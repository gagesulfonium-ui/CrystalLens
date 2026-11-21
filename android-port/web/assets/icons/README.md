# CrystalLens 图标资源（web/assets/icons）

本目录为 Android APK / Web / 单文件 HTML 预览版共用的图标位图，由 `web/assets/logo.png`（1024×1024 母版）统一生成。

## 文件与用途

| 文件 | 尺寸 | 用途 |
|---|---|---|
| `icon-favicon-32.png` | 32×32 | 浏览器 favicon、标签页图标 |
| `icon-48.png` | 48×48 | Android `mipmap-mdpi` legacy launcher 图标 |
| `icon-72.png` | 72×72 | Android `mipmap-hdpi` legacy launcher 图标 |
| `icon-96.png` | 96×96 | Android `mipmap-xhdpi` legacy launcher 图标 |
| `icon-144.png` | 144×144 | Android `mipmap-xxhdpi` legacy launcher 图标 |
| `icon-192.png` | 192×192 | Android `mipmap-xxxhdpi` legacy 图标；PWA manifest 192；apple-touch-icon(180) 缩放源；Web 帮助页 logo |
| `icon-512.png` | 512×512 | Google Play 商店列表图标；PWA manifest 512；单文件版“关于”大图 |

## 规格

- 格式：PNG，RGBA（8 位/通道），正方形，透明背景。
- 内容：logo 的圆角方板 + 晶体几何图形，等比缩放后居中，四边各留 **6%** 空白（内容占画布 88%）。
- 圆角板之外为全透明（alpha = 0），可叠加在任意底色上；不要做白底合成。
- 生成源：`logo.png` 的 alpha 内容包围盒 `(28, 28, 997, 997)`（969×969），按目标尺寸 `round(size * 0.88)` 用 Lanczos 重采样后居中粘贴。
- 本目录文件为生成产物，**请勿手改**；需要改动时改 `logo.png` 并重新生成。

## Android 注意

- 48/72/96/144/192 对应 legacy launcher 图标（`android:icon`），可直接使用。
- 本套 PNG **含圆角底板**，不要直接作为 adaptive icon 的 foreground 层（系统会再套遮罩与安全区裁切）；adaptive icon 的前景/背景层建议由矢量源另出（规格与安全区见 `docs/spec/assets.md` §4.4）。
- Play 商店只上传 512×512、无透明通道的版本时，可用 `icon-512.png` 平铺到指定底色（#0E1420）后上传。

## 重新生成

见 `docs/spec/assets.md` §4.6 的 Pillow 脚本；校验值（字节数 / SHA-256）见 `docs/spec/assets-cases.md`。

---
生成日期：2026-11-21 · 母版：`web/assets/logo.png`（CrystalLens 1.1.0）
