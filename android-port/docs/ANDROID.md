# CrystalLens 安卓版（v1.1.0）

> 将 CrystalLens v1.1.0（Windows / C++17 + Win32 + OpenGL 3.3 原生晶体结构查看与编辑器）重构为**可在安卓设备运行**的项目：
> **免安装网页预览版** + **可安装的签名 APK**，共享同一套 Web 核心代码。

---

## 1. 交付物

| 文件 | 说明 |
|---|---|
| `CrystalLens-v1.1.0-android.apk` | **打包版**：已签名 APK（v2/v3），可直接侧载安装。包名 `com.crystallens.android`，versionName `1.1.0`（versionCode 110），minSdk 24 / targetSdk 36，仅申请 VIBRATE 普通权限，无网络、无存储权限。本次构建 540,473 B，SHA-256 `a728edea271060ac15459e71747ffa7dcb6e6d5966286d4b67e3b62411a3f491`。 |
| `CrystalLens-Android-Preview.html` | **免安装预览版**：单文件、零依赖、**离线可用**（1.13 MB，晶体库 12 结构 + 6 示例已内嵌）。复制到安卓手机后用 Chrome 打开即可，也可以双击在桌面浏览器打开。 |
| `preview/` | 免安装预览版的目录形式（用本地 HTTP 服务托管，便于调试/局域网在手机上访问）。 |
| `CrystalLens-v1.1.0-android.zip` | 分发包（1.43 MB）：包含上述全部文件 + 本说明 + LICENSE + SHA256SUMS + VERSION + build-info。 |
| `README-ANDROID.md`（即本文件） | 架构、构建、安装与使用说明。 |
| `SHA256SUMS.txt` / `build-info.json` / `VERSION.txt` | 校验清单与构建元数据。 |

两个版本**功能完全一致**：APK 只是把同一份 `preview/` 资源放进 WebView 并补上原生文件读写/分享能力。

---

## 2. 为什么是「Java WebView 外壳 + JS/WebGL2 核心」

原版是 4 万行 C++（Win32 + OpenGL 3.3）：晶体学核心（解析/对称/成键/超胞/多面体/编辑）、渲染器、自绘 UI 全部绑定 Windows API。要在安卓上以最快速度达成**功能等价、双版本（免安装 + APK）共享同一实现**，采用如下架构：

```
┌──────────────────────── APK（Java 宿主，无需 Gradle） ────────────────────────┐
│ MainActivity / WebAppBridge（文件选择、保存/分享、沉浸式、返回键、打开方式） │
│            assets/www/  ←  与免安装预览版 100% 同一份 Web 产物                │
└──────────────────────────────────────────────────────────────────────────────┘
┌──────────────────── 共享 Web 核心（纯经典 JS + WebGL2，离线） ────────────────┐
│ 解析层   CIF / XYZ / VESTA 解析、周期表（118 元素，含半径/颜色/分类）         │
│ 模 型  对称展开、超胞 1–16、边界原子、周期键、配位多面体、测量、编辑、导出   │
│ 渲 染  实例化球体 impostor、圆柱键、晶胞/子胞线框、半透明多面体+描边、       │
│        标签/图例/测量叠层、拾取、轨道相机（透视/正交）                       │
│ 界 面  移动优先 UI：抽屉面板、底部弹层、标签页、中英文、设置持久化           │
└──────────────────────────────────────────────────────────────────────────────┘
```

设计要点：
- **零第三方依赖、零构建步骤**（不使用 npm/CDN/框架、不用 ES module），所有脚本以固定顺序加载并挂在全局 `CL` 命名空间，因此同一份源码可直接 `file://` 打开、可打进 APK assets、也可本地 HTTP 托管。
- 渲染用 **WebGL2**：球体为实例化 billboard + 片段着色器射线-球求交（写入真实 `gl_FragDepth`），化学键用预生成圆柱网格实例化（弥补 WebGL 无几何着色器），多面体为半透明面 + 屏幕空间描边。
- 晶体学算法逐行移植自 C++（含 CIF 无引号对称操作、`1.234(5)` 不确定度数字、无序组互斥成键、闭区间边界原子去重、65536/300000/80000 容量上限等），并用 **Node 单元测试 + 与原版数值基准对照**校验。
- APK **不使用 Gradle/AndroidX**：`aapt2 → javac → d8 → zipalign → apksigner` 直通构建，主机只需 JDK 17 + Android build-tools/platform（`tools/fetch_toolchain.ps1` 一键下载），便于复现与审查。

---

## 3. 快速开始

### 3.1 免安装预览版（无需安装任何东西）

