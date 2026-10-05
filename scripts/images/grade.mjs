/**
 * node scripts/images/grade.mjs --showroom <id> --in <目录> --out <目录>
 * 按图片位的比例和像素居中裁切（可用 focus），套上统一调色，压成 JPG。
 * 输入目录里有的位才处理。没有 gradeParams 时用中性参数。
 */
import fs from "fs";
import path from "path";
import { imageSize } from "../lib/image-size.mjs";
import {
  INPUT_EXT,
  byteLimit,
  die,
  findSlotFile,
  formatBytes,
  gradeInPage,
  launchBrowser,
  limitLabel,
  loadImages,
  parseArgs,
  parsePx,
  parseRatio,
  printTable,
  reportError,
  resolveGradeParams,
  sniffImage,
} from "./lib.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2), ["showroom", "in", "out"]);
  if (!args.showroom || !args.in || !args.out) {
    die("用法：node scripts/images/grade.mjs --showroom <id> --in <目录> --out <目录>");
  }
  const inDir = path.resolve(args.in);
  const outDir = path.resolve(args.out);
  if (!fs.existsSync(inDir) || !fs.statSync(inDir).isDirectory()) die(`输入目录不存在：${inDir}`);
  const { doc } = loadImages(args.showroom);
  const slots = doc.slots.filter((slot) => slot && slot.id);
  const known = new Set(slots.map((slot) => slot.id));
  for (const name of fs.readdirSync(inDir)) {
    const ext = path.extname(name).toLowerCase();
    if (!INPUT_EXT.includes(ext)) continue;
    const id = path.basename(name, path.extname(name));
    if (!known.has(id)) console.log(`跳过，清单里没有这个位：${name}`);
  }
  const jobs = [];
  let missing = 0;
  for (const slot of slots) {
    const file = findSlotFile(inDir, slot.id);
    if (!file) {
      missing += 1;
      continue;
    }
    jobs.push({ slot, file });
  }
  if (!jobs.length) die("输入目录里没有对得上的图片");
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await launchBrowser();
  const rows = [];
  let bad = 0;
  try {
    const page = await browser.newPage();
    for (const job of jobs) {
      const row = await gradeOne(page, doc, job, outDir);
      rows.push(row.cells);
      if (!row.ok) bad += 1;
    }
  } finally {
    await browser.close();
  }
  console.log(`调色  ${args.showroom}  已处理 ${jobs.length} 张，清单里还有 ${missing} 张没有文件`);
  printTable(["id", "ratio", "px", "bytes", "quality", "limit", "result"], rows);
  if (bad) process.exit(1);
}

async function gradeOne(page, doc, job, outDir) {
  const { slot, file } = job;
  if (!slot.ratio || !slot.px) die(`${slot.id} 缺少 ratio 或 px`);
  const px = parsePx(slot.px);
  const declared = parseRatio(slot.ratio);
  if (slot.focus != null) {
    if (!Array.isArray(slot.focus) || slot.focus.length !== 2 || slot.focus.some((item) => !Number.isFinite(Number(item)))) {
      die(`${slot.id} 的 focus 要是 [x, y]`);
    }
  }
  const params = resolveGradeParams(doc, slot);
  const limit = byteLimit(slot);
  const buf = fs.readFileSync(file);
  const kind = sniffImage(buf);
  if (!kind) die(`${slot.id} 不是 png、jpeg、webp 或 gif：${file}`);
  console.log(`裁切 ${slot.id}  ${path.basename(file)}`);
  const result = await page.evaluate(gradeInPage, {
    imageDataUrl: `data:${kind.mime};base64,${buf.toString("base64")}`,
    width: px.width,
    height: px.height,
    focus: slot.focus || null,
    params,
    limit,
    startQuality: 80,
    minQuality: 20,
  });
  const jpeg = Buffer.from(result.base64, "base64");
  if (!sniffImage(jpeg) || sniffImage(jpeg).ext !== ".jpg") die(`${slot.id} 导出的不是 jpeg`);
  const outFile = path.join(outDir, `${slot.id}.jpg`);
  fs.writeFileSync(outFile, jpeg);
  const size = imageSize(outFile);
  const bytes = jpeg.length;
  const pxOk = Boolean(size && size.width === px.width && size.height === px.height);
  const ratioOk = Boolean(size && Math.abs(size.width / size.height - declared) <= 0.01);
  const sizeOk = bytes <= limit;
  let resultText = "通过";
  if (!size) resultText = "读不出尺寸";
  else if (!pxOk) resultText = `尺寸 ${size.width}x${size.height}`;
  else if (!ratioOk) resultText = "比例不符";
  else if (!sizeOk) resultText = "超出";
  return {
    ok: resultText === "通过",
    cells: [slot.id, String(slot.ratio), `${px.width}x${px.height}`, formatBytes(bytes), String(result.quality), limitLabel(limit), resultText],
  };
}

main().catch(reportError);
