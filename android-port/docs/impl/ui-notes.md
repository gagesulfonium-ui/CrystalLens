# 移动端 UI / 交互实现说明（impl-ui）

> 范围：`web/index.html`、`web/css/**`、`web/js/ui/**`、`web/js/boot.js`。
> 契约基线：`docs/CONTRACT.md` §4/§5.3/§5.4/§6.7–6.10/§8/§10；规格：`docs/spec/ui.md`、
> `ui-tokens.json`、`i18n.json`、`help.md`。渲染/模型由并行 agent 提供，本文记录 UI 侧
> 的接线方式、降级路径与自测方法。

## 1. 文件清单

| 文件 | 作用 |
|---|---|
| `web/index.html` | 页面骨架：appbar / 文档标签栏 / workspace / 左右面板 / HUD / 空态 / 手机底部动作条 / 状态栏 / sheet+menu+toast 容器 / 文件 input。脚本顺序严格按 CONTRACT §4（经典 `<script>`，无 module/fetch）。 |
| `web/css/app.css` | 全部视觉 token（ui-tokens.json）、桌面三栏 + 平板横屏并排 + 手机抽屉/底 sheet 三档响应式、安全区、触控热区、HUD、表单、菜单、toast。 |
| `web/js/ui/i18n.js` | `CL.i18n`：`docs/spec/i18n.json` 全部 251 条 + 62 条移动端补充键（共 313）；`t(key,...args)` 支持 `%s`/`%d`/`%.nf`，缺键 console.warn 一次并返回 key；`setLanguage` 持久化 `crystallens.language` 并即时刷新 DOM（`data-i18n*`）；`onChange`。 |
| `web/js/ui/native.js` | `CL.Native`：`window.CLNative` 桥（beginExport/appendExportChunk/endExport/toast/vibrate/keepScreenOn/exitApp/getInfo/共享文件轮询），无桥时 `<a download>` / Web Share 回退；UTF-8 ↔ base64 助手（分块 24 KiB）。 |
| `web/js/ui/app.js` | `CL.App`：设置持久化、多文档会话、打开文件/晶体库/示例、Renderer+Camera 接线、脏标记渲染循环、指针/滚轮/键盘、选择/测量/编辑撤销、保存/导出/截图/摘要、语言切换、抽屉/返回键/共享文件钩子、URL QA 钩子与 selftest、错误日志钩子、Camera2D/Canvas2D 降级实现。 |
| `web/js/ui/panels.js` | 左面板（结构/晶胞/结构信息/显示/外观/元素）、右面板（选择/测量）、HUD（标题/测量横幅/元素图例/提示/gizmo/测量与原子标签）、状态栏。 |
| `web/js/ui/dialogs.js` | 底部 sheet / 居中对话框：晶体库+示例、超胞、外观（HSV 色轮+明度条+3 色块+3 滑杆）、编辑晶胞、添加/编辑原子、删除确认、未保存确认、通用确认/错误、保存/分享/导出、帮助/关于、溢出菜单、Toast。 |
| `web/js/boot.js` | `#cl-error-log` 全局 onerror/unhandledrejection 捕获、启动 `CL.App.init()`、启动失败兜底（写 selftest fail>0、6 s 后强制移除 splash、绝不留白屏）。 |
| `docs/impl/ui-notes.md` | 本文件。 |

## 2. 页面与布局

- 手机竖屏（≤719px 或 portrait）：appbar（品牌/当前晶体名/打开·保存·语言·菜单）+ 文档标签栏 +
  全屏视口 + HUD + 手机底部动作条（打开/晶体库/键长/键角/结构/测量/更多）+ 状态栏；左右面板为
  `position:fixed` 抽屉（左 310 / 右 328，带 scrim、44px 关闭热区）。
- 手机/平板横屏（≥720px 且 landscape）：左右面板**并排常驻**（216/242），视口居中；HUD 图例与
  提示条按宽度收紧；无手机底部动作条。
- 桌面（≥1200px）：0 菜单栏并入 appbar；左 262 / 右 296 常驻，视口圆角外框，完整 HUD。
- 安全区：`env(safe-area-inset-*)` 计入 appbar/状态栏/抽屉/sheet/toast；禁用页面滚动与缩放
  （`body{touch-action:none}`，仅面板/sheet 内容 `pan-y`）；`user-select:none`（输入框除外）。
