# CrystalLens 资源规格：晶体库 / 示例 / 图标 / 内嵌策略

> 状态：实现级规格，供 **Android WebView APK**、**免安装单文件 HTML** 与 **QA** 使用。
> 版本基线：CrystalLens **v1.1.0**（C++17 + Win32 + OpenGL 3.3 便携版）。
> 权威源码（只读，禁止修改）：`../`；便携包：`../`（其 `library/`、`examples/`、`docs/` 与源码树逐字节相同，已核对）。
> 配套文件：机器可读数据 `docs/spec/library.json`、QA 校验清单 `docs/spec/assets-cases.md`。
> 本文只定义资源口径；窗口布局、交互细节以 UI 规格为准，此处仅给出资源侧的呈现约束。

---

## 0. 结论摘要（TL;DR）

| 项 | 数量 | 体积 | 处理方式 |
|---|---:|---:|---|
| 晶体库 CIF | 12 | 39,323 B | **原样内嵌**，不重新生成、不精简、不改文件名 |
| `library/index.tsv` | 1 | 735 B | 原样内嵌（库列表数据源） |
| `library/SOURCES.md` | 1 | 4,935 B | 原样内嵌（许可/署名，必须可达） |
| 示例文件 | 6 | 3,739 B | 原样内嵌 |
| `logo.png` 母版 | 1 | 70,639 B | 仅作图标母版/Web 展示；单文件版建议改用内联 SVG |
| 生成图标 PNG | 7 | 140,316 B | Android mipmap / 商店 / favicon |
| 截图（docs/） | 12 | 4,873,051 B | **不打包进 App**，仅说明书/商店素材 |

- 晶体库 + 示例总计 **48,732 B**，全部内嵌后离线可用，App 运行期**不访问网络**。
- 单文件 HTML 预览版把 CIF 文本内嵌为 JS/JSON 后：数据部分 **50,813 B**，gzip 9 级实测 **10,115 B**。
- 12 份 CIF 的 SHA-256 与 `SOURCES.md` 记录**全部一致**（逐文件核对，见 `assets-cases.md`）；拷贝后必须保持字节级一致。
- 图标已生成（透明背景、四边 6% 边距）；**adaptive icon 前景层需另出**（现有位图带圆角底板，见 §4.4）。

---

## 1. 版本与发布标识

### 1.1 应用名与版本号

| 项 | 值 | 权威来源 |
|---|---|---|
| 应用名 | `CrystalLens` | `README.md:1`、窗口标题 |
| 窗口标题格式 | `CrystalLens — <文件名>.cif` | `docs/screenshot-main.png` |
| 版本号 | `1.1.0` | `CMakeLists.txt:3`（`project(CrystalLens VERSION 1.1.0 …)`） |
| Windows 版本资源 | `FILEVERSION 1,1,0,0` / `PRODUCTVERSION 1,1,0,0`，CompanyName `CrystalLens Project`，FileDescription `CrystalLens Crystal Structure Viewer`，LegalCopyright `Copyright (c) 2026 CrystalLens Project` | `resources/app.rc:7-38` |
| 关于/帮助窗口显示 | `版本 1.1`（硬编码 `L"1.1"`）+ `构建于 <__DATE__>` | `src/ui/Popups.cpp:1194,1268` |
| 版权行 | `© 2026 CrystalLens Project · 供科研与教学使用` | `src/ui/Localization.h:239` |

Android/Web 取值建议：

- `versionName = "1.1.0"`（以发布包版本为准；界面“关于”可简写为 `1.1`，与桌面版一致）。
- `versionCode` 由 Android 规格 / 打包脚本确定；注意已生成的 `web/js/data/library.js` 中 `CL.data.app.versionCode = 110`（另一实现方的打包约定），Android 侧必须与该约定保持一致，**不要只改一处**。
- `applicationId` / 包名由 Android 规格决定，本资源规格不锁定。
- 单文件 HTML 版在 `<title>` 与“关于”面板显示 `CrystalLens 1.1.0`，并保留上述版权行。

### 1.2 发布包命名规则（桌面版基线）

| 项 | 规则/实测值 |
|---|---|
| 发布压缩包 | `CrystalLens-v1.1.0-win64.zip`（`pack.ps1:16-17`：`$StageName = "CrystalLens-v$Version-win64"`，输出到 `dist/`） |
| 解压目录 | `CrystalLens-v1.1.0-win64/` |
| 包内结构 | `CrystalLens.exe`、`README.md`、`LICENSE`、`VERSION.txt`、`SHA256SUMS.txt`、`library/`、`examples/`、`docs/`（`pack.ps1:39-62`） |
| `VERSION.txt` | 单行 `CrystalLens 1.1.0 (win64)`，ASCII + CRLF，**27 B**（实测） |
| `SHA256SUMS.txt` | 单行 `<64 位大写十六进制 SHA-256>` + **两个空格** + `CrystalLens.exe`，ASCII + CRLF，**83 B**；当前值 `757140D0B279986A588031FA7AEE8BF59543AA835A0B00B0C9F63B520E04AE67  CrystalLens.exe`，已与 `../CrystalLens.exe`（1,077,248 B）核对一致（`pack.ps1:60-62`） |
| 打包方式 | 先把文件铺到暂存目录，再 `Compress-Archive` 压缩目录内容（zip 根即文件，不套目录） |

