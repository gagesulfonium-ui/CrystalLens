# CrystalLens 核心测试 · 可移植清单（core-cases.md）

> 来源：`../tests/test_core.cpp`（v1.1.0，共 **173** 个 `CHECK`/`CHECK_NEAR` 断言，参考实现 `173 checks passed, 0 failed`）。
> 目标：逐条移植成 JS（Node、无依赖）测试。建议 harness：
> ```js
> // tests/node/harness.js：提供 test(name, fn) 与 assert；核心文件按 CONTRACT §4 顺序加载
> test('cell parameters and fractional transforms', () => { ... });
> ```
> 断言映射：`CHECK(expr)` → `assert.ok(expr)`；`CHECK_NEAR(a,b,eps)` → `assert.ok(Math.abs(a-b) <= eps)`。
> 解析失败在 C++ 是返回 false + `ParseError`，JS 是**抛** `CL.ParseError`：用 `assert.throws` 验证 `message`/`line`。
> 需要文件的用例（examples / library / 导出回环）：把夹具复制到 `tests/fixtures/`（由 lead/spec-assets 提供），或把文本内联为字符串；写文件用例可换成"导出到字符串再解析"（见 §15 备注）。
> 本文的"期望值"全部来自 C++ 源码语义与测试断言；**不要**拿工作区 `build/` 下旧预编译产物的输出当 oracle（见 core.md §15.D14）。

---

## 0. 夹具文本（内联）

### 0.1 `kNaCl`（CIF，4 条面心平移）

```cif
data_rock_salt
_chemical_name_common 'Rock salt'
_chemical_formula_sum 'Na Cl'
_cell_length_a 5.6402
_cell_length_b 5.6402
_cell_length_c 5.6402
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'F m -3 m'
loop_
_symmetry_equiv_pos_site_id
_symmetry_equiv_pos_as_xyz
1 'x,y,z'
2 'x,y+1/2,z+1/2'
3 'x+1/2,y,z+1/2'
4 'x+1/2,y+1/2,z'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
Na1 Na 0.0 0.0 0.0 1.0
Cl1 Cl 0.5 0.0 0.0 1.0
```

### 0.2 `kSemicolon`（CIF，分号文本块）

```cif
data_text_test
_chemical_name_common
;
A title
on two lines
;
_cell_length_a 4
_cell_length_b 4
_cell_length_c 4
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Si1 Si 0 0 0
```

### 0.3 特殊位置去重 CIF

```cif
data_special
_cell_length_a 5
_cell_length_b 5
_cell_length_c 5
loop_
_symmetry_equiv_pos_as_xyz
'x,y,z'
'-x,-y,-z'
'x+1/2,y+1/2,z'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Na1 Na 0 0 0
```

### 0.4 无引号对称操作 CIF

```cif
data_unquoted_symops
_cell_length_a 5
_cell_length_b 6
_cell_length_c 7
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'P -1'
_symmetry_equiv_pos_as_xyz
x, y, z
-x, -y, -z
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
C1 C 0.1 0.2 0.3
```

### 0.5 CIF 兼容性用例（词法边界 + 笛卡尔回退 + 无序 + 往返）

```cif
data_parse
_chemical_name_common 'O'Brien crystal'
_cell.length_a 1.000(2)e1
_cell.length_b 10
_cell.length_c 10
loop_
_space_group_symop.id
_space_group_symop.operation_xyz
1 x, y, z
loop_
_atom_site.label
_atom_site.type_symbol
_atom_site.fract_x
_atom_site.fract_y
_atom_site.fract_z
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.disorder_assembly
_atom_site.disorder_group
C#1 C ? ? ? 1 2 3 A 1
C2 C .2 .2 .3 ? ? ? A 2
C3 C .3 .2 .3 ? ? ? B 1
```

### 0.6 VESTA 文本（内联）