- 触控目标：按钮/开关/分段 ≥ 40–48px；表单输入高 46–48px + `inputmode`。
- HUD 职责（CONTRACT §5.4）：UI DOM 画**元素图例 / gizmo / 原子标签 / 标题 / 横幅 / 提示**；
  渲染器 overlay 画**测量线、端点、数值框**（`renderOptions().overlay = {gizmo:false,legend:false,labels:false,measurements:true}`）。
  Canvas2D 降级渲染器没有 overlay 时，UI 用 DOM 画测量标签。

## 3. 状态与数据流

```
DocumentSession = { id, title, sourceName, format, structure, model, builtKey,
                    meta, demo, libId, sourceText, cameraState, selected, measurements[],
                    undo[], redo[], dirty, userAdjusted }
```
- 渲染器只有一个；切换文档时 `setModel` + 恢复该文档 `cameraState`（首次打开自动 fit）。
- 显示选项/超胞/外观/语言为**全局设置**（持久化到 `crystallens.settings.v1`），文档切换复用；
  结构/相机/选择/测量/撤销栈按文档隔离。`builtKey = supercell × showBoundary × style`，
  style 切到 polyhedral 且 `polyhedra.enabled=false` 时强制重建模型（lead 口径）。
- 设置默认值对齐 ui.md §15.1：style=ball-stick、atomScale 0.30、showBoundary 1、边界原子开、
  外观 cellColor `#D6DEE9` / bg `#020305` / cellWidth 1.0 / polyTransparency 66 / polyEdgeWidth 1.2 /
  polyEdgeColor `#91B4D3`；语言默认中文。
- 编辑：作用域为不对称单元；提交前 `JSON.stringify(structure)` 入撤销栈（深度 50），调
  `CL.crystal.setCellParameters/addAtomSite/updateAtomSite/deleteAtomSite`（返回 `{ok,structure|error}`），
  成功后 refinalize + 重建显示模型 + 清空测量 + 脏标记；`result.error` 若为 i18n key 会翻译。
- 测量：`CL.crystal.measureDistance(displayModel,a,b)` / `measureAngle(displayModel,a,b,c)`，
  用返回的 `{value, points, offsets, label}`（周期最小镜像已修正）；仅当模型层不可用（示例/降级）
  时才退回显示空间欧氏距离。

## 4. 交互状态机

- 单指/左键拖动：旋转（灵敏度 0.0072，pitch ±85°，松手惯性 exp(-6dt)，速度限 ±4）；
  双指：pinch 缩放（`distance *= exp(-log(ratio))` 等价）+ 双指中点平移；中/右键拖动平移；
  滚轮缩放（每 120 → 1 档）；双击/双击视口 `fit`；长按 520 ms 选中原子；单击拾取/在测量模式
  下加入 pending；点空白清空选择。
- 测量：Distance/待选 2 原子、Angle/待选 3 原子（第 2 个为顶点）；重复点忽略；完成后模式保持、
  Flash 2.4 s；Esc/返回键退出测量，再按清除选择，再按关抽屉/关弹层 → `window.__clHandleBack()`
  返回 `'true'`，否则 `'false'`。
- 键盘（桌面/外接键盘）：Ctrl+O/L/S/Shift+S/Z/Y/E/Shift+A/C、F1/F2/Delete/Home/F/D/A/C/B/L/P、
  方向键旋转、+/- 缩放；输入框内不拦截。
- 文件：`<input type=file multiple accept=...>`、桌面拖放、剪切板文件、Android 共享文件
  （`__clOpenSharedFile(name, base64)` → UTF-8 文本 → 新标签）。多文件按顺序建标签。
- 保存/导出：底部 sheet 提供 CIF/XYZ/PNG 的保存与分享 + 复制摘要；文件名
  `CrystalLens-<title>-<yyyymmdd-hhmmss>.<ext>`；分块经 `CL.Native`，非 Android 走下载/Web Share。
  CIF 无晶胞时按 `toast.no-cell-for-cif` 提示；`exportCif` 返回 null 时兼容 `exportCifResult`。

## 5. 降级与容错

- 核心/渲染缺失时（并行开发期）：`CL.Renderer` 不可用 → 内置 Canvas2D 渲染器（球/键/晶胞/坐标轴/
  拾取/截图）；`CL.Camera` 不可用 → 内置相机；`CL.parsers`/`CL.crystal` 可用性分别检测；晶体库
  无解析器时用元数据生成"演示模型"并明确标注 DEMO（`ui.demo.note`），绝不白屏/抛出未捕获异常。
- 模型层 `buildDisplayModel` 抛错 → 记录 `#cl-error-log` 并退回简化模型（sites 直接显示）。
- 所有页面异常写入 `<pre id="cl-error-log">{json array}</pre>`（boot.js 早于 App 安装）。

