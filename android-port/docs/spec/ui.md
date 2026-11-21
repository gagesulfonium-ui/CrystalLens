# CrystalLens 安卓重构 — UI / 交互 / 本地化实现级规格

- **基准**:CrystalLens **v1.1.0**(`../`,C++ Win32 + GDI+ 自绘 + OpenGL 3.3)
- **配套文件**:[i18n.json](i18n.json)(251 条中英文文案)、[ui-tokens.json](ui-tokens.json)(机器可读视觉 token)、[help.md](help.md)(帮助窗口全文)
- **单位**:下文 `dp` = Windows DIP(96dpi 基准逻辑像素)。代码中所有尺寸为 `S(x) = round(x * scale)`(`scale = dpi/96`),字体直接用像素字号。Web 实现可直接把 dp 当 CSS px。
- **重要**:`docs/screenshot-*.png` 为 **v0.7.0** 旧版截图(标题栏显示 `v0.7`,左/右面板内容与 v1.1 有差异),仅作视觉参考;本规格以 v1.1 源码为准。差异见文末 §18.2。
- 用户可见文案一律以 **i18n.json** 为准,本文引用时写成 `键名「中文 / English」`。

---

## 1. 视觉体系(Design Tokens)

完整机读值见 [ui-tokens.json](ui-tokens.json);以下是实现时最重要的部分。

### 1.1 调色板(直接取自 `UiDraw.h` `Theme::` 与各处字面量)

| 语义 | Hex | 用途 |
|---|---|---|
| 窗口背景顶 | `#0C111A` | 主窗背景垂直渐变起点 |
| 窗口背景底 | `#070A10` | 主窗背景垂直渐变终点 |
| 装饰光斑(左上) | `#2E57B0` @ 6.7% | 椭圆径向光晕,640×580 @(-180,-220) |
| 装饰光斑(右下) | `#18553E` @ 3.9% | 椭圆径向光晕,560×470 @(W-380,H-280) |
| Surface | `#121824` | 面板/卡片基础色 |
| SurfaceRaised | `#161D2B` | 抬升层、按钮底 |
| SurfaceHover | `#1D2637` | 悬停底 |
| SurfaceSunken | `#0D121B` | 凹陷底(输入框) |
| 面板渐变顶 | `#131A26` | 左/右面板渐变起点 |
| 面板渐变底 | `#0E131D` | 左/右面板渐变终点 |
| Border | `#263143` | 标准描边 |
| BorderSoft | `#1D2635` | 弱描边 |
| BorderBright | `#374862` | 强描边 |
| 面板描边 | `#253041` | 左/右面板 1dp 描边 |
| 卡片描边 | `#1F2938` | 晶胞参数卡等 |
| 分隔线 | `#202A3A` | 面板内 Divider |
| 文本主 | `#EAF0F8` | 标题、正文 |
| 文本次 | `#9EAABE` | 次级标签、未激活图标 |
| 文本弱 | `#6C798F` | 字段名、说明 |
| 文本极弱 | `#4C596E` | 禁用、脚注 |
| 强调 | `#6392FF` | 主按钮/开关/滑块/焦点/勾选 |
| 强调亮 | `#85ABFF` | 悬停强调、格式徽章文字 |
| 强调暗 | `#2C4678` | 强调底色 |
| Teal | `#35D3AF` | 状态点(渲染正常)、周期性徽章 |
| Gold | `#FFC95B` | 距离测量 |
| Cyan | `#5BCCFF` | 角度测量、格式徽章 |
| Green | `#3FDB97` | 成功 toast |
| Red | `#FF6B7A` | 危险操作、错误、清除 |
| 白烟 | `#ECF1F8` | 高亮文本 |

窗口骨架专用:`菜单栏 #0A0E16 @88% / 底分线 #1E2736`、`工具栏 #0A0E15 @70% / 底分线 #1C2534`、`状态栏 #080C12 / 顶分线 #19212E`、`视口外框渐变 #111722→#090D14 / 描边 #273244 / 圆角 13dp`。标题栏(DWM 深色):caption `#0A0E16`、text `#E9EFF8`、border `#283345`。

视口 HUD(`Viewport.cpp` `kHud*`):文本 `#EAF0F8`、暗 `#9DABBF`、极暗 `#718097`、强调 `#8DB0FF`(绘制用 `#6392FF`)、Teal `#35D3AF`、Gold `#FFC95B`、Cyan `#5BCCFF`、Red `#FF6B7A`;面板 `#0B111B @80%`、柔和面板 `#0A0F18 @58%`、描边 `#2A3549 @85%`。

3D 场景测量线颜色:`距离 = RGB(1.0,0.76,0.28) ≈ #FFC247`、`角度 = RGB(0.38,0.83,1.0) ≈ #61D4FF`(与 UI 的 Gold/Cyan 同族,实现时统一用 token 色即可)。

### 1.2 字体

- 正文族:`Microsoft YaHei UI`,回退 `Segoe UI`,再回退系统 sans(Web:`"Microsoft YaHei UI","Segoe UI",system-ui,sans-serif`)。
- 等宽族:`Cascadia Mono` → `Consolas` → `Courier New`(坐标、快捷键、版本号、测量数值、晶胞数值用等宽)。
- 仅两档字重:`Regular(400)` / `Bold(700)`;标题、选中态、数值强调用 Bold。
- 字号阶梯(dp):`21`(帮助页 App 名) · `18`(表单标题) · `17`(外观设置标题) · `14.5`(面板结构标题) · `13.5`(菜单栏 App 名) · `12.5`(选中原子名/视口标题/菜单项) · `12`(菜单项 12、toast 标题 12) · `11.8`(菜单栏菜单) · `11.5`(测量数值) · `11`(面板正文/空状态提示) · `10.5`(工具栏标签、toast 正文、tooltip、帮助描述) · `10.2`(表单字段名) · `10`(视口后缀/提示条/表单按钮) · `9.6`(右栏模式按钮、信息行) · `9.5`(外观滑杆标签、表单副标题、状态栏) · `9.4`(表单错误/测量表达式) · `9.2`(面板开关标签、内容元素、图例) · `9.0`(视口原子标签、脚注) · `8.8`(段选/元素 chip/面板小链接) · `8.5`(面板 meta) · `8.2`(表单字段 hint、徽章、版本 chip)。

### 1.3 圆角 / 描边 / 阴影 / 间距

| 元素 | 圆角 | 说明 |
|---|---|---|
| 左/右面板、视口外框 | 13 | 1dp 描边 |
| 对话框(表单) | 16 | |
| 帮助窗口 | 15 | |
| 外观设置窗口 | 14 | |
| 菜单弹层 | 10 | 窗口区域圆角 |
| toast | 11 | |
| tooltip | 6 | |
| 卡片(晶胞/测量/空态) | 9 / 11 | 小卡 9,结构空态卡 11 |
| 按钮 | 7~8 | 次级 7,主按钮 8,表单按钮 8 |
| 输入框 | 8 | |
| 段选容器 8 / 激活段 6 | | |
| chip/徽章 | 6 / 8 | |
| HUD 面板 | 9~10 | 标题条 10,提示条 9 |

- 阴影:`Shadow(rect, radius, color, spread)`:三层叠加,每层外扩 `spread*i`、alpha 依次衰减 1/(3+i),偏移 +1dp。面板用 `spread 4`、视口外框 `spread 5`。
- 全局外边距 12dp;面板间距 10dp;面板内边距 16dp(水平)/ 14dp(垂直);面板内容宽 = 内宽 - 6dp。
- 所有文字默认单行截断(省略号 `…`),仅指定处换行。

---

## 2. 主窗口结构

类 `CrystalLensMainWindow`,无系统菜单栏、全部自绘(GDI+ 离屏位图后 BitBlt,`WM_ERASEBKGND` 返回 1)。

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 菜单栏 38dp: [logo24] CrystalLens [v1.1] │ 文件 编辑 视图 测量 帮助 …  [中文][i]│
├──────────────────────────────────────────────────────────────────────────┤
│ 工具栏 52dp: [打开][重载][截图] │ [重置][适应][投影] │ [晶胞][键][标签] │     │
│              [距离测量][角度测量][清除]                    [左面板][右面板]   │
├──────────┬──────────────────────────────────────────────┬────────────────┤
│ 左面板    │  视口外框 13dp 圆角(内嵌 1dp 子窗口 = WebGL)   │ 右面板          │
│ 262dp     │  HUD 叠加:标题条 / 测量横幅 / 元素图例 /      │ 296dp           │
│          │           底部提示 / 坐标轴 gizmo / 测量标签   │                │
├──────────┴──────────────────────────────────────────────┴────────────────┤
│ 状态栏 30dp: ● 状态文本 ………………………………… OpenGL 3.3 · GPU · 4×MSAA      │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.1 布局计算(`Relayout`)

| 区域 | 矩形 |
|---|---|
| 菜单栏 | `{0,0,W,38}` |
| 工具栏 | `{0,38,W,52}` |
| 状态栏 | `{0,H-30,W,H}` |
| 内容顶 | `toolbar.bottom + 8` = 98 |
| 内容底 | `max(contentTop+100, status.top - 8)` = `H-38` |
| 外边距 margin | 12 |
| 面板间距 gap | 10 |
| 左面板(可见时) | `{12, 98, 12+262, H-38}` |
| 右面板(可见时) | `{W-12-296, 98, W-12, H-38}` |
| 视口外框 | `{margin + (left? 262+10:0), 98, W - margin - (right? 296+10:0), H-38}` |
| 视口子窗 | 外框向内缩 1dp(避免描边被裁) |

**绘制顺序**:背景 → 视口外框(阴影/渐变/描边)→ 左面板 → 右面板 → 菜单栏 → 工具栏 → 状态栏 →(视口子窗自行绘制 HUD)。每帧重建 hotspot(命中区)列表;命中测试**从后往前**,即可见性由绘制顺序决定。

### 2.2 窗口尺寸

- 创建时 `1280×800`,随后定位居中:`W = min(1360×scale, 工作区 94%)`、`H = min(830×scale, 工作区 92%)`。
- 最小尺寸 `900×560 ×scale`(`WM_GETMINMAXINFO`)。
- 标题 `CrystalLens  —  <文件名|tagline>`;有未保存修改时追加 ` *`(注意是 "两个空格 + 长破折号 + 两个空格")。
- 高 DPI:进程 Per-Monitor-V2;`WM_DPICHANGED` 时更新 `scale`,把窗口移到系统建议矩形、`viewport.SetDpi()`、重置 hover、`Relayout()`。所有布局/字号乘 scale;子窗弹层若超出工作区会按比例缩小其内部 dpi(见 §11 表单/帮助)。

