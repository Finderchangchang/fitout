/**
 * 可选截图。找得到 Playwright 才跑，找不到打印「跳过」并退出 0。
 * node scripts/shot.mjs [站点目录...]
 * 图片写到本仓库 out/shots/，避免盖掉评审留下的截图。
 */
import fs from "fs";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";
import { findPlaywright } from "./images/lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = path.join(root, "out", "shots");
const found = findPlaywright();
if (!found) {
  console.log("跳过：没有找到 Playwright");
  process.exit(0);
}

const args = process.argv.slice(2);
const sites = (args.length ? args : ["out/demo-store", "out/demo-factory"])
  .map((item) => path.resolve(root, item))
  .filter((dir) => fs.existsSync(dir));

if (sites.length === 0) {
  console.log("跳过：没有可截图的站点目录");
  process.exit(0);
}

const loaded = await import(pathToFileURL(found).href);
const chromium = loaded.chromium || loaded.default?.chromium;
if (!chromium) {
  console.log("跳过：Playwright 在，但没有 chromium 导出");
  process.exit(0);
}
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: "chromium" });
} catch {
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    console.log(`未验：Playwright 在，但浏览器没启动。${error.message}`);
    process.exit(0);
  }
}

fs.mkdirSync(shotDir, { recursive: true });
const overflows = [];
try {
  for (const site of sites) {
    const name = path.basename(site);
    const pages = walk(site).filter((file) => file.endsWith(".html"));
    for (const file of pages) {
      const slug = path.relative(site, file).replaceAll("\\", "/").replace(/\.html$/, "").replaceAll("/", "-");
      const page = await browser.newPage();
      await page.goto(pathToFileURL(file).href);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({ path: path.join(shotDir, `${name}-${slug}-1440.png`), fullPage: true });
      await page.setViewportSize({ width: 375, height: 812 });
      await page.screenshot({ path: path.join(shotDir, `${name}-${slug}-375.png`), fullPage: true });
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const line = `${name}/${slug} 375 scrollWidth=${scrollWidth}`;
      console.log(scrollWidth <= 375 ? `375 无横向溢出 ${line}` : `375 横向溢出 ${line}`);
      if (scrollWidth > 375) overflows.push(line);
      await page.close();
    }
  }
} finally {
  await browser.close();
}

if (overflows.length) {
  console.log("有页面在 375 宽下横向溢出");
  process.exit(1);
}
console.log(`截图已写入 ${shotDir}`);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