```vesta
#VESTA_FORMAT_VERSION 3.5.4

CRYSTAL

TITLE
Rock salt from VESTA

CELLP
 5.6402 5.6402 5.6402 90.0 90.0 90.0
 0 0 0 0 0 0

GROUP
 225 1 F m -3 m

SYMOP
 0.0 0.0 0.0 1 0 0 0 1 0 0 0 1 1
 0.0 0.5 0.5 1 0 0 0 1 0 0 0 1 1
 0.5 0.0 0.5 1 0 0 0 1 0 0 0 1 1
 0.5 0.5 0.0 1 0 0 0 1 0 0 0 1 1
 -1.0 -1.0 -1.0 0 0 0 0 0 0 0 0 0

STRUC
 1 Na Na1 1.0000 0.0000 0.0000 0.0000 4a 1
 0.0000 0.0000 0.0000 0.00
 2 Cl Cl1 1.0000 0.5000 0.0000 0.0000 4b 1
 0.0000 0.0000 0.0000 0.00
 0 0 0 0 0 0 0

THERI 1
 1 Na 0.01
 0 0 0
```

### 0.7 XYZ 水分子（内联）

```xyz
3
water molecule
O 0.000000 0.000000 0.000000
H 0.757000 0.586000 0.000000
H -0.757000 0.586000 0.000000
```

### 0.8 示例文件（`../examples/`，复制为夹具）

`quartz.cif`（α-quartz，2 个位点 / 6 条操作 / 带 Uiso 列）、`diamond.cif`（8 个 C 位点，无对称操作）、`water.xyz`、`nacl.vesta`。

---

## 1. 元素符号归一化（`TestElementNames`）

| 断言 | 期望 |
|---|---|
| `normalizeElementSymbol("Fe3+")` | `"Fe"` |
| `normalizeElementSymbol("O2-")` | `"O"` |
| `normalizeElementSymbol("C1")` | `"C"` |
| `normalizeElementSymbol("CA")` | `"Ca"` |
| `normalizeElementSymbol("13C")` | `"C"` |
| `elementBySymbol("Si").z` | `14` |
| `elementByZ(26).symbol` | `"Fe"` |

补充（来自编辑用例）：
| `elementFromInput("14")` | `z=14, symbol="Si"` |
| `elementFromInput("fe")` | `z=26, symbol="Fe"` |
| `elementFromInput("Qq")` | 失败（C++ 返回 false + 错误"未知元素：Qq"；JS 返回 null / 抛错） |

---

## 2. COD 晶体库 12 结构（`TestLibraryStructures`）

对 `../library/<name>.cif` 逐个：

| 文件 | `blockName`（COD id） | 展开后元素计数 | 其它断言 |
|---|---|---|---|
| `halite.cif` | `9003308` | `{Na:4, Cl:4}` | `cell.valid && bonds.length > 0` |
| `fluorite.cif` | `9007060` | `{Ca:4, F:8}` | 同上 |
| `perovskite.cif` | `9006172` | `{Ca:4, Ti:4, O:12}` | 同上 |
| `cooperite.cif` | `1011334` | `{Pt:2, S:2}` | 同上 |
| `rutile.cif` | `9004141` | `{Ti:2, O:4}` | 同上 |
| `brookite.cif` | `9004137` | `{Ti:8, O:16}` | 同上 |
| `anatase.cif` | `9008213` | `{Ti:4, O:8}` | 同上 |
| `sphalerite.cif` | `1100043` | `{Zn:4, S:4}` | 同上 |
| `wurtzite.cif` | `1100044` | `{Zn:2, S:2}` | 同上 |
| `diamond.cif` | `9011997` | `{C:8}` | 同上 |
| `quartz.cif` | `9013321` | `{Si:3, O:6}` | 同上 |
| `calcite.cif` | `9000965` | `{Ca:6, C:6, O:18}` | 同上 |

元素统计按 `atom.element` 计数（`element === symbol`）。注意 `blockName` 来自 `data_<COD号>`。

---

## 3. 斜晶胞最小镜像 + 自键 + 网格等价（`TestSkewImagesAndGrid`）

### 3.1 最小镜像（最难的用例）

```
cell = buildCell(2.3, 19, 17, 75, 72, 12)          // 必须成功
for n in 1..72:
    d = [sin(n*1.1), cos(n*0.7), sin(n*0.37)]
    actual = minimumFractionalDelta(cell, d)
    best = min over i∈[-20,20], j∈[-4,4], k∈[-3,3] of |fracToCart(cell, d + [i,j,k])|
    CHECK_NEAR(|fracToCart(cell, actual)|, best, 1e-9)
    if (|actual[0] - d[0]| > 1.5) outside = true
CHECK(outside)                                     // 必须跳出 3×3×3 邻域，否则是"只搜 ±1"的错实现
```

