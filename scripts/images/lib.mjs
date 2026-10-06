/**
 * 配图脚本共用：参数、样板间清单、调色、MiniMax 地址。
 * 不读、不写密钥本身。日志要先过 redact()。
 */
import fs from "fs";
import path from "path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "url";
import { readJson } from "../lib/json.mjs";

const require = createRequire(import.meta.url);

export const NEGATIVE = "无文字、无 logo、无水印、不要真实品牌";
export const INPUT_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
const ASPECTS = [
  ["1:1", 1],
  ["16:9", 16 / 9],
  ["4:3", 4 / 3],
  ["3:2", 3 / 2],
  ["2:3", 2 / 3],
  ["3:4", 3 / 4],
  ["9:16", 9 / 16],
  ["21:9", 21 / 9],
];

export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function die(message) {
  const error = new Error(message);
  error.code = "EDIE";
  throw error;
}

export function redact(value) {
  let text = String(value ?? "");
  const key = process.env.MINIMAX_API_KEY;
  if (key && key.length >= 8) text = text.split(key).join("[REDACTED]");
  text = text.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
  text = text.replace(/MINIMAX_API_KEY\s*[=:]\s*\S+/gi, "MINIMAX_API_KEY=[REDACTED]");
  return text;
}

export function reportError(err) {
  const text = err && err.code === "EDIE" ? err.message : (err && err.stack) || String(err);
  console.error(redact(text));
  process.exit(1);
}

export function parseArgs(argv, known) {
  const out = { _: [] };
  const flags = new Set(known);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      out._.push(token);
      continue;
    }
    const name = token.slice(2);
    if (!flags.has(name)) die(`未知参数：${token}`);
    if (name === "dry-run") {
      if (out.dryRun) die("重复参数：--dry-run");
      out.dryRun = true;
      continue;
    }
    if (out[name] !== undefined) die(`重复参数：--${name}`);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) die(`参数缺少值：--${name}`);
    out[name] = value;
    i += 1;
  }
  if (out._.length) die(`多余参数：${out._.join(" ")}`);
  return out;
}

export function parseRatio(ratio) {
  const match = String(ratio ?? "").trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!match) die(`比例不合法：${ratio}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0) || !(height > 0)) die(`比例不合法：${ratio}`);
  return width / height;
}

export function parsePx(px) {
  const match = String(px ?? "").trim().match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) die(`像素不合法：${px}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0) || !(height > 0)) die(`像素不合法：${px}`);
  return { width, height };
}

export function aspectRatioFor(ratio) {
  const value = parseRatio(ratio);
  const exact = ASPECTS.find(([name]) => name === String(ratio).trim());
  if (exact) return { aspect: exact[0], exact: true };
  let best = ASPECTS[0];
  let diff = Infinity;
  for (const item of ASPECTS) {
    const gap = Math.abs(item[1] - value);
    if (gap < diff) {
      diff = gap;
      best = item;
    }
  }
  return { aspect: best[0], exact: false };
}

/** 首屏大图：hero，或首页里宽度达到 1440 的满宽图。单位是字节。 */
export function byteLimit(slot) {
  const { width } = parsePx(slot.px);
  const large = slot.block === "hero" || (slot.page === "home" && width >= 1440);
  return large ? 250 * 1024 : 150 * 1024;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "未知";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function limitLabel(bytes) {
  return bytes === 250 * 1024 ? "250 KB" : "150 KB";
}

function num(value, fallback, name) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) die(`${name} 不是数字`);
  return parsed;
}

