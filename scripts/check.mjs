/**
 * node scripts/check.mjs <站点目录> [--site <site.json>] [--demo]
 * node scripts/check.mjs --lint-framework
 * node scripts/check.mjs --lint-showrooms
 * 有 block 级失败就退出码 1。警告不改变退出码。
 * 规则等级在 scripts/lib/rules.mjs。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readJson } from "./lib/json.mjs";
import { langError, loadCopy, siteLang } from "./lib/i18n.mjs";
import { closedTargets, isOn, parentOfCollection, pointsClosed } from "./lib/pages.mjs";
import {
  RULES,
  E6_WORDS,
  phrasesFor,
  textLimit,
  PLACEHOLDERS,
  LIMITS,
  CONTRAST_PAIRS,
  SAT_KEYS,
  SAT_MAX,
  PURPLE_HUE,
  BANNED_HEX,
  CJK_FONT,
  NAMED_COLORS,
  HIGH_SAT_BANDS,
  HERO_PX,
  levelOf,
  phraseLevel,
  satFull,
  purpleAccentOk,
  serifOk,
  a11Level,
  heroTitleIssue,
  industryError,
  nicheError,
} from "./lib/rules.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const lint = args.includes("--lint-framework");
const lintRooms = args.includes("--lint-showrooms");
const demoFlag = args.includes("--demo");
let siteOverride = null;
const dirs = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--lint-framework" || args[i] === "--lint-showrooms" || args[i] === "--demo") continue;
  if (args[i] === "--site") {
    siteOverride = path.resolve(args[i + 1] || "");
    i += 1;
    continue;
  }
  dirs.push(path.resolve(args[i]));
}

const blocks = [];
const warnings = [];
let currentDir = null;
const seenReports = new Set();
const cjkFont = new RegExp(`^(?:${CJK_FONT})`, "i");
const genericFace = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "inherit", "initial", "unset",
  "revert", "revert-layer", "emoji", "math", "fangsong",
]);

function main() {
  if (!lint && !lintRooms && dirs.length === 0) {
    console.error("用法：node scripts/check.mjs <站点目录> [--site <site.json>] [--demo]");
    console.error("      node scripts/check.mjs --lint-framework");
    console.error("      node scripts/check.mjs --lint-showrooms");
    process.exit(2);
  }
  if (lint) lintFramework();
  if (lintRooms) lintShowrooms();
  for (const dir of dirs) checkSite(dir);
  printReport();
  process.exit(blocks.length ? 1 : 0);
}

function checkSite(dir) {
  currentDir = dir;
  if (!fs.existsSync(dir)) {
    report("结构", `${dir} 不存在`);
    return;
  }
  const htmlFiles = walk(dir).filter((file) => file.endsWith(".html"));
  if (htmlFiles.length === 0) report("结构", `${rel(dir)} 里没有 html`);
  const cssPath = path.join(dir, "assets", "site.css");
  const jsPath = path.join(dir, "assets", "site.js");
  const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf8") : "";
  const js = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, "utf8") : "";
  if (!css) report("结构", "缺少 assets/site.css");
  if (!js) report("结构", "缺少 assets/site.js");

  const vars = parseRoot(css);
  const sitePath = siteOverride || path.join(dir, "site.json");
  let site = null;
  if (!fs.existsSync(sitePath)) report("spec", "缺少 site.json，没法核对字段和备案号");
  else {
    try {
      site = readJson(sitePath);
      const langProblem = langError(site);
      if (langProblem) report("SEO", langProblem);
      checkSiteJson(site);
      checkLengths(site);
      const registered = industryError(site.industry) || nicheError(site.industry, site.niche);
      if (registered) report("结构", registered);
    } catch (err) {
      report("spec", err.message || `${sitePath} 不是合法 JSON`);
    }
  }
  const demoMode = demoFlag || readDemoFlag(dir);
  const house = loadHouse(site);
  if (css) {
    checkTokens(vars, site);
    checkCss(css, vars, site);
    checkFonts(css, vars, site);
  }
  checkMotionJs(js);

  const toolRel = toolRoot(site);
  if (toolRel && !toolRel.endsWith(".html")) {
    const indexFile = path.join(dir, ...toolRel.split("/"), "index.html");
    if (!fs.existsSync(indexFile)) report("链接", `小工具入口缺少 ${toolRel}/index.html`);
  }
  for (const file of htmlFiles) {
    // 拼装在长中文末尾插入的词连接符（U+2060）不占宽，比对正文、按钮和备案号时去掉。
    const html = fs.readFileSync(file, "utf8").replace(/\u2060/g, "");
    const where = path.relative(dir, file).replaceAll("\\", "/");
    if (isToolHtml(where, toolRel)) {
      checkLinks(dir, file, where, html, demoMode);
      continue;
    }
    checkResiduals(where, html);
    checkPage(where, html, site, house, vars, js, demoMode, css);
    checkLinks(dir, file, where, html, demoMode);
  }
  if (css) checkResiduals("assets/site.css", css);
  if (js) checkResiduals("assets/site.js", js);
  checkBuildReport(dir);
  checkClientSlots(dir, site, demoMode);
  checkImageTiers(dir, demoMode);
  checkImageSources(dir, site, demoMode);
}

function demoSoft(demoMode, html) {
  return Boolean(demoMode && String(html || "").includes("demo-badge"));
}

function checkClientSlots(dir, site, demoMode) {
  if (demoMode || !site?.showroom || !/^[a-z0-9_-]+$/.test(site.showroom)) return;
  const file = path.join(root, "showrooms", site.showroom, "images.json");
  if (!fs.existsSync(file)) return;
  let doc;
  try {
    doc = readJson(file);
  } catch {
    return;
  }
  const slots = (doc.slots || []).filter((slot) => slot && slot.source === "client" && slot.id && !slot.tier);
  if (!slots.length) return;
  let names = [];
  const folder = path.join(dir, "images");
  if (fs.existsSync(folder)) {
    try {
      names = fs.readdirSync(folder);
    } catch {
      names = [];
    }
  }
  const exts = [".jpg", ".jpeg", ".png", ".webp", ".svg", ".gif"];
  for (const slot of slots) {
    const id = String(slot.id);
    if (exts.some((ext) => names.includes(id + ext))) continue;
    report("图片", `${id} 是客户提供的图片，正式站还没有文件`, "warn");
  }
}

function checkImageSources(dir, site, demoMode) {
  if (demoMode || !site?.showroom || !/^[a-z0-9_-]+$/.test(site.showroom)) return;
  const specFile = path.join(root, "showrooms", site.showroom, "images.json");
  if (!fs.existsSync(specFile)) return;
  let doc;
  try {
    doc = readJson(specFile);
  } catch {
    return;
  }
  const realIds = (doc.slots || [])
    .filter((slot) => slot && slot.mustBeReal && slot.id)
    .map((slot) => String(slot.id));
  if (!realIds.length) return;
  const file = path.join(dir, "images", "sources.json");
  if (!fs.existsSync(file)) {
    report("实拍", "无法确认实拍", "warn");
    return;
  }
  let sources;
  try {
    sources = readJson(file);
  } catch {
    report("实拍", "sources.json 不是合法 JSON");
    return;
  }
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) {
    report("实拍", "sources.json 要是对象：图片位 id 对应 photo、ai 或 stock");
    return;
  }
  const allowed = new Set(["photo", "ai", "stock"]);
  for (const id of realIds) {
    if (!Object.prototype.hasOwnProperty.call(sources, id)) {
      report("实拍", `无法确认实拍：${id}`, "warn");
      continue;
    }
    const mark = typeof sources[id] === "string" ? sources[id].trim() : "";
    if (!allowed.has(mark)) {
      report("实拍", `sources.json 的来源只能是 photo、ai、stock：${id}`);
      continue;
    }
    if (mark === "ai") report("实拍", `不许拿生成图冒充实拍：${id}`);
  }
}

function readSparse(dir) {
  if (!dir) return false;
  const file = path.join(dir, "build-report.json");
  if (!fs.existsSync(file)) return false;
  try {
    return readJson(file).sparse === true;
  } catch {
    return false;
  }
}

function checkImageTiers(dir, demoMode) {
  if (demoMode) return;
  const file = path.join(dir, "build-report.json");
  if (!fs.existsSync(file)) return;
  let data;
  try {
    data = readJson(file);
  } catch {
    return;
  }
  const missing = Array.isArray(data.missingMust) ? data.missingMust.filter(Boolean) : [];
  if (missing.length) {
    report("图片", `这些图课上要有，现在还没有：${missing.join("、")}`, "warn");
  }
  const base = String(data.baseUrl || "");
  if (!base || /^https?:\/\/example\.com\/?$/i.test(base)) {
    report("SEO", "上线前要换真实网址", "warn");
  }
}

function checkPage(where, html, site, house, vars, js, demoMode, css) {
  const lang = siteLang(site);
  const htmlLang = lang === "en" ? "en" : "zh-CN";
  const ogLocale = lang === "en" ? "en_US" : "zh_CN";
  if (!new RegExp(`<html[^>]*\\blang="${htmlLang}"`, "i").test(html)) {
    report("SEO", `${where} 缺少 lang="${htmlLang}"`);
  }
  if (!html.includes(`property="og:locale" content="${ogLocale}"`)) {
    report("SEO", `${where} 的 og:locale 不是 ${ogLocale}`);
  }
  const viewport = meta(html, "viewport");
  if (!viewport) report("C3", `${where} 缺少 viewport`);
  else {
    if (!/width\s*=\s*device-width/i.test(viewport)) report("C3", `${where} viewport 没有 width=device-width`);
    if (/user-scalable\s*=\s*no/i.test(viewport) || /maximum-scale\s*=\s*1\b/i.test(viewport)) {
      report("C3", `${where} viewport 禁止了缩放`);
    }
  }
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
  if (!title.trim()) report("SEO", `${where} 缺少 title`);
  const description = meta(html, "description");
  if (!description || !description.trim()) report("SEO", `${where} 缺少 description`);
  if (!/property="og:title"/i.test(html) || !/property="og:description"/i.test(html)) {
    report("SEO", `${where} 缺少 Open Graph`);
  }
  const h1 = html.match(/<h1\b/gi) || [];
  if (h1.length !== 1) report("结构", `${where} 的 h1 有 ${h1.length} 个，必须恰好 1 个`);
  if (!/<header\b/i.test(html)) report("结构", `${where} 缺少 header`);
  if (!/<footer\b/i.test(html)) report("结构", `${where} 缺少 footer`);
  if (!/data-float\b/.test(html)) report("结构", `${where} 缺少悬浮联系`);
  if (!/href="tel:/i.test(html)) report("结构", `${where} 缺少 tel: 链接`);
  if (site?.contact?.icp && !html.includes(site.contact.icp)) report("E9", `${where} 页脚没有 ICP 备案号`);
  if (site?.contact?.police && !html.includes(site.contact.police)) report("E9", `${where} 页脚没有公安备案号`);
  if (where === "index.html" && !/application\/ld\+json/.test(html)) report("SEO", "首页缺少 JSON-LD");
  if (where === "index.html" && !/"@type"\s*:\s*"(LocalBusiness|Organization)"/.test(html)) {
    report("SEO", "首页 JSON-LD 不是 LocalBusiness 或 Organization");
  }
  if (where === "index.html" && !html.includes(`"inLanguage":"${htmlLang}"`)) {
    report("SEO", `首页 JSON-LD 的 inLanguage 不是 ${htmlLang}`);
  }

  checkIds(where, html);
  for (const item of collectTexts(html)) scanCopy(where, item.text, item.source, lang);
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const alt = tag.match(/\balt="([^"]*)"/i);
    if (!alt || !decode(alt[1]).trim()) report("ALT", `${where} 的图片 alt 为空`);
  }

  for (const heading of extract(html, "h[1-6]")) {
    if (hasDash(heading)) report("口径", `${where} 标题里有破折号：${clip(heading)}`);
  }
  if (hasDash(title)) report("口径", `${where} 的 title 里有破折号：${clip(title)}`);
  for (const label of buttonTexts(html)) {
    if (hasDash(label)) report("口径", `${where} 按钮里有破折号：${clip(label)}`);
    const folded = foldLabel(label);
    for (const word of E6_WORDS) {
      if (folded.includes(word)) report("E6", `${where} 按钮写了「${word}」：${clip(label)}`);
    }
  }
  checkHeroButton(where, html, house, site);
  checkHeroCtas(where, html);
  if (where === "index.html") checkRepeat(html, site);

  const hero = html.match(/<section\b[^>]*data-section="hero"[^>]*>[\s\S]*?<\/section>/i);
  if (hero) {
    const h1Text = visibleText((hero[0].match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "");
    const issue = heroTitleIssue(h1Text);
    if (issue) report("C14", `${where} 的 hero 标题${issue}：${clip(h1Text)}`);
    checkScriptWords(where, h1Text, vars);
  }

  checkVariety(where, html);
  checkTones(where, html, site);
  checkSatBands(where, html, site);
  checkImageSlots(where, html, css || "");
  if (where === "index.html") checkSlogan(html, site, demoMode);
  checkFullbleed(where, html, site, demoMode);
  checkCarousel(where, html, js);
}

function checkHeroButton(where, html, house, site) {
  const fromSite = typeof site?.buttons?.primary === "string" ? site.buttons.primary.trim() : "";
  const expected = fromSite || house?.buttons?.primary;
  if (!expected) return;
  const hero = html.match(/<section\b[^>]*data-section="hero"[^>]*>[\s\S]*?<\/section>/i);
  if (!hero) return;
  const primary = (hero[0].match(/<a\b[^>]*\bbtn-primary\b[^>]*>[\s\S]*?<\/a>/i) || [])[0];
  if (!primary) return;
  const label = visibleText(primary);
  if (!label) return;
  const override = Array.isArray(site?.hero?.buttons) ? String(site.hero.buttons[0]?.label || "") : "";
  if (override) {
    if (foldLabel(label) !== foldLabel(override) && !isFallbackLabel(label, site)) {
      report("E6", `${where} 的 hero 主按钮「${clip(label)}」和 hero.buttons「${override}」不是同一句`);
    }
    return;
  }
  if (pointsClosed(house?.buttons?.primaryHref || "", closedTargets(house, site))) return;
  if (foldLabel(label) !== foldLabel(expected)) {
    report("E6", `${where} 的 hero 主按钮「${clip(label)}」和户型主按钮「${expected}」不是同一句`);
  }
}

function isFallbackLabel(label, site) {
  const got = foldLabel(label);
  const copy = loadCopy(siteLang(site));
  return got === foldLabel(copy.phoneConsult) || got === foldLabel(copy.contactUs);
}

const REPEAT_UNITS = "平方米|公斤|千克|毫升|厘米|毫米|小时|分钟|万元|亿元|元|年|月|日|人|座|杯|家|个|位|次|吨|亩|斤|克|米|㎡|%|％|折|天|周|项|台|件|箱|瓶|袋|只|款|种|层|间|万|亿";

function checkRepeat(html, site) {
  if (siteLang(site) === "en") {
    checkRepeatEn(html);
    return;
  }
  const sections = html.match(/<section\b[\s\S]*?<\/section>/gi) || [];
  if (!sections.length) return;
  const clauseCount = new Map();
  const unitSections = new Map();
  sections.forEach((section, index) => {
    const text = visibleText(section);
    const clauses = text.split(/[。！？；，,\n.!?;]+/).map((part) => part.replace(/\s+/g, "").trim());
    for (const clause of clauses) {
      if ([...clause].length < 4) continue;
      clauseCount.set(clause, (clauseCount.get(clause) || 0) + 1);
    }
    const seen = new Set();
    const re = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${REPEAT_UNITS})`, "g");
    for (const match of text.matchAll(re)) {
      const token = `${match[1]}${match[2]}`;
      if (seen.has(token)) continue;
      seen.add(token);
      if (!unitSections.has(token)) unitSections.set(token, new Set());
      unitSections.get(token).add(index);
    }
  });
  const phrases = [...clauseCount.entries()].filter(([, count]) => count >= 3).slice(0, 8);
  for (const [clause, count] of phrases) {
    report("重复", `首页短句「${clip(clause)}」出现 ${count} 次`, "warn");
  }
  const units = [...unitSections.entries()].filter(([, set]) => set.size >= 3).slice(0, 8);
  for (const [token, set] of units) {
    report("重复", `首页「${token}」出现在 ${set.size} 个板块`, "warn");
  }
}

const REPEAT_UNITS_EN = "kg|mm|cm|km|sqm|pcs|hours|years|days|tons|sets|units";

function checkRepeatEn(html) {
  const sections = html.match(/<section\b[\s\S]*?<\/section>/gi) || [];
  if (!sections.length) return;
  const clauseCount = new Map();
  const unitSections = new Map();
  sections.forEach((section, index) => {
    const text = visibleText(section);
    const clauses = text.split(/[.!?;]+/);
    for (const part of clauses) {
      const words = part.toLowerCase().match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) || [];
      if (words.length < 4) continue;
      const key = words.join(" ");
      clauseCount.set(key, (clauseCount.get(key) || 0) + 1);
    }
    const seen = new Set();
    const re = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${REPEAT_UNITS_EN}|%)(?![A-Za-z])`, "gi");
    for (const match of text.matchAll(re)) {
      const token = `${match[1]}${match[2].toLowerCase()}`;
      if (seen.has(token)) continue;
      seen.add(token);
      if (!unitSections.has(token)) unitSections.set(token, new Set());
      unitSections.get(token).add(index);
    }
  });
  const phrases = [...clauseCount.entries()].filter(([, count]) => count >= 3).slice(0, 8);
  for (const [clause, count] of phrases) {
    report("重复", `首页短句「${clip(clause)}」出现 ${count} 次`, "warn");
  }
  const units = [...unitSections.entries()].filter(([, set]) => set.size >= 3).slice(0, 8);
  for (const [token, set] of units) {
    report("重复", `首页「${token}」出现在 ${set.size} 个板块`, "warn");
  }
}

function checkVariety(where, html) {
  const main = (html.split(/<main\b[^>]*>/i)[1] || "").split(/<\/main>/i)[0] || "";
  const sections = [...main.matchAll(/<section\b[^>]*>/gi)].map((match) => match[0]);
  if (sections.length < 6) return;
  const families = sections.map((tag) => (tag.match(/\sdata-family="([^"]*)"/) || [])[1] || "");
  if (families.some((family) => !family)) report("C8", `${where} 有板块缺少 data-family`);
  const counts = new Map();
  for (const family of families) {
    if (family) counts.set(family, (counts.get(family) || 0) + 1);
  }
  const dups = [...counts.entries()].filter(([, count]) => count > 1).map(([family]) => family);
  if (dups.length) report("C8", `${where} 有 ${sections.length} 个板块，版式家族 ${dups.join("、")} 用了不止一次`);
  if (counts.size < 4) report("C8", `${where} 有 ${sections.length} 个板块，版式家族只有 ${counts.size} 种`);
}

function checkIds(where, html) {
  const seen = new Set();
  const reported = new Set();
  for (const match of html.matchAll(/\sid="([^"]*)"/gi)) {
    const id = match[1];
    if (!id) continue;
    if (seen.has(id) && !reported.has(id)) {
      report("结构", `${where} 的 id「${id}」重复`);
      reported.add(id);
    }
    seen.add(id);
  }
}

function checkLinks(dir, file, where, html, demoMode) {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  for (const href of [...html.matchAll(/\shref="([^"]*)"/g)].map((match) => decode(match[1]))) {
    if (!href || isExternal(href)) continue;
    const { pathPart, hash } = splitHref(href);
    if (!pathPart) {
      if (hash && !ids.has(hash)) report("链接", `${where} 的锚点 #${hash} 不存在`);
      continue;
    }
    const decoded = decodePath(pathPart);
    const target = path.resolve(path.dirname(file), decoded);
    if (!isInside(dir, target)) {
      report("链接", `${where} 的链接跑出了站点：${href}`);
      continue;
    }
    if (!fs.existsSync(target)) {
      report("链接", `${where} 的链接不存在：${href}`);
      continue;
    }
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      const indexFile = path.join(target, "index.html");
      if (!fs.existsSync(indexFile)) {
        report("链接", `${where} 的链接指向目录而不是页面：${href}`);
        continue;
      }
      if (!hash) continue;
      const targetIds = new Set([...fs.readFileSync(indexFile, "utf8").matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
      if (!targetIds.has(hash)) report("链接", `${where} 的锚点 #${hash} 不存在`);
      continue;
    }
    if (!hash) continue;
    const targetIds = path.resolve(target) === path.resolve(file)
      ? ids
      : new Set([...fs.readFileSync(target, "utf8").matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
    if (!targetIds.has(hash)) report("链接", `${where} 的锚点 #${hash} 不存在`);
  }
  let total = 0;
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const src = decode((tag.match(/\ssrc="([^"]*)"/i) || [])[1] || "");
    if (!src || isExternal(src) || src.startsWith("data:")) continue;
    const { pathPart } = splitHref(src);
    const target = path.resolve(path.dirname(file), decodePath(pathPart));
    if (!fs.existsSync(target)) {
      report("链接", `${where} 的图片不存在：${src}`, demoSoft(demoMode, html) ? "warn" : "block");
      continue;
    }
    const size = fs.statSync(target).size;
    total += size;
    if (size > 400 * 1024) report("图片", `${where} 的 ${src} 超过 400KB`);
  }
  if (total > 1.5 * 1024 * 1024) report("图片", `${where} 的图片合计超过 1.5MB`);
}

function checkResiduals(where, text) {
  if (text.includes("{{")) report("残留", `${where} 还有未替换的 {{`);
  if (/\bundefined\b/.test(text)) report("残留", `${where} 出现 undefined`);
  if (/\bnull\b/.test(text)) report("残留", `${where} 出现 null`);
  if (/lorem/i.test(text)) report("残留", `${where} 出现 Lorem`);
  if (/john doe/i.test(text)) report("残留", `${where} 出现 John Doe`);
  if (/acme/i.test(text)) report("残留", `${where} 出现 Acme`);
}

function checkBuildReport(dir) {
  const file = path.join(dir, "build-report.json");
  if (!fs.existsSync(file)) return;
  try {
    const data = readJson(file);
    for (const note of data.notes || []) report("降级", String(note));
  } catch (err) {
    report("spec", err.message || "build-report.json 不是合法 JSON");
  }
}

function checkTokens(vars, site) {
  const need = ["--bg", "--surface", "--text", "--text-muted", "--border", "--primary", "--primary-contrast", "--accent"];
  const colors = {};
  for (const key of need) {
    const value = (vars[key] || "").trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
      report("A1", `token ${key} 不是 #RRGGBB：${value}`);
      return;
    }
    colors[key.slice(2)] = value;
  }
  for (const [key, value] of Object.entries(colors)) {
    if (value.toLowerCase() === "#000000") report("A8", `${key} 用了纯黑 #000000`);
  }
  if (/#000000\b|#000\b/i.test(vars["--shadow-card"] || "")) report("A8", "阴影里用了纯黑");
  for (const key of ["text", "text-muted"]) {
    const rgb = hexRgb(colors[key]);
    if (rgb.r === rgb.g && rgb.g === rgb.b) report("A8", `${key} 是纯灰，要带一点偏色`);
  }

  const count = paletteCount(colors);
  if (count < 3 || count > 5) report("A1", `调色板算下来是 ${count} 色，要求 3 到 5（中性色算 1 组）`);

  for (const [label, fgKey, bgKey] of CONTRAST_PAIRS) {
    const ratio = contrast(colors[fgKey], colors[bgKey]);
    if (ratio < 4.5) report("A6", `${label} 对比度 ${ratio.toFixed(2)}，低于 4.5`);
  }

  for (const key of ["primary", "accent"]) {
    const value = colors[key].toLowerCase();
    if (BANNED_HEX.includes(value)) report("A10", `${key} ${colors[key]} 是 AI 万能色`);
  }
  if (isForbiddenHue(colors.primary)) report("A10", `primary ${colors.primary} 是紫色，不能当主色或强调色`);
  if (isForbiddenHue(colors.accent) && !purpleAccentOk(site)) {
    report("A10", `accent ${colors.accent} 是紫色，不能当主色或强调色`);
  }
  if (isForbiddenHue(colors.bg)) report("A10", `bg ${colors.bg} 是紫色，不作大面积底`);
  const beige = channelDist(colors.bg, "#F4F1EA") <= 24;
  const clay = channelDist(colors.primary, "#D97757") <= 48 || channelDist(colors.accent, "#D97757") <= 48;
  if (beige && clay) {
    const level = a11Level(site);
    if (level) report("A11", "这是米色底加陶土强调的 AI 暖色配方", level);
  }

  if (!satFull(site)) {
    const bg = hsl(colors.bg);
    if (bg.s > SAT_MAX && bg.l > 0.22) report("A3", "有颜色饱和度超过 80%");
    for (const key of ["primary", "accent"]) {
      if (hsl(colors[key]).s <= SAT_MAX) continue;
      const banned = BANNED_HEX.includes(colors[key].toLowerCase()) || isForbiddenHue(colors[key]);
      if (banned) report("A3", "有颜色饱和度超过 80%");
    }
  }
}

function checkFonts(css, vars, site) {
  const body = firstFamily(vars["--font-body"] || "");
  if (body && cjkFont.test(body)) report("B7", `正文字体栈把中文「${body}」放在了西文前面`);
  const heading = firstFamily(vars["--font-heading"] || "");
  if (heading && isSerifFace(heading) && !serifOk(site)) {
    report("B10", `标题用了衬线「${heading}」，这个行业不放行`);
  }

  const used = new Set();
  forEachMatch(/font-family\s*:\s*([^;{}]+)/gi, css, (match) => {
    const family = firstFamily(resolveVars(match[1], vars));
    if (!family) return;
    const key = family.toLowerCase();
    if (genericFace.has(key)) return;
    used.add(key);
  });
  if (used.size > 2) report("B1", `字体族有 ${used.size} 个：${[...used].join("、")}`);
}

function checkCss(css, vars, site) {
  const grads = css.match(/linear-gradient\((?:[^()]|\([^()]*\))*\)|radial-gradient\((?:[^()]|\([^()]*\))*\)/g) || [];
  const decorative = grads.filter((item) => !isBlackScrim(item));
  if (decorative.length > 2) report("A7", `装饰性渐变有 ${decorative.length} 处，最多 2 处`);
  if (decorative.some((item) => isNeonFill(item))) report("A7", "渐变用了紫蓝青铺满");
  if (/background-clip\s*:\s*text|-webkit-background-clip\s*:\s*text/i.test(css)) report("A7", "渐变或背景被剪进了文字");
  if (!/prefers-reduced-motion/.test(css)) report("D2", "CSS 没有尊重 prefers-reduced-motion");
  checkHeroSize(vars, site);
  checkMotionCss(css);

  forEachMatch(/([a-z-]+)\s*:\s*([^;{}]+)/gi, css, (match) => {
    const prop = match[1].toLowerCase();
    const value = match[2].trim();
    if (prop === "font-size") {
      const px = toPx(value, vars);
      if (px !== null && px < 14) report("B3", `字号 ${value} 小于 14px`);
    }
    if (prop === "transition" || prop === "transition-property") {
      if (/\ball\b/i.test(value)) report("D2", "写了 transition: all");
      if (prop === "transition") {
        for (const part of splitTop(value)) {
          const name = part.trim().split(/\s+/)[0];
          if (name && name !== "transform" && name !== "opacity") report("D2", `过渡属性不是 transform/opacity：${name}`);
        }
      }
    }
  });
}

function checkHeroCtas(where, html) {
  const hero = html.match(/<section\b[^>]*data-section="hero"[^>]*>[\s\S]*?<\/section>/i);
  if (!hero) return;
  const buttons = [];
  for (const el of hero[0].match(/<(?:a|button)\b[^>]*>[\s\S]*?<\/(?:a|button)>/gi) || []) {
    if (/data-carousel-(?:prev|next|dot)/.test(el)) continue;
    if (!/\bclass="[^"]*\bbtn\b/.test(el)) continue;
    buttons.push(el);
  }
  if (buttons.length > 2) report("C9", `${where} 首屏按钮有 ${buttons.length} 个，最多 2 个`);
  const primary = buttons.filter((el) => /\bbtn-primary\b/.test(el)).length;
  if (primary > 1) report("C9", `${where} 首屏主按钮有 ${primary} 个，不是同一意图`);
  if (buttons.length === 2 && primary !== 1) report("C9", `${where} 首屏两个按钮不是同一意图`);
}

function checkScriptWords(where, text, vars) {
  if ((vars?.["--display"] || "") !== "script") return;
  const px = toPx(vars["--fs-hero"] || "", vars);
  if (px == null || px <= HERO_PX.max) return;
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length > LIMITS.scriptWords) {
    report("B6", `${where} 的手写展示标题有 ${words.length} 个词，最多 ${LIMITS.scriptWords} 个`);
  }
}

function checkTones(where, html, site) {
  if (where !== "index.html" || !site?.showroom) return;
  const main = (html.split(/<main\b[^>]*>/i)[1] || "").split(/<\/main>/i)[0] || "";
  const tags = [...main.matchAll(/<section\b[^>]*>/gi)].map((match) => match[0]);
  const tones = tags.map((tag) => (tag.match(/\bdata-tone="([^"]*)"/) || [])[1] || "");
  let switches = 0;
  for (let i = 1; i < tones.length; i += 1) {
    if (tones[i] && tones[i - 1] && tones[i] !== tones[i - 1]) switches += 1;
  }
  if (switches < 3) report("A9", `首页深浅切换 ${switches} 次，至少 3 次`);
}

function checkSatBands(where, html, site) {
  if (satFull(site)) return;
  const bands = (html.match(/data-band="sat"/g) || []).length;
  if (bands > HIGH_SAT_BANDS) report("A3", `${where} 高饱和整宽色块 ${bands} 个，最多 ${HIGH_SAT_BANDS}`);
}

function checkImageSlots(where, html, css) {
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const w = (tag.match(/\bwidth="([^"]*)"/i) || [])[1];
    const h = (tag.match(/\bheight="([^"]*)"/i) || [])[1];
    const style = (tag.match(/\bstyle="([^"]*)"/i) || [])[1] || "";
    const ok = (Number(w) > 0 && Number(h) > 0) || /aspect-ratio\s*:/.test(style);
    if (!ok) report("图片位", `${where} 的图片缺少 width/height 或 aspect-ratio`);
  }
  const rules = cssFrameRules(css);
  const re = /data-media-group="([^"]*)"/g;
  for (const match of html.matchAll(re)) {
    const id = match[1];
    const start = html.lastIndexOf("<", match.index);
    const end = html.indexOf(">", match.index);
    if (start < 0 || end < 0) continue;
    const open = html.slice(start, end + 1);
    const classAttr = (open.match(/\bclass="([^"]*)"/i) || [])[1] || "";
    const classes = classAttr.split(/\s+/).filter(Boolean);
    const chunk = html.slice(end + 1).split(/data-media-group=|<\/section>/i)[0];
    if (frameLocked(id, classes, rules)) continue;
    const ratios = [];
    for (const tag of chunk.match(/<img\b[^>]*>/gi) || []) {
      const w = Number((tag.match(/\bwidth="([^"]*)"/i) || [])[1]);
      const h = Number((tag.match(/\bheight="([^"]*)"/i) || [])[1]);
      if (w > 0 && h > 0) ratios.push(w / h);
    }
    if (ratios.length < 2) continue;
    const base = ratios[0];
    if (ratios.some((ratio) => Math.abs(ratio - base) / base > 0.04)) {
      report("图片位", `${where} 的图片组 ${id} 比例不一致`);
    }
  }
}

function cssFrameRules(css) {
  const masked = String(css || "").replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
  const rules = [];
  for (const match of masked.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const selector = match[1].replace(/\s+/g, " ").trim();
    if (!selector) continue;
    const body = match[2];
    const ratio = body.match(/(?:^|[;\s])aspect-ratio\s*:\s*([^;]+)/i);
    const fit = body.match(/(?:^|[;\s])object-fit\s*:\s*([^;]+)/i);
    rules.push({
      selector,
      ratio: ratio ? parseAspect(ratio[1]) : null,
      fit: fit ? fit[1].trim().toLowerCase() : "",
    });
  }
  return rules;
}

function parseAspect(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || /^(auto|inherit|initial|unset|revert|revert-layer)$/.test(text)) return null;
  const slash = text.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (slash) {
    const height = Number(slash[2]);
    if (height <= 0) return null;
    return Number(slash[1]) / height;
  }
  const numeric = Number(text);
  return numeric > 0 ? numeric : null;
}

function frameLocked(id, classes, rules) {
  const matched = rules.filter((rule) => selectorHits(rule.selector, id, classes));
  return matched.some((rule) => rule.ratio != null && /^cover\b/.test(rule.fit));
}

function selectorHits(selector, id, classes) {
  return splitSelector(selector).some((part) => {
    if (part.includes(`[data-media-group="${id}"]`) || part.includes(`[data-media-group='${id}']`)) return true;
    return classes.some((name) => new RegExp(`\\.${escapeReg(name)}(?![\\w-])`).test(part));
  });
}

function splitSelector(selector) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of selector) {
    if (ch === "(") depth += 1;
    else if (ch === ")" && depth) depth -= 1;
    if (ch === "," && depth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function checkSlogan(html, site, demoMode) {
  if (demoMode || !site?.showroom || !/^[a-z0-9_-]+$/.test(site.showroom)) return;
  const example = readExampleSite(site.showroom);
  if (!example) return;
  const exampleName = String(example.name || "").replace(/（虚构）|\(虚构\)/g, "").trim();
  const siteName = String(site.name || "").replace(/（虚构）|\(虚构\)/g, "").trim();
  if (exampleName && siteName && exampleName === siteName) return;
  const sampleRaw = exampleHeroTitle(example);
  const hero = html.match(/<section\b[^>]*data-section="hero"[^>]*>[\s\S]*?<\/section>/i);
  const h1 = (hero?.[0].match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "";
  const actualRaw = visibleText(h1);
  if (sloganClose(actualRaw, sampleRaw, siteLang(site))) {
    report("口号", "首屏口号不要套示例句式，按企业档案重写", "warn");
  }
}

function sloganClose(actualRaw, sampleRaw, lang) {
  if (lang === "en") return sloganCloseWords(actualRaw, sampleRaw);
  const actual = normSlogan(actualRaw);
  const sample = normSlogan(sampleRaw);
  if (!actual || !sample) return false;
  if (commonRun(actual, sample) >= 4 || editRatio(actual, sample) <= 0.5) return true;
  const left = sloganClauses(actualRaw);
  const right = sloganClauses(sampleRaw);
  for (const a of left) {
    for (const b of right) {
      if (commonRun(a, b) >= 4 || editRatio(a, b) <= 0.5) return true;
    }
  }
  return false;
}

function sloganWords(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) || [];
}

function sloganCloseWords(actualRaw, sampleRaw) {
  const actual = sloganWords(actualRaw);
  const sample = sloganWords(sampleRaw);
  if (!actual.length || !sample.length) return false;
  if (commonRun(actual, sample) >= 4 || editRatio(actual, sample) <= 0.5) return true;
  const left = String(actualRaw || "").split(/[.!?;]+/).map((part) => sloganWords(part)).filter((words) => words.length >= 4);
  const right = String(sampleRaw || "").split(/[.!?;]+/).map((part) => sloganWords(part)).filter((words) => words.length >= 4);
  for (const a of left) {
    for (const b of right) {
      if (commonRun(a, b) >= 4 || editRatio(a, b) <= 0.5) return true;
    }
  }
  return false;
}

function sloganClauses(text) {
  return String(text || "")
    .split(/[\s，。！？、,.!?;；:："“”'‘’（）()【】\[\]《》·—\-]+/)
    .map((part) => normSlogan(part))
    .filter((part) => Array.from(part).length >= 4);
}

function readExampleSite(id) {
  const file = path.join(root, "showrooms", id, "examples", "site.json");
  if (!fs.existsSync(file)) return null;
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

function exampleHeroTitle(doc) {
  const pages = doc.pages || [];
  const home = pages.find((page) => page.id === "home" || page.file === "index.html") || pages[0];
  const hero = (home?.sections || []).find((section) => section.type === "hero");
  return String(hero?.data?.title || "");
}

function normSlogan(text) {
  return Array.from(String(text || "").replace(/[\s，。！？、,.!?;；:："“”'‘’（）()【】\[\]《》·—\-]/g, "")).join("");
}

function commonRun(a, b) {
  const left = Array.from(a);
  const right = Array.from(b);
  let best = 0;
  const prev = new Uint16Array(right.length + 1);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = 0;
    for (let j = 1; j <= right.length; j += 1) {
      const next = left[i - 1] === right[j - 1] ? diagonal + 1 : 0;
      diagonal = prev[j];
      prev[j] = next;
      if (next > best) best = next;
    }
  }
  return best;
}

function editRatio(a, b) {
  const left = Array.from(a);
  const right = Array.from(b);
  const denom = Math.max(left.length, right.length);
  if (!denom) return 1;
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const saved = row[j];
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = saved;
    }
  }
  return row[right.length] / denom;
}

function checkFullbleed(where, html, site, demoMode) {
  if (where !== "index.html" || !site?.showroom) return;
  const imgs = (html.match(/<img\b/gi) || []).length;
  let full = 0;
  for (const section of html.match(/<section\b[\s\S]*?<\/section>/gi) || []) {
    const open = section.match(/^<section\b[^>]*>/i)?.[0] || "";
    if (!/\bdata-fullbleed\b/.test(open)) continue;
    full += (section.match(/<img\b/gi) || []).length;
  }
  if (readSparse(currentDir)) return;
  const level = demoSoft(demoMode, html) ? "warn" : levelOf("E4");
  if (imgs < 12) report("E4", `首页图片 ${imgs} 张，少于 12`, level);
  if (full < 2) report("E4", `首页满宽图 ${full} 张，少于 2`, level);
}

function checkCarousel(where, html, js) {
  if (!/\bdata-carousel\b/.test(html)) return;
  const interval = Number((html.match(/\bdata-interval="(\d+)"/) || [])[1] || 0);
  if (interval < 3000 || interval > 5000) report("D6", `${where} 轮播间隔 ${interval}ms，要在 3000 到 5000`);
  const slides = (html.match(/\bdata-slide\b/g) || []).length;
  if (slides < 3 || slides > 9) report("D6", `${where} 轮播 ${slides} 张，要 3 到 9 张`);
  if (!/data-carousel-prev/.test(html) || !/data-carousel-next/.test(html)) report("D6", `${where} 轮播没有箭头`);
  if (!/data-carousel-dot/.test(html)) report("D6", `${where} 轮播没有指示点`);
  if (!/mouseenter/.test(js || "")) report("D6", "轮播没有悬停暂停");
  if (!/prefers-reduced-motion/.test(js || "")) report("D6", "轮播没有尊重减少动效");
  if (!/data-carousel-prev/.test(js || "") || !/data-carousel-dot/.test(js || "")) {
    report("D6", "轮播脚本缺少箭头或指示点");
  }
}

function checkHeroSize(vars, site) {
  const script = (vars["--display"] || "") === "script";
  const max = script ? HERO_PX.script : HERO_PX.max;
  const basis = vars["--fs-hero"] ? toPx(vars["--fs-hero"], vars) : toPx(vars["--fs-6"] || "", vars);
  if (basis != null && basis > max) report("B6", `首屏标题 ${basis}px，超过 ${max}px`);
  if (site?.showroom && vars["--fs-hero"]) {
    const px = toPx(vars["--fs-hero"], vars);
    if (px != null && px < HERO_PX.min) report("B6", `样板间首屏标题 ${px}px，小于 ${HERO_PX.min}px`);
  }
}

function checkMotionCss(css) {
  const names = new Set();
  let infinite = 0;
  forEachMatch(/(?:^|[^\w-])animation-name\s*:\s*([^;{}]+)/gi, css, (match) => {
    for (const name of animTokens(match[1])) names.add(name);
  });
  forEachMatch(/(?:^|[^\w-])animation\s*:\s*([^;{}]+)/gi, css, (match) => {
    if (/\binfinite\b/i.test(match[1])) infinite += 1;
    for (const name of animTokens(match[1])) names.add(name);
  });
  forEachMatch(/animation-iteration-count\s*:\s*([^;{}]+)/gi, css, (match) => {
    if (/\binfinite\b/i.test(match[1])) infinite += 1;
  });
  if (names.size > 2) report("D3", `入场动画有 ${names.size} 种：${[...names].join("、")}，最多 2 种`);
  if (infinite > 1) report("D3", `全页循环微动效有 ${infinite} 条，最多 1 条`);
}

function animTokens(value) {
  const skip = new Set([
    "none", "inherit", "initial", "unset", "infinite", "paused", "running",
    "ease", "ease-in", "ease-out", "ease-in-out", "linear", "step-start", "step-end",
    "normal", "reverse", "alternate", "alternate-reverse", "forwards", "backwards", "both",
  ]);
  const names = [];
  for (const part of splitTop(value)) {
    for (const token of part.trim().split(/\s+/)) {
      if (!token) continue;
      if (token.startsWith("var(") || token.startsWith("cubic-bezier") || token.startsWith("steps")) continue;
      if (/^[\d.]+m?s$/i.test(token) || /^\d+(?:\.\d+)?$/.test(token)) continue;
      if (skip.has(token.toLowerCase())) continue;
      names.push(token);
    }
  }
  return names;
}

function isBlackScrim(grad) {
  const colors = grad.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi) || [];
  if (colors.length === 0) return false;
  return colors.every((color) => {
    const rgb = cssRgb(color);
    return rgb && rgb.r <= 16 && rgb.g <= 16 && rgb.b <= 16;
  });
}

function isNeonFill(grad) {
  const colors = grad.match(/#[0-9a-f]{3,8}\b/gi) || [];
  return colors.some((color) => {
    const hex = color.length === 4
      ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
      : color.slice(0, 7);
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return false;
    const { h, s } = hsl(hex);
    if (s < 0.45) return false;
    return (h >= 170 && h <= 320);
  });
}

function cssRgb(color) {
  const text = String(color).trim();
  const hex = text.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((ch) => ch + ch).join("");
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  const rgb = text.match(/rgba?\(\s*(\d+)(?:\s*,\s*|\s+)(\d+)(?:\s*,\s*|\s+)(\d+)/i);
  if (!rgb) return null;
  return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
}

function isSerifFace(family) {
  const name = String(family || "").toLowerCase();
  if (!name || genericFace.has(name)) return false;
  if (/\bsans\b/.test(name)) return false;
  return /serif|songti|simsun|playfair|fraunces|cormorant|garamond|times|georgia|宋体|stsong|source han serif/.test(name);
}

function readDemoFlag(dir) {
  const file = path.join(dir, "build-report.json");
  if (!fs.existsSync(file)) return false;
  try {
    return readJson(file).demo === true;
  } catch {
    return false;
  }
}

function checkMotionJs(js) {
  if (/addEventListener\(\s*["']scroll["']/.test(js) || /\bonscroll\b/.test(js) || /window\.scroll/.test(js)) {
    report("D5", "脚本监听了 window scroll");
  }
}

function checkSiteJson(site) {
  const specs = loadSpecs(site);
  const house = loadHouse(site);
  const lang = siteLang(site);
  for (const page of site.pages || []) {
    if (page.enabled === false) continue;
    for (const section of page.sections || []) {
      const spec = specs.get(section.type);
      if (!spec) {
        report("spec", `没有板块规格 ${section.type}`);
        continue;
      }
      checkFields(section.data || {}, spec.fields, `${page.id}.${section.type}`, section.type, lang);
    }
  }
  const productSpec = specs.get("product-detail");
  for (const product of site.products || []) {
    checkFields(product, productSpec?.fields || {}, `product.${product.slug || "?"}`, "product-detail", lang);
  }
  const detailSpec = specs.get("collection-detail") || productSpec;
  for (const [id, items] of Object.entries(site.collections || {})) {
    if (!Array.isArray(items)) {
      report("spec", `collections.${id} 必须是列表`);
      continue;
    }
    const parent = house ? parentOfCollection(house, id) : null;
    if (parent && !isOn(house, site, parent)) continue;
    for (const item of items) {
      checkFields(item, detailSpec?.fields || {}, `${id}.${item.slug || "?"}`, "collection-detail", lang);
    }
  }
}

function checkLengths(site) {
  const lang = siteLang(site);
  if (typeof site.name === "string") {
    const issue = lengthIssue(site.name, LIMITS.name, lang);
    if (issue) report("篇幅", `店名${issue}`);
  }
  const address = site.contact?.address;
  if (typeof address === "string") {
    const issue = lengthIssue(address, LIMITS.address, lang);
    if (issue) report("篇幅", `地址${issue}`);
  }
  for (const page of site.pages || []) {
    if (typeof page.title === "string") {
      const issue = lengthIssue(page.title, LIMITS.title, lang);
      if (issue) report("篇幅", `页面 ${page.id || "?"} 的 title ${issue}`);
    }
    if (typeof page.description === "string") {
      const issue = lengthIssue(page.description, LIMITS.description, lang);
      if (issue) report("篇幅", `页面 ${page.id || "?"} 的 description ${issue}`);
    }
  }
}

function lengthIssue(text, maxChars, lang) {
  const n = countChars(text);
  const limit = textLimit(maxChars, lang);
  if (n <= limit) return "";
  if (lang === "en") return `有 ${n} 个字符，上限 ${limit}（中文上限 ${maxChars} × 2.2）`;
  return `有 ${n} 字，上限 ${maxChars}`;
}

function checkFields(data, fields, label, type, lang) {
  for (const [key, def] of Object.entries(fields || {})) {
    if (def.filledBy === "build") continue;
    const value = data?.[key];
    if (def.type === "list") {
      if (!Array.isArray(value)) {
        if (def.required) report("spec", `${label} 缺少列表 ${key}`);
        continue;
      }
      if (def.min && value.length < def.min) report("spec", `${label}.${key} 至少 ${def.min} 项`);
      if (def.max && value.length > def.max) report("spec", `${label}.${key} 最多 ${def.max} 项`);
      value.forEach((item, index) => checkFields(item, def.item, `${label}.${key}[${index}]`, type, lang));
    } else if (typeof value === "string") {
      if (def.required && value.trim() === "") report("spec", `${label} 的 ${key} 是空的`);
      if (type === "hero" && key === "title") {
        const issue = heroTitleIssue(value);
        if (issue) report("C14", `${label}.${key} ${issue}`);
      } else if (def.maxChars) {
        const issue = lengthIssue(value, def.maxChars, lang);
        if (issue) report("spec", `${label}.${key} ${issue}`);
      }
    } else if (def.required) report("spec", `${label} 缺少 ${key}`);
  }
}

function lintFramework() {
  const dir = path.join(root, "framework");
  const files = walk(dir).filter((file) => file.endsWith(".css"));
  let hits = 0;
  const namedRe = new RegExp(`(?<![A-Za-z0-9-])(?:${NAMED_COLORS.join("|")})(?![A-Za-z0-9-])`, "gi");
  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    const masked = raw.replace(/\/\*[\s\S]*?\*\//g, (blockText) => blockText.replace(/[^\n]/g, " "));
    const relFile = path.relative(root, file);
    const patterns = [
      [/#[0-9A-Fa-f]{3,8}\b/g, "写死的颜色"],
      [/\brgba?\s*\(/gi, "写死的颜色"],
      [/\bhsla?\s*\(/gi, "写死的颜色"],
      [namedRe, "写死的命名色"],
      [/transition\s*:\s*all\b/gi, "transition: all"],
      [/background-clip\s*:\s*text/gi, "background-clip: text"],
      [/-webkit-background-clip\s*:\s*text/gi, "background-clip: text"],
    ];
    for (const [re, message] of patterns) {
      forEachMatch(re, masked, (match) => {
        hits += 1;
        report("F3", `${relFile}:${lineOf(raw, match.index)} ${message}`);
      });
    }
    forEachMatch(/(border-radius|box-shadow)\s*:\s*([^;{}]+)/gi, masked, (match) => {
      const tokens = match[2].trim().split(/\s+/).filter((token) => token !== "!important");
      const ok = tokens.every((token) => /^var\(--[a-z0-9-]+\)$/i.test(token));
      if (!ok) {
        hits += 1;
        report("F3", `${relFile}:${lineOf(raw, match.index)} 写死的${match[1] === "border-radius" ? "圆角" : "阴影"}`);
      }
    });
  }
  if (hits === 0) console.log("框架 CSS 检查：零命中");
}

function scanCopy(where, text, source, lang) {
  if (!text) return;
  for (const entry of phrasesFor(lang)) {
    if (!hitPhrase(text, entry)) continue;
    const message = source === "可见文字"
      ? `${where} 出现空话「${entry.word}」`
      : `${where} 的 ${source} 出现空话「${entry.word}」`;
    report("E5", message, phraseLevel("E5", entry.level));
  }
  if (hasEmoji(text)) {
    const message = source === "可见文字"
      ? `${where} 用了 emoji 或彩色符号当图标`
      : `${where} 的 ${source} 用了 emoji 或彩色符号当图标`;
    report("E2", message);
  }
  if (/[★☆]/.test(text)) {
    const place = source === "可见文字" ? where : `${where} 的 ${source}`;
    report("E2", `${place} 用了星标`);
  }
  for (const item of PLACEHOLDERS) {
    const re = new RegExp(item.pattern, item.flags || "");
    if (!re.test(text)) continue;
    const place = source === "可见文字" ? where : `${where} 的 ${source}`;
    report("残留", `${place} 出现${item.label}`);
  }
}

function collectTexts(html) {
  const list = [{ source: "可见文字", text: visibleText(html) }];
  for (const tag of html.match(/<[^>]+>/g) || []) {
    for (const attr of ["alt", "title", "aria-label", "placeholder"]) {
      const found = tag.match(new RegExp(`\\s${attr}\\s*=\\s*"([^"]*)"`, "i"));
      if (found && found[1].trim()) list.push({ source: attr.toLowerCase(), text: decode(found[1]) });
    }
    if (!/^<meta\b/i.test(tag)) continue;
    const name = (tag.match(/\s(?:name|property)\s*=\s*"([^"]*)"/i) || [])[1] || "";
    if (!/^(description|og:description|twitter:description)$/i.test(name)) continue;
    const content = (tag.match(/\scontent\s*=\s*"([^"]*)"/i) || [])[1] || "";
    if (content.trim()) list.push({ source: name.toLowerCase(), text: decode(content) });
  }
  return list;
}

function loadHouse(site) {
  if (site?.showroom && /^[a-z0-9_-]+$/.test(site.showroom)) {
    const showroomFile = path.join(root, "showrooms", site.showroom, "showroom.json");
    if (fs.existsSync(showroomFile)) {
      try {
        return readJson(showroomFile);
      } catch {
        return null;
      }
    }
  }
  const name = site?.industry;
  if (!name || !/^[a-z0-9-]+$/.test(name)) return null;
  const file = path.join(root, "industries", name, "house.json");
  if (!fs.existsSync(file)) return null;
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

function loadSpecs(site) {
  const map = new Map();
  readSpecDir(path.join(root, "framework", "sections"), map);
  if (site?.showroom && /^[a-z0-9_-]+$/.test(site.showroom)) {
    readSpecDir(path.join(root, "showrooms", site.showroom, "sections"), map);
  }
  return map;
}

function readSpecDir(dir, map) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const specPath = path.join(dir, name, "spec.json");
    if (!fs.existsSync(specPath)) continue;
    try {
      map.set(name, readJson(specPath));
    } catch (err) {
      report("spec", err.message || `${specPath} 不是合法 JSON`);
    }
  }
}

function paletteCount(colors) {
  const neutralKeys = ["bg", "surface", "text", "text-muted", "border", "primary-contrast"];
  let low = true;
  const extra = [];
  for (const key of neutralKeys) {
    const { h, s } = hsl(colors[key]);
    if (s >= 0.15) {
      low = false;
      if (!extra.some((item) => hueDist(item, h) <= 20)) extra.push(h);
    }
  }
  let count = low ? 1 : extra.length;
  const primary = hsl(colors.primary);
  const accent = hsl(colors.accent);
  if (primary.s >= 0.15) count += 1;
  if (accent.s >= 0.15 && hueDist(accent.h, primary.h) > 20) count += 1;
  return count;
}

function isForbiddenHue(hex) {
  const { h, s } = hsl(hex);
  return s >= PURPLE_HUE.sat && h >= PURPLE_HUE.min && h <= PURPLE_HUE.max;
}

function contrast(a, b) {
  const l1 = relLum(a);
  const l2 = relLum(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function relLum(hex) {
  const { r, g, b } = hexRgb(hex);
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function hsl(hex) {
  let { r, g, b } = hexRgb(hex);
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function channelDist(a, b) {
  const A = hexRgb(a);
  const B = hexRgb(b);
  return Math.abs(A.r - B.r) + Math.abs(A.g - B.g) + Math.abs(A.b - B.b);
}

function hueDist(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

function firstFamily(stack) {
  return String(stack || "").split(",")[0].trim().replace(/^['"]+|['"]+$/g, "").trim();
}

function resolveVars(value, vars, depth = 0) {
  if (!value || depth > 6) return value || "";
  return value.replace(/var\(\s*(--[a-z0-9-]+)\s*\)/gi, (_, name) => resolveVars(vars[name] || "", vars, depth + 1));
}

function toPx(value, vars, depth = 0) {
  if (!value || depth > 6) return null;
  const text = value.trim().replace(/!important/g, "").trim();
  if (text.startsWith("var(")) {
    const name = text.slice(4, text.indexOf(")"));
    return toPx(vars[name], vars, depth + 1);
  }
  const px = text.match(/^([0-9.]+)px$/);
  if (px) return Number(px[1]);
  const rem = text.match(/^([0-9.]+)(rem|em)$/);
  if (rem) return Number(rem[1]) * 16;
  const clamp = text.match(/^clamp\(\s*([^,]+),/);
  if (clamp) return toPx(clamp[1], vars, depth + 1);
  return null;
}

function parseRoot(css) {
  const body = (css.match(/:root\s*\{([\s\S]*?)\}/) || [])[1] || "";
  const vars = {};
  for (const part of body.split(";")) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key.startsWith("--")) vars[key] = part.slice(idx + 1).trim();
  }
  return vars;
}

function meta(html, name) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const tagName = (tag.match(/\bname="([^"]*)"/i) || [])[1];
    if (tagName && tagName.toLowerCase() === name) return (tag.match(/\bcontent="([^"]*)"/i) || [])[1] || "";
  }
  return "";
}

function buttonTexts(html) {
  const out = [];
  for (const tag of ["button", "a"]) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    for (const el of html.match(re) || []) {
      if (tag === "a" && !/\bclass="[^"]*\bbtn\b/.test(el)) continue;
      out.push(visibleText(el));
    }
  }
  return out;
}

function extract(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  return [...html.matchAll(re)].map((match) => visibleText(match[1]));
}

function visibleText(html) {
  return decode(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")).trim();
}

function decode(text) {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function foldLabel(text) {
  const map = { "點": "点", "擊": "击", "這": "这", "裡": "里", "裏": "里", "詳": "详", "見": "见", "後": "后", "開": "开", "關": "关" };
  const folded = Array.from(String(text).normalize("NFKC"), (ch) => map[ch] || ch).join("").toLowerCase();
  return folded.replace(/[\p{P}\p{S}\p{Z}\s]/gu, "");
}

function hasEmoji(text) {
  const allow = /[©®™✔✓℃×±№≤≥Φφ㎡°]/u;
  const re = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F/gu;
  for (const match of String(text).matchAll(re)) {
    const base = match[0].replace(/\uFE0F/g, "");
    if ([...base].every((ch) => allow.test(ch))) continue;
    return true;
  }
  return false;
}

function hitPhrase(text, entry) {
  if (entry.boundary === "en") {
    const re = new RegExp(`(?:^|[^A-Za-z0-9])${escapeReg(entry.word)}(?:$|[^A-Za-z0-9])`, "i");
    return re.test(text);
  }
  return text.toLowerCase().includes(entry.word.toLowerCase());
}

function escapeReg(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasDash(text) {
  return /[\u2014\u2015\u2E3A]/.test(text);
}

function countChars(text) {
  return Array.from(String(text).replace(/\s+/g, "")).length;
}

function isExternal(href) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith("//");
}

function splitHref(href) {
  let pathPart = String(href);
  let hash = "";
  const hashAt = pathPart.indexOf("#");
  if (hashAt >= 0) {
    hash = pathPart.slice(hashAt + 1);
    pathPart = pathPart.slice(0, hashAt);
  }
  const queryAt = pathPart.indexOf("?");
  if (queryAt >= 0) pathPart = pathPart.slice(0, queryAt);
  return { pathPart, hash };
}

function decodePath(href) {
  return href.split("/").map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  }).join("/");
}

function isInside(rootDir, target) {
  const base = path.resolve(rootDir);
  const resolved = path.resolve(target);
  if (resolved === base) return true;
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  return resolved.startsWith(prefix);
}

function splitTop(value) {
  const parts = [];
  let current = "";
  let depth = 0;
  for (const ch of value) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function forEachMatch(re, text, fn) {
  if (!re.global) {
    report("F3", "lint 自身异常：正则缺少 g 标志");
    return;
  }
  re.lastIndex = 0;
  let guard = 0;
  let prev = -1;
  let match;
  while ((match = re.exec(text))) {
    guard += 1;
    if (guard > 10000 || match.index === prev) {
      report("F3", "lint 自身异常：命中超过 10000 或正则没有前进");
      break;
    }
    prev = match.index;
    if (match[0] === "") re.lastIndex += 1;
    fn(match);
  }
}

const ROOM_STOP = new Set(`
home about news products product contact catalog list index top page main nav hero item grid row card all banner
services cases team why trust faq honors photo stories story store stores places courses course menu shop blog
search map form tool tools note notes feed board image images assets site slot slots true false null none auto
left right center cover contain phone email name title text lead summary label href slug key value hours address
wechat icp police intro band page-banner detail
`.split(/\s+/).filter(Boolean));

function lintShowrooms() {
  // FITOUT_SHOWROOMS_DIR：回归测试拿一份带坏规则的样板间副本来验证这条 lint 真的会失败。平时不设。
  const dir = process.env.FITOUT_SHOWROOMS_DIR ? path.resolve(process.env.FITOUT_SHOWROOMS_DIR) : path.join(root, "showrooms");
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (!/^(cn|intl)-/.test(name)) continue;
    const example = path.join(dir, name, "examples", "site.json");
    const sections = path.join(dir, name, "sections");
    if (!fs.existsSync(example) || !fs.existsSync(sections)) continue;
    let doc;
    try {
      doc = readJson(example);
    } catch (err) {
      report("样板间", `${name} 的示例站读不了：${err.message || "JSON"}`);
      continue;
    }
    const tokens = exampleTokens(doc);
    const files = walk(sections).filter((file) => /\.(html|css|js)$/i.test(file));
    lintContainerWidth(name, files);
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      for (const token of tokens) {
        const at = findToken(text, token);
        if (at < 0) continue;
        const relFile = path.relative(root, file).replaceAll("\\", "/");
        report("样板间", `${relFile}:${lineOf(text, at)} 写死了示例值「${clip(token)}」`);
      }
    }
  }
}

/**
 * 限宽别挂在 .container 元素上：.container 自带 margin-inline: auto，给它加 max-width 会被推到中间，
 * 文案左缘和页头 logo、别的板块对不上（首屏 .container hero-copy 反复踩过）。限宽写在里面的子元素上。
 * 做法：从样板间的 html 里收「和 container 写在同一个 class 里的别的类名」，
 * 再扫 css 里最后一级选择器是 .container 或这些类、又写了 max-width（不是 none）的规则。
 * 同一条规则里把 margin / margin-inline 设成 0 的算已处理（不再自动居中）。
 */
