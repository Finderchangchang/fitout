/**
 * node scripts/check-originality.mjs --showroom <id> --ref <file> [--ref <file> ...] [--main <file>] [--signatures <清单.md>] [--tokens <file>]
 * --ref 可重复。未给 --main 时第一个是主参考；--main 指定主参考，不在列表里也会加入。
 * 主色、强调色只和主参考的每个有彩色比，ΔE00 ≥ 15。副参考不查单色距离。
 * 背景离每一份参考的背景 ΔE00 ≥ 8（两边都近白或都近黑时只警告）。
 * 主色和强调色不能同时落在任一参考某两色的 25 以内。
 * 招牌清单里每一条，originality.md 都要有「已替换为」或「已删除（原因）」。
 * 失败退出码 1，参数错误退出码 2。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseColor, rgbToLab, labToLch, deltaE2000 } from "./lib/color.mjs";
import { tokensFromMeasure } from "./extract-ref-tokens.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROMA = 12;
const CHROMATIC = 15;
const BACKGROUND = 8;
const PAIR = 25;
export const PRIMARY_KEYS = new Set(["primary", "brand", "main"]);
export const ACCENT_KEYS = new Set(["accent", "highlight", "secondary"]);
const BG_KEYS = new Set(["bg", "background", "backdrop", "sky", "pagebg"]);
const MARKERS = ["已替换为", "已删除", "replaced with", "removed"];
const PLACEHOLDER = /^(?:…+|\.{2,}|_+|-+|—+|<[^>]*>|（[^）]*）|\([^)]*\)|todo|tbd|待填|待定|原因|x{2,}|\?+|？+)$/i;

function flags(name) {
  const out = [];
  const argv = process.argv;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] !== name) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) failUse(`缺少 ${name} 的参数`);
    out.push(value);
    i += 1;
  }
  return out;
}

function arg(name) {
  return flags(name)[0] || "";
}

function failUse(message) {
  console.error(message);
  console.error("用法：node scripts/check-originality.mjs --showroom <id> --ref <file> [--ref <file> ...] [--main <file>] [--signatures <md>] [--tokens <file>]");
  process.exit(2);
}

function samePath(a, b) {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function collect(node, segs, out) {
  if (typeof node === "string") {
    const color = parseColor(node);
    if (!color || color.a < 0.6) return;
    const lab = rgbToLab(color.r, color.g, color.b);
    const leaf = [...segs].reverse().find((part) => !/^\d+$/.test(String(part))) || "";
    out.push({ leaf: String(leaf).toLowerCase(), hex: color.hex, lab, C: labToLch(lab)[1], path: segs.join(".") });
  } else if (Array.isArray(node)) {
    node.forEach((item, index) => collect(item, [...segs, index], out));
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      collect(value, [...segs, key], out);
    }
  }
}

export function pick(colors, keys) {
  return colors.find((item) => keys.has(item.leaf)) || null;
}

function nearest(color, pool) {
  let best = null;
  for (const item of pool) {
    const dE = deltaE2000(color.lab, item.lab);
    if (!best || dE < best.dE) best = { item, dE };
  }
  return best;
}

function nearWhite(lab) {
  return lab[0] >= 92;
}

function nearBlack(lab) {
  return lab[0] <= 12;
}

function loadRef(file) {
  const json = readJson(file);
  if (json && typeof json === "object" && json.desktop) return tokensFromMeasure(json);
  return json;
}

function chromaticOf(colors) {
  return colors.filter((item) => item.C >= CHROMA);
}

function findPair(primary, accent, pool) {
  for (const left of pool) {
    const d1 = deltaE2000(primary.lab, left.lab);
    if (d1 >= PAIR) continue;
    for (const right of pool) {
      if (right.hex === left.hex) continue;
      const d2 = deltaE2000(accent.lab, right.lab);
      if (d2 >= PAIR) continue;
      return { left, right, d1, d2 };
    }
  }
  return null;
}

export function parseSignatures(md) {
  const items = [];
  for (const line of md.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:[-*+]|\d+[.)、])\s+(.+)$/);
    if (!match) continue;
    let text = match[1].trim();
    let id = null;
    const idMatch = text.match(/^\[([A-Za-z]{1,3}\d{1,3})\]\s*|^([A-Za-z]{1,3}\d{1,3})\s*[:：.、)）]\s*/);
    if (idMatch) {
      id = (idMatch[1] || idMatch[2]).toUpperCase();
      text = text.slice(idMatch[0].length).trim();
    }
    items.push({ id, text });
  }
  return items.map((item, index) => ({ id: item.id || `S${index + 1}`, text: item.text }));
}