### 3.2 自键

```
cell = buildCell(1.5, 20, 20, 90, 90, 90)
sites = [C]（frac 默认 [0,0,0]，z=6）
finalize(s, true)
CHECK(bonds.length === 1)
CHECK(bonds[0].a === bonds[0].b)
CHECK_NEAR(bonds[0].length, 1.5, 1e-10)

buildBonds(s, 1.0)                  // 容差缩小：cutoff = 1.64/1.2 = 1.3667 < 1.5
CHECK(bonds.length === 0)
```

### 3.3 网格路径与暴力路径一致（n=1600 强制网格）

```
cell = buildCell(31, 30, 8, 90, 90, 5)
sites = [C@(0.1,0.8,0), C@(0.65,0.25,0)]
finalize(s, true)
expected = bonds.slice()
CHECK(expected.length > 0)

s.atoms.length = 1600               // 惰性占位（z=0，不产生键）→ atoms.length >= 1600 触发网格
buildBonds(s)
CHECK(bonds.length === expected.length)
for i: CHECK(bonds[i].shift === expected[i].shift)
       CHECK(bonds[i].a === expected[i].a && bonds[i].b === expected[i].b)
```
（32 条断言量级；关键是网格与暴力必须先命中同一候选对。）

---

## 4. CIF 兼容性（`TestCifCompatibility`，夹具 0.5）

```js
s = parseCif(FIXTURE_05); finalize(s, true);
CHECK(s.sites.length === 3);                              // 若不等直接 fail 返回
CHECK(s.title === "O'Brien crystal");                     // 单引号内含撇号
CHECK(s.atoms[0].label === "C#1");                        // 无引号 token 内 '#' 保留
CHECK_NEAR(s.atoms[0].frac.y, 0.2, 1e-12);                // 笛卡尔列回退 + 回算分数坐标
CHECK_NEAR(s.cell.a, 10.0, 1e-12);                        // "1.000(2)e1" 不确定度+指数
CHECK(s.bonds.length === 1);
CHECK(s.bonds[0].a === 1 && s.bonds[0].b === 2);          // A/2 与 A/1 无序互斥跳过；C#1-C2 被互斥
```

往返（CIF）：
```js
text = exportCif(s); reloaded = parseCifFromString(text); finalize(reloaded, true);
CHECK(s.atoms.length === reloaded.atoms.length);
CHECK(s.bonds.length === reloaded.bonds.length);
for i: CHECK_NEAR(|s.atoms[i].cart - reloaded.atoms[i].cart|, 0, 1e-7);
       CHECK(s.atoms[i].disorderGroup === reloaded.atoms[i].disorderGroup);
       CHECK(s.atoms[i].label === reloaded.atoms[i].label);
CHECK(s.title === reloaded.title);
```

再对 `nacl.vesta` 做同样往返：
```js
load nacl.vesta;
CHECK(s.spaceGroup === "F m -3 m");
roundtrip();                                   // 同上 1e-7
```
VESTA SYMOP 非标准（旋转 90°）往返：把 `SYMOP` 段替换成
```
SYMOP
0 0 0 1 0 0 0 1 0 0 0 1
0.5 0 0 0 -1 0 1 0 0 0 0 1
```
→ `parseVesta` + `finalize` + 往返，断言同上。

单原子笛卡尔 CIF（无晶胞、无循环）：
```cif
data_one
_atom_site.label O1
_atom_site.Cartn_x 1
_atom_site.Cartn_y 2
_atom_site.Cartn_z 3
```
```js
CHECK(cell === null); CHECK(atoms.length === 1); CHECK(atoms[0].z === 8);
```

坏 CIF（坐标非法）：
```cif
data_bad
loop_
_atom_site.label
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
O1 0 0 0
C1 0 0 inf/2
```
```js
assert.throws(() => parseCif(bad), e => e.name === 'ParseError' && e.line === 8);
```
（`inf/2` 走分数解析再 `strtod` → 非有限 → 失败；行号 = 原子行行号 8。）

