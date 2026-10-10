/**
 * node scripts/build.mjs <site.json> [--out <dir>] [--site-dir <dir>] [--keep <相对目录>] [--demo-images <dir>] [--images <dir>] [--base-url <url>]
 * 读企业档案，套上户型或样板间，拼成纯静态站。
 * 不安装依赖。内容违规交给 check.mjs，这里只在结构拼不起来时失败。
 * --keep 可重复。--site-dir 仍会先清空目标目录，但这些相对子目录会原样留住。
 * 留住的目录在同一盘用 rename，不再用 cpSync，中文路径不会把进程打崩。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { render } from "./lib/tpl.mjs";
import { parseColor, toHex } from "./lib/color.mjs";
import { readJson } from "./lib/json.mjs";
import { imageSize } from "./lib/image-size.mjs";
import { EN_FONT, formatDate, langError, loadCopy, siteLang } from "./lib/i18n.mjs";
import { HERO_PX, industryError, nicheError } from "./lib/rules.mjs";
import {
  closedTargets,
  contactFile,
  isOn,
  pointsClosed,
  requiredTurnedOff,
  resolveHeroButtons,
  scrubSection,
} from "./lib/pages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frameworkDir = path.join(root, "framework");

const DENSITY = {
  compact: { y: "clamp(2.5rem, 2rem + 2vw, 3.5rem)", gap: "1rem" },
  standard: { y: "clamp(3rem, 2.4rem + 3vw, 5rem)", gap: "1.5rem" },
  airy: { y: "clamp(3.5rem, 2.6rem + 4vw, 6.5rem)", gap: "2rem" },
};

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".svg", ".gif"]);
const PUBLISHED_KEYS = [
  "id", "lang", "name", "industry", "niche", "showroom", "style", "businessType", "summary", "url",
  "contact", "nav", "shell", "pages", "products", "collections", "toolEntry", "hero", "buttons",
];
const TONES = new Set(["light", "dark", "image"]);

const args = process.argv.slice(2);
let sitePath = null;
let outRoot = path.join(root, "out");
let demoDir = null;
let imagesDir = null;
let siteDirArg = null;
let baseUrlArg = "";
const keepRels = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--out") {
    outRoot = path.resolve(args[i + 1] || "");
    i += 1;
  } else if (args[i] === "--site-dir") {
    siteDirArg = path.resolve(args[i + 1] || "");
    i += 1;
  } else if (args[i] === "--keep") {
    keepRels.push(readKeep(args[i + 1] || ""));
    i += 1;
  } else if (args[i] === "--demo-images") {
    demoDir = path.resolve(args[i + 1] || "");
    i += 1;
  } else if (args[i] === "--images") {
    imagesDir = path.resolve(args[i + 1] || "");
    i += 1;
  } else if (args[i] === "--base-url") {
    baseUrlArg = args[i + 1] || "";
    i += 1;
  } else if (!sitePath) sitePath = path.resolve(args[i]);
  else fail(`多余参数：${args[i]}`);
}
if (!sitePath) {
  fail("用法：node scripts/build.mjs <site.json> [--out <dir>] [--site-dir <dir>] [--keep <相对目录>] [--demo-images <dir>] [--images <dir>] [--base-url <url>]");
}
if (demoDir && imagesDir) fail("不要同时用 --images 和 --demo-images");
if (demoDir && (!fs.existsSync(demoDir) || !fs.statSync(demoDir).isDirectory())) {
  fail(`演示图片目录不存在：${demoDir}`);
}
if (imagesDir && (!fs.existsSync(imagesDir) || !fs.statSync(imagesDir).isDirectory())) {
  fail(`图片目录不存在：${imagesDir}`);
}

const demoMode = Boolean(demoDir);
const baseUrl = normalizeBase(baseUrlArg || "https://example.com/");
const site = readJsonOrFail(sitePath);
const langProblem = langError(site);
if (langProblem) fail(langProblem);
site.lang = siteLang(site);
const lang = site.lang;
const copy = loadCopy(lang);
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

const flavor = showroom && (showroom.flavor === "cn" || showroom.flavor === "intl") ? showroom.flavor : "";
const tokens = readJsonOrFail((assertRegistered(site), showroom ? path.join(showroomDir, "tokens.json") : resolveStyle(site.style, siteDir)));
validateTokens(tokens);
const house = showroom || loadHouse(site.industry);
const buttonOverrides = readButtonOverrides(site);
const imageSlots = loadImageSlots();
const frameworkSpecs = new Map();
readSpecDir(path.join(frameworkDir, "sections"), frameworkSpecs);
const specs = loadSpecs();
const tiered = [...imageSlots.values()].some((slot) => slot && (slot.tier === "must" || slot.tier === "nice"));
const fallbacks = [];
const icons = loadIcons();
const shell = readText(path.join(frameworkDir, "shell", "page.html"));
const notes = [];
const SOURCE_MARKS = new Set(["photo", "ai", "stock"]);
const copied = new Set();
const notedMissing = new Set();
let usedPlaceholder = false;
const DEMO_MARK = "data-demo%3D%221%22";
// 客户图占位（二维码、证书）：说明字的真实像素，和 SVG 根上的标记（URL 编码后的 data-ph="1"）。见 clientPlaceholder。
const PH_PX = 14;
const PH_MARK = "data-ph%3D%221%22";

const outDir = siteDirArg || path.join(outRoot, site.id);
resetOutDir(outDir, keepRels);

if (!site.name) fail("缺少 name");
const navConf = readNavConfig(site);
for (const page of site.pages || []) {
  if (!house.pages.some((item) => item.id === page.id && !item.from)) fail(`户型没有页面 ${page.id}`);
}

const toolEntry = readToolEntry();
const faqItems = collectFaqItems();
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
const turnedOff = requiredTurnedOff(house, site);
if (turnedOff.length) fail(`必有页不能关：${turnedOff.join("、")}`);
const categoryPlans = planCategories();

for (const page of house.pages) {
  if (!isOn(house, site, page)) continue;
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
    const categories = [...categoryPlans.values()].filter((item) => item.rootListFile === toRootPath(page.file));
    for (const category of categories) {
      writePage({
        file: category.listFile,
        title: `${category.category}${titleJoiner()}${site.name}`,
        description: source.description,
        sections: source.sections || [],
        order: page.order,
        banner: { ...bannerFromPage(source), title: category.category, crumbs: [{ label: collectionLabel(category.id), href: page.file }, { label: category.category, href: "" }] },
        listState: { ...category, page: 1, file: category.listFile },
      });
    }
  }
}

const css = [cssRoot(tokens), readText(path.join(frameworkDir, "base.css"))];
if (showroom?.layout === "business") css.push(readText(path.join(frameworkDir, "business.css")));
for (const key of [...usedCss].sort()) {
  const [type, variant] = key.split("/");
  css.push(readText(sectionFile(type, variant, "css")));
}
fs.mkdirSync(path.join(outDir, "assets"), { recursive: true });
fs.writeFileSync(path.join(outDir, "assets", "site.css"), css.join("\n"), "utf8");
fs.copyFileSync(path.join(frameworkDir, "shell", "site.js"), path.join(outDir, "assets", "site.js"));
publishSources();
fs.writeFileSync(path.join(outDir, "site.json"), JSON.stringify(publishSite(site), null, 2) + "\n", "utf8");
if (usedPlaceholder) notes.push("演示模式：缺图渲染成占位色块，页面标了演示占位图");
const coverage = collectCoverage();
writeSeoFiles();
fs.writeFileSync(
  path.join(outDir, "build-report.json"),
  JSON.stringify({
    notes,
    fallbacks,
    demo: demoMode,
    showroom: site.showroom || "",
    missingMust: coverage.missingMust,
    sparse: coverage.sparse,
    baseUrl,
  }, null, 2) + "\n",
  "utf8",
);
written.push("assets/site.css", "assets/site.js", "site.json", "sitemap.xml", "robots.txt", "build-report.json");

console.log(`已生成 ${path.relative(root, outDir) || outDir}`);
const printed = [...notes, ...fallbacks];
if (printed.length) {
  console.log("降级：");
  for (const note of printed) console.log(`- ${note}`);
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
    const bodyImage = item.image || "";
    const headerImage = pickDetailBanner(bodyImage, id);
    // 页头和正文不许用同一张。只有一张横图时页头留着、正文拿掉；只有一张竖图时竖图留在正文，页头不放图。
    const articleImage = headerImage && bodyImage === headerImage ? "" : bodyImage;
    const listPage = pagesById.get(id);
    const section = {
      type: rule.type,
      variant,
      anchor: "detail",
      data: {
        ...item,
        image: articleImage,
        imageAlt: item.imageAlt || item.name || "",
        primaryLabel: buttonLabel("primary"),
        primaryHref: contactHref(),
        backHref: listFileOf(id),
        backLabel: copy.backList,
      },
    };
    writePage({
      file,
      title: `${item.name}${titleJoiner()}${site.name}`,
      description: item.summary || site.summary,
      sections: [section],
      order: page.order,
      banner: {
        title: item.name,
        image: headerImage,
        imageAlt: headerImage && headerImage !== bodyImage
          ? (listPage?.bannerAlt || listPage?.bannerTitle || item.name || "")
          : (item.imageAlt || item.name || ""),
        crumbs: [
          { label: collectionLabel(id), href: listFileOf(id) },
          { label: item.name, href: "" },
        ],
      },
    });
  }
}

function writePage(opts) {
  const { file, title, description, sections, order, banner } = opts;
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
  for (const section of checked) {
    const kept = adaptSection(section, order);
    if (kept) queued.push(kept);
  }
  if (showroom && file !== "index.html") retargetBanner(queued);
  const listState = opts.listState || planList(file, queued);
  const globals = makeGlobals(file);
  let main = "";
  let first = true;
  for (const section of queued) {
    const spec = specs.get(section.type);
    if (!spec) fail(`没有板块 ${section.type}`);
    const resolved = section.type === "page-banner"
      ? { variant: "band", data: section.data || {} }
      : resolveSection(section, spec, order);
    if (!resolved) continue;
    const variant = resolved.variant;
    const fillSpec = resolved.fillSpec || spec;
    usedCss.add(`${section.type}/${variant}`);
    const data = prepareData({ ...section, data: resolved.data }, fillSpec, file, variant, listState);
    if (Array.isArray(data.items) && !data.items.length && section.data?.items?.length) continue;
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
    if (section.type === "hero" && variant === "carousel") {
      if (!data.carouselOn && /\bdata-carousel\b/.test(html)) html = stripCarouselChrome(html);
      if (data.hasSlideCopy) html = injectHeroCopies(html, data);
    }
    if ((section.type === "collection-list" || section.type === "product-list") && data._paginate === "1") {
      html = upgradeListCards(html, data);
    }
    html = tagSection(html, section, resolved, file);
    main += html;
  }
  if (file === "index.html" && toolEntry) {
    usedCss.add("tool-entry/band");
    const toolHtml = render(readText(sectionFile("tool-entry", "band", "html")), {
      title: toolEntry.title,
      lead: toolEntry.lead,
      label: toolEntry.label,
      href: siteHref(file, toolEntry.href),
    }, { icons, globals });
    main += tagSection(toolHtml, { tone: "" }, null, file);
  }
  usedCss.add(`header/${shellChoice.header}`);
  usedCss.add(`footer/${shellChoice.footer}`);
  usedCss.add(`float-contact/${shellChoice.floatContact}`);
  let headerHtml = render(readText(sectionFile("header", shellChoice.header, "html")), globals, { icons });
  headerHtml = upgradeHeader(headerHtml, globals.nav);
  let footerHtml = render(readText(sectionFile("footer", shellChoice.footer, "html")), globals, { icons });
  let floatHtml = render(readText(sectionFile("float-contact", shellChoice.floatContact, "html")), globals, { icons });
  ({ footerHtml, floatHtml } = injectQr(footerHtml, floatHtml, globals.qrcodes));
  const isHome = file === "index.html";
  let html = render(shell, {
    pageTitle: title,
    pageDescription: description,
    assetPrefix: assetPrefix(file),
    canonical: canonical(file),
    jsonLd: isHome ? jsonLd() : "",
    faqJsonLd: isHome ? faqJsonLd() : "",
    headerHtml,
    mainHtml: main,
    footerHtml,
    floatHtml,
    demoBadge: "",
    htmlLang: lang === "en" ? "en" : "zh-CN",
    ogLocale: lang === "en" ? "en_US" : "zh_CN",
    flavor,
    layout: showroom?.layout || "",
    ui: copy,
  }, { icons });
  if (html.includes(DEMO_MARK)) {
    usedPlaceholder = true;
    html = html.replace("<body>", `<body>\n  <p class="demo-badge">${escapeHtml(copy.demoBadge)}</p>`);
  }
  if (tiered && !demoMode) html = html.replace(/<img\b[^>]*\bsrc=""[^>]*>/gi, "");
  html = markPlaceholders(html);
  html = markPortraitBanners(html);
  const dest = path.join(outDir, ...file.split("/"));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html, "utf8");
  written.push(file);
  if (listState && listState.page === 1 && listState.pages > 1) {
    for (let page = 2; page <= listState.pages; page += 1) {
      writePage({
        ...opts,
        file: pageFileOf(listState.listFile, page),
        listState: { ...listState, page, file: pageFileOf(listState.listFile, page) },
      });
    }
  }
}

function tagSection(html, section, resolved, file) {
  const tone = section.tone || "";
  if (tone && !TONES.has(tone)) fail(`tone 只能是 light、dark、image：${tone}`);
  const enter = tokens.motion === 1;
  const bare = Boolean(resolved?.bare);
  let tagged = html.replace(/<section\b([^>]*)>/, (full, attrs) => {
    let next = attrs;
    if (tone && !/\bdata-tone=/.test(attrs)) next += ` data-tone="${tone}"`;
    if (enter && !/\bdata-enter=/.test(attrs)) next += ` data-enter="fade"`;
    if (bare && !/\bdata-hero-bare\b/.test(attrs)) next += ` data-hero-bare=""`;
    return `<section${next}>`;
  });
  const bg = sectionBackground(section, file);
  if (bg && (tone === "dark" || tone === "image") && section.type !== "hero" && section.type !== "page-banner") {
    tagged = tagged.replace(/<section\b([^>]*)>/, (full, attrs) => {
      let next = attrs;
      if (/\bclass="/.test(next)) next = next.replace(/class="/, 'class="has-section-bg ');
      else next += ' class="has-section-bg"';
      return `<section${next}>`;
    });
    const img = `<div class="section-bg" aria-hidden="true"><img src="${escAttr(bg.src)}" alt="" width="${escAttr(bg.width)}" height="${escAttr(bg.height)}" decoding="async"><span class="section-bg-mask"></span></div>`;
    tagged = tagged.replace(/(<section\b[^>]*>)/, `$1${img}`);
  }
  if (section.type === "collection-list" || section.type === "product-list") {
    tagged = tagged.replace(/<div\b([^>]*\bdata-media-group="[^"]*"[^>]*)>/g, (full, attrs, offset) => {
      const first = tagged.slice(offset + full.length).match(/^\s*<article\b[^>]*class="([^"]*)"/);
      const rows = /(?:^|\s)(?:row-item|news-row|ledger-row|docket-row|sheet-row|note-row|note|line|entry)(?:\s|$)/.test(first?.[1] || "");
      const fit = rows ? attrs : (/\bclass="/.test(attrs) ? attrs.replace(/class="([^"]*)"/, 'class="$1 fit-rows"') : `${attrs} class="fit-rows"`);
      return `<div${fit} data-list-grid="${rows ? "rows" : "cards"}">`;
    });
    const id = section.type === "product-list" ? "products" : section.data?.collection;
    const routes = [...categoryPlans.values()].filter((item) => item.id === id);
    if (routes.length) {
      const anchor = section.anchor || "list";
      const links = Object.fromEntries(routes.map((item) => [item.key, rootHref(file, item.listFile)]));
      const hashes = Object.fromEntries(routes.map((item) => [`#${anchor}-${item.key}`, links[item.key]]));
      const all = rootHref(file, routes[0].rootListFile);
      const current = routes.find((item) => covers(item.listFile, file));
      tagged = tagged.replace(/(<section\b)/, `$1 data-category-links="${escAttr(JSON.stringify(links))}" data-category-hashes="${escAttr(JSON.stringify(hashes))}" data-category-all="${escAttr(all)}"`);
      tagged = tagged.replace(/<a\b([^>]*?)href="(#[^"]*)"([^>]*)>/g, (full, before, hash, after) => {
        const target = hashes[hash] || (hash === `#${anchor}` ? all : "");
        if (!target) return full;
        let attrs = `${before}href="${escAttr(target)}"${after}`;
        const selected = current ? target === links[current.key] : target === all;
        if (selected) {
          attrs = /\bclass="/.test(attrs) ? attrs.replace(/class="([^"]*)"/, 'class="$1 is-category-current"') : `${attrs} class="is-category-current"`;
          attrs += ' aria-current="page"';
        }
        return `<a${attrs}>`;
      });
    }
  }
  if (!/<img\b[^>]*\bsrc="[^"\s]+"/.test(tagged)) tagged = tagged.replace(/(<section\b)/, '$1 data-no-media=""');
  return tagged;
}

function prepareData(section, spec, file, variant, listState) {
  const raw = { ...(section.data || {}) };
  if (section.type === "product-list" || section.type === "collection-list") {
    const id = section.type === "product-list" ? "products" : String(raw.collection || "");
    const all = itemsOf(id) || [];
    const catKeys = categoryKeys(all);
    let view = all;
    const paging = listState && listState.type === section.type && listState.id === id && toRootPath(file) === toRootPath(listState.file);
    raw.pager = [];
    raw.prevHref = "";
    raw.nextHref = "";
    raw._paginate = "";
    if (paging) {
      const start = (listState.page - 1) * listState.pageSize;
      const selected = listState.category ? all.filter((item) => String(item.category || "").trim() === listState.category) : all;
      view = selected.slice(start, start + listState.pageSize);
      raw._paginate = listState.pages > 1 ? "1" : "";
      raw.pager = [];
      for (let page = 1; listState.pages > 1 && page <= listState.pages; page += 1) {
        raw.pager.push({
          label: String(page),
          href: pageFileOf(listState.listFile, page),
          current: page === listState.page,
        });
      }
      raw.prevHref = listState.page > 1 ? pageFileOf(listState.listFile, listState.page - 1) : "";
      raw.nextHref = listState.page < listState.pages ? pageFileOf(listState.listFile, listState.page + 1) : "";
    } else {
      const limit = Number(raw.limit);
      if (Number.isFinite(limit) && limit > 0) view = all.slice(0, Math.floor(limit));
    }
    raw.items = view.map((item) => {
      const category = String(item.category || "").trim();
      const name = item.name || "";
      return {
        name,
        summary: item.summary || "",
        href: detailHref(id, item.slug),
        image: item.image || "",
        imageAlt: item.imageAlt || name,
        category,
        catKey: catKeys.get(category) || "",
        date: item.date || "",
        dateIso: dateIso(item.date),
        initial: firstChar(name),
        price: item.price || item.specs?.find((row) => row.label === "价格" || row.label === "Price")?.value || "",
      };
    });
    raw.filters = filtersFrom(catKeys, raw.facets);
  }
  if (section.type === "hero" && variant === "carousel") prepareHero(raw);
  const data = fill(raw, spec.fields, `${section.type}`);
  if (section.type === "trust" && Array.isArray(data.items)) {
    data.items = data.items.map((item) => ({
      ...item,
      countTo: (String(item.value || "").match(/\d[\d.]*/) || [""])[0],
    }));
  }
  return bindAssets(localizeDates(data), file);
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

