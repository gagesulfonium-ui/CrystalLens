# 解析层实现说明（impl-core-parser）

> 对应文件：`web/js/lib/periodic_table.js`、`web/js/core/{cif,xyz,vesta,parsers}.js`、
> `tests/node/test_periodic.js`、`tests/node/test_parsers.js`。
> 基线：`../src/core/*`（v1.1.0）+ `docs/spec/core.md` §1–§5、`docs/spec/core-cases.md` §1/§2/§4/§6/§8–§14。

## 1. 实现概览

| 文件 | 内容 |
|---|---|
| `web/js/lib/periodic_table.js` | 119 条数据（z=1..118 + `X` kUnknown），来自 `docs/spec/elements.json`（= PeriodicTable.cpp）。`get/all/classify/elementFromInput` + 供解析/模型层复用的 `normalizeElementSymbol/elementFromLabel/bySymbol/byZ/isNonMetal/isMetalloid/isAlkaliOrAlkaline/pairBondCutoff/unknown/count`。 |
| `web/js/core/cif.js` | CIF tokenizer（注释/分号块/引号/无引号 `C#1`/BOM/行号）、blocks/loops/items、多块打分选优、`_atom_site_*` 伪循环、`parseCifNumber`（不确定度/指数/分数/`? .`）、晶胞、标题/化学式/空间群、原子表（坐标优先级/占位率/Uiso/disorder/多模型）、对称操作提取与表达式解析（`readOperation` 跨 token 拼接）。同时定义 `CL.ParseError` 并导出 `CL.parsers._util`（xyz/vesta 复用的行/数字/晶胞工具）。 |
| `web/js/core/xyz.js` | 首行原子数（严格整数）、注释行、`#` 行内注释、元素符号/原子序数/未知元素、声明数不符 note、30000 截断（`truncated`）。 |
| `web/js/core/vesta.js` | `#VESTA_FORMAT_VERSION` / `CRYSTAL` / `TITLE` / `CELLP` / `GROUP` / `SYMOP` / `STRUC`；零旋转行丢弃；`op.text` 按 `toFixed(12)` 生成；只取第一个 CRYSTAL 块。 |
| `web/js/core/parsers.js` | `detectFormat`（扩展名优先，再按 `#VESTA_FORMAT_VERSION`/`data_`/`_cell_`/`_atom_site`/XYZ 首行嗅探，最后 CIF 兜底）、`parse` 分派、空文件/无法识别错误；`CL.ParseError` 兜底定义。 |

输出严格为 CONTRACT §5.1 `StructureData`（纯 JSON，无函数/Map/TypedArray）：
`format/sourceName/title/blockName/spaceGroup/formula/note/periodic/truncated/cell/symops/sites/symmetryExpanded/asymmetricAtomCount/symmetryOperatorCount`。
解析阶段 `symmetryExpanded=false`、`asymmetricAtomCount=sites.length`、`symmetryOperatorCount=symops.length`；
不做对称展开/成键/显示模型（属于 impl-core-model）。

## 2. 与原版 C++ 的关键对齐点

- **CIF 词法**：`;` 仅在列首才是文本块；`#` 只在 token 起点开始注释（无引号 token 内允许 `#`，如 `C#1`）；单引号内含撇号（`'O'Brien crystal'`）；引号不可跨行；`\r` 不计行；行号 1 起。
- **数值**：`1.234(5)`→1.234、`1.000(2)e1`→10、`1/3`、`-2/3`、`?`/`.`→缺失；坏值（`inf/2`、`1.2(3)4`、`1/2/3`）判失败。
- **块选择**：`(cell?1000) + min(atoms,1000)*2 + (symmetry?20)`，只在含坐标块中比较，平局取靠前；块内原子循环取行数最多者。
- **坐标优先级**：完整分数坐标优先，否则该行完整笛卡尔坐标（后者有晶胞时回算 `frac`，不 Wrap）。
- **元素推断**：`_atom_site_type_symbol` 优先，失效时用 label；`NormalizeElementSymbol` 覆盖 `Fe3+`/`O2-`/`C1`/`CA`→Ca/`13C`/`D`/`T`/`O1'`；未识别→`X`/z=0。
- **对称操作**：`symop_operation_xyz`/`equiv_pos_as_xyz`/`operation_xyz` 列识别；单值 item 的逐行无引号操作；`readOperation` 拼接 `x, y, z`；前导编号（`1 x,y,z`）剥离；`text` 去前导编号/尾部空白、保留内部空白（去重键 `lower(text)`，不归一空白）；递归下降表达式文法及 7 类错误文本。
- **VESTA**：SYMOP 12 数值按 `t x y z + 行优先 3x3`；旋转全零行丢弃；`allZero` 结束 STRUC；续行（<7 token）跳过；GROUP 解析 `number setting 名称`；`op.text` 与 C++ `fixed setprecision(12)` 一致。
- **错误/警告文本**：与 core.md §3.10 / §4 / §5 逐字一致（中文硬编码，D19 风险已知）。
- **周期表**：数值/分类与 PeriodicTable.cpp、elements.json 完全一致（测试逐条比对 118 行 + kUnknown）。

## 3. 关键数值验证（测试证据）

- 12 个 COD 库 CIF：blockName（COD id）、空间群、晶胞 a/c/体积、不对称位点数、对称操作数全部断言；
  用测试内（仅测试用）的展开模拟验证展开后元素计数与 C++ 测试一致：
  halite Na4Cl4 / fluorite Ca4F8 / perovskite Ca4Ti4O12 / cooperite Pt2S2 / rutile Ti2O4 /
  brookite Ti8O16 / anatase Ti4O8 / sphalerite Zn4S4 / wurtzite Zn2S2 / diamond C8 / quartz Si3O6 / calcite Ca6C6O18。
