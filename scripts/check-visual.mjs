/**
 * node scripts/check-visual.mjs <站点目录> [--shots <目录>] [--layout-only] [--page <相对路径>]... [--widths 375,1440]
 * 需要浏览器的检查：图上文字对比度、按钮对比度、悬浮条压页脚、横向溢出、同组图片比例、点击区、顶栏高度，
 * 以及版式检查 L1 到 L19（本文件末尾的 layoutProbe：面包屑基线、页脚空白、图标间距、占位图字号、
 * 小于 12px 的字、内部键名、文字被裁、按钮列宽、栏高失衡、同行顶边、左缘对齐、手机页脚间距、导航间距、
 * 首屏文案间距、短文字折行、网格末行孤儿卡、半宽空白板块、页头文字被省略号截断；
 * L18 统计数字上下不齐要截图量像素，单独在 measureNumerals 里量）。
 * 每个页面、每个宽度都量（L18 只在最宽的一档量）。同一条问题跨页合并成一行，写出现了几处和第一个例子。
 * --layout-only 只跑版式检查（反例测试用）；--page 只看指定页；--widths 指定宽度，默认 375,768,1024,1440。
 * Playwright 先看环境变量 PLAYWRIGHT_PATH（指到入口文件或包目录都行），没设置就按 Node 正常的模块解析找。找不到就打印「跳过」并退出 0。
 *
 * 确定状态（不改框架）：
 * 每个视口用 Playwright reducedMotion=reduce，让 CSS 和 site.js 都走减少动效。
 * 轮播不自动播，入场不走 no-preference 的淡入，数字留在终值。
 * 再注入 data-fitout-check="settle"：把动画时长压到 0.01ms，并盖掉框架「减少动效时桌面悬浮条强制可见」。
 * 悬浮条按规则摆：宽 <1024 一直贴底；宽 ≥1024 只在滚过一屏（折线标记 top<=0）后出现。
 * 3000–5000ms 的 setInterval 直接丢掉，避免自动翻页。
 * 首屏每个轮播的每一张都点开，分别采样图上文字。失败行写第几张。
 *
 * 另开一个不减少动效的上下文，页面加载后不滚动、不等入场动画，
 * 马上量首页标题和按钮、内页 Banner 的透明度（含祖先）。必须是 1。
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { readJson } from "./lib/json.mjs";
import { FLAVOR_LIMITS } from "./lib/rules.mjs";
import { findPlaywright } from "./images/lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
let shots = "";
let layoutOnly = false;
let widths = [375, 768, 1024, 1440];
const onlyPages = [];
const dirs = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--shots") {
    shots = path.resolve(args[i + 1] || "");
    i += 1;
  } else if (args[i] === "--layout-only") {
    layoutOnly = true;
  } else if (args[i] === "--page") {
    onlyPages.push(String(args[i + 1] || "").replaceAll("\\", "/"));
    i += 1;
  } else if (args[i] === "--widths") {
    widths = String(args[i + 1] || "").split(",").map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 280);
    i += 1;
  } else dirs.push(path.resolve(args[i]));
}
if (!dirs.length || !widths.length) {
  console.error("用法：node scripts/check-visual.mjs <站点目录> [--shots <目录>] [--layout-only] [--page <相对路径>]... [--widths 375,1440]");
  process.exit(2);
}

const pw = findPlaywright();
if (!pw) {
  console.log("跳过");
  process.exit(0);
}

const loadedPw = await import(pathToFileURL(pw).href);
const chromium = loadedPw.chromium || loadedPw.default?.chromium;
if (!chromium) {
  console.log("跳过：Playwright 在，但没有 chromium 导出");
  process.exit(0);
}
const failures = [];
const layoutHits = new Map();
const browser = await launch(chromium);

try {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      failures.push(`${dir} 不存在`);
      continue;
    }
    const server = await serve(dir);
    try {
      let pages = walk(dir).filter((file) => file.endsWith(".html")).map((file) => path.relative(dir, file).replaceAll("\\", "/"));
      if (onlyPages.length) pages = pages.filter((file) => onlyPages.includes(file));
      if (!pages.length) {
        failures.push(`${path.basename(dir)} 没有可检查的页面`);
        continue;
      }
      const slotIds = slotIdsOfDir(dir);
      if (layoutOnly) {
        for (const width of widths) await checkLayoutOn(dir, server.port, pages, width, slotIds);
        continue;
      }
      const home = pages.includes("index.html") ? "index.html" : pages[0];
      const extra = pages.find((file) => file !== home) || "";
      const flavor = flavorOfDir(dir);
      await checkFirstPaint(dir, server.port, home);
      if (extra) await checkFirstPaint(dir, server.port, extra);
      for (const width of widths) {
        await checkWidth(dir, server.port, home, width, true, flavor, slotIds);
        if (extra) await checkWidth(dir, server.port, extra, width, false, flavor, slotIds);
        const rest = pages.filter((file) => file !== home && file !== extra);
        await checkButtonsOn(dir, server.port, rest, width, slotIds);
      }
    } finally {
      await new Promise((resolve) => server.server.close(resolve));
    }
  }
} finally {
  await browser.close();
}

for (const hit of layoutHits.values()) {
  failures.push(`${hit.site} 版式[${hit.rule}] ${hit.sig}：${hit.where.size} 处（例 ${hit.example}）`);
}

if (failures.length) {
  console.log(`视觉检查：不通过（${failures.length}）`);
  for (const item of failures) console.log(`- ${item}`);
  process.exit(1);
}
console.log("视觉检查：通过");

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

function flavorOfDir(dir) {
  const siteFile = path.join(dir, "site.json");
  if (!fs.existsSync(siteFile)) return "";
  let site;
  try {
    site = readJson(siteFile);
  } catch {
    return "";
  }
  const id = site?.showroom;
  if (typeof id !== "string" || !/^[a-z0-9_-]+$/.test(id)) return "";
  const metaFile = path.join(repoRoot, "showrooms", id, "showroom.json");
  if (!fs.existsSync(metaFile)) return "";
  try {
    const meta = readJson(metaFile);
    return meta.flavor === "intl" || meta.flavor === "cn" ? meta.flavor : "";
  } catch {
    return "";
  }
}

async function checkWidth(dir, port, file, width, shoot, flavor, slotIds) {
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
  await recordLayout(page, dir, file, width, slotIds);
  const contrast = await sampleContrasts(page);
  for (const item of contrast) pushContrast(label, item);
  for (const item of await sampleButtonContrasts(page)) pushButtonContrast(label, item);
  const ratios = await page.evaluate(groupRatios);
  for (const item of ratios) {
    if (!item.ok) failures.push(`${label} 图片组 ${item.id} 比例不一致`);
  }
  const chrome = await page.evaluate(chromeProbe);
  if (chrome.header > (chrome.overlay ? 160 : 110)) {
    failures.push(`${label} 顶栏高 ${Math.round(chrome.header)}px，超过 ${chrome.overlay ? 160 : 110}`);
  }
  if (flavor === "intl" && width >= 1024) {
    const hero = await page.evaluate(() => {
      const el = document.querySelector("[data-section='hero']");
      if (!el) return null;
      const h1 = el.querySelector("h1");
      const fs = h1 ? Number.parseFloat(getComputedStyle(h1).fontSize) : 0;
      const view = window.innerHeight || 1;
      return { height: el.getBoundingClientRect().height, view, fs };
    });
    if (hero && hero.view > 0) {
      const ratio = hero.height / hero.view;
      const band = FLAVOR_LIMITS.intl.heroViewport;
      if (ratio < band.min - 0.02 || ratio > band.max + 0.02) {
        failures.push(`${label} 国际风首屏高度 ${ratio.toFixed(2)} 屏，要在 ${band.min} 到 ${band.max}`);
      }
      if (hero.fs > FLAVOR_LIMITS.intl.heroMax + 0.5) {
        failures.push(`${label} 国际风首屏标题 ${Math.round(hero.fs)}px，超过 ${FLAVOR_LIMITS.intl.heroMax}px`);
      }
    }
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

// 只跑版式检查：每页每个宽度开一次页面。反例测试和单查版式用。
async function checkLayoutOn(dir, port, files, width, slotIds) {
  const context = await browser.newContext({
    viewport: { width, height: width <= 768 ? 900 : 800 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await installSettle(page);
  try {
    for (const file of files) {
      const url = `http://127.0.0.1:${port}/${file.split("/").map(encodeURIComponent).join("/")}`;
      await page.goto(url, { waitUntil: "networkidle" });
      await settlePage(page);
      await recordLayout(page, dir, file, width, slotIds);
    }
  } finally {
    await context.close();
  }
}

async function recordLayout(page, dir, file, width, slotIds) {
  const site = path.basename(dir);
  let found;
  try {
    found = await page.evaluate(layoutProbe, { slotIds });
  } catch (err) {
    failures.push(`${site} ${file} ${width}px 版式探针出错：${String((err && err.message) || err).split("\n")[0]}`);
    return;
  }
  for (const item of found) pushLayoutHit(site, file, width, item);
  // L18 要截图量像素，数字的字形和页面宽度无关，只在最宽的那一档量一遍。
  if (width === Math.max(...widths)) {
    try {
      for (const item of await measureNumerals(page)) pushLayoutHit(site, file, width, item);
    } catch (err) {
      failures.push(`${site} ${file} ${width}px 数字基线探针出错：${String((err && err.message) || err).split("\n")[0]}`);
    }
  }
}

function pushLayoutHit(site, file, width, item) {
  const key = `${site}|${item.rule}|${item.sig}`;
  let hit = layoutHits.get(key);
  if (!hit) {
    hit = { site, rule: item.rule, sig: item.sig, where: new Set(), example: `${file} ${width}px：${item.detail}` };
    layoutHits.set(key, hit);
  }
  hit.where.add(`${file}@${width}`);
}

/**
 * L18 统计数字上下不齐：同一串数字里，有的数字沉到基线下面（衬线字体的老式数字：3、4、5、7、9 下坠，0、1、2 留在 x 高度）。
 * DOM 量不出字形，所以截图量墨迹：先在页面里找出「大字号的短数字串」（字号 ≥ 26px、整段文字 ≤ 16 个字符、至少 2 个数字），
 * 每个数字取自己的字符盒（Range），截下这一小块，在每个数字的格子里找墨迹的最低一行。
 * 等高数字的最低一行基本一样（圆的数字会多出 1 到 2px 的过冲）；最低行的极差超过 max(3px, 字号的 10%) 就是上下不齐。
 * 字和底色反差太小（背景是照片、反差 < 250）的不量，免得误报。
 */