// 二维码这类「图就是内容」的列表项：正式拼装客户没给文件，整项不出（连同图下面的说明字）。
// 演示模式有占位图，不受影响。证书、团队人像等有名字有说明的项不在此列，缺图仍保留文字。
function dropsWithoutClientImage(item) {
  if (showroom?.missingClientImages === "omit" && item && typeof item.image === "string") {
    const slot = slotOf(item.image);
    if (slot && imageSlots.get(slot)?.source === "client" && !findSlotFile(slot)) return true;
  }
  if (demoMode || !item || typeof item !== "object" || Array.isArray(item)) return false;
  if (typeof item.image !== "string" || !item.image) return false;
  const slot = slotOf(item.image);
  if (!slot || !/^qr(-|$)/i.test(slot)) return false;
  const meta = imageSlots.get(slot);
  return meta?.source === "client" && !findSlotFile(slot);
}

function bindAssets(data, file) {
  const walk = (node) => {
    if (Array.isArray(node)) return node.filter((item) => !dropsWithoutClientImage(item)).map(walk);
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
      } else if (typeof value === "string" && (key === "primaryHref" || key === "secondaryHref" || key === "href" || key === "backHref" || key === "prevHref" || key === "nextHref")) {
        out[key] = rootHref(file, value);
      } else if (value && typeof value === "object") out[key] = walk(value);
      else out[key] = value;
    }
    return out;
  };
  return walk(data);
}

