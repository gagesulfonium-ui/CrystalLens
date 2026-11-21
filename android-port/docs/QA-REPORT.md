# CrystalLens 安卓版 · QA 验收报告

> 角色：QA / 验收工程师（独立端到端验证，不修改业务代码）
> 基准：`docs/QA-ACCEPTANCE.md`（§0–§8）、`docs/CONTRACT.md`、`docs/spec/*`
> 被测产物：`dist/CrystalLens-Android-Preview.html`（单文件预览）、`dist/preview/`（目录版）、`dist/CrystalLens-v1.1.0-android.apk`（签名 APK）
> 构建时间：2026-11-21 21:58–21:59（Asia/Shanghai），本报告所有数据均来自该次「当前构建」的全量重建
> 环境：Windows / Node v24.21.0 / Python 3.12 / Microsoft Edge headless（SwiftShader WebGL2）/ Android build-tools 36.0.0 + JDK 17

## 0. 结论摘要

| 项目 | 结果 |
|---|---|
| QA 自动化矩阵（`tests/qa/run_all.ps1`） | **11/11 步骤通过** |
| 代码缺陷 P0（阻断） | **0** |
| 代码缺陷 P1（功能） | **0** |
| 代码缺陷 P2（视觉/UI） | **1**（space-fill 样式 HUD 多显示化学键数，见 D-QA-01） |
| 文档缺陷 P3 | **1**（`camera-cases.md` A4 正交投影矩阵第 0 项参考值算错，见 D-QA-02） |
| 数值基准（QA-ACCEPTANCE §1/§2） | 32/32 组通过，0 跳过（晶体库 12、显示集合 27/125/343/64、多面体 63、键数 24/12/16/2、测量、编辑/导出往返等全部命中） |
| 相机基准（§3，A1–A7） | 7/7 通过（含 view/projection 矩阵精确值、screen↔world 往返） |
| 预览版（§5） | 21/21 结构检查通过；单文件 1,128,458 B（< 2 MB 预算）、无本地引用/无网络 API、内嵌 12 晶体 + 6 示例 |
| 渲染截图套件（§4） | 单文件版 14/14 场景、目录版 14/14 场景通过（无 pageerror，截图均 > 2 KB） |
| `?selftest=1`（§4） | 单文件版 pass=32 fail=0；目录版 pass=32 fail=0；`rendererSupported=true`、12 个晶体结构均解析建模、frames=2 |
| APK（§6） | 31/31 检查通过：v2+v3 签名 Verifies、包名/版本/SDK/launchable-activity 正确、仅 VIBRATE 权限、必需 zip 条目齐全、`assets/www` 与 `dist/preview` 文件清单+SHA256 完全一致、APK 解包后无头加载 selftest 通过 |

**总判定：当前构建满足验收基准的自动化可验证项（§1–§6），可以交付；余下 1 个 P2 视觉细节与 1 个文档错误建议本轮或下轮修复，不构成阻断。**

## 1. 复现命令（全部在本仓库根目录执行）

```powershell
# 一键 QA 矩阵（重建 Web + 重建并校验 APK + 全部测试/截图）
powershell -ExecutionPolicy Bypass -File tests\qa\run_all.ps1

# 分项
& "node" tests\node\run.js
& "...node.exe" tests\qa\check_camera.cjs  --json tests\headless\out\qa-camera-report.json
& "...node.exe" tests\qa\check_preview.cjs --json tests\headless\out\qa-preview-report.json
& "...node.exe" tests\headless\run_suite.cjs --target single   # 14 场景截图
& "...node.exe" tests\headless\run_suite.cjs --target folder
powershell -ExecutionPolicy Bypass -File tests\qa\check_apk.ps1
```

原始日志与机器可读报告：`tests/headless/out/qa-*.log`、`qa-summary.json`、`qa-camera-report.json`、`qa-preview-report.json`、`qa-apk-report.json`、`qa-node-tests.log`。
截图与 contact sheet：`tests/headless/out/*.png`、`tests/headless/out/index.html`。

## 2. 数值基准回归（QA-ACCEPTANCE §1 / §2）—— 最重要项

实现：`tests/node/test_acceptance.js`（32 个验收组，按 `CL.*` 就绪度条件跳过；当前 0 跳过）。
总计 `tests/node/test_*.js`：**190 tests 全部通过**（QA 验收 32 组 + 实现代理单测 158 条；失败 0）。

### §1 解析层（全部通过）

