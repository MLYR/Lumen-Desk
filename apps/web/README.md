# apps/web

Lumen Desk 前端：Astro 静态站，样式是原型里的纯 CSS（`src/styles/theme.css`、`src/styles/console.css`），没有用 Tailwind。

## 开发

```sh
pnpm --filter web dev      # http://localhost:4321，/api 代理到 http://localhost:3000
```

控制台和登录页依赖 `apps/api`，没有后端时控制台会显示空态或错误态。

## 构建

```sh
pnpm --filter web build
```

| 输出 | 内容 | 部署位置 |
| --- | --- | --- |
| `dist/` | 公开文件：`/`、`/login`、`_astro/*` | `/srv/web/public` |
| `dist-private/` | 仅 `console/index.html` | `/srv/web/private`（Caddy `forward_auth` 之后） |

`astro build` 之后由 `scripts/split-private.mjs` 把 `dist/console` 移到 `dist-private/console`，并检查 `dist/console` 不存在、`dist-private/console/index.html` 存在，否则构建失败。

控制台的书签、AI 热点、服务器状态都在浏览器里运行时请求，构建产物不含这些数据。

`dist/_astro/` 里有控制台的 JS 和 CSS（不含私有数据），因为静态资源共用一个目录。
