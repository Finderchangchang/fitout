# 框架怎么锁

便宜模型只填 `site.json`。`scripts/build.mjs` 把户型、风格 token 和板块模板拼成静态站。`scripts/check.mjs` 按下面的规则打回。模型改不了颜色和版式范围。

## Token 契约

`framework/tokens.schema.json` 规定风格必须给出的键。数值只放在 `styles/<id>/tokens.json`。`framework/` 里的 CSS 只能写 `var(--…)`。

| 键 | 约束 |
|---|---|
| `color` | `bg` `surface` `text` `text-muted` `border` `primary` `primary-contrast` `accent`，都是 `#RRGGBB` |
| `font.font-heading` / `font-body` | 系统字体栈。西文在前，中文在后。不引字体 CDN |
| `type.base` | 16 到 18 |
| `type.ratio` | `1.2`、`1.25` 或 `1.333` |
| `radius` | `radius-sm` `radius-md` `radius-lg` |
| `shadow.shadow-card` | 可以是 `none` |
| `density` | `compact` / `standard` / `airy`，对应三档区块间距 |
| `container` | 1152 到 1280 |
| `motion` | `0` 或 `1`。1 时过渡 200ms，首屏入场 280ms |

拼装时把它们写成 `:root` 变量，并按 ratio 算出 `--fs-1` 到 `--fs-6`。`--fs-5` 不超过 48px，`--fs-6` 不超过 60px，且至少是正文字号的 2.5 倍（仍不超过 60）。`html` 字号保持 100%，辅助字用 `0.875rem`（14px）。

衬线栈 `"Noto Serif SC", "Songti SC", "SimSun", serif` 只留给以后的专业服务。`_neutral` 标题和正文同一套无衬线系统字体，文件里写了「不是正式装修风格」。

疏密（来自 localbiz `lib/theme/styles.ts`）：

- compact：`clamp(2.5rem, 2rem + 2vw, 3.5rem)`，间隙 1rem
- standard：`clamp(3rem, 2.4rem + 3vw, 5rem)`，间隙 1.5rem
- airy：`clamp(3.5rem, 2.6rem + 4vw, 6.5rem)`，间隙 2rem

## 板块与版式

每个板块在 `framework/sections/<type>/`：`spec.json` 是字段表和版式，`<variant>.html` 是片段，`<variant>.css` 只写这个版式的布局。模板语法见 `scripts/lib/tpl.mjs`：`{{字段}}` 会转义，`{{#if}}` `{{#each}}`，未定义就报错。`{{icon:名:尺寸}}` 的尺寸只允许 16、20、24。

外壳（顶栏、页脚、悬浮）不进 `main`，不计入版式家族。`main` 里第一个板块是唯一的 `h1`。

| type | 版式 | 家族 | 结构来源 |
|---|---|---|---|
| header | standard / centered | bar | localbiz `HeaderStandard.tsx`、`HeaderCentered.tsx`（收成一行）；菜单参考 `MobileNav.tsx` 与 hyperui `marketing/headers/1.html` |
| hero | split-image / text / centered（未启用） | split / editorial / centered | localbiz `HeroSplitImage.tsx`、`HeroCentered.tsx`。不搬渐变占位。centered 不进门店和工厂户型，现在没有户型能选到 |
| trust | stats / certs | metrics / credentials | hyperui `marketing/stats/1.html` 的 dl。certs 没有现成区块，自写 |
| services | grid-cards / list-rows | grid / menu | localbiz `ServicesGridCards.tsx`、`ServicesListRows.tsx`。不搬 01 编号 |
| why | points / steps | points / sequence | hyperui `marketing/feature-grids/1.html`。steps 用 `ol`，不搬 01 角标 |
| cases | gallery / list | gallery / stories | 自写。不使用参考仓库里的库存照片 |
| testimonials | grid-cards / spotlight | quotes / quote | localbiz `TestimonialsGridCards.tsx`、`TestimonialsSpotlight.tsx`。不打星，不横向滚动 |
| team | cards / roster | portraits / people | hyperui `marketing/team-sections/1.html` 的姓名和岗位。不搬头像和品牌图标 |
| faq | accordion / two-column | accordion / columns | localbiz `FaqAccordion.tsx`、`FaqTwoColumn.tsx`。原生 `details` |
| contact | card / banner | visit / banner | localbiz `HoursContactCard.tsx`、`HoursContactBanner.tsx` |
| cta-band | simple / inline | band / split-cta | localbiz `CtaBandSimple.tsx`。不搬渐变版 |
| footer | simple / columns | plain / columns | localbiz `FooterSimple.tsx`、`FooterColumns.tsx`。备案行参考 PageTemplatify `themes/enterprise/template.html` |
| float-contact | dock | dock | 调研没有现成区块，按任务书自写 |
| product-list | grid / rows | catalog / menu | hyperui `marketing/product-cards/1.html` 的名称链接。没图不出图 |
| product-detail | article | article | 自写规格表。没图不出图，不换版式 |

