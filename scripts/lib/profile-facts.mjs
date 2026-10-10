const SKIP = new Set(["image", "imageAlt", "href", "primaryHref", "secondaryHref", "moreHref", "backHref", "collection", "pageSize", "limit", "interval", "on", "mode"]);

export function claimsOf(site) {
  const claims = new Map();
  function walk(node, key) {
    if (Array.isArray(node)) node.forEach((item, index) => walk(item, `${key}[${index}]`));
    else if (node && typeof node === "object") {
      for (const [name, value] of Object.entries(node)) if (!SKIP.has(name)) walk(value, `${key}.${name}`);
    } else if (typeof node === "string" && node.trim()) claims.set(key, node);
  }
  walk(site.contact || {}, "contact");
  claims.set("name", site.name || "");
  claims.set("summary", site.summary || "");
  for (const page of site.pages || []) {
    if (page.enabled === false) continue;
    claims.set(`pages.${page.id}.title`, page.title || "");
    claims.set(`pages.${page.id}.description`, page.description || "");
    for (const section of page.sections || []) walk(section.data || {}, `pages.${page.id}.${section.type}`);
  }
  for (const [id, items] of Object.entries(site.collections || {})) {
    for (const item of items) walk(item, `collections.${id}.${item.slug}`);
  }
  return claims;
}

function numbers(text) {
  return String(text).match(/\d+(?:,\d{3})*(?:\.\d+)?/g) || [];
}

export function auditFacts(site, markdown) {
  const original = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    const found = line.match(/^- `([^`]+)`：(.+)$/);
    if (found) original.set(found[1], found[2]);
  }
  if (!original.size) return ["档案没有可回查的事实原文"];
  const pool = new Set([...original.values()].flatMap(numbers));
  const errors = [];
  for (const [key, value] of claimsOf(site)) {
    const actual = numbers(value);
    for (const number of actual) if (!pool.has(number)) errors.push(`${key} 的数字 ${number} 没有档案来源`);
    // 参数、统计值、日期和联系方式原样保持；改写正文可以引用档案中其他已知事实。
    if (/\.(?:value|price|date|phone|time)$/.test(key) && original.has(key)) {
      const expected = numbers(original.get(key));
      if (expected.join("|") !== actual.join("|")) errors.push(`${key} 数字口径改变：${original.get(key)} → ${value}`);
    }
  }
  return [...new Set(errors)];
}
