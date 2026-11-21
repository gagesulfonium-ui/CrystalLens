# CrystalLens 帮助 / 关于窗口 — 完整内容(中 / 英)

- 来源:`../src/ui/Popups.cpp` `HelpWindow::Paint()`,文案取自 `Localization.h`(键名见 [i18n.json](i18n.json))。
- 「帮助」菜单的 **快捷键与操作**(F1)与 **关于 CrystalLens** 打开的是**同一个窗口**;窗口内标题始终用 App 名,不使用 `dialog.about.title`(该键在 v1.1 未被渲染)。
- 措辞逐字保留(含全角标点、`·`、`   ` 多空格);实现时不得改写。

---

## 1. 窗口与版式规格

| 项 | 值 |
|---|---|
| 尺寸 | 760 × 600 dp(超出工作区时整体按比例缩小,居中于主窗) |
| 圆角 / 遮罩 | 圆角 15dp;弹出时禁用主窗(模态式) |
| 背景 | 垂直渐变 `#0E131C → #090D14`,描边 `#303C52`;左上径向光晕 `#407AFF @8%`(460×430 @-120,-150),右下光晕 `#1E5E5F @5.5%`(380×380 @W-330,H-330) |
| 内边距 | 32dp |
| 关闭方式 | 右上 `×`(44×44 热区,符号 20×20、色 `#ACB8CA`、悬停底 `#1F2939`)、`Esc`、`F1`、系统关闭 |
| 两栏 | 左栏 x=32、宽 288;右栏 x=350、宽 `W-350-32` |
| 底栏 | 分隔线在 `H-48`;页脚文字在 `H-40` |

版式顺序(自上而下):

```
[logo 46×46]  CrystalLens(21 Bold)            …………………………………………  [×]
              版本 1.1   ·   原生 C++ / OpenGL 3.3(9.5)
──────────────────────────────── 分隔线 y=92 ────────────────────────────────
左栏:                                              右栏:
  晶体结构，清晰可见(12, Teal)                       快捷键(12 Bold)
  描述段落(10.5, 换行)                               ───────── 分隔线 y=136 ─────────
  ✓ 特性 1                                           [Ctrl+O]      打开文件
  ✓ 特性 2                                           [Ctrl+R]      重新载入
  ✓ 特性 3                                           [Ctrl+S]      保存结构
  ✓ 特性 4                                           [Ctrl+Shift+S] 保存截图
                                                     [Ctrl+Z]      撤销 / 重做
                                                     [Ctrl+E]      编辑晶胞 / 原子
                                                     [F]           适应窗口
                                                     [Home]        重置视图
                                                     [D]           距离测量
                                                     [A]           角度测量
                                                     [Esc]         取消 / 退出测量
                                                     [LMB]         旋转
                                                     [Wheel]       缩放
                                                     [MMB/RMB]     平移
──────────────────────────── 分隔线 y=H-48 ────────────────────────────────
© 2026 CrystalLens Project · 供科研与教学使用                          构建于 Nov 21 2026
```

细节:
- 标题行:logo 46×46 @(32,28);App 名 21 Bold `#EEF3FA` @(90,30);版本行 9.5 `#808FA7` @(90,58)。
- tagline:12dp,Teal `#53D3AF` @(32,108)。
- 描述段落:10.5dp `#929FB4`,起始 y=140,宽 288,可换行(不省略)。
- 特性行:从 y=254 起,行距 27;每行左侧 16×16 圆底 `#1B2B3E` + 10×10 Teal 勾;文案 9.8 `#BCC7D8`(x+26)。
- 快捷键表:表头 12 Bold `#EAF0F9` @y=108;分隔线 y=136 `#263142`;每行高 26,首行 y=146;键帽 chip 最小宽 68、高 21、圆角 `h*0.35`、底 `#171F2C`、描边 `#2B3649`、键名 8.8 等宽 `#9CB4DA`;描述 10 `#B5C1D2`,x = 右栏 x + 132。
- 页脚:左 `© 2026 CrystalLens Project · 供科研与教学使用` 9dp `#677489`;右 `构建于 <编译日期>` 9dp `#525E71`(`__DATE__`,如 `Nov 21 2026`)。

---

## 2. 中文版全文

### 头部
- **CrystalLens**
- 版本 1.1   ·   原生 C++ / OpenGL 3.3

### 左栏
**晶体结构，清晰可见**

> 面向真实 CIF 数据的晶体结构查看与编辑工具。完整边界晶格、平滑 3D 球棍、元素图例与晶胞叠加框，打开、观察、测量和编辑结构。

✓ CIF / VESTA / XYZ 解析与对称展开
✓ 可调超胞、边界原子与专业晶胞显示
✓ 晶胞与原子编辑、撤销/重做、CIF/XYZ 导出
✓ 键长键角测量、高 DPI 与中英双语

### 右栏 — 快捷键

| 键 | 说明 |
|---|---|
| Ctrl+O | 打开文件 |
| Ctrl+R | 重新载入 |
| Ctrl+S | 保存结构 |
| Ctrl+Shift+S | 保存截图 |
| Ctrl+Z | 撤销 / 重做 |
| Ctrl+E | 编辑晶胞 / 原子 |
| F | 适应窗口 |
| Home | 重置视图 |
| D | 距离测量 |
| A | 角度测量 |
| Esc | 取消 / 退出测量 |
| LMB | 旋转 |
| Wheel | 缩放 |
| MMB/RMB | 平移 |

### 页脚
- © 2026 CrystalLens Project · 供科研与教学使用
- 构建于 `<编译日期>`

---

## 3. English version

