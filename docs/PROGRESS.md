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
| P0 准备 | 1 / 6 | 服务器和域名已有；备案、初始化、COS、内容未完成 |
| P1 MVP | 9 / 9 | 全部完成 |
| P1.5 上线加固 | 0 / 10 | |
| P2 博客 | 0 / 9 | |
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

## 4. 待确认问题

请逐条回复。括号里是我的建议。

1. **项目名和标识**：中文名用「拾光台」吗？页面左上角现在是字母 `z` + `zreo`，要不要换成 `L` + Lumen Desk，还是保留个人名？（建议：公开主页保留 zreo，控制台和登录页用 Lumen Desk）
2. **域名**：具体域名是什么？控制台走同域名 `/console`，还是单独子域名如 `desk.域名`？（建议同域名，现在的配置就是这样）
3. **备案进度**：ICP 备案提交了吗？这决定 P1.5-3 什么时候能做。
4. **博客写作方式**：在仓库里写 MDX，push 后自动发布；还是要一个网页后台编辑器？（建议 MDX，不需要数据库和后台，安全面最小）
5. **博客评论**：要不要评论？要的话用 Waline 自托管。Giscus 依赖 GitHub，国内访问慢。（建议先不做）
6. **COS 和 CDN**：现在开通吗？会有少量费用。不开通的话博客图片只能压得很小放在服务器上。（建议写博客前开通）
7. **CI 自动部署**：开启 GitHub Actions 自动部署（要把服务器 SSH 私钥放进 GitHub Secrets），还是我写一个本地一键部署脚本？（建议先用本地脚本，稳定后再开 CI）
8. **数据备份**：需要定期备份 `data/` 到 COS 吗？里面是登录会话和书签，丢了可以重新 `init-totp` 和导入。（建议做，成本很低）
9. **服务器状态卡**：要显示宿主机真实指标和每月流量吗？流量要调腾讯云 API，需要一个只读的 API 密钥。（建议宿主机指标做，流量先不做）
10. **P4 增强项**：Umami 统计、Uptime Kuma 状态页、AIHOT 今日日报、天气、GitHub 热力图、控制台编辑书签，哪些要？（建议先做 Uptime Kuma 和今日日报）
11. **开源许可**：仓库是公开的，要不要加 LICENSE？（建议 MIT；内容如文章另用 CC BY-NC 4.0）
12. **公开主页内容**：简历、一句话介绍、头像、联系方式什么时候给？公开主页上要不要放邮箱？

## 5. 下一步

1. 用户回复第 4 节问题。
2. P1.5-1：服务器初始化完成后部署到 IP。
3. P1.5-5、P1.5-6、P1.5-8：不依赖备案，可以先做。
4. 开始 P2 博客（待问题 4、5、6 确认）。

## 6. 变更日志

| 日期 | 内容 |
| --- | --- |
| 2026-10-30 | 方案和原型定稿；建仓库并推送 |
| 2026-10-30 | P1 MVP 完成，本机 Docker 部署；安全审查修复 5 项 |
| 2026-10-30 | 新增 ROADMAP.md、PROGRESS.md、README.md、AGENTS.md |
