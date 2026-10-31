# 服务器状态卡（P1.5-10 / P2.9）

用户在 2026-10-31 确认：卡片显示当前运行环境的真实信息。在服务器上就是服务器；在本机 Docker（OrbStack）里，显示的是 Docker 虚拟机的信息，并标注「Docker 虚拟机」。Mac 上不额外装任何东西。每 5 秒刷新一次。

## 数据从哪来

api 容器里能直接读到宿主机内核的数据：`/proc/stat`、`/proc/meminfo`、`/proc/loadavg`、`/proc/uptime`。宿主机的系统名称、主机名和网络流量要靠挂载才能读到。compose 里给 api 加三个**只读**挂载，都只是文件，不挂 docker.sock，也不开特权：

```yaml
- /etc/os-release:/host/os-release:ro     # 宿主机的系统名称
- /etc/hostname:/host/hostname:ro         # 宿主机的主机名
- /proc/1/net/dev:/host/net_dev:ro        # 宿主机网络命名空间里的流量计数
```

已在 OrbStack 上实测：`/host/os-release` 里是 `PRETTY_NAME="OrbStack"`，`/host/hostname` 里是 `orbstack`，`/host/net_dev` 里能看到 `eth0` 的真实计数。新增环境变量 `HOST_ROOT=/host`（默认值也是 `/host`）。文件不存在时降级：系统名称显示为容器自己的，网络一栏显示「—」。

## 接口 `GET /api/private/server`（需要登录，Cache-Control: no-store）

在原有字段上增加内容，原字段保持兼容：

```jsonc
{
  "host": { "name": "orbstack", "os": "OrbStack", "kernel": "7.2.12-orbstack…", "arch": "arm64", "virtual": "docker-vm" | "container" | null },
  "cpu":  { "model": "Apple M5" | null, "cores": 10, "usage": 12.3, "load1": 0.5, "load5": 0.4, "load15": 0.3 },
  "mem":  { "total": 0, "used": 0 },
  "swap": { "total": 0, "used": 0 },
  "disk": { "total": 0, "used": 0, "mount": "/data" },
  "net":  { "iface": "eth0", "rxRate": 1234.5, "txRate": 99.1, "rxTotal": 0, "txTotal": 0 } | null,
  "uptime": 0, "hostUptime": 0,
  "services": [
    { "id": "web",   "name": "网站",       "ok": true },
    { "id": "aihot", "name": "AIHOT 同步", "ok": true, "detail": "3 分钟前" },
    { "id": "stats", "name": "访问统计",   "ok": true },
    { "id": "kuma",  "name": "网站监控",   "ok": true }
  ]
}
```

- **CPU 使用率**：后端在内存里保存上一次读到的 `/proc/stat` 和时间戳，用两次的差值算。第一次请求时，等 200ms 再采一次。多个请求同时到达时共用同一个采样，避免短时间重复读取。
- **网络速率**：用 `/host/net_dev` 前后两次采样的差值除以时间。网卡自动选择：去掉 `lo`、`docker*`、`br-*`、`veth*` 之后，取累计流量最大的那一块。计数器回绕或重置时，速率记为 0。
- **CPU 型号**：从 `/proc/cpuinfo` 里读 `model name` 或 `Hardware`。arm 虚拟机上常常读不到，这时返回 null，前端不显示型号。
- **virtual 判定**：`os-release` 里含 OrbStack 或 Docker Desktop，或者 `/host/hostname` 是 `orbstack` 或 `docker-desktop`，就是 `docker-vm`。`/host` 挂载不存在、只能看到容器自身时，是 `container`。其他情况为 null，也就是真实的服务器。
- **services**：
  - `web` 只要接口能响应就是 ok；
  - `aihot` 看 `aihot_cache` 的 checked_at 或 fetched_at：30 分钟以内算 ok，detail 写「N 分钟前」；
  - `stats`：api 请求 `http://caddy/u/script.js`。Caddy 和 api 在同一个 default 网络里，Umami 隔离在 stats 网络里，所以要通过 Caddy 访问。返回 200 就算 ok。
    - 备案后 `SITE_ADDRESS` 会改成域名，Caddy 只接受带这个域名的 Host 请求，而且会自动跳转 HTTPS。所以探测时要带 `Host: <SITE_URL 里的主机名>`，并且不跟随重定向：返回 200 或 308 都算 Caddy 可达，再进一步判断。如果实现起来太复杂，可以改成在 Caddyfile 里给 Caddy 加一个只在内网监听的 `:8090` 站点，只代理 `/u/script.js`；但这样需要改 deploy，汇报时要说明。
  - `kuma`：api 请求 `http://uptime-kuma:3001/`。它们在同一个 default 网络里，返回 2xx 或 3xx 就算 ok。
  - 两项探测的超时都是 1.5 秒，结果缓存 30 秒。
  - **不要**为了探测把 api 加进 stats 网络。
- 这个接口不能返回任何秘密，也不能返回容器的环境变量。

## 卡片（apps/web）

```
服务器                                   [Docker 虚拟机] ← 只在 virtual 不为 null 时显示，用强调色描边小标签
orbstack · OrbStack · arm64 · 10 核 Apple M5          ← 一行等宽字体，太长时省略号截断，title 里放完整内容
[CPU 12%] [内存 43%] [磁盘 58%] [交换 0%]              ← 保留现在的环形或条形样式，4 格
↓ 12.3 KB/s  ↑ 1.1 KB/s   累计 ↓ 1.9 GB ↑ 2.1 GB     ← 速率、累计流量
负载 0.50 / 0.40 / 0.30   主机已运行 5 天 0 小时   API 已运行 3 小时
● 网站  ● AIHOT 同步 3 分钟前  ● 访问统计  ● 网站监控      ← 绿点是正常，红点是异常
```

- 每 5 秒刷新一次。页面切到后台（`document.hidden`）时暂停，切回来时立刻刷新一次。请求失败时显示「—」，不弹 toast。
- 数字变化时不做闪烁动画，`prefers-reduced-motion` 时不做任何过渡。
- 两套主题、1440 和 375 宽度都不能有横向溢出。卡片宽度是 span-4，一行放不下的内容要换行。
