# 分类、标签、个人资料、设置：接口约定（P2.5）

前后端都按本文实现。要改约定，先改本文。和 `blog-api.md` 冲突时，以本文为准。

## 0. 已确认的决定（用户，2026-10-30）

- 一篇文章只属于一个分类，可以不选（显示为「未分类」）。分类不分层级。
- 分类网址用英文 slug：`/blog/category/frontend/`。标签网址保持中文：`/blog/tags/部署/`。
- 分类和标签都内置一批常用项，也可以手动添加。写文章时输入新名字，保存时自动创建；也可以在设置页改名、删除、排序。
- 导入的 .md 里写了站上没有的分类时，自动新建这个分类。
- 控制台右上角放圆形头像，点开是菜单：设置、写文章、退出登录。
- 设置页 `/console/settings` 有三块：个人资料、分类和标签、账号安全。
- 个人资料同步到公开主页的简介、控制台的简介卡和头像。简历这类长内容先用占位。

## 1. 数据

```
Category { id, slug: [a-z0-9-]{1,40} 唯一, name: 1–20 字 唯一（不区分大小写）, description: 0–200 字, sort: int }
// 分类名、标签名、个人资料文字都不允许控制字符、零宽字符和双向控制字符（U+200B–200F、U+202A–202E、U+2060–2064、U+FEFF），且必须含可见字符；标签不能只由 . 组成
Tag      { name: 1–30 字 唯一（不区分大小写）, sort: int }
Post     增加 categoryId: number|null（删除分类时文章改为 null）
Profile  {
  name: 1–40 字,
  tagline: 0–80 字,     // 一句话介绍，主页大标题下面那段
  bio: 0–500 字,        // 控制台简介卡上的介绍
  avatar: string|null,  // "/uploads/<hash>.webp"
  facts: [{label: 1–10 字, value: 1–60 字}]，最多 6 条    // 主页右侧的「职业 / 坐标 / 在研究」
  links: [{label: 1–20 字, url: http/https/mailto}]，最多 6 条
}
```

- 分类存 `categories` 表。标签词表存 `tags` 表；文章仍用 `posts.tags` JSON 数组存标签名。保存文章时，不在词表里的标签自动加进去。
- 迁移要幂等。内置项只在第一次迁移时写入，用 `kv` 表里的 `taxonomy_seeded` 标记。用户删掉的内置项不会再出现。
- 内置分类：前端 `frontend`、后端 `backend`、部署运维 `devops`、AI `ai`、随笔 `notes`。
- 内置标签：Astro、TypeScript、Node.js、Docker、Linux、Caddy、SQLite、性能、工具、踩坑。
- 个人资料存 `kv.profile`（JSON）。默认值：`name` 为「zreo」，`tagline` 为主页现在的那段文案，`facts` 为主页现在右侧的 4 条。

## 2. 公开接口

| 方法 路径 | 返回 |
| --- | --- |
| `GET /api/profile` | `{name, tagline, bio, avatar, facts, links}`（这些字段本来就是公开的）。`Cache-Control: public, max-age=60` |
| `GET /api/categories` | `{items:[{slug,name,description,count}]}`，按 sort 排序。`count` 只计已发布文章。只列出有已发布文章的分类，以及没有任何文章的内置分类（count=0）。自己新建的分类在里面有文章发布之前都不公开，它的分类页返回 404，这样草稿的分类名不会泄露（2026-10-30 两轮安全审查后收紧） |
| `GET /api/tags` | `{items:[{name,count}]}`，只列出已发布文章里用到的标签，按 count 倒序 |
| `GET /api/posts?category=<slug>` | 在原接口上增加分类筛选，每条结果增加 `category:{slug,name}|null` |
| `GET /blog/category/<slug>[/]` | 分类页 HTML；分类不存在返回 404；分类存在但没有文章时显示「这个分类还没有文章」 |
| `GET /blog/tags/` | 标签总览页 HTML，按文章数排列 |

`/blog/` 列表页顶部加分类筛选栏。筛选栏只列有已发布文章的分类，在分类页里当前分类也列出。片段如下，样式由 web 负责：

```html
<nav class="cat-bar" aria-label="分类">
  <a href="/blog/" aria-current="page">全部 <span class="n">12</span></a>
  <a href="/blog/category/frontend/">前端 <span class="n">5</span></a>
</nav>
```

