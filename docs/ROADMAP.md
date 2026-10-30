# 拾光台 · 详细计划

版本：v1.0（2026-10-30）。整体方案和设计决定见 `PLAN.md`，当前完成情况见 `PROGRESS.md`。
本文按阶段拆成可执行的任务。每个任务写清楚做什么、产出什么、怎么验收。任务编号在 `PROGRESS.md` 里引用。

标记说明：👤 需要用户本人操作或提供信息；❓ 依赖 `PROGRESS.md` 第 4 节的待确认问题。

## 阶段总览

| 阶段 | 目标 | 状态 | 前置条件 |
| --- | --- | --- | --- |
| P0 准备 | 备案、服务器、外部服务 | 进行中 | 无 |
| P1 MVP | 公开主页、登录、控制台、部署流水线 | 代码完成，本机 Docker 已部署 | 无 |
| P1.5 上线加固 | 部署到腾讯云，切 HTTPS，补齐安全项 | 未开始 | 服务器初始化完成；切域名还要等 ICP 备案 |
| P2 博客 | 文章存 SQLite、在线写、导入 .md、RSS、搜索 | 完成（差第一篇文章） | 无 |
| P2.5 分类、标签、设置 | 分类和标签管理、个人资料、账号安全、控制台头像菜单 | 完成 | P2 |
| P3 试验场 | `/lab` 列表和单个实验页 | 未开始 | P2 的内容结构（可并行） |
| P4 增强 | 统计、状态页、日报、天气等 | 未开始 | ❓ 逐项确认要不要 |

## P0 准备（用户为主）

| 编号 | 任务 | 说明 | 验收 |
| --- | --- | --- | --- |
| P0-1 👤 | 提交 ICP 备案 | 腾讯云控制台「ICP 备案」，主体选个人。网站名称不能带"导航""平台"，建议"拾光台 · zreo 的个人主页"。1～3 周 | 拿到备案号 |
| P0-2 👤 | 公安联网备案 | 网站上线后 30 天内办理 | 拿到公安备案号，页脚放两个号 |
| P0-3 👤 | 服务器初始化 | Ubuntu 24.04；SSH 密钥登录，关密码和 root 登录，建部署用户；防火墙只开 22/80/443；2 GB swap；装 Docker 和 Compose 插件，配镜像加速 `mirror.ccs.tencentyun.com`；开自动安全更新和自动快照 | 能用密钥 SSH 登录，`docker run hello-world` 正常 |
| P0-4 👤 | 告知域名 | 用于 Caddy 的 `SITE_ADDRESS`、`SITE_URL` | 写进服务器 `.env` |
| ~~P0-5~~ | ~~对象存储和 CDN~~ | 用户决定不用（2026-10-30）。图片放服务器本机，上传时压缩，见 P2-7 | — |
| P0-6 👤 | 提供公开主页内容 | 一句话介绍、简历、头像、联系方式 | 替换 `Intro.astro`、`Resume.astro` 里的占位 |

## P1 MVP（已完成，见 PROGRESS.md）

| 编号 | 任务 | 状态 |
| --- | --- | --- |
| P1-1 | pnpm workspace，`apps/web`、`apps/api` | ✅ |
| P1-2 | 主题系统迁到 Astro（白纸、蓝图、自动切换、防闪烁） | ✅ |
| P1-3 | 公开主页拆成 Astro 组件 | ✅（内容还是占位，见 P0-6） |
| P1-4 | TOTP 登录、恢复码、会话、限流、`/api/auth/check` | ✅ |
| P1-5 | AIHOT 热点定时拉取和缓存，`GET /api/hot` | ✅ |
| P1-6 | `import-bookmarks`，`GET /api/private/bookmarks` | ✅ |
| P1-7 | 控制台改为运行时取数，构建到私有目录 | ✅ |
| P1-8 | Caddyfile、docker-compose.yml | ✅ 本机 Docker 验证 |
| P1-9 | GitHub Actions：测试、构建、rsync 部署 | ✅ 构建通过；部署步骤待开启 |