| 验收项 | 实测 |
|---|---|
| 12 个晶体库 CIF | 全部 `format='cif'`、`periodic=true`、`symops>0`、`sites>0`、`siteIndex` 连续、晶胞体积 > 0 |
| halite 晶胞 | a=b=c=**5.6401 Å**、α=β=γ=90°、空间群含 `F m -3 m`、不对称位点 2（Na/Cl） |
| wurtzite / quartz / calcite | γ=**120°**、α=β=90°；perovskite/cooperite/rutile/brookite/anatase 晶胞角均为 90° |
| 6 个示例 | quartz/diamond/srtio3 → CIF、nacl.vesta → VESTA（4 symops）、water.xyz/benzene.xyz → XYZ 且 `periodic=false` |
| 边界用例 | 无引号逐行对称操作=2；`1.234(5)`→1.234；`1.000(2)e1`→10.0；`1/3`→0.3333；多 data block 取原子最多（3 sites）；引号内撇号标题保留；`type_symbol` 优先于标签推断（label C1 + symbol N → N）；无 type_symbol 时标签推断（Na1→Na）；多模型取第一个模型（2 sites+note）；未知元素→`X`、`z=0` 且不成键 |
| `CL.periodic` | 118 元素 + `get('X')`（z=0）；Na/Cl/Ti/Si/O/Ni/Bi/Te 的 z / covalent / vdw / colorU32 与 `docs/spec/elements.json` 完全一致；`elementFromInput('Si'|'14'|'si')='Si'`、`'Qq'→null` |

### §2 模型层（全部通过）

| 验收项 | 实测 |
|---|---|
| halite | atoms=8（Na4 Cl4）、周期键 **24**、全部 Na–Cl、键长 **2.8201 Å**（±1e-3） |
| quartz 示例 | atoms=9、键 **12**、全部 Si–O、含 **1.6046 / 1.6124 Å**、`cellContents="O6 Si3"` |
| diamond 示例 | atoms=8、C–C 键 **16**、长 1.5445 Å |
| water.xyz | atoms=3、O–H 键 **2**（H–H 不成键）、长 0.9573 Å |
| Bi₂Te₃（`build/bi2te3.cif`） | Bi–Te 键 **0**（metalloid cutoff 生效） |
| 无序互斥 | 同 assembly 不同 disorder group 的相邻位点 **0 键**；去掉 disorder 列后同坐标 **1 键**（对照） |
| 显示集合 halite | 1×1×1=**27**（cell 8 + boundary 19）；2×2×2=**125**（64+61，Na 实例 **63**、Cl 62）；3×3×3=**343**（216+127）；2×2×2 关边界=**64** |
| 多面体 halite 2×2×2 | 中心/多面体数 **63**，八面体三角形 63×8=**504** |
| 超胞容量 | halite 16³ 不截断（`supercellLimited=false`，displayedCells=16³，实例 39304 ≤ 80000）；perovskite 16³（20×4096>65536）→ `supercellLimited=true` 回退 1×1×1；请求 20³ 被钳制到 ≤16；不得崩溃 |
| 模型一致性 | atoms.id 连续；boundary 原子 `pickable=false`；`cellAtomCount+boundaryAtomCount=visibleAtomCount`；`origin===structure.center`；1×1×1 晶胞线 ≥12、2×2×2 ≥27 条 |
| 性能 | halite 2×2×2 `buildDisplayModel` 实测远小于 500 ms 预算；16³ 无 OOM/崩溃 |
| 测量 | 最近 Na–Cl=**2.8201 Å**；C++ fixture `measureDistance(0,4)`=2.8201；跨边界对（0.05/0.95）最小镜像=**0.3 Å** 且 offsetB=**(-3,0,0)**；水 H–O–H 角=**104.47°**（C++ test_core） |
| 编辑 | `setCellParameters` 负数/180° 返回 `{ok:false}`，合法值后 cell/体积/展开原子数更新；add/update/delete 位点作用于不对称单元并重建；非法元素、占位率 0 被拒绝；越界删除被拒绝 |
| 导出往返 | `exportCif→parse`：晶胞参数（±1e-4）、sites 数、symops 数、展开原子数、键数一致；`exportXyz` 行数=单胞原子数+2、首行 N、坐标 1e-5 内一致 |
| JSON 往返 | `StructureData` 经 `JSON.stringify/parse` 无损（逐字节一致），恢复快照后仍可 rebuild 显示模型（27 原子） |

