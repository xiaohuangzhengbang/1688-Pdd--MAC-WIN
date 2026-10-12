# 1688 商品素材便携工具

v1.2.0 固定“只发商品链接”的采集流程：复用已登录 Chrome，保存原图、直接 MP4 和商品描述，在右侧打开可复制的图文预览。默认不生成 PDF 或 ZIP。保留既有 OpenCLI 交接与 Windows 记录；Mac 安装入口面向 Apple Silicon（M 系列）。

## 默认固定流程

安装后发商品链接即可，例如：

```text
https://detail.1688.com/offer/1075593934641.html
```

- 读取对应已登录 Chrome 商品页，使用固定提取器采集图库、详情、页面文字和直接 MP4。兼容两种已验证的图库/详情布局，排除已知推荐图及界面图标，读取实际懒加载图片地址。
- 图片与视频保存到任务的 `outputs/<商品ID>/`，保留大小、SHA256、错误及下载来源清单。发现视频后必须完成下载或报告真正的阻塞，不能直接把失败当作已完成。
- Mac 视频下载使用普通用户的国内直连：自动识别物理接口、实时 AliDNS 解析、逐个重定向验证 HTTPS 素材域名，保持原签名查询参数。系统代理、TUN、DNS、路由与当前节点不变，不需要 sudo。失败时可从该商品实际媒体请求取得新鲜 CDN URL，写入 `source.videoResolvedUrls` 后重试。
- 中文商品描述依据页面证据整理，逐 SKU 保留价格与起订量。
- 生成 `图文预览.html`；描述和原图可复制，成功保存的视频直接播放/保存。通过只监听本机的限制性 HTTP 服务打开右侧，支持视频拖动进度。
- 聊天仅给简短结果；必要的授权、登录或验证码阻塞才需要用户处理。明确安全拦截不得绕过。

复用采集 JSON 时：

```sh
bash download-mac.sh /完整路径/source.json /完整路径/outputs
node work/serve-preview.mjs /完整路径/outputs/商品ID
```

第二个命令保持运行，并打印预览 HTTP URL。Codex 将该 URL 在右侧打开。只在明确要求压缩包时使用 `bash download-mac.sh source.json outputs --zip`。OpenCLI 不是此默认路径的替代浏览器安全入口。

## 已有OpenCLI插件：先读这份交接

用户另一台电脑已有OpenCLI入口。请先阅读 [OPENCLI-HANDOFF.md](OPENCLI-HANDOFF.md)，再运行 `bash check-opencli-mac.sh` 检查本机程序与命令目录。该检查不访问商品页，也不验证扩展连接。

本包的Chrome DevTools入口与OpenCLI是两种独立连接方式。项目尚未将OpenCLI接入统一manifest、中文描述和图文侧栏交付；不要把“交接已上传”写成“OpenCLI全流程已打通”。已发生的站点安全拦截不能靠换用OpenCLI解除。

## 推荐：恢复“给 Codex 商品链接就提取”的原流程

1. 安装 Codex、Chrome 144+ 和 Node.js macOS ARM64（22.12 或更新版本），确保终端里 `node`、`npx`、`codex` 可用。Codex CLI 安装见 https://developers.openai.com/codex/cli 。
2. 解压到一个固定目录，在终端进入本包目录，运行 `bash install-codex-mac.sh`。脚本将本包 `.mcp.json` 的 npx 和 Node PATH 适配为这台Mac的实际安装路径，再用官方CLI添加本包 marketplace 并安装 `1688-fast-assets` 插件，不覆盖其他Codex配置。需保持目录以便更新。
3. 重启 Codex。Chrome 登录1688，在 `chrome://inspect/#remote-debugging` 启用远程调试；连接提示出现时点 Allow。如果 Chrome 中没有该选项，先核对 Chrome 版本和原插件说明，不改用新的未登录浏览器。
4. 在 Codex 中选择“1688 快速素材采集”插件，发送：