### Header
- **CrystalLens**
- Version 1.1   ·   Native C++ / OpenGL 3.3

### Left column
**Crystallography, beautifully rendered**

> Crystal-structure viewing and editing built for real CIF data, with full boundary lattices, smooth 3D ball-and-stick, an element legend and a cell overlay.

✓ CIF / VESTA / XYZ parsing with symmetry expansion
✓ Adjustable supercells, boundary atoms and professional cell views
✓ Cell and atom editing, undo/redo, CIF/XYZ export
✓ Geometry measurement, high DPI and Chinese/English

### Right column — Shortcuts

| Key | Description |
|---|---|
| Ctrl+O | Open file |
| Ctrl+R | Reload |
| Ctrl+S | Save structure |
| Ctrl+Shift+S | Screenshot |
| Ctrl+Z | Undo / redo |
| Ctrl+E | Edit cell / atom |
| F | Fit to window |
| Home | Reset view |
| D | Distance |
| A | Angle |
| Esc | Cancel / exit measuring |
| LMB | Orbit |
| Wheel | Zoom |
| MMB/RMB | Pan |

### Footer
- © 2026 CrystalLens Project · for research and teaching
- Built `<build date>`

---

## 4. 文案键对照(便于实现时直接取用)

| 位置 | 键 | 中文 | English |
|---|---|---|---|
| App 名 | `app.title` | CrystalLens | CrystalLens |
| 版本行 | `dialog.about.version` | 版本 %s   ·   原生 C++ / OpenGL 3.3 | Version %s   ·   Native C++ / OpenGL 3.3 |
| Tagline | `app.tagline` | 晶体结构，清晰可见 | Crystallography, beautifully rendered |
| 描述 | `dialog.about.description` | 面向真实 CIF 数据的晶体结构查看与编辑工具。完整边界晶格、平滑 3D 球棍、元素图例与晶胞叠加框，打开、观察、测量和编辑结构。 | Crystal-structure viewing and editing built for real CIF data, with full boundary lattices, smooth 3D ball-and-stick, an element legend and a cell overlay. |
| 特性 1 | `dialog.about.feature1` | CIF / VESTA / XYZ 解析与对称展开 | CIF / VESTA / XYZ parsing with symmetry expansion |
| 特性 2 | `dialog.about.feature2` | 可调超胞、边界原子与专业晶胞显示 | Adjustable supercells, boundary atoms and professional cell views |
| 特性 3 | `dialog.about.feature3` | 晶胞与原子编辑、撤销/重做、CIF/XYZ 导出 | Cell and atom editing, undo/redo, CIF/XYZ export |
| 特性 4 | `dialog.about.feature4` | 键长键角测量、高 DPI 与中英双语 | Geometry measurement, high DPI and Chinese/English |
| 右栏标题 | `dialog.about.shortcuts` | 快捷键 | Shortcuts |
| footer 左 | `dialog.about.footnote` | © 2026 CrystalLens Project · 供科研与教学使用 | © 2026 CrystalLens Project · for research and teaching |
| footer 右 | `dialog.about.build` | 构建于 %s | Built %s |

快捷键行(按显示顺序,左侧为**原样键名**,不可本地化):

| 键名(原样) | 文案键 | 中文 | English |
|---|---|---|---|
| Ctrl+O | `help.shortcut.open` | 打开文件 | Open file |
| Ctrl+R | `help.shortcut.reload` | 重新载入 | Reload |
| Ctrl+S | `help.shortcut.save` | 保存结构 | Save structure |
| Ctrl+Shift+S | `help.shortcut.screenshot` | 保存截图 | Screenshot |
| Ctrl+Z | `help.shortcut.undo` | 撤销 / 重做 | Undo / redo |
| Ctrl+E | `help.shortcut.edit` | 编辑晶胞 / 原子 | Edit cell / atom |
| F | `help.shortcut.fit` | 适应窗口 | Fit to window |
| Home | `help.shortcut.reset` | 重置视图 | Reset view |
| D | `help.shortcut.distance` | 距离测量 | Distance |
| A | `help.shortcut.angle` | 角度测量 | Angle |
| Esc | `help.shortcut.cancel` | 取消 / 退出测量 | Cancel / exit measuring |
| LMB | `help.shortcut.orbit` | 旋转 | Orbit |
| Wheel | `help.shortcut.zoom` | 缩放 | Zoom |
| MMB/RMB | `help.shortcut.pan` | 平移 | Pan |

> 注:`help.shortcut.panels`(显示 / 隐藏侧栏 / Toggle side panels)、`dialog.about.title`(关于 CrystalLens / About CrystalLens)、`dialog.about.close`(关闭 / Close)在 v1.1 中已定义但**未在帮助窗口渲染**;安卓端若要增加"侧栏开关"行或独立标题,可直接使用。

---

## 5. 安卓端帮助页建议

- 单列滚动:头部(logo+App 名+版本)→ tagline → 描述 → 特性 4 条 → 「快捷键」列表(键帽 + 说明,可分组:文件/编辑/视图/测量/鼠标手势)→ 脚注与构建日期。
- 移动端手势说明需新增键(桌面版无):建议 `help.shortcut.touch`「单指旋转 · 双指缩放 · 双指拖动平移 / One finger to rotate · pinch to zoom · two-finger drag to pan」;原 `LMB/Wheel/MMB/RMB` 行可隐藏或替换为该行。
- 构建日期:`dialog.about.build` 在桌面取自编译宏 `__DATE__`(如 `Nov 21 2026`);安卓端建议在构建注入 `2026-11-21` 或保持同格式。