Android/Web 建议沿用同一版本口径（最终由打包规格确认）：
`CrystalLens-v1.1.0-android.apk`、`CrystalLens-v1.1.0-web.html`、`CrystalLens-v1.1.0-android-sources.zip`；APK 内 `assets/web/VERSION.txt` 写 `CrystalLens 1.1.0 (android)`，单文件版内嵌同样文本，便于“关于”页显示与 QA 溯源。

### 1.3 许可与署名要求

- **代码**：MIT License，`Copyright (c) 2026 CrystalLens Project`（`LICENSE`，1,076 B）。重新分发时必须保留版权声明与许可全文；Android 需在“关于/开源许可”页放 MIT 全文（或 `LICENSE` 资源），单文件版在文件尾部注释或“关于”面板内置全文。
- **晶体数据**：12 份 CIF 取自 Crystallography Open Database（COD）格拉纳达大学镜像，COD 数据为 **CC0**；COD 文件头要求“使用时引用原始论文”（`library/SOURCES.md:3`）。因此：
  - `SOURCES.md` **必须**随资源分发，并在 App 内可达（“关于 → 晶体数据来源”，或库列表页脚链接）。
  - 每个结构详情至少显示 COD 编号 + 文献短引；`library.json` 的 `sourceId` / `sourceNote` 已内置，可直接渲染。
  - 最低署名组合（建议在“关于”页统一呈现）：`© 2026 CrystalLens Project · 供科研与教学使用` + `MIT License` 入口 + `晶体数据：COD（CC0），格拉纳达大学镜像` + `SOURCES.md` 全文。
- 桌面版“关于”窗口没有单独的许可面板（`Popups.cpp:1100-1271` 只显示版本、功能点、快捷键、版权行），Android 版**补充**许可/来源入口即可，不必复刻桌面布局。

---

## 2. 晶体库

### 2.1 文件清单（12 个 CIF，顺序 = `index.tsv` 顺序 = 库列表显示顺序）

| # | 文件 | 中文显示名 | 英文显示名 | 化学式（显示） | CIF `_chemical_formula_sum` | 晶系 | 空间群（IT 号） | COD | 字节 |
|---:|---|---|---|---|---|---|---|---|---:|
| 1 | `halite.cif` | 岩盐（氯化钠） | Halite | NaCl | `Cl Na` | 立方 | `F m -3 m`（225） | 9003308 | 4,730 |
| 2 | `fluorite.cif` | 萤石 | Fluorite | CaF₂ | `Ca F2` | 立方 | `F m -3 m`（225） | 9007060 | 4,599 |
| 3 | `perovskite.cif` | 钙钛矿 | Perovskite | CaTiO₃ | `Ca O3 Ti` | 正交 | `P b n m`（62） | 9006172 | 2,325 |
| 4 | `cooperite.cif` | 硫铂矿 | Cooperite | PtS | `Pt S` | 四方 | `P 42/m m c`（131） | 1011334 | 2,346 |
| 5 | `rutile.cif` | 金红石 | Rutile | TiO₂ | `O2 Ti` | 四方 | `P 42/m n m`（136） | 9004141 | 2,648 |
| 6 | `brookite.cif` | 板钛矿 | Brookite | TiO₂ | `O2 Ti` | 正交 | `P b c a`（61） | 9004137 | 2,671 |
| 7 | `anatase.cif` | 锐钛矿 | Anatase | TiO₂ | `O2 Ti` | 四方 | `I 41/a m d :1`（141） | 9008213 | 2,818 |
| 8 | `sphalerite.cif` | 闪锌矿 | Sphalerite | ZnS | `S Zn` | 立方 | `F -4 3 m`（216） | 1100043 | 3,329 |
| 9 | `wurtzite.cif` | 纤锌矿（2H） | Wurtzite (2H) | ZnS | `S Zn` | 六方 | `P 63 m c`（186） | 1100044 | 2,302 |
| 10 | `diamond.cif` | 金刚石 | Diamond | C | `C` | 立方 | `F d -3 m :1`（227） | 9011997 | 5,822 |
| 11 | `quartz.cif` | α-石英 | α-Quartz | SiO₂ | `O2 Si` | 三方 | `P 32 2 1`（154） | 9013321 | 2,670 |
| 12 | `calcite.cif` | 方解石 | Calcite | CaCO₃ | `C Ca O3` | 三方（六方设置） | `R -3 c :H`（167） | 9000965 | 3,063 |
| | | | | | | | **合计** | | **39,323** |

- 中文/英文显示名、显示化学式、空间群字符串取自 `library/index.tsv`；空间群与化学式已与 CIF 的 `_symmetry_space_group_name_H-M` / `_chemical_formula_sum` 交叉核对（晶系由 IT 号推出，未额外编造）。
- 显示化学式使用 Unicode 下标（`CaF₂`、`TiO₂`…）；CIF 内为 ASCII（`Ca F2`、`O2 Ti`）。`library.json.formula` 采用**显示形式**，解析/导出用 ASCII 形式时从 CIF 取。
- id（资源标识符）= 文件名去 `.cif`：`halite, fluorite, perovskite, cooperite, rutile, brookite, anatase, sphalerite, wurtzite, diamond, quartz, calcite`（与 `tests/test_core.cpp:618-619` 中的库名用法一致；`resources/library_ids.h` 只含对话框控件 ID，**不含**逐结构 ID，故 id 由文件名约定）。
- 来源：COD 格拉纳达镜像（`SOURCES.md:3`），12 份中 9 份原始数据来自 AMCSD（CIF 头 `_database_code_amcsd` 存在），3 份为 COD 直接收录（cooperite / sphalerite / wurtzite）。逐篇文献短引见 §2.3 与 `library.json.sourceNote`。

