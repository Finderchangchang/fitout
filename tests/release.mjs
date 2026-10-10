/**
 * node tests/release.mjs [--demo-images <目录>]
 * 发版前全量：14 套样板间重建、完整视觉检查、精简回归。
 * --demo-images 是按样板间 id 分子目录的根，或单套图片目录（只在查一套时有意义）。
 */
import fs from "fs";
import path from "path";
import { demoDir, parseArgs, root, runFile, seconds, showroomIds } from "./lib.mjs";

const started = Date.now();
let demoImages = "";
try {
  demoImages = parseArgs(process.argv.slice(2), { demo: true }).demoImages;
} catch (err) {
  console.error(err.message || String(err));
  process.exit(2);
}

const ids = showroomIds();
const live = path.join(root, "tests", "_run", "release");
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
  const mark = Date.now();
  const args = [path.join(root, "showrooms", id, "examples", "site.json"), "--site-dir", dest];
  if (images) args.push("--demo-images", images);
  const built = await runFile(path.join(root, "scripts", "build.mjs"), args, { timeout: 180000 });
  if (built.status !== 0) {
    console.log(`FAIL  ${id} 拼装  ${built.out.trim().split("\n").slice(0, 3).join(" | ")}`);
    process.exit(1);
  }
  const checked = await runFile(path.join(root, "scripts", "check.mjs"), [dest], { timeout: 120000 });
  if (checked.status !== 0) {
    console.log(`FAIL  ${id} 有图机检\n${checked.out}`);
    process.exit(1);
  }
  console.log(`PASS  ${id} 拼装  ${seconds(Date.now() - mark)}`);
  dirs.push(dest);
}

const seen = await runFile(path.join(root, "scripts", "check-visual.mjs"), dirs, { timeout: 3600000 });
process.stdout.write(seen.out);
if (seen.status !== 0 || !seen.out.includes("视觉检查：通过") || seen.out.includes("跳过")) {
  console.log(`release 不通过  视觉检查  ${seconds(Date.now() - started)}`);
  process.exit(seen.out.includes("跳过") ? 3 : 1);
}

const reg = await runFile(path.join(root, "tests", "regressions.mjs"), [], { timeout: 900000 });
process.stdout.write(reg.out);
if (reg.status !== 0) {
  console.log(`release 不通过  回归  ${seconds(Date.now() - started)}`);
  process.exit(1);
}
const business = await runFile(path.join(root, "tests", "business.mjs"), [], { timeout: 180000 });
process.stdout.write(business.out);
if (business.status !== 0) {
  console.log(`release 不通过  企业站回归  ${seconds(Date.now() - started)}`);
  process.exit(business.status);
}
console.log(`release 通过  ${ids.length} 套  ${seconds(Date.now() - started)}`);
