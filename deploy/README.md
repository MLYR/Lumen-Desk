# 部署说明

服务器：腾讯云轻量（上海，4 核 4G，3 Mbps）。结构：

- Caddy 做入口，提供静态文件和上传的图片；
- api 容器只在内部网络监听 3000，负责登录、书签、博客页面；
- Umami（访问统计）和它的 Postgres 数据库；
- Uptime Kuma（网站监控）。

不使用对象存储和 CDN，所有文件都走服务器自己的带宽。

## 目录结构

```
/opt/lumen-desk/
├── docker-compose.yml
├── Caddyfile
├── .env                 # 密钥，只放服务器（api 和 caddy 用）
├── umami.env            # Umami 的数据库密码和签名密钥，只放服务器（只有 umami、umami-db 读取）
├── web/
│   ├── public/          # apps/web/dist（公开）
│   ├── private/         # apps/web/dist-private（控制台）
│   └── shell/           # apps/web/dist-shell（博客页面外壳，挂进 api 容器的 /srv/shell）
└── data/                # api 的 /data：SQLite、书签数据
    └── uploads/         # 博客上传的图片（api 可写，Caddy 只读，网址是 /uploads/…）
```

Docker 卷（不在目录里）：`caddy_data`（证书）、`umami_db`（Umami 数据库）、`kuma_data`（Uptime Kuma 数据）。

### 网络隔离

- `default` 网络：caddy、api、uptime-kuma。
- `stats` 网络：caddy、umami、umami-db。api 和 uptime-kuma 不在里面，所以 Uptime Kuma 的管理员（它能让服务器去访问任意地址）访问不到 Umami 和它的数据库。
- 只有 caddy 对外发布端口。

### 端口

| 端口 | 用途 |
| --- | --- |
| 80、443 | 主站（备案前只用 80） |
| 8081 | Umami 后台（先过 Caddy 的 basic_auth，再到 Umami 自己的登录页） |
| 8082 | Uptime Kuma 后台（同上） |

访客的统计数据不走 8081，而是走主站同源的 `/u/script.js` 和 `/u/api/send`（见下面「Umami 访问统计」），所以 8081 只有你自己用。

## 腾讯云防火墙

在腾讯云控制台 → 轻量应用服务器 → 防火墙里放行：

- 现在：TCP 80、443（22 默认已开）。
- 要用 `http://IP:8081`、`http://IP:8082` 打开后台时，再放行 TCP 8081、8082。最好把这两条规则的来源限制成自己的 IP。绑定域名以后后台改走 80/443（子域名），这两个端口可以关掉。

两个后台都有两道密码（Caddy 的 basic_auth，再加 Umami、Kuma 自己的登录），但备案前走的是明文 HTTP，密码会明文传输。尽量不要在公共 WiFi 上登录。


## 本机 Docker 部署

和服务器部署步骤相同，区别是：

- 目录用 `~/lumen-desk/`（放在仓库外面，避免误提交 `.env` 和数据）。
- `docker-compose.yml` 里的 `build.context` 改成仓库的绝对路径，删掉 443 端口映射。
- 建目录：`mkdir -p ~/lumen-desk/{web/public,web/private,web/shell,data/uploads}`。
- `.env` 里 `SITE_ADDRESS=:80`、`SITE_URL=http://localhost`、`COOKIE_SECURE=false`，并填好 `ADMIN_USER`、`ADMIN_PASSWORD_HASH`（见下面「生成后台登录密码」），再复制 `umami.env.example` 为 `umami.env` 并填好。这几项没填 `docker compose` 会直接报错。
- 本机只想跑主站时，可以只启动需要的服务：`docker compose up -d caddy api`。
- `data/uploads` 要让 api 容器里的 node 用户（uid 1000）可写。Docker Desktop（macOS）一般不用处理；Linux 本机执行 `sudo chown 1000:1000 data/uploads`。
- 打开 <http://localhost>。
- 本机加 Umami 统计：构建网页时带上变量：`PUBLIC_UMAMI_SRC=/u/script.js PUBLIC_UMAMI_WEBSITE_ID=<网站ID> pnpm --filter web build`，再把产物 rsync 进 `web/`。
- Uptime Kuma 里的内部地址用容器名：`http://api:3000/api/healthz`、`http://caddy/`。它们在宿主机浏览器里打不开，是正常的。
- 更新网页时，用 `rsync -a --delete` 覆盖 `web/public`、`web/private`、`web/shell` 的内容，不要删掉目录再重建。删掉重建后 Caddy 容器还挂着旧目录，会返回 404，只能 `docker compose restart caddy`。

