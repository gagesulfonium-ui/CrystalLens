# CrystalLens 安卓重构 · 核心规格（core.md）

> 基线：`../`（C++17，v1.1.0，只读）。**不要**参考工作区根目录旧版 `src/`（v0.7.0）。
> 本文把 C++ 核心实现（`src/core/*` + `src/render/Renderer.cpp` 中的显示集合逻辑）提炼成"可直接照着写 JS"的实现级规格；接口命名以 `docs/CONTRACT.md` 的 `StructureData` / `DisplayModel` 为准。
> 数据表：`docs/spec/elements.json`（周期表，字段与分类见 §14.1）。可移植测试清单：`docs/spec/core-cases.md`。
> 单位：长度 Å；角度对外为度（°），内部三角函数用弧度；时间 ms。坐标系：右手系，晶格 a 沿 +X。
> 文中 `kXxx` / `Xxx` 为 C++ 源码标识符，`snake_case`/`camelCase` 为 JS 建议命名；两者对应关系见 §1。

---

## 目录

0. 源码地图与移植边界
1. 数据模型
2. 数学约定（晶胞、分数/笛卡尔、最小镜像）
3. CIF 解析
4. XYZ 解析
5. VESTA 解析
6. 对称展开
7. 成键 BuildBonds
8. 超胞、边界原子与显示集合（含可见键）
9. 配位多面体（中心与配体）
10. 测量
11. 编辑（晶胞/原子增删改）
12. 导出（CIF / XYZ）
13. 结构摘要与数值格式化
14. 常量与上限清单
15. 已知差异、风险与实现建议
16. 移植检查清单

---

## 0. 源码地图与移植边界

| C++ 文件 | 职责 | JS 归属（CONTRACT §2/§4） |
|---|---|---|
| `src/core/Math.h` | Vec3、常量、Wrap、Clamp | `web/js/lib/math.js` |
| `src/core/PeriodicTable.{h,cpp}` | 元素表、成键分类、元素符号归一化 | `web/js/lib/periodic_table.js`（数据源 `elements.json`） |
| `src/core/Crystal.{h,cpp}` | 数据结构、晶胞数学、最小镜像、对称展开、成键、编辑、导出、测量、文件格式检测与加载 | `core/crystal.js`、`core/measure.js`、`core/edit.js`、`core/export.js` |
| `src/core/CifParser.cpp` | CIF 词法/语法/语义 | `core/cif.js` |
| `src/core/XyzParser.cpp` | XYZ | `core/xyz.js` |
| `src/core/VestaParser.cpp` | VESTA 文本 | `core/vesta.js` |
| `src/render/Renderer.cpp`（`RebuildAtoms` / `RebuildLines` / `FitsSupercell` / `RebuildLines`） | 超胞、边界原子、可见键、容量上限 | 并入 `core/crystal.js` 的 `buildDisplayModel` |
| `src/render/PolyhedronMesh.cpp` | 配位多面体（中心判定 + 凸包） | `core/crystal.js` 的 `buildPolyhedra` |
| `src/ui/Format.cpp` | 摘要/测量/晶胞数值格式 | `core/format.js` |

**移植顺序建议**（impl-core-model）：数据模型 → 晶胞数学/最小镜像 → 对称展开 → 成键 → 摘要/包围盒；解析器（impl-core-parser）只依赖 §1/§2/§3–§5 + `elements.json`。

---

## 1. 数据模型

### 1.1 总览与 C++ ↔ JS 对照

C++ 用**一个** `Atom` 结构同时承载"不对称单元位点"和"展开后的原子"；JS 按 `CONTRACT.md` 分成 `Site`（不对称单元）与 `Atom`（展开后）。

| C++ | JS（CONTRACT） | 说明 |
|---|---|---|
| `SourceFormat` | `StructureData.format: 'cif'\|'xyz'\|'vesta'` | 未知格式不会走到模型 |
| `Cell` | `StructureData.cell: CellData \| null` | `cell.valid` ⟺ `cell !== null` |
| `SymmetryOp` | `StructureData.symops[i]: SymOp` | 显式操作；空数组 = 无操作 |
| `Atom`（`asymmetricAtoms`） | `StructureData.sites[i]: Site` | 源数据；编辑只改它 |
| `Atom`（`atoms`） | `StructureData.atoms[i]: Atom` | 展开产物；只读派生 |
| `Bond` | `StructureData.bonds[i]: Bond` | 单胞周期键表 |
| `Structure` | `StructureData` | 见 §1.7 |
| `Measurement` | `Measurement`（CONTRACT §5.6） | 见 §10 |
| `ParseError` | `CL.ParseError`（`{name:'ParseError', message, line}`） | 见 §1.9 |

### 1.2 元素 `Element`（`elements.json` 一项）

| 字段 | 类型 | 语义 |
|---|---|---|
| `symbol` | string | 标准元素符号（大写+小写，如 `Si`）；未知为 `X` |
| `z` | int | 原子序数 1–118；未知 `X` 为 0 |
| `name` | string\|null | 英文名（源码有） |
| `nameZh` | string\|null | 中文名；**C++ 源码没有**，全部 `null`（UI 需要时由 i18n 补充） |
| `category` | `'metal'\|'nonmetal'\|'metalloid'\|'unknown'` | 由 §7.1 分类函数推导（Po=84 归 `metalloid`，与源码一致） |
| `metal` | bool | `category === 'metal'`（= C++ `!IsNonMetal && !IsMetalloid`，**碱金属/碱土金属也算 metal**） |
| `covalent` | number | 共价半径 Å（原 `float`，按十进制原值） |
| `vdw` | number | 范德华半径 Å |
| `colorU32` | int | 24 位 `0xRRGGBB`（与 C++ `Element::color` 一致，**不含 alpha**） |
| `colorHex` | string | `"#rrggbb"` |
| `rgb` | [number,number,number] | `[R/255, G/255, B/255]`，0..1，渲染器可直接用 |

`elements.json` 共 **119** 项：前 118 项严格按 `z = 1..118` 顺序；第 119 项是 `kUnknown` 的 `X`（`z:0, covalent:0.77, vdw:1.70, color:0x9AA4B2`），供未知元素/空晶格占位使用。`CL.periodic.get('X')` 应返回它；`get` 对 0/118 之外返回 `null`（或 `X`）。

### 1.3 晶胞 `CellData`

| 字段 | 类型 | 默认（C++） | 语义 |
|---|---|---|---|
| `a,b,c` | number | 1.0 | 边长 Å，必须 > 0 |
| `alpha,beta,gamma` | number | 90.0 | 晶胞角（度），必须 ∈ (0,180) |
| `aVec,bVec,cVec` | `[x,y,z]` | (1,0,0)/(0,1,0)/(0,0,1) | 笛卡尔晶格向量，构造规则见 §2.2 |
| `volume` | number | 1.0 | `|aVec·(bVec×cVec)|`，见 §2.4 |

构造失败时 C++ 返回 `false` 且 `Cell` 保持原值；JS 建议 `CL.Math.buildCell(...) -> CellData | null`（另有 `buildCellOrThrow` 供解析器给出带文本错误）。`valid` 判据：`volume` 有限且 `> 1e-9`。

### 1.4 对称操作 `SymOp`

| 字段 | 类型 | 语义 |
|---|---|---|
| `m` | `[Vec3,Vec3,Vec3]` | 3×3 旋转/镜像矩阵，**行优先**：`m[row][col]`，作用 `f' = m·f + t` |
| `t` | Vec3 | 平移（分数坐标单位，可为任意实数，如 `1/6`） |
| `text` | string | 原始（规范化后的）表达式，导出时写回；缺少时按矩阵生成（VESTA） |

`applySymOp(op, frac) = [m00*x+m01*y+m02*z+t0, ...]`。
注意：`text` 是**语义一部分**（CIF 导出/去重/测试都依赖它）；CIF 解析时 `text = 去掉前导编号、去尾部空白后的原文`（内部空白保留，如 `-y, x-y, z+1/6` → text `-y, x-y, z+1/6`）。

### 1.5 位点 `Site`（不对称单元）与原子 `Atom`（展开后）

字段语义（★ = 解析/展开时被赋值的关键规则）：

| C++ 字段 | Site | Atom | 语义 / 赋值规则 |
|---|---|---|---|
| `label` | ✓ | ✓ | 显示标签。CIF 取 `_atom_site_label`；为空时 `element + (row+1)`。展开时：该位点只生成 1 个位置 → `label = baseLabel`；生成 >1 位置 → `label = baseLabel + "_" + (copy+1)`（copy 从 0 起，故后缀从 `_1` 开始） |
| `baseLabel` | ✓ | ✓ | 去对称后缀的基名。解析时 `= label`；编辑时 `= 输入标签`；为空则回填当时 label |
| `element` | ✓ | ✓ | 元素符号。未知 → `"X"` |
| `atomicNumber` → `z` | ✓ | ✓ | 1–118；未知/未识别 = 0 |
| `frac` | ✓（可为 null） | ✓ 恒有 | 分数坐标；晶体必填；分子位点建议 `[0,0,0]` 占位（C++ 非周期结构 `frac={0,0,0}`） |
| `cart` | ✓（可为 null） | ✓ 恒有 | 笛卡尔坐标 Å；晶体中由 `frac` 计算，分子中为真实坐标 |
| `disorderGroup` | ✓ | ✓ | CIF `_atom_site_disorder_group` 原文；空 = 无 |
| `disorderAssembly` | ✓ | ✓ | CIF `_atom_site_disorder_assembly` 原文；空 = 无 |
| `occupancy` | ✓ | ✓ | 占位率，默认 1.0；**解析不裁剪**（可为 0/负/大于 1）；展开时 `<= 0` 的位点整组跳过 |
| `uiso` | ✓ | ✓ | CIF `_atom_site_U_iso_or_equiv` 数值；默认 0.0 |
| `hasUiso` | ✓ | ✓ | 仅当 CIF 该列存在且**数值解析成功**时为 true；VESTA/XYZ 恒 false |
| `siteIndex` | ✓ | ✓ | Site：在 `sites` 中的索引。Atom：其来源 Site 的索引（C++ 中即 `asymmetricAtoms` 下标）；编辑对话框用它定位 |
| `symmetryIndex` | — | ✓ | 生成该 Atom 的 `symops` 下标（0 起）；无操作/未展开时 0 |
| `symmetryGenerated` | — | ✓ | `symmetryIndex !== 0`。⚠只是"C++ 第一条操作之外"的判定，**并不等价于"由对称操作生成"**（若文件首个操作不是单位操作，该标记会误导 UI；保持 C++ 行为，UI 文案按"该原子由对称操作生成"处理即可） |

**注意**：C++ `Atom` **没有 `note` 字段**；备注只在 `Structure.note`（§1.7）。`CONTRACT` 的 `Site` 也没有 `note`。

其他不变式（C++ 行为，必须复刻）：
- 展开后每个 Atom 都满足 `cart = fracToCart(cell, frac)`（晶体）；`frac` 已 `Wrap01` 到 `[0,1)`。
- 分子（无晶胞）：`atoms = sites` 的浅拷贝，`siteIndex = i`，`symmetryIndex = 0`，`symmetryGenerated` 保持解析值（XYZ 为 false）。
- `sites` 是唯一真源；`atoms / bonds / elementCounts / cellContents / center / boundRadius` 全是派生值，任一次编辑后整体重建（§11）。
- `StructureData` 必须可 `JSON.stringify` 往返（撤销快照）；因此上表字段全部是原始值，不含函数/Map/TypedArray。

### 1.6 化学键 `Bond`

| 字段 | 类型 | 语义 |
|---|---|---|
| `a`,`b` | int | `atoms` 下标；恒满足 `a <= b`（自键 `a === b` 存在，见 §7.5） |
| `length` | number | 该周期像下的真实距离 Å（= `|b.cart + imageOffset - a.cart|`，**不是**最小镜像重算值，但按构造它就是该 pair 的一个像距） |
| `shift` | `[tx,ty,tz]` int | 施加在 **b 端**的晶格平移（分数坐标整数）；距离 = `|b.cart + fracToCart(cell,shift) - a.cart|` |
| `imageOffset` | Vec3 | `= fracToCart(cell, shift)`（笛卡尔偏移，渲染直接用） |
| `periodic` | bool | `= cell.valid`（分子键为 false） |

排序：`bonds` 按 `(a, b, shift[0], shift[1], shift[2])` 升序（C++ `std::array` 字典序，即先 x 后 y 后 z）。

### 1.7 `StructureData` 字段

| C++ | JS | 语义 |
|---|---|---|
| `format` | `format` | `'cif'\|'xyz'\|'vesta'` |
| `sourcePathUtf8` | `sourceName` | CONTRACT 只留文件名；C++ 存完整 UTF-8 路径（摘要里显示 Source 用） |
| `title` | `title` | 标题：CIF 依次取 `_chemical_name_common/_chemical_name_mineral/_chemical_name_systematic/_struct_title`，空则 blockName，再空 `"CIF structure"`；VESTA 取 TITLE 下一非空行，空则 `"VESTA structure"`；XYZ 取第 2 行注释，空则 `"XYZ molecule"`；`LoadStructureFile` 最后若仍空则用文件名去扩展名 |
| `blockName` | `blockName` | CIF `data_` 之后的名字（原样大小写）；无 data_ 的块为 `"CIF"`；XYZ/VESTA 为 `""` |
| `spaceGroup` | `spaceGroup` | CIF 取 H-M 名（表见 §3.6），否则 IT 号拼成 `"#<n>"`；VESTA 由 GROUP 行解析（如 `"F m -3 m"`）；XYZ 为 `""` |
| `formula` | `formula` | CIF `_chemical_formula_sum` / `_chemical_formula_moiety`（CleanText）；否则在 `ComputeContents` 时用 `cellContents` 回填；`LoadStructureFile` 末尾 `Trim` |
| `cellContents` | `cellContents` | 显示晶胞内容的元素计数串，见 §13.1 |
| `note` | `note` | 警告/提示串（多段用前导空格拼接），逐条文本见 §3.10 / §4 / §5 / §6 / §7。⚠**v1.1 UI 从未显示 `note`**（见 §15） |
| `cell` | `cell` | 见 §1.3；失败时 null |
| `periodic` | `periodic` | `= cell.valid`（`FinalizeStructure` 末尾设置） |
| `symmetryExpanded` | `symmetryExpanded` | 仅当 `symops.length > 0` 且执行了展开时为 true（§6） |
| `truncated` | `truncated`（建议补进 StructureData） | 原子/键被 30000 / 150000 容量截断过 |
| `asymmetricAtomCount` | `asymmetricAtomCount` | `= sites.length`（`FinalizeStructure` 设置） |
| `symmetryOperatorCount` | `symmetryOperatorCount` | 解析器设为显式操作数；展开后设为 `symops.length || 1` |
| `asymmetricAtoms` | `sites` | 不对称单元 |
| `symmetryOps` | `symops` | 显式操作（空数组表示"仅显示不对称单元"） |
| `atoms` | `atoms` | 展开后单胞原子（可能为空 = 尚未 finalize） |
| `bonds` | `bonds` | 单胞周期键 |
| `elementCounts` | `elementCounts: Record<string,int>` | `z → count`（按 z 升序插入，保证 §13.1 字符串顺序；JS 对象需显式排序后再拼） |
| `center` | `center` | 包围球中心（笛卡尔，未减任何 origin） |
| `boundRadius` | `boundRadius` | 包围球半径；默认 8.0；相机 fit 用 |

`CONTRACT` 未列但实现需要的字段：`truncated`（建议加）、`sourceName`（代替 `sourcePathUtf8`）。

### 1.8 `StructureData` JSON 示例（NaCl，展开并成键后）

```json
{
  "format": "cif", "sourceName": "halite.cif", "title": "Halite", "blockName": "9003308",
  "spaceGroup": "F m -3 m", "formula": "Cl Na", "cellContents": "Na4 Cl4", "note": "",
  "periodic": true, "symmetryExpanded": true, "truncated": false,
  "asymmetricAtomCount": 2, "symmetryOperatorCount": 192,
  "cell": {"a":5.6401,"b":5.6401,"c":5.6401,"alpha":90,"beta":90,"gamma":90,
           "aVec":[5.6401,0,0],"bVec":[0,5.6401,0],"cVec":[0,0,5.6401],"volume":179.42},
  "symops": [{"m":[[1,0,0],[0,1,0],[0,0,1]],"t":[0,0,0],"text":"x,y,z"}],
  "sites": [{"label":"Na1","baseLabel":"Na1","element":"Na","z":11,"frac":[0,0,0],
             "cart":[0,0,0],"occupancy":1,"uiso":0,"hasUiso":false,
             "disorderGroup":"","disorderAssembly":"","siteIndex":0}],
  "atoms": [{"label":"Na1","baseLabel":"Na1","element":"Na","z":11,"frac":[0,0,0],
             "cart":[0,0,0],"occupancy":1,"uiso":0,"hasUiso":false,
             "disorderGroup":"","disorderAssembly":"","siteIndex":0,
             "symmetryIndex":0,"symmetryGenerated":false}],
  "bonds": [{"a":0,"b":4,"length":2.8201,"shift":[0,0,0],"imageOffset":[0,0,0],"periodic":true}],
  "elementCounts": {"11":4,"17":4},
  "center": [2.82005,2.82005,2.82005], "boundRadius": 6.1
}
```

