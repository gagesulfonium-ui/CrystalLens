# CrystalLens 安卓版 · 验收标准与测试数据（QA 基准）

> 由 lead 维护。所有实现 agent 完成前必须按本文件自检；QA agent 以此产出报告。
> 数值来源：`docs/spec/core.md`（v1.1 C++ 行为核实）、`../tests/*.cpp`、
> `../README.md` 历史断言、`docs/spec/camera-cases.md`。

## 0. 命令

```powershell
# 单元测试（Node，无依赖）
& "node" tests\node\run.js

# 构建 Web（内嵌晶体库 + 目录版 + 单文件版）
& python tools\gen_library.py
& python tools\build_web.py

# 无头渲染截图套件（自动探测 Edge）
& "C:\...\node.exe" tests\headless\run_suite.cjs

# 单测 + selftest + APK 一键
powershell -ExecutionPolicy Bypass -File tools\build_all.ps1

# APK 验证
cmd /c ".toolchain\android-sdk\build-tools\36.0.0\apksigner.bat" verify --verbose --print-certs dist\CrystalLens-v1.1.0-android.apk
.toolchain\android-sdk\build-tools\36.0.0\aapt2.exe dump badging dist\CrystalLens-v1.1.0-android.apk
```

## 1. 解析层（CL.parsers）验收

- 12 个晶体库 CIF（`web/data/library/*.cif`）全部 `parse` 成功；`format='cif'`、`periodic=true`、`cell` 合法、`symops.length>0`、`sites.length>0`、`siteIndex` 连续。
- halite：a=b=c=5.6401 Å、α=β=γ=90、空间群 "F m -3 m"、sites=2（Na/Cl）。
- wurtzite/quartz/calcite：γ=120°；单斜/三斜结构晶胞角正确。
- 6 个示例：`quartz.cif`、`diamond.cif`、`srtio3.cif`（cif）、`nacl.vesta`（vesta）、`water.xyz`/`benzene.xyz`（xyz，periodic=false）。
- 边界用例（内联文本）：无引号逐行对称操作；`1.234(5)`；`1/3`；多 data block 取原子最多；引号内含撇号标签；`_atom_site_type_symbol` 优先于标签推断；未知元素 → "X"；多模型表取第一个。
- `CL.periodic`：118 元素 + X；Na=11、Cl=17、Ti=22、Si=14、O=8、Ni=28、Bi=83、Te=52 的半径/颜色与 `docs/spec/elements.json` 一致；`elementFromInput('Si')='Si'`、`'14'='Si'`、`'si'='Si'`。

## 2. 模型层（CL.crystal）数值基准（v1.1 对齐）

晶胞内容（对称展开后 `atoms`）：
- halite 常规胞：4 Na + 4 Cl（8 原子），周期键 24 条 Na–Cl，键长 2.8201 Å（±1e-3）。
- quartz（α-石英）：Si–O 键长 1.6046 / 1.6124 Å，周期键 12 条（示例 CIF）。
- diamond：周期键 16 条。
- water.xyz（分子）：2 条 O–H 键。
- Bi₂Te₃（`build/Bi2Te3.cif` 如存在；或内联）：Bi–Te 远距离接触不连键（0 条 Bi–Te）。
- 无序集合中互斥组位点之间不自动成键。

显示集合（`buildDisplayModel`，halite，含边界）：
- 1×1×1：atom 实例 27（cell 8 + boundary 19）。
- 2×2×2：125（cell 64 + boundary 61；其中 Na 中心 63）。
- 3×3×3：343（cell 216 + boundary 127）。
- 2×2×2 且 `showBoundary=false`：64（= cell）。
- 多面体（halite 2×2×2，`style=polyhedral`）：中心/多面体数量 63。
- 超胞容量：请求范围 1–16；超出位点 65536 / 键 300000 / 显示像 80000 时截断并置 `stats.supercellLimited/boundaryLimited`，不得崩溃。
- atoms.id 连续；`kind='boundary'` 原子 `pickable=false`；`cellAtomCount`+`boundaryAtomCount`=visibleAtomCount 一致。
- `lines` 包含晶胞边（超胞时含每个子晶胞的边线）；`origin` 等于结构中心；`polyhedra.enabled` 与 style 无关（模型总是生成，渲染器按 style 显示）——以 CONTRACT 为准。
- 性能：2×2×2 halite `buildDisplayModel` < 500ms（PC）；16×16×16 不 OOM/不崩溃（受上限截断）。

测量：
- halite 最近 Na–Cl 距离 2.8201 Å（最小镜像）；Si–O–Si 键角按 quartz 数据合理（与 C++ test_core 对照）。
- `measureDistance` 对相邻晶胞像返回最小镜像距离与 offset。