function resolveSection(section, spec, order) {
  const meta = spec.variants?.[section.variant];
  if (!meta) fail(`未知版式 ${section.type}/${section.variant}`);
  const original = section.data || {};
  if (tiered && !demoMode && meta.needsImage) {
    if (section.type === "hero" && meta.imageField === "slides.image" && Array.isArray(original.slides)) {
      const kept = original.slides.filter((item) => imageKept(item?.image));
      const single = original.mode === "single" || kept.length === 1;
      if ((kept.length >= 3 && kept.length <= 9) || (single && kept.length > 0)) return { variant: section.variant, data: { ...original, slides: kept, ...(single ? { mode: "single" } : {}) } };
    }
    if (!imagesReady(original, meta.imageField)) {
      const fb = usableFallback(section, spec, order, original);
      if (fb) {
        fallbacks.push(`${section.type}：${section.variant} 缺图，改用 ${fb}`);
        return { variant: fb, data: original, bare: heroBare(section, spec, fb) };
      }
      if (section.type === "hero") {
        fallbacks.push(`${section.type}：${section.variant} 缺图，改用 text`);
        return { variant: "text", data: original, fillSpec: frameworkSpecs.get("hero") || spec, bare: true };
      }
      if (section.type === "photo-band") {
        fallbacks.push(`${section.type}：${section.variant} 缺图，整块不出`);
        return null;
      }
      fallbacks.push(`${section.type}：${section.variant} 缺图，图片留空`);
      return { variant: section.variant, data: original };
    }
  }
  let variant = section.variant;
  let bare = false;
  if (meta.needsImage && !imagesReady(original, meta.imageField)) {
    if (!meta.fallback || meta.fallback === "omit") fail(`${section.type}/${section.variant} 缺图，又没有 fallback`);
    notes.push(`${section.type}：${section.variant} 缺图，改用 ${meta.fallback}`);
    variant = meta.fallback;
    bare = heroBare(section, spec, variant);
    const rule = order.find((item) => item.type === section.type);
    if (rule && !rule.variants.includes(variant)) fail(`fallback ${variant} 不在户型允许的版式里`);
  }
  return { variant, data: original, bare };
}

function heroBare(section, spec, variant) {
  if (section.type !== "hero") return false;
  return !spec.variants?.[variant]?.needsImage;
}

function usableFallback(section, spec, order, data) {
  const fbName = spec.variants?.[section.variant]?.fallback;
  if (!fbName || fbName === "omit" || fbName === section.variant) return null;
  const fb = spec.variants?.[fbName];
  if (!fb) return null;
  const rule = (order || []).find((item) => item.type === section.type);
  if (rule && !rule.variants.includes(fbName)) return null;
  if (fb.needsImage && !imagesReady(data, fb.imageField)) return null;
  return fbName;
}

