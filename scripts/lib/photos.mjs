import path from "node:path";

const SOURCES = new Set(["photo", "ai", "stock"]);

/** sources.json 支持既有 id→来源，也接受交付清单的 items[{id,file,source}]。 */
export function matchPhotos(files, slots, manifest = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("sources.json 必须是来源对象或包含 items 的交付清单");
  const names = new Map(files.map((file) => [path.basename(file), file]));
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const entries = Array.isArray(manifest.items)
    ? manifest.items
    : Object.entries(manifest).map(([id, source]) => ({ id, source }));
  const paired = [];
  const used = new Set();
  const marks = new Map();
  for (const item of entries) {
    if (!item || typeof item !== "object") throw new Error("sources.json 的每一项必须有 id 和 source");
    if (!slotById.has(item.id)) throw new Error(`照片清单的图片位不存在：${item.id}`);
    if (item.source === "missing" && !item.file) continue;
    if (!SOURCES.has(item.source)) throw new Error(`照片来源只能是 photo、ai、stock：${item.id}`);
    if (marks.has(item.id)) throw new Error(`照片清单的图片位重复：${item.id}`);
    marks.set(item.id, item.source);
    if (!item.file) continue;
    if (path.basename(item.file) !== item.file || /[\\/]/.test(item.file)) throw new Error("照片清单 file 只能是本目录里的文件名");
    const file = names.get(item.file);
    if (!file) throw new Error(`照片清单中的文件不存在：${item.file}`);
    if (used.has(file)) throw new Error(`同一照片重复分配：${item.file}`);
    used.add(file);
    paired.push({ file, slot: slotById.get(item.id), source: item.source });
  }
  const taken = new Set(paired.map((pair) => pair.slot.id));
  for (const file of files) {
    if (used.has(file)) continue;
    const stem = path.basename(file, path.extname(file)).toLowerCase();
    const slot = slots.find((item) => item.id.toLowerCase() === stem && !taken.has(item.id));
    if (!slot) continue;
    used.add(file);
    taken.add(slot.id);
    paired.push({ file, slot, source: marks.get(slot.id) || "photo" });
  }
  for (const pair of paired) {
    if (pair.slot.mustBeReal && pair.source === "ai") throw new Error(`必须实拍的位不能用生成图：${pair.slot.id}`);
  }
  return { paired, leftover: files.filter((file) => !used.has(file)) };
}
