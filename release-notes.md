# Release Notes

每次发布前，在与 `package.json` 版本号一致的 `## v版本号` 小节中手动填写更新内容。
发布流程会将该小节正文写入 GitHub Release；不要在版本小节内使用二级标题，分类使用三级标题。
操作步骤见 [发布说明](docs/releases/README.md)。

## v0.1.1

- 修复：补齐打包遗漏的运行依赖，解决启动时报找不到 zod 的问题。
- 发布：提供 macOS Apple Silicon、Intel 和 Windows x64 安装包。

### 下载与安装

- macOS：选择对应芯片的 DMG 或 ZIP；此版本为 ad-hoc 签名，未经 Apple 公证，系统可能阻止打开。
- Windows x64：提供安装版 EXE、解压即用 ZIP 和便携版 EXE；未使用付费代码签名证书。
- 更新需要手动下载安装；此流程不包含应用内自动更新。

## v0.1.0

- 首次发布 macOS Apple Silicon 预览版。
- 支持 AI 英语问答、本地 Markdown 学习笔记、发音播放和 Anki 卡片生成与导出。
- 完整历史说明见 https://github.com/Bern3rsH/EnglishAsk/releases/tag/v0.1.0 。
