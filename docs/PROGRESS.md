# 项目进度

更新日期：2026-11-10。任务编号对应 `ROADMAP.md`。完成或变更任务时更新本文。

## 1. 当前状态

- **阶段**：P1 完成；P2 博客代码完成（在线写、导入 .md、图片上传）；P3 试验场新增 `/lab/` 列表页和《时间的尽头》Three.js 实验页；Umami、Uptime Kuma、自动部署配置完成；安全审查 11 项已处理。
- **仓库**：<https://github.com/MLYR/Lumen-Desk>（公开），分支 `main`。
- **本机部署**：`~/lumen-desk/`（**只在里启动 compose**，数据在 `~/lumen-desk/data/lumen.db`，仓库 `deploy/` 只是模板），5 个容器（caddy、api、umami、umami-db、uptime-kuma）。主站 <http://localhost>，Umami <http://localhost:8081>，Uptime Kuma <http://localhost:8082>（两个后台先过 basic_auth 门口密码）。已导入 296 条书签、简历 3 个项目 9 条技能、2 篇文章、绑定 Google Authenticator。
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
| P2.8 收藏夹管理 | 完成 | 见 `docs/contracts/bookmarks.md`；不做浏览器扩展 |
| P2.9 服务器状态卡 | 完成 | `docs/contracts/server-status.md` |
| P2.10 简历 | 完成 | `docs/contracts/resume.md`；简历内容只在服务器数据库 |
| P2.11 重新绑定验证器 | 完成 | `docs/contracts/totp-rebind.md`；新增 `SECRET_KEY` |
| P3 试验场 | 2 / 7（含工具箱） | P3-6《时间的尽头》、P3-7 工具箱完成；`/lab/` 列表页静态版完成；内容模型和流场页未做 |
| P4 增强 | 2 / 7 | Umami、Uptime Kuma 已部署到本机；其余待定 |

## 2. 已完成

### P3-2 试验场列表页（2026-11-10）

- 新增公开页 `/lab/`：巨型标题、实验统计和卡片墙；顶部导航「试验场」从 `/#lab` 改为 `/lab/`，当前页有 `aria-current`。
- 首页试验场卡片增加「全部实验 →」，控制台的试验场卡片和《时间的尽头》返回链接统一指向 `/lab/`。
- 卡片由 `LabGrid.astro` 维护，只保留已完成的 `/lab/end-of-time/`；未实现的流场、WebGPU、WASM 卡片已移除。侧栏改为「当前实验 / 技术栈 / 交互」。
- 仍是静态卡片，P3-1 内容模型（`src/content/lab/*.md`）未做。
- 已同步 `apps/web/dist/`、`dist-private/`、`dist-shell/` 到 `~/lumen-desk/web/{public,private,shell}`；`http://localhost/lab/` 返回 200。已重启 API，博客页顶栏已刷新到 `/lab/`；`/sitemap.xml` 的 `/lab/` 条目仍在旧镜像里，需重建 API 才会出现。

### P3-6 时间的尽头（2026-11-10）

- **页面**：新增公开页 `/lab/end-of-time/`，并加入 `/sitemap.xml`。Three.js 场景由程序化几何和着色器组成：四层青铜刻度环、罗马数字幽灵表盘、断裂表针、黑色太阳与吸积漩涡、280 片玻璃碎片、7200 个向心粒子、星空、海面时间涟漪，以及泛光、胶片颗粒、边缘色差后处理。
- **交互**：拖动环视、滚轮/双指缩放、点击/轻点画面或空格让时间坍缩（粒子加速、表针旋转、海面冲击波、泛光闪动）；镜头靠近时标题自动退场；方向键环视、`+`/`-` 缩放、`P` 暂停、`R` 复位。系统开启“减少动态”时默认暂停，点击播放或坍缩后才开始运动。
- **首页**：`LabList.astro` 改为“主打卡片 + 三个小卡片”，主打卡片链接到实验页。海报 `apps/web/public/lab/end-of-time-poster.webp` 为 1440×720、65 KB，`loading="lazy"`，不进首屏。
- **资源**：Three.js 0.187 本地打包，无 CDN、无外部字体、无新环境变量。实验页单页 JS 617 KB、gzip 159 KB，HTML/CSS 合计 gzip 约 8 KB，低于 P3-4 的 1 MB；首页新增的只是卡片标记和懒加载海报。
- **验证**：`pnpm test`（153 个）和 `pnpm build`；Chrome + CDP 在真实 Metal GPU 下确认 60 FPS，并在 1440×813、375×812 下检查渲染、拖动、滚轮/双指缩放、轻点/点击坍缩、暂停、复位和 `prefers-reduced-motion`；WebGL 不可用时显示降级页；TypeScript 单文件 strict 检查通过。
- **本机部署**：已把 `apps/web/dist/`、`dist-private/`、`dist-shell/` 同步到 `~/lumen-desk/web/{public,private,shell}`，`http://localhost/lab/`、`/lab/end-of-time/` 返回 200，首页主打卡片和海报正常；已重启 API，博客顶栏已刷新到 `/lab/`。API 没重建，所以线上 `/sitemap.xml` 暂时还没有实验室条目。