---

## 3. 菜单栏

高度 38dp,背景 `#0A0E16 @88%`,底部分线 `#1E2736`。

- 左侧:`logo` 24×24 @x=16,垂直居中;App 名 13.5 Bold `#EAF0F8` @`logo.right+10`;版本 chip:文本 `v1.1` 等宽 8.2,高 17、宽 `measure+14`、圆角 8、底 `#19212F`、描边 `#2A3547`、字色 `#7E8EA7`;之后 +22dp。
- 5 个菜单:字号 11.8,宽 `measure+22`,高 26,y=top+6,间距 2;未激活 `#9EAABE`,悬停/打开 `#EAF0F8`,悬停底 `#1D2636` 圆角 7;打开时底部再加 2dp 强调下划线(左右各内缩 9dp,`#6392FF`)。
- 右侧:帮助按钮 31×31 @`W-14-31`,悬停底 `#1D2636`,`Info` 图标 17×17(内缩 7);语言胶囊在帮助左侧 10dp:高 24、宽 `measure(9.8)+20`、圆角 8、底 `#161D2A`(悬停 `#1F293A`)、描边 `#2A3548`、文字 9.8 `#9DADC6`。**胶囊显示"当前语言"**(中文模式下显示"中文"),点击切到另一语言(tooltip `tip.language「切换中文 / English」`)。

### 3.1 菜单内容(逐项:`label` · 快捷键 · 可用条件 · 勾选)

**文件**(menu.file「文件 / File」)

| 序 | 文案键 | 快捷键 | 可用条件 | 命令 |
|---|---|---|---|---|
| 1 | file.open「打开结构文件… / Open structure…」 | Ctrl+O | 恒可用 | 系统打开对话框(多选) |
| 2 | library.title「经典晶体库 / Crystal library」 | Ctrl+L | 恒可用 | 晶体库对话框 |
| 3 | file.reload「重新载入 / Reload」 | Ctrl+R | 有当前路径 | 确认后重载 |
| 4 | file.save「保存结构… / Save structure…」 | Ctrl+S | 已载入 | 另存 CIF/XYZ |
| 5 | file.save-screenshot「保存视图截图 / Save viewport image」 | Ctrl+Shift+S | 已载入 | 存 PNG |
| — | 分隔线 | | | |
| 6 | file.exit「退出 / Exit」 | Alt+F4 | 恒可用 | 关闭窗口(未保存确认) |

**编辑**(menu.edit「编辑 / Edit」)

| 序 | 文案键 | 快捷键 | 可用条件 |
|---|---|---|---|
| 1 | edit.undo「撤销 / Undo」 | Ctrl+Z | undo 栈非空 |
| 2 | edit.redo「重做 / Redo」 | Ctrl+Y | redo 栈非空 |
| — | 分隔线 | | |
| 3 | edit.cell「编辑晶胞… / Edit unit cell…」 | Ctrl+E | 晶胞有效 |
| 4 | edit.add-atom「添加原子… / Add atom…」 | Ctrl+Shift+A | 已载入 |
| 5 | edit.edit-atom「编辑选中原子… / Edit selected atom…」 | F2 | 有选中原子 |
| 6 | edit.delete-atom「删除选中原子 / Delete selected atom」 | Delete | 有选中原子 |
| — | 分隔线 | | |
| 7 | edit.copy-summary「复制结构摘要 / Copy structure summary」 | Ctrl+C | 已载入 |
| 8 | edit.clear-measurements「清除全部测量 / Clear all measurements」 | — | 已载入且有测量 |

**视图**(menu.view「视图 / View」)

| 序 | 文案键 | 快捷键 | 可用 | 勾选 |
|---|---|---|---|---|
| 1 | view.reset「重置视图 / Reset view」 | Home | 已载入 | — |
| 2 | view.fit「适应窗口 / Fit to window」 | F | 已载入 | — |
| — | 分隔线 | | | |
| 3 | view.perspective「透视投影 / Perspective projection」 | — | 已载入 | `!orthographic` |
| 4 | view.orthographic「正交投影 / Orthographic projection」 | — | 已载入 | `orthographic` |
| — | 分隔线 | | | |
| 5 | view.toggle-cell「显示晶胞边框 / Show unit-cell frame」 | C | 晶胞有效 | `showCell` |
| 6 | view.toggle-bonds「显示化学键 / Show bonds」 | B | 已载入 | `showBonds` |
| 7 | view.toggle-labels「显示原子标签 / Show atom labels」 | L | 已载入 | `showLabels` |
| 8 | panel.display.boundary「边界原子 / Boundary」 | — | 晶胞有效 | `showImages` |
| 9 | view.supercell「超胞… / Supercell…」 | — | 晶胞有效 | — |
| 10 | view.appearance「外观设置… / Appearance…」 | — | 恒可用(菜单项不限) | — |
| 11 | view.toggle-axes「显示坐标轴 / Show axes」 | — | 已载入 | `showAxes` |
| — | 分隔线 | | | |
| 12 | view.toggle-left-panel「显示结构面板 / Show structure panel」 | — | 恒可用 | `leftVisible` |
| 13 | view.toggle-right-panel「显示测量面板 / Show measurement panel」 | — | 恒可用 | `rightVisible` |
| — | 分隔线 | | | |
| 14 | language.english「English」/ language.chinese「中文」 | — | 恒可用 | 显示目标语言 |

**测量**(menu.measure「测量 / Measure」)

| 序 | 文案键 | 快捷键 | 可用 | 勾选 |
|---|---|---|---|---|
| 1 | measure.distance「距离测量 / Distance」 | D | 已载入 | `mode==Distance` |
| 2 | measure.angle「角度测量 / Angle」 | A | 已载入 | `mode==Angle` |
| — | 分隔线 | | | |
| 3 | measure.exit「退出测量模式 / Exit measuring mode」 | Esc | 测量模式中 | — |
| 4 | edit.clear-measurements「清除全部测量」 | — | 有测量 | — |

**帮助**(menu.help「帮助 / Help」)

| 序 | 文案键 | 快捷键 |
|---|---|---|
| 1 | help.menu.shortcuts「快捷键与操作 / Shortcuts & controls」 | F1 |
| 2 | help.menu.about「关于 CrystalLens / About CrystalLens」 | — |

> 帮助与关于**打开同一个窗口**(HelpWindow);命令处理中 `CmdHelp`/`CmdAbout` 合并。

### 3.2 菜单弹层(MenuPopup)

- 尺寸:宽 `clamp(max(项文字)+max(快捷键)+78, 236, 390)`,项高 33、分隔 9、内边距 6;`height = padding*2 + Σitem`。
- 视觉:底 `#131925`,描边 `#2E3A4E`,圆角 10,顶部叠一层 18dp 的 `#181F2D` 高光条;`CS_DROPSHADOW`。
- 项:文本 12 @`left+36`;勾选时在 `left+10` 画 16×16 `Check` 图标(`#6392FF`);快捷键 8.8 等宽右对齐 @`right-11`(`#707F97`,禁用 `#506173`);悬停(仅可用项)圆角 7 底 `#1F2A3D`;禁用文字 `#5C687B`;分隔线 `#252F40` 左右各内缩 10。
- 弹出位置:菜单项左下 +2dp;右侧/底部越界时内缩 8dp、必要时向上翻转(上翻到 `触发点.y - height - 2`)。
- 关闭:点击项(执行命令并关闭)、点击空白、右键、Esc、失去焦点;关闭后通知主窗 `WM_CL_MENU_CLOSED` 让菜单栏恢复。
- 键盘:↑/↓ 循环跳过分隔与禁用项、Enter/Space 执行当前悬停项。

---

## 4. 工具栏(52dp)

背景 `#0A0E15 @70%`,底分线 `#1C2534`。按钮 36×36,第一个 x=12,垂直居中,按钮间距 4dp;分组间竖分隔线(高 `52-26`,色 `#222C3C`)并空 13dp。

| 组 | 按钮(图标) | 命令/行为 | 激活条件 | 可用条件 | Tooltip 键 |
|---|---|---|---|---|---|
| 1 | Open(文件夹) | 打开文件 | — | 恒可用 | tip.open「打开结构文件   Ctrl+O」 |
| 1 | Reload(圆弧箭头) | 重载 | — | 有文件路径 | tip.reload「重新载入   Ctrl+R」 |
| 1 | Camera(相机) | 截图 | — | 已载入 | tip.screenshot「保存截图到图片文件夹   Ctrl+Shift+S」 |
| 2 | Reset(回环) | 重置视图 | — | 已载入 | tip.reset「重置视图   Home」 |
| 2 | Fit(四角括号) | 适应窗口 | — | 已载入 | tip.fit「适应窗口   F」 |
| 2 | Cube(立方体) | 切换投影 | — | 已载入 | tip.projection「切换透视 / 正交投影」 |
| 3 | Cell(晶胞框) | 显示晶胞 | `showCell` | 晶胞有效 | tip.cell「显示或隐藏晶胞边框   C」 |
| 3 | Bond(两圆连线) | 显示键 | `showBonds` | 已载入 | tip.bonds「显示或隐藏化学键   B」 |
| 3 | Label(标签牌) | 显示标签 | `showLabels` | 已载入 | tip.labels「显示或隐藏原子标签   L」 |

| 4 | Ruler + 文字「距离测量」 | 距离测量 | `mode==Distance`(金色系) | 已载入 | tip.distance「距离测量   D」 |
| 4 | Angle + 文字「角度测量」 | 角度测量 | `mode==Angle`(青色系) | 已载入 | tip.angle「角度测量   A」 |
| 4 | Trash(垃圾桶) | 清除全部测量 | — | 有测量 | tip.clear-measurements「清除所有测量结果」 |

| 右对齐 | PanelLeft | 左面板开合 | `leftVisible` | 恒可用 | tip.left-panel「显示或隐藏结构面板」 |
| 右对齐 | PanelRight | 右面板开合 | `rightVisible` | 恒可用 | tip.right-panel「显示或隐藏测量面板」 |

