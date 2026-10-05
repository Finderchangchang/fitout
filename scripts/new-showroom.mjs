/**
 * node scripts/new-showroom.mjs --id <id> --industry <industry> --flavor <cn|intl> [--niche <niche>]
 * 从 showrooms/_template 复制一套骨架。industry / niche 以 industries/registry.json 为准。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { industryError, nicheError } from "./lib/rules.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] || "" : "";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const id = arg("--id");
const industry = arg("--industry");
const flavor = arg("--flavor");
const niche = arg("--niche");
if (!id || !industry || !flavor) {
  fail("用法：node scripts/new-showroom.mjs --id <id> --industry <industry> --flavor <cn|intl> [--niche <niche>]");
}
if (!/^_?[a-z0-9][a-z0-9-]*$/.test(id)) fail("id 只能是小写字母、数字和连字符，最多一个前导下划线");
const industryProblem = industryError(industry);
if (industryProblem) fail(industryProblem);
if (flavor !== "cn" && flavor !== "intl") fail("flavor 只能是 cn 或 intl");
const nicheProblem = nicheError(industry, niche);
if (nicheProblem) fail(nicheProblem);

const from = path.join(root, "showrooms", "_template");
const dest = path.join(root, "showrooms", id);
if (!fs.existsSync(from)) fail("找不到 showrooms/_template");
if (fs.existsSync(dest)) fail(`样板间已存在：${id}`);

copyDir(from, dest);
replaceTree(dest);
console.log(`已建立 showrooms/${id}`);

function copyDir(src, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const next = path.join(src, entry.name);
    const out = path.join(target, entry.name);
    if (entry.isDirectory()) copyDir(next, out);
    else fs.copyFileSync(next, out);
  }
}

function replaceTree(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) replaceTree(full);
    else {
      const text = fs.readFileSync(full, "utf8");
      const next = text
        .replaceAll("__ID__", id)
        .replaceAll("__INDUSTRY__", industry)
        .replaceAll("__FLAVOR__", flavor)
        .replaceAll("__NICHE__", niche);
      if (next !== text) fs.writeFileSync(full, next, "utf8");
    }
  }
}