带图版式在 spec 里声明 `fallback`：`split-image` → `text`，`gallery` → `list`，`cards` → `roster`。缺图就换版式。

图标在 `framework/icons/`。18 个，全部是 Heroicons outline 的路径，线宽 2，见 `NOTICE`。没有星、没有微信品牌标、没有剪贴板图标。微信用文字「加微信」，复制用文字按钮。

## 户型

`industries/<id>/house.json`：

- `mode`：`single` 或 `multi`
- `buttons`：主按钮、次按钮、「在线留言」
- `shell`：顶栏、页脚、悬浮各允许哪些版式
- `pages`：顺序、是否必填、允许的版式。`from: "products"` 的页按产品生成

行业清单和规则例外在 `industries/registry.json`。`store-service` 是单页。`factory-trade` 是首页、产品目录、每个产品一页、关于、联系。新行业照一份已有 `house.json` 另存，再在注册表登记。

## 拼装和机检

```
node scripts/build.mjs <site.json> [--out <dir>]
node scripts/check.mjs <站点目录> [--site <site.json>]
node scripts/check.mjs --lint-framework
```

默认输出 `out/<site-id>/`。内容违规不让拼装失败，让机检失败，这样坏样例能生成再被抓住。结构拼不起来（缺必填页、版式不在户型里、必填字段空）拼装会停。

产品 slug 不能是 `index`，也不能重复。同一个输出文件写第二次会停。`site.json` 和 `tokens.json` 开头的 UTF-8 BOM 会去掉。JSON 写错会说哪个文件、第几行，不打堆栈。户型 id 不存在时说可选的有哪些，不打堆栈。

内链以 `/` 开头时按站点根路径改成相对路径，不看当前工作目录。`products/`、`about` 这种没有扩展名的会补上 `index.html`。带 `scheme:` 或 `//` 的链接原样保留，查询串也保留。电话只取第一个号码，`转`、分机和斜杠后面的不拼进 `tel:`。

图片只复制 jpg、jpeg、png、webp、svg、gif，而且必须是非空文件。路径按段判断，`a..b.png` 可以，`../` 不行。文件名里的 `#`、空格会做 URL 编码。缺图仍降级，并写进 `build-report.json`。上线的 `site.json` 只留档案字段，丢掉 `_` 开头的内部备注。

输出包含用到的版式 CSS、一份 `assets/site.js`（菜单、复制微信号、微信浮层的 Esc 和外点关闭）、公开字段的 `site.json`，以及 `build-report.json`。单页 `lang="zh-CN"`，viewport 不禁缩放，有 title、description、Open Graph。首页有 JSON-LD。

`shot.mjs` 是可选截图。找不到 Playwright 就打印「跳过」并退出 0。图片写到本仓库 `out/shots/`。

机检规则的 block / warn 在 `scripts/lib/rules.mjs`。要放宽一条，只改那个文件里的 level。

## 规则落在哪

「机检」指 `scripts/check.mjs`。「样式」指 `framework/base.css` 或 token。「没落」是这次没有做成自动判定，原因写在后面。