XYZ 原子序数 + 未知元素：
```js
s = parseXyz("2\nnumbers\n8 0 0 0\nX 1 0 0\n"); finalize(s, false);
CHECK(s.atoms[0].z === 8);
CHECK(s.atoms[1].z === 0);          // X → 未知
CHECK(s.bonds.length === 0);        // z=0 不成键
```

---

## 5. 晶胞数学（`TestCellMath`）

```js
cell = buildCell(3,4,5,90,90,90, &err); CHECK(cell !== null);
CHECK_NEAR(cell.volume, 60.0, 1e-9);
cart = fracToCart(cell, [0.25,0.5,0.75]);
CHECK_NEAR(cart.x, 0.75, 1e-9); CHECK_NEAR(cart.y, 2.0, 1e-9); CHECK_NEAR(cart.z, 3.75, 1e-9);
frac = cartToFrac(cell, cart);
CHECK_NEAR(frac.x, 0.25, 1e-9); CHECK_NEAR(frac.y, 0.5, 1e-9); CHECK_NEAR(frac.z, 0.75, 1e-9);
CHECK(buildCell(3,3,3, 0.0, 90, 90) === null);       // α=0 非法

tri = buildCell(5,6,7,78,83,74); CHECK(tri !== null);
p = fracToCart(tri, [0.12,0.45,0.77]);
q = cartToFrac(tri, p);
CHECK_NEAR(q.x, 0.12, 1e-8); CHECK_NEAR(q.y, 0.45, 1e-8); CHECK_NEAR(q.z, 0.77, 1e-8);
```

---

## 6. 对称操作解析（`TestSymmetryParser`）

```js
op = parseSymmetryOperation("-y, x-y, z+1/6"); CHECK(op !== null);
CHECK_NEAR(op.m[0][1], -1, 1e-12); CHECK_NEAR(op.m[1][0], 1, 1e-12);
CHECK_NEAR(op.m[1][1], -1, 1e-12); CHECK_NEAR(op.t[2], 1/6, 1e-12);
p = applySymOp(op, [0.1,0.2,0.3]);
CHECK_NEAR(p[0], -0.2, 1e-12); CHECK_NEAR(p[1], -0.1, 1e-12);
CHECK_NEAR(p[2], 0.3 + 1/6, 1e-12);

parseSymmetryOperation("1 x,y,z");   // 前导编号剥离
CHECK_NEAR(op.m[0][0],1,1e-12); CHECK_NEAR(op.m[1][1],1,1e-12); CHECK_NEAR(op.m[2][2],1,1e-12);

parseSymmetryOperation("x-y, -x, -z+2/3");
CHECK_NEAR(op.m[0][0],1,1e-12); CHECK_NEAR(op.m[0][1],-1,1e-12);
CHECK_NEAR(op.m[1][0],-1,1e-12); CHECK_NEAR(op.t[2],2/3,1e-12);

CHECK(parseSymmetryOperation("x*y, z, 0") === null);   // 非线性乘积
CHECK(parseSymmetryOperation("x, y") === null);        // 分量数不足
```

---

## 7. CIF 基础：解析 + 对称展开 + 成键（`TestCifBasic`，夹具 0.1）

```js
s = parseCif(FIXTURE_01); finalize(s, true);
CHECK(s.atoms.length === 8);
CHECK_NEAR(s.cell.a, 5.6402, 1e-9);
CHECK(s.spaceGroup.includes("F m -3 m"));
CHECK(s.formula.includes("Na"));                       // formula 来自 _chemical_formula_sum "Na Cl"
CHECK(s.cellContents === "Na4 Cl4");
CHECK(s.periodic === true);
CHECK(s.bonds.length === 24);
for (b of s.bonds) CHECK_NEAR(b.length, 2.8201, 0.002);
CHECK(存在 Na–Cl 键);                                   // 按元素判定
CHECK_NEAR(measureDistance(s, 0, 4), 2.8201, 0.002);    // 0=Na1, 4=Cl1（索引顺序见表）
```
原子顺序（展开后）：`[Na1_?, Na…, Cl…]`——本用例只依赖 `0` 是 Na、`4` 是 Cl；NaCl 的展开顺序为
`Na(0,0,0) (0,0.5,0.5) (0.5,0,0.5) (0.5,0.5,0)`、`Cl(0.5,0,0) (0.5,0.5,0.5) (0,0,0.5) (0,0.5,0)`。
`symmetryOperatorCount === 4`、`symmetryExpanded === true`。