### P3-7 工具箱（2026-11-10）

- 新增公开页 `/tools/`，顶部导航在「试验场」后加「工具箱」；工具卡片用 `target="_blank"` 在新标签页打开。页面结构、两套主题和 375 宽度样式都在 `ToolGrid.astro`、`tools.css`。
- 首个工具是用户提供的 `image-compressor-pyodide.html`：放在 `apps/web/public/tools/image-compressor/index.html`，去掉 Google Fonts 和 CDN 引用，Pyodide 0.26.4、Pillow 10.2.0、JSZip 3.10.1 放进同目录 `vendor/`，由本站提供并长期缓存。来源和许可见 `vendor/README.md`。
- 工具需要 WebAssembly 和 `blob:` 图片，Caddy 只对 `/tools/image-compressor/*` 放宽 CSP（`wasm-unsafe-eval`、`img-src blob:`），其他页面保持原策略。
- 已在 `apps/api/src/blog/pages.ts` 把 `/tools/`、`/tools/image-compressor/` 加入 sitemap，测试同步更新。
- 验证：`pnpm test`（153 个）和 `pnpm build` 通过；本机 Docker 上 `/tools/`、工具页和 vendor wasm 返回 200，CSP 头正确；Chrome 在 1440 和真实 375 视口、两套主题下无横向溢出；工具页 Pyodide + Pillow 初始化到可用界面。实际压缩未做上传回归（Chrome 扩展未开启文件 URL 权限），压缩逻辑保持原页面不变。
- 已同步 `dist`、`dist-private`、`dist-shell` 到 `~/lumen-desk`，重建 API 镜像并重启 Caddy/API。

### 博客布局调整（2026-11-10）

- 博客主体 `.wrap-blog` 改为视口 90%，左右各留 5% 空白，上限仍为 1680px；内边距改为 0，5% 是实际留白。
- 文章页固定左栏 240px、右栏 200px，正文 `minmax(0, 1fr)` 填满剩余宽度；没有 `.post-toc` 时正文占掉右栏，左栏位置和宽度不变。
- 博客列表页同样保留左栏 240px，列表占满剩余宽度；桌面三栏阈值仍是 1200px，900–1199px 两栏，375 宽走抽屉。
- 验证：`pnpm build` 通过；本机 Docker 页面 200；1440/1200/375 宽、两套主题下 `scrollWidth` 等于视口宽度，无横向溢出。

### P2.9–P2.11 服务器状态卡、简历、重新绑定验证器（2026-10-31，Orca 协同）

