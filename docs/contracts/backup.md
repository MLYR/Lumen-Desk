# 整站数据备份（P2.12）

用户在 2026-11-10 要求：不要手动搬 SQLite，控制台要能导出并导入所有动态录入的数据。

## 范围

导出包包含：

- 已发布和草稿文章：标题、slug、摘要、标签、Markdown 原文、状态、发布时间、创建时间、更新时间、分类；
- 分类：名称、slug、描述、排序；
- 标签词表：名称、排序（包括没有任何文章使用的标签）；
- 书签：完整文件夹树、链接、排序、添加时间；
- 简历 `kv.resume` 和简历公开开关 `kv.resume_settings`；
- 个人资料 `kv.profile`（包括头像路径）；
- `DATA_DIR/uploads/` 里的图片。

不包含：

- TOTP 密钥、恢复码、登录会话、登录失败记录；
- AIHOT 缓存、书签快照等可以重新生成的内部数据；
- SQLite 文件本身。

因此导入后**验证器不需要重新绑定**，当前登录会话也继续有效；如果换到全新服务器，请在新服务器上重新绑定验证器或继续使用原来的验证器。

## 文件格式

ZIP，版本 1：

```text
manifest.json
content.json
uploads/<文件名>
```

`manifest.json`：

```json
{
  "format": "lumen-desk-backup",
  "version": 1,
  "exportedAt": "2026-11-10T00:00:00.000Z",
  "counts": { "posts": 1, "categories": 7, "tags": 16, "folders": 13, "bookmarks": 296, "uploads": 4 },
  "note": "不包含验证器、恢复码、登录会话、限流记录和 AIHOT 缓存"
}
```

`content.json` 里的 `posts[].category` 存分类的稳定 slug，不存数据库 id；导入时按 slug 重新建立关联。文章正文以 Markdown 原文为准，导入时重新渲染 HTML 和目录。

## 接口

都需要登录，挂在 `/api/private/backup/*` 下，并经过 Caddy forward_auth 和 API 会话检查。

| 方法 路径 | 请求 | 返回 |
| --- | --- | --- |
| `GET /api/private/backup/export` | | `application/zip`，`Content-Disposition: attachment`，`Cache-Control: no-store` |
| `POST /api/private/backup/import` | multipart `file`（.zip，≤ 40 MiB） | `{ posts, categories, tags, folders, bookmarks, uploads }` |

导入写操作校验 `Origin` 和 `multipart/form-data`。Caddy 的请求体上限单独设为 41 MiB，不能落进其他私有接口的 3 MiB 规则。

## 导入行为

1. 解压后先校验 manifest、版本、所有字段、文章正文、简历、个人资料、书签树和图片名；全部通过才进入写入阶段。
2. 图片先写入 `DATA_DIR/uploads/`；旧图片不删除，多出来的文件无害。
3. 在一个 SQLite 事务里替换文章、分类、标签、书签树、简历、个人资料和简历开关，并重建 FTS 索引。书签导入前尽力保存一份快照。
4. 设置 `taxonomy_seeded`、`bookmarks_migrated` 和 `render_version`，避免下一次启动重复 seed 或重新渲染。

任何校验失败都不会改数据库；已写入的图片最多留下未被引用的文件。导入时不会读取或修改验证器、恢复码、会话、限流和 AIHOT 表。

限制：压缩包 ≤ 40 MiB，解压后 ≤ 80 MiB，文章 ≤ 2000 篇，分类 ≤ 500 个，标签 ≤ 2000 个，书签条目 ≤ 20000 条，图片 ≤ 500 个、单张 ≤ 12 MiB、总计 ≤ 40 MiB。图片名只允许安全 basename 和常见图片扩展名（webp/png/jpg/jpeg/gif/avif）。

## 控制台

`/console/settings#backup` 新增「数据备份」分区：

- 「下载全部数据 (.zip)」调用导出接口，按响应头里的文件名下载；
- 「选择备份 .zip」后显示文件名和大小，启用「导入并覆盖」；
- 导入前用现有 `confirmDialog` 明确提示会覆盖哪些内容，确认后才发请求；成功后 Toast 并刷新页面。

开发/验证：`apps/api/test/backup.test.ts` 全部使用合成数据，覆盖往返、鉴权、坏 ZIP、错误版本/字段和失败不改数据。