export function checkSignatureRecords(sigs, recordText) {
  const lines = String(recordText || "").split(/\r?\n/);
  return sigs.map((sig) => {
    const idRe = new RegExp(`(?<![A-Za-z0-9])${sig.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![0-9])`, "i");
    const hits = lines.filter((line) => idRe.test(line));
    if (!hits.length) return { ...sig, ok: false, problem: `originality.md 里没有 ${sig.id}` };
    for (const line of hits) {
      const lower = line.toLowerCase();
      for (const marker of MARKERS) {
        const at = lower.indexOf(marker.toLowerCase());
        if (at < 0) continue;
        const after = line.slice(at + marker.length).replace(/\|/g, " ").replace(/[*`]/g, "").replace(/^[\s:：，,]+/, "").trim();
        if (marker === "已删除" || marker === "removed") {
          const reason = after.replace(/^[（(]\s*/, "").replace(/\s*[)）]\s*$/, "").trim();
          if (reason && !PLACEHOLDER.test(reason)) return { ...sig, ok: true, record: line.trim() };
          continue;
        }
        if (after.length >= 2 && !PLACEHOLDER.test(after)) return { ...sig, ok: true, record: line.trim() };
      }
    }
    return { ...sig, ok: false, problem: `${sig.id} 没有写成「已替换为：…」或「已删除（原因）」` };
  });
}

function main() {
  const id = arg("--showroom");
  const refArgs = flags("--ref");
  const mainArgs = flags("--main");
  const signatures = arg("--signatures");
  const tokensPath = arg("--tokens");
  if (!id) failUse("缺少 --showroom");
  if (!/^[a-z0-9_-]+$/.test(id)) failUse(`样板间 id 不合法：${id}`);
  if (mainArgs.length > 1) failUse("--main 只能写一个");
  if (!refArgs.length && !mainArgs.length) failUse("缺少 --ref");

  const seen = new Set();
  const refAbs = [];
  function addRef(file) {
    const abs = path.resolve(file);
    if (!fs.existsSync(abs)) failUse(`找不到参考：${file}`);
    const key = process.platform === "win32" ? abs.toLowerCase() : abs;
    if (seen.has(key)) return abs;
    seen.add(key);
    refAbs.push(abs);
    return abs;
  }
  for (const file of refArgs) addRef(file);
  const mainAbs = mainArgs.length ? addRef(mainArgs[0]) : refAbs[0];
  const mainPos = refAbs.findIndex((file) => samePath(file, mainAbs));
  const orderedAbs = [refAbs[mainPos], ...refAbs.filter((_, index) => index !== mainPos)];

  const showroomDir = path.join(root, "showrooms", id);
  const oursFile = tokensPath ? path.resolve(tokensPath) : path.join(showroomDir, "tokens.json");
  const recordFile = path.join(showroomDir, "originality.md");
  if (!fs.existsSync(oursFile)) failUse(`找不到令牌：${oursFile}`);

  const ours = [];
  collect(readJson(oursFile), [], ours);
  const refs = orderedAbs.map((file) => {
    const colors = [];
    collect(loadRef(file), [], colors);
    return { file, colors };
  });
  const baseCount = new Map();
  for (const ref of refs) {
    const base = path.basename(ref.file);
    baseCount.set(base, (baseCount.get(base) || 0) + 1);
  }
  for (const ref of refs) {
    const base = path.basename(ref.file);
    ref.label = baseCount.get(base) > 1 ? `${path.basename(path.dirname(ref.file))}/${base}` : base;
  }

  const failures = [];
  const warnings = [];
  const primary = pick(ours, PRIMARY_KEYS);
  const accent = pick(ours, ACCENT_KEYS);
  const bg = pick(ours, BG_KEYS);
  const mainRef = refs[0];
  const mainChromatic = chromaticOf(mainRef.colors);

  console.log(`主参考：${mainRef.label}`);
  if (refs.length > 1) {
    console.log(`副参考：${refs.slice(1).map((ref) => `${ref.label}（不查单色距离）`).join("、")}`);
  }

  for (const [label, color] of [["主色", primary], ["强调色", accent]]) {
    if (!color) {
      failures.push(`没有找到${label}`);
      continue;
    }
    if (!mainChromatic.length) continue;
    const near = nearest(color, mainChromatic);
    console.log(`${label} ${color.hex} 离主参考最近的有彩色 ${near.item.hex} ΔE00 ${near.dE.toFixed(2)}`);
    if (near.dE < CHROMATIC) failures.push(`${label} ${color.hex} 离主参考 ${near.item.hex} 只有 ΔE00 ${near.dE.toFixed(2)}，要 ≥ ${CHROMATIC}`);
  }
  if ((primary || accent) && !mainChromatic.length) console.log("主参考没有有彩色，单色距离跳过");

  if (bg) {
    for (const ref of refs) {
      const refBg = ref.colors.filter((item) => BG_KEYS.has(item.leaf));
      if (!refBg.length) continue;
      const near = nearest(bg, refBg);
      const bothLight = nearWhite(bg.lab) && nearWhite(near.item.lab);
      const bothDark = nearBlack(bg.lab) && nearBlack(near.item.lab);
      const where = refs.length > 1 ? ` ${ref.label} 的背景` : "参考背景";
      console.log(`背景 ${bg.hex} 离${where} ${near.item.hex} ΔE00 ${near.dE.toFixed(2)}`);
      if (near.dE < BACKGROUND) {
        const message = `背景 ${bg.hex} 离${where} ${near.item.hex} 只有 ΔE00 ${near.dE.toFixed(2)}，要 ≥ ${BACKGROUND}`;
        if (bothLight || bothDark) warnings.push(`${message}（两边都是近白或近黑，只警告）`);
        else failures.push(message);
      }
    }
  }

  let checkedPair = false;
  if (primary && accent) {
    for (const ref of refs) {
      const pool = chromaticOf(ref.colors);
      if (pool.length < 2) continue;
      checkedPair = true;
      const hit = findPair(primary, accent, pool);
      if (!hit) continue;
      const whose = refs.length > 1 ? ` ${ref.label} 的 ` : "参考的 ";
      failures.push(`主色和强调色同时靠近${whose}${hit.left.hex}（ΔE00 ${hit.d1.toFixed(2)}）和 ${hit.right.hex}（ΔE00 ${hit.d2.toFixed(2)}），要至少换掉一个`);
    }
    if (checkedPair && !failures.some((item) => item.startsWith("主色和强调色同时靠近"))) {
      console.log(refs.length > 1 ? "主色 + 强调色没有同时落在任一参考的一组里" : "主色 + 强调色没有同时落在参考的一组里");
    }
  }

  if (signatures) {
    if (!fs.existsSync(path.resolve(signatures))) failUse(`找不到招牌清单：${signatures}`);
    if (!fs.existsSync(recordFile)) failures.push("缺少 originality.md");
    else {
      const rows = checkSignatureRecords(parseSignatures(fs.readFileSync(path.resolve(signatures), "utf8")), fs.readFileSync(recordFile, "utf8"));
      for (const row of rows) {
        if (row.ok) console.log(`招牌 ${row.id} 已记录`);
        else failures.push(row.problem);
      }
    }
  }

  for (const item of warnings) console.log(`警告：${item}`);
  for (const item of failures) console.log(`失败：${item}`);
  console.log(failures.length ? "原创性：不通过" : "原创性：通过");
  process.exit(failures.length ? 1 : 0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main();