### 2.2 晶胞参数（直接来自 CIF，`library.json.cell` 为去不确定度后的数值）

| 文件 | a (Å) | b (Å) | c (Å) | α (°) | β (°) | γ (°) | V (Å³) | Z |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| halite | 5.6401 | 5.6401 | 5.6401 | 90 | 90 | 90 | 179.416 | 4 |
| fluorite | 5.4631 | 5.4631 | 5.4631 | 90 | 90 | 90 | 163.049 | 4 |
| perovskite | 5.3785 | 5.4419 | 7.6400 | 90 | 90 | 90 | 223.617 | 4 |
| cooperite | 3.47 | 3.47 | 6.1 | 90 | 90 | 90 | 73.4 | 2 |
| rutile | 4.593 | 4.593 | 2.959 | 90 | 90 | 90 | 62.422 | 2 |
| brookite | 9.174 | 5.449 | 5.138 | 90 | 90 | 90 | 256.844 | 8 |
| anatase | 3.7842 | 3.7842 | 9.5146 | 90 | 90 | 90 | 136.251 | 4 |
| sphalerite | 5.4145 | 5.4145 | 5.4145 | 90 | 90 | 90 | 158.7 | 4 |
| wurtzite | 3.8227 | 3.8227 | 6.2607 | 90 | 90 | 120 | 79.2 | 2 |
| diamond | 3.566986 | 3.566986 | 3.566986 | 90 | 90 | 90 | 45.3842 | 8 |
| quartz | 4.913437 | 4.913437 | 5.405118 | 90 | 90 | 120 | 113.007 | 3 |
| calcite | 4.988 | 4.988 | 17.061 | 90 | 90 | 120 | 367.611 | 6 |

> CIF 中带不确定度的写法（`5.4145(90)`、`3.566986(15)`、`3.8227(1)`、`45.3842(3)`）在 JSON 中取括号前的标称值；如需精确复现，保留 CIF 原文，不要用 JSON 值回写 CIF。

### 2.3 来源文献（COD + 原始论文）

| 文件 | COD | 论文短引 |
|---|---|---|
| halite | 9003308 | Walker, Verma, Cranswick, Jones, Clark & Buhre (2004). *Halite-sylvite thermoelasticity*. American Mineralogist 89:204–210 |
| fluorite | 9007060 | Speziale & Duffy (2002). *Single-crystal elastic constants of fluorite (CaF2) to 9.3 GPa*. Phys. Chem. Minerals 29:465–472, doi:10.1007/s00269-002-0250-x |
| perovskite | 9006172 | Liu & Liebermann (1993). *X-ray powder diffraction study of CaTiO3 perovskite at high temperatures*. Phys. Chem. Minerals 20:171–175 |
| cooperite | 1011334 | Bannister & Hey (1932). *Determination of minerals in platinum concentrates from the Transvaal by X-ray methods*. Mineralogical Magazine 23:188–206, doi:10.1180/minmag.1932.023.138.05 |
| rutile | 9004141 | Meagher & Lager (1979). *Polyhedral thermal expansion in the TiO2 polymorphs…*. The Canadian Mineralogist 17:77–85 |
| brookite | 9004137 | 同上（Meagher & Lager, 1979） |
| anatase | 9008213 | Horn, Schwerdtfeger & Meagher (1972). *Refinement of the structure of anatase at several temperatures*. Z. Kristallogr. 136:273–281, doi:10.1524/zkri.1972.136.3-4.273 |
| sphalerite | 1100043 | Jumpertz (1955). *Electron-density distribution in zinc blende*. Z. Elektrochem. 59:419–425 |
| wurtzite | 1100044 | Kisi & Elcombe (1989). *u parameters for the wurtzite structure of ZnS and ZnO using powder neutron diffraction*. Acta Cryst. C45:1867–1870, doi:10.1107/S0108270189004269 |
| diamond | 9011997 | Hom, Kiszenick & Post (1975). *Accurate lattice constants from multiple reflection measurements II…*. J. Appl. Cryst. 8:457–458, doi:10.1107/S0021889875010965 |
| quartz | 9013321 | Antao, Hassan, Wang, Lee & Toby (2008). *State-of-the-art HRPXRD illustrated with Rietveld refinement of quartz, sodalite, tremolite, and meionite*. The Canadian Mineralogist 46:1501–1509, doi:10.3749/canmin.46.5.1501 |
| calcite | 9000965 | Markgraf & Reeder (1985). *High-temperature structure refinements of calcite and magnesite*. American Mineralogist 70:590–600 |

COD 记录 URL 模板：`https://www.crystallography.net/cod/<sourceId>.html`（`SOURCES.md` 表内已给链接）。`SOURCES.md` 每行末尾的 SHA-256 已在本次交付中逐一核对通过。

### 2.4 CIF 字段矩阵（解析器必须覆盖的输入形态）

12 份 CIF 的字段组合（`Y` = 存在；由交付脚本扫描确认）：

