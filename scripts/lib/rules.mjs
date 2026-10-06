/**
 * 机检规则的等级、词表和行业条件。check.mjs 只读这个文件。
 * level：block 失败（退出码 1），warn 只打印、不改变退出码。
 * 整条规则标成 warn 时，这条下面的分项也全部降为 warn。
 *
 * 行业和细分从 industries/registry.json 读。
 * 细分的 ruleFlags 盖过行业级；没写的项沿用行业。没写 niche 时只用行业级。
 * 未登记的 industry / niche 由 build、new-showroom、check、check-distinct 报中文错误。
 */
import path from "path";
import { fileURLToPath } from "url";
import { readJson } from "./json.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const registry = readJson(path.join(root, "industries", "registry.json"));
const industries = Array.isArray(registry.industries) ? registry.industries : [];
const FLAG_DEFAULTS = {
  serifTitles: false,
  satFull: false,
  beigeTerracotta: "block",
  purpleAccent: false,
};
const BEIGE = new Set(["ok", "warn", "block"]);

function checkFlags(flags, where) {
  if (!flags) return;
  if (flags.beigeTerracotta !== undefined && !BEIGE.has(flags.beigeTerracotta)) {
    throw new Error(`${where} 的 beigeTerracotta 只能是 ok、warn、block`);
  }
}

function assertRegistry() {
  const ids = new Set();
  const niches = new Set();
  for (const industry of industries) {
    if (!industry || typeof industry.id !== "string" || !industry.id) {
      throw new Error("industries/registry.json 有一条行业缺少 id");
    }
    if (ids.has(industry.id)) throw new Error(`行业 id 重复：${industry.id}`);
    ids.add(industry.id);
    checkFlags(industry.ruleFlags, `行业 ${industry.id}`);
    for (const niche of industry.niches || []) {
      if (!niche || typeof niche.id !== "string" || !niche.id) {
        throw new Error(`行业 ${industry.id} 有一条细分缺少 id`);
      }
      if (niches.has(niche.id)) throw new Error(`细分 id 重复：${niche.id}`);
      niches.add(niche.id);
      checkFlags(niche.ruleFlags, `细分 ${niche.id}`);
    }
  }
}

assertRegistry();

const byId = new Map(industries.map((item) => [item.id, item]));

export const INDUSTRIES = industries.map((item) => item.id);
export const NICHES = industries.flatMap((item) => (item.niches || []).map((niche) => niche.id));

export function industryError(id) {
  const name = String(id || "");
  if (!name) return "";
  if (!byId.has(name)) return `未登记的 industry：${name}`;
  return "";
}

export function nicheError(industryId, nicheId) {
  const niche = String(nicheId || "");
  if (!niche) return "";
  const industry = byId.get(String(industryId || ""));
  if (!industry) return "";
  if ((industry.niches || []).some((item) => item.id === niche)) return "";
  return `未登记的 niche：${niche}`;
}

function resolveFlags(site) {
  const industry = byId.get(String(site?.industry || ""));
  const flags = { ...FLAG_DEFAULTS, ...(industry?.ruleFlags || {}) };
  const nicheId = String(site?.niche || "");
  if (!industry || !nicheId) return flags;
  const niche = (industry.niches || []).find((item) => item.id === nicheId);
  if (!niche) return flags;
  return { ...flags, ...(niche.ruleFlags || {}) };
}

