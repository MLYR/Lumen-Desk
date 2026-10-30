# 拾光台 Lumen Desk · 个人站方案（v0.3，2026-10-30）

> 本文记录整体方案和设计决定。分阶段任务和验收标准见 `ROADMAP.md`，当前进度和待确认问题见 `PROGRESS.md`。项目名已从暂定的「航点 Waypoint」改为「拾光台 Lumen Desk」；实际实现和本文的差异列在 `PROGRESS.md` 第 3 节。

## 1. 目标

一个域名下的个人站，分公开和私有两部分（详见 1.1）：公开主页放简历、博客、试验场；私人控制台放导航、AI 热点、收藏夹和服务器状态，只有自己能登录。

约束：腾讯云轻量应用服务器（上海），4 核 4G、3 Mbps 带宽（约 375 KB/s），一年期。已有域名。

视觉：酷但克制。两套主题，默认「自动」：06:00–18:00 用白纸，其余时间用蓝图，也可手动固定。

| 主题 | 时段 | 要点 |
| --- | --- | --- |
| 白纸 paper | 白天 | 浅色，去掉卡片外框，黑线分栏，大号时钟，朱红点缀 |
| 蓝图 blueprint | 夜间 | 深蓝细网格背景，直角，卡片四角标记，等宽字体，琥珀点缀 |

控制台布局（从上到下）：时间 + 搜索（默认 Bing）｜个人简介 + AI 热点滚动（AIHOT 热点榜 Top 10，点击跳转 AIHOT）｜收藏夹（来自 Chrome 书签，固定高度内部滚动，文件夹导航 + 筛选）｜服务器 + 博客 + 试验场。

实现方式：所有主题共用一套 HTML 结构，靠 `html[data-theme]` 切换 CSS 变量（颜色、圆角、字体）和少量结构样式。选择存在 localStorage，也可用 `?theme=` 指定；切换用 View Transitions 过渡。新增主题只需加一组变量。

- 首页首屏传输量控制在 **200 KB（压缩后）以内**。
- 不在页面里加载中文 Web 字体，中文用系统字体，英文/等宽字体做子集化。
- 大文件（图片、3D 模型、视频）放对象存储 + CDN，不走服务器带宽。
- 全部配置进 Git，Docker Compose 部署，到期迁移只需换机器重跑。

## 1.1 公开与私有（2026-10-30 定）

| 区域 | 路径 | 谁能看 | 内容 |
| --- | --- | --- | --- |
| 公开主页 | `/` | 所有人，允许搜索引擎收录 | 一句话介绍、简历、博客列表、试验场列表 |
| 博客 | `/blog/*` | 所有人 | 文章、RSS |
| 试验场 | `/lab/*` | 所有人 | 每个实验一个页面 |
| 登录 | `/login` | 所有人（noindex） | Google Authenticator 6 位验证码 |
| 私人控制台 | `/console` | 仅自己（noindex） | 时间搜索、简介、AI 热点、收藏夹、服务器状态、博客/试验场入口 |
| 私有接口 | `/api/private/*` | 仅自己 | 书签、服务器指标 |

访问控制方案：

- 只用 Google Authenticator 验证码登录（TOTP，RFC 6238，30 秒一个 6 位码），不设密码。TOTP 密钥存在服务器 `.env` 的 `TOTP_SECRET`，用 `otpauth` 库校验，允许前后各 1 个时间窗。同一个码用过后作废，防重放。
- 首次部署时运行初始化脚本生成密钥和二维码，用 Google Authenticator 扫码；同时生成 10 个一次性恢复码，离线保存，手机丢了靠它登录。
- 成功后下发会话 Cookie：`HttpOnly; Secure; SameSite=Strict`，有效期 30 天；会话存 SQLite，可在服务器上一键作废全部会话。
- 只有验证码一个因素，6 位数字靠限流防暴力尝试，所以限流必须做（见下一条），这一点不能省。
- Caddy 对 `/console*` 和 `/api/private/*` 用 `forward_auth` 先问后端，未登录跳转 `/login`。控制台页面和书签数据都不进公开静态目录，未登录拿不到。
- 登录接口限流：同一 IP 连续失败 5 次锁定 15 分钟；全局每小时失败超过 30 次时暂停登录 1 小时并记日志。
- 书签数据含公司内网地址，只存在服务器的私有目录，不进 Git 仓库（已加 `.gitignore`）。
- 备选：如果以后只想从自己的设备访问，可以改用 Tailscale 把控制台放在内网，彻底不暴露在公网。