export function resolveGradeParams(doc, slot) {
  const raw = { ...(doc.gradeParams || {}), ...(slot.gradeParams || {}) };
  const brightness = num(raw.brightness, 1, "brightness");
  const contrast = num(raw.contrast, 1, "contrast");
  const saturate = num(raw.saturate, 1, "saturate");
  const warmth = num(raw.warmth, 0, "warmth");
  if (brightness < 0 || brightness > 3) die(`brightness 要在 0 到 3：${brightness}`);
  if (contrast < 0 || contrast > 3) die(`contrast 要在 0 到 3：${contrast}`);
  if (saturate < 0 || saturate > 3) die(`saturate 要在 0 到 3：${saturate}`);
  if (warmth < -1 || warmth > 1) die(`warmth 要在 -1 到 1：${warmth}`);
  let tint = null;
  if (raw.tint != null) {
    if (typeof raw.tint !== "object" || typeof raw.tint.color !== "string") die("tint 要有 color");
    if (!/^#[0-9a-fA-F]{6}$/.test(raw.tint.color)) die(`tint.color 要是 #RRGGBB：${raw.tint.color}`);
    const opacity = num(raw.tint.opacity, 0, "tint.opacity");
    if (opacity < 0 || opacity > 1) die(`tint.opacity 要在 0 到 1：${opacity}`);
    tint = { color: raw.tint.color, opacity };
  }
  return { brightness, contrast, saturate, warmth, tint };
}

export function buildPrompt(doc, slot) {
  const grade = String(slot.grade || doc.grade || "").trim();
  const prompt = [String(slot.prompt || "").trim(), grade, NEGATIVE].filter(Boolean).join(" ");
  if (!prompt) die(`${slot.id} 没有 prompt`);
  if (prompt.length > 1500) die(`${slot.id} 的 prompt 有 ${prompt.length} 字，超过 1500`);
  return redact(prompt);
}

export function loadImages(showroomId) {
  if (!/^[a-z0-9_-]+$/.test(showroomId || "")) die(`样板间 id 不合法：${showroomId || ""}`);
  const file = path.join(repoRoot(), "showrooms", showroomId, "images.json");
  if (!fs.existsSync(file)) die(`找不到图片清单：${file}`);
  let doc;
  try {
    doc = readJson(file);
  } catch (err) {
    die(err.message);
  }
  if (!doc || !Array.isArray(doc.slots)) die(`${file} 没有 slots 数组`);
  return { file, doc };
}

export function aiSlots(doc) {
  return doc.slots.filter((slot) => slot && slot.source === "ai");
}

export function clientSlots(doc) {
  return doc.slots.filter((slot) => slot && slot.source === "client");
}

export function findSlotFile(dir, id) {
  for (const ext of INPUT_EXT) {
    const file = path.join(dir, id + ext);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return "";
}

export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: ".jpg", mime: "image/jpeg" };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: ".png", mime: "image/png" };
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { ext: ".webp", mime: "image/webp" };
  if (buf.toString("ascii", 0, 3) === "GIF") return { ext: ".gif", mime: "image/gif" };
  return null;
}

/**
 * 找 Playwright 的入口文件。先看环境变量 PLAYWRIGHT_PATH：
 * 指到入口文件（.../playwright/index.mjs）或指到包目录（.../playwright）都行，指到目录时自动找里面的 index.mjs / index.js。
 * 没设置，或设置的路径不存在，就按 Node 正常的模块解析去找 playwright。找不到返回空串。
 * check-visual.mjs、shot.mjs、配图脚本都用这一个函数。
 */
export function findPlaywright() {
  const fromEnv = process.env.PLAYWRIGHT_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) {
    if (!fs.statSync(fromEnv).isDirectory()) return fromEnv;
    for (const name of ["index.mjs", "index.js"]) {
      const file = path.join(fromEnv, name);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
    }
  }
  try {
    const resolved = require.resolve("playwright");
    if (resolved && fs.existsSync(resolved)) return resolved;
  } catch {
    // 从当前文件往上没有这个包
  }
  return "";
}

export async function launchBrowser() {
  const found = findPlaywright();
  if (!found) die("没有找到 Playwright。设置环境变量 PLAYWRIGHT_PATH，或把它装到 Node 能解析到的位置。");
  const loaded = await import(pathToFileURL(found).href);
  const chromium = loaded.chromium || loaded.default?.chromium;
  if (!chromium) die("Playwright 在，但没有 chromium 导出");
  const tries = [{ headless: true }, { headless: true, channel: "chrome" }, { headless: true, channel: "msedge" }];
  let last = null;
  for (const options of tries) {
    try {
      return await chromium.launch(options);
    } catch (err) {
      last = err;
    }
  }
  die(`浏览器没启动：${last && last.message ? last.message : last}`);
}

export function minimaxEndpoint() {
  const raw = (process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1").trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(raw);
  } catch {
    die("MINIMAX_BASE_URL 不是合法地址");
  }
  if (url.protocol !== "https:") die("MINIMAX_BASE_URL 必须是 https");
  if (raw.endsWith("/image_generation")) return raw;
  return `${raw}/image_generation`;
}

export function apiKey() {
  const key = process.env.MINIMAX_API_KEY;
  if (!key || !String(key).trim()) die("没有环境变量 MINIMAX_API_KEY");
  return String(key).trim();
}

