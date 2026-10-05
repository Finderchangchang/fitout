/**
 * node scripts/images/fetch-stock.mjs --plan <stock-plan.json> --out <目录> [--dry-run]
 * 按下选图清单下载首选图，失败再用备选。--dry-run 只打印文件和估计大小，不下载。
 */
import fs from "fs";
import path from "path";
import { readJson } from "../lib/json.mjs";
import {
  clientSlots,
  die,
  formatBytes,
  loadImages,
  parseArgs,
  redact,
  reportError,
  sniffImage,
} from "./lib.mjs";

const MAX_BYTES = 30 * 1024 * 1024;

async function main() {
  const args = parseArgs(process.argv.slice(2), ["plan", "out", "dry-run"]);
  if (!args.plan || !args.out) {
    die("用法：node scripts/images/fetch-stock.mjs --plan <stock-plan.json> --out <目录> [--dry-run]");
  }
  const plan = readPlan(path.resolve(args.plan));
  const items = withoutClient(plan);
  if (args.dryRun) dryRun(plan, items);
  else await downloadAll(plan, items, path.resolve(args.out));
}

function withoutClient(plan) {
  const skip = clientIds(plan.showroom);
  const kept = [];
  for (const item of plan.items) {
    if (skip.has(item.id)) console.log(`${item.id}  是客户提供，跳过`);
    else kept.push(item);
  }
  return kept;
}

function clientIds(showroom) {
  if (!showroom) return new Set();
  const { doc } = loadImages(showroom);
  return new Set(clientSlots(doc).map((slot) => slot.id));
}

function readPlan(file) {
  if (!fs.existsSync(file)) die(`找不到清单：${file}`);
  let doc;
  try {
    doc = readJson(file);
  } catch (err) {
    die(err.message);
  }
  if (!doc || !Array.isArray(doc.items) || doc.items.length === 0) die("清单要有非空的 items 数组");
  if (doc.showroom != null && !/^[a-z0-9_-]+$/.test(doc.showroom)) die(`showroom 不合法：${doc.showroom}`);
  const seen = new Set();
  const items = doc.items.map((item) => normalizeItem(item, seen));
  return { showroom: doc.showroom || "", items };
}

function normalizeItem(item, seen) {
  if (!item || typeof item !== "object") die("items 里有空项");
  const id = String(item.id || "").trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) die(`slot id 不合法：${item.id || ""}`);
  if (seen.has(id)) die(`重复的 slot：${id}`);
  seen.add(id);
  const primary = candidate(item.primary, id, "首选");
  if (!primary) die(`${id} 缺少首选`);
  const fallback = item.fallback == null ? null : candidate(item.fallback, id, "备选");
  return { id, primary, fallback };
}

function candidate(raw, id, label) {
  if (raw == null) return null;
  if (typeof raw !== "object") die(`${id} 的${label}不是对象`);
  const missing = [];
  for (const key of ["page", "author", "platform", "url", "license"]) {
    if (typeof raw[key] !== "string" || !raw[key].trim()) missing.push(key);
  }
  if (typeof raw.bytes !== "number" || !Number.isFinite(raw.bytes) || raw.bytes < 0) missing.push("bytes");
  if (missing.length) die(`${id} 的${label}缺少字段：${missing.join("、")}`);
  checkHttp(`${id} 的${label}页面链接`, raw.page);
  checkHttp(`${id} 的${label}直链`, raw.url);
  return {
    page: raw.page.trim(),
    author: raw.author.trim(),
    platform: raw.platform.trim(),
    url: raw.url.trim(),
    bytes: raw.bytes,
    license: raw.license.trim(),
  };
}

