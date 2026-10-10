# 配图

样板间的图片位在 `showrooms/<id>/images.json`。字段说明见 `docs/SHOWROOM.md` 的 images.json 一节。这一页写三件事：图库图怎么下、AI 图怎么生、拿到图之后怎么裁成一套。

演示图放仓库外，目录自己定。下文把这个目录写成 `<演示图目录>`。

```text
<演示图目录>/<showroom-id>/<slot-id>.jpg
```

图库图的许可证不允许原样再分发，所以不要放进公开仓库。拼装时指过去：

```text
node scripts/build.mjs showrooms/<id>/examples/site.json --demo-images <演示图目录>/<id>
```

课堂上图很少，用正式模式，不要画演示占位：

```text
node scripts/build.mjs <site.json> --images <老板照片和生成图的目录> [--site-dir <目录>] [--base-url <网址>]
```

`--images` 按图片位 id 找同名的 jpg、jpeg、png、webp、svg、gif。找不到就当这张没有。不要和 `--demo-images` 一起用。

`images.json` 每个位有 `tier`。`must` 是课上必须有的图，每套最多 8 张（首屏 1 到 3 张，再加几张最关键的）。`nice` 没有就走无图。正式模式（不带 `--demo-images`）里：

- `nice` 缺了：能换无图版式就换。首屏轮播凑不满 3 张，改成文字首屏。纯图片带 `photo-band` 整块不出。别的板块留下文字，缺的 `<img>` 不输出。拼装不因此失败。
- `must` 缺了：拼装仍然成功。`check.mjs` 警告「这些图课上要有，现在还没有」，并列出 id。
- 还有 `must` 或 `nice` 位没有文件时，首页张数不够不再拿 E4 挡住。演示模式仍按原来的张数规则。

深色板块的底图用新的图片位：`block` 写 `section-bg`，`tier` 写 `nice`。板块的 `bg` 填这个 id。没有文件就退回纯色，不换版式，也不因此失败。这种位不是课上必须有的图，不占 `must` 的名额。拼装也接受已经存在的任意图片位 id 当作 `bg`（验收时可以拿现成的图顶上）。

三个脚本都在 `scripts/images/`，不安装 npm 包。网络用 Node 自带的 fetch。裁切和调色用本机 Playwright 的 Chromium canvas。Playwright 先看环境变量 `PLAYWRIGHT_PATH`，指到入口文件（`.../playwright/index.mjs`）或包目录（`.../playwright`）都行，指到目录时自动找里面的 `index.mjs`；没设置就按 Node 正常的模块解析去找 `playwright`。`check-visual.mjs`、`shot.mjs` 和这几个脚本用同一个查找函数。

MiniMax 的密钥只读环境变量 `MINIMAX_API_KEY`。接口根地址默认 `https://api.minimaxi.com/v1`，要用别的地址就设 `MINIMAX_BASE_URL`（https，写到 `/v1` 为止）。脚本不会把密钥写进日志、报告或图片目录。

## 顺序

1. 先 `--dry-run`。图库清单看文件名、作者、许可证和估计大小。AI 位看将要发送的 prompt。
2. 图库清单给老板点头之后再下载。没点头不要下。
3. 下载和生成都写到各自的目录。
4. 用 `grade.mjs` 裁切、调色、压成 JPG，再放进演示目录。
5. 用上面的 `--demo-images` 拼装。

## 1. 下载图库图

`<图库清单目录>` 里如果还没有清单，就用下面这份。一个图片位一条，`primary` 是首选，`fallback` 是备选，备选可以不写。

```json
{
  "showroom": "cn-dining",
  "items": [
    {
      "id": "hero-tea",
      "primary": {
        "page": "https://www.example.com/photo/hero-tea",
        "author": "作者名",
        "platform": "pexels",
        "url": "https://images.example.com/hero-tea.jpg",
        "bytes": 240000,
        "license": "Pexels License"
      },
      "fallback": {
        "page": "https://www.example.com/photo/hero-tea-alt",
        "author": "作者名",
        "platform": "unsplash",
        "url": "https://images.example.com/hero-tea-alt.jpg",
        "bytes": 180000,
        "license": "Unsplash License"
      }
    }
  ]
}
```

