# 博客阅读体验：左侧导航、右侧目录、上下篇、回到顶部（P2.7）

用户在 2026-10-30 确认。前后端都按本文实现，和 `blog-api.md`、`taxonomy-profile.md` 冲突时以本文为准。

## 0. 决定

- 左侧导航：文章按分类分组，每组下面列出文章标题。没有分类的文章放在最后的「未分类」组。当前分类展开，当前文章高亮。已发布文章超过 50 篇时只展开当前分类；50 篇以内全部展开。
- 右侧目录：只收 h2、h3 两级。滚动时高亮当前读到的那一节，下面显示阅读进度。
- 正文的 h2、h3 带锚点。鼠标悬停时在标题旁显示 `#`，点击复制这一节的链接。
- 文章底部放「上一篇 / 下一篇」，在同一分类内按发布时间排序。未分类的文章在未分类组内排序。
- 右下角放「回到顶部」「直达底部」两个浮动按钮，页面滚过一屏后才出现。
- 博客列表页 `/blog/`、分类页、标签页也用同一个左侧导航，替换掉现在的 `.cat-bar`。
- 左侧导航和目录都在服务端生成，没有 JS 也能看，也方便搜索引擎抓取。前端脚本只负责：滚动时高亮当前一节、阅读进度、浮动按钮、复制锚点、窄屏抽屉。

## 1. 后端（apps/api）

### 1.1 标题锚点

- render.ts 渲染时给 h2、h3 加 `id`。id 由标题纯文本生成：
  - 转小写，空白换成 `-`；
  - 只保留 Unicode 字母、数字、`-` 和 `_`，所以中文保留，例如 `第一节-安装`；
  - 去掉首尾的 `-`，长度不超过 60 个字符；
  - 结果为空时用 `section-<n>`；
  - 同一篇文章里重复时依次加 `-2`、`-3`；
  - 最后加前缀 `h-`，避免和页面上已有的 id（`blog-search` 等）冲突。
- sanitize 白名单里给 h2、h3 放行 `id`，并且只接受 `^h-[\p{L}\p{N}_-]{1,64}$`（Unicode 正则）。
- 渲染同时返回目录数据 `toc: [{level: 2|3, id, text}]`。保存时存进 `posts.toc`（JSON），迁移时新增这一列，默认 `'[]'`。
- **重新渲染旧文章**：服务启动后在后台执行，不阻塞对外服务；渲染完成前，旧的 html 照常提供。kv 里没有 `render_version=2` 时，把所有文章用新渲染器重新生成 html 和 toc，然后在同一个事务里写入这个标记。只有成功才写标记，失败时下次启动会重试。
- 每篇文章最多给前 200 个 h2/h3 加 id 并列入目录。去重后缀按 base 记住下一个编号，保证线性时间（第三轮安全审查）。

### 1.2 页面数据

文章页、列表页、分类页、标签页都调用 `blogNav(db, {currentSlug?, currentCategorySlug?})`，返回下面的片段。HTML 结构固定，样式由 web 负责：

```html
<aside class="blog-nav" id="blog-nav" aria-label="文章导航">
  <div class="blog-nav-search"><!-- 外壳里原有的 #blog-search 和 #blog-search-results 由前端脚本移到这里 --></div>
  <nav>
    <details class="nav-group" open>
      <summary><a href="/blog/category/frontend/">前端</a><span class="n">3</span></summary>
      <ul>
        <li><a href="/blog/slug/" aria-current="page">文章标题</a></li>
      </ul>
    </details>
    <details class="nav-group">
      <summary><span>未分类</span><span class="n">1</span></summary>
      <ul>…</ul>
    </details>
  </nav>
  <p class="nav-foot"><a href="/blog/">全部文章</a> · <a href="/blog/tags/">标签</a> · <a href="/rss.xml">RSS</a></p>
</aside>
```

- 分组按分类的 sort 排序，组内按 publishedAt 倒序。草稿不出现，只被草稿用到的分类也不出现（沿用 `isPublic` 规则）。
- 列表页没有当前文章。分类页把当前分类加 `open` 并给 summary 里的链接加 `aria-current="page"`。

文章页的 `<article>` 改成下面这样。`.post-head` 和 `.prose` 保持原样：