## P1.5 上线加固

先用 IP 部署到服务器（不用等备案），备案下来后切域名和 HTTPS。

| 编号 | 任务 | 做法 | 验收 |
| --- | --- | --- | --- |
| P1.5-1 | 服务器首次部署 | 按 `deploy/README.md`：建 `/opt/lumen-desk`，`init-totp`，导入书签，`docker compose up -d` | 用 `http://服务器IP` 能打开主页，能登录控制台 |
| P1.5-2 | 开启 CI 自动部署（用户已确认用 GitHub Actions） | 仓库变量 `DEPLOY_ENABLED=true`；Secrets：`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`、`DEPLOY_KNOWN_HOSTS` | push 到 main 后服务器自动更新 |
| P1.5-3 | 切域名和 HTTPS | `.env` 里 `SITE_ADDRESS=域名`、`SITE_URL=https://域名`、`COOKIE_SECURE=true`；Caddy 自动签证书 | `https://域名` 证书有效，HTTP 自动跳 HTTPS，Cookie 带 `Secure` |
| P1.5-4 | Cookie 改用 `__Host-` 前缀 | `sessions.ts` 改名为 `__Host-ld_session`，浏览器会拒绝不带 `Secure` 的写入，配错时能立刻发现。只能在 HTTPS 上线时一起改 | 测试更新；HTTPS 下能登录 |
| P1.5-5 ✅ | 加 CSP 头 | Caddyfile 加 `Content-Security-Policy`：`default-src 'self'; script-src 'self' 'sha256-…'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`。Astro 的内联主题脚本要算 hash，或者改成外链脚本 | 三个页面在浏览器控制台没有 CSP 报错 |
| P1.5-6 ✅ | Actions 固定到 commit SHA | `deploy.yml` 里 `actions/*`、`pnpm/action-setup` 改成完整 SHA，注释写版本号 | workflow 通过 |
| P1.5-7 | 数据备份（暂缓） | 每天用 SQLite 在线备份把 `data/` 打包加密，保留 14 天。不用 COS 的话，目标可以是腾讯云轻量自动快照，或 rsync 回本机。博客上线后数据库里有文章，必须做 | 能从备份恢复出可登录的实例 |
| P1.5-8 ✅ | 日志轮转 | compose 里给两个服务加 `logging: max-size: 10m, max-file: 3` | `docker inspect` 能看到配置 |
| P1.5-9 | 页脚备案号 | 拿到号后填到 `Footer.astro`，ICP 链接到 `beian.miit.gov.cn` | 页面显示正确 |
| P1.5-10 | 服务器状态显示真实数据 | Linux 上容器读到的负载、内存（已改用 MemAvailable）、开机时长就是宿主机的值，`/data` 挂在宿主磁盘上，磁盘也是真实的。部署到服务器后对照 `free -h`、`df -h` 核对。每月流量包用量要调腾讯云 API（需要只读子账号密钥），单独做 | 控制台数字和 `free`、`df` 一致 |

## P2 博客

用户要求：**既能导入 md 文件，也能在线写**（2026-10-30）。不要评论。

### 方案

文章存在服务器上（SQLite），不放 Git 仓库。这样在线写的文章不用 push、不用重新构建就能发布。

```
控制台「写文章」（需登录）
  ├─ 在线编辑：左边写 Markdown，右边实时预览，可粘贴/拖入图片
  └─ 导入：拖入一个或多个 .md 文件，读取开头的 frontmatter（标题、日期、标签）
        ↓ POST /api/private/posts
      api 存进 SQLite（原文 Markdown + 渲染好的 HTML）
        ↓
公开访问 /blog、/blog/<slug>
  Caddy → api 读 SQLite，套上和主页一样的模板返回 HTML
```