function categoryKeys(items) {
  const labels = [];
  const seen = new Set();
  for (const item of items || []) {
    const label = String(item?.category || "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  const byBase = new Map();
  for (const label of labels) {
    const base = stableCategoryKey(label);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(label);
  }
  const assigned = new Map();
  for (const [base, list] of byBase) {
    const sorted = [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    sorted.forEach((label, index) => {
      assigned.set(label, index === 0 ? base : `${base}-${index + 1}`);
    });
  }
  const map = new Map();
  for (const label of labels) map.set(label, assigned.get(label));
  return map;
}

function stableCategoryKey(label) {
  let hash = 2166136261;
  for (let i = 0; i < label.length; i += 1) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `k${(hash >>> 0).toString(36)}`;
}

function filtersFrom(catKeys, facets) {
  const notes = new Map();
  if (Array.isArray(facets)) {
    for (const facet of facets) {
      const name = String(facet?.name || "").trim();
      if (name) notes.set(name, String(facet.text || ""));
    }
  }
  return [...catKeys.entries()].map(([label, key]) => ({
    key,
    label,
    text: notes.get(label) || "",
  }));
}

function imageKept(value) {
  const state = imageState(value);
  return state === "file" || state === "demo";
}

function imageState(value) {
  if (!value) return "empty";
  const slot = slotOf(value);
  if (slot) {
    if (findSlotFile(slot)) return "file";
    const meta = imageSlots.get(slot);
    if (meta?.mustBeReal && !demoMode) return "missing";
    if (demoMode) return "demo";
    return "missing";
  }
  return inspectAsset(value).state === "ok" ? "file" : "missing";
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
    const meta = imageSlots.get(slot);
    if (meta?.mustBeReal && !demoMode) return false;
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
  if (meta?.mustBeReal && !demoMode) return { src: "", width: "", height: "" };
  // 客户提供的图（二维码、证书）：正式拼装没拿到文件就整块不出，不画「上线前替换」。演示模式才画占位。
  if (meta?.source === "client") return demoMode && showroom?.missingClientImages !== "omit" ? clientPlaceholder(meta, id, box) : { src: "", width: "", height: "" };
  if (!demoMode) {
    if (!tiered && !notedMissing.has(id)) {
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

/**
 * 客户提供的图（二维码、证书）在演示模式下画的占位。只在 --demo-images 时出现，正式拼装整块不出。
 * 说明字由这里统一画，样板间不再各盖一层：
 * - SVG 不写 viewBox，宽高都是 100%：里面一个单位就是显示出来的 1 个像素，字永远是 14px，
 *   不管这张图在页面里显示成 96px 的页脚小码，还是 288px 的证书格。以前字号按画布比例算，显示多大字跟着多大。
 * - 底色、虚线框、字色取这个站自己的 tokens（--text、--surface、--text-muted），和页面配套，不是一块固定的米色。
 * - 文案分行：用途一行到三行，最后一行「上线前替换」。用途取 desc 的第一小句；
 *   没有 desc 时，二维码位叫「二维码」，其他位叫「客户提供的图」。不拿图片位 id 当文案。
 * - SVG 根上带 data-ph 标记，writePage 看到它就给 <img> 加 data-ph 属性，框架 CSS 靠这个属性给占位图设显示尺寸。
 */
function clientPlaceholder(meta, id, box) {
  const raw = String(meta?.desc || "").trim();
  const clause = raw.split(/[。！？!?，,；;]/)[0].trim().replace(/(上线前.*|占位|示例)$/, "").trim();
  const isQr = /^qr(-|$)/i.test(id);
  const generic = isQr ? copy.placeholderQr : copy.placeholderImage;
  const purpose = lang === "en" ? generic : (clause || generic).slice(0, 18);
  // 按最小的显示宽度（约 96px）折行：中文一行 6 个字，英文一行 14 个字符。
  const perLine = lang === "en" ? 14 : 6;
  const lines = [...wrapEven(purpose, perLine), ...wrapEven(copy.placeholderNote, perLine)];
  const colors = placeholderColors();
  const rows = lines.map((text, index) => {
    const dy = ((index - (lines.length - 1) / 2) * 1.45).toFixed(3);
    return `<text x="50%" y="50%" dy="${dy}em" dominant-baseline="central" text-anchor="middle" fill="${colors.text}" font-size="${PH_PX}" font-family="sans-serif">${xmlText(text)}</text>`;
  }).join("");
  const frame = `<rect x="3%" y="3%" width="94%" height="94%" fill="none" stroke="${colors.line}" stroke-width="1" stroke-dasharray="5 4"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" data-ph="1" width="100%" height="100%"><rect width="100%" height="100%" fill="${colors.fill}"/>${frame}${rows}</svg>`;
  return {
    src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    width: box.w,
    height: box.h,
  };
}

// 占位图的三个颜色，从这个站的 tokens 里混出来：底 = 字色 8% 混进表面色，虚线 = 字色 30% 混进底，字 = 次要字色。
// 次要字色落在底上不到 4.5:1 时改用正文字色。tokens 里读不到颜色就回到固定的米色。
function placeholderColors() {
  const c = tokens?.color || {};
  const text = parseColor(c.text);
  const surface = parseColor(c.surface);
  const muted = parseColor(c["text-muted"]);
  if (!text || !surface || !muted) return { fill: "#e7e2d8", line: "#b9b2a3", text: "#3d3b37" };
  const mix = (a, b, t) => ({
    r: a.r * t + b.r * (1 - t),
    g: a.g * t + b.g * (1 - t),
    b: a.b * t + b.b * (1 - t),
  });
  const fill = mix(text, surface, 0.08);
  const line = mix(text, fill, 0.3);
  const lum = (v) => {
    const f = (n) => {
      const x = n / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(v.r) + 0.7152 * f(v.g) + 0.0722 * f(v.b);
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const ink = ratio(muted, fill) >= 4.5 ? muted : text;
  return {
    fill: toHex(fill.r, fill.g, fill.b),
    line: toHex(line.r, line.g, line.b),
    text: toHex(ink.r, ink.g, ink.b),
  };
}

// 给占位图的 <img> 加 data-ph 属性：只认 clientPlaceholder 画的 SVG（根上有 data-ph 标记）。
function markPlaceholders(html) {
  if (!html.includes(PH_MARK)) return html;
  return html.replace(/<img\b(?=[^>]*\bsrc="data:image\/svg\+xml,[^"]*data-ph%3D%221%22)/g, '<img data-ph=""');
}

// 一行放不下就均匀拆成几行：7 个字拆成 4 + 3，不拆成 6 + 1。含空格的（英文）按词拆。
function wrapEven(text, perLine) {
  const chars = [...text];
  if (chars.length <= perLine) return [text];
  if (/\s/.test(text)) {
    const out = [];
    let cur = "";
    for (const word of text.split(/\s+/)) {
      if (cur && `${cur} ${word}`.length > perLine) {
        out.push(cur);
        cur = word;
      } else cur = cur ? `${cur} ${word}` : word;
    }
    if (cur) out.push(cur);
    return out;
  }
  const each = Math.ceil(chars.length / Math.ceil(chars.length / perLine));
  const out = [];
  for (let i = 0; i < chars.length; i += each) out.push(chars.slice(i, i + each).join(""));
  return out;
}

function xmlText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function findSlotFile(id) {
  const dir = demoDir || imagesDir;
  if (!dir) return null;
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const ext of IMAGE_EXT) {
    if (names.includes(id + ext)) return path.join(dir, id + ext);
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
    hoursText: hours.map((row) => `${row.day} ${row.time}`).join(lang === "en" ? "; " : "；"),
    icp: site.contact.icp || "",
    police,
    policeUrl: digits ? `https://www.beian.gov.cn/portal/registerSystemInfo?recordcode=${digits}` : "",
    formUrl: site.contact.formUrl || "",
    hasWechat: Boolean(wechat || qrPic.src),
    year: String(new Date().getFullYear()),
    primaryLabel: buttonLabel("primary"),
    secondaryLabel: buttonLabel("secondary"),
    formLabel: buttonLabel("form"),
    ui: copy,
    nav: navFor(file),
    homeHref: rootHref(file, "index.html"),
    qrcodes: qrCodesFor(file),
    // 页脚品牌栏的「首页」链接：导航里已经有首页就不再放一条重复的。
    footerHome: !navConf.items.some((item) => rootHref("index.html", item.href) === "index.html"),
  };
}

function contactHref() {
  return contactFile(house);
}

function defaultPrimaryClosed() {
  return pointsClosed(house.buttons?.primaryHref || "", closedTargets(house, site));
}

function adaptSection(section, order) {
  if (section.type === "hero") {
    const buttons = resolveHeroButtons({
      site,
      house,
      data: section.data || {},
      phone,
      labels: copy,
    });
    return {
      ...section,
      data: {
        ...(section.data || {}),
        primaryLabel: buttons[0].label,
        primaryHref: buttons[0].href,
        secondaryLabel: buttons[1]?.label || "",
        secondaryHref: buttons[1]?.href || "",
      },
    };
  }
  const rule = (order || []).find((item) => item.type === section.type);
  return scrubSection(section, { house, site, required: Boolean(rule?.required), labels: copy });
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

function slotRatio(id) {
  const slot = imageSlots.get(id);
  const matched = String(slot?.ratio || "").match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!matched) return null;
  return { w: Number(matched[1]), h: Number(matched[2]) };
}

function isPortraitSlot(id) {
  const ratio = slotRatio(id);
  return Boolean(ratio && ratio.w > 0 && ratio.h > ratio.w * 1.02);
}

function isSquareSlot(id) {
  const ratio = slotRatio(id);
  if (!ratio || !(ratio.w > 0)) return false;
  return Math.abs(ratio.h - ratio.w) / ratio.w <= 0.02;
}

// 详情页页头：先用列表页指定的横幅，再用名为 banner 的图位，再用 block 是 page-banner / banner 的横图。
// 跳过和正文同一张、以及竖图、方图。一张横图都没有时：正文是横图就用它（调用方清掉正文），正文是竖图就返回空。
function pickDetailBanner(bodyImage, collectionId) {
  const list = pagesById.get(collectionId);
  const candidates = [];
  if (list?.banner) candidates.push(list.banner);
  const fallback = defaultBannerImage();
  if (fallback) candidates.push(fallback);
  for (const slot of imageSlots.values()) {
    if (slot?.block === "page-banner" || slot?.block === "banner") candidates.push(slot.id);
  }
  const seen = new Set();
  for (const id of candidates) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (id === bodyImage) continue;
    if (isPortraitSlot(id) || isSquareSlot(id)) continue;
    return id;
  }
  if (bodyImage && !isPortraitSlot(bodyImage)) return bodyImage;
  return "";
}

function imageFields(data) {
  const ids = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if ((key === "image" || key === "wechatQr") && typeof value === "string" && value) ids.push(value);
      else if (value && typeof value === "object") walk(value);
    }
  };
  walk(data);
  return ids;
}

function alternateBanner(used) {
  const ranked = [];
  for (const slot of imageSlots.values()) {
    const id = slot?.id;
    if (!id || used.has(id)) continue;
    if (isPortraitSlot(id) || isSquareSlot(id)) continue;
    if (/^qr(-|$)/i.test(id)) continue;
    const block = String(slot.block || "");
    let score = 1;
    if (block === "page-banner" || block === "banner" || id === "banner" || id.startsWith("banner-")) score = 4;
    else if (block === "hero" || id.startsWith("hero-")) score = 3;
    else if (block === "photo-band") score = 2;
    ranked.push({ id, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return ranked[0]?.id || "";
}

function clearImageField(node, slotId) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((item) => clearImageField(item, slotId));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if ((key === "image" || key === "wechatQr") && value === slotId) node[key] = "";
    else if (value && typeof value === "object") clearImageField(value, slotId);
  }
}

// 内页页头和本页主图（不含列表缩略图）撞车时，换成另一张横图。没有第二张就清掉正文里那张。
function retargetBanner(queued) {
  const banner = queued.find((section) => section.type === "page-banner");
  const bannerId = banner?.data?.image || "";
  if (!bannerId) return;
  const used = new Set([bannerId]);
  const clashes = [];
  for (const section of queued) {
    if (section.type === "page-banner" || section.type === "collection-list" || section.type === "product-list") continue;
    const ids = imageFields(section.data);
    for (const id of ids) used.add(id);
    if (ids.includes(bannerId)) clashes.push(section);
  }
  if (!clashes.length) return;
  const alt = alternateBanner(used);
  if (alt) {
    banner.data = { ...banner.data, image: alt };
    return;
  }
  for (const section of clashes) clearImageField(section.data, bannerId);
}

// 竖图进了横幅或正文主图时打上 is-portrait。页头把裁切焦点抬到靠上；正文版式可据此不把人像裁成横条。
function markPortraitBanners(html) {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    if (!(/\bpage-banner-img\b/.test(tag) || /\bdetail-photo\b/.test(tag)) || /\bis-portrait\b/.test(tag)) return tag;
    const width = Number((tag.match(/\bwidth="(\d+)"/) || [])[1]);
    const height = Number((tag.match(/\bheight="(\d+)"/) || [])[1]);
    if (!(width > 0 && height > width * 1.02)) return tag;
    return tag.replace(/\bclass="([^"]*)"/, (full, cls) => `class="${cls} is-portrait"`);
  });
}

function bannerFromTitle(title) {
  const name = splitTitle(title);
  return {
    title: name,
    image: defaultBannerImage(),
    imageAlt: name,
    crumbs: [{ label: name, href: "" }],
  };
}

function bannerFromPage(source) {
  const name = source.bannerTitle || splitTitle(source.title);
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
    inLanguage: lang === "en" ? "en" : "zh-CN",
  };
  if (phone) data.telephone = phone;
  if (site.contact.email) data.email = site.contact.email;
  if (address) data.address = { "@type": "PostalAddress", streetAddress: address };
  if (site.url) data.url = site.url;
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function faqJsonLd() {
  if (!faqItems.length) return "";
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: lang === "en" ? "en" : "zh-CN",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function collectFaqItems() {
  const items = [];
  for (const page of site.pages || []) {
    if (page.enabled === false) continue;
    for (const section of page.sections || []) {
      if (section?.type !== "faq") continue;
      const list = section.data?.items;
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!item || typeof item.q !== "string" || typeof item.a !== "string") continue;
        if (!item.q.trim() || !item.a.trim()) continue;
        items.push({ q: item.q, a: item.a });
      }
    }
  }
  return items;
}