文章页的 `.post-meta` 在日期后面增加 `<a class="cat" href="/blog/category/frontend/">前端</a>`，标签放在它后面。RSS 每篇文章加一个 `<category>` 写分类名，排在标签前面；sitemap 加入分类页。

## 3. 私有接口（需要登录，写请求沿用 Origin 和 Content-Type 检查）

| 方法 路径 | 请求 | 返回 |
| --- | --- | --- |
| `GET /api/private/categories` | | `{items:[{id,slug,name,description,sort,count,draftCount}]}` |
| `POST /api/private/categories` | `{name, slug?, description?}` | 201 Category；没给 slug 时，ASCII 名字转 slug，中文名用 `cat-<n>`；名字或 slug 重复返回 409 `name_taken` / `slug_taken` |
| `PUT /api/private/categories/:id` | `{name?, slug?, description?}` | 200 Category |
| `DELETE /api/private/categories/:id` | | 204，文章的 `categoryId` 改为 null |
| `PUT /api/private/categories/order` | `{ids:[...]}`，必须正好是全部分类的 id | 204 |
| `GET /api/private/tags` | | `{items:[{name,sort,count,draftCount}]}`，含没被用到的词表项 |
| `POST /api/private/tags` | `{name}` | 201 |
| `PUT /api/private/tags/rename` | `{from, to}` | 200 `{updated:<文章数>}`。`to` 已存在时就是合并，同一篇文章里重复的标签去重 |
| `DELETE /api/private/tags/:name` | | 204，从所有文章里移除这个标签 |
| 文章增删改 | 请求体增加 `categoryId?: number|null` 或 `category?: string`（分类名，不存在时自动创建）；两个同时给时以 `categoryId` 为准 | Post 增加 `categoryId`、`category:{slug,name}|null` |
| 导入 `.md` | frontmatter 支持 `category`（名字），不存在时自动创建 | |
| 导出 | frontmatter 写 `category: 分类名` | |
| `GET /api/private/profile` | | Profile |
| `PUT /api/private/profile` | Profile（不含 avatar） | 200 Profile |
| `POST /api/private/profile/avatar` | multipart `file` | `{avatar:"/uploads/<hash>.webp"}`。服务端居中裁成正方形，输出 256×256 WebP，≤ 50 KB；规则同图片上传 |
| `DELETE /api/private/profile/avatar` | | 204，恢复为首字母头像 |
| `GET /api/private/security` | | `{recoveryCodesLeft, sessionCount, currentSessionCreatedAt}` |
| `POST /api/private/security/sessions/revoke-others` | | 204，退出除当前设备以外的所有设备 |
| `POST /api/private/security/sessions/revoke-all` | | 204，退出所有设备（包括当前设备），并清掉 Cookie |
| `POST /api/private/security/recovery-codes` | `{code:"<当前 6 位验证码>"}` | 200 `{codes:[...10 个]}`，旧恢复码全部作废。验证码错误返回 401 `invalid_code`，并计入登录限流（和登录共用同一套计数）。验证码同样不能重放 |

## 4. 页面

- **控制台**：右上角放圆形头像（有图用图，没图显示名字首字母），点开是菜单：设置、写文章、退出登录。菜单支持键盘操作（Esc 关闭，方向键移动），点页面其他地方也会关闭。简介卡的名字、头像、bio 从 `/api/private/profile` 读。
- **设置页** `/console/settings`：三块内容，宽屏时左侧是区块导航，窄屏时导航变成顶部标签。
  - 个人资料：头像上传和移除，名字、一句话介绍、bio，facts 和 links 可增删、可排序，右侧有主页简介的实时预览。
  - 分类和标签：增加、改名、删除（确认框里写出受影响的文章数）、上移下移排序。标签支持合并。
  - 账号安全：剩余恢复码数量（少于 3 个时提醒），已登录设备数，两个退出按钮，重新生成恢复码（先输入验证码；新码只显示一次，附带复制和下载为 .txt 的按钮）。
- **写文章页**：表单增加「分类」下拉框，最后一项是「+ 新分类…」，选它后输入名字。标签输入框增加自动补全，从 `/api/private/tags` 取，可以用逗号或回车添加，每个标签显示为可删除的小块。
- **公开主页**：`Intro.astro` 在浏览器里请求 `/api/profile` 渲染名字、tagline、facts、links。请求失败时保留构建时的静态文案。所有外部数据都要转义，链接只允许 http、https、mailto。
- **博客外壳**：分类筛选栏和 `.cat` 的样式写进 `blog.css`。
