# 样板间

一套样板间是一个行业、一种气质的完整官网。客户选定之后，模型只填 `examples/site.json` 这种档案，`scripts/build.mjs` 负责拼页面。

这一轮的 `showrooms/_smoke` 和 `showrooms/_template` 都不是正式样板间。正式的八套另做。公开仓库里不要写参考模板的品牌、主题名或网址。对照记在仓库外的 `showroom-refs.json`。

## 目录

```
showrooms/<id>/
  showroom.json
  tokens.json
  images.json
  preview.jpg
  sections/<type>/<variant>.html
  sections/<type>/<variant>.css
  sections/<type>/<variant>.spec.json
  originality.md
  examples/site.json
```

`<id>` 用小写字母、数字和连字符。`scripts/new-showroom.mjs --id <id> --industry <industry> --flavor cn|intl [--niche <niche>]` 会从 `_template` 复制出这份骨架。

行业见 `industries/registry.json`。`flavor` 仍是 `cn` 或 `intl`。`industry` 和 `niche` 不再写死在脚本里。没登记的 industry 或 niche，建样板间、拼装、机检和样板间区分都会停，并打印中文错误。

每条行业有：

- `id`、`name`（中文名）
- `niches`：细分。每项有 `id` 和中文名。niche 可以不填；填了就必须是这一条行业下面的细分
- `ruleFlags`：机检例外
  - `serifTitles`：衬线标题放不放行
  - `satFull`：高饱和能不能铺满整屏
  - `beigeTerracotta`：米色加陶土。`ok` 不报，`warn` 只警告，`block` 失败
  - `purpleAccent`：紫色能不能当强调色
- `defaultPages`：建议页面清单。样板间可以按这套来排，也可以改

细分上的 `ruleFlags` 只写和行业不同的几项，盖过行业级。没写的项沿用行业。没写 niche 时只用行业级。原先四条行业的口径还在注册表里：衬线不放行；门店的米色加陶土仍拦截；工厂和专业服务的米色加陶土只警告；教培允许高饱和整屏和紫色强调。美业、餐饮不报米色加陶土，并且可以衬线；律所、咨询可以衬线；少儿、职教可以高饱和整屏。

## 新增一个行业

1. 在 `industries/registry.json` 的 `industries` 里加一条。`id` 用小写字母、数字和连字符，不能和已有行业或细分重复。
2. 新建 `industries/<id>/house.json`。照已有户型写 `label`、`buttons`、`shell`、`pages`。建议首页板块序列放在 `id` 为 `home` 的那一页的 `order` 里。首页只把首屏和一个产品或服务板块标 `"required": true`。联系板块标在放了 `contact` 的那一页。其余板块标 `false`，档案里没有事实就可以不写。版式名用框架里已有的，没有样板间时拼装读的就是这份。
3. 再跑 `node scripts/new-showroom.mjs --id <样板间 id> --industry <id> --flavor cn --niche <niche>` 起骨架。样板间的 `showroom.json` 会盖过户型，页面可以和 `defaultPages` 不一样。

已登记的行业、细分和规则例外以注册表为准，不在这里再抄一份。

## showroom.json

要能代替原来的户型。脚本读到 `site.json` 的 `"showroom"` 之后，用这一份，不再读 `industries/*/house.json`。

必填：

- `id`、`name`（中文名）、`industry`、`flavor`
- `niche`：需要行业例外时写
- `note`：这套是给谁的。冒烟和模板要写明不是正式样板间
- `buttons`：`primary`、`secondary`、`form`，以及 `primaryHref`、`secondaryHref`。没写 `hero.buttons` 时，首屏用这两句和这两个链接。链接指向的页被关掉时，拼装改成联系页上的按钮
- `shell`：`header`、`footer`、`floatContact`，每项是允许的版式名数组。现成的有顶栏 `standard` / `centered`，页脚 `simple` / `columns`，悬浮 `dock`
- `pages`：见下
- `collections`：见下
- `motion`：给人看的动效约定，要和 `tokens.json` 的 `motion` 一致。`enter` 只用 `fade`。时长 700ms，位移不超过 30px，只播一次

`pages` 的每一项：

- `id`、`file`、`kind`、`optional`、`order`
- `optional`：`false` 是必有页（首页、关于、联系、主集合及其详情）。`true` 是可选页（加盟、门店分布、团队、新闻，以及别的次要页）
- 可选页要写 `when`：什么情况下该有，给填档案的模型看。可以再写 `deny`，档案里出现这些说法时，这一页必须关掉
- 详情页加 `from`，`file` 里写 `{slug}`，例如 `services/{slug}.html`
- `kind` 用这些名字：`home`、`about`、`list`、`detail`、`team`、`news-list`、`news-detail`、`contact`
- `order` 是板块数组。每项有 `type`、`variants`、`required`
- 顺序要和档案里的板块顺序一致。同一种板块一页只出现一次
- 不要把 `page-banner` 写进 order。除首页外，脚本会自动插到最上面