function readToolEntry() {
  const raw = site.toolEntry;
  if (raw == null || raw === "") return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("toolEntry 必须是对象");
  const title = requiredText(raw.title, "toolEntry.title");
  const lead = requiredText(raw.lead, "toolEntry.lead");
  const label = requiredText(raw.label, "toolEntry.label");
  const href = typeof raw.href === "string" && raw.href.trim() ? raw.href.trim() : "tool/";
  return { title, lead, label, href };
}

function navFor(file) {
  const closed = closedTargets(house, site);
  const nav = [];
  for (const item of navConf.items) {
    if (pointsClosed(item.href, closed)) continue;
    const children = resolveChildren(item, navConf.auto, closed).map((child) => ({
      label: child.label,
      href: rootHref(file, child.href),
      current: childHrefCurrent(child.href, file),
      children: [],
    }));
    const current = covers(item.href, file) || children.some((child) => child.current);
    nav.push({
      label: item.label,
      href: rootHref(file, item.href),
      current,
      children,
    });
  }
  if (!toolEntry) return nav;
  const href = siteHref(file, toolEntry.href);
  const taken = navConf.items.some((item) => sameSitePath(item.href, toolEntry.href));
  if (!taken) nav.push({ label: toolEntry.title, href, current: covers(toolEntry.href, file), children: [] });
  return nav;
}

function readNavConfig(doc) {
  const nav = doc.nav;
  let auto = doc.navAutoChildren !== false;
  let items = nav;
  if (nav && !Array.isArray(nav) && typeof nav === "object") {
    auto = nav.autoChildren !== false;
    items = nav.items;
  }
  if (!Array.isArray(items) || items.length === 0) fail("缺少 nav");
  for (const item of items) {
    if (!item || !item.label || !item.href) fail("nav 每一项都要有 label 和 href");
    if (item.children == null) continue;
    if (!Array.isArray(item.children)) fail("nav.children 必须是列表");
    for (const child of item.children) {
      if (!child || !child.label || !child.href) fail("nav 的二级每一项都要有 label 和 href");
    }
  }
  return { auto, items };
}

function resolveChildren(item, auto, closed) {
  if (Array.isArray(item.children) && item.children.length) {
    return item.children.filter((child) => child && child.label && child.href && !pointsClosed(child.href, closed));
  }
  if (item.autoChildren === false || auto === false) return [];
  const id = typeof item.autoChildren === "string" && item.autoChildren
    ? item.autoChildren
    : collectionIdForHref(item.href);
  if (!id) return [];
  const items = itemsOf(id);
  if (!items) return [];
  const keys = categoryKeys(items);
  if (keys.size < 2) return [];
  const listFile = toRootPath(listFileOf(id));
  const hook = listHookOf(id);
  const children = [];
  for (const [label, key] of keys) {
    const href = categoryPlans.get(`${id}:${key}`)?.listFile || categoryHref(listFile, hook, key);
    if (pointsClosed(href, closed)) continue;
    children.push({ label, href });
  }
  return children.length >= 2 ? children : [];
}

