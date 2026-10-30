# 拾光台 Lumen Desk · 详细计划

版本：v1.0（2026-10-30）。整体方案和设计决定见 `PLAN.md`，当前完成情况见 `PROGRESS.md`。
本文按阶段拆成可执行的任务。每个任务写清楚做什么、产出什么、怎么验收。任务编号在 `PROGRESS.md` 里引用。

标记说明：👤 需要用户本人操作或提供信息；❓ 依赖 `PROGRESS.md` 第 4 节的待确认问题。

## 阶段总览

| 阶段 | 目标 | 状态 | 前置条件 |
| --- | --- | --- | --- |
| P0 准备 | 备案、服务器、外部服务 | 进行中 | 无 |
| P1 MVP | 公开主页、登录、控制台、部署流水线 | 代码完成，本机 Docker 已部署 | 无 |
| P1.5 上线加固 | 部署到腾讯云，切 HTTPS，补齐安全项 | 未开始 | 服务器初始化完成；切域名还要等 ICP 备案 |
| P2 博客 | MDX 文章、RSS、搜索 | 未开始 | ❓ 写作方式、评论 |
| P3 试验场 | `/lab` 列表和单个实验页 | 未开始 | P2 的内容结构（可并行） |
| P4 增强 | 统计、状态页、日报、天气等 | 未开始 | ❓ 逐项确认要不要 |

## P0 准备（用户为主）

| 编号 | 任务 | 说明 | 验收 |
| --- | --- | --- | --- |
| P0-1 👤 | 提交 ICP 备案 | 腾讯云控制台「ICP 备案」，主体选个人。网站名称不能带"导航""平台"，建议"拾光台 · zreo 的个人主页"。1～3 周 | 拿到备案号 |
| P0-2 👤 | 公安联网备案 | 网站上线后 30 天内办理 | 拿到公安备案号，页脚放两个号 |
| P0-3 👤 | 服务器初始化 | Ubuntu 24.04；SSH 密钥登录，关密码和 root 登录，建部署用户；防火墙只开 22/80/443；2 GB swap；装 Docker 和 Compose 插件，配镜像加速 `mirror.ccs.tencentyun.com`；开自动安全更新和自动快照 | 能用密钥 SSH 登录，`docker run hello-world` 正常 |
| P0-4 👤 | 告知域名 | 用于 Caddy 的 `SITE_ADDRESS`、`SITE_URL` | 写进服务器 `.env` |
| P0-5 👤❓ | 对象存储和 CDN | 腾讯云 COS（上海）加 CDN，存博客图片和试验场资源。CDN 加速域名也要备案 | 能通过 CDN 域名访问测试文件 |
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
| P1.5-2 ❓ | 开启 CI 自动部署 | 仓库变量 `DEPLOY_ENABLED=true`；Secrets：`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`、`DEPLOY_KNOWN_HOSTS` | push 到 main 后服务器自动更新 |
| P1.5-3 | 切域名和 HTTPS | `.env` 里 `SITE_ADDRESS=域名`、`SITE_URL=https://域名`、`COOKIE_SECURE=true`；Caddy 自动签证书 | `https://域名` 证书有效，HTTP 自动跳 HTTPS，Cookie 带 `Secure` |
| P1.5-4 | Cookie 改用 `__Host-` 前缀 | `sessions.ts` 改名为 `__Host-ld_session`，浏览器会拒绝不带 `Secure` 的写入，配错时能立刻发现。只能在 HTTPS 上线时一起改 | 测试更新；HTTPS 下能登录 |
| P1.5-5 | 加 CSP 头 | Caddyfile 加 `Content-Security-Policy`：`default-src 'self'; script-src 'self' 'sha256-…'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`。Astro 的内联主题脚本要算 hash，或者改成外链脚本 | 三个页面在浏览器控制台没有 CSP 报错 |
| P1.5-6 | Actions 固定到 commit SHA | `deploy.yml` 里 `actions/*`、`pnpm/action-setup` 改成完整 SHA，注释写版本号 | workflow 通过 |
| P1.5-7 | 数据备份 ❓ | 每天把 `data/lumen.db`（用 `sqlite3 .backup` 或复制前停写）和 `bookmarks.json` 打包，加密后传到 COS，保留 14 天 | 能从备份恢复出可登录的实例 |
| P1.5-8 | 日志轮转 | compose 里给两个服务加 `logging: max-size: 10m, max-file: 3` | `docker inspect` 能看到配置 |
| P1.5-9 | 页脚备案号 | 拿到号后填到 `Footer.astro`，ICP 链接到 `beian.miit.gov.cn` | 页面显示正确 |
| P1.5-10 | 服务器指标改成宿主机视角 ❓ | 现在读的是容器里的 `os` 和 `/data` 的磁盘。改为只读挂载宿主 `/proc` 或用 node_exporter；带宽流量包要调腾讯云 API | 控制台数字和 `htop`、`df` 一致 |