1. 把 `CrystalLens-Android-Preview.html` 复制到手机（USB / 微信文件传输 / 网盘 / 邮件均可）。
2. 用 **Chrome** 打开该文件（文件管理器里点击 → 选择 Chrome），首次可能提示「在浏览器中打开/允许访问本地文件」，允许即可。
3. 离线可用；打开后点击首屏「经典晶体库」即可查看 12 个晶体结构。

> 可选：把 `preview/` 目录放到任意静态文件服务器（或在本机运行 `python tools\serve_preview.py`），手机与电脑同一 Wi-Fi 时访问 `http://<电脑IP>:8000/`。这需要联网环境，但便于多设备预览。

### 3.2 安装 APK

1. 把 `CrystalLens-v1.1.0-android.apk` 复制到手机并点击安装；系统会提示「禁止安装未知应用」，按提示为当前文件管理器/浏览器授予「安装未知应用」权限后继续。
2. 或使用 ADB：`adb install -r CrystalLens-v1.1.0-android.apk`（需开启 USB 调试）。
3. 首次启动允许约 1–2 秒 WebView 初始化；应用全屏沉浸式、保持屏幕常亮。
4. 在文件管理器中**用「打开方式 → CrystalLens」** 直接打开 `.cif / .xyz / .vesta` 文件也可以（APK 已注册 VIEW/SEND intent）。

> 系统要求：Android 7.0+（minSdk 24），WebView 内核支持 WebGL2（Chrome/WebView 56+，现代设备均满足）。若设备 WebView 过旧，应用会提示「此设备 WebView 不支持 WebGL2」。

---

## 4. 使用说明

### 4.1 布局（移动端）

- **顶部工具栏**：文件、经典晶体库、标签页、撤销/重做、测量、样式、全屏/语言等入口。
- **视口**：全屏 3D 视图；右上角元素图例，右下角坐标轴 gizmo，左下角状态提示。
- **左侧抽屉**：晶胞参数、显示开关（晶胞/化学键/标签/坐标轴/边界原子）、外观样式（球棍/空间填充/多面体）、超胞设置、外观设置、结构信息（化学式、空间群、原子/键/对称操作数、备注）。
- **右侧抽屉**：选中原子信息与编辑/删除；测量（键长/键角）与结果列表。
- **底部状态栏**：当前结构、原子数、键数、FPS/提示。
- **标签页**：可同时打开多个结构（替代桌面版的多窗口），每个标签独立相机、选择、测量与撤销栈。

### 4.2 触控手势

| 手势 | 功能 |
|---|---|
| 单指拖动 | 旋转（松手有惯性） |
| 双指捏合 | 缩放 |
| 双指拖动 | 平移 |
| 双击 | 适配视图（Fit） |
| 单击原子 | 选中并显示信息 |
| 长按原子 | 选中（移动端替代右键/悬停） |
| 鼠标（桌面/平板外设） | 左键旋转、中/右键平移、滚轮缩放、悬停高亮 |

### 4.3 常用操作

- 打开结构：顶部「文件」→ 本地文件（支持多选）或「经典晶体库」12 个离线结构；也支持拖放文件（桌面浏览器）。
- 样式：球棍 / 空间填充 / **多面体**（v1.1 核心：以 Si/Al/过渡金属等为中心生成配位多面体，半透明面 + 描边；可调透明度与描边宽度）。
- 超胞：每个方向 1–16 倍；边界原子可开关（对齐原版闭区间显示逻辑）。
- 测量：选择「键长」（2 原子）或「键角」（3 原子），测量值带周期最小镜像修正，可清除。
- 编辑：晶胞参数、添加/编辑/删除原子（作用于不对称单元，对称等价位置一起更新），支持 50 步撤销/重做。
- 保存/导出：CIF（含晶胞）或 XYZ（当前结构笛卡尔坐标）；导出 PNG 截图；复制结构摘要。APK 中通过系统「另存为/分享」保存到任意位置。
- 外观设置：晶胞边框颜色/粗细、背景色、多面体透明度/描边宽度/描边色，实时预览并持久化。
- 中英文一键切换（默认中文）。

### 4.4 快捷键（桌面浏览器；触屏有对应按钮）

`Ctrl+O` 打开、`Ctrl+L` 晶体库、`Ctrl+S` 保存、`Ctrl+Z/Y` 撤销/重做、`Ctrl+E` 编辑晶胞、`Ctrl+Shift+A` 添加原子、`F2` 编辑原子、`Delete` 删除、`F1` 帮助、`F` 适配视图、`Home` 重置视角、`D/A` 键长/键角测量、`Esc` 取消、`C/B/L` 晶胞/键/标签开关、`P` 透视/正交。

