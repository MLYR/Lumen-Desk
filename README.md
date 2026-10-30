# 拾光台

zreo 的个人站：公开的主页、博客和技术试验场，加一个只有自己能登录的私人控制台（搜索、AI 热点、收藏夹、服务器状态）。

部署在一台腾讯云轻量服务器上（4 核 4G、3 Mbps），所以页面做得很轻：首屏压缩后不到 20 KB，不加载 Web 字体。

## 页面

| 路径 | 谁能看 | 内容 |
| --- | --- | --- |
| `/` | 所有人 | 一句话介绍、简历、博客、试验场 |
| `/login` | 所有人（noindex） | Google Authenticator 6 位验证码，或一次性恢复码 |
| `/console` | 仅本人 | 时间和搜索、个人简介、AI 热点滚动、收藏夹、服务器状态 |

两套主题：白纸（06:00–18:00）和蓝图（夜间），默认按时间自动切换，也可以手动固定，或用 `?theme=paper` / `?theme=blueprint` 指定。

## 技术栈

- **前端** `apps/web`：Astro 7 静态输出，纯 CSS，原生脚本。
- **后端** `apps/api`：Hono + Node 自带的 `node:sqlite`，负责 TOTP 登录、会话、限流、AIHOT 缓存、私有书签。
- **网关** `deploy/Caddyfile`：Caddy，`forward_auth` 保护控制台和私有接口，自动 HTTPS。
- **部署**：Docker Compose 两个容器（caddy、api），GitHub Actions 构建后 rsync 到服务器。

```
浏览器 ── Caddy ──┬─ /、/login、/_astro ─→ 公开静态文件
                 ├─ /console*        ─→ forward_auth ─→ 私有静态文件（失败 302 /login）
                 ├─ /api/private/*   ─→ forward_auth ─→ api（失败 401）
                 └─ /api/*           ─→ api ── SQLite
                                           └─ 每 10 分钟拉取 aihot.news
```

## 本地开发

需要 Node ≥ 22.13 和 pnpm 10（没装可以用 `npx pnpm@10.18.0` 代替 `pnpm`）。

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # 本地把 COOKIE_SECURE 改成 false
pnpm --filter api init-totp                 # 打印二维码和恢复码，把 TOTP_SECRET 填进 apps/api/.env
pnpm --filter api import-bookmarks ~/Downloads/bookmarks.html   # 可选，写到 apps/api/data/

pnpm dev:api     # http://localhost:3000
pnpm dev:web     # http://localhost:4321，/api 代理到 3000
```

常用命令：

```bash
pnpm test                   # api 的 vitest 测试
pnpm build                  # 构建 api 和 web
pnpm --filter api revoke-sessions   # 作废所有登录
pnpm --filter api unlock-logins     # 解除登录锁定
```

web 构建产物：`apps/web/dist/`（公开）和 `apps/web/dist-private/`（控制台）。

## 部署

本机 Docker 或服务器部署见 [`deploy/README.md`](deploy/README.md)。

## 目录

```
apps/web/        Astro 前端（页面、组件、主题、控制台脚本）
apps/api/        Hono 后端（src/auth、src/sources/aihot.ts、src/cli、test）
deploy/          Caddyfile、docker-compose.yml、.env.example、部署说明
design-demos/    已定稿的 HTML 原型，浏览器直接打开
docs/            方案、计划、进度、交接文档
.github/         CI/CD
```

## 文档

| 文件 | 内容 |
| --- | --- |
| [`docs/PLAN.md`](docs/PLAN.md) | 整体方案和设计决定 |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | 分阶段详细计划和验收标准 |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | 当前进度、待确认问题、变更日志 |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | 接手须知：敏感数据规则、访问控制、AIHOT 规则 |

## 隐私

书签（含公司内网地址）、TOTP 密钥、恢复码、`.env` 和 `data/` 都不进仓库。书签只通过登录后的 `/api/private/bookmarks` 返回。

## 数据来源

AI 热点来自 [AIHOT](https://aihot.news)，按其[使用规则](https://aihot.news/terms)个人非商业使用：保留来源和原文链接，缓存不超过 7 天，不做镜像。

## 许可

代码使用 [MIT](LICENSE) 许可。博客文章等内容使用 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/deed.zh-hans)：可以转载，需要署名，不能商用。