function lintContainerWidth(name, files) {
  const containerClasses = new Set(["container"]);
  for (const file of files.filter((item) => item.endsWith(".html"))) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/class="([^"]*)"/g)) {
      const list = match[1].split(/\s+/).filter(Boolean);
      if (!list.includes("container")) continue;
      for (const item of list) if (!item.includes("{")) containerClasses.add(item);
    }
  }
  for (const file of files.filter((item) => item.endsWith(".css"))) {
    const raw = fs.readFileSync(file, "utf8");
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
    const relFile = path.relative(root, file).replaceAll("\\", "/");
    for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = match[2];
      if (!/max-width\s*:\s*(?=[^;}\s])(?!none)/.test(body)) continue;
      if (/margin(-inline)?\s*:\s*0\b/.test(body)) continue;
      for (const part of match[1].split(",")) {
        const last = part.trim().split(/\s+/).pop() || "";
        const hit = [...last.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((item) => item[1]).find((item) => containerClasses.has(item));
        if (!hit) continue;
        report("样板间", `${relFile}:${lineOf(raw, match.index + match[0].indexOf("{"))} 限宽挂在 .${hit} 上（.container 自带 margin-inline: auto，会被推到中间）：${part.trim()}，把 max-width 写在里面的子元素上`);
        break;
      }
    }
  }
}

