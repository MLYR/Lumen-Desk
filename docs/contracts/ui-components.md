# 基础 UI 组件（P2.6）

用户在 2026-10-30 选了方案 A：不引入 UI 库，自己写一套小组件，替换控制台里原生的下拉框、`confirm()`、日期时间选择，另外新增 Toast。

## 范围

只改控制台的私有页面：`/console`、`/console/write`、`/console/settings`。公开主页和博客不改。

| 现状 | 替换为 | 用在哪 |
| --- | --- | --- |
| `<select>` ×3 | `Select` 组件 | 写文章页：打开已有文章、状态、分类 |
| `confirm()` ×8 | `confirmDialog()` | 写文章页 2 处，设置页 6 处 |
| `<input type="datetime-local">` ×1 | `DateTimePicker` | 写文章页：发布时间 |
| 表单上方的消息条（成功类消息） | `toast()` | 保存、删除、上传成功；错误仍在原位显示，同时弹 Toast |

## 设计要求

- 只用 `theme.css` 里的变量：`--bg --panel --card-hover --fg --muted --line --soft-line --accent --accent-fg --mono --sans`。不写死颜色。
- 每个组件都要在两个主题下有不同的样子：
  - **蓝图 blueprint**：直角，1px `--line` 边框，浮层的左上角和右下角加 2px `--accent` 角标（和 `.card::before/::after` 一样），标签用等宽字体，浮层背景是 `--panel` 加轻微毛玻璃。高亮项是左边一条 2px `--accent` 竖线加 `--card-hover` 背景。
  - **白纸 paper**：直角，弹框顶部是 2px `--line` 实线，分隔用 1px 细线，阴影很淡。高亮项是 `--card-hover` 背景，选中项后面有一个 `--accent` 对勾。确认按钮实心 `--accent`，取消按钮只有文字。
- 动画：浮层淡入加 4px 位移，弹框淡入加 0.98 到 1 的缩放，每个都在 120–160ms 内完成。`prefers-reduced-motion` 时关掉动画。
- 层级：Toast 用 90，Dialog 用 80，浮层（下拉、日历）用 70。拖放遮罩已经占了 60，保持不变。
- 手机宽度 375：下拉和日历浮层不能超出屏幕（宽度不超过 `calc(100vw - 32px)`，靠近底部时向上弹）；弹框宽度 `min(440px, calc(100vw - 32px))`。
- 不引入新依赖，代码放 `src/scripts/ui/`，样式放 `src/styles/ui.css`。所有组件压缩后合计不超过 8 KB。

## 组件接口

```ts
// src/scripts/ui/select.ts —— 用一个自定义控件替换原生 <select>，原生 select 仍保留并隐藏。
// value、change 事件和表单读写都照常走原生 select，所以现有代码不用改读取方式。
enhanceSelect(select: HTMLSelectElement, opts?: { searchable?: boolean; placeholder?: string }): { refresh(): void; destroy(): void }
//   - 原生 select 的 options 变化后（例如重新加载文章列表），调用 refresh() 重新生成选项。
//   - searchable：选项超过 8 个时显示搜索框，按名称过滤，忽略大小写。
//   - 每个选项可以显示副标题：option 上的 data-sub 属性（例如「已发布 · 10-30」）。
//   - 选项可以有 data-kind="action"（例如「+ 新分类…」），显示时加强调色，前面有分隔线。

// src/scripts/ui/dialog.ts
confirmDialog(opts: { title: string; body?: string; confirmText?: string; cancelText?: string; danger?: boolean }): Promise<boolean>
promptDialog(opts: { title: string; label: string; value?: string; placeholder?: string; maxLength?: number; validate?(v: string): string | null }): Promise<string | null>
//   - 基于原生 <dialog>.showModal()：浏览器自带焦点锁定和 Esc 关闭。
//   - body 只当纯文本处理（textContent），允许 \n 换行。
//   - danger=true 时确认按钮用强调色，并加「此操作无法撤销」的视觉提示。
//   - 默认焦点：danger 时在取消按钮上，否则在确认按钮上。
//   - 点遮罩、按 Esc 都算取消；关闭后焦点回到打开前的元素。

// src/scripts/ui/toast.ts
toast(text: string, opts?: { kind?: "ok" | "err" | "info"; duration?: number }): void
//   - 右下角堆叠，最多 3 条；默认 3 秒，err 默认 6 秒；鼠标悬停时暂停计时；可以手动关闭。
//   - 容器带 role="status" aria-live="polite"，err 类型用 role="alert"。

// src/scripts/ui/datetime.ts —— 替换 datetime-local，原生 input 保留并隐藏，value 格式不变（YYYY-MM-DDTHH:mm）
enhanceDateTime(input: HTMLInputElement): { refresh(): void }
//   - 点开是浮层：月份切换、7×6 日历网格（周一开头，中文星期）、时和分两个输入框、「现在」和「清空」两个按钮。
//   - 今天：日期数字下面加一个点；选中日：实心强调色背景。
//   - 方向键在日期间移动，PageUp/PageDown 切换月份，回车选中，Esc 关闭。
//   - 显示格式：2026-10-30 22:30（等宽字体）。
```

## 无障碍（必须做到）

- Select 遵循 WAI-ARIA combobox 加 listbox 模式：
  - 按钮带 `role="combobox"`、`aria-expanded`、`aria-controls`、`aria-activedescendant`。
  - 选项带 `role="option"`、`aria-selected`。
  - 键盘：上下方向键移动，Home/End 跳到首尾，回车或空格选中，Esc 关闭，输入字母跳到以它开头的选项（type-ahead）。
- 日历网格带 `role="grid"`，每个日期按钮的 `aria-label` 写完整日期，例如「2026年10月30日 星期五」。
- 所有浮层点外部时关闭，关闭后焦点回到触发它的按钮。