export const RULES = {
  A1: { level: "block", text: "调色板要算成 3 到 5 色，token 必须是 #RRGGBB" },
  A3: { level: "block", text: "大面积底色保持中性或深色。高饱和色最多铺 3 个整宽色块。注册表 satFull 为真的可以整屏高饱和" },
  A6: { level: "block", text: "文字和背景的对比度至少 4.5，大字至少 3，含链接色、卡片上的价格，以及压在图片上的字" },
  A7: { level: "block", text: "允许首屏压暗渐变，另加装饰性渐变最多 2 处。仍禁渐变文字和紫蓝青铺满" },
  A8: { level: "block", text: "不用纯黑，正文和次级字不走纯灰" },
  A9: { level: "block", text: "样板间首页用两层底色加图块，深浅切换至少 3 次。不再要求整页只有一个明暗" },
  A10: { level: "block", text: "紫色可以当注册表允许的强调色，不能当大面积底，也不能当其他行业的主色" },
  A11: { level: "block", text: "米色加陶土按注册表：ok 不报，warn 只警告，block 失败" },
  B1: { level: "block", text: "整份 CSS 里实际用到的字体族不超过 2 个" },
  B3: { level: "block", text: "字号不小于 14px" },
  B6: { level: "block", text: "桌面首屏标题 60 到 110px。手写展示字可以到 173px，并且不超过 4 个词。国际风同样到 110px" },
  B7: { level: "block", text: "正文字体栈的第一个不能是中文字体" },
  B10: { level: "block", text: "衬线标题只给注册表里 serifTitles 为真的行业或细分。不再因为字体名字本身拦截" },
  C3: { level: "block", text: "有 viewport，且不许禁止缩放。容器宽 1152 到 1340" },
  C5: { level: "block", text: "导航高度不超过 110px。叠在图上、带信息条的可以到 160px" },
  C8: { level: "block", text: "6 个及以上板块时，版式家族至少 4 种，且不能重复" },
  C9: { level: "block", text: "首屏按钮最多 2 个，而且是同一个意图" },
  C14: { level: "block", text: "首屏标题：中文不超过 14 字，英文不超过 10 个词" },
  D2: { level: "block", text: "过渡只写 transform 和 opacity，并尊重减少动效" },
  D3: { level: "block", text: "整页只用一套入场。入场动画类型最多 2 种。全页循环微动效不允许多于 1 条" },
  D5: { level: "block", text: "脚本不监听滚动" },
  D6: { level: "block", text: "首屏轮播 3 到 9 张，间隔 3 到 5 秒，有箭头和指示点，悬停暂停，减少动效时停止" },
  E2: { level: "block", text: "可见文字和 alt、说明文字里不用 emoji，也不打星" },
  E4: { level: "block", text: "样板间首页至少 12 张图，其中至少 2 张满宽。演示模式降为警告" },
  E5: { level: "block", text: "空话。中文站：赋能等为失败，打造和 Elevate、Seamless、Unleash、Next-Gen 为警告。英文站改用英文词表，命中即失败" },
  E6: { level: "block", text: "按钮不用提交、了解更多、点击这里，以及绕过写法" },
  E9: { level: "block", text: "档案里有备案号时，页脚必须出现原文" },
  F3: { level: "block", text: "框架 CSS 不写死颜色、圆角、阴影，不用 transition:all 和 background-clip:text" },
  SEO: { level: "block", text: "语言、title、description、Open Graph、首页 JSON-LD" },
  ALT: { level: "block", text: "有图片就必须有非空 alt" },
  结构: { level: "block", text: "页面骨架：h1、header、footer、悬浮、电话、id 不重复" },
  口径: { level: "block", text: "标题和按钮不用 em dash。中文站和英文站一样，正文不查" },
  链接: { level: "block", text: "站内链接、锚点和图片都要存在，目录链接不行" },
  残留: { level: "block", text: "不留模板残留和占位词" },
  篇幅: { level: "block", text: "店名、标题、说明、地址有字数上限。英文站同一上限乘 2.2，向上取整，仍按去掉空白后的码点" },
  spec: { level: "block", text: "字段符合板块 spec" },
  图片: { level: "warn", text: "单张图片超过 400KB，或一页合计超过 1.5MB" },
  图片位: { level: "block", text: "每个 img 要有 width 和 height，或写 aspect-ratio。同一组若用 aspect-ratio 和 object-fit:cover 锁住显示框，就按框检查；否则仍比原图比例" },
  降级: { level: "warn", text: "拼装时缺图改了版式。退出码仍看有没有 block" },
  口号: { level: "warn", text: "首屏口号不要套示例句式，按企业档案重写" },
  重复: { level: "warn", text: "首页同一个短句出现 3 次及以上，或同一个数字加单位出现在 3 个板块里。英文站按词，短句至少 4 个词" },
  实拍: { level: "block", text: "mustBeReal 的位不能标成 ai。没有 sources.json 时只警告，无法确认实拍" },
  样板间: { level: "block", text: "样板间版式不写死这套示例站的 slug、id、专有名词和电话" },
};

export const HIGH_SAT_BANDS = 3;
export const HERO_PX = { min: 60, max: 110, script: 173 };
export const SECTION_Y = { desktopMin: 80, desktopMax: 160, mobileMin: 48, mobileMax: 72 };
/** 国际风首屏高度只在 check-visual 里量。国内风不套这道，凡科中位大约 0.74 屏。 */
export const FLAVOR_LIMITS = {
  cn: { heroMin: 60, heroMax: 110, sectionYMin: 80, sectionYMax: 160, heroViewport: null },
  intl: { heroMin: 60, heroMax: 110, sectionYMin: 80, sectionYMax: 160, heroViewport: { min: 0.85, max: 1 } },
};
export const EN_CHAR_FACTOR = 2.2;
export const NAV_PX = { max: 110, overlay: 160 };
export const CONTAINER = { min: 1152, max: 1340 };

export const E5_WORDS = [
  { word: "赋能", level: "block" },
  { word: "革命性", level: "block" },
  { word: "颠覆性", level: "block" },
  { word: "一站式", level: "block" },
  { word: "全方位", level: "block" },
  { word: "领先的", level: "block" },
  { word: "打造", level: "warn" },
  { word: "Elevate", level: "warn", boundary: "en" },
  { word: "Seamless", level: "warn", boundary: "en" },
  { word: "Unleash", level: "warn", boundary: "en" },
  { word: "Next-Gen", level: "warn", boundary: "en" },
];

