# site.json 怎么填

给填内容的模型看。只填事实，不选颜色，不写 CSS。配色、字体、圆角、阴影在风格的 `tokens.json` 里，这份档案碰不到。

字数按去掉所有空白后的 Unicode 码点计。`128 元起` 算 5 个字。超了，机检直接失败。英文站（`lang` 为 `en`）用同一把尺子，上限是中文上限 × 2.2，向上取整。首屏标题另计：含汉字时 ≤14 字，纯英文 ≤10 个词。

## 先看户型

`industry` 和 `niche` 以 `industries/registry.json` 为准。没有 `showroom` 时，还要有 `industries/<id>/house.json`，拼装按那份户型。`niche` 可以不填；填了就必须是该行业下已登记的细分。

门店 `store-service` 仍是单页，导航用 `#锚点`。工厂 `factory-trade` 是多页，产品详情不要自己写进 `pages`，写在 `products` 里，脚本按 slug 生成。别的行业看各自的 `house.json` 和注册表里的 `defaultPages`。

户型规定了：有哪些页、板块顺序、每块允许哪几种版式、哪些块必填、顶栏和悬浮条的按钮文案。档案里的板块必须是这个顺序的子序列，不能多、不能换序、不能重复。必填块缺了，拼装会停。可选块没有真内容就整块不要，不要编。

## 顶层

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 站点目录名。小写字母、数字、连字符 |
| `lang` | 否 | 不写就是 `zh-CN`。英文站写 `en`。见「语言」 |
| `buttons` | 否 | 盖掉户型按钮。键是 `primary`、`secondary`、`form`。不写就用户型原文 |
| `style` | 是 | 风格 id，例如 `_neutral`。对应 `styles/<id>/tokens.json`。也可以写相对这份档案的路径，例如 `./bad-style` |
| `industry` | 是 | 户型 id |
| `businessType` | 是 | 门店写 `LocalBusiness`，工厂写 `Organization`。首页 JSON-LD 用它 |
| `name` | 是 | 店名或厂名。虚构例子在名字后加「（虚构）」。不要用真实公司名 |
| `summary` | 否 | 一句话，页脚和 JSON-LD 用。没有就不填 |
| `url` | 否 | 站点根地址。有才输出 canonical |
| `contact` | 是 | 见下 |
| `nav` | 是 | 导航。见「导航」。数组写法照旧 |
| `shell` | 是 | `header`、`footer`、`floatContact`，值必须在户型允许的版式里 |
| `pages` | 是 | 见下。不要写 `from: products` 的那一页 |
| `products` | 工厂必填 | 见下。门店不要写 |

## 语言

不写 `lang` 就是中文站。只接受 `zh-CN` 和 `en`。

`en` 时：

- `<html lang="en">`，Open Graph `en_US`，JSON-LD `inLanguage` 为 `en`。中文站仍是 `zh-CN`、`zh_CN`、`zh-CN`。
- 字段名正好是 `date` 的，能认出就显示成 `Sep 2025`。认 `2025-09`、`2025-09-12`、`2025/09/12`、`2025.09`、`2025年9月`、`2025年9月12日`、`September 2025`。日不写进去。认不出就原样留下。中文站不改这个字段。
- 字数上限见本页开头。店名 16、页面 title 30、description 80、地址 40，以及各板块 `maxChars`，英文都乘 2.2 后向上取整。
- 空话改查英文词表，命中即失败：Seamless、Elevate、Unleash、Cutting-edge、World-class、Next-gen、Revolutionary、One-stop。按词边界，大小写不敏感。中文站仍是原来的词表：赋能等失败，打造和 Elevate、Seamless、Unleash、Next-Gen 只警告。
- 标题和按钮里的 em dash 仍失败。正文可以有。
- 首页重复、示例口号按词比。短句至少 4 个词。
- 框架固定文案（首页、复制微信号、跳到正文等）走 `framework/i18n/en.json`。户型主按钮不会自动翻译，英文站用 `buttons.primary` 盖掉，否则顶栏仍是户型里的中文。
- 字体用 token 的 `font-heading-en` / `font-body-en`。不写就用 `"Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif`。不加载字体文件。