按钮样式(`PaintToolButton`):激活 → 底 `accent@15%` + 描边 `accent@35%` + 图标/文字用 accent;悬停 → 底 `#1D2637`;图标 18dp(带文字时 16dp @`x+9`);文字 10.5 @`x+31`,激活加粗。图标色优先级:禁用 `#4B586C` > 激活 accent > 悬停 `#EAF0F8` > 常态 `#9EAABE`;文字色:禁用 `#4B586C` / 激活 accent / 悬停 `#EAF0F8` / 常态 `#B7C3D5`。带文字按钮宽 = `max(36, measure(文字,10.5)+42)`。悬停热区是按钮矩形整块,光标 hand;滑杆为水平 resize 光标。

---

## 5. 左侧面板(结构面板,262dp 宽)

容器:阴影 spread4 + 渐变 `#131A26→#0E131D` + 描边 `#253041` + 圆角 13;内边距 16/14;内容可滚动(整块裁剪绘制),滚轮 52dp/档;自定义滚动条:轨道 3dp @`panel.right-8`、`#1B2330`,滑块 `#445774`,最小高 28。

分区标题 `PaintSectionLabel`:3×12dp 圆角竖条(`#6392FF`)+ 9.2dp Bold `#74839A` + 上留白 12 → 节标题高 26~28。

### 5.1 未打开结构(空态)

`panel.section.structure「晶体结构 / STRUCTURE」` → 卡片(高 196,圆角 11,底 `#0F151F`,描边 `#222D3E`):
- 居中 logo 48×48(@y+24)
- 提示 11dp `#919FB6` 居中换行:`panel.empty.hint「打开文件后在此查看结构信息 / Open a structure to inspect it here」`
- 主按钮(高 34、宽 `max(138, measure(10.5, bold)+34)`、圆角 8、底 `#6392FF`、悬停 `#85ABFF`、白字 10.5 Bold):`viewport.empty.open「打开结构文件 / Open structure」` → 打开文件对话框

### 5.2 已载入

1. **晶体结构**:标题 14.5 Bold(空则用 App 名)26dp 高 → 化学式 10.5 `#85ABFF`(`FormatFormulaText`,空则 `—`)→ 徽章行:
   - 格式徽章(CIF/XYZ/VESTA)青色 `#5BCCFF`
   - 类型徽章:晶胞有效 → `panel.badge.periodic「周期性晶体 / Periodic crystal」`(Teal);否则 `panel.badge.molecule「分子结构 / Molecule」`(`#9EAABE`)
   - 徽章:高 19、圆角 8、底色 `色@13%`、描边 `色@31%`、文字 8.2 Bold
2. **晶胞参数**:标题右侧链接 `panel.cell.edit「编辑 / Edit」`(8.8,悬停 `#85ABFF`);其左侧 `超胞  2×2×2`(8.4,`panel.cell.supercell-link「超胞 / Supercell」` + 当前倍率,悬停 `#85ABFF`)→ 打开超胞对话框。仅晶胞有效时显示。
   - 晶胞卡片:高 92、圆角 9、底 `#0C111A`、描边 `#1F2938`;三列 a/b/c:列名 8.5 `#6C798F`,值 9.4 等宽 `#EAF0F8`(`%.4f Å`);第二行 `α 90.00°    β 90.00°    γ 90.00°` 8.8 等宽 `#96A3B8`;第三行 `体积  697.06 Å³` 8.8 `#7F8DA4`。
   - 无晶胞时:显示 `panel.badge.molecule` + `体积  —`。
3. **信息行**(4 行,行高 21):`common.space-group`、`common.symmetry-ops`(无则 1)、`common.asymmetric-unit`、`common.cell-contents`;左 9.6 `#6C798F`(宽 46%),右 9.6 等宽右对齐 `#B6C3D6`(宽 54%,超长省略)。
4. **显示**(menu.view 同款):两列开关(每列宽 `(contentW-8)/2`,行高 28):`panel.display.cell「晶胞边框 / Cell frame」(需晶胞)`、`bonds「化学键 / Bonds」`、`labels「原子标签 / Atom labels」`、`boundary「边界原子 / Boundary」(需晶胞)`、`axes「坐标轴 / Axes」`。悬停整行底 `#1B2433` 圆角 6;开关见 §5.4。
5. **外观**:标题右侧链接 `panel.appearance.settings「设置 / Settings」`(8.6)→ 打开外观设置窗口。段选(高 32、圆角 8、底 `#0B1018`、描边 `#212B3B`,3 等分):`球棍模型 / 空间填充 / 多面体`(8.8;激活底 `#1F2C43`、描边 `#45608B`、文字 `#EAF0F8` Bold;未激活 `#6C798F`)。
   - `原子尺寸` 标签 9.6 `#6C798F` + 右侧百分比 9.4 等宽 `#9EAABE`(`%d%%`,如 `30%`)
   - 滑杆:轨道高 4、圆角 2、底 `#222D3E`,已填充 `#6392FF`,手柄 12 圆 `#DEE7F5`;范围 `0.15–0.85`,热区 = 轨道上下各 9dp(高 26);**空间填充样式下滑杆禁用**。
6. **元素**(panel.section.elements「元素 / Elements」):按原子数降序、同数按原子序数升序;元素 chip:高 23、圆角 6、底 `#141B27`、描边 `#202A39`,内含 6dp 元素色圆点 + `Symbol count` 8.8 Bold `#BAC7D9`;最多绘制 **14** 个,超出显示 `panel.elements.more「+%d 种元素 / +%d more」` 8.6 `#6C798F`。

### 5.3 开关(PaintSwitch)

宽 32、高 17、圆角全;开= `#6392FF`,关= `#263041`,禁用= `#1E2633`;关/禁用有描边 `#364358`;旋钮 13dp 圆:开= 白,关= `#97A3B5`,左/右内缩 2dp。

### 5.4 面板滚动

- 滚轮在左/右面板区域内 → 滚动对应面板 52dp×(`delta/120`),并在 0..(contentH-innerH) 间钳制。
- 视口内滚轮 = 缩放(见 §12)。

---

## 6. 右侧面板(测量面板,296dp 宽)

容器样式同左面板。分区:

### 6.1 选择(`panel.section.selection「选择 / SELECTION」`)

- **未载入** 或 **未选中**:卡片高 58、圆角 9、底 `#0D121B`、描边 `#1F2937`
  - 未载入:仅 `panel.selection.hint「在三维视图中点击原子以查看信息 / Click an atom in the viewport to inspect it」` 9.8 `#6C798F` 换行
  - 未选中:`panel.selection.none「未选择原子 / No atom selected」` 10.2 `#9EAABE` @y+10 + 同一 hint 8.8 @y+28
- **选中原子**:卡片高 190
  - 元素圆 34×34(元素色 @82% 不透明):元素符号 12.5 Bold、深色字 `#14181E`
  - 原子标签 12.5 Bold `#EAF0F8`(空则 `元素符号+序号`);副行 8.5 `#6C798F`:`O   ·   Z=8   ·   位点 1`(`panel.selection.site`)
  - `panel.selection.fractional「分数坐标 / Fractional」` 8.2 `#6C798F` + 值 8.7 等宽 `#AAB8CD`:`x 0.4139   y 0.2674   z 0.2144`(4 位小数)
  - `panel.selection.cartesian「笛卡尔坐标 / Cartesian」` + 值(3 位小数)
  - meta 8.5 `#8997AC`:`占位率  1.00`(2 位)+ `Uiso  0.0123`(4 位,有则)+ `对称等价位置 #2`(对称生成时,索引 `symmetryIndex+1`)
  - 两个操作按钮(高 30、宽 `(contentW-24-8)/2`、圆角 7):`panel.selection.edit-atom「编辑原子 / Edit atom」`(强调亮,底 `#121823`,描边 `accentLight@27%`,悬停底 `accentLight@15%`)、`panel.selection.delete「删除 / Delete」`(红色同构);文字 9.2 Bold。

### 6.2 测量(`panel.section.measurements「测量 / MEASUREMENTS」`)

- 标题右侧链接(仅在有测量时):`panel.measurements.clear-all「清除全部 / Clear all」` 8.8,悬停变 `#FF6B7A`。
- 模式按钮 2 个(高 34、宽 `(contentW-6)/2`、圆角 8):
  - `measurement.type.distance「键长 / Distance」` + Ruler 图标 15dp @+10,文字 9.6 @+30;激活金色 `#FFC95B`(底 `金@15%`、描边 `金@37%`、文字/图标金)
  - `measurement.type.angle「键角 / Angle」` 同构,青色 `#5BCCFF`
  - 未载入时图标/文字用 `#4C596E` 且不可点
- 测量模式提示行(mode != None):优先 `measurement.selected-count「已选 %d / %d」`,否则 `measurement.pick.distance「点击两个原子测量距离 / Click two atoms to measure distance」` 或 `measurement.pick.angle「依次点击三个原子测量键角 / Click three atoms to measure the angle」`;8.8,金色/青色。
- 空态卡:高 70、底 `#0C111A`、描边 `#1E2836`;`panel.measurements.empty「还没有测量结果 / No measurements yet」` 9.8 `#9EAABE` 居中 + `panel.measurements.empty-hint「选择距离或角度，再点击原子 / Pick a mode, then click atoms」` 8.6 `#6C798F` 居中换行。
- 结果卡(每条高 58、底 `#0D131C`、描边 `#212C3C`):左侧 3×36 类型色条;类型名 8.3 Bold 类型色;数值 11.5 Bold 等宽类型色右对齐;表达式 9.4 等宽 `#A9B7CB`(`O1–O2`,端破折号 U+2013;角度 `O1–O2–O3`);右上角 20×20 关闭热区,`Close` 图标 10dp,`#4C596E`(悬停 `#FF6B7A`),tooltip `measurement.remove「删除此测量 / Remove this measurement」`。

---

## 7. 状态栏(30dp)

背景 `#080C12`,顶分线 `#19212E`(位于 `top+0.5`)。
- 左侧指示点:6dp 圆 @x=16,渲染器就绪 = Teal `#35D3AF`,失败 = Gold `#FFC95B`。
- 状态文本 9.5 `#8D9CB2` @x=29,最大宽 56%:
  - 悬停原子时有更高优先级:`status.hover「%s  ·  %s  ·  点击选择 / %s  ·  %s  ·  click to inspect」`(标签,元素符号)
  - 否则为最近一次状态:`status.loaded「已载入  %s」`、`status.structure-updated「结构已更新」`、`status.undone「已撤销」`、`status.redone「已重做」`、`status.atom-deleted「已删除原子」`、`toast.save.saved「已保存到 %s」`、`toast.screenshot.saved「截图已保存到 %s」`、`toast.open-failed-title「无法打开文件」`、`status.ready-hint「打开 CIF / VESTA / XYZ 文件开始」`(启动时)等;空则 `status.ready「就绪 / Ready」`。