---

## 8. CIF 文本字段（`TestCifText`，夹具 0.2）

```js
s = parseCif(FIXTURE_02); finalize(s, true);
CHECK(s.title === "A title on two lines");   // 分号块 CleanText
CHECK(s.atoms.length === 1);
CHECK(s.atoms[0].element === "Si");
```

---

## 9. 无引号对称操作（`TestUnquotedSymmetry`，夹具 0.4）

```js
s = parseCifText(FIXTURE_04);                 // 不 finalize，先查操作
CHECK(s.symops.length === 2);
finalize(s, true);
CHECK(s.atoms.length === 2);
CHECK(s.bonds.length === 0);                  // C…C 3.86 Å > C-C cutoff 1.64
```

---

## 10. 特殊位置去重（`TestDuplicatePositions`，夹具 0.3）

```js
s = parseCif(FIXTURE_03); finalize(s, true);
CHECK(s.atoms.length === 2);                  // identity 与 inversion 在 (0,0,0) 去重，+1/2 平移保留
CHECK(s.symops.length === 3);
```

---

## 11. XYZ 分子（`TestXyz`，夹具 0.7）

```js
s = parseXyz(FIXTURE_07); finalize(s, false);
CHECK(s.atoms.length === 3);
CHECK(s.format === 'xyz');
CHECK(s.cell === null);
CHECK_NEAR(measureDistance(s,0,1), Math.hypot(0.757,0.586), 1e-6);   // 0.957311
angle = measureAngle(s, 1, 0, 2);            // 顶点为 0 (O)
CHECK_NEAR(angle, 104.47, 0.1);              // 精确值 104.5125°
CHECK(s.bonds.length === 2);                 // 两条 O–H；H–H 1.514 不成键
```

---

## 12. VESTA（`TestVesta`，夹具 0.6）

```js
s = parseVesta(FIXTURE_06);
CHECK(s.symops.length === 4);                // 4 条有效操作；全零旋转行被丢弃
finalize(s, true);
CHECK(s.atoms.length === 8);
CHECK(s.bonds.length === 24);
CHECK(s.title === "Rock salt from VESTA");
CHECK(s.spaceGroup === "F m -3 m");
```

---

## 13. 示例文件加载（`TestFileLoading`）

对 `examples/quartz.cif`、`examples/diamond.cif`、`examples/water.xyz`、`examples/nacl.vesta`：

```js
CHECK(loadStructureFile(path) !== null);
CHECK(atoms.length > 0);
CHECK(boundRadius > 0);
```

期望数值（当前 v1.1 源码语义；作为附加断言）：

| 文件 | atoms | bonds | cellContents | 备注 |
|---|---|---|---|---|
| `quartz.cif` | 9 | 12 | `O6 Si3` | 2 site × 6 ops 去重后 9 原子 |
| `diamond.cif` | 8 | 16 | `C8` | 无对称操作（仅显示不对称单元 8 个 C），C–C = 1.5445 |
| `water.xyz` | 3 | 2 | `H2 O` | formula 由 cellContents 回填 |
| `nacl.vesta` | 8 | 24 | `Na4 Cl4` | VESTA 只给 4 条面心平移；同 §7 的 4-op NaCl |

---

## 14. 石英几何（`TestQuartzGeometry`，文件 `examples/quartz.cif`）

```js
s = loadStructureFile(examples/quartz.cif);
CHECK(s.atoms.length === 9);
CHECK(s.cellContents === "O6 Si3");            // 按原子序数排序：O(8) 在 Si(14) 前
CHECK(s.bonds.length === 12);
siO = 0
for (b of s.bonds):
    if (元素对是 Si–O): siO++;
                        CHECK(b.length > 1.45 && b.length < 1.80);
CHECK(siO >= 12);
```
期望 Si–O 距离：**1.6046**（6 条）与 **1.6124**（6 条）——由 6 条 P3₁21 操作 + Si(0.4697,0,1/3)、O(0.4139,0.2674,0.2144) 展开计算。

---

## 15. 编辑与导出（`TestEditingAndExport`，文件 `examples/quartz.cif`）