（示例只展示 1 个 site/atom/bond；`symops` 实际为 192 条。）

### 1.9 `CL.ParseError`

```ts
class ParseError extends Error { name = 'ParseError'; message: string; line: number; }
```
- `line`：1 起；未知/非行相关问题为 0。
- 解析器失败时**抛** `ParseError`（CONTRACT §3）；C++ 的返回 `{ok,error}` 改为异常。
- 编辑类 API 不抛异常，返回 `{ok:true, structure}` / `{ok:false, error:string}`。

---

## 2. 数学约定

### 2.1 常量（`Math.h`）

| 常量 | 值 | 用途 |
|---|---|---|
| `kPi` | `3.14159265358979323846` | π |
| `kDegToRad` | `kPi / 180` | 度→弧度 |
| `kRadToDeg` | `180 / kPi` | 弧度→度 |
| 归一化 eps | `1e-15` | `Normalize`：`len > 1e-15` 才除，否则返回零向量 |
| `Wrap01` 吸附 | `1e-12` | `r >= 1-1e-12` → 0 |
| `NearlyEqual` 默认 eps | `1e-6` | 通用近似比较 |
| 对称展开去重容差 | `1e-3` Å | `ExpandAsymmetricUnit(tolerance=1e-3)` |
| 成键默认容差 | `1.20` | `BuildBonds(tolerance=1.20)` |
| 成键最小距离 | `0.42` Å | 距离 < 0.42 视为重合/无效，不成键 |
| 超胞面吸附 eps | `1e-7`（分数） | 边界像判定（§8） |
| 多面体 eps | `1e-6` | 去重/共面/退化判定（§9） |
| 文件大小上限 | `128 * 1024 * 1024` byte | `ReadTextFile` |

### 2.2 由 a,b,c,α,β,γ 构造晶格向量（`Cell::SetFromParameters`）

**角度约定**：α = b 与 c 的夹角，β = a 与 c 的夹角，γ = a 与 b 的夹角。构造上三角基：

```
aVec = (a, 0, 0)
bVec = (b·cosγ, b·sinγ, 0)
c_x  = c·cosβ
c_y  = c·(cosα − cosβ·cosγ) / sinγ
cz2  = c² − c_x² − c_y²
cVec = (c_x, c_y, sqrt(cz2))
```

**逐步校验（顺序固定，错误文本固定）**：

| 步骤 | 条件 | 失败结果（C++ 文本） |
|---|---|---|
| 1 | `a>0 && b>0 && c>0` 且 6 个输入均 `isFinite` | `"晶胞参数必须是正数"` |
| 2 | `0 < alpha,beta,gamma < 180`（严格） | `"晶胞角必须在 0° 与 180° 之间"` |
| 3 | `|sinγ| >= 1e-10` | `"晶胞角组合退化"` |
| 4 | `cz2 > 1e-12` | `"晶胞参数不能构成有效晶胞"` |
| 5 | `volume` 有限且 `> 1e-9` | `"晶胞体积为零"` |

全部通过才写回 `a,b,c,α,β,γ,aVec,bVec,cVec,volume`，`valid = true`。
**幂等性**：失败时对象不变（JS 实现应先构造临时对象再赋值，或返回 null）。

伪代码（JS）：

```js
function buildCell(a,b,c,al,be,ga) {
  if (!(a>0 && b>0 && c>0) || ![a,b,c,al,be,ga].every(Number.isFinite)) return err('CELL_POSITIVE');
  if (!(al>0 && al<180 && be>0 && be<180 && ga>0 && ga<180)) return err('CELL_ANGLE_RANGE');
  const ca=Math.cos(deg2rad(al)), cb=Math.cos(deg2rad(be)), cg=Math.cos(deg2rad(ga));
  const sg=Math.sin(deg2rad(ga));
  if (Math.abs(sg) < 1e-10) return err('CELL_DEGENERATE');
  const cx=c*cb, cy=c*(ca-cb*cg)/sg, cz2=c*c-cx*cx-cy*cy;
  if (cz2 <= 1e-12) return err('CELL_INVALID');
  const aVec=[a,0,0], bVec=[b*cg,b*sg,0], cVec=[cx,cy,Math.sqrt(cz2)];
  const volume=Math.abs(dot(aVec, cross(bVec,cVec)));
  if (!Number.isFinite(volume) || !(volume>1e-9)) return err('CELL_VOLUME_ZERO');
  return {a,b,c,alpha:al,beta:be,gamma:ga,aVec,bVec,cVec,volume};
}
```

### 2.3 分数 ↔ 笛卡尔

```
fracToCart(cell,f) = aVec*f.x + bVec*f.y + cVec*f.z
det = aVec · (bVec × cVec)
cartToFrac(cell,p) = ( p·(bVec×cVec)/det , aVec·(p×cVec)/det , aVec·(bVec×p)/det )
```
- `|det| < 1e-15` 时 C++ 返回 `{0,0,0}`（防御路径；正常晶胞不会触发）。
- `cartToFrac` 结果**不**自动 Wrap（CIF 的笛卡尔列转分数后可能超出 `[0,1)`；展开时统一 Wrap，见 §6）。

### 2.4 体积

`volume = |aVec · (bVec × cVec)|`。与 `a·b·c·√(1 − cos²α − cos²β − cos²γ + 2cosαcosβcosγ)` 等价。

### 2.5 Wrap 函数（`Math.h`）

```js
// 包到 [0,1)，并把 >= 1-1e-12 吸附到 0
function wrap01(v){ let r=v%1; if(r<0)r+=1; if(r>=1-1e-12)r=0; return r; }
// 包到 [-0.5, 0.5)
function wrapHalf(v){ let r=(v+0.5)%1; if(r<0)r+=1; return r-0.5; }
```
JS `%` 与 C++ `fmod` 符号一致（向零取整），可直接对应。

### 2.6 最小分数位移 `MinimumFractionalDelta`（核心难点，必须逐行复刻）

用途：对称展开去重、CIF 分数坐标去重、`MinimumImageVector`、键长测量。**目标**：给定分数位移 `d`，找整数 `n` 使 `|fracToCart(d+n)|` 最小（三斜胞不能只搜 `[-1,1]^3`）。

C++ 实现分两层：`VisitImageRows` 用"球被晶格面切片"枚举候选行，`MinimumFractionalDelta` 在行内取 x 最近整数并持续缩小半径。基为上三角（`aVec.y=aVec.z=bVec.z=0`，`cVec.z>0`）。

```
MinimumFractionalDelta(d):
  best = wrapHalf(d)                                  # 各分量独立
  if (!cell.valid || alpha==90 && beta==90 && gamma==90) return best   # 正交快速路径
  df = best
  # 种子：先在 b、a 方向各做一次"就近取整"，保证极斜晶胞也有好起点
  seed = df
  seed.y -= round(seed.y + cVec.y*seed.z / bVec.y)
  seed.x -= round(seed.x + (bVec.x*seed.y + cVec.x*seed.z) / a)
  radiusSq = |fracToCart(best)|²
  if (|fracToCart(seed)|² < radiusSq) { best = seed; radiusSq = |fracToCart(seed)|² }
  VisitImageRows(df, radiusSq, onRow)
    onRow(iy, iz, xCenter):
      candidate = { df.x + round(xCenter), df.y+iy, df.z+iz }
      s = |fracToCart(candidate)|²
      if (s < radiusSq) { best = candidate; radiusSq = s }
  return best

VisitImageRows(df, radiusSq, visit):
  radius = sqrt(radiusSq)
  zFirst = ceil(-df.z - radius/cVec.z);  zLast = floor(-df.z + radius/cVec.z)
  for iz in zFirst..zLast:
    fz = df.z + iz; z = cVec.z*fz
    yzRoom = radiusSq - z*z                     # 注意：radiusSq 可被 visit 缩小，故每步重读
    if (yzRoom < 0) continue
    yCenter = -df.y - cVec.y*fz / bVec.y
    yRadius = sqrt(yzRoom)/bVec.y
    for iy in ceil(yCenter-yRadius) .. floor(yCenter+yRadius):
      fy = df.y+iy; y = bVec.y*fy + cVec.y*fz
      room = radiusSq - z*z - y*y
      if (room < 0) continue
      xCenter = -df.x - (bVec.x*fy + cVec.x*fz)/a
      visit(iy, iz, xCenter, sqrt(room)/a)
```

- 行内只需**最近整数** `round(xCenter)`：固定 (iy,iz) 后 `|d+n|²` 对整数 `nx` 是凸二次，最近的整数即最优。
- `radiusSq` 是"当前已知最优"（按引用传递并实时缩小），因此枚举量远小于理论界。
- C++ 用 `double round()`（四舍六入五成双），JS 用 `Math.round`（0.5 向上）——在 1e-9 级差异下不影响结果；移植时若追求逐位一致可实现 `roundHalfEven`。
- `VisitImageRows` 也被成键搜索复用（§7.4），JS 建议实现为内部函数 `visitImageRows(cell, df, radiusSqRef, visitor)`。

**验证用例**（`test_core.cpp` `TestSkewImagesAndGrid`，见 core-cases.md）：`a=2.3,b=19,c=17,α=75,β=72,γ=12`，对 `d=(sin(1.1n),cos(0.7n),sin(0.37n))`（n=1..72），结果长度必须等于穷举 `i∈[-20,20], j∈[-4,4], k∈[-3,3]` 的最小值，误差 ≤ 1e-9；且至少一次 `|d.x - best.x| > 1.5`（说明确实跳出了 3×3×3 邻域）。

### 2.7 最小镜像向量与周期像偏移

```
MinimumImageVector(fromCart, toCart):
  if (!cell.valid) return toCart - fromCart
  df = MinimumFractionalDelta( cartToFrac(toCart - fromCart) )
  return fracToCart(df)

ImageOffset(fromCart, toCart):
  if (!cell.valid) return [0,0,0]
  return MinimumImageVector(fromCart,toCart) - (toCart - fromCart)
```
语义：`toCart + ImageOffset` 是 `to` 在 `from` 附近的最近周期像。渲染画键/测量线时用 `atom.cart + offset`。

### 2.8 晶胞 8 角点 `Corners`

顺序（z 外层、y 中层、x 内层，x 变化最快）：

```
corners[0]=(0,0,0) [1]=(1,0,0) [2]=(0,1,0) [3]=(1,1,0)
corners[4]=(0,0,1) [5]=(1,0,1) [6]=(0,1,1) [7]=(1,1,1)
```
每项为 `fracToCart(cell, corner)`。

### 2.9 去重/容差速查

| 场景 | 判据 |
|---|---|
| 对称展开位置去重 | `|fracToCart(MinimumFractionalDelta(f1-f2))| < 1e-3`（Å） |
| 周期像候选 | 距离 ∈ `[0.42, cutoff]`，`cutoff ≤ 6.0` |
| 多面体配体点去重 | `|p-q|² < (1e-6)²` |
| 多面体共面判定 | `|n·(p-a)| <= 1e-6` 视为共面 |
| 超胞面判定 | `f + t ∈ [0, N]` 且 eps=`1e-7` 分数 |
| `NearlyEqual` | `|a-b| <= 1e-6` |

---

## 3. CIF 解析（`CifParser.cpp`）

入口：`CL.parsers.parseCif(text, fileName) -> StructureData`；失败抛 `CL.ParseError{message,line}`。
只解析**一个**结构块（多块打分选优，见 §3.7）；返回的是"不对称单元 + 显式对称操作"，随后由 `finalize` 展开（§6）。

### 3.1 词法（Tokenizer）

Token：`{ text, line, quoted }`。状态变量：`i`（字符下标）、`line`（1 起）、`atLineStart`（当前行是否尚未遇到任何非换行字符）。

```
i = 0; line = 1; atLineStart = true
若文本以 UTF-8 BOM(U+FEFF) 开头: i = 1（JS 直接 strip BOM）
while i < len:
  c = text[i]
  if c == '\r':  i++; continue                    // 单独 CR 不影响行号，也不改变 atLineStart
  if c == '\n':  line++; i++; atLineStart = true; continue
  if isspace(c): i++; atLineStart = false; continue
  if c == '#':                                     // 注释：跳到此行末尾（\n 由下一轮处理）
      while i < len && text[i] != '\n': i++
      continue
  if c == ';' && atLineStart:  → 分号文本块（§3.1.1）
  if c == '\'' || c == '"':    → 引号 token（§3.1.2）
  → 无引号 token（§3.1.3）
```

关键点：
- `atLineStart` 只在"上一字符是 `\n`"时为真；**行首缩进空格会把 `atLineStart` 置 false**，因此 `;` 必须位于第 0 列才是文本块（与 CIF 规范一致，源码如此）。
- `#` 只在"扫描到一个 token 的起始位置"时开启注释；**无引号 token 内部允许 `#`**（如原子标签 `C#1`、`_atom_site.Cartn_x` 后的值）。
- 行号只由 `\n` 增加。

#### 3.1.1 分号文本块

```
startLine = line; i++                              // 跳过 ';'
if text[i]=='\r': i++
if text[i]=='\n': line++; i++
fieldStart = i
查找 end = 第一个满足 text[i]==';' && (i==fieldStart || text[i-1]=='\n') 的下标
if 找不到: throw ParseError("分号文本字段缺少结束分号", line=startLine)
token.text = cleanText(text[fieldStart..end])       // 折叠空白为单空格、去两端空白
token.quoted = true; token.line = startLine
i = end + 1
while i < len && text[i] != '\n': i++               // 跳过结束分号到行尾的残余
if i < len: line++; i++
atLineStart = true
```
例：`_chemical_name_common\n;\nA title\non two lines\n;` → token.text = `"A title on two lines"`。

#### 3.1.2 引号 token

```
quote = c; startLine = line; i++; start = i; closed = false
while i < len:
  if text[i] == quote && (i+1 == len || isspace(text[i+1])): closed = true; break
  if text[i] == '\n' || text[i] == '\r': break      // 引号不可跨行
  i++
if !closed: throw ParseError("引号字段缺少结束引号", line=startLine)
token.text = text[start..i]                          // 原样保留，不做反转义（CIF 无转义）
token.quoted = true; token.line = startLine; i++
```
- 结束引号的判据是"引号 + 下一字符为空白/文件尾"，因此**单引号内含撇号**可正确解析：`'O'Brien crystal'` → `O'Brien crystal`（撇号后是 `B`，非空白）。
- 引号内换行不允许（报错），因此多行文本只能用分号块。
- 引号内容**已解码**（去掉外层引号），后续不再 strip。

#### 3.1.3 无引号 token

从 `start` 扫到第一个空白字符为止；`token.quoted = false`，`line = startLine`。之后 `atLineStart = false`。
无引号 token 中包含 `#`（如 `C#1`）或 `,`（如 `x,y,z`）都合法。

`cleanText(s)`（用于比较/拼接文本值）：折叠所有空白为单空格并去两端；C++ 实现等价于 `s.replace(/\s+/g,' ').trim()`。

### 3.2 顶层结构解析（blocks / loops / items）

```
blocks = []; current = null
while i < len(tokens):
  tok = tokens[i]
  lower = tok.quoted ? "" : tok.text.toLowerCase()
  if (!tok.quoted && lower.startsWith("data_")):
      blocks.push({name: tok.text.slice(5), items:{}, loops:[]}); current = blocks.at(-1); i++; continue
  if (!current): blocks.push({name:"CIF", ...}); current = blocks.at(-1)
  if (!tok.quoted && lower == "loop_"):  → loop（§3.2.1）
  else if (!tok.quoted && tok.text.length > 1 && tok.text[0] == '_'): → item（§3.2.2）
  else i++                                    // 裸 token / save_ / stop_ 等忽略
```

#### 3.2.1 `loop_`

```
loop = {line: tok.line, headers:[], values:[], rowLines:[]}; i++
while i < len && !tokens[i].quoted && tokens[i].text.length > 1 && tokens[i].text[0]=='_':
    loop.headers.push(tokens[i].text); i++
if (loop.headers.length === 0) throw ParseError("loop_ 之后缺少数据列名", line=loop.line)
ncols = loop.headers.length
opColumn[c] = isSymmetryOperationKey(normKey(headers[c]))
while i < len:
    v = tokens[i]
    if !v.quoted:
        vl = v.text.toLowerCase()
        if (vl=="loop_" || vl=="stop_" || vl=="global_" || vl.startsWith("data_") || vl.startsWith("save_")) break
        if (v.text[0] == '_') break
    col = loop.values.length % ncols
    if (col == 0) loop.rowLines.push(v.line)
    if (opColumn[col]) loop.values.push(readOperation(tokens, iRef))   // §3.5
    else loop.values.push(tokens[i++].text)
if (loop.values.length % ncols !== 0) throw ParseError(
    `loop_ 数据项数量与列数不匹配（第 ${loop.line} 行）`, line=loop.line)
current.loops.push(loop)
```
- 列数可以多、值必须整除；**值数少于列数（只有 0 个值时）允许**（RowCount=0）。
- `isSymmetryOperationKey(normKey)` 判定见 §3.5.1；命中列的值用 `readOperation` 拼接。

