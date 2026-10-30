# 博客与统计监控：接口约定（P2 / P4-1 / P4-2）

前后端和部署三方都按本文实现。改约定先改本文。

## 1. 文章数据

```
Post {
  id: number
  slug: string            // [a-z0-9-]{1,80}，唯一；没给时由标题生成（中文标题用 pinyin 不做，直接用 `post-<id>` 或日期+序号）
  title: string           // 1–200 字
  summary: string         // 0–500 字；空时取正文前 120 字纯文本
  tags: string[]          // 每个 1–30 字，最多 10 个
  markdown: string        // 原文，≤ 1 MB
  html: string            // 保存时渲染好的正文 HTML（不返回给编辑器以外的人）
  status: 'draft' | 'published'
  publishedAt: string|null  // ISO；首次发布时写入，可在编辑器里改
  createdAt: string
  updatedAt: string
}
```

渲染规则：markdown-it（`html: false`，不允许原始 HTML）+ Shiki 双主题（`github-light` / `github-dark`，`defaultColor: false`，用 CSS 变量 `--shiki-light` / `--shiki-dark`）。链接只允许 `http:`、`https:`、`mailto:`、站内相对路径和 `#`；外链加 `rel="noopener noreferrer" target="_blank"`。图片 `loading="lazy" decoding="async"`。最后用白名单再过滤一遍。

## 2. 公开接口（不需要登录）

| 方法 路径 | 返回 |
| --- | --- |
| `GET /api/posts?limit=10&tag=x` | `{items:[{slug,title,summary,tags,publishedAt}]}`，只含已发布，按 `publishedAt` 倒序；`limit` 1–50 |
| `GET /api/search?q=` | `{items:[{slug,title,snippet}]}`，SQLite FTS5 `trigram`，`q` 2–50 字，最多 20 条；`snippet` 是纯文本，前端自己转义 |
| `GET /blog`、`/blog/` | 列表页 HTML |
| `GET /blog/<slug>`、`/blog/<slug>/` | 文章页 HTML；草稿或不存在返回 404 HTML |
| `GET /blog/tags/<tag>` | 标签页 HTML |
| `GET /rss.xml` | RSS 2.0，最新 20 篇，正文用 summary |
| `GET /sitemap.xml` | `/`、`/blog/`、每篇文章；不含 `/login`、`/console` |
| `GET /uploads/<file>` | 由 Caddy 直接从 `data/uploads` 提供，api 不处理 |

HTML 页面 `Cache-Control: public, max-age=60`。

### HTML 外壳

页面外壳由 web 构建，api 只填内容，保证和主页同一套主题和样式。

- web 构建出 `apps/web/dist-shell/blog.html`（列表、标签、文章页共用一个外壳）。
- 外壳里有三个占位符，原样出现在 HTML 中：`{{LD_TITLE}}`（在 `<title>` 里）、`{{LD_DESCRIPTION}}`（`<meta name="description" content="...">` 里）、`{{LD_CONTENT}}`（`<main>` 里）。
- api 从 `SHELL_DIR`（默认 `../web/dist-shell`，容器内 `/srv/shell`）读取，启动时缓存；文件不存在时用一个最简内置外壳兜底并打印警告。
- 标题、描述由 api 做 HTML 转义后替换。`{{LD_CONTENT}}` 替换为下面的片段。

### 内容片段（api 生成，web 负责样式）

文章页：

```html
<article class="post">
  <header class="post-head">
    <a class="back" href="/blog/">← 全部文章</a>
    <h1 class="post-title">标题</h1>
    <div class="post-meta"><time datetime="2026-10-30">2026-10-30</time><a class="tag" href="/blog/tags/部署/">部署</a></div>
  </header>
  <div class="prose">…渲染后的正文…</div>
</article>
```

列表页 / 标签页：