## 3. 相机（QA-ACCEPTANCE §3，`docs/spec/camera-cases.md` A1–A7）

实现：`tests/qa/check_camera.cjs`（在 Node VM 中加载 `math.js`+`camera.js`，无浏览器）。**7/7 用例通过**：

- A1 `reset({1,2,3},6.6,1.15)`：distance=22.704923374、eye/近远平面、5 个世界点屏幕坐标、view/projection 矩阵全部命中参考值（矩阵容差 1e-5）；
- A2 画面中心射线命中 target（误差 <0.05）、方向单位长；
- A3 orbit 方向与 18.4988°/32.2506°、zoom(3) 距离 10.643507、pitch 钳制 ±85°、基正交单位；
- A4 正交：中心 (500,400)、depth=-0.521739、投影矩阵（m[0] 按 C++ 真值 0.135074079，见 D-QA-02）；
- A5 球拟合 27.521119 / 点集拟合 22.916427 / 近远平面 / 8 角点屏幕坐标（±0.05 px）；
- A6 超胞点集拟合：target=(43,-7,6)（1e-9）、透视/正交距离与近远平面、8 角点透视/正交屏幕坐标；
- A7 默认值、sceneRadius 钳制 0.5、near 下限 0.02、far 公式、orbit/pan/zoom 方向符号、worldToScreen↔screenRay 往返（1e-6）。

## 4. 渲染 / 视觉（QA-ACCEPTANCE §4）

### 4.1 无头截图套件

`tests/headless/run_suite.cjs` 14 个场景（桌面 ×5、手机竖屏 ×4、横屏 ×2、示例 ×2、库入口 ×1）：
- 单文件版 **14/14** 通过，目录版 **14/14** 通过；每张截图 >2 KB（最小 41 KB，最大 322 KB）；无 `#cl-error-log` 错误、无未捕获异常。
- 生成 contact sheet：`tests/headless/out/index.html`。

### 4.2 人工 read_image 抽查（5 张关键图 + 与原版对照）

| 截图 | 检查结论 |
|---|---|
| `tests/headless/out/desktop-halite.png` | 球棍 + 灰色圆柱键 + 浅灰晶胞线 + 深色背景 + 左上 HUD “27 原子 54 化学键” + 右上元素图例 + 右下 axes gizmo + 左右面板/状态栏齐全，**与 `../docs/screenshot-main.png` 视觉语言一致** |
| `tests/headless/out/desktop-quartz-poly.png` | SiO₄ 四面体半透明蓝面 + 描边 + 中心 Si 球可见；HUD 显示多面体 5/原子 5；与 `../docs/screenshot-polyhedral.png` 的多面体表现一致（色相由中心元素颜色驱动，符合 spec） |
| `tests/headless/out/desktop-fluorite-spacefill.png` | 空间填充，无键线；Ca（vdw 2.31）/F（vdw 1.47）半径层次存在；仅 HUD 键数问题见 D-QA-01 |
| `tests/headless/out/phone-halite.png` | 390×844 竖屏：appbar/标签页/HUD/视口/底部工具栏/状态栏五段无重叠，7 个工具按钮全部可见（含“更多”），状态栏“已载入 halite.cif”正确，安全区留白正常 |
| `tests/headless/out/phone-diamond.png`（2×2×2 超胞） | 原子布满视口、无溢出、无白屏；工具栏完整 |
| `tests/headless/out/land-poly.png`（844×390 横屏） | 左右面板 + 视口并排，无重叠，HUD/gizmo 正常 |
| `tests/headless/out/example-water.png` | 分子（无晶胞线框、无晶胞参数）、O 红/H 白、O–H 键正常、compact HUD “water (H2O) · XYZ” |
| `tests/headless/out/library-open.png` | 首屏空状态完整：品牌标识、空状态文案、“经典晶体库”按钮、格式提示、状态栏 |

另用 URL 参数 + DOM 文本验证自动化钩子（`?lib / ?example / ?style / ?supercell / ?lang / ?showBoundary / ?measure`）全部生效：
`?lib=halite`→27 原子/54 键；`&showBoundary=0`→8 原子/12 键；`&supercell=2x2x2&showBoundary=0`→64 原子/144 键；`?measure=distance`→提示“距离测量：点击两个原子”；`?lang=en` 全英文无中文残留；`?style=space-fill` 生效（见 D-QA-01 的 HUD 计数）。

### 4.3 `?selftest=1`

