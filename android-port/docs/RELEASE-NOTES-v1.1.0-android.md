# CrystalLens Android v1.1.0

将 **CrystalLens v1.1.0**（Windows 原生 C++17 / Win32 / OpenGL 3.3 晶体结构查看与编辑器）重构为可在安卓设备运行的版本。本次提供**免安装网页预览版**与**可安装签名 APK**，两者共享同一套 Web 核心（无第三方运行时依赖）。

## ⬇️ 下载

| 文件 | 说明 | 大小 | SHA-256 |
|---|---|---|---|
| `CrystalLens-v1.1.0-android.apk` | **打包版**：已签名 APK（v2/v3），侧载安装 | 540,473 B | `a728edea271060ac15459e71747ffa7dcb6e6d5966286d4b67e3b62411a3f491` |
| `CrystalLens-Android-Preview.html` | **免安装预览版**：单文件、离线可用，手机 Chrome 直接打开 | 1,128,654 B | `abe9fcf90d4b10a067ffa1ebdb0f69e015dc39acd9898ff324080d3b331c6900` |
| `CrystalLens-v1.1.0-android.zip` | 完整分发包（APK + 预览 + preview 目录 + 校验清单 + 说明） | 1,432,377 B | `a23cac899546be2220172ad6464fc118f434ff43544d6b77b46a3817e9255a61` |

## 🚀 使用

- **免安装预览版（零安装）**：把 `CrystalLens-Android-Preview.html` 发到手机 → 用 Chrome 打开 → 点击「经典晶体库」即可。完全离线。
- **APK 安装**：点击 APK 安装（按提示允许「安装未知应用」），或 `adb install -r CrystalLens-v1.1.0-android.apk`。
  也可以在文件管理器里用「打开方式 → CrystalLens」直接打开 `.cif / .xyz / .vesta` 文件。
- 系统要求：Android 7.0+（minSdk 24），WebView 支持 WebGL2；仅申请 VIBRATE 权限，无网络/存储权限。

## ✨ 功能（对齐 Windows v1.1）

- **结构读取**：CIF（对称操作展开、`1.234(5)` 不确定度、多 data block、无引号逐行对称操作、无序组）、XYZ（元素符号/原子序数）、VESTA（CELLP/SYMOP/STRUC）。
- **三维显示**：晶胞/超胞（1–16 倍）与每个子晶胞线框、周期化学键、球棍/空间填充/**配位多面体**（半透明面+像素描边）、元素图例、原子标签、坐标轴 gizmo、透视/正交。
- **边界原子**：默认显示相邻晶胞的一层实心原子与完整键网络，可一键关闭；边界原子不参与拾取。
- **交互**：单指旋转（带惯性）、双指缩放/平移、双击适配、点击/长按拾取；桌面端保留鼠标+键盘。
- **测量**：键长/键角，周期性最小镜像，画面绘制测量线与数值。
- **编辑**：晶胞参数、添加/编辑/删除原子（作用于不对称单元）、50 步撤销/重做。
- **导出**：CIF / XYZ / PNG 截图 / 复制结构摘要。
- **界面**：移动优先（抽屉面板 + 底部弹层 + 标签页）、中英文、外观设置（边框/背景/多面体透明度与描边）持久化。
- **离线晶体库**：岩盐、萤石、钙钛矿、硫铂矿、金红石、板钛矿、锐钛矿、闪锌矿、纤锌矿、金刚石、α-石英、方解石（12 份 COD CIF）。

## 🏗 实现

- **共享 Web 核心**：纯经典 JS + WebGL2，按固定顺序加载、全局 `CL` 命名空间，无 npm/CDN/框架/构建步骤 —— 同一份代码可直接 `file://` 打开、可打进 APK assets、也可本地 HTTP 托管。
- **渲染**：实例化球体 impostor（写真实深度）、实例化圆柱键、屏幕空间线宽、半透明多面体排序 + 像素恒定描边、2D 叠层（标签/图例/测量/坐标轴）。
- **Java 外壳**：WebView 全屏沉浸、SAF 文件选择、分块保存/分享、返回键、打开方式（VIEW/SEND）、FileProvider；**不使用 Gradle/AndroidX**，`aapt2 → javac → d8 → zipalign → apksigner` 直通构建。
- **源码与构建说明**：见仓库 [`android-port/README.md`](https://github.com/gagesulfonium-ui/CrystalLens/blob/main/android-port/README.md) 与 [`docs/ANDROID.md`](https://github.com/gagesulfonium-ui/CrystalLens/blob/main/android-port/docs/ANDROID.md)。

## ✅ 验证（本次构建实测）

- Node 单元 + 验收测试 **190 / 190 通过**（解析/对称/成键/超胞/多面体/测量/编辑/导出）。
- Web 内建自检 `?selftest=1`：目录版 / 单文件 / APK 解包后 **均 32 pass / 0 fail**，WebGL2 正常。
- 无头渲染截图套件 **14 / 14 场景通过**（桌面/手机竖屏/横屏、三种样式、超胞、中英文）。
- APK 校验 **31 / 31 通过**：v2+v3 签名、包名 `com.crystallens.android`、1.1.0（110）、minSdk 24 / targetSdk 36、仅 VIBRATE、assets 与预览版逐文件 SHA 一致。
- 与 Windows v1.1 数值对照一致（如 halite 4Na+4Cl / 24 键 @2.8201 Å；超胞显示集合 1×1×1=27、2×2×2=125、3×3×3=343；多面体中心 63）。

## 📱 已知限制

- 多窗口改为标签页；键盘快捷键在桌面浏览器可用、触屏以按钮替代。
- 边缘抗锯齿以 MSAA/着色器替代 alpha-to-coverage，细微差异；多面体透明面按三角心排序（与原版同为近似）。
- 截图保存为「缓存 + 系统另存为/分享」（无需存储权限）。
- **未在真机/模拟器上运行**（构建环境无 Android 设备）：Web 部分已用无头 Chromium（SwiftShader WebGL）验证，Java 壳层通过编译与 APK 结构/签名校验；建议在手机上复测触控、打开方式与分享。
- APK 使用调试证书签名（`CN=CrystalLens Debug`）；正式分发请用你自己的发布证书重新签名。

## 📄 许可

MIT License（继承自 CrystalLens v1.1.0）。晶体数据来自 Crystallography Open Database（COD），来源与文献见仓库 `android-port/web/data/library/SOURCES.md`。

---

**English summary:** Android port of CrystalLens v1.1.0 — a shared WebGL2/JavaScript crystal-structure viewer wrapped in a minimal Java WebView host, shipped both as a single-file offline HTML preview and a signed APK (no Gradle/AndroidX, no dangerous permissions). Feature parity with the Windows v1.1 release, verified by 190 Node tests, a 14-scenario headless visual suite and 31 APK checks.