async function measureNumerals(page) {
  const found = await page.evaluate(numeralCandidates);
  const out = [];
  const view = page.viewportSize() || { width: 0, height: 0 };
  for (const cand of found) {
    const box = await page.evaluate(numeralBox, cand.n);
    if (!box) continue;
    const clip = clipBox({ x: box.x, y: box.y, width: box.width, height: box.height }, view);
    if (!clip || Math.abs(clip.x - box.x) > 1 || Math.abs(clip.y - box.y) > 1 || clip.width < box.width - 1 || clip.height < box.height - 1) continue;
    let buffer;
    try {
      buffer = await page.screenshot({ clip });
    } catch {
      continue;
    }
    const res = await page.evaluate(numeralInk, { b64: buffer.toString("base64"), digits: box.digits, fg: box.fg });
    if (!res) continue;
    if (res.spread > Math.max(3, cand.fs * 0.1)) {
      out.push({
        rule: "L18",
        sig: `统计数字上下不齐：${cand.where}`,
        detail: `${cand.where}「${cand.text}」字号 ${Math.round(cand.fs)}px，各数字最低一行相差 ${res.spread}px（${res.bottoms.join("/")}）`,
      });
    }
  }
  await page.evaluate(() => {
    document.querySelectorAll("[data-fitout-num]").forEach((el) => el.removeAttribute("data-fitout-num"));
    window.scrollTo(0, 0);
  });
  return out;
}

