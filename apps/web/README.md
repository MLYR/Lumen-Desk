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
| `dist-private/` | 仅控制台：`console/index.html`、`console/write/index.html`（编辑器） | `/srv/web/private`（Caddy `forward_auth` 之后） |
| `dist-shell/` | 仅 `blog.html`：博客外壳，含 `{{LD_TITLE}}`、`{{LD_DESCRIPTION}}`、`{{LD_CONTENT}}` 三个占位符 | `web/shell/`，挂到 api 容器 `/srv/shell:ro`，由 api 填内容后返回，不直接对外提供 |

`astro build` 之后由 `scripts/split-private.mjs` 拆分：`dist/console` 移到 `dist-private/console`，`dist/blog/index.html` 移到 `dist-shell/blog.html`。脚本会断言：`dist/` 里没有 `console` 和 `blog`；`dist-private/console/index.html`、`dist-private/console/write/index.html` 存在；`dist-shell/blog.html` 里三个占位符各出现一次且位置正确（`<title>`、meta description 的 `content`、`<main>`），并含 `#blog-search`、`#blog-search-results`。任何一条不满足，构建失败。

## 博客

- 文章在服务器上（SQLite），由 api 渲染；`src/pages/blog.astro` 只是外壳，复用 Layout/Header/Footer，所以和主页同一套主题。
- 片段样式在 `src/styles/blog.css`（`.post`、`.prose`、`.post-list` 等，约定见 `docs/contracts/blog-api.md`），主页博客卡片、外壳和编辑器预览共用。
- 主页「博客」卡片在浏览器里请求 `/api/posts?limit=3`，失败时显示「还没有文章」。
- 编辑器是 `/console/write`（`src/pages/console/write.astro`、`src/scripts/console/write.ts`、`src/styles/write.css`），在 `dist-private/` 里，需要登录。

## Umami 统计

构建时读取 `PUBLIC_UMAMI_SRC` 和 `PUBLIC_UMAMI_WEBSITE_ID`（见 `.env.example`），两个都非空才在公开主页和博客外壳插入 `<script defer src=… data-website-id=…>`。`/login` 和 `/console*` 永远不插。

控制台的书签、AI 热点、服务器状态都在浏览器里运行时请求，构建产物不含这些数据。

`dist/_astro/` 里有控制台的 JS 和 CSS（不含私有数据），因为静态资源共用一个目录。
