# 项目进度

更新日期：2026-10-30。任务编号对应 `ROADMAP.md`。完成或变更任务时更新本文。

## 1. 当前状态

- **阶段**：P1 完成；P2 博客代码完成（在线写、导入 .md、图片上传）；Umami、Uptime Kuma、自动部署配置完成；安全审查 11 项已处理。
- **仓库**：<https://github.com/MLYR/Lumen-Desk>（公开），分支 `main`。
- **本机部署**：`~/lumen-desk/`，5 个容器（caddy、api、umami、umami-db、uptime-kuma）。主站 <http://localhost>，Umami <http://localhost:8081>，Uptime Kuma <http://localhost:8082>（两个后台先过 basic_auth 门口密码）。已导入 296 条书签、绑定 Google Authenticator。
- **服务器**：未部署。
- **备案**：未提交。

| 阶段 | 完成度 | 说明 |
| --- | --- | --- |
| P0 准备 | 1 / 5 | 服务器和域名已有；备案未提交；COS 已取消 |
| P1 MVP | 9 / 9 | 全部完成 |
| P1.5 上线加固 | 3 / 10 | CSP、Actions 固定 SHA、日志轮转已完成；其余要等服务器和备案 |
| P2 博客 | 10 / 11 | 只差第一篇文章（P2-11，用户写） |
| P2.5 分类、标签、设置 | 8 / 8 | 完成，见 `docs/contracts/taxonomy-profile.md` |
| P2.6 基础 UI 组件 | 完成 | 见 `docs/contracts/ui-components.md` |
| P2.7 博客阅读体验 | 完成 | 见 `docs/contracts/blog-reader.md` |
| P2.8 收藏夹管理 | 进行中 | 见 `docs/contracts/bookmarks.md`；不做浏览器扩展 |
| P3 试验场 | 0 / 5 | 主页上有一个流场粒子预览 |
| P4 增强 | 2 / 7 | Umami、Uptime Kuma 已部署到本机；其余待定 |

## 2. 已完成

### P2.7 博客阅读体验（2026-10-30，Orca 协同）

- **后端**（Orca Worker `blog-api-v2`，claude-opus-5.5）：给 h2/h3 生成 `h-` 开头的 id，sanitize 时按正则校验；`posts.toc` 存目录；`blogNav()` 生成按分类分组的导航（只含已发布的文章和公开分类）；用一条带索引的查询取上一篇和下一篇；列表页、分类页、标签页套用同一个导航，去掉 `.cat-bar`；`render_version=2` 时自动重新渲染旧文章；顺手修了老库 FTS 为空时更新文章会报 malformed 的 bug。
- **前端**（Orca Worker `blog-web-v2`，claude-sonnet-5.5）：三栏布局，1200 / 900 两个断点；用 IntersectionObserver 高亮当前小节，显示阅读进度；标题旁有复制锚点按钮；右下角有回到顶部和直达底部；窄屏时导航放进左侧抽屉（锁定焦点）。新增部分合计 gzip 约 3.5 KB。
- **安全审查**（Orca Worker `security-review`，第三轮）：中 1 项，重复标题去重是平方复杂度，2 万个重复标题要 16 s，会卡住整个进程，已改为线性，并且只取前 200 个标题；低 1 项，启动时同步等待重新渲染，失败会让服务起不来，已改为在后台进行，失败下次重试。
- **集成**（Lead）：顶栏背景改为不透明，修好滚动时代码透出的问题；搜索框提示文字缩短。在本机 Docker 上用真实文章跑了端到端测试（两套主题 × 3 种宽度，没有横向溢出，所有目录链接都能跳转），api 测试 84 个。升级前数据库备份到 `~/lumen-desk/data/pre-p27.db`。

### P2.6 基础 UI 组件（2026-10-30，Orca 协同）

- 用户选了方案 A：不引入 UI 库，自己写。规格见 `docs/contracts/ui-components.md`。
- **组件**（Orca Worker `blog-web-v2`，claude-sonnet-5.5）：`src/scripts/ui/` 下的 Select（可搜索，带副标题和 action 项）、confirmDialog / promptDialog（基于原生 `<dialog>`）、Toast（放在 popover 顶层）、DateTimePicker（日历网格），以及 `src/styles/ui.css`。两套主题各有样式。合计 gzip 8.9 KB，用户接受比原定的 8 KB 多出这部分。支持 WAI-ARIA 和键盘操作，开启 reduced-motion 时不播放动画。
- **替换**：写文章页的 3 个 select、1 个 datetime-local、2 处 confirm()；设置页的 6 处 confirm()；成功消息改为 Toast。`apps/web/src` 里已经没有原生 `confirm(`。演示页 `/console/ui-demo` 已删除。
- **验证**（Lead）：在本机 Docker 上用真实后端做了 15 项端到端测试，全程没有弹出任何原生对话框，也没有页面报错。

### P2.5 分类、标签、个人资料、设置（2026-10-30，Orca 协同）

