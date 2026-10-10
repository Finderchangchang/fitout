# 精装 · FitOut

把企业资料，做成客户看得懂的静态官网。**默认不需要额外 API key，零 npm 依赖，Node 18+。**

14 套行业样板间。v0.6.0 第一阶段重做了国内工厂、英文外贸工厂、餐饮门店三套的首页、内页和无图版；其余 11 套保留原版，等待视觉方向确认后继续。

## 跟 AI 说一句话出站

1. 下载仓库，在仓库根目录安装 Skill：

```powershell
node scripts/install-skill.mjs --target codex
```

Claude Code 把 target 换成 `claude`；其他兼容助手用 `agents`。安装器把仓库位置记录在安装副本中，仓库移动后重装一次。也可以把 `skill/fitout` 整个文件夹手工复制到助手的 skills 目录，并在首次对话告诉助手仓库位置。

2. 新开对话，说：

> 给我公司做一个官网。这是企业介绍和产品资料，客户主要是……，希望看完能……。

助手先读你已有的资料，补问必要信息，再推荐样板间；整理照片、填写内容、生成网站并验收。你不用写 JSON，不用给照片改内部编号。

3. 打开交付目录的 `site/index.html`。同时查看桌面、手机截图和 `交付说明.md`。没有照片也能生成完整的精简版，有素材再增强。

一个站点一个目录：

| 文件 | 用途 |
|---|---|
| `企业档案.md` | 可公开事实，修改数字、价格和时间先改这里 |
| `site.json` | 网站内容，助手按档案填写 |
| `photos/` | 原素材的副本和用途清单 |
| `img/` | 处理后的图片和来源记录 |
| `site/` | 完整静态网站 |
| `交付说明.md` | 页面、检查结果、缺失素材、发布方式 |

默认交本地站。明确要求上线后才发布，发布只使用 `site/`；档案和原始素材不上传。

## 样板间

| 行业 | 样板间 | 适合谁 | 主要页面 |
|---|---|---|---|
| 制造工厂 | `cn-factory` | 机械、五金、零部件、建材工厂 | 产品中心（型号参数表）、生产设备、资质荣誉、应用领域、询价 |
| 餐饮茶饮 | `cn-dining` | 茶饮、餐饮、烘焙连锁和单店 | 品牌故事、产品、门店分布、加盟合作 |
| 培训学校 | `cn-education` | 职业技能学校、兴趣培训中心 | 课程设置、师资力量、学员风采、预约试听 |
| 律所财税 | `cn-professional` | 律师事务所、财税代账、企业咨询 | 专业领域、律师团队、典型案例、法律知识 |
| 口腔诊所 | `cn-medical` | 口腔诊所、社区诊所、中医馆 | 诊疗项目、医生团队、就诊指南、口腔科普 |
| 装修公司 | `cn-home-decor` | 家装公司、全屋定制、建材门店 | 装修案例、设计团队、装修套餐、施工工艺、免费量房 |
| 汽车服务 | `cn-auto` | 汽修厂、快修连锁、汽车美容 | 服务项目、技师团队、门店分布、养车知识 |
| 民宿文旅 | `cn-hospitality` | 民宿、精品客栈、度假酒店 | 房型介绍、周边玩法、相册、预订与交通 |
| 农业特产 | `cn-agriculture` | 农产品基地、合作社、地方特产 | 产品中心、种植与溯源、资质认证、批发合作 |
| 婚纱摄影 | `cn-wedding-photo` | 婚纱摄影、婚庆、写真 | 作品欣赏、套系价格、团队、拍摄基地、预约看样 |
| 外贸工厂 | `intl-factory` | 做外贸的零部件、五金、机械和代工。英文站 | 首页、关于、产品、应用、品质、新闻、联系 |
| 高端门店 | `intl-beauty` | 美容院、SPA、美发沙龙、养生馆 | 首页、品牌、项目、手艺人、环境、会员、记事、预约 |
| 课程平台 | `intl-education` | 职业技能、设计、编程、语言课程 | 首页、关于、课程、讲师、学员作业、资讯、报名 |
| 咨询律所 | `intl-professional` | 管理咨询、律师事务所、财税顾问 | 首页、关于、服务、团队、案例、洞察、面谈 |