| 字段 | 含义 |
|---|---|
| `id` | 图片位 id，和 images.json 里的一样 |
| `page` | 照片页面链接，用来核对作者和许可证 |
| `author` | 作者 |
| `platform` | 平台，例如 `pexels`、`unsplash` |
| `url` | 文件直链。只接受 http 或 https |
| `bytes` | 估计字节数。dry-run 把首选的加总 |
| `license` | 许可证名称 |

```text
node scripts/images/fetch-stock.mjs --plan <stock-plan.json> --out <目录> --dry-run
node scripts/images/fetch-stock.mjs --plan <stock-plan.json> --out <目录>
```

`--dry-run` 只打印将要下载的首选，以及估计总大小，不创建目录、不写文件。

真下载时先下首选。直链不是 2xx、连不上、或者文件不是 png / jpeg / webp / gif，就改下备选。两个都失败时这一条记失败，其他条照常保存，最后退出码为 1。

保存的文件名是 `<id>` 加真实后缀，不把 png 硬改成 `.jpg`。来源写在同一目录的 `credits.json`：页面、作者、平台、直链、许可证、字节数、用的是首选还是备选。再次下载同一个 id 会盖掉这一条，别的 id 保留。

## 2. 生成 AI 图

只处理 `source` 为 `ai` 的位。模型 `image-01`。`prompt` 是这三段接在一起：slot 的 prompt、这套的 grade（slot 上有就用 slot 的，没有用顶层）、固定的「无文字、无 logo、无水印、不要真实品牌」。

比例不在 MiniMax 支持列表里时，选数值最接近的一档。支持的比例和模型原生像素是：

| slot 比例 | aspect_ratio | 模型大约输出 |
|---|---|---|
| `1:1` | `1:1` | 1024×1024 |
| `16:9` | `16:9` | 1280×720 |
| `4:3` | `4:3` | 1152×864 |
| `3:2` | `3:2` | 1248×832 |
| `2:3` | `2:3` | 832×1248 |
| `4:5` | `3:4` | 864×1152 |
| `9:16` | `9:16` | 720×1280 |
| `16:10` | `3:2` | 1248×832 |
| `2.4:1` | `21:9` | 1344×576 |

生成图先按模型尺寸存成 `<slot-id>.jpg`。要的像素在下一步裁。

```text
node scripts/images/gen-ai.mjs --showroom cn-dining --out <目录> --dry-run
node scripts/images/gen-ai.mjs --showroom cn-dining --out <目录> --only prod-grape
```

`--only` 只处理一个位。不加的话，会按 images.json 的顺序把全部 ai 位各请求一次。

请求体是这几个字段：`model`、`prompt`、`aspect_ratio`、`response_format`（`url`）、`n`（1）、`prompt_optimizer`（false）、`aigc_watermark`（false）。不传 width / height，避免和比例打架。

成功后，用过的 prompt 和接口摘要写在 `<目录>/ai-log.json`。里面有任务 id、HTTP 状态、`base_resp`、响应有哪些字段、图片从 url 还是 base64 来、文件尺寸和耗时。不写密钥，也不写带签名的图片直链，只写主机名。

失败时打印 HTTP 状态码和 MiniMax 返回的 `status_code`、`status_msg`。响应里的长字符串会截断。

## 3. 裁切、调色、压缩

```text
node scripts/images/grade.mjs --showroom cn-dining --in <原始图目录> --out <演示图目录>/cn-dining
```

输入按图片位 id 找 `.jpg`、`.jpeg`、`.png`、`.webp`、`.gif`，jpg 优先。目录里没有的位跳过，最后说明还缺多少。对得上的才处理。

