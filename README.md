# 1688 商品素材便携工具

复用 TK 总控已实测的提取器和 Node 下载器。v1.1.0 补齐Chrome DevTools自动入口；v1.1.1补齐OpenCLI交接与本机核查，适用于 Apple Silicon（M 系列）Mac。

## 已有OpenCLI插件：先读这份交接

用户另一台电脑已有OpenCLI入口。请先阅读 [OPENCLI-HANDOFF.md](OPENCLI-HANDOFF.md)，再运行 `bash check-opencli-mac.sh` 检查本机程序与命令目录。该检查不访问商品页，也不验证扩展连接。

本包的Chrome DevTools入口与OpenCLI是两种独立连接方式。项目尚未将OpenCLI接入统一manifest、中文描述和ZIP交付；不要把“交接已上传”写成“OpenCLI全流程已打通”。已发生的站点安全拦截不能靠换用OpenCLI解除。

## 推荐：恢复“给 Codex 商品链接就提取”的原流程

1. 安装 Codex、Chrome 144+ 和 Node.js macOS ARM64（22.12 或更新版本），确保终端里 `node`、`npx`、`codex` 可用。Codex CLI 安装见 https://developers.openai.com/codex/cli 。
2. 解压到一个固定目录，在终端进入本包目录，运行 `bash install-codex-mac.sh`。脚本将本包 `.mcp.json` 的 npx 和 Node PATH 适配为这台Mac的实际安装路径，再用官方CLI添加本包 marketplace 并安装 `1688-fast-assets` 插件，不覆盖其他Codex配置。需保持目录以便更新。
3. 重启 Codex。Chrome 登录1688，在 `chrome://inspect/#remote-debugging` 启用远程调试；连接提示出现时点 Allow。如果 Chrome 中没有该选项，先核对 Chrome 版本和原插件说明，不改用新的未登录浏览器。
4. 在 Codex 中选择“1688 快速素材采集”插件，发送：

```text
用 1688 快速素材采集提取这个商品的图库、详情图、视频和描述，下载校验并打包：
https://detail.1688.com/offer/802358929157.html
```

插件组合：Chrome DevTools MCP → 固定提取器 → 保存source.json → 中文描述整理 → 原并发下载器 → ZIP。平时由 Codex 完成，不需要你手动复制页面脚本或JSON。

浏览器连接复用原工具的 `--autoConnect` 模式，Mac命令是 `npx`，不使用Windows的 `npx.cmd`。MCP依赖固定为 `chrome-devtools-mcp@1.10.1`，首次启动会由npx下载运行，后续使用缓存；需要网络。不包含1688官方采购助手或Codex Chrome Bridge浏览器扩展，也不需要它们来完成这条DevTools流程。

说明：v1.0.0是手动脚本版；应使用v1.1.0完成原流程迁移。当前验证了配置/脚本及历史真实素材缓存链，Mac安装、Chrome授权和全链路尚需在目标Mac上验证。两秒左右仅为历史下载阶段，不是全流程承诺。

## 手动备用入口

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