- 右侧:渲染器描述 8.6 `#58667A`,右对齐,最大 38% 宽,超长省略。格式 `OpenGL 3.3.0  ·  Intel(R) Arc(TM) ...  ·  4× MSAA`(MSAA 为 1 时省略);失败时 `common.unknown「未知」`。

---

## 8. 视口(HUD 叠加层)

视口 = 独立 GL 子窗口,尺寸取外框内缩 1dp。HUD 全用矢量/文字绘制(叠加在 3D 之上);所有测量/标签锚点由相机投影。

### 8.1 已载入 HUD

1. **标题条**:`x=16,y=14,h=34`,宽 = `36 + measure(title,12.5,bold) + measure(suffix,10)`,上限 `min(0.60W, 580)`;底 `#0B111B @80%`、描边 `#2A3549 @85%`、圆角 10。左侧 3.2dp 圆点 `#8DB0FF` + 5.5dp 圆环 `#6392FF @35%`(x=31);标题 12.5 Bold;后缀 10 `#718097`:
   `    ·   CIF   ·   65 原子   80 化学键`(键数 >0 且非多面体无壳时追加)
   - 视口宽 < 700dp(compact):后缀只保留 `    ·   CIF`
   - 多面体样式但无配位壳:追加 `  ·  viewport.hud.no-coordination-hull「无三维配位 · 球棍 / No 3D shell · ball and stick」`
   - 超胞超预算:`  ·  viewport.hud.supercell-limited「超胞过大，显示单胞 / Supercell limit: showing one cell」`
   - 否则边界截断:`  ·  viewport.hud.boundary-limited「边界副本已截断 / Boundary images truncated」`
   - 标题过长时先缩标题(省略号),保证后缀完整。
2. **测量横幅**(仅测量模式):`y = 14+34+8 = 56`,`h=30`,宽 `measure+34`,圆角 9,底 `#0D1118 @82%`,描边距离 `#6B5421 @90%` / 角度 `#1F536A @90%`;左侧 3dp 圆点模式色;文字 10.5 模式色,内容 `距离测量   ·   已选 1 / 2`(类型名 + 3 空格 + bullet + 3 空格 + 状态)。
3. **元素图例**(右上):视口宽 ≥ 560 才显示;最多 8 种元素,按元素符号字母序;`右内缩 18`,`top=54`,行高 20;每行:4.2dp 元素色圆(x=panelX+6)+ 元素符号 9.2 `#9DABBF` 右对齐(x=`panelX+50`)。
4. **坐标轴 gizmo**(右下):100×100(compact 86),内缩 16;圆角 11,底 `#0A0F18 @58%`,描边 `#253044 @65%`;中心 `(x+size/2, y+size*0.53)`,轴长 `0.27*size`,线宽 1.7,端点 2.2dp 圆 + 9.5 Bold 标签;三轴取晶胞 a/b/c 方向(无晶胞用 x/y/z),颜色 Red/Teal/Cyan;指向背面时 alpha 0.55。
5. **底部提示条**:`x=16, y=H-16-28, h=28`,宽 `min(max(120, gizmoX-28), measure(文字,10)+24)`,圆角 9,底 `#0A0F18 @58%`,描边 `#222C3D @60%`,文字 10 `#9DABBF`:
   - 常规 `viewport.hint.navigate「左键拖动旋转   ·   滚轮缩放   ·   中键 / 右键平移 / Drag to rotate · Scroll to zoom · Middle/right-drag to pan」`
   - 距离测量 `viewport.hint.measure-distance「距离测量：点击两个原子   ·   Esc 退出」`
   - 角度测量 `viewport.hint.measure-angle「角度测量：依次点击三个原子   ·   Esc 退出」`
6. **边界原子图例**(存在周期性键时,提示条上方 `h=24`,`y = H-16-28-8-24`):圆点 `#6EA8FF`(显示边界)/`#E0B45A`(隐藏)+ 9.2 文案 `viewport.legend.boundary-on「边界原子 = 相邻晶胞中的原子」` / `boundary-off「仅显示晶胞内原子与键」`。
7. **测量标签**:世界坐标取测点/角平分线位置投影到屏幕 `(+8, -22-4)`,盒高 22、圆角 7、底 `#0A0F18 @88%`、描边类型色 @55%、文字 10 Bold 类型色;最多 24 条;**碰撞处理**:与已放置盒重叠则上移 `22+3`dp,最多重试 5 次;屏幕边距 20dp 内不画。
8. **原子标签**(`showLabels` 且原子数 ≤ 400 时):最多 90 个,按深度从远到近;文字 9,位置 `(+5, -textH-3)`,先画黑色阴影 @65% 再画元素标签色(元素色提亮 `0.38+0.62*c`,alpha 0.96);超 12 字符截断加 `…`;与其他标签矩形碰撞则跳过。
9. **Flash 反馈**(测量完成):居中底部 `y=H-58-28`,`h=28`,宽 `measure+30`,底 `#0C1119 @88%`,描边 `#8A6B2E`,文字 10.5 `#FFD98A`,内容 `✓  O1–O2    1.234 Å`;持续 2400ms,最后 500ms 线性淡出。

### 8.2 空状态(未打开结构)

居中六边形"晶格"图形(6 个顶点连线,蓝/青交替;多层同心圆光晕半径 `radius*(1.4+i*0.34)`;中心小环):
- 标题 `viewport.empty.title「打开结构文件，开始探索晶体世界 / Open a structure and explore its crystal world」` 21 Bold `#EAF0F8`,超宽先降 17 再省略
- 副标题 `viewport.empty.subtitle「将 CIF、VESTA 或 XYZ 文件拖放到窗口 / Drop a CIF, VESTA or XYZ file here」` 12 `#9DABBF`,+33dp
- 主按钮(+66dp,高 44,宽 `max(198, measure(12.5,bold)+58)`,圆角 12):`library.title「经典晶体库 / Crystal library」` 12.5 Bold 白字;底 `#5B8CFF @94%`,悬停 `#7CA3FF @98%`;顶部叠 `白 @6%` 高光;底边 1dp `#9CB8FF @35%` 线;**点击 = 打开晶体库**
- 格式行(+27):`viewport.empty.formats「CIF   ·   VESTA   ·   XYZ」` 9.5 `#718097`
- 页脚(H-20):`viewport.empty.footnote「本地解析 · 硬件加速渲染 · 无需联网」` 9.5 `#596981`

### 8.3 渲染失败回退

当 GL 初始化失败:视口画纯色底 `#090D15`,居中:
- `error.renderer.title「无法初始化 OpenGL 3.3 渲染器 / Could not initialize the OpenGL 3.3 renderer」`(18)
- `error.renderer.hint「请更新显卡驱动后重新启动 CrystalLens / Update your graphics driver and restart CrystalLens」`(11 `#9BA8BC`)
- 若存在错误详情:9dp 等宽 `#6C798F` 居中(`#height/2+66 ~ +150` 区域)
- 状态栏仍显示错误信息,指示点变 Gold。

---

## 9. 浮层组件

| 组件 | 规格 | 行为 |
|---|---|---|
| **Tooltip** | 单行;字号 10.5,内边距水平 20,高 `10.5+13`;圆角 6;底 `#0F151F`,描边 `#303D53`,字 `#D1DBE9`;位置 = 光标 `(+14,+20)`,越界翻转/钳制到工作区 8dp | 热区带 tooltip 时,**悬停稳定 550ms** 后显示;热区改变、点击、打开菜单、应用失活、离开窗口立即隐藏;不接收鼠标(`HTTRANSPARENT`) |
| **Toast** | 非阻塞,底部居中;宽 `clamp(340, max(title, min(msg,500))+84, 620)`;高 ≥ 76(带正文 100);距窗口底 64;圆角 11;底 `#101621`,描边 `#2D394D`;左侧 4dp 状态色条 + 22dp 圆形图标(✓ 或 `!`);标题 12 Bold `#ECF1F9`,正文 10.5 `#9AA7BB` 换行 | 显示 4600ms 自动消失;点击立即消失;新 toast 覆盖旧 toast;类型 Info(强调蓝)/Success(绿)/Error(红) |
| **Flash** | 见 §8.1-9 | 仅测量完成时,2400ms |

---

## 10. 对话框总览

四种形态:
1. **Win32 原生对话框**:仅晶体库(`IDD_LIBRARY`,330×230 DLU)。
2. **自定义表单窗(FormWindow)**:超胞/编辑晶胞/添加原子/编辑原子 —— 620dp 宽、`高=208+54×字段数`、圆角 16、**模态**(打开时 `EnableWindow(owner,false)`)。
3. **模型窗口**:外观设置(非模态,实时预览)、帮助/关于(模态式,禁用主窗)。
4. **系统消息框**:未保存确认、晶体库不可用、启动失败。

### 10.1 表单窗通用规格(FormWindow)

- 尺寸 620 × `208+54n`;若超出工作区(减 40)则按比例缩小内部 dpi(最小 0.75)。
- 视觉:圆角 16;垂直渐变 `#0F141E → #090D14`;描边 `#303C52`;左上角径向光晕 `#407AFF @7.5%`(420×360 @-100,-120)。
- 标题 18 Bold @(30,24);副标题 9.4 `#6C798F` 换行(最多 2 行)@(30,56);分隔线 y=88(`#283345`)。
- 字段行:起点 y=106,行距 54;字段名 10.2 `#9EAABE` @(30, 行心-10, 宽 140);hint 8.2 `#4C596E` @(30, 行心+8);输入框 `{180, y+7, W-30, +38}` 圆角 8、底 `#0C111A`、描边 `#263143`;**聚焦时描边 `#6392FF` 1.6dp**,否则 1dp。
- 原生 EDIT 控件:字体 12.5 YaHei,内缩 8/4,`EM_SETLIMITTEXT 512`,文字 `#EAF0F8`,底色 `#0C111A`;`Tab/Shift+Tab` 循环、`Enter` 提交、`Esc` 取消、`Ctrl+A` 全选;打开时自动聚焦首字段并全选。
- 错误行:y = `106+54n+8`,9.4 `#FF6B7A` 换行;任意字段编辑(`EN_CHANGE`)后清除错误。
- 按钮:OK 主按钮 + Cancel 次级,各 108×34,圆角 8,位于底部右侧(距右 30,间隔 10);主按钮底 `#6392FF`(悬停 `#85ABFF`)白字 10 Bold,次级底 `#161C28`(悬停 `#1E2737`)描边 `#2B3649` 文字 `#9EAABE`。
- 右上关闭按钮 44×44(热区),关闭符号 20×20、线宽 1.6、色 `#ACB8CA`;悬停底 `#1F2939` 圆角 10。
- 标题区(y<88,除关闭按钮)可拖动窗口(`HTCAPTION`)。
- 点 OK → 回调校验:返回空串 = 成功(关闭窗口);返回非空 = 显示该错误、窗口保持打开。

