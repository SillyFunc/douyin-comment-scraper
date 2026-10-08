# 评论号码台

基于 Tauri + React 的抖音公开视频评论三位数统计工具。粘贴完整分享文案或视频链接后，程序使用本机 Chrome 登录资料读取网页实际加载的评论，筛选 000–999 的三位号码并汇总出现次数。

## 运行桌面界面

需要 Windows、Google Chrome、Node.js 和 Rust/Tauri 开发环境。安装依赖后运行：

```powershell
pnpm install
npm run tauri -- dev
```

界面默认滚动到网页提示顶层评论没有更多，按评论发布时间和最小出现次数筛选，并查看号码频次；同一条评论中的同一号码只计一次。修改条件后可直接重新统计已保存的评论，无须重新访问网页。登录失效时可从界面打开扫码窗口。结果会保存为 TXT、CSV、JSON，可点击“打开报表文件夹”查看。开发模式下会优先显示此前命令行采集的结果。

桌面应用通过 Playwright Core 运行浏览器采集。普通安装包使用本机 Node.js 和 Chrome；便携版自带 Node.js、Chromium 和 WebView2，无需单独安装这三项运行环境。登录资料保存在 `%LOCALAPPDATA%\douyin-comment-scraper\phase1-chrome-profile`，报告保存在应用数据目录，不写入程序目录。

Windows 安装包通过 `npm run tauri -- build --bundles nsis` 构建，输出在 `src-tauri/target/release/bundle/nsis/`。从 0.1.1 起，安装包内含 WebView2 离线安装器；普通安装包仍需另行安装 Node.js 和 Chrome。

## 构建便携版

在 Windows x64 构建机器上运行 `npm run portable:build`。脚本会从 Node.js 和微软官方来源下载、校验并打包 Node.js 与 WebView2 固定版本，再按当前 Playwright 版本下载 Chromium。输出在 `src-tauri/target/portable-dist/评论号码台_<版本>_portable_x64.zip`。将整个 ZIP 解压到本地磁盘上的普通文件夹，双击其中的 `douyin-review-scraper.exe`；不要直接在压缩包预览界面运行。便携版较大，首次启动会配置内置 WebView2 在 Windows 10 上所需的文件读取权限。便携版的 WebView2 固定版本需要随新版压缩包更新。

筛选口径、命令行用法与实际采集边界见 [三位数统计说明](docs/number-statistics.md)。分享链接、网页登录和资料复用的第一阶段验证见 [第一阶段记录](docs/phase1-verification.md)。
