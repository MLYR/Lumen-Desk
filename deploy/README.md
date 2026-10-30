# 部署说明

服务器：腾讯云轻量（上海）。结构：Caddy 做入口和静态文件，api 容器只在内部网络监听 3000。

## 目录结构

```
/opt/lumen-desk/
├── docker-compose.yml
├── Caddyfile
├── .env                 # 密钥，只放服务器
├── web/
│   ├── public/          # apps/web/dist（公开）
│   └── private/         # apps/web/dist-private（控制台）
└── data/                # SQLite、书签数据（api 的 /data）
```

## 首次部署

1. 装 Docker 和 Compose 插件，然后配置镜像加速（见下面"Docker 镜像加速"）。
2. 建目录并放入配置：

   ```bash
   sudo mkdir -p /opt/lumen-desk/{web/public,web/private,data}
   sudo chown -R $USER /opt/lumen-desk
   ```

3. 复制 `deploy/.env.example` 为 `/opt/lumen-desk/.env`，此时 `TOTP_SECRET` 留空。
4. 生成 TOTP 密钥（只需做一次）：

   ```bash
   cd /opt/lumen-desk
   docker compose run --rm api node dist/cli/init-totp.js
   ```

   终端会打印二维码，用 Google Authenticator 扫码。同时会显示 10 个一次性恢复码，离线保存好，只显示一次。
   把脚本输出的 `TOTP_SECRET` 手动填进 `.env`。
5. 首次启动：

   ```bash
   docker compose up -d
   ```

   Caddy 镜像 `caddy:2-alpine` 需要从 Docker Hub 拉取。如果拉不动，先配置镜像加速再执行。

## 导入书签

书签是私人数据，导出文件不进 Git。

```bash
scp ~/Downloads/bookmarks.html 服务器:/tmp/bookmarks.html
ssh 服务器
cd /opt/lumen-desk
docker compose run --rm -v /tmp/bookmarks.html:/tmp/b.html:ro api node dist/cli/import-bookmarks.js /tmp/b.html
rm /tmp/bookmarks.html
```

## 作废所有登录会话

登录会话存在 SQLite 里。怀疑泄露时执行：

```bash
cd /opt/lumen-desk
docker compose run --rm api node dist/cli/revoke-sessions.js
```

登录被锁（同一 IP 失败 5 次，或全站一小时失败超过 30 次）时，可以手动解锁。全站暂停期间恢复码仍可登录。

```bash
docker compose run --rm api node dist/cli/unlock-logins.js
```

## 更新

推送到 `main` 分支后，GitHub Actions（`.github/workflows/deploy.yml`）会自动构建并部署。CI 上传的内容包括：

- 前端静态文件（`web/public`、`web/private`）
- `Caddyfile` 和 `docker-compose.yml`
- api 镜像（以 tar.gz 形式传输，不依赖服务器访问 Docker Hub）

服务器上的 `.env`、`data/` 不会被 CI 覆盖。

需要在 GitHub 仓库里配置：

- Variables：`DEPLOY_ENABLED=true`
- Secrets：`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`、`DEPLOY_KNOWN_HOSTS`

也可以在 Actions 页面手动运行 `workflow_dispatch`。

## Docker 镜像加速

国内服务器直连 Docker Hub 和 GitHub 容易超时。在服务器上配置一个可用的镜像源，例如 `/etc/docker/daemon.json`：

```json
{
  "registry-mirrors": ["https://mirror.ccs.tencentyun.com"]
}
```

改完后执行 `sudo systemctl restart docker`。`mirror.ccs.tencentyun.com` 是腾讯云内网镜像源，只在腾讯云服务器上可用。

## 注意

- 生产镜像不含 `tsx`，所以容器里用 `node dist/cli/*.js` 运行脚本；本地开发用 `pnpm --filter api init-totp` 等命令。
- `TOTP_SECRET`、恢复码、`.env`、书签数据、`data/` 都不进 Git。
- 备案前 `SITE_ADDRESS=:80`，用 IP 访问。备案后把 `SITE_ADDRESS` 改成域名，`COOKIE_SECURE` 改为 `true`，然后 `docker compose up -d` 重新加载。
- 在 `COOKIE_SECURE=false` 的纯 HTTP 阶段，验证码和会话 Cookie 都是明文传输。这段时间尽量不在公共网络登录控制台，或用 SSH 隧道访问。