- 渲染在保存时做一次（Markdown → HTML，代码高亮用 Shiki），访问时直接返回存好的 HTML，几乎不耗 CPU。
- 页面模板复用 `theme.css`，两套主题照常切换。
- 主页的「博客」卡片在浏览器里请求 `/api/posts?limit=3` 显示最新文章。
- 原方案「仓库里写 MDX、构建期生成」放弃，原因是在线写的文章没法进构建。

### 任务

| 编号 | 任务 | 做法 | 验收 |
| --- | --- | --- | --- |
| P2-1 ✅ | 文章数据表 | `posts`：slug、标题、摘要、标签、Markdown 原文、HTML、状态（草稿/发布）、发布时间、更新时间 | 迁移脚本可重复运行 |
| P2-2 ✅ | 渲染 | `marked`（或 `markdown-it`）+ Shiki 双主题；输出用 `sanitize-html` 白名单过滤，防止文章里的脚本 | 测试覆盖：`<script>`、`javascript:` 链接被去掉 |
| P2-3 ✅ | 私有接口 | `/api/private/posts` 增删改查、`/api/private/posts/import`（上传 .md，解析 frontmatter）、`/api/private/uploads`（图片） | vitest 覆盖；未登录 401 |
| P2-4 ✅ | 公开页面 | api 提供 `/blog`（按年份分组）、`/blog/<slug>`、`/blog/tags/<tag>` 的 HTML；Caddy 把这些路径转给 api；`Cache-Control` 短缓存 | 草稿不可见；两套主题、1440/375 无溢出 |
| P2-5 ✅ | 控制台编辑器 | 新页面 `/console/write`：文章列表、编辑、预览、发布/撤回、删除、导入 .md。编辑器用 `<textarea>` 加快捷键，不引入大型编辑器 | 编辑器页面压缩后 < 100 KB |
| P2-6 ✅ | 主页联动 | `BlogList.astro` 改成运行时请求最新 3 篇 | 主页显示真实文章 |
| P2-7 ✅ | 图片（不用对象存储） | 上传时在服务器上用 `sharp` 转 WebP，最长边 1600 px，目标 ≤ 150 KB；存 `data/uploads/`，Caddy 以 `/uploads/*` 提供并长缓存 | 单张图 ≤ 150 KB |
| P2-8 ✅ | RSS 和站点地图 | api 生成 `/rss.xml`、`/sitemap.xml`，排除 `/login`、`/console` | RSS 阅读器能订阅 |
| P2-9 ✅ | 搜索 | 文章不多时用 SQLite FTS5 做 `/api/search`；中文用 `trigram` 分词 | 搜中文关键词能命中 |
| P2-10 ✅ | 导出 | 一键把全部文章导出成 .md 压缩包，方便备份和迁移 | 导出再导入后内容一致 |
| P2-11 👤 | 第一篇文章 | 建议写本站搭建记录 | 上线 |

评论：用户确认不要。

## P2.5 分类、标签、个人资料、设置

用户 2026-10-30 确认。接口约定见 `docs/contracts/taxonomy-profile.md`。

| 编号 | 任务 | 做法 | 验收 |
| --- | --- | --- | --- |
| P2.5-1 ✅ | 分类、标签数据 | `categories`、`tags` 表，`posts.category_id`；内置 5 个分类、10 个标签，只在首次迁移时写入 | 老数据库能升级；删掉的内置项不会再出现 |
| P2.5-2 ✅ | 分类、标签接口 | 公开的列表和计数接口（草稿不计）；私有的增删改、排序、标签改名和合并；保存文章或导入时自动创建分类和标签 | vitest 覆盖，未登录访问返回 401 |
| P2.5-3 ✅ | 公开页面 | `/blog/` 分类筛选栏、`/blog/category/<slug>/`、`/blog/tags/` 总览、文章页显示分类、RSS 和 sitemap 带分类 | 两个主题、1440/375 宽度都没有横向溢出 |
| P2.5-4 ✅ | 个人资料 | `kv.profile`；头像裁成 256×256 WebP；`/api/profile` 公开；主页简介和控制台简介卡从接口读 | 改完资料刷新主页就能看到 |
| P2.5-5 ✅ | 账号安全 | 剩余恢复码、设备数、退出其他设备或所有设备、重新生成恢复码（需要当前验证码，并计入限流） | 验证码错 5 次被锁；旧恢复码作废 |
| P2.5-6 ✅ | 控制台头像菜单 | 右上角圆形头像，菜单里有设置、写文章、退出；支持键盘操作 | 375 宽度下可用 |
| P2.5-7 ✅ | 设置页 | `/console/settings` 三块：个人资料、分类和标签、账号安全；构建到 `dist-private` | 未登录访问 302 到 `/login` |
| P2.5-8 ✅ | 写文章页 | 分类下拉框（可以新建）、标签自动补全 | 新名字保存后出现在设置页 |