- 与 model 层集成（2026-11-21 时点 `web/js/core/crystal.js`）：`CL.crystal.expand(parse(text))` 对 12 个库 CIF
  展开后的元素计数与 C++ `TestLibraryStructures` 完全一致（Na4Cl4、Ca4F8、Ca4Ti4O12、Pt2S2、Ti2O4、Ti8O16、
  Ti4O8、Zn4S4、Zn2S2、C8、Si3O6、Ca6C6O18）。
- 示例：`quartz.cif`（2 位点/6 操作→Si3O6）、`diamond.cif`（8 位点/0 操作）、`srtio3.cif`（5 位点/0 操作）、
  `nacl.vesta`（2 位点/4 操作→Na4Cl4，Cl cart=2.8201 Å）、`water.xyz`、`benzene.xyz`。
- CIF 内联边界用例：带撇号标题、`1.000(2)e1`、笛卡尔回退+回算分数、disorder、`C#1`、多 data 块、
  多模型、无引号对称操作、特殊位置、单值对称 item、IT 号 `#n` 回退、错误行号（坏坐标 line=8）。

## 4. 已知差异 / 风险

1. **晶胞构造**：`cif.js` 自带 `makeCell`（core.md §2.2 五级校验与错误文本逐条一致；VESTA 复用），
   不直接调用 `CL.Math.buildCell`，因为解析器需要区分"参数非正/角度越界/退化/体积为零"的中文错误文本。
   两者的晶格基与体积已被测试逐结构比对（`test_parsers.js` 的 "parser cells agree with CL.Math.buildCell"）。
   当前 `CL.Math`（impl-core-model 维护）已含 `wrap01/wrapHalf/visitImageRows` 等解析/模型共用函数，解析层不依赖它们。
2. **VESTA 差异（刻意改进）**：
   - `Site.siteIndex` 取数组下标（CONTRACT §5.1 / core.md §5.3 "以数组下标为准"），而非 C++ STRUC `index-1`；
     模型展开本就会用位点下标覆盖 Atom 的 siteIndex。
   - STRUC 出现在 CELLP 之前时，解析结束后会补算 `cart`（C++ 会保留 0 向量）；更健壮且不影响标准文件。
3. **CIF 数字文法差异（极低风险）**：C++ `strtod` 还接受十六进制浮点（`0x1p3`）、`inf`/`nan`（随后被 `isfinite` 拒绝）；
   JS 用十进制正则，十六进制浮点会判失败。实际 CIF 不使用。
4. **`nameZh` 为 `null`**：elements.json / C++ 无中文元素名（core.md §1.2）；若 UI 需要中文元素名，需在 `i18n.json`/
   `ui/i18n.js` 增补（解析层不臆造数据）。
5. **`formula` 字段**：解析器按 core.md §1.7 写入（CIF 取 `_chemical_formula_sum/_moiety`，XYZ/VESTA 为 `""`），
   模型 finalize 可再用 `cellContents` 回填；`cellContents/elementCounts/atoms/bonds/center/boundRadius` 由 model 层生成。
6. **测试 harness 限制**：`tests/node/run.js` 的 VM sandbox 未暴露 `require`，因此测试未用 `node:assert`，
   改用本地断言助手（`ok/eq/near/vecNear/expectParseError`）；这与 CONTRACT §7 "断言用 node:assert" 略有出入，
   但 harness 是唯一可执行入口（已报 lead，若 run.js 后续注入 `assert` 可直接替换）。
7. **`tests/node` 依赖**：`test_parsers.js` 只依赖 `math.js + periodic_table.js + 解析文件`；`test_periodic.js`
   额外读取 `reference/.../PeriodicTable.cpp` 与 `docs/spec/elements.json` 做数据一致性比对（仅测试用 readText）。
8. **中文错误文本（D19）**：解析错误/note 按 C++ 中文硬编码输出；英文模式由 UI 兜底（i18n 暂无解析键）。

## 5. 跨模块观察（供 lead/QA）

- `tests/node/test_acceptance.js` §2.6（disorder 控制组）把两个 C 原子放在 (0.10,0.10,0.10) 与 (0.15,0.10,0.10)
  （a=4 → 间距 0.2 Å），却期望成 1 条键；C++ `BuildBonds` 对 <0.42 Å 的原子对直接跳过（core.md §14.3/§7），
  该断言与参考实现矛盾（应改用 ≥0.42 Å 的间距，如 0.25）。非解析层问题。
- `tests/node/test_acceptance.js` §2.15 用 library/halite.cif 断言 `measureDistance(0,4)=2.8201`：库文件 Cl 源位点是
  (0.5,0.5,0.5)，展开后 atoms[4] 是体心 Cl，其最近像距离为 √3·a/2 = 4.8845 Å（模型算出的正是此值，正确）；
  2.8201 对应的是 C++ 内联夹具 `kNaCl`（Cl 源位点 0.5,0,0）。测试应改用内联夹具或改成"最近 Na–Cl 键长"断言。
- 全量 `node tests/node/run.js`：解析/周期表断言全绿（62 个）；剩余失败 2 个为上述 QA 夹具问题，4 个 skip 为其他模块
  尚未完成的 API（edit/export）。