## 首次部署

1. 装 Docker 和 Compose 插件，然后配置镜像加速（见下面"Docker 镜像加速"）。
2. 建目录并放入配置：

   ```bash
   sudo mkdir -p /opt/lumen-desk/{web/public,web/private,web/shell,data/uploads}
   sudo chown -R $USER /opt/lumen-desk
   # 博客上传的图片由 api 容器里的 node 用户（uid 1000）写入，所以这个目录要归 1000。
   sudo chown 1000:1000 /opt/lumen-desk/data/uploads
   ```

   之后用 GitHub Actions 部署时，这一步会自动做，不用再手动执行。

3. 复制 `deploy/.env.example` 为 `/opt/lumen-desk/.env`，此时 `TOTP_SECRET` 留空。按下面「生成后台登录密码」填好 `ADMIN_USER` 和 `ADMIN_PASSWORD_HASH`。
4. 复制 `deploy/umami.env.example` 为 `/opt/lumen-desk/umami.env`，生成并填好 Umami 的数据库密码和签名密钥：

   ```bash
   cd /opt/lumen-desk
   PW=$(openssl rand -hex 16)
   cat > umami.env <<EOF
   POSTGRES_PASSWORD=$PW
   DATABASE_URL=postgresql://umami:$PW@umami-db:5432/umami
   APP_SECRET=$(openssl rand -hex 32)
   EOF
   chmod 600 umami.env
   ```

   这个文件只有 `umami` 和 `umami-db` 两个容器读取，api 读不到。CI 不会覆盖它。

5. 生成 TOTP 密钥（只需做一次）：

   ```bash
   cd /opt/lumen-desk
   docker compose run --rm api node dist/cli/init-totp.js
   ```

   终端会打印二维码，用 Google Authenticator 扫码。同时会显示 10 个一次性恢复码，离线保存好，只显示一次。
   把脚本输出的 `TOTP_SECRET` 手动填进 `.env`。
6. 首次启动：

   ```bash
   docker compose up -d
   ```

   第一次会拉取 `caddy:2-alpine`、`postgres:16-alpine`、`umamisoftware/umami`、`louislam/uptime-kuma` 四个镜像，都在 Docker Hub 上。如果拉不动，先配置镜像加速再执行。

   用 GitHub Actions 部署的话，这一步由 CI 完成（见下一节），不用手动执行。

## 生成后台登录密码

Umami（8081）和 Uptime Kuma（8082）两个后台前面有一道 Caddy 的 basic_auth，账号密码从 `.env` 的 `ADMIN_USER`、`ADMIN_PASSWORD_HASH` 读。这道门的目的是：自动部署完成到你去改默认密码、建管理员之间有一段空档，没有这道门，别人先打开页面就能接管。

`.env` 里存的是 bcrypt 哈希，不是明文密码。生成方法（在服务器或本机都行，需要 Docker）：

```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext '你的密码'
```

输出形如 `$2a$14$…`。把它写进 `.env`，**整个值必须用单引号包起来**：

```
ADMIN_USER=admin
ADMIN_PASSWORD_HASH='$2a$14$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
```

原因：`docker compose` 会把 `.env` 里的 `$…` 当变量替换。实测过：单引号包起来原样保留（`config` 输出里 `$` 显示成 `$$` 是 compose 自己的转义，容器里拿到的是原值）；不加引号或加双引号，哈希会被截坏，登录永远失败。也可以不加引号，改成把每个 `$` 写成 `$$`，效果相同。

