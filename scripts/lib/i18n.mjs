/**
 * 框架固定文案和英文日期。
 * lang 不写就是 zh-CN。只接受 zh-CN 或 en。
 */
import path from "path";
import { fileURLToPath } from "url";
import { readJson } from "./json.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cache = new Map();

export const EN_FONT = '"Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif';

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function siteLang(site) {
  const raw = site?.lang;
  if (raw == null || raw === "") return "zh-CN";
  return String(raw);
}

export function langError(site) {
  const raw = site?.lang;
  if (raw == null || raw === "") return "";
  if (raw === "zh-CN" || raw === "en") return "";
  return `lang 只能是 zh-CN 或 en：${raw}`;
}

export function loadCopy(lang) {
  const key = lang === "en" ? "en" : "zh-CN";
  if (!cache.has(key)) cache.set(key, readJson(path.join(root, "framework", "i18n", `${key}.json`)));
  return cache.get(key);
}

/**
 * 英文站把能认出的日期写成 "Sep 2025"。
 * 认：2025年9月、2025年9月12日、2025-09、2025-09-12、2025/09/12、2025.09、September 2025。
 * 日不写进结果。认不出就原样留下。中文站不改。
 */
export function formatDate(value, lang) {
  const text = String(value || "").trim();
  if (lang !== "en" || !text) return text;
  const zh = text.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月(?:\s*\d{1,2}\s*日)?$/);
  if (zh) return monthYear(Number(zh[2]), zh[1], text);
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/);
  if (iso) return monthYear(Number(iso[2]), iso[1], text);
  const named = text.match(/^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d{4})$/i);
  if (named) {
    const idx = MONTHS.findIndex((item) => named[1].toLowerCase().startsWith(item.toLowerCase()));
    if (idx >= 0) return `${MONTHS[idx]} ${named[2]}`;
  }
  return text;
}

function monthYear(month, year, original) {
  if (!Number.isInteger(month) || month < 1 || month > 12) return original;
  return `${MONTHS[month - 1]} ${year}`;
}