`scripts/fill.mjs` 默认跟随样板间示例语言，可用 `--lang en|zh-CN` 指定。agent 校验读取 site.json.lang，和机检共用语言规则。中文档案可以生成英文站。

## contact

电话、地址、营业时间必填。其余有才填，没有就空字符串或不要这个键。不要编微信号、备案号、邮箱。

| 字段 | 说明 |
|---|---|
| `phone` | 给人看的电话，例如 `0571-86001188` |
| `wechat` | 微信号。没有二维码就显示这个，并给一键复制 |
| `wechatQr` | 二维码图片，相对这份档案的路径。文件不存在就当没有 |
| `email` | 有才填 |
| `address` | 一行地址。页面会链到 `https://uri.amap.com/search?keyword=` 加这行字。不要嵌地图 |
| `hours` | `[{ "day", "time" }]`，至少一行。例如 `{ "day": "周一至周五", "time": "10:00-20:00" }` |
| `formUrl` | 外部表单链接，例如飞书表单。有才出现「在线留言」，点了跳走。不要做站内可提交表单 |
| `icp` | ICP 备案号原文。有才在页脚显示 |
| `police` | 公安备案号原文。有才显示 |
| `qrcodes` | 可无。数组，每项 `{ "image", "label" }`，`imageAlt` 可无。例如「关注公众号」「加店长微信」。有就在页脚显示最多 2 个，电脑右侧悬浮条多一个「二维码」按钮，悬停弹出。没有、或图片文件没有，整块不出。这是页脚和悬浮条用的，和联系板块里的 `qrs` 不是同一个字段 |

悬浮条文案是固定的：打电话、加微信、导航。写了 `qrcodes` 才多一个「二维码」。不要改这几句。

顶栏按钮和行动条按钮用户型里的主按钮（门店「电话预约」，工厂「获取报价」）。首屏默认也用这一句。要换文案或链接，写顶层 `hero.buttons`；不写才用样板间默认。默认按钮指向的页如果关掉了，拼装改成「电话咨询」或「联系我们」，链到联系页。

## 页面

每一页：

| 字段 | 说明 |
|---|---|
| `id` | 必须是户型里的页面 id：门店只有 `home`。工厂有 `home`、`products`、`about`、`contact` |
| `title` | 进 `<title>`。不要用破折号「——」或「—」。需要分隔时用「｜」 |
| `description` | 进 description 和 Open Graph |
| `sections` | 按户型顺序排。每块 `{ "type", "variant", "anchor", "tone", "data" }`。`tone` 可无，取值 `light`、`dark`、`image` |

板块还可以写 `bg`（放在板块上，或放在 `data.bg`）：一张图的图片位 id。只在 `tone` 为 `dark` 或 `image` 时生效，渲染成图片加一层主色方向的深色半透明蒙版（约 0.76）。没这张图就退回原来的纯色。首屏和内页横幅不要用这个字段。图片位见 `docs/IMAGES.md` 的 `section-bg`。

`anchor` 用字母开头，只能有字母、数字、连字符。单页导航的 `#锚点` 必须对上这里。同一页不要重复同一种 type。

可选页可以多一个 `enabled`。`false` 表示关掉。不写就是开着。必有页不能关。关掉的页不生成，导航、首页入口、页脚和首屏按钮里指向它的链接也不出。

`variant` 必须在户型允许列表里。带图的版式如果图不存在，脚本会改成 spec 里的 `fallback`，不会留裂图。所以档案里可以选带图版式，但图的路径必须真实存在；没有图就留空字符串，让它降级。

## 门店 `store-service` 的顺序

首页 `index.html`。必填：hero、services、contact。其余可无。