- 12 份**全部包含**：`_chemical_name_mineral`、`_chemical_formula_sum`、`_space_group_IT_number`、`_symmetry_space_group_name_H-M`、`_atom_site_fract_x/y/z`、`_cod_database_code`、`_cell_volume`、`_cell_formula_units_Z`。
- 对称操作字段有两种写法，解析器**两者都要认**：**9 份**用 `_space_group_symop_operation_xyz`；**3 份**（cooperite / sphalerite / wurtzite）用旧式 `_symmetry_equiv_pos_as_xyz`。
- `_atom_site_aniso_*` 循环存在：brookite、calcite、quartz、rutile（解析可跳过，不得因此报错）。
- `_atom_site_occupancy` 列存在：cooperite、sphalerite（值均为 1）。
- `_chemical_name_common` 存在：diamond（`Diamond`）。
- 带不确定度数值（`1.234(5)`）：sphalerite、wurtzite、diamond。
- 含 DOI：anatase、cooperite、diamond、fluorite、quartz、wurtzite；其余仅期刊/页码。
- 行尾：CIF 全部 **LF、纯 ASCII、无 BOM**；`index.tsv` / `SOURCES.md` 为 **UTF-8 无 BOM + CRLF**。

### 2.5 `index.tsv` 列格式与用途

- 文件：`library/index.tsv`，735 B，UTF-8（无 BOM），**CRLF**，**13 行**（1 行表头 + 12 行数据）。
- 列：**6 列，TAB 分隔，无引号/转义**，顺序固定：

| 列 | 名称（表头） | 含义 | 示例 |
|---:|---|---|---|
| 0 | `file` | CIF 文件名（仅基名，含 `.cif`） | `halite.cif` |
| 1 | `zh` | 中文显示名 | `岩盐（氯化钠）` |
| 2 | `en` | 英文显示名 | `Halite` |
| 3 | `formula` | 显示化学式（Unicode 下标） | `CaF₂` |
| 4 | `space_group` | H-M 空间群符号（与 CIF 同形） | `F m -3 m` |
| 5 | `cod` | COD 记录号（纯数字字符串） | `9003308` |

- 用途：桌面版**库列表的唯一数据源**（`src/ui/CrystalLibrary.cpp:34-57` 的 `ReadLibrary`）；列表 4 列依次为 `zh|en`（按界面语言选一列）、`formula`、`space_group`、`COD`（列宽比例 34/17/29/20%，`:68-77`）。表头行被跳过；每行要求 6 个字段非空，否则**跳过该行**；`file` 必须是纯文件名且扩展名为 `.cif`，否则跳过（`:50-51`）。
- 移植要求：Android/Web 若直接解析此文件，按 `\t` 切分、去掉行尾 `\r`，不要引入 CSV 引号规则；行序即显示顺序。`library.json` 是同一数据的机器可读派生（额外带 cell/sourceNote），两者以 `index.tsv` + CIF 为准；出现不一致按 QA 缺陷处理。

### 2.6 库入口的 UI 呈现要求（与 UI 规格互补）

桌面基线（作为移植参照，不要求逐像素复刻）：

- 入口：空状态视口中央“**经典晶体库**”按钮；已打开结构时 `文件 → 经典晶体库` 或 `Ctrl+L`（`README.md:15`）。
- 对话框：标题 `经典晶体库` / `Crystal library`，尺寸 330×230 DLU（`resources/app.rc:40-49`）；提示行 `双击打开一个晶体，或按住 Ctrl / Shift 多选，在独立窗口中打开。`；列表为报表模式 4 列、整行选中、默认选中首行；`打开`/`取消` 按钮；双击行 = 打开；无选中时“打开”置灰（`CrystalLibrary.cpp:59-122`）。
- 缺失兜底文案：`无法打开晶体库。请检查程序旁的 library 文件夹是否完整。` / `Cannot open the crystal library. Check the library folder beside the executable.`（`Localization.h:27`）。
- 打开行为：每个晶体一个独立窗口（桌面多窗口），可并排比较。

Android/Web 侧资源约束（实现须满足，布局形式自由）：

1. **离线**：12 个结构来自内嵌数据（APK `assets/` 或打包进单文件 HTML 的 JS），运行期不得发起网络请求；无缓存时也能在首次进入时立即列出 12 项。
2. **顺序**：列表顺序 = `index.tsv` 行序（不得按字母重排）。
3. **每行信息**：主标题 = 当前语言显示名（`zh`/`en`），副行 = `formula` · `space_group` · `COD <sourceId>`；三项缺一不可（COD 是来源可追溯性的最低要求）。
4. **多选与打开**：支持多选后批量打开；单点/双击行为按 UI 规格，但必须能从列表直接打开，不需要先进详情页再打开。
5. **离线许可入口**：库页脚或详情页需能到达 `SOURCES.md` 全文/等价内容（COD + CC0 + 逐结构文献）。
6. **异常**：数据缺失或解析失败时显示上述本地化兜底文案（或等价错误页），**不得崩溃、不得白屏**；单条 CIF 解析失败只影响该条，其余 11 条仍可用。
7. **无障碍**：每行 `contentDescription` 至少包含“显示名 + 化学式 + 空间群 + COD”。

---

## 3. 示例文件（6 个）

