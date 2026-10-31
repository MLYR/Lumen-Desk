# 重新绑定 Google Authenticator（P2.11）

用户在 2026-10-31 确认：登录控制台后，可以在「设置 → 账号安全」里重新绑定验证器。页面弹出二维码，扫码后输入新验证码确认，绑定完成。

## 0. 设计

- **密钥改存数据库**：新增 `kv.totp_secret`，存放 base32 密钥。
  - 启动时先读 `kv.totp_secret`。没有的话读 `.env` 的 `TOTP_SECRET`。
  - 两边都有时以数据库为准，并在日志里打印一行「TOTP 密钥来自数据库，.env 里的 TOTP_SECRET 已不再使用」。不打印密钥本身。
  - `init-totp` CLI 改为直接写进数据库（加上 `--print-env` 参数时保留旧的输出方式），并且仍然生成恢复码。
  - `deploy/README.md` 补充这一变化：首次部署只需要运行 init-totp，不用再手动把密钥填进 `.env`。
- **数据库里的密钥不能明文存放**：用 `kv.totp_secret` 存加密后的值，`AES-256-GCM`。
  - 加密密钥由环境变量 `SECRET_KEY` 提供（32 字节，base64 编码），新增到 `.env.example`、`config.ts` 和 README。
  - 没有设置 `SECRET_KEY` 时，退回明文存储并打印警告。这样能兼容本机开发。
  - 目的：数据库备份或者 `data/` 目录泄露时，攻击者不能直接拿到密钥。
- **两步提交，旧密钥在确认前一直有效**：
  1. `POST /api/private/security/totp/rebind`，请求体 `{code}`，code 是**当前**验证器上的 6 位码。
     - 必须先通过当前验证器的校验，和重新生成恢复码共用限流、防重放（`lockedFor` → `verifyTotp` → `recordFailure`，中间不能有 await）。原因：会话被盗时，攻击者不能把你的验证器换成他的。
     - 校验通过后，生成新密钥，存进 `kv.totp_pending`（加密，同时记录过期时间，当前时间加 10 分钟）。
     - 返回 `{otpauthUri, qrSvg, secret, expiresAt}`：
       - `qrSvg` 是服务端生成的二维码 SVG，前端用 `<img src="data:image/svg+xml;base64,…">` 显示，**不能**把 SVG 塞进 innerHTML；
       - `secret` 用来在扫不了码时手动输入；
       - 响应带 `Cache-Control: no-store`。
  2. `POST /api/private/security/totp/confirm`，请求体 `{code}`，code 是**新**验证器上的 6 位码。
     - 用 pending 的密钥校验，允许前后各 1 个时间窗口，同样限流。
     - 校验通过后，在一个事务里：把 pending 写进 `totp_secret`，删除 pending，`totp_last_step` 重置为这次新码的 step（防止这个码被重放）。
     - 然后**退出所有其他设备**，当前会话保留。恢复码不变。
     - 进程内的 TOTP 实例要立即替换成新密钥，不用重启。
     - 返回 200 `{ok:true}`。
  3. `DELETE /api/private/security/totp/pending`：取消，删除 pending。
- 第 1 步重复调用时，生成新的 pending 并覆盖旧的。pending 过期后，confirm 返回 410 `pending_expired`。
- 生成二维码：现有的 `qrcode-terminal` 只能输出终端字符画，需要换一个能生成 SVG 的库，比如 `qrcode`（选纯 JS、零原生依赖的）。或者自己写一个小的 QR 编码器。选型由 worker 决定，汇报时说明理由。

## 1. 安全要求（必须测试）

- 没登录访问这几个接口返回 401；写请求要检查 Origin 和 Content-Type。
- rebind 用错误的当前验证码返回 401 `invalid_code`，错 5 次后返回 429，之后登录也被锁定。
- 用当前验证码调用 rebind 之后，这个码不能再拿去登录（防重放）。
- confirm 用旧密钥的验证码要失败，只能用新密钥的码。
- confirm 成功后：
  - 旧密钥生成的验证码不能登录；
  - 新密钥生成的验证码能登录；
  - 其他会话失效，当前会话仍然有效。
- 没有设置 `SECRET_KEY` 时也能工作。设置了以后，数据库里 `totp_secret` 的值不是明文 base32。
- 密钥不能出现在日志里，也不能出现在 rebind 以外的任何响应里。

## 2. 页面（设置 → 账号安全）

- 新增一个「重新绑定验证器」按钮，点了以后打开一个 3 步的弹框（基于 `src/scripts/ui/dialog.ts` 的模态弹框）：
  1. 「输入当前验证器上的 6 位码」，输满 6 位后自动提交。
  2. 显示二维码，200×200，白底，四周留足空白，蓝图主题下也保持白底，保证能扫出来。下面是「扫不了码？手动输入密钥」，点开后显示分组的 secret 和「复制」按钮。再下面是倒计时「10:00 内完成」，以及「输入新验证器上的 6 位码」。
  3. 完成：「已绑定新的验证器，其他设备已退出登录。旧的验证器条目可以删除了。」
- 关闭弹框或点「取消」时调用 DELETE pending。
- 二维码和密钥不能写进 localStorage、URL 或控制台日志，弹框关闭时从 DOM 里删掉。
- 错误码要有中文提示：invalid_code、locked、pending_expired。
