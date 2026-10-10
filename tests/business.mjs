/** 企业站回归：分类分页、英文、照片来源、事实、无图文字。 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { root } from "./lib.mjs";
import { fillProfile, lintAgentSite } from "../scripts/fill.mjs";
import { matchPhotos } from "../scripts/lib/photos.mjs";
import { auditFacts } from "../scripts/lib/profile-facts.mjs";
import { loadCatalog, rankShowrooms } from "../scripts/fitout.mjs";
import { findPlaywright } from "../scripts/images/lib.mjs";

const work = path.join(root, "tests", "_run", "business");
fs.mkdirSync(work, { recursive: true });
let failures = 0;
function expect(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures += 1;
}
function run(file, args, timeout = 120000) {
  return spawnSync(process.execPath, [path.join(root, file), ...args], { cwd: root, encoding: "utf8", timeout, windowsHide: true });
}
const readSite = (id) => JSON.parse(fs.readFileSync(path.join(root, "showrooms", id, "examples", "site.json"), "utf8"));
const profilePath = (id) => path.join(root, "examples", "profiles", "showrooms", `${id}.md`);
const catalog = loadCatalog();
expect("14 套可由主命令选择", catalog.length === 14 && catalog.some((room) => room.id === "intl-factory" && room.lang === "en"));
expect("中文档案能推荐英文外贸", rankShowrooms({ industry: "外贸工厂", intro: "按图制造零部件出口" }, catalog)[0]?.id === "intl-factory");
expect("英文选型仍优先匹配行业", rankShowrooms({ industry: "口腔诊所", intro: "洗牙和补牙" }, catalog, "en")[0]?.id === "cn-medical");

for (const { id } of catalog) {
  expect(`${id} 事实`, auditFacts(readSite(id), fs.readFileSync(profilePath(id), "utf8")).length === 0);
}
const changed = readSite("cn-factory");
changed.pages.find((p) => p.id === "home").sections.find((s) => s.type === "trust").data.items[0].value = "4 年";
expect("统计数值篡改被拦", auditFacts(changed, fs.readFileSync(profilePath("cn-factory"), "utf8")).some((e) => e.includes("数字口径改变")));

const install = run("scripts/install-skill.mjs", ["--target", "codex", "--dest", path.join(work, "skills")]);
const runtime = JSON.parse(fs.readFileSync(path.join(work, "skills", "fitout", "runtime.json"), "utf8"));
expect("Skill 安装与仓库定位", install.status === 0 && runtime.repository === root && fs.existsSync(path.join(work, "skills", "fitout", "SKILL.md")));
const singleShop = readSite("cn-dining");
singleShop.pages.find((page) => page.id === "join").enabled = false;
singleShop.buttons = { primary: "到店坐坐", form: "联系门店" };
const shopInput = path.join(work, "button-target.json");
const shopOut = path.join(work, "button-target");
fs.writeFileSync(shopInput, JSON.stringify(singleShop));
const shopBuild = run("scripts/build.mjs", [shopInput, "--site-dir", shopOut]);
const shopDetail = fs.readFileSync(path.join(shopOut, "products", singleShop.collections.products[0].slug + ".html"), "utf8");
expect("关闭业务后详情仍尊重到店目标", shopBuild.status === 0 && shopDetail.includes("到店坐坐") && !shopDetail.includes("谈加盟"));
const slot = { id: "hero-demo", mustBeReal: false };
const matches = matchPhotos(["照片目录/车床近景.png"], [slot], { items: [{ id: slot.id, file: "车床近景.png", source: "stock" }] });
expect("普通照片名与来源", matches.paired[0]?.source === "stock" && matches.leftover.length === 0);
let blocked = false;
try { matchPhotos(["照片目录/员工.png"], [{ id: "team", mustBeReal: true }], { items: [{ id: "team", file: "员工.png", source: "ai" }] }); } catch { blocked = true; }
expect("生成图不能顶实拍", blocked);

const log = console.log;
let english;
try {
  console.log = () => {};
  english = await fillProfile({ profilePath: profilePath("intl-factory"), showroomId: "intl-factory", outPath: path.join(work, "unused.json"), dryRun: true });
} finally { console.log = log; }
expect("英文示例填写规则", english.ok);
const agent = readSite("intl-factory");
for (const page of agent.pages) for (const section of page.sections) delete section.data.interval;
let errors = lintAgentSite({ profilePath: profilePath("intl-factory"), showroomId: "intl-factory", site: agent });
expect("英文 agent 填写规则", errors.length === 0, errors.slice(0, 2).join("；"));
agent.name = "A".repeat(80);
errors = lintAgentSite({ profilePath: profilePath("intl-factory"), showroomId: "intl-factory", site: agent });
expect("英文超长仍被拦", errors.some((e) => e.includes("店名有")));
agent.name = "World-class parts";
errors = lintAgentSite({ profilePath: profilePath("intl-factory"), showroomId: "intl-factory", site: agent });
expect("英文空话仍被拦", errors.some((e) => e.includes("[E5]")));

const pw = findPlaywright();
if (!pw) { console.error("business 未验：没有 Playwright"); process.exit(3); }
const loaded = await import(pathToFileURL(pw).href);
const browser = await (loaded.chromium || loaded.default.chromium).launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const fixture = readSite("cn-factory");
  fixture.pages.find((p) => p.id === "products").sections.find((s) => s.type === "collection-list").data.pageSize = 1;
  const input = path.join(work, "category.json");
  fs.writeFileSync(input, JSON.stringify(fixture));
  const dest = path.join(work, "category");
  const built = run("scripts/build.mjs", [input, "--site-dir", dest]);
  expect("分页分类构建", built.status === 0);
  await page.goto(pathToFileURL(path.join(dest, "index.html")).href);
  const parent = page.locator("header .nav-item.has-sub").first();
  await parent.hover();
  const machining = parent.locator(".nav-sub a").filter({ hasText: "机加件" });
  await machining.click();
  await page.waitForURL(/category/);
  expect("导航找到第二页原有产品", await page.locator("main article").count() === 1 && (await page.locator("main article").textContent()).includes("安装底板"));
  await page.locator(".pager-next").click();
  await page.waitForURL(/page\/2\.html/);
  expect("分类单独分页", (await page.locator("main article").textContent()).includes("轴套") && (await page.locator("header .is-current").first().textContent()).includes("产品中心"));
  const mainFile = pathToFileURL(path.join(dest, "products", "index.html")).href;
  // 已有 hero 的机加入口是旧锚点，回归保证它不再筛出空页。
  const oldHref = fixture.pages[0].sections[0].data.rail.find((r) => r.name === "机加").href;
  await page.goto(mainFile + oldHref.slice(oldHref.indexOf("#")));
  await page.waitForURL(/category/);
  expect("旧分类锚点兼容", await page.locator("main article").count() === 1 && page.url().includes("category"));

  const carousel = readSite("cn-factory");
  const hero = carousel.pages.find((p) => p.id === "home").sections.find((s) => s.type === "hero").data;
  hero.slides[1].primaryLabel = "查看折弯产品";
  hero.slides[1].primaryHref = "products/frame.html";
  hero.slides[1].secondaryLabel = "联系我们";
  hero.slides[1].secondaryHref = "contact/index.html";
  const carouselImages = path.join(work, "carousel-images");
  fs.mkdirSync(carouselImages, { recursive: true });
  for (const slide of hero.slides.slice(0, 3)) fs.writeFileSync(path.join(carouselImages, slide.image + ".svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><rect width="1440" height="900" fill="#142733"/></svg>');
  const carouselInput = path.join(work, "carousel.json"), carouselOut = path.join(work, "carousel");
  fs.writeFileSync(carouselInput, JSON.stringify(carousel));
  const carouselBuild = run("scripts/build.mjs", [carouselInput, "--images", carouselImages, "--site-dir", carouselOut]);
  expect("轮播按钮构建", carouselBuild.status === 0);
  await page.goto(pathToFileURL(path.join(carouselOut, "index.html")).href);
  expect("轮播只输出一组按钮", await page.locator("[data-carousel] .btn-primary").count() === 1 && await page.locator("[data-carousel] .btn").count() <= 2);
  await page.locator("[data-carousel-next]").click();
  expect("轮播按钮随当前页更新", (await page.locator("[data-hero-copy].is-current .btn-primary").textContent()) === "查看折弯产品" && (await page.locator("[data-hero-copy].is-current .btn-primary").getAttribute("href")) === "products/frame.html");
  expect("轮播二级按钮随当前页更新", (await page.locator("[data-hero-copy].is-current .btn:not(.btn-primary)").getAttribute("href")) === "contact/index.html");
  fs.writeFileSync(path.join(carouselImages, "qr-wechat.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#111"/></svg>');
  const demoClients = path.join(work, "demo-clients");
  const demoClientBuild = run("scripts/build.mjs", [carouselInput, "--demo-images", carouselImages, "--site-dir", demoClients]);
  expect("演示图库不冒充客户材料", demoClientBuild.status === 0 && !fs.existsSync(path.join(demoClients, "images", "qr-wechat.svg")));
  const realClients = path.join(work, "provided-clients");
  const realClientBuild = run("scripts/build.mjs", [carouselInput, "--images", carouselImages, "--site-dir", realClients]);
  expect("正式素材仍可使用客户文件", realClientBuild.status === 0 && fs.existsSync(path.join(realClients, "images", "qr-wechat.svg")));

  for (const id of ["cn-factory", "intl-factory", "cn-dining"]) {
    const siteDir = path.join(work, id);
    const result = run("scripts/build.mjs", [path.join(root, "showrooms", id, "examples", "site.json"), "--site-dir", siteDir]);
    expect(`${id} 无图构建`, result.status === 0);
    await page.goto(pathToFileURL(path.join(siteDir, "index.html")).href);
    const contrast = await page.evaluate(() => {
      function rgb(value) { const m = value.match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : [255, 255, 255]; }
      function lum(c) { return c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); }
      const elements = [...document.querySelectorAll('.stat-value, .stat dt, .step p, .essay .prose, .plain-intro p, [data-section="tasting"] p, .use-card p')];
      return elements.map((el) => {
        let ancestor = el;
        let bg = "rgb(255,255,255)";
        while (ancestor) { const color = getComputedStyle(ancestor).backgroundColor; if (!/rgba\([^)]*,\s*0\)$/.test(color) && color !== "transparent") { bg = color; break; } ancestor = ancestor.parentElement; }
        const a = lum(rgb(getComputedStyle(el).color)); const b = lum(rgb(bg));
        return { text: el.textContent.trim().slice(0, 30), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      });
    });
    expect(`${id} 无图正文可读`, contrast.length > 0 && contrast.every((item) => item.ratio >= 4.5), contrast.filter((item) => item.ratio < 4.5).map((item) => `${item.text} ${item.ratio.toFixed(2)}`).join("；"));
    expect(`${id} 缺素材不留占位`, await page.locator("img").count() === 0 && !(await page.locator("body").textContent()).includes("上线前替换"));
    if (id === "cn-factory" || id === "intl-factory") {
      await page.locator(".business-hero-topics a").first().click();
      const firstProduct = readSite(id).collections.products[0];
      expect(`${id} 无图首屏进入产品详情`, (await page.locator("h1").textContent()).includes(firstProduct.name) && (await page.locator("header .is-current").first().textContent()).includes(id === "cn-factory" ? "产品" : "Products"));
      await page.goto(pathToFileURL(path.join(siteDir, "index.html")).href);
    }
    if (id === "intl-factory") {
      await page.setViewportSize({ width: 768, height: 900 });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForFunction(() => {
        const height = Math.ceil(document.querySelector(".float-dock").getBoundingClientRect().height);
        return parseFloat(document.documentElement.style.getPropertyValue("--dock-h")) === height;
      });
      const clearance = await page.evaluate(() => {
        const footer = getComputedStyle(document.querySelector(".site-footer"));
        const dock = document.querySelector(".float-dock").getBoundingClientRect();
        return parseFloat(footer.paddingBottom) - dock.height;
      });
      expect("平板英文页脚给浮窗留空间", clearance >= 48);
      await page.setViewportSize({ width: 1440, height: 900 });
      for (const file of ["products/index.html", "news/index.html"]) {
        await page.goto(pathToFileURL(path.join(siteDir, file)).href);
        expect(`英文无图 ${file} 不留大字母占位`, await page.locator(".media-card-fallback").count() === 0);
      }
    }
  }
  for (const { id } of catalog.filter((room) => !["cn-factory", "intl-factory", "cn-dining"].includes(room.id))) {
    const site = readSite(id);
    const siteDir = path.join(work, id);
    const result = run("scripts/build.mjs", [path.join(root, "showrooms", id, "examples", "site.json"), "--site-dir", siteDir]);
    expect(`${id} 无图构建`, result.status === 0);
    await page.goto(pathToFileURL(path.join(siteDir, "index.html")).href);
    const firstCatalog = site.pages.find((p) => p.id === "home").sections.find((s) => Array.isArray(s.data.items) && s.data.items.some((item) => item.name));
    const text = await page.locator("main").textContent();
    expect(`${id} 无图仍保留主要业务`, firstCatalog.data.items.every((item) => text.includes(item.name)));
    const textVariant = { "cn-agriculture": "lots", "cn-auto": "services", "cn-hospitality": "stays", "cn-medical": "services" }[id];
    if (textVariant) {
      const report = JSON.parse(fs.readFileSync(path.join(siteDir, "build-report.json"), "utf8"));
      expect(`${id} 使用专门的无图目录`, report.fallbacks.some((line) => line.startsWith(textVariant + "：") && line.includes("改用 text-list")));
    }
    const contrast = await page.evaluate(() => {
      function rgb(value) { return (value.match(/[\d.]+/g) || [255, 255, 255]).slice(0, 3).map(Number); }
      function lum(c) { return c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); }
      return [...document.querySelectorAll("main [data-section] p, main [data-section] h3, main [data-section] dt")].filter((el) => el.getBoundingClientRect().width && el.getBoundingClientRect().height).map((el) => {
        let ancestor = el; let bg = "rgb(255,255,255)";
        while (ancestor) { const color = getComputedStyle(ancestor).backgroundColor; if (!/rgba\([^)]*,\s*0\)$/.test(color) && color !== "transparent") { bg = color; break; } ancestor = ancestor.parentElement; }
        const a = lum(rgb(getComputedStyle(el).color)), b = lum(rgb(bg));
        return { text: el.textContent.trim().slice(0, 30), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      });
    });
    expect(`${id} 无图正文可读`, contrast.length > 0 && contrast.every((item) => item.ratio >= 4.5), contrast.filter((item) => item.ratio < 4.5).slice(0, 5).map((item) => `${item.text} ${item.ratio.toFixed(2)}`).join("；"));
    expect(`${id} 缺素材不留占位`, await page.locator("img").count() === 0 && !(await page.locator("body").textContent()).includes("上线前替换"));
  }
  await page.close();
} finally { await browser.close(); }
process.exit(failures ? 1 : 0);