| 文件 | 格式 | 标题（中/英） | 化学式 | 字节 | 内容摘要 |
|---|---|---|---:|---:|---|
| `benzene.xyz` | XYZ | 苯 / Benzene | C₆H₆ | 498 | 12 原子（6C+6H）平面分子，D6h 优化几何；无晶胞，键按共价半径推测 |
| `diamond.cif` | CIF | 金刚石 / Diamond | C | 746 | 极小 CIF：`F d -3 m`（227）常规胞 8 个碳位点，**无显式对称操作**；用来演示“仅空间群、沿用输入位点并提示缺失操作”的路径 |
| `nacl.vesta` | VESTA | 岩盐（NaCl）/ Rock salt (NaCl) | NaCl | 851 | VESTA 3.5.4 文本：`TITLE`/`CELLP`/`GROUP`/`SYMOP`/`STRUC`；演示 `.vesta` 读取 |
| `quartz.cif` | CIF | α-石英 / α-Quartz | SiO₂ | 822 | `P 3_1 2 1`（152）简化 CIF，6 条显式对称操作 + Si/O 分数坐标；演示 SiO₄ 四面体 |
| `srtio3.cif` | CIF | 钛酸锶 / Strontium titanate | SrTiO₃ | 694 | `P m -3 m`（221），5 个位点；演示 TiO₆ 配位八面体（`README.md:31`） |
| `water.xyz` | XYZ | 水 / Water | H₂O | 128 | 3 原子分子，无晶胞；最小 XYZ 示例 |

合计 **3,739 B**。示例为**纯演示数据**，不属于晶体库、不进入 `index.tsv`、不占用库列表名额。

UI 入口（桌面基线）：

- `文件 → 打开结构文件…`（`Ctrl+O`；`Localization.h:113-117` 的对话框与过滤器：`*.cif;*.mcif`、`*.vesta`、`*.xyz`、所有支持文件），支持多选与拖放，命令行可传路径（`README.md:172-187`）。
- 桌面版**没有**“示例”菜单项；示例通过 README“快速开始”指引用户到 `examples/` 目录打开。
- Android/Web 建议（资源侧要求，交互形式由 UI 规格定）：用户文件走系统文件选择器（Android SAF `ACTION_OPEN_DOCUMENT`，`.cif/.mcif/.vesta/.xyz` 建议按 `text/plain`/`application/octet-stream` 过滤）；6 个内置示例必须在“帮助/示例”或打开面板的“示例”入口中可直接打开（不要求用户先导出文件）；单文件版从内嵌数据打开。示例文件同样不得走网络。

---

## 4. 图标与品牌

### 4.1 `logo.png`（母版）

| 项 | 值 |
|---|---|
| 路径 | `../resources/logo.png` → 交付 `web/assets/logo.png` |
| 尺寸/格式 | 1024×1024，PNG，RGBA |
| 体积 / SHA-256 | 70,639 B / `D75CD58CBFC727FC1CF9F07773CD5C0A21A401B05BD7C29FF34A5FBABCED3F36` |
| 构图 | 深色圆角方板（四角透明）+ 中央多面体宝石；宝石高光/描边带半透明 alpha（alpha 取值 0/1/2/46/90/100/120/150/235/245/255），**不要做白底合成或不透明化** |
| 内容包围盒 | alpha>8 的 bbox = `(28, 28, 997, 997)`，969×969，几何中心即画布中心 |
| 品牌色（采样） | 板面渐变 `#0E1420`(顶) → `#131827`(底)；板边缘 `#344662`；宝石蓝 `#40BAFF`（局部 `#3DBEFF`/`#44B6FF`）；高光近白 `#EEF8FF` |
| 运行时用途 | **桌面 UI 不读取该 PNG**：`logo` 由 GDI+ 矢量绘制（`Icons.cpp:39-68 DrawLogo`，24×24 单位轮廓）。该文件是图标/文档母版 |

UI 中的 logo 尺寸（矢量绘制，移植时可作为布局参照）：工具栏左上 **24 px**（`MainWindow.cpp:766-768`）、空状态 **48 px**（`MainWindow.cpp:943`）、帮助/关于窗口 **46 px**（`Popups.cpp:1191`）。

### 4.2 Windows `.ico`

- `resources/app.ico`：64,710 B，含 **7 个尺寸**：16 / 24 / 32 / 48 / 64 / 128 / 256；作为资源 ID `101`（`resources/app.rc:5`），用于 exe、任务栏、窗口图标。
- Android **不复用** `.ico`（平台不支持该容器）；Web 也不需要。仅作为 Windows 构建产物基线记录。

### 4.3 已生成的 Android/Web 图标（`web/assets/icons/`）

| 文件 | 尺寸 | 字节 | 用途 |
|---|---:|---:|---|
| `icon-favicon-32.png` | 32×32 | 1,932 | favicon / 浏览器标签 |
| `icon-48.png` | 48×48 | 3,465 | Android `mipmap-mdpi` legacy 图标 |
| `icon-72.png` | 72×72 | 6,004 | Android `mipmap-hdpi` |
| `icon-96.png` | 96×96 | 8,872 | Android `mipmap-xhdpi` |
| `icon-144.png` | 144×144 | 15,435 | Android `mipmap-xxhdpi` |
| `icon-192.png` | 192×192 | 22,714 | Android `mipmap-xxxhdpi`；PWA manifest 192；apple-touch-icon（180）缩放源 |
| `icon-512.png` | 512×512 | 81,894 | Google Play 商店图标；PWA manifest 512 |
| （合计） | | **140,316** | |

