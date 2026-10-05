/**
 * node scripts/build.mjs <site.json> [--out <dir>] [--demo-images <dir>]
 * 读企业档案，套上户型或样板间，拼成纯静态站。
 * 不安装依赖。内容违规交给 check.mjs，这里只在结构拼不起来时失败。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { render } from "./lib/tpl.mjs";
import { readJson } from "./lib/json.mjs";
import { imageSize } from "./lib/image-size.mjs";
import { HERO_PX, industryError, nicheError } from "./lib/rules.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frameworkDir = path.join(root, "framework");

const DENSITY = {
  compact: { y: "clamp(2.5rem, 2rem + 2vw, 3.5rem)", gap: "1rem" },
  standard: { y: "clamp(3rem, 2.4rem + 3vw, 5rem)", gap: "1.5rem" },
  airy: { y: "clamp(3.5rem, 2.6rem + 4vw, 6.5rem)", gap: "2rem" },
};

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".svg", ".gif"]);
const PUBLISHED_KEYS = [
  "id", "name", "industry", "niche", "showroom", "style", "businessType", "summary", "url",
  "contact", "nav", "shell", "pages", "products", "collections",
];
const TONES = new Set(["light", "dark", "image"]);

const args = process.argv.slice(2);
let sitePath = null;
let outRoot = path.join(root, "out");
let demoDir = null;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--out") {
    outRoot = path.resolve(args[i + 1] || "");
    i += 1;
  } else if (args[i] === "--demo-images") {
    demoDir = path.resolve(args[i + 1] || "");
    i += 1;
  } else if (!sitePath) sitePath = path.resolve(args[i]);
  else fail(`多余参数：${args[i]}`);
}
if (!sitePath) fail("用法：node scripts/build.mjs <site.json> [--out <dir>] [--demo-images <dir>]");
if (demoDir && (!fs.existsSync(demoDir) || !fs.statSync(demoDir).isDirectory())) {
  fail(`演示图片目录不存在：${demoDir}`);
}

const demoMode = Boolean(demoDir);
const site = readJsonOrFail(sitePath);
const siteDir = path.dirname(sitePath);
if (!/^_?[a-z0-9][a-z0-9-]*$/.test(site.id || "")) fail("site.id 只能是小写字母、数字和连字符");

let showroom = null;
let showroomDir = null;
if (site.showroom) {
  if (!/^[a-z0-9_-]+$/.test(site.showroom)) fail(`样板间 id 不合法：${site.showroom}`);
  showroomDir = path.join(root, "showrooms", site.showroom);
  const showroomFile = path.join(showroomDir, "showroom.json");
  if (!fs.existsSync(showroomFile)) fail(`找不到样板间：${site.showroom}`);
  showroom = readJsonOrFail(showroomFile);
  if (site.industry && showroom.industry && site.industry !== showroom.industry) {
    fail(`site.industry 和样板间不一致：${site.industry} / ${showroom.industry}`);
  }
  site.industry = site.industry || showroom.industry;
  if (site.niche && showroom.niche && site.niche !== showroom.niche) {
    fail(`site.niche 和样板间不一致：${site.niche} / ${showroom.niche}`);
  }
  site.niche = site.niche || showroom.niche || "";
}

const tokens = readJsonOrFail((assertRegistered(site), showroom ? path.join(showroomDir, "tokens.json") : resolveStyle(site.style, siteDir)));
validateTokens(tokens);
const house = showroom || loadHouse(site.industry);
const imageSlots = loadImageSlots();
const specs = loadSpecs();
const icons = loadIcons();
const shell = readText(path.join(frameworkDir, "shell", "page.html"));
const notes = [];
const copied = new Set();
const notedMissing = new Set();
let usedPlaceholder = false;
const DEMO_MARK = "data-demo%3D%221%22";

const outDir = path.join(outRoot, site.id);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

if (!site.name) fail("缺少 name");
if (!Array.isArray(site.nav) || site.nav.length === 0) fail("缺少 nav");
for (const item of site.nav) {
  if (!item.label || !item.href) fail("nav 每一项都要有 label 和 href");
}
for (const page of site.pages || []) {
  if (!house.pages.some((item) => item.id === page.id && !item.from)) fail(`户型没有页面 ${page.id}`);
}

const phone = requiredText(site.contact?.phone, "contact.phone");
const address = requiredText(site.contact?.address, "contact.address");
const hours = Array.isArray(site.contact?.hours) ? site.contact.hours : [];
if (hours.length === 0) fail("缺少营业时间 contact.hours");
for (const row of hours) {
  if (!row.day || !row.time) fail("营业时间每一行都要有 day 和 time");
}

const shellChoice = site.shell || {};
assertAllowed(house.shell.header, shellChoice.header, "顶栏版式");
assertAllowed(house.shell.footer, shellChoice.footer, "页脚版式");
assertAllowed(house.shell.floatContact, shellChoice.floatContact, "悬浮联系版式");

const pagesById = new Map((site.pages || []).map((page) => [page.id, page]));
const usedCss = new Set();
const written = [];

for (const page of house.pages) {
  if (page.from) writeCollection(page);
  else {
    const source = pagesById.get(page.id);
    if (!source) fail(`site.json 缺少页面 ${page.id}`);
    writePage({
      file: page.file,
      title: source.title,
      description: source.description,
      sections: source.sections || [],
      order: page.order,
      banner: bannerFromPage(source),
    });
  }
}

const css = [cssRoot(tokens), readText(path.join(frameworkDir, "base.css"))];
for (const key of [...usedCss].sort()) {
  const [type, variant] = key.split("/");
  css.push(readText(sectionFile(type, variant, "css")));
}
fs.mkdirSync(path.join(outDir, "assets"), { recursive: true });
fs.writeFileSync(path.join(outDir, "assets", "site.css"), css.join("\n"), "utf8");
fs.copyFileSync(path.join(frameworkDir, "shell", "site.js"), path.join(outDir, "assets", "site.js"));
fs.writeFileSync(path.join(outDir, "site.json"), JSON.stringify(publishSite(site), null, 2) + "\n", "utf8");
if (usedPlaceholder) notes.push("演示模式：缺图渲染成占位色块，页面标了演示占位图");
fs.writeFileSync(
  path.join(outDir, "build-report.json"),
  JSON.stringify({ notes, demo: demoMode, showroom: site.showroom || "" }, null, 2) + "\n",
  "utf8",
);
written.push("assets/site.css", "assets/site.js", "site.json", "build-report.json");

console.log(`已生成 ${path.relative(root, outDir) || outDir}`);
if (notes.length) {
  console.log("降级：");
  for (const note of notes) console.log(`- ${note}`);
}
console.log("文件：");
printTree(outDir, "");

function writeCollection(page) {
  const id = page.from;
  const items = itemsOf(id);
  if (!Array.isArray(items) || items.length === 0) fail(`集合 ${id} 是空的`);
  const rule = (page.order || []).find((item) => item.type === "product-detail" || item.type === "collection-detail") || (page.order || [])[0];
  if (!rule) fail(`集合 ${id} 的详情页没有板块`);
  const variant = (rule.variants || []).includes("article") ? "article" : rule.variants[0];
  const seen = new Set();
  for (const item of items) {
    const slug = item.slug || "";
    if (!/^[a-z0-9-]+$/.test(slug)) fail(`slug 不合法：${slug}`);
    if (slug === "index") fail(`slug 不能用保留名：${slug}`);
    if (seen.has(slug)) fail(`slug 重复：${slug}`);
    seen.add(slug);
    const file = page.file.replaceAll("{slug}", slug);
    const section = {
      type: rule.type,
      variant,
      anchor: "detail",
      data: {
        ...item,
        imageAlt: item.imageAlt || item.name || "",
        primaryLabel: house.buttons.primary,
        primaryHref: contactHref(),
        backHref: listFileOf(id),
        backLabel: "返回列表",
      },
    };
    writePage({
      file,
      title: `${item.name}｜${site.name}`,
      description: item.summary || site.summary,
      sections: [section],
      order: page.order,
      banner: {
        title: item.name,
        image: item.image || defaultBannerImage(),
        imageAlt: item.imageAlt || item.name || "",
        crumbs: [
          { label: collectionLabel(id), href: listFileOf(id) },
          { label: item.name, href: "" },
        ],
      },
    });
  }
}

function writePage({ file, title, description, sections, order, banner }) {
  if (written.includes(file)) fail(`页面文件冲突：${file}`);
  if (!title) fail(`${file} 缺少 title`);
  if (!description) fail(`${file} 缺少 description`);
  const checked = checkOrder(sections, order, file);
  const queued = [];
  if (showroom && file !== "index.html") {
    queued.push({
      type: "page-banner",
      variant: "band",
      anchor: "banner",
      tone: "image",
      data: banner || bannerFromTitle(title),
    });
  }
  queued.push(...checked);
  const globals = makeGlobals(file);
  let main = "";
  let first = true;
  for (const section of queued) {
    const spec = specs.get(section.type);
    if (!spec) fail(`没有板块 ${section.type}`);
    const variant = section.type === "page-banner" ? "band" : resolveVariant(section, spec, order);
    usedCss.add(`${section.type}/${variant}`);
    const data = prepareData(section, spec, file, variant);
    data.anchor = safeAnchor(section.anchor || section.type, file);
    data.isH1 = first;
    data.isH2 = !first;
    first = false;
    if (section.type === "testimonials" && variant === "spotlight") {
      const items = data.items || [];
      if (items.length === 0) fail(`${file} 的评价是空的`);
      data.featured = items[0];
      data.rest = items.slice(1);
    }
    let html = render(readText(sectionFile(section.type, variant, "html")), data, { icons, globals });
    html = tagSection(html, section);
    main += html;
  }
  usedCss.add(`header/${shellChoice.header}`);
  usedCss.add(`footer/${shellChoice.footer}`);
  usedCss.add(`float-contact/${shellChoice.floatContact}`);
  const headerHtml = render(readText(sectionFile("header", shellChoice.header, "html")), globals, { icons });
  const footerHtml = render(readText(sectionFile("footer", shellChoice.footer, "html")), globals, { icons });
  const floatHtml = render(readText(sectionFile("float-contact", shellChoice.floatContact, "html")), globals, { icons });
  const isHome = file === "index.html";
  let html = render(shell, {
    pageTitle: title,
    pageDescription: description,
    assetPrefix: assetPrefix(file),
    canonical: canonical(file),
    jsonLd: isHome ? jsonLd() : "",
    headerHtml,
    mainHtml: main,
    footerHtml,
    floatHtml,
    demoBadge: "",
  }, { icons });
  if (html.includes(DEMO_MARK)) {
    usedPlaceholder = true;
    html = html.replace("<body>", "<body>\n  <p class=\"demo-badge\">演示占位图</p>");
  }
  const dest = path.join(outDir, ...file.split("/"));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html, "utf8");
  written.push(file);
}

function tagSection(html, section) {
  const tone = section.tone || "";
  if (tone && !TONES.has(tone)) fail(`tone 只能是 light、dark、image：${tone}`);
  const enter = tokens.motion === 1;
  return html.replace(/<section\b([^>]*)>/, (full, attrs) => {
    let next = attrs;
    if (tone && !/\bdata-tone=/.test(attrs)) next += ` data-tone="${tone}"`;
    if (enter && !/\bdata-enter=/.test(attrs)) next += ` data-enter="fade"`;
    return `<section${next}>`;
  });
}

function prepareData(section, spec, file, variant) {
  const raw = { ...(section.data || {}) };
  if (section.type === "product-list" || section.type === "collection-list") {
    const id = section.type === "product-list" ? "products" : String(raw.collection || "");
    const items = itemsOf(id) || [];
    raw.items = items.map((item) => ({
      name: item.name || "",
      summary: item.summary || "",
      href: detailHref(id, item.slug),
      image: item.image || "",
      imageAlt: item.imageAlt || item.name || "",
    }));
  }
  const data = fill(raw, spec.fields, `${section.type}`);
  if (section.type === "trust" && Array.isArray(data.items)) {
    data.items = data.items.map((item) => ({
      ...item,
      countTo: (String(item.value || "").match(/\d[\d.]*/) || [""])[0],
    }));
  }
  if (section.type === "hero" && variant === "carousel" && !data.interval) data.interval = "4000";
  return bindAssets(data, file);
}

