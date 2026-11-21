/**
 * CrystalLens Android - i18n (CL.i18n).
 * Generated from docs/spec/i18n.json (251 desktop keys) + UI extras for the
 * Android shell. Classic script, no dependencies. See docs/impl/ui-notes.md.
 *
 *   CL.i18n.t(key, ...args)          -> localized string (%s / %d / %.nf args)
 *   CL.i18n.setLanguage('zh'|'en')   -> switch + persist + refresh DOM
 *   CL.i18n.language                 -> 'zh' | 'en'
 *   CL.i18n.onChange(cb)             -> subscribe, returns unsubscribe fn
 *   CL.i18n.apply(rootEl)            -> apply data-i18n* attributes
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};
  var STORAGE_KEY = 'crystallens.language';
  var MESSAGES = {
    "app.title": ["CrystalLens", "CrystalLens"],
    "app.tagline": ["晶体结构，清晰可见", "Crystallography, beautifully rendered"],
    "status.ready": ["就绪", "Ready"],
    "common.unknown": ["未知", "Unknown"],
    "common.none": ["—", "—"],
    "menu.file": ["文件", "File"],
    "menu.edit": ["编辑", "Edit"],
    "menu.view": ["视图", "View"],
    "menu.measure": ["测量", "Measure"],
    "menu.help": ["帮助", "Help"],
    "library.title": ["经典晶体库", "Crystal library"],
    "library.hint": ["双击打开一个晶体，或按住 Ctrl / Shift 多选，在独立窗口中打开。", "Double-click a crystal, or use Ctrl / Shift to open several in separate windows."],
    "viewport.hud.no-coordination-hull": ["无三维配位 · 球棍", "No 3D shell · ball and stick"],
    "library.col.mineral": ["晶体名称", "Crystal"],
    "library.col.formula": ["化学式", "Formula"],
    "library.col.space-group": ["空间群", "Space group"],
    "library.open": ["打开", "Open"],
    "library.unavailable": ["无法打开晶体库。请检查程序旁的 library 文件夹是否完整。", "Cannot open the crystal library. Check the library folder beside the executable."],
    "file.open": ["打开结构文件…", "Open structure…"],
    "file.reload": ["重新载入", "Reload"],
    "file.save-screenshot": ["保存视图截图", "Save viewport image"],
    "file.exit": ["退出", "Exit"],
    "edit.copy-summary": ["复制结构摘要", "Copy structure summary"],
    "edit.clear-measurements": ["清除全部测量", "Clear all measurements"],
    "file.save": ["保存结构…", "Save structure…"],
    "edit.undo": ["撤销", "Undo"],
    "edit.redo": ["重做", "Redo"],
    "edit.cell": ["编辑晶胞…", "Edit unit cell…"],
    "edit.add-atom": ["添加原子…", "Add atom…"],
    "edit.edit-atom": ["编辑选中原子…", "Edit selected atom…"],
    "edit.delete-atom": ["删除选中原子", "Delete selected atom"],
    "dialog.ok": ["确定", "OK"],
    "dialog.cancel": ["取消", "Cancel"],
    "dialog.error.invalid-number": ["请输入有效数字", "Enter valid numbers"],
    "dialog.edit-cell.title": ["编辑晶胞参数", "Edit unit-cell parameters"],
    "dialog.edit-cell.subtitle": ["应用后将重新展开对称原子并重建化学键。", "Applying the change re-expands symmetry copies and rebuilds bonds."],
    "dialog.edit-cell.error.invalid": ["晶胞参数无效，请检查长度和角度", "Invalid cell parameters; check lengths and angles"],
    "dialog.add-atom.title": ["添加原子", "Add atom"],
    "dialog.edit-atom.title": ["编辑原子", "Edit atom"],
    "dialog.atom.subtitle-fractional": ["输入元素、标签、占位率与分数坐标；新原子会按对称操作展开。", "Enter element, label, occupancy and fractional coordinates; symmetry copies are generated."],
    "dialog.atom.subtitle-cartesian": ["输入元素、标签、占位率与笛卡尔坐标（Å）。", "Enter element, label, occupancy and Cartesian coordinates (Å)."],
    "dialog.edit-atom.subtitle-fractional": ["修改不对称单元中该位点的元素、标签、占位率与分数坐标。", "Edit the asymmetric-unit site: element, label, occupancy and fractional coordinates."],
    "dialog.edit-atom.subtitle-cartesian": ["修改该原子的元素、标签、占位率与笛卡尔坐标（Å）。", "Edit this atom's element, label, occupancy and Cartesian coordinates (Å)."],
    "dialog.edit-atom.symmetry-note": ["该原子由对称操作生成；修改会同时作用于全部等价原子。", "This atom is symmetry-generated; editing affects all equivalent copies."],
    "dialog.atom.error.invalid-element": ["未知元素，请输入元素符号或原子序数", "Unknown element; enter a symbol or atomic number"],
    "dialog.atom.error.invalid-occupancy": ["占位率必须在 0 与 1 之间（不含 0）", "Occupancy must be in (0, 1]"],
    "toast.select-atom-first": ["请先在三维视图中选择一个原子", "Select an atom in the viewport first"],
    "toast.no-cell-for-edit": ["当前结构没有晶胞参数，无法编辑晶胞", "This structure has no unit cell to edit"],
    "toast.no-cell-for-cif": ["CIF 导出需要晶胞参数；请改用 XYZ 格式", "CIF export requires a unit cell; choose XYZ instead"],
    "dialog.save.title": ["保存结构", "Save structure"],
    "toast.save.saved-title": ["结构已保存", "Structure saved"],
    "toast.save.saved": ["已保存到 %s", "Saved to %s"],
    "toast.save.failed": ["保存结构失败", "Could not save the structure"],
    "status.structure-updated": ["结构已更新", "Structure updated"],
    "status.undone": ["已撤销", "Undone"],
    "status.redone": ["已重做", "Redone"],
    "status.atom-deleted": ["已删除原子", "Atom deleted"],
    "status.modified": ["已修改  ·  Ctrl+S 保存结构", "Modified  ·  Ctrl+S to save"],
    "dialog.unsaved.title": ["未保存的修改", "Unsaved changes"],
    "dialog.unsaved.message": ["当前结构有未保存的修改。继续将丢失这些修改，是否继续？", "The structure has unsaved changes. Continue and discard them?"],
    "panel.selection.edit-atom": ["编辑原子", "Edit atom"],
    "panel.selection.delete": ["删除", "Delete"],
    "panel.cell.edit": ["编辑", "Edit"],
    "tip.save": ["保存结构   Ctrl+S", "Save structure   Ctrl+S"],
    "tip.edit-cell": ["编辑晶胞参数   Ctrl+E", "Edit unit-cell parameters   Ctrl+E"],
    "tip.add-atom": ["添加原子   Ctrl+Shift+A", "Add atom   Ctrl+Shift+A"],
    "tip.edit-atom": ["编辑选中原子   F2", "Edit selected atom   F2"],
    "tip.delete-atom": ["删除选中原子   Delete", "Delete selected atom   Delete"],
    "tip.undo": ["撤销   Ctrl+Z", "Undo   Ctrl+Z"],
    "tip.redo": ["重做   Ctrl+Y", "Redo   Ctrl+Y"],
    "help.shortcut.save": ["保存结构", "Save structure"],
    "help.shortcut.undo": ["撤销 / 重做", "Undo / redo"],
    "help.shortcut.edit": ["编辑晶胞 / 原子", "Edit cell / atom"],
    "dialog.atom.hint.element": ["符号 / Z", "Symbol / Z"],
    "dialog.field.hint.optional": ["可选", "Optional"],
    "dialog.field.hint.fractional": ["分数", "Fractional"],
    "view.reset": ["重置视图", "Reset view"],
    "view.fit": ["适应窗口", "Fit to window"],
    "view.perspective": ["透视投影", "Perspective projection"],
    "view.orthographic": ["正交投影", "Orthographic projection"],
    "view.toggle-cell": ["显示晶胞边框", "Show unit-cell frame"],
    "view.toggle-bonds": ["显示化学键", "Show bonds"],
    "view.toggle-labels": ["显示原子标签", "Show atom labels"],
    "view.toggle-axes": ["显示坐标轴", "Show axes"],
    "view.toggle-left-panel": ["显示结构面板", "Show structure panel"],
    "view.toggle-right-panel": ["显示测量面板", "Show measurement panel"],
    "panel.style.ball-and-stick": ["球棍模型", "Ball & stick"],
    "panel.style.space-fill": ["空间填充", "Space filling"],
    "panel.style.polyhedral": ["多面体", "Polyhedral"],
    "language.chinese": ["中文", "Chinese"],
    "language.english": ["English", "English"],
    "measure.distance": ["距离测量", "Distance"],
    "measure.angle": ["角度测量", "Angle"],
    "measure.exit": ["退出测量模式", "Exit measuring mode"],
    "help.menu.about": ["关于 CrystalLens", "About CrystalLens"],
    "help.menu.shortcuts": ["快捷键与操作", "Shortcuts & controls"],
    "dialog.open.title": ["打开晶体结构文件", "Open a crystal structure"],
    "dialog.open.filter.all": ["所有支持的结构文件", "All supported structures"],
    "dialog.open.filter.cif": ["CIF 晶体文件 (*.cif;*.mcif)", "CIF crystals (*.cif;*.mcif)"],
    "dialog.open.filter.vesta": ["VESTA 文件 (*.vesta)", "VESTA files (*.vesta)"],
    "dialog.open.filter.xyz": ["XYZ 分子文件 (*.xyz)", "XYZ molecules (*.xyz)"],
    "panel.section.structure": ["晶体结构", "STRUCTURE"],
    "panel.section.cell": ["晶胞参数", "UNIT CELL"],
    "panel.section.display": ["显示", "DISPLAY"],
    "panel.section.appearance": ["外观", "APPEARANCE"],
    "panel.section.selection": ["选择", "SELECTION"],
    "panel.section.measurements": ["测量", "MEASUREMENTS"],
    "viewport.hud.supercell-limited": ["超胞过大，显示单胞", "Supercell limit: showing one cell"],
    "viewport.hud.boundary-limited": ["边界副本已截断", "Boundary images truncated"],
    "common.atoms": ["原子", "Atoms"],
    "common.bonds": ["化学键", "Bonds"],
    "common.space-group": ["空间群", "Space group"],
    "common.formula": ["化学式", "Formula"],
    "common.cell-contents": ["晶胞内容", "Cell contents"],
    "common.source": ["来源", "Source"],
    "common.symmetry-ops": ["对称操作", "Symmetry ops"],
    "common.asymmetric-unit": ["不对称单元", "Asymmetric unit"],
    "common.volume": ["体积", "Volume"],
    "common.format": ["格式", "Format"],
    "common.data-block": ["数据块", "Data block"],
    "panel.empty.hint": ["打开文件后在此查看结构信息", "Open a structure to inspect it here"],
    "panel.display.cell": ["晶胞边框", "Cell frame"],
    "panel.display.bonds": ["化学键", "Bonds"],
    "panel.display.labels": ["原子标签", "Atom labels"],
    "panel.display.axes": ["坐标轴", "Axes"],
    "panel.display.boundary": ["边界原子", "Boundary"],
    "view.supercell": ["超胞…", "Supercell…"],
    "dialog.supercell.title": ["超胞设置", "Supercell"],
    "dialog.supercell.subtitle": ["沿 a、b、c 方向重复晶胞的次数（1–16）", "Repeat the unit cell along a, b, c (1–16)"],
    "dialog.supercell.a": ["a 方向", "a repeats"],
    "dialog.supercell.b": ["b 方向", "b repeats"],
    "dialog.supercell.c": ["c 方向", "c repeats"],
    "panel.cell.supercell-link": ["超胞", "Supercell"],
    "view.appearance": ["外观设置…", "Appearance…"],
    "panel.appearance.settings": ["设置", "Settings"],
    "dialog.appearance.title": ["外观设置", "Appearance"],
    "dialog.appearance.subtitle": ["设置晶胞边框、背景与配位多面体", "Cell frame, background and coordination polyhedra"],
    "dialog.appearance.cell-color": ["晶胞边框颜色", "Cell frame colour"],
    "dialog.appearance.poly-transparency": ["多面体面透明度", "Face transparency"],
    "dialog.appearance.poly-edge-color": ["多面体描边", "Polyhedron outline"],
    "dialog.appearance.poly-edge-width": ["多面体描边宽度（0 关闭）", "Outline width (0 = off)"],
    "dialog.supercell.error.budget": ["请减小倍率，超胞内部最多 65,536 个位点、300,000 条周期键。", "Reduce repeats to fit 65,536 sites and 300,000 periodic bonds."],
    "dialog.appearance.cell-width": ["边框粗细", "Frame width"],
    "dialog.appearance.background-color": ["背景颜色", "Background colour"],
    "dialog.appearance.brightness": ["明度", "Brightness"],
    "dialog.appearance.reset": ["恢复默认", "Reset defaults"],
    "dialog.appearance.live-hint": ["拖动色轮或滑杆时，视口会实时预览", "Drag the wheel or sliders for a live preview"],
    "dialog.appearance.error.color": ["颜色格式应为 #RRGGBB", "Colour must be #RRGGBB"],
    "dialog.appearance.error.width": ["边框粗细应在 0.5–4 之间", "Frame width must be between 0.5 and 4"],
    "dialog.supercell.error.invalid": ["超胞倍率必须是 1–16 的整数", "Supercell repeats must be integers from 1 to 16"],
    "tip.boundary": ["显示晶胞外的相邻原子和完整配位", "Show neighbouring boundary atoms and full coordination"],
    "panel.appearance.atom-size": ["原子尺寸", "Atom size"],
    "panel.appearance.style": ["渲染样式", "Style"],
    "panel.section.elements": ["元素", "Elements"],
    "panel.badge.periodic": ["周期性晶体", "Periodic crystal"],
    "panel.badge.molecule": ["分子结构", "Molecule"],
    "panel.selection.none": ["未选择原子", "No atom selected"],
    "panel.selection.hint": ["在三维视图中点击原子以查看信息", "Click an atom in the viewport to inspect it"],
    "dialog.atom.label": ["标签", "Label"],
    "dialog.atom.element": ["元素", "Element"],
    "panel.selection.fractional": ["分数坐标", "Fractional"],
    "panel.selection.cartesian": ["笛卡尔坐标", "Cartesian"],
    "dialog.atom.occupancy": ["占位率", "Occupancy"],
    "panel.selection.uiso": ["Uiso", "Uiso"],
    "panel.selection.site": ["位点", "Site"],
    "panel.selection.symmetry-image": ["对称等价位置", "Symmetry image"],
    "panel.measurements.empty": ["还没有测量结果", "No measurements yet"],
    "panel.measurements.empty-hint": ["选择距离或角度，再点击原子", "Pick a mode, then click atoms"],
    "measurement.type.distance": ["键长", "Distance"],
    "measurement.type.angle": ["键角", "Angle"],
    "panel.measurements.clear-all": ["清除全部", "Clear all"],
    "measurement.pick.distance": ["点击两个原子测量距离", "Click two atoms to measure distance"],
    "measurement.pick.angle": ["依次点击三个原子测量键角", "Click three atoms to measure the angle"],
    "measurement.selected-count": ["已选 %d / %d", "Selected %d / %d"],
    "measurement.remove": ["删除此测量", "Remove this measurement"],
    "viewport.hint.navigate": ["左键拖动旋转   ·   滚轮缩放   ·   中键 / 右键平移", "Drag to rotate   ·   Scroll to zoom   ·   Middle/right-drag to pan"],
    "viewport.legend.boundary-on": ["边界原子 = 相邻晶胞中的原子", "Boundary atoms come from neighbouring cells"],
    "viewport.legend.boundary-off": ["仅显示晶胞内原子与键", "Only unit-cell atoms and bonds are shown"],
    "viewport.hint.measure-distance": ["距离测量：点击两个原子   ·   Esc 退出", "Distance: click two atoms   ·   Esc to exit"],
    "viewport.hint.measure-angle": ["角度测量：依次点击三个原子   ·   Esc 退出", "Angle: click three atoms   ·   Esc to exit"],
    "viewport.empty.title": ["打开结构文件，开始探索晶体世界", "Open a structure and explore its crystal world"],
    "viewport.empty.subtitle": ["将 CIF、VESTA 或 XYZ 文件拖放到窗口", "Drop a CIF, VESTA or XYZ file here"],
    "viewport.empty.open": ["打开结构文件", "Open structure"],
    "viewport.empty.formats": ["CIF   ·   VESTA   ·   XYZ", "CIF   ·   VESTA   ·   XYZ"],
    "viewport.empty.footnote": ["本地解析 · 硬件加速渲染 · 无需联网", "Local parsing · GPU accelerated · offline"],
    "viewport.hud.atoms-bonds": ["%d 原子   %d 键", "%d atoms   %d bonds"],
    "toast.no-structure": ["请先打开一个结构文件", "Open a structure first"],
    "toast.open-failed-title": ["无法打开文件", "Could not open file"],
    "toast.loaded": ["已载入 %s", "Loaded %s"],
    "toast.screenshot.saved-title": ["截图已保存", "Screenshot saved"],
    "toast.screenshot.saved": ["截图已保存到 %s", "Screenshot saved to %s"],
    "toast.screenshot.failed": ["截图保存失败", "Could not save the screenshot"],
    "toast.copied-summary": ["结构摘要已复制到剪贴板", "Structure summary copied to clipboard"],
    "error.renderer.title": ["无法初始化 OpenGL 3.3 渲染器", "Could not initialize the OpenGL 3.3 renderer"],
    "error.renderer.hint": ["请更新显卡驱动后重新启动 CrystalLens", "Update your graphics driver and restart CrystalLens"],
    "status.renderer-info": ["OpenGL %s · %s", "OpenGL %s · %s"],
    "dialog.about.title": ["关于 CrystalLens", "About CrystalLens"],
    "dialog.about.version": ["版本 %s   ·   原生 C++ / OpenGL 3.3", "Version %s   ·   Native C++ / OpenGL 3.3"],
    "dialog.about.description": ["面向真实 CIF 数据的晶体结构查看与编辑工具。完整边界晶格、平滑 3D 球棍、元素图例与晶胞叠加框，打开、观察、测量和编辑结构。", "Crystal-structure viewing and editing built for real CIF data, with full boundary lattices, smooth 3D ball-and-stick, an element legend and a cell overlay."],
    "dialog.about.feature1": ["CIF / VESTA / XYZ 解析与对称展开", "CIF / VESTA / XYZ parsing with symmetry expansion"],
    "dialog.about.feature2": ["可调超胞、边界原子与专业晶胞显示", "Adjustable supercells, boundary atoms and professional cell views"],
    "dialog.about.feature3": ["晶胞与原子编辑、撤销/重做、CIF/XYZ 导出", "Cell and atom editing, undo/redo, CIF/XYZ export"],
    "dialog.about.feature4": ["键长键角测量、高 DPI 与中英双语", "Geometry measurement, high DPI and Chinese/English"],
    "dialog.about.shortcuts": ["快捷键", "Shortcuts"],
    "help.shortcut.orbit": ["旋转", "Orbit"],
    "help.shortcut.zoom": ["缩放", "Zoom"],
    "help.shortcut.pan": ["平移", "Pan"],
    "help.shortcut.fit": ["适应窗口", "Fit to window"],
    "help.shortcut.reset": ["重置视图", "Reset view"],
    "help.shortcut.distance": ["距离测量", "Distance"],
    "help.shortcut.angle": ["角度测量", "Angle"],
    "help.shortcut.cancel": ["取消 / 退出测量", "Cancel / exit measuring"],
    "help.shortcut.screenshot": ["保存截图", "Screenshot"],
    "help.shortcut.panels": ["显示 / 隐藏侧栏", "Toggle side panels"],
    "help.shortcut.reload": ["重新载入", "Reload"],
    "help.shortcut.open": ["打开文件", "Open file"],
    "dialog.about.close": ["关闭", "Close"],
    "dialog.about.footnote": ["© 2026 CrystalLens Project · 供科研与教学使用", "© 2026 CrystalLens Project · for research and teaching"],
    "dialog.about.build": ["构建于 %s", "Built %s"],
    "tip.open": ["打开结构文件   Ctrl+O", "Open structure   Ctrl+O"],
    "tip.reload": ["重新载入   Ctrl+R", "Reload   Ctrl+R"],
    "tip.screenshot": ["保存截图到图片文件夹   Ctrl+Shift+S", "Save image to Pictures   Ctrl+Shift+S"],
    "tip.fit": ["适应窗口   F", "Fit to window   F"],
    "tip.reset": ["重置视图   Home", "Reset view   Home"],
    "tip.projection": ["切换透视 / 正交投影", "Toggle perspective / orthographic"],
    "tip.cell": ["显示或隐藏晶胞边框   C", "Show or hide unit-cell frame   C"],
    "tip.bonds": ["显示或隐藏化学键   B", "Show or hide bonds   B"],
    "tip.labels": ["显示或隐藏原子标签   L", "Show or hide atom labels   L"],
    "tip.distance": ["距离测量   D", "Measure distance   D"],
    "tip.angle": ["角度测量   A", "Measure angle   A"],
    "tip.clear-measurements": ["清除所有测量结果", "Clear all measurements"],
    "tip.left-panel": ["显示或隐藏结构面板", "Show or hide the structure panel"],
    "tip.right-panel": ["显示或隐藏测量面板", "Show or hide the measurement panel"],
    "tip.language": ["切换中文 / English", "Switch Chinese / English"],
    "tip.about": ["关于与快捷键", "About and shortcuts"],
    "tip.cancel-measure": ["退出测量模式   Esc", "Exit measuring mode   Esc"],
    "status.loaded": ["已载入  %s", "Loaded  %s"],
    "status.file-info": ["%s  ·  %d 原子  ·  %d 键", "%s  ·  %d atoms  ·  %d bonds"],
    "status.hover": ["%s  ·  %s  ·  点击选择", "%s  ·  %s  ·  click to inspect"],
    "status.measure": ["%s  ·  %s", "%s  ·  %s"],
    "status.ready-hint": ["打开 CIF / VESTA / XYZ 文件开始", "Open a CIF / VESTA / XYZ file to begin"],
    "error.unsupported-format": ["不支持的文件格式", "Unsupported file format"],
    "common.untitled": ["（未命名）", "(untitled)"],
    "clipboard.atom-line": ["%s  %s  frac(%.4f, %.4f, %.4f)", "%s  %s  frac(%.4f, %.4f, %.4f)"],
    "app.version": ["v1.1", "v1.1"],
    "tooltip.panel-left": ["结构面板", "Structure panel"],
    "tooltip.panel-right": ["测量面板", "Measurement panel"],
    "panel.elements.more": ["+%d 种元素", "+%d more"],
    "panel.info.no-bonds": ["该结构未生成化学键", "No bonds generated for this structure"],
    "panel.info.truncated": ["结构过大，显示已截断", "Structure truncated for performance"],
    "dialog.search.placeholder": ["搜索", "Search"],
    "ui.open": ["打开", "Open"],
    "ui.library": ["晶体库", "Library"],
    "ui.examples": ["示例", "Examples"],
    "ui.save": ["保存", "Save"],
    "ui.share": ["分享", "Share"],
    "ui.export": ["导出", "Export"],
    "ui.export.title": ["保存 / 导出", "Save / export"],
    "ui.export.cif": ["保存为 CIF 文件", "Save as CIF"],
    "ui.export.xyz": ["保存为 XYZ 文件", "Save as XYZ"],
    "ui.export.png": ["保存视图截图 (PNG)", "Save viewport image (PNG)"],
    "ui.share.title": ["分享结构", "Share structure"],
    "ui.share.cif": ["分享 CIF 文件…", "Share CIF…"],
    "ui.share.xyz": ["分享 XYZ 文件…", "Share XYZ…"],
    "ui.share.png": ["分享视图截图…", "Share viewport image…"],
    "ui.copy.summary": ["复制结构摘要", "Copy structure summary"],
    "ui.more": ["更多", "More"],
    "ui.menu": ["菜单", "Menu"],
    "ui.display": ["显示", "Display"],
    "ui.panels": ["面板", "Panels"],
    "ui.close": ["关闭", "Close"],
    "ui.back": ["返回", "Back"],
    "ui.confirm": ["确定", "Confirm"],
    "ui.error": ["错误", "Error"],
    "ui.notice": ["提示", "Notice"],
    "ui.warning": ["警告", "Warning"],
    "ui.required": ["必填", "Required"],
    "ui.clear.selection": ["清除选择", "Clear selection"],
    "ui.add.atom": ["添加原子", "Add atom"],
    "ui.delete.confirm.title": ["删除原子", "Delete atom"],
    "ui.delete.confirm": ["确定删除这个原子吗？", "Delete this atom?"],
    "ui.delete.tab.confirm": ["关闭标签页", "Close tab"],
    "ui.delete.tab.message": ["该结构有未保存的修改，关闭后将丢失这些修改。是否继续？", "This structure has unsaved changes that will be lost. Continue?"],
    "ui.modified": ["有未保存修改", "Unsaved changes"],
    "ui.demo.note": ["演示模型 · 解析/渲染核心尚未就绪", "Demo model · core modules not ready"],
    "ui.demo.badge": ["演示", "DEMO"],
    "ui.core.missing": ["核心模块尚未就绪", "Core module not available"],
    "ui.structure.info": ["结构信息", "Structure info"],
    "ui.cell.atoms": ["晶胞原子", "Cell atoms"],
    "ui.note": ["备注", "Note"],
    "ui.tab.close": ["关闭标签页", "Close tab"],
    "ui.style": ["样式", "Style"],
    "ui.loading": ["正在启动…", "Starting…"],
    "ui.share.failed": ["分享失败", "Share failed"],
    "ui.export.failed": ["导出失败", "Export failed"],
    "ui.unsupported": ["不支持的文件格式", "Unsupported file format"],
    "ui.tap.close": ["点击关闭", "Tap to dismiss"],
    "ui.about.stack": ["共享 Web 核心（经典 JS + WebGL2）+ Java WebView 外壳", "Shared web core (classic JS + WebGL2) inside a Java WebView shell"],
    "ui.about.license": ["MIT 许可 · 完全离线 · 免安装预览可用", "MIT licensed · fully offline · install-free preview available"],
    "ui.about.engine": ["渲染器", "Renderer"],
    "ui.help.touch.title": ["触屏手势", "Touch gestures"],
    "ui.help.touch.orbit": ["单指拖动", "One-finger drag"],
    "ui.help.touch.pinch": ["双指捏合", "Pinch"],
    "ui.help.touch.pan": ["双指拖动", "Two-finger drag"],
    "ui.help.touch.tap": ["单击原子", "Tap atom"],
    "ui.help.touch.long": ["长按", "Long press"],
    "ui.help.touch.double": ["双击视口", "Double tap"],
    "ui.help.touch.hint": ["单指拖动旋转 · 双指缩放 · 双指拖动平移", "One finger drags to rotate · pinch to zoom · two fingers drag to pan"],
    "ui.fmt.angle.unit": ["°", "°"],
    "ui.style.ball-stick": ["球棍", "Ball & stick"],
    "ui.style.space-fill": ["填充", "Space fill"],
    "ui.style.polyhedral": ["多面体", "Polyhedra"],
    "ui.measure.exit.hint": ["按返回键退出测量", "Press back to leave measuring"],
  };

  var language = 'zh';
  var listeners = [];
  var warned = {};
  var missing = {};

  function normalizeLang(value) {
    var s = String(value == null ? '' : value).toLowerCase();
    if (s.indexOf('en') === 0) return 'en';
    return 'zh';
  }

  function loadStoredLanguage() {
    try {
      if (root.localStorage) {
        var saved = root.localStorage.getItem(STORAGE_KEY);
        if (saved) return normalizeLang(saved);
      }
    } catch (e) { /* storage unavailable: keep default */ }
    return 'zh';
  }

  function formatMessage(str, args) {
    if (!args || !args.length) return str;
    var i = 0;
    return String(str).replace(/%(?:\.([0-9]+))?([sdf])/g, function (match, prec, kind) {
      var value = args[i++];
      if (value === undefined || value === null) return match;
      if (kind === 'f') return Number(value).toFixed(prec ? parseInt(prec, 10) : 0);
      if (kind === 'd') return String(Math.round(Number(value)));
      return String(value);
    });
  }

  function t(key) {
    var entry = MESSAGES[key];
    if (!entry) {
      if (!warned[key]) {
        warned[key] = 1;
        missing[key] = 1;
        if (root.console && root.console.warn) root.console.warn('[CL.i18n] missing key: ' + key);
      }
      return key;
    }
    var str = entry[language === 'en' ? 1 : 0];
    if (str === '' || str == null) str = entry[0] || key;
    if (arguments.length > 1) {
      str = formatMessage(str, Array.prototype.slice.call(arguments, 1));
    }
    return str;
  }

  function translateElement(el) {
    var key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
    key = el.getAttribute('data-i18n-html');
    if (key) el.innerHTML = t(key);
    key = el.getAttribute('data-i18n-title');
    if (key) el.title = t(key);
    key = el.getAttribute('data-i18n-aria-label');
    if (key) el.setAttribute('aria-label', t(key));
    key = el.getAttribute('data-i18n-placeholder');
    if (key) el.setAttribute('placeholder', t(key));
    key = el.getAttribute('data-i18n-value');
    if (key) el.setAttribute('value', t(key));
  }

  function apply(rootEl) {
    var scope = rootEl || (root.document && root.document);
    if (!scope || !scope.querySelectorAll) return;
    var nodes = scope.querySelectorAll('[data-i18n],[data-i18n-html],[data-i18n-title],[data-i18n-aria-label],[data-i18n-placeholder],[data-i18n-value]');
    for (var i = 0; i < nodes.length; i++) translateElement(nodes[i]);
  }

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](language); } catch (e) {
        if (root.console && root.console.error) root.console.error('[CL.i18n] onChange handler failed', e);
      }
    }
  }

  function setLanguage(next, options) {
    var opts = options || {};
    var lang = normalizeLang(next);
    var changed = lang !== language;
    language = lang;
    try {
      if (opts.persist !== false && root.localStorage) root.localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) { /* ignore quota / privacy mode */ }
    try {
      if (root.document && root.document.documentElement) {
        root.document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
        root.document.documentElement.setAttribute('data-lang', lang);
      }
    } catch (e2) { /* ignore */ }
    if (changed || opts.force) {
      apply(root.document);
      notify();
    }
    return lang;
  }

  function onChange(cb) {
    if (typeof cb !== 'function') return function () {};
    listeners.push(cb);
    return function () {
      var i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function toggleLanguage() {
    return setLanguage(language === 'zh' ? 'en' : 'zh');
  }

  function keys() { return Object.keys(MESSAGES); }
  function has(key) { return Object.prototype.hasOwnProperty.call(MESSAGES, key); }
  function missingKeys() { return Object.keys(missing); }

  language = loadStoredLanguage();

  CL.i18n = {
    t: t,
    setLanguage: setLanguage,
    toggleLanguage: toggleLanguage,
    onChange: onChange,
    apply: apply,
    keys: keys,
    has: has,
    missingKeys: missingKeys,
    normalizeLang: normalizeLang,
    storageKey: STORAGE_KEY,
    get language() { return language; },
    get count() { return Object.keys(MESSAGES).length; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