- 单文件版 & 目录版：`#cl-selftest` 存在，**pass=32 / fail=0**，`info.renderer="webgl2"`、`info.rendererSupported=true`、12 个 `atoms_<id>`（晶体库 12 个全部解析+建模成功）、`frames=2`、`clipped=false`、HUD/gizmo 布局矩形有效。
- 覆盖：库/示例数据、core、renderer、camera、i18n(≥251 keys+关键键)、UI 元素、Android 钩子、对话框挂载/表单校验、共享文件钩子、导出管线、语言切换往返、超胞重建、编辑+撤销往返、两帧渲染。

## 5. 免安装预览版（QA-ACCEPTANCE §5）

`tests/qa/check_preview.cjs`：**21/21 通过**。

- 单文件 `dist/CrystalLens-Android-Preview.html`：**1,128,458 B**（≤2 MB 预算）、DOCTYPE/≥20 个内联 script、**无 `<script src>`/`<link rel=stylesheet>`/本地 src|href**、**无 fetch/XHR/Worker/module/动态 import/WebSocket/serviceWorker**、无外部 CDN URL（仅 CIF 溯源注释里的 cod/amcsr URL，非网络请求）、内嵌晶体 **12** + 示例 **6**、`CL.assets` 已注入（9 个内联 PNG data URI）、文件名 `crystallens-build` 元信息存在。
- `dist/preview/` 目录版：index.html 的 22 个本地引用全部存在（含此前修复的 `js/data/library.js`）、`build.json` 字段正确、`data/` 原始目录未误打包、36 个文件。
- **一致性**：APK 内 `assets/www/` 与 `dist/preview/` 文件清单、逐文件 SHA256 **完全一致**（34/34 文件）。
- 两种形态均可 `file://` 直接无头加载（selftest 通过），满足“双击/离线可用”。

## 6. APK（QA-ACCEPTANCE §6）

`tests/qa/check_apk.ps1`：**31/31 通过**。产物 `dist/CrystalLens-v1.1.0-android.apk`：540,473 B，SHA256 `8b6f1b52a7bc05c358c02d3ea663d85c35c8ce4fc63fa834bcc48e3fb94e8c37`。

| 检查 | 实测 |
|---|---|
| apksigner verify | exit 0 / `Verifies`；v2 scheme=true；v3 scheme=true；cert `CN=CrystalLens Debug, O=Android, C=US` |
| badging | package=`com.crystallens.android`、versionCode=**110**、versionName=**1.1.0**、minSdk=**24**、targetSdk=**36**、launchable-activity=`com.crystallens.android.MainActivity`、label=CrystalLens |
| permissions | 仅 `android.permission.VIBRATE`；无 INTERNET / READ/WRITE_EXTERNAL_STORAGE / MANAGE_EXTERNAL_STORAGE |
| zip 条目 | `AndroidManifest.xml`、`resources.arsc`、`classes.dex`(>1 KB)、`assets/www/index.html` 齐全；无重复条目；`assets/www/` 34 个文件 |
| assets 与预览版 | 文件清单一致、逐文件 SHA256 一致（34/34） |
| `dist/build-info.json` | 字段完整；package/version/minSdk/targetSdk/toolchain(jdk/buildTools 36.0.0/platform android-36)/signature.verified/verified.apksigner 均正确；`apkSizeBytes`、`sha256` 与磁盘实际一致；`wwwFileCount=34` |
| APK 内 assets 无头 selftest | 解压到临时目录 `file://.../assets/www/index.html?selftest=1`：selftest 通过（fail=0、pageErrors=0、WebGL2、frames=2、12 个晶体解析） |

## 7. 缺陷清单

### D-QA-01 · P2（视觉/UI）· space-fill 样式的 HUD 化学键数错误

- **现象**：空间填充样式下 HUD 仍显示化学键数量。实测 `?lib=fluorite&style=space-fill` HUD = “萤石 · CIF · **22 原子 32 化学键**”；按 v1.1 行为应为“22 原子”（空间填充不构建可见键，键数 0，且 HUD 规则不追加键数）。
- **复现**：
  ```powershell
  & "...node.exe" tests\headless\shot.cjs --url "file:///D:/vibe/crystal/dist/CrystalLens-Android-Preview.html?lib=fluorite&style=space-fill" --dom
  # 读取 #hud-title-suffix
  ```
