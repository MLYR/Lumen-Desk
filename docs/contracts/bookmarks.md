# 收藏夹管理（P2.8）

用户在 2026-10-30 确定了范围：在控制台里增删改书签，能导出和浏览器格式一样的书签文件。**不做浏览器扩展，也不做一键替换浏览器书签。** 等 P2.7 提交后开工。前后端都按本文实现。

## 0. 决定

- 书签从 `DATA_DIR/bookmarks.json` 迁到 SQLite。第一次启动时自动导入现有文件（296 条，13 个文件夹）。导入成功后把原文件改名为 `bookmarks.json.migrated`，不删除。
- 文件夹可以多层嵌套。每个文件夹里，子文件夹和链接按各自的 `sort` 排序：子文件夹在前，链接在后，和现有的显示方式一致。
- 控制台的收藏夹卡片上可以直接操作：
  - 新增链接或文件夹；
  - 修改名称和网址；
  - 删除；
  - 移到另一个文件夹；
  - 在同一个文件夹里拖拽排序，键盘也能操作（上移、下移）。
- 导入：在页面上选择浏览器导出的 HTML 文件。有两种方式：
  - 「替换全部」，默认，原来的书签整体换成文件里的；
  - 「合并」，加到一个新文件夹「导入 YYYY-MM-DD」里。
  原来的 `import-bookmarks` 命令行工具保留，改成写数据库。
- 导出：生成 Netscape Bookmark 格式的 HTML。Chrome、Edge、Firefox、Safari 的「导入书签」都能直接读。
- 快照：每次导入、批量删除（删除的文件夹里超过 20 条），或者用户手动点「保存快照」时，先把整棵树存一份 JSON，最多保留 10 份，可以一键恢复。恢复前也会先自动存一份快照。
- 所有书签接口都放在 `/api/private/*` 下，继续由 Caddy 加 api 两道检查。书签数据永远不进 Git、测试、文档或日志（见 AGENTS.md）。

## 1. 数据

```
bookmark_folders { id, parent_id NULL=根, name 1–100 字, sort int, created_at, updated_at }
bookmarks        { id, folder_id NOT NULL, title 1–300 字, url ≤ 2048, sort int, add_date int(秒) NULL, created_at, updated_at }
bookmark_snapshots { id, reason 'import'|'bulk-delete'|'manual'|'restore', tree TEXT(JSON), count int, created_at }
```

- 删除文件夹时，下面的子文件夹和链接一起删除（应用层在一个事务里递归删除，或者用外键 ON DELETE CASCADE）。
- 网址规则：保存时只拒绝空值、超长（> 2048）和含控制字符的网址，协议不做限制。浏览器书签里本来就可能有 `chrome://`、`file://`、`javascript:` 这类地址，要原样存储、原样导出，这样导出的文件才和浏览器里的一致。
  - 页面显示时，只有 http 和 https 链接能点开。其他协议显示成不能点的文字，和现在一样。
  - `javascript:` 小书签在页面上**永远**不能点击执行，只显示为文字，并标上「小书签」。
- 校验：标题和文件夹名不允许控制字符。标题为空时用网址代替。

## 2. 接口（都需要登录，写操作沿用 Origin 和 Content-Type 检查）