export function clipJson(value, depth = 0) {
  if (typeof value === "string") {
    const clean = redact(value);
    if (clean.length > 160) return `${clean.slice(0, 40)}…（${clean.length} 字）`;
    return clean;
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (depth > 4) return "…";
  if (Array.isArray(value)) return value.slice(0, 6).map((item) => clipJson(item, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = clipJson(item, depth + 1);
    return out;
  }
  return redact(String(value));
}

export function summarizeBody(text) {
  const clean = redact(text).replace(/\s+/g, " ").trim();
  if (clean.length <= 2000) return clean;
  return `${clean.slice(0, 2000)}…（已截断）`;
}

export function printTable(headers, rows) {
  const body = rows.map((row) => row.map((cell) => String(cell)));
  const all = [headers, ...body];
  const widths = headers.map((_, index) => Math.max(...all.map((row) => row[index].length)));
  for (const row of all) {
    console.log(row.map((cell, index) => cell + " ".repeat(widths[index] - cell.length)).join("  "));
  }
}

/**
 * 在页面里裁切、调色、压成 JPEG。由 page.evaluate 调用，不能引用 Node。
 * spec.imageDataUrl、width、height、focus、params、limit、startQuality、minQuality、sample。
 */
export function gradeInPage(spec) {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function hexToRgba(hex, opacity) {
    const h = hex.replace("#", "");
    const r = Number.parseInt(h.slice(0, 2), 16);
    const g = Number.parseInt(h.slice(2, 4), 16);
    const b = Number.parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  function focusOf(focus, width, height) {
    if (!focus) return { x: 0.5, y: 0.5 };
    let x = Number(focus[0]);
    let y = Number(focus[1]);
    if (x > 1 || y > 1) {
      x /= width;
      y /= height;
    }
    return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const srcW = img.naturalWidth;
        const srcH = img.naturalHeight;
        if (!srcW || !srcH) throw new Error("图片尺寸是 0");
        const tw = spec.width;
        const th = spec.height;
        const outRatio = tw / th;
        const srcRatio = srcW / srcH;
        let cropW;
        let cropH;
        if (srcRatio > outRatio) {
          cropH = srcH;
          cropW = cropH * outRatio;
        } else {
          cropW = srcW;
          cropH = cropW / outRatio;
        }
        const focus = focusOf(spec.focus, srcW, srcH);
        let cropX = focus.x * srcW - cropW / 2;
        let cropY = focus.y * srcH - cropH / 2;
        cropX = clamp(cropX, 0, Math.max(0, srcW - cropW));
        cropY = clamp(cropY, 0, Math.max(0, srcH - cropH));
        if (cropX + cropW > srcW) cropW = srcW - cropX;
        if (cropY + cropH > srcH) cropH = srcH - cropY;

        const canvas = document.createElement("canvas");
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const params = spec.params || {};
        const brightness = Number(params.brightness ?? 1);
        const contrast = Number(params.contrast ?? 1);
        const saturate = Number(params.saturate ?? 1);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        if (brightness !== 1 || contrast !== 1 || saturate !== 1) {
          ctx.filter = `brightness(${brightness}) contrast(${contrast}) saturate(${saturate})`;
        }
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, tw, th);
        ctx.filter = "none";

        const warmth = Number(params.warmth ?? 0);
        if (warmth) {
          const amount = clamp(warmth, -1, 1);
          const alpha = Math.min(0.55, Math.abs(amount) * 0.45);
          if (alpha > 0) {
            ctx.globalCompositeOperation = "soft-light";
            ctx.fillStyle = amount > 0 ? `rgba(214, 132, 54, ${alpha})` : `rgba(64, 122, 196, ${alpha})`;
            ctx.fillRect(0, 0, tw, th);
            ctx.globalCompositeOperation = "source-over";
          }
        }
        const tint = params.tint;
        if (tint && tint.color && Number(tint.opacity) > 0) {
          ctx.globalCompositeOperation = "soft-light";
          ctx.fillStyle = hexToRgba(tint.color, clamp(Number(tint.opacity), 0, 1));
          ctx.fillRect(0, 0, tw, th);
          ctx.globalCompositeOperation = "source-over";
        }

        let sample = null;
        if (spec.sample) {
          const pixel = ctx.getImageData(Math.floor(tw / 2), Math.floor(th / 2), 1, 1).data;
          sample = [pixel[0], pixel[1], pixel[2], pixel[3]];
        }

        const limit = spec.limit;
        const floor = spec.minQuality || 20;
        let quality = spec.startQuality || 80;
        const tried = [];
        let chosen = "";
        let bytes = 0;
        while (true) {
          const dataUrl = canvas.toDataURL("image/jpeg", quality / 100);
          const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1).replace(/\s/g, "");
          const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
          bytes = Math.floor((b64.length * 3) / 4) - pad;
          tried.push({ quality, bytes });
          chosen = b64;
          if (bytes <= limit || quality <= floor) break;
          quality -= 5;
        }
        resolve({
          base64: chosen,
          quality,
          bytes,
          width: tw,
          height: th,
          tried,
          sample,
          srcWidth: srcW,
          srcHeight: srcH,
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    img.onerror = () => reject(new Error("浏览器解不开这张图"));
    img.src = spec.imageDataUrl;
  });
}
