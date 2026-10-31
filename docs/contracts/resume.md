# 简历：页面、控制台编辑、敏感信息打码（P2.10）

用户 2026-10-31 确认。前后端按本文实现。

## 0. 决定

- 简历内容只存在服务器数据库（`kv.resume`），**不进 Git**：仓库是公开的，简历里有真实姓名、手机、邮箱。测试和 fixture 只用合成数据，不能出现用户的真实简历内容。
- 首次导入由 Lead 在本机通过私有接口完成（`PUT /api/private/resume`），内容来自用户提供的 PDF。Worker 不读这个 PDF。
- 打码在**服务端**完成。公开接口只返回打码后的数据，浏览器拿不到原文，所以不能在前端用 CSS 或 JS 打码。
- 一个总开关「对外显示完整信息」（`revealPublic`），**默认关闭**。
  - 关闭：所有访客看到打码版。
  - 打开：所有访客看到完整版。
  - 控制台编辑时始终显示完整内容，并能一键切换「预览访客看到的样子」。
- 敏感字段默认打码：姓名、手机、邮箱、出生年月、籍贯、现居地、公司名、客户和项目名。不打码：学校、学历、性别、工作年限、技能。每一项都能在控制台单独设置要不要打码。
- 公开主页上的简历卡片从接口读取。另外新增独立的简历页面 `/resume/`，展示完整排版（时间线、技能、项目），并支持打印（`@media print`，A4 版式）。

## 1. 数据

```ts
Resume {
  basics: {
    name:      Field            // 姓名
    title:     string           // 求职方向，例如「Java 开发工程师」，不敏感
    phone:     Field
    email:     Field
    birth:     Field            // 出生年月，例如「2000.01」
    hometown:  Field            // 籍贯
    location:  Field            // 现居地
    school:    Field            // 默认 sensitive=false
    degree:    Field            // 默认 sensitive=false
    gender:    Field            // 默认 sensitive=false
    years:     Field            // 工作年限，默认 sensitive=false
    summary:   string           // 一句话自我介绍，可空
  }
  work: [{ id, start: "2022.05", end: "2024.02" | "至今", company: Field, role: string, bullets: string[] }]
  skills: [{ id, label: string, text: string }]                 // 例如「后端框架」「Spring、SpringBoot……」
  projects: [{ id, name: Field, client: Field | null, desc: string, stack: string[], bullets: string[] }]
  updatedAt: string
}
Field = { value: string, sensitive: boolean }
ResumeSettings { revealPublic: boolean }                         // kv.resume_settings
```

- 字段长度：普通文本最多 200 字；desc、bullet 每条最多 500 字；work、projects 各最多 20 条，每条最多 20 个 bullet；skills 最多 30 条。超出时返回 400。
- 文本里不能有控制字符和零宽、双向控制字符，复用 `BAD_CHARS`（bullet 和 desc 允许 `\n`）。
- **额外敏感词** `keywords: string[]`（2026-10-31 新增）：用来放不属于任何字段、但不想公开的词，比如对接的厂商名、客户内部系统名。最多 50 个，每个 2–40 个字。它们和敏感字段一起参与下面的替换，替换结果是 `某系统`。如果 `某系统` 本身包含某个敏感值，就改用占位符。导出和导入时保留这个字段。公开接口不返回 keywords。编辑器里提供「其他需要隐藏的词」输入框，用逗号或回车分隔，每个词显示成一个可以删除的小块。
- **自由文本里也可能写到敏感词**，比如 desc 里提到客户全名。所以服务端打码时，除了打码 `sensitive=true` 的字段，还会把这些字段原文出现在 desc、bullets、summary、skills.text 里的地方一起替换。规则：
  1. 从所有 `sensitive=true` 的字段里取 value；
  2. 去掉长度小于 2 的；
  3. 按长度从长到短排序；
  4. 用 `split(v).join(mask(v))` 依次替换，不要用正则，避免用户内容里的特殊字符被当成正则；
  5. 匹配要区分大小写。

## 2. 打码规则 `mask(kind, value)`

