/**
 * node scripts/images/gen-ai.mjs --showroom <id> --out <目录> [--only <slot>] [--dry-run]
 * 给 source 为 ai 的图片位调用 MiniMax image-01。source 为 client 的位跳过。--dry-run 只打印 prompt，不请求。
 * 每次运行对每个选中的位发 1 次生成请求。密钥只从 MINIMAX_API_KEY 读取。
 */
import fs from "fs";
import os from "os";
import path from "path";
import { readJson } from "../lib/json.mjs";
import { imageSize } from "../lib/image-size.mjs";
import {
  aiSlots,
  clientSlots,
  apiKey,
  aspectRatioFor,
  buildPrompt,
  clipJson,
  die,
  formatBytes,
  gradeInPage,
  launchBrowser,
  loadImages,
  minimaxEndpoint,
  parseArgs,
  redact,
  reportError,
  sniffImage,
  summarizeBody,
} from "./lib.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2), ["showroom", "out", "only", "dry-run"]);
  if (!args.showroom || !args.out) {
    die("用法：node scripts/images/gen-ai.mjs --showroom <id> --out <目录> [--only <slot>] [--dry-run]");
  }
  const { doc } = loadImages(args.showroom);
  const slots = selectSlots(doc, args.only);
  if (!slots.length) {
    console.log(`${args.only} 是客户提供，跳过，不生成`);
    return;
  }
  if (args.dryRun) {
    dryRun(args.showroom, doc, slots);
    return;
  }
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const key = apiKey();
  const endpoint = minimaxEndpoint();
  console.log(`生成  ${args.showroom}  ${slots.length} 个 ai 位  每个 1 次请求`);
  console.log(`POST ${endpoint}`);
  const holder = { browser: null, page: null };
  try {
    for (const slot of slots) {
      await generateOne(doc, slot, { key, endpoint, outDir, holder, showroom: args.showroom });
    }
  } finally {
    if (holder.browser) await holder.browser.close();
  }
}

function selectSlots(doc, only) {
  if (!only) {
    const clients = clientSlots(doc);
    if (clients.length) console.log(`跳过客户提供 ${clients.length} 个：${clients.map((slot) => slot.id).join("、")}`);
    const slots = aiSlots(doc);
    if (!slots.length) die("没有 source 为 ai 的图片位");
    return slots;
  }
  const slot = doc.slots.find((item) => item && item.id === only);
  if (!slot) die(`没有这个图片位：${only}`);
  if (slot.source === "client") return [];
  if (slot.source !== "ai") die(`${only} 的 source 不是 ai`);
  return [slot];
}

function dryRun(showroom, doc, slots) {
  console.log(`dry-run  ${showroom}  ai 位 ${slots.length} 个  模型 image-01  不请求网络`);
  for (const slot of slots) {
    const mapped = aspectRatioFor(slot.ratio);
    const prompt = buildPrompt(doc, slot);
    const ratioNote = mapped.exact ? mapped.aspect : `${slot.ratio} → ${mapped.aspect}`;
    const real = slot.mustBeReal ? "  mustBeReal：演示可生成，交给客户必须换实拍" : "";
    console.log("");
    console.log(`${slot.id}  比例 ${slot.ratio}  aspect_ratio ${ratioNote}  ${slot.px}${real}`);
    console.log(prompt);
  }
}

async function generateOne(doc, slot, ctx) {
  const mapped = aspectRatioFor(slot.ratio);
  const prompt = buildPrompt(doc, slot);
  if (slot.mustBeReal) console.log(`${slot.id}  mustBeReal：这张只适合演示，交给客户必须换成实拍`);
  const payload = {
    model: "image-01",
    prompt,
    aspect_ratio: mapped.aspect,
    response_format: "url",
    n: 1,
    prompt_optimizer: false,
    aigc_watermark: false,
  };
  console.log("");
  console.log(`${slot.id}  aspect_ratio ${mapped.aspect}${mapped.exact ? "" : `（slot ${slot.ratio}）`}`);
  console.log(prompt);
  console.log("请求字段：model, prompt, aspect_ratio, response_format, n, prompt_optimizer, aigc_watermark");
  const started = Date.now();
  let response;
  let rawText = "";
  try {
    response = await fetch(ctx.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(180000),
    });
    rawText = await response.text();
  } catch (err) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    die(`MiniMax 请求失败（${elapsed}s）：${err.message || err}`);
  }
  let json;
  try {
    json = JSON.parse(rawText);
  } catch {
    die(`MiniMax HTTP ${response.status}，响应不是 JSON（${((Date.now() - started) / 1000).toFixed(1)}s）：${summarizeBody(rawText)}`);
  }
  const base = json.base_resp || {};
  const statusCode = base.status_code == null ? null : Number(base.status_code);
  if (!response.ok || (statusCode != null && statusCode !== 0)) {
    die(`MiniMax HTTP ${response.status}，status_code=${base.status_code ?? "无"}，status_msg=${base.status_msg || "无"}，响应：${JSON.stringify(clipJson(json))}`);
  }
  const urls = stringList(json.data && json.data.image_urls);
  const b64s = stringList(json.data && json.data.image_base64);
  collectImageUrls(json, urls);
  let got = null;
  if (urls.length) {
    try {
      got = await fetchRemote(urls[0]);
    } catch (err) {
      if (!b64s.length) throw err;
      console.log(`直链下载失败：${redact(err.message || String(err))}，改用响应里的 base64`);
    }
  }
  if (!got && b64s.length) got = decodeBase64(b64s[0]);
  if (!got) die(`响应里没有图片。响应摘要：${JSON.stringify(clipJson(json))}`);
  const file = await saveJpeg(ctx.holder, slot.id, got.buf, ctx.outDir);
  const elapsedMs = Date.now() - started;
  const size = imageSize(file);
  const bytes = fs.statSync(file).size;
  const entry = {
    id: slot.id,
    mustBeReal: Boolean(slot.mustBeReal),
    slotRatio: slot.ratio,
    px: slot.px,
    aspectRatio: mapped.aspect,
    aspectExact: mapped.exact,
    prompt,
    request: {
      model: payload.model,
      aspect_ratio: payload.aspect_ratio,
      response_format: payload.response_format,
      n: payload.n,
      prompt_optimizer: payload.prompt_optimizer,
      aigc_watermark: payload.aigc_watermark,
    },
    httpStatus: response.status,
    responseTopKeys: Object.keys(json),
    dataKeys: json.data && typeof json.data === "object" && !Array.isArray(json.data) ? Object.keys(json.data) : [],
    baseResp: clipJson(json.base_resp || null),
    metadata: clipJson(json.metadata || null),
    taskId: typeof json.id === "string" ? json.id : "",
    delivery: got.delivery,
    urlHost: got.host,
    file: path.basename(file),
    bytes,
    width: size ? size.width : 0,
    height: size ? size.height : 0,
    elapsedMs,
    savedAt: new Date().toISOString(),
  };
  writeLog(path.join(ctx.outDir, "ai-log.json"), ctx.showroom, entry, ctx.endpoint);
  const pxText = size ? `${size.width}x${size.height}` : "尺寸未知";
  console.log(`HTTP ${response.status}`);
  console.log(`响应字段：${entry.responseTopKeys.join(", ") || "无"}`);
  console.log(`data 字段：${entry.dataKeys.join(", ") || "无"}`);
  console.log(`base_resp：${base.status_code ?? "无"} ${base.status_msg || ""}`.trim());
  console.log(`交付：${got.delivery}${got.host ? `（主机 ${got.host}）` : ""}`);
  console.log(`文件 ${file}`);
  console.log(`尺寸 ${pxText}  大小 ${formatBytes(bytes)}`);
  console.log(`耗时 ${(elapsedMs / 1000).toFixed(1)}s`);
}