裁切：按 `px` 的宽高比从原图切一块，再缩放到 `px`。默认焦点在画面正中。slot 可以加 `focus`：

```json
"focus": [0.42, 0.38]
```

两个数都在 0 到 1，表示焦点在宽、高上的相对位置，裁切时尽量把这个点留在画面中心。有一个数大于 1，就两个都按像素算。

调色参数是可选的 `gradeParams`，可以写在 images.json 顶层，某个 slot 再写一份就盖过顶层对应字段。**不要为了填这个字段去改样板间里已经定稿的 images.json**，没写就用中性默认。

```json
"gradeParams": {
  "brightness": 1.02,
  "contrast": 1.04,
  "saturate": 0.88,
  "warmth": 0.22
}
```

或者用一层色，不用冷暖：

```json
"gradeParams": {
  "brightness": 1,
  "contrast": 1,
  "saturate": 0.92,
  "tint": { "color": "#c4783a", "opacity": 0.18 }
}
```

| 字段 | 默认 | 范围 | 做法 |
|---|---|---|---|
| `brightness` | 1 | 0 到 3 | canvas `brightness()`，1 是原图 |
| `contrast` | 1 | 0 到 3 | canvas `contrast()` |
| `saturate` | 1 | 0 到 3 | canvas `saturate()` |
| `warmth` | 0 | -1 到 1 | 正数 soft-light 叠 `#d68436`，负数叠 `#407ac4`。透明度是 `min(0.55, abs(warmth) × 0.45)` |
| `tint.color` | 无 | `#RRGGBB` | 再叠一层 soft-light |
| `tint.opacity` | 0 | 0 到 1 | 这一层的 alpha |

三个滤镜都是 1、warmth 是 0、又没有 tint 时，不叠颜色，只做裁切和压缩。`grade` 那段文字仍然只用于生图 prompt，不拿来猜数字。

导出 JPG。质量从 80 开始，文件还大于上限就减 5，最低到 20。上限：

- 首屏大图 250 KB（250×1024 字节）：`block` 是 `hero`，或者 `page` 是 `home` 且 `px` 宽度 ≥ 1440
- 其他 150 KB（150×1024 字节）

跑完打印表：id、比例、像素、文件大小、实际质量、上限、是否通过。尺寸或比例不对，或者降到 20 仍然超过上限，退出码为 1。

## 客户提供

`source` 三选一：`stock` 图库，`ai` 生成，`client` 客户提供。二维码、营业执照、资质证书写 `client`。

`fetch-stock.mjs` 看到清单里的 id 在样板间里是 `client`，就跳过，不下载。`gen-ai.mjs` 只处理 `ai`，`client` 不发请求。`--only` 指到一个 `client` 位时，打印跳过并退出 0。

拼装按 id 在 `--demo-images` 目录里找文件。找到就拷进站点。找不到就画一块浅色占位，分两行：用途、「上线前替换」，例如「微信二维码 / 上线前替换」。用途取这个位 `desc` 的第一小句（到逗号、句号为止，去掉「占位」「上线前……」），没有 `desc` 时二维码位叫「二维码」、其他位叫「客户提供的图」，**不拿图片位 id 当文案**。这张 SVG 不写 `viewBox`、宽高 100%，字永远是 14px 真实像素，不管占位图显示成 96px 还是 288px 宽；底色、虚线框、字色取这个站自己的 tokens，和页面配套。字太长时按中文 6 个字、英文 14 个字符一行折行。`<img>` 上带 `data-ph` 属性。样板间不要在占位图上再盖说明字。拼装不因此失败，这一页也不挂「演示占位图」。