#### 3.2.2 数据项 `_key value`

```
key = normKey(tok.text)             // 小写，'.' 和 ':' 都替换成 '_'
i++
if (i >= len || (!tokens[i].quoted && (isControlWord(tokens[i]) || tokens[i].text[0]=='_')))
    throw ParseError(`数据项 ${tok.text} 缺少值`, line=tok.line)
if (isSymmetryOperationKey(key)):
    loop = {line: tokens[i].line, headers:[tok.text], values:[], rowLines:[]}
    do { loop.rowLines.push(tokens[i].line); loop.values.push(readOperation(tokens,iRef)) }
    while (i < len && (looksLikeSymmetryExpression(tokens[i].text) || tokens[i].text.includes(',')))
    current.loops.push(loop)
else:
    current.items[key] = {value: tokens[i].text, line: tokens[i].line}; i++
```
`isControlWord(t) = lower(t) ∈ {loop_, stop_, global_} || startsWith(lower,'data_') || startsWith(lower,'save_')`。

### 3.3 单原子/逐行 `_atom_site_*` 兼容

每个 block 解析完后，把该 block 的 `items` 中所有 key 以 `_atom_site_` 开头的项合成一个"伪 loop"（每 key 一个 header、一个值、`rowLines=[最小行号]`），追加到 `block.loops`。这样 `_atom_site.label/_atom_site.Cartn_x/...`（单原子 CIF）也能走统一原子表路径。
`key` 已经是归一化形式（`_atom_site` + `_` + 小写名），与 FindColumn 的归一化匹配一致。

### 3.4 数值解析 `ParseCifNumber`

```js
function parseCifNumber(input) {
  const s = cleanText(input);
  if (!s || s === '?' || s === '.') return null;
  const slash = s.indexOf('/');
  if (slash >= 0) {
    if (s.indexOf('/', slash+1) >= 0) return null;
    const a = parseCifNumber(s.slice(0,slash)), b = parseCifNumber(s.slice(slash+1));
    if (a === null || b === null || b === 0) return null;
    const out = a/b; return Number.isFinite(out) ? out : null;
  }
  let t = s;
  const open = t.indexOf('(');
  if (open >= 0) {
    const close = t.indexOf(')', open+1);
    if (open === 0 || !isDigit(t[open-1]) || close < 0 || close === open+1 ||
        /[^0-9]/.test(t.slice(open+1, close))) return null;      // 括号内必须全数字
    if (close+1 !== t.length && t[close+1] !== 'e' && t[close+1] !== 'E') return null;
    t = t.slice(0,open) + t.slice(close+1);
  }
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}
```

| 输入 | 结果 | 说明 |
|---|---|---|
| `1.234` | 1.234 | |
| `1.234(5)` | 1.234 | 标准不确定度被丢弃 |
| `1.000(2)e1` | 10.0 | 保留指数（测试用例 `_cell.length_a 1.000(2)e1`） |
| `1/3`、`-2/3`、`1 / 3` | 0.3333 / -0.6667 | 分数（CleanText 后空格仍在，但左右再解析会 trim） |
| `?`、`.` | null | 缺失值 |
| `inf/2` | null | 非有限（测试要求 bad CIF 在此行报错） |
| `1.2(3)4` | null | `)` 后只能是 `e/E` 或结束 |
| `1/2/3` | null | 只允许一个 `/` |

### 3.5 对称操作提取

#### 3.5.1 判定函数

```js
function isSymmetryOperationKey(k /* 已 normKey */) {
  if (k.includes('equiv_pos_as_xyz')) return true;
  if (k.includes('symop') && k.includes('xyz')) return true;
  return k.includes('operation_xyz');
}
function looksLikeSymmetryExpression(s) {
  let commas = 0, hasVar = false;
  for (const c of s) {
    if (c === ',') commas++;
    else if ('xXyYzZ'.includes(c)) hasVar = true;
    else if (/[0-9+\-*/.\s()]/.test(c)) continue;
    else return false;
  }
  return commas === 2 && hasVar;
}
```

#### 3.5.2 `readOperation`（无引号/空格分隔的 x,y,z 拼接）

CIF 循环行可能允许把一条操作拆成多 token 甚至写成 `x, y, z`（源码测试 `TestUnquotedSymmetry`）。**只有对称操作列的值**走此函数：

```
readOperation(tokens, iRef):
  start = tokens[iRef++]; op = start.text
  if (start.quoted) return op
  if (looksLikeSymmetryExpression(op) && op[op.length-1] !== ',') return op
  end = iRef.current
  while (end < len && tokens[end].line === start.line && !tokens[end].quoted):
      part = tokens[end].text
      if (/[^xXyYzZ0-9+\-*/.(),]/.test(part)) break     // 含非法字符：不拼
      op += ' ' + part; end++
      if (looksLikeSymmetryExpression(op) && op[op.length-1] !== ','):
          if (end < len && tokens[end].line === start.line && (tokens[end].text === '+' || tokens[end].text === '-'))
              continue                                   // 末尾还有独立 +/-，继续拼
          if (op[op.length-1] === '+' || op[op.length-1] === '-') continue
          iRef.current = end; return op
  return start.text                                       // 拼不完整：只返回首 token
```
- 拼完一条后 `iRef` 停在**下一个未消费 token**；循环继续下一行/列。
- 单行内 `x, y, z` → `"x, y, z"`；`-x, -y, -z` → `"-x, -y, -z"`。
- 同一行后面若紧跟 loop 的其它列（如 `_symmetry_equiv_pos_site_id` 在前），只有本列值被拼接。

#### 3.5.3 找到对称操作循环 `FindSymmetryLoop`

1. 第一遍：任一 loop 的任一 header 满足 `normKey` 含 `"symop"` 且含 `"xyz"`，或含 `"equiv_pos_as_xyz"` → 返回该 loop 与该列。
2. 第二遍：任一 header 含 `"operation_xyz"` → 返回。
3. 都没有 → `null`（再看单值 item，见 §3.9）。

#### 3.5.4 `ParseSymmetryOperation`

```
parseSymmetryOperation(rawText):
  body = stripLeadingOperationNumber(rawText)
  body = body.trimEnd()
  if (body === '') throw "空的对称操作"
  parts = split(body, ',' , depth=0)          // 括号内的逗号不切
  if (parts.length !== 3) throw "对称操作必须包含 x,y,z 三个分量"
  for i in 0..2: linear = exprParse(parts[i]); m[i][j] = linear.c[j]; t[i] = linear.k
  return {m, t, text: body}                  // text 不含前导编号
```

`stripLeadingOperationNumber`：跳前导空白与连续数字；若数字后跟空白，且空白后的字符 ∈ `{x,y,z,-,+,(,数字}`，则去掉"数字+空白"前缀。例：`"1 x,y,z"` → `"x,y,z"`；`"1x,y,z"`（数字后无空格）**不**剥离（会解析失败）。

表达式文法（递归下降，`Linear = {c:[3], k:number}`）：

```
Expr  := Term (('+'|'-') Term)*
Term  := Factor (('*'|'/') Factor)*
Factor:= ['+'|'-'] Factor | '(' Expr ')' | 'x'|'y'|'z' | Number
Number:= [0-9]* ('.' [0-9]*)?        // 只允许一个小数点；'.' 单独出现非法
```
语义与错误：
| 情况 | 行为 |
|---|---|
| `*` 两侧都含变量 | 失败 `"对称操作中出现非线性乘积"` |
| `/` 右侧非常量或常量为 0 | 失败 `"对称操作中出现非法除法"` |
| 非法字符 | `"对称操作中出现未知字符"` |
| 表达式在因子处结束 | `"对称操作表达式不完整"` |
| 括号不配对 | `"对称操作中括号不匹配"` |
| 数字 token 为空或 `.` | `"对称操作中的数字无效"` |
| 解析结束仍未消费完 | `"对称操作表达式无法解析"` |

大小写不敏感（`x/X/y/Y/z/Z` 均可）；**不支持隐式乘法**（`2x` 非法）、不支持函数。

合法示例（与测试一致）：
- `x,y,z` → m=I, t=0
- `-y, x-y, z+1/6` → `m[0][1]=-1, m[1][0]=1, m[1][1]=-1, t.z=1/6`
- `x-y, -x, -z+2/3`
- `1 x,y,z`（带编号）

### 3.6 元数据与晶胞

#### 3.6.1 识别的 tag（完整清单）

| 用途 | 归一化 key（`normKey`：小写 + `.`/`:`→`_`） |
|---|---|
| 标题 | `_chemical_name_common`, `_chemical_name_mineral`, `_chemical_name_systematic`, `_struct_title`（按序取第一个非空） |
| 化学式 | `_chemical_formula_sum`, `_chemical_formula_moiety` |
| 空间群名 | `_space_group_name_h-m_alt`, `_symmetry_space_group_name_h-m`, `_space_group_name_h-m`, `_symmetry_space_group_name_h-m_alt`, `_space_group_name_hall`, `_symmetry_space_group_name_hall` |
| 空间群号 | `_space_group_it_number`, `_symmetry_int_tables_number` → `spaceGroup = "#" + cleanText(value)` |
| 晶胞长度 | `_cell_length_a`, `_cell_length_b`, `_cell_length_c` |
| 晶胞角 | `_cell_angle_alpha`, `_cell_angle_beta`, `_cell_angle_gamma` |
| 对称操作（单值） | `_space_group_symop_operation_xyz`, `_symmetry_equiv_pos_as_xyz` |
| 原子循环列 | `_atom_site_label`, `_atom_site_label_atom_id`, `_atom_site_id`（label 备选）；`_atom_site_type_symbol`；`_atom_site_fract_x/y/z`；`_atom_site_cartn_x/y/z`；`_atom_site_occupancy`；`_atom_site_u_iso_or_equiv`；`_atom_site_disorder_group`；`_atom_site_disorder_assembly`；`_atom_site_pdbx_pdb_model_num` |
| 对称循环列 | header 满足 §3.5.1（子串匹配，因此 `_space_group_symop.operation_xyz`、`_symmetry_equiv_pos_as_xyz` 都命中） |

- 原子列匹配是**归一化后的精确相等**（`_atom_site.Cartn_x` → `_atom_site_cartn_x`）。
- 循环列（symmetry）用**子串**匹配。
- 单值 item 重复出现时**后者覆盖**（C++ `unordered_map` 赋值）。

#### 3.6.2 标题/化学式/空间群

- `title` = 上述 4 键第一个非空（`cleanText`）；仍空 → `block.name || "CIF structure"`。
- `formula` = `_chemical_formula_sum` 或 `_chemical_formula_moiety`（`cleanText`）；空则留空（finalize 时用 cellContents 回填，§13.1）。
- `spaceGroup` = 上述 6 键第一个非空；仍空则 IT 号拼 `#n`。
- `blockName` = `data_` 后原文（大小写保留）。

#### 3.6.3 晶胞

```
haveA = parse(_cell_length_a) 有效; haveB/haveC 同理
anyCell = 6 个 cell 长度/角度 item 中任意一个存在
if (haveA && haveB && haveC):
    alpha=beta=gamma=90
    for key in [alpha,beta,gamma]:
        item = find(key)
        if (!item) continue                      // 缺角度 → 保留 90
        v = parseCifNumber(item.value)
        if (v === null) throw ParseError(`${key} 晶胞角无效`, line=item.line)
        angle = v
    cell = buildCell(...)  // §2.2
    if (!cell) throw ParseError(`无效晶胞参数：${cellError}`, line=最后角度 item 行号, 可为 0)
else if (anyCell):
    throw ParseError("晶胞参数不完整（需要 a、b、c）")
else:
    cell = null                                  // 分子语义（后续 note）
```

### 3.7 结构块选择

```js
// 每个 block:
score = {
  cell: a,b,c 均解析成功,
  atoms: findAtomLoop(block)?.rowCount ?? 0,
  hasCoordinates: atoms > 0,
  hasSymmetry: findSymmetryLoop(block) != null,
};
quality = (cell?1000:0) + Math.min(atoms,1000)*2 + (hasSymmetry?20:0);
// 只在 hasCoordinates 的块中比较；取 quality 最大，平局取靠前者（仅 > 时替换）
// 全无 → throw ParseError("CIF 中未找到包含坐标的原子表")
```
`findAtomLoop(block)`：遍历 loop，
- `hasFrac = 三列 _atom_site_fract_x/y/z 都存在`，`hasCartn = 三列 _atom_site_cartn_x/y/z 都存在`；
- 二者皆无 → 跳过；
- 必须有 label 备选列（`_atom_site_label|_atom_site_label_atom_id|_atom_site_id`）或 `_atom_site_type_symbol`；
- 取 `RowCount() = rowCount = floor(values.length / ncols)` **最大**的 loop（平局取靠前）。

选中块后：`out = 空 StructureData`（除 format 外重置），`blockName`、标题/化学式/空间群按 §3.6。
若有 **>1** 个含坐标的块 → 末尾 note `" CIF 包含多个结构数据块，已载入原子数最多的块。"`（注：实际是 quality 打分，文案如此）。

### 3.8 原子表解析

列下标：`labelCol/typeCol/fxCol/fyCol/fzCol/cxCol/cyCol/czCol/occCol/uisoCol/groupCol/assemblyCol/modelCol`（分别用 §3.6.1 的列名列表 `findColumn`）。

```
useFrac = 三列 fract 存在; useCart = 三列 cartn 存在
if (!useFrac && !useCart) throw "原子表缺少完整的分数坐标或笛卡尔坐标列"
if (useFrac && !useCart && !cell) throw "原子使用分数坐标，但 CIF 缺少晶胞参数"

model = modelCol>=0 ? loop.get(0, modelCol) : ""
multipleModels = false
for row in 0..rowCount-1:
    if (modelCol>=0 && loop.get(row,modelCol) !== model) { multipleModels = true; continue; }
    atom = new Site()
    if (labelCol>=0) atom.label = cleanText(get(row,labelCol))
    type = typeCol>=0 ? get(row,typeCol) : ""
    hasType = type!=="" && type!=="." && type!=="?"
    atom.element = normalizeElementSymbol(hasType ? type : atom.label)   // §7.1
    atom.z = elementBySymbol(atom.element).z
    atom.element = symbolOf(atom.z)                  // 未识别 → "X"
    if (!atom.label) atom.label = atom.element + (row+1)   // 注意是行号+1，不是元素计数
    atom.baseLabel = atom.label
    // 坐标（“优先完整分数坐标，否则该行完整笛卡尔坐标”）
    if (useFrac && cell && parse3(get,row,fxCol,fyCol,fzCol)) {
        atom.frac = parsed; atom.cart = fracToCart(cell, atom.frac);
    } else if (useCart && parse3(get,row,cxCol,cyCol,czCol)) {
        atom.cart = parsed; if (cell) atom.frac = cartToFrac(cell, atom.cart);
    } else {
        throw ParseError(`原子 ${atom.label} 缺少有效的完整坐标`, line=loop.rowLines[row])
    }
    if (groupCol>=0)    atom.disorderGroup    = get(row,groupCol)      // 原样，不 trim
    if (assemblyCol>=0) atom.disorderAssembly = get(row,assemblyCol)
    if (occCol>=0)  { const v = parseCifNumber(get(row,occCol)); if (v!==null) atom.occupancy = v; }
    if (uisoCol>=0) { const v = parseCifNumber(get(row,uisoCol)); if (v!==null) { atom.uiso = v; atom.hasUiso = true; } }
    out.sites.push(atom)
if (out.sites.length === 0) throw ParseError("CIF 原子表为空")
```
注意：
- 分数坐标**此处不 Wrap**（保留解析值；展开阶段统一 Wrap）。
- `occupancy` 解析失败保留 1.0，不做区间校验/裁剪。
- 多模型：以**首行**的 model 值为准；不同值行跳过；只有存在被跳过行才记 note。

解析完原子后按顺序追加 note：
1. `multipleModels` → `" 文件包含多个模型，已载入首个模型 " + model + "。"`
2. `cell === null` → `" 未发现完整晶胞参数，按非周期性分子结构显示。"`（注意此条**无前导空格**）

### 3.9 对称操作提取流程

