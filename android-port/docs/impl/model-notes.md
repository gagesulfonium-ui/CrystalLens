# 模型层实现说明（impl-core-model）

> 对应文件：`web/js/core/{crystal,measure,edit,export,format}.js`、`web/js/lib/math.js`（修订）、
> `tests/node/{test_crystal,test_measure,test_edit,test_export}.js`。
> 基线：`../`（C++ v1.1.0，只读）+ `docs/spec/core.md` §1–§16 + `docs/QA-ACCEPTANCE.md` §2。

## 1. 实现概览

| 文件 | 内容 |
|---|---|
| `lib/math.js` | `buildCell`（core.md §2.2 五级校验，失败返回 null）、`fracToCart/cartToFrac`（三重积公式）、`wrap01/wrapHalf`、`visitImageRows`（C++ 球-晶格面切片枚举）、`minimumFractionalDelta`（斜胞最短格点搜索，正交快速路径）、`minimumImage/imageOffset`、`cellCorners`（C++ 顺序 `x+2y+4z`）、`convexHull3D`（平面枚举 + 共面 mask 合并 + 2D 单调链 + 扇形三角化 + 真实棱），以及原有 vec3/mat3/mat4 全部保留。 |
| `core/crystal.js` | `expand`（对称展开/去重/label/30000 截断）、`buildBonds`（三分支容差/无序互斥/自键过滤/多像/150000 截断/暴力+网格）、`computeContents`（Z 升序、不约分）、`computeBounds`、`finalize`、`fitsSupercell`、`buildDisplayModel`（闭区间 [0,N] 显示集合/边界预算/可见键 map/子胞线/axes/stats）、`buildCoordinationMeshes` + `buildPolyhedra`（多面体）、`getVisiblePoints`、元素助手。 |
| `core/measure.js` | `measureDistance/measureAngle`（周期最小镜像 + image offset），返回 CONTRACT Measurement（points/offsets/label）并附 C++ 兼容字段（a/b/c/offsetA/B/C）；同时支持 StructureData 与 DisplayModel 入参。 |
| `core/edit.js` | `setCellParameters/addAtomSite/updateAtomSite/deleteAtomSite`：纯函数（不修改入参），候选结构完整校验后 `finalize`，返回 `{ok,structure[,siteIndex]}` / `{ok:false,error}`。 |
| `core/export.js` | `exportCif`（不对称单元+对称操作、8 位小数、CifQuote、可选 disorder/Uiso 列、`#IT` 分支、标签去重）与 `exportXyz`（StructureData→单胞展开原子；DisplayModel→kind==='cell' 的显示原子）；附 `*Result()` 版本。 |
| `core/format.js` | §13.3 全部格式化函数、`formatDisplayName`、`atomDisplayLabel`、测量表达式/数值、`buildStructureSummary`，以及 `computeSummary`（Hill 排序+GCD 约分的 formula、Z 序 cellContents、elementCounts、center/boundRadius 等）。 |

## 2. 关键对齐点（与 C++ 逐条对应）

- **展开**：`cell` 无效/无位点 → atoms=sites 拷贝、`symmetryExpanded=false`；无 symops → 单位操作（标志仍 false）；显式操作 → true；去重 = `wrap01(apply)+minimumFractionalDelta→|Δcart|<1e-3`；`symmetryIndex` 取首个命中的操作；label：单像 `baseLabel`，多像 `baseLabel_(copy+1)`；`occupancy<=0` 整组跳过；>30000 截断 + note。
- **成键**：`PairBondCutoff` 三分支（金属-金属 +0.12 且含碱/碱土直接 0；金属-非金属 +0.35；其余 +0.12）；`cutoff = clamp(base*tolerance/1.2, 0, 6)`；`<0.42 Å` 跳过；无序集合互斥（同 assembly 不同 group）；周期像用 `visitImageRows` 全枚举（同一对可多条键）；自键只保留 `[tz,ty,tx] > [0,0,0]` 半边；排序 `(a,b,shift)`；n<1600 暴力 / ≥1600 网格（网格仅候选筛选，命中仍走完整像搜索）。
- **显示集合**：`[0,N]^3` 闭区间 + `eps=1e-7`；先放原始位点（永不因容量丢弃、数组最前），再放周期像；内部像= kind `'cell'`（可拾取），边界像 = `'boundary'`（不可拾取）；边界预算 `maxImages(80000)-interiorCount`；`FitsSupercell` 65536/300000，超限回退 1×1×1 并置 `supercellLimited`。
- **可见键**：Map<(atomIndex,tx,ty,tz)> 匹配 `src.tx+shift`；两端都在显示集合才计入 `visibleBondCount`；键半径 0.105（含 H ×0.82）、色 `[0.66,0.70,0.76]`。
- **多面体**：配位壳来自单胞周期键表（完整周期，不受边界显示限制）；两轮中心判定（先非碱/碱土，再碱/碱土；配体 z∈{7,8,9,16,17,34,35,53}；配位数≥4；中心 z≠0）；凸包 ≤14 点、共面合并、2D 单调链、扇形三角化、法线朝外；按显示实例复制（含边界像）；颜色=中心元素色。
- **stats（lead 决策 D1 + §8.4）**：`visibleAtomCount`=实例总数（含边界像）、`cellAtomCount`=内部位点数、`boundaryAtomCount`=边界像数、`visibleBondCount`=可见键实例、`cellBondCount`=单胞周期键、`polyhedronCenterCount`=中心实例数（未计算多面体时为 0）、`polyhedronCount/polyhedronTriangleCount`=按需计算的实例/三角形数；`supercellLimited/boundaryLimited` 同上。
- **测量**：距离 offsetA=0、offsetB=minImage−(pb−pa)；角度以 b 为顶点，两臂各自修正；points 已减 origin；label 用 `formatLength/formatAngle`。
- **编辑**：`prepareAtomForStructure` 校验顺序/文本（元素→占位率→坐标→Wrap→元素符号→唯一标签）；有晶胞用 frac（缺失时 cart 回算），分子用 cart；`update` 只覆盖元素/label/occupancy/坐标（disorder/uiso 保留）；删除最后一个原子拒绝。错误优先使用 i18n key（`dialog.atom.error.invalid-element/-occupancy`、`dialog.error.invalid-number`、`dialog.edit-cell.error.invalid`、`toast.no-cell-for-cif`），无键的沿用 C++ 中文文本。
- **导出**：CIF 用 sites+symops（非展开原子），7 个 cell 字段 + 可选 title/formula/空间群/对称操作/原子循环，全部 8 位小数；标题/公式/空间群经 `CifQuote`；`#225` 写 `_space_group_IT_number`；原子标签按 `baseLabel` 唯一化（`_2` 起）。XYZ 8 位小数、注释行 CR/LF→空格、空则 `CrystalLens export`。