function exampleTokens(doc) {
  const tokens = new Set();
  const add = (value) => {
    const text = String(value || "").trim();
    if ([...text].length < 3) return;
    if (ROOM_STOP.has(text.toLowerCase())) return;
    tokens.add(text);
  };
  const addContact = (value) => {
    const text = String(value || "").trim();
    add(text);
    const digits = text.replace(/\D/g, "");
    if (digits.length >= 6) add(digits);
  };
  const walkNode = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walkNode);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (typeof node.slug === "string") add(node.slug);
    if (typeof node.slug === "string" && typeof node.name === "string") add(node.name);
    if (typeof node.id === "string") add(node.id);
    if (typeof node.key === "string") add(node.key);
    if (typeof node.href === "string" && node.href.includes("#")) add(node.href.split("#")[1].split(/[/?&]/)[0]);
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") walkNode(value);
    }
  };
  walkNode(doc);
  if (doc.collections && typeof doc.collections === "object" && !Array.isArray(doc.collections)) {
    for (const id of Object.keys(doc.collections)) add(id);
  }
  if (typeof doc.name === "string") add(String(doc.name).replace(/（虚构）|\(虚构\)/g, ""));
  const contact = doc.contact || {};
  for (const key of ["phone", "wechat", "email", "icp", "police"]) addContact(contact[key]);
  return [...tokens];
}