function fill(data, fields, label) {
  const out = { ...(data || {}) };
  for (const [key, def] of Object.entries(fields || {})) {
    if (def.filledBy === "build") continue;
    if (def.type === "list") {
      if (out[key] === undefined) {
        if (def.required) fail(`${label} 缺少列表 ${key}`);
        out[key] = [];
      }
      if (!Array.isArray(out[key])) fail(`${label}.${key} 必须是列表`);
      if (def.required && out[key].length === 0) fail(`${label} 的 ${key} 是空的`);
      out[key] = out[key].map((item, index) => fill(item, def.item, `${label}.${key}[${index}]`));
    } else if (out[key] === undefined) {
      if (def.required) fail(`${label} 缺少字段 ${key}`);
      out[key] = "";
    } else if (typeof out[key] !== "string" && def.type !== "list") {
      fail(`${label}.${key} 必须是字符串`);
    }
  }
  return out;
}

function bindAssets(data, file) {
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string" && (key === "image" || key === "wechatQr")) {
        if (!value) {
          out[key] = "";
          if (key === "image") {
            out.imageWidth = "";
            out.imageHeight = "";
          }
        } else {
          const pic = resolvePicture(value, file);
          out[key] = pic.src;
          if (key === "image") {
            out.imageWidth = pic.src ? String(pic.width) : "";
            out.imageHeight = pic.src ? String(pic.height) : "";
          }
        }
      } else if (typeof value === "string" && (key === "primaryHref" || key === "secondaryHref" || key === "href" || key === "backHref")) {
        out[key] = rootHref(file, value);
      } else if (value && typeof value === "object") out[key] = walk(value);
      else out[key] = value;
    }
    return out;
  };
  return walk(data);
}

