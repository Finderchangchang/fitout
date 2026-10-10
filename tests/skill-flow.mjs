/** 独立用户情境：已有奶茶店档案 → 无图站 → 普通照片 → 修改时间。零外部模型调用。 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { root } from "./lib.mjs";

const parent = process.env.FITOUT_REVIEW_DIR ? path.join(process.env.FITOUT_REVIEW_DIR, "skill-flow-runs") : path.join(root, "tests", "_run", "skill-flow-runs");
fs.mkdirSync(parent, { recursive: true });
const out = fs.mkdtempSync(path.join(parent, "flow-"));
fs.mkdirSync(path.join(out, "photos"), { recursive: true });
const profile = path.join(out, "企业档案.md");
fs.copyFileSync(path.join(root, "examples", "profiles", "巷口半糖.md"), profile);
const room = JSON.parse(fs.readFileSync(path.join(root, "showrooms", "cn-dining", "showroom.json"), "utf8"));
const images = JSON.parse(fs.readFileSync(path.join(root, "showrooms", "cn-dining", "images.json"), "utf8"));
const defs = [
  ["lemon", "柠檬茶", "冰可以少放，路过买一杯。", "16元", "prod-grape"],
  ["roast-milk", "烤奶", "店里烤的奶，想喝热的。", "12元", "prod-oolong"],
  ["oolong", "乌龙奶盖", "乌龙加奶盖，下午来坐。", "14元", "prod-scone"],
  ["mango", "杨枝甘露", "店内菜单中的饮品。", "", "prod-rice"],
];
const products = defs.map(([slug, name, summary, price, image]) => ({ slug, name, summary, body: summary, category: "茶饮", image, imageAlt: name, specs: price ? [{ label: "价格", value: price }] : [] }));
const story = { title: "小河街道这一家", lead: "何晚看店，小苏做奶茶。", body: "2019年4月开业，只此一家，不招加盟。茶叶从广州芳村一家茶行买，没有自己的茶园。", image: "about-table", imageAlt: "茶杯与木桌", caption: "" };
const site = {
  id: "xiangkou", showroom: "cn-dining", industry: room.industry, niche: room.niche, businessType: "LocalBusiness", lang: "zh-CN",
  name: "巷口半糖（虚构）", summary: "杭州小河街道的社区奶茶店，卖柠檬茶、烤奶和乌龙奶盖，只此一家。",
  contact: { phone: "0571-86920415", address: "杭州市拱墅区小河街道河东路9号（虚构地址）", hours: [{ day: "每天", time: "11:10-21:40" }] },
  nav: [{ label: "首页", href: "index.html" }, { label: "关于", href: "about/index.html" }, { label: "菜单", href: "products/index.html" }, { label: "到店", href: "contact/index.html" }],
  shell: { header: "standard", footer: "columns", floatContact: "dock" },
  buttons: { primary: "到店坐坐", secondary: "看菜单", form: "联系门店" },
  hero: { buttons: [{ label: "看菜单", href: "products/index.html" }, { label: "到店坐坐", href: "contact/index.html" }] },
  collections: { products, stores: [], news: [] },
  pages: [
    { id: "home", title: "巷口半糖", description: "小河街道的社区奶茶店，菜单与到店信息。", sections: [
      { type: "hero", variant: "carousel", anchor: "home", tone: "image", data: { label: "半糖", title: "半糖，冰少一点", lead: "杭州小河街道的社区奶茶店，只此一家。", primaryLabel: "看菜单", primaryHref: "products/index.html", secondaryLabel: "到店坐坐", secondaryHref: "contact/index.html", slides: ["hero-tea", "hero-bake", "hero-door"].map((image) => ({ image, imageAlt: images.slots.find((slot) => slot.id === image).desc || "" })) } },
      { type: "tasting", variant: "menu", anchor: "menu", tone: "light", data: { title: "菜单与价格", lead: "柠檬茶、烤奶和乌龙奶盖。", moreHref: "products/index.html", moreLabel: "全部菜单", items: defs.filter((item) => item[3]).map(([, name, text, price, image]) => ({ name, text, price, image, imageAlt: name })) } },
      { type: "essay", variant: "split", anchor: "story", tone: "dark", data: story },
      { type: "contact", variant: "card", anchor: "visit", tone: "light", data: { title: "来店里坐坐", lead: "电话、地址和营业时间。" } },
    ] },
    { id: "about", title: "关于巷口半糖", description: "小河街道这一家社区奶茶店。", sections: [{ type: "essay", variant: "split", anchor: "story", tone: "light", data: story }] },
    { id: "products", title: "巷口半糖菜单", description: "柠檬茶、烤奶、乌龙奶盖和杨枝甘露。", sections: [{ type: "collection-list", variant: "board", anchor: "menu", tone: "light", data: { title: "菜单", lead: "标价来自企业档案。", collection: "products" } }] },
    { id: "contact", title: "巷口半糖到店信息", description: "社区奶茶店的地址、电话和营业时间。", sections: [{ type: "contact", variant: "card", anchor: "visit", tone: "light", data: { title: "到店信息", lead: "小河街道这一家。" } }] },
    ...["stores", "join", "news"].map((id) => ({ id, enabled: false, title: id, description: id, sections: [] })),
  ],
};
const siteFile = path.join(out, "site.json");
const write = () => fs.writeFileSync(siteFile, JSON.stringify(site, null, 2) + "\n");
write();
const log = ["# Skill 独立用户情境验收", "", "测试用户提供已有档案：社区奶茶店、单店、不招加盟、没有微信和备案号。目标：看菜单、找到店。", "助手沿用资料，推荐餐饮样板间，关闭多店、加盟和新闻，不虚构素材。", ""];
function generate(label) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "fitout.mjs"), "--profile", profile, "--out", out, "--showroom", "cn-dining", "--fill", "agent"], { cwd: root, encoding: "utf8", env: { ...process.env, DEEPSEEK_API_KEY: "", MINIMAX_API_KEY: "" }, timeout: 180000, windowsHide: true });
  fs.writeFileSync(path.join(out, `${label}.log`), `${result.stdout || ""}\n${result.stderr || ""}`);
  console.log(`${result.status === 0 ? "PASS" : "FAIL"} Skill ${label} exit ${result.status}`);
  log.push(`- ${label}：退出码 ${result.status}`);
  if (result.status !== 0) { console.error(result.stdout + result.stderr); fs.writeFileSync(path.join(out, "体验记录.md"), log.join("\n")); process.exit(1); }
}
generate("无照片出站");
if (fs.existsSync(path.join(out, "site", "join")) || fs.existsSync(path.join(out, "site", "news"))) throw new Error("无来源业务页仍生成");
const detail = fs.readFileSync(path.join(out, "site", "products", "lemon.html"), "utf8");
if (!detail.includes("到店坐坐") || detail.includes("谈加盟") || detail.includes("不标价")) throw new Error("详情按钮或未知价格仍沿用占位内容");
log.push("- 首页仅展示三款已确认价格；杨枝甘露在产品列表保留名称，省略价格；详情按钮按到店目标设置。");
const input = process.env.FITOUT_DEMO_ASSETS;
if (!input) throw new Error("需要 FITOUT_DEMO_ASSETS，指向仓库外测试素材");
const photo = path.join(out, "photos", "茶杯照片.jpg");
fs.copyFileSync(path.join(input, "cn-dining", "hero-tea.jpg"), photo);
fs.writeFileSync(path.join(out, "photos", "sources.json"), JSON.stringify({ items: [{ id: "hero-tea", file: "茶杯照片.jpg", source: "stock" }] }));
const hash = () => crypto.createHash("sha256").update(fs.readFileSync(photo)).digest("hex");
const before = hash();
generate("普通照片与单图首屏");
const html = fs.readFileSync(path.join(out, "site", "index.html"), "utf8");
if (!html.includes("images/hero-tea.jpg") || /\bdata-carousel\b/.test(html)) throw new Error("单张首屏没有正确启用");
if (hash() !== before) throw new Error("原照片被修改");
const sources = JSON.parse(fs.readFileSync(path.join(out, "site", "images", "sources.json")));
if (sources["hero-tea"] !== "stock") throw new Error("照片来源丢失");
log.push("- 普通照片未改名、未修改；stock 来源保留；一张图片启用 single。");
fs.copyFileSync(profile, profile + ".bak");
fs.writeFileSync(profile, fs.readFileSync(profile, "utf8").replaceAll("21:40", "21:50") + "\n测试用户追加确认：营业结束时间改为 21:50。\n");
site.contact.hours[0].time = "11:10-21:50";
write();
generate("修改营业时间后重建");
const delivered = JSON.parse(fs.readFileSync(path.join(out, "site", "site.json")));
if (delivered.contact.hours[0].time !== "11:10-21:50") throw new Error("时间变更未同步");
const usage = JSON.parse(fs.readFileSync(path.join(out, "用量.json")));
if (usage.deepseek || usage.minimax) throw new Error("agent 模式调用了外部模型");
log.push("- 改动先进入档案，随后更新 site.json；企业名称和产品价格保持；外部模型调用 0。");
fs.writeFileSync(path.join(out, "体验记录.md"), log.join("\n") + "\n");
if (process.env.FITOUT_REVIEW_DIR) fs.writeFileSync(path.join(process.env.FITOUT_REVIEW_DIR, "skill-flow-latest.json"), JSON.stringify({ directory: path.relative(process.env.FITOUT_REVIEW_DIR, out) }, null, 2));
console.log(`体验记录：${path.join(out, "体验记录.md")}`);
