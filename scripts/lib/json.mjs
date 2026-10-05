/**
 * 读 JSON。去掉 UTF-8 BOM。语法错抛中文错误，带文件和行号，不带堆栈。
 */
import fs from "fs";
import path from "path";

export function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    const error = new Error(`读不了 ${file}：${err.message}`);
    error.code = "EREAD";
    throw error;
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return JSON.parse(text);
  } catch (err) {
    const spot = locate(text, err);
    const error = new Error(`${path.basename(file)} 不是合法 JSON：${file} 第 ${spot.line} 行第 ${spot.column} 列`);
    error.code = "EBADJSON";
    throw error;
  }
}

function locate(text, err) {
  const msg = String(err?.message || "");
  const lineCol = msg.match(/line (\d+) column (\d+)/i);
  if (lineCol) return { line: Number(lineCol[1]), column: Number(lineCol[2]) };
  const pos = msg.match(/position (\d+)/i);
  if (pos) {
    const index = Number(pos[1]);
    const head = text.slice(0, index);
    return { line: head.split("\n").length, column: index - head.lastIndexOf("\n") };
  }
  return { line: 1, column: 1 };
}