密码用密码管理器生成一个长的。没填 `ADMIN_USER` 或 `ADMIN_PASSWORD_HASH` 时 `docker compose up` 会直接报错，后台不会不带保护地启动。

## 导入书签

书签是私人数据，导出文件不进 Git。书签存在 SQLite（`data/lumen.db`）里，平时直接在控制台收藏夹卡片的「管理」菜单里导入、导出就行。下面的命令行方式在没法登录控制台时用。

```bash
scp ~/Downloads/bookmarks.html 服务器:/tmp/bookmarks.html
ssh 服务器
cd /opt/lumen-desk
# 默认「替换全部」：原来的书签整体换成文件里的。
docker compose run --rm -v /tmp/bookmarks.html:/tmp/b.html:ro api node dist/cli/import-bookmarks.js /tmp/b.html
# 或者「合并」：加到一个新文件夹「导入 YYYY-MM-DD」里，原来的不动。
docker compose run --rm -v /tmp/bookmarks.html:/tmp/b.html:ro api node dist/cli/import-bookmarks.js /tmp/b.html --merge
rm /tmp/bookmarks.html
```

- 两种方式都会先把原来的书签存一份快照（最多保留 10 份），导错了可以在控制台「管理 → 快照列表」里恢复。
- 命令只打印文件夹数和链接数，不打印书签内容。文件超过 32 层嵌套或 20000 条时会拒绝导入，数据库不变。
- 从旧版本升级：第一次启动时，如果数据库里还没有书签，api 会把 `data/bookmarks.json` 导入数据库，然后改名为 `data/bookmarks.json.migrated`（不删除，确认无误后可以手动删）。导入失败时会回滚，原文件不动，下次启动再试。

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

## 开启自动部署（GitHub Actions）

开启后，每次推送到 `main` 分支，GitHub 会自己测试、构建，然后通过 SSH 把文件传到服务器并重启服务，最后访问一次 `/api/healthz` 确认服务正常。

CI 会上传：

- 前端静态文件（`web/public`、`web/private`、`web/shell`）
- `Caddyfile` 和 `docker-compose.yml`
- api 镜像（以 tar.gz 形式传输，不依赖服务器访问 Docker Hub）

服务器上的 `.env`、`umami.env`、`data/` 不会被 CI 覆盖。第三方镜像（Caddy、Umami、Postgres、Uptime Kuma）由服务器自己拉取，所以要先配好下面的"Docker 镜像加速"。

下面的步骤只需要做一次。命令里的 `服务器IP` 换成实际的 IP。

### 1. 在服务器上建一个专门的部署用户

用你现在的账号登录服务器（以 Ubuntu 为例）：

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo mkdir -p /opt/lumen-desk
sudo chown -R deploy:deploy /opt/lumen-desk
```

这个用户没有密码，只能用密钥登录，也没有 `sudo` 权限。加入 `docker` 组后它可以运行 Docker，这等于拥有服务器的高权限，所以密钥一定要保管好。

如果 `/opt/lumen-desk` 里已有手动部署的内容，上面的 `chown -R` 会把它们的所有者改成 `deploy`，这是预期的。`data/uploads` 会在第一次部署时被自动改回 uid 1000。

### 2. 在自己电脑上生成专用密钥

```bash
ssh-keygen -t ed25519 -f ~/.ssh/lumen-desk-deploy -N "" -C "lumen-desk-deploy"
```

会生成两个文件：`lumen-desk-deploy`（私钥，不能给别人）和 `lumen-desk-deploy.pub`（公钥）。这对密钥只用于部署，不要拿去干别的。

### 3. 把公钥放到服务器上

```bash
ssh-copy-id -i ~/.ssh/lumen-desk-deploy.pub deploy@服务器IP
```

如果 `deploy` 没有密码，`ssh-copy-id` 登不上去，就改用现在的账号手动放：

```bash
cat ~/.ssh/lumen-desk-deploy.pub | ssh 你的账号@服务器IP \
  "sudo -u deploy mkdir -p /home/deploy/.ssh && sudo -u deploy tee -a /home/deploy/.ssh/authorized_keys >/dev/null && sudo chmod 700 /home/deploy/.ssh && sudo chmod 600 /home/deploy/.ssh/authorized_keys"