```
xyzColumn = -1
symLoop = findSymmetryLoop(block, xyzColumn)
if (symLoop):
    seen = Set()
    for row in 0..rowCount-1:
        value = trim(symLoop.get(row, xyzColumn))
        if (value==="" || value==="." || value==="?") continue
        op = try parseSymmetryOperation(value)
        if (失败): note += " 有一个对称操作无法解析，已跳过：" + err + "。"; continue
        canonical = op.text.toLowerCase()
        if (!seen.has(canonical)) { seen.add(canonical); out.symops.push(op) }
else:
    item = findItem([_space_group_symop_operation_xyz, _symmetry_equiv_pos_as_xyz])
    if (item):
        op = try parseSymmetryOperation(item.value)
        if (ok) out.symops.push(op)
        else note += " 对称操作无法解析，已忽略：" + err + "。"
out.symmetryOperatorCount = out.symops.length
if (out.cell && out.symops.length === 0)
    note += " CIF 未提供对称操作，仅显示不对称单元。"
```
- 去重键 = `lower(op.text)`（**不**归并空白，因此 `x, y, z` 与 `x,y,z` 视为不同操作）。
- 空间群只给名称/编号而没有操作时：**不推断**空间群操作，保持空 `symops` → 展开用单位操作，仅显示不对称单元，并给出上面最后一条 note（这正是"空间群只给名称无操作"的处理，也是 v1.1 的已知限制，测试 `TestCifCompatibility` 依赖它）。

### 3.10 CIF 全部错误/警告文本

| 类型 | 文本 | 触发 |
|---|---|---|
| 抛错 | `分号文本字段缺少结束分号` | 分号块未闭合（line=起始行） |
| 抛错 | `引号字段缺少结束引号` | 引号跨行/未闭合 |
| 抛错 | `loop_ 之后缺少数据列名` | loop_ 后无 `_` 列头 |
| 抛错 | `loop_ 数据项数量与列数不匹配（第 N 行）` | 值数不整除列数（line=N=loop_ 行） |
| 抛错 | `数据项 X 缺少值` | item 后无合法值 |
| 抛错 | `CIF 中未找到包含坐标的原子表` | 没有任何含坐标块 |
| 抛错 | `晶胞参数不完整（需要 a、b、c）` | 有部分 cell 项 |
| 抛错 | `KEY 晶胞角无效` | 角度项存在但无法解析 |
| 抛错 | `无效晶胞参数：<原因>` | buildCell 失败（line=0 或最后角度行） |
| 抛错 | `CIF 中没有可读取的 _atom_site 坐标循环` | findAtomLoop 失败（二次检查） |
| 抛错 | `原子表缺少完整的分数坐标或笛卡尔坐标列` | 无完整坐标三元组 |
| 抛错 | `原子使用分数坐标，但 CIF 缺少晶胞参数` | |
| 抛错 | `原子 X 缺少有效的完整坐标` | 某行坐标解析失败 |
| 抛错 | `CIF 原子表为空` | |
| 抛错 | `CIF 文件为空` | 无 token |
| 抛错 | `CIF 中没有 data_ 数据块` | 理论不可达（防御） |
| note | ` 文件包含多个模型，已载入首个模型 X。` | 多模型 |
| note | ` 未发现完整晶胞参数，按非周期性分子结构显示。` | 无晶胞 |
| note | ` 有一个对称操作无法解析，已跳过：<err>。` | 循环中的坏操作 |
| note | ` 对称操作无法解析，已忽略：<err>。` | 单值坏操作 |
| note | ` CIF 未提供对称操作，仅显示不对称单元。` | 有晶胞无操作 |
| note | ` CIF 包含多个结构数据块，已载入原子数最多的块。` | 多块含坐标 |

---

## 4. XYZ 解析（`XyzParser.cpp`）

```
parseXyz(text):
  lines = splitLines(text)            // 去 \r；末尾无换行的最后一行也保留（若非空）
  cursor = 0
  while cursor < lines.length && isBlank(lines[cursor]): cursor++
  if (cursor >= lines.length) throw "XYZ 文件为空"
  countText = trim(lines[cursor])
  n = parseIntStrict(countText)        // 整 token 必须完全匹配；0 <= n <= 1_000_000
  if (失败) throw ParseError("XYZ 第一行必须是原子数", line=cursor+1)
  cursor++
  comment = cursor < lines.length ? trim(lines[cursor++]) : ""
  out.format='xyz'; out.title = comment || "XYZ molecule"; out.periodic=false; out.cell=null
  parsed = 0
  for (; cursor < lines.length && parsed < n; cursor++):
      line = lines[cursor]
      hash = line.indexOf('#'); if (hash>=0) line = line.slice(0,hash)
      if (isBlank(line)) continue
      tok = splitWhitespace(line)      // 至少 4 个
      if (tok.length < 4) throw ParseError("XYZ 原子行需要元素符号和三个坐标", line=cursor+1)
      x=parseDouble(tok[1]); y=...; z=...
      if (任一失败) throw ParseError("XYZ 坐标不是有效数字", line=cursor+1)
      atom.label = atom.baseLabel = tok[0]
      const e = elementFromInput(tok[0])   // 支持符号或原子序数（§7.1）
      if (e) { atom.z = e.z; atom.element = e.symbol } else { atom.z = 0; atom.element = "X" }
      atom.cart = [x,y,z]; atom.frac = [0,0,0]
      out.sites.push(atom); parsed++
  if (out.sites.length === 0) throw "XYZ 文件中没有可读取的原子"
  if (parsed !== n) note += `XYZ 声明了 ${n} 个原子，实际读取 ${parsed} 个。`
  if (out.sites.length > 30000) { out.sites.length = 30000; out.truncated = true; note += " 原子数超过限制，显示已截断。" }
  out.atoms = out.sites.slice()        // 随后 finalize(expand=false) 会再同步
```
要点：
- 原子序数支持：`8 0 0 0` → O（`elementFromInput("8")`）；未知符号（如 `X`）→ `z=0, element="X"`（测试：`atoms[1].z===0`）。
- 声明数超过实际行数：**不报错**，只加 note；多余行（parsed 达到 n 后）忽略。
- 注释行只在 `#` 处裁剪（`#` 后可跟任意文字）；元素 token 不允许为原子序数以外的数字以外格式。
- `countText` 必须是**纯整数**（`strtol` 全消费 + 尾随空白），`3 abc` 会失败；`-1`/`1000001` 失败。
- 分子语义：`cell=null`，`periodic=false`，后续不展开对称；成键只在原子间直接判定（§7.6）。
- 文本编码：JS 端由 `File.text()` 得到 UTF-8 字符串并 strip BOM；无需 ACP 回退。

## 5. VESTA 解析（`VestaParser.cpp`）

逐行读取（去 `\r`），`trim` 后按整行关键字分派；块内循环读取。关键字必须**整行等于**（trim 后）：`CRYSTAL`、`TITLE`、`CELLP`、`GROUP`、`SYMOP`、`STRUC`、`THERI`、`UCOLP`、`COMPS`、`VESTA_FORMAT_END` 等；`#VESTA_FORMAT_VERSION...` 行忽略。

```
lines = splitLines(text); out = 空 StructureData(format='vesta')
haveCell=false; crystalCount=0; groupLine=""
for i in 0..lines.length-1:
  line = trim(lines[i]); if (line==="") continue
  if (line === "CRYSTAL"): { crystalCount++; if (crystalCount>1 && haveCell) break; continue }
  if (line.startsWith("#VESTA_FORMAT_VERSION") || line.startsWith("VESTA_FORMAT_VERSION")) continue
  if (line === "TITLE"):
      for j=i+1..: if (trim(lines[j]) !== "") { out.title = trim(lines[j]); i=j; break }
      continue
  if (line === "CELLP"):
      for j=i+1..:
          tok = splitWhitespace(lines[j])
          if (tok.length < 6) continue                       // 跳过过短行
          if (任一 tok[0..5] 解析失败) continue                // 跳过非参数行
          cell = buildCell(tok[0..5])
          if (!cell) throw ParseError("VESTA 晶胞参数无效："+err, line=j+1)   // 注意：硬错误
          out.cell = cell; haveCell = true; i=j; break
      continue
  if (line === "GROUP"):
      for j=i+1..: if (trim(lines[j]) !== "") { groupLine = trim(lines[j]); i=j; break }
      continue
  if (line === "SYMOP"):
      for j=i+1..:
          cand = trim(lines[j]); if (cand==="") continue
          if (looksLikeSection(cand)) break                  // 全大写行 = 下一节
          tok = splitWhitespace(cand); if (tok.length < 12) break
          vals[0..11] = 12 个 double（任一失败 → break）
          op.t = vals[0..2]
          op.m[r][c] = vals[3 + r*3 + c]                     // 行优先，前 3 个是 m[0][*]
          // 旋转矩阵全零 → 丢弃该行（不计入 ops）
          if (rotation 有非零元素) { op.text = 按 §5.2 生成; out.symops.push(op) }
          i = j
      continue
  if (line === "STRUC"):
      for j=i+1..:
          cand = trim(lines[j]); if (cand==="") continue
          if (looksLikeSection(cand)) break
          tok = splitWhitespace(cand); if (tok.length < 7) continue     // 跳过 STRUC 续行
          if (allZero(tok)) break                                        // 全 0 行 = 结束
          index = parseInt(tok[0]); if (失败) continue
          if (!isAlpha(tok[1][0])) continue
          occupancy = parseDouble(tok[3]); x=parseDouble(tok[4]); y=tok[5]; z=tok[6]
          if (任一失败) continue
          atom.element = normalizeElementSymbol(tok[1]); atom.z = elementBySymbol(...).z
          atom.element = symbolOf(atom.z)
          atom.label = tok[2] || (atom.element + index)
          atom.baseLabel = atom.label; atom.occupancy = occupancy
          atom.frac = [x,y,z]; atom.siteIndex = index>0 ? index-1 : 0
          if (out.cell) atom.cart = fracToCart(out.cell, atom.frac)
          out.sites.push(atom); i = j
      continue
  // 其它关键字（THERI/UCOLP/COMPS/VESTA_FORMAT_END/未知）忽略
```

**块终止判定** `looksLikeSection(line)`：trim 后非空、首字符为大写字母、且整行**不含小写字母**。因此 `STRUC`、`SYMOP`、`THERI 1`、`UCOLP`、`VESTA_FORMAT_END` 都是节；` 1 Na Na1 ...` 不是。

`allZero(tokens)`：所有 token 都能解析为 double 且 `|v| <= 1e-12`（且非空）。`STRUC` 的 `0 0 0 0 0 0 0` 结束行即靠它。

收尾：
```
if (!haveCell || !out.cell) throw "VESTA 文件中缺少有效的 CELLP 晶胞参数"
if (out.sites.length === 0) throw "VESTA 文件中没有可读取的 STRUC 原子"
if (groupLine):
    fields = groupLine 按空白切分并解析 "number setting 名称..." 
    若 1 <= number <= 230 且 setting 为整数:
        name = 剩余文本（trim）; out.spaceGroup = name || ("#" + number)
    else out.spaceGroup = groupLine          // 解析失败保留整行
out.periodic = true
out.title = out.title || "VESTA structure"
out.symmetryOperatorCount = out.symops.length
if (out.symops.length === 0) note += " VESTA 文件未包含 SYMOP 对称操作，仅显示不对称单元。"
```

### 5.1 SYMOP 行格式

每行至少 12 个数值：`tx ty tz m00 m01 m02 m10 m11 m12 m20 m21 m22 [额外 token 忽略]`（VESTA 3.5 会在末尾再跟一个 `1`，忽略）。
矩阵**行优先**：`m[0][0..2] = vals[3..5]`。旋转全零的行（如 `-1 -1 -1 0 0 0 0 0 0 0 0 0`）跳过。

### 5.2 生成 `op.text` 的精确规则（导出/回环依赖）

```
text = ""
for r in 0..2:
    if (r) text += ','
    term = false
    for c in 0..2:
        k = m[r][c]; if (k === 0) continue
        if (k < 0) text += '-'; else if (term) text += '+'
        if (Math.abs(k) !== 1) text += formatFixed12(Math.abs(k)) + '*'
        text += "xyz"[c]; term = true
    if (t[r] !== 0 || !term):
        if (term && t[r] > 0) text += '+'
        text += formatFixed12(t[r])
```
`formatFixed12` = `toFixed(12)`（C++ `std::fixed << setprecision(12)`）。
例：单位操作 → `"x,y,z"`；`t=(0,0.5,0.5)` → `"x+0.500000000000,y+0.500000000000,z"`。
注意：平移 0 且项存在时不写 `+0`；无项时写 `0`（如 `"0+x,y,z"` 的可能性极低）。

### 5.3 VESTA 注意点

- `CELLP` 块内：**先**找"≥6 个 token 且 6 个都能解析为 double"的行；若该行数值非法（如全零）→ 直接报错（不是跳过）。VESTA 的标准文件第二行 `0 0 0 0 0 0` 因为第一行已成功而不会被读取。
- 原子 `siteIndex = index-1` 只是 VESTA 的序号提示，`finalize`/展开会覆盖 Atom 的 `siteIndex`（Site 的 siteIndex 以数组下标为准）。
- VESTA 不提供 formula/blockName；`formula` 在 finalize 时由 cellContents 回填。`sourceName` 由加载层填。
- 一个文件含多个 `CRYSTAL` 块时只取第一个（`crystalCount>1 && haveCell` → break）。
- `STRUC` 的续行（如 B 矩阵/占位行，token < 7）被跳过；不要把它们当原子。

---

## 6. 对称展开（`ExpandAsymmetricUnit`）

输入：`sites` + `symops` + `cell`；输出：`atoms`（单胞内全部原子）、`symmetryExpanded`、`symmetryOperatorCount`、`truncated`。**幂等**：每次都从 `sites` 重新生成 `atoms`，绝不拿旧 `atoms` 迭代。

```
expand(structure, tolerance = 1e-3):
  // ① 非周期/空位点：直接拷贝
  if (!structure.cell || structure.sites.length === 0):
      structure.atoms = structure.sites.map(clone)
      for i, atom in atoms: if (!atom.baseLabel) atom.baseLabel = atom.label; atom.siteIndex = i
      structure.symmetryExpanded = false
      structure.truncated = false
      return

  // ② 操作表：无显式操作 → 用单位操作（不改变 symmetryExpanded）
  ops = structure.symops.slice()
  if (ops.length === 0) ops.push(identityOp)      // m=I, t=0, text="x,y,z"
  else structure.symmetryExpanded = true

  structure.atoms = []
  structure.truncated = false

  for siteIndex in 0..sites.length-1:
    src = sites[siteIndex]
    if (src.occupancy <= 0) continue              // 整组位点跳过

    positions = []; opIndices = []
    for oi in 0..ops.length-1:
      frac = wrap01(applySymOp(ops[oi], src.frac))     // 每个分量 Wrap01
      dup = false
      for old in positions:
        delta = minimumFractionalDelta(cell, frac - old)          // §2.6
        if (|fracToCart(cell, delta)| < tolerance) { dup = true; break }
      if (!dup) { positions.push(frac); opIndices.push(oi) }
    if (positions.length === 0) continue          // 理论不可达

    for copy in 0..positions.length-1:
      if (structure.atoms.length >= 30000) { structure.truncated = true; break }
      atom = clone(src)
      atom.frac = positions[copy]
      atom.cart = fracToCart(cell, atom.frac)
      atom.siteIndex = siteIndex
      atom.symmetryIndex = opIndices[copy]
      atom.symmetryGenerated = (opIndices[copy] !== 0)
      if (!atom.baseLabel) atom.baseLabel = atom.label
      atom.label = (positions.length > 1) ? atom.baseLabel + "_" + (copy + 1) : atom.baseLabel
      structure.atoms.push(atom)
    if (structure.truncated) break

  if (structure.truncated):
      structure.truncated = true
      structure.note += " 原子数超过 30,000，显示已截断。"
  structure.symmetryOperatorCount = structure.symops.length === 0 ? 1 : structure.symops.length
```

**去重语义**（关键）：
- 判据：位置差先过 `minimumFractionalDelta`（周期等价），再取笛卡尔长度 `< 1e-3 Å` 视为同一位置。
- 只与**已接受**的位置比较 → 保留首个生成该位置的操作下标（`symmetryIndex` = 首个命中的操作）。
- 特殊位置（如 NaCl 中位于反演中心/面的位点）自动降重；例如 3 条操作（identity、inversion、`+1/2` 平移）作用在 `(0,0,0)` → 2 个位置（测试 `TestDuplicatePositions`）。
- 位点只生成 1 个位置时 `label = baseLabel`；多位置时 `label = baseLabel + "_" + (copy+1)`。
- `occupancy <= 0` 的位点在展开阶段整组不生成原子（即使 >0 也只影响显示，不做归一化）。

**边界情况**：
| 情况 | 行为 |
|---|---|
| `cell` 无效（分子/缺晶胞 CIF） | `atoms = sites`（浅拷贝），`symmetryExpanded=false`，不展开 |
| `sites` 为空 | 同上，`atoms=[]` |
| `symops` 为空但有晶胞 | 用单位操作，`symmetryExpanded` 保持 false |
| 显式操作非空 | `symmetryExpanded=true` |
| 原子数超 30000 | 截断 + `truncated=true` + note |
| 位点坐标在 `[0,1)` 外 | 展开时 `wrap01` 规范化 |