| 顺序 | type | 允许的版式 |
|---|---|---|
| 1 | hero | `split-image`（要图，缺图改 `text`）、`text` |
| 2 | trust | `stats`、`certs` |
| 3 | services | `grid-cards`、`list-rows` |
| 4 | why | `points`、`steps` |
| 5 | cases | `gallery`（每条都要图，缺一张改 `list`）、`list` |
| 6 | testimonials | `grid-cards`、`spotlight` |
| 7 | team | `cards`（每人要照片，缺一张改 `roster`）、`roster` |
| 8 | faq | `accordion`、`two-column` |
| 9 | contact | `card`、`banner` |
| 10 | cta-band | `simple`、`inline` |

居中 hero（`centered`）存在，这个户型不允许用。

顶栏 `standard` 或 `centered`。页脚 `simple` 或 `columns`。悬浮 `dock`。

## 工厂 `factory-trade` 的顺序

| 页 | 文件 | 板块 |
|---|---|---|
| `home` | `index.html` | hero 必填，trust、services、why、cases 可无，cta-band 必填。版式与门店相同 |
| `products` | `products/index.html` | `product-list` 必填，版式 `grid` 或 `rows` |
| `about` | `about/index.html` | why 必填，team、faq 可无 |
| `contact` | `contact/index.html` | contact 必填，`card` 或 `banner` |

每个产品再生成 `products/<slug>.html`，版式固定 `article`。

## 板块字段

没有写「可无」的就是必填。列表一般 1 到 6 条，常见问题 1 到 10 条，产品规格 1 到 8 条。

### hero

`label` 可无，≤12。`title` 中文 ≤14 字、英文 ≤10 个词。`lead` ≤40。`primaryLabel` ≤8。`primaryHref` ≤200。`secondaryLabel` 可无 ≤8。`secondaryHref` 可无 ≤200。`image` 可无。`imageAlt` 可无 ≤30。轮播另有 `interval`（3000 到 5000 的毫秒，字符串，不写就是 4000）、`mode` 和 `slides`。

`mode` 可无：`carousel`（默认）或 `single`。`slides` 建议 3 到 5 张，引擎仍接受最多 9 张。每张必填 `image`、`imageAlt`。可另写 `title`（仍是中文 ≤14 字、英文 ≤10 个词）、`lead`（≤40）、`primaryLabel` / `primaryHref`、`secondaryLabel` / `secondaryHref`。某一张没写标题、说明或按钮，就用首屏上的那一组。只有一张，或 `mode` 为 `single`，就出单张大图，没有圆点、没有箭头。两张及以上并且不是 `single`：自动播放（默认 4 秒，悬停暂停，系统开了减少动效就停在当前张），有圆点和左右箭头。

`mode` 和 `slides` 写在首页 hero 板块的 `data` 里。顶层 `hero` 只放 `buttons`，不要把轮播写到顶层。

首屏：小标签、标题、一句说明、最多两个按钮（一主一次），以及压在底边的一条信任数字。小标签全站只用一种写法。图片位可以写成 `slot:名字`，名字要在样板间的 `images.json` 里。

## 导航

`nav` 继续可以写成数组：`[{ "label", "href" }]`。单页用 `#services` 这种锚点，多页用 `index.html`、`products/index.html`。

要关掉自动二级，写成对象：`{ "autoChildren": false, "items": [ ... ] }`。`autoChildren` 不写或为 true 时，某一项没有自己的 `children`，并且它的链接对得上某个集合的列表页，这个集合又有至少 2 个分类，就用这些分类做二级。分类不到 2 个就不生成。某一项写 `"autoChildren": false` 只关这一项；写集合 id（字符串）就指定用哪个集合。分类链接：列表版式里有 `id="{{anchor}}-{{key}}"` 时，链到 `#锚点-分类键`（和筛选项同一个键）；版式只有板块锚点时，几个分类都链到这个锚点；两种都没有就只链列表页。不要编一个页面上不存在的锚点。

某一项自己的二级写 `children`：`[{ "label", "href" }]`。写了就用这份，不再自动生成。

电脑宽度：鼠标悬停或键盘聚焦时展开，有小箭头，移开大约 0.28 秒后收起。手机菜单里点箭头折叠。当前页，以及当前页所属的一级，用主色底线高亮。详情页高亮它所属的栏目。带 `#` 的分类链接不高亮成「当前页」，避免一进列表每一类都亮。