/** 英文站空话。整词命中即失败。连字符算在词里面，大小写不敏感。 */
export const E5_WORDS_EN = [
  { word: "Seamless", level: "block", boundary: "en" },
  { word: "Elevate", level: "block", boundary: "en" },
  { word: "Unleash", level: "block", boundary: "en" },
  { word: "Cutting-edge", level: "block", boundary: "en" },
  { word: "World-class", level: "block", boundary: "en" },
  { word: "Next-gen", level: "block", boundary: "en" },
  { word: "Revolutionary", level: "block", boundary: "en" },
  { word: "One-stop", level: "block", boundary: "en" },
];

export function phrasesFor(lang) {
  return lang === "en" ? E5_WORDS_EN : E5_WORDS;
}

/** 英文上限 = ceil(中文上限 × 2.2)。中文站原数不动。 */
export function textLimit(maxChars, lang) {
  const n = Number(maxChars);
  if (!Number.isFinite(n)) return n;
  if (lang !== "en") return n;
  return Math.ceil(n * EN_CHAR_FACTOR - 1e-9);
}

export const E6_WORDS = [
  "提交",
  "了解更多",
  "点击这里",
  "点击查看",
  "查看详情",
  "立即提交",
  "submit",
  "learnmore",
  "clickhere",
  "readmore",
];

export const PLACEHOLDERS = [
  { label: "待补充", pattern: "待补充" },
  { label: "待补", pattern: "待补" },
  { label: "TODO", pattern: "\\bTODO\\b", flags: "i" },
  { label: "XX", pattern: "(?:^|[^A-Za-z0-9])XX(?:[^A-Za-z0-9]|$)" },
  { label: "示例", pattern: "示例" },
  { label: "请填写", pattern: "请填写" },
  { label: "Ipsum", pattern: "ipsum", flags: "i" },
  { label: "Jane Doe", pattern: "jane doe", flags: "i" },
  { label: "张三", pattern: "张三" },
  { label: "李四", pattern: "李四" },
  { label: "test@", pattern: "test@", flags: "i" },
  { label: "123-4567-8900", pattern: "123[\\s-]*4567[\\s-]*8900" },
];

export const LIMITS = {
  name: 16,
  title: 30,
  description: 80,
  address: 40,
  heroZh: 14,
  heroEnWords: 10,
  scriptWords: 4,
};

export const CONTRAST_PAIRS = [
  ["正文/背景", "text", "bg"],
  ["正文/表面", "text", "surface"],
  ["次级字/背景", "text-muted", "bg"],
  ["次级字/表面", "text-muted", "surface"],
  ["主按钮字/主色", "primary-contrast", "primary"],
  ["强调色/背景", "accent", "bg"],
  ["链接色/背景", "primary", "bg"],
  ["链接色/表面", "primary", "surface"],
  ["价格/卡片", "accent", "surface"],
];

export const SAT_KEYS = ["bg", "primary", "accent"];
export const SAT_MAX = 0.8;

export const PURPLE_HUE = { min: 235, max: 320, sat: 0.2 };
export const BANNED_HEX = ["#8b5cf6", "#06b6d4", "#667eea", "#764ba2"];
export const CJK_FONT = "PingFang|Hiragino|STHeiti|STSong|Heiti|SimSun|SimHei|Microsoft YaHei|Microsoft JhengHei|Noto Sans|Noto Serif|Source Han|WenQuanYi|Songti|FangSong|KaiTi|华文|微软雅黑|苹方|宋体|黑体|思源";

export const NAMED_COLORS = [
  "black", "white", "red", "blue", "green", "gray", "grey", "purple", "orange", "yellow",
  "pink", "cyan", "magenta", "brown", "navy", "teal", "silver", "gold", "indigo", "violet",
  "beige", "ivory",
];

export function levelOf(rule) {
  return RULES[rule]?.level === "warn" ? "warn" : "block";
}

export function phraseLevel(rule, itemLevel) {
  if (levelOf(rule) === "warn") return "warn";
  return itemLevel === "warn" ? "warn" : "block";
}

export function satFull(site) {
  return resolveFlags(site).satFull === true;
}

export function purpleAccentOk(site) {
  return resolveFlags(site).purpleAccent === true;
}

export function serifOk(site) {
  return resolveFlags(site).serifTitles === true;
}

/** 返回 block、warn，或不报（null）。 */
export function a11Level(site) {
  const value = resolveFlags(site).beigeTerracotta;
  if (value === "ok") return null;
  if (value === "warn") return "warn";
  return "block";
}

export function heroTitleIssue(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const cjk = raw.match(/[\u3400-\u9fff]/g) || [];
  if (cjk.length > 0) {
    const n = raw.replace(/\s+/g, "").length;
    if (n > LIMITS.heroZh) return `有 ${n} 字，超过 ${LIMITS.heroZh} 字`;
    return null;
  }
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length > LIMITS.heroEnWords) return `有 ${words.length} 个词，超过 ${LIMITS.heroEnWords} 个词`;
  return null;
}