```html
<section class="post-index">
  <h1 class="page-title">博客</h1>            <!-- 标签页：标签 · 部署 -->
  <div class="year-group">
    <h2 class="year">2026</h2>
    <ul class="post-list">
      <li><a href="/blog/slug/"><span class="d">10-30</span><div><div class="t">标题</div><div class="s">摘要</div></div><span class="tags">部署 · 前端</span></a></li>
    </ul>
  </div>
  <p class="empty">还没有文章。</p>       <!-- 只在没有文章时出现 -->
</section>
```

外壳里放一个搜索框（`#blog-search`）和结果容器（`#blog-search-results`），脚本调用 `/api/search`。

## 3. 私有接口（需要登录，`/api/private/*`）

所有写请求：只接受 `application/json` 或 `multipart/form-data`，如果带 `Origin` 头，必须等于 `SITE_URL` 的 origin 或请求自身的 Host，否则 403。

| 方法 路径 | 请求 | 返回 |
| --- | --- | --- |
| `GET /api/private/posts` | | `{items:[{id,slug,title,status,tags,publishedAt,updatedAt}]}`，含草稿，按 `updatedAt` 倒序 |
| `GET /api/private/posts/:id` | | 完整 Post（不含 `html`） |
| `POST /api/private/posts` | `{title, slug?, summary?, tags?, markdown, status, publishedAt?}` | 201 Post |
| `PUT /api/private/posts/:id` | 同上 | 200 Post |
| `DELETE /api/private/posts/:id` | | 204 |
| `POST /api/private/posts/import` | multipart，字段 `files`（可多个 `.md`，每个 ≤ 1 MB，最多 20 个） | `{imported:[{id,slug,title,status}], errors:[{file,error}]}` |
| `POST /api/private/preview` | `{markdown}` | `{html}` |
| `POST /api/private/uploads` | multipart，字段 `file`（jpg/png/webp/gif/avif，≤ 10 MB） | `{url:"/uploads/<sha256前16位>.webp", width, height, bytes}` |
| `GET /api/private/posts/export` | | `application/zip`，每篇一个 `<slug>.md`（带 frontmatter） |

导入的 frontmatter（YAML）：`title`、`slug`、`date`（→ publishedAt）、`tags`（数组或逗号分隔）、`summary`、`draft`（默认 true → 草稿；`draft: false` 或 `published: true` → 发布）。没有 `title` 时取第一个 `# 标题`，再没有就用文件名。

错误格式：`{error:'<code>', message?:string}`。常用：`400 invalid_request`、`404 not_found`、`409 slug_taken`、`413 payload_too_large`、`415 unsupported_media_type`、`403 bad_origin`。

图片处理：`sharp` 转 WebP，最长边 ≤ 1600 px，quality 从 80 往下试直到 ≤ 150 KB（最低 50）；去掉 EXIF；文件名是内容哈希，重复上传返回同一个 URL。写到 `DATA_DIR/uploads/`。

## 4. 部署相关

- api 新环境变量：`SHELL_DIR`（默认见上）。uploads 目录固定为 `DATA_DIR/uploads`。
- Caddy：`/blog`、`/blog/*`、`/rss.xml`、`/sitemap.xml` 转给 api；`/uploads/*` 从 `/srv/uploads` 直接提供，`Cache-Control: public, max-age=31536000, immutable`，`X-Content-Type-Options: nosniff`；`/api/private/uploads` 请求体上限 12 MB。
- 服务器目录：`web/shell/` 放 `dist-shell` 内容，挂到 api 容器 `/srv/shell:ro`；`data/uploads` 挂到 caddy `/srv/uploads:ro`。

## 5. Umami 和 Uptime Kuma

- Umami（访问统计）：`STATS_ADDRESS`，默认 `:8081`；备案后改成 `stats.域名`。数据库用单独的 Postgres 容器。
- Uptime Kuma（网站监控）：`STATUS_ADDRESS`，默认 `:8082`；备案后改成 `status.域名`。
- 公开页面（主页、博客外壳）在构建时读取 `PUBLIC_UMAMI_SRC`（如 `http://IP:8081/script.js`）和 `PUBLIC_UMAMI_WEBSITE_ID`，两个都有值才插入 `<script defer src=… data-website-id=…>`。登录页和控制台不插入。