## 列表和分页

集合列表（`collection-list`、`product-list`）的卡片有四样：缩略图、标题、摘要（两行截断）、日期或标签。没有缩略图时用主色块加标题的第一个字，不留裂图。首页上的产品、新闻块同样带图。

`data.pageSize` 可无，默认 9，最大 60。只在**这一页就是该集合的列表页**、并且条目数超过 `pageSize` 时分页：第 1 页仍是原来的 `index.html`，第 2 页起是同目录的 `page/2.html`。页上有页码、上一页、下一页。`data.limit` 只截短首页这类导读，不拿来分页。分类键按整份集合算，翻页不会变。

### trust

`title` ≤16。`lead` 可无 ≤40。

- `stats`：每条 `value` ≤8，`label` ≤12。数字用真实的零碎值。没有真数字就不要这块。
- `certs`：每条 `name` ≤20，`issuer` 可无 ≤16。没有真证照就不要这块。

### services

`title` ≤16。`lead` 可无 ≤40。每条 `name` ≤12，`text` ≤40，`price` 可无 ≤16。没有价格就空着，不要写整整齐齐的假价。

### why

`title` ≤16。`lead` 可无 ≤40。每条 `name` ≤16，`text` ≤40。写具体做法。

### cases

`title` ≤16。`lead` 可无 ≤40。每条 `name` ≤16，`text` ≤50，`result` 可无 ≤24，`image` 可无，`imageAlt` 可无 ≤30。没有真实案例就不要这块。

### testimonials

`title` ≤16。`lead` 可无 ≤40。每条 `quote` ≤80，`name` ≤12，`role` 可无 ≤16。没有原话就不要这条，更不要编人名。不打星。

### team

`title` ≤16。`lead` 可无 ≤40。每条 `name` ≤12，`role` ≤16，`text` 可无 ≤40，`image` 可无，`imageAlt` 可无 ≤30。没有真人就不要这块。

### faq

`title` ≤16。`lead` 可无 ≤40。问答 1 到 10 条。每条 `q` ≤24，`a` ≤80。回答里可以用中文破折号。标题和按钮里不行。

### contact

只要 `title` ≤16，`lead` 可无 ≤40。电话、地址、时间从顶层 `contact` 来，不要在 data 里再写一遍。

框架的 `contact/card`、`contact/banner` 还认可选的 `qrs`（最多 4 个）：`{ "image": 图片位 id 或路径, "imageAlt" ≤30, "label" ≤8 }`。有就在联系区下面整行居中放二维码；正式拼装客户没给文件，这一项整项不出；不写这个键这一块就不出。样板间自己的联系版式有各自的字段，以它自己的 `spec.json` 为准。

### cta-band

`title` ≤16。`lead` 可无 ≤40。`primaryHref` ≤200。按钮文字用户型主按钮，不要在 data 里改。

### product-list

`title` ≤16。`lead` 可无 ≤40。产品清单不要写在这里。

### products（工厂）

| 字段 | 说明 |
|---|---|
| `slug` | 小写字母、数字、连字符。变成 `products/<slug>.html` |
| `name` | ≤20。详情页的唯一 h1 |
| `summary` | ≤80 |
| `image` | 可无。没有就不出图 |
| `imageAlt` | 可无 ≤30。不填就用产品名 |
| `specs` | 1 到 8 条。`label` ≤8，`value` ≤24 |

## 样板间

`site.json` 写 `"showroom": "<id>"` 时，不再读 `industries/` 和 `styles/`。脚本改读 `showrooms/<id>/showroom.json`、那里的 `tokens.json`，以及那里的 `sections/`（没有的版式回落到 `framework/sections`）。

