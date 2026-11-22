#pragma once

#include <string>

namespace cl {

enum class Language { Chinese = 0, English = 1 };

#define CL_STRING_LIST(X)                                                                              \
    X(AppName, L"CrystalLens", L"CrystalLens")                                                        \
    X(AppTagline, L"晶体结构，清晰可见", L"Crystallography, beautifully rendered")                      \
    X(Ready, L"就绪", L"Ready")                                                                       \
    X(Unknown, L"未知", L"Unknown")                                                                   \
    X(None, L"—", L"—")                                                                               \
    X(FileMenu, L"文件", L"File")                                                                     \
    X(EditMenu, L"编辑", L"Edit")                                                                     \
    X(ViewMenu, L"视图", L"View")                                                                     \
    X(MeasureMenu, L"测量", L"Measure")                                                               \
    X(HelpMenu, L"帮助", L"Help")                                                                     \
    X(Library, L"经典晶体库", L"Crystal library") \
    X(LibraryHint, L"双击打开一个晶体，或按住 Ctrl / Shift 多选，在独立窗口中打开。", L"Double-click a crystal, or use Ctrl / Shift to open several in separate windows.") \
    X(NoCoordinationHull, L"无三维配位 · 球棍", L"No 3D shell · ball and stick") \
    X(LibraryMineral, L"晶体名称", L"Crystal") \
    X(LibraryFormula, L"化学式", L"Formula") \
    X(LibraryGroup, L"空间群", L"Space group") \
    X(LibraryOpen, L"打开", L"Open") \
    X(LibraryUnavailable, L"无法打开晶体库。请检查程序旁的 library 文件夹是否完整。", L"Cannot open the crystal library. Check the library folder beside the executable.") \
    X(OpenFile, L"打开结构文件…", L"Open structure…")                                                 \
    X(ReloadFile, L"重新载入", L"Reload")                                                             \
    X(SaveScreenshot, L"保存视图截图", L"Save viewport image")                                        \
    X(ExitApp, L"退出", L"Exit")                                                                      \
    X(CopySummary, L"复制结构摘要", L"Copy structure summary")                                        \
    X(ClearMeasurements, L"清除全部测量", L"Clear all measurements")                                  \
    X(SaveStructure, L"保存结构…", L"Save structure…")                                                \
    X(Undo, L"撤销", L"Undo")                                                                         \
    X(Redo, L"重做", L"Redo")                                                                         \
    X(EditCell, L"编辑晶胞…", L"Edit unit cell…")                                                     \
    X(AddAtom, L"添加原子…", L"Add atom…")                                                            \
    X(EditAtom, L"编辑选中原子…", L"Edit selected atom…")                                             \
    X(DeleteAtom, L"删除选中原子", L"Delete selected atom")                                           \
    X(DialogOK, L"确定", L"OK")                                                                       \
    X(DialogCancel, L"取消", L"Cancel")                                                               \
    X(DialogInvalidNumber, L"请输入有效数字", L"Enter valid numbers")                                 \
    X(EditCellTitle, L"编辑晶胞参数", L"Edit unit-cell parameters")                                   \
    X(EditCellSubtitle, L"应用后将重新展开对称原子并重建化学键。",                                    \
      L"Applying the change re-expands symmetry copies and rebuilds bonds.")                          \
    X(CellInvalid, L"晶胞参数无效，请检查长度和角度", L"Invalid cell parameters; check lengths and angles") \
    X(AddAtomTitle, L"添加原子", L"Add atom")                                                         \
    X(EditAtomTitle, L"编辑原子", L"Edit atom")                                                       \
    X(AtomSubtitleFrac, L"输入元素、标签、占位率与分数坐标；新原子会按对称操作展开。",                \
      L"Enter element, label, occupancy and fractional coordinates; symmetry copies are generated.") \
    X(AtomSubtitleCart, L"输入元素、标签、占位率与笛卡尔坐标（Å）。",                                 \
      L"Enter element, label, occupancy and Cartesian coordinates (Å).")                             \
    X(EditAtomSubtitleFrac, L"修改不对称单元中该位点的元素、标签、占位率与分数坐标。",                \
      L"Edit the asymmetric-unit site: element, label, occupancy and fractional coordinates.")      \
    X(EditAtomSubtitleCart, L"修改该原子的元素、标签、占位率与笛卡尔坐标（Å）。",                      \
      L"Edit this atom's element, label, occupancy and Cartesian coordinates (Å).")                 \
    X(EditSymmetryNote, L"该原子由对称操作生成；修改会同时作用于全部等价原子。",                       \
      L"This atom is symmetry-generated; editing affects all equivalent copies.")                    \
    X(InvalidElement, L"未知元素，请输入元素符号或原子序数", L"Unknown element; enter a symbol or atomic number") \
    X(InvalidOccupancy, L"占位率必须在 0 与 1 之间（不含 0）", L"Occupancy must be in (0, 1]")          \
    X(SelectAtomFirst, L"请先在三维视图中选择一个原子", L"Select an atom in the viewport first")       \
    X(NoCellForEdit, L"当前结构没有晶胞参数，无法编辑晶胞", L"This structure has no unit cell to edit") \
    X(NoCellForCif, L"CIF 导出需要晶胞参数；请改用 XYZ 格式", L"CIF export requires a unit cell; choose XYZ instead") \
    X(SaveStructureTitle, L"保存结构", L"Save structure")                                             \
    X(SaveStructureSaved, L"结构已保存", L"Structure saved")                                          \
    X(SaveStructureSavedFmt, L"已保存到 %s", L"Saved to %s")                                          \
    X(SaveStructureFailed, L"保存结构失败", L"Could not save the structure")                          \
    X(StructureUpdated, L"结构已更新", L"Structure updated")                                          \
    X(Undone, L"已撤销", L"Undone")                                                                   \
    X(Redone, L"已重做", L"Redone")                                                                   \
    X(AtomDeleted, L"已删除原子", L"Atom deleted")                                                     \
    X(StatusEdited, L"已修改  ·  Ctrl+S 保存结构", L"Modified  ·  Ctrl+S to save")                    \
    X(UnsavedTitle, L"未保存的修改", L"Unsaved changes")                                               \
    X(UnsavedMessage, L"当前结构有未保存的修改。继续将丢失这些修改，是否继续？",                       \
      L"The structure has unsaved changes. Continue and discard them?")                              \
    X(EditAtomButton, L"编辑原子", L"Edit atom")                                                      \
    X(DeleteAtomButton, L"删除", L"Delete")                                                           \
    X(EditCellButton, L"编辑", L"Edit")                                                               \
    X(TipSaveStructure, L"保存结构   Ctrl+S", L"Save structure   Ctrl+S")                             \
    X(TipEditCell, L"编辑晶胞参数   Ctrl+E", L"Edit unit-cell parameters   Ctrl+E")                   \
    X(TipAddAtom, L"添加原子   Ctrl+Shift+A", L"Add atom   Ctrl+Shift+A")                             \
    X(TipEditAtom, L"编辑选中原子   F2", L"Edit selected atom   F2")                                  \
    X(TipDeleteAtom, L"删除选中原子   Delete", L"Delete selected atom   Delete")                      \
    X(TipUndo, L"撤销   Ctrl+Z", L"Undo   Ctrl+Z")                                                    \
    X(TipRedo, L"重做   Ctrl+Y", L"Redo   Ctrl+Y")                                                    \
    X(ShortcutSave, L"保存结构", L"Save structure")                                                   \
    X(ShortcutUndo, L"撤销 / 重做", L"Undo / redo")                                                   \
    X(ShortcutEdit, L"编辑晶胞 / 原子", L"Edit cell / atom")                                          \
    X(HintElementInput, L"符号 / Z", L"Symbol / Z")                                                   \
    X(HintOptional, L"可选", L"Optional")                                                             \
    X(HintFractional, L"分数", L"Fractional")                                                         \
    X(ResetView, L"重置视图", L"Reset view")                                                          \
    X(FitView, L"适应窗口", L"Fit to window")                                                        \
    X(ProjectionPerspective, L"透视投影", L"Perspective projection")                                  \
    X(ProjectionOrthographic, L"正交投影", L"Orthographic projection")                                \
    X(ToggleCell, L"显示晶胞边框", L"Show unit-cell frame")                                           \
    X(ToggleBonds, L"显示化学键", L"Show bonds")                                                      \
    X(ToggleLabels, L"显示原子标签", L"Show atom labels")                                             \
    X(ToggleAxes, L"显示坐标轴", L"Show axes")                                                        \
    X(ToggleLeftPanel, L"显示结构面板", L"Show structure panel")                                      \
    X(ToggleRightPanel, L"显示测量面板", L"Show measurement panel")                                   \
    X(BallAndStick, L"球棍模型", L"Ball & stick")                                                     \
    X(SpaceFill, L"空间填充", L"Space filling")                                                    \
    X(StylePolyhedral, L"多面体", L"Polyhedral")                                                       \
    X(LanguageChinese, L"中文", L"Chinese")                                                           \
    X(LanguageEnglish, L"English", L"English")                                                        \
    X(MeasureDistance, L"距离测量", L"Distance")                                                      \
    X(MeasureAngle, L"角度测量", L"Angle")                                                            \
    X(CancelMeasurement, L"退出测量模式", L"Exit measuring mode")                                     \
    X(AboutApp, L"关于 CrystalLens", L"About CrystalLens")                                            \
    X(KeyboardShortcuts, L"快捷键与操作", L"Shortcuts & controls")                                    \
    X(OpenDialogTitle, L"打开晶体结构文件", L"Open a crystal structure")                              \
    X(AllSupportedFiles, L"所有支持的结构文件", L"All supported structures")                          \
    X(FileFilterCif, L"CIF 晶体文件 (*.cif;*.mcif)", L"CIF crystals (*.cif;*.mcif)")                 \
    X(FileFilterVesta, L"VESTA 文件 (*.vesta)", L"VESTA files (*.vesta)")                             \
    X(FileFilterXyz, L"XYZ 分子文件 (*.xyz)", L"XYZ molecules (*.xyz)")                               \
    X(StructureSection, L"晶体结构", L"STRUCTURE")                                                    \
    X(CellParameters, L"晶胞参数", L"UNIT CELL")                                                      \
    X(DisplaySection, L"显示", L"DISPLAY")                                                            \
    X(AppearanceSection, L"外观", L"APPEARANCE")                                                      \
    X(SelectionSection, L"选择", L"SELECTION")                                                        \
    X(MeasurementsSection, L"测量", L"MEASUREMENTS")                                                  \
    X(SupercellLimited, L"超胞过大，显示单胞", L"Supercell limit: showing one cell") \
    X(BoundaryLimited, L"边界副本已截断", L"Boundary images truncated") \
    X(AtomsCount, L"原子", L"Atoms")                                                                  \
    X(BondsCount, L"化学键", L"Bonds")                                                                \
    X(SpaceGroup, L"空间群", L"Space group")                                                          \
    X(Formula, L"化学式", L"Formula")                                                                 \
    X(CellContents, L"晶胞内容", L"Cell contents")                                                    \
    X(Source, L"来源", L"Source")                                                                     \
    X(SymmetryOps, L"对称操作", L"Symmetry ops")                                                      \
    X(AsymAtoms, L"不对称单元", L"Asymmetric unit")                                                   \
    X(Volume, L"体积", L"Volume")                                                                     \
    X(FormatLabel, L"格式", L"Format")                                                                \
    X(BlockLabel, L"数据块", L"Data block")                                                           \
    X(NoStructureHint, L"打开文件后在此查看结构信息", L"Open a structure to inspect it here")         \
    X(DisplayCell, L"晶胞边框", L"Cell frame")                                                   \
    X(DisplayBonds, L"化学键", L"Bonds")                                                              \
    X(DisplayLabels, L"原子标签", L"Atom labels")                                                     \
    X(DisplayAxes, L"坐标轴", L"Axes")                                                                \
    X(DisplayImages, L"边界原子", L"Boundary")                                                       \
    X(SupercellMenu, L"超胞…", L"Supercell…")                                                        \
    X(SupercellTitle, L"超胞设置", L"Supercell")                                                     \
    X(SupercellSubtitle, L"沿 a、b、c 方向重复晶胞的次数（1–16）", L"Repeat the unit cell along a, b, c (1–16)") \
    X(SupercellAxisA, L"a 方向", L"a repeats")                                                       \
    X(SupercellAxisB, L"b 方向", L"b repeats")                                                       \
    X(SupercellAxisC, L"c 方向", L"c repeats")                                                       \
    X(SupercellLink, L"超胞", L"Supercell")                                                          \
    X(AppearanceMenu, L"外观设置…", L"Appearance…")                                                  \
    X(AppearanceButton, L"设置", L"Settings")                                                        \
    X(AppearanceTitle, L"外观设置", L"Appearance")                                                   \
    X(AppearanceSubtitle, L"设置晶胞边框、背景与配位多面体", L"Cell frame, background and coordination polyhedra") \
    X(CellColorLabel, L"晶胞边框颜色", L"Cell frame colour")                                         \
    X(PolyTransparency, L"多面体面透明度", L"Face transparency") \
    X(PolyEdgeColor, L"多面体描边", L"Polyhedron outline") \
    X(PolyEdgeWidth, L"多面体描边宽度（0 关闭）", L"Outline width (0 = off)") \
    X(SupercellBudget, L"请减小倍率，超胞内部最多 65,536 个位点、300,000 条周期键。", L"Reduce repeats to fit 65,536 sites and 300,000 periodic bonds.") \
    X(CellWidthLabel, L"边框粗细", L"Frame width")                                                   \
    X(BackgroundColorLabel, L"背景颜色", L"Background colour")                                       \
    X(AppearanceBrightness, L"明度", L"Brightness")                                                  \
    X(AppearanceReset, L"恢复默认", L"Reset defaults")                                               \
    X(AppearanceLiveHint, L"拖动色轮或滑杆时，视口会实时预览", L"Drag the wheel or sliders for a live preview") \
    X(AppearanceColorInvalid, L"颜色格式应为 #RRGGBB", L"Colour must be #RRGGBB")                    \
    X(AppearanceWidthInvalid, L"边框粗细应在 0.5–4 之间", L"Frame width must be between 0.5 and 4")   \
    X(SupercellInvalid, L"超胞倍率必须是 1–16 的整数", L"Supercell repeats must be integers from 1 to 16") \
    X(TipImages, L"显示晶胞外的相邻原子和完整配位", L"Show neighbouring boundary atoms and full coordination") \
    X(AtomSize, L"原子尺寸", L"Atom size")                                                            \
    X(StyleLabel, L"渲染样式", L"Style")                                                              \
    X(ElementLegend, L"元素", L"Elements")                                                            \
    X(PeriodicChip, L"周期性晶体", L"Periodic crystal")                                               \
    X(MoleculeChip, L"分子结构", L"Molecule")                                                         \
    X(NoAtomSelected, L"未选择原子", L"No atom selected")                                             \
    X(SelectHint, L"在三维视图中点击原子以查看信息", L"Click an atom in the viewport to inspect it")  \
    X(AtomLabelField, L"标签", L"Label")                                                              \
    X(ElementField, L"元素", L"Element")                                                              \
    X(FractionalCoords, L"分数坐标", L"Fractional")                                                   \
    X(CartesianCoords, L"笛卡尔坐标", L"Cartesian")                                                   \
    X(OccupancyField, L"占位率", L"Occupancy")                                                        \
    X(UisoField, L"Uiso", L"Uiso")                                                                    \
    X(SiteField, L"位点", L"Site")                                                                    \
    X(SymmetryCopyField, L"对称等价位置", L"Symmetry image")                                          \
    X(MeasureEmpty, L"还没有测量结果", L"No measurements yet")                                        \
    X(MeasureEmptyHint, L"选择距离或角度，再点击原子", L"Pick a mode, then click atoms")               \
    X(MeasurementDistance, L"键长", L"Distance")                                                      \
    X(MeasurementAngle, L"键角", L"Angle")                                                            \
    X(MeasurementClearAll, L"清除全部", L"Clear all")                                                 \
    X(MeasurementPickDistance, L"点击两个原子测量距离", L"Click two atoms to measure distance")        \
    X(MeasurementPickAngle, L"依次点击三个原子测量键角", L"Click three atoms to measure the angle")    \
    X(SelectedCountFmt, L"已选 %d / %d", L"Selected %d / %d")                                         \
    X(RemoveMeasurement, L"删除此测量", L"Remove this measurement")                                   \
    X(ViewHint, L"左键拖动旋转   ·   滚轮缩放   ·   中键 / 右键平移",                                \
      L"Drag to rotate   ·   Scroll to zoom   ·   Middle/right-drag to pan")                          \
    X(ImageLegendOn, L"边界原子 = 相邻晶胞中的原子", L"Boundary atoms come from neighbouring cells")    \
    X(ImageLegendOff, L"仅显示晶胞内原子与键", L"Only unit-cell atoms and bonds are shown")            \
    X(MeasureHintDistance, L"距离测量：点击两个原子   ·   Esc 退出",                                  \
      L"Distance: click two atoms   ·   Esc to exit")                                                \
    X(MeasureHintAngle, L"角度测量：依次点击三个原子   ·   Esc 退出",                                 \
      L"Angle: click three atoms   ·   Esc to exit")                                                 \
    X(EmptyTitle, L"打开结构文件，开始探索晶体世界", L"Open a structure and explore its crystal world") \
    X(EmptySubtitle, L"将 CIF、VESTA 或 XYZ 文件拖放到窗口", L"Drop a CIF, VESTA or XYZ file here")   \
    X(OpenButton, L"打开结构文件", L"Open structure")                                                 \
    X(SupportedFormats, L"CIF   ·   VESTA   ·   XYZ", L"CIF   ·   VESTA   ·   XYZ")                   \
    X(EmptyFootnote, L"本地解析 · 硬件加速渲染 · 无需联网", L"Local parsing · GPU accelerated · offline") \
    X(AtomsBondsHud, L"%d 原子   %d 键", L"%d atoms   %d bonds")                                      \
    X(NoStructureToast, L"请先打开一个结构文件", L"Open a structure first")                            \
    X(OpenFailedTitle, L"无法打开文件", L"Could not open file")                                       \
    X(LoadedToastFmt, L"已载入 %s", L"Loaded %s")                                                     \
    X(ScreenshotSaved, L"截图已保存", L"Screenshot saved")                                            \
    X(ScreenshotSavedFmt, L"截图已保存到 %s", L"Screenshot saved to %s")                              \
    X(ScreenshotFailed, L"截图保存失败", L"Could not save the screenshot")                            \
    X(CopiedSummary, L"结构摘要已复制到剪贴板", L"Structure summary copied to clipboard")              \
    X(RendererError, L"无法初始化 OpenGL 3.3 渲染器", L"Could not initialize the OpenGL 3.3 renderer") \
    X(RendererErrorHint, L"请更新显卡驱动后重新启动 CrystalLens",                                     \
      L"Update your graphics driver and restart CrystalLens")                                         \
    X(RendererInfoFmt, L"OpenGL %s · %s", L"OpenGL %s · %s")                                         \
    X(AboutTitle, L"关于 CrystalLens", L"About CrystalLens")                                          \
    X(AboutVersionFmt, L"版本 %s   ·   原生 C++ / OpenGL 3.3", L"Version %s   ·   Native C++ / OpenGL 3.3") \
    X(AboutDescription, L"面向真实 CIF 数据的晶体结构查看与编辑工具。完整边界晶格、平滑 3D 球棍、元素图例与晶胞叠加框，打开、观察、测量和编辑结构。", \
      L"Crystal-structure viewing and editing built for real CIF data, with full boundary lattices, smooth 3D ball-and-stick, an element legend and a cell overlay.") \
    X(AboutFeature1, L"CIF / VESTA / XYZ 解析与对称展开", L"CIF / VESTA / XYZ parsing with symmetry expansion") \
    X(AboutFeature2, L"可调超胞、边界原子与专业晶胞显示", L"Adjustable supercells, boundary atoms and professional cell views") \
    X(AboutFeature3, L"晶胞与原子编辑、撤销/重做、CIF/XYZ 导出", L"Cell and atom editing, undo/redo, CIF/XYZ export") \
    X(AboutFeature4, L"键长键角测量、高 DPI 与中英双语", L"Geometry measurement, high DPI and Chinese/English") \
    X(AboutShortcuts, L"快捷键", L"Shortcuts")                                                        \
    X(ShortcutOrbit, L"旋转", L"Orbit")                                                               \
    X(ShortcutZoom, L"缩放", L"Zoom")                                                                 \
    X(ShortcutPan, L"平移", L"Pan")                                                                   \
    X(ShortcutFit, L"适应窗口", L"Fit to window")                                                    \
    X(ShortcutReset, L"重置视图", L"Reset view")                                                      \
    X(ShortcutDistance, L"距离测量", L"Distance")                                                     \
    X(ShortcutAngle, L"角度测量", L"Angle")                                                           \
    X(ShortcutCancel, L"取消 / 退出测量", L"Cancel / exit measuring")                                 \
    X(ShortcutScreenshot, L"保存截图", L"Screenshot")                                                 \
    X(ShortcutPanels, L"显示 / 隐藏侧栏", L"Toggle side panels")                                      \
    X(ShortcutReload, L"重新载入", L"Reload")                                                        \
    X(ShortcutOpen, L"打开文件", L"Open file")                                                        \
    X(AboutClose, L"关闭", L"Close")                                                                  \
    X(AboutFootnote, L"© 2026 CrystalLens Project · 供科研与教学使用",                                \
      L"© 2026 CrystalLens Project · for research and teaching")                                     \
    X(AboutBuildFmt, L"构建于 %s", L"Built %s")                                                       \
    X(TipOpen, L"打开结构文件   Ctrl+O", L"Open structure   Ctrl+O")                                  \
    X(TipReload, L"重新载入   Ctrl+R", L"Reload   Ctrl+R")                                            \
    X(TipScreenshot, L"保存截图到图片文件夹   Ctrl+Shift+S", L"Save image to Pictures   Ctrl+Shift+S") \
    X(TipFit, L"适应窗口   F", L"Fit to window   F")                                                  \
    X(TipReset, L"重置视图   Home", L"Reset view   Home")                                             \
    X(TipProjection, L"切换透视 / 正交投影", L"Toggle perspective / orthographic")                    \
    X(TipCell, L"显示或隐藏晶胞边框   C", L"Show or hide unit-cell frame   C")                        \
    X(TipBonds, L"显示或隐藏化学键   B", L"Show or hide bonds   B")                                  \
    X(TipLabels, L"显示或隐藏原子标签   L", L"Show or hide atom labels   L")                          \
    X(TipDistance, L"距离测量   D", L"Measure distance   D")                                          \
    X(TipAngle, L"角度测量   A", L"Measure angle   A")                                                \
    X(TipClearMeasure, L"清除所有测量结果", L"Clear all measurements")                                \
    X(TipLeftPanel, L"显示或隐藏结构面板", L"Show or hide the structure panel")                       \
    X(TipRightPanel, L"显示或隐藏测量面板", L"Show or hide the measurement panel")                    \
    X(TipLanguage, L"切换中文 / English", L"Switch Chinese / English")                                \
    X(TipAbout, L"关于与快捷键", L"About and shortcuts")                                               \
    X(TipCancelMeasure, L"退出测量模式   Esc", L"Exit measuring mode   Esc")                          \
    X(StatusLoadedFmt, L"已载入  %s", L"Loaded  %s")                                                  \
    X(StatusFileInfoFmt, L"%s  ·  %d 原子  ·  %d 键", L"%s  ·  %d atoms  ·  %d bonds")               \
    X(StatusHoverFmt, L"%s  ·  %s  ·  点击选择", L"%s  ·  %s  ·  click to inspect")                  \
    X(StatusMeasureFmt, L"%s  ·  %s", L"%s  ·  %s")                                                  \
    X(StatusReadyHint, L"打开 CIF / VESTA / XYZ 文件开始", L"Open a CIF / VESTA / XYZ file to begin") \
    X(UnsupportedFormat, L"不支持的文件格式", L"Unsupported file format")                            \
    X(EmptyFileName, L"（未命名）", L"(untitled)")                                                    \
    X(CopyAtomLineFmt, L"%s  %s  frac(%.4f, %.4f, %.4f)", L"%s  %s  frac(%.4f, %.4f, %.4f)")         \
    X(VersionPrefix, L"v1.2.0", L"v1.2.0")                                                               \
    X(TooltipPanelLeft, L"结构面板", L"Structure panel")                                             \
    X(TooltipPanelRight, L"测量面板", L"Measurement panel")                                           \
    X(MoreElementsFmt, L"+%d 种元素", L"+%d more")                                                    \
    X(NoBondsInfo, L"该结构未生成化学键", L"No bonds generated for this structure")                   \
    X(TruncatedNote, L"结构过大，显示已截断", L"Structure truncated for performance")                 \
    X(SearchPlaceholder, L"搜索", L"Search")

enum class Str {
#define CL_ENUM_ENTRY(id, zh, en) id,
    CL_STRING_LIST(CL_ENUM_ENTRY)
#undef CL_ENUM_ENTRY
        Count
};

class I18n {
public:
    static Language GetLanguage();
    static void SetLanguage(Language language);
    static bool IsChinese();
    static const wchar_t* Get(Str id);
    static const wchar_t* Get(Str id, Language language);
};

inline const wchar_t* T(Str id) { return I18n::Get(id); }

} // namespace cl
