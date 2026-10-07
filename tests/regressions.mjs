/**
 * node tests/regressions.mjs
 * 只留抓过真问题的反例：空话、编造数字、示例值写死、撞色、本机路径，
 * 再加上 tests/visual-negatives.mjs 里的视觉硬伤。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { rgbToLab } from "../scripts/lib/color.mjs";
import { reportFlavor } from "../scripts/check-distinct.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = path.join(root, "out", "regress");
const work = path.join(root, "tests", "_run", "regress");
fs.rmSync(outRoot, { recursive: true, force: true });
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const lines = [];
function expect(name, ok, detail) {
  lines.push(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`.trim());
}

function runNode(script, args, opts = {}) {
  const res = spawnSync(process.execPath, [path.join(root, script), ...args], {
    encoding: "utf8",
    cwd: root,
    timeout: opts.timeout || 60000,
    env: opts.env || process.env,
  });
  return { status: res.status, out: `${res.stdout || ""}${res.stderr || ""}`, error: res.error ? String(res.error.message) : "" };
}

{
  const build = runNode("scripts/build.mjs", [path.join(root, "tests", "bad-site.json"), "--site-dir", path.join(outRoot, "bad-site")]);
  const check = build.status === 0 ? runNode("scripts/check.mjs", [path.join(outRoot, "bad-site")]) : null;
  const hitEmpty = check?.out.includes("空话「赋能」") && check.out.includes("空话「革命性」");
  expect("空话", build.status === 0 && check?.status === 1 && hitEmpty, hitEmpty ? "赋能、革命性被拦下" : (check?.out || build.out).trim().split("\n").slice(0, 3).join(" | "));
}

{
  const dest = path.join(outRoot, "made-up");
  const build = runNode("scripts/build.mjs", [path.join(root, "examples", "demo-store", "site.json"), "--site-dir", dest]);
  let detail = build.out.trim().split("\n")[0];
  let ok = false;
  if (build.status === 0) {
    const file = path.join(dest, "index.html");
    const html = fs.readFileSync(file, "utf8");
    const extra = "<section><p>99年</p></section>".repeat(3);
    fs.writeFileSync(file, html.includes("</main>") ? html.replace("</main>", `${extra}</main>`) : `${html}${extra}`, "utf8");
    const check = runNode("scripts/check.mjs", [dest]);
    ok = check.out.includes("首页「99年」出现在 3 个板块");
    detail = check.out.split("\n").find((line) => line.includes("99年")) || `exit ${check.status}`;
  }
  expect("编造数字", ok, detail);
}

{
  const rooms = path.join(work, "lint-rooms");
  const room = path.join(rooms, "cn-factory");
  fs.cpSync(path.join(root, "showrooms", "cn-factory"), room, { recursive: true });
  const run = () => runNode("scripts/check.mjs", ["--lint-showrooms"], { env: { ...process.env, FITOUT_SHOWROOMS_DIR: rooms } });
  const clean = run();
  fs.appendFileSync(path.join(room, "sections", "hero", "carousel.html"), "\n<p>宁浦精工</p>\n", "utf8");
  const bad = run();
  const line = bad.out.split("\n").find((item) => item.includes("写死了示例值"));
  expect("示例值写死", clean.status === 0 && bad.status === 1 && Boolean(line), line ? line.trim() : `原样 ${clean.status}，写入后 ${bad.status}`);
}

{
  const lab = rgbToLab(31, 79, 130);
  const accent = rgbToLab(134, 100, 16);
  const room = (id) => ({ id, flavor: "cn", primary: { hex: "#1F4F82", lab }, accent: { hex: "#866410", lab: accent } });
  const hit = reportFlavor([room("left-room"), room("right-room")]);
  const line = hit.failures.find((item) => item.includes("主色") && item.includes("ΔE00"));
  expect("撞色", Boolean(line), line || "没有撞色失败");
}

{
  const res = runNode("tests/no-local-paths.mjs", [], { timeout: 60000 });
  expect("本机路径", res.status === 0 && !res.error, res.out.trim().split("\n")[0] || `exit ${res.status}`);
}

{
  const res = runNode("tests/visual-negatives.mjs", [], { timeout: 900000 });
  const rows = res.out.split(/\r?\n/).filter((line) => /^(PASS|FAIL)/.test(line));
  const bad = rows.filter((line) => line.startsWith("FAIL"));
  if (res.status === 3 || res.out.includes("没有 Playwright")) {
    expect("视觉反例", false, "没有 Playwright");
  } else {
    expect("视觉反例", res.status === 0 && rows.length >= 6 && bad.length === 0, bad.length ? bad.join(" | ").slice(0, 300) : `${rows.length} 条`);
    for (const row of rows) lines.push(row);
  }
}

console.log(lines.join("\n"));
process.exit(lines.some((line) => line.startsWith("FAIL")) ? 1 : 0);