| 方法 路径 | 请求 | 返回 |
| --- | --- | --- |
| `GET /api/private/bookmarks` | | 现有的树形格式保持兼容：`[{name, children?, links?:[[title,url]]}]`。另外每个节点加上 `id`，每个链接加上 `id`（新格式见下） |
| `POST /api/private/bookmarks/folders` | `{name, parentId: number|null}` | 201 |
| `PUT /api/private/bookmarks/folders/:id` | `{name?, parentId?}` | 200。移动时，目标不能是它自己或它的子孙，否则返回 400 `invalid_move` |
| `DELETE /api/private/bookmarks/folders/:id` | | 204，返回头 `X-Deleted-Count`；删除超过 20 条时先自动存快照 |
| `POST /api/private/bookmarks/links` | `{folderId, title, url}` | 201 |
| `PUT /api/private/bookmarks/links/:id` | `{title?, url?, folderId?}` | 200 |
| `DELETE /api/private/bookmarks/links/:id` | | 204 |
| `PUT /api/private/bookmarks/order` | `{folderId, folders:[id...], links:[id...]}`，必须正好是这个文件夹下全部子项的 id | 204 |
| `POST /api/private/bookmarks/import` | multipart：`file`（.html，≤ 5 MiB），`mode=replace|merge` | `{folders, links}`，导入前自动存快照 |
| `GET /api/private/bookmarks/export` | | `text/html; charset=utf-8`，`Content-Disposition: attachment; filename="bookmarks_YYYY_MM_DD.html"`，`Cache-Control: no-store` |
| `GET /api/private/bookmarks/snapshots` | | `{items:[{id, reason, count, createdAt}]}` |
| `POST /api/private/bookmarks/snapshots` | | 201，手动保存一份快照 |
| `POST /api/private/bookmarks/snapshots/:id/restore` | | 200，先自动存一份快照，再恢复 |

`GET /api/private/bookmarks` 的新格式（旧字段保留，前端可以逐步改用新字段）：

```json
[{ "id": 3, "name": "公司", "children": [ ... ], "links": [["标题","https://..."]], "items": [{ "id": 17, "title": "标题", "url": "https://..." }] }]
```

## 3. 导出格式（和 Chrome 导出的文件保持一致）

```html
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1730000000" LAST_MODIFIED="1730000000" PERSONAL_TOOLBAR_FOLDER="true">书签栏</H3>
    <DL><p>
        <DT><H3 ADD_DATE="…" LAST_MODIFIED="…">公司</H3>
        <DL><p>
            <DT><A HREF="https://…" ADD_DATE="…">标题</A>
        </DL><p>
    </DL><p>
</DL><p>
```

- 最外层固定放一个带 `PERSONAL_TOOLBAR_FOLDER="true"` 的「书签栏」文件夹，网站上的顶层文件夹都放在它下面。这样导入 Chrome 或 Edge 后，书签会出现在书签栏里。
- 缩进每层 4 个空格，换行用 `\n`，和 Chrome 的输出一样。
- `ADD_DATE`：导入时如果原文件里有 `ADD_DATE` 就保留下来；没有的话，用创建时间（Unix 秒）。现有的 296 条迁移前没有保存日期，会统一用迁移时的时间。
- 标题和文件夹名要做 HTML 转义（`& < > "`）。`HREF` 写原始网址，只转义 `&` 和 `"`。
- 导入的解析器要兼容 Chrome、Edge、Firefox、Safari 这四种导出文件（Firefox 会多出 `LAST_CHARSET`、`ICON` 等属性，直接忽略）。最外层的「书签栏」「其他书签」「移动设备书签」都展平到根目录，和现在的规则一样。
- **往返测试**：导出 → 解析 → 再导出，两次结果逐字节相同；拿 Chrome 导出的合成样例导入后再导出，文件夹结构、标题、网址、顺序都不变。

## 4. 控制台页面

- 收藏夹卡片加一个「编辑」开关，默认关闭，日常浏览不受影响。打开后：
  - 每个文件夹和链接都出现「⋯」菜单，里面有修改、移动到…、删除；
  - 顶部出现「+ 链接」「+ 文件夹」按钮；
  - 每一项前面出现拖拽手柄，可以拖动排序。
- 修改和新增都在弹框里完成（需要新增一个多字段的表单弹框，或者扩展 `promptDialog`）。「移动到…」用可以搜索的 Select 选择目标文件夹，选项显示完整路径，例如「公司 / 汇招」。
- 删除文件夹时，确认框里写出会一起删掉的链接数。
- 收藏夹卡片右上角加一个「管理」菜单：导入 HTML、导出 HTML、保存快照、快照列表（列表里可以恢复）。
- 所有操作成功后弹 toast；失败时弹 toast 并恢复原样，拖拽排序失败也要恢复到原来的顺序。
- 继续使用 `src/scripts/ui/` 里的组件，不用浏览器原生弹框。