## 6. i18n 落地

- 251 条规格键全部存在，另加 62 条移动端键（触屏手势、底部动作条短标签、导出/分享、示例、
  结构信息、演示/降级提示等），完整列表见 `web/js/ui/i18n.js` 生成脚本附录（当前 313 条）。
- 切换语言：i18n.apply 刷新 `data-i18n*`，App 重建 tabs/面板/HUD/状态栏，抽屉/sheet/menu 重渲染，
  写入 `crystallens.language` 与设置 JSON；语言即时生效且保留选择/测量/相机。
- 数值格式：晶胞 4/2 位、坐标 4/3 位、占位率 2 位、Uiso 4 位、距离 3 位+Å、角度 2 位+°，
  优先使用 `CL.crystal.formatLength/formatAngle/formatCoord`（如存在）。

## 7. QA 钩子（供 lead/impl-qa）

URL 参数（`file://` 或 http 均可）：
`?lib=<id>`、`?example=<file>`、`?style=ball-stick|space-fill|polyhedral`、`?supercell=2x2x2`、
`?lang=zh|en`、`?showBoundary=0|1`、`?measure=distance|angle`、`?selftest=1`、
以及 UI 截图辅助：`?drawer=left|right`、`?select=<atomId>`、`?sheet=library|supercell|appearance|edit-cell|add-atom|help|save|menu`。

隐藏 DOM：
- `<pre id="cl-selftest">`：32 项检查（12 晶体库 parse+finalize+buildDisplayModel(2×2×2)、
  renderer.supported、camera、i18n≥251、关键 UI 元素、编辑+撤销、超胞重建、测量最小镜像
  （halite 最短 Na–Cl = 2.82005，绝不为 4.88）、export、Android 钩子（返回键/共享文件）、对话框挂载与表单校验、同步渲染 2 帧）。
- `<pre id="cl-error-log">`：全局错误 JSON 数组。
- `<pre id="cl-runtime-info">`：启动/每次 resize 约 0.2–1.2 s 后写入的实时布局快照
  （window/viewport/相机/投影原子包围盒/clipped/modelStats），无头排版自测用。

## 8. 无头截图注意（Windows Edge headless 限制）

本机 Edge `--headless=new` 会被操作系统最小窗口宽度（~492px）钳制：`--window-size=390,844`
时 `window.innerWidth=492`，而截图文件仍是 390×844（左上裁剪）。为让 390 宽截图真实可信，
`app.js` 在检测到 `HeadlessChrome` 且 `innerWidth≈492` 时把 App 外壳（app/抽屉/sheet/toast/
scrim/menu）钉到 390 CSS px（`html.cl-qa-size`，同时禁用过渡动画，右抽屉按钉宽贴右），
真机/WebView 的 UA 不会命中该分支。可用 `?vw=390&vh=844` 强制/覆盖。

截图命令示例（产物在 `tests/headless/out/`）：

```
node tests/headless/shot.cjs --url "file:///D:/vibe/crystal/dist/preview/index.html?lib=halite" \
  --out tests/headless/out/final-phone-halite.png --width 390 --height 844 --budget 10000
node tests/headless/shot.cjs --url "file:///D:/vibe/crystal/dist/preview/index.html?selftest=1" --selftest
```

## 9. 已知风险 / 待集成确认

1. 左右面板抽屉打开时 `position:fixed` 覆盖 appbar（与规格"底部 sheet"略有出入，按任务要求
   采用左右抽屉；横屏为并排常驻）。
2. 显示开关/超胞/样式为全局设置（非每文档快照）；文档独立的是结构/相机/选择/测量/撤销栈。
3. 测量标签在 WebGL2 模式依赖 Renderer overlay；若 overlay 未按 CONTRACT §5.4 落实，3D 中只有
   测量线而无数值框（UI 侧不重复绘制）。Canvas2D 降级模式由 DOM 绘制标签。
4. 截图（`renderer.screenshot()`）只含 3D+renderer overlay，不含 DOM HUD（标题/图例/gizmo 等）；
   如需含 HUD 需 lead 决定是否在 UI 侧合成 canvas。
5. `CL.Native` 的 Java 侧方法名/返回格式以 `android/` 实现为准；当前对
   `beginExport/appendExportChunk/endExport/getInfo/consumeSharedFile` 均做了存在性判断与 JSON 容错。
6. 外观设置"恢复默认"/关闭保存依赖 `localStorage`；隐私模式写入失败被静默忽略（沿用内存态）。