**流程编排 `FinalizeStructure(structure, expandSymmetry)`**（解析后 / 编辑后都调用）：

```
finalize(structure, expandSymmetry):
  if (structure.cell):
      for site in sites:
          if (!site.baseLabel) site.baseLabel = site.label
          site.cart = fracToCart(cell, site.frac)        // 以 frac 为准
  if (expandSymmetry) expand(structure)
  else:
      structure.atoms = sites.map(clone)
      for i, a in atoms: if (!a.baseLabel) a.baseLabel = a.label; a.siteIndex = i
  structure.periodic = !!structure.cell
  structure.asymmetricAtomCount = structure.sites.length
  computeContents(structure)      // §13.1
  computeBounds(structure)        // §13.2
  buildBonds(structure)           // §7
```
解析器传入 `expandSymmetry = (format !== 'xyz')`；所有编辑 API 恒传 `true`。

---

## 7. 成键 `BuildBonds`（`Crystal.cpp` + `PeriodicTable.cpp`）

### 7.1 元素分类与分类函数（必须逐字复刻）

```js
const NONMETAL = new Set([1,2,6,7,8,9,10,15,16,17,18,34,35,36,53,54,85,86,117,118]);
const METALLOID = new Set([5,14,32,33,51,52,84]);                       // 含 Po(84)
const ALKALI_OR_ALKALINE = new Set([3,4,11,12,19,20,37,38,55,56,87,88]);

isNonMetal(z)      = NONMETAL.has(z)
isMetalloid(z)     = METALLOID.has(z)
isAlkaliOrAlkaline(z) = ALKALI_OR_ALKALINE.has(z)
isMetal(z)         = !isNonMetal(z) && !isMetalloid(z)                  // 碱/碱土也算 metal
category(z)        = z===0 || z>118 ? 'unknown' : isNonMetal(z) ? 'nonmetal'
                                 : isMetalloid(z) ? 'metalloid' : 'metal'
```

**元素符号归一化 `normalizeElementSymbol(raw) -> string`**（CIF/XYZ/VESTA/编辑通用）：

```
s = raw 去掉首部空白和 '_'，去掉尾部空白
if (s === "") return "X"
letters = ""
for c in s:
    if (isAlpha(c)) { if (letters.length < 2) letters += c }
    else if (letters !== "") {
        if (isDigit(c) || c === '+' || c === '-' || c === '(') break
        if (c === '_' || c === '/') break
    }
if (letters === "") return "X"
upper = letters.toUpperCase()
if (upper === "D" || upper === "T") return "H"          // 氘/氚标签
if (letters.length >= 2) {
    two = upper(letters[0]) + lower(letters[1])        // 化学正确写法：CA -> Ca
    if (elementBySymbol(two).z !== 0) return two
}
one = upper(letters[0])
if (elementBySymbol(one).z !== 0) return one
return letters                                          // 未识别（如 "Qq"），后续查表 z=0
```
行为样例（测试 `TestElementNames`）：`Fe3+→Fe`、`O2-→O`、`C1→C`、`CA→Ca`、`13C→C`、`Si→Si`。

**编辑/XYZ 用的 `elementFromInput(text) -> {z,symbol} | null`**：
```
t = trim(text)
if (t === "") 失败（"元素不能为空"）
若 t 是"纯十进制整数"（正整数、整体匹配）且 1<=n<=118 → elementByZ(n)
否则 sym = normalizeElementSymbol(t); e = elementBySymbol(sym)
     e.z === 0 → 失败（"未知元素：" + t）；否则返回 e.z/e.symbol
```

### 7.2 元素对截断 `PairBondCutoff(za, zb)`

```
aNon = isNonMetal(za); bNon = isNonMetal(zb)
aMetal = !aNon && !isMetalloid(za); bMetal = !bNon && !isMetalloid(zb)
ca = elementByZ(za).covalent; cb = elementByZ(zb).covalent

if (aMetal && bMetal):
    if (isAlkaliOrAlkaline(za) || isAlkaliOrAlkaline(zb)) return 0.0   // 碱金属/碱土间不成键
    return ca + cb + 0.12                                              // 金属-金属
if ((aMetal && bNon) || (bMetal && aNon)):
    return ca + cb + 0.35                                              // 金属-非金属（离子性）
return ca + cb + 0.12                                                  // 非金属/类金属之间（严格）
```
返回 0 表示这对元素永不成键（后续 cutoff=0 < 0.42 直接被过滤）。

**分支配套的实际数值（Å）示例**：

| 对 | 分支 | cutoff |
|---|---|---|
| Na–Cl | 金属-非金属：1.66+1.02+0.35 | 3.03 |
| Na–Na / K–K / K–Ni | 含碱/碱土 | 0（不成键） |
| Si–O | 非金属-非金属（Si 非 metal、O 非 metal）：1.11+0.66+0.12 | 1.89 |
| C–C | 非金属-非金属：0.76+0.76+0.12 | 1.64 |
| Bi–Te | 非金属/类金属分支（Bi=metal，Te=metalloid → 两侧都不是"金属-非金属"）：1.48+1.38+0.12 | **2.98**（3.07/3.25 Å 的 Bi–Te 接触因此不成键） |
| Ti–O | 金属-非金属：1.60+0.66+0.35 | 2.61 |
| Ca–F | 金属-非金属（Ca 是金属）：1.76+0.57+0.35 | 2.68 |
| Zn–S | 金属-非金属：1.22+1.05+0.35 | 2.62 |

（Bi–Te 说明：Bi(83) 是 metal；Te(52) 属于 **metalloid**，因此 Bi–Te 两侧都不满足"金属-非金属"分支，落到最后的非金属/类金属分支 `1.48+1.38+0.12 = 2.98 < 3.07 Å`，故 Bi₂Te₃ 中 3.07–3.25 Å 的 Bi–Te 接触不成键。这是 v0.7 的关键修复。）

### 7.3 无序互斥与容差缩放 `PairCutoff`

```
knownGroup(g) = g !== "" && g !== "." && g !== "?"
cutoffFor(a, b):
  if (knownGroup(a.disorderGroup) && knownGroup(b.disorderGroup) &&
      a.disorderAssembly === b.disorderAssembly &&           // 空串==空串也算"同集合"
      a.disorderAssembly !== "?" &&
      a.disorderGroup !== b.disorderGroup) return 0.0        // 同集合不同无序组 → 互斥，不成键
  if (a.z === 0 || b.z === 0) return 0.0
  return clamp(pairBondCutoff(a.z, b.z) * (tolerance / 1.20), 0.0, 6.0)
```
- 默认 `tolerance = 1.20` → 缩放因子 1；`buildBonds(s, 1.0)` 会把所有 cutoff 乘以 1/1.2。
- 上限 6.0 Å（`PairBondCutoff` 最大约 3.4，容差 >2 时会触顶）；`< 0.42` 视为不成立。

### 7.4 候选像搜索

**非周期（`cell === null`）**：

```
for i in 0..n-1: for j in i..n-1:
    cutoff = cutoffFor(atoms[i], atoms[j]); if (cutoff < 0.42) continue
    if (i === j) continue                                 // 分子无自键
    d = |atoms[j].cart - atoms[i].cart|
    if (0.42 <= d <= cutoff) addBond(i, j, shift=[0,0,0])
```

**周期**：对每对 `(i<=j)` 枚举像（含多像，如石墨/金属中的等价邻近距离）：

```
direct = b.cart - a.cart
for tx,ty,tz in 候选整数:
    if (i === j):
        // 自键只保留半个方向：跳过 (tz,ty,tx) <= (0,0,0) 的字典序
        if (lexLE([tz,ty,tx], [0,0,0])) continue
    offset = fracToCart(cell, [tx,ty,tz])
    distSq = |direct + offset|²
    if (distSq < 0.42² || distSq > cutoff² + 1e-12) continue
    if (bonds.length >= 150000) { truncated = true; stop enumeration }
    push Bond{a:i, b:j, shift:[tx,ty,tz], imageOffset:offset,
              length:sqrt(distSq), periodic:true}
```
- 候选枚举用 §2.6 的 `VisitImageRows(cell, b.frac - a.frac, radiusSq=cutoff²+1e-12, visitor)`；visitor 对每个 `(iy,iz)` 行取 `ix ∈ [ceil(xCenter - r/a), floor(xCenter + r/a)]` 逐个 `add(ix,iy,iz)`。
- 自键过滤是 **`[tz,ty,tx]` 字典序 ≤ `[0,0,0]` 就跳过**（注意源码里分量顺序是 tz,ty,tx，虽然看起来像笔误，但必须照抄）。效果：保留 tx>0，或 tx==0&&ty>0，或 tx==ty==0&&tz>0 的像。
- 距离范围是**闭区间近似** `[0.42, cutoff]`（下界严格 `< 0.42*0.42` 才排除；上界 `> cutoff²+1e-12` 排除）。
- `shift` 只作用于 **b 端**；同一对 `(i,j)` 可产生多条 Bond（不同 shift）。
- i<=j 保证无序对只枚举一次；因此无需再去重。

### 7.5 自键（`a === b`）

- 同一原子的周期像可成键（如单原子金属晶胞）。`Bond.a === Bond.b` 合法，`length` = 该周期像距离。
- 仅周期结构产生自键；分子（无晶胞）不产生。
- 测试 `TestSkewImagesAndGrid`：cell `1.5×20×20` 放 1 个 C，默认容差 → 恰好 **1 条自键**，长度 1.5；`BuildBonds(s, 1.0)` 后为 **0 条**（cutoff 1.64/1.2=1.3667 < 1.5）。

### 7.6 编排 `BuildBonds(structure, tolerance=1.20)`

```
buildBonds(s, tolerance=1.20):
  s.bonds = []
  if (s.atoms.length === 0) return
  truncated = false
  s.bonds.reserve(min(s.atoms.length*2, 150000))
  if (s.atoms.length < 1600) buildBruteForce()   // 双循环
  else                      buildGrid()          // 空间网格
  if (truncated) { s.truncated = true; s.note += " 化学键数量过多，已截断显示。" }
  s.bonds.sort(by (a, b, shift[0], shift[1], shift[2]))
```

**网格算法 `BuildBondsGrid`**（n ≥ 1600 时；测试要求与暴力结果**完全一致**）：

```
const CELL = 6.0                                  // 网格边长 Å（cutoff 上限 6）
if (cell):
    // 用"晶面间距"而非棱长作为每轴厚度
    lengths[0] = volume / |bVec×cVec|; lengths[1] = volume / |aVec×cVec|; lengths[2] = volume / |aVec×bVec|
    bins[axis] = clamp(floor(lengths[axis]/CELL), 1, 40)
    for i, atom: f = wrap01(atom.frac)
        x = min(bins[0]-1, floor(f.x*bins[0])); y = ...; z = ...
        binIndex[i] = (z*bins[1] + y)*bins[0] + x
else:
    // 分子：笛卡尔包围盒
    lo/hi = 所有原子 cart 的包围盒; origin = lo; extent = hi - lo
    bins[axis] = clamp(floor(extent[axis]/CELL), 1, 48)
    for i: local = cart - origin
        x = clamp(floor(local.x/max(1e-9,extent.x)*bins[0]), 0, bins[0]-1); ...
        binIndex[i] = ...
把原子放入 cells[binIndex[i]]
first = [-1,-1,-1]; last = [1,1,1]
if (cell):
    for axis: if (bins[axis] <= 2) first[axis] = 0
              if (bins[axis] == 1) last[axis] = 0
for i in 0..n-1:
    (bx,by,bz) = 反解 binIndex[i]
    for dz in first[2]..last[2]: for dy in first[1]..last[1]: for dx in first[0]..last[0]:
        x=bx+dx; y=by+dy; z=bz+dz
        if (cell) { x=(x+bins[0])%bins[0]; y=...; z=... }         // 周期环绕
        else if (越界) continue
        for j in cells[(z*bins[1]+y)*bins[0]+x]:
            if (j < i) continue                                  // 与暴力一致的 i<=j
            considerPair(i, j); if (truncated) return
```
- 网格只做**候选筛选**：命中后仍走 §7.4 的完整像搜索（`considerPair`），因此结果与暴力一致（测试 `TestSkewImagesAndGrid` 用 1600 个惰性占位原子强制走网格并逐条比对 `a/b/shift`）。
- 占位原子的 `z=0` → `cutoffFor` 返回 0 → 不产生键。

### 7.7 成键结果参考值（必须一致）

| 结构 | atoms | bonds | 说明 |
|---|---|---|---|
| NaCl（4 条面心平移，a=5.6402） | 8 | **24** | 全部 Na–Cl，长度 2.8201 |
| NaCl（192 条 Fm-3m 操作，halite.cif） | 8 | **24** | 同上（展开去重后原子相同） |
| quartz（examples/quartz.cif） | 9 | **12** | 全部 Si–O，长度 1.6046 / 1.6124 |
| diamond（examples/diamond.cif，无操作） | 8 | **16** | C–C = a·√3/4 = 1.5445 |
| water.xyz | 3 | **2** | O–H 0.9573；H–H 1.514 不成键 |
| Bi₂Te₃（v1.1 目标） | — | Bi–Te **0** | Te 属 metalloid，3.07–3.25 Å > cutoff 2.98 |
| CrCoBr₃（v1.1 目标） | 20 可见原子 | Co–Br **12** | Cr 保持孤立（Co–Br 为主），见 README v0.7 |

---

## 8. 超胞、边界原子与显示集合（`Renderer.cpp` 的 `RebuildAtoms`/`RebuildLines`）

实现位置：`CL.crystal.buildDisplayModel(structure, {supercell:[nx,ny,nz], showBoundary})`。渲染空间：所有 `pos = cart - origin`，`origin = structure.center`（`DisplayModel.origin`）。

### 8.1 容量常量（已核实真实位置，与 README 一致但分散在两处）

| 常量 | 值 | 位置/语义 |
|---|---|---|
| `kMaxCellRepeats` | **16** | `src/render/Appearance.h`；超胞每轴 1–16 整数 |
| 超胞内部位点上限 | **65536** | `Renderer.cpp: FitsSupercell`：`atoms.length * copies <= 65536` |
| 超胞内部周期键上限 | **300000** | `FitsSupercell`：`bonds.length * copies <= 300000` |
| 显示像总数上限 | **80000** | `Renderer.cpp: RebuildAtoms` 的 `maxImages`（含边界像） |
| 单胞展开原子上限 | **30000** | `src/core/Crystal.h: kMaxDisplayAtoms`（仅用于对称展开/XYZ 截断） |
| 单胞周期键上限 | **150000** | `src/core/Crystal.h: kMaxBonds`（BuildBonds 截断） |
| 超胞面吸附 eps | **1e-7**（分数） | `RebuildAtoms` 的 `limits()` |

默认渲染选项（`AppSettings`/`RenderOptions`，v1.1）：`style='ball-stick'`、`showCell=showBonds=showAxes=true`、`showLabels=false`、`showBoundary=true`（原 `showImages`）、`atomScale=0.30`、`bondRadius=0.105`、`supercell=[1,1,1]`。**注意 `showBoundary` 默认开**，所以 1×1×1 岩盐默认就显示 27 个实例（8 内部 + 19 远面/边像）。

```
FitsSupercell(structure, copies):       // copies = nx*ny*nz
  return copies === 1 || (structure.atoms.length * copies <= 65536 &&
                          structure.bonds.length * copies <= 300000)
```
`buildDisplayModel` 的判定：

```
displayed = [clamp(nx,1,16), clamp(ny,1,16), clamp(nz,1,16)]
periodic = !!structure.cell && structure.atoms.length > 0
requested = displayed[0]*displayed[1]*displayed[2]
supercellLimited = periodic && requested > 1 && !FitsSupercell(structure, requested)
if (!periodic || supercellLimited) displayed = [1,1,1]        // 回退单胞
[nx,ny,nz] = displayed
interiorCount = structure.atoms.length * nx*ny*nz              // 内部位点数（= cellAtomCount）
maxImages = 80000
```
- `supercellLimited` 时 UI 显示 `视图·超胞过大，显示单胞`（HUD suffix，见 §8.7）。
- 超胞对话框另有校验：三轴均为 **1–16 的整数**，否则错误 `超胞倍率必须是 1–16 的整数`；`!FitsSupercell(structure, nx*ny*nz)` → 错误 `请减小倍率，超胞内部最多 65,536 个位点、300,000 条周期键。`（i18n `dialog.supercell.error.budget`）。

### 8.2 显示集合 = 闭区间 [0,Nx]×[0,Ny]×[0,Nz]