## P2 博客

| 编号 | 任务 | 做法 | 验收 |
| --- | --- | --- | --- |
| P2-1 | 内容模型 | Astro Content Collections，`src/content/blog/*.mdx`，frontmatter：`title`、`date`、`summary`、`tags`、`draft`、`cover?` | 类型检查能发现字段错误 |
| P2-2 | 文章页 | `/blog/[slug]`，沿用两套主题的排版；Shiki 代码高亮，主题跟着白纸/蓝图切换（双主题 CSS 变量） | 两套主题下代码块可读 |
| P2-3 | 列表页 | `/blog` 按年份分组，`/blog/tags/[tag]` | 草稿不出现在生产构建 |
| P2-4 | 主页联动 | `BlogList.astro` 改为取最新 3 篇，替换占位 | 主页显示真实文章 |
| P2-5 | RSS 和站点地图 | `@astrojs/rss` 生成 `/rss.xml`，`@astrojs/sitemap` 生成 sitemap，排除 `/login`、`/console` | RSS 阅读器能订阅 |
| P2-6 | 站内搜索 | Pagefind 构建期生成索引，只索引 `/blog` | 搜索中文关键词能命中 |
| P2-7 | 图片 | 文章图片放 COS/CDN，或用 Astro `<Image>` 构建期转 AVIF/WebP 并限宽 | 单张图 ≤ 150 KB |
| P2-8 ❓ | 评论 | 可选 Waline（自托管，需要一个小数据库）或不做 | 按确认结果 |
| P2-9 | 第一篇文章 👤 | 建议写本站搭建记录 | 上线 |

## P3 试验场

| 编号 | 任务 | 做法 | 验收 |
| --- | --- | --- | --- |
| P3-1 | 内容模型 | `src/content/lab/*.md` 存元数据（名称、简介、技术、状态、封面），每个实验一个 `src/pages/lab/[slug].astro` 或独立目录 | 新增实验只加文件 |
| P3-2 | 列表页 | `/lab` 卡片墙，主页 `LabList.astro` 改为取数据 | 主页卡片链接到真实页面 |
| P3-3 | 流场粒子 | 把现有 `flowfield.ts` 做成第一个完整实验页，加参数面板 | 页面可交互，减少动态效果时停止动画 |
| P3-4 | 资源规则 | 重资源（模型、WASM、纹理）放 CDN，页面按需加载，列表页不加载任何实验脚本 | 列表页首屏 ≤ 200 KB |
| P3-5 | 后续实验 | WebGPU 粒子、WASM 图片压缩（原型里的两个计划项） | 按兴趣排期 |

## P4 增强（逐项确认）

| 编号 | 任务 | 资源占用 | 说明 |
| --- | --- | --- | --- |
| P4-1 ❓ | Umami 访问统计 | 约 300 MB 内存（含 Postgres） | 子域名 `stats.域名`，需要备案域名 |
| P4-2 ❓ | Uptime Kuma 状态页 | 约 100 MB | 监控本站和其他服务 |
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
- 两个主题在 1440 和 375 宽度下无横向溢出。
- 书签、TOTP 密钥、恢复码、`.env`、`data/` 永不进 Git。
- AIHOT 内容保留来源标注和原文链接，缓存不超过 7 天。