字段还可以有 `niche`（美业 `beauty`、餐饮 `dining`、律所 `law`、咨询 `consulting` 等）和 `collections`。集合的每一项会生成一页，slug 规则和产品一样：小写、连字符，不能用 `index`，不能重复。要做筛选时，给这一项加 `category`（分类名，例如「茶饮」）。拼装按分类名生成筛选项，不看 slug 前缀。筛选键由分类名做 FNV-1a，写成 `k` 加 36 进制，同一个分类名每次都是同一个键，不随条目顺序变化。同一分类写同一个名字。没有 `category` 的集合不出现筛选。列表页自己写在 `pages` 里，用板块 `collection-list`。详情页由 `"from": "<集合 id>"` 生成，不要写进 `pages`。

样板间首页至少留首屏、一个产品或服务板块。联系板块留在放了 `contact` 的那一页。这三块在户型里标必有，其余板块可以不写：档案里没有事实就整块不出。

页面分必有和可选。必有是首页、关于、联系、主集合，不能少。可选页（加盟、门店分布、团队、新闻等）在样板间里写了「什么情况下该有」。档案对不上，或写了否定（例如不招加盟、只有一家店），把该页 `"enabled": false`。详情页跟着列表：列表关掉，详情也不生成，那个集合可以空着。

首屏按钮写在顶层，不写才用样板间默认：

```json
"hero": {
  "buttons": [
    { "label": "到店坐坐", "href": "contact/index.html" },
    { "label": "看菜单", "href": "products/index.html" }
  ]
}
```

一到两个。`label` 不超过 8 个字。档案内容少时少放几块，不要把同一件事换着说。

内页顶部的页内 Banner 由脚本插入，不要写进板块顺序。旧的两个例子不写 `showroom`，仍然走原来的户型。

目录里每个文件写什么，见 `docs/SHOWROOM.md`。

## 常见问题、sitemap、robots

档案里每个 `type` 为 `faq` 的板块，问答显示在那一页上。同一批问答再写进首页的第二段 JSON-LD，类型是 `FAQPage`：`name` 是问题，`acceptedAnswer.text` 是回答，顺序和页面上一致。没有 faq 板块就不写这段。原来的 LocalBusiness 或 Organization 仍在第一段。

拼装参数 `--base-url <网址>` 只接受 http 或 https，脚本会补上末尾的 `/`。它会写出：

- `sitemap.xml`：每个生成的 html 页面一条 `<loc>`，前缀是这个网址
- `robots.txt`：`User-agent: *`、`Allow: /`，并写上 sitemap 的地址

不给 `--base-url` 时用 `https://example.com/` 占位。正式模式的 `check.mjs` 会警告「上线前要换真实网址」。带 `--demo-images` 的演示模式不警告。

## toolEntry

可选。有这个对象时，首页末尾多一块小工具入口，导航末尾多一项。颜色和字体走样板间令牌，不另配色。

| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | 是 | 入口标题，也是导航上的文字。≤16 |
| `lead` | 是 | 一句话。≤40 |
| `label` | 是 | 按钮文字。≤8 |
| `href` | 否 | 相对站点根的路径。不写就是 `tool/`。不要写主机名，也不要写成 `tool/index.html` |

`nav` 里如果已经有同一个路径，导航不再加一项。

链接按页面所在目录改成相对路径：首页是 `tool/`，`products/xxx.html` 里是 `../tool/`。站点挂在 `https://用户名.github.io/仓库名/` 这种子路径下，也能点到工具页。

## 输出目录

`--out <目录>` 会在里面再建一层 `<site.id>/`。`--site-dir <目录>` 把整站直接写到这个目录根下，根上就是 `index.html`。两个都写时用 `--site-dir`。

`--site-dir` 会先清空目标目录，再写入这一次拼出来的页面。小工具之类的附加页要在拼装之后放进去。若这个目录里已经有要留住的子目录，用 `--keep <相对路径>`，可以写多次，例如 `--keep tool`。路径必须在目标目录里面，不能写 `..` 或盘符。目标里还没有这个子目录时，`--keep` 什么也不做。目录名是中文也可以：要留住的子目录先在同一盘改名挪走，清空后再挪回来，不再用会在中文路径上崩溃的整目录复制。

## 不要写的东西