```text
https://detail.1688.com/offer/802358929157.html
```

插件组合：Chrome DevTools MCP → 固定提取器 → 保存source.json → 中文描述整理 → 下载与国内视频直连 → 可复制图文侧栏。平时由 Codex 完成，不需要你手动复制页面脚本或JSON。

浏览器连接复用原工具的 `--autoConnect` 模式，Mac命令是 `npx`，不使用Windows的 `npx.cmd`。MCP依赖固定为 `chrome-devtools-mcp@1.10.1`，首次启动会由npx下载运行，后续使用缓存；需要网络。不包含1688官方采购助手或Codex Chrome Bridge浏览器扩展，也不需要它们来完成这条DevTools流程。

说明：v1.0.0是手动脚本版；新安装或更新使用v1.2.0或更新版本。当前已在目标Mac验证Chrome连接、图库下载、直接MP4国内下载与图文侧栏；详情覆盖仍取决于具体页面正常加载。两秒左右仅为部分商品的下载阶段，不是全流程承诺。

## 本机实测入口与本包的区别

2026-10-12的商品1085818639893实测，使用本机已经连接的“1688 Sourcing Agent”所提供的Chrome DevTools工具，不是重新安装并运行本包的“1688 快速素材采集”插件。调用的是外部Chrome的list_pages、take_snapshot、evaluate_script与hover，未调用OpenCLI、内置浏览器或1688官方商品API。

- 该Windows实测时，固定提取器与当时的本包逐字节一致，下载器仅增加可选输出目录参数。v1.2.0另增加新页面布局支持、Mac国内视频下载和侧栏预览，不能再将当前版本与旧Windows脚本视为逐字节一致。
- Windows实测使用Node下载后，以PowerShell的Compress-Archive打包；本包Mac入口使用Bash和系统zip。两者不是同一条启动命令。
- 中文描述由Codex依据实际页面正文整理。实测另做了MP4时长读取及ZIP解压后逐文件哈希对照；这些是Codex执行的额外检查，不是download-mac.sh自动完成的功能。
- 本机外部Chrome成功不等于本包Mac安装或连接已验证。已有Chrome DevTools入口时先复用；不要仅因本包包含MCP配置就重复安装另一个同名浏览器连接。

## 图库和视频的加载检查

提取器是读取当前DOM的函数，不负责自动触发所有懒加载。warnings为空也不证明图库完整：当前预览图可能只有1张，但商品缩略图区已经显示多张。

Codex下载前应将预览区图片与商品缩略图区的真实图片项核对，排除视频封面重复、参数入口和界面图标，不要求两边元素数量机械相等。若预览仅1张而缩略图区有多张图片，或视频/详情未加载，使用当前快照识别的正常图库/视频控件悬停或点击一次，确认DOM发生相应变化，再执行原提取器。不要替换成全页图片抓取或猜测原图URL。

商品1085818639893首次读取为1张图库、14张详情、0视频；悬停页面已有视频入口后，图库预览DOM展开，复采得到88张图库、14张详情和1个视频。一次补加载后仍有缺失时，报告当前实得数量和未解决项，不把部分素材称为完整包；遇登录、验证码、权限或明确安全阻断应停止相关动作。

## Windows下载（已有Chrome连接时）

不在Windows运行install-codex-mac.sh。Codex先完成页面采集、保存source.json和商品描述，再用本包Node下载器指定工作区输出目录。限制性侧栏预览目前依赖macOS的文件读取保护，Windows/Linux尚不支持；可在对话中交付文字与本地媒体链接。以下压缩示例仅供用户明确要求ZIP时使用，由Codex替换为实际绝对路径和商品ID：

```powershell
node "<插件目录>/work/download-assets.mjs" "<工作区>/outputs/<商品ID>/source.json" "<工作区>/outputs"
if ($LASTEXITCODE -ne 0) { throw 'Asset download failed; inspect assets-manifest.json' }
Compress-Archive -Path "<工作区>/outputs/<商品ID>/*" -DestinationPath "<工作区>/outputs/1688_<商品ID>_assets.zip"
```