| 规则 | 落点 |
|---|---|
| A1 | 机检。中性色饱和度都低于 0.15 算 1 组，主色和差开的强调色另计，合计 3 到 5。算法记在报告的待定口径 |
| A2 | 没落。60-30-10 要量面积，静态 HTML 量不准 |
| A3 | 机检。高饱和底色，或高饱和的主色/强调色同时又是禁用紫或万能色，失败。高饱和整宽色块（`data-band="sat"`）最多 3 个。注册表 `satFull` 为真的不卡这条（现在是教培，以及少儿、职教） |
| A4 | 没落。正式风格还没做，`_neutral` 不是品牌色 |
| A5 | 没落。同样没有 OKLCH 11 阶生成 |
| A6 | 机检。token 九对都要 ≥4.5。压在图片上的字由 `check-visual.mjs` 采样文字背后的亮度：正文 ≥4.5，大字 ≥3。首屏轮播每一张都切到终态再采样，失败行写第几张 |
| A7 | 机检。纯黑压暗渐变不计数。装饰性渐变最多 2 处。仍禁渐变文字和紫蓝青铺满。不再要求渐变角度 |
| A8 | 机检。`#000000`、阴影里的纯黑、正文或次级字的纯灰。近白的按钮字允许 |
| A9 | 只查样板间首页。`data-tone` 深浅切换至少 3 次。不再要求整页只有一个明暗 |
| A10 | 机检。禁用 `#8B5CF6` `#06B6D4` `#667eea` `#764ba2`。紫色色相不能当主色，也不能当大面积底。注册表 `purpleAccent` 为真的，强调色可以用紫（现在是教培，以及少儿、职教） |
| A11 | 机检。米色底加陶土按注册表 `beigeTerracotta`：`ok` 不报，`warn` 只警告，`block` 失败。细分盖过行业。原先：美业、餐饮不报；工厂和专业服务只警告；门店和教培仍失败 |
| B1 | 机检。扫整份 CSS 的 `font-family`，变量展开后，去掉 serif / sans-serif 这类通用族，超过 2 个就失败。只看两个 token 变量的旧算法恒真，已经换掉 |
| B2 | token 契约锁 ratio。字阶由拼装算，`--fs-6` 有 60px 和 2.5 倍两条帽。任务要求 6 档，报告里的「不超过 5 档」按任务放宽 |
| B3 | token 的 base 16–18。机检扫 CSS，小于 14px 失败。辅助字是 14px |
| B4 | 样式。正文行高 1.75，标题 1.3。机检不量行高 |
| B5 | 样式。`.prose` 和 `.section-lead` 是 `max-width: 36em` |
| B6 | 样板间写了 `type.hero` 时，桌面首屏 60 到 110px。`type.display` 为 `script` 时可到 173px，标题不超过 4 个词。没写 `type.hero` 的旧例子仍走字阶，不卡 60px 下限 |
| B7 | token 示例和机检。正文字体栈按逗号取第一段，去掉引号。这一段不能是中文（含微软雅黑、华文、Hiragino、黑体、思源） |
| B8 | 没加载任何字体文件，所以没有子集。机检不查字体文件 |
| B9 | 样式。标题 `text-wrap: balance`，正文 `pretty`，数字 `tabular-nums` |
| B10 | 机检只看衬线。注册表 `serifTitles` 为真才放行，细分盖过行业。美业、餐饮、律所、咨询可以；工厂和教培不行。不再按字体名字黑名单拦截 |
| C1 | 样式用 0.25rem 的倍数。机检不逐条量间距 |
| C2 | 拼装按 density 注入。样板间可写 `sectionY`，固定长度 80 到 160px。窄屏样式把板块上下收在 48 到 72px |
| C3 | token 容器宽 1152 到 1340。样式断点 375 / 768 / 1024 / 1440。机检 viewport 不禁缩放 |
| C4 | 样式。按钮、导航、摘要最少 44px，间隙 0.5rem 起 |
| C5 | 样式。顶栏最低 4rem。`check-visual.mjs` 量高度，普通顶栏不超过 110px，叠在图上可到 160px |
| C6 | 没做整屏 `100vh` / `100dvh`。首屏入场只有 hero 一处。机检不量「不用滚动就能看见按钮」 |
| C7 | 模板。hero 只有标签、标题、说明、主按钮和至多一个次按钮 |
| C8 | 机检。`main` 里 ≥6 个 `section` 时：缺 `data-family`、家族少于 4 种、或同一个家族出现两次，都失败。旧阈值在「一板块一家族」时到不了，现在重复家族本身就会失败 |
| C9 | 机检。首屏带 `btn` 的按钮最多 2 个，且只能有一个主按钮。轮播箭头和指示点不算 |
| C10 | 只有 sm/md/lg 三档，值在 token。`_neutral` 是 2 / 4 / 8 px，用来测框架，不是 12–16 的正式风格。框架 CSS 不许写死圆角 |
| C11 | 卡片是边框加 `var(--shadow-card)`。`_neutral` 的阴影是 `none`，所以现在只有边框。正式风格若改成有阴影，应同时去掉边框，否则两样都在 |
| C12 | 模板。列表、步骤、资质用分隔线，不套娃卡片。机检不判 |
| C13 | 不再禁止左大标题、右段落。现有模板仍是上下叠 |
| C14 | 机检。首屏标题含汉字时按字数 ≤14，纯英文按词数 ≤10 |
| D1 | token。motion 1 时微交互 200ms，整页入场 700ms，缓动 `cubic-bezier(0.4, 0, 0.2, 1)` |
| D2 | 样式和机检。过渡只写 transform 和 opacity，有 `prefers-reduced-motion`。`transition: all` 失败 |
| D3 | 机检。`animation` 里的动画名最多 2 种。循环（`infinite`）最多 1 条。框架只有一个 `enter`：淡入、位移 30px、只播一次 |
| D4 | 没落。用途写在这里：hero 入场表示首屏，按钮 hover 表示可点。机检不读这句话 |
| D5 | 机检。`site.js` 不得监听 scroll |
| D6 | 机检。有 `data-carousel` 时：3 到 9 张，间隔 3000 到 5000ms，箭头和指示点都要在。脚本里要有悬停暂停和 `prefers-reduced-motion` |
| E1 | 拼装不编内容。必填块缺失会停，可选块不写就不出。机检不认得「这个数字是编的」 |
| E2 | 图标只有 16/20/24、同一线宽。机检扫可见文字，以及 alt、title、aria-label、description、og:description。只认 emoji 展示形式。`©` `®` `™` `✔` `✓` `℃` `×` `±` 不算。`★` `☆` 算星标，失败 |
| E3 | 按任务书，不画占位框。缺图换不带图的版式。没有手画插画 |
| E4 | 样板间首页至少 12 张图，其中至少 2 张在 `data-fullbleed` 里。演示模式降为警告。没有样板间的例子不卡张数。空 alt 仍失败 |
| E5 | 机检可见文字，以及 alt、title、aria-label 和 description。词表：赋能、革命性、颠覆性、一站式、全方位、领先的（block）；打造、Elevate、Seamless、Unleash、Next-Gen（warn，英文按词边界）。单独的「智能」不扫 |
| E6 | 机检 `button` 和带 `btn` 的链接。先去掉空白和标点（含全角、间隔号）再比，繁体折成简体。禁止提交、了解更多、点击这里、点击查看、查看详情、立即提交、Submit、Learn more、Click here、Read more。没覆盖首屏按钮时，hero 主按钮要和户型主按钮同一句；写了 `hero.buttons`，或默认指向的页关掉了，就按档案里的按钮 |
| E7 | 没有站内表单。有 `formUrl` 才给一个外链按钮 |
| E8 | 没落。没有 logo 槽。缺图走版式降级，不用色块顶 |
| E9 | 模板有才显示。机检：档案里有备案号，页脚必须出现原文 |
| E10 | 户型把行业必备页和板块定下来。机检不对照 3.3 的行业表 |
| F1 | 没落。这是给人的流程，不是脚本 |
| F2 | 一次拼装只读一套 `tokens.json`。档案不能覆盖 token |
| F3 | 框架 CSS 只走变量。`--lint-framework` 扫写死的颜色、圆角、阴影、`transition: all`、`background-clip: text`。命名色要求前后不是字母或连字符，所以 `white-space` 不算；`transparent` 不在词表里。正则带 `g`，命中超过 10000 次算 lint 自身异常 |
| F4 | `check.mjs` 是这份清单里能自动跑的那一部分，不是 60 项人工清单的全文 |

