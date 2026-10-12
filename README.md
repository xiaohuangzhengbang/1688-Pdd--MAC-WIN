# 1688 商品素材便携工具

复用 TK 总控已实测的提取器和 Node 下载器。适用于 Apple Silicon（M 系列）Mac，不需要 Rosetta 或 npm 依赖。

## Mac 使用

1. 安装官方 Node.js 的 macOS ARM64 版本（建议 22 或更新的 LTS），终端执行 `node -v` 确认可用。
2. 用 Chrome 登录 1688，打开目标商品页，滚动到商品详情等待图片加载。如需视频，先点开对应视频。
3. 打开 Chrome 开发者工具的 Console。打开本包 `export-from-chrome.js`，复制完整内容到 Console 执行。脚本只读取当前商品页，自动下载 `<商品ID>.json`。Chrome 若提示粘贴保护，请先审阅脚本并按 Chrome 自己的提示操作。
4. 在终端进入本包目录，例如 `cd ~/Downloads/1688-mac-portable`，运行：

```sh
bash download-mac.sh "$HOME/Downloads/802358929157.json"
```

将示例路径换成刚导出的 JSON。文件统一保存本包 `outputs/<商品ID>/`，成功后生成 `outputs/1688_<商品ID>_assets.zip`。

也可以只下载不压缩：`node work/download-assets.mjs /完整路径/商品ID.json`。路径有空格请保留引号。

## 结果

- mainImages：商品图库，可能包含颜色/SKU图。
- detailImages：详情图。
- videos：当前页面可提取的直接 MP4。
- 页面原文.txt：页面文字，保留页面当前语言，不自动翻译或 OCR。
- source.json：来源快照；assets-manifest.json：来源、哈希、大小、错误和警告。

下载器4路并发、每项最多2次尝试、60秒超时；校验一致的缓存复用。失败返回非零并保留清单，修复后重跑同一命令。浏览器登录状态不会被导出。

## 验证范围

原流程在 Windows 已验证两个真实商品：809493108964（22个媒体）和802358929157（90个媒体）。本包为同一源码加Mac启动脚本。当前没有M系列Mac硬件实机验证，不能把打包成功称为Mac实测通过。

依赖当前1688页面结构和正常访问权限；遇登录/验证码请人工处理。空详情或空视频会写warnings，不代表商品没有该素材。视频仅支持直接MP4，未逐一覆盖所有视频入口，不支持blob/HLS/DRM。视频结构检查不等于全片解码。

下载耗时仅计算下载阶段。精炼中文商品描述需要另行整理，程序不会伪造商品字段。素材商业使用权限请向权利人确认。
