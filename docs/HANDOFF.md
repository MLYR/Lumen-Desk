# 交接文档 · 航点 Waypoint

更新日期：2026-10-30
阶段：P0 结束（方案和页面布局已定稿），下一步进入 P1 编码。
完整方案见 `docs/PLAN.md`，本文只写接手需要知道的事。

## 1. 项目是什么

zreo 的个人站，部署在一台腾讯云轻量服务器上，分成两部分：

- **公开主页**：一句话介绍、简历、博客、技术试验场，所有人可看。
- **私人控制台**：时间和搜索、个人简介、AI 热点滚动、收藏夹、服务器状态、博客和试验场入口，只有 zreo 自己能登录。

项目名暂定 **航点 / Waypoint**，用户还没最终确认，备选见第 8 节。

## 2. 已经定下来的决定

| 项目 | 决定 | 来源 |
| --- | --- | --- |
| 服务器 | 腾讯云轻量，上海，4 核 4G，3 Mbps，一年期 | 用户 |
| 域名 | 已有，具体名称未告知；内地机房必须 ICP 备案 | 用户 |
| 可见范围 | 控制台仅自己可见；简历、博客、试验场公开 | 用户 |
| 登录方式 | 只用 Google Authenticator 6 位验证码，不设密码 | 用户 |
| 主题 | 两套：白纸（白天）、蓝图（夜间）。默认「自动」，06:00–18:00 白纸，其余蓝图；可手动固定。石墨主题已删除 | 用户 |
| 搜索 | 默认 Bing，可切 Google、百度、GitHub、MDN；保留 `// QUERY` 样式 | 用户 |
| AI 热点 | AIHOT 热点榜 Top 10，纵向循环滚动，悬停暂停，点击跳 AIHOT | 用户 |
| 控制台布局 | 第 1 行时间、搜索；第 2 行简介、AI 热点；第 3 行收藏夹；第 4 行服务器、博客、试验场 | 用户 |
| 收藏夹 | 固定高度（桌面 460px，手机 420px），内部滚动；左侧文件夹树，右侧分组链接，顶部筛选 | 用户确认 |
| 显示名 | 暂用 zreo | 用户 |
| 技术栈 | Astro + Tailwind v4 前端，Hono + SQLite 后端，Caddy 网关，Docker Compose 部署 | 方案，用户未反对 |

## 3. 文件清单

```
AAA/
├── .gitignore                    # 已排除书签数据和 .env
├── docs/
│   ├── PLAN.md                   # 完整方案（v0.2）
│   └── HANDOFF.md                # 本文
└── design-demos/                 # 已定稿的静态 HTML 原型，浏览器直接打开
    ├── site.html                 # 公开主页
    ├── login.html                # 登录页（6 位验证码，输满自动提交）
    ├── navigator.html            # 私人控制台
    ├── theme.css / theme.js      # 两个主题、自动切换逻辑，三个页面共用
    ├── bookmarks.data.js         # ⚠ 私有：用户的 296 条书签
    └── shots/                    # 各页面在两个主题、1440/375 宽度下的截图
```

原型都是纯前端，没有真实后端：登录页不校验验证码；AI 热点是 2026-10-30 拉取的快照写死在页面里；服务器状态是示例数据；博客和简历是占位内容。

目录还不是 Git 仓库，没有 `git init`。

## 4. ⚠ 敏感数据

`design-demos/bookmarks.data.js` 由用户的 Chrome 书签导出文件转换而来（296 条，12 个文件夹），含公司内网地址、本机服务地址等私人链接。控制台截图同样含书签内容，也不进仓库。

处理规则：

- 不进 Git 仓库（已在 `.gitignore`），不放进公开静态目录，不出现在公开主页或公开接口里。
- 正式版只通过需要登录的 `/api/private/bookmarks` 返回，数据文件放服务器私有目录。
- 用户没有要求删减或改分类，转换时内容原样保留。要改动先问用户。

## 5. 访问控制设计（P1 要实现）

```
浏览器 ── Caddy ──┬─ /、/blog、/lab、/login ─→ 公开静态文件
                 ├─ /console*、/api/private/* ─→ forward_auth → api 校验会话
                 │                                ├ 通过 → 私有静态文件 / api
                 │                                └ 失败 → 302 /login
                 └─ /api/* ─→ api:3000（AIHOT 缓存等公开接口）
```

- TOTP 符合 RFC 6238：30 秒一个码，6 位数字。密钥放 `.env` 的 `TOTP_SECRET`。校验时允许前后各 1 个时间窗；同一个码只能用一次，防止重放。
- 初始化脚本 `apps/api/scripts/init-totp` 负责三件事：
  - 生成密钥；
  - 在终端打印二维码，供 Google Authenticator 扫码；
  - 生成 10 个一次性恢复码。恢复码只保存哈希，明文只显示一次。
