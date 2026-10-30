# 项目进度

更新日期：2026-10-30。任务编号对应 `ROADMAP.md`。完成或变更任务时更新本文。

## 1. 当前状态

- **阶段**：P1 代码完成，P1.5 未开始。
- **仓库**：<https://github.com/MLYR/Lumen-Desk>（公开），分支 `main`。
- **本机部署**：`~/lumen-desk/`，<http://localhost> 已运行（Caddy + api 两个容器），已导入 296 条书签、绑定 Google Authenticator。
- **服务器**：未部署。
- **备案**：未知（等用户反馈）。

| 阶段 | 完成度 | 说明 |
| --- | --- | --- |
| P0 准备 | 1 / 5 | 服务器和域名已有；备案未提交；COS 已取消 |
| P1 MVP | 9 / 9 | 全部完成 |
| P1.5 上线加固 | 0 / 10 | |
| P2 博客 | 0 / 11 | 方案改为文章存 SQLite，支持导入和在线写 |
| P3 试验场 | 0 / 5 | 主页上有一个流场粒子预览 |
| P4 增强 | 0 / 7 | 等确认 |

## 2. 已完成

### P1 MVP（2026-10-30）

- **前端 `apps/web`**：Astro 7，纯静态输出。页面 `/`、`/login`、`/console`。构建后 `scripts/split-private.mjs` 把控制台移到 `dist-private/`。首屏压缩后：主页 HTML 3.9 KB、控制台 HTML 3.3 KB，CSS/JS 合计约 9 KB。
- **后端 `apps/api`**：Hono + `node:sqlite`（无原生依赖）。
  - 接口：`/api/auth/login`、`/api/auth/logout`、`/api/auth/check`、`/api/hot`、`/api/private/bookmarks`、`/api/private/server`、`/api/healthz`。
  - CLI：`init-totp`、`import-bookmarks`、`revoke-sessions`、`unlock-logins`。
  - 19 个 vitest 测试，覆盖登录、防重放、限流、恢复码、私有接口、书签解析、AIHOT 缓存。
- **部署 `deploy/`**：Caddyfile（`forward_auth` 保护 `/console*` 和 `/api/private/*`）、docker-compose.yml、`.env.example`、部署说明。
- **CI**：`.github/workflows/deploy.yml`，测试和构建在 GitHub 上通过；部署步骤要设置 `DEPLOY_ENABLED=true` 才运行。

### 验证记录

- 本机 Docker：未登录访问 `/console`（含 `/Console`、`//console`、`/x/../console`、`%2F`）一律 302 到 `/login`；私有接口 401；登录后书签和服务器指标正常。
- 20 个并发错误码：4 个 401，其余 429，伪造 `X-Forwarded-For` 无效。
- 构建产物和仓库中搜不到书签里的内网地址。

### 安全审查后修复

- 登录接口：锁定检查、校验、记录失败放在同一段同步代码里，修复并发请求绕过限流。
- 登录只接受 `application/json`，防止别的网站用表单替访客提交错误码。
- 全站暂停登录期间恢复码仍可用；新增 `unlock-logins`。
- 书签链接只允许 http/https（原来的黑名单能被 `java\tscript:` 绕过）。
- Caddy 登录跳转写法错误导致未登录能打开控制台页面，已修。

## 3. 和原方案不同的地方

| 原方案 | 实际 | 原因 |
| --- | --- | --- |
| 项目名「航点 Waypoint」 | 「拾光台 Lumen Desk」 | 用户用这个名字建了仓库 |
| Tailwind v4 | 纯 CSS | 原型是纯 CSS，直接迁移最保真，体积也更小 |
| React 岛 | 原生 `<script>` | 目前交互都很简单，不需要框架 |
| SQLite（better-sqlite3） | Node 自带 `node:sqlite` | 无原生编译依赖，镜像更简单；需要 Node ≥ 22.13，启动时会打一条 experimental 警告 |
| 服务器状态卡显示带宽 | 显示 CPU、内存、磁盘、负载、运行时长 | 带宽没有现成数据源，见 P1.5-10 |
| 博客用 MDX，构建期生成 | 文章存 SQLite，api 渲染 | 用户要在线写，在线写的文章进不了构建 |
| 图片和大资源放 COS + CDN | 放服务器本机，上传时压缩 | 用户不想用对象存储 |

## 4. 决定和待确认问题

### 已确认（2026-10-30）

| # | 问题 | 决定 | 落到哪里 |
| --- | --- | --- | --- |
| 1 | 项目名 | **拾光台**。页面标题已改；左上角标识保留 `z` + zreo | 已改 `pages/*.astro` |
| 2 | 控制台地址 | 同域名 `/console` | 现有配置不变 |
| 3 | ICP 备案 | **还没提交** | P0-1，越早越好 |
| 4 | 博客写作 | 既能导入 .md，也能在控制台在线写 | ROADMAP P2 改为文章存 SQLite + 在线编辑器 |
| 5 | 评论 | 不要 | P2 去掉评论 |
| 6 | 对象存储 / CDN | 不用 | P0-5 取消；图片上传时压缩，存服务器（P2-7） |
| 9 | 服务器状态 | 显示真实数据 | 内存已改用 MemAvailable；部署后核对（P1.5-10） |
| 11 | 许可 | 代码 MIT，文章 CC BY-NC 4.0 | 已加 `LICENSE`，README 写明 |
| 12 | 主页内容 | 之后提供，先用占位 | P0-6 |

### 还要确认

7. **自动部署**：流程已向用户解释，等用户决定用 GitHub Actions 自动部署，还是先用本地一键脚本。
8. **数据备份**：暂定。博客上线后文章存在数据库里，到时必须做（P1.5-7）。
10. **P4 增强项**：Umami 统计、Uptime Kuma 状态页已向用户解释，等用户决定要不要；AIHOT 今日日报、天气、GitHub 热力图、控制台编辑书签也待定。

## 5. 下一步

1. 用户提交 ICP 备案（P0-1）、初始化服务器（P0-3）。
2. 用户回复第 4 节剩下的问题 7、8、10。
3. 开始 P2 博客（方案已定，不依赖备案和服务器，可以先在本机 Docker 上做）。
4. P1.5-5（CSP）、P1.5-6（Actions 固定 SHA）、P1.5-8（日志轮转）不依赖备案，可以穿插做。

## 6. 变更日志

| 日期 | 内容 |
| --- | --- |
| 2026-10-30 | 方案和原型定稿；建仓库并推送 |
| 2026-10-30 | P1 MVP 完成，本机 Docker 部署；安全审查修复 5 项 |
| 2026-10-30 | 新增 ROADMAP.md、PROGRESS.md、README.md、AGENTS.md |
| 2026-10-30 | 用户确认 9 项：定名拾光台、不用 COS、博客支持在线写、不要评论、加 MIT 许可；服务器内存改读 MemAvailable |