前置：`loadStructureFile(quartz)`。

```js
asymmetricBefore = s.sites.length;  CHECK(asymmetricBefore === 2);
displayedBefore  = s.atoms.length;  CHECK(displayedBefore === 9);

// 元素输入
CHECK(elementFromInput("14") => {z:14, symbol:"Si"});
CHECK(elementFromInput("fe") => {z:26, symbol:"Fe"});
CHECK(elementFromInput("Qq") === null);

// 编辑晶胞
oldA = s.cell.a;
CHECK(setCellParameters(s, {a:5.1000, b:s.cell.b, c:s.cell.c, alpha, beta, gamma}).ok);
CHECK_NEAR(s.cell.a, 5.1000, 1e-9);
CHECK(s.cell.volume > 0);
CHECK(s.sites.length === 2); CHECK(s.atoms.length === 9);
CHECK(!setCellParameters(s, {a:-1.0, ...}).ok);        // 失败且结构不变
CHECK_NEAR(s.cell.a, 5.1000, 1e-9);

// 添加原子（分数坐标；晶体）
o = {z:8, element:"O", frac:[0.13,0.27,0.41], occupancy:1.0};
added = addAtomSite(s, o); CHECK(added.index === 2);
CHECK(s.sites.length === 3); CHECK(s.atoms.length > 9);
CHECK(s.sites[2].element === "O");

// 更新（只覆盖 z/label/occupancy/frac/cart）
updated = {z:7, label:"N_test", frac:[0.22,0.31,0.44], occupancy:1.0};
CHECK(updateAtomSite(s, 2, updated).ok);
CHECK(s.sites[2].element === "N");
CHECK(s.sites[2].label === "N_test");
CHECK(存在 atom 满足 atom.siteIndex === 2 && atom.z === 7);

// 删除
CHECK(deleteAtomSite(s, 2).ok);
CHECK(s.sites.length === 2); CHECK(s.atoms.length === 9);
CHECK(!deleteAtomSite(s, 999).ok);
CHECK(s.cellContents === "O6 Si3");

// 分子编辑
m = loadStructureFile(examples/water.xyz);
CHECK(addAtomSite(m, {z:6, cart:[1,2,3]}).ok);
CHECK(m.atoms.length === 4);
CHECK(exportCif(m) === null);           // 无晶胞 → 失败
CHECK(exportXyz(m) !== null);

// CIF 导出往返
if (!exportCifToFile(s, tmpCif)) { CHECK(false); } // 或导出字符串后解析
reloaded = loadStructureFile(tmpCif);
CHECK_NEAR(reloaded.cell.a, s.cell.a, 1e-5);
CHECK(reloaded.sites.length === s.sites.length);
CHECK(reloaded.atoms.length === s.atoms.length);
CHECK(reloaded.symops.length === s.symops.length);

// XYZ 导出往返
CHECK(exportXyzToFile(s, tmpXyz));
r = loadStructureFile(tmpXyz);
CHECK(r.atoms.length === s.atoms.length);
CHECK(r.format === 'xyz');
CHECK_NEAR(r.atoms[0].cart.x, s.atoms[0].cart.x, 1e-5);   // y、z 同理
```

### 15.1 导出字符串精确格式（额外断言，建议）

`exportCif(s)`（s = 编辑后的 quartz）：
- 第一行 `data_crystallens_export`
- 出现 `_chemical_name_common`、`_chemical_formula_sum`（值 `'Si O2'` 或引号形式）
- 9 个 cell 字段各 8 位小数（如 `_cell_length_a             5.10000000`）
- 有 `loop_` + `_symmetry_equiv_pos_site_id` + `_symmetry_equiv_pos_as_xyz`，6 行
- 原子循环固定 6 列 + `_atom_site_U_iso_or_equiv`（examples/quartz.cif 有 Uiso 列 → 导出必带），值 8 位小数
- 无 `_atom_site_disorder_*`（无 disorder）

`exportXyz(s)`：
- 第 1 行 `9`
- 第 2 行 = title（`Quartz`）
- 之后 9 行：`Si`/`O` + 三个 8 位小数笛卡尔坐标

分子 `exportXyz(m)`：第 1 行 `4`，第 2 行 `water molecule`。

---