---

## 5. 构建（从源码复现）

### 5.1 依赖

- Windows 10/11 x64（构建机）
- Python 3.10+（用系统 Python 即可；仅标准库）
- Node.js 18+（用户环境自带；用于测试；运行应用不需要）
- JDK 17 + Android SDK build-tools 36 + platform android-36（由脚本自动下载到 `.toolchain/`）

### 5.2 一键构建

```powershell
# 1) 下载工具链（仅首次，约 300MB；JDK17 + build-tools + platform + adb）
powershell -ExecutionPolicy Bypass -File tools\fetch_toolchain.ps1

# 2) 全流程：内嵌晶体库 → 构建预览版 → Node 单测 → 无头自检 → 构建并签名 APK
powershell -ExecutionPolicy Bypass -File tools\build_all.ps1

# 3) 组装发布包（dist\CrystalLens-v1.1.0-android\ 与 .zip）
powershell -ExecutionPolicy Bypass -File tools\release.ps1
```

产物在 `dist/`：
- `CrystalLens-Android-Preview.html`（单文件免安装预览版）
- `preview/`（目录版预览）
- `CrystalLens-v1.1.0-android.apk`（签名 APK）
- `build-info.json`、`SHA256SUMS.txt`、`VERSION.txt`
- `CrystalLens-v1.1.0-android.zip`（分发包）

### 5.3 单独步骤

```powershell
python tools\gen_library.py      # 把 web/data 下 12 CIF + 6 示例内嵌为 web/js/data/library.js
python tools\build_web.py        # 生成 dist/preview 与单文件 HTML（内联 CSS/JS/图标）
node tests\node\run.js           # Node 单元测试（解析/对称/成键/显示集合/测量/编辑/导出）
node tests\headless\run_suite.cjs  # 无头 Edge 渲染截图套件
powershell -File tools\build_apk.ps1  # 仅构建 APK（自动同步 dist/preview 到 assets/www）
python tools\serve_preview.py    # 本地 HTTP 预览（打印局域网 URL）
```

### 5.4 目录结构

```
web/                     安卓与预览版共享的 Web 应用
  index.html  css/  js/
    js/lib/               数学、周期表
    js/core/              解析（cif/xyz/vesta/parsers）、模型（crystal/measure/edit/export/format）
    js/render/            相机、WebGL2 渲染器、2D 叠层
    js/ui/                界面、i18n、原生桥、面板、对话框
    js/data/library.js    构建时生成的离线晶体库（12 CIF + 6 示例）
  data/library|examples/  原始数据（打包时内嵌）
  assets/                 logo 与图标
android/                  Java WebView 宿主工程（Manifest/MainActivity/WebAppBridge/FileProvider）
tools/                    fetch_toolchain / gen_library / build_web / build_apk / build_all / release / serve_preview
tests/                    node 单测、无头截图套件、验收基准
docs/                     CONTRACT（实现契约）、spec/（C++ 规格）、QA-ACCEPTANCE、本文件
reference/                原始 CrystalLens v1.1.0 源码与便携包（只读参考）
.toolchain/               自动下载的 JDK/Android SDK（不随发布包分发）
dist/                     构建产物
```

### 5.5 实现要点（移植对照）

- **解析**：CIF 词法状态机（引号含撇号、分号文本块、无引号对称操作逐行、`data_` 多块打分选择、不确定度数字、分数、`.`/`?`）、XYZ（元素符号/原子序数）、VESTA（CELLP/GROUP/SYMOP/STRUC）。
- **模型**：对称展开去重（最小镜像 <1e-3 Å）、周期键（共价半径 + 分类容差，金属-非金属更宽；无序组互斥；自键过滤；空间网格近邻）、闭区间 `[0,N]` 显示集合与边界原子去重、每个子晶胞边线、配位多面体凸包（平面枚举 + 共面合并 + 单调链面边界 + 扇形三角化）、测量、编辑快照、CIF/XYZ 导出。
- **渲染**：实例化球体 impostor（真实深度写入）、实例化圆柱键、屏幕空间线宽、背景渐晕、半透明多面体（按三角心排序）+ 屏幕像素宽描边、2D 叠层（标签/图例/测量值/坐标轴 gizmo）、射线-球拾取、轨道相机与 fit 算法（含 margin）。
- **界面**：深色主题还原原版视觉（`#020305` 背景、面板层级、细边框、圆角），触控优先布局、安全区适配、44px 触控目标、底部弹层表单、`localStorage` 设置持久化、中英文 251 条文案。

---

## 6. 测试与验证

### 6.1 本次构建实测结果（2026-11-21，Windows 10/11 x64 构建机）