### 10.2 晶体库(原生对话框)

- **入口**:① 文件菜单 `library.title`(Ctrl+L);② 未打开结构时视口空状态的大按钮(点击 = CmdLibrary)。视图菜单中**没有**晶体库项;已载入结构时从文件菜单进入同样可用。
- 标题(运行时设置):`library.title「经典晶体库 / Crystal library」`。
- 提示行:`library.hint「双击打开一个晶体，或按住 Ctrl / Shift 多选，在独立窗口中打开。/ Double-click a crystal, or use Ctrl / Shift to open several in separate windows.」`
- 列表(Report 视图,全行选中,双缓冲,表头不可排序):4 列
  `library.col.mineral「晶体名称 / Crystal」34%`、`library.col.formula「化学式 / Formula」17%`、`library.col.space-group「空间群 / Space group」29%`、`COD` 20%
- 默认选中并聚焦第 0 行。**双击**行 = 打开;「打开」按钮在多选数为 0 时禁用;按钮 `library.open「打开 / Open」`、`dialog.cancel「取消 / Cancel」`;Esc/关闭 = 取消。
- 数据源:`<exe目录>/library/index.tsv`,6 个制表符字段 `file / zh / en / formula / space_group / cod`,任一为空则跳过该行;文件名必须是 `.cif` 纯文件名。
- 打开行为:每个选中项 → 若当前窗口尚未载入结构则就地载入,否则**为每个文件启动一个新进程窗口**;库读取失败或控件初始化失败 → 消息框 `library.title` + `library.unavailable「无法打开晶体库。请检查程序旁的 library 文件夹是否完整。/ Cannot open the crystal library. Check the library folder beside the executable.」`。
- 12 条内置结构(显示名/化学式)见 [ui-tokens.json](ui-tokens.json) `library` 字段,摘要:
  岩盐（氯化钠）/Halite NaCl;萤石/Fluorite CaF₂;钙钛矿/Perovskite CaTiO₃;硫铂矿/Cooperite PtS;金红石/Rutile TiO₂;板钛矿/Brookite TiO₂;锐钛矿/Anatase TiO₂;闪锌矿/Sphalerite ZnS;纤锌矿（2H）/Wurtzite (2H) ZnS;金刚石/Diamond C;α-石英/α-Quartz SiO₂;方解石/Calcite CaCO₃。

### 10.3 超胞设置(`CmdSupercell`)

| 项 | 内容 |
|---|---|
| 标题 | `dialog.supercell.title「超胞设置 / Supercell」` |
| 副标题 | `dialog.supercell.subtitle「沿 a、b、c 方向重复晶胞的次数（1–16）/ Repeat the unit cell along a, b, c (1–16)」` |
| 字段 | `dialog.supercell.a「a 方向 / a repeats」` hint `×`,值 = 当前 supercellX;b、c 同构 |
| 校验 | ① 数字可解析;② 整数;③ `1 ≤ n ≤ 16`;否则 `dialog.supercell.error.invalid「超胞倍率必须是 1–16 的整数 / Supercell repeats must be integers from 1 to 16」`;④ 预算:`copies==1` 或 `atoms×copies ≤ 65,536` 且 `bonds×copies ≤ 300,000`,否则 `dialog.supercell.error.budget「请减小倍率，超胞内部最多 65,536 个位点、300,000 条周期键。」`;⑤ 无晶胞时 `toast.no-cell-for-edit「当前结构没有晶胞参数，无法编辑晶胞」` |
| 打开前置 | 已载入且晶胞有效;否则 toast(标题 `dialog.supercell.title`,正文 `toast.no-cell-for-edit`,Info) |
| 确定 | 写入 supercell X/Y/Z → 应用渲染选项并**立即保存设置**(不重载结构) |
| 取消 | 关闭,无副作用 |

### 10.4 外观设置(AppearanceWindow,非模态)

- 尺寸 438×568,圆角 14,渐变 `#0E141E→#080C13`,描边 `#2E3C52`;定位:主窗**右上角内侧**(右 28、顶 +96),并钳制到工作区。
- 标题 17 Bold @(22,16):`dialog.appearance.title「外观设置 / Appearance」`;副标题 9.5 `#6C798F` @(24,44):`dialog.appearance.subtitle「设置晶胞边框、背景与配位多面体 / Cell frame, background and coordination polyhedra」`;右上 `×` 18dp `#6C798F`(热区 22×22 @右上 18)。
- **HSV 色轮**:208×208 @(22,104);hue=角度,sat=半径/半径,val 由右侧明度条控制;色轮外圈 1.2dp `#364557`;标记点 5dp 实心当前色 + 1.4dp 白边,位置 `(cx+cos(h)*sat*(R-7), cy+sin(h)*sat*(R-7))`。
- **明度条**:18×208 @色轮右 14;渐变 = 当前 hue/sat 的纯色(上)→ 黑(下);1dp `#37465E` 描边、圆角 7;游标为横向白线 2dp(左右各出 3dp)。
- **色块(3 个目标,纵向堆叠,高 46,圆角 9)**:`dialog.appearance.cell-color「晶胞边框颜色 / Cell frame colour」`(默认 `#D6DEE9`)、`dialog.appearance.background-color「背景颜色 / Background colour」`(默认 `#020305`)、`dialog.appearance.poly-edge-color「多面体描边 / Polyhedron outline」`(默认 `#91B4D3`);激活色块描边 `#85ABFF` 2dp、标签同色;未激活描边 `#3A4A62` 1dp、标签 `#6C798F`;点击色块切换"当前编辑目标",色轮/明度条随之更新。
- **3 个滑杆**(轨道高 8,圆角 4,底 `#18202F`,填充 `#6392FF`,手柄 12dp 白圆;标签 9.5 左、数值 9.5 等宽右):
  1. `dialog.appearance.cell-width「边框粗细 / Frame width」`:0.5–4.0,值 `%.2f`
  2. `dialog.appearance.poly-transparency「多面体面透明度 / Face transparency」`:0–100,值 `%d%%`
  3. `dialog.appearance.poly-edge-width「多面体描边宽度（0 关闭）/ Outline width (0 = off)」`:0–4.0(步进 0.1),值 `%.1f px`
  - 第 4 行文字 `dialog.appearance.brightness「明度 / Brightness」` + 当前色 `#RRGGBB`(等宽)。
  - v0.7 截图里还有 `dialog.appearance.live-hint「拖动色轮或滑杆时，视口会实时预览 / Drag the wheel or sliders for a live preview」`;v1.1 代码保留字符串但**未绘制**(可在安卓端可选保留)。
- 按钮:`dialog.appearance.reset「恢复默认 / Reset defaults」`(左,142×42,圆角 9,底 `#181F2D`,描边 `#36445B`,文字 `#9EAABE`)与 `dialog.ok「确定 / OK」`(右,142×42,主按钮)。
- **实时预览**:任何拖动(色轮/明度/滑杆/色块切换/滚轮 ±0.05 明度)立即回调主窗 → `viewport.SetAppearance()`;点色轮时若当前明度 < 0.08 自动提到 0.42。
- **关闭保存**:`×`/`确定`/`Esc`/`WM_CLOSE` → `Close()` → 主窗回调 `SaveSettingsNow()`(写设置文件);`恢复默认` 立即把 6 个外观字段重置为默认值并推送预览(仍需关闭才持久化)。
- 打开入口:视图菜单 `view.appearance`、左面板外观区 `panel.appearance.settings`。

### 10.5 编辑晶胞参数(`CmdEditCell`)

| 项 | 内容 |
|---|---|
| 标题 | `dialog.edit-cell.title「编辑晶胞参数 / Edit unit-cell parameters」` |
| 副标题 | `dialog.edit-cell.subtitle「应用后将重新展开对称原子并重建化学键。/ Applying the change re-expands symmetry copies and rebuilds bonds.」` |
| 字段(6) | `a` `b` `c`(hint `Å`,初值 `%.6f`)、`α` `β` `γ`(hint `°`,初值 `%.4f`) |
| 数字校验 | 任一项不可解析 → `dialog.error.invalid-number「请输入有效数字 / Enter valid numbers」` |
| 几何校验 | `Cell::SetFromParameters`:三边 >0 且有限、角度 ∈ (0°,180°)、角度组合不退化、能构成有效晶胞、体积非零;失败 → `dialog.edit-cell.error.invalid「晶胞参数无效，请检查长度和角度 / Invalid cell parameters; check lengths and angles」` |
| 确定 | 推入撤销快照 → 替换结构(重新展开对称原子、重建键)→ 保持相机 → 状态 `status.structure-updated「结构已更新」` → 标记已修改 |
| 前置 | 无结构 → toast(Info)`toast.no-structure`;无晶胞 → toast(标题 `dialog.edit-cell.title`,正文 `toast.no-cell-for-edit`,Info) |
| 取消/×/Esc | 关闭,无修改 |

### 10.6 添加原子(`CmdAddAtom`) / 编辑原子(`CmdEditAtom`)