```
instances = []            // DisplayAtom 列表（渲染空间）
images = []               // 附加记录 {atomIndex, tx, ty, tz, pos}（键/多面体用）
meshes = (polyhedral 样式时 CoordinationMeshes(structure)，否则空)

appendAtom(atomIndex, posCart, selectableIndex, tx, ty, tz):
    images.push({atom: atomIndex, tx, ty, tz, pos: posCart - center})
    if (polyhedral && meshes[atomIndex].length === 0) return        // 多面体样式只画中心
    baseRadius = (style==='space-fill' || !isTransitionMetal(z)) ? element.vdw : element.covalent
    styleScale = style==='space-fill' ? 0.92 : clamp(atomScale, 0.10, 0.85)
    radius = max(0.10, baseRadius * styleScale)
    if (polyhedral) radius *= 0.72
    instances.push({pos: posCart-center, radius, color: element.rgb,
                    selectableIndex /* -1 = 不可拾取 */, kind, atomIndex})
    if (selectableIndex >= 0) siteRadii[selectableIndex] = radius

// ① 先放单胞内部原始位点（t=0），保证内部原子永不因容量被丢弃、且在数组最前
for i in 0..atoms.length-1:
    appendAtom(i, atoms[i].cart, selectableIndex = i, 0,0,0)

// ② 周期结构：按闭区间补所有 (位点, 平移) 像
if (periodic):
    boundaryBudget = maxImages - min(maxImages, interiorCount)
    eps = 1e-7
    limits(f, n) = showBoundary ? [ceil(-eps - f), floor(n + eps - f)] : [0, n-1]
    for i in 0..atoms.length-1:
        x = limits(atoms[i].frac.x, nx); y = ...; z = ...
        for tx in x[0]..x[1]: for ty in y[0]..y[1]: for tz in z[0]..z[1]:
            if (tx===0 && ty===0 && tz===0) continue
            outside = (tx<0 || ty<0 || tz<0 || tx>=nx || ty>=ny || tz>=nz)   // 是否"边界像"
            if (outside):
                if (boundaryBudget === 0) { boundaryLimited = true; continue }
                boundaryBudget--
            pos = atoms[i].cart + fracToCart(cell, [tx,ty,tz])
            appendAtom(i, pos, selectableIndex = -1, tx, ty, tz)
atomCount = instances.length
```

数学等价描述：
- **内部位点**（`cell` 原子）：`t ∈ [0, nx-1]×[0,ny-1]×[0,nz-1]`，共 `interiorCount` 个 —— 即闭区间 `[0,N]` 里的"格内"部分（含 t=0）。
- **边界像**：其余 `f+t ∈ [0,N]` 的点，例如 `f=0` 时 `t=N`（远面复制）、`f∈(0,1)` 时 `t=N-1` 的远侧副本等；数量 = 总像数 − 内部位点数。
- **不按位置去重**：不同 `(位点, t)` 是不同原子副本；当 `f=0` 时闭区间两端（`t=0` 与 `t=N`）各生成一份，位置不同、不是重复；同一 `(位点,t)` 只生成一次，因此显示集合天然无重复。
- `limits` 用 `eps=1e-7` 分数吸附，使"数值上在面上"的位点（如 `f=1e-9`、`f=n±1e-9`）也生成面上的额外副本。
- 关闭边界（`showBoundary=false`，原 `showImages`）→ 每轴 `[0, n-1]`，只保留内部位点（1×1×1 时即"仅单胞原子"）。

**实测/推导值（QA 可作断言）**：

| 案例 | 显示实例总数 | 内部位点 | 边界像 | 说明 |
|---|---|---|---|---|
| halite 1×1×1，开边界 | **27** | 8 | 19 | Na 14 / Cl 13（f=0 的轴在闭区间 [0,1] 生成 2 个 t） |
| halite 2×2×2，开边界 | **125** | 64 | **61** | Na 实例 63、Cl 62（63 与 README "63 个 Na 中心"一致） |
| halite 2×2×2，关边界 | **64** | 64 | 0 | 8 位点 × 8 |
| halite 3×3×3，开边界 | **343** | 216 | 127 | Na 172 / Cl 171（f=0 轴取 4 个 t、f=0.5 轴取 3 个） |

### 8.3 可见键（绘制集合）

```
visibleBonds = []                        // DisplayBond 实例（可指向 boundary 原子）
if (style !== 'space-fill' && images.length > 0 && (showBonds || polyhedral)):
    lookup = Map<(atomIndex,tx,ty,tz), imageIndex>
    copies[atomIndex] = [imageIndex...]
    for bond in structure.bonds:
        for idx in copies[bond.a]:
            src = images[idx]
            end = lookup([bond.b, src.tx+bond.shift[0], src.ty+bond.shift[1], src.tz+bond.shift[2]])
            if (!end) continue                       // 该周期像未被显示 → 不画
            visibleBonds.push({a: idx, b: end, radius: bondRadius * (H? 0.82 : 1), color:[0.66,0.70,0.76]})
```
- 语义：**两端端点都在显示集合中**才画（端点可以是边界像）。
- 同一条单胞键会因 `a` 的多份副本而产生多条可见键实例；`visibleBondCount = visibleBonds.length`。
- 多面体样式下不画键（只画多面体），`visibleBondCount` 仍按上述规则统计（源码里 `++visibleBondCount_` 在 `if (polyhedral) continue;` 之前）。
- 空间填充样式不画键。

### 8.4 统计量（按 lead 2026-11 决策，与 C++ v1.1 HUD 一致）

| DisplayModel 字段 | 值 | 对齐 C++ |
|---|---|---|
| `cellAtomCount` | `interiorCount`（内部位点数） | 内部副本数 |
| `visibleAtomCount` | `instances.length`（**含边界像**） | `Renderer::AtomCount()` |
| `boundaryAtomCount` | `visibleAtomCount - cellAtomCount` | 边界像数 |
| `cellBondCount` | `structure.bonds.length`（单胞周期键） | `CellBondCount()` |
| `visibleBondCount` | `visibleBonds.length`（视口绘制键实例，含边界像端点） | `BondCount()` |
| `supercellLimited` / `boundaryLimited` | 上述布尔 | 同名 |
| `displayedCells` | 实际生效的 `[nx,ny,nz]` | `displayedCells_` |

> 记录：旧 CONTRACT §5.3 曾把 `visibleAtomCount` 定义为 "kind==='cell'"、`visibleBondCount` 定义为"两端均 cell"，与 C++ 不符；lead 已决策按 C++ HUD 口径修正（见 §15.D1）。

### 8.5 拾取与 `kind`

- `DisplayAtom.kind`：**建议 `'cell'` = 内部位点（`t∈[0,n-1]^3`，即 `cellAtomCount` 集合），`'boundary'` = 边界像**。
- `pickable`：`kind === 'cell'`。这是相对原版的**有意改进**（C++ 只允许 `t=0` 的原始位点拾取，超胞内部副本也不可选）；若 lead/QA 要求像素级行为一致，改为仅 `t=0` 可拾取（`selectableIndex = atomIndex` 仅对原始位点）。
- `DisplayAtom.siteId` = `structure.atoms[atomIndex].siteIndex`（编辑定位用）；`id` = 数组下标。
- 拾取本身（射线-球）半径公式见原 `Picking.cpp`：`pickRadius = max(radius*1.04, boundRadius*0.007)`，取最近命中，`siteRadii[i] <= 0` 跳过。

### 8.6 相机取景 `getVisiblePoints()`

返回渲染空间点（已减 `center`）：
1. 若 `cell`：8 个显示超胞角点 `fracToCart([0|nx,0|ny,0|nz])`；
2. 每个 `DisplayAtom` 的 8 个包围盒角 `pos ± radius`；
3. 多面体三角形顶点。
（C++ `GetVisiblePoints` 用 `atoms_`+`polyVertices_`；JS 用 DisplayModel。）

### 8.7 HUD 提示（渲染/UI 层）

| 情况 | i18n key | 中文文案 |
|---|---|---|
| 请求超胞超容量 | `viewport.hud.supercell-limited` | `超胞过大，显示单胞` |
| 边界像被 80000 截断 | `viewport.hud.boundary-limited` | `边界副本已截断` |
| 多面体样式但无凸包 | `viewport.hud.no-coordination-hull` | `无三维配位 · 球棍` |
| 原子/键计数 | `viewport.hud.atoms-bonds` | `%d 原子   %d 键` |

### 8.8 晶胞线框（补充，渲染用）

`showCell` 时按显示超胞画线（三段循环，每段含 `outer` 标记）：
```
cellBaseRadius = clamp(min(a,b,c) * 0.005, 0.017, 0.065)
cellRadius = cellBaseRadius * clamp(cellLineWidth, 0.5, 4.0)
edge(a,b,outer): radius = outer ? cellRadius : cellRadius*0.52; flags = outer?2.0:6.0
// x 方向：for iy in 0..ny, iz in 0..nz: edge((0,iy,iz),(nx,iy,iz), outer = (iy∈{0,ny})&&(iz∈{0,nz}))
// y 方向：for ix, iz: edge((ix,0,iz),(ix,ny,iz), outer = (ix∈{0,nx})&&(iz∈{0,nz}))
// z 方向：for ix, iy: edge((ix,iy,0),(ix,iy,nz), outer = (ix∈{0,nx})&&(iy∈{0,ny}))
```
端点都减 `center`。

---

## 9. 配位多面体（中心与配体，`PolyhedronMesh.cpp`）

入口：`CL.crystal.buildPolyhedra(displayModel, structure) -> DisplayPolyhedra`。仅当 `style === 'polyhedral'` 时构建（`buildDisplayModel` 内按需调用；其它样式 `enabled=false`）。

### 9.1 配位壳（中心判定）

```
buildCoordinationMeshes(structure):
  if (!structure.cell || structure.bonds.length === 0) return []
  LIGAND = {7,8,9,16,17,34,35,53}          // N O F S Cl Se Br I
  shells[atoms.length] = []
  for bond in structure.bonds:
      delta = atoms[bond.b].cart + bond.imageOffset - atoms[bond.a].cart   // a → b 的完整像向量
      shells[bond.a].push(delta)
      shells[bond.b].push(-delta)                                       // 配体壳对两端都记录
  meshes = 空数组（每元素=多边形三角形列表，默认空）
  // 两轮：先"骨架中心"，再"离子中心"
  for ionicCenters of [false, true]:
      found = false
      for site in 0..atoms.length-1:
          z = atoms[site].z
          if (z === 0) continue                       // 未知元素不做中心
          if (LIGAND.has(z)) continue                 // 卤素/O/S 等配体元素不做中心
          if (isAlkaliOrAlkaline(z) !== ionicCenters) continue
          if (shells[site].length < 4) continue       // 配位数 <4 不成多面体
          meshes[site] = coordinationHull(shells[site])
          if (meshes[site].length > 0) found = true
      if (found) return meshes                        // 第一轮有结果就只保留第一轮中心
  return []                                           // 全部为空 → 无三维配位
```
- **中心**：非配体元素、非未知元素、配位数 ≥ 4；优先"非碱/碱土"（如 Ti、Si、Al、Ni、Bi），若一个都没有则退回"碱/碱土"（如 NaCl 的 Na⁶、CaF₂ 的 Ca⁸）。
- 配体集合来自 `bonds` 的**完整周期像**（含 `imageOffset`），因此每个中心的配位壳是完整三维壳，**不受边界显示限制**（v1.1 关键行为）：即使边界原子被关闭/截断，中心的多面体仍包含相邻晶胞提供的配体。是否绘制某中心的多面体才受显示集合约束。
- 需要 `cell.valid`；分子（无晶胞）不生成多面体。

### 9.2 凸包 `CoordinationHull(ligands)`（必须照抄的几何规则）

```
coordinationHull(ligands):
  pts = []
  for p in ligands:
      if (所有已有 q 满足 |p-q|² >= (1e-6)²) pts.push(p)      // 去重
      if (pts.length > 14) return []                          // 配体点上限 14（>14 放弃该中心）
  mesh = []
  planes = Set<uint32 bitmask>
  for a in 0..pts.length-1: for b in a+1..: for c in b+1..:
      n = cross(pts[b]-pts[a], pts[c]-pts[a]); len = |n|
      if (len < 1e-6) continue                                // 共线
      n = n / len
      above = below = false; mask = 0
      for i in 0..pts.length-1:
          d = dot(n, pts[i]-pts[a])
          if (d > 1e-6) above = true
          else if (d < -1e-6) below = true
          else mask |= 1 << i                                 // 共面点
      if (above === below) continue                           // 全部共面或点位于两侧 → 不是面
      if (!planes.add(mask)) continue                          // 同一组共面点只处理一次
      if (above) n = -n                                        // 法向朝外
      face = [pts[i] for i where mask bit]
      polygon = faceBoundary(face, n)                          // 2D 凸包排序（§9.3）
      for i in 1..polygon.length-2:                            // 扇形三角化
          mesh.push({corners:[polygon[0], polygon[i], polygon[i+1]], normal:n,
                     boundary:[true, i+2 === polygon.length, i === 1]})
  return mesh
```
- 只保留"单侧有其余点"的真实面，因此凸包顶点上的冗余共面点不会产生额外三角形；共面多边形（四边形面、六边形面）会被合成一个多边形再三角化。
- 输出 `normal` 为面法向（朝外），`boundary[3]` 表示三角形**每条边（对角点）是否为多边形真实棱**——渲染器用它做"只描外棱"的 barycentric 描边（禁用内部扇形对角线）。
- 最多 14 个配体点：8 面体（6）、立方体（8）、四方反棱柱（8）等常见配位均支持；>14 直接放弃（不报错，HUD 会提示无凸包）。
- 复杂度 O(k³)（k≤14：≤364 个平面三元组 × k 点）。
- 测试参考：NaCl 中每个 Na 的 6 个 Cl → 正八面体 8 个三角形；CaF₂ 中 Ca 的 8 个 F → 立方体（6 个四边形面，每面 2 三角形 = 12 三角形）；SrTiO₃ 的 TiO₆ 八面体。

### 9.3 `faceBoundary(face, normal)` 共面点 2D 凸包（单调链）

```
u = normalize(face[1] - face[0])
v = cross(normal, u)
按 (dot(p,u), dot(p,v)) 字典序排序 face
hull = []
append(p, base):
    while (hull.length >= base+2):
        a = hull[hull.length-2]
        if (dot(normal, cross(hull.last - a, p - a)) > 1e-6) break    // 左转保留
        hull.pop()
    hull.push(p)
for p in sorted: append(p, 0)
split = hull.length - 1
for p in sorted.reversed[1..]: append(p, split)
hull.pop()          // 去掉重复的首点
return hull
```
前提：`face.length >= 3`；`u` 用 `face[1]-face[0]` 构造（凸包计算已经保证 face 非空且非退化）。

### 9.4 复制到显示集合（渲染）

```
for image in images (所有实例，含边界像):
    color = elementByZ(atoms[image.atom].z).color
    for tri in meshes[image.atom]:
        for corner in tri.corners:
            pos = image.pos + corner             // 渲染空间（已减 center）
            push vertex {pos, normal: tri.normal, rgb: color, bary}
```
- 多面体颜色 = **中心原子**的元素颜色（非独立配色）。
- 面透明度/描边来自外观设置：`polyTransparency`（默认 66%）、`polyEdgeWidth`（默认 1.2 px，0 关闭）、`polyEdgeColor`（默认 `0x91B4D3`）；半透明三角形的绘制顺序按 `-dot(forward, triangleCenter)` 排序（每帧一次）。
- 统计：`polyhedronCount` = 非空 mesh 的实例数；`polyhedronTriangleCount = Σ mesh.length`。
- 边界中心也会绘制（例如 NaCl 2×2×2 共 **63** 个 Na 中心，每个 8 三角形 = 504 三角形）；关闭边界时中心数按内部位点计：1×1×1 为 **4**、2×2×2 为 **32**（= 4 个 Na 位点 × nx·ny·nz）。
- 中心原子在多面体样式下仍绘制球（半径 ×0.72），配体与非中心原子隐藏（`meshes[atomIndex].length === 0` 的实例不生成球），但它们的 `images` 仍参与键/多面体复制。

---

## 10. 测量（`Crystal.cpp` 的 Measure* / Make*）

### 10.1 距离 `measureDistance(structure, a, b)`

```
if (a<0 || b<0 || a>=atoms.length || b>=atoms.length) return 0（offsets 置零）
pa = atoms[a].cart; pb = atoms[b].cart
delta = pb - pa; offset = [0,0,0]
if (cell):
    delta  = minimumImageVector(pa, pb)         // §2.7
    offset = delta - (pb - pa)                  // 周期像修正
offsetA = [0,0,0]; offsetB = offset
return |delta|
```
- `offsetA` 恒零（a 端不修正），`offsetB` 使 `pb + offsetB` 成为 `pa` 附近的最近像。
- 渲染画线端点：`atomA.cart + offsetA` → `atomB.cart + offsetB`（再减 `center`）。

### 10.2 键角 `measureAngle(structure, a, b, c)`（b 是顶点）

