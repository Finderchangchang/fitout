/**
 * node tests/visual.mjs [--showroom <id>...] [--demo-images <目录>]
 * 只查视觉硬伤：横向溢出、文字被裁、图上文字对比度、按钮对比度、首屏立即可见、悬浮条压页脚、孤儿卡。
 * 只看 1440 和 375。每种页面类型抽一页。轮播只查第 1 张。
 * --demo-images 可以是某一套的图片目录，或按样板间 id 分子目录的根。
 */
import fs from "fs";
import path from "path";
import { demoDir, parseArgs, pickShowrooms, root, runFile, seconds } from "./lib.mjs";

const started = Date.now();
let ids;
let demoImages = "";
try {
  const parsed = parseArgs(process.argv.slice(2), { showroom: true, demo: true });
  ids = pickShowrooms(parsed.showrooms);
  demoImages = parsed.demoImages;
} catch (err) {
  console.error(err.message || String(err));
  process.exit(2);
}

const live = path.join(root, "tests", "_run", "visual");
fs.rmSync(live, { recursive: true, force: true });
fs.mkdirSync(live, { recursive: true });

const dirs = [];
for (const id of ids) {
  let images = "";
  try {
    images = demoDir(demoImages, id);
  } catch (err) {
    console.error(err.message || String(err));
    process.exit(2);
  }
  const dest = path.join(live, id);
  const args = [path.join(root, "showrooms", id, "examples", "site.json"), "--site-dir", dest];
  if (images) args.push("--demo-images", images);
  const built = await runFile(path.join(root, "scripts", "build.mjs"), args, { timeout: 180000 });
  if (built.status !== 0) {
    console.log(`FAIL  ${id} 拼装  ${built.out.trim().split("\n").slice(0, 3).join(" | ")}`);
    console.log(`visual 不通过  ${seconds(Date.now() - started)}`);
    process.exit(1);
  }
  dirs.push(dest);
}

const seen = await runFile(path.join(root, "scripts", "check-visual.mjs"), [
  ...dirs,
  "--widths", "375,1440",
  "--sample",
  "--hard",
  "--first-slide",
], { timeout: 600000 });
process.stdout.write(seen.out);
const skipped = seen.out.includes("跳过");
const ok = seen.status === 0 && !skipped && seen.out.includes("视觉检查：通过");
console.log(`visual ${ok ? "通过" : "不通过"}  ${ids.join("、")}  ${seconds(Date.now() - started)}`);
process.exit(ok ? 0 : (skipped ? 3 : 1));
