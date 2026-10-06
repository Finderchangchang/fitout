#!/usr/bin/env node
/**
 * node scripts/fill.mjs --profile <企业档案.md> --showroom <id> --out <site.json> [--model deepseek-chat] [--max-retries 2]
 * 用 DeepSeek 按企业档案填 site.json。密钥只读 DEEPSEEK_API_KEY。
 * 拿到 JSON 后用本仓库的填写校验和拼装、机检回喂，最多再改 --max-retries 轮。
 * token 记在 <out>.log.json，每次模型原文记在 <out>.raw-<n>.txt。设置 FITOUT_CALL_LEDGER 时，调用次数达到 80 就停。
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { readJson } from "./lib/json.mjs";
import { E5_WORDS, E6_WORDS, PLACEHOLDERS, LIMITS, heroTitleIssue } from "./lib/rules.mjs";
import { closedTargets, isOn, parentOfCollection, pointsClosed } from "./lib/pages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const CALL_LIMIT = 95;
const ASSETS = process.env.FITOUT_DEMO_ASSETS || "H:\\ai_tool\\fitout-demo-assets";
const RETRY_RULES = new Set([
  "spec", "篇幅", "C14", "E5", "E6", "E2", "口径", "残留", "SEO", "结构", "链接", "D6", "C9", "C8", "口号", "A9", "重复",
]);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  return args[i + 1];
};
const profilePath = flag("--profile");
const showroomId = flag("--showroom");
const outPath = flag("--out");
const model = flag("--model", "deepseek-chat");
const maxRetries = Number(flag("--max-retries", "2"));
const dryRun = args.includes("--dry-run");

if (!profilePath || !showroomId || !outPath || !Number.isInteger(maxRetries) || maxRetries < 0) {
  console.error("用法：node scripts/fill.mjs --profile <企业档案.md> --showroom <id> --out <site.json> [--model deepseek-chat] [--max-retries 2]");
  process.exit(2);
}

const profileFile = path.resolve(profilePath);
const outFile = path.resolve(outPath);
const logFile = `${outFile}.log.json`;
if (!fs.existsSync(profileFile)) fail(`找不到企业档案：${profileFile}`, 2);
if (!/^[a-z0-9_-]+$/.test(showroomId)) fail(`样板间 id 不合法：${showroomId}`, 2);

const showroomDir = path.join(root, "showrooms", showroomId);
const showroom = readJson(path.join(showroomDir, "showroom.json"));
const example = readJson(path.join(showroomDir, "examples", "site.json"));
const images = readJson(path.join(showroomDir, "images.json"));
const profile = fs.readFileSync(profileFile, "utf8").replace(/^\uFEFF/, "");
const rulesDoc = fs.readFileSync(path.join(root, "docs", "SITE_JSON.md"), "utf8").replace(/^\uFEFF/, "");
const specs = loadSpecs(showroomDir);
const slots = Array.isArray(images.slots) ? images.slots : [];
const heroSlots = slots.filter((slot) => slot.block === "hero" && slot.tier === "must" && slot.mustBeReal === false);
const bans = exampleBans(example, showroomId);
const outline = showroomOutline(showroom, heroSlots, slots);
const specText = specPrompt(showroom, specs);
const businessType = example.businessType === "Organization" || example.businessType === "LocalBusiness"
  ? example.businessType
  : (showroom.industry === "factory-trade" ? "Organization" : "LocalBusiness");
const system = systemPrompt(showroom, bans, businessType);
const user = userPrompt({ rulesDoc, outline, specText, example, profile, showroomId });

if (dryRun) {
  const exampleErrors = lintSite(example, { leak: false });
  console.log(`提示词 ${countChars(system) + countChars(user)} 字（系统 ${system.length} 字符，用户 ${user.length} 字符）`);
  console.log(`示例站校验：${exampleErrors.length ? exampleErrors.join(" | ") : "通过"}`);
  console.log(`首屏图：${heroSlots.map((slot) => slot.id).join("、") || "无"}`);
  process.exit(exampleErrors.length ? 1 : 0);
}

const apiKey = String(process.env.DEEPSEEK_API_KEY || "").trim();
if (!apiKey) fail("没有 DEEPSEEK_API_KEY", 2);

fs.mkdirSync(path.dirname(outFile), { recursive: true });
const callLog = [];
let lastSite = null;
let lastErrors = [];
let passedOn = 0;

const messages = [
  { role: "system", content: system },
  { role: "user", content: user },
];

for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
  let raw = "";
  let finish = "";
  try {
    const turned = await chat(messages, attempt);
    raw = turned.content;
    finish = turned.finish;
  } catch (error) {
    lastErrors = [redact(error.message)];
    writeLog({ ok: false, passedOn: 0, errors: lastErrors });
    fail(lastErrors[0], 1);
  }
  if (finish === "length") {
    lastErrors = ["输出被截断，请删掉可选板块并缩短正文，重新输出完整 JSON"];
    remember(messages, raw, lastErrors);
    continue;
  }
  let site;
  try {
    site = parseModelJson(raw);
  } catch (error) {
    lastErrors = [error.message];
    remember(messages, raw, lastErrors);
    continue;
  }
  lastSite = site;
  const errors = await engineErrors(site);
  if (!errors.length) {
    passedOn = attempt;
    break;
  }
  lastErrors = errors;
  remember(messages, JSON.stringify(site), errors);
}

if (lastSite) {
  fs.writeFileSync(outFile, `${JSON.stringify(lastSite, null, 2)}\n`, "utf8");
}
writeLog({ ok: passedOn > 0, passedOn, errors: passedOn ? [] : lastErrors });
if (!passedOn) {
  console.error(`没填成（${lastErrors.length} 条）：${lastErrors.slice(0, 8).join("；")}`);
  process.exit(1);
}
const tokens = callLog.reduce((sum, row) => sum + (row.totalTokens || 0), 0);
console.log(`已写入 ${outFile}（第 ${passedOn} 次，重试 ${passedOn - 1} 次，${tokens} token）`);

function remember(history, assistant, errors) {
  history.length = 2;
  history.push({ role: "assistant", content: assistant });
  history.push({
    role: "user",
    content: `校验没过，请只改这些错，不要新增事实，不要补日子，不要输出「待补」。仍只输出完整 JSON 对象。\n${errors.slice(0, 40).join("\n")}`,
  });
}

function systemPrompt(room, banned, businessType) {
  const words = E5_WORDS.map((item) => item.word).join("、");
  const buttons = E6_WORDS.join("、");
  const primary = room.buttons?.primary || "";
  return [
    "你是给中小企业填官网档案的人。只输出一个 JSON 对象，不要 Markdown，不要解释，不要缩进。",
    "写短。集合只收档案里有的条目，正文一两句，不要把示例站的篇幅照抄过来。",
    "事实只来自企业档案。档案写「待补」、空着、或明确说没有的，当成没有：那一项整段删掉。输出里禁止出现「待补」「暂无」「详情咨询」这几个字。",
    "每个板块都要写 tone，只能是 light、dark、image。hero 的 tone 必须是 image。首页至少 4 个板块，相邻 tone 不能相同，深浅切换至少 3 次。",
    "不要写 interval。年月照档案的写法，例如「2025年9月」。不要写成 2025-09-01，不要补档案里没有的日子，也不要把 9 写成 09。",
    "首屏 slides 的 imageAlt 必须原样照抄给出的画面说明。首屏 label 可以不写；要写就不超过 4 个字。",
    "不要编电话、微信、邮箱、备案号、价格、年份、人数、客户数、评分、证号、评价原话、人名。数字照档案里的那一串抄，不要换算，不要凑整。",
    "可选板块没有对应事实就整块不出。样板间必填板块必须在，内容仍只能用档案里有的话，不够就写短。",
    "可选页看骨架里的「什么情况下该有」。对不上，或档案写了否定，就把该页 enabled 设为 false。关掉的页不要留在导航里，首页也不要做它的入口。必有页不能关。",
    "详情页不要写进 pages。列表页关掉时，这个集合可以空着，详情也不要编。",
    "顶层写 hero.buttons，1 到 2 个，每项有 label 和 href。不写才用样板间默认。默认按钮指向的页如果关掉了，就改成「电话咨询」或「联系我们」，href 用联系页。",
    `样板间默认主按钮是「${primary}」。档案不是这条业务就不要用它。标题和按钮里不要用破折号。`,
    "档案内容少时少放几块，够说清就停，不要把同一件事换着说。首页同一个短句不要出现 3 次，同一个数字加单位不要写进 3 个板块。",
    "导航、首屏按钮、页脚摘要不要写已关掉的业务。例如不招加盟，这些地方就不要出现「加盟」。",
    `不要用这些空话：${words}。按钮不要写：${buttons}。`,
    "示例站只看结构。不要沿用它的公司名、电话、微信、邮箱、备案号、人名、首屏口号、句子和数字。",
    banned.length ? `这些示例字样一旦出现就算失败：${banned.join("、")}` : "",
    "首屏图是样板间的氛围图，不是这家的实拍。alt 用给出的画面说明，不要写成「本厂」「本店」「本院」。",
    "非首屏图片没有客户照片就留空字符串。规格把 image 标成必填时，填列表里已有的图片位 id，alt 用该位的画面说明，不要编新 id。",
    "轮播 interval 不要填，拼装会补。",
    `行业 industry 必须是 ${room.industry}，niche 必须是 ${room.niche || "空"}。`,
    `businessType 必须写 ${businessType}。填写规则里若写了另一种，以这一句为准。`,
    "不要写 style、颜色、字体。不要写 page-banner。详情页不要写进 pages。",
  ].filter(Boolean).join("\n");
}

function userPrompt({ rulesDoc: doc, outline: frame, specText: fields, example: sample, profile: brief, showroomId: id }) {
  return [
    `这次样板间是 ${id}。下面四份材料：填写规则、这套骨架、字段上限、示例站。示例站只说明 JSON 长什么样。`,
    "## 填写规则",
    doc,
    "## 这套骨架",
    frame,
    "## 字段和字数上限",
    "字数按去掉空白后的 Unicode 码点计。超了会失败。",
    fields,
    "## 示例站（只看结构，不要抄内容）",
    JSON.stringify(stripInterval(sample), null, 2),
    "## 企业档案（唯一事实来源）",
    brief,
    "请输出这一家的 site.json。id 用档案里的站点 id。店名用品牌名，品牌名里已有「（虚构）」就不要再加。",
  ].join("\n\n");
}

function showroomOutline(room, heroes, allSlots) {
  const lines = [];
  lines.push(`名称：${room.name || room.id}`);
  lines.push(`industry：${room.industry}`);
  lines.push(`niche：${room.niche || ""}`);
  lines.push(`默认主按钮：${room.buttons?.primary || ""} → ${room.buttons?.primaryHref || "联系页"}`);
  lines.push(`默认次按钮：${room.buttons?.secondary || ""} → ${room.buttons?.secondaryHref || ""}。次按钮可以空，要用就写具体动作。`);
  lines.push(`顶栏只能：${(room.shell?.header || []).join("、")}`);
  lines.push(`页脚只能：${(room.shell?.footer || []).join("、")}`);
  lines.push(`悬浮只能：${(room.shell?.floatContact || []).join("、")}`);
  lines.push("页面（详情页由集合生成，不要写进 pages）：");
  for (const page of room.pages || []) {
    if (page.from) {
      const follow = page.optional ? "列表页关掉就不生成。" : "主集合开着就生成。";
      lines.push(`- 详情 ${page.file} 来自集合 ${page.from}，不要出现在 pages。${follow}`);
      continue;
    }
    const flag = page.optional ? "可选" : "必有";
    let line = `- ${page.id} → ${page.file} ${flag}`;
    if (page.optional && page.when) line += `。什么情况下该有：${page.when}`;
    if (page.optional && page.deny?.length) line += `。档案出现这些说法就要关掉：${page.deny.join("、")}`;
    lines.push(line);
    for (const block of page.order || []) {
      lines.push(`  - ${block.type} ${block.required ? "必填" : "可无"} 版式：${(block.variants || []).join("、")}`);
    }
  }
  lines.push("集合（每条至少一个 slug、name、summary；slug 用小写英文或拼音，不能用 index，不能重复）：");
  for (const col of room.collections || []) {
    lines.push(`- ${col.id}（${col.label || col.id}）列表页 ${col.listFile}`);
  }
  lines.push("导航 href 用上面的文件路径，例如 index.html、about/index.html。");
  lines.push("首屏 slides 按这个顺序全部放上，image 只写 id：");
  for (const slot of heroes) lines.push(`- ${slot.id}：${slot.desc || ""}`);
  lines.push("其他图片位（必填 image 才能用，alt 用冒号后的画面，不要编 id）：");
  for (const slot of allSlots) {
    if (heroes.includes(slot)) continue;
    lines.push(`- ${slot.id}：${slot.desc || slot.id}`);
  }
  return lines.join("\n");
}

function specPrompt(room, specMap) {
  const types = new Set(["collection-detail"]);
  for (const page of room.pages || []) {
    for (const block of page.order || []) types.add(block.type);
  }
  const lines = [];
  for (const type of types) {
    const spec = specMap.get(type);
    lines.push(`### ${type}`);
    if (!spec) {
      lines.push("没有单独的 spec，沿用骨架。");
      continue;
    }
    lines.push(...compactFields(spec.fields, ""));
  }
  return lines.join("\n");
}

function compactFields(fields, indent) {
  const lines = [];
  for (const [key, def] of Object.entries(fields || {})) {
    if (!def || def.filledBy === "build") continue;
    if (def.type === "list") {
      const min = def.min ?? 0;
      const max = def.max ?? "";
      lines.push(`${indent}${key}：列表，${def.required ? "必填" : "可无"}，${min}到${max}项`);
      lines.push(...compactFields(def.item, `${indent}  `));
    } else {
      const max = def.maxChars ? `，≤${def.maxChars}` : "";
      lines.push(`${indent}${key}：${def.type || "string"}，${def.required ? "必填" : "可无"}${max}`);
    }
  }
  return lines;
}

function loadSpecs(dir) {
  const map = new Map();
  readSpecDir(path.join(root, "framework", "sections"), map);
  readSpecDir(path.join(dir, "sections"), map);
  return map;
}

function readSpecDir(dir, map) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name, "spec.json");
    if (fs.existsSync(file)) map.set(name, readJson(file));
  }
}

function exampleBans(sample, roomId) {
  const bans = new Set();
  const add = (value) => {
    const text = String(value || "").trim();
    if (text.length >= 2) bans.add(text);
  };
  const name = String(sample.name || "").replace(/（虚构）|\(虚构\)/g, "").trim();
  add(name);
  const contact = sample.contact || {};
  for (const key of ["phone", "wechat", "email", "icp", "police"]) add(contact[key]);
  const phoneDigits = String(contact.phone || "").replace(/\D/g, "");
  if (phoneDigits.length >= 8) add(phoneDigits);
  if (sample.id && sample.id !== roomId) add(sample.id);
  const home = (sample.pages || []).find((page) => page.id === "home") || sample.pages?.[0];
  const hero = (home?.sections || []).find((section) => section.type === "hero");
  add(hero?.data?.title);
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const person = node.quote || node.role || (node.focus && node.years);
    if (person && /^[\u3400-\u9fff]{2,4}$/.test(String(node.name || ""))) add(node.name);
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") walk(value);
    }
  };
  walk(sample);
  return [...bans];
}

async function engineErrors(site) {
  const lintErrors = lintSite(site, { leak: true, model: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fitout-fill-"));
  try {
    const built = runBuild(site, tmp);
    if (!built.ok) return dedupe([...lintErrors, ...built.errors]).slice(0, 40);
    const checked = runCheck(tmp);
    return dedupe([...lintErrors, ...checked]).slice(0, 40);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function runBuild(site, tmp) {
  const siteFile = path.join(tmp, "site.json");
  const imgDir = path.join(tmp, "images");
  fs.writeFileSync(siteFile, JSON.stringify(site), "utf8");
  fs.mkdirSync(imgDir, { recursive: true });
  copyHeroFiles(showroomId, imgDir);
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "build.mjs"), siteFile, "--site-dir", path.join(tmp, "site"), "--images", imgDir], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60000,
  });
  if (res.status === 0) return { ok: true, errors: [] };
  const text = redact(`${res.stderr || ""}\n${res.stdout || ""}`)
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\s*at\s|node:internal|ModuleJob|^\^$|throw new Error/.test(line));
  const useful = text.filter((line) => /未定义|缺少|必须|不是|Error:|失败/.test(line));
  const picked = (useful.length ? useful : text).slice(0, 8);
  return { ok: false, errors: (picked.length ? picked : ["拼装失败"]).map((line) => `拼装：${line}`) };
}

function runCheck(tmp) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "check.mjs"), path.join(tmp, "site")], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60000,
  });
  const lines = `${res.stdout || ""}\n${res.stderr || ""}`.split(/\r?\n/);
  const errors = [];
  for (const line of lines) {
    const match = line.match(/^- \[(?:警告\/)?([^\]]+)\]\s*(.*)$/);
    if (!match) continue;
    const warn = line.includes("[警告/");
    const rule = match[1];
    if (!RETRY_RULES.has(rule)) continue;
    if (warn && rule !== "口号" && rule !== "重复") continue;
    if (rule === "SEO" && /上线前要换真实网址/.test(match[2])) continue;
    errors.push(`[${rule}] ${match[2]}`);
  }
  return errors;
}

function copyHeroFiles(id, dest) {
  const from = path.join(ASSETS, id);
  if (!fs.existsSync(from)) return;
  for (const slot of heroSlots) {
    for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
      const file = path.join(from, `${slot.id}${ext}`);
      if (!fs.existsSync(file)) continue;
      fs.copyFileSync(file, path.join(dest, `${slot.id}${ext}`));
      break;
    }
  }
}

function lintSite(site, { leak, model }) {
  const errors = [];
  const push = (message) => {
    if (!errors.includes(message)) errors.push(message);
  };
  if (!site || typeof site !== "object" || Array.isArray(site)) return ["根节点必须是对象"];
  if (site.showroom !== showroomId) push(`showroom 必须是 ${showroomId}`);
  if (site.industry !== showroom.industry) push(`industry 必须是 ${showroom.industry}`);
  if (showroom.niche && site.niche !== showroom.niche) push(`niche 必须是 ${showroom.niche}`);
  if (site.businessType !== businessType) push(`businessType 必须是 ${businessType}`);
  if (!/^_?[a-z0-9][a-z0-9-]*$/.test(site.id || "")) push("id 只能是小写字母、数字和连字符");
  if (!site.name) push("缺少 name");
  else if (countChars(site.name) > LIMITS.name) push(`店名有 ${countChars(site.name)} 字，上限 ${LIMITS.name}`);
  if (!Array.isArray(site.nav) || site.nav.length === 0) push("缺少 nav");
  for (const item of site.nav || []) {
    if (!item?.label || !item?.href) push("nav 每一项都要有 label 和 href");
  }
  const phone = site.contact?.phone;
  const address = site.contact?.address;
  if (!phone) push("缺少 contact.phone");
  if (!address) push("缺少 contact.address");
  else if (countChars(address) > LIMITS.address) push(`地址有 ${countChars(address)} 字，上限 ${LIMITS.address}`);
  const hours = Array.isArray(site.contact?.hours) ? site.contact.hours : [];
  if (!hours.length) push("缺少营业时间 contact.hours");
  for (const row of hours) {
    if (!row?.day || !row?.time) push("营业时间每一行都要有 day 和 time");
  }
  const shell = site.shell || {};
  assertChoice(showroom.shell?.header, shell.header, "顶栏版式", push);
  assertChoice(showroom.shell?.footer, shell.footer, "页脚版式", push);
  assertChoice(showroom.shell?.floatContact, shell.floatContact, "悬浮联系版式", push);

  const pageIds = new Set((showroom.pages || []).filter((page) => !page.from).map((page) => page.id));
  const seenPages = new Set();
  for (const page of site.pages || []) {
    if (!pageIds.has(page.id)) push(`户型没有页面 ${page.id}`);
    if (seenPages.has(page.id)) push(`页面重复：${page.id}`);
    seenPages.add(page.id);
    const housePage = (showroom.pages || []).find((item) => item.id === page.id && !item.from);
    if (page.enabled === false) {
      if (!housePage?.optional) push(`必有页 ${page.id} 不能关`);
      continue;
    }
    if (!page.title) push(`${page.id || "?"} 缺少 title`);
    else if (countChars(page.title) > LIMITS.title) push(`页面 ${page.id} 的 title 有 ${countChars(page.title)} 字，上限 ${LIMITS.title}`);
    if (!page.description) push(`${page.id || "?"} 缺少 description`);
    else if (countChars(page.description) > LIMITS.description) push(`页面 ${page.id} 的 description 有 ${countChars(page.description)} 字，上限 ${LIMITS.description}`);
    const order = (showroom.pages || []).find((item) => item.id === page.id && !item.from)?.order || [];
    lintOrder(page.sections || [], order, page.file || page.id, push);
    for (const section of page.sections || []) {
      if (section?.type === "page-banner") push("page-banner 不要写进板块");
      const spec = specs.get(section?.type);
      if (!spec) {
        push(`没有板块规格 ${section?.type}`);
        continue;
      }
      lintFields(section?.data || {}, spec.fields, `${page.id}.${section.type}`, section.type, push);
      if (!["light", "dark", "image"].includes(section?.tone)) push(`${page.id} 的 ${section?.type} 缺少 tone（light、dark、image）`);
      if (section?.type === "hero" && section.tone !== "image") push("首屏 tone 必须是 image");
      if (model && section?.type === "hero") lintHeroExtra(section.data || {}, push);
    }
  }
  lintHomeTones(site, push);
  lintHeroButtons(site, push, model);
  if (model) lintClosedPages(site, push);
  for (const id of pageIds) {
    const housePage = (showroom.pages || []).find((item) => item.id === id && !item.from);
    if (!seenPages.has(id) && !housePage?.optional) push(`site.json 缺少页面 ${id}`);
  }
  for (const page of showroom.pages || []) {
    if (!page.from) continue;
    const parent = parentOfCollection(showroom, page.from);
    if (parent && !isOn(showroom, site, parent)) continue;
    const items = itemsOf(site, page.from);
    if (!Array.isArray(items) || items.length === 0) {
      push(`集合 ${page.from} 是空的`);
      continue;
    }
    const slugs = new Set();
    const detailSpec = specs.get("collection-detail");
    for (const item of items) {
      const slug = String(item?.slug || "");
      if (!/^[a-z0-9-]+$/.test(slug)) push(`slug 不合法：${slug || "(空)"}`);
      if (slug === "index") push("slug 不能用保留名：index");
      if (slugs.has(slug)) push(`slug 重复：${slug}`);
      slugs.add(slug);
      if (detailSpec) lintFields(item, detailSpec.fields, `${page.from}.${slug || "?"}`, "collection-detail", push);
    }
  }
  walkStrings(site, (text, keys) => {
    const key = keys[keys.length - 1];
    const where = keys.join(".");
    for (const entry of E5_WORDS) {
      if (hitPhrase(text, entry)) push(`[E5] ${where} 出现空话「${entry.word}」`);
    }
    if (hasEmoji(text)) push(`[E2] ${where} 用了 emoji`);
    if (/[★☆]/.test(text)) push(`[E2] ${where} 用了星标`);
    for (const item of PLACEHOLDERS) {
      const re = new RegExp(item.pattern, item.flags || "");
      if (re.test(text)) push(`[残留] ${where} 出现${item.label}`);
    }
    if (text.includes("待补")) push(`[残留] ${where} 出现待补`);
    if (["title", "name", "q", "primaryLabel", "secondaryLabel", "label", "moreLabel"].includes(key) && hasDash(text)) {
      push(`[口径] ${where} 有破折号`);
    }
    if (model && key === "interval") push(`[口径] ${where} 不要写 interval`);
    if (model && key !== "interval") {
      for (const item of tokensOf(text)) {
        if (/^\d$/.test(item.token)) continue;
        if (numberCovered(profile, item.token)) continue;
        push(`[残留] ${where} 的数字 ${item.token} 档案里没有`);
      }
    }
    if (["primaryLabel", "secondaryLabel", "moreLabel"].includes(key)) {
      const folded = foldLabel(text);
      for (const word of E6_WORDS) {
        if (folded.includes(word)) push(`[E6] ${where} 按钮写了「${word}」`);
      }
    }
    if (leak) {
      for (const ban of bans) {
        if (ban && text.includes(ban)) push(`沿用了示例「${clip(ban)}」`);
      }
    }
  });
  return errors;
}

function lintHeroButtons(site, push, model) {
  const closed = closedTargets(showroom, site);
  const hero = site.hero;
  if (hero != null) {
    if (!hero || typeof hero !== "object" || Array.isArray(hero) || !Array.isArray(hero.buttons)) {
      push("hero.buttons 要是 1 到 2 个按钮");
      return;
    }
    if (hero.buttons.length < 1 || hero.buttons.length > 2) push("hero.buttons 要 1 到 2 个");
    for (const button of hero.buttons) {
      if (!button?.label || !button?.href) {
        push("hero.buttons 每一项都要有 label 和 href");
        continue;
      }
      if (countChars(String(button.label)) > 8) push(`首屏按钮「${button.label}」超过 8 个字`);
      if (pointsClosed(button.href, closed)) push(`首屏按钮「${button.label}」指向已关闭的页面，改到联系页或还开着的页`);
    }
    return;
  }
  if (!model) return;
  const home = (site.pages || []).find((page) => page.id === "home");
  const section = (home?.sections || []).find((item) => item?.type === "hero");
  const href = section?.data?.primaryHref || showroom.buttons?.primaryHref || "";
  if (pointsClosed(href, closed)) push("默认首屏按钮指向已关闭的页面，请写 hero.buttons，改成电话咨询或联系我们");
}

function lintClosedPages(site, push) {
  const closed = closedTargets(showroom, site);
  for (const page of showroom.pages || []) {
    if (page.from || page.optional !== true || !isOn(showroom, site, page)) continue;
    for (const phrase of page.deny || []) {
      if (phrase && profile.includes(phrase)) {
        push(`档案写了「${phrase}」，页面 ${page.id} 要关掉（enabled: false），导航和首屏按钮不要指向它`);
        break;
      }
    }
  }
  for (const item of site.nav || []) {
    if (pointsClosed(item?.href, closed)) push(`导航「${item?.label || item?.href}」指向已关闭的页面，删掉这一项`);
  }
  if (pointsClosed(showroom.buttons?.primaryHref || "", closed) && String(site.summary || "").includes("加盟")) {
    push("这条业务已关，页脚摘要不要写加盟");
  }
}

function lintHomeTones(site, push) {
  const home = (site.pages || []).find((page) => page.id === "home");
  const tones = (home?.sections || []).map((section) => section?.tone || "");
  let switches = 0;
  for (let i = 1; i < tones.length; i += 1) {
    if (tones[i] && tones[i - 1] && tones[i] !== tones[i - 1]) switches += 1;
  }
  if (switches < 3) push(`[A9] 首页深浅切换 ${switches} 次，至少 3 次。hero 用 image，后面 light 和 dark 交替，至少 4 个板块`);
}

function lintHeroExtra(data, push) {
  if (data.label && countChars(data.label) > 4) push(`首屏 label 有 ${countChars(data.label)} 字，最多 4 个字`);
  for (const slide of data.slides || []) {
    const slot = slots.find((item) => item.id === slide?.image);
    if (slot?.desc && slide?.imageAlt !== slot.desc) push(`首屏 ${slide?.image || "?"} 的说明必须原样是「${slot.desc}」`);
  }
}

function stripInterval(value) {
  if (Array.isArray(value)) return value.map(stripInterval);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "interval") continue;
    out[key] = stripInterval(item);
  }
  return out;
}

function tokensOf(text) {
  const found = [];
  const ranges = [];
  const take = (re, kind) => {
    for (const match of String(text).matchAll(re)) {
      const start = match.index;
      const end = start + match[0].length;
      if (ranges.some((range) => start < range.end && end > range.start)) continue;
      ranges.push({ start, end });
      found.push({ token: match[0], kind });
    }
  };
  take(/0\d{2,3}-\d{7,8}/g, "phone");
  take(/0\d{2,3}-\d{3,4}-\d{4}/g, "phone");
  take(/1[3-9]\d{9}/g, "phone");
  take(/(?<![\d.])\d+\.\d+(?![\d.])/g, "decimal");
  take(/(?<!\d)\d{2,}(?!\d)/g, "int");
  return found;
}

function numberCovered(brief, token) {
  if (numberExact(brief, token)) return true;
  const unpadded = token.replace(/^0+(?=\d)/, "");
  return unpadded !== token && numberExact(brief, unpadded);
}

function numberExact(brief, token) {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\d.])${esc}(?![\\d.])`).test(brief);
}

function itemsOf(site, id) {
  if (site.collections && Array.isArray(site.collections[id])) return site.collections[id];
  if (id === "products" && Array.isArray(site.products)) return site.products;
  return null;
}

function assertChoice(allowed, value, label, push) {
  if (!Array.isArray(allowed) || !allowed.length) return;
  if (!allowed.includes(value)) push(`${label}必须是 ${allowed.join("、")}`);
}

function lintOrder(sections, order, file, push) {
  let last = -1;
  const seen = new Set();
  for (const section of sections) {
    const idx = order.findIndex((item) => item.type === section?.type);
    if (idx === -1) push(`${file} 不允许板块 ${section?.type}`);
    if (seen.has(section?.type)) push(`${file} 重复了板块 ${section?.type}`);
    if (idx >= 0 && idx < last) push(`${file} 的板块顺序和户型不一致：${section.type}`);
    if (idx >= 0 && section?.variant && !order[idx].variants.includes(section.variant)) {
      push(`${file} 的 ${section.type} 不能用版式 ${section.variant}`);
    }
    if (idx >= 0) last = idx;
    seen.add(section?.type);
  }
  for (const rule of order) {
    if (rule.required && !seen.has(rule.type)) push(`${file} 缺少必备板块 ${rule.type}`);
  }
}

function lintFields(data, fields, label, type, push) {
  for (const [key, def] of Object.entries(fields || {})) {
    if (!def || def.filledBy === "build") continue;
    const value = data?.[key];
    if (def.type === "list") {
      if (!Array.isArray(value)) {
        if (def.required) push(`${label} 缺少列表 ${key}`);
        continue;
      }
      if (def.min && value.length < def.min) push(`${label}.${key} 至少 ${def.min} 项`);
      if (def.max && value.length > def.max) push(`${label}.${key} 最多 ${def.max} 项`);
      value.forEach((item, index) => lintFields(item, def.item, `${label}.${key}[${index}]`, type, push));
      continue;
    }
    if (typeof value === "string") {
      if (def.required && value.trim() === "") push(`${label} 的 ${key} 是空的`);
      if (type === "hero" && key === "title") {
        const issue = heroTitleIssue(value);
        if (issue) push(`[C14] ${label}.${key} ${issue}`);
      } else if (def.maxChars && countChars(value) > def.maxChars) {
        push(`${label}.${key} 有 ${countChars(value)} 字，上限 ${def.maxChars}`);
      }
      if ((key === "image" || key === "wechatQr") && value.trim()) {
        const id = value.startsWith("slot:") ? value.slice(5).trim() : value.trim();
        if (!slots.some((slot) => slot.id === id)) push(`${label}.${key} 不是已有图片位：${clip(id)}`);
      }
    } else if (def.required) push(`${label} 缺少 ${key}`);
  }
}

function walkStrings(node, fn, keys = []) {
  if (typeof node === "string") {
    fn(node, keys);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => walkStrings(item, fn, [...keys, String(index)]));
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) walkStrings(value, fn, [...keys, key]);
}

function firstJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === "\"") inStr = false;
      continue;
    }
    if (ch === "\"") inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return "";
}

function parseModelJson(raw) {
  if (apiKey && raw.includes(apiKey)) throw new Error("模型输出异常，已丢弃");
  const clean = String(raw || "").trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch (error) {
    const sliced = firstJsonObject(clean);
    if (!sliced) {
      const sample = clean.replace(/\s+/g, " ").slice(0, 140);
      throw new Error(`模型响应不是合法 JSON：${error.message}。开头：${sample}`);
    }
    try {
      parsed = JSON.parse(sliced);
    } catch (error2) {
      const sample = clean.replace(/\s+/g, " ").slice(0, 140);
      throw new Error(`模型响应不是合法 JSON：${error2.message}。开头：${sample}`);
    }
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && !parsed.pages) {
    const nested = Object.values(parsed).find((item) => item && typeof item === "object" && !Array.isArray(item) && Array.isArray(item.pages));
    if (nested) return nested;
  }
  return parsed;
}

async function chat(messages, attempt) {
  reserveCall();
  let last = "未知错误";
  for (let i = 0; i < 2; i += 1) {
    if (i > 0) reserveCall();
    try {
      const response = await fetch(DEEPSEEK_URL, {
        method: "POST",
        signal: AbortSignal.timeout(180000),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          max_tokens: 8192,
          response_format: { type: "json_object" },
        }),
      });
      const bodyText = await response.text();
      if (!response.ok) {
        saveRaw(attempt, bodyText);
        last = redact(`HTTP ${response.status} ${bodyText.slice(0, 180)}`.replace(/\s+/g, " "));
        if (response.status < 500 && response.status !== 429) break;
        continue;
      }
      let payload;
      try {
        payload = JSON.parse(bodyText);
      } catch (error) {
        saveRaw(attempt, bodyText);
        throw error;
      }
      const usage = payload.usage || {};
      const finish = payload.choices?.[0]?.finish_reason || "";
      callLog.push({
        attempt,
        http: response.status,
        promptTokens: usage.prompt_tokens ?? null,
        completionTokens: usage.completion_tokens ?? null,
        totalTokens: usage.total_tokens ?? null,
        finish,
      });
      writeLog({ ok: false, passedOn: 0, errors: lastErrors });
      const content = payload.choices?.[0]?.message?.content ?? "";
      saveRaw(attempt, content);
      return { content, finish };
    } catch (error) {
      last = redact(error.message || "请求失败");
      if (/输出异常/.test(last)) throw new Error(last);
    }
  }
  throw new Error(`DeepSeek 请求失败：${last}`);
}

function reserveCall() {
  const file = process.env.FITOUT_CALL_LEDGER;
  if (!file) return;
  let data = { count: 0 };
  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    } catch {
      data = { count: 0 };
    }
  }
  const count = Number(data.count) || 0;
  if (count >= CALL_LIMIT) fail(`DeepSeek 调用已达 ${CALL_LIMIT} 次，停止`, 2);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ count: count + 1, limit: CALL_LIMIT }, null, 2)}\n`, "utf8");
}

function saveRaw(attempt, text) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(`${outFile}.raw-${attempt}.txt`, redact(String(text ?? "")), "utf8");
}

function writeLog(extra) {
  const payload = {
    model,
    showroom: showroomId,
    profile: profileFile,
    ok: Boolean(extra.ok),
    passedOn: extra.passedOn || 0,
    calls: callLog,
    errors: extra.errors || [],
  };
  fs.writeFileSync(logFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function dedupe(list) {
  const out = [];
  for (const item of list) {
    const text = redact(String(item || "").trim());
    if (!text || out.includes(text)) continue;
    out.push(text);
  }
  return out;
}

function countChars(text) {
  return Array.from(String(text).replace(/\s+/g, "")).length;
}

function hasDash(text) {
  return /[\u2014\u2015\u2E3A]/.test(text) || text.includes("——");
}

function foldLabel(text) {
  const map = { "點": "点", "擊": "击", "這": "这", "裡": "里", "裏": "里", "詳": "详", "見": "见", "後": "后", "開": "开", "關": "关" };
  return Array.from(String(text).normalize("NFKC"), (ch) => map[ch] || ch).join("").toLowerCase().replace(/[\p{P}\p{S}\p{Z}\s]/gu, "");
}

function hitPhrase(text, entry) {
  if (entry.boundary === "en") {
    const re = new RegExp(`(?:^|[^A-Za-z0-9])${entry.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^A-Za-z0-9])`, "i");
    return re.test(text);
  }
  return text.toLowerCase().includes(entry.word.toLowerCase());
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

function clip(text) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean;
}

function redact(text) {
  const key = String(process.env.DEEPSEEK_API_KEY || "").trim();
  const out = String(text || "");
  return key ? out.split(key).join("***") : out;
}

function fail(message, code) {
  console.error(redact(message));
  process.exit(code);
}