- 颜色、字体、圆角、阴影、动效。那些在风格里。
- emoji，或者用表情当图标。
- 标题、按钮、<title> 里的「——」和「—」。中文站和英文站一样。正文可以有。
- 按钮写「提交」「了解更多」「点击这里」。写具体动作。
- 空话见「语言」。中文站：赋能、革命性、颠覆性、一站式、全方位、领先的为失败；打造，以及 Elevate、Seamless、Unleash、Next-Gen 为警告。英文站改用英文词表，命中即失败。
- 占位词：Lorem、John Doe、Acme。
- 编出来的客户数、评分、备案号、评价、案例、团队。没有就不填，整块不出。
- 站内可提交的表单、嵌入地图、手画插画。

## 对话里由 AI 自己填（agent）

装上 skill 之后，正在对话的 AI 按本页和样板间 `examples/site.json` 的结构，把事实写进站点目录的 `site.json`。然后跑：

```bash
node scripts/fitout.mjs --profile <站点目录>/企业档案.md --out <站点目录> --showroom <id> --fill agent
```

这个模式不调用 DeepSeek，不读 `DEEPSEEK_API_KEY`。脚本只校验已经写好的 `site.json`。校验没过，会打印中文错误清单，退出码不是 0。按清单改 `site.json`，再跑同一条命令。不要为了过检去编事实。

`--fill` 不写时也是 `agent`。`--fill deepseek` 才是下面的批量填法，才需要 `DEEPSEEK_API_KEY`。

没有 `MINIMAX_API_KEY` 时，`--gen-images` 会跳过生图并提示，站点照常拼。

## 用模型填

`scripts/fill.mjs` 把本页规则、这套样板间的 `examples/site.json`（只作结构，不抄公司名、电话、数字和句式）、各板块 `spec.json` 的字段和字数上限、企业档案全文拼成提示词，请 DeepSeek 输出 `site.json`。只有这条和 `--fill deepseek` 才需要密钥。

```bash
node scripts/fill.mjs --profile <企业档案.md> --showroom <id> --out <site.json> [--model deepseek-chat] [--max-retries 2] [--lang zh-CN|en]
```

一条命令从企业档案做到整站，批量填法加 `--fill deepseek`：`node scripts/fitout.mjs --profile <档案.md> --out <目录> --showroom auto --fill deepseek`，见 README 的「批量填写」。

- `--model` 默认 `deepseek-chat`。
- `--max-retries` 默认 `2`。校验不过就把错误清单发回给模型改，最多再改这么多轮。
- 密钥只读环境变量 `DEEPSEEK_API_KEY`，不要写进命令行、日志或档案。
- 每次调用用了多少 token，记在旁边的 `<out>.log.json`。

校验先看本仓库的填写规则（必填、字数、空话、可选页开关），再实际拼一次、跑一次机检。`fill.mjs`、agent 和机检共用英文 ×2.2、首屏词数和英文空话规则。缺图警告，以及「上线前要换真实网址」，不会拿去要求模型重写。首页把同一短句说满 3 次，或同一个数字加单位出现在 3 个板块里，会要求重写。英文站的这一条按词，短句至少 4 个词。

## 分类页与行业官网

实际超过 pageSize 的集合有至少两个分类时，额外生成 `category/<分类键>/index.html`，分类分页在该目录的 `page/2.html`。分类键沿用稳定键，自动导航指向完整分类页。business 版式即使未分页，也为至少两个真实分类生成独立入口。旧列表文件、详情文件和分类锚点仍可用；旧锚点在有脚本时转到对应分类页。没有脚本也能直接访问新分类页。

各行业官网的首页顺序由 showroom.json 定义，模型仍只能在允许版式里填内容。无图菜单、产品、课程和房型保留对应内容，缺图不保留空位。首屏只有一张照片时可以用 single；三张及以上才建议轮播。

填写入口的 `--lang` 可覆盖语言。批量未指定跟随样板间示例；agent 未指定沿用 site.json.lang 和旧的中文默认。图片位 `descEn` 提供英文说明。
