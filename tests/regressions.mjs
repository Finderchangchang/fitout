/**
 * node tests/regressions.mjs
 * 回归：slug=index、slug 重复、BOM、空 alt、坏 JSON、无参数机检、
 * lint 不挂起、两个例子、坏样例、B1 和 C8 能失败、仓库文本没有本机路径。
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

{
  const build = runNode("build.mjs", [path.join(root, "tests", "en-smoke", "site.json"), "--out", outRoot]);
  const dir = path.join(outRoot, "en-smoke");
  const check = build.status === 0 ? runNode("check.mjs", [dir]) : null;
  const htmlFiles = build.status === 0
    ? walkHtml(dir)
    : [];
  const zh = load("framework/i18n/zh-CN.json");
  const leaked = [];
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "");
    for (const value of Object.values(zh)) {
      if (value && html.includes(value) && !leaked.includes(value)) leaked.push(value);
    }
  }
  const home = htmlFiles.length ? fs.readFileSync(path.join(dir, "index.html"), "utf8") : "";
  const product = htmlFiles.length ? fs.readFileSync(path.join(dir, "products", "hinge-80.html"), "utf8") : "";
  const about = htmlFiles.length ? fs.readFileSync(path.join(dir, "about", "index.html"), "utf8") : "";
  expect(
    "英文冒烟拼装+机检",
    build.status === 0 && check?.status === 0 && home.includes('lang="en"') && home.includes('"inLanguage":"en"') && product.includes("Sep 2025") && about.includes("\u2014") && leaked.length === 0,
    leaked.length
      ? `中文 UI：${leaked.join("、")}`
      : `build ${build.status} check ${check?.status} ${check ? check.out.split("\n").slice(0, 6).join(" | ") : build.out.trim().split("\n").slice(0, 4).join(" | ")}`,
  );

  if (build.status === 0) {
    const dest = path.join(outRoot, "en-seamless");
    fs.cpSync(dir, dest, { recursive: true });
    const htmlPath = path.join(dest, "index.html");
    const html = fs.readFileSync(htmlPath, "utf8").replace(
      "<h1 class=\"section-title\">Small-batch hinges matched to your sample</h1>",
      "<h1 class=\"section-title\">Seamless one-stop solution</h1>",
    );
    fs.writeFileSync(htmlPath, html, "utf8");
    const blocked = runNode("check.mjs", [dest]);
    const hitSeamless = blocked.out.includes("空话「Seamless」");
    const hitStop = blocked.out.includes("空话「One-stop」");
    expect(
      "英文标题 Seamless one-stop 拦下",
      blocked.status === 1 && hitSeamless && hitStop,
      blocked.out.split("\n").filter((line) => line.includes("空话") || line.startsWith("结论")).join(" | ") || `exit ${blocked.status}`,
    );
  } else {
    expect("英文标题 Seamless one-stop 拦下", false, "冒烟站没拼出来");
  }
}

{
  const src = path.join(root, "out", "demo-store");
  const dest = path.join(outRoot, "zh-seamless");
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
    const htmlPath = path.join(dest, "index.html");
    const html = fs.readFileSync(htmlPath, "utf8").replace("</h1>", "</h1><p>Seamless fit for this shop.</p>");
    fs.writeFileSync(htmlPath, html, "utf8");
    const check = runNode("check.mjs", [dest]);
    const warn = check.out.includes("[警告/E5]") && check.out.includes("空话「Seamless」");
    const block = /^-\s\[E5\].*Seamless/m.test(check.out);
    expect("中文站 Seamless 仍是警告", check.status === 0 && warn && !block, check.out.split("\n").find((line) => line.includes("Seamless")) || `exit ${check.status}`);
  } else {
    expect("中文站 Seamless 仍是警告", false, "缺少 out/demo-store");
  }
}

// 客户提供的图（二维码）：演示模式的占位字够大、不露出键名；正式拼装整块不出。
{
  const empty = path.join(work, "empty-images");
  fs.mkdirSync(empty, { recursive: true });
  const dining = path.join(root, "showrooms", "cn-dining", "examples", "site.json");
  const hosp = path.join(root, "showrooms", "cn-hospitality", "examples", "site.json");
  const demoBuild = runNode("build.mjs", [dining, "--demo-images", empty, "--out", path.join(outRoot, "qr-demo")], { timeout: 60000 });
  const demoHtml = demoBuild.status === 0 ? fs.readFileSync(path.join(outRoot, "qr-demo", "lucha-ji", "contact", "index.html"), "utf8") : "";
  // 空演示目录里别的图位都是深色演示块，只取客户占位那一块（字里有「上线前替换」）。
  const svg = [...demoHtml.matchAll(/src="(data:image\/svg\+xml,[^"]+)"/g)]
    .map((m) => decodeURIComponent(m[1].slice(m[1].indexOf(",") + 1)))
    .find((text) => text.includes("上线前替换")) || "";
  const sizes = [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
  const words = [...svg.matchAll(/<text[^>]*>([^<]*)</g)].map((m) => m[1]).join(" ");
  // 占位图的 SVG 不写 viewBox、宽高 100%：里面的字就是显示出来的真实像素，14px，不随图的显示尺寸缩放。
  // 根上带 data-ph 标记，<img> 上带 data-ph 属性，框架 CSS 靠它给占位图设尺寸。
  const marked = /<img data-ph=""[^>]*\ssrc="data:image\/svg/.test(demoHtml);
  expect(
    "演示占位：字是 14px 真实像素（不随图缩放），img 带 data-ph，不露出 qr- 键名",
    demoBuild.status === 0 && sizes.length >= 2 && Math.min(...sizes) >= 12 && !/viewBox/.test(svg) && /data-ph="1"/.test(svg) && marked && !/qr-/i.test(words) && words.includes("二维码"),
    demoBuild.status === 0 ? `字号 ${sizes.join("/")}，viewBox ${/viewBox/.test(svg) ? "有" : "无"}，img data-ph ${marked ? "有" : "无"}，文字「${words}」` : demoBuild.out.trim().split("\n")[0],
  );
  const formalBuild = runNode("build.mjs", [hosp, "--out", path.join(outRoot, "qr-formal")], { timeout: 60000 });
  const formalHtml = formalBuild.status === 0 ? fs.readFileSync(path.join(outRoot, "qr-formal", "luci-yuan", "contact", "index.html"), "utf8") : "";
  expect(
    "正式拼装没给二维码：整块不出，没有「上线前替换」",
    formalBuild.status === 0 && !formalHtml.includes("code-pair") && !formalHtml.includes("上线前替换") && !/qr-/i.test(formalHtml),
    formalBuild.status === 0 ? `code-pair ${formalHtml.includes("code-pair") ? "还在" : "无"}，占位字 ${formalHtml.includes("上线前替换") ? "还在" : "无"}` : formalBuild.out.trim().split("\n")[0],
  );
}

// PLAYWRIGHT_PATH 指到包目录也行：自动找目录里的 index.mjs（以前直接把目录交给 import，报 ERR_UNSUPPORTED_DIR_IMPORT）。
// 用一个假的包目录验证查找函数，不需要真装 Playwright。指到入口文件、指到不存在的路径也各验一次。
{
  const fakeDir = path.join(work, "fake-playwright");
  fs.mkdirSync(fakeDir, { recursive: true });
  fs.writeFileSync(path.join(fakeDir, "index.mjs"), "export const chromium = null;\n", "utf8");
  const probe = (value) => {
    const res = spawnSync(process.execPath, [
      "--input-type=module",
      "-e",
      `import { findPlaywright } from ${JSON.stringify(new URL(`file:///${path.join(root, "scripts", "images", "lib.mjs").replaceAll("\\", "/")}`).href)}; console.log(findPlaywright());`,
    ], { encoding: "utf8", cwd: root, env: { ...process.env, PLAYWRIGHT_PATH: value } });
    return String(res.stdout || "").trim();
  };
  const viaDir = probe(fakeDir);
  const viaFile = probe(path.join(fakeDir, "index.mjs"));
  const viaMissing = probe(path.join(work, "no-such-playwright"));
  expect(
    "PLAYWRIGHT_PATH 指到目录或入口文件都能找到，路径不存在不崩",
    viaDir === path.join(fakeDir, "index.mjs") && viaFile === path.join(fakeDir, "index.mjs") && !viaMissing.endsWith("no-such-playwright"),
    `目录 -> ${path.basename(viaDir)}，文件 -> ${path.basename(viaFile)}，不存在 -> ${viaMissing ? "回到模块解析" : "空"}`,
  );
}

// --lint-showrooms 的「限宽别挂在 .container 上」：拿民宿样板间的副本，往首屏 css 里塞一条 .hero-copy 的 max-width，必须失败；原样的副本必须通过。
{
  const rooms = path.join(work, "lint-rooms");
  const room = path.join(rooms, "cn-hospitality");
  fs.mkdirSync(rooms, { recursive: true });
  fs.cpSync(path.join(root, "showrooms", "cn-hospitality"), room, { recursive: true });
  const run = () => spawnSync(process.execPath, [path.join(root, "scripts", "check.mjs"), "--lint-showrooms"], {
    encoding: "utf8",
    cwd: root,
    timeout: 20000,
    env: { ...process.env, FITOUT_SHOWROOMS_DIR: rooms },
  });
  const clean = run();
  fs.appendFileSync(path.join(room, "sections", "hero", "carousel.css"), "\n.hero-full .hero-copy { max-width: 40rem; }\n", "utf8");
  const bad = run();
  const out = `${bad.stdout || ""}${bad.stderr || ""}`;
  expect(
    "lint-showrooms：限宽挂在 .container 上被拦下，原样副本通过",
    clean.status === 0 && bad.status === 1 && out.includes("限宽挂在 .hero-copy 上"),
    `原样 exit ${clean.status}，塞了坏规则 exit ${bad.status} ${out.split("\n").find((line) => line.includes("限宽")) || ""}`.trim(),
  );
}

// 版式检查 L1 到 L19 的反例：每一项都要能拦下。需要 Playwright，没有就跳过。FITOUT_SKIP_VISUAL_NEG=1 也跳过。
{
  if (process.env.FITOUT_SKIP_VISUAL_NEG) {
    lines.push("SKIP  版式检查反例  FITOUT_SKIP_VISUAL_NEG 已设置");
  } else {
    const res = spawnSync(process.execPath, [path.join(root, "tests", "visual-negatives.mjs")], {
      encoding: "utf8",
      cwd: root,
      timeout: 900000,
    });
    const out = `${res.stdout || ""}${res.stderr || ""}`;
    if (res.status === 3) lines.push("SKIP  版式检查反例  没有 Playwright");
    else {
      const rows = out.split(/\r?\n/).filter((line) => /^(PASS|FAIL)/.test(line));
      const bad = rows.filter((line) => line.startsWith("FAIL"));
      expect("版式检查反例全部被拦下", res.status === 0 && rows.length > 20, bad.length ? bad.join(" | ").slice(0, 300) : `${rows.length} 条，全部符合预期`);
    }
  }
}

{
  const res = spawnSync(process.execPath, [path.join(root, "tests", "no-local-paths.mjs")], {
    encoding: "utf8",
    cwd: root,
    timeout: 60000,
  });
  const detail = `${res.stdout || ""}${res.stderr || ""}`.trim().split(/\r?\n/).filter(Boolean).slice(0, 8).join(" | ");
  expect("仓库文本没有本机路径", res.status === 0 && !res.error, detail || `exit ${res.status}`);
}

console.log(lines.join("\n"));
const failed = lines.filter((line) => line.startsWith("FAIL")).length;
process.exit(failed ? 1 : 0);

function walkHtml(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkHtml(full));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}
