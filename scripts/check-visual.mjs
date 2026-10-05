/**
 * node scripts/check-visual.mjs <站点目录> [--shots <目录>]
 * 需要浏览器的检查：图上文字对比度、悬浮条压页脚、横向溢出、同组图片比例、点击区、顶栏高度。
 * Playwright 从 PLAYWRIGHT_PATH 或仓库外的 site-studio-refs 里找。找不到就打印「跳过」并退出 0。
 *
 * 确定状态（不改框架）：
 * 每个视口用 Playwright reducedMotion=reduce，让 CSS 和 site.js 都走减少动效。
 * 轮播不自动播，入场不走 no-preference 的淡入，数字留在终值。
 * 再注入 data-fitout-check="settle"：把动画时长压到 0.01ms，并盖掉框架「减少动效时桌面悬浮条强制可见」。
 * 悬浮条按规则摆：宽 <1024 一直贴底；宽 ≥1024 只在滚过一屏（折线标记 top<=0）后出现。
 * 3000–5000ms 的 setInterval 直接丢掉，避免自动翻页。
 * 首屏每个轮播的每一张都点开，分别采样图上文字。失败行写第几张。
 */
import fs from "fs";
import http from "http";
import path from "path";
import { pathToFileURL } from "url";

const args = process.argv.slice(2);
let shots = "";
const dirs = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--shots") {
    shots = path.resolve(args[i + 1] || "");
    i += 1;
  } else dirs.push(path.resolve(args[i]));
}
if (!dirs.length) {
  console.error("用法：node scripts/check-visual.mjs <站点目录> [--shots <目录>]");
  process.exit(2);
}

const pw = findPlaywright();
if (!pw) {
  console.log("跳过");
  process.exit(0);
}

const { chromium } = await import(pathToFileURL(pw).href);
const failures = [];
const browser = await launch(chromium);

try {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      failures.push(`${dir} 不存在`);
      continue;
    }
    const server = await serve(dir);
    try {
      const pages = walk(dir).filter((file) => file.endsWith(".html")).map((file) => path.relative(dir, file).replaceAll("\\", "/"));
      const home = pages.includes("index.html") ? "index.html" : pages[0];
      const extra = pages.find((file) => file !== home) || "";
      for (const width of [375, 768, 1024, 1440]) {
        await checkWidth(dir, server.port, home, width, true);
        if (extra) await checkWidth(dir, server.port, extra, width, false);
      }
    } finally {
      await new Promise((resolve) => server.server.close(resolve));
    }
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(`视觉检查：不通过（${failures.length}）`);
  for (const item of failures) console.log(`- ${item}`);
  process.exit(1);
}
console.log("视觉检查：通过");

function findPlaywright() {
  const fromEnv = process.env.PLAYWRIGHT_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const bundled = "H:\\ai_tool\\site-studio-refs\\scripts\\node_modules\\playwright\\index.mjs";
  if (fs.existsSync(bundled)) return bundled;
  return "";
}