不带 `--demo-images` 时，`--images` 目录里有同名文件就用那张；没有就**不画占位**，这个位当没有图：`qr-` 开头的位所在的列表项整项不出（连同图下面的说明字），单张图的位按空处理，板块里用 `{{#if}}` 包住的整块不出。正式站不会出现「上线前替换」。拼装不失败。`check.mjs` 在正式模式里，对没写 `tier` 的 `client` 位发现站点里没有 `images/<id>` 文件，给警告，不阻断。写了 `tier` 的位改走上面的 must / nice 规则，不再重复这条。演示模式不为此警告。

## 交给真实客户

课堂口径：

首屏轮播是行业氛围和细节特写，可以用 AI 生成，也可以用图库。不要把它写成「本厂 / 本店 / 本校」的全景。样板间里这些位一律 `mustBeReal: false`、`tier: must`。prompt 写局部：工厂是机床加工、金属零件、车间光影；餐饮是茶汤和食材；律所是案头书卷、法槌、建筑局部；口腔是器械和诊室局部，不要口腔特写。每套 `tier: must` 的位里，至少 3 个是 `mustBeReal: false`，课上没有老板照片时，可以用生成图把首屏补上。

- `mustBeReal` 为 `true` 的图片位不允许用生成图。正式拼装时，这个位没有客户的真图，就走无图 fallback，不画「上线前替换」，也不拿生成图顶上。所以每个 `mustBeReal` 的位都必须写 fallback（样板间里写 `"fallback": "omit"`，表示整张图不出）。
- `tier` 为 `must` 且 `mustBeReal` 为 `false` 的位可以用生成图。正式拼装找不到文件时，仍按缺图警告，不因此改退出码。
- `mustBeReal: true` 只留给页面文字明确说「这是我们的」那一类：团队、医生、律师、技师的人像，门店门头，厂房或场地全景，证书，客片和作品。氛围图、细节特写、工艺过程不要标成必须实拍。
- 二维码、营业执照、资质证书不要写 `stock` 或 `ai`，写 `client`。

`--images` 目录里可以放一份 `sources.json`。它是一个对象，键是图片位 id，值只能是这三字：

| 值 | 含义 |
|---|---|
| `photo` | 老板实拍 |
| `ai` | 生成 |
| `stock` | 图库 |

```json
{
  "front-longjing": "photo",
  "hero-tea": "ai"
}
```

拼装时如果有这份文件，会原样抄到站点的 `images/sources.json`。正式模式的 `check.mjs` 读它（演示模式不查）：

- `mustBeReal: true` 的位标成 `ai`：失败，不许拿生成图冒充实拍。
- 标成 `photo` 或 `stock`：这一条通过。
- 没有 `sources.json`：警告「无法确认实拍」，不改变退出码。文件在、但某个必须实拍的位没写来源，也是这一句警告，带上 id。

值不是 `photo`、`ai`、`stock` 时，拼装直接失败。

正式拼装不要带 `--demo-images`。那个参数是演示用的：缺的图库图和 AI 图会画深色占位，只有这一页真画出了这种块，才标「演示占位图」。演示模式仍给 `mustBeReal` 的位画占位，方便看版式。见 `docs/SHOWROOM.md`。

## 普通照片名与来源清单

对话助手负责看图、分配用途，用户不用把文件改成内部编号。photos/sources.json 可以采用 `{ "items": [{ "id": "hero-tea", "file": "茶杯照片.jpg", "source": "photo" }] }`，或既有 id 对应来源的对象。file 只能是本目录里的文件名。来源记录随调色、拼装保留；生成图指向必须实拍的位会被拦下。

图片位可有 descEn，供英文站填写。14 套的 showroom.json 写 missingClientImages: omit，因此没有客户文件的二维码和证书收起。演示图库里的客户材料始终收起：图库条码、二维码和证书不能证明属于演示企业。核实过的客户文件用正式模式 --images 提供。不要生成一个看似真实的二维码来顶替未知的公众号。

产品示意图须与产品形状相符，明确区分示意图和企业实拍。演示素材、生成原图、调色产物和来源记录都保留在仓库外。