function collectionIdForHref(href) {
  const cols = showroom?.collections || house.collections || [];
  for (const col of cols) {
    if (col?.listFile && sameSitePath(col.listFile, href)) return col.id;
  }
  if (sameSitePath(href, "products/index.html") && itemsOf("products")) return "products";
  return "";
}

function listHookOf(id) {
  const listFile = toRootPath(listFileOf(id));
  for (const page of site.pages || []) {
    const housePage = (house.pages || []).find((item) => item.id === page.id && !item.from);
    if (!housePage || toRootPath(housePage.file) !== listFile) continue;
    for (const section of page.sections || []) {
      if (section?.type !== "collection-list" && section?.type !== "product-list") continue;
      const html = readSectionTemplate(section.type, section.variant);
      return {
        anchor: section.anchor || "list",
        keyed: /id="\{\{anchor\}\}-\{\{key\}\}"/.test(html),
        anchored: /id="\{\{anchor\}\}"/.test(html),
      };
    }
  }
  return { anchor: "list", keyed: false, anchored: false };
}

function categoryHref(listFile, hook, key) {
  if (hook.keyed) return `${listFile}#${hook.anchor}-${key}`;
  if (hook.anchored) return `${listFile}#${hook.anchor}`;
  return listFile;
}

function readSectionTemplate(type, variant) {
  if (!type || !variant) return "";
  const names = [];
  if (showroomDir) names.push(path.join(showroomDir, "sections", type, `${variant}.html`));
  names.push(path.join(frameworkDir, "sections", type, `${variant}.html`));
  for (const file of names) {
    if (fs.existsSync(file)) return readText(file);
  }
  return "";
}

function childHrefCurrent(href, file) {
  if (String(href || "").includes("#")) return false;
  return covers(href, file);
}

