# AGENTS.md

给在本仓库工作的编码代理看的说明。人类读者先看 `README.md`。

## 开始之前

1. 读 `docs/PROGRESS.md`：当前阶段、待确认问题、上一次做到哪。
2. 要做的任务在 `docs/ROADMAP.md` 里找编号，按它的验收标准做。
3. 设计决定和原因在 `docs/PLAN.md`；敏感数据规则在 `docs/HANDOFF.md` 第 4、5 节。
4. `PROGRESS.md` 第 4 节里还没确认的问题，不要自己替用户决定；做到相关任务时先问。

## 项目结构

- `apps/web`：Astro 7 静态站。页面在 `src/pages`，组件在 `src/components`，控制台逻辑在 `src/scripts/console/main.ts`，主题在 `src/styles/theme.css` 和 `src/scripts/theme.js`。
- `apps/api`：Hono + `node:sqlite`，TypeScript ESM，`tsc` 编译到 `dist/`。路由全在 `src/app.ts`；认证在 `src/auth/`；AIHOT 在 `src/sources/aihot.ts`；CLI 在 `src/cli/`。
- `deploy/`：Caddyfile、docker-compose.yml、`.env.example`。
- `design-demos/`：已定稿的 HTML 原型，是视觉的参照，不要在这里开发新功能。

## 命令

pnpm 没有全局安装时，用 `npx -y pnpm@10.18.0` 代替 `pnpm`。

```bash
pnpm install
pnpm test                    # api 测试（vitest）
pnpm build                   # api tsc + web astro build + split-private
pnpm --filter web dev        # 4321，/api 代理到 3000
pnpm --filter api dev        # 3000，读 apps/api/.env
```

改完代码，提交前至少跑 `pnpm test` 和 `pnpm build`。

## 硬性规则

### 私有数据

- 书签数据（`design-demos/bookmarks.data.js`、`apps/api/data/`、任何 `bookmarks.json`）、`.env`、TOTP 密钥、恢复码、`*.db`，**永远不进 Git**，也不能复制进测试、fixture、文档、提交信息或日志。
- 测试只用 `apps/api/test/fixtures/` 里的合成数据。
- 控制台截图（`design-demos/shots/navigator-*`、`bm-filter.png`）含书签，已 gitignore，不要提交新的控制台截图。
- 仓库是公开的。提交前检查 `git diff --cached`，确认没有内网地址、IP、密钥。
- 不要 `import` 或 `fetch` 原型里的 `bookmarks.data.js`。

### 访问控制

- 控制台页面只能出现在 `dist-private/`。新增私有页面时同步更新 `scripts/split-private.mjs` 和 Caddyfile 里的 `@console` 路由。
- 私有数据只能从 `/api/private/*` 返回，且 api 里也要校验会话（Caddy 之外的第二道检查）。
- 登录处理函数里，从锁定检查到记录失败之间不能有 `await`，否则并发请求能绕过限流。
- 页面上渲染任何外部数据（书签、AIHOT 标题）都要转义；链接只允许 http/https。
- 改了 Caddyfile 后，在本机 Docker 里验证未登录访问 `/console`、`/Console`、`//console`、`/console/index.html` 都会 302 到 `/login`。

### AIHOT

- 只用 `/api/v1/*`。浏览器不直连 aihot.news。
- 保留来源标注和 `links.aihot` 链接；缓存不超过 7 天；每次 200 响应全量替换（对方撤回的条目要消失）。
- 不做任何商业化相关的东西。

### 前端

- 首屏压缩后 ≤ 200 KB；不加载中文 Web 字体；不引入 UI 框架，除非 ROADMAP 里的任务明确需要。
- 样式用 CSS 变量，两个主题（`paper`、`blueprint`）都要检查，1440 和 375 宽度无横向溢出。
- 尊重 `prefers-reduced-motion`。
- 用户可见文字用简体中文。

### 后端

- 新接口要配 vitest 测试，用 `test/helpers.ts` 的 `setup()`（内存 SQLite、可控时钟）。
- 新环境变量同时加到 `apps/api/.env.example`、`deploy/.env.example` 和 `src/config.ts`。
- 生产镜像没有 `tsx`，CLI 在容器里用 `node dist/cli/<name>.js` 运行；新增 CLI 时在 `package.json` 加脚本，并更新 `deploy/README.md`。

## 文档维护

- 完成或改变任务时，更新 `docs/PROGRESS.md`（状态表、已完成、变更日志）。
- 方案层面的变化（技术选型、范围）写进 `docs/PLAN.md` 或 `docs/ROADMAP.md`，并在 PROGRESS 的「和原方案不同的地方」里记一行。
- 文档用简体中文，写具体的命令、路径、数字。

## 提交

- 提交信息用 `type: 中文说明`，type 取 `feat`、`fix`、`docs`、`chore`、`test`、`refactor`。
- 不要 force push，不要改已推送的历史。
- 推送到 `main` 会触发 CI；部署步骤只有仓库变量 `DEPLOY_ENABLED=true` 时才运行。