```html
<div class="post-layout">
  {blogNav}
  <article class="post">
    <header class="post-head">…原样…</header>
    <details class="toc-inline" ><summary>本文目录</summary><ol>…同下…</ol></details>   <!-- 只在 toc 非空时输出 -->
    <div class="prose">…</div>
    <nav class="post-pager" aria-label="上一篇和下一篇">
      <a class="prev" href="/blog/a/" rel="prev"><span>上一篇</span><strong>标题</strong></a>
      <a class="next" href="/blog/b/" rel="next"><span>下一篇</span><strong>标题</strong></a>
    </nav>
  </article>
  <aside class="post-toc" aria-label="本文目录">                                       <!-- 只在 toc 非空时输出 -->
    <p class="toc-title">本文目录</p>
    <ol>
      <li class="l2"><a href="#h-第一节">第一节</a>
        <ol><li class="l3"><a href="#h-1-1">1.1</a></li></ol>
      </li>
    </ol>
    <div class="toc-progress" aria-hidden="true"><span></span></div>
  </aside>
</div>
```

- 「上一篇」指时间更早的一篇，「下一篇」指更新的一篇。没有就不输出对应的 `<a>`。两个都没有时不输出 `<nav>`。
- 列表页、分类页、标签页的结构是 `<div class="post-layout list">{blogNav}<section class="post-index">…原样…</section></div>`，不输出 `.cat-bar`。
- 目录文字、导航标题都要转义，href 里的 slug、id 要先做 URL 编码再转义。

### 1.3 测试

- id 生成：中文、重复标题、空标题、带特殊字符、超长标题。
- 白名单：手写的 `<h2 id="javascript:...">` 不会出现（markdown 本身就禁止原始 HTML，再加一层检查）。
- 旧文章迁移：第一次重渲染后有 id 和 toc，重复迁移不会再重渲染。
- 导航里不出现草稿和只被草稿用到的分类。
- 上一篇、下一篇的顺序和边界：分类内只有一篇时两个都没有。
- 页面里的 `.post-toc` 链接和正文里的 id 一一对应。

## 2. 前端（apps/web）

- 样式写在 `blog.css`，脚本放 `src/scripts/blog-reader.ts`，在外壳 `blog.astro` 里加载。
- **布局**：
  - ≥ 1200px：三栏 `240px | minmax(0, 1040px) | 200px`（2026-10-31 由 68ch 加宽到 1040px，博客页外框 `.wrap-blog` 1680px），左右两栏 `position: sticky; top: 76px; max-height: calc(100vh - 96px); overflow: auto`。
  - 900–1199px：两栏，左边是导航，右侧目录隐藏，用正文顶部的 `.toc-inline`。
  - < 900px：一栏，`.blog-nav` 变成从左边滑出的抽屉，正文顶部放一个「文章列表」按钮打开它；遮罩、Esc 和点链接都能关闭抽屉，焦点锁定在抽屉里。
  - `.toc-inline` 只在 < 1200px 时显示。
- **目录高亮**：用 IntersectionObserver 监听正文 h2、h3，当前一节的链接加 `aria-current="true"`（两套主题各自的样式：蓝图是左边琥珀色竖线，白纸是朱红色文字加粗）。点击目录平滑滚动，`prefers-reduced-motion` 时直接跳。地址栏用 `history.replaceState` 更新 hash。目录过长时让当前项保持在可视区域里。
- **阅读进度**：`.toc-progress span` 的宽度跟随正文滚动比例变化，用 requestAnimationFrame 节流。
- **锚点复制**：正文 h2、h3 鼠标悬停时显示 `#` 按钮，点击用 `navigator.clipboard` 复制完整链接，并弹出 toast「已复制本节链接」。博客是公开页面，不要引入控制台的 ui 组件。写一个只有几行的极简 toast，或者让按钮短暂显示 ✓。
- **浮动按钮**：右下角竖排「↑」「↓」，有 `aria-label`（回到顶部、直达底部）。滚过一屏后显示，在页面最底部时隐藏「↓」，在顶部时隐藏「↑」。按钮至少 40×40，不能挡住正文。375 宽时贴在右下角。
- **搜索**：外壳里原有的搜索框移进 `.blog-nav-search`。没有 `.blog-nav` 的页面（404）保持原样。
- **主题**：两套主题都要单独设计导航、目录、上下篇卡片和浮动按钮的样子，风格和控制台组件保持一致：蓝图用角标、等宽字体、琥珀色；白纸用黑线、朱红色。
- **体积**：公开页面新增的 JS 和 CSS 合计 gzip 不超过 4 KB。
