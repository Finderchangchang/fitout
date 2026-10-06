# site.json 怎么填

给填内容的模型看。只填事实，不选颜色，不写 CSS。配色、字体、圆角、阴影在风格的 `tokens.json` 里，这份档案碰不到。

字数按去掉所有空白后的 Unicode 码点计。`128 元起` 算 5 个字。超了，机检直接失败。

## 先看户型

`industry` 和 `niche` 以 `industries/registry.json` 为准。没有 `showroom` 时，还要有 `industries/<id>/house.json`，拼装按那份户型。`niche` 可以不填；填了就必须是该行业下已登记的细分。

门店 `store-service` 仍是单页，导航用 `#锚点`。工厂 `factory-trade` 是多页，产品详情不要自己写进 `pages`，写在 `products` 里，脚本按 slug 生成。别的行业看各自的 `house.json` 和注册表里的 `defaultPages`。

户型规定了：有哪些页、板块顺序、每块允许哪几种版式、哪些块必填、顶栏和悬浮条的按钮文案。档案里的板块必须是这个顺序的子序列，不能多、不能换序、不能重复。必填块缺了，拼装会停。可选块没有真内容就整块不要，不要编。

## 顶层

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 站点目录名。小写字母、数字、连字符 |
| `style` | 是 | 风格 id，例如 `_neutral`。对应 `styles/<id>/tokens.json`。也可以写相对这份档案的路径，例如 `./bad-style` |
| `industry` | 是 | 户型 id |
| `businessType` | 是 | 门店写 `LocalBusiness`，工厂写 `Organization`。首页 JSON-LD 用它 |
| `name` | 是 | 店名或厂名。虚构例子在名字后加「（虚构）」。不要用真实公司名 |
| `summary` | 否 | 一句话，页脚和 JSON-LD 用。没有就不填 |
| `url` | 否 | 站点根地址。有才输出 canonical |
| `contact` | 是 | 见下 |
| `nav` | 是 | `{ "label", "href" }`。单页用 `#services` 这种锚点，多页用 `index.html`、`products/index.html` 这种路径 |
| `shell` | 是 | `header`、`footer`、`floatContact`，值必须在户型允许的版式里 |
| `pages` | 是 | 见下。不要写 `from: products` 的那一页 |
| `products` | 工厂必填 | 见下。门店不要写 |

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

悬浮条文案是固定的：打电话、加微信、导航。不要改。

顶栏按钮和行动条按钮用户型里的主按钮（门店「电话预约」，工厂「获取报价」）。首屏的 `primaryLabel` 要自己填，并且跟户型主按钮用同一句话。

## 页面

每一页：

| 字段 | 说明 |
|---|---|
| `id` | 必须是户型里的页面 id：门店只有 `home`。工厂有 `home`、`products`、`about`、`contact` |
| `title` | 进 `<title>`。不要用破折号「——」或「—」。需要分隔时用「｜」 |
| `description` | 进 description 和 Open Graph |
| `sections` | 按户型顺序排。每块 `{ "type", "variant", "anchor", "data" }` |

`anchor` 用字母开头，只能有字母、数字、连字符。单页导航的 `#锚点` 必须对上这里。同一页不要重复同一种 type。

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

`label` 可无，≤12。`title` 中文 ≤14 字、英文 ≤10 个词。`lead` ≤40。`primaryLabel` ≤8。`primaryHref` ≤200。`secondaryLabel` 可无 ≤8。`secondaryHref` 可无 ≤200。`image` 可无。`imageAlt` 可无 ≤30。轮播另有 `interval`（3000 到 5000 的毫秒，字符串）和 `slides`（3 到 9 张，每张 `image`、`imageAlt`）。

首屏：小标签、标题、一句说明、最多两个按钮（一主一次），以及压在底边的一条信任数字。小标签全站只用一种写法。图片位可以写成 `slot:名字`，名字要在样板间的 `images.json` 里。

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

样板间首页至少留首屏、一个产品或服务板块。联系板块留在放了 `contact` 的那一页。这三块在户型里标必有，其余板块可以不写：档案里没有事实就整块不出。页面本身仍要在，不能少页。

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
- 标题、按钮、<title> 里的「——」和「—」。正文可以有。
- 按钮写「提交」「了解更多」「点击这里」。写具体动作。
- 空话：赋能、革命性、颠覆性、一站式、打造、全方位、领先的，以及 Elevate、Seamless、Unleash、Next-Gen。
- 占位词：Lorem、John Doe、Acme。
- 编出来的客户数、评分、备案号、评价、案例、团队。没有就不填，整块不出。
- 站内可提交的表单、嵌入地图、手画插画。

## 用模型填

`scripts/fill.mjs` 把本页规则、这套样板间的 `examples/site.json`（只作结构，不抄公司名、电话、数字和句式）、各板块 `spec.json` 的字段和字数上限、企业档案全文拼成提示词，请 DeepSeek 输出 `site.json`。

```bash
node scripts/fill.mjs --profile <企业档案.md> --showroom <id> --out <site.json> [--model deepseek-chat] [--max-retries 2]
```

- `--model` 默认 `deepseek-chat`。
- `--max-retries` 默认 `2`。校验不过就把错误清单发回给模型改，最多再改这么多轮。
- 密钥只读环境变量 `DEEPSEEK_API_KEY`，不要写进命令行、日志或档案。
- 每次调用用了多少 token，记在旁边的 `<out>.log.json`。

校验先看本仓库的填写规则（必填、字数、空话、主按钮），再实际拼一次、跑一次机检。缺图警告，以及「上线前要换真实网址」，不会拿去要求模型重写。