| 项 | 添加原子 | 编辑原子 |
|---|---|---|
| 标题 | `dialog.add-atom.title「添加原子 / Add atom」` | `dialog.edit-atom.title「编辑原子 / Edit atom」` |
| 副标题(有晶胞) | 花括号模式 `dialog.atom.subtitle-fractional「输入元素、标签、占位率与分数坐标；新原子会按对称操作展开。」` | `dialog.edit-atom.subtitle-fractional「修改不对称单元中该位点的元素、标签、占位率与分数坐标。」` |
| 副标题(无晶胞/笛卡尔) | `dialog.atom.subtitle-cartesian「输入元素、标签、占位率与笛卡尔坐标（Å）。」` | `dialog.edit-atom.subtitle-cartesian「修改该原子的元素、标签、占位率与笛卡尔坐标（Å）。」` |
| 追加提示 | — | 若选中原子为对称生成:`+ "  " + dialog.edit-atom.symmetry-note「该原子由对称操作生成；修改会同时作用于全部等价原子。」` |
| 字段 1 | `dialog.atom.element「元素 / Element」`,hint `符号 / Z`,默认 `C` | 默认 = 该位点元素符号 |
| 字段 2 | `dialog.atom.label「标签 / Label」`,hint `可选`,默认空 | 默认 = `baseLabel` 或 `label` |
| 字段 3 | `dialog.atom.occupancy「占位率 / Occupancy」`,hint `0 – 1`,默认 `1.00` | 默认 `%.2f` |
| 字段 4-6 | `x`/`y`/`z`:hint 分数/Å,默认分数 `0.5,0.5,0.5`(cartesian 模式 = 结构中心),`%.5f` | 默认取该位点分数/笛卡尔坐标 |
| 元素校验 | `ElementFromInput`:支持元素符号或原子序数(1–118);失败 → `dialog.atom.error.invalid-element「未知元素，请输入元素符号或原子序数 / Unknown element; enter a symbol or atomic number」` | 同 |
| 占位率校验 | 必须 `0 < occ ≤ 1`,否则 `dialog.atom.error.invalid-occupancy「占位率必须在 0 与 1 之间（不含 0）/ Occupancy must be in (0, 1]」` | 同 |
| 坐标校验 | 不可解析 → `dialog.error.invalid-number`;核心层另有"分数/笛卡尔坐标必须是有效数字" | 同 |
| 提交 | 加入不对称单元 → 按对称操作重新展开 → 选中新原子(映射到展示原子)→ `status.structure-updated` | 更新该不对称单元位点 → 全部对称等价原子同步 → 状态同上 |
| 前置 | 未载入 → toast `toast.no-structure` | 未载入 → 同上;无选中位点 → toast(标题 `dialog.edit-atom.title`,正文 `toast.select-atom-first「请先在三维视图中选择一个原子」`) |

### 10.7 删除原子(`CmdDeleteAtom`)

- **无确认对话框**,立即执行:必须已选中(`toast.select-atom-first`);核心层保护"结构中至少需要保留一个原子"(失败 → toast 标题 `edit.delete-atom`,正文核心错误,Error);成功 → 状态 `status.atom-deleted「已删除原子」`,清空选择,推入撤销。

### 10.8 帮助 / 关于(HelpWindow)

- 760×600(超出工作区按比例缩放),圆角 15,模态式(打开时禁用主窗);`Esc`、`F1`、`×`、`WM_CLOSE` 关闭。
- 结构:左侧品牌区(logo 46、App 名 21 Bold、`dialog.about.version「版本 1.1   ·   原生 C++ / OpenGL 3.3」` 9.5)、tagline 12 Teal、描述段落 10.5、4 条特性(✓ 圆标 16dp 底 `#1B2B3E` + 勾 Teal)、右侧「快捷键」表(14 行 key chip 68×21 最小宽 + 描述);底部分隔线上一行:`dialog.about.footnote「© 2026 CrystalLens Project · 供科研与教学使用」`(9 `#677489`)+ 右侧 `dialog.about.build「构建于 %s」`(`__DATE__`,9 `#525E71`)。
- 全文内容见 [help.md](help.md)。

### 10.9 未保存更改确认

- 原生 MessageBox:标题 `dialog.unsaved.title「未保存的修改 / Unsaved changes」`,正文 `dialog.unsaved.message「当前结构有未保存的修改。继续将丢失这些修改，是否继续？/ The structure has unsaved changes. Continue and discard them?」`,`是/否 + 警告图标`,**默认按钮 = 否**(防误触)。
- 触发点:① 重新载入(`CmdReload`);② 关闭窗口 / 退出(`WM_CLOSE`)。(打开新文件不受影响,因为已载入时一律开新窗口。)
- "已修改"判定:任何编辑提交后置位;保存成功后(重载保存结果)清除;标题追加 ` *`。

### 10.10 其它系统弹窗

- 晶体库不可用:见 §10.2。
- 启动期失败:`无法创建 CrystalLens 主窗口。`(硬编码中文,非 i18n 表)与 `无法初始化 GDI+ 图形库。`;Web 版无对应,可忽略或用 `error.renderer.*`。
- 粘贴板失败:`toast.open-failed-title` + `Clipboard is unavailable`(硬编码英文)。

---

## 11. 交互状态机

### 11.1 模式

```
MeasureMode = None | Distance | Angle
状态: mode, pendingPicks[] (已被点选但未成测量的原子索引)
```

| 动作 | 从 | 结果 |
|---|---|---|
| D / `measure.distance` / 工具栏 / 右栏按钮 | None 或 Angle | → Distance,pending 清空 |
| 同上（目标 == 当前模式） | Distance | → None（取消测量） |
| A / `measure.angle` | None 或 Distance | → Angle,pending 清空 |
| Esc | Distance/Angle | → None,pending 清空 |
| 切换语言/打开对话框 | 任意 | 模式与 pending **保留** |
| 载入新结构 | 任意 | 测量与 pending 清空；模式保留（沿用全局模式，实测 `SetStructure` 后仍按当前 mode 拾取） |

- 每次模式变化都会通知宿主(右栏刷新横幅/勾选)。
- 测量模式下游标 = 十字(`IDC_CROSS`)。

### 11.2 选择 / 悬停

- 点击原子:选中(右栏显示原子卡,3D 高亮);点击空白:取消选中。
- 测量模式下点击原子:选中 + 加入 pending(重复点同一原子被忽略;不切换选择)。
- 悬停原子:光标 hand,3D 高亮,状态栏显示 `status.hover`;移出:清除。
- 选择/高亮数据流:Viewport → host(`OnViewportSelectionChanged` / `OnViewportHoverChanged` / `OnViewportMeasurementsChanged` / `OnViewportModeChanged`)。

### 11.3 相机操作(视口)

| 操作 | 行为 | 参数 |
|---|---|---|
| 左键拖拽 | 旋转(带惯性) | 灵敏度 `0.0072 rad/dp`;yaw 反向,`pitch += dy*0.0072` 并夹在 ±85°;拖拽中缓动系数 26,松手后按速度惯性衰减 `exp(-6dt)`,缓动 18;速度上限 ±4 rad/s |
| 单击(未移动) | 拾取原子 | 位移阈值 `3dp`;`abs(dx)+abs(dy) > 3*dpi` 视为拖拽 |
| 滚轮 | 缩放 | `distance *= exp(-steps*0.16)`,每档 120;夹在 `sceneRadius*0.035 … sceneRadius*40+100` |
| 中键 / 右键拖拽 | 平移(pan) | 按像素换算世界单位 |
| 方向键 | 旋转 ±8° | ←/→ 改变 yaw,↑/↓ 改变 pitch |
| `+` / `-` | 缩放 1 档 | |
| F / Home | 适应窗口 / 重置视图 | 重置会清 `userAdjustedCamera`;适应使用渲染器可见点,边距 1.18 |
| 双击 | **无行为**(不注册) | |
| 右键单击 | **无右键菜单**(`WM_CONTEXTMENU` 返回 0,右键只用于平移) | |

- 相机被用户操作后,窗口 resize 不再自动 fit(仅未手动调整时自动 fit)。

### 11.4 键盘快捷键全表

全局加速键(`CreateAcceleratorTable`,主窗含视口):

| 快捷键 | 命令 |
|---|---|
| Ctrl+O | 打开结构文件 |
| Ctrl+L | 经典晶体库 |
| Ctrl+R | 重新载入 |
| Ctrl+S | 保存结构 |
| Ctrl+Shift+S | 保存截图 |
| Ctrl+C | 复制结构摘要 |
| Ctrl+Z | 撤销 |
| Ctrl+Y | 重做 |
| Ctrl+E | 编辑晶胞 |
| Ctrl+Shift+A | 添加原子 |
| F2 | 编辑选中原子 |
| Delete | 删除选中原子 |
| F1 | 帮助 |

主窗 `WM_KEYDOWN`(无 Ctrl 时):F1 帮助、Esc(帮助可见→关帮助;否则测量中→退出测量)、F 适应、Home 重置、D 距离、A 角度、C 晶胞、B 键、L 标签、P 切换投影。
视口 `WM_KEYDOWN`(有焦点且无 Ctrl):Esc(退出测量→否则取消选中)、F、Home、D、A、C、B、L、P、F1、F2、Delete、←→↑↓ 旋转 8°、+/− 缩放。
对话框:表单 Enter 提交/Esc 取消/Tab 循环;菜单弹层 ↑↓/Enter/Space/Esc;帮助 Esc/F1;外观 Esc。

> 安卓映射建议:D/A/C/B/L/P/F/Home 可保留为外接键盘快捷键,触屏用按钮;Ctrl 系列用长按/菜单替代;Esc 行为映射为"返回键"(优先关弹层 → 退出测量 → 取消选中 → 再返回退出)。

### 11.5 拖放文件

- 主窗与视口都接受 `WM_DROPFILES`(视口转发给父窗)。
- 对每个文件调用 `OpenDocument`:未载入 → 就地载入;已载入 → **新进程窗口**打开。多个文件 = 多个窗口。
- 安卓/WebView 无拖放:改为"打开文件"选择器,行为一致(已载入时用新会话/新页签)。

### 11.6 多窗口行为

- v1.1 采用**每文档一进程**:每个窗口独立 GL 上下文、撤销历史、测量、选中态;通过命令行参数传入文件路径。
- 设置共享同一 `%APPDATA%\CrystalLens\settings.ini`:用命名互斥体 `Local\CrystalLens.Settings` 保护;**只写"本窗口改过的键"**(`store(key, before, after)`),避免互相覆盖;首次迁移(`SettingsVersion<4`)会重置 atomScale=0.30、showImages=true 并写版本 4。
- 无多文档页签;无 Win+方向键特殊处理(交给系统贴靠)。
- **安卓建议**:单进程 + 多 `DocumentSession`(每 session 独立 structure/undo/measurements/camera/options 快照),用"最近文件/多窗口"入口切换;设置改为单写者 `localStorage` 全局。