打包前确认目标ZIP不存在，或先在授权范围内保留旧版本；不要把旧ZIP交付为本次结果。只需补打包时不要再次运行下载器，否则manifest的elapsedMs和downloaded/cached会被第二轮缓存检查覆盖。GitHub包不包含原Windows总控的download-product.ps1；不能在另一台电脑假设它存在。

## 手动备用入口

1. 安装官方 Node.js 的 macOS ARM64 版本（建议 22 或更新的 LTS），终端执行 `node -v` 确认可用。
2. 用 Chrome 登录 1688，打开目标商品页，滚动到商品详情等待图片加载。如需视频，先点开对应视频。
3. 打开 Chrome 开发者工具的 Console。打开本包 `export-from-chrome.js`，复制完整内容到 Console 执行。脚本只读取当前商品页，自动下载 `<商品ID>.json`。Chrome 若提示粘贴保护，请先审阅脚本并按 Chrome 自己的提示操作。
4. 在终端进入本包目录，例如 `cd ~/Downloads/1688-mac-portable`，运行：

```sh
bash download-mac.sh "$HOME/Downloads/802358929157.json"
```

将示例路径换成刚导出的 JSON。文件统一保存本包 `outputs/<商品ID>/`，成功后生成可复制的 `图文预览.html`；默认不压缩。

也可以仅运行下载器：`node work/download-assets.mjs /完整路径/商品ID.json`。路径有空格请保留引号。

## 结果

- mainImages：商品图库，可能包含颜色/SKU图。
- detailImages：详情图。
- videos：当前页面可提取的直接 MP4。
- 页面原文.txt：页面文字，保留页面当前语言，不自动翻译或 OCR。
- source.json：来源快照；assets-manifest.json：来源、哈希、大小、错误和警告。
- 图文预览.html：商品文字复制、原图复制、已下载MP4播放/保存；使用本机HTTP服务在右侧查看。

下载器4路并发、每项最多2次尝试、60秒超时；校验一致的缓存复用。失败返回非零并保留清单，修复后重跑同一命令。浏览器登录状态不会被导出。

## 验证范围

原流程在 Windows 已验证三个真实商品：

| 商品ID | 图库/颜色规格图 | 详情图 | 视频 | 媒体合计 |
|---|---:|---:|---:|---:|
| 809493108964 | 8 | 13 | 1 | 22 |
| 802358929157 | 69 | 20 | 1 | 90 |
| 1085818639893 | 88 | 14 | 1 | 103 |

第三个商品于2026-10-12采集：103个媒体全部下载，0失败、warnings为空，首轮下载阶段1510ms；MP4为8.472秒、1,615,043字节。素材SHA256与大小全部复核一致；ZIP含103个媒体和4个文档，共107个文件，解压内容与原文件逐一对照通过。以上是Windows原流程实测，不是OpenCLI或本包Mac运行记录，也不是所有1688商品的覆盖保证。

2026-10-12 在M系列Mac的已登录Chrome实测商品1075593934641：保存9张图库和1个MP4；详情未正常加载，明确保留此缺失。直接MP4为16.834秒、2,710,735字节；国内直连请求返回HTTP200，TLS验证通过，文件边界及SHA256已核对。可复制文字/9张原图的侧栏已显示。此记录不代表所有商品、所有详情或所有替代视频已覆盖，也不证明全片解码。

依赖当前1688页面结构和正常访问权限；遇登录/验证码请人工处理。空详情或空视频会写warnings，不代表商品没有该素材。视频仅支持直接MP4，未逐一覆盖所有视频入口，不支持blob/HLS/DRM。视频结构检查不等于全片解码。

下载耗时仅计算下载阶段。精炼中文商品描述需要另行整理，程序不会伪造商品字段。素材商业使用权限请向权利人确认。