- **服务器状态卡**（后端 `blog-api-v2`，前端 `blog-web-v2`）：`src/system/` 采集 CPU 使用率（/proc/stat 差值）、内存、交换、磁盘、负载、网络速率与累计（宿主 `/proc/1/net/dev`）、主机信息、服务状态（网站、AIHOT、经 Caddy 探测 Umami、Kuma）。compose 给 api 加 3 个只读文件挂载，不挂 docker.sock。本机 OrbStack 显示「Docker 虚拟机」。前端每 5 秒刷新一次，后台标签页暂停。
- **简历**：只存在 `kv.resume`，不进 Git。服务端打码（姓名、手机、邮箱、生日、籍贯、现居地、公司、项目、客户，以及 keywords）。用 split/join 和线性的 findLoose 匹配：手机号允许分隔符和全角，邮箱忽略大小写，姓名允许中间有空白，统一 NFC。最后在归一化形式上再查一遍，有残留就整段替换。总开关 revealPublic 默认关闭，打开时 noindex 并从 sitemap 移除。公开页面 `/resume/` 支持打印 A4；控制台 `/console/resume` 可编辑并预览两种视图。用户的 2024 年简历由 Lead 通过私有接口导入，22 个敏感值（包括片段）在公开接口、页面 DOM、全部网络响应中精确匹配和归一化匹配都是 0 命中。
- **重新绑定验证器**：密钥用 AES-256-GCM 加密存进 `kv.totp_secret`（需要 `SECRET_KEY`）。rebind 要先验证当前码；新密钥放在 pending 里 10 分钟；confirm 在一个事务里替换密钥、重置 last_step、退出其他会话，然后热替换。二维码由 uqr 生成 SVG。init-totp 改为写数据库，`--force` 视为重置。
- **安全审查**（`security-review`，第五轮）：中 1 项，自由文本里敏感词换个写法就会漏，比如手机号带分隔符或全角、邮箱大小写不同、姓名中间有空格、NFD 编码；已修复。低 3 项：GCM 的 tag 长度没有固定，配置了 key 后仍接受 plain:；init-totp 的 --print-env 和 --force 存在隐患；主页在 reveal 打开时没有 noindex。均已修复。api 测试 153 个。
- **本机配置**：`.env` 新增 `SECRET_KEY`、`HOST_ROOT`（原配置备份在 `.env.bak-p210`）；数据库备份在 `data/pre-p210.db`。

### P2.8 收藏夹管理（2026-10-31，Orca 协同）