function covers(href, file) {
  const raw = String(href || "").trim();
  if (!raw || raw.startsWith("#") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return false;
  const pathOnly = raw.split("#")[0].split("?")[0];
  const rootPath = toRootPath(pathOnly);
  const current = toRootPath(file);
  if (rootPath === "index.html") return current === "index.html";
  if (rootPath === current) return true;
  if (rootPath.endsWith("/index.html")) {
    const dir = rootPath.slice(0, -"index.html".length);
    return current.startsWith(dir);
  }
  return false;
}

function toRootPath(file) {
  let raw = String(file || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  raw = raw.split("#")[0].split("?")[0];
  if (!raw || raw === "index.html") return "index.html";
  if (raw.endsWith("/")) raw += "index.html";
  else if (!path.posix.extname(raw)) raw += "/index.html";
  return raw;
}

function pageFileOf(listFile, page) {
  const rootPath = toRootPath(listFile);
  if (page <= 1) return rootPath;
  const dir = path.posix.dirname(rootPath);
  const base = dir === "." ? "" : `${dir}/`;
  return `${base}page/${page}.html`;
}

function planList(file, queued) {
  for (const section of queued) {
    if (section.type !== "collection-list" && section.type !== "product-list") continue;
    const id = section.type === "product-list" ? "products" : String(section.data?.collection || "");
    if (!id) continue;
    const listFile = toRootPath(listFileOf(id));
    if (toRootPath(file) !== listFile) continue;
    const items = itemsOf(id) || [];
    const pageSize = clampPageSize(section.data?.pageSize ?? site.pageSize);
    if (items.length <= pageSize) continue;
    return {
      type: section.type,
      id,
      listFile,
      pageSize,
      pages: Math.ceil(items.length / pageSize),
      page: 1,
      file: listFile,
    };
  }
  return null;
}

function planCategories() {
  const plans = new Map();
  for (const page of house.pages || []) {
    if (page.from || !isOn(house, site, page)) continue;
    const source = pagesById.get(page.id);
    for (const section of source?.sections || []) {
      if (!["collection-list", "product-list"].includes(section.type)) continue;
      const id = section.type === "product-list" ? "products" : section.data?.collection;
      if (!id || toRootPath(page.file) !== toRootPath(listFileOf(id))) continue;
      const items = itemsOf(id) || [];
      const pageSize = clampPageSize(section.data?.pageSize ?? site.pageSize);
      const keys = categoryKeys(items);
      if ((items.length <= pageSize && showroom?.layout !== "business") || keys.size < 2) continue;
      for (const [category, key] of keys) {
        const count = items.filter((item) => String(item.category || "").trim() === category).length;
        const rootListFile = toRootPath(page.file);
        plans.set(`${id}:${key}`, { id, key, category, type: section.type, rootListFile, listFile: path.posix.join(path.posix.dirname(rootListFile), "category", key, "index.html"), pageSize, pages: Math.ceil(count / pageSize) });
      }
    }
  }
  return plans;
}

function clampPageSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 9;
  return Math.min(60, Math.max(1, Math.floor(n)));
}

function prepareHero(raw) {
  if (!raw.interval) raw.interval = "4000";
  const slides = Array.isArray(raw.slides) ? raw.slides.map((item) => ({ ...(item || {}) })) : [];
  const single = raw.mode === "single" || slides.length <= 1;
  const kept = single ? slides.slice(0, 1) : slides;
  const hasCopy = kept.some((item) => textOf(item.title) || textOf(item.lead) || textOf(item.primaryLabel));
  raw.carouselOn = single ? "" : "1";
  raw.hasSlideCopy = hasCopy ? "1" : "";
  raw.slides = kept.map((item, index) => {
    if (!hasCopy) return item;
    return {
      ...item,
      title: textOf(item.title) || textOf(raw.title),
      lead: textOf(item.lead) || textOf(raw.lead),
      primaryLabel: textOf(item.primaryLabel) || textOf(raw.primaryLabel),
      primaryHref: textOf(item.primaryHref) || textOf(raw.primaryHref),
      secondaryLabel: textOf(item.secondaryLabel) || (index === 0 ? textOf(raw.secondaryLabel) : ""),
      secondaryHref: textOf(item.secondaryHref) || (index === 0 ? textOf(raw.secondaryHref) : ""),
      isFirst: index === 0,
    };
  });
}

function textOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstChar(name) {
  const text = String(name || "").trim();
  if (!text) return "";
  return [...text][0];
}

function dateIso(value) {
  const text = String(value || "").trim();
  const matched = text.match(/^(\d{4})[-/.年](\d{1,2})(?:[-/.月](\d{1,2}))?/);
  if (!matched) return "";
  const month = matched[2].padStart(2, "0");
  const day = matched[3] ? matched[3].padStart(2, "0") : "01";
  return `${matched[1]}-${month}-${day}`;
}

function escAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function sectionBackground(section, file) {
  const id = textOf(section?.bg) || textOf(section?.data?.bg);
  if (!id || !file) return null;
  const pic = resolvePicture(id, file);
  if (!pic.src) return null;
  return pic;
}

function stripCarouselChrome(html) {
  let out = html.replace(/\sdata-carousel\b(?:="[^"]*")?/g, "");
  out = out.replace(/\sdata-interval="[^"]*"/g, "");
  out = out.replace(/<button\b[^>]*\bdata-carousel-prev\b[^>]*>[\s\S]*?<\/button>/g, "");
  out = out.replace(/<button\b[^>]*\bdata-carousel-next\b[^>]*>[\s\S]*?<\/button>/g, "");
  out = out.replace(/<div class="hero-dots">[\s\S]*?<\/div>/g, "");
  out = out.replace(/<div class="container hero-ui">\s*<\/div>/g, "");
  return out;
}

function injectHeroCopies(html, data) {
  if (!data?.hasSlideCopy || html.includes("data-hero-copy")) return html;
  const slides = Array.isArray(data.slides) ? data.slides : [];
  const copies = slides.map((slide) => {
    const title = slide.title ? `<p class="section-title">${escapeHtml(slide.title)}</p>` : "";
    const lead = slide.lead ? `<p class="section-lead">${escapeHtml(slide.lead)}</p>` : "";
    let buttons = "";
    if (slide.primaryLabel && slide.primaryHref) {
      const secondary = slide.secondaryLabel && slide.secondaryHref
        ? `<a class="btn" href="${escAttr(slide.secondaryHref)}">${escapeHtml(slide.secondaryLabel)}</a>`
        : "";
      buttons = `<div class="btn-row"><a class="btn btn-primary" href="${escAttr(slide.primaryHref)}">${escapeHtml(slide.primaryLabel)}</a>${secondary}</div>`;
    }
    return `<div class="hero-slide-copy" data-hero-copy>${title}${lead}${buttons}</div>`;
  }).join("");
  const block = `<div class="hero-slide-copies" data-hero-copies>${copies}</div>`;
  let next = html.replace(/class="([^"]*\bhero-copy\b[^"]*)"/, (full, cls) => {
    if (cls.includes("has-slide-copy")) return full;
    return `class="${cls} has-slide-copy"`;
  });
  next = next.replace(/(<div\b[^>]*\bhero-copy\b[^>]*>)/, `$1${block}`);
  return next;
}

function upgradeListCards(html, data) {
  if (!data || data._paginate !== "1") return html;
  let next = html;
  if (!next.includes("media-card")) {
    const items = data.items || [];
    const found = next.match(/<article\b[\s\S]*?<\/article>/g) || [];
    if (found.length === items.length && items.length) {
      let index = 0;
      next = next.replace(/<article\b[\s\S]*?<\/article>/g, () => mediaCard(items[index++]));
      next = next.replace(
        /(<div\b[^>]*class=")([^"]*)("[^>]*>)(\s*<article class="media-card")/,
        (full, open, cls, close, rest) => (/\bmedia-grid\b/.test(cls) ? full : `${open}${cls} media-grid${close}${rest}`),
      );
    }
  }
  if (!next.includes("data-pager") && Array.isArray(data.pager) && data.pager.length > 1) {
    next = insertPager(next, pagerHtml(data));
  }
  return next;
}

function mediaCard(item) {
  const href = escAttr(item.href || "");
  const name = escapeHtml(item.name || "");
  const initial = escapeHtml(item.initial || firstChar(item.name) || "·");
  const thumb = item.image
    ? `<img src="${escAttr(item.image)}" alt="${escAttr(item.imageAlt || item.name || "")}" width="${escAttr(item.imageWidth || "")}" height="${escAttr(item.imageHeight || "")}" loading="lazy" decoding="async">`
    : `<span class="media-card-fallback" aria-hidden="true">${initial}</span>`;
  const summary = `<p class="media-card-summary">${escapeHtml(item.summary || "")}</p>`;
  const bits = [];
  if (item.date) {
    const iso = item.dateIso ? ` datetime="${escAttr(item.dateIso)}"` : "";
    bits.push(`<time${iso}>${escapeHtml(item.date)}</time>`);
  }
  if (item.category) bits.push(`<span class="media-card-tag">${escapeHtml(item.category)}</span>`);
  return `<article class="media-card"><a class="media-card-thumb" href="${href}">${thumb}</a><h2 class="item-title"><a href="${href}">${name}</a></h2>${summary}<p class="media-card-meta">${bits.join("")}</p></article>`;
}

function pagerHtml(data) {
  const prev = data.prevHref ? `<a class="pager-prev" href="${escAttr(data.prevHref)}">${escapeHtml(copy.pagerPrev)}</a>` : "";
  const next = data.nextHref ? `<a class="pager-next" href="${escAttr(data.nextHref)}">${escapeHtml(copy.pagerNext)}</a>` : "";
  const pages = (data.pager || []).map((item) => {
    const current = item.current ? ' class="is-current" aria-current="page"' : "";
    return `<a href="${escAttr(item.href)}"${current}>${escapeHtml(item.label)}</a>`;
  }).join("");
  return `<nav class="pager" data-pager aria-label="${escAttr(copy.pagerLabel)}">${prev}${pages}${next}</nav>`;
}

function insertPager(html, nav) {
  const end = html.lastIndexOf("</section>");
  if (end === -1) return html + nav;
  const head = html.slice(0, end);
  const div = head.lastIndexOf("</div>");
  if (div === -1) return `${head}${nav}${html.slice(end)}`;
  return `${head.slice(0, div)}${nav}${head.slice(div)}${html.slice(end)}`;
}

function qrCodesFor(file) {
  const list = site.contact?.qrcodes;
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const image = textOf(item.image);
    if (!image) continue;
    const pic = resolvePicture(image, file);
    if (!pic.src) continue;
    const label = textOf(item.label);
    out.push({
      src: pic.src,
      width: String(pic.width || ""),
      height: String(pic.height || ""),
      label,
      alt: textOf(item.imageAlt) || label || copy.placeholderQr || "二维码",
    });
    if (out.length >= 2) break;
  }
  return out;
}

function qrBlock(items) {
  const figs = items.map((item) => {
    const caption = item.label ? `<figcaption>${escapeHtml(item.label)}</figcaption>` : "";
    return `<figure class="footer-qr"><img src="${escAttr(item.src)}" alt="${escAttr(item.alt)}" width="${escAttr(item.width)}" height="${escAttr(item.height)}" decoding="async">${caption}</figure>`;
  }).join("");
  return `<div class="footer-qrs" data-qrcodes>${figs}</div>`;
}

function injectQr(footerHtml, floatHtml, items) {
  if (!items?.length) return { footerHtml, floatHtml };
  if (!footerHtml.includes("data-qrcodes")) {
    const block = qrBlock(items);
    if (footerHtml.includes('<div class="footer-legal">')) {
      footerHtml = footerHtml.replace('<div class="footer-legal">', `${block}<div class="footer-legal">`);
    } else {
      footerHtml = footerHtml.replace(/<\/footer>/, `${block}</footer>`);
    }
  }
  if (!floatHtml.includes("data-qrcodes")) {
    const figs = items.map((item) => {
      const caption = item.label ? `<figcaption>${escapeHtml(item.label)}</figcaption>` : "";
      return `<figure class="footer-qr"><img src="${escAttr(item.src)}" alt="${escAttr(item.alt)}" width="${escAttr(item.width)}" height="${escAttr(item.height)}">${caption}</figure>`;
    }).join("");
    const pop = `<details class="wechat-pop qr-pop"><summary class="btn">${escapeHtml(copy.qrButton)}</summary><div class="wechat-panel qr-pop-panel" data-qrcodes>${figs}</div></details>`;
    const at = floatHtml.lastIndexOf("</div>");
    if (at !== -1) floatHtml = `${floatHtml.slice(0, at)}${pop}${floatHtml.slice(at)}`;
  }
  return { footerHtml, floatHtml };
}

function upgradeHeader(html, items) {
  if (!html || !Array.isArray(items) || items.length === 0) return html;
  const byKey = new Map();
  for (const item of items) byKey.set(`${item.href}\0${stripJoiners(item.label)}`, item);
  return html.replace(/<a href="([^"]+)">([^<]*)<\/a>/g, (full, href, inner) => {
    const label = stripJoiners(decodeBasic(inner)).trim();
    const item = byKey.get(`${decodeBasic(href)}\0${label}`);
    if (!item) return full;
    if (!item.current && !(item.children && item.children.length)) return full;
    return navItemHtml(item);
  });
}

function navItemHtml(item) {
  const kids = Array.isArray(item.children) ? item.children : [];
  const hasKids = kids.length > 0;
  const current = Boolean(item.current);
  const cls = `nav-item${hasKids ? " has-sub" : ""}${current ? " is-current" : ""}`;
  const currentAttr = current ? ' class="is-current" aria-current="page"' : "";
  const popup = hasKids ? ' aria-haspopup="true"' : "";
  const caret = hasKids ? '<span class="nav-caret" aria-hidden="true"></span>' : "";
  const sub = hasKids
    ? `<button type="button" class="nav-more" aria-expanded="false" aria-label="${escAttr(copy.navExpand)}">${chevronIcon()}<span class="sr">${escapeHtml(copy.navExpand)}</span></button><ul class="nav-sub" data-subnav>${kids.map((child) => {
      const childCurrent = child.current ? ' class="is-current" aria-current="page"' : "";
      return `<li><a href="${escAttr(child.href)}"${childCurrent}>${escapeHtml(child.label)}</a></li>`;
    }).join("")}</ul>`
    : "";
  return `<span class="${cls}"><a href="${escAttr(item.href)}"${currentAttr}${popup}>${escapeHtml(item.label)}${caret}</a>${sub}</span>`;
}