### 11.7 模态与命令屏蔽

- 帮助窗或表单窗可见时,主窗命令(**除 CmdHelp**)全部忽略(`ExecuteCommand` 早退);表单/帮助会禁用主窗。
- 菜单弹层打开时点击其他区域会先关闭弹层(弹层持有 capture)。

---

## 12. 测量功能

1. 入口:工具栏两个按钮、右栏两个按钮、视图→测量菜单(D/A)。进入后右栏显示提示行、视口显示测量横幅和底部提示,光标十字。
2. 拾取流:
   - 距离:点击原子 1 → `已选 1 / 2` → 点击原子 2 → 计算并生成测量;
   - 角度:三个原子,顶点是**第二个**点击的原子(B),夹角 A–B–C。
   - 每次拾取立即刷新 3D 高亮与连线(pending 段用金色 0.030 半径)。
   - 重复点击已选原子忽略。
   - 完成后:pending 清空、**模式保持**(可连续测量)、Flash 显示结果 2.4s。
   - 距离 `value ≤ 0` 或角度无法计算时:不生成测量,pending 清空。
3. 3D 呈现:距离 = 两原子间一条金线(世界半径 0.028);角度 = 顶点到 A、顶点到 C 两条青线(不画弧);线为屏幕空间细分带状渲染,始终可见(深度测试策略由渲染器决定,实现建议:测量线最后绘制、`depthTest=false` 以免被球挡住)。
4. 显示格式:
   - 距离 `%.3f Å`(如 `2.401 Å`)、角度 `%.2f°`(如 `104.47°`);
   - 表达式 `标签–标签`(端破折号 `–` U+2013),标签为空时用 `元素符号+序号`;
   - 画布标签与右栏卡片同值;画布标签最多 24 条、自动上移避让。
5. 周期镜像:测量时自动选最近镜像(`offsetA/offsetB/offsetC`),画线与标签位置都按镜像偏移计算;右栏不额外标注镜像信息。
6. 清除:`panel.measurements.clear-all` 链接 / 工具栏垃圾桶 / 菜单项 → 清空全部测量与 pending;单条:卡片右上 ×;两者都会同步 3D 标注。
7. 测量的生命周期:载入新结构时清空;编辑结构时保留(测量对象为原子索引,编辑后由渲染刷新;实现建议在编辑后按"位点+镜像"重映射或直接清空并提示)。撤销/重做不恢复测量历史。

---

## 13. 编辑流程

- **修改晶胞**:`SetCellParameters` → 重新用对称操作展开全部原子(原子按分数坐标在新晶胞下重新计算笛卡尔坐标)→ 重建化学键 → 保持相机 → 更新左栏摘要/化学式/体积 → 状态 `结构已更新` → 脏标记 + 撤销快照。
- **加/改/删原子**:作用于**不对称单元**(`asymmetricAtoms[siteIndex]`),然后整体重新展开,使**全部对称等价原子一起更新**;UI 选中新原子(加/改)或清空选择(删)。
- **撤销/重做**:结构级完整快照(`std::vector<Structure>`),最多 **50** 步;任何新编辑清空 redo 栈;撤销/重做后选择被清除、相机保持(状态 `已撤销`/`已重做`)。
- **脏标记**:编辑成功后 `modified=true`(标题 ` *`);保存流程会重新载入导出的文件并清标记;载入新结构清空 undo/redo 与标记。
- **保存后重载**:保存 CIF/XYZ 成功后调用 `OpenPath(保存路径)` —— 即用磁盘文件重新解析并替换当前文档(当前路径变为新路径),随后清除脏标记。
- **未保存提示时机**:仅"重新载入"和"关闭窗口"。

---

## 14. 保存 / 导出 / 截图 / 复制

| 功能 | 规格 |
|---|---|
| **保存结构** | 另存对话框;标题 `dialog.save.title「保存结构 / Save structure」`;建议名 = `<原文件名>-edited.cif`(无当前文件则 `CrystalLens-edited.cif`);过滤:晶胞有效时先给 `dialog.open.filter.cif「CIF 晶体文件 (*.cif;*.mcif)」` 再 `dialog.open.filter.xyz「XYZ 分子文件 (*.xyz)」`,否则仅 XYZ;默认扩展名随过滤项;扩展名 `.xyz` → XYZ、`.cif/.mcif` → CIF,其它按当前过滤项补扩展名;覆盖提示;成功后重载、清脏、toast `toast.save.saved-title「结构已保存」` + `toast.save.saved「已保存到 %s」`、状态栏同文本 |
| **CIF 无晶胞** | toast `toast.save.failed「保存结构失败」` + `toast.no-cell-for-cif「CIF 导出需要晶胞参数；请改用 XYZ 格式」`(Error) |
| **导出失败** | toast `保存结构失败` + 核心错误文本(如 `无法创建文件：<path>`、`写入文件失败：<path>`) |
| **截图** | 保存目录按优先序回退:`图片库/CrystalLens` → `%LOCALAPPDATA%/CrystalLens/Screenshots` → `%TEMP%/CrystalLens Screenshots` → `<cwd>/CrystalLens Screenshots`;全部失败 → toast `toast.screenshot.failed「截图保存失败」` + 目录/错误;文件名 `CrystalLens-YYYYMMDD-HHMMSS.png`;内容 = 视口当前帧(GL ReadPixels → PNG,含 HUD?**仅 3D 帧 + 叠加 HUD 由 overlay 绘制在同一帧 → 含 HUD**);成功 → toast `toast.screenshot.saved-title「截图已保存」` + `toast.screenshot.saved「截图已保存到 %s」`、状态栏同文本 |
| **复制摘要** | 写入系统剪贴板(纯文本),成功 toast `toast.copied-summary「结构摘要已复制到剪贴板 / Structure summary copied to clipboard」`;格式见 §15.4 |
| **状态栏反馈** | 见 §7;toast 与状态栏常成对出现 |

---

## 15. 设置(settings.ini → 安卓 localStorage)

### 15.1 键名 / 默认值(v1.1,节 `[CrystalLens]`)

| ini 键 | 类型 | 默认 | 含义 |
|---|---|---|---|
| Language | int | 0 | 0=中文 1=English |
| LeftPanel | bool | 1 | 左面板可见 |
| RightPanel | bool | 1 | 右面板可见 |
| ShowCell | bool | 1 | 显示晶胞边框 |
| ShowBonds | bool | 1 | 显示化学键 |
| ShowLabels | bool | 0 | 显示原子标签 |
| ShowImages | bool | 1 | 显示边界原子 |
| ShowAxes | bool | 1 | 显示坐标轴 |
| Orthographic | bool | 0 | 正交投影(0=透视) |
| AtomStyle | int | 0 | 0=球棍 1=空间填充 2=多面体(读时 clamp 0..2) |
| AtomScale | float | 0.30 | 原子尺寸 0.15–0.85(越界回默认) |
| SupercellX/Y/Z | int | 1 | 1–16 |
| CellColor | int(RGB) | 0xD6DEE9 | 晶胞边框色 |
| BackgroundColor | int | 0x020305 | 视口背景色 |
| CellWidth | float | 1.0 | 边框粗细 0.5–4.0 |
| PolyTransparency | int | 66 | 多面体面透明度 0–100 |
| PolyEdgeTenths | int | 12 | 描边宽度×10(0–40 ⇒ 0–4.0) |
| PolyEdgeColor | int | 0x91B4D3 | 多面体描边色 |
| SettingsVersion | int | 4 | 迁移版本 |

- 读取:文件不存在 → 全默认;`SettingsVersion < 4` 的旧配置一次性把 `AtomScale=0.30`、`ShowImages=true`。
- 保存时机:`设置/开关/样式/投影/侧栏/语言`改动后立即保存;外观窗口关闭时保存;滑杆拖动结束(`WM_LBUTTONUP`)保存;退出窗口时再保存一次(只写变更键)。
- 语言切换**持久化**为 Language 并立即刷新全部 UI 文案 + 标题 + 状态栏(测量/选中状态保留;测量数据结构不含文案)。

### 15.2 安卓端 localStorage 键名建议

统一前缀 `crystallens.`(单 JSON 块 `crystallens.settings` 更方便原子写入):

```
crystallens.settings            // 单个 JSON,字段同 §15.1 (camelCase)
crystallens.language            // "zh" | "en"
crystallens.leftPanel           // boolean
crystallens.rightPanel
crystallens.showCell
crystallens.showBonds
crystallens.showLabels
crystallens.showImages
crystallens.showAxes
crystallens.orthographic
crystallens.atomStyle           // 0|1|2
crystallens.atomScale           // number 0.15–0.85
crystallens.supercell           // {x,y,z}
crystallens.appearance          // {cellColor:"#D6DEE9", backgroundColor:"#020305", cellLineWidth:1, polyTransparency:66, polyEdgeWidth:1.2, polyEdgeColor:"#91B4D3"}
crystallens.settingsVersion     // 4
crystallens.recentFiles         // string[]（安卓新增）
crystallens.lastDocument        // {path, camera:{yaw,pitch,distance,target}, options}（安卓新增，可选）
```

- 事件:同一 WebView 内用内存单例 + `storage` 事件(如多 WebView)同步;语言切换后重渲染 DOM 文案(建议用 i18n.json 键驱动 `data-i18n` 属性)。

---

## 16. 数值 / 文本格式化(Format.cpp)

> 代码中**没有** `FormatDouble`;统一的数值格式化入口是 `FormatNumber(double value, int decimals)`(`Format.cpp`),实现为 `printf("%.*f")`。下表即其全部调用点的精度规则。

