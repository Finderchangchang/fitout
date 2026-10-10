/** 零依赖安装。node scripts/install-skill.mjs --target codex|claude|agents [--dest <技能根目录>] */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opts = {};
for (let i = 0; i < args.length; i += 2) {
  if (!["--target", "--dest"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) {
    console.error("用法：node scripts/install-skill.mjs --target codex|claude|agents [--dest <技能根目录>]");
    process.exit(2);
  }
  opts[args[i].slice(2)] = args[i + 1];
}
const homes = { codex: ".codex", claude: ".claude", agents: ".agents" };
if (!homes[opts.target]) {
  console.error("--target 只能是 codex、claude 或 agents");
  process.exit(2);
}
const dest = path.resolve(opts.dest || path.join(os.homedir(), homes[opts.target], "skills"), "fitout");
const source = path.join(root, "skill", "fitout");
const insideSource = path.relative(source, dest);
if (!insideSource || (!insideSource.startsWith(".." + path.sep) && insideSource !== ".." && !path.isAbsolute(insideSource))) {
  console.error("安装目标不能覆盖仓库里的 skill 原件");
  process.exit(2);
}
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(source, dest, { recursive: true });
fs.writeFileSync(path.join(dest, "runtime.json"), JSON.stringify({ repository: root }, null, 2) + "\n");
console.log(`已安装 ${opts.target}：${dest}`);
console.log("新开对话，说「给我公司做个官网」。无需额外 API key。仓库移动后重跑安装。");
