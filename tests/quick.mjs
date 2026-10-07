/**
 * node tests/quick.mjs [--showroom <id>...]
 * 静态检查，不开浏览器：框架 lint、样板间 lint、样板间不撞色，再拼装示例站跑 check.mjs。
 * --showroom 可重复。不写时查全部样板间。撞色始终两两比较全目录。
 */
import fs from "fs";
import path from "path";
import { parseArgs, pickShowrooms, root, runFile, seconds, showroomIds } from "./lib.mjs";

const started = Date.now();
let ids;
try {
  ids = pickShowrooms(parseArgs(process.argv.slice(2), { showroom: true }).showrooms);
} catch (err) {
  console.error(err.message || String(err));
  process.exit(2);
}

const lines = [];
function expect(name, ok, detail) {
  lines.push(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`.trim());
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

const lintDir = path.join(root, "tests", "_run", "quick-lint");
fs.rmSync(path.join(root, "tests", "_run", "quick"), { recursive: true, force: true });
fs.rmSync(lintDir, { recursive: true, force: true });

const framework = runFile(path.join(root, "scripts", "check.mjs"), ["--lint-framework"], { timeout: 30000 });
const distinct = runFile(path.join(root, "scripts", "check-distinct.mjs"), [], { timeout: 30000 });
const roomsLint = (async () => {
  let env;
  if (ids.length !== showroomIds().length) {
    fs.mkdirSync(lintDir, { recursive: true });
    for (const id of ids) {
      fs.symlinkSync(path.join(root, "showrooms", id), path.join(lintDir, id), "junction");
    }
    env = { FITOUT_SHOWROOMS_DIR: lintDir };
  }
  return runFile(path.join(root, "scripts", "check.mjs"), ["--lint-showrooms"], { timeout: 60000, env });
})();

const built = pool(ids, 4, async (id) => {
  const dest = path.join(root, "tests", "_run", "quick", id);
  const site = path.join(root, "showrooms", id, "examples", "site.json");
  const build = await runFile(path.join(root, "scripts", "build.mjs"), [site, "--site-dir", dest], { timeout: 120000 });
  if (build.status !== 0) return { id, ok: false, detail: build.out.trim().split("\n").slice(0, 2).join(" | ") };
  const check = await runFile(path.join(root, "scripts", "check.mjs"), [dest], { timeout: 60000 });
  const head = check.out.trim().split("\n").slice(0, 3).join(" | ");
  return { id, ok: check.status === 0, detail: `check ${check.status} ${head}` };
});

const [fw, dist, lint, sites] = await Promise.all([framework, distinct, roomsLint, built]);
expect("lint-framework", fw.status === 0 && fw.out.includes("零命中"), fw.out.trim().split("\n")[0] || `exit ${fw.status}`);
expect("lint-showrooms", lint.status === 0, lint.out.trim().split("\n").find((line) => line.includes("失败") || line.includes("写死") || line.startsWith("结论")) || `exit ${lint.status}`);
expect("check-distinct", dist.status === 0 && dist.out.includes("样板间区分：通过"), dist.out.trim().split("\n").pop());
for (const site of sites) expect(`${site.id} 机检`, site.ok, site.detail);

console.log(lines.join("\n"));
const failed = lines.filter((line) => line.startsWith("FAIL")).length;
console.log(`quick ${failed ? "不通过" : "通过"}  ${ids.length} 套  ${seconds(Date.now() - started)}`);
process.exit(failed ? 1 : 0);
