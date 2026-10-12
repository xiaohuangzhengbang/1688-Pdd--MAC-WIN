---
name: 1688-fast-assets
description: Use when a user provides a detail.1688.com product link, including a link-only message, to collect the product's images, text and direct MP4 using an existing signed-in Chrome session.
---

A product link is enough to run the task. The default result is original media saved locally and a copyable HTML preview opened in the right sidebar. Download any discovered direct MP4; do not call the task complete with a detected video still failed. Use the demonstrated workflow without asking the user to select a format again. Normal execution needs no ZIP or PDF.

Keep chat brief: one short start message when required, only necessary status or blocking user actions while working, then a short result with actual media counts. Keep download timing and transport evidence in the manifest; explain them only when requested.

The plugin root is two directories above this file. Resolve it from this actual skill path; caches may move. Write results to the task workspace's `outputs/<offerId>/`, not the installed cache. On an ordinary local Mac, package `outputs/` may be used when it is the established destination.

## Collect

1. Use the connected Chrome DevTools provider's `list_pages`. Reuse the existing signed-in Chrome: select the matching product, or open the user URL in a new tab of that session. Take a compact snapshot to check the product. Follow the exposed pageId/selection schema.
2. On missing connection retry once; if still absent, give the required `chrome://inspect/#remote-debugging` setup and Allow step. Stop relevant actions on login, CAPTCHA, permission or an explicit security block. Keep the existing profile and normal website controls.
3. Read and execute the full packaged `work/extract-1688-assets.js`. It supports the old gallery/Shadow DOM and the current gallery/detail layout, skips known recommendation/control images, and reads real lazy-load URLs. Compare actual product thumbnails with captured gallery images; an empty warnings array is not proof of coverage. If only a single preview is captured despite multiple thumbnails, or detail/video loading is incomplete, inspect a relevant visible control once, activate it normally, and recapture. Empty video results do not establish that there is no video.
4. Verify `offerId` against the user URL, preserving long IDs as strings. Save `source.json` and create `商品描述.md` from actual product text: product, material/specifications, seller if visible, SKU-specific prices and MOQ, and meaningful unknowns. Preserve the original text; do not invent missing facts or treat a lowest accessory/SKU price as all variants' price. Do not export browser login storage or unrelated state.

## Download the original media

5. Run `node "<plugin-root>/work/download-assets.mjs" "<output-dir>/source.json" "<workspace>/outputs"` with Node 22.12+. The 4-worker retry/hash cache remains in place. On Mac, videos use the bundled domestic direct transport; other platforms retain the ordinary downloader unless domestic direct is explicitly enabled. This is a per-process request path, not a system network change.
6. If a discovered video download fails and its source is a `cloud.video.taobao.com/play/...` redirect, inspect that product page's existing media requests. Use `get_network_request` to obtain the actual fresh HTTPS MP4 CDN URL, retaining its complete query. If necessary activate the visible retry/play control once to refresh an expired URL. Record `source.videoResolvedUrls` as an object mapping the original video URL to the actual browser-observed CDN URL, keeping `source.videos` unchanged. Rerun the downloader: images with matching hashes are cached while the failed video is retried.
7. The domestic helper discovers the physical interface and live AliDNS IPv4 answers, binds ordinary-user curl to that interface, and resolves approved asset hosts for each redirect hop. It validates TLS and keeps its errors/evidence. Do not hardcode a previously observed CDN IP, remove signature parameters, export cookies, use sudo, change system proxy/TUN/DNS/routes/current nodes, or silently fall back to another proxy path. `ASSET_DIRECT_INTERFACE` may specify the user's physical interface for this process; it is not a global setting.
8. Inspect exit status and `assets-manifest.json`; verify successful file sizes/hashes and original source identity. A failed detected MP4 remains incomplete work: use the available ordinary authenticated URL and direct transport to resolve it. If a real site/permission/security block prevents further authorized work, report the concrete required action; do not bypass it or label a partial result complete. MP4 container validation does not prove full decoding. No HLS/blob/DRM conversion.

## Show the copyable result in the sidebar

9. Run `node "<plugin-root>/work/create-preview.mjs" "<output-dir>"`. The preview reads the current successful manifest media and product description, with copy-text/copy-original-image controls and a native local MP4 player/download link. It labels missing detail coverage and genuine failures. It never invents a description or includes stale files merely because they are in the folder.
10. Run `node "<plugin-root>/work/serve-preview.mjs" "<output-dir>"` in a retained ordinary process. Read its localhost URL. The server binds only to loopback and serves the generated preview and listed local media; MP4 range requests support seeking. Open this approved HTTP URL in the right sidebar with `open_in_codex` or the in-app browser. Keep the result tab as a deliverable when that browser capability is available. Use HTTP, not a `file://` automation target. If the approved preview action itself is blocked, stop it and give a local file/media link with the limitation.
11. Confirm displayed media and the latest manifest before the short final response. Default final: actual image/video counts and that the sidebar is ready for copying. Link a local video when useful. If the user explicitly requests inline chat content, provide copyable text and original image embeds instead. Only create ZIP/PDF when explicitly requested. `bash download-mac.sh source.json [output-root] --zip` retains optional ZIP packaging.

## Existing providers and scope

Chrome DevTools may come from this plugin or an already-connected 1688 Sourcing Agent; reuse the functioning provider rather than installing a duplicate. Mac installation and existing Windows Chrome connectivity are different checks. On Windows use the Node downloader, but do not run the Mac installer or assume an unbundled Windows script exists. The restricted preview generator/server currently require macOS filesystem protection and explicitly reject Windows/Linux; deliver copyable text and local media links there and report that sidebar limitation.

If the user explicitly names OpenCLI, read `OPENCLI-HANDOFF.md` and its own installed skill first. `check-opencli-mac.sh` is only command/version inventory; this package does not claim an integrated OpenCLI extraction path. The in-app browser is a result viewer here, not a substitute for extracting the 1688 product. An explicit browser-tool block cannot be bypassed with another provider, raw CDP, a new task, or a recovery browser.

This workflow reads the selected product and saves local files. It does not authorize purchases, cart changes, seller messages, account changes, or uploading collected media/URLs to GitHub. Repository publication includes reusable code and instructions only.