标题和按钮额外禁止「——」「—」。正文允许。这是任务书定的，不是 A 报告原文。

店名不超过 16 字，页面 title 不超过 30，description 不超过 80，地址不超过 40。占位词另拦：待补、待补充、TODO、XX、示例、请填写、ipsum、Jane Doe、张三、李四、`test@`、`123-4567-8900`。`id` 全页不能重复。

## 样板间必须满足的约定

目录、集合和动效见 `docs/SHOWROOM.md`。下面三条已经落成框架样式，并由机检卡住。

### 图片比例和尺寸（P1-7）

- 同一组用 `data-media-group`。卡片和画廊是 3/2，人像是 4/5，首屏照片是 16/10，满宽图块是 2.4/1，再加 `object-fit: cover`。
- 每个 `<img>` 写 `width` 和 `height`。首屏之外加 `loading="lazy"` 和 `decoding="async"`。缺了，或同一组比例不一致，机检规则「图片位」失败。
- 满屏轮播自己铺满首屏。其他首屏图有 `max-height: 70vh`，避免竖图把按钮挤出 1440 宽的首屏。

### 悬浮条避让页脚（P1-8）

- 1024 及以上，页脚 `padding-bottom: 12rem`，给右下角悬浮条留空。更窄的宽度由 `body` 的 `padding-bottom: 4.5rem` 把正文垫起来。
- `check-visual.mjs` 先把页面收到确定状态再采样：上下文开减少动效（轮播不自动播，入场和数字直接到终值），并注入 `data-fitout-check="settle"`。悬浮条按宽度摆：1024 及以上首屏不显示，滚过一屏再出现；更窄的贴底。375 / 768 / 1024 / 1440 滚到页底，悬浮条和页脚文字的重叠面积超过 20 平方像素就失败。同一视口 `scrollWidth` 比 `clientWidth` 大过 1px 也失败。

### 点击区域（G-14）

- 顶栏品牌、导航、页脚链接、悬浮条和按钮的可点区域至少 44×44。手机菜单里原来就有 44px 的，没有改小。
- `check-visual.mjs` 量这些控件的盒子。小于 44px 失败。
