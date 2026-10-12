# OpenCLI 与 1688 固定素材流程交接

## 给另一台电脑的 Codex 先读

用户提供的插件截图名称是 OpenCLI。用户希望复用现有能力，恢复“商品链接 → 商品图库/详情图/视频/原文/中文整理 → 校验 → ZIP”的体验。

本项目以前只打包了固定提取器和下载器，v1.1.0又补了Chrome DevTools MCP入口；此前没有把OpenCLI的依赖与差异交接进来。v1.1.1补齐本文和本机只读检查脚本。**这次不是OpenCLI已接入完成的发布。**

已确认的历史批次：802358929157有69张图库、20张详情图、1个56.634秒MP4；90个文件下载阶段2.368秒。该记录来自Chrome DevTools+本项目固定脚本，不能把它写成OpenCLI的实测。

## 两条入口及已有边界

| 项目 | 原固定流程／本包v1.1 | OpenCLI官方能力（源码核查） |
|---|---|---|
| 浏览器连接 | Chrome DevTools MCP --autoConnect | OpenCLI程序+Browser Bridge Chrome扩展+本机daemon |
| 浏览器 | 已登录的外部Chrome | 已登录的外部Chrome |
| 商品字段 | 页面文字，由Codex整理 | item：标题、价格、MOQ、卖家、属性等 |
| 媒体 | 固定提取器：图库、详情图、直接MP4 | assets/download：主图、SKU图、详情图、视频等 |
| 页面原文、中文描述 | 原文保存；Codex按证据生成中文描述 | 不能把item输出当完整描述正文；不能宣称命令自动生成中文描述 |
| 本项目清单、SHA256缓存和ZIP | 已有 | 尚未接到本项目统一交付格式 |
| 当前Mac实机验证 | 尚未完成 | 此项目未在目标Mac验证 |

Codex里显示OpenCLI插件，不等于本机OpenCLI运行时、Chrome Browser Bridge扩展和登录状态已就绪。先读该已安装插件自己的技能说明并复用其入口，再检查本机依赖。不要凭图标宣称连接成功。

## 当前报错的真实断点

另一台电脑提供的原始记录是：`mcp__cua_repl.js`通过`cua.getBrowser`选择了Codex In-app Browser（iab），随后createBrowserTab被site-safety policy拒绝。没有进入页面，也没有实际发起Chrome DevTools连接或OpenCLI调用。

因此可确认“这次内置浏览器被拒绝”，不能写“Chrome DevTools或OpenCLI失败”。但是原始拒绝明确禁止为同一结果改走其他浏览器、原始CDP或间接执行。不要通过OpenCLI、外部Chrome或新任务来绕过该拦截。先处理正式访问策略；当前允许继续做本机安装/命令/配置诊断，不访问受限商品页。

## 当前允许执行的本机核查

在解压的本项目目录运行：

```bash
bash check-opencli-mac.sh
```

脚本只读取OpenCLI命令路径、版本和命令目录，不运行商品命令，不启动浏览器诊断，也不修改安装或授权。若找不到命令，返回非零并明确缺失。此检查不能证明扩展连接、1688登录或站点访问已通过。

另由用户在已登录1688的Chrome配置中检查`chrome://extensions`，确认OpenCLI Browser Bridge是否安装/启用；不要假设Codex插件包含了Chrome扩展。

正常获准的OpenCLI运行依赖可参照官方说明：Mac可用OpenCLIApp或npm运行时，再连接Browser Bridge。先检查已有版本，不重复安装，不升级无关环境。

## 后续接入工作（待执行）

在访问限制正常解决并获准后，再验证OpenCLI提供的实际item/assets/download契约；媒体输出需转换为本项目source/manifest契约，保留来源、offer ID、采集时间、分类、失败及warnings，再复用原下载校验/中文整理/打包能力。

不要只换命令就宣称复现90文件成果；不得假设两个版本素材数量相同。中文描述必须基于实际正文或可靠商品字段；原文件、未知项和图片文字未OCR的边界需要保留。

## 官方依据（2026-10-12读取）

- 项目及安装：https://github.com/jackwener/opencli
- Browser Bridge：https://opencli.info/docs/guide/browser-bridge.html
- Chrome扩展：https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk
- 商品字段：https://github.com/jackwener/opencli/blob/main/clis/1688/item.js
- 素材提取：https://github.com/jackwener/opencli/blob/main/clis/1688/assets.js
- 素材下载：https://github.com/jackwener/opencli/blob/main/clis/1688/download.js

以上main分支会更新；以目标机器安装版本的帮助和插件说明为实际执行依据。本项目不包含上游OpenCLI源码、运行时或浏览器扩展安装包。