```

验证能登录：

```bash
ssh -i ~/.ssh/lumen-desk-deploy deploy@服务器IP "docker ps"
```

能看到容器列表（可能是空的）就对了。

### 4. 生成 known_hosts

`known_hosts` 记录服务器的"指纹"，防止 CI 连到冒充的服务器：

```bash
ssh-keyscan -t ed25519 服务器IP > /tmp/known_hosts
cat /tmp/known_hosts
```

如果你担心这一步被中间人干扰，可以登录服务器执行 `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`，核对指纹和本地 `ssh-keygen -lf /tmp/known_hosts` 显示的一致。

### 5. 把配置填进 GitHub 仓库

先确认 `gh` 已登录（`gh auth status`），然后在仓库目录下执行：

```bash
gh secret set DEPLOY_HOST --body "服务器IP"
gh secret set DEPLOY_USER --body "deploy"
gh secret set DEPLOY_SSH_KEY < ~/.ssh/lumen-desk-deploy
gh secret set DEPLOY_KNOWN_HOSTS < /tmp/known_hosts
gh variable set DEPLOY_ENABLED --body "true"
```

四个 Secrets 的作用：

| 名称 | 内容 |
| --- | --- |
| `DEPLOY_HOST` | 服务器 IP（备案后可以是域名） |
| `DEPLOY_USER` | 部署用户名，上面建的 `deploy` |
| `DEPLOY_SSH_KEY` | 私钥文件的完整内容 |
| `DEPLOY_KNOWN_HOSTS` | 上一步生成的 known_hosts 内容 |

`DEPLOY_ENABLED` 是总开关，不设或设为别的值时只构建和测试，不部署。

做完后可以删掉本地的临时文件：`rm /tmp/known_hosts`。私钥 `~/.ssh/lumen-desk-deploy` 留着，以后换密钥时要用。

### 6. 在服务器上准备 `.env` 和 `umami.env`

CI 不会创建这两个文件。第一次部署前，按"首次部署"里的第 3、4、5 步，在 `/opt/lumen-desk/` 下填好 `.env`（含 `TOTP_SECRET`、`ADMIN_USER`、`ADMIN_PASSWORD_HASH`）和 `umami.env`。缺任何一项，`docker compose up` 会报错，部署会失败。

### 7. 第一次运行

```bash
gh workflow run deploy
gh run watch
```

之后每次推送到 `main` 会自动运行。运行结果在仓库的 Actions 页面看。

### 部署做了什么

1. 在 GitHub 上跑测试，构建前端和 api 镜像。
2. 用 rsync 把静态文件同步到 `web/public`、`web/private`、`web/shell`。
3. 上传 `Caddyfile`、`docker-compose.yml` 和 api 镜像，在服务器上加载镜像。
4. 确保 `data/uploads` 存在，并且归 uid 1000（api 容器的 `node` 用户）所有。做法：用 api 镜像里的 root 执行一次 `chown 1000:1000`，不需要 `sudo`。
5. `docker compose pull --ignore-pull-failures` 拉第三方镜像（拉失败时沿用服务器上已有的版本），再 `docker compose up -d`。
6. 冒烟检查：在服务器上访问 `http://127.0.0.1/api/healthz`（最多重试 1 分钟），并确认 api 容器的健康状态是 `healthy`。失败则整个 workflow 变红。备案后站点地址换成域名，Caddy 对 `127.0.0.1` 的请求不再返回 api 的内容（可能是跳转或空响应），单看 `curl` 可能误判，所以另外加了容器健康状态这一项。