## 3. 与 C++ 的已知差异 / 决策

1. **DisplayModel 与样式解耦（lead 决策）**：`atoms/bonds/lines` 恒为完整显示集合（id 稳定），渲染器按 style 过滤（多面体样式只画 centers、不画键）。多面体几何仅在 `style==='polyhedral'` 或 `polyhedra:true` 时计算，否则 `polyhedra.enabled=false`、`polyhedronCenterCount=0`（UI 切到多面体样式时会强制重建模型，已确认 `ui/app.js` 的 `setStyle` 处理）。
2. **axes 线（lead 确认）**：`lines` 末尾追加 3 条 `kind='axes'`，从晶胞 (0,0,0) 沿 aVec/bVec/cVec 的完整晶格向量，顺序 a、b、c（渲染器按顺序红/绿/蓝，仅 `showAxes` 时绘制）。原版只有 2D gizmo，无 3D axes。
3. **baseRadius**：过渡金属→共价半径，其余（含 Na/Ca/K 等主族金属与非金属）→范德华半径；球棍缩放/空间填充由渲染器负责（`CL.periodic` 数据）。
4. **kind/pickable（D5 改进）**：`kind==='cell'` 的超胞内部副本皆可拾取；原版仅 `t=0` 的原始位点可拾取。边界像恒 `pickable=false`。
5. **note 去重**：重复 `finalize`/`expand` 不会重复追加截断提示（`appendNote` 幂等）；C++ 会重复拼接。`Structure.note` 由 UI 显示（D2）。
6. **成键正交快速路径**：`alpha=beta=gamma=90` 时用"逐轴 |Δ+t·L|≤cutoff"整数框枚举替代 `VisitImageRows`（数学上同为"所有距离≤cutoff 的像"，结果再做距离过滤；已用穷举对照测试锁定，误差 <1e-15）。非正交晶胞仍走 C++ 逐行枚举。`PairBondCutoff` 在单次 `buildBonds` 内按元素对缓存（无行为变化）。
7. **多面体安全上限**：实例 >60,000 或三角形 >400,000 时跳过几何（返回 `enabled=false` + `limited=true` 扩展字段），避免大超胞 OOM。16×16×16 halite 的 polyhedral 请求为 143,752 三角形/120 MB 堆，可完成（143 ms）；默认球棍样式不计算多面体，16³ 无压力。
8. **测量 API 双入参**：CONTRACT 写 `measureDistance(structure, aAtomId, bAtomId)` 但说明"输入 DisplayModel 的 atom id"；实现同时接受 StructureData（结构原子索引，C++ 语义）与 DisplayModel（DisplayAtom id，超胞感知）。返回对象同时含 CONTRACT 字段与 C++ 字段（`a/b/c/offsetA/B/C`），兼容两种消费方式。
9. **exportCif 失败返回 null**（附 `exportCifResult` 返回 `{ok,error}`）；`exportXyz` 双入参，DisplayModel 周期性结构只导出 `kind==='cell'`（QA §2 行数口径），StructureData 导出单胞展开原子（C++ 语义）。
10. **computeSummary**：额外提供 Hill 排序 + GCD 约分的 `formula`（如 halite→`ClNa`）与 `elements:[{z,symbol,count}]`，但 `StructureData.formula/cellContents` 仍按 C++ 语义（CIF formula 优先；cellContents 按 Z 升序不约分），`DisplayModel.formula` 直接用 `structure.formula`。
11. **数值格式**：`toFixed` 与 C++ `printf %.*f` 在极少数二进制半值上可能差 1 ULP（≤1e-8 显示级差异，D9 同类风险）。`formatLength/formatAngle` 对非有限值返回 `—`。
12. **CifQuote 边界**（D8）：值与 C++ 相同（只在"引号后跟空白"时判不安全），未额外修复"值以引号结尾"的非法 CIF 边界。