## P3 试验场

| 编号 | 任务 | 做法 | 验收 |
| --- | --- | --- | --- |
| P3-1 | 内容模型 | `src/content/lab/*.md` 存元数据（名称、简介、技术、状态、封面），每个实验一个 `src/pages/lab/[slug].astro` 或独立目录 | 新增实验只加文件 |
| P3-2 | 列表页 | `/lab` 卡片墙，主页 `LabList.astro` 改为取数据 | 主页卡片链接到真实页面 |
| P3-3 | 流场粒子 | 把现有 `flowfield.ts` 做成第一个完整实验页，加参数面板 | 页面可交互，减少动态效果时停止动画 |
| P3-4 | 资源规则 | 不用 CDN，所以单个实验的资源总量控制在 1 MB 内，按需加载；列表页不加载任何实验脚本 | 列表页首屏 ≤ 200 KB |
| P3-5 | 后续实验 | WebGPU 粒子、WASM 图片压缩（原型里的两个计划项） | 按兴趣排期 |

## P4 增强（逐项确认）

| 编号 | 任务 | 资源占用 | 说明 |
| --- | --- | --- | --- |
| P4-1 ✅ | Umami 访问统计 | 约 300 MB 内存（含 Postgres） | 看每天多少人访问、看了哪些页面、从哪来；只有自己能看后台。可以放在 `/stats` 路径下，不用子域名 |
| P4-2 ✅ | Uptime Kuma 状态页 | 约 100 MB | 每分钟检查网站和接口能不能打开，挂了发通知（邮件、微信、Telegram 等）。注意：装在同一台服务器上，整台机器宕机时它也一起挂 |
| P4-3 ❓ | AIHOT 今日日报 | 很小 | 控制台加日报入口，接口 `GET /api/v1/dailies/latest` |
| P4-4 ❓ | 天气小组件 | 很小 | 和风天气免费版，需要 Key；原型里没有 |
| P4-5 ❓ | GitHub 贡献热力图 | 很小 | 公开主页或控制台，后端定时拉 GitHub GraphQL，需要 Token |
| P4-6 ❓ | 控制台内编辑书签 | 中等 | 现在只能重新导出导入 |
| P4-7 | 控制台脚本私有化 | 很小 | 把控制台 JS/CSS 打包进 `dist-private`，公开目录不出现私有接口路径 |

## 不做的事

- 网盘、视频站、图床、公共下载站：3 Mbps 带宽撑不住。
- 本地大模型：4 GB 内存不够。
- 商业化（广告、收费、赞助）：AIHOT 个人免费授权不允许，商业化前需要书面授权。

## 约束（所有阶段都要守住）

- 首屏压缩后 ≤ 200 KB，不加载中文 Web 字体。
- 不使用对象存储和 CDN（用户决定），所有资源都走服务器的 3 Mbps 带宽，图片必须压缩。
- 两个主题在 1440 和 375 宽度下无横向溢出。
- 书签、TOTP 密钥、恢复码、`.env`、`data/` 永不进 Git。
- AIHOT 内容保留来源标注和原文链接，缓存不超过 7 天。