一套里要把这些页面种类盖到，能合的再合，不要另起炉灶：

1. 首页 `index.html`
2. 关于
3. 列表（服务、产品、课程，用 `collection-list`）
4. 详情（由集合生成，用 `collection-detail`）
5. 案例或团队
6. 新闻列表
7. 新闻详情
8. 联系

`collections` 的每一项：`id`、`label`、`listFile`。`listFile` 是列表页路径，详情页上的「返回列表」指到这里。

档案里的集合写在 `site.json` 的 `collections.<id>`，是一个数组。旧的 `products` 仍然可用，等价于集合 `products`。

每一条至少要有 `slug`、`name`、`summary`。`slug` 只能是小写字母、数字和连字符，不能叫 `index`，同一个集合里不能重复。脚本为每一条生成 `from` 那一页，不要在 `pages` 里再写一遍。

## tokens.json

形状按 `framework/tokens.schema.json`。可以加新键，但要先写进这份 schema，否则拼装不认。

和样板间有关的可选键：

- `color.on-media`：压在图片上的字色。不写就用 `primary-contrast`
- `type.hero`：桌面首屏标题像素，60 到 110。手写展示字把 `type.display` 设为 `script`，可以到 173，标题同时不能超过 4 个词
- `type.display`：`sans`、`serif` 或 `script`
- `sectionY`：盖过 density 的桌面上下留白，例如 `140px`。固定长度要在 80px 到 160px

颜色仍是 `#RRGGBB`。对比度按机检的九对，都要 ≥4.5。衬线标题栈的第一个字体要真是衬线，并且注册表里这个行业或细分的 `serifTitles` 为真。工厂和教培没有放开。

`motion` 为 1 时，微交互 200ms，整页入场 700ms。脚本会给每个板块加上 `data-enter="fade"`。板块自己的 `tone` 写成 `light`、`dark` 或 `image`，首页要深浅切换至少 3 次。

## images.json

```json
{
  "grade": "整套图片的统一调色，一句话。不要把标题烤进图片。",
  "slots": [
    {
      "id": "hero-1",
      "page": "home",
      "block": "hero",
      "ratio": "16:10",
      "px": "1440x900",
      "desc": "给以后找图或生图用的画面，不写品牌名",
      "tier": "must"
    }
  ]
}
```

`tier` 二选一。`must`：课上必须有图，每套最多 8 张，缺了机检只警告、不挡拼装。`nice`：没有就走无图，不挡拼装。旧档案不写 `tier` 时，行为跟以前一样。

比例用这些：首屏和满宽主图 `16:10`（约 1440×900），横条 `2.4:1`（约 1440×600），内容图 `3:2`，竖图 `4:5` 或 `2:3`，头像和产品 `1:1`。整套准备 25 到 40 张不重复的图，其中 8 到 12 张是必须好看的大图。首页至少 12 张，至少 2 张放在带 `data-fullbleed` 的板块里。课上只备齐 `must` 时张数可以少于 12，正式模式不因此失败。

档案里的图片字段写图片位 id，或写成 `slot:<id>`。

`node scripts/build.mjs <site.json> --demo-images <目录>` 会按 id 找同名的 jpg、jpeg、png、webp、svg、gif。找到就拷进站点。找不到时，`source` 为 `client` 的位画浅色用途占位，不挂角标，见 `docs/IMAGES.md`。其他位在带了这个参数时画一块带比例和 id 的深色块。只有这一页真的画出了这种块，角落才标「演示占位图」。不带这个参数时，图库图和 AI 图缺了走无图：能换版式就换，纯图片带整块不出，其余板块留文字。降级写进 `build-report.json` 的 `fallbacks`，不因此失败。`client` 位没有文件时同样画浅色占位，不报错。正式配图目录用 `--images`，不要和 `--demo-images` 一起用。

挑样板间用的预览图是 `showrooms/<id>/preview.jpg`（720×450，80KB 以内，首页首屏）。`showrooms/index.json` 的 `showrooms` 数组给助手读，不参与拼装。每项有 `id`、`name`（中文名）、`industry`（行业）、`niche`、`fit`（适合谁，取 `showroom.json` 的 `note` 第一句）、`preview`（相对 `showrooms/` 的路径）、`pages`（`examples/site.json` 导航上的文字）。

## 版式

`sections/<type>/<variant>.html`、`.css`、`spec.json` 三份一起放。有本地文件就整份替换框架里的同名版式，不会把两份 CSS 接在一起。只替换你写了的 type，不要为了改一个 hero 把别的 spec 也拷进来。

板块根节点是一个 `<section>`，带 `data-section`、`data-family`。一组图片的外层加 `data-media-group`，组里的比例必须一样。每个 `<img>` 写 `width`、`height`。非首屏再加 `loading="lazy"` `decoding="async"`。