第一阶段三套重点：

三套新版的仓库预览图展示无图版；有图演示使用仓库外图库，预览不打包图库照片。

- `cn-factory`：产品与参数先于企业宣传，工艺、品控和询价形成连贯阅读顺序。
- `intl-factory`：英文产品、生产流程、能力和询价；填写、校验、呈现使用相同语言规则。
- `cn-dining`：菜单、价格、门店体验、地址和营业时间优先；无照片时是清楚的文字菜单。

保留每套主色和行业特点。样板间确定版式，助手填写事实。未确认的数字、评价、资质和经营承诺不补写。

## 命令行

已有 `site.json` 时校验并生成，不调用外部模型：

```powershell
node scripts/fitout.mjs --profile "<站点目录>/企业档案.md" --out "<站点目录>" --showroom cn-factory --fill agent
```

`--fill` 默认是 `agent`。语言需要覆盖时加 `--lang en` 或 `--lang zh-CN`。照片已放进 photos 不用再加参数；外部照片目录用 `--photos "<目录>"`。

普通照片名可以通过 `photos/sources.json` 对应到用途，助手应负责完成这个清单：

```json
{
  "items": [
    { "id": "hero-tea", "file": "茶杯照片.jpg", "source": "photo" }
  ]
}
```

`id` 来自所选样板间的图片清单；来源是 `photo`、`stock` 或 `ai`。也支持既有的 `{ "hero-tea": "photo" }` 写法。实拍限制会在配图和拼装时检查，来源记录随图片保留。

只看示例，不需要密钥：

```powershell
node scripts/build.mjs showrooms/cn-factory/examples/site.json --site-dir out/demo
```

打开 `out/demo/index.html`。仓库不带演示照片，缺图会换成无图版。用自己合法持有的图，可加 `--images "<图片目录>"`；开发者演示图库用 `--demo-images "<仓库外图片目录>"`，照片不进入仓库。

### 批量填写

只有主动选择 DeepSeek 批量填写才需要 `DEEPSEEK_API_KEY`，密钥只放环境变量：

```powershell
node scripts/fitout.mjs --profile "<档案.md>" --out "<站点目录>" --showroom intl-factory --fill deepseek --lang en
```

批量默认跟随样板间语言，中文档案可以生成英文站。提示词中的示例只提供字段骨架，不携带示例公司的整套文案和数字。

MiniMax 生图是可选项；没有生图密钥不会阻止出站。助手已有生图能力时也可整理生成的氛围图，标记为 ai，不能冒充企业实拍。

## 验证

```powershell
node tests/quick.mjs
node tests/visual.mjs --showroom cn-factory --demo-images "<演示图根目录>"
node tests/release.mjs --demo-images "<演示图根目录>"
```

- quick：静态检查、框架和样板间 lint、颜色区分。
- visual：受影响样板间的视觉硬伤，1440 和 375。
- release：14 套完整视觉检查、既有回归、新增企业站回归，最终跑一次。

视觉检查使用本机已有 Playwright，`PLAYWRIGHT_PATH` 可指到包目录或入口。程序不安装 npm 依赖。没有 Playwright 时明确报告未验，不能把跳过当通过。

三套示例的事实来源在 `examples/profiles/showrooms/`：

```powershell
node scripts/check-profile.mjs
node tests/business.mjs
```

程序检查之外还要看完整页面、核对图文、点导航和分类。零横向溢出不等于企业信息已经表达清楚。

## 文档

- [Skill 工作流](skill/fitout/SKILL.md)
- [企业档案](docs/PROFILE.md)
- [站点字段与语言](docs/SITE_JSON.md)
- [样板间](docs/SHOWROOM.md)
- [素材与来源](docs/IMAGES.md)
- [框架约定](docs/FRAMEWORK.md)
- [更新记录](CHANGELOG.md)

## 许可

[Apache-2.0](LICENSE)，开源可商用。演示照片的使用权与项目代码许可独立，照片保留在仓库外。
