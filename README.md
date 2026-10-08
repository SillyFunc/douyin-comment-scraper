# 评论号码台

基于 Tauri + React 的抖音公开视频评论三位数统计工具。粘贴完整分享文案或视频链接后，程序使用本机 Chrome 登录资料读取网页实际加载的评论，筛选 000–999 的三位号码并汇总出现次数。

## 运行桌面界面

需要 Windows、Google Chrome、Node.js 和 Rust/Tauri 开发环境。安装依赖后运行：

```powershell
pnpm install
npm run tauri -- dev
```

界面中可选择“尽量读取完整顶层评论”或“快速查看”，按评论发布时间和最小出现次数筛选，并查看号码频次；同一条评论中的同一号码只计一次。修改条件后可直接重新统计已保存的评论，无须重新访问网页。登录失效时可从界面打开扫码窗口。结果会保存为 TXT、CSV、JSON，可点击“打开报表文件夹”查看。开发模式下会优先显示此前命令行采集的结果。

桌面应用目前调用 Node.js + Playwright Core，并使用本机 Chrome；打包资源包含脚本和 Playwright Core，但运行机器仍需安装 Node.js 与 Chrome。登录资料保存在 `%LOCALAPPDATA%\douyin-comment-scraper\phase1-chrome-profile`，报告保存在应用数据目录，不写入安装目录。

筛选口径、命令行用法与实际采集边界见 [三位数统计说明](docs/number-statistics.md)。分享链接、网页登录和资料复用的第一阶段验证见 [第一阶段记录](docs/phase1-verification.md)。