async function launch(chromiumApi) {
  const tries = [{ headless: true }, { headless: true, channel: "msedge" }, { headless: true, channel: "chrome" }];
  let last = null;
  for (const options of tries) {
    try {
      return await chromiumApi.launch(options);
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

function serve(dir) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    let rel = url === "/" ? "/index.html" : url;
    if (rel.endsWith("/")) rel += "index.html";
    const target = path.resolve(dir, `.${rel}`);
    if (!target.startsWith(path.resolve(dir))) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    res.writeHead(200, { "Content-Type": types[path.extname(target).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(target).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function checkWidth(dir, port, file, width, shoot) {
  const context = await browser.newContext({
    viewport: { width, height: width <= 768 ? 900 : 800 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await installSettle(page);
  const url = `http://127.0.0.1:${port}/${file.split("/").map(encodeURIComponent).join("/")}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await settlePage(page);
  const label = `${path.basename(dir)} ${file} ${width}px`;
  const ready = await page.evaluate(() => {
    const zeros = [...document.querySelectorAll("[data-count]")].filter((el) => {
      const target = Number(String(el.getAttribute("data-count") || "").replace(/,/g, ""));
      return Number.isFinite(target) && target !== 0 && (el.textContent || "").trim() === "0";
    }).length;
    return {
      flag: document.documentElement.getAttribute("data-fitout-check"),
      reduce: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      error: window.__fitoutSettleError || "",
      zeros,
    };
  });
  if (ready.flag !== "settle" || !ready.reduce) {
    failures.push(`${label} 确定状态没装上${ready.error ? `：${ready.error}` : ""}（flag=${ready.flag || "无"} reduce=${ready.reduce}）`);
  }
  if (ready.zeros) failures.push(`${label} 数字还停在 0，有 ${ready.zeros} 处`);
  const contrast = await sampleContrasts(page);
  for (const item of contrast) pushContrast(label, item);
  const ratios = await page.evaluate(groupRatios);
  for (const item of ratios) {
    if (!item.ok) failures.push(`${label} 图片组 ${item.id} 比例不一致`);
  }
  const chrome = await page.evaluate(chromeProbe);
  if (chrome.header > (chrome.overlay ? 160 : 110)) {
    failures.push(`${label} 顶栏高 ${Math.round(chrome.header)}px，超过 ${chrome.overlay ? 160 : 110}`);
  }
  for (const item of chrome.small) failures.push(`${label} 点击区 ${Math.round(item.w)}×${Math.round(item.h)}：${item.text}`);
  const overflow = await page.evaluate(overflowProbe);
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    failures.push(`${label} 横向溢出 scrollWidth ${overflow.scrollWidth}，视口 ${overflow.clientWidth}`);
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.evaluate(() => { if (window.__fitoutPlaceDock) window.__fitoutPlaceDock(); });
  await frames(page);
  const cover = await page.evaluate(footerProbe);
  if (cover.missing) failures.push(`${label} 没有悬浮条或页脚`);
  else if (cover.hit.length) failures.push(`${label} 悬浮条压住页脚：${cover.hit.join("；")}`);
  if (shoot && shots && file === "index.html") {
    fs.mkdirSync(shots, { recursive: true });
    const name = path.basename(dir);
    await page.screenshot({ path: path.join(shots, `${name}-${width}-bottom.png`) });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => { if (window.__fitoutPlaceDock) window.__fitoutPlaceDock(); });
    await frames(page);
    await page.screenshot({ path: path.join(shots, `${name}-${width}.png`) });
  }
  await context.close();
}

async function installSettle(page) {
  await page.addInitScript(() => {
    window.__fitoutSettleError = "";
    try {
      const orig = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        const text = String(query);
        if (text.includes("prefers-reduced-motion")) {
          return {
            matches: /prefers-reduced-motion:\s*reduce/.test(text),
            media: text,
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent() { return false; },
          };
        }
        return orig(query);
      };
      const nativeSetInterval = window.setInterval.bind(window);
      window.setInterval = (fn, delay, ...rest) => {
        const ms = Number(delay);
        if (ms >= 3000 && ms <= 5000) return 0;
        return nativeSetInterval(fn, delay, ...rest);
      };
      window.__fitoutPlaceDock = () => {
        const dock = document.querySelector("[data-float]");
        if (!dock) return;
        let mark = document.querySelector("[data-fold-mark]");
        if (!mark && document.body) {
          mark = document.createElement("div");
          mark.setAttribute("data-fold-mark", "");
          mark.setAttribute("aria-hidden", "true");
          document.body.appendChild(mark);
        }
        const desktop = window.matchMedia("(min-width: 1024px)").matches;
        if (!desktop) {
          dock.classList.add("is-dock");
          return;
        }
        const top = mark ? mark.getBoundingClientRect().top : 1;
        dock.classList.toggle("is-dock", top <= 0);
      };
      const arm = () => {
        const root = document.documentElement;
        if (!root || root.getAttribute("data-fitout-check") === "settle") return;
        root.setAttribute("data-fitout-check", "settle");
        const style = document.createElement("style");
        style.setAttribute("data-fitout-check", "settle");
        style.textContent = [
          "*,*::before,*::after{animation-duration:0.01ms !important;animation-delay:0s !important;animation-iteration-count:1 !important;transition-duration:0.01ms !important;transition-delay:0s !important;scroll-behavior:auto !important;}",
          "@media (min-width:1024px){html[data-fitout-check=settle] .js .float-dock:not(.is-dock){opacity:0 !important;visibility:hidden !important;pointer-events:none !important;}}",
        ].join("");
        root.appendChild(style);
      };
      if (document.documentElement) arm();
      else document.addEventListener("DOMContentLoaded", arm);
    } catch (err) {
      window.__fitoutSettleError = String((err && err.message) || err);
    }
  });
}

async function settlePage(page) {
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const imgs = [...document.images].filter((img) => img.getAttribute("loading") !== "lazy");
    await Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => {}))));
    document.querySelectorAll("[data-enter]").forEach((el) => el.classList.add("is-in"));
    if (window.__fitoutPlaceDock) window.__fitoutPlaceDock();
  });
  await frames(page);
  await page.waitForFunction(() => {
    const nodes = [...document.querySelectorAll("[data-enter]")];
    return nodes.every((el) => Number.parseFloat(getComputedStyle(el).opacity) > 0.99);
  }, null, { timeout: 3000 });
}

function frames(page) {
  return page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function sampleContrasts(page) {
  const carousels = await page.evaluate(() => [...document.querySelectorAll("[data-carousel]")].map((root, index) => ({
    index,
    slides: root.querySelectorAll("[data-slide]").length,
    id: root.id || root.getAttribute("data-section") || "",
  })));
  const results = [];
  for (const item of await sampleContrast(page, { scope: "outside" })) results.push(item);
  const active = carousels.filter((item) => item.slides > 0);
  const many = active.length > 1;
  try {
    for (const carousel of active) {
      const name = many ? `轮播${carousel.id || carousel.index + 1}` : "";
      for (let i = 0; i < carousel.slides; i += 1) {
        try {
          await showSlide(page, carousel.index, i);
        } catch (err) {
          results.push({
            ratio: Number.NaN,
            need: 0,
            text: "",
            error: String((err && err.message) || err).split("\n")[0],
            slide: i + 1,
            carousel: name,
          });
          continue;
        }
        const found = await sampleContrast(page, { scope: "carousel", index: carousel.index });
        if (i === 0 && !found.length) break;
        for (const item of found) results.push({ ...item, slide: i + 1, carousel: name });
      }
    }
  } finally {
    for (const carousel of active) {
      if (carousel.slides > 1) {
        try {
          await showSlide(page, carousel.index, 0);
        } catch {
          /* 后面的顶图截图就停在切失败的那一张 */
        }
      }
    }
  }
  return results;
}

async function showSlide(page, index, slide) {
  await page.evaluate(async ({ index, slide }) => {
    const root = document.querySelectorAll("[data-carousel]")[index];
    if (!root) return;
    const dots = root.querySelectorAll("[data-carousel-dot]");
    if (dots[slide]) dots[slide].click();
    else {
      root.querySelectorAll("[data-slide]").forEach((el, n) => {
        el.classList.toggle("is-current", n === slide);
      });
    }
    const el = root.querySelectorAll("[data-slide]")[slide];
    if (el && el.tagName === "IMG" && !el.complete) {
      await new Promise((resolve) => {
        const timer = window.setTimeout(resolve, 8000);
        const done = () => {
          window.clearTimeout(timer);
          resolve();
        };
        el.addEventListener("load", done, { once: true });
        el.addEventListener("error", done, { once: true });
      });
    }
  }, { index, slide });
  await page.waitForFunction(({ index, slide }) => {
    const root = document.querySelectorAll("[data-carousel]")[index];
    if (!root) return true;
    const el = root.querySelectorAll("[data-slide]")[slide];
    if (!el) return true;
    if (!el.classList.contains("is-current")) return false;
    return Number.parseFloat(getComputedStyle(el).opacity) > 0.99;
  }, { index, slide }, { timeout: 4000 });
  await frames(page);
}

function pushContrast(label, item) {
  const bits = [];
  if (item.carousel) bits.push(item.carousel);
  if (item.slide) bits.push(`第${item.slide}张`);
  const prefix = bits.length ? `${bits.join(" ")} ` : "";
  if (item.error) {
    failures.push(`${label} ${prefix}图上文字对比度采样失败：${item.text || "这一张"}（${item.error}）`);
    return;
  }
  if (item.ratio < item.need) {
    failures.push(`${label} ${prefix}图上文字对比度 ${item.ratio.toFixed(2)}，低于 ${item.need}：${item.text}`);
  }
}

async function sampleContrast(page, filter) {
  const boxes = await page.evaluate((filter) => {
    const lin = (v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const parse = (text) => {
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.fillStyle = "#000";
      ctx.fillStyle = text;
      const hex = ctx.fillStyle;
      return {
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16),
        lum: lum(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)),
      };
    };
    const opaque = (el) => {
      const parts = getComputedStyle(el).backgroundColor.match(/[\d.]+/g) || [];
      const alpha = parts.length >= 4 ? Number(parts[3]) : (parts.length ? 1 : 0);
      return alpha > 0.25;
    };
    const onImage = (el) => {
      if (opaque(el)) return false;
      if (el.closest("[data-on-media], .hero-copy, .page-banner-copy")) return true;
      const r = el.getBoundingClientRect();
      for (const img of document.images) {
        const b = img.getBoundingClientRect();
        const area = Math.max(0, Math.min(r.right, b.right) - Math.max(r.left, b.left)) * Math.max(0, Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top));
        if (area > 40) return true;
      }
      return false;
    };
    const roots = [...document.querySelectorAll("[data-carousel]")];
    const scopeRoot = filter && filter.scope === "carousel" ? roots[filter.index] || null : null;
    const out = [];
    for (const el of document.querySelectorAll("[data-on-media] h1, [data-on-media] h2, [data-on-media] p, [data-on-media] a, .hero-copy h1, .hero-copy p, .page-banner-copy h1, .page-banner-copy a")) {
      const owner = el.closest("[data-carousel]");
      if (filter && filter.scope === "outside" && owner) continue;
      if (filter && filter.scope === "carousel" && owner !== scopeRoot) continue;
      if (opaque(el) || !onImage(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize) || 16;
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const text = (el.textContent || "").trim().slice(0, 24);
      if (!text) continue;
      out.push({
        x: r.x, y: r.y, width: r.width, height: r.height,
        color: cs.color,
        text,
        need: size >= 24 || (weight >= 600 && size >= 18.66) ? 3 : 4.5,
        textRgb: parse(cs.color),
      });
    }
    return out;
  }, filter || null);
  const view = page.viewportSize() || { width: 0, height: 0 };
  const results = [];
  for (const box of boxes) {
    const clip = clipBox(box, view);
    if (!clip) continue;
    let buffer;
    try {
      buffer = await page.screenshot({ clip });
    } catch (err) {
      results.push({ ratio: Number.NaN, need: box.need, text: box.text, error: String((err && err.message) || err).split("\n")[0] });
      continue;
    }
    const ratio = await page.evaluate(async ({ b64, rgb }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      const lin = (v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const bg = [];
      const all = [];
      for (let i = 0; i < data.length; i += 16) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const L = lum(r, g, b);
        all.push(L);
        const dist = Math.abs(r - rgb.r) + Math.abs(g - rgb.g) + Math.abs(b - rgb.b);
        if (dist > 48) bg.push(L);
      }
      const pool = bg.length >= 8 ? bg : all;
      pool.sort((a, b) => a - b);
      const med = pool[Math.floor(pool.length / 2)] || 0;
      const tl = rgb.lum;
      return (Math.max(tl, med) + 0.05) / (Math.min(tl, med) + 0.05);
    }, { b64: buffer.toString("base64"), rgb: box.textRgb });
    results.push({ ratio, need: box.need, text: box.text });
  }
  return results;
}

function clipBox(box, view) {
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  let width = Math.max(1, Math.min(box.width, 800));
  let height = Math.max(1, Math.min(box.height, 400));
  if (x >= view.width || y >= view.height) return null;
  if (x + width > view.width) width = view.width - x;
  if (y + height > view.height) height = view.height - y;
  if (width < 8 || height < 8) return null;
  return { x, y, width, height };
}

function groupRatios() {
  const out = [];
  for (const group of document.querySelectorAll("[data-media-group]")) {
    const id = group.getAttribute("data-media-group") || "";
    const ratios = [...group.querySelectorAll("img")].map((img) => {
      const r = img.getBoundingClientRect();
      return r.width > 2 && r.height > 2 ? r.width / r.height : 0;
    }).filter((n) => n > 0);
    if (ratios.length < 2) continue;
    const base = ratios[0];
    out.push({ id, ok: ratios.every((n) => Math.abs(n - base) / base <= 0.08) });
  }
  return out;
}

function chromeProbe() {
  const header = document.querySelector("header");
  const bar = header ? header.getBoundingClientRect().height : 0;
  const overlay = !!(header && header.hasAttribute("data-overlay"));
  const small = [];
  const seen = new Set();
  for (const el of document.querySelectorAll("header a, header button, footer a, footer button, [data-float] a, [data-float] button, [data-float] summary, .btn")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.width >= 44 && r.height >= 44) continue;
    const text = (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 20);
    const key = `${text}:${Math.round(r.width)}:${Math.round(r.height)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    small.push({ w: r.width, h: r.height, text });
  }
  return { header: bar, overlay, small };
}

function footerProbe() {
  const dock = document.querySelector("[data-float]");
  const foot = document.querySelector("footer");
  if (!dock || !foot) return { missing: true, hit: [] };
  const d = dock.getBoundingClientRect();
  const hit = [];
  foot.querySelectorAll("p, a, button, span, li").forEach((el) => {
    if (el.children.length && el.tagName !== "A" && el.tagName !== "BUTTON") return;
    const text = (el.textContent || "").trim();
    if (!text) return;
    const r = el.getBoundingClientRect();
    const area = Math.max(0, Math.min(r.right, d.right) - Math.max(r.left, d.left)) * Math.max(0, Math.min(r.bottom, d.bottom) - Math.max(r.top, d.top));
    if (area > 20) hit.push(text.slice(0, 24));
  });
  return { missing: false, hit };
}

function overflowProbe() {
  const root = document.documentElement;
  const body = document.body;
  return {
    scrollWidth: Math.max(root.scrollWidth, body ? body.scrollWidth : 0),
    clientWidth: root.clientWidth,
  };
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