| 类型 | 原文 | 打码后 |
| --- | --- | --- |
| 姓名 | 2 个字 | `张*` |
| 姓名 | 3 个字以上 | 保留首尾，中间换成 `*`，例如「张小三」→ `张*三` |
| 手机 | 11 位数字 | 前 3 位和后 4 位之间换成 `****`，例如 `138****0000` |
| 手机 | 其他格式 | 只保留最后 2 位，例如 `*********00` |
| 邮箱 | `zhangsan@example.com` | local 部分只留首字母，例如 `z***@example.com`；domain 不变 |
| 出生年月 | `2000.1.1` | 只留年份，例如 `2000.**` |
| 籍贯、现居地 | 「浙江 杭州」「浙江杭州」 | 只留到省一级（取前 2 个字），后面补 `**`，例如 `浙江**` |
| 公司、客户、项目名 | | 一律变成 `某`加行业或类型的词。打码时取 value 的最后 2–4 个字作为类型（「有限公司」「集团」「研究院」「系统」「平台」），前面加 `某`，例如 `某信息科技有限公司`、`某集团…系统`。识别不出类型时显示 `某公司` 或 `某项目` |
| 其他 | | 每个字都换成 `*`，保留长度 |

- 为了让访客看得出这里被打码了，公开接口给每个打码过的字段加 `"masked": true`。前端在它旁边显示一个小锁图标，`title` 写「已隐藏」。
- 打码结果的长度不能透露原文的确切长度（姓名、公司名这类）。`某…` 的写法已经做到了这一点。

## 3. 接口

| 方法 路径 | 返回 |
| --- | --- |
| `GET /api/resume` | 公开。`revealPublic` 为 false 时返回打码版，每个 Field 序列化成 `{text, masked}`；为 true 时返回原文，masked 都是 false。`Cache-Control: no-store`，保证开关切换后马上生效。没有导入过简历时返回 404 `no_resume` |
| `GET /api/private/resume` | 原始数据，Field 保持 `{value, sensitive}`，另外附带 `settings` |
| `PUT /api/private/resume` | 整份替换，校验规则见第 1 节。返回 200 Resume |
| `PUT /api/private/resume/settings` | `{revealPublic: boolean}` |
| `GET /api/private/resume/preview` | 返回访客现在会看到的版本（和 `/api/resume` 一样），供控制台预览 |
| `GET /api/private/resume/export` | 下载 JSON 备份，`Content-Disposition: attachment`，`no-store` |

- 写接口沿用 Origin 和 Content-Type 检查。
- **公开接口的响应里绝不能出现任何 `sensitive=true` 的原文。** 要有测试：用合成数据，把全部敏感 value 逐个在响应 JSON 里搜索，一个都不能找到。另外要覆盖「敏感词出现在 bullet 里」的情况。
- sitemap 加上 `/resume/`。打码版允许搜索引擎收录，`revealPublic` 打开时页面加上 `noindex`，避免完整信息被搜索引擎缓存。

## 4. 页面

### 公开
- 主页 `Resume.astro`：改成在浏览器里请求 `/api/resume` 渲染，显示精简版（最近两段工作经历和技能分组），右上角放「查看完整简历 →」链接到 `/resume/`。请求失败或返回 404 时显示「简历整理中」，**不能**保留旧的占位假数据。
- `/resume/`：由 Astro 生成的静态页面，内容在浏览器里请求接口后渲染。排版：
  - 页头：姓名和求职方向，下面一行是联系方式和基本信息。
  - 工作经历：时间线。
  - 项目经历：卡片，包含技术栈 chips 和职责要点。
  - 专业技能：分组列表。
  - 两套主题都要好看。另外加 `@media print`：打印时强制白底黑字，隐藏顶栏、页脚和浮动按钮，每段经历不跨页断开（`break-inside: avoid`）。
- 被打码的字段旁边显示一个小锁图标，用 `aria-label="已隐藏"`。
- Header 导航里的「简历」改成链接到 `/resume/`。
- 所有文字都用 textContent 写入，不使用 innerHTML。

### 控制台
- `/console/settings` 新增「简历」区块（`#resume`）。也可以单独做一个页面 `/console/resume`，看哪种做法更合适。
  - 顶部放总开关「对外显示完整信息」。打开时弹出 danger 确认框：「访客将看到你的手机号、邮箱等全部信息」。
  - 基本信息：每一行是「字段名、输入框、打码开关」，打码开关用一个小锁按钮，`aria-pressed` 表示状态。
  - 工作经历和项目经历：列表形式，可以新增、删除、上移、下移，每一条里的要点也能增删。公司名、项目名、客户名旁边同样有打码开关。
  - 技能：label 加 text，可以增删和排序。
  - 右侧（窄屏时在下方）放「预览」，用标签切换「我看到的」和「访客看到的」，访客视图调用 `/api/private/resume/preview`。
  - 保存按钮支持 Ctrl/Cmd+S。离开页面时如果有未保存的修改要提示。按钮旁边提供「导出 JSON 备份」。
- 继续使用 `src/scripts/ui/` 里的组件，不使用原生弹框。