function checkHttp(label, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    die(`${label}不是 URL：${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") die(`${label}只接受 http 或 https`);
}

function dryRun(plan, items) {
  if (!items.length) {
    console.log("没有要下载的图库图");
    return;
  }
  console.log(`dry-run  ${plan.showroom || "（未写 showroom）"}  ${items.length} 个图片位  不下载`);
  let total = 0;
  for (const item of items) {
    console.log("");
    console.log(item.id);
    printCandidate("首选", item.primary);
    if (item.fallback) printCandidate("备选", item.fallback);
    else console.log("  备选  无");
    total += item.primary.bytes;
  }
  console.log("");
  console.log(`将下载 ${items.length} 个文件（只下首选；首选失败才下备选），估计总大小 ${formatBytes(total)}`);
}

function printCandidate(label, item) {
  console.log(`  ${label}  ${item.platform}  ${item.author}  ${formatBytes(item.bytes)}  ${item.license}`);
  console.log(`        直链 ${item.url}`);
  console.log(`        页面 ${item.page}`);
}

async function downloadAll(plan, items, dir) {
  if (!items.length) {
    console.log("没有要下载的图库图");
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  const saved = [];
  let failed = 0;
  for (const item of items) {
    const result = await downloadItem(item, dir);
    saved.push(result);
    if (!result.ok) failed += 1;
  }
  writeCredits(dir, plan.showroom, saved);
  console.log("");
  console.log(`完成 ${saved.length - failed} 张，失败 ${failed} 张。来源记在 ${path.join(dir, "credits.json")}`);
  if (failed) process.exit(1);
}

async function downloadItem(item, dir) {
  try {
    const got = await downloadImage(item.primary.url);
    const file = writeImage(dir, item.id, got);
    console.log(`${item.id}  首选  ${file}  ${formatBytes(got.buf.length)}`);
    return credit(item, "primary", item.primary, file, got.buf.length, "");
  } catch (err) {
    const reason = redact(err.message || String(err));
    console.log(`${item.id}  首选失败：${reason}`);
    if (!item.fallback) return credit(item, "", null, "", 0, reason);
    try {
      const got = await downloadImage(item.fallback.url);
      const file = writeImage(dir, item.id, got);
      console.log(`${item.id}  备选  ${file}  ${formatBytes(got.buf.length)}`);
      return credit(item, "fallback", item.fallback, file, got.buf.length, reason);
    } catch (fallbackErr) {
      const fallbackReason = redact(fallbackErr.message || String(fallbackErr));
      console.log(`${item.id}  备选失败：${fallbackReason}`);
      return {
        id: item.id,
        ok: false,
        picked: "",
        file: "",
        primaryError: reason,
        fallbackError: fallbackReason,
      };
    }
  }
}

function credit(item, picked, source, file, bytes, primaryError) {
  if (!source) {
    return { id: item.id, ok: false, picked: "", file: "", primaryError, fallbackError: "" };
  }
  return {
    id: item.id,
    ok: true,
    picked,
    file: path.basename(file),
    page: source.page,
    author: source.author,
    platform: source.platform,
    url: source.url,
    license: source.license,
    bytes,
    ...(primaryError ? { primaryError } : {}),
  };
}

async function downloadImage(url) {
  let response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(45000),
      headers: { Accept: "image/*,*/*;q=0.8" },
    });
  } catch (err) {
    die(`下载失败：${err.message || err}`);
  }
  if (!response.ok) die(`HTTP ${response.status}`);
  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.length > MAX_BYTES) die(`文件超过 30MB（${buf.length}）`);
  if (buf.length === 0) die("响应是空的");
  const kind = sniffImage(buf);
  if (!kind) die(`响应不是 png、jpeg、webp 或 gif（${response.headers.get("content-type") || "无类型"}）`);
  return { buf, ...kind };
}

function writeImage(dir, id, got) {
  const file = path.join(dir, id + got.ext);
  fs.writeFileSync(file, got.buf);
  return file;
}

function writeCredits(dir, showroom, items) {
  const file = path.join(dir, "credits.json");
  let doc = { showroom, savedAt: "", items: [] };
  if (fs.existsSync(file)) {
    try {
      const prev = readJson(file);
      if (prev && Array.isArray(prev.items)) doc = prev;
    } catch {
      doc = { showroom, savedAt: "", items: [] };
    }
  }
  const byId = new Map((doc.items || []).filter((item) => item && item.id).map((item) => [item.id, item]));
  for (const item of items) byId.set(item.id, item);
  const next = {
    showroom: showroom || doc.showroom || "",
    savedAt: new Date().toISOString(),
    items: [...byId.values()],
  };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

main().catch(reportError);