生成规格（已验证）：

- 正方形、RGBA、**透明背景**（圆角板外 alpha=0）。
- 内容等比缩放后**居中**，四周各留 **6%** 透明边距（内容占 88%）；实测边距：48→3 px、72→4/5 px、96→6 px、144→8/9 px、192→11/12 px、512→30/31 px、32→2 px。
- 源裁剪：logo 内容 bbox `(28,28,997,997)`（969×969）→ 按 `round(size × 0.88)` Lanczos 重采样 → 居中粘贴到透明画布。
- 生成后逐张校验了尺寸、alpha 边距与 PNG 可读性；SHA-256 见 `assets-cases.md`。

### 4.4 Android mipmap 与 adaptive icon 建议

**legacy 图标（立即可用）**：

| 密度 | 目录 | 文件 |
|---|---|---|
| mdpi | `res/mipmap-mdpi/` | `icon-48.png` → `ic_launcher.png` |
| hdpi | `res/mipmap-hdpi/` | `icon-72.png` |
| xhdpi | `res/mipmap-xhdpi/` | `icon-96.png` |
| xxhdpi | `res/mipmap-xxhdpi/` | `icon-144.png` |
| xxxhdpi | `res/mipmap-xxxhdpi/` | `icon-192.png` |

`android:roundIcon` 复用同一套 PNG（或另出圆形裁切版）。

**adaptive icon（Android 8.0+，建议必做）**：

- 画布 **108×108 dp**；可见区域 72 dp；**安全区为直径 66 dp 的圆**（即中心约 61% 直径内的主体不会被任何遮罩裁掉）。
- **背景层**：满幅 108 dp，不留透明；推荐纯色 `#0E1420` 或 `#0E1420 → #131827` 135° 渐变（与 logo 板面一致）。
- **前景层**：108 dp 透明画布，只放**宝石图形本身**（去掉圆角方板），主体外接尺寸控制在 **66 dp** 内；四边仍留透明。
- 若用位图而非矢量：前景/背景各出 mdpi 108 / hdpi 162 / xhdpi 216 / xxhdpi 324 / xxxhdpi 432 px。
- `monochrome` 层（Android 13+ 主题图标）可选：单色宝石轮廓，透明底。
- **注意**：现有 `icon-*.png` 带圆角底板，**不要直接当 adaptive 前景层**（系统再套遮罩会把圆角板二次裁切、露出边缘）；若暂无独立前景设计稿，可暂时只用 legacy 图标 + 纯色背景层，或由设计从矢量源重导前景（推荐）。
- Android 12+ 启动画面：`windowSplashScreenAnimatedIcon` 用前景图形（66 dp 安全区内）或 `icon-192.png` 的宝石部分；背景色同 `#0E1420`。

### 4.5 favicon / Web 图标建议

- favicon：`icon-favicon-32.png`（32×32）；建议再由该图缩出 16×16 作 `favicon-16.png`（可选，非本次交付）。
- iOS 主屏：`apple-touch-icon` 180×180（由 `icon-192.png` 缩到 180，透明区建议先平铺 `#0E1420`）。
- PWA manifest：`icons: [{src:"assets/icons/icon-192.png", sizes:"192x192", type:"image/png"}, {src:"assets/icons/icon-512.png", sizes:"512x512", type:"image/png"}]`；`theme_color` / `background_color` = `#0E1420`。
- **不要**给现有图标记 `purpose: "maskable"`：maskable 要求主体在中心直径 80% 的安全圆内，而本套内容占 88%（边距 6%），超出安全区；如需 maskable，另生成 10% 边距版本。
- 单文件 HTML：**不要**内联 base64 版 `logo.png`（70,639 B → base64 ≈ 94 KB，且 PNG 已压缩、gzip 收益低）；改用内联 SVG 重绘 24×24 单位轮廓（见 §7 附录），约 1–2 KB。

### 4.6 图标重新生成（可复现）

Pillow 环境：`python`（Pillow 12.3）。核心逻辑：

```python
from PIL import Image
im = Image.open("web/assets/logo.png").convert("RGBA")
bbox = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()  # (28,28,997,997)
crop = im.crop(bbox)                    # 969x969，已居中
for size in (48, 72, 96, 144, 192, 512, 32):
    content = int(round(size * 0.88))   # 6% 边距
    art = crop.resize((content, content), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    off = (size - content) // 2
    canvas.paste(art, (off, off), art)
    name = "icon-favicon-32.png" if size == 32 else f"icon-{size}.png"
    canvas.save(f"web/assets/icons/{name}", "PNG", optimize=True)
```

生成后需复验：尺寸、四角 alpha=0、内容 bbox 边距落在 5.5%–6.5% 区间、PNG 可正常解码。

---

## 5. 截图与文档资源（仅说明书，不打包进 App）

`docs/` 下共 **12 张 PNG，合计 4,873,051 B**（`pack.ps1:53` 会把这 12 张打进 win64 便携包；**Android APK / 单文件版不打包**，避免体积膨胀）。