模板语法见 `scripts/lib/tpl.mjs`。没定义的变量会让拼装失败。可选图片写在 `{{#if image}}` 里面，宽高用 `{{imageWidth}}` 和 `{{imageHeight}}`，脚本会填。

首页板块可以在档案里写 `tone`。深色底上的卡片会回到正文色，不要在深色板块里再放一枚深色链接。

内页 Banner 是框架板块 `page-banner`，高约 400 到 580px，图上有压暗、页名和面包屑。页名是这一页的 h1，下面的板块标题降成 h2。

## 动效

不要引第三方库，不要监听 `scroll`。`framework/shell/site.js` 已经做了这些事，样板间不要再写一套：

- 整页入场：淡入，位移 30px，约 0.7 秒，进入视口播一次。系统开了减少动效就不动，也不要把内容藏起来。
- 数字滚动：信任条的 `value` 里有数字时，进入视口从 0 计到这个数，最后恢复原来的单位。
- 首屏轮播：版式 `hero/carousel`。3 到 9 张，`interval` 写 3000 到 5000。有上一张、下一张和指示点，悬停暂停。减少动效时停在第一张。
- 桌面悬浮条：宽 1024 及以上，首屏里不显示，滚过一屏后淡入。手机仍贴底常驻。系统开了减少动效就直接出现，不做淡入。

首屏带 `btn` 的按钮最多两个，一个主按钮一个次按钮。轮播的箭头不要加 `btn` 类。

## examples/site.json

公司名里带「（虚构）」。`id` 是输出目录名，小写连字符。`showroom` 指向这套的 id。`industry`、`niche` 和 showroom.json 一致。

页面只写 showroom.json 里那些没有 `from` 的页。字段上限沿用各板块 `spec.json`。首屏标题中文不超过 14 字，英文不超过 10 个词。

## 原创性

像不像抄的，看配色组合、版面和招牌细节。工厂蓝、律所深色这类行业里常见的颜色可以继续用。

`originality.md` 用表格记下招牌处理，每一行都要有编号：

```markdown
| S1 | 已替换为：我们自己的句子 |
| S2 | 已删除（这套不用那条横幅，因为没有对应内容） |
```

「已删除」后面的括号里要写真实原因。空着、写「待填」或只写「原因」都不算数。

检查：

```text
node scripts/check-originality.mjs --showroom <id> --ref <主参考> [--ref <副参考> ...] [--main <文件>] [--signatures <仓库外的招牌清单.md>]
```

`--ref` 可以写多次，文件是 `tokens.ref.json` 或 `measure.json`。没写 `--main` 时，第一个 `--ref` 是主参考。写了 `--main`，就以那个文件为主参考；它没出现在 `--ref` 里时，也会加入参考列表。

参考色不要抄进这个仓库。量取文件可以先转成令牌：

```text
node scripts/extract-ref-tokens.mjs <measure.json> --out <仓库外的 tokens.ref.json>
```

- 主色、强调色和主参考里每个有彩色比，ΔE00 至少 15。副参考不参加这一条。
- 主色和强调色不能同时落在任一参考某两色的 25 以内。每一份参考都查。
- 背景和每一份参考的背景比，ΔE00 至少 8。两边都是近白或近黑时只警告。
- 招牌清单里每一条，`originality.md` 都要有「已替换为」或「已删除（原因）」。

同一 `flavor` 的样板间之间还要避开撞色。每加一套都跑：

```text
node scripts/check-distinct.mjs
```

脚本读 `showrooms/*/tokens.json`，目录名以 `_` 开头的跳过，按 `showroom.json` 的 `flavor` 分组。同一组里主色两两 ΔE00 至少 20，强调色两两至少 15，两套的主色和强调色不能同时都小于 20。它打印两两距离表，有冲突时退出码 1。

## 拼装和检查

```text
node scripts/build.mjs showrooms/<id>/examples/site.json --demo-images <图片目录>
node scripts/check.mjs out/<site id>
node scripts/check-visual.mjs out/<site id>
```

`--demo-images` 指到一个空目录也可以，用来出占位图。演示模式下，缺图和首页张数不足降为警告，而且只在这一页真的画出了演示占位时才降。正式拼装不要带这个参数。`source` 为 `client` 的位见 `docs/IMAGES.md`。

视觉检查需要本机已有的 Playwright。没有时它打印「跳过」并退出 0。它会先把页面收到确定状态：Playwright 开减少动效，并给 `<html>` 加上 `data-fitout-check="settle"`。轮播不自动翻，入场和数字直接到终值。悬浮条按桌面 / 手机规则摆（1024 及以上首屏不显示，滚过一屏再出现；更窄的贴底）。首屏轮播每一张都点开查图上文字，不过的那张会写第几张。