### 出问题怎么办

- **SSH 连不上 / Host key verification failed**：`DEPLOY_HOST` 或 `DEPLOY_KNOWN_HOSTS` 不对，重新做第 4、5 步。服务器重装系统后指纹会变，也要重做。
- **`permission denied` 访问 docker**：`deploy` 没在 `docker` 组里，重新登录一次，或重启 SSH 会话。
- **拉镜像超时**：配置"Docker 镜像加速"，或在 `.env` 里用 `UMAMI_IMAGE`、`KUMA_IMAGE` 换镜像源。
- **想暂停自动部署**：`gh variable set DEPLOY_ENABLED --body "false"`。

## Umami 访问统计

访客浏览器只连主站：统计脚本是 `/u/script.js`，上报地址是 `/u/api/send`（Umami 的脚本会把"脚本所在目录"当作上报地址）。Caddy 在主站上只放行这两个路径，其他 `/u/*`（包括 Umami 的后台和接口）一律返回 404。后台只能从 8081 端口进。

首次设置：

1. 打开 `http://服务器IP:8081`。浏览器先弹出 basic_auth 窗口，输入 `.env` 里 `ADMIN_USER` 对应的明文密码。
2. 再到 Umami 自己的登录页，用默认账号 `admin`、密码 `umami` 登录。
3. **立刻改密码**：右上角头像 → Profile → Change password。默认密码是公开的。
4. 设置 → Websites → Add website，名称随意，域名填服务器 IP。创建后点进去，复制网站 ID（形如 `xxxxxxxx-xxxx-…` 的一串）。
5. 把脚本地址和网站 ID 填进仓库变量：

   ```bash
   gh variable set PUBLIC_UMAMI_SRC --body "/u/script.js"
   gh variable set PUBLIC_UMAMI_WEBSITE_ID --body "上一步复制的网站ID"
   ```

6. 重新运行一次部署（`gh workflow run deploy`），因为这两个变量是在构建网页时写进页面的。

`PUBLIC_UMAMI_SRC` 用相对路径，所以备案后改成 https 域名不用改这个变量，也不用改 CSP。两个变量都有值，公开页面才会插入统计脚本；登录页和控制台不插入。

镜像：默认用 Docker Hub 的 `umamisoftware/umami:3.4.1`（国内镜像加速能拉到）。拉不动时，在 `.env` 里加 `UMAMI_IMAGE=ghcr.io/umami-software/umami:3.4.1` 换成 GitHub 的镜像仓库，再 `docker compose up -d`。升级版本时同时改 `docker-compose.yml` 里的默认标签，并先看 Umami 的发布说明里是否需要迁移数据库。

数据库是同一个 compose 里的 `umami-db`（Postgres 16，卷 `umami_db`），和 umami 一起在 `stats` 网络里。内存上限：Umami 384 MB，Postgres 256 MB。

## Uptime Kuma 状态监控

> **安全提醒**：Uptime Kuma 第一次打开时会让"第一个访问的人"创建管理员账号，而且管理员能让服务器去访问任意地址（包括内网）。所以 8082 前面加了 Caddy 的 basic_auth，不知道密码的人到不了 Kuma 的页面。但部署成功后仍请**尽快**打开页面建好管理员，不要让它一直处于"待创建"状态。

1. 打开 `http://服务器IP:8082`，先过 basic_auth 窗口（和 Umami 同一个账号密码）。
2. 如果出现"选择数据库"，选 **SQLite**（占内存少；内嵌 MariaDB 在 256 MB 内存上限下容易被杀）。
3. 创建管理员账号，设一个强密码，保存好。
4. 建议添加的监控项（间隔 60 秒）：

   | 名称 | 类型 | 地址 | 说明 |
   | --- | --- | --- | --- |
   | api 内部 | HTTP(s) | `http://caddy/api/healthz` | 容器内部检查 Caddy 到 api 的链路 |
   | 主站公网 | HTTP(s) | `http://服务器IP/` | 从外部看主站能不能打开（备案后改成域名） |
   | 公网接口 | HTTP(s) | `http://服务器IP/api/healthz` | 公网到 api 是否正常 |

