#!/usr/bin/env node
/**
 * node scripts/fitout.mjs --profile <档案.md> --out <站点目录> [--fill agent|deepseek] [--lang zh-CN|en] [--showroom <id>|auto] [--photos <照片目录>] [--gen-images] [--base-url <网址>] [--model deepseek-chat]
 * 一条命令：挑样板间、校验或填写、配图、拼装、机检，并写交付说明。
 * 默认 --fill agent：不调用 DeepSeek，校验站点目录里已有的 site.json。
 * --fill deepseek 才读 DEEPSEEK_API_KEY。生图没有 MINIMAX_API_KEY 就跳过并提示。
 * 不发布，不改样板间。
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { readJson } from "./lib/json.mjs";
import { fillProfile, lintAgentSite } from "./fill.mjs";
import { matchPhotos } from "./lib/photos.mjs";
import {
  aspectRatioFor,
  buildPrompt,
  clipJson,
  findPlaywright,
  findSlotFile,
  formatBytes,
  loadImages,
  minimaxEndpoint,
  sniffImage,
  summarizeBody,
} from "./images/lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const GEN_CAP = 8;
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const USAGE = "用法：node scripts/fitout.mjs --profile <档案.md> --out <站点目录> [--fill agent|deepseek] [--lang zh-CN|en] [--showroom <id>|auto] [--photos <照片目录>] [--gen-images] [--base-url <网址>] [--model deepseek-chat]\n默认 --fill agent，不需要密钥。--fill deepseek 才读 DEEPSEEK_API_KEY。";

const KEYWORDS = {
  "cn-dining": ["奶茶", "茶饮", "餐饮", "烘焙", "咖啡", "甜品", "面包", "饭店", "餐厅", "火锅", "小吃"],
  "cn-agriculture": ["农产品", "合作社", "特产", "茶园", "果园", "大米", "稻米", "果蔬", "种植基地"],
  "cn-factory": ["工厂", "制造", "紧固件", "五金", "零部件", "机械", "螺栓", "冲压", "模具", "车间"],
  "cn-auto": ["汽修", "快修", "汽车美容", "贴膜", "钣金", "养车", "洗车"],
  "cn-medical": ["口腔", "诊所", "牙科", "洗牙", "中医", "门诊", "齿科"],
  "cn-professional": ["律师", "律所", "事务所", "财税", "代账", "诉讼"],
  "cn-education": ["培训", "学校", "课程", "学员", "职教", "兴趣班", "教培"],
  "cn-home-decor": ["装修", "家装", "全屋定制", "量房", "软装", "工装"],
  "cn-hospitality": ["民宿", "客栈", "酒店", "客房", "房型", "度假"],
  "cn-wedding-photo": ["婚纱", "写真", "婚庆", "影楼", "摄影"],
  "intl-factory": ["外贸", "出口", "OEM", "工厂", "制造", "紧固件", "五金", "零部件", "机械", "螺栓", "冲压", "模具", "车间"],
  "intl-beauty": ["美容", "SPA", "美发", "沙龙", "养生"],
  "intl-education": ["培训", "学校", "课程", "学员", "编程", "设计", "语言"],
  "intl-professional": ["咨询", "律师", "律所", "财税", "管理咨询"],
};

const ALIASES = [
  ["company", ["公司全称", "公司名"]],
  ["brand", ["品牌名/门店名", "品牌名", "门店名"]],
  ["siteId", ["站点id"]],
  ["industry", ["行业", "行业/细分"]],
  ["address", ["城市、地址", "城市地址", "地址"]],
  ["phone", ["电话"]],
  ["wechat", ["微信", "微信号"]],
  ["email", ["邮箱"]],
  ["icp", ["备案号"]],
  ["hours", ["营业时间"]],
];

const usage = {
  deepseek: 0,
  minimax: 0,
  fillCalls: 0,
};
let currentStep = "出站";

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    const where = error.step || currentStep;
    console.error(`失败在「${where}」。`);
    console.error(redact(error.message || String(error)));
    console.error("这一步停了，后面没有继续。");
    process.exit(Number.isInteger(error.code) ? error.code : 1);
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let step = "读档案";
  const mark = (name) => {
    step = name;
    currentStep = name;
  };
  mark("读档案");
  const profilePath = path.resolve(opts.profile);
  if (!fs.existsSync(profilePath) || !fs.statSync(profilePath).isFile()) {
    stepFail(step, `找不到企业档案：${profilePath}\n路径写到那份 .md。`, 2);
  }
  const markdown = fs.readFileSync(profilePath, "utf8").replace(/^\uFEFF/, "");
  const parsed = parseProfile(markdown);
  const missing = missingFields(parsed);
  if (missing.length) {
    const lines = missing.map((item) => `- ${item.label}：${item.hint}`);
    stepFail(step, `企业档案还缺这些，不能开工：\n${lines.join("\n")}\n没有调用模型，站点也还没生成。补上之后用同一条命令再跑。不知道的项留空，不要编。`, 2);
  }
  console.log(`读档案：${parsed.brand || parsed.company}（${parsed.siteId}）`);

  mark("挑样板间");
  const catalog = loadCatalog();
  const picked = await chooseShowroom(opts, parsed, catalog);
  console.log(`用第 1 套：${picked.id} ${picked.name}`);

  const outDir = path.resolve(opts.out);
  settleSiteDir(outDir, profilePath);
  const notes = [];
  const say = (line) => {
    notes.push(line);
    console.log(line);
  };

  mark("填内容");
  if (opts.fill === "agent") {
    validateAgentSite(outDir, profilePath, picked.id, opts.lang);
    say("填内容：已校验 site.json。没有调用外部模型。");
  } else {
    say("填内容：正在按档案写 site.json。");
    let filled;
    try {
      filled = await fillProfile({
        profilePath,
        showroomId: picked.id,
        outPath: path.join(outDir, "site.json"),
        model: opts.model,
        lang: opts.lang,
        maxRetries: 2,
      });
    } catch (error) {
      stepFail(step, `${error.message}\n请确认 DEEPSEEK_API_KEY 在环境变量里。不要把密钥贴到聊天或写进档案。`, error.code || 1);
    }
    usage.fillCalls = filled.calls || 0;
    usage.deepseek += filled.calls || 0;
    if (!filled.ok) {
      stepFail(step, `${filled.message}\n按这几条改档案，或把可选内容删短，然后重跑。不要手写电话、人数、价格去凑。`, 1);
    }
    say(filled.message);
  }

  mark("配图");
  const roomDoc = readJson(path.join(root, "showrooms", picked.id, "showroom.json"));
  const imageDoc = loadImages(picked.id).doc;
  const images = await prepareImages({
    outDir,
    showroomId: picked.id,
    doc: imageDoc,
    photos: photoSource(outDir, opts.photos),
    genImages: opts.genImages,
    model: opts.model,
    fill: opts.fill,
    say,
  });

  mark("拼装");
  const siteDir = path.join(outDir, "site");
  const buildArgs = [path.join(outDir, "site.json"), "--site-dir", siteDir, "--images", images.dir];
  if (opts.baseUrl) buildArgs.push("--base-url", opts.baseUrl);
  const built = run("build.mjs", buildArgs, 120000);
  if (built.status !== 0) {
    stepFail(step, `拼装没有完成。\n${tail(built.text || built.error)}\n先看上面最后几行。site.json 在输出目录里，不要为了过检去编事实。`, 1);
  }
  say("拼装：完成。");

  mark("机检");
  const checked = run("check.mjs", [siteDir], 120000);
  const checkInfo = summarizeCheck(checked);
  say(`机检：${checkInfo.line}`);
  if (checked.status !== 0) {
    writeDelivery({ outDir, picked, roomDoc, images, checkInfo, visual: null, siteDir, baseUrl: opts.baseUrl });
    stepFail(step, `机检没过（退出码 ${checked.status}）。\n${tail(checked.text)}\n警告可以先留着。带失败的那几条要处理：多半是档案里的事实不够，或填出来的句子超了字数。改档案后重跑。`, 1);
  }

  mark("视觉检查");
  let visual = { status: "skip", line: "跳过：没有找到 Playwright。", shots: [] };
  if (findPlaywright()) {
    const shotDir = path.join(outDir, "shots");
    const seen = run("check-visual.mjs", [siteDir, "--shots", shotDir], 600000);
    const shotFiles = listShots(shotDir);
    const hero = shotFiles.find((file) => file.endsWith("-1440.png") && !path.basename(file).toLowerCase().includes("bottom"));
    const heroShots = [];
    if (hero) {
      const name = "首屏-1440.png";
      fs.copyFileSync(hero, path.join(outDir, name));
      heroShots.push(name);
    }
    if (seen.error && /timeout|超时/i.test(seen.error)) {
      visual = { status: "fail", line: "视觉检查超时。", detail: seen.error, shots: heroShots };
    } else if (/^跳过/.test(seen.text.trim()) || seen.text.includes("\n跳过")) {
      visual = { status: "skip", line: "跳过：没有找到 Playwright。", shots: heroShots };
    } else if (seen.status !== 0 || seen.text.includes("视觉检查：不通过")) {
      visual = { status: "fail", line: "视觉检查：不通过。", detail: tail(seen.text, 40), shots: heroShots };
    } else {
      visual = { status: "ok", line: "视觉检查：通过。", shots: heroShots };
    }
    say(visual.line);
  } else {
    say(visual.line);
  }

  mark("交付说明");
  const delivery = writeDelivery({ outDir, picked, roomDoc, images, checkInfo, visual, siteDir, baseUrl: opts.baseUrl });
  writeUsage(outDir);
  if (visual.status === "fail") {
    stepFail(step, `视觉检查没过，交付说明已经写了。\n${visual.detail || ""}\n打开站点看失败里写的那一页。`, 1);
  }
  console.log(`交付：${siteDir}`);
  console.log(`说明：${delivery}`);
}

export function parseProfile(markdown) {
  const fields = {};
  const text = String(markdown || "").replace(/^\uFEFF/, "");
  for (const line of text.split(/\r?\n/)) {
    const parts = tableCells(line);
    if (parts) {
      const key = aliasOf(parts[0]);
      if (key && fields[key] == null) fields[key] = parts[1];
      continue;
    }
    const plain = line.match(/^\s*(?:[-*]\s*)?([^:：]{1,20})[:：]\s*(.+?)\s*$/);
    if (!plain) continue;
    const key = aliasOf(plain[1]);
    if (key && fields[key] == null) fields[key] = plain[2];
  }
  const intro = sectionBody(text, /^##\s*1[.\s、]/m, /^##\s*2[.\s、]/m);
  return {
    company: clean(fields.company),
    brand: clean(fields.brand),
    siteId: clean(fields.siteId).toLowerCase(),
    industry: clean(fields.industry),
    address: clean(fields.address),
    phone: clean(fields.phone),
    wechat: clean(fields.wechat),
    email: clean(fields.email),
    icp: clean(fields.icp),
    hours: clean(fields.hours),
    intro,
    text,
  };
}

export function loadCatalog() {
  const index = readJson(path.join(root, "showrooms", "index.json"));
  return (index.showrooms || []).filter((item) => item && item.id && !String(item.id).startsWith("_"));
}

export function rankShowrooms(parsed, catalog, lang = "") {
  const industry = parsed.industry || "";
  const intro = parsed.intro || "";
  const languages = new Map(catalog.map((room) => [room.id, room.lang || "zh-CN"]));
  const ranked = catalog.map((room) => {
    const words = KEYWORDS[room.id] || [];
    let score = 0;
    const reasons = [];
    for (const word of words) {
      const inField = hit(industry, word);
      const inIntro = hit(intro, word);
      if (inField === "yes") {
        score += 8;
        reasons.push(`行业写了「${word}」`);
      } else if (inField === "no") {
        score -= 8;
        reasons.push(`行业里否定了「${word}」`);
      } else if (inIntro === "yes") {
        score += 4;
        reasons.push(`介绍里有「${word}」`);
      } else if (inIntro === "no") {
        score -= 4;
        reasons.push(`介绍里否定了「${word}」`);
      }
    }
    return {
      id: room.id,
      name: room.name || room.id,
      fit: room.fit || "",
      score,
      reasons: reasons.slice(0, 3),
    };
  });
  ranked.sort((a, b) => b.score - a.score || (lang ? Number(languages.get(b.id) === lang) - Number(languages.get(a.id) === lang) : 0) || a.id.localeCompare(b.id));
  return ranked;
}

function missingFields(parsed) {
  const missing = [];
  if (blank(parsed.brand) && blank(parsed.company)) {
    missing.push({ label: "公司名", hint: "填「品牌名 / 门店名」或「公司全称」。练习用的名字后面加（虚构）。" });
  }
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(parsed.siteId || "")) {
    missing.push({ label: "站点 id", hint: "用小写字母、数字、连字符，例如 xiangkou。这是输出目录里的名字，不要用中文。" });
  }
  if (blank(parsed.industry)) {
    missing.push({ label: "行业", hint: "写你们做什么，例如「社区奶茶」或「紧固件工厂」。细分拿不准就只写行业。没有行业就没法挑样板间。" });
  }
  if (blank(parsed.phone) || digits(parsed.phone).length < 7) {
    missing.push({ label: "电话", hint: "写成 0571-86001188 这样的号码。联系页必须有电话。没有就先不要跑。" });
  }
  if (blank(parsed.address)) {
    missing.push({ label: "地址", hint: "写城市和街道，一行。没有地址就拼不出联系页。" });
  }
  if (blank(parsed.hours)) {
    missing.push({ label: "营业时间", hint: "例如「周一至周五 9:00-18:00」。不知道某一天就先写确定的那段。" });
  }
  return missing;
}

async function chooseShowroom(opts, parsed, catalog) {
  const asked = opts.showroom || "auto";
  if (asked !== "auto") {
    if (!/^[a-z0-9_-]+$/.test(asked)) stepFail("挑样板间", `样板间 id 不合法：${asked}`, 2);
    const room = catalog.find((item) => item.id === asked);
    if (!room) {
      stepFail("挑样板间", `没有这套样板间：${asked}。\n可选：${catalog.map((item) => item.id).join("、")}\n或写 --showroom auto 让命令自己挑。`, 2);
    }
    console.log(`指定样板间：${room.id} ${room.name}`);
    return { ...room, ranked: [], why: "命令里指定了这一套。", modelNote: "" };
  }
  const ranked = rankShowrooms(parsed, catalog, opts.lang);
  const top = ranked.slice(0, 3);
  console.log("推荐样板间：");
  top.forEach((item, index) => {
    const why = item.reasons.length ? item.reasons.join("；") : "没有对上行业关键词";
    console.log(`${index + 1}. ${item.id} ${item.name}（${item.score}）${why}`);
  });
  const first = ranked[0];
  const second = ranked[1] || first;
  const confident = first.score >= 8 && first.score - second.score >= 4;
  if (confident || opts.fill === "agent") {
    const note = !confident && opts.fill === "agent"
      ? "前两名接近。这一步不调用外部模型，先用规则第 1 名。要换就重跑并写上 --showroom。"
      : "";
    if (note) console.log(note);
    return { ...catalog.find((item) => item.id === first.id), ranked: top, why: first.reasons.join("；"), modelNote: note };
  }
  console.log("前两名接近，请模型从这两套里选。");
  const pickedId = await askModelPick(parsed, [first, second], opts.model);
  const chosen = catalog.find((item) => item.id === pickedId) || catalog.find((item) => item.id === first.id);
  const modelNote = pickedId === first.id
    ? "模型同意规则第 1 名。"
    : `模型改选 ${chosen.id}。规则第 1 名是 ${first.id}。`;
  console.log(modelNote);
  return { ...chosen, ranked: top, why: (ranked.find((item) => item.id === chosen.id)?.reasons || []).join("；"), modelNote };
}

async function askModelPick(parsed, pair, model) {
  const list = pair.map((item) => `${item.id} ${item.name}。${item.fit} 规则分 ${item.score}。${item.reasons.join("；") || "无"}`).join("\n");
  let payload;
  try {
    payload = await askJson(
      "挑样板间",
      "你只输出一个 JSON 对象，不要解释。只能从给出的候选里选 id。不要编造档案里没有的业务。",
      `行业：${parsed.industry}\n介绍：${clipText(parsed.intro, 400)}\n\n候选：\n${list}\n\n输出 {"id":"候选id","reason":"一句中文"}`,
      model,
    );
  } catch (error) {
    console.log(`模型没选出样板间（${error.message}）。仍用规则第 1 名。`);
    return pair[0].id;
  }
  const id = String(payload.id || "").trim();
  if (!pair.some((item) => item.id === id)) {
    console.log("模型给的 id 不在候选里。仍用规则第 1 名。");
    return pair[0].id;
  }
  if (payload.reason) console.log(`模型：${clipText(payload.reason, 80)}`);
  return id;
}

function settleSiteDir(outDir, profilePath) {
  fs.mkdirSync(path.join(outDir, "photos"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "img"), { recursive: true });
  const dest = path.join(outDir, "企业档案.md");
  const src = path.resolve(profilePath);
  if (src !== path.resolve(dest)) fs.copyFileSync(src, dest);
}

function photoSource(outDir, photosOpt) {
  const dest = path.join(outDir, "photos");
  if (!photosOpt) return listImages(dest).length ? dest : "";
  const src = path.resolve(photosOpt);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    stepFail("配图", `找不到照片目录：${src}\n--photos 要指到放图片的文件夹。也可以把照片放进站点目录的 photos。`, 2);
  }
  if (src !== path.resolve(dest)) {
    for (const file of listImages(src)) fs.copyFileSync(file, path.join(dest, path.basename(file)));
    const manifest = path.join(src, "sources.json");
    if (fs.existsSync(manifest)) fs.copyFileSync(manifest, path.join(dest, "sources.json"));
  }
  return listImages(dest).length ? dest : "";
}

function siteForLint(site) {
  if (!site || typeof site !== "object" || Array.isArray(site)) return site;
  const copy = JSON.parse(JSON.stringify(site));
  const nav = copy.nav;
  if (nav && !Array.isArray(nav) && typeof nav === "object") {
    copy.nav = Array.isArray(nav.items) ? nav.items : [];
  }
  return copy;
}

function checkPageSize(value, push) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 60) push("列表 pageSize 要是 1 到 60 的整数");
}

function lintFrameworkFields(site) {
  const errors = [];
  const push = (message) => {
    if (!errors.includes(message)) errors.push(message);
  };
  if (!site || typeof site !== "object" || Array.isArray(site)) return errors;

  const nav = site.nav;
  let items = [];
  if (Array.isArray(nav)) items = nav;
  else if (nav && typeof nav === "object") {
    if (nav.autoChildren != null && nav.autoChildren !== true && nav.autoChildren !== false) {
      push("nav.autoChildren 只能是 true 或 false");
    }
    if (!Array.isArray(nav.items)) push("nav.items 必须是列表");
    else items = nav.items;
  }
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (item.autoChildren != null && item.autoChildren !== false && typeof item.autoChildren !== "string") {
      push("导航项的 autoChildren 只能是 false，或一个集合 id");
    }
    if (item.children == null) continue;
    if (!Array.isArray(item.children)) {
      push("nav.children 必须是列表");
      continue;
    }
    for (const child of item.children) {
      if (!child || !child.label || !child.href) push("nav 的二级每一项都要有 label 和 href");
    }
  }

  const topHero = site.hero;
  if (topHero && typeof topHero === "object" && (topHero.mode != null || topHero.slides != null)) {
    push("hero.mode 和 hero.slides 写在首页 hero 板块的 data 里。顶层 hero 只放 buttons");
  }

  for (const page of site.pages || []) {
    for (const section of page?.sections || []) {
      if (!section || typeof section !== "object") continue;
      if (section.type === "hero") {
        const data = section.data || {};
        if (data.mode != null && data.mode !== "carousel" && data.mode !== "single") {
          push("hero.mode 只能是 carousel 或 single");
        }
        if (data.slides != null) {
          if (!Array.isArray(data.slides)) push("hero.slides 必须是列表");
          else {
            if (data.slides.length > 9) push("hero.slides 最多 9 张");
            data.slides.forEach((slide, index) => {
              if (!slide || !slide.image || !slide.imageAlt) push(`hero.slides 第 ${index + 1} 张要有 image 和 imageAlt`);
            });
          }
        }
      }
      const bg = section.bg != null ? section.bg : section.data?.bg;
      if (bg != null) {
        if (typeof bg !== "string" || !bg.trim()) push("板块 bg 要是图片位 id");
        if (section.type === "hero" || section.type === "page-banner") push("首屏和内页横幅不要写 bg");
        else if (section.tone !== "dark" && section.tone !== "image") push("板块 bg 只在 tone 为 dark 或 image 时写");
      }
      if (section.data?.pageSize != null) checkPageSize(section.data.pageSize, push);
    }
  }
  if (site.pageSize != null) checkPageSize(site.pageSize, push);

  const codes = site.contact?.qrcodes;
  if (codes != null) {
    if (!Array.isArray(codes)) push("contact.qrcodes 必须是列表");
    else {
      codes.forEach((item, index) => {
        if (!item || !item.image || !item.label) push(`contact.qrcodes 第 ${index + 1} 项要有 image 和 label`);
      });
    }
  }
  return errors;
}

function validateAgentSite(outDir, profilePath, showroomId, lang) {
  const siteFile = path.join(outDir, "site.json");
  if (!fs.existsSync(siteFile)) {
    stepFail(
      "填内容",
      `还没有 site.json：${siteFile}\n请按 docs/SITE_JSON.md，对照样板间 ${showroomId} 的 examples/site.json，把这一家的内容写到这个文件，再跑同一条命令。\n事实只来自企业档案。这一步不调用外部模型。`,
      1,
    );
  }
  let site;
  try {
    site = JSON.parse(fs.readFileSync(siteFile, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    stepFail("填内容", `site.json 不是合法的 JSON：${error.message}\n请改 ${siteFile} 后再跑同一条命令。`, 1);
  }
  let errors;
  if (lang) {
    if (!["zh-CN", "en"].includes(lang)) stepFail("填内容", "lang 只能是 zh-CN 或 en", 2);
    site.lang = lang;
  }
  try {
    errors = lintAgentSite({ profilePath, showroomId, site: siteForLint(site) });
  } catch (error) {
    stepFail("填内容", error.message, error.code || 1);
  }
  for (const item of lintFrameworkFields(site)) {
    if (!errors.includes(item)) errors.push(item);
  }
  if (!errors.length) {
    if (lang) fs.writeFileSync(siteFile, `${JSON.stringify(site, null, 2)}\n`, "utf8");
    return;
  }
  const lines = errors.slice(0, 40).map((item, index) => `${index + 1}. ${item}`);
  const more = errors.length > 40 ? `\n……还有 ${errors.length - 40} 条，先改上面这些。` : "";
  stepFail(
    "填内容",
    `校验没过（${errors.length} 条）。请只改这些错，不要新增档案里没有的事实：\n${lines.join("\n")}${more}`,
    1,
  );
}

function publishDir(from, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  if (!fs.existsSync(from)) return;
  for (const name of fs.readdirSync(from)) {
    const file = path.join(from, name);
    if (fs.statSync(file).isFile()) fs.copyFileSync(file, path.join(dest, name));
  }
}

async function prepareImages({ outDir, showroomId, doc, photos, genImages, model, fill, say }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "fitout-img-"));
  const published = path.join(outDir, "img");
  const slots = (doc.slots || []).filter((slot) => slot && slot.id);
  const items = [];
  const taken = new Set();

  if (photos) {
    const photoDir = path.resolve(photos);
    if (!fs.existsSync(photoDir) || !fs.statSync(photoDir).isDirectory()) {
      stepFail("配图", `找不到照片目录：${photoDir}\n--photos 要指到放图片的文件夹。`, 2);
    }
    const files = listImages(photoDir);
    let matched;
    try {
      const manifestFile = path.join(photoDir, "sources.json");
      matched = matchPhotos(files, slots, fs.existsSync(manifestFile) ? readJson(manifestFile) : {});
    } catch (error) {
      stepFail("配图", error.message, 1);
    }
    const { paired, leftover } = matched;
    for (const pair of paired) {
      const saved = copyOnto(pair.file, work, pair.slot.id);
      taken.add(pair.slot.id);
      items.push(itemOf(pair.slot, pair.source, path.basename(saved), "按清单或文件名对上图片位"));
    }
    if (leftover.length && fill === "deepseek") {
      const matched = await matchByModel(leftover, slots.filter((slot) => !taken.has(slot.id)), model);
      for (const pair of matched) {
        const saved = copyOnto(pair.file, work, pair.slot.id);
        taken.add(pair.slot.id);
        items.push(itemOf(pair.slot, "photo", path.basename(saved), "按画面说明对上"));
      }
      const used = new Set(matched.map((pair) => pair.file));
      const idle = leftover.filter((file) => !used.has(file));
      if (idle.length) say(`这几张没对上图片位，没有用：${idle.map((file) => path.basename(file)).join("、")}`);
    } else if (leftover.length) {
      say(`这些照片还没有分配用途：${leftover.map((file) => path.basename(file)).join("、")}。请助手查看照片，在 photos/sources.json 的 items 里填写 id、file、source；原照片不必改名。`);
    }
  }

  const generated = [];
  if (genImages) {
    const targets = slots
      .filter((slot) => slot.tier === "must" && slot.mustBeReal === false && !taken.has(slot.id) && !findSlotFile(work, slot.id))
      .sort((a, b) => Number(a.block !== "hero") - Number(b.block !== "hero"));
    const batch = targets.slice(0, GEN_CAP);
    if (targets.length > GEN_CAP) say(`可生成 ${targets.length} 张，这次只生成前 ${GEN_CAP} 张。`);
    if (!batch.length) say("没有还缺的氛围图，不调用 MiniMax。");
    else {
      const key = String(process.env.MINIMAX_API_KEY || "").trim();
      if (!key) {
        say("跳过生图：没有配置生图密钥。站点照常拼。要氛围图时再设 MINIMAX_API_KEY，然后加上 --gen-images。必须实拍的位子不会用生成图。");
      } else {
        for (const slot of batch) {
          if (slot.mustBeReal) stepFail("配图", `必须实拍的位不能生图：${slot.id}`, 1);
          const saved = await generateSlot(doc, slot, work, showroomId, key);
          taken.add(slot.id);
          generated.push(slot.id);
          items.push(itemOf(slot, "ai", path.basename(saved), "MiniMax image-01"));
        }
      }
    }
  }

  for (const slot of slots) {
    if (taken.has(slot.id)) continue;
    if (slot.tier !== "must" && slot.mustBeReal !== true) continue;
    items.push(itemOf(slot, "missing", "", slot.mustBeReal ? "必须实拍，不能用生成图" : "还没有"));
  }

  let dir = published;
  let graded = false;
  let gradeNote = "";
  const hasFile = slots.some((slot) => findSlotFile(work, slot.id));
  if (!hasFile) {
    gradeNote = "没有图片文件，跳过调色。";
    publishDir(work, published);
  } else if (!findPlaywright()) {
    gradeNote = "跳过统一调色：没有找到 Playwright。图按原文件进站。装好之后可以再跑 scripts/images/grade.mjs。";
    publishDir(work, published);
  } else {
    fs.rmSync(published, { recursive: true, force: true });
    const gradedRun = run("images/grade.mjs", ["--showroom", showroomId, "--in", work, "--out", published], 600000);
    if (gradedRun.status !== 0) {
      publishDir(work, published);
      fs.rmSync(work, { recursive: true, force: true });
      stepFail("配图", `统一调色没通过。\n${tail(gradedRun.text || gradedRun.error)}\n看表格里没通过的那几张。修图之后重跑。`, 1);
    }
    graded = true;
    gradeNote = "已统一调色。";
    for (const item of items) {
      if (!item.file) continue;
      const jpg = `${item.id}.jpg`;
      if (fs.existsSync(path.join(published, jpg))) item.file = jpg;
    }
  }
  fs.rmSync(work, { recursive: true, force: true });
  say(`配图：实拍 ${items.filter((item) => item.source === "photo").length}，生成 ${items.filter((item) => item.source === "ai").length}，${gradeNote}`);

  const banned = items.filter((item) => item.source === "ai" && item.mustBeReal);
  if (banned.length) stepFail("配图", `生成图落在必须实拍的位：${banned.map((item) => item.id).join("、")}`, 1);

  fs.writeFileSync(path.join(dir, "sources.json"), JSON.stringify(Object.fromEntries(items.filter((item) => item.file && ["photo", "ai", "stock"].includes(item.source)).map((item) => [item.id, item.source])), null, 2) + "\n", "utf8");

  const sources = {
    showroom: showroomId,
    graded,
    gradeNote,
    items,
  };
  const sourcesFile = path.join(outDir, "sources.json");
  fs.writeFileSync(sourcesFile, `${JSON.stringify(sources, null, 2)}\n`, "utf8");
  return { dir, sources, sourcesFile, generated };
}

async function generateSlot(doc, slot, dir, showroomId, key) {
  if (slot.source === "ai") {
    const ran = run("images/gen-ai.mjs", ["--showroom", showroomId, "--out", dir, "--only", slot.id], 240000);
    usage.minimax += 1;
    if (ran.status !== 0) {
      stepFail("配图", `生成 ${slot.id} 失败。\n${tail(ran.text || ran.error)}\n看网络后重跑。已经生成的图留在站点目录的 img。`, 1);
    }
    const file = findSlotFile(dir, slot.id);
    if (!file) stepFail("配图", `生成 ${slot.id} 之后没有找到文件。`, 1);
    return file;
  }
  const mapped = aspectRatioFor(slot.ratio);
  const prompt = buildPrompt(doc, slot);
  const payload = {
    model: "image-01",
    prompt,
    aspect_ratio: mapped.aspect,
    response_format: "url",
    n: 1,
    prompt_optimizer: false,
    aigc_watermark: false,
  };
  console.log(`生成 ${slot.id}  aspect_ratio ${mapped.aspect}`);
  const endpoint = minimaxEndpoint();
  const started = Date.now();
  let response;
  let rawText = "";
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(180000),
    });
    rawText = await response.text();
  } catch (error) {
    stepFail("配图", `MiniMax 请求失败（${slot.id}）：${error.message || error}\n看网络后重跑。`, 1);
  }
  usage.minimax += 1;
  let json;
  try {
    json = JSON.parse(rawText);
  } catch {
    stepFail("配图", `MiniMax HTTP ${response.status}，响应不是 JSON（${slot.id}）：${summarizeBody(redact(rawText))}`, 1);
  }
  const base = json.base_resp || {};
  const statusCode = base.status_code == null ? null : Number(base.status_code);
  if (!response.ok || (statusCode != null && statusCode !== 0)) {
    stepFail("配图", `生成 ${slot.id} 失败。HTTP ${response.status}，status_code=${base.status_code ?? "无"}，status_msg=${base.status_msg || "无"}。看密钥和额度后重跑。`, 1);
  }
  const got = await takeImage(json);
  if (!got) stepFail("配图", `生成 ${slot.id} 的响应里没有图片。`, 1);
  const kind = sniffImage(got.buf);
  if (!kind) stepFail("配图", `生成 ${slot.id} 的结果不是图片。`, 1);
  const file = path.join(dir, `${slot.id}${kind.ext}`);
  fs.writeFileSync(file, got.buf);
  appendAiLog(path.join(dir, "ai-log.json"), {
    id: slot.id,
    mustBeReal: false,
    aspectRatio: mapped.aspect,
    httpStatus: response.status,
    baseResp: clipJson(json.base_resp || null),
    delivery: got.delivery,
    urlHost: got.host,
    file: path.basename(file),
    bytes: got.buf.length,
    elapsedMs: Date.now() - started,
  });
  console.log(`文件 ${file}  ${formatBytes(got.buf.length)}`);
  return file;
}

async function takeImage(json) {
  const urls = [];
  collectUrls(json, urls);
  const b64s = stringList(json.data && json.data.image_base64);
  if (urls.length) {
    try {
      return await fetchRemote(urls[0]);
    } catch (error) {
      if (!b64s.length) stepFail("配图", `图片下载失败：${error.message || error}`, 1);
      console.log("直链下载失败，改用响应里的 base64。");
    }
  }
  if (b64s.length) return decodeBase64(b64s[0]);
  return null;
}

function collectUrls(json, urls) {
  const data = json && json.data;
  for (const value of stringList(data && data.image_urls)) urls.push(value);
  const images = data && data.images;
  if (!Array.isArray(images)) return;
  for (const item of images) {
    if (typeof item === "string" && item.trim()) urls.push(item.trim());
    else if (item && typeof item.url === "string") urls.push(item.url.trim());
    else if (item && typeof item.image_url === "string") urls.push(item.image_url.trim());
  }
}

async function fetchRemote(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("图片地址不是 URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("图片地址协议不支持");
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`图片下载 HTTP ${response.status}`);
  const buf = Buffer.from(await response.arrayBuffer());
  if (!sniffImage(buf)) throw new Error("图片下载结果不是 png、jpeg、webp 或 gif");
  return { buf, host: parsed.host, delivery: "url" };
}

function decodeBase64(entry) {
  const match = String(entry).match(/^data:image\/[a-zA-Z0-9.+-]+;base64,([\s\S]+)$/);
  const b64 = (match ? match[1] : entry).replace(/\s/g, "");
  const buf = Buffer.from(b64, "base64");
  if (!sniffImage(buf)) throw new Error("base64 不是图片");
  return { buf, host: "", delivery: "base64" };
}

function appendAiLog(file, entry) {
  let doc = { model: "image-01", items: [] };
  if (fs.existsSync(file)) {
    try {
      const prev = JSON.parse(fs.readFileSync(file, "utf8"));
      if (prev && Array.isArray(prev.items)) doc = prev;
    } catch {
      doc = { model: "image-01", items: [] };
    }
  }
  doc.items = (doc.items || []).filter((item) => item && item.id !== entry.id);
  doc.items.push(entry);
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

async function matchByModel(files, slots, model) {
  if (!files.length || !slots.length) return [];
  const names = files.map((file) => path.basename(file));
  const brief = slots.map((slot) => `${slot.id}：${slot.desc || slot.prompt || slot.id}`).join("\n");
  let payload;
  try {
    payload = await askJson(
      "配图",
      "你只输出一个 JSON 对象。把照片文件名对到图片位 id。对不上就不要写。不要发明 id，不要一个文件对两个位。",
      `文件：\n${names.join("\n")}\n\n图片位：\n${brief}\n\n输出 {"matches":[{"file":"文件名","id":"图片位id"}]}`,
      model,
    );
  } catch (error) {
    stepFail("配图", `照片没能按画面说明对上。\n${error.message}\n把文件名改成图片位 id，例如 hero-tea.jpg，然后重跑。`, 1);
  }
  const matches = Array.isArray(payload.matches) ? payload.matches : [];
  const byName = new Map(files.map((file) => [path.basename(file), file]));
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const usedFiles = new Set();
  const usedSlots = new Set();
  const paired = [];
  for (const match of matches) {
    const file = byName.get(String(match.file || ""));
    const slot = slotById.get(String(match.id || ""));
    if (!file || !slot || usedFiles.has(file) || usedSlots.has(slot.id)) continue;
    usedFiles.add(file);
    usedSlots.add(slot.id);
    paired.push({ file, slot });
  }
  return paired;
}

function copyOnto(file, dir, id) {
  const ext = path.extname(file).toLowerCase() || ".jpg";
  const dest = path.join(dir, id + ext);
  fs.copyFileSync(file, dest);
  return dest;
}

function itemOf(slot, source, file, note) {
  return {
    id: slot.id,
    tier: slot.tier || "",
    mustBeReal: Boolean(slot.mustBeReal),
    source,
    file,
    note,
    desc: slot.desc || "",
  };
}

function writeDelivery({ outDir, picked, roomDoc, images, checkInfo, visual, siteDir, baseUrl }) {
  const site = readJson(path.join(outDir, "site.json"));
  const pages = pageReport(roomDoc, site);
  const items = images.sources.items || [];
  const photos = items.filter((item) => item.source === "photo");
  const ais = items.filter((item) => item.source === "ai");
  const missing = items.filter((item) => item.source === "missing");
  const mustReal = missing.filter((item) => item.mustBeReal);
  const lines = [];
  lines.push(`# 交付说明`);
  lines.push("");
  lines.push(`## 样板间`);
  lines.push("");
  lines.push(`用了 \`${picked.id}\`（${picked.name}）。`);
  if (picked.modelNote) lines.push(picked.modelNote);
  if (picked.why) lines.push(`理由：${picked.why}`);
  if (picked.ranked?.length) {
    lines.push("");
    lines.push("推荐前 3 套：");
    lines.push("");
    picked.ranked.forEach((item, index) => {
      lines.push(`${index + 1}. \`${item.id}\` ${item.name}（${item.score}）${item.reasons.join("；") || "没有对上行业关键词"}`);
    });
  }
  lines.push("");
  lines.push("## 这个目录");
  lines.push("");
  lines.push("改内容就改 `企业档案.md` 或 `site.json`，再跑同一条命令。");
  lines.push("");
  lines.push("- `企业档案.md`：事实来源");
  lines.push("- `site.json`：站点内容");
  lines.push("- `photos/`：你给的照片");
  lines.push("- `img/`：生成或处理后的图");
  lines.push("- `site/`：生成的网站，打开 `site/index.html`");
  lines.push("");
  lines.push(`## 页面`);
  lines.push("");
  lines.push(`开着：${pages.on.join("、") || "无"}`);
  lines.push("");
  lines.push(`关掉：${pages.off.join("、") || "无"}`);
  lines.push("");
  lines.push(`## 图片`);
  lines.push("");
  lines.push(`实拍：${labelList(photos)}`);
  lines.push("");
  lines.push(`生成：${labelList(ais)}`);
  lines.push("");
  lines.push(`缺：${labelList(missing)}`);
  lines.push("");
  lines.push(images.sources.gradeNote || "");
  lines.push("");
  lines.push(`清单在 \`sources.json\`。`);
  lines.push("");
  lines.push(`## 机检`);
  lines.push("");
  lines.push(checkInfo.line);
  if (checkInfo.warnings.length) {
    lines.push("");
    lines.push("警告：");
    lines.push("");
    for (const warning of checkInfo.warnings.slice(0, 30)) lines.push(`- ${warning}`);
  }
  lines.push("");
  lines.push(`视觉：${visual ? visual.line : "还没跑"}`);
  if (visual?.shots?.length) {
    lines.push("");
    lines.push("首屏截图：");
    lines.push("");
    for (const file of visual.shots) lines.push(`- ${file}`);
  }
  lines.push("");
  lines.push(`## 上线前要补的实拍`);
  lines.push("");
  if (!mustReal.length) lines.push("必须实拍的位子都有客户的图，或这套没有缺着的必须实拍位。");
  else {
    lines.push("这些位子必须用实拍，没有用生成图顶上。上线前补上，再跑同一条命令。");
    lines.push("");
    for (const item of mustReal) lines.push(`- \`${item.id}\`${item.desc ? `：${item.desc}` : ""}`);
  }
  lines.push("");
  lines.push(`## 怎么发布到 GitHub Pages`);
  lines.push("");
  lines.push("下面是文字步骤。这条命令不会帮你发布，也不会碰密钥。");
  lines.push("");
  lines.push("1. 在 GitHub 新建一个公开仓库，不要勾选自动生成 README。");
  lines.push("2. 把本目录里 `site` 文件夹中的全部文件放到仓库根目录，让 `index.html` 在根上，不要多套一层 `site`。");
  lines.push("3. 推送到 `main` 分支。");
  lines.push("4. 打开仓库 Settings → Pages，Source 选 Deploy from a branch，Branch 选 `main`，文件夹选 `/ (root)`，保存。");
  lines.push("5. 等一两分钟，用浏览器打开首页、关于和联系，再把窗口拉到手机宽度看一眼。");
  if (baseUrl) lines.push(`6. 这次写了 \`--base-url ${baseUrl}\`。Pages 的网址要和它一致，末尾的 \`/\` 也要在。不一致就用同一个档案重跑，换上真实网址。`);
  else lines.push("6. 上线前若要 canonical 和 sitemap，用同一个档案重跑，加上 `--base-url https://你的用户名.github.io/仓库名/`。");
  lines.push("");
  lines.push(`站点目录：\`${siteDir}\``);
  lines.push("");
  const file = path.join(outDir, "交付说明.md");
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  return file;
}

function pageReport(room, site) {
  const on = [];
  const off = [];
  for (const page of room.pages || []) {
    if (page.from) continue;
    const got = (site.pages || []).find((item) => item.id === page.id);
    const label = `${got?.title || page.id}（${page.file || page.id}）`;
    const closed = page.optional ? (!got || got.enabled === false) : got?.enabled === false;
    if (closed) off.push(label);
    else on.push(label);
  }
  return { on, off };
}

function labelList(items) {
  if (!items.length) return "无";
  return items.map((item) => `\`${item.id}\``).join("、");
}

function summarizeCheck(result) {
  const warnings = [];
  const failures = [];
  for (const line of (result.text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- [")) continue;
    if (trimmed.startsWith("- [警告")) warnings.push(trimmed.slice(2).trim());
    else failures.push(trimmed.slice(2).trim());
  }
  const failed = result.status !== 0;
  const line = failed
    ? `check.mjs 没过，失败 ${failures.length || "若干"} 条。`
    : `check.mjs：0 失败，警告 ${warnings.length} 条。`;
  return { line, warnings, failures, failed };
}

function listShots(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(png|jpg|jpeg|webp)$/i.test(entry.name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function listImages(dir) {
  return fs.readdirSync(dir)
    .filter((name) => IMAGE_EXT.has(path.extname(name).toLowerCase()))
    .map((name) => path.join(dir, name))
    .filter((file) => fs.statSync(file).isFile());
}

function writeUsage(outDir) {
  const payload = {
    deepseek: usage.deepseek,
    deepseekFill: usage.fillCalls,
    minimax: usage.minimax,
  };
  fs.writeFileSync(path.join(outDir, "用量.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function askJson(step, system, user, model) {
  const key = String(process.env.DEEPSEEK_API_KEY || "").trim();
  if (!key) stepFail(step, "没有 DEEPSEEK_API_KEY。请设在环境变量里，不要贴到聊天或写进文件。", 2);
  let response;
  let raw = "";
  try {
    response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      signal: AbortSignal.timeout(120000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: model || "deepseek-chat",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0,
        max_tokens: 800,
        response_format: { type: "json_object" },
      }),
    });
    raw = await response.text();
  } catch (error) {
    stepFail(step, `DeepSeek 请求失败：${error.message || error}`, 1);
  }
  usage.deepseek += 1;
  if (key && raw.includes(key)) stepFail(step, "模型输出异常，已丢弃", 1);
  if (!response.ok) stepFail(step, `DeepSeek HTTP ${response.status} ${redact(raw).slice(0, 180)}`, 1);
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    stepFail(step, "DeepSeek 响应不是 JSON", 1);
  }
  const content = String(payload.choices?.[0]?.message?.content || "").trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  try {
    return JSON.parse(content);
  } catch {
    stepFail(step, `模型没有返回 JSON：${clipText(content, 120)}`, 1);
  }
  return {};
}

function run(script, args, timeout) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", script), ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout,
  });
  return {
    status: res.status,
    text: redact(`${res.stdout || ""}\n${res.stderr || ""}`),
    error: res.error ? redact(res.error.message) : "",
  };
}

function parseArgs(argv) {
  const opts = { profile: "", out: "", showroom: "auto", photos: "", genImages: false, baseUrl: "", model: "deepseek-chat", fill: "agent", lang: "" };
  const needs = new Set(["--profile", "--out", "--showroom", "--photos", "--base-url", "--model", "--fill", "--lang"]);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--gen-images") {
      opts.genImages = true;
      continue;
    }
    if (!needs.has(token)) {
      console.error(USAGE);
      process.exit(2);
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      console.error(USAGE);
      process.exit(2);
    }
    i += 1;
    if (token === "--profile") opts.profile = value;
    else if (token === "--out") opts.out = value;
    else if (token === "--showroom") opts.showroom = value;
    else if (token === "--photos") opts.photos = value;
    else if (token === "--base-url") opts.baseUrl = value;
    else if (token === "--model") opts.model = value;
    else if (token === "--fill") opts.fill = value;
    else if (token === "--lang") opts.lang = value;
  }
  if (!opts.profile || !opts.out) {
    console.error(USAGE);
    process.exit(2);
  }
  if (opts.fill !== "agent" && opts.fill !== "deepseek") {
    console.error("`--fill` 只能是 agent 或 deepseek。");
    console.error(USAGE);
    process.exit(2);
  }
  return opts;
}

function tableCells(line) {
  if (!String(line).trim().startsWith("|")) return null;
  const parts = String(line).split("|").slice(1, -1).map((cell) => cell.trim());
  if (parts.length < 2) return null;
  if (/^:?-+:?$/.test(parts[0].replace(/\s/g, ""))) return null;
  return parts;
}

function aliasOf(label) {
  const key = normKey(label);
  for (const [name, aliases] of ALIASES) {
    if (aliases.some((alias) => normKey(alias) === key)) return name;
  }
  return "";
}

function normKey(value) {
  return String(value || "").replace(/\s+/g, "").replace(/／/g, "/").toLowerCase();
}

function sectionBody(text, startRe, endRe) {
  const start = text.search(startRe);
  if (start < 0) return "";
  const from = text.indexOf("\n", start);
  if (from < 0) return "";
  const rest = text.slice(from + 1);
  const end = rest.search(endRe);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

function clean(value) {
  return String(value || "").trim();
}

function blank(value) {
  const text = clean(value);
  if (!text) return true;
  return /^(待补|暂无|暂缺|无|没有|待定|未知|不详|空|待填写|未填|\/|—|-|－|无。)$/.test(text) || text.startsWith("待补");
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function hit(text, word) {
  let pos = 0;
  let neg = 0;
  for (const part of String(text).split(/[。！？；，,\n]/)) {
    if (!part.includes(word)) continue;
    if (/不是|不做|没有|而非|不招|不属于|并非|不修|不开|不要/.test(part)) neg += 1;
    else pos += 1;
  }
  if (pos && !neg) return "yes";
  if (neg && !pos) return "no";
  return "";
}

function clipText(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function tail(text, count = 30) {
  return redact(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-count).join("\n");
}

function stringList(value) {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
}

function stepFail(step, message, code = 1) {
  const error = new Error(redact(message));
  error.step = step;
  error.code = code;
  throw error;
}

function redact(text) {
  let out = String(text || "");
  for (const key of [process.env.DEEPSEEK_API_KEY, process.env.MINIMAX_API_KEY]) {
    const secret = String(key || "").trim();
    if (secret) out = out.split(secret).join("***");
  }
  return out;
}