function numeralCandidates() {
  const main = document.querySelector("main") || document.body;
  const visibleEl = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    for (let p = e; p && p !== document.documentElement; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
      if (p.tagName === "DETAILS" && !p.open && !(e.tagName === "SUMMARY")) return false;
    }
    return true;
  };
  const digitsIn = (text) => (text.match(/\d/g) || []).length;
  const ok = (e) => {
    if (e.closest(".float-dock, .demo-badge, .skip, script, style")) return false;
    const text = (e.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length > 16 || digitsIn(text) < 2) return false;
    if (Number.parseFloat(getComputedStyle(e).fontSize) < 26) return false;
    return visibleEl(e);
  };
  const sel2 = (e) => {
    let s = e.tagName.toLowerCase();
    const c = (e.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (c.length) s += `.${c.join(".")}`;
    return s;
  };
  const seen = new Set();
  const list = [];
  for (const e of main.querySelectorAll("*")) {
    if (list.length >= 12) break;
    if (!ok(e)) continue;
    if (e.parentElement && e.parentElement !== main && ok(e.parentElement)) continue;
    const s = getComputedStyle(e);
    const text = (e.textContent || "").replace(/\s+/g, " ").trim();
    const key = `${s.fontFamily}|${s.fontSize}|${s.fontWeight}|${s.fontVariantNumeric}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const n = list.length;
    e.setAttribute("data-fitout-num", String(n));
    list.push({ n, fs: Number.parseFloat(s.fontSize), text, where: sel2(e) });
  }
  return list;
}

function numeralBox(n) {
  const el = document.querySelector(`[data-fitout-num="${n}"]`);
  if (!el) return null;
  el.scrollIntoView({ block: "center", inline: "nearest" });
  const digits = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node;
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  while ((node = walker.nextNode())) {
    const value = node.nodeValue;
    for (let i = 0; i < value.length; i += 1) {
      if (!/\d/.test(value[i])) continue;
      const rg = document.createRange();
      rg.setStart(node, i);
      rg.setEnd(node, i + 1);
      const r = rg.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      digits.push({ l: r.left, r: r.right, t: r.top, b: r.bottom });
      x0 = Math.min(x0, r.left);
      y0 = Math.min(y0, r.top);
      x1 = Math.max(x1, r.right);
      y1 = Math.max(y1, r.bottom);
    }
  }
  if (digits.length < 2) return null;
  const pad = 6;
  const x = Math.floor(x0 - pad);
  const y = Math.floor(y0 - pad);
  const width = Math.ceil(x1 + pad) - x;
  const height = Math.ceil(y1 + pad) - y;
  const cs = getComputedStyle(el);
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillStyle = cs.color;
  const hex = ctx.fillStyle;
  const fg = { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
  return { x, y, width, height, fg, digits: digits.map((d) => ({ l: d.l - x, r: d.r - x, t: d.t - y, b: d.b - y })) };
}

async function numeralInk({ b64, digits, fg }) {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const W = img.width;
  const H = img.height;
  const data = ctx.getImageData(0, 0, W, H).data;
  const px = (x, y) => {
    const i = (y * W + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  // 背景色：四个角的中位数。
  const corners = [px(0, 0), px(W - 1, 0), px(0, H - 1), px(W - 1, H - 1)];
  const med = (k) => corners.map((c) => c[k]).sort((a, b) => a - b)[1];
  const bg = [med(0), med(1), med(2)];
  const full = Math.abs(fg.r - bg[0]) + Math.abs(fg.g - bg[1]) + Math.abs(fg.b - bg[2]);
  if (full < 250) return null;
  const bottoms = [];
  for (const d of digits) {
    // 只在这个数字自己的行盒（上到下）和格子（左到右）里找，下面一行的字不算。
    const xa = Math.max(0, Math.floor(d.l) + 1);
    const xb = Math.min(W - 1, Math.ceil(d.r) - 1);
    const ya = Math.max(0, Math.floor(d.t));
    const yb = Math.min(H - 1, Math.ceil(d.b) - 1);
    // 从上往下找第一段连续有墨迹的行（数字的字形是一整块，竖向投影不会断），它的最后一行就是这个数字的底。
    // 数字下面紧跟着的标签文字，和数字之间隔着空行，是另一段，不算。
    let start = -1;
    let bottom = -1;
    for (let y = ya; y <= yb; y += 1) {
      let inked = false;
      for (let x = xa; x <= xb; x += 1) {
        const p = px(x, y);
        const dist = Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]);
        if (dist > full * 0.5) {
          inked = true;
          break;
        }
      }
      if (inked) {
        if (start < 0) start = y;
        bottom = y;
      } else if (start >= 0 && y - bottom >= 2) break;
    }
    if (bottom < 0) return null;
    bottoms.push(bottom);
  }
  return { spread: Math.max(...bottoms) - Math.min(...bottoms), bottoms };
}

function slotIdsOfDir(dir) {
  const siteFile = path.join(dir, "site.json");
  if (!fs.existsSync(siteFile)) return [];
  try {
    const id = readJson(siteFile)?.showroom;
    if (typeof id !== "string" || !/^[a-z0-9_-]+$/.test(id)) return [];
    const file = path.join(repoRoot, "showrooms", id, "images.json");
    if (!fs.existsSync(file)) return [];
    return (readJson(file).slots || []).map((slot) => String(slot?.id || "")).filter(Boolean);
  } catch {
    return [];
  }
}

async function checkFirstPaint(dir, port, file) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  const label = `${path.basename(dir)} ${file} 首屏`;
  try {
    const url = `http://127.0.0.1:${port}/${file.split("/").map(encodeURIComponent).join("/")}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const probe = await page.evaluate(() => {
      const used = (el) => {
        let value = 1;
        let node = el;
        while (node && node.nodeType === 1) {
          const cs = getComputedStyle(node);
          const n = Number.parseFloat(cs.opacity);
          if (Number.isFinite(n)) value *= n;
          if (cs.visibility === "hidden") value = 0;
          node = node.parentElement;
        }
        return value;
      };
      const hero = document.querySelector("[data-section='hero']");
      const banner = document.querySelector("[data-section='page-banner']");
      const root = hero || banner;
      const kind = hero ? "hero" : (banner ? "banner" : "");
      const title = root ? root.querySelector("h1, h2") : document.querySelector("main h1, h1");
      const buttons = root ? [...root.querySelectorAll("a.btn, button.btn")] : [];
      const pack = (el, role) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const view = window.innerHeight || 0;
        return {
          role,
          text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24),
          opacity: used(el),
          inView: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < view,
        };
      };
      return {
        elapsed: Math.round(performance.now()),
        title: pack(title, kind === "banner" ? "内页 Banner 标题" : "标题"),
        buttons: buttons.map((el) => pack(el, kind === "banner" ? "内页 Banner 按钮" : "按钮")).filter(Boolean),
      };
    });
    const shown = (n) => (Number.isFinite(n) ? n.toFixed(2) : "无效");
    if (!probe.title) {
      failures.push(`${label} 没有首屏标题`);
    } else if (!probe.title.inView) {
      failures.push(`${label} ${probe.title.role}「${probe.title.text}」不在视口内（${probe.elapsed}ms）`);
    } else if (!(probe.title.opacity >= 0.99)) {
      failures.push(`${label} ${probe.title.role}「${probe.title.text}」在 ${probe.elapsed}ms 时 opacity ${shown(probe.title.opacity)}，要是 1`);
    }
    for (const item of probe.buttons) {
      if (item.opacity >= 0.99) continue;
      failures.push(`${label} ${item.role}「${item.text}」在 ${probe.elapsed}ms 时 opacity ${shown(item.opacity)}，要是 1`);
    }
  } catch (err) {
    failures.push(`${label} 首屏透明度检查失败：${String((err && err.message) || err).split("\n")[0]}`);
  } finally {
    await context.close();
  }
}