function resolveVariant(section, spec, order) {
  const meta = spec.variants?.[section.variant];
  if (!meta) fail(`未知版式 ${section.type}/${section.variant}`);
  let variant = section.variant;
  if (meta.needsImage && !imagesReady(section.data || {}, meta.imageField)) {
    if (!meta.fallback) fail(`${section.type}/${section.variant} 缺图，又没有 fallback`);
    notes.push(`${section.type}：${section.variant} 缺图，改用 ${meta.fallback}`);
    variant = meta.fallback;
    const rule = order.find((item) => item.type === section.type);
    if (rule && !rule.variants.includes(variant)) fail(`fallback ${variant} 不在户型允许的版式里`);
  }
  return variant;
}

function imagesReady(data, field) {
  if (!field) return false;
  if (field.includes(".")) {
    const [list, key] = field.split(".");
    const items = data?.[list];
    if (!Array.isArray(items) || items.length === 0) return false;
    return items.every((item) => pictureReady(item?.[key]));
  }
  return pictureReady(data?.[field]);
}

function pictureReady(value) {
  if (!value) return false;
  const slot = slotOf(value);
  if (slot) {
    if (findSlotFile(slot)) return true;
    if (imageSlots.get(slot)?.source === "client") return true;
    return demoMode;
  }
  return inspectAsset(value).state === "ok";
}

