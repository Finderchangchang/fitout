/**
 * 三档检查共用：样板间名单、演示图目录、子进程。
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function showroomIds() {
  const dir = path.join(root, "showrooms");
  return fs.readdirSync(dir)
    .filter((name) => /^(cn|intl)-/.test(name) && fs.existsSync(path.join(dir, name, "examples", "site.json")))
    .sort();
}

export function parseArgs(argv, { showroom = false, demo = false } = {}) {
  const showrooms = [];
  let demoImages = "";
  for (let i = 0; i < argv.length; i += 1) {
    if (showroom && argv[i] === "--showroom") {
      const id = argv[i + 1] || "";
      i += 1;
      if (!id) throw new Error("缺少样板间 id");
      showrooms.push(id);
      continue;
    }
    if (demo && argv[i] === "--demo-images") {
      demoImages = argv[i + 1] || "";
      i += 1;
      if (!demoImages) throw new Error("缺少演示图目录");
      continue;
    }
    throw new Error(`多余参数：${argv[i]}`);
  }
  return { showrooms, demoImages };
}

export function pickShowrooms(ids) {
  const known = showroomIds();
  if (!ids.length) return known;
  const missing = ids.filter((id) => !known.includes(id));
  if (missing.length) throw new Error(`没有这套样板间：${missing.join("、")}`);
  return ids;
}

export function demoDir(rootArg, id) {
  if (!rootArg) return "";
  const abs = path.resolve(rootArg);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error(`演示图片目录不存在：${abs}`);
  }
  const nested = path.join(abs, id);
  const hasImages = (dir) => fs.existsSync(dir)
    && fs.statSync(dir).isDirectory()
    && fs.readdirSync(dir).some((name) => /\.(jpe?g|png|webp)$/i.test(name));
  if (hasImages(nested)) return nested;
  if (hasImages(abs)) return abs;
  throw new Error(`没有 ${id} 的演示图：${abs}`);
}

export function runFile(file, args = [], { timeout = 120000, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd: root,
      env: env ? { ...process.env, ...env } : process.env,
      windowsHide: true,
    });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { out += chunk; });
    const timer = setTimeout(() => {
      out += "\n超时";
      child.kill();
    }, timeout);
    const done = (status) => {
      clearTimeout(timer);
      resolve({ status: status ?? 1, out });
    };
    child.on("error", (err) => done(1, out += String(err.message || err)));
    child.on("close", done);
  });
}

export function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}