function chevronIcon() {
  const svg = icons.get("chevron-down");
  if (!svg) return "";
  return svg.replace("<svg", '<svg class="icon icon-20" focusable="false" aria-hidden="true"');
}

function stripJoiners(value) {
  return String(value || "").replace(/\u2060/g, "");
}

function decodeBasic(value) {
  return stripJoiners(value)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function sameSitePath(left, right) {
  const norm = (value) => String(value || "").trim().replace(/^\/+/, "").replace(/\/index\.html$/, "").replace(/\/$/, "");
  return norm(left) !== "" && norm(left) === norm(right);
}

function siteHref(fromFile, href) {
  let raw = String(href || "").trim();
  if (!raw) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) || raw.startsWith("//") || raw.startsWith("#")) return raw;
  const dirLike = raw.endsWith("/");
  raw = raw.replace(/^\/+/, "");
  if (!dirLike) return rootHref(fromFile, raw);
  const target = raw.replace(/\/$/, "");
  const fromDir = path.posix.dirname(fromFile);
  let rel = path.posix.relative(fromDir === "." ? "" : fromDir, target);
  if (!rel || rel === ".") rel = ".";
  return rel.endsWith("/") ? rel : `${rel}/`;
}

function collectCoverage() {
  const missingMust = [];
  let missingNice = false;
  let realGap = false;
  if (!tiered || demoMode) return { missingMust, sparse: false };
  for (const slot of imageSlots.values()) {
    if (!slot?.id || (slot.tier !== "must" && slot.tier !== "nice")) continue;
    if (findSlotFile(slot.id)) continue;
    if (slot.mustBeReal) {
      realGap = true;
      continue;
    }
    if (slot.tier === "must") missingMust.push(slot.id);
    else if (slot.source !== "client") missingNice = true;
  }
  return { missingMust, sparse: missingMust.length > 0 || missingNice || realGap };
}

function writeSeoFiles() {
  const pages = written.filter((file) => file.endsWith(".html"));
  const urls = pages.map((file) => new URL(file, baseUrl).href);
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((loc) => `  <url><loc>${xmlText(loc)}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "sitemap.xml"), body, "utf8");
  const robots = `User-agent: *\nAllow: /\n\nSitemap: ${new URL("sitemap.xml", baseUrl).href}\n`;
  fs.writeFileSync(path.join(outDir, "robots.txt"), robots, "utf8");
}

function normalizeBase(value) {
  const trimmed = String(value || "").trim() || "https://example.com/";
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    fail(`网址不合法：${trimmed}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") fail(`网址只接受 http 或 https：${trimmed}`);
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
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
    "  --scrim-banner: linear-gradient(90deg, rgb(0 0 0 / 0.82), rgb(0 0 0 / 0.62));",
    `  --font-heading: ${lang === "en" ? (token.font["font-heading-en"] || EN_FONT) : token.font["font-heading"]};`,
    `  --font-body: ${lang === "en" ? (token.font["font-body-en"] || EN_FONT) : token.font["font-body"]};`,
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
  for (const key of ["font-heading-en", "font-body-en"]) {
    const value = token.font?.[key];
    if (value == null || value === "") continue;
    if (typeof value !== "string" || value.length < 3) fail(`token 字体不合法：${key}`);
  }
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
  let mustCount = 0;
  for (const slot of data.slots || []) {
    if (!slot?.id) fail("images.json 有图片位缺少 id");
    if (slot.tier != null && slot.tier !== "must" && slot.tier !== "nice") {
      fail(`图片位 ${slot.id} 的 tier 只能是 must 或 nice`);
    }
    if (slot.tier === "must") mustCount += 1;
    if (slot.mustBeReal && !slot.fallback) {
      fail(`图片位 ${slot.id} 标了必须实拍，但没有无图 fallback`);
    }
    map.set(slot.id, slot);
  }
  if (mustCount > 8) fail(`样板间 ${site.showroom} 的必配图有 ${mustCount} 张，课上最多 8 张`);
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

function readButtonOverrides(doc) {
  const raw = doc?.buttons;
  if (raw == null || raw === "") return {};
  if (typeof raw !== "object" || Array.isArray(raw)) fail("buttons 必须是对象");
  const out = {};
  for (const key of ["primary", "secondary", "form"]) {
    if (!(key in raw) || raw[key] === "") continue;
    if (typeof raw[key] !== "string") fail(`buttons.${key} 必须是字符串`);
    const text = raw[key].trim();
    if (text) out[key] = text;
  }
  return out;
}

function buttonLabel(key) {
  if (buttonOverrides[key]) return buttonOverrides[key];
  if (defaultPrimaryClosed() && key === "primary") return copy.phoneConsult;
  if (defaultPrimaryClosed() && key === "form") return copy.contactUs;
  return house.buttons[key];
}

function titleJoiner() {
  return lang === "en" ? " | " : "｜";
}

function splitTitle(title) {
  const text = String(title || "");
  const mark = lang === "en" ? " | " : "｜";
  if (!text.includes(mark)) return text.trim() || text;
  return text.split(mark)[0].trim() || text;
}

function localizeDates(node) {
  if (lang !== "en") return node;
  if (Array.isArray(node)) return node.map((item) => localizeDates(item));
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "date" && typeof value === "string") out[key] = formatDate(value, lang);
    else if (value && typeof value === "object") out[key] = localizeDates(value);
    else out[key] = value;
  }
  return out;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

function readKeep(raw) {
  const text = String(raw || "").trim();
  const rel = text.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  const bad = !rel || path.posix.isAbsolute(rel) || path.win32.isAbsolute(text) || /^[A-Za-z]:/.test(rel);
  if (bad || rel.split("/").some((part) => !part || part === "." || part === "..")) {
    fail(`--keep 要写目标目录里的相对路径：${raw}`);
  }
  return rel;
}

function resetOutDir(dir, keeps) {
  const stashed = [];
  if (fs.existsSync(dir)) {
    const base = path.resolve(dir);
    const parent = path.dirname(base);
    for (const rel of keeps) {
      const src = path.join(dir, ...rel.split("/"));
      const resolved = path.resolve(src);
      if (resolved !== base && !resolved.startsWith(base + path.sep)) fail(`--keep 路径越界：${rel}`);
      if (!fs.existsSync(src)) continue;
      const tmp = fs.mkdtempSync(path.join(parent, ".fitout-keep-"));
      const saved = path.join(tmp, "item");
      moveTree(src, saved);
      stashed.push({ rel, saved, tmp });
    }
    removeTree(dir);
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const item of stashed) {
    const dest = path.join(dir, ...item.rel.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    moveTree(item.saved, dest);
    removeTree(item.tmp);
  }
}

function moveTree(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch {
    copyTree(src, dest);
    removeTree(src);
  }
}

function copyTree(src, dest) {
  const st = fs.lstatSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) copyTree(path.join(src, name), path.join(dest, name));
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (st.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(src), dest);
    return;
  }
  fs.copyFileSync(src, dest);
}

function removeTree(target) {
  if (!fs.existsSync(target)) return;
  const st = fs.lstatSync(target);
  if (st.isDirectory() && !st.isSymbolicLink()) {
    for (const name of fs.readdirSync(target)) removeTree(path.join(target, name));
    fs.rmdirSync(target);
    return;
  }
  fs.unlinkSync(target);
}

function publishSources() {
  if (!imagesDir) return;
  const file = path.join(imagesDir, "sources.json");
  if (!fs.existsSync(file)) return;
  let data;
  try {
    data = readJson(file);
  } catch (err) {
    fail(err.message || "sources.json 不是合法 JSON");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail("sources.json 要是对象：图片位 id 对应 photo、ai 或 stock");
  }
  const out = {};
  for (const [id, value] of Object.entries(data)) {
    const mark = typeof value === "string" ? value.trim() : "";
    if (!SOURCE_MARKS.has(mark)) fail(`sources.json 的来源只能是 photo、ai、stock：${id}`);
    out[id] = mark;
  }
  const destDir = path.join(outDir, "images");
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, "sources.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
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
