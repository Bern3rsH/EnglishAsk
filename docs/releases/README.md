# 打包与发布

与 FenyiDic 一样，手动维护根目录 `release-notes.md`，推送版本标签触发 GitHub Actions，也支持手动选择标签运行 Release workflow。

## 发布步骤

1. 执行 `npm version 0.1.2 --no-git-tag-version`（替换为实际新版本），同步更新 `package.json` 和 `package-lock.json`。
2. 在 `release-notes.md` 增加对应的 `## v0.1.2` 小节，手动填写本次更新。分类使用 `###`；缺失、重复或空白版本小节会阻止发布。
3. 执行 `npm run release:notes` 和 `npm run test:release`，核对提取内容并验证发布工具。
4. 提交本次代码、版本文件及更新说明，推送提交，然后执行 `git tag v0.1.2` 和 `git push origin v0.1.2`。
5. 在 GitHub Actions 的 Release 流程查看构建结果。两平台成功后，流程先创建草稿，上传并校验八个附件及更新说明，再公开 Release。

首次接入时，需要把 `.github/workflows/release.yml` 和配套脚本一并提交并推送。现有版本为 `0.1.1`，已经有对应的更新说明；以上 `0.1.2` 仅为下一版本示例。不要移动已发布的标签。

## 产物

- macOS ARM64 / x64：每个架构提供 DMG 和 ZIP。
- Windows x64：可选安装目录的安装版 EXE、ZIP、便携版 EXE，文件名互不冲突。
- `SHA256SUMS.txt`：全部七个安装文件的 SHA-256。

保留 EnglishAsk 当前的 ad-hoc macOS 签名和未公证状态；Windows 未配置付费签名。发布构建继续关闭遥测。自动发布不等于应用内自动更新，用户仍需手动下载安装。

## 本地打包

先执行 `npm ci`，然后在对应操作系统运行：

```sh
npm run dist:mac  # macOS：ARM64 和 Intel 两套包
npm run dist:win  # Windows：x64 三种格式
```

原有 `npm run package:mac` 仍只生成 Apple Silicon 包。以上命令只打包、校验，不上传。每个架构都会把 ASAR 解压到仓库外的临时目录，检查运行依赖能否独立导入；这不代表其他操作系统上的 GUI 启动已验证。

## 失败与重试

版本标签必须与 `package.json` 相符。手动运行必须选择现有 `v版本号` 标签，不能选择分支。构建任务只有读取权限，发布任务使用内置 `GITHUB_TOKEN`，不需要添加个人令牌；仓库需允许 Actions 运行。

任一平台构建失败不会创建 Release。上传或远端校验失败时保留草稿，可重跑失败任务继续上传。已公开的同版本 Release 会被拒绝，不能覆盖；草稿里有非预期附件也会阻止公开，需检查草稿。网络或认证失败不会被当成“Release 不存在”。

FenyiDic 在各平台构建时直接发布；这里保留 EnglishAsk 的打包验证，并合并到最后一个发布任务，确保两个平台和手写说明准备好后一起公开。没有引入 `electron-updater` 或修改应用功能。