```
if (任一索引越界) return false
pa,pb,pc = cart
va = pa - pb; vc = pc - pb; oa=oc=[0,0,0]
if (cell):
    va = minimumImageVector(pb, pa)             // 从顶点指向 a 的最近像
    vc = minimumImageVector(pb, pc)
    oa = va - (pa - pb); oc = vc - (pc - pb)    // 各自周期像修正
la = |va|; lc = |vc|
if (la < 1e-9 || lc < 1e-9) return false
cosine = clamp(dot(va,vc)/(la*lc), -1, 1)
degrees = acos(cosine) * rad2deg
armA = oa; armC = oc; return true
```
- 顶点 `b` 不做像修正（`offsetB` 对角度无意义）；两臂各带 `offsetA/offsetC`。
- 渲染：顶点 = `atomB.cart`；两条线到 `atomA.cart+offsetA`、`atomC.cart+offsetC`，颜色青色（`kCyan=[0.38,0.83,1.00]`），线半径 0.028（渲染空间单位）；未完成测量（pending picks）用金色、半径 0.030。

### 10.3 `Make*Measurement`

| 函数 | 返回 |
|---|---|
| `makeDistanceMeasurement(s,a,b)` | `{kind:'distance', a, b, c:-1, value: measureDistance(...), offsetA:[0,0,0], offsetB: 距离修正}` |
| `makeAngleMeasurement(s,a,b,c)` | `{kind:'angle', a,b,c, value: degrees, offsetA, offsetC}`（`offsetB` 保持零） |

C++ 结构 `Measurement` 字段：`kind, a, b, c, value, offsetA, offsetB, offsetC`；CONTRACT 层 `Measurement` 为 `{kind, atomIds, value, points, offsets, label}`，映射：
- `atomIds`：距离 `[a,b]`；角度 `[a,b,c]`。
- `points`（渲染空间，已减 origin）：距离 `[cartA+offsetA-origin, cartB+offsetB-origin]`；角度 `[cartA+offsetA-origin, cartB-origin, cartC+offsetC-origin]`。
- `offsets`：`[offsetA, offsetB, offsetC]`（角度第二项为零）。
- `label`：距离 `formatLength(value)`（3 位小数 + `" Å"`）；角度 `formatAngle(value)`（2 位小数 + `"°"`）。
- 距离有效性：UI 要求 `value > 0`；角度要求 `measureAngle` 返回 true。

### 10.4 交互（UI 层）

- 距离模式：依次点 2 个原子（顺序无关）；角度模式：依次点 3 个原子 → `picks[0]` 为臂 A、`picks[1]` 为**顶点**、`picks[2]` 为臂 C。
- 同一测量内重复点同一原子被忽略；到达所需原子数后立即计算并清空 pending；测量面板可删除/清空。
- 表达式文案：距离 `"A–B"`、角度 `"A–B–C"`（U+2013 en dash）；标签取 `atom.label`，空则 `element+(index+1)`。
- 测量值显示：距离 3 位小数 + `" Å"`；角度 2 位小数 + `"°"`（§13.3）。

---

## 11. 编辑（`Crystal.cpp` 的编辑 API）

**统一约定**：所有编辑 API 都在**候选结构**上校验并重建，成功才写回；JS 建议纯函数式 `{ok:true, structure}` / `{ok:false, error}`，不抛异常（CONTRACT §3）。每次成功都执行 `finalize(structure, expandSymmetry=true)`（§6），即重建 `atoms → elementCounts/cellContents → center/boundRadius → bonds → truncated`。

### 11.1 `setCellParameters(structure, {a,b,c,alpha,beta,gamma})`

```
if (sites.length === 0) return err("结构中没有原子")
candidate = buildCell(a,b,c,al,be,ga)                    // 失败返回 §2.2 的错误文本
updated = clone(sites)
if (structure.cell === null):                            // 分子 → 晶体
    for site in updated:
        if (!isFiniteVec(site.cart)) return err("现有原子坐标无效，无法转换为分数坐标")
        site.frac = wrap01(candidate.cartToFrac(site.cart))
structure.cell = candidate; structure.periodic = true; structure.sites = updated
finalize(structure, true)
return ok
```
- 已有晶胞时**不改** `sites.frac`（只换晶格基，分数坐标语义不变）。
- 校验阈值/文本完全来自 §2.2：`"晶胞参数必须是正数"`、`"晶胞角必须在 0° 与 180° 之间"`、`"晶胞角组合退化"`、`"晶胞参数不能构成有效晶胞"`、`"晶胞体积为零"`。
- UI（`MainWindow::EditCellDialog`）：仅对有晶胞结构开放（否则 toast `当前结构没有晶胞参数，无法编辑晶胞`）；6 个输入框用 `ParseNumberToken` 解析（trim 后 `strtod` 全消费 + 有限；ERANGE/非法 → `请输入有效数字`）；核心失败统一显示 `晶胞参数无效，请检查长度和角度`。

### 11.2 `addAtomSite(structure, siteInput)`

```
atom = clone(siteInput)            // 可含 label/element/z/occupancy/frac/cart
prepareAtomForStructure(structure, atom)   // §11.4，失败 return err
structure.sites.push(atom)
finalize(structure, true)
return ok(structure, index = sites.length-1)
```
UI（`AddAtomDialog`）默认值：`z=6 (C)`、`occupancy=1.0`、`label` 空；有晶胞时 `frac=(0.5,0.5,0.5)`，否则 `cart = structure.center`。

### 11.3 `updateAtomSite(structure, siteIndex, siteInput)` / `deleteAtomSite(structure, siteIndex)`

```
update:
  if (siteIndex < 0 || >= sites.length) return err("原子索引无效")
  atom = clone(sites[siteIndex])
  // 只覆盖这 5 个字段，其余（disorder*、uiso、hasUiso、baseLabel）沿用旧值
  atom.z = input.z; atom.label = input.label; atom.occupancy = input.occupancy
  atom.frac = input.frac; atom.cart = input.cart
  prepareAtomForStructure(structure, atom)    // 会重写 element/baseLabel 与坐标
  sites[siteIndex] = atom
  finalize(structure, true)

delete:
  if (越界) return err("原子索引无效")
  if (sites.length <= 1) return err("结构中至少需要保留一个原子")
  sites.splice(siteIndex, 1)
  finalize(structure, true)
```
注意：
- `update` **不会**保留旧的 `frac/cart` 中未提供的那个坐标——输入必须提供与结构类型匹配的坐标（有晶胞给 `frac`，否则 `cart`）。
- `update` 的 `label` 为空时会被重新生成（`symbol` + 递增编号），并覆盖 `baseLabel`。
- 编辑由对称展开生成的原子时，实际修改的是**位点**，所有等价原子同时变化（UI 提示 `该原子由对称操作生成；修改会同时作用于全部等价原子。`）。
- 删除最后一个原子被拒绝（结构不允许空）。

### 11.4 `prepareAtomForStructure(structure, atom)`（公共校验，错误文本固定）

```
if (atom.z <= 0 || atom.z > 118) return err("原子元素无效")
if (!isFinite(atom.occupancy) || atom.occupancy <= 0 || atom.occupancy > 1)
    return err("占位率必须在 0 与 1 之间（不含 0）")
if (structure.cell):
    if (!isFiniteVec(atom.frac)) return err("分数坐标必须是有效数字")
    atom.frac = wrap01(atom.frac)
    atom.cart = fracToCart(cell, atom.frac)
else:
    if (!isFiniteVec(atom.cart)) return err("笛卡尔坐标必须是有效数字")
    atom.frac = [0,0,0]
atom.element = symbolOf(atom.z)
atom.label = trim(atom.label) === "" ? uniqueSiteLabel(structure, "", atom.element)
                                       : trim(atom.label)
atom.baseLabel = atom.label
```
`uniqueSiteLabel(structure, requested, symbol)`：
```
used = { site.baseLabel || site.label for site in sites }
base = trim(requested)
if (base === ""):
    for i in 1..9999: if (!used.has(symbol+i)) return symbol+i      // C1, C2, ...
if (!used.has(base)) return base
for i in 2..9999: if (!used.has(base+"_"+i)) return base+"_"+i
return base
```
（注意：自动编号从 **1** 开始，冲突后缀从 `_2` 开始。）

### 11.5 UI 编辑流程与撤销边界

- 对话框流程（C++ UI）：把当前结构**整体复制**为候选 → 调核心 API（失败把 `error` 文本回填对话框）→ 成功则 `CommitStructure`：**先** `PushUndoSnapshot()`（把旧结构深拷贝入栈，栈最多 **50** 步，超限从头部删除）并清空 redo 栈，再替换结构、`modified=true`、重建视图、选中新位点。
- 撤销/重做：`undoStack`/`redoStack` 各上限 **50**；互推时同样裁剪。快照是完整 `StructureData`（含 `atoms/bonds/center/...`），因此撤销无需重算；恢复后 `RefreshAfterEdit(preserveCamera=true)`。
- **核心层不提供撤销**：`setCellParameters/add/update/delete` 只负责改结构并重建；撤销由 UI 的 JSON 快照栈负责（JS 纯函数风格下快照即深拷贝，建议 `structuredClone` 或 `JSON.parse(JSON.stringify(...))`）。
- UI 编辑相关文案（i18n 已有键）：`dialog.edit-cell.title/subtitle`、`dialog.add-atom.title`、`dialog.edit-atom.title`、`dialog.atom.subtitle-fractional/cartesian`、`dialog.edit-atom.symmetry-note`、`dialog.atom.error.invalid-element`、`dialog.atom.error.invalid-occupancy`、`dialog.error.invalid-number`、`toast.select-atom-first`、`status.structure-updated` 等。

---

## 12. 导出（`ExportStructureToCif` / `ExportStructureToXyz`）

### 12.1 CIF 导出 `exportCif(structure) -> string`

失败条件与文本：无晶胞 → `"CIF 导出需要晶胞参数，请改用 XYZ 格式"`；`sites` 为空 → `"结构中没有原子"`。
输出（所有浮点 **8 位小数**，`toFixed(8)`；整数原样）：

```
data_crystallens_export
[_chemical_name_common      <quote(trim(title))>]          ← title 非空才写
[_chemical_formula_sum      <quote(trim(formula))>]        ← formula 非空才写
_cell_length_a             <a>
_cell_length_b             <b>
_cell_length_c             <c>
_cell_angle_alpha          <alpha>
_cell_angle_beta           <beta>
_cell_angle_gamma          <gamma>
_cell_volume               <volume>
[空间群行]                                                 ← spaceGroup 非空才写
<空行>
[loop_                                                     ← symops 非空才写
_symmetry_equiv_pos_site_id
_symmetry_equiv_pos_as_xyz
1 <quote(op.text || "x,y,z")>
2 ...]
<空行>
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
[_atom_site_disorder_assembly                              ← 任一 site 有 disorder* 才写
_atom_site_disorder_group]
[_atom_site_U_iso_or_equiv]                                ← 任一 site hasUiso 才写
<label> <symbol> <fx> <fy> <fz> <occupancy> [asm|.] [grp|.] [uiso|?]
...
```
细节：
- **用不对称单元**（`sites`）+ `symops` 写出，不是展开后的 `atoms`。
- 空间群行：若 `spaceGroup` 形如 `#123`（`#` 后全数字）→ `_space_group_IT_number 123`；否则 `_symmetry_space_group_name_H-M <quote(sg)>`。
- 对称操作文本 = `trim(op.text)`，空则 `"x,y,z"`，经 `CifQuote`。
- 原子标签 `cifAtomLabel`：`label = site.baseLabel || site.label`；空 → `symbol + (index+1)`；重复时追加 `_2`、`_3`…（与 `uniqueSiteLabel` 的后缀规则相同但基于全表 `used` 集合）；最终经 `CifQuote`。
- `CifQuote(text)`（复刻原版，注意边界）：
  ```
  v = text.replace(/[\r\n\t]/g, ' ')
  for quote of ["'", '"']:
      safe = true
      for i in 0..v.length-2:  if (v[i] === quote && isspace(v[i+1])) { safe = false; break }
      if (safe) return quote + v + quote
  return ";\n" + v + "\n;\n"
  ```
  （只检查"引号后跟空白"的情况；若值以引号结尾会生成非法 CIF——低风险边界，见 §15.D13。）
- `occupancy` 用 8 位小数；无序列缺失写 `.`；Uiso 缺失写 ` ?`（注意值前有空格，`out << " ?"`）。
- 行尾统一 `\n`；写文件由调用方（Android Native 桥）负责。

### 12.2 XYZ 导出 `exportXyz(structure) -> string`

失败条件：`atoms` 为空 → `"结构中没有原子"`。

```
<N>                                             ← structure.atoms.length（单胞展开后的原子数）
<comment>                                       ← trim(title)，CR/LF 换成空格；空则 "CrystalLens export"
SYMBOL X.XXXXXXXX Y.XXXXXXXX Z.XXXXXXXX          ← 每个 atoms[i]，8 位小数，Cartesian（未减 center）
```
- 与 C++ 一致：导出的是 `structure.atoms`（单胞展开结果），不是超胞显示集合。
- 若产品需要"导出当前超胞视图"，另加 `exportXyzFromDisplay(model)`（用 `pos + origin`），与 C++ 行为不同，需在 UI 文案区分。
- 回环要求（测试）：重载后 `atoms.length` 相同、`format==='xyz'`、每个 `cart` 分量误差 ≤ 1e-5。
- CIF 回环要求（测试）：`cell.a` 误差 ≤ 1e-5、`asymmetricAtoms/sites` 数、`atoms` 数、`symops` 数与导出前相同；VESTA 结构回环时 `cart` 误差 ≤ 1e-7。

### 12.3 UI 保存流程

- `allowCif = cell.valid`；无晶胞时保存对话框只提供 XYZ；文件名建议 `<原stem>-edited.cif/.xyz`。
- 成功：打开保存位置；若保存路径 == 当前文档路径 → `modified=false`。
- 失败：toast `保存结构失败` + 错误文本；无晶胞却选 CIF → `CIF 导出需要晶胞参数；请改用 XYZ 格式`。
- 保存不改动结构状态（导出是只读操作）。

---

## 13. 结构摘要与数值格式化

### 13.1 `computeContents(structure)`（`Structure::ComputeContents`）

```
elementCounts = Map<int,int>()
for atom in atoms: elementCounts[atom.z] += 1
parts = []
for z in elementCounts.keys().sort(ascending):          // 按原子序数升序，不是字母序
    count = elementCounts[z]
    parts.push(symbolOf(z) + (count !== 1 ? String(count) : ""))
cellContents = parts.join(' ')
if (!structure.formula) structure.formula = cellContents
```
- **不约分**：按显示原子实际计数（NaCl → `"Na4 Cl4"`，不会约成 `"Na Cl"`）。
- 元素顺序 = 原子序数升序（测试：quartz `"O6 Si3"`、diamond `"C8"`、water `"H2 O"`；注意 count=1 时省略数字）。
- `formula`（来自 CIF `_chemical_formula_sum`）与 `cellContents` 是**两个不同概念**：前者是文件里的化学式（可能带空格/括号，如 `"Si O2"`），后者是晶胞内容计数。UI 同时显示两者（`common.formula` / `common.cell-contents`）。
- `elementCounts` 在 JS 里建议同时提供有序数组 `[{z,symbol,count}]`，因为 `Record<string,number>` 的键序不稳定。

### 13.2 `computeBounds(structure)`（`Structure::ComputeBounds`）

**有晶胞**：
```
center = (aVec + bVec + cVec) * 0.5
maxDist = max over 8 corners of |corner - center|
for atom in atoms: maxDist = max(maxDist, |atom.cart - center|)
boundRadius = max(2.0, maxDist + 1.2) * 1.06      // 留出键/标签余量
```
**无晶胞（分子）**：
```
if (atoms.length === 0) { center=[0,0,0]; boundRadius = 8.0; return }
lo/hi = atoms.cart 包围盒
center = (lo+hi)/2
maxDist = max |atom.cart - center|
boundRadius = max(2.5, maxDist + 0.8, |hi-lo| * 0.5 + 0.8)
```
（默认初值 `center=0`、`boundRadius=8.0`，`cell.valid` 但 `atoms` 为空时仍按晶胞公式计算。）

### 13.3 格式化（`src/ui/Format.cpp` → `core/format.js`）

| 函数 | 规则 |
|---|---|
| `formatDouble(v, decimals)` | 非有限 → `"—"`；否则 `toFixed(decimals)` |
| `formatNumber` | 同上 |
| `atomDisplayLabel(structure, i)` | 越界 → `"?"`；`atom.label` 非空用它，否则 `element + (i+1)` |
| `measurementExpression(m)` | 距离 `"A–B"`，角度 `"A–B–C"`（en dash） |
| `measurementValueText(m)` | 距离 `formatDouble(value,3) + " Å"`；角度 `formatDouble(value,2) + "°"` |
| `formatCellLengths` | `"a %.4f  b %.4f  c %.4f Å"`（两个空格分隔）；无晶胞 `"—"` |
| `formatCellAngles` | `"α %.2f°   β %.2f°   γ %.2f°"` |
| `formatVolume` | `"%.2f Å³"`；无晶胞 `"—"` |
| `formatFormulaText` | `formula || cellContents || "—"` |
| `formatFileStem(path)` | 去扩展名的文件名 |