- **后端**（Orca Worker `blog-api-v2`，claude-opus-5.5）：书签从 `bookmarks.json` 迁到 SQLite（`bookmark_folders`、`bookmarks`、`bookmark_snapshots`），首次启动自动迁移，原文件改名为 `.migrated`；增删改、移动（防环）、排序；导入 Netscape HTML（替换或合并，线性解析，最多 32 层、20000 条）；导出与 Chrome 格式一致；快照最多 10 份，恢复前自动存一份。`import-bookmarks` CLI 改为写数据库。测试 107 个，只用合成 fixture。
- **前端**（Orca Worker `blog-web-v2`，claude-sonnet-5.5）：收藏夹卡片加「编辑」开关（关闭时和原来一样）、「⋯」菜单（修改、移动到…、上移/下移、删除）、链接拖拽排序和 Alt+↑/↓、「管理」菜单（导入、导出、快照）；新增 `formDialog`、`choiceDialog`、`menu.ts`。非 http(s) 链接只显示文字，`javascript:` 标「小书签」。
- **安全审查**（Orca Worker `security-review`，第四轮）：中 1 项，单个字段里 100 万个实体会让 api 内存超限，已改为先截断再解码；低 3 项，「移动文件夹到…」打不开（前端少了 return）、快照无大小上限（改为 8 MB）、迁移后改名失败可能重复导入（加 `bookmarks_migrated` 标记）。
- **集成**（Lead）：先在真实数据副本上验证迁移，13 个文件夹、296 条链接逐条一致；再在本机 Docker 上真实迁移，用浏览器测了增删改、防环、快照、导出后再导入，前后两次导出逐字节相同。升级前备份：`~/lumen-desk/data/pre-p28.db`、`bookmarks.json.pre-p28`。

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
| 2026-11-10 | 博客布局：主体左右留 5%，左栏固定 240px，正文自适应；无目录时正文占掉右栏，列表页同步收窄 |
| 2026-11-10 | P3-7 工具箱：新增 `/tools/` 聚合页和顶部「工具箱」导航，图片压缩工具（Pyodide/Pillow/JSZip 本地化）在新标签页打开；加入 sitemap，已同步本机 Docker |
| 2026-11-10 | 修复写文章页标签自动补全只显示 8 个的问题：取消截断，改成网格展示全部标签，并在回到页面/聚焦时刷新标签和分类词表 |
| 2026-11-10 | 试验场侧栏改为「当前实验 / 技术栈 / 交互」，移除流场、WebGPU、WASM 三个未实现卡片；页面只保留《时间的尽头》 |
| 2026-11-10 | 简历页和试验场列表页移除页头「返回主页」入口；简历页保留打印按钮，试验场页头横栏整体移除 |
| 2026-11-10 | P3-2 静态列表页：新增 `/lab/`，顶部「试验场」导航、首页入口、控制台和实验页返回链接统一到 `/lab/`；已同步本机 Docker 并重启 API，博客顶栏已刷新；sitemap 新条目待 API 重建 |
| 2026-11-10 | P3-6 完成：新增 Three.js 交互实验《时间的尽头》和首页主打卡片；实验页约 167 KB gzip，移动端可双指缩放，减少动态时默认暂停；已同步到本机 Docker 的 80 端口 |
| 2026-11-01 | 修事故：上一轮从仓库 `deploy/` 里启动了 compose（项目名同为 `lumen-desk`），容器挂载被换成仓库里的空目录，数据库变空。现象是 `/resume/` 一直「简历整理中」、控制台输对验证码也进不去。已改回在 `~/lumen-desk/` 启动（挂载 `~/lumen-desk/data`），重建 API 镜像，重新同步网页；数据、登录、打码全部正常。仓库 `deploy/` 里的 `web/`、`data/`、改坏的 `.env` 已挪到 `/tmp/lumen-desk-repo-deploy-leftovers/`，`.gitignore` 加 `deploy/web/`，AGENTS.md 加了「本机部署」一节 |
| 2026-11-01 | 控制台博客卡片的标题改成链接：已发布开公开文章页（新标签页），草稿开 `/console/write?id=<id>` 编辑器；write 页支持 `?id=` 且等分类加载完再填 |
| 2026-11-01 | 控制台「博客」卡片改为读真实数据（`/api/private/posts`，最近 3 篇，带已发布/草稿和日期），去掉 3 条写死的占位标题；新脚本 `src/scripts/console/blog-card.ts`，空列表和读不到时给中文提示 |
| 2026-11-01 | 博客顶栏不再跟着正文的 1680px 宽框变宽，改成和其它页一致的 `.wrap`（1200px）；正文与页脚仍为全宽。`Header.astro` 去掉 `wide` 参数，页脚保留 |
| 2026-10-30 | 方案和原型定稿；建仓库并推送 |
| 2026-10-30 | P1 MVP 完成，本机 Docker 部署；安全审查修复 5 项 |
| 2026-10-30 | 新增 ROADMAP.md、PROGRESS.md、README.md、AGENTS.md |
| 2026-10-30 | 用户确认：自动部署用 GitHub Actions；要 Umami 和 Uptime Kuma |
| 2026-10-30 | P2 博客、Umami、Uptime Kuma、自动部署完成（Orca 协同 3 个 Worker） |
| 2026-10-31 | P2.9 服务器状态卡、P2.10 简历（服务端打码）、P2.11 重新绑定验证器完成；第五轮安全审查 4 项修复 |
| 2026-10-31 | 博客页加宽：外框 1680px，正文最宽 1040px（原来 68ch 约 690px），左右栏宽度不变；控制台顶栏只保留「控制台」，个人简介、博客、试验场的卡片标题在新标签页打开，头像菜单去掉「写文章」（入口在博客卡片上） |
| 2026-10-31 | P2.8 完成：收藏夹在控制台里增删改、排序，导入导出浏览器格式，快照；第四轮安全审查 4 项修复 |
| 2026-10-30 | P2.7 完成：博客左侧分类导航、右侧目录、上下篇、回到顶部/底部；第三轮安全审查 2 项修复 |
| 2026-10-30 | 用户确认 P2.8 范围：收藏夹增删改 + 导出浏览器格式，不做浏览器扩展 |
| 2026-10-30 | P2.6 完成：控制台原生下拉框、confirm、日期选择换成自制组件，新增 Toast |
| 2026-10-30 | P2.5 完成：分类、标签、个人资料、设置页、头像菜单；安全审查 4 项低危修复 |
| 2026-10-30 | 写文章页改版：左写右预览，导入在顶部且回显到编辑器（不直接入库），去掉文章列表改为下拉框，新文章默认发布、发布时间默认当前 |
| 2026-10-30 | 用户确认 P2.5：分类和标签内置一批、也能手动添加，控制台加头像菜单和设置页，个人资料同步到主页 |
| 2026-10-30 | 安全审查 11 项修复；Umami、Kuma 加门口密码，统计脚本改走主站 `/u/` |
| 2026-10-30 | 用户确认 9 项：定名拾光台、不用 COS、博客支持在线写、不要评论、加 MIT 许可；服务器内存改读 MemAvailable |