- **后端**（Orca Worker `blog-api-v2`，claude-opus-5.5）：`categories`、`tags` 两张表和 `posts.category_id`；内置 5 个分类、10 个标签，只在第一次迁移时写入；标签不区分大小写，改名和合并放在一个事务里；`kv.profile` 存个人资料，`/api/profile` 公开；头像裁成 256×256 WebP（≤ 50 KB）；账号安全：退出其他设备、退出所有设备、重新生成恢复码（要输入 TOTP，和登录共用限流和防重放）。测试共 67 个。
- **前端**（Orca Worker `blog-web-v2`，claude-sonnet-5.5）：三个控制台页共用 `ConsoleTop.astro`，右上角是头像菜单（设置、写文章、退出，支持键盘操作）；新增 `/console/settings`，分个人资料、分类和标签、账号安全三块；写文章页加了分类下拉框（可新建）和带自动补全的标签小块；公开主页的简介从 `/api/profile` 读取；博客加了 `.cat-bar` 和 `.cat`。
- **安全审查**（Orca Worker `security-review`，claude-opus-5.5，两轮）：P2.5 这一轮报了 4 个低危问题，都由 Lead 修复：头像上传在 Caddy 上限 3 MiB → 12 MiB；标签名不能只由 `.` 组成；名字里不允许零宽字符和双向控制字符；自己新建的分类在有文章发布前不公开。
- **集成**（Lead）：在本机 Docker 上跑了 28 项端到端测试；真实头像 9.7 MB 能通过 Caddy 上传；旧数据库在迁移前备份到 `/tmp/lumen-before-p25.db`，迁移后用户的 2 篇文章完好。

### P2 博客 + P4-1/P4-2 + P1.5 部分（2026-10-30，Orca 协同）

- **后端**（Orca Worker `blog-api-v2`，claude-opus-5.5）：`apps/api/src/blog/`。文章存 SQLite，FTS5 trigram 搜索（2 个字时回退 LIKE）；markdown-it（禁原始 HTML）+ Shiki 双主题 + sanitize-html 白名单；导入 .md（frontmatter，默认草稿）；sharp 转 WebP（≤1600 px、≤150 KB、去 EXIF、按内容哈希命名）；导出 zip；`/blog`、文章页、标签页、RSS、sitemap 由 api 填进 web 构建的外壳返回。测试从 19 个增加到 40 个。
- **前端**（Orca Worker `blog-web-v2`，claude-sonnet-5.5）：外壳 `dist-shell/blog.html`；博客样式（代码块、表格在自身内滚动）；主页显示最新 3 篇；在线编辑器 `/console/write`（实时预览、Ctrl/Cmd+S、导入、粘贴图片上传、导出）；Umami 脚本只加在公开页面。
- **部署**（Orca Worker `deploy-v2`，claude-sonnet-5.5）：Caddy 加博客路由、`/uploads`（`default-src 'none'`）、主站 CSP、各接口请求体上限；compose 加 Umami 3.4.1 + Postgres 16、Uptime Kuma 2.5.8，所有服务日志轮转；Actions 全部固定 commit SHA，部署后做冒烟检查。
- **安全审查**（Orca Worker `security-review`，claude-opus-5.5，只读）：报告 11 项，1 高 3 中 7 低。高：Umami/Kuma 部署后无保护地暴露在公网（Kuma 首个访问者成管理员、Umami 默认密码），可借 Kuma 访问内网。修复：两个后台加 basic_auth（`ADMIN_USER`、`ADMIN_PASSWORD_HASH` 必填）；统计脚本改走主站 `/u/script.js`、`/u/api/send`，CSP 去掉外部源；Umami 和数据库放进独立 `stats` 网络；后台请求去掉 Cookie；Umami 密钥拆到 `umami.env`。中：外壳占位符二次替换、导入标题正则回溯、部署 chmod 权限。低：超长代码块不高亮、列表不读全文、像素上限 2400 万、MiB 单位、img-src 允许 https。api 测试增加到 46 个。
- **集成**（Lead）：Caddy 请求体上限按 api 对齐（导入 21 MB、其他私有 3 MB）；本机 Docker 5 个容器端到端验证：登录、上传图片、发布、文章页、搜索、RSS、删除后 404、Origin 不匹配 403、未登录 `/console/write` 302。

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
| 7 | 自动部署 | GitHub Actions | `deploy/README.md`「开启自动部署」 |
| 10 | Umami、Uptime Kuma | 都要 | compose 已加，本机已运行 |
| 12 | 主页内容 | 之后提供，先用占位 | P0-6 |

### 还要确认

8. **数据备份**：暂定。博客上线后文章存在数据库里，到时必须做（P1.5-7）。
10. **P4 其余增强项**：AIHOT 今日日报、天气、GitHub 热力图、控制台编辑书签待定。

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
| 2026-10-30 | 用户确认：自动部署用 GitHub Actions；要 Umami 和 Uptime Kuma |
| 2026-10-30 | P2 博客、Umami、Uptime Kuma、自动部署完成（Orca 协同 3 个 Worker） |
| 2026-10-30 | P2.7 完成：博客左侧分类导航、右侧目录、上下篇、回到顶部/底部；第三轮安全审查 2 项修复 |
| 2026-10-30 | 用户确认 P2.8 范围：收藏夹增删改 + 导出浏览器格式，不做浏览器扩展 |
| 2026-10-30 | P2.6 完成：控制台原生下拉框、confirm、日期选择换成自制组件，新增 Toast |
| 2026-10-30 | P2.5 完成：分类、标签、个人资料、设置页、头像菜单；安全审查 4 项低危修复 |
| 2026-10-30 | 写文章页改版：左写右预览，导入在顶部且回显到编辑器（不直接入库），去掉文章列表改为下拉框，新文章默认发布、发布时间默认当前 |
| 2026-10-30 | 用户确认 P2.5：分类和标签内置一批、也能手动添加，控制台加头像菜单和设置页，个人资料同步到主页 |
| 2026-10-30 | 安全审查 11 项修复；Umami、Kuma 加门口密码，统计脚本改走主站 `/u/` |
| 2026-10-30 | 用户确认 9 项：定名拾光台、不用 COS、博客支持在线写、不要评论、加 MIT 许可；服务器内存改读 MemAvailable |
