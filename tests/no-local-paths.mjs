#!/usr/bin/env node
/**
 * node tests/no-local-paths.mjs
 * 扫将要提交的文本（已跟踪的文件，加上没被忽略的新文件，包括 .gitignore）。
 * 发现作者盘符目录、外部参考库目录、用户主目录前缀就失败。
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const back = String.fromCharCode(92);
const needles = [
  "H:" + back + "ai_tool",
  "H:" + back + back + "ai_tool",
  "H:" + "/" + "ai_tool",
  ["site", "studio", "refs"].join("-"),
  "C:" + back + "Users" + back,
  "C:" + back + back + "Users" + back + back,
  "C:" + "/" + "Users" + "/",
  "admin" + "istrator",
].map((item) => item.toLowerCase());

const binaryExt = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2",
  ".pdf", ".zip", ".exe", ".dll", ".mp4", ".mp3", ".glb", ".wasm",
]);

function files() {
  const listed = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "buffer",
  });
  return listed.toString("utf8").split("\0").filter(Boolean);
}

const blocked = [];
for (const rel of files()) {
  const norm = rel.replaceAll("\\", "/");
  const ext = path.extname(rel).toLowerCase();
  if (binaryExt.has(ext)) continue;
  const full = path.join(root, rel);
  let buf;
  try {
    buf = fs.readFileSync(full);
  } catch {
    continue;
  }
  if (buf.includes(0)) continue;
  const lines = buf.toString("utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const lower = lines[i].toLowerCase();
    if (!needles.some((needle) => lower.includes(needle))) continue;
    blocked.push(`${norm}:${i + 1}`);
  }
}

if (blocked.length) {
  console.log("失败：仓库文本里有本机路径");
  for (const hit of blocked) console.log(hit);
  process.exit(1);
}
console.log("通过");
