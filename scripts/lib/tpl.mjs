/**
 * 极简模板。支持：
 * - {{path}}            HTML 转义后输出。未定义或 null 直接报错，不输出空串。
 * - {{#if path}}…{{/if}}  可带 {{else}}。空串、0、false、空数组为假。路径未定义则报错。
 * - {{#each path}}…{{/each}}  列表项为对象时，字段盖住外层同名；没有的字段向外层找。
 * - {{@index}}          each 内从 1 开始。
 * - {{@raw path}}       不转义。只给拼装脚本塞已经生成的 HTML / JSON-LD。
 * - {{icon:名称}}        内联图标，默认 20。{{icon:名称:16}} 尺寸只允许 16 / 20 / 24。
 *
 * 模型填的内容走转义。图标表由 render 的第三个参数传入，不从数据里读。
 */

export function render(template, data, options = {}) {
  const icons = options.icons || new Map();
  const stack = [data];
  if (options.globals) stack.push(options.globals);
  return renderInto(template, stack, icons);
}

function nextTag(template, from) {
  const open = template.indexOf("{{", from);
  if (open === -1) return null;
  const close = template.indexOf("}}", open + 2);
  if (close === -1) throw new Error("模板错误：{{ 没有闭合");
  return { open, end: close + 2, tag: template.slice(open + 2, close).trim() };
}

function renderInto(template, stack, icons) {
  let out = "";
  let cursor = 0;
  while (cursor < template.length) {
    const found = nextTag(template, cursor);
    if (!found) {
      out += template.slice(cursor);
      break;
    }
    out += template.slice(cursor, found.open);
    const tag = found.tag;
    if (tag.startsWith("#each ")) {
      const name = tag.slice(6).trim();
      const end = findClose(template, found.end, "each");
      const inner = template.slice(found.end, end.start);
      const list = resolve(name, stack);
      if (!Array.isArray(list)) throw new Error(`模板错误：${name} 不是列表`);
      list.forEach((item, index) => {
        const scope = item && typeof item === "object" ? { ...item, __index: index } : { ".": item, __index: index };
        out += renderInto(inner, [scope, ...stack], icons);
      });
      cursor = end.end;
    } else if (tag.startsWith("#if ")) {
      const name = tag.slice(4).trim();
      const end = findClose(template, found.end, "if");
      const inner = template.slice(found.end, end.start);
      const parts = splitElse(inner);
      out += renderInto(truthy(name, stack) ? parts.yes : parts.no, stack, icons);
      cursor = end.end;
    } else if (tag === "else" || tag.startsWith("/")) {
      throw new Error(`模板错误：标签位置不对 {{${tag}}}`);
    } else if (tag.startsWith("@raw ")) {
      out += String(resolve(tag.slice(5).trim(), stack));
      cursor = found.end;
    } else if (tag === "@index") {
      const idx = stack[0] && stack[0].__index;
      if (typeof idx !== "number") throw new Error("未定义变量：@index");
      out += String(idx + 1);
      cursor = found.end;
    } else if (tag.startsWith("icon:")) {
      out += inlineIcon(tag.slice(5).trim(), icons);
      cursor = found.end;
    } else if (tag.startsWith("#")) {
      throw new Error(`模板错误：不认识的块 {{${tag}}}`);
    } else {
      out += escapeHtml(stringify(resolve(tag, stack), tag));
      cursor = found.end;
    }
  }
  return out;
}

function findClose(template, from, kind) {
  let depth = 1;
  let i = from;
  while (i < template.length) {
    const open = template.indexOf("{{", i);
    if (open === -1) break;
    const close = template.indexOf("}}", open);
    if (close === -1) throw new Error(`模板错误：{{ 没有闭合`);
    const tag = template.slice(open + 2, close).trim();
    if (tag.startsWith(`#${kind} `) || tag === `#${kind}`) depth += 1;
    else if (tag === `/${kind}`) {
      depth -= 1;
      if (depth === 0) return { start: open, end: close + 2 };
    }
    i = close + 2;
  }
  throw new Error(`模板错误：{{#${kind}}} 没有闭合`);
}

function splitElse(inner) {
  let depth = 0;
  let i = 0;
  while (i < inner.length) {
    const open = inner.indexOf("{{", i);
    if (open === -1) break;
    const close = inner.indexOf("}}", open);
    if (close === -1) break;
    const tag = inner.slice(open + 2, close).trim();
    if (tag.startsWith("#")) depth += 1;
    else if (tag.startsWith("/")) depth -= 1;
    else if (tag === "else" && depth === 0) {
      return { yes: inner.slice(0, open), no: inner.slice(close + 2) };
    }
    i = close + 2;
  }
  return { yes: inner, no: "" };
}

function resolve(path, stack) {
  if (path === "." || path === "this") {
    const top = stack[0];
    if (top && Object.prototype.hasOwnProperty.call(top, ".")) return defined(top["."], path);
    return defined(top, path);
  }
  const parts = path.split(".");
  for (const scope of stack) {
    if (!scope || typeof scope !== "object") continue;
    if (!Object.prototype.hasOwnProperty.call(scope, parts[0])) continue;
    let cur = scope;
    for (let i = 0; i < parts.length; i += 1) {
      const key = parts[i];
      if (cur === undefined || cur === null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, key)) {
        throw new Error(`未定义变量：${path}`);
      }
      cur = cur[key];
    }
    return defined(cur, path);
  }
  throw new Error(`未定义变量：${path}`);
}

function defined(value, path) {
  if (value === undefined || value === null) throw new Error(`未定义变量：${path}`);
  return value;
}

function truthy(path, stack) {
  const value = resolve(path, stack);
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return value !== 0;
  if (typeof value === "boolean") return value;
  return true;
}

function stringify(value, path) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new Error(`模板错误：${path} 不是可输出的文本`);
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineIcon(spec, icons) {
  const bits = spec.split(":").filter(Boolean);
  const name = bits[0];
  const size = bits[1] || "20";
  if (!name) throw new Error("模板错误：图标名是空的");
  if (size !== "16" && size !== "20" && size !== "24") {
    throw new Error(`图标尺寸只能是 16、20、24：${name}/${size}`);
  }
  const svg = icons.get(name);
  if (!svg) throw new Error(`没有图标：${name}`);
  return svg.replace(
    "<svg",
    `<svg class="icon icon-${size}" focusable="false" aria-hidden="true"`,
  );
}