原型文件：`design-demos/site.html`（公开主页）、`login.html`、`navigator.html`（控制台）、共享 `theme.css` / `theme.js`。

## 2. 技术选型

| 层 | 选择 | 理由 |
| --- | --- | --- |
| 前端框架 | **Astro**（最新稳定版） | 默认输出静态 HTML，零 JS；需要交互的组件按"岛"加载；内置 Content Collections 适合博客 |
| 交互组件 | React（或 Svelte）岛 | 命令面板、小组件、试验场 demo |
| 样式 | Tailwind CSS v4 | 体积小，主题变量好管 |
| 动效 | CSS 动画 + View Transitions；重动效只在 `/lab` 内用 | 首页保持轻量 |
| 博客 | MDX + Shiki 代码高亮 + Pagefind 搜索 | 全部构建期生成，无需数据库 |
| 后端 API | **Hono**（Node.js LTS）+ SQLite | 代理并缓存 AIHOT、天气等外部数据，体积小，内存占用几十 MB |
| 定时任务 | 后端进程内调度（node-cron / croner） | 不需要单独的队列服务 |
| 网关 | **Caddy** | 自动 HTTPS，静态文件 + 反向代理，开 zstd/gzip 压缩 |
| 部署 | Docker Compose | `caddy` + `api` 两个容器起步 |
| CI/CD | GitHub Actions 构建 → 产物 rsync 到服务器 | 服务器不承担构建；国内拉 GitHub 慢，所以传构建产物 |
| 包管理 | pnpm workspace | 前后端同仓 |
| 统计（可选） | Umami 自托管 | 后期加 |

## 3. AIHOT 接入

### 3.1 接口（已验证可访问，2026-10-30）

AIHOT 提供匿名只读接口，无需 API Key。入口说明：<https://aihot.news/llms.txt>，规范：<https://aihot.news/openapi-v1.json>。

| 用途 | 接口 | 拉取节奏 |
| --- | --- | --- |
| 今日日报 | `GET /api/v1/dailies/latest` | 每天 08:00（北京时间）后拉一次，之后带 ETag 校验 |
| 热点榜 Top 10 | `GET /api/v1/hot-topics` | 每 10 分钟 |
| 最新精选 | `GET /api/v1/items?mode=selected&window=24h` | 每 10～30 分钟 |
| 事件详情 | `GET /api/v1/stories/{publicId}` | 用户点击时按需拉，publicId 只取自热点榜返回 |
| 备用 | `/feed.xml`、`/feed/daily.xml`（RSS） | 每 30 分钟 |

注意：旧接口 `/api/public/*` 将于 2026-10-31 停止服务，只用 `/api/v1/*`。

### 3.2 接入方式

浏览器不直接请求 AIHOT，由自己的后端统一拉取：

```
浏览器 → Caddy → api(Hono) → SQLite 缓存
                    ↑ 定时任务（带 ETag、gzip、遵守 429 Retry-After）
                 aihot.news/api/v1
```

- 所有请求带 `Accept-Encoding: gzip, br` 和 `If-None-Match`，内容未变时对方返回 304。
- 设置能识别的 User-Agent，例如 `zreo-homepage/1.0 (+https://你的域名)`。
- 单 IP 限制约 60 次/分钟，我们的用量远低于此。

### 3.3 使用规则（摘自 <https://aihot.news/terms>，2026-09-30 版）

- 个人非商业使用免费，无需申请。前提：**不收费、不放广告、不接赞助、不导流获客**。
- 不做公开镜像或换皮站。导航站展示摘要 + 链接回 AIHOT 和原文，不复刻全文。
- 保留响应里的 `attribution`、`links.aihot`、原文链接，页面上标注"来源：AIHOT"。
- 缓存只为运行服务：只保留近 7 天数据，不做历史数据库；对方撤回的条目要同步删除（每次全量刷新时以对方返回为准）。
- 以后若站点开始商业化，需先发邮件申请书面授权。

## 4. 仓库结构

