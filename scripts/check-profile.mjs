import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditFacts } from "./lib/profile-facts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const ids = [];
for (let i = 0; i < args.length; i += 2) {
  if (args[i] !== "--showroom" || !/^[a-z0-9-]+$/.test(args[i + 1] || "")) throw new Error("用法：node scripts/check-profile.mjs [--showroom <id> ...]");
  ids.push(args[i + 1]);
}
let failed = 0;
const showroomIds = JSON.parse(fs.readFileSync(path.join(root, "showrooms", "index.json"), "utf8")).showrooms.map((room) => room.id);
for (const id of ids.length ? ids : showroomIds) {
  const site = JSON.parse(fs.readFileSync(path.join(root, "showrooms", id, "examples", "site.json"), "utf8"));
  const profile = fs.readFileSync(path.join(root, "examples", "profiles", "showrooms", `${id}.md`), "utf8");
  const errors = auditFacts(site, profile);
  console.log(`${errors.length ? "FAIL" : "PASS"} ${id} 事实核对 ${errors.length} 条错误`);
  for (const error of errors) console.log(`- ${error}`);
  failed += errors.length;
}
process.exit(failed ? 1 : 0);