## 16. 建议新增断言（本规格推导，非原测试；用于锁死 §8/§9 行为）

### 16.1 超胞显示集合（halite 8 原子 / 24 键单胞）

| 用例 | 期望 |
|---|---|
| `fitsSupercell(s, 1)` | `true`（copies==1 恒真） |
| `fitsSupercell(s, 8)`（2×2×2） | `true`（8*8=64 ≤65536，24*8=192 ≤300000） |
| `atoms=30000、copies=8` | `false`（240000 > 65536） |
| 1×1×1，showBoundary=true | `visibleAtomCount=27`、`cellAtomCount=8`、`boundaryAtomCount=19` |
| 2×2×2，showBoundary=true | `visibleAtomCount=125`、`cellAtomCount=64`、`boundaryAtomCount=61`（Na 实例 63） |
| 2×2×2，showBoundary=false | `visibleAtomCount=64`、`boundaryAtomCount=0` |
| 3×3×3，showBoundary=true | `visibleAtomCount=343`、`cellAtomCount=216`、`boundaryAtomCount=127` |
| 2×2×2 请求但结构超容量 | `supercellLimited=true`、`displayedCells=[1,1,1]` |

### 16.2 多面体（halite 2×2×2，polyhedral 样式）

| 用例 | 期望 |
|---|---|
| `polyhedronCount` | `63`（全部 Na 实例，含边界像） |
| `polyhedronTriangleCount` | `504`（每中心正八面体 8 个三角形） |
| 1×1×1 halite | `polyhedronCount=14`（Na 实例：27 个显示实例中的 14 个 Na） |
| Bi₂Te₃ 类（Bi–Te 不成键） | `polyhedronCount=0`，UI 显示"无三维配位 · 球棍" |

### 16.3 成键数值

| 用例 | 期望 |
|---|---|
| 4-op NaCl | 24 条，全部 2.8201 |
| diamond（8 C, a=3.5670） | 16 条，C–C = 1.5445 |
| water.xyz | 2 条 O–H，0.9573 |
| `buildBonds(s, 1.0)` 对 1.5 Å 单原子晶胞 | 0 条 |

---

## 17. 移植注意事项

1. **行号**：`ParseError.line` 是 1 起；CIF 的行号来自 token/rowLines，**分隔符行也计数**（夹具 0.5 的坏 CIF 断言 `line === 8`）。
2. **文件路径**：JS 测试不要依赖 `CL_EXAMPLES_DIR`；夹具统一放 `tests/fixtures/`，或把文本内联（推荐）。
3. **写文件**：`exportCif`/`exportXyz` 在 JS 里返回字符串（核心层无 IO），回环测试用"字符串 → parse"。
4. **数值比较**：原测试大量用 `CHECK_NEAR(..., 1e-12/1e-9/1e-8)`；JS 双精度一致，可原样使用。`toFixed` 8 位小数会带来 ≤1e-7 的回环误差，测试容差按本文。
5. **比较浮点相等**：原测试 `CHECK_NEAR(bond.length, 2.8201, 0.002)`；不要用 `===`。
6. **`bonds` 排序**：断言 `bonds[0]` 前请按 `(a,b,shift)` 排序（§7.6），或只断言集合/计数。
7. **stale oracle 警告**：工作区 `build/` 下旧 exe 早于 `reference/CrystalLens` 最终源码（曾对 `nacl.vesta` 输出 12 键，而当前源码=24 键）。若需二次确认，重新编译 `../tests/test_core.cpp`，或直接用本文 + 原测试断言。
8. **`nacl.vesta` 的 24 键推导**：VESTA 文件只有 4 条面心平移操作 → 展开为 8 原子（4 Na + 4 Cl），与夹具 0.1 的 4-op NaCl 完全同构 → 24 条 Na–Cl（每个 Na 有 6 个 Cl 邻，含 ±a/±b/±c 两个方向像）。
9. **`elementFromInput` 语义**：C++ 失败返回 `false` + 错误；JS CONTRACT 建议返回 `null`，编辑 API 再转成 `{ok:false,error}`。测试按实现约定统一即可。
10. **性能**：全部用例都是小结构；网格等价用例用 1600 个 `z=0` 占位原子，注意不要给占位原子设置坐标参与拾取/显示。
