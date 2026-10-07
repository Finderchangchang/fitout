/**
 * node tests/visual-negatives.mjs [--only <id>...]
 * 视觉硬伤反例：图上文字对比度、按钮对比度、首屏不可见、悬浮条压页脚、孤儿卡、人像页头砍脸。
 * 需要 Playwright。找不到就打印「跳过」并退出 3。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = path.join(root, "tests", "_run", "vneg");
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const portraitSvg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000"><rect width="100%" height="100%" fill="#c4b8a8"/></svg>')}`;
const faceBanner = (extra) => `<section class="page-banner" data-section="page-banner" data-family="pagehead" data-fullbleed><img class="page-banner-img${extra}" src="${portraitSvg}" alt="" width="800" height="1000"><div class="page-banner-scrim"></div><div class="container page-banner-copy" data-on-media><p class="crumbs"><a href="index.html">首页</a><span aria-hidden="true">/</span><span>当前页</span></p><h1 class="section-title">页名</h1></div></section>`;
const sec = (inner) => `<section class="section" data-section="neg" data-family="neg"><div class="container">${inner}</div></section>`;
const cards = (n) => Array.from({ length: n }, (_, i) => `<div class="card"><h3>卡片 ${i + 1}</h3><p>一小段说明，撑出卡片的高度。</p><p>再来一行。</p></div>`).join("");
const contrastHtml = sec(`<div class="hero-copy" style="background:#f4f7f9"><h1 style="color:#e7ebef;background:transparent;font-size:48px;margin:0">浅字浅底</h1></div><p style="margin-top:16px"><a class="btn" href="#" style="background-color:#d5d8dc;color:#c8ccd0;font-size:16px;font-weight:400">灰按钮</a></p>`);

const cases = [
  { id: "contrast", page: "index.html", width: 1440, full: true, top: true, html: contrastHtml, rules: [["图上文字对比度", "图上文字对比度"], ["按钮对比度", "按钮对比度"]] },
  { id: "first-paint", dir: path.join(root, "tests", "fixtures", "first-paint-hidden"), page: "index.html", width: 1440, full: true, rules: [["首屏不可见", "opacity"]] },
  { id: "DOCK", page: "index.html", width: 1440, full: true, css: ".footer-legal{justify-content:flex-end}.footer-legal p{margin-right:-5rem}.site-footer{padding-bottom:0 !important}.js .float-dock.is-over-foot{opacity:1 !important;visibility:visible !important;pointer-events:auto !important}", rules: [["悬浮条压页脚", "悬浮条压住页脚"]] },
  { id: "L16", page: "index.html", width: 1440, html: sec(`<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px">${cards(4)}</div>`), rules: [["孤儿卡", "版式[L16]"]] },
  { id: "L20", page: "about/index.html", width: 1440, top: true, html: faceBanner(""), rules: [["人像页头砍脸", "版式[L20]"]] },
].filter((item) => !only || only.includes(item.id));

const lines = [];
const ok = (name, pass, detail) => lines.push(`${pass ? "PASS" : "FAIL"}  ${name}  ${detail}`);

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
const base = path.join(work, "base");
if (cases.some((item) => !item.dir)) {
  const built = spawnSync(process.execPath, [path.join(root, "scripts", "build.mjs"), path.join(root, "examples", "demo-factory", "site.json"), "--site-dir", base], { encoding: "utf8", cwd: root });
  if (built.status !== 0) {
    console.log(`FAIL  反例底站拼装失败  ${(built.stdout + built.stderr).split("\n")[0]}`);
    process.exit(1);
  }
}

function runVisual(dir, page, width, full) {
  const a = [path.join(root, "scripts", "check-visual.mjs"), dir, "--page", page, "--widths", String(width)];
  if (!full) a.push("--layout-only");
  const res = spawnSync(process.execPath, a, { encoding: "utf8", cwd: root, timeout: 240000 });
  return { status: res.status, out: `${res.stdout || ""}${res.stderr || ""}` };
}

for (const item of cases) {
  let dir = item.dir;
  if (!dir) {
    dir = path.join(work, item.id);
    fs.cpSync(base, dir, { recursive: true });
    if (item.css) fs.appendFileSync(path.join(dir, "assets", "site.css"), `\n${item.css}\n`, "utf8");
    if (item.html) {
      const file = path.join(dir, ...item.page.split("/"));
      const html = fs.readFileSync(file, "utf8");
      if (!html.includes("</main>")) throw new Error(`${item.page} 没有 </main>`);
      const next = item.top ? html.replace(/<main id="main">/, (found) => `${found}${item.html}`) : html.replace("</main>", `${item.html}</main>`);
      fs.writeFileSync(file, next, "utf8");
    }
  }
  const res = runVisual(dir, item.page, item.width, Boolean(item.full));
  if (res.out.includes("跳过")) {
    console.log("跳过：没有 Playwright");
    process.exit(3);
  }
  for (const [name, rule] of item.rules) {
    const hit = res.out.split("\n").find((line) => line.includes(rule));
    ok(name, res.status === 1 && Boolean(hit), hit ? hit.trim() : `exit ${res.status} ${res.out.trim().split("\n").slice(0, 4).join(" | ")}`);
  }
}

console.log(lines.join("\n"));
process.exit(lines.some((line) => line.startsWith("FAIL")) ? 1 : 0);