function findToken(text, token) {
  if (/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(token)) {
    const re = new RegExp(`(?:^|[^A-Za-z0-9])${escapeReg(token)}(?=$|[^A-Za-z0-9])`, "gi");
    for (const match of text.matchAll(re)) {
      const start = match.index + (match[0].toLowerCase().startsWith(token.toLowerCase()) ? 0 : 1);
      if (start > 0 && text[start - 1] === "-") continue;
      const after = text.slice(start + token.length, start + token.length + 2);
      if (after[0] === "-" && /[A-Za-z]/.test(after[1] || "")) continue;
      const before = text.slice(Math.max(0, start - 24), start);
      if (/data-(?:family|section|tone)=["']$/.test(before)) continue;
      return start;
    }
    return -1;
  }
  return text.indexOf(token);
}

function toolRoot(site) {
  if (!site?.toolEntry || typeof site.toolEntry !== "object" || Array.isArray(site.toolEntry)) return "";
  let href = String(site.toolEntry.href || "tool/").trim().replace(/\\/g, "/");
  href = href.replace(/^\.\//, "").replace(/^\/+/, "");
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return "";
  if (href.endsWith("/index.html")) href = href.slice(0, -"/index.html".length);
  return href.replace(/\/+$/, "");
}

function isToolHtml(where, toolRel) {
  if (!toolRel) return false;
  const norm = String(where || "").replaceAll("\\", "/");
  if (toolRel.endsWith(".html")) return norm === toolRel;
  return norm === `${toolRel}/index.html` || norm.startsWith(`${toolRel}/`);
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function rel(file) {
  return path.relative(root, file);
}

function clip(text) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean;
}

function report(rule, message, level) {
  const lv = level || levelOf(rule);
  const key = `${lv}\0${rule}\0${message}`;
  if (seenReports.has(key)) return;
  seenReports.add(key);
  const item = { rule, message };
  if (lv === "warn") warnings.push(item);
  else blocks.push(item);
}

function printReport() {
  let target = "框架";
  if (dirs.length) target = dirs.map(rel).join("、");
  else if (lint && lintRooms) target = "框架、样板间";
  else if (lintRooms) target = "样板间";
  console.log(`精装机检：${target}`);
  console.log(`结论：${blocks.length ? "不通过" : "通过"}`);
  console.log(`失败：${blocks.length}`);
  console.log(`警告：${warnings.length}`);
  for (const item of blocks) console.log(`- [${item.rule}] ${item.message}`);
  for (const item of warnings) console.log(`- [警告/${item.rule}] ${item.message}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main();

export { RULES };