## 4. 性能数据（Node v24，PC；`node build/` 基准脚本已删除，数据可复现）

| 场景 | 结果 |
|---|---|
| 12 个晶体库 CIF `parse+finalize` 总计 | 11 ms |
| halite `parse+finalize`（8 原子/24 键） | 1.3 ms |
| halite `buildDisplayModel` 1×1×1 / 2×2×2 | 0.04 / 0.10 ms |
| halite 2×2×2 + polyhedral（63 中心/504 三角形） | 0.24 ms |
| srtio3 2×2×2（71 原子/192 可见键） | 0.04 ms |
| quartz 2×2×2 + polyhedral（SiO₄ 四面体） | 0.05 ms |
| 合成 669 原子结构 `finalize`（expand+contents+bounds+bonds） | 12 ms |
| halite 16×16×16 `buildDisplayModel`（35,937 原子/104,544 可见键） | 24 ms |
| halite 16×16×16 + polyhedral | 143 ms / ≈120 MB 堆（14.4 万三角形） |
| `measureDistance` / `exportCif`（halite） | 0.01 / 0.07 ms |

> Node 测试 harness 使用 `vm.runInContext` 沙箱，全局内建（如 `Math.floor`）调用显著慢于浏览器/普通 Node；
> 已把 `Math.ceil/floor` 缓存为模块内局部变量，669 原子用例在沙箱中从 ~76 ms 降到 ~11 ms。

## 5. 测试

- `node tests/node/run.js`：**190 tests, 0 failed**（含 lead 的 `test_acceptance.js` 32 组、parser/periodic 测试与本人 4 个文件）。
  - `test_crystal.js`（53）：Math 晶胞/斜胞最小镜像穷举对照/凸包；expand 去重+label+截断；成键 24/12/16/2、自键、网格等价、正交快速路径穷举对照、无序互斥；显示集合 27/125/343/64、边界预算 80,000、超胞容量回退、16³；stats 口径；多面体 63/504、CaF₈ 立方体、1×1×1 14 中心、SiO₄；12 库元素计数；性能。
  - `test_measure.js`（8）：水分子 0.9573 Å/104.51°、NaCl 最小镜像、offset 端点自洽、DisplayModel 超胞远像配对、无效输入。
  - `test_edit.js`（17）：元素输入、cell 编辑/校验/分子→晶体、增删改/标签唯一/校验错误、输入不可变、JSON 快照、CIF 往返。
  - `test_export.js`（18）：CIF 精确格式（8 位小数/可选列/IT 号/标签去重/CifQuote）、失败条件、CIF/XYZ 与 `CL.parsers` 往返、DisplayModel XYZ 行数口径。

## 6. 已知风险 / 待集成确认

1. **UI 测量未走模型层**：`web/js/ui/app.js::commitMeasurement()` 目前用显示空间 `pos` 直接算欧氏距离/角度，没有周期最小镜像；跨晶胞边界的测量会偏大/键角错误（已报 lead，建议改为调用 `CL.crystal.measureDistance/measureAngle(doc.model, ids…)` 并消费返回的 `points`）。渲染器与我的 measure.js 接口已按此准备。
2. **`stats.visibleBondCount` 与 style 无关**：模型始终按"两端都在显示集合"统计（含边界像）；C++ 在 space-fill 样式下该值为 0（不画键）。UI 结构面板在 space-fill 下会显示键数，属可接受的轻微差异；渲染器仍按样式决定是否画键。
3. **多面体 `polyhedra.edges`**：按 CONTRACT 输出真实棱（默认描边色 0x91B4D3）；渲染器实际用 `triangles` 平面合并重建 bary 描边，不读 edges，因此 `polyEdgeColor` 外观设置仍由渲染器生效（符合 v1.1）。
4. **边界像数值吸附**：`limits()` 使用 `1e-7` 分数 eps，与 C++ 一致；若 CIF 分数坐标恰好落在 1.0（解析层已 Wrap01 到 0）不会重复。
5. **`DisplayModel.atoms` 于 80,000 上限时约 100 MB 级 JS 对象**（对象而非 TypedArray，契约要求 JSON 可序列化的字段结构）；16³ 为 35,937 个，常规 2×2×2/3×3×3 无压力。渲染器上传后模型可继续复用（几何只在模型/选项变化时重建）。
6. **星号项**：`fitsSupercell` 返回 `{ok,limited,requested}`（CONTRACT §6.4 为 `{ok,limited}`，多返回 requested 无破坏）；`CellData` 无 `valid` 字段（以 `cell===null` 表示无效，与 CONTRACT 一致）。