async function checkButtonsOn(dir, port, files, width, slotIds) {
  if (!files.length) return;
  const context = await browser.newContext({
    viewport: { width, height: width <= 768 ? 900 : 800 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await installSettle(page);
  try {
    for (const file of files) {
      const url = `http://127.0.0.1:${port}/${file.split("/").map(encodeURIComponent).join("/")}`;
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await settlePage(page);
      const label = `${path.basename(dir)} ${file} ${width}px`;
      await recordLayout(page, dir, file, width, slotIds);
      for (const item of await sampleButtonContrasts(page)) pushButtonContrast(label, item);
    }
  } finally {
    await context.close();
  }
}

function pushButtonContrast(label, item) {
  if (item.error || !Number.isFinite(item.ratio)) {
    failures.push(`${label} 按钮对比度采样失败：${item.text || "按钮"}${item.error ? `（${item.error}）` : ""}`);
    return;
  }
  if (item.ratio < item.need) {
    failures.push(`${label} 按钮对比度 ${item.ratio.toFixed(2)}，低于 ${item.need}：${item.text}`);
  }
}

async function sampleButtonContrasts(page) {
  const found = await page.evaluate(collectButtons);
  const results = [...found.solid];
  for (const item of found.shot) {
    await page.evaluate((n) => {
      const el = document.querySelector(`[data-fitout-btn-shot="${n}"]`);
      if (el) el.scrollIntoView({ block: "center", inline: "nearest" });
    }, item.n);
    await frames(page);
    const box = await page.evaluate(readShotButton, item.n);
    if (!box) {
      results.push({ ratio: Number.NaN, need: item.need, text: item.text, error: "找不到按钮" });
      continue;
    }
    results.push(await contrastAt(page, box));
  }
  await page.evaluate(() => {
    document.querySelectorAll("[data-fitout-btn-shot]").forEach((el) => el.removeAttribute("data-fitout-btn-shot"));
    window.scrollTo(0, 0);
  });
  return results;
}

function collectButtons() {
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
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b, lum: lum(r, g, b) };
  };
  const ratioOf = (fg, bg) => {
    const a = parse(fg).lum;
    const b = parse(bg).lum;
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const painted = (el) => {
    const cs = getComputedStyle(el);
    const image = cs.backgroundImage && cs.backgroundImage !== "none";
    const parts = String(cs.backgroundColor).match(/[\d.]+/g) || [];
    const alpha = parts.length >= 4 ? Number(parts[3]) : (parts.length ? 1 : 0);
    return { image, alpha, color: cs.backgroundColor };
  };
  const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
    * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const imageBehind = (el) => {
    const rect = el.getBoundingClientRect();
    for (const img of document.images) {
      if (overlap(rect, img.getBoundingClientRect()) > 40) return true;
    }
    return false;
  };
  const seen = new Set();
  const solid = [];
  const shot = [];
  let n = 0;
  for (const el of document.querySelectorAll("a.btn, button.btn, .btn, input[type='submit'], input[type='button']")) {
    if (seen.has(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number.parseFloat(cs.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    const text = (el.tagName === "INPUT" ? el.value : el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const size = parseFloat(cs.fontSize) || 16;
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const need = size >= 24 || (weight >= 600 && size >= 18.66) ? 3 : 4.5;
    const short = text.slice(0, 24);
    const own = painted(el);
    if (!own.image && own.alpha > 0.25) {
      solid.push({ ratio: ratioOf(cs.color, own.color), need, text: short });
      continue;
    }
    let image = own.image || imageBehind(el);
    let bg = "";
    if (!image) {
      let node = el.parentElement;
      while (node) {
        const paint = painted(node);
        if (paint.image) {
          image = true;
          break;
        }
        if (paint.alpha > 0.25) {
          bg = paint.color;
          break;
        }
        node = node.parentElement;
      }
    }
    if (!image && bg) {
      solid.push({ ratio: ratioOf(cs.color, bg), need, text: short });
      continue;
    }
    el.setAttribute("data-fitout-btn-shot", String(n));
    shot.push({ n, need, text: short });
    n += 1;
  }
  return { solid, shot };
}

function readShotButton(n) {
  const el = document.querySelector(`[data-fitout-btn-shot="${n}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillStyle = cs.color;
  const hex = ctx.fillStyle;
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const size = parseFloat(cs.fontSize) || 16;
  const weight = parseInt(cs.fontWeight, 10) || 400;
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    text: (el.tagName === "INPUT" ? el.value : el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24),
    need: size >= 24 || (weight >= 600 && size >= 18.66) ? 3 : 4.5,
    textRgb: { r, g, b, lum: 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) },
  };
}

async function contrastAt(page, box) {
  const view = page.viewportSize() || { width: 0, height: 0 };
  const clip = clipBox(box, view);
  if (!clip) return { ratio: Number.NaN, need: box.need, text: box.text, error: "按钮不在视口里" };
  let buffer;
  try {
    buffer = await page.screenshot({ clip });
  } catch (err) {
    return { ratio: Number.NaN, need: box.need, text: box.text, error: String((err && err.message) || err).split("\n")[0] };
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
    return (Math.max(rgb.lum, med) + 0.05) / (Math.min(rgb.lum, med) + 0.05);
  }, { b64: buffer.toString("base64"), rgb: box.textRgb });
  return { ratio, need: box.need, text: box.text };
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
    // 只比同样大小的几张：末位单数的那张跨满整行改成横幅（宽度是别的卡的 1.5 倍以上）是设计，不算「同组比例不一致」。
    const boxes = [...group.querySelectorAll("img")].map((img) => {
      const r = img.getBoundingClientRect();
      return r.width > 2 && r.height > 2 ? { w: r.width, ratio: r.width / r.height } : null;
    }).filter(Boolean);
    if (boxes.length < 2) continue;
    const widths = boxes.map((b) => b.w).sort((a, b) => a - b);
    const median = widths[Math.floor(widths.length / 2)];
    const peers = boxes.filter((b) => b.w <= median * 1.5);
    if (peers.length < 2) continue;
    const base = peers[0].ratio;
    out.push({ id, ok: peers.every((b) => Math.abs(b.ratio - base) / base <= 0.08) });
  }
  return out;
}

function chromeProbe() {
  const header = document.querySelector("header");
  const bar = header ? header.getBoundingClientRect().height : 0;
  const overlay = !!(header && header.hasAttribute("data-overlay"));
  const small = [];
  const seen = new Set();
  for (const el of document.querySelectorAll("header a, header button, footer a, footer button, [data-float] a, [data-float] button, [data-float] summary, .crumbs a, .btn")) {
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
  const ds = getComputedStyle(dock);
  // 桌面悬浮条碰到页脚时会让开（is-over-foot，隐藏）。看不见的悬浮条不算压住。
  if (ds.visibility === "hidden" || Number.parseFloat(ds.opacity) === 0) return { missing: false, hit };
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

/**
 * 版式探针（L1 到 L17、L19；L18 要截图，见 measureNumerals）。整个函数会被序列化后送进浏览器，所以：
 * 只能用浏览器里有的东西，不能引用本文件外的变量。
 *
 * 返回 [{ rule, sig, detail }]。同一页同一条 sig 只报一次，跨页的合并由调用方做。
 * 规则编号 L1 到 L19，意思写在每一段的注释里。L1 到 L15 的阈值来自对 10 套国内风样板间 226 页的校准，
 * L16 到 L19 用 14 套样板间（国内 10、国际 4）校准。
 *
 * opts: { slotIds: string[]  样板间 images.json 里的图片位 id，可见文字里不许出现 }
 */
function layoutProbe(opts) {
  const W = window.innerWidth;
  const MOBILE = W < 768;
  const hits = [];
  const seen = new Set();
  const add = (rule, sig, detail) => {
    const key = `${rule}|${sig}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ rule, sig, detail });
  };
  const cs = (e) => getComputedStyle(e);
  const R = (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, r: r.right + scrollX, b: r.bottom + scrollY };
  };
  const rnd = (n) => Math.round(n * 10) / 10;
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const tx = (e) => clean(e.textContent).slice(0, 24);
  const sel = (e) => {
    if (!e || !e.tagName) return "";
    let s = e.tagName.toLowerCase();
    const c = (e.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (c.length) s += `.${c.join(".")}`;
    return s;
  };
  const where = (e) => {
    const a = [];
    let p = e;
    for (let i = 0; i < 3 && p && p !== document.body; i += 1) {
      a.unshift(sel(p));
      p = p.parentElement;
    }
    return a.join(" > ");
  };
  const overlay = (e) => !!(e.closest && e.closest(".float-dock, .demo-badge, .skip, [data-fold-mark]"));
  const visible = (e) => {
    if (!e || !e.getBoundingClientRect) return false;
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const own = cs(e);
    if (own.position === "absolute" && (r.width <= 1 || r.height <= 1)) return false;
    let p = e;
    while (p && p !== document.documentElement) {
      const s = cs(p);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
      if (p.hasAttribute && p.hasAttribute("hidden")) return false;
      if (p.tagName === "DETAILS" && !p.open) {
        const sm = p.querySelector(":scope > summary");
        if (!(sm && sm.contains(e))) return false;
      }
      p = p.parentElement;
    }
    return true;
  };
  // 页脚、页头认站点自己的那一个（文章里的 <footer>、<header> 不算）。
  const header = document.querySelector(".site-header, body > header");
  const footer = document.querySelector(".site-footer, body > footer");
  const inFooter = (e) => !!(footer && footer.contains(e));
  const inHeader = (e) => !!(header && header.contains(e));
  const main = document.querySelector("main") || document.body;

  // 所有可见文字节点：文字盒（Range）的位置，不是元素盒的位置。
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!node.nodeValue.trim()) continue;
    const p = node.parentElement;
    if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(p.tagName)) continue;
    if (overlay(p) || !visible(p)) continue;
    const rg = document.createRange();
    rg.selectNodeContents(node);
    const rs = [...rg.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (!rs.length) continue;
    const r0 = rs[0];
    const u = rs.reduce((a, r) => ({ l: Math.min(a.l, r.left), t: Math.min(a.t, r.top), r: Math.max(a.r, r.right), b: Math.max(a.b, r.bottom) }), { l: 1e9, t: 1e9, r: -1e9, b: -1e9 });
    texts.push({
      n: node,
      p,
      text: clean(node.nodeValue),
      first: { x: r0.left + scrollX, y: r0.top + scrollY, w: r0.width, h: r0.height },
      u: { x: u.l + scrollX, y: u.t + scrollY, r: u.r + scrollX, b: u.b + scrollY },
      lines: new Set(rs.map((r) => Math.round(r.top))).size,
      fs: parseFloat(cs(p).fontSize),
    });
  }

  // L1 面包屑：每一项（链接、「/」、当前页）的字，垂直中心差不超过 2px。
  const crumbs = [...document.querySelectorAll('.crumbs, [class*="crumb"], [aria-label*="面包屑"]')].filter(visible);
  crumbs.forEach((bc) => {
    if (crumbs.some((o) => o !== bc && o.contains(bc))) return;
    const ts = texts.filter((t) => bc.contains(t.n));
    if (ts.length < 2) return;
    // 当前页标题太长会折到下一行：中心差超过 16px 的算另一行，只比同一行里的。
    const items = ts.map((t) => ({ t, cy: t.first.y + t.first.h / 2 })).sort((a, b) => a.cy - b.cy);
    const lines = [];
    for (const it of items) {
      const last = lines[lines.length - 1];
      if (last && it.cy - last[last.length - 1].cy <= 16) last.push(it);
      else lines.push([it]);
    }
    for (const line of lines) {
      if (line.length < 2) continue;
      const spread = line[line.length - 1].cy - line[0].cy;
      if (spread > 2) {
        add("L1", "面包屑各项的字不在一条线上", `差 ${rnd(spread)}px：${line.map((x) => `${x.t.text.slice(0, 6)}@${rnd(x.cy)}`).join(" ")}`);
        break;
      }
    }
  });

  // L2 页脚：最后一行内容到页脚底边的空白，不能比页脚顶部的空白多出 28px；
  // 窄屏时再允许多出贴底悬浮条的实际高度（那是留给悬浮条的）。页脚下面不能再露出一条浅色底。
  if (footer && visible(footer)) {
    const fr = R(footer);
    const own = texts.filter((t) => footer.contains(t.n));
    const tops = own.map((t) => t.u.y);
    const bottoms = own.map((t) => t.u.b);
    for (const e of footer.querySelectorAll("img, button, .btn, input")) {
      if (!visible(e)) continue;
      const r = R(e);
      tops.push(r.y);
      bottoms.push(r.b);
    }
    if (tops.length) {
      const topGap = Math.min(...tops) - fr.y;
      const bottomGap = fr.b - Math.max(...bottoms);
      const dock = document.querySelector("[data-float]");
      let dockH = 0;
      if (dock && W < 1024 && cs(dock).position === "fixed" && cs(dock).display !== "none") dockH = dock.getBoundingClientRect().height;
      const allowed = Math.max(topGap, 0) + 28 + dockH;
      if (bottomGap > allowed) {
        add("L2", "页脚底部空白过大", `最后一行到页脚底边 ${rnd(bottomGap)}px，页脚顶部空白 ${rnd(topGap)}px${dockH ? `，悬浮条 ${rnd(dockH)}px` : ""}`);
      }
    }
    const below = document.documentElement.scrollHeight - fr.b;
    if (below > 20) add("L2", "页脚下面还露出一条底色", `页脚底边到文档底边 ${rnd(below)}px`);
  }

  // L3 图标：图标右缘到后面那段字不到 4px 算贴字；图标中心和第一行字中心差超过 3px 算没对齐。
  for (const ic of document.querySelectorAll("svg.icon, svg[class*='icon']")) {
    if (!visible(ic) || overlay(ic)) continue;
    const par = ic.parentElement;
    if (!par) continue;
    const ir = R(ic);
    const after = texts.find((t) => par.contains(t.n) && !ic.contains(t.n) && (ic.compareDocumentPosition(t.n) & Node.DOCUMENT_POSITION_FOLLOWING));
    if (!after) continue;
    const gap = after.first.x - ir.r;
    const where2 = inFooter(ic) ? "页脚" : (inHeader(ic) ? "页头" : "正文");
    if (gap > -2 && gap < 4) add("L3", `${where2}图标贴着文字`, `${where(par)} 间距 ${rnd(gap)}px：${after.text.slice(0, 12)}`);
    const dy = ir.y + ir.h / 2 - (after.first.y + after.first.h / 2);
    if (gap >= -2 && Math.abs(dy) > 3) add("L3", `${where2}图标没对齐第一行字`, `${where(par)} 偏 ${rnd(dy)}px：${after.text.slice(0, 12)}`);
  }

  // L4 占位图里的字：按显示尺寸折算，小于 12px 不行。演示占位块（data-demo）不算。
  const svgTexts = [];
  for (const im of document.images) {
    const src = im.getAttribute("src") || "";
    if (!src.startsWith("data:image/svg") || !visible(im) || overlay(im)) continue;
    let dec = "";
    try {
      dec = decodeURIComponent(src.slice(src.indexOf(",") + 1));
    } catch {
      continue;
    }
    if (/data-demo="1"/.test(dec)) continue;
    const vb = dec.match(/viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+[\d.]+"/);
    const vbW = vb ? parseFloat(vb[1]) : parseFloat((dec.match(/\swidth="(\d+)"/) || [])[1]);
    const r = R(im);
    let min = 1e9;
    let sample = "";
    for (const m of dec.matchAll(/<text[^>]*font-size="([\d.]+)"[^>]*>([^<]*)</g)) {
      svgTexts.push(m[2]);
      const eff = (parseFloat(m[1]) * r.w) / (vbW || r.w);
      if (eff < min) {
        min = eff;
        sample = m[2];
      }
    }
    if (min < 12) add("L4", "占位图里的字小于 12px", `${rnd(min)}px（图显示 ${rnd(r.w)}px 宽）：${sample.slice(0, 16)}`);
  }

  // L5 可见文字小于 12px。
  for (const t of texts) {
    if (t.fs < 12) add("L5", `文字小于 12px：${sel(t.p)}`, `${rnd(t.fs)}px：${t.text.slice(0, 16)}`);
  }

  // L6 图片位 id、qr- 键名、slot: 前缀出现在可见文字里（含占位图里的字）。
  const names = (opts && opts.slotIds ? opts.slotIds : []).filter((s) => s.includes("-"));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameRe = names.length ? new RegExp(`(^|[^A-Za-z0-9-])(${names.map(esc).join("|")})(?![A-Za-z0-9-])`) : null;
  const keyRe = /(^|[^A-Za-z0-9-])(qr-[a-z0-9-]+|slot:[a-z0-9-]+)/i;
  const pool = [...texts.map((t) => ({ s: t.text, where: sel(t.p) })), ...svgTexts.map((s) => ({ s, where: "占位图" }))];
  for (const item of pool) {
    const m = (nameRe && item.s.match(nameRe)) || item.s.match(keyRe);
    if (m) add("L6", `可见文字里有内部键名：${(m[2] || m[0]).trim()}`, `${item.where}：${item.s.slice(0, 24)}`);
  }

  // L7 文字被 overflow 裁掉：overflow 为 hidden / clip 的盒子，里面的字高出或宽出盒子。
  // 用了 line-clamp 或 ellipsis 的是设计内截断，不算。
  for (const e of document.body.querySelectorAll("*")) {
    if (!visible(e) || overlay(e)) continue;
    const s = cs(e);
    const hid = ["hidden", "clip"].includes(s.overflowX) || ["hidden", "clip"].includes(s.overflowY);
    if (!hid || /^(IMG|SVG|svg|VIDEO|CANVAS)$/.test(e.tagName)) continue;
    if (!clean(e.textContent)) continue;
    const dy = e.scrollHeight - e.clientHeight;
    const dx = e.scrollWidth - e.clientWidth;
    if (dy > 2 || dx > 2) {
      const clamp = s.webkitLineClamp && s.webkitLineClamp !== "none";
      if (clamp || s.textOverflow === "ellipsis") continue;
      add("L7", `文字被 overflow 裁掉：${sel(e)}`, `${where(e)} 超出 ${rnd(Math.max(dy, dx))}px：${tx(e)}`);
    }
  }
  for (const t of texts) {
    let p = t.p.parentElement;
    while (p && p !== document.body) {
      const ps = cs(p);
      if (["hidden", "clip"].includes(ps.overflowY) && ps.display !== "inline") {
        const pr = R(p);
        if (t.u.b > pr.b + 1.5 || t.u.y < pr.y - 1.5) {
          add("L7", `文字被 overflow 裁掉：${sel(p)}`, `${where(t.p)} 文字 ${rnd(t.u.y)}–${rnd(t.u.b)}，盒子 ${rnd(pr.y)}–${rnd(pr.b)}：${t.text.slice(0, 16)}`);
          break;
        }
      }
      p = p.parentElement;
    }
  }

  // L8 同一列的按钮宽度一致：每个按钮各占一行（各自是父元素的唯一子元素）、左缘相同、上下相邻的，宽度极差不超过 4px。
  const btns = [...document.querySelectorAll(".btn, button.btn, a.btn")].filter((b) => visible(b) && clean(b.textContent) && !overlay(b)
    && !b.closest(".mobile-panel, .hero-ui, .hero-dots") && !/nav|menu|tab|filter|chip|tag/.test(String(b.className)));
  const alone = btns.filter((b) => b.parentElement && b.parentElement.children.length === 1);
  const byZone = new Map();
  for (const b of alone) {
    const z = b.closest("section, footer, header, aside") || document.body;
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z).push(b);
  }
  for (const [zone, list] of byZone) {
    const sorted = list.map((b) => ({ b, r: R(b) })).sort((a, c) => a.r.x - c.r.x || a.r.y - c.r.y);
    let cur = [];
    const flush = () => {
      if (cur.length >= 2) {
        const ws = cur.map((c) => c.r.w);
        const spread = Math.max(...ws) - Math.min(...ws);
        if (spread > 4) add("L8", "同一列的按钮宽度不一", `${sel(zone)} ${cur.map((c) => `${clean(c.b.textContent).slice(0, 8)}=${Math.round(c.r.w)}`).join(" / ")}`);
      }
      cur = [];
    };
    for (const it of sorted) {
      const last = cur[cur.length - 1];
      if (last && Math.abs(it.r.x - last.r.x) <= 2 && it.r.y >= last.r.b - 2 && it.r.y - last.r.b < 140) cur.push(it);
      else {
        flush();
        cur = [it];
      }
    }
    flush();
  }

  // L9 / L10 同一行的多栏：flex / grid 里水平不重叠的子项。
  // L9 只查联系区（data-section="contact"）：栏的可见内容高度（有边框 / 底色的栏按盒子算）比 < 0.6 且差 > 160px，
  //    一栏空了一大块。图文并排、侧栏加列表这类设计内的高矮不同，不在这条里。
  // L10 顶边、底边都差 > 4px，而且中心也差 > 16px：既不顶对齐、也不底对齐、也不居中（居中的允许 16px 内的行高误差）。
  const boxed = (e) => {
    const s = cs(e);
    const bg = String(s.backgroundColor).match(/[\d.]+/g) || [];
    const alpha = bg.length >= 4 ? Number(bg[3]) : (bg.length ? 1 : 0);
    const bw = ["Top", "Right", "Bottom", "Left"].filter((k) => parseFloat(s[`border${k}Width`]) > 0 && s[`border${k}Style`] !== "none").length;
    return alpha > 0.25 || bw >= 2 || s.boxShadow !== "none";
  };
  const extent = (el) => {
    let top = 1e9;
    let bot = -1e9;
    for (const t of texts) {
      if (!el.contains(t.n)) continue;
      top = Math.min(top, t.u.y);
      bot = Math.max(bot, t.u.b);
    }
    for (const x of el.querySelectorAll("img, video, canvas, iframe, .btn, button, input, select, textarea")) {
      if (!visible(x) || cs(x).position === "absolute") continue;
      const r = R(x);
      top = Math.min(top, r.y);
      bot = Math.max(bot, r.b);
    }
    return top < 1e9 ? { top, h: bot - top } : null;
  };
  for (const e of main.querySelectorAll("*")) {
    const s = cs(e);
    if (!/flex|grid/.test(s.display) || !visible(e) || overlay(e)) continue;
    if (s.display.includes("flex") && s.flexDirection.startsWith("column")) continue;
    if (e.closest("[data-carousel], .hero-ui, .hero-dots")) continue;
    const kids = [...e.children].filter((k) => visible(k) && !["absolute", "fixed"].includes(cs(k).position) && k.tagName.toLowerCase() !== "svg");
    if (kids.length < 2) continue;
    const items = kids.map((k) => ({ k, r: R(k) })).sort((a, b) => a.r.y - b.r.y);
    const groups = [];
    for (const it of items) {
      const g = groups.find((x) => it.r.y < x.b - 2 && it.r.b > x.y + 2);
      if (g) {
        g.items.push(it);
        g.y = Math.min(g.y, it.r.y);
        g.b = Math.max(g.b, it.r.b);
      } else groups.push({ y: it.r.y, b: it.r.b, items: [it] });
    }
    for (const g of groups) {
      if (g.items.length < 2) continue;
      const xs = g.items.map((i) => [i.r.x, i.r.r]).sort((a, b) => a[0] - b[0]);
      let disjoint = true;
      for (let i = 1; i < xs.length; i += 1) if (xs[i][0] < xs[i - 1][1] - 2) disjoint = false;
      if (!disjoint) continue;
      const tops = g.items.map((i) => i.r.y);
      const bots = g.items.map((i) => i.r.b);
      const cens = g.items.map((i) => (i.r.y + i.r.b) / 2);
      const sp = (a) => Math.max(...a) - Math.min(...a);
      if (sp(tops) > 4 && sp(bots) > 4 && sp(cens) > 16) {
        add("L10", `同行多栏顶边没对齐：${where(e)}`, `顶 ${tops.map(rnd).join("/")}，底 ${bots.map(rnd).join("/")}`);
      }
      if (!MOBILE && e.closest('[data-section="contact"]')) {
        const hs = g.items.map((i) => {
          const v = boxed(i.k) ? { h: i.r.h } : extent(i.k);
          return v ? v.h : null;
        });
        if (hs.every((h) => h !== null)) {
          const hi = Math.max(...hs);
          const lo = Math.min(...hs);
          if (hi - lo > 160 && lo / hi < 0.6) {
            add("L9", `联系区左右栏高度失衡：${where(e)}`, `栏内容高 ${hs.map(rnd).join(" / ")}，最矮的只有 ${Math.round((lo / hi) * 100)}%`);
          }
        }
      }
    }
  }

  // L11 左缘对齐。
  // a) 板块里最靠左的内容（文字、按钮、图、带竖线或底色的块），要贴着页头容器的左缘（±2px）；居中排版的不查。
  // b) 标题和紧跟在它下面的那段字，左缘差 2 到 40px（标题前面的标记把字推歪了，导语却留在原位）。
  const bar = (header && header.querySelector(".container")) || document.querySelector(".container");
  if (bar) {
    const cr = R(bar);
    const L = cr.x;
    const Rr = cr.r;
    for (const sec of main.children) {
      if (!visible(sec) || !/SECTION/i.test(sec.tagName)) continue;
      let minX = 1e9;
      let maxX = -1e9;
      const take = (a, b) => {
        minX = Math.min(minX, a);
        maxX = Math.max(maxX, b);
      };
      const inBtn = (e) => !!e.closest(".btn, button, .hero-ui");
      let leftText = null;
      for (const t of texts) {
        if (!sec.contains(t.n) || inBtn(t.p)) continue;
        take(t.first.x, t.u.r);
        if (!leftText || t.first.x < leftText.first.x) leftText = t;
      }
      for (const b of sec.querySelectorAll(".btn, button")) {
        if (!visible(b) || b.closest(".hero-ui")) continue;
        const r = R(b);
        take(r.x, r.r);
      }
      // 左边带竖线的块、带底色或边框的卡片：它们的盒子算内容的边，竖线贴着容器、字缩进一点是设计。
      for (const bx of sec.querySelectorAll("*")) {
        if (!visible(bx) || cs(bx).position === "absolute" || bx.closest(".hero-ui, .hero-dots")) continue;
        const bs = cs(bx);
        const rule = parseFloat(bs.borderLeftWidth) >= 2 && bs.borderLeftStyle !== "none";
        if (!rule && !boxed(bx)) continue;
        const r = R(bx);
        if (r.w >= W - 4 || r.w < 40 || r.h < 20) continue;
        take(r.x, r.r);
      }
      for (const im of sec.querySelectorAll("img")) {
        if (!visible(im) || cs(im).position === "absolute" || im.closest("[data-fullbleed] .hero-slides")) continue;
        const r = R(im);
        if (r.x < L - 2 || r.w > W - 40) continue;
        take(r.x, r.r);
      }
      if (maxX < 0) continue;
      const leftGap = minX - L;
      const rightGap = Rr - maxX;
      // 居中排版：最靠左的那段字自己是 text-align: center。字靠左、整块靠边距居中的（窄栏居中、字却靠左）不算居中，
      // 它的字和页头 logo、别的板块的左缘对不上。板块里没有字（只有图）时才按左右对称判断。
      const centered = leftText ? /center/.test(cs(leftText.p).textAlign) : Math.abs(leftGap - rightGap) < 24;
      if (leftGap > 2 && !centered) {
        add("L11", `板块内容没贴齐容器左缘：${sel(sec)}${sec.getAttribute("data-section") ? `[${sec.getAttribute("data-section")}]` : ""}`, `最靠左的内容 x=${rnd(minX)}，容器左缘 ${rnd(L)}，差 ${rnd(leftGap)}px`);
      }
    }
    for (const h of document.querySelectorAll("h1, h2, h3")) {
      if (!visible(h) || overlay(h) || inFooter(h) || inHeader(h)) continue;
      const nx = h.nextElementSibling;
      if (!nx || !visible(nx) || nx.tagName !== "P") continue;
      const ta = cs(h).textAlign;
      if (ta === "center" || ta === "right" || ta === "end" || cs(nx).textAlign === "center") continue;
      const a = texts.find((x) => h.contains(x.n));
      const b = texts.find((x) => nx.contains(x.n) && !x.p.closest(".btn, button"));
      if (!a || !b) continue;
      // 一段话开头带图标时，左缘算图标的左边，不算图标后面的字。
      const edge = (box, t) => {
        let x = t.first.x;
        for (const ic of box.querySelectorAll("svg, img")) {
          const r = R(ic);
          if (visible(ic) && r.y < t.first.y + t.first.h) x = Math.min(x, r.x);
        }
        return x;
      };
      const ax = edge(h, a);
      const bx = edge(nx, b);
      const d = bx - ax;
      if (Math.abs(d) > 2 && Math.abs(d) <= 40) add("L11", "标题文字和它下面那段字的左缘没对齐", `${where(h)} 标题 x=${rnd(ax)}，下一段 x=${rnd(bx)}，差 ${rnd(d)}px：${a.text.slice(0, 12)}`);
    }
  }

  // L12 窄屏页脚：栏与栏上下相接，不能零间距。
  if (MOBILE && footer) {
    const grid = footer.querySelector(".footer-grid");
    if (grid && visible(grid)) {
      const cols = [...grid.children].filter(visible).map((k) => R(k));
      for (let i = 1; i < cols.length; i += 1) {
        if (cols[i].y >= cols[i - 1].b - 1 && cols[i].y - cols[i - 1].b < 8) {
          add("L12", "手机页脚各栏之间没有间距", `第 ${i} 栏和第 ${i + 1} 栏间距 ${rnd(cols[i].y - cols[i - 1].b)}px`);
        }
      }
    }
  }

  // L13 桌面导航：相邻两项文字之间的距离，最大减最小不超过 4px。
  if (W >= 1024) {
    const nav = [...document.querySelectorAll(".nav-list")].find(visible);
    if (nav) {
      const ts = [...nav.querySelectorAll("a")].filter(visible).map((a) => texts.find((t) => a.contains(t.n))).filter(Boolean);
      if (ts.length >= 3) {
        const gaps = [];
        for (let i = 1; i < ts.length; i += 1) gaps.push(ts[i].first.x - (ts[i - 1].first.x + ts[i - 1].first.w));
        const spread = Math.max(...gaps) - Math.min(...gaps);
        if (spread > 4) add("L13", "导航项之间的间距不均", `文字间距 ${gaps.map(rnd).join(" / ")}`);
      }
    }
  }

  // L14 首屏 / 页头文案栈：标签、标题、导语、按钮上下相邻的盒子，间距不能小于 4px。
  for (const stack of document.querySelectorAll(".hero-copy, .hero-in, .page-banner-copy")) {
    if (!visible(stack)) continue;
    const kids = [...stack.children].filter((k) => visible(k) && !k.matches(".hero-ui, .hero-dots") && !["absolute", "fixed"].includes(cs(k).position));
    for (let i = 1; i < kids.length; i += 1) {
      const a = R(kids[i - 1]);
      const b = R(kids[i]);
      if (b.y >= a.b - 1 && b.y - a.b < 4) {
        add("L14", `首屏文案各项之间没有间距：${sel(stack)}`, `${sel(kids[i - 1])} 与 ${sel(kids[i])} 间距 ${rnd(b.y - a.b)}px`);
        break;
      }
    }
  }

  // L15 短文字（≤6 个字符，数字加单位之类）不许折成两行。
  for (const t of texts) {
    if (t.text.length > 6 || t.lines < 2) continue;
    if (t.p.children.length) continue;
    add("L15", `短文字折成了几行：${sel(t.p)}`, `${t.lines} 行：${t.text}`);
  }

  // L16 网格末行孤儿卡：桌面宽度（≥ 1024）下一排排的等宽卡片（grid 或 flex-wrap），前面每行至少 2 张，最后一行只剩 1 张，
  // 而且这张和上一行的卡片一样宽、贴着第一列。5 张排 3 + 2 不算（末行 2 张），3 + 1、4 + 1、3 + 3 + 1 才算。
  // 「卡片」指带框、带底色、带阴影或带图的块；只有一条分隔线的文字行（步骤、要点列表）、小标签、按钮、导航项不算。
  // 平板（768）下两列排奇数张本来就会 2 + 1，是响应式的常态，不在这条里。
  for (const e of W >= 1024 ? main.querySelectorAll("*") : []) {
    const s = cs(e);
    const grid = s.display.includes("grid");
    const wrap = s.display.includes("flex") && s.flexWrap.startsWith("wrap") && !s.flexDirection.startsWith("column");
    if (!grid && !wrap) continue;
    if (!visible(e) || overlay(e) || e.closest("[data-carousel], .hero-ui, .hero-dots, details, nav, .crumbs")) continue;
    const kids = [...e.children].filter((k) => visible(k) && !["absolute", "fixed"].includes(cs(k).position));
    if (kids.length < 3) continue;
    if (kids.some((k) => /\b(btn|tag|chip|filter|facet|nav|tab)\b/.test(String(k.className)) || k.matches("a.btn, button, summary"))) continue;
    if (!kids.every((k) => boxed(k) || k.querySelector("img"))) continue;
    const rs = kids.map((k) => R(k)).sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    for (const r of rs) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(r.y - last[0].y) <= 6) last.push(r);
      else rows.push([r]);
    }
    if (rows.length < 2) continue;
    const lastRow = rows[rows.length - 1];
    const prevRow = rows[rows.length - 2];
    if (lastRow.length !== 1 || prevRow.length < 2) continue;
    const one = lastRow[0];
    if (one.h < 64 || prevRow.some((p) => p.h < 64)) continue;
    const same = prevRow.every((p) => Math.abs(p.w - one.w) <= Math.max(6, one.w * 0.06));
    const firstX = Math.min(...rows.flat().map((r) => r.x));
    if (!same || one.x - firstX > 6) continue;
    add("L16", `网格末行只剩一张卡：${sel(e)}`, `${where(e)} 共 ${kids.length} 张，${rows.length} 行，每行 ${prevRow.length} 张，末行 1 张：${tx(kids[kids.length - 1])}`);
  }

  // L17 半宽空白板块：桌面宽度下，板块里所有内容（字、图、按钮、有框或有底图的块）的外接盒只占容器宽的 56% 以内，
  // 又贴着左缘，右边空出一大片（至少 35% 的容器宽）。居中排版、整屏背景图的板块不算。
  if (W >= 1024 && bar) {
    const cr2 = R(bar);
    const CW = cr2.r - cr2.x;
    for (const sec of main.children) {
      if (!visible(sec) || !/SECTION/i.test(sec.tagName)) continue;
      if (sec.hasAttribute("data-fullbleed") || sec.matches('[data-section="hero"], [data-section="page-banner"], .photo-band')) continue;
      const own = cs(sec);
      if (own.backgroundImage !== "none") continue;
      if ([...sec.querySelectorAll("img")].some((im) => visible(im) && cs(im).position === "absolute")) continue;
      let lo = 1e9;
      let hi = -1e9;
      const take = (a, b) => {
        lo = Math.min(lo, a);
        hi = Math.max(hi, b);
      };
      for (const t of texts) if (sec.contains(t.n)) take(t.first.x, t.u.r);
      for (const b of sec.querySelectorAll(".btn, button, img, video, iframe")) {
        if (!visible(b) || cs(b).position === "absolute") continue;
        const r = R(b);
        if (r.w >= 8 && r.h >= 8) take(r.x, r.r);
      }
      for (const bx of sec.querySelectorAll("*")) {
        // 没展开的 details 本身是看得见的一行（visible() 会把它当成藏起来的），手风琴靠它的上边线撑满整行。
        const shown = bx.tagName === "DETAILS" ? bx.getBoundingClientRect().width > 0 : visible(bx);
        if (!shown || cs(bx).position === "absolute") continue;
        const bs = cs(bx);
        // 带框、带底色、带底图、带任何一边的线（行与行之间的分隔线也算）的块：它们的盒子算内容的边。
        const line = ["Top", "Right", "Bottom", "Left"].some((k) => parseFloat(bs[`border${k}Width`]) > 0 && bs[`border${k}Style`] !== "none");
        if (!(boxed(bx) || line || bs.backgroundImage !== "none")) continue;
        const r = R(bx);
        if (r.w < 40 || r.h < 1) continue;
        take(r.x, r.r);
      }
      if (hi < 0) continue;
      const left = lo - cr2.x;
      const right = cr2.r - hi;
      const used = (hi - lo) / CW;
      if (used < 0.56 && left <= 6 && right >= CW * 0.35 && R(sec).h >= 160) {
        add("L17", `半宽空白板块：${sel(sec)}${sec.getAttribute("data-section") ? `[${sec.getAttribute("data-section")}]` : ""}`, `内容只占容器宽的 ${Math.round(used * 100)}%，右边空 ${rnd(right)}px：${tx(sec)}`);
      }
    }
  }

  // L19 页头文字被省略号截断：品牌名这类文字被挤得只剩半截（带 text-overflow: ellipsis、实际内容比盒子宽）。
  if (header) {
    for (const e of header.querySelectorAll("*")) {
      if (!visible(e)) continue;
      const s = cs(e);
      if (s.textOverflow !== "ellipsis" || !clean(e.textContent)) continue;
      if (e.scrollWidth > e.clientWidth + 1) add("L19", `页头文字被省略号截断：${sel(e)}`, `${where(e)} 内容宽 ${e.scrollWidth}，盒子宽 ${e.clientWidth}：${tx(e)}`);
    }
  }

  return hits;
}
