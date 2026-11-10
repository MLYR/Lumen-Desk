# Vendored assets

图片压缩工具不连接 CDN，下面这些文件随站点一起发布。升级时替换文件并同步更新版本号。

| 文件 | 版本 | 来源 | 许可 |
| --- | --- | --- | --- |
| `pyodide/` | 0.26.4 | <https://github.com/pyodide/pyodide/releases/tag/0.26.4> | MPL-2.0（见 `pyodide/LICENSE`） |
| `pyodide/pillow-10.2.0-…whl` | 10.2.0 | Pyodide 0.26.4 包仓库 | Pillow MIT-CMU（见 wheel 内 `Pillow-10.2.0.dist-info/LICENSE`） |
| `jszip.min.js` | 3.10.1 | <https://github.com/Stuk/jszip/releases/tag/v3.10.1> | MIT / GPLv3（见 `JSZIP-LICENSE.markdown`） |

`pyodide/` 只保留运行 Pillow 需要的核心文件：`pyodide.js`、`pyodide.asm.js`、`pyodide.asm.wasm`、`python_stdlib.zip`、`pyodide-lock.json` 和 Pillow wheel。