编辑：
- `setCellParameters`：非正数/角度越界返回 `{ok:false}`；成功后续展开与摘要更新（原子数按新胞变化）。
- `addAtomSite/updateAtomSite/deleteAtomSite`：作用于不对称单元；非法元素/占位率 (0,1] 拒绝；成功后重建对称原子/键/摘要。
- 编辑后 `exportCif` → `parse` 往返：晶胞参数、对称操作数、位点数一致（±1e-4）。
- `exportXyz` 行数 = 显示原子数（cell 部分）+2（首行原子数、注释行）。
- 解析后的 StructureData 可 `JSON.parse(JSON.stringify())` 无损往返（撤销快照）。

## 3. 相机（CL.Camera，对照 docs/spec/camera-cases.md）

- 默认 yaw=35°、pitch=24°、fovY=38°、margin 1.12/1.16。
- 7 组用例：fit 距离、eye 坐标、worldToScreen 屏幕坐标、view/projection 矩阵（误差 <1e-4）。
- orbit/pan/zoom 后的 eye/forward/right/up 正交且单位长；worldToScreen∘screenRay 一致。
- 正交与透视切换；near/far 随距离自适应（近平面>0）。

## 4. 渲染器（无头截图 + selftest）

- `tests/headless/run_suite.cjs` 全部场景截图 >2KB、无 `#cl-error-log` 错误、无未捕获异常。
- 视觉检查（人工 read_image）：
  - 桌面 halite：球棍、灰色圆柱键、浅灰晶胞线、图例、深色背景。
  - `style=polyhedral` quartz：SiO₄ 四面体半透明面 + 描边，中心原子可见。
  - `space-fill` fluorite：Ca/F 半径对比合理、无键。
  - `supercell=2x2x2`：每个子晶胞边线可见、原子布满超胞。
  - 手机竖屏：工具栏/状态栏/视口不重叠、安全区正确、点击目标可辨。
  - `lang=en`：界面英文完整（无中文残留）。
- `?selftest=1`：`#cl-selftest` 存在，`fail=0`；info 含库加载数量=12、renderer.supported=true。
- 截图中 HUD/标签/图例存在（2D overlay 与 WebGL 合成正确）。
- 性能：桌面 5 万原子（可构造）旋转 ≥30fps；手机目标 ≥30fps（以中端机估计，无设备时记录 PC SwiftShader 数据即可）。

## 5. 免安装预览版

- `dist/CrystalLens-Android-Preview.html` 单文件：无 `src="js/`、`href="css/` 等本地引用；双击/`file://` 打开可用；无网络请求；晶体库可打开。
- `dist/preview/` 目录版经 `python tools/serve_preview.py` 可访问，功能与单文件版一致。
- 预览版与 APK 内 `assets/www` 内容一致（文件清单/SHA 对比）。

## 6. APK

- `apksigner verify` 通过（v2/v3）；`aapt2 dump badging`：package=com.crystallens.android、versionName=1.1.0、versionCode=110、minSdk=24、targetSdk=36、launchable-activity 存在。
- 无 INTERNET/READ/WRITE_EXTERNAL_STORAGE 权限；允许 VIBRATE（normal）。
- 必需 zip 条目：AndroidManifest.xml、resources.arsc、classes.dex、`assets/www/index.html`；assets 内文件清单与 dist/preview 一致。
- `dist/build-info.json` 存在且字段完整（size/sha256/toolchain/verification）。
- 无法真机验证时，至少：APK 内 HTML 用无头 Edge 加载（从解压目录）通过 selftest。

## 7. UI 功能清单（手工/无头可点验）

- 首屏空状态可打开经典晶体库 → 打开 12 个结构中任意一个。
- 打开本地 CIF/XYZ/VESTA 文件（多选）；示例入口。
- 触控：单指旋转（有惯性）、双指缩放/平移、双击 fit；桌面鼠标等价操作。
- 单击原子选中 → 右侧信息；测量距离（2 原子）/角度（3 原子）显示数值与线；清除。
- 左面板：晶胞参数、显示开关（晶胞/键/标签/边界原子）、外观三样式、超胞、外观设置、结构信息。
- 外观设置：色轮/滑杆实时生效、关闭保存、重启恢复。
- 编辑：晶胞参数、添加/编辑/删除原子、校验错误提示、撤销/重做 50 步。
- 保存 CIF/XYZ、导出 PNG 截图、复制摘要（桌面回退 download/clipboard）。
- 中英文切换即时生效并持久化。
- `window.__clHandleBack()`：有弹层/抽屉时返回 'true' 并关闭；无则 'false'。
- 标签页：多结构切换/关闭，各自独立相机与撤销栈。

## 8. 已知可接受差异（不算缺陷）

- 多窗口 → 标签页（移动端形态）。
- 键盘快捷键在桌面浏览器可用、触屏以按钮替代（保留原快捷键映射）。
- MSAA/alpha-to-coverage 用 WebGL2 替代方案，边缘质量允许轻微差异。
- 多面体透明三角形为按三角心排序近似（原版同样近似）。
- Structure.note 在安卓版结构信息面板显示（原版未显示，产品改进）。
- 截图保存路径改为应用缓存 + 系统分享/另存（Android 规范）。