| 文件 | 尺寸 | 字节 | 用途（README 章节） |
|---|---:|---:|---|
| `halite-polyhedra-v11.png` | 1000×780 | 362,864 | v1.1 岩盐 NaCl₆ 八面体 |
| `polyhedra-v09.png` | 1000×780 | 158,735 | v0.9 SrTiO₃ 配位八面体 |
| `screenshot-v08-srtio3.png` | 1000×780 | 346,864 | v0.8 晶胞显示 |
| `screenshot-main.png` | 2707×1567 | 799,356 | 主界面（README 未直接引用，打包脚本包含） |
| `screenshot-supercell.png` | 2707×1567 | 1,336,910 | v0.5 超胞 |
| `screenshot-polyhedral.png` | 2707×1567 | 427,297 | v0.6 多面体模式 |
| `screenshot-bi2te3.png` | 2707×1567 | 349,800 | v0.6 Bi₂Te₃ 无键 |
| `screenshot-crcobr3.png` | 2707×1567 | 452,895 | v0.7 CrCoBr₃ 键连 |
| `screenshot-appearance.png` | 876×1024 | 362,897 | v0.7 HSV 色轮 |
| `screenshot-help.png` | 1520×1200 | 154,194 | 帮助/关于窗口 |
| `screenshot-editcell.png` | 1240×1064 | 57,624 | 编辑晶胞 |
| `screenshot-editatom.png` | 1240×1064 | 63,615 | 编辑原子 |

说明：`README.md` 引用其中 11 张；`screenshot-main.png` 仅被打包脚本收录。当前工作区 `docs/` 仅有 9 张（缺 `halite-polyhedra-v11.png`、`polyhedra-v09.png`、`screenshot-v08-srtio3.png`），如需完整说明书素材请从 `../docs/` 全量复制（本规格未写入这些路径，见 §8 风险）。

---

## 6. 资源体积预算与内嵌策略

### 6.1 实测体积

| 资源 | 文件数 | 字节 | 备注 |
|---|---:|---:|---|
| `web/data/library/`（12 CIF + index + SOURCES） | 14 | 44,993 | CIF 39,323 + 735 + 4,935 |
| `web/data/examples/` | 6 | 3,739 | |
| **web/data 小计** | 20 | **48,732** | 必进 App |
| `web/assets/logo.png` | 1 | 70,639 | 仅 Web/图标母版 |
| `web/assets/icons/`（7 PNG + README） | 8 | 142,516 | PNG 140,316 + README 2,200 |
| **web/assets 小计** | 9 | **213,155** | |
| `docs/spec/library.json` | 1 | 8,955 | 构建期数据，可不进 App |
| docs 截图 | 12 | 4,873,051 | **不进 App** |

单文件版内嵌数据实测（UTF-8、gzip 9 级）：

| 片段 | 原始 | gzip |
|---|---:|---:|
| 12 份 CIF → JSON 字典（key = id） | 41,169 B | 6,923 B |
| `index.tsv` | 735 B | 同左 |
| `SOURCES.md` | 4,935 B | 同左 |
| 6 个示例 → JSON 字典 | 3,974 B | 1,034 B |
| **合计** | **50,813 B** | **10,115 B** |

### 6.2 Android 内嵌

- 推荐目录：把 `web/` 整树放进 `app/src/main/assets/web/`，用 `WebViewAssetLoader` 以 `https://appassets.androidplatform.net/assets/web/index.html` 提供（同源、支持 `fetch`/ES Module、无网络权限）。备选：Kotlin 从 assets 读取后以 `window.__CRYSTAL_DATA__` 注入（兼容老 WebView，但需注意 ~50 KB 字符串注入时机）。
- CIF 直接放 `assets/`（保留 `.cif` 原文），**不要**放 `res/raw`（无法按 URL fetch）、**不要** Base64（体积 +33%）、**不要**运行时下载。
- 预算：App 资源增量 **≈ 262 KB 原始**（data+assets，不含截图），APK 压缩后约 200–230 KB 增量（PNG 已压缩；CIF 压缩比高）。目标：**新加资源 ≤ 300 KB**；截图、`docs/`、`.ico` 一律排除。
- 单文件版目标：**≤ 400 KB 未压缩 / ≤ 120 KB gzip**（数据 51 KB + 应用 JS/CSS；logo 用 SVG 而非 PNG base64）。

### 6.3 单文件 HTML 预览版：数据内嵌结构

**现状**：仓库中已由另一实现方生成 `web/js/data/library.js`（55,448 B，`tools/gen_library.py` 产物，勿手改），结构为 IIFE 挂载全局：

```js
CL.data.app      = { name, version:"1.1.0", versionCode:110, sourceVersion, license:"MIT", builtAt }
CL.data.library  = [ { id, file, kind:"crystal", titleZh, titleEn, formula, spaceGroup,
                       sourceId, sourceNote, size, sha256, cell{a,b,c,alpha,beta,gamma},
                       text /* CIF 原文 */ }, … 12 项 ]
CL.data.examples = [ { file, kind:"example", format, titleZh, titleEn, formula, note,
                       size, sha256, text /* 原文 */ }, … 6 项 ]
CL.data.summary  = { library:12, examples:6 }
```

该文件与 `docs/spec/library.json` + `web/data/library/` 的数据一致（id/文件名/标题/化学式/空间群/COD/文献/cell 均可逐项对上；`size`/`sha256` 与 `assets-cases.md` 相同）。单文件构建建议直接复用它，或在等价结构上生成：