**结构摘要（`BuildStructureSummary`，供"复制结构摘要"）**——逐行拼接，注意 `A^3` 是 ASCII：

```
CrystalLens v1.1
<title>
Format: <CIF | XYZ | VESTA | 未知>
Formula: <formatFormulaText>
[Space group: <spaceGroup>]
[Cell: a=%.5f, b=%.5f, c=%.5f, alpha=%.3f, beta=%.3f, gamma=%.3f]
[Volume: %.3f A^3]
Atoms: <atoms.length>, bonds: <bonds.length>
[Measurements:
  1. <expr>  <value>
  2. ...]
[Source: <sourcePathUtf8>]
```
- 方括号行按存在性输出；`Format:` 用 `FormatDisplayName`：`CIF`/`XYZ`/`VESTA`/`未知`。
- 测量块仅当有测量时输出；`Source` 仅当有来源路径。
- 其它 UI 计数文案：`status.file-info = "%s · %d 原子 · %d 键"`；`viewport.hud.atoms-bonds = "%d 原子   %d 键"`；`clipboard.atom-line = "%s  %s  frac(%.4f, %.4f, %.4f)"`。
- `formatDisplayName(format)`：`cif→"CIF"`、`xyz→"XYZ"`、`vesta→"VESTA"`、其它 `"未知"`。

---

## 14. 常量与上限清单（精确数值 + 位置）

### 14.1 数学/晶胞（`src/core/Math.h`、`Crystal.cpp`）

| 常量 | 值 | 说明 |
|---|---|---|
| `kPi` | `3.14159265358979323846` | |
| `kDegToRad` | `kPi/180` | |
| `kRadToDeg` | `180/kPi` | |
| `Normalize` eps | `1e-15` | 向量长度下限 |
| `Wrap01` 吸附 | `1e-12` | `>= 1-1e-12` → 0 |
| `WrapHalf` 范围 | `[-0.5, 0.5)` | |
| `NearlyEqual` eps | `1e-6` | |
| 晶胞体积有效下限 | `1e-9` | `valid = finite && volume > 1e-9` |
| `cz2` 下限 | `1e-12` | `c²-cx²-cy²` 必须更大 |
| `|sinγ|` 下限 | `1e-10` | 否则"晶胞角组合退化" |
| 晶胞角范围 | 严格 `(0,180)` | |
| 逆矩阵行列式下限 | `1e-15` | `cartToFrac` 防御 |
| `ColorFromHex(rgb, alpha=1)` | `((round(clamp(alpha,0,1)*255))<<24) | (rgb & 0xFFFFFF)` | ARGB |

### 14.2 解析

| 常量 | 值 | 说明 |
|---|---|---|
| 文件大小上限 | `128*1024*1024 = 134217728` byte | 超过报"文件超过 128 MB，已拒绝载入" |
| XYZ 声明原子数上限 | `1_000_000` | 超出/非法 → "XYZ 第一行必须是原子数" |
| 原子显示上限（核心） | `kMaxDisplayAtoms = 30000` | 对称展开 / XYZ 截断 |
| 周期键上限（核心） | `kMaxBonds = 150000` | BuildBonds 截断 |
| 对称展开去重容差 | `1e-3` Å | `ExpandAsymmetricUnit(tolerance)` |
| CIF 分号块/引号错误 | 见 §3.10 | |

### 14.3 成键

| 常量 | 值 | 说明 |
|---|---|---|
| 默认 tolerance | `1.20` | cutoff 缩放因子 = `tolerance/1.20` |
| 最小原子间距 | `0.42` Å | `< 0.42` 不成键（含自键） |
| cutoff 上限 | `6.0` Å | `clamp(...,0,6)` |
| 金属-金属附加 | `+0.12` | 碱金属/碱土参与时直接 `0` |
| 金属-非金属附加 | `+0.35` | |
| 非金属/类金属附加 | `+0.12` | |
| 暴力/网格阈值 | `atoms.length < 1600` 用暴力 | 否则网格 |
| 网格边长 | `6.0` Å | |
| 网格分档上限 | 周期 `1..40` / 分子 `1..48` | |
| 网格搜索邻域 | `dx,dy,dz ∈ {-1,0,1}`；`bins<=2` 时该轴起点 0；`bins==1` 时终点 0 | 周期环绕 |
| 自键像过滤 | `[tz,ty,tx] <= [0,0,0]` 跳过 | 见 §7.4 |
| 键排序 | `(a,b,shift[0],shift[1],shift[2])` 升序 | |

### 14.4 显示集合 / 渲染（`src/render/*`）

| 常量 | 值 | 位置 |
|---|---|---|
| 超胞每轴重复 | `1..16`（`kMaxCellRepeats=16`） | `Appearance.h` |
| 超胞内部位点上限 | `65536` | `Renderer.cpp: FitsSupercell` |
| 超胞内部周期键上限 | `300000` | `Renderer.cpp: FitsSupercell` |
| 显示像总数上限 | `80000`（`maxImages`） | `Renderer.cpp: RebuildAtoms` |
| 边界像面吸附 | `1e-7`（分数） | `RebuildAtoms::limits` |
| 原子基准半径 | 空间填充或非过渡金属 → `vdw`；球棍过渡金属 → `covalent` | `RebuildAtoms` |
| 过渡金属判定 | `21..30`、`39..48`、`57..80`、`>=89` | |
| `atomScale` 默认/范围 | `0.30`；clamp `0.10..0.85` | RenderOptions / Settings |
| 空间填充缩放 | `0.92` | |
| 原子半径下限 | `0.10` Å | |
| 多面体样式球半径系数 | `×0.72` | |
| 键半径默认 | `bondRadius = 0.105` | RenderOptions |
| 含氢键半径系数 | `×0.82`（任一端 z===1） | |
| 键颜色 | `[0.66, 0.70, 0.76]` | |
| 晶胞线宽基准 | `clamp(min(a,b,c)*0.005, 0.017, 0.065)` | |
| 晶胞线宽倍率 | `clamp(cellLineWidth, 0.5, 4.0)` | |
| 晶胞次线宽系数 | `×0.52` | 非最外层棱 |
| 测量线半径 | `0.028`（已完成）/ `0.030`（pending） | |
| 测量颜色 | 距离金 `[1.00,0.76,0.28]`；角度青 `[0.38,0.83,1.00]` | |
| 半透明面排序 | 每帧按 `-dot(forward, triangleCenter)` 排序 | |
| 外观默认 | `cellColor 0xD6DEE9`、`backgroundColor 0x020305`、`cellLineWidth 1.0`、`polyTransparency 66`、`polyEdgeWidth 1.2`、`polyEdgeColor 0x91B4D3` | `Appearance.h` |
| 外观范围 | `polyTransparency 0..100`；`polyEdgeWidth 0..4.0`（0=关）；`cellLineWidth 0.5..4.0` | `Settings.cpp` |

### 14.5 多面体

| 常量 | 值 |
|---|---|
| 几何 eps | `1e-6` |
| 配体去重 | `|p-q|² < (1e-6)²` |
| 配体点上限 | `14`（超过放弃该中心） |
| 最小配位数 | `4` |
| 配体元素 z | `{7,8,9,16,17,34,35,53}`（N,O,F,S,Cl,Se,Br,I） |
| 中心优先 | 非碱/碱土优先；否则用碱/碱土 |

### 14.6 格式化 / UI

| 项 | 值 |
|---|---|
| 测量距离小数位 | 3 + `" Å"` |
| 测量角度小数位 | 2 + `"°"` |
| 晶胞长度显示小数位 | 4 |
| 晶胞角显示小数位 | 2 |
| 体积显示小数位 | 2 |
| 摘要 Cell 小数位 | 5（alpha/beta/gamma 3） |
| 摘要 Volume 小数位 | 3（`A^3`） |
| 编辑对话框坐标小数位 | 5 |
| 编辑对话框晶胞参数小数位 | a/b/c 6、角 4 |
| 撤销/重做栈上限 | 50 |
| 3D 视图原子标签显示上限 | `atoms.length <= 400`（`Viewport.cpp`） |
| 超胞对话框 | 每轴 1–16 的整数 |

---

## 15. 已知差异、风险与实现建议

### 15.1 已决策（lead，2026-11）

| 编号 | 决策 |
|---|---|
| **D1** | **统计口径采用 C++ v1.1 HUD**：`visibleAtomCount` = 显示实例总数（含边界像，即 `atoms_.length`）；`visibleBondCount` = 视口绘制键实例数（含边界像端点）；`cellAtomCount` = 内部位点数；`cellBondCount` = 单胞周期键数；`boundaryAtomCount` = 边界像数。`CONTRACT §5.3` 已同步更新；实现以 §8.4 为准。 |
| **D2** | **`Structure.note` 在安卓版 UI 显示**（结构信息面板）。原版 v1.1 只收集不显示（源码里 `note` 无任何 UI 引用），这是**产品改进，不是复刻 bug**；解析告警文本仍按 §3.10/§4/§5/§6/§7 原样生成。 |

### 15.2 需要实现者注意的复刻风险

| 编号 | 风险 | 建议 |
|---|---|---|
| D3 | C++ `Atom` **没有 `note` 字段**（任务描述里提到的 `note` 实为 `Structure.note`） | `Site/Atom` 不加 note；UI 显示 `structure.note` |
| D4 | `symmetryGenerated = (symmetryIndex !== 0)`，并非"由对称操作生成"的严格语义 | 保留 C++ 行为；UI 文案"该原子由对称操作生成"仍可直接用 |
| D5 | 原版只允许 `t=0` 的 8 个原始位点拾取（超胞内部副本、边界像都不可选） | **建议**：`kind==='cell'`（内部位点，`t∈[0,n-1]^3`）都可拾取，边界像不可拾取；这是 UX 改进，需 lead 确认（默认按此实现，见 §8.5） |
| D6 | 自键像过滤写的是 `[tz,ty,tx] <= [0,0,0]`（分量顺序疑似笔误） | **必须照抄**；若"修正"成 `[tx,ty,tz]`，NaCl 等自键/金属键的数量与排序会变（测试会挂） |
| D7 | `CIF 包含多个结构数据块，已载入原子数最多的块。` 与实际打分（cell 优先、原子数封顶 1000、对称 +20）不一致 | 保留原文案；选择算法按 §3.7 |
| D8 | `CifQuote` 不检查"引号位于字符串末尾"，极端标签会生成非法 CIF | 低风险；可按原样实现 |
| D9 | `Math.round` vs C++ `round`（四舍六入五成双）在 `.5` 上有别 | 距离/最小镜像结果差异 ≤1e-9，不影响测试；只有 `shift` 标签在退化情形可能不同 |
| D10 | `symmetryExpanded` 仅表示"文件有显式操作且执行了展开"；无操作时用单位操作但标志保持 false | 不要用它判断"是否周期性"（用 `periodic`） |
| D11 | 原子 `label` 生成规则：多位置时 `baseLabel_copy`（copy 从 1 起）；单原子 CIF 无 label 时是 `元素+行号+1` | 严格按 §6/§3.8 |
| D12 | CIF 解析时 `occupancy` 不裁剪（可能 0/负/>1），仅在展开时 `<=0` 跳过 | 不要在校验层之外 clamp |
| D13 | 空间群**只给名称/编号时不会推断对称操作**（v1.1 已知限制） | 保持：展开用单位操作 + note；后续版本可加空间群表 |
| D14 | 参考工作区 `build/` 下的预编译产物（`crystal_tests.exe`、`eval_one.exe`）**早于** `reference/CrystalLens` 最终源码，其输出不可作为数值 oracle（例如旧版对 `nacl.vesta` 报 12 键，当前源码应为 24 键） | 用 `docs/spec/core-cases.md` 的断言与本文推导值；必要时重编参考实现 |
| D15 | 多面体中心判定与渲染独立：`CoordinationMeshes` 需要晶胞 + 非空 bonds；分子无多面体，HUD 提示"无三维配位 · 球棍" | 按 §9 |
| D16 | 原版 HUD 在有多面体三角形时**隐藏键数**（`visibleBonds>0 && polyTriangleCount===0` 才显示键数） | UI 层照做 |
| D17 | VESTA `CELLP` 遇到"≥6 token 但数值非法"的首行会硬报错（不跳过） | 与源码一致；注释说明 |
| D18 | `StructureData.sourceName`（CONTRACT）与 C++ `sourcePathUtf8`（完整路径）不同 | 摘要 Source 行需要时用加载层保留的路径；模型只保证文件名 |
| D19 | 解析错误文本目前是 C++ 中文硬编码；`i18n.json` 没有 `parse.error.*` 键 | 建议 impl-ui/lead 增补 i18n 键并把 `message` 作为兜底（否则英文模式会显示中文）；本规格中的文本即默认中文 |
| D20 | `CONTRACT` 的 `exportXyz(displayModel)` 与 C++ 的"导出单胞展开原子"语义不同 | 核心提供 `exportXyz(structure)`（对齐 C++/测试）；超胞导出另设 API 并在 UI 说明 |
| D21 | 大结构性能：显示实例 ≤ 80000、多面体 O(k³) 每中心、成键 n<1600 暴力 | 渲染侧用 InstancedArray/TypedArray；模型侧避免每帧重建；多面体按需构建（仅 polyhedral 样式） |

---

## 16. 移植检查清单

### 16.1 数学/晶胞
- [ ] `buildCell` 三角基公式与 5 级校验、错误文本完全一致
- [ ] `fracToCart`/`cartToFrac`、`volume`、`corners` 顺序
- [ ] `wrap01`（含 1e-12 吸附）/`wrapHalf`
- [ ] `minimumFractionalDelta`（含正交快速路径、种子、VisitImageRows、半径收缩）
- [ ] `minimumImageVector` / `imageOffset`
- [ ] 斜晶胞验证：`a=2.3,b=19,c=17,75,72,12` 的 72 组抽样 vs 穷举（≤1e-9）

### 16.2 解析器
- [ ] CIF tokenizer（注释、分号块、引号内撇号、无引号 `C#1`、行号）
- [ ] CIF 多块打分、单原子伪循环、`ParseCifNumber`（不确定度/分数/`? .`）
- [ ] 全部 tag 识别（§3.6.1）、坐标优先策略、多模型取首、disorder/uiso
- [ ] `readOperation` 跨 token 拼接；`parseSymmetryOperation` 文法与 7 类错误
- [ ] 全部错误/警告文本（§3.10）
- [ ] XYZ（原子序数、未知元素、`#` 注释、声明数不符 note、30000 截断）
- [ ] VESTA（TITLE/CELLP/GROUP/SYMOP/STRUC、零旋转行丢弃、op.text 12 位小数生成、note）

### 16.3 模型
- [ ] `expand`（去重键、label 规则、siteIndex/symmetryIndex/symmetryGenerated、30000 截断、单位操作回退）
- [ ] `buildBonds`（分类表、三分支容差、无序互斥、tolerance 缩放、自键过滤、多像、排序、150000 截断）
- [ ] 网格路径与暴力路径结果逐条一致（1600 阈值）
- [ ] `computeContents` 顺序/不约分/`formula` 回填；`computeBounds` 两套公式
- [ ] 分子语义：`cell=null`、无对称展开、无自键、`boundBound=8` 默认

### 16.4 显示/多面体
- [ ] `fitsSupercell`（65536/300000，copies=1 恒真）+ 超胞回退单胞
- [ ] 闭区间 `[0,N]` 生成、eps=1e-7、80000 预算、内部优先、`boundaryLimited`
- [ ] 可见键 map（a 的副本 × shift → b 的像）、氢键半径系数
- [ ] 统计量按 §8.4（D1 决策）
- [ ] 多面体中心两轮判定、配体壳、凸包（≤14、平面枚举、共面 mask、单调链、三角化 boundary 标志）
- [ ] `无三维配位 · 球棍` 提示条件

### 16.5 测量/编辑/导出/摘要
- [ ] `measureDistance`/`measureAngle` 的 offset 语义与渲染端点
- [ ] `setCellParameters`（分子→晶体换算）、`add/update/delete` 校验文本、重建流程
- [ ] `prepareAtomForStructure` + `uniqueSiteLabel`
- [ ] `exportCif`（8 位小数、可选列、`CifQuote`、`#IT` 分支、标签唯一化）
- [ ] `exportXyz`（8 位小数、注释行、原子数）
- [ ] 格式化函数与结构摘要逐行对齐（§13.3）
- [ ] 撤销快照 50 步（UI 层）

### 16.6 测试
- [ ] 逐条移植 `docs/spec/core-cases.md`（173 个 CHECK 的关键断言）
- [ ] 晶体库 12 结构元素计数表
- [ ] 导出往返（CIF/XYZ/VESTA）