- **期望 vs 实际**：期望 `22 原子`（无键数）；实际 `22 原子 32 化学键`。
- **依据**：`docs/spec/render.md` §5.2（`style != SpaceFill` 才计 visibleBondCount/画键）与 §13.3（HUD 键数只在不显示多面体时追加）；C++ `Renderer::BondCount()`=visibleBondCount，SpaceFill 下为 0。
- **证据**：`tests/headless/out/url-fluorite-spacefill.html`（DOM）、`tests/headless/out/desktop-fluorite-spacefill.png`。
- **建议修复文件**：`web/js/ui/panels.js`（`renderHud()`，约 L416–425：非 polyhedral 分支无条件追加 `bonds` 文本；SpaceFill 时应按 v1.1 口径显示 0 键/不显示键数，ball-stick 数值不变）；如模型层统一口径可改 `web/js/core/crystal.js` 的 `stats.visibleBondCount`（需同时保证 ball-stick/polyhedral 数值不变）。
- **影响**：仅 HUD 文案，不影响渲染、交互与数值；非阻断。

### D-QA-02 · P3（文档）· `docs/spec/camera-cases.md` A4 正交投影矩阵参考值错误

- **现象**：A4 用例参考表写 `projectionMatrix(1000,800)` 的 `m[0]=0.112561735`（halfW=8.8840137=halfH×1.5），但 `halfW` 必须使用**视口** aspect=1000/800=1.25 → `m[0]=1/(5.9226758146453555×1.25)=0.135074079`。
- **依据**：`../src/render/Camera.cpp` L217–240（`halfW = halfH * aspect`，aspect=width/height）；JS 实现逐项一致（0.13507407903671265），A4 其余 3 项参考值（m[5]/m[10]/m[14]）均命中。
- **影响**：仅文档误导实现/测试；JS 实现是正确的。已在 `tests/qa/check_camera.cjs` 中按 C++ 真值断言并加注释。
- **建议修复文件**：`docs/spec/camera-cases.md`（A4 参考表 m[0] 改为 0.135074079，halfW 改为 7.4033448）。

无 P0（阻断）/P1（功能）缺陷。

## 8. 未覆盖/受限项（非缺陷，需真机或交互式验证）

1. **真实安卓设备安装与运行**：本环境无 Android 设备/模拟器；APK 仅做静态校验 + 无头 Edge 加载同份 assets 的 selftest。建议侧载真机冒烟（打开库、文件“打开方式”、保存/分享）。
2. **触控手势**（单指惯性旋转、双指 pinch/pan、双击 fit、长按拾取）与 **多标签页**、**外观色轮/持久化**、**撤销 50 步上限**、**复制摘要/保存文件对话框**：selftest 已覆盖编辑+撤销往返、导出管线、对话框挂载与表单校验，但完整交互需真机/人工点验（QA-ACCEPTANCE §7）。
3. **50k 原子旋转帧率**：无头 SwiftShader 下无法得到有代表性的 FPS；selftest 只验证 16³ 超胞不崩溃与 2×2×2 重建预算。建议真机采一次 FPS。
4. **`?library=1` 场景**：`run_suite.cjs` 的 `library-open` 场景用 `?library=1`，CONTRACT §6.9 未定义该参数，故截图仅验证空状态首屏；晶体库面板打开需交互验证（非产品缺陷，属测试覆盖说明）。
5. **VESTA/XYZ/CIF 本地文件多选打开**：`file://` 下无头无法稳定构造文件选择；解析层已覆盖三种格式（含多 block/多模型/边界用例）。

## 9. 证据索引

| 证据 | 路径 |
|---|---|
| QA 一键矩阵摘要 | `tests/headless/out/qa-summary.json` |
| Node 全量测试日志（190 passed） | `tests/headless/out/qa-node-tests.log` |
| 相机 A1–A7 报告 | `tests/headless/out/qa-camera-report.json` / `qa-camera.log` |
| 预览版结构检查 | `tests/headless/out/qa-preview-report.json` / `qa-preview.log` |
| 截图套件日志 + 报告 | `tests/headless/out/qa-visual-single.log`、`qa-visual-folder.log`、`qa-visual-*-report.json` |
| 截图（14 场景 ×2 目标，后写覆盖为目录版） | `tests/headless/out/*.png`、`tests/headless/out/index.html` |
| selftest（单文件/目录） | `tests/headless/out/qa-selftest-single.log`、`qa-selftest-folder.log`、`qa-selftest-*.png` |
| APK 校验 | `tests/headless/out/qa-apk-report.json` / `qa-apk.log` |
| APK 构建 | `tests/headless/out/qa-build-apk.log`、`dist/build-info.json` |
| 复现旧缺陷（space-fill HUD）DOM | `tests/headless/out/url-fluorite-spacefill.html` |
| 验收测试代码 | `tests/node/test_acceptance.js`（32 组） |
| QA 脚本 | `tests/qa/run_all.ps1`、`check_camera.cjs`、`check_preview.cjs`、`check_apk.ps1` |