```
AAA/
├── apps/
│   ├── web/                     # Astro 前端
│   │   ├── src/pages/           # /（公开主页）/blog /lab /login
│   │   ├── src/console/         # 控制台页面，单独构建到私有目录
│   │   ├── src/content/         # blog/*.mdx、lab 元数据
│   │   ├── src/styles/theme.css # 两套主题变量（来自原型）
│   │   └── src/components/      # 命令面板、热点滚动、收藏夹
│   └── api/                     # Hono 后端
│       ├── src/auth/            # TOTP 登录、会话、限流、forward_auth 校验
│       ├── src/sources/aihot.ts # AIHOT 拉取与缓存
│       ├── src/routes/private/  # 书签、服务器指标
│       └── scripts/             # init-totp、import-bookmarks
├── deploy/
│   ├── docker-compose.yml
│   ├── Caddyfile
│   └── .env.example             # 密钥只放服务器上的 .env
├── design-demos/                # 已定稿的 HTML 原型
├── .github/workflows/deploy.yml
└── docs/                        # PLAN.md、HANDOFF.md
```

## 5. 服务器部署拓扑

```
:443 Caddy
├── example.com/                → /srv/web/public（公开静态页）
├── example.com/login         → /srv/web/public/login
├── example.com/console*      → forward_auth(api) → /srv/web/private
├── example.com/api/private/* → forward_auth(api) → api:3000
├── example.com/api/*         → api:3000
└── stats.example.com     → umami（后期）
```

内存预算：Caddy ~30 MB、API ~80 MB、Umami + Postgres ~300 MB，4G 绰绰有余。

## 6. 前期准备清单

### 6.1 账号与合规（越早越好，备案耗时最长）

- [x] 服务器：腾讯云轻量，上海（内地机房，必须备案）
- [x] 域名：已有
- [ ] 确认域名已实名认证，后缀在工信部可备案名单内（.com/.cn/.net 等常见后缀都可以）
- [ ] 在腾讯云控制台「ICP 备案」提交，备案主体选个人，接入商选腾讯云（通常 1～3 周；域名不在腾讯云注册也能备案）
- [ ] 个人备案的网站名称不能带"导航""博客平台"等经营或门户性质字样，建议填"xx 的个人主页"或"xx 技术笔记"
- [ ] 网站上线后 30 天内办理**公安联网备案**，页脚放两个备案号
- [ ] 备案下来之前用 IP + 端口访问开发，不绑定域名

### 6.2 服务器初始化

- [ ] 系统选 Ubuntu 24.04 LTS 或 Debian 12
- [ ] 配置 SSH 密钥登录，关闭密码登录和 root 直登，新建部署用户
- [ ] 防火墙只开 22、80、443（控制台安全组 + ufw）
- [ ] 加 2 GB swap
- [ ] 安装 Docker + Compose 插件，配置国内镜像加速
- [ ] 开启自动安全更新（unattended-upgrades）
- [ ] 控制台设置自动快照

### 6.3 外部服务

- [ ] 腾讯云 COS（上海地域）+ CDN，放图片和试验场资源；CDN 加速域名也需要已备案
- [ ] 在轻量控制台查看套餐自带的月流量包额度，接近上限时及时处理
- [ ] 天气 API（和风天气免费版，需要 Key）
- [ ] GitHub 仓库 + Actions Secrets（服务器 SSH 私钥、主机地址）

### 6.4 本地开发环境

- [ ] Node.js LTS、pnpm、Docker Desktop
- [ ] 初始化 pnpm workspace、Astro、Hono 骨架

## 7. 分阶段计划

| 阶段 | 内容 | 产出 |
| --- | --- | --- |
| P0 准备 | 第 6 节清单、视觉风格定稿 | 备案提交、服务器可 SSH、设计稿 |
| P1 MVP | 公开主页骨架 + 登录 + 控制台（搜索、AI 热点、收藏夹）+ 部署流水线 | IP 可访问，能登录控制台 |
| P2 博客 | MDX、RSS、Pagefind、文章页排版 | 第一篇文章 |
| P3 试验场 | `/lab` 列表页 + 第一个 demo | 第一个实验 |
| P4 增强 | Umami、Uptime Kuma 状态页、GitHub 贡献图、深色模式细节 | 按需 |

## 8. 待确认

完整的待确认问题列表见 `PROGRESS.md` 第 4 节。

1. 简历内容、一句话介绍、头像、联系方式（用户说后面再给）
2. ~~项目名~~：已定为拾光台 Lumen Desk
3. 公开主页的域名用哪个（已有域名，未告知具体名称）