- 会话 Cookie 设为 `HttpOnly; Secure; SameSite=Strict`，有效期 30 天。会话存在 SQLite 里，可以一条命令作废全部会话。
- 限流：
  - 同一 IP 连续失败 5 次，锁定 15 分钟；
  - 全局每小时失败超过 30 次，暂停登录 1 小时。
- 只有一个验证因素，6 位码能挡住攻击全靠限流，所以**限流必须做**。
- 登录页和控制台都加 `noindex`。

## 6. AIHOT 接入要点

- 接口是匿名只读的，不需要 Key。只用 `/api/v1/*`，旧接口 `/api/public/*` 将于 2026-10-31 停止服务。
- 热点榜 `GET https://aihot.news/api/v1/hot-topics` 返回的 `items[]` 字段有：`rank`、`title`、`sourceCount`、`links.aihot`、`links.original`、`latestAt`。原型用的是 `links.aihot`。
- 由后端每 10 分钟拉一次。请求带 `Accept-Encoding: gzip` 和 `If-None-Match`，内容没变时对方返回 304；遇到 429 时按 `Retry-After` 等待。浏览器不直连 AIHOT。
- 使用规则（<https://aihot.news/terms>）：
  - 个人非商业使用免费，不用申请；
  - 页面要保留来源标注和链接；
  - 不做镜像站；
  - 缓存最多保留 7 天；
  - 网站一旦商业化，要先申请书面授权。

## 7. 下一步

### 用户要做的（不阻塞编码）
- [ ] 在腾讯云控制台提交 ICP 备案。个人备案的网站名称不要用"导航""平台"等字样，可以用"航点 · zreo 的个人主页"。整个流程 1～3 周，是最长的一步。
- [ ] 服务器装 Ubuntu 24.04，改成 SSH 密钥登录，安装 Docker，开启自动快照。
- [ ] 稍后提供：简历内容、一句话介绍、头像、联系方式、具体域名（用户说"后面再说"）。

### P1 编码（建议顺序）
1. `git init`，建 pnpm workspace，包括 `apps/web`（Astro）和 `apps/api`（Hono）。
2. 把 `design-demos/theme.css`、`theme.js` 迁到 Astro，防闪烁的内联脚本放进 `<head>`。
3. 把公开主页 `site.html` 拆成 Astro 组件。
4. 后端：TOTP 登录、会话、限流、`/auth/check`（给 forward_auth 用），加上 `init-totp` 脚本。
5. 后端：AIHOT 定时拉取和缓存，提供 `GET /api/hot` 接口，最多返回 10 条。
6. 后端：`import-bookmarks` 脚本，把 Chrome 导出的 HTML 转成私有 JSON；再提供 `GET /api/private/bookmarks`。转换逻辑可以参考本次用的 Python 解析（Netscape 书签格式：`H3` 是文件夹，`A` 是链接，`DL` 表示嵌套）。
7. 控制台页面改成从接口取数据，单独构建到私有目录。
8. 编写 Caddyfile 和 docker-compose.yml，先在服务器上用 IP 访问验证。
9. GitHub Actions：构建完成后用 rsync 把产物推到服务器。

### 验收标准
- 未登录访问 `/console` 和 `/api/private/bookmarks` 都会跳到登录页或返回 401，页面源码里看不到任何书签。
- 输错 5 次验证码后，该 IP 被锁定。
- 首屏压缩后小于 200 KB。两个主题在 1440 和 375 宽度下都没有横向溢出。

## 8. 项目名

暂定 **航点 / Waypoint**。航点是航线上的一个个标记点。这个站本身是起点（导航），途中会经过博客和试验场这些点，名字也和"蓝图"主题的工程图、坐标气质相合。英文可以用作仓库名和 Logo 字母 `W`。

备选：

| 中文 | 英文 | 含义 |
| --- | --- | --- |
| 拾光台 | Lumen Desk | 收集亮光的工作台，偏温和 |
| 栖站 | Nook | 网络角落里自己的小站，偏私人 |
| 白昼与图纸 | DayPrint | 对应白纸、蓝图两套主题，有点俏皮 |

名字定了之后，需要同步改：`<title>`、品牌标识（现在是 `z` + zreo）、TOTP 发行方名称（Authenticator 里显示的名字），以及仓库名。

## 9. 本地查看原型

用浏览器直接打开 `design-demos/site.html`，从页脚的「🔒 控制台」进入登录页，随便输入 6 位数字就会进入控制台。URL 加 `?theme=paper` 或 `?theme=blueprint` 可以强制使用某个主题。
