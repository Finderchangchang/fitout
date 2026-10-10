/** Build the public showroom catalog without licensed demo photos or private inputs. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let output = path.join(root, "out", "preview");
let baseUrl = "";
for (let i = 2; i < process.argv.length; i += 2) {
  const value = process.argv[i + 1];
  if (!value) throw new Error(`缺少 ${process.argv[i]} 的值`);
  if (process.argv[i] === "--out") output = path.resolve(value);
  else if (process.argv[i] === "--base-url") {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) throw new Error("预览网址必须使用 http 或 https");
    baseUrl = url.href.replace(/\/?$/, "/");
  } else throw new Error(`未知参数 ${process.argv[i]}`);
}
// Only use a dedicated output directory; do not clear existing user files.
if (output === root || output === path.dirname(root)) throw new Error("输出目录不能是仓库或它的父目录");
fs.mkdirSync(output, { recursive: true });
const catalog = JSON.parse(fs.readFileSync(path.join(root, "showrooms", "index.json"), "utf8"));
const images = path.join(output, "previews");
fs.mkdirSync(images, { recursive: true });
function escape(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
const cards = [];
for (const room of catalog.showrooms) {
  if (!/^[a-z0-9-]+$/.test(room.id)) throw new Error(`无效样板间 id：${room.id}`);
  const dest = path.join(output, room.id);
  const args = [path.join(root, "scripts", "build.mjs"), path.join(root, "showrooms", room.id, "examples", "site.json"), "--site-dir", dest];
  if (baseUrl) args.push("--base-url", new URL(`${room.id}/`, baseUrl).href);
  const built = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", windowsHide: true });
  if (built.status !== 0) throw new Error(`${room.id} 预览拼装失败\n${built.stdout}${built.stderr}`);
  const checked = spawnSync(process.execPath, [path.join(root, "scripts", "check.mjs"), dest], { cwd: root, encoding: "utf8", windowsHide: true });
  if (checked.status !== 0) throw new Error(`${room.id} 预览机检失败\n${checked.stdout}${checked.stderr}`);
  // Construction inputs and diagnostics are useful locally, but are not web assets.
  for (const filename of ["site.json", "build-report.json"]) fs.rmSync(path.join(dest, filename), { force: true });
  fs.copyFileSync(path.join(root, "showrooms", room.id, "preview.jpg"), path.join(images, room.id + ".jpg"));
  const flavor = room.id.startsWith("intl-") ? "intl" : "cn";
  const badge = room.id === "intl-factory" ? "英文外贸" : flavor === "intl" ? "国际风" : "国内风";
  const points = Array.isArray(room.pages) ? room.pages.join(" · ") : "首页 · 产品与服务 · 联系";
  cards.push(`<article class="room" data-flavor="${flavor}" data-search="${escape(room.name + " " + room.fit + " " + room.industry)}"><a class="room-picture" href="${room.id}/index.html"><img src="previews/${room.id}.jpg" width="1440" height="900" alt="${escape(room.name)}首页" loading="lazy" decoding="async"></a><div class="room-copy"><span class="badge">${badge}</span><h2><a href="${room.id}/index.html">${escape(room.name)}</a></h2><p>${escape(room.fit)}</p><p class="pages">${escape(points)}</p><a class="open" href="${room.id}/index.html">查看完整网站 <span aria-hidden="true">→</span></a></div></article>`);
  console.log(`PASS ${room.id} 在线预览`);
}
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="精装 FitOut 的 14 套行业官网样板间，覆盖制造、餐饮、教育和专业服务。查看完整静态网站与无照片版式。"><title>精装 FitOut｜行业官网样板间</title>${baseUrl ? `<link rel="canonical" href="${escape(baseUrl)}">` : ""}<style>
*{box-sizing:border-box}body{margin:0;background:#f5f7f8;color:#172730;font:16px/1.7 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}a{color:inherit}button,input{font:inherit}header,main,footer{max-width:1200px;margin:auto;padding:24px}.top{display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{font-size:24px;font-weight:750;letter-spacing:-.03em}.github{padding:10px 16px;border:1px solid #9caeb7;border-radius:6px;text-decoration:none;min-height:44px}.intro{padding:38px 0 30px;max-width:860px}.intro h1{font-size:clamp(30px,4vw,52px);line-height:1.3;margin:0 0 18px;text-wrap:balance}.intro p{color:#475a65;margin:0 0 12px}.notice{padding:14px 18px;background:#e8edf0;border-left:3px solid #356477;color:#354a56}.toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:28px 0}input{min-height:48px;flex:1 1 240px;max-width:440px;border:1px solid #899eaa;border-radius:6px;padding:10px 14px;background:white}button{min-height:48px;padding:10px 18px;border:1px solid #899eaa;border-radius:6px;background:white;color:#263d4a;cursor:pointer}button[aria-pressed=true]{background:#244d5c;color:white;border-color:#244d5c}.count{margin-left:auto;color:#526570}.rooms{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.room{border:1px solid #d4dfe4;border-radius:8px;overflow:hidden;background:white;display:flex;flex-direction:column;min-width:0}.room[hidden]{display:none}.room-picture{display:block;border-bottom:1px solid #d4dfe4}.room img{display:block;width:100%;height:auto;aspect-ratio:8/5;object-fit:cover}.room-copy{padding:20px;display:flex;flex-direction:column;flex:1}.badge{font-size:13px;color:#476371}.room h2{font-size:21px;line-height:1.45;margin:8px 0 12px}.room h2 a{text-decoration:none}.room p{color:#4e626d;margin:0 0 14px}.room .pages{font-size:13px;color:#526570}.open{margin-top:auto;min-height:44px;display:flex;align-items:center;justify-content:space-between;font-weight:650;text-decoration:none}.empty{padding:32px 0}.empty[hidden]{display:none}footer{margin-top:36px;padding-block:30px;color:#526570;border-top:1px solid #cbd7dd}a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #247a95;outline-offset:3px}@media(max-width:1000px){.rooms{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){header,main,footer{padding-inline:20px}.rooms{grid-template-columns:1fr}.intro{padding-top:24px}.toolbar{gap:8px}input{max-width:none;flex-basis:100%}.count{margin-left:0;flex-basis:100%}.top{align-items:flex-start}.brand{font-size:21px}.github{font-size:14px}.notice{font-size:14px}}
.brand{min-height:44px;display:flex;align-items:center;text-decoration:none}.room h2 a{display:inline-flex;align-items:center;min-height:44px}
</style></head><body><header><div class="top"><a class="brand" href="index.html">精装 · FitOut</a><a class="github" href="https://github.com/Finderchangchang/fitout">获取生成器</a></div></header><main><div class="intro"><h1>先选行业，再看完整官网</h1><p>14 套行业样板间。查看首页、服务列表、详情与联系页，找到适合自己企业的内容结构。</p><p class="notice">这里展示无需照片也能使用的完整版本。演示企业及联系方式均为虚构，不接受真实预约。图库照片不随预览公开发布；本地可使用合法持有的照片增强展示。</p></div><div class="toolbar"><input id="search" type="search" aria-label="搜索行业或样板间" placeholder="搜索工厂、餐饮、学校、律所……"><button type="button" data-filter="all" aria-pressed="true">全部</button><button type="button" data-filter="cn" aria-pressed="false">国内风</button><button type="button" data-filter="intl" aria-pressed="false">国际风</button><span class="count" id="count" aria-live="polite">14 套样板间</span></div><div class="rooms">${cards.join("\n")}</div><p class="empty" hidden>没有匹配的样板间，换一个行业词试试。</p></main><footer>精装 FitOut · ${escape(catalog.version)} · 静态官网生成器<br>提供页面与结构示例；企业事实、照片和联系信息由使用者填写。</footer><script>
const cards=[...document.querySelectorAll('.room')],buttons=[...document.querySelectorAll('[data-filter]')],search=document.querySelector('#search');let filter='all';function update(){const q=search.value.trim().toLowerCase();let count=0;cards.forEach(card=>{const visible=(filter==='all'||card.dataset.flavor===filter)&&card.dataset.search.toLowerCase().includes(q);card.hidden=!visible;if(visible)count++});document.querySelector('#count').textContent=count+' 套样板间';document.querySelector('.empty').hidden=count!==0}search.addEventListener('input',update);buttons.forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.filter;buttons.forEach(item=>item.setAttribute('aria-pressed',String(item===button)));update()}));
</script></body></html>`;
fs.writeFileSync(path.join(output, "index.html"), html);
fs.writeFileSync(path.join(output, ".nojekyll"), "");
fs.writeFileSync(path.join(output, "release.json"), JSON.stringify({ version: catalog.version, commit: process.env.GITHUB_SHA || "local", showrooms: catalog.showrooms.map((room) => room.id), imageMode: "no-photos" }, null, 2) + "\n");
console.log(`在线预览：${output}`);