function slotOf(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.startsWith("slot:")) {
    const id = raw.slice(5).trim();
    if (!imageSlots.has(id)) fail(`images.json 没有图片位 ${id}`);
    return id;
  }
  if (!raw.includes("/") && !raw.includes("\\") && !path.posix.extname(raw) && imageSlots.has(raw)) return raw;
  return null;
}

function resolvePicture(rel, file) {
  const slot = slotOf(rel);
  if (slot) return resolveSlot(slot, file);
  const info = inspectAsset(rel);
  if (!rel) return { src: "", width: "", height: "" };
  if (info.state === "bad") fail(info.message);
  if (info.state === "missing") {
    notes.push(`图片不存在，已省略：${info.clean || rel}`);
    return { src: "", width: "", height: "" };
  }
  if (!copied.has(info.clean)) {
    const dest = path.join(outDir, ...info.clean.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(info.full, dest);
    copied.add(info.clean);
  }
  const size = imageSize(info.full) || { width: 1200, height: 800 };
  return { src: assetPrefix(file) + encodePath(info.clean), width: size.width, height: size.height };
}

function resolveSlot(id, file) {
  const meta = imageSlots.get(id);
  const box = ratioBox(meta?.ratio);
  const found = findSlotFile(id);
  if (found) {
    const ext = path.extname(found).toLowerCase();
    const clean = `images/${id}${ext}`;
    if (!copied.has(clean)) {
      const dest = path.join(outDir, "images", `${id}${ext}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(found, dest);
      copied.add(clean);
    }
    const size = imageSize(found) || { width: box.w, height: box.h };
    return { src: assetPrefix(file) + encodePath(clean), width: size.width, height: size.height };
  }
  if (meta?.source === "client") return clientPlaceholder(meta, id, box);
  if (!demoMode) {
    if (!notedMissing.has(id)) {
      notes.push(`图片不存在，已省略：${id}`);
      notedMissing.add(id);
    }
    return { src: "", width: "", height: "" };
  }
  const label = `${id} ${meta?.ratio || ""}`.trim();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" data-demo="1" width="${box.w}" height="${box.h}" viewBox="0 0 ${box.w} ${box.h}"><rect width="100%" height="100%" fill="#2f3331"/><text x="50%" y="18%" dominant-baseline="middle" text-anchor="middle" fill="#d5ddd8" font-size="36" font-family="sans-serif">${xmlText(label)}</text></svg>`;
  return {
    src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    width: box.w,
    height: box.h,
  };
}

function clientPlaceholder(meta, id, box) {
  const raw = String(meta?.desc || "").trim();
  const sentence = raw.split(/[。！？!?]/)[0].trim();
  const purpose = (sentence || id).slice(0, 18);
  const label = `${purpose} · 上线前替换`;
  const size = Math.max(18, Math.min(42, Math.round(Math.min(box.w / 22, box.h / 6))));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}" viewBox="0 0 ${box.w} ${box.h}"><rect width="100%" height="100%" fill="#e7e2d8"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#3d3b37" font-size="${size}" font-family="sans-serif">${xmlText(label)}</text></svg>`;
  return {
    src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    width: box.w,
    height: box.h,
  };
}

function xmlText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function findSlotFile(id) {
  if (!demoDir) return null;
  let names = [];
  try {
    names = fs.readdirSync(demoDir);
  } catch {
    return null;
  }
  for (const ext of IMAGE_EXT) {
    if (names.includes(id + ext)) return path.join(demoDir, id + ext);
  }
  return null;
}

function ratioBox(ratio) {
  const known = {
    "16:10": [1440, 900],
    "2.4:1": [1440, 600],
    "3:2": [1200, 800],
    "4:5": [800, 1000],
    "2:3": [800, 1200],
    "1:1": [800, 800],
    "6.6:1": [1440, 218],
  };
  if (known[ratio]) return { w: known[ratio][0], h: known[ratio][1] };
  const match = String(ratio || "").match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (match) {
    const w = 1200;
    const h = Math.max(1, Math.round((w * Number(match[2])) / Number(match[1])));
    return { w, h };
  }
  return { w: 1200, h: 800 };
}

function inspectAsset(rel) {
  const raw = String(rel || "");
  const clean = raw.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!clean || path.isAbsolute(raw) || path.win32.isAbsolute(clean) || path.posix.isAbsolute(clean)) {
    return { state: "bad", message: `图片路径不合法：${raw}` };
  }
  const parts = clean.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    return { state: "bad", message: `图片路径不合法：${raw}` };
  }
  const ext = path.posix.extname(clean).toLowerCase();
  if (!IMAGE_EXT.has(ext)) return { state: "bad", message: `图片只接受 jpg、jpeg、png、webp、svg、gif：${raw}` };
  const full = resolveInside(siteDir, parts);
  if (!full) return { state: "missing", clean };
  let stat;
  try {
    stat = fs.statSync(full);
  } catch (err) {
    return { state: "bad", message: `图片读不了：${raw}（${err.code || "错误"}）` };
  }
  if (!stat.isFile()) return { state: "bad", message: `图片路径不是文件：${raw}` };
  if (stat.size <= 0) return { state: "bad", message: `图片是空文件：${raw}` };
  return { state: "ok", clean, full };
}

function resolveInside(dir, parts) {
  let cur = dir;
  for (const part of parts) {
    let names;
    try {
      names = fs.readdirSync(cur);
    } catch {
      return null;
    }
    if (!names.includes(part)) return null;
    cur = path.join(cur, part);
  }
  return cur;
}

function encodePath(rel) {
  return rel.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function checkOrder(sections, order, file) {
  let last = -1;
  const seen = new Set();
  for (const section of sections) {
    const idx = order.findIndex((item) => item.type === section.type);
    if (idx === -1) fail(`${file} 不允许板块 ${section.type}`);
    if (seen.has(section.type)) fail(`${file} 重复了板块 ${section.type}`);
    if (idx < last) fail(`${file} 的板块顺序和户型不一致：${section.type}`);
    seen.add(section.type);
    last = idx;
    if (!order[idx].variants.includes(section.variant)) {
      fail(`${file} 的 ${section.type} 不能用版式 ${section.variant}`);
    }
  }
  for (const rule of order) {
    if (rule.required && !seen.has(rule.type)) fail(`${file} 缺少必备板块 ${rule.type}`);
  }
  return sections;
}

function makeGlobals(file) {
  const wechat = site.contact.wechat || "";
  const qr = site.contact.wechatQr || "";
  const qrPic = qr ? resolvePicture(qr, file) : { src: "", width: "", height: "" };
  const email = site.contact.email || "";
  const police = site.contact.police || "";
  const digits = police.replace(/\D/g, "");
  return {
    name: site.name,
    summary: site.summary || "",
    phone,
    phoneTel: phoneTel(phone),
    email,
    wechat,
    wechatQrSrc: qrPic.src,
    wechatQrWidth: String(qrPic.width || ""),
    wechatQrHeight: String(qrPic.height || ""),
    address,
    amapUrl: `https://uri.amap.com/search?keyword=${encodeURIComponent(address)}`,
    hours,
    hoursText: hours.map((row) => `${row.day} ${row.time}`).join("；"),
    icp: site.contact.icp || "",
    police,
    policeUrl: digits ? `https://www.beian.gov.cn/portal/registerSystemInfo?recordcode=${digits}` : "",
    formUrl: site.contact.formUrl || "",
    hasWechat: Boolean(wechat || qrPic.src),
    year: String(new Date().getFullYear()),
    primaryLabel: house.buttons.primary,
    secondaryLabel: house.buttons.secondary,
    formLabel: house.buttons.form,
    nav: (site.nav || []).map((item) => ({ label: item.label, href: rootHref(file, item.href) })),
    homeHref: rootHref(file, "index.html"),
  };
}

function contactHref() {
  const contact = house.pages.find((page) => page.id === "contact");
  if (contact?.file) return contact.file;
  return "#contact";
}

function itemsOf(id) {
  if (site.collections && Array.isArray(site.collections[id])) return site.collections[id];
  if (id === "products" && Array.isArray(site.products)) return site.products;
  return null;
}

function listFileOf(id) {
  const col = (showroom?.collections || house.collections || []).find((item) => item.id === id);
  if (col?.listFile) return col.listFile;
  const page = house.pages.find((item) => item.id === id && !item.from);
  if (page?.file) return page.file;
  if (id === "products") return "products/index.html";
  return `${id}/index.html`;
}

function collectionLabel(id) {
  const col = (showroom?.collections || house.collections || []).find((item) => item.id === id);
  return col?.label || id;
}

function detailHref(id, slug) {
  const page = house.pages.find((item) => item.from === id);
  if (page?.file) return page.file.replaceAll("{slug}", slug);
  if (id === "products") return `products/${slug}.html`;
  return `${id}/${slug}.html`;
}

function defaultBannerImage() {
  return imageSlots.has("banner") ? "banner" : "";
}

function bannerFromTitle(title) {
  const name = String(title || "").split("｜")[0].trim() || title;
  return {
    title: name,
    image: defaultBannerImage(),
    imageAlt: name,
    crumbs: [{ label: name, href: "" }],
  };
}

function bannerFromPage(source) {
  const name = source.bannerTitle || String(source.title || "").split("｜")[0].trim();
  return {
    title: name,
    image: source.banner || defaultBannerImage(),
    imageAlt: source.bannerAlt || name,
    crumbs: Array.isArray(source.crumbs) ? source.crumbs : [{ label: name, href: "" }],
  };
}

function jsonLd() {
  const type = site.businessType === "Organization" ? "Organization" : "LocalBusiness";
  const data = {
    "@context": "https://schema.org",
    "@type": type,
    name: site.name,
    description: site.summary || "",
  };
  if (phone) data.telephone = phone;
  if (site.contact.email) data.email = site.contact.email;
  if (address) data.address = { "@type": "PostalAddress", streetAddress: address };
  if (site.url) data.url = site.url;
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function canonical(file) {
  if (!site.url) return "";
  try {
    const base = site.url.endsWith("/") ? site.url : `${site.url}/`;
    return new URL(file, base).toString();
  } catch {
    return "";
  }
}

function cssRoot(token) {
  const scale = typeScale(token.type.base, token.type.ratio);
  const density = DENSITY[token.density];
  const motionOn = token.motion === 1;
  const lines = [
    ":root {",
    `  --bg: ${token.color.bg};`,
    `  --surface: ${token.color.surface};`,
    `  --text: ${token.color.text};`,
    `  --text-muted: ${token.color["text-muted"]};`,
    `  --border: ${token.color.border};`,
    `  --primary: ${token.color.primary};`,
    `  --primary-contrast: ${token.color["primary-contrast"]};`,
    `  --accent: ${token.color.accent};`,
    `  --on-media: ${token.color["on-media"] || token.color["primary-contrast"]};`,
    "  --scrim: linear-gradient(180deg, rgb(0 0 0 / 0.4), rgb(0 0 0 / 0.8));",
    `  --font-heading: ${token.font["font-heading"]};`,
    `  --font-body: ${token.font["font-body"]};`,
    ...scale.map((size, index) => `  --fs-${index + 1}: ${size};`),
  ];
  if (typeof token.type.hero === "number") lines.push(`  --fs-hero: ${token.type.hero}px;`);
  if (token.type.display) lines.push(`  --display: ${token.type.display};`);
  lines.push(
    `  --radius-sm: ${token.radius["radius-sm"]};`,
    `  --radius-md: ${token.radius["radius-md"]};`,
    `  --radius-lg: ${token.radius["radius-lg"]};`,
    `  --shadow-card: ${token.shadow["shadow-card"]};`,
    `  --section-y: ${token.sectionY || density.y};`,
    `  --gap: ${density.gap};`,
    `  --container: ${token.container}px;`,
    `  --dur: ${motionOn ? "200ms" : "0ms"};`,
    `  --dur-enter: ${motionOn ? "700ms" : "0ms"};`,
    "  --ease: cubic-bezier(0.4, 0, 0.2, 1);",
    "}",
  );
  return lines.join("\n");
}

function typeScale(base, ratio) {
  const sizes = [];
  for (let i = 0; i < 6; i += 1) {
    let px = base * ratio ** i;
    if (i === 4) px = Math.min(px, 48);
    if (i === 5) px = Math.min(px, 60);
    sizes.push(px);
  }
  if (sizes[5] / base < 2.5) sizes[5] = Math.min(60, base * 2.5);
  return sizes.map((n) => `${Math.round(n * 10) / 10}px`);
}

function validateTokens(token) {
  const colors = ["bg", "surface", "text", "text-muted", "border", "primary", "primary-contrast", "accent"];
  for (const key of colors) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(token.color?.[key] || "")) fail(`token 颜色不合法：${key}`);
  }
  if (token.color?.["on-media"] && !/^#[0-9A-Fa-f]{6}$/.test(token.color["on-media"])) {
    fail("token 颜色不合法：on-media");
  }
  if (!token.font?.["font-heading"] || !token.font?.["font-body"]) fail("token 缺少字体栈");
  const base = token.type?.base;
  const ratio = token.type?.ratio;
  if (typeof base !== "number" || base < 16 || base > 18) fail("正文字号 base 必须在 16 到 18");
  if (![1.2, 1.25, 1.333].some((item) => Math.abs(item - ratio) < 0.0001)) fail("字阶比只能是 1.2、1.25 或 1.333");
  if (token.type?.display && !["sans", "serif", "script"].includes(token.type.display)) {
    fail("type.display 只能是 sans、serif、script");
  }
  if (token.type?.hero != null) {
    const hero = token.type.hero;
    const cap = token.type.display === "script" ? HERO_PX.script : HERO_PX.max;
    if (typeof hero !== "number" || hero < HERO_PX.min || hero > cap) {
      fail(`首屏标题 ${hero}px 不在 ${HERO_PX.min} 到 ${cap}`);
    }
  }
  if (token.sectionY) {
    const max = maxLengthPx(token.sectionY);
    if (max == null || max > 160 || max < 80) fail("sectionY 的固定长度要在 80px 到 160px");
  }
  for (const key of ["radius-sm", "radius-md", "radius-lg"]) {
    if (!token.radius?.[key]) fail(`token 缺少 ${key}`);
  }
  if (!token.shadow?.["shadow-card"]) fail("token 缺少 shadow-card");
  if (!DENSITY[token.density]) fail("density 只能是 compact、standard、airy");
  if (typeof token.container !== "number" || token.container < 1152 || token.container > 1340) {
    fail("容器宽必须在 1152 到 1340");
  }
  if (token.motion !== 0 && token.motion !== 1) fail("motion 只能是 0 或 1");
}

function maxLengthPx(value) {
  const found = [];
  for (const match of String(value).matchAll(/(-?\d+(?:\.\d+)?)(px|rem|em)\b/g)) {
    const n = Number(match[1]);
    found.push(match[2] === "px" ? n : n * 16);
  }
  if (!found.length) return null;
  return Math.max(...found);
}

function resolveStyle(style, dir) {
  if (!style) fail("site.json 缺少 style");
  const byId = path.join(root, "styles", style, "tokens.json");
  if (fs.existsSync(byId)) return byId;
  const rel = path.resolve(dir, style, "tokens.json");
  if (fs.existsSync(rel)) return rel;
  fail(`找不到风格：${style}`);
}

function loadImageSlots() {
  const map = new Map();
  if (!showroomDir) return map;
  const file = path.join(showroomDir, "images.json");
  if (!fs.existsSync(file)) return map;
  const data = readJsonOrFail(file);
  for (const slot of data.slots || []) {
    if (!slot?.id) fail("images.json 有图片位缺少 id");
    map.set(slot.id, slot);
  }
  return map;
}

function loadSpecs() {
  const map = new Map();
  readSpecDir(path.join(frameworkDir, "sections"), map);
  if (showroomDir) readSpecDir(path.join(showroomDir, "sections"), map);
  return map;
}

function readSpecDir(dir, map) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const specPath = path.join(dir, name, "spec.json");
    if (fs.existsSync(specPath)) map.set(name, readJsonOrFail(specPath));
  }
}