---
*报告生成：QA agent（impl-qa）· 2026-11-21 22:01 · 所有结论均来自上述可复现命令；未修改任何业务代码。*

---

## 10. 最终构建复核（lead 修复 D-QA-01/D-QA-02 后，只读验证）

> 复核时间：2026-11-21 22:02–22:04（Asia/Shanghai）。
> 按 lead 指示**未执行任何构建/重建**（未运行 `tools/build_web.py` / `tools/build_apk.ps1`），仅只读验证；复核前后产物 SHA 不变。

### 10.1 产物与哈希（dist/build-info.json 22:02:24 重建）

| 产物 | 大小 | SHA-256 |
|---|---|---|
| `dist/CrystalLens-v1.1.0-android.apk` | 540,473 B | `a728edea271060ac15459e71747ffa7dcb6e6d5966286d4b67e3b62411a3f491` |
| `dist/CrystalLens-Android-Preview.html` | 1,128,654 B | `abe9fcf90d4b10a067ffa1ebdb0f69e015dc39acd9898ff324080d3b331c6900` |
| `dist/preview/` | 34 个文件 | 与 APK 内 `assets/www/` 清单+逐文件 SHA256 一致 |

`dist/build-info.json`：`apkSizeBytes`=540473、`sha256` 与磁盘实际 APK 哈希一致、`builtAt`=2026-11-21T22:02:24、`wwwFileCount`=34、`webSource="preview"`。

### 10.2 缺陷修复复核

- **D-QA-01（P2）· 已关闭**：`?lib=fluorite&style=space-fill` HUD = `CIF · 22 原子`（**无 “32 化学键”**）；对照回归：ball-stick `?lib=fluorite` = `22 原子 · 32 化学键`、`?lib=halite` = `27 原子 · 54 化学键`（未被误改）、polyhedral `?lib=quartz&style=polyhedral` = `多面体 5 · 原子 5`（分支不变）；4 个场景 `#cl-error-log` 均为 `[]`。
- **D-QA-02（P3 文档）· 已关闭**：`docs/spec/camera-cases.md` L123 的 A4 正交投影矩阵已改为 `m[0]=0.135074079`（halfW=7.4033448），与 C++ `Camera.cpp` / JS 实现一致。

### 10.3 复核结果（全部通过）

| 复核项 | 命令/方式 | 结果 |
|---|---|---|
| a) space-fill HUD + 回归 | `shot.cjs --dom` 读 `#hud-title-suffix` | 通过（见 10.2） |
| b) APK 校验 | `tests/qa/check_apk.ps1`（只读，解包到临时目录） | **31/31 通过**；apksigner v2+v3 Verifies；assets 清单与 SHA256 同 `dist/preview`；build-info SHA 一致 |
| c) APK 内 assets 无头 selftest | 解包 `assets/www/index.html?selftest=1`（file://） | **pass=32 / fail=0**、`rendererSupported=true`、`frames=2`、`pageErrors=[]`（exit 0） |
| d) 只读回归 | `tests/node/run.js` / `check_camera.cjs` / `check_preview.cjs` | 190/190 tests（验收 32/32 组）、相机 7/7、预览版 21/21 |

**最终判定：当前构建（APK SHA-256 `a728edea…f491`）全部 P0/P1/P2 代码缺陷清零，自动化矩阵全通过，可交付。** 未覆盖项仍同 §8（真机安装/触控/分享、50k 原子 FPS）。

### 10.4 复核证据

- APK：`tests/headless/out/qa-apk-final.log`、`qa-apk-report.json`
- APK 内 assets selftest：`tests/headless/out/qa-final-apk-assets-selftest.log`、`final-apk-selftest.png`
- HUD 复核 DOM：`tests/headless/out/final-spacefill-fluorite.html`、`final-ballstick-fluorite.html`、`final-ballstick-halite.html`、`final-poly-quartz.html`
- 只读回归日志：`tests/headless/out/qa-node-tests-final.log`、`qa-camera-final.log`、`qa-preview-final.log`