function stringList(value) {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
}

function collectImageUrls(json, urls) {
  const images = json && json.data && json.data.images;
  if (!Array.isArray(images)) return;
  for (const item of images) {
    if (typeof item === "string" && item.trim()) urls.push(item.trim());
    else if (item && typeof item.url === "string") urls.push(item.url.trim());
    else if (item && typeof item.image_url === "string") urls.push(item.image_url.trim());
  }
}

async function fetchRemote(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    die("图片地址不是 URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") die(`图片地址协议不支持：${parsed.protocol}`);
  console.log(`图片在 ${parsed.host}，开始下载`);
  let response;
  try {
    response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60000) });
  } catch (err) {
    die(`图片下载失败：${err.message || err}`);
  }
  if (!response.ok) die(`图片下载 HTTP ${response.status}`);
  const buf = Buffer.from(await response.arrayBuffer());
  if (!sniffImage(buf)) die("图片下载结果不是 png、jpeg、webp 或 gif");
  return { buf, host: parsed.host, delivery: "url" };
}

function decodeBase64(entry) {
  const match = String(entry).match(/^data:image\/[a-zA-Z0-9.+-]+;base64,([\s\S]+)$/);
  const b64 = (match ? match[1] : entry).replace(/\s/g, "");
  const buf = Buffer.from(b64, "base64");
  if (!sniffImage(buf)) die("base64 不是图片");
  return { buf, host: "", delivery: "base64" };
}

async function saveJpeg(holder, id, buf, dir) {
  const kind = sniffImage(buf);
  if (!kind) die("生成结果不是图片");
  const file = path.join(dir, `${id}.jpg`);
  if (kind.ext === ".jpg") {
    fs.writeFileSync(file, buf);
    return file;
  }
  const size = sizeOf(buf, kind.ext);
  if (!size) die("读不出生成图的尺寸，无法转成 jpg");
  if (!holder.browser) holder.browser = await launchBrowser();
  if (!holder.page) holder.page = await holder.browser.newPage();
  const result = await holder.page.evaluate(gradeInPage, {
    imageDataUrl: `data:${kind.mime};base64,${buf.toString("base64")}`,
    width: size.width,
    height: size.height,
    focus: null,
    params: { brightness: 1, contrast: 1, saturate: 1, warmth: 0, tint: null },
    limit: 30 * 1024 * 1024,
    startQuality: 92,
    minQuality: 92,
  });
  fs.writeFileSync(file, Buffer.from(result.base64, "base64"));
  return file;
}

function sizeOf(buf, ext) {
  const file = path.join(os.tmpdir(), `fitout-${process.pid}-${Date.now()}${ext}`);
  fs.writeFileSync(file, buf);
  try {
    return imageSize(file);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

function writeLog(file, showroom, entry, endpoint) {
  let doc = { showroom, model: "image-01", endpoint, items: [] };
  if (fs.existsSync(file)) {
    try {
      const prev = readJson(file);
      if (prev && Array.isArray(prev.items)) doc = prev;
    } catch {
      doc = { showroom, model: "image-01", endpoint, items: [] };
    }
  }
  const items = (doc.items || []).filter((item) => item && item.id !== entry.id);
  items.push(entry);
  const next = {
    showroom: showroom || doc.showroom || "",
    model: "image-01",
    endpoint,
    items,
  };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

main().catch(reportError);