| 项目 | 结果 |
|---|---|
| Node 单元测试（`node tests/node/run.js`） | **190 tests, 0 failed**（解析 62、周期表 9、模型 53、测量 8、编辑 17、导出 18、QA 验收 32 组） |
| Web 端内建自检（`?selftest=1`，目录版） | **32 pass / 0 fail**，no page errors，frames=2 |
| 免安装单文件版自检（`file://` 直接打开） | **32 pass / 0 fail**，无 page errors |
| APK 内 `assets/www` 解包后自检 | **32 pass / 0 fail**（证明 APK 内 Web 产物可独立运行） |
| 无头渲染视觉套件（`tests/headless/run_suite.cjs`） | **14/14 场景通过**（桌面/手机竖屏/横屏、三种样式、超胞、中英文、示例、晶体库） |
| APK 签名 | `apksigner verify` 通过（v2/v3），调试证书 `CN=CrystalLens Debug` |
| APK 结构 | package/version/minSdk/targetSdk/启动 Activity 校验通过；zip 必需条目齐全；34 个 `assets/www` 文件 |
| APK 权限 | 仅 `android.permission.VIBRATE`（无 INTERNET / 存储权限） |
| 关键数值回归 | halite 常规胞 4 Na+4 Cl、24 条 Na–Cl 键 @2.8201 Å；显示集合 1×1×1=27、2×2×2=125、3×3×3=343、关边界=64；多面体中心 63；SrTiO₃ 2×2×2=71 原子/192 键；quartz 12 键、diamond 16、water 2 —— 全部与 C++ 原版一致 |

> 详细的缺陷记录与回归矩阵见仓库内 `docs/QA-REPORT.md`；视觉截图见 `tests/headless/out/`（含与原版 `docs/*.png` 的同视角对照图）。

### 6.2 测试方法

- **Node 单元测试**（`tests/node`）：解析器（12 库 + 6 示例 + 语法边界）、周期表、对称展开/成键/超胞/多面体/测量/编辑/导出，含与 C++ 原版一致的数值断言。
- **无头浏览器测试**（`tests/headless`，Edge/Chromium + SwiftShader WebGL）：桌面/手机竖屏/横屏、多结构、三种样式、超胞、中英文场景截图；`?selftest=1` 内建自检（12 个结构解析 + 显示模型构建 + 渲染器初始化 + UI 元素 + 编辑/撤销/超胞/表单校验/共享文件/返回键钩子）。
- **APK 验证**：`apksigner verify`、`aapt2 dump badging`、`aapt2 dump permissions`、zip 必需条目检查、`zipalign -c`；`dist/build-info.json` 记录哈希与工具链版本。
- 视觉对齐：与原版 `docs/screenshot-*.png` 及 README 中记录的原子/键数逐项对照。

---

## 7. 已知限制与差异（相对 Windows 原版）

1. **多窗口 → 标签页**：移动端用标签页承载多个结构；每个标签独立相机/选择/测量/撤销栈。桌面版「Win+方向键并排」对应标签切换。
2. **输入方式**：原版键盘快捷键保留（桌面浏览器），触屏以工具栏/抽屉/弹层按钮为主；无右键菜单（原版也无）。
3. **边缘抗锯齿**：WebGL2 用 MSAA/着色器替代 alpha-to-coverage，球体边缘可能存在轻微差异；多面体半透明面按三角心排序（原版亦为近似）。
4. **截图保存**：Android 侧改为应用缓存 + 系统「另存为/分享」（无需存储权限）；预览版走浏览器下载。
5. **性能**：超大超胞（如 16×16×16）受原版同样的容量上限约束（65536 位点 / 300000 键 / 80000 显示像），超过会截断并提示；移动端 2×2×2/3×3×3 流畅，极端结构取决于设备 GPU 与 WebView 版本。
6. 未实现原版标注的「不处理」项（无序精修、各向异性热振动、磁矩），与 v1.1 行为一致。
7. APK 使用调试证书签名（`CN=CrystalLens Debug`），适合侧载与自用；若要上架/长期分发，请用你自己的发布证书重新签名（`apksigner sign --ks <你的.keystore>`）。

---

## 8. 许可与数据来源

- 代码：MIT License（继承自 CrystalLens v1.1.0，见 `LICENSE`）。
- 晶体库：12 份 CIF 来自 Crystallography Open Database（COD）格拉纳达大学镜像，具体编号/文献/校验值见原始 `library/SOURCES.md`（随 `preview/` 无关，源码树 `web/data/library/SOURCES.md` 保留）。
- 未引入任何第三方运行时库；界面图标由原版 logo 生成。
