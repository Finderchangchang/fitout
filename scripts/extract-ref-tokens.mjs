/**
 * node scripts/extract-ref-tokens.mjs <measure.json> [--out tokens.ref.json]
 * 从量取结果里抽出原创性检查要的颜色。逻辑对齐仓库外的 extract-ref-tokens，只留颜色。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export function tokensFromMeasure(json) {
  const desktop = json?.desktop && typeof json.desktop === "object" ? json.desktop : json;
  const colors = desktop?.colors || {};
  const primary = colors.primaryButtonBg || colors.primary || null;
  const accents = [];
  for (const item of colors.accents || []) {
    const hex = typeof item === "string" ? item : item?.hex;
    if (typeof hex === "string" && hex) accents.push(hex);
  }
  const accent = accents.find((hex) => hex.toLowerCase() !== String(primary || "").toLowerCase()) || accents[0] || colors.accent || null;
  return {
    color: {
      bg: colors.pageBg || colors.bg || null,
      primary,
      accent,
    },
    palette: accents,
  };
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((item) => !item.startsWith("--"));
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args[outIdx + 1] : "";
  if (!file) {
    console.error("用法：node scripts/extract-ref-tokens.mjs <measure.json> [--out tokens.ref.json]");
    process.exit(2);
  }
  const json = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  const tokens = tokensFromMeasure(json);
  const text = JSON.stringify(tokens, null, 2) + "\n";
  if (out) fs.writeFileSync(path.resolve(out), text, "utf8");
  else process.stdout.write(text);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main();
