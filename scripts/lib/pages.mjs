/**
 * 可选页开关、关掉之后的链接、首屏按钮回退。
 * 必有页：首页、关于、联系、主集合。可选页在 showroom.json 里 optional: true。
 * site.json 不写 enabled 就是开着；可选页 enabled: false，或整页不写，就是关掉。
 */

export function normPath(href) {
  let raw = String(href || "").trim();
  if (!raw) return "";
  raw = raw.split("#")[0].split("?")[0].trim();
  if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) return "";
  raw = raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (raw.endsWith("/")) raw += "index.html";
  else if (!raw.endsWith(".html") && !raw.includes(".")) raw = `${raw.replace(/\/$/, "")}/index.html`;
  return raw;
}

export function pageRecord(site, id) {
  return (site?.pages || []).find((page) => page?.id === id) || null;
}

export function parentOfCollection(house, id) {
  if (!id) return null;
  const pages = house?.pages || [];
  const byId = pages.find((page) => !page.from && page.id === id);
  if (byId) return byId;
  const listFile = (house?.collections || []).find((item) => item.id === id)?.listFile;
  if (!listFile) return null;
  return pages.find((page) => !page.from && page.file === listFile) || null;
}

export function isOn(house, site, page) {
  if (!page) return false;
  if (page.from) {
    const parent = parentOfCollection(house, page.from);
    return parent ? isOn(house, site, parent) : true;
  }
  if (page.optional !== true) return true;
  const record = pageRecord(site, page.id);
  if (!record || record.enabled === false) return false;
  return true;
}

export function requiredTurnedOff(house, site) {
  const bad = [];
  for (const page of house?.pages || []) {
    if (page.from || page.optional === true) continue;
    const record = pageRecord(site, page.id);
    if (record?.enabled === false) bad.push(page.id);
  }
  return bad;
}

export function closedTargets(house, site) {
  const files = new Set();
  const prefixes = new Set();
  for (const page of house?.pages || []) {
    if (isOn(house, site, page)) continue;
    if (page.from) {
      const prefix = String(page.file || "").replace("{slug}.html", "");
      if (prefix) prefixes.add(prefix);
      continue;
    }
    const file = normPath(page.file);
    if (file) files.add(file);
    const dir = String(page.file || "").replace(/index\.html$/, "");
    if (dir && dir !== page.file) prefixes.add(dir);
  }
  return { files, prefixes };
}

export function pointsClosed(href, closed) {
  const file = normPath(href);
  if (!file || !closed) return false;
  if (closed.files.has(file)) return true;
  for (const prefix of closed.prefixes) {
    if (file.startsWith(prefix)) return true;
  }
  return false;
}

export function contactFile(house) {
  const page = (house?.pages || []).find((item) => item.id === "contact" && item.file);
  if (page?.file) return page.file;
  const pages = house?.pages || [];
  if (pages.some((item) => item.id === "home" || item.file === "index.html") && !pages.some((item) => item.id === "contact")) {
    return "#contact";
  }
  return "contact/index.html";
}

export function expandTel(href, phone) {
  const raw = String(href || "").trim();
  if (raw !== "tel:" && raw !== "tel") return raw;
  const head = String(phone || "").split(/\s*(?:转|分机|ext\.?|\/|,|，|;|；)\s*/i)[0];
  const digits = head.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : "";
}

function fallbackButton(contact, used) {
  if (!used.has("电话咨询")) return { label: "电话咨询", href: contact };
  if (!used.has("联系我们")) return { label: "联系我们", href: contact };
  return null;
}

export function resolveHeroButtons({ site, house, data, phone }) {
  const closed = closedTargets(house, site);
  const contact = contactFile(house);
  let buttons = [];
  const written = Array.isArray(site?.hero?.buttons) ? site.hero.buttons : null;
  if (written && written.length) {
    buttons = written.slice(0, 2).map((button) => ({
      label: String(button?.label || "").trim(),
      href: expandTel(button?.href, phone),
    })).filter((button) => button.label && button.href);
  }
  if (!buttons.length) {
    const primaryLabel = String(data?.primaryLabel || house?.buttons?.primary || "").trim();
    const primaryHref = expandTel(data?.primaryHref || house?.buttons?.primaryHref || "", phone);
    if (primaryLabel && primaryHref) buttons.push({ label: primaryLabel, href: primaryHref });
    const secondaryLabel = String(data?.secondaryLabel || "").trim();
    const secondaryHref = expandTel(data?.secondaryHref || "", phone);
    if (secondaryLabel && secondaryHref) {
      buttons.push({ label: secondaryLabel, href: secondaryHref });
    } else if (!data?.primaryLabel && house?.buttons?.secondary && house?.buttons?.secondaryHref) {
      buttons.push({
        label: String(house.buttons.secondary).trim(),
        href: expandTel(house.buttons.secondaryHref, phone),
      });
    }
  }
  const used = new Set();
  const out = [];
  for (const button of buttons) {
    if (!pointsClosed(button.href, closed)) {
      out.push(button);
      used.add(button.label);
      continue;
    }
    const next = fallbackButton(contact, used);
    if (next) {
      out.push(next);
      used.add(next.label);
    }
  }
  if (!out.length) out.push({ label: "电话咨询", href: contact });
  return out.slice(0, 2);
}

function linkKeysClosed(item, closed) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  return ["href", "primaryHref", "secondaryHref", "moreHref"].some((key) => pointsClosed(item[key], closed));
}

function scrubTree(node, closed) {
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i -= 1) {
      const item = node[i];
      if (linkKeysClosed(item, closed)) node.splice(i, 1);
      else scrubTree(item, closed);
    }
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string" && ["href", "primaryHref", "secondaryHref", "moreHref"].includes(key)) {
      if (pointsClosed(value, closed)) node[key] = "";
    } else if (value && typeof value === "object") scrubTree(value, closed);
  }
}

export function scrubSection(section, { house, site, required }) {
  if (!section || section.type === "hero" || section.type === "page-banner") return section;
  const closed = closedTargets(house, site);
  if (closed.files.size === 0 && closed.prefixes.size === 0) return section;
  const data = structuredClone(section.data || {});
  section = { ...section, data };
  if (section.type === "collection-list" || section.type === "product-list") {
    const id = section.type === "product-list" ? "products" : String(data.collection || "");
    const parent = parentOfCollection(house, id);
    if (parent && !isOn(house, site, parent)) return required ? section : null;
  }
  let drop = false;
  if (pointsClosed(data.primaryHref, closed)) {
    if (required) {
      data.primaryHref = contactFile(house);
      data.primaryLabel = "电话咨询";
    } else drop = true;
  }
  if (pointsClosed(data.secondaryHref, closed)) {
    data.secondaryHref = "";
    data.secondaryLabel = "";
  }
  scrubTree(data, closed);
  if (Array.isArray(data.items) && data.items.length === 0 && !required) drop = true;
  return drop ? null : section;
}