| 场景 | 规则 | 示例 |
|---|---|---|
| `FormatNumber(v, d)` | `printf("%.*f")`,四舍五入,无千分位 | `FormatNumber(8.8666,4)` = `8.8666` |
| 晶胞长度(左栏/摘要行) | 4 位小数 + ` Å` | `a 8.8666  b 8.8666  c 8.8666 Å` |
| 晶胞角度(左栏) | 2 位 + `°` | `α 90.00°   β 90.00°   γ 90.00°` |
| 体积(左栏) | 2 位 + ` Å³` | `体积  697.06 Å³` |
| 晶胞对话框长度/角度 | 6 / 4 位(便于编辑) | `4.913400`、`90.0000` |
| 分数坐标 | 4 位 | `x 0.4139   y 0.2674   z 0.2144` |
| 笛卡尔坐标 | 3 位 | `x 1.234   y 2.345   z 0.567` |
| 原子对话框坐标 | 5 位 | `0.41390` |
| 占位率 / Uiso | 2 / 4 位 | `1.00`、`0.0123` |
| 距离 / 角度 | 3 位 + ` Å` / 2 位 + `°` | `2.401 Å`、`104.47°` |
| 原子尺寸 | 百分比整数 | `30%` |
| 左栏化学式 | `structure.formula`,空则 `cellContents`,再空则 `—` | `Na8 Al6 Si6 Cl2 O24` |
| 左栏晶胞内容 | `cellContents` | `O24 Na8 Al6 Si6 Cl2`(空间群/对称操作/不对称单元/晶胞内容 4 行) |
| 晶胞内容摘要 | 摘要文本中用空格分隔的化学式 | — |
| 元素 chip | `符号 + 空格 + 数量` | `O 24` |
| 关键常量 | `kMaxCellRepeats=16`;`kMaxDisplayAtoms=30000`;`kMaxBonds=150000`;超胞预算 65536/300000;撤销 50 | |

### 16.1 结构摘要文本(复制到剪贴板,`BuildStructureSummary`)

纯文本,ASCII 标签(**不随语言切换**,固定英文),逐行:

```
CrystalLens v1.1
<title>
Format: <CIF|XYZ|VESTA|未知>
Formula: <化学式或晶胞内容或 —>
Space group: <空间群>              // 仅在存在时
Cell: a=%.5f, b=%.5f, c=%.5f, alpha=%.3f, beta=%.3f, gamma=%.3f   // 仅晶胞有效
Volume: %.3f A^3                    // 仅晶胞有效
Atoms: <n>, bonds: <m>
Measurements:                       // 仅当有测量
  1. <表达式>  <数值>               // 例: 1. O1–O2  2.401 Å
Source: <原始文件绝对路径>           // 仅当有来源
```

---

## 17. 安卓 / WebView 适配规格(触屏布局)

> 目标:同一套视觉语言与文案,布局从"三栏常驻"改为"抽屉 + 弹层"。

### 17.1 断点与容器

| 宽度 | 布局 |
|---|---|
| ≥ 900dp(平板横屏) | 完全复刻桌面:顶栏 56、左面板 262、右面板 296 常驻 |
| 600–899dp | 左面板变抽屉(262),右面板变右侧抽屉(296);顶栏合并菜单栏+工具栏为 56 高 AppBar + 溢出菜单 |
| < 600dp(手机) | 视口全屏;顶部紧凑栏(标题+菜单溢出);底部工具条(打开/测量/显示/更多);左右面板改为**底部 sheet**(圆角 16,最大高 70vh,拖拽把手) |

### 17.2 区域映射

- **菜单栏**:菜单项(文件/编辑/视图/测量/帮助)进入 `⋮` 溢出菜单,用同一 `MenuEntry` 数据(含勾选、禁用);语言切换与帮助按钮保留为图标。AppBar 高 56 = 旧 38 + 视觉呼吸,logo 24、App 名 13.5 Bold、版本 chip 保留。
- **工具栏**:分组与顺序不变;图标按钮命中区 ≥ 44;带文字的距离/角度按钮在手机上改为图标(图标+长按提示),激活色仍 Gold/Cyan。
- **左面板**:抽屉内按原顺序渲染:结构信息(标题/化学式/徽章)、晶胞参数(+编辑/超胞链接)、信息 4 行、显示开关(2 列)、外观(段选+滑杆)、元素 chip。滑杆改为触摸友好:轨道高 8、手柄 20(视觉 12)、`touch-action: none`。
- **右面板**:底部 sheet:选中原子卡、测量模式按钮、测量列表;每张测量卡右侧 × 加大到 36 热区。
- **状态栏**:手机改为视口底部浮条(半透明 `#080C12 @70%`),只显示状态文本;渲染器信息移到"关于"。
- **视口 HUD**:标题条与元素图例在窄屏压缩(标题后缀仅格式;图例最多 4 行/可折叠);底部操作提示在触屏改为手势提示:`单指旋转 · 双指缩放 · 双指拖动平移`(文案需新增 i18n 键,建议 `viewport.hint.touch`);gizmo 保持右下 86。
- **对话框**:表单(超胞/晶胞/原子)改为 **底部 sheet 或全屏对话框**:标题 18、副标题 9.4、字段纵向堆叠(标签在上、输入框高 48、hint 在输入框内右侧或下方),按钮区固定底部(主按钮全宽 + 取消次按钮),`Enter=提交`映射为键盘"完成",`Esc`→系统返回键;错误行红色 9.4 保持在按钮上方。外观设置面板改为全屏 sheet,色轮 240、明度条竖放、3 个滑杆。
- **帮助/关于**:全屏滚动页,双列改为单列(品牌区 → 特性 → 快捷键表 → 脚注)。
- **Toast**:贴底悬浮(距安全区 16),宽 ≤ 屏宽-32,4.6s;点击可关。
- **Tooltip**:触屏无 hover → 删除 tooltip;改由长按显示等价文案(可复用 tip.* 键)。
- **交互**:`Esc` = 返回键(关弹层 → 退出测量 → 取消选中);`Ctrl+*` 快捷键仅外接键盘;右键菜单无;拖放改文件选择器;多窗口改"多文档会话 + 最近文件"。

### 17.3 渲染与 HUD 技术要点

- WebGL2 与 HUD 叠加建议同一 canvas 双层(`#gl` + `#hud` 2D canvas),或 HUD 用 DOM(推荐:文字清晰、可选中、易本地化);测量标签/原子标签用绝对定位 DOM 或 canvas 都是可行方案,碰撞避让需按 §8.1 规则实现。
- 相机:`yaw/pitch/distance/target`,与桌面参数一致(灵敏度 0.0072、缩放 exp(-steps*0.16)、pitch ±85°、fit 边距 1.18),便于复用测试用例。
- 高 DPI:`devicePixelRatio` 缩放 canvas 备份缓冲;HUD 用 CSS px(dp)。
- 性能:元素图例 ≤ 8、标签 ≤ 90、测量 ≤ 24、chip ≤ 14 的绘制上限要保留(移动端可再降:标签 40、测量 12)。

---

## 18. 附录

### 18.1 i18n 覆盖情况

- i18n.json 共 **251** 条 = `Localization.h` 全量,含菜单、按钮、字段、校验错误、toast、tooltip、帮助、图例、状态栏(含 `%s/%d` 占位符)。
- 其中 **219** 条在 v1.1 UI 实际渲染;**32 条已声明但未使用**(实现时可用于安卓新增场景,勿删):
  `status.modified`(`已修改 · Ctrl+S 保存结构`,被标题 ` *` 取代)、`tip.save`、`tip.edit-cell`、`tip.add-atom`、`tip.edit-atom`、`tip.delete-atom`、`tip.undo`、`tip.redo`、`common.formula`、`common.source`、`common.format`、`common.data-block`、`dialog.appearance.live-hint`、`dialog.appearance.error.color`、`dialog.appearance.error.width`、`tip.boundary`、`panel.appearance.style`、`panel.selection.uiso`、`viewport.hud.atoms-bonds`、`status.renderer-info`、`dialog.about.title`、`help.shortcut.panels`、`dialog.about.close`、`tip.cancel-measure`、`status.measure`、`common.untitled`、`clipboard.atom-line`、`tooltip.panel-left`、`tooltip.panel-right`、`panel.info.no-bonds`、`panel.info.truncated`、`dialog.search.placeholder`。
- 占位符仅两种:`%s`(字符串)、`%d`(整数);`measurement.selected-count` 有两个 `%d`(已选/需要)。安卓实现禁止用 `String.format` 之外的方式替换,且中英文参数顺序不同处需注意(`toast.save.saved` 中英都是单参数)。
- 硬编码但未入表的用户可见文案(如需全量本地化需补键):启动失败 `无法创建 CrystalLens 主窗口。`、`无法初始化 GDI+ 图形库。`、剪贴板失败 `Clipboard is unavailable`、核心层解析/导出错误(如 `晶胞参数必须是正数`、`必须包含 x,y,z 三个分量`、`原子序数必须在 1 与 118 之间`、`未知元素：X`、`结构中至少需要保留一个原子`、`CIF 导出需要晶胞参数，请改用 XYZ 格式`、`无法创建文件：<path>`、`写入文件失败：<path>`)、截图内部错误 `渲染器尚未就绪` / `视图尺寸无效` / `未找到 PNG 编码器` / `无法写入图片文件`。

### 18.2 与旧截图(v0.7.0)的差异(避免按截图实现错)

1. 旧截图为 3 栏 + 顶部菜单栏;v1.1 结构相同,但工具栏右端新增左右面板开合按钮,外观设置窗口新增"多面体描边色/透明度/描边宽度"三项。
2. 旧截图左面板底部只到"原子尺寸";v1.1 增加"元素" chip 区。
3. 旧截图无测量横幅与底部边界图例;v1.1 在测量模式/存在周期键时显示。
4. 旧截图标题栏显示 `v0.7` 版本 chip,内容为 `v1.1`。
5. 旧外观窗口副标题为 `自定义晶胞边框与视口背景`;v1.1 为 `设置晶胞边框、背景与配位多面体`(以 i18n.json 为准)。

### 18.3 风险与待确认

- **测量/编辑交互的移动端替换**需求方未指定;本规格按"桌面语义等价"给出建议映射(§17.2)。
- 视口截图是否包含 HUD:代码在 `RenderFrame(false)` 中绘制 overlay 后再 `glReadPixels`,因此**包含 HUD**;但 overlay 的 2D 绘制是否在同一 GL 帧需在 WebGL 端复核(若 HUD 用独立 canvas,截图需手动合成)。
- 撤销/重做不恢复测量与相机;若安卓要实现"完整撤销",需扩展快照内容。
- 编辑后既有测量未做重映射(代码直接复用旧测量对象),编辑晶胞/原子后测量值可能滞后;建议安卓端在编辑提交后清空测量或按位点重算。
- `Localization` 中 `%` 与 `×`、`·`、`—`、`–`、`°`、`Å` 等字符需保证 UTF-8/字体覆盖(Android 默认字体可用,WebView 注意字体子集)。