function sectionFile(type, variant, ext) {
  if (showroomDir) {
    const local = path.join(showroomDir, "sections", type, `${variant}.${ext}`);
    if (fs.existsSync(local)) return local;
  }
  const file = path.join(frameworkDir, "sections", type, `${variant}.${ext}`);
  if (!fs.existsSync(file)) fail(`找不到版式文件 ${type}/${variant}.${ext}`);
  return file;
}

function loadIcons() {
  const dir = path.join(frameworkDir, "icons");
  const map = new Map();
  if (!fs.existsSync(dir)) return map;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".svg")) continue;
    map.set(name.replace(/\.svg$/, ""), readText(path.join(dir, name)).replace(/\s+/g, " ").trim());
  }
  return map;
}

function rootHref(fromFile, href) {
  if (!href) return "";
  let raw = String(href).trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) || raw.startsWith("//") || raw.startsWith("#")) return raw;
  raw = raw.replace(/^\/+/, "");
  const split = raw.match(/^([^?#]*)(.*)$/);
  let target = split[1];
  const suffix = split[2];
  if (!target || target === "." || target === "./") target = "index.html";
  else if (target.endsWith("/")) target += "index.html";
  else if (!path.posix.extname(target)) target += "/index.html";
  const fromDir = path.posix.dirname(fromFile);
  let rel = path.posix.relative(fromDir, target);
  if (!rel || rel === ".") rel = "index.html";
  return rel + suffix;
}

function phoneTel(raw) {
  const head = String(raw).split(/\s*(?:转|分机|ext\.?|\/|,|，|;|；)\s*/i)[0];
  return head.replace(/[^\d+]/g, "");
}

function loadHouse(industry) {
  const name = String(industry || "");
  const options = () => {
    const dir = path.join(root, "industries");
    return fs.readdirSync(dir).filter((item) => fs.existsSync(path.join(dir, item, "house.json"))).join("、");
  };
  if (!/^[a-z0-9-]+$/.test(name)) fail(`没有户型「${name}」，可选：${options()}`);
  const file = path.join(root, "industries", name, "house.json");
  if (!fs.existsSync(file)) fail(`没有户型「${name}」，可选：${options()}`);
  return readJsonOrFail(file);
}

function publishSite(value) {
  const out = {};
  for (const key of PUBLISHED_KEYS) {
    if (key in value && value[key] !== "") out[key] = stripPrivate(value[key]);
  }
  return out;
}

function stripPrivate(value) {
  if (Array.isArray(value)) return value.map(stripPrivate);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith("_")) continue;
    out[key] = stripPrivate(item);
  }
  return out;
}

function assetPrefix(file) {
  const depth = file.split("/").length - 1;
  return depth === 0 ? "" : "../".repeat(depth);
}

function safeAnchor(anchor, file) {
  if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(anchor)) fail(`${file} 的锚点不合法：${anchor}`);
  return anchor;
}

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`缺少 ${label}`);
  return value.trim();
}

function assertAllowed(list, value, label) {
  if (!list?.includes(value)) fail(`${label}不在户型允许范围：${value}`);
}

function readJsonOrFail(file) {
  try {
    return readJson(file);
  } catch (err) {
    fail(err.message || `读不了 ${file}`);
  }
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function printTree(dir, prefix) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    console.log(`${prefix}${entry.name}${entry.isDirectory() ? "/" : ""}`);
    if (entry.isDirectory()) printTree(path.join(dir, entry.name), `${prefix}  `);
  }
}

function assertRegistered(site) {
  const industryProblem = industryError(site?.industry);
  if (industryProblem) fail(industryProblem);
  const nicheProblem = nicheError(site?.industry, site?.niche);
  if (nicheProblem) fail(nicheProblem);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