```js
// 建议的单文件内嵌形式（由构建脚本生成，勿手改）
// 数据来源：docs/spec/library.json + web/data/library/*.cif + web/data/examples/*
export const LIBRARY_META = Object.freeze([ /* 12 项，字段同 library.json.crystals */ ]);
export const LIBRARY_CIF  = Object.freeze({ halite: "…CIF 原文…", /* … 共 12 个 key（= id） */ });
export const EXAMPLES     = Object.freeze({ "srtio3.cif": "…原文…", /* … 共 6 个 */ });
export const SOURCES_MD   = "…SOURCES.md 全文…";
export const LIBRARY_INDEX_TSV = "file\tzh\ten\tformula\tspace_group\tcod\n…";
```

- 备选（更稳，避免转义问题）：把上述数据序列化为单个 JSON，放进
  `<script type="application/json" id="crystallens-library">…</script>`，
  启动时 `JSON.parse(document.getElementById("crystallens-library").textContent)`。CIF/SOURCES 内不含反引号与 `${`，但仍建议统一走 JSON（SOURCES.md 含 `|`、`*`、中文，JSON 最省心）。
- 生成校验：`LIBRARY_CIF` 的 12 个 key 与元数据一一对应；`LIBRARY_INDEX_TSV` 行数 = 13；每个 CIF 文本与 `web/data/library/<file>` 逐字节一致（构建期断言）。

---

## 7. 交付路径与命名约定

本次已写入（见 `web/` 树）：

```text
web/
  data/library/    anatase.cif brookite.cif calcite.cif cooperite.cif diamond.cif
                   fluorite.cif halite.cif perovskite.cif quartz.cif rutile.cif
                   sphalerite.cif wurtzite.cif  index.tsv  SOURCES.md     (14 文件)
  data/examples/   benzene.xyz diamond.cif nacl.vesta quartz.cif srtio3.cif water.xyz (6 文件)
  assets/logo.png                                                          (70,639 B)
  assets/icons/    icon-48/-72/-96/-144/-192/-512.png icon-favicon-32.png README.md
docs/spec/
  assets.md  library.json  assets-cases.md
```

命名规则：

- 晶体 id = CIF 文件名去 `.cif`；**不得改名 CIF**、不得合并 12 份为一个文件（`index.tsv`、`SOURCES.md` 按文件名互相引用）。
- Web 路径一旦确定不要改：`web/data/library/…`、`web/data/examples/…`、`web/assets/…`（其他实现方按此路径读取）。
- Android `assets/web/…` 保持相同相对结构，便于单文件版与 APK 共用同一份数据。
- `web/js/`、`web/css/`、`web/index.html` 由其他实现方交付（如 `web/js/data/library.js` 已生成并在使用内嵌数据），不在本规格的写入范围内；本规格只保证 `web/data/` 与 `web/assets/` 的路径、字节与 SHA-256 稳定。

## 8. 已知风险与待办

1. **adaptive icon 前景缺失**：现有 7 个 PNG 含圆角底板，不能直接作为 adaptive 前景层；需设计从矢量源导出“纯宝石图形”前景（108 dp，主体 ≤66 dp）。不影响 legacy 图标上线。
2. **docs 截图不全**：工作区 `docs/` 当前只有 9 张，缺 3 张历史示意图；说明书/README 如需引用需从 `../docs/` 补齐（只能从基线包 copy，不要另行截图）。
3. **版本口径**：发布包/CMake/版本资源为 `1.1.0`，关于窗口显示 `1.1`；Android 统一用 `versionName 1.1.0`，界面对齐桌面显示 `1.1`。
4. **数据不得再生成**：CIF 与 `index.tsv`/`SOURCES.md` 必须保持字节级一致（SHA-256 见 `assets-cases.md`）；任何“格式化/重排/转码”都会破坏与 `SOURCES.md` 的校验记录。
5. **maskable 图标**：如 PWA/Web 需要 `purpose:"maskable"`，须另生成 10% 边距版本（当前 6% 版本不安全）。
6. **`library.json` 消费者约定**：顶层为对象 `{schemaVersion, app, version, generatedFrom, crystals[], examples[]}`；`crystals[]` 每项字段固定（额外字段会被 QA 视为不合格）。若其他实现方需要不同入口名，请先改规格再改数据。

---

## 附录 A：内联 SVG 品牌图形（单文件版用）

桌面 `DrawLogo`（`Icons.cpp:39-68`）的 24×24 单位几何，可直接转 SVG：

- 外轮廓六边形点：`(12,1.2) (21.2,7.3) (18.4,18.8) (12,22.8) (5.6,18.8) (2.8,7.3)`，填充用线性渐变（桌面主题 `kAccentLight #85ABFF` → `kTeal #35D3AF`，取自 `src/ui/UiDraw.h:33-36`；PNG 母版更偏白/亮蓝，若要与 PNG 一致可改用 `#EEF8FF → #40BAFF`）。
- 棱线：`(12,1.2)-(12,22.8)`、`(2.8,7.3)-(12,12.2)`、`(21.2,7.3)-(12,12.2)`、`(5.6,18.8)-(12,12.2)`、`(18.4,18.8)-(12,12.2)`，描边 `rgba(160,236,246,255)`，线宽 0.8。
- 高光椭圆：圆心约 `(10.6,5.0)`，半径 1.3，`rgba(255,255,255,190)`。

建议直接 `viewBox="0 0 24 24"` 内联到页头（尺寸 24 px）与空状态（48 px），避免 94 KB 的 base64 PNG。
