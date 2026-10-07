/**
 * node tests/visual-negatives.mjs [--only L3,L8] [--keep]
 * 版式检查的反例测试：每一项新检查都要先有一个能拦住它的反例。
 * 做法：拼出演示工厂站（框架自带版式，无样板间），复制一份，往里塞一处会犯这条规则的 CSS 或 HTML，
 * 跑 check-visual.mjs，必须失败并且点名这条规则。没改动的原站也跑一遍，必须通过。
 * 需要 Playwright（PLAYWRIGHT_PATH 指到入口文件或包目录都行，没设置就按 Node 正常的模块解析找）。找不到就打印「跳过」并退出 3。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = path.join(root, "tests", "_run", "vneg");
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;

const svg = (text, size) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><rect width="100%" height="100%" fill="#e7e2d8"/><text x="50%" y="50%" text-anchor="middle" font-size="${size}">${text}</text></svg>`)}`;
const portraitSvg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000"><rect width="100%" height="100%" fill="#c4b8a8"/></svg>')}`;
const landSvg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="100%" height="100%" fill="#8a9a88"/></svg>')}`;
const landSvgB = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="100%" height="100%" fill="#445566"/></svg>')}`;
const faceBanner = (extra) => `<section class="page-banner" data-section="page-banner" data-family="pagehead" data-fullbleed><img class="page-banner-img${extra}" src="${portraitSvg}" alt="" width="800" height="1000"><div class="page-banner-scrim"></div><div class="container page-banner-copy" data-on-media><p class="crumbs"><a href="index.html">首页</a><span aria-hidden="true">/</span><span>当前页</span></p><h1 class="section-title">页名</h1></div></section>`;
const landBanner = (src) => `<section class="page-banner" data-section="page-banner" data-family="pagehead" data-fullbleed><img class="page-banner-img" src="${src}" alt="" width="1200" height="800"><div class="page-banner-scrim"></div><div class="container page-banner-copy" data-on-media><p class="crumbs"><a href="index.html">首页</a><span aria-hidden="true">/</span><span>当前页</span></p><h1 class="section-title">页名</h1></div></section>`;
const orphanBox = (text) => sec(`<div style="border-bottom:1px solid var(--border)"></div><h2 class="section-title">配图说明</h2><p style="width:4.15em;max-width:4.15em;font-size:20px;line-height:1.4;text-wrap:wrap;letter-spacing:0;overflow-wrap:anywhere;font-family:'Microsoft YaHei','Segoe UI',sans-serif">${text}</p>`);
const sec = (inner) => `<section class="section" data-section="neg" data-family="neg"><div class="container">${inner}</div></section>`;
const banner = `<section class="page-banner" data-section="page-banner" data-family="pagehead" data-fullbleed><div class="page-banner-scrim"></div><div class="container page-banner-copy" data-on-media><p class="crumbs"><a href="index.html">首页</a><span aria-hidden="true">/</span><a href="about/index.html">关于</a><span aria-hidden="true">/</span><span>当前页</span></p><h1 class="section-title">页名</h1></div></section>`;
const lines = (n) => Array.from({ length: n }, (_, i) => `<p>第 ${i + 1} 行文字，占着高度。</p>`).join("");
const cards = (n) => Array.from({ length: n }, (_, i) => `<div class="card"><h3>卡片 ${i + 1}</h3><p>一小段说明，撑出卡片的高度。</p><p>再来一行。</p></div>`).join("");

// rule：必须出现在输出里的文字；css 追加到 assets/site.css；html 塞进 </main> 前面（top 为真塞在 <main> 开头）。
// control 为真的是对照：不该报。full 为真时跑完整视觉检查。
const cases = [
  { id: "L1-ok", control: true, page: "about/index.html", width: 1440, top: true, html: banner, note: "面包屑按框架样式：必须通过" },
  { id: "L1", rule: "版式[L1]", page: "about/index.html", width: 1440, top: true, html: banner, css: ".crumbs > span{align-self:flex-start;min-height:0;display:block}", note: "面包屑的「/」和当前页贴在 44px 盒子顶部，比链接高 8px（老 bug 原样复现）" },
  { id: "L2a", rule: "版式[L2] 页脚底部空白过大", page: "index.html", width: 1440, css: ".site-footer{padding-bottom:12rem !important}", note: "页脚底部固定 12rem 空白" },
  { id: "L2b", rule: "版式[L2] 页脚下面还露出一条底色", page: "index.html", width: 375, css: "body{padding-bottom:4.5rem}", note: "手机页脚下面 body 垫出一条浅色" },
  { id: "L3a", rule: "版式[L3] 页脚图标贴着文字", page: "index.html", width: 1440, css: ".site-footer a:has(> .icon){gap:0 !important}", note: "页脚图标和字零间距" },
  { id: "L3b", rule: "版式[L3] 页脚图标没对齐第一行字", page: "index.html", width: 1440, css: ".site-footer a:has(> .icon){align-items:center !important;max-width:9rem !important}.site-footer a > .icon-16{margin-top:0 !important}", note: "两行地址的图标居中在两行之间，不在第一行（老 bug 原样复现）" },
  { id: "L4", rule: "版式[L4] 占位图里的字小于 12px", page: "index.html", width: 1440, html: sec(`<img src="${svg("微信二维码 · 上线前替换", 36)}" width="160" height="160" alt="">`), note: "800 画布里写 36 号字，显示 160px 宽，实际 7.2px" },
  { id: "L5", rule: "版式[L5] 文字小于 12px", page: "index.html", width: 1440, html: sec(`<p style="font-size:10px">十号字压在这里</p>`), note: "10px 的字" },
  { id: "L6a", rule: "版式[L6] 可见文字里有内部键名：qr-wechat", page: "index.html", width: 1440, html: sec(`<p>qr-wechat · 上线前替换</p>`), note: "正文里露出键名 qr-wechat" },
  { id: "L6b", rule: "版式[L6] 可见文字里有内部键名：qr-mini", page: "index.html", width: 1440, html: sec(`<img src="${svg("qr-mini", 120)}" width="320" height="320" alt="">`), note: "占位图里的字是键名 qr-mini（字够大，只触发 L6）" },
  { id: "L6c", base: "room", rule: "版式[L6] 可见文字里有内部键名：hero-court", page: "index.html", width: 1440, html: sec(`<p>hero-court</p>`), note: "样板间 images.json 里的图片位 id（hero-court）出现在正文里" },
  { id: "L7", rule: "版式[L7] 文字被 overflow 裁掉", page: "index.html", width: 1440, html: sec(`<div style="width:200px;height:24px;overflow:hidden"><p>这是一段会被裁掉的很长的文字，这是一段会被裁掉的很长的文字，这是一段会被裁掉的很长的文字。</p></div>`), note: "盒子高 24px，文字有好几行" },
  { id: "L8", rule: "版式[L8] 同一列的按钮宽度不一", page: "index.html", width: 1440, html: sec(`<p><a class="btn" href="#">短</a></p><p><a class="btn" href="#">按钮长一点的字</a></p>`), note: "两个按钮各占一行、宽度不同" },
  { id: "L9", rule: "版式[L9] 联系区左右栏高度失衡", page: "index.html", width: 1440, html: `<section class="section" data-section="contact" data-family="neg"><div class="container" style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start"><div>${lines(12)}</div><div><p>右栏只有一行</p></div></div></section>`, note: "左栏 12 行，右栏 1 行" },
  { id: "L10", rule: "版式[L10] 同行多栏顶边没对齐", page: "index.html", width: 1440, html: sec(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start"><div>${lines(3)}</div><div style="margin-top:64px"><p>右栏被推下去 64px</p></div></div>`), note: "两栏顶边差 64px，也不是居中" },
  { id: "L11a", rule: "版式[L11] 板块内容没贴齐容器左缘", page: "index.html", width: 1440, html: sec(`<div style="margin-left:280px"><h2>整块缩进的标题</h2><p>整块缩进的正文</p></div>`), note: "整个板块的内容比容器左缘靠右 280px，又不是居中" },
  { id: "L11b", rule: "版式[L11] 标题文字和它下面那段字的左缘没对齐", page: "index.html", width: 1440, html: sec(`<h2 style="padding-left:15px">带标记的标题</h2><p>下面的导语</p>`), note: "标题字被推右 15px，导语留在原位" },
  { id: "L12", rule: "版式[L12] 手机页脚各栏之间没有间距", page: "index.html", width: 375, css: ".footer-grid{display:block !important}", note: "手机页脚 grid 改回 block，各栏零间距" },
  { id: "L13", rule: "版式[L13] 导航项之间的间距不均", page: "index.html", width: 1440, css: ".nav-list{gap:.5rem 1rem !important}.nav-list a{padding-inline:0 !important;justify-content:flex-start !important}", note: "导航项字靠左，两字项后面多出一截（老 bug 原样复现）" },
  { id: "L14", rule: "版式[L14] 首屏文案各项之间没有间距", page: "index.html", width: 1440, css: ".hero-in{display:block !important}.hero-in > *{margin:0 !important}", note: "首屏标题、导语、按钮零间距" },
  { id: "L15", rule: "版式[L15] 短文字折成了几行", page: "index.html", width: 1440, html: sec(`<dl><dd style="width:70px;font-size:30px;margin:0">0.2 mm</dd></dl>`), note: "「0.2 mm」折成两行" },
  { id: "L16", rule: "版式[L16] 网格末行只剩一张卡", page: "index.html", width: 1440, html: sec(`<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px">${cards(4)}</div>`), note: "4 张等宽卡片排 3 列：3 + 1，末行孤零零一张" },
  { id: "L16-ok", control: true, page: "index.html", width: 1440, html: sec(`<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px">${cards(6)}</div>`), note: "6 张排 3 列：3 + 3，必须通过" },
  { id: "L16-768", rule: "版式[L16] 网格末行只剩一张卡", page: "index.html", width: 768, html: sec(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">${cards(3)}</div>`), note: "768 两列 3 张：2 + 1，末行孤零零一张" },
  { id: "L16-768-ok", control: true, page: "index.html", width: 768, html: sec(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">${cards(4)}</div>`), note: "768 两列 4 张：2 + 2，必须通过" },
  { id: "L17", rule: "版式[L17] 半宽空白板块", page: "index.html", width: 1440, html: sec(`<h2 class="section-title">只占左边一小块</h2><p class="section-lead" style="max-width:20rem">下面和右边什么都没有，内容只有容器宽的四分之一。</p><p><a class="btn" href="#">按钮</a></p>`), note: "板块里的字和按钮只占容器宽的四分之一，右边整片空" },
  { id: "L17-ok", control: true, page: "index.html", width: 1440, html: sec(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start"><div><h2 class="section-title">左文右卡</h2><p class="section-lead">左边是字。</p></div><div class="card"><p>右边是一张卡片，铺到容器右缘。</p></div></div>`), note: "左文右卡铺满容器：必须通过" },
  { id: "L18", rule: "版式[L18] 统计数字上下不齐", page: "index.html", width: 1440, html: sec(`<p style="font-size:48px;line-height:1.2;margin:0">20<span style="position:relative;top:0.3em">4</span>6</p>`), note: "一串数字里的「4」沉下去 0.3em，和老式数字的 3、4、5、7、9 下坠一样" },
  { id: "L18-ok", control: true, page: "index.html", width: 1440, html: sec(`<div style="border-top:1px solid var(--border)"><p style="font-size:48px;line-height:1.2;margin:0">2046 1.86</p></div>`), note: "同样的数字全在基线上：必须通过" },
  { id: "L19", rule: "版式[L19] 页头文字被省略号截断", page: "index.html", width: 1440, css: ".site-header .brand{display:block !important;max-width:3rem !important;overflow:hidden !important;text-overflow:ellipsis !important;white-space:nowrap !important}", note: "页头品牌名被挤成半截，后面是省略号" },
  { id: "TAP-ok", control: true, page: "about/index.html", width: 375, full: true, top: true, html: banner, note: "手机面包屑按框架样式：必须通过" },
  { id: "TAP", rule: "点击区", page: "about/index.html", width: 375, full: true, top: true, html: banner, css: ".crumbs a{min-width:0 !important;padding-inline:0 !important;margin-inline:0 !important}", note: "手机面包屑「首页」链接只有 32px 宽" },
  { id: "DOCK", rule: "悬浮条压住页脚", page: "index.html", width: 1440, full: true, css: ".footer-legal{justify-content:flex-end}.footer-legal p{margin-right:-5rem}.site-footer{padding-bottom:0 !important}.js .float-dock.is-over-foot{opacity:1 !important;visibility:visible !important;pointer-events:auto !important}", note: "页脚内容顶到右下角、桌面悬浮条又不让开" },
  { id: "DOCK-ok", control: true, page: "index.html", width: 1440, full: true, css: ".footer-legal{justify-content:flex-end}.footer-legal p{margin-right:-5rem}.site-footer{padding-bottom:0 !important}", note: "同样的页脚，但悬浮条按规矩让开：必须通过" },
  { id: "L20", rule: "版式[L20]", page: "about/index.html", width: 1440, top: true, html: faceBanner(""), note: "800×1000 竖图塞进约 1440×400 的横幅，居中裁，顶部脸的位置几乎不在画面里" },
  { id: "L20-ok", control: true, page: "about/index.html", width: 1440, top: true, html: faceBanner(" is-portrait"), note: "同一张竖图，焦点抬到 15%：必须通过" },
  { id: "L21", rule: "版式[L21]", page: "index.html", width: 1440, top: true, html: landBanner(landSvg) + sec(`<h2 class="section-title">正文标题</h2><p>这段说明铺开，避免板块被看成只有左边一条。</p><img src="${landSvg}" alt="" width="1200" height="800">`), note: "页头和正文 img 的 src 相同" },
  { id: "L21-ok", control: true, page: "index.html", width: 1440, top: true, html: landBanner(landSvg) + sec(`<h2 class="section-title">正文标题</h2><p>这段说明铺开，避免板块被看成只有左边一条。</p><img src="${landSvgB}" alt="" width="1200" height="800">`), note: "页头和正文各一张图：必须通过" },
  { id: "L22", rule: "版式[L22]", page: "index.html", width: 1440, html: orphanBox("一二三四五"), note: "五个汉字塞进四字宽，关掉 balance，末行只剩一个字" },
  { id: "L22-ok", control: true, page: "index.html", width: 1440, html: orphanBox("一二三&#x2060;四&#x2060;五"), note: "末尾三个字用词连接符粘住，末行是三个字：必须通过" },
].filter((item) => !only || only.includes(item.id));

const lines2 = [];
const ok = (name, pass, detail) => lines2.push(`${pass ? "PASS" : "FAIL"}  ${name}  ${detail}`);

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
const base = path.join(work, "base");
const built = spawnSync(process.execPath, [path.join(root, "scripts", "build.mjs"), path.join(root, "examples", "demo-factory", "site.json"), "--site-dir", base], { encoding: "utf8", cwd: root });
if (built.status !== 0) {
  console.log(`FAIL  反例底站拼装失败  ${(built.stdout + built.stderr).split("\n")[0]}`);
  process.exit(1);
}

// 带样板间的底站（认得图片位 id）：民宿样板间，正式拼装，不要图。只有用到 base: "room" 的反例才拼。
const baseRoom = path.join(work, "base-room");
if (cases.some((item) => item.base === "room")) {
  const b2 = spawnSync(process.execPath, [path.join(root, "scripts", "build.mjs"), path.join(root, "showrooms", "cn-hospitality", "examples", "site.json"), "--site-dir", baseRoom], { encoding: "utf8", cwd: root });
  if (b2.status !== 0) {
    console.log(`FAIL  样板间底站拼装失败  ${(b2.stdout + b2.stderr).split("\n")[0]}`);
    process.exit(1);
  }
}

function runVisual(dir, page, width, full) {
  const a = [path.join(root, "scripts", "check-visual.mjs"), dir, "--page", page, "--widths", String(width)];
  if (!full) a.push("--layout-only");
  const res = spawnSync(process.execPath, a, { encoding: "utf8", cwd: root, timeout: 240000 });
  return { status: res.status, out: `${res.stdout || ""}${res.stderr || ""}` };
}

// 对照：原站必须过。
{
  const res = runVisual(base, "index.html", 1440, false);
  if (res.out.includes("跳过")) {
    console.log("跳过：没有 Playwright");
    process.exit(3);
  }
  const res2 = runVisual(base, "about/index.html", 375, false);
  ok("对照：未改动的原站，版式检查通过", res.status === 0 && res2.status === 0, res.status === 0 && res2.status === 0 ? "1440 首页、375 关于页都过" : `${res.out.trim().split("\n").slice(0, 3).join(" | ")} ${res2.out.trim().split("\n").slice(0, 3).join(" | ")}`);
}

for (const item of cases) {
  const dir = path.join(work, item.id);
  fs.cpSync(item.base === "room" ? baseRoom : base, dir, { recursive: true });
  if (item.css) fs.appendFileSync(path.join(dir, "assets", "site.css"), `\n${item.css}\n`, "utf8");
  if (item.html) {
    const file = path.join(dir, ...item.page.split("/"));
    const html = fs.readFileSync(file, "utf8");
    if (!html.includes("</main>")) throw new Error(`${item.page} 没有 </main>`);
    const next = item.top ? html.replace(/<main id="main">/, (m) => `${m}${item.html}`) : html.replace("</main>", `${item.html}</main>`);
    fs.writeFileSync(file, next, "utf8");
  }
  const res = runVisual(dir, item.page, item.width, Boolean(item.full));
  if (item.control) {
    ok(`${item.id} 对照通过`, res.status === 0, res.status === 0 ? item.note : `exit ${res.status} ${res.out.trim().split("\n").slice(0, 3).join(" | ")}`);
    continue;
  }
  const hit =res.out.split("\n").find((line) => line.includes(item.rule));
  ok(`${item.id} 反例被拦下`, res.status === 1 && Boolean(hit), hit ? hit.trim() : `exit ${res.status} ${res.out.trim().split("\n").slice(0, 3).join(" | ")}`);
}

console.log(lines2.join("\n"));
process.exit(lines2.some((line) => line.startsWith("FAIL")) ? 1 : 0);
