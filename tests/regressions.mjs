/**
 * node tests/regressions.mjs
 * 回归：slug=index、slug 重复、BOM、空 alt、坏 JSON、无参数机检、
 * lint 不挂起、两个例子、坏样例、B1 和 C8 能失败。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = path.join(root, "out", "regress");
const work = path.join(root, "tests", "_run");
fs.rmSync(outRoot, { recursive: true, force: true });
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function runNode(script, args, opts = {}) {
  const started = Date.now();
  const res = spawnSync(process.execPath, [path.join(root, "scripts", script), ...args], {
    encoding: "utf8",
    cwd: root,
    timeout: opts.timeout || 20000,
  });
  return {
    status: res.status,
    out: `${res.stdout || ""}${res.stderr || ""}`,
    ms: Date.now() - started,
    error: res.error ? String(res.error.message) : "",
  };
}

function load(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
}

function writeCase(name, site, extraFiles = {}) {
  const dir = path.join(work, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "site.json"), JSON.stringify(site, null, 2), "utf8");
  for (const [rel, data] of Object.entries(extraFiles)) {
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
  return dir;
}

const lines = [];
function expect(name, ok, detail) {
  lines.push(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`.trim());
}

const store = load("examples/demo-store/site.json");
const factory = load("examples/demo-factory/site.json");

{
  const site = structuredClone(factory);
  site.id = "slug-index";
  site.products[0].slug = "index";
  const dir = writeCase("slug-index", site);
  const res = runNode("build.mjs", [path.join(dir, "site.json"), "--out", outRoot]);
  expect("slug=index 拦下", res.status === 1 && res.out.includes("保留名"), res.out.trim().split("\n")[0]);
}

{
  const site = structuredClone(factory);
  site.id = "slug-dup";
  site.products[1].slug = site.products[0].slug;
  const dir = writeCase("slug-dup", site);
  const res = runNode("build.mjs", [path.join(dir, "site.json"), "--out", outRoot]);
  expect("slug 重复拦下", res.status === 1 && res.out.includes("重复"), res.out.trim().split("\n")[0]);
}

{
  const site = structuredClone(store);
  site.id = "bom-site";
  const dir = path.join(work, "bom-site");
  fs.mkdirSync(dir, { recursive: true });
  const body = JSON.stringify(site, null, 2);
  fs.writeFileSync(path.join(dir, "site.json"), `\uFEFF${body}`, "utf8");
  const res = runNode("build.mjs", [path.join(dir, "site.json"), "--out", outRoot]);
  const check = res.status === 0 ? runNode("check.mjs", [path.join(outRoot, "bom-site")]) : null;
  expect(
    "带 BOM 的 site.json 能拼装（不再崩）",
    res.status === 0 && check?.status === 0,
    res.status === 0 ? `build 0，check ${check.status}` : res.out.trim().split("\n")[0],
  );
}

{
  const dir = path.join(work, "bad-json");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "site.json"), '{\n  "id": "bad-json",\n}\n', "utf8");
  const res = runNode("build.mjs", [path.join(dir, "site.json"), "--out", outRoot]);
  const first = res.out.trim().split("\n")[0];
  expect("坏 JSON 中文行号", res.status === 1 && /不是合法 JSON/.test(first) && /第 \d+ 行/.test(first) && !/\n\s+at /.test(res.out), first);
}

{
  const site = structuredClone(store);
  site.id = "alt-empty";
  const hero = site.pages[0].sections.find((item) => item.type === "hero");
  hero.variant = "split-image";
  hero.data.image = "images/a.png";
  hero.data.imageAlt = "";
  const dir = writeCase("alt-empty", site, { "images/a.png": png });
  const res = runNode("build.mjs", [path.join(dir, "site.json"), "--out", outRoot]);
  const check = res.status === 0 ? runNode("check.mjs", [path.join(outRoot, "alt-empty")]) : null;
  expect(
    "alt 为空拦下",
    res.status === 0 && check?.status === 1 && check.out.includes("[ALT]"),
    check ? check.out.split("\n").find((line) => line.includes("[ALT]")) || check.out.trim().split("\n").slice(0, 4).join(" | ") : res.out.trim().split("\n")[0],
  );
}

{
  const res = runNode("check.mjs", []);
  expect("无机检目录时退出 2", res.status === 2 && res.out.includes("用法"), `exit ${res.status}`);
}

{
  const res = runNode("check.mjs", ["--lint-framework"], { timeout: 10000 });
  expect(
    "lint 10 秒内零命中",
    res.status === 0 && res.ms < 10000 && res.out.includes("零命中") && !res.error,
    `exit ${res.status}，${res.ms}ms，${res.error || "无超时"}`,
  );
}

for (const id of ["demo-store", "demo-factory"]) {
  const build = runNode("build.mjs", [path.join(root, "examples", id, "site.json"), "--out", path.join(root, "out")]);
  const check = build.status === 0 ? runNode("check.mjs", [path.join(root, "out", id)]) : null;
  expect(`${id} 拼装+机检通过`, build.status === 0 && check?.status === 0, check ? `build ${build.status} check ${check.status} ${check.out.split("\n").slice(0, 4).join(" | ")}` : build.out.trim().split("\n")[0]);
}

{
  const build = runNode("build.mjs", [path.join(root, "tests", "bad-site.json"), "--out", path.join(root, "out")]);
  const check = build.status === 0 ? runNode("check.mjs", [path.join(root, "out", "bad-site")]) : null;
  const wanted = [
    "主按钮字/主色 对比度 4.23",
    "primary #8B5CF6 是 AI 万能色",
    "primary #8B5CF6 是紫色",
    "有颜色饱和度超过 80%",
    "home.hero.title 有 25 字",
    "出现 Lorem",
    "出现 John Doe",
    "出现 Acme",
    "出现空话「赋能」",
    "出现空话「革命性」",
    "出现空话「颠覆性」",
    "出现空话「一站式」",
    "出现空话「打造」",
    "出现空话「全方位」",
    "出现空话「领先的」",
    "用了 emoji 或彩色符号当图标",
    "标题里有破折号",
    "的 title 里有破折号",
    "按钮写了「了解更多」",
    "的 hero 标题有 25 字",
  ];
  const missing = wanted.filter((item) => !check?.out.includes(item));
  expect("坏样例仍失败且 20 条都在", build.status === 0 && check?.status === 1 && missing.length === 0, missing.length ? `缺：${missing.join("、")}` : check.out.split("\n").slice(0, 4).join(" | "));
}

{
  const src = path.join(root, "out", "demo-store");
  const dest = path.join(outRoot, "b1-extra");
  fs.cpSync(src, dest, { recursive: true });
  fs.appendFileSync(path.join(dest, "assets", "site.css"), '\n.extra{font-family:"Comic Sans MS",cursive}\n.more{font-family:Georgia,serif}\n', "utf8");
  const check = runNode("check.mjs", [dest]);
  expect("B1 能失败", check.status === 1 && check.out.includes("[B1]"), check.out.split("\n").find((line) => line.includes("[B1]")) || `exit ${check.status}`);
}

{
  const src = path.join(root, "out", "demo-store");
  const dest = path.join(outRoot, "c8-repeat");
  fs.cpSync(src, dest, { recursive: true });
  const htmlPath = path.join(dest, "index.html");
  let html = fs.readFileSync(htmlPath, "utf8");
  html = html.replace('data-family="quote"', 'data-family="editorial"');
  fs.writeFileSync(htmlPath, html, "utf8");
  const check = runNode("check.mjs", [dest]);
  expect("C8 能失败", check.status === 1 && check.out.includes("[C8]"), check.out.split("\n").find((line) => line.includes("[C8]")) || `exit ${check.status}`);
}

console.log(lines.join("\n"));
const failed = lines.filter((line) => line.startsWith("FAIL")).length;
process.exit(failed ? 1 : 0);
