/**
 * node scripts/check-distinct.mjs
 * 扫 showrooms 下每个样板间的 tokens.json，跳过目录名以 _ 开头的。
 * 同一 flavor：主色两两 ΔE00 ≥ 20，强调色两两 ≥ 15，
 * 主色和强调色不能同时都小于 20。
 * 打印两两距离表。有冲突退出码 1。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { deltaE2000 } from "./lib/color.mjs";
import { readJson } from "./lib/json.mjs";
import { industryError, nicheError } from "./lib/rules.mjs";
import { collect, pick, PRIMARY_KEYS, ACCENT_KEYS } from "./check-originality.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRIMARY_GAP = 20;
const ACCENT_GAP = 15;
const COMBO_GAP = 20;

function clusters(ids, edges) {
  const parent = new Map(ids.map((id) => [id, id]));
  function find(id) {
    let top = parent.get(id);
    if (top !== id) {
      top = find(top);
      parent.set(id, top);
    }
    return top;
  }
  for (const [left, right] of edges) {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map();
  for (const id of ids) {
    const top = find(id);
    if (!groups.has(top)) groups.set(top, []);
    groups.get(top).push(id);
  }
  return [...groups.values()]
    .map((group) => group.sort())
    .filter((group) => group.length >= 3)
    .sort((a, b) => a[0].localeCompare(b[0]));
}

export function reportFlavor(rooms) {
  const lines = [];
  const failures = [];
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const ids = [...byId.keys()].sort();
  const flavor = rooms[0].flavor;
  lines.push(`风味 ${flavor}：${ids.join("、")}`);
  for (const id of ids) {
    const room = byId.get(id);
    lines.push(`${id}  主色 ${room.primary.hex}  强调色 ${room.accent.hex}`);
  }
  if (ids.length < 2) {
    lines.push("只有 1 套，不用互比");
    return { lines, failures };
  }
  lines.push("两两距离：");
  const primaryEdges = [];
  const accentEdges = [];
  const primaryFails = [];
  const accentFails = [];
  const comboFails = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const left = byId.get(ids[i]);
      const right = byId.get(ids[j]);
      const dp = deltaE2000(left.primary.lab, right.primary.lab);
      const da = deltaE2000(left.accent.lab, right.accent.lab);
      const primaryMark = dp < PRIMARY_GAP ? " < 20" : "";
      const accentMark = da < ACCENT_GAP ? " < 15" : "";
      lines.push(`${left.id} × ${right.id}  主色 ΔE00 ${dp.toFixed(2)}${primaryMark}  强调色 ΔE00 ${da.toFixed(2)}${accentMark}`);
      if (dp < PRIMARY_GAP) {
        primaryFails.push(`失败：主色 ΔE00 ${dp.toFixed(2)} < 20：${left.id} ${left.primary.hex} × ${right.id} ${right.primary.hex}`);
        primaryEdges.push([left.id, right.id]);
      }
      if (da < ACCENT_GAP) {
        accentFails.push(`失败：强调色 ΔE00 ${da.toFixed(2)} < 15：${left.id} ${left.accent.hex} × ${right.id} ${right.accent.hex}`);
        accentEdges.push([left.id, right.id]);
      }
      if (dp < COMBO_GAP && da < COMBO_GAP) {
        comboFails.push(`失败：主色和强调色同时都在 20 以内：${left.id} × ${right.id}（主色 ΔE00 ${dp.toFixed(2)}，强调色 ΔE00 ${da.toFixed(2)}）`);
      }
    }
  }
  failures.push(...primaryFails, ...accentFails, ...comboFails);
  for (const group of clusters(ids, primaryEdges)) {
    failures.push(`失败：主色撞成一组：${group.map((id) => `${id} ${byId.get(id).primary.hex}`).join("、")}`);
  }
  for (const group of clusters(ids, accentEdges)) {
    failures.push(`失败：强调色撞成一组：${group.map((id) => `${id} ${byId.get(id).accent.hex}`).join("、")}`);
  }
  return { lines, failures };
}

function loadRoom(dir, name) {
  const metaPath = path.join(dir, "showroom.json");
  const tokenPath = path.join(dir, "tokens.json");
  if (!fs.existsSync(metaPath)) return { error: `失败：${name} 没有 showroom.json` };
  if (!fs.existsSync(tokenPath)) return { error: `失败：${name} 没有 tokens.json` };
  let meta;
  let tokens;
  try {
    meta = readJson(metaPath);
    tokens = readJson(tokenPath);
  } catch (error) {
    return { error: `失败：${name} 的 JSON 读不了（${error.message}）` };
  }
  const flavor = typeof meta.flavor === "string" ? meta.flavor.trim() : "";
  if (!flavor) return { error: `失败：${name} 的 showroom.json 没有 flavor` };
  const colors = [];
  collect(tokens, [], colors);
  const primary = pick(colors, PRIMARY_KEYS);
  const accent = pick(colors, ACCENT_KEYS);
  if (!primary) return { error: `失败：${name} 没有找到主色` };
  if (!accent) return { error: `失败：${name} 没有找到强调色` };
  const industryProblem = industryError(meta.industry);
  if (industryProblem) return { error: `失败：${name} ${industryProblem}` };
  const nicheProblem = nicheError(meta.industry, meta.niche);
  if (nicheProblem) return { error: `失败：${name} ${nicheProblem}` };
  return { room: { id: name, flavor, primary, accent } };
}

function main() {
  const showroomsDir = path.join(root, "showrooms");
  if (!fs.existsSync(showroomsDir)) {
    console.error(`找不到样板间目录：${showroomsDir}`);
    process.exit(2);
  }
  const skipped = [];
  const loadFailures = [];
  const rooms = [];
  for (const entry of fs.readdirSync(showroomsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_")) {
      skipped.push(entry.name);
      continue;
    }
    const loaded = loadRoom(path.join(showroomsDir, entry.name), entry.name);
    if (loaded.error) loadFailures.push(loaded.error);
    else rooms.push(loaded.room);
  }
  if (skipped.length) console.log(`跳过：${skipped.sort().join("、")}`);

  const groups = new Map();
  for (const room of rooms) {
    if (!groups.has(room.flavor)) groups.set(room.flavor, []);
    groups.get(room.flavor).push(room);
  }
  const failures = [...loadFailures];
  const flavors = [...groups.keys()].sort();
  if (!flavors.length && !loadFailures.length) console.log("没有参与比较的样板间");
  for (const flavor of flavors) {
    const result = reportFlavor(groups.get(flavor));
    for (const line of result.lines) console.log(line);
    for (const item of result.failures) console.log(item);
    failures.push(...result.failures);
  }
  for (const item of loadFailures) console.log(item);
  console.log(failures.length ? "样板间区分：不通过" : "样板间区分：通过");
  process.exit(failures.length ? 1 : 0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main();