5. 设置 → Notifications 里添加通知方式（邮件、Telegram 等），并在每个监控项里勾选。

Uptime Kuma 和 api 在同一个网络，但不在 `stats` 网络，访问不到 Umami 和它的数据库。

注意：Uptime Kuma 装在同一台服务器上，整台机器宕机时它也一起挂，不会发出通知。

镜像：`louislam/uptime-kuma:2.5.8`（Docker Hub）。可以用 `.env` 里的 `KUMA_IMAGE` 覆盖。内存上限 256 MB。

## 内容安全策略（CSP）

主站所有页面的响应头里有 `Content-Security-Policy`（在 `Caddyfile` 里，P1.5-5）。当前 `script-src` 带 `'unsafe-inline'`，因为 Astro 页面里有内联的主题脚本。

后续收紧：把内联脚本算成 sha256 哈希，写成 `script-src 'self' 'sha256-…'`，然后去掉 `'unsafe-inline'`。Umami 和 Uptime Kuma 的站点块不加 CSP，它们的后台页面自己需要内联脚本。

统计脚本走主站同源的 `/u/script.js`，所以 `script-src`、`connect-src` 不需要放行外部域名。`img-src` 放行了 `https:`，文章里可以引用外部图片，省服务器带宽。

`/uploads/*` 单独设置 `default-src 'none'`，浏览器直接打开图片地址时不会执行任何内容。

## 备案后切换到域名

ICP 备案拿到号之前，全部用 IP 走 HTTP 访问。备案通过后：

1. **DNS**：在域名服务商添加三条 A 记录，都指向服务器 IP：`@`（或 `www`）、`stats`、`status`。
2. **防火墙**：确认 80、443 已放行。原来的 8081、8082 可以关掉。
3. 改服务器上的 `/opt/lumen-desk/.env`：

   ```
   SITE_ADDRESS=your.domain
   SITE_URL=https://your.domain
   COOKIE_SECURE=true
   STATS_ADDRESS=stats.your.domain
   STATUS_ADDRESS=status.your.domain
   ```

   `ADMIN_USER`、`ADMIN_PASSWORD_HASH` 不用改。统计脚本是同源的 `/u/script.js`，不需要改 `PUBLIC_UMAMI_SRC`，也没有 https 混合内容的问题。

4. 让配置生效：重新运行一次部署（`gh workflow run deploy`），或在服务器上 `cd /opt/lumen-desk && docker compose up -d`。

5. 在 Uptime Kuma 里把监控地址从 IP 改成域名；Umami 里网站的域名也改成新域名。内部监控 `http://caddy/api/healthz` 在站点地址变成域名后会失效（Caddy 只响应域名），改成 `https://your.domain/api/healthz`。
6. Caddy 会自动申请并续期 HTTPS 证书。证书申请要求域名已解析到服务器，且 80、443 可从外网访问。
7. 改 Cookie 前缀（P1.5-4）要和 HTTPS 一起上线，见 `docs/ROADMAP.md`。
8. `docker-compose.yml` 里 `8081:8081`、`8082:8082` 的端口映射在切域名后不再需要，可以删掉。

`DEPLOY_HOST` 用域名或 IP 都可以；换成域名时要重新生成 `DEPLOY_KNOWN_HOSTS`。

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
- `TOTP_SECRET`、恢复码、`.env`、`umami.env`、书签数据、`data/` 都不进 Git。
- 备案前 `SITE_ADDRESS=:80`，用 IP 访问。备案后的完整步骤见上面的「备案后切换到域名」。
- 在 `COOKIE_SECURE=false` 的纯 HTTP 阶段，验证码和会话 Cookie 都是明文传输。这段时间尽量不在公共网络登录控制台，或用 SSH 隧道访问。
