# CrystalLens Android 重构 · 实现契约 v1

> 本文件是并行开发唯一接口基准。所有实现 agent 必须遵守；如需变更接口，先在此文件记录（由 lead 维护）。
> 参考实现：`../`（C++ v1.1.0，只读）。**不要**参考工作区根目录旧版 `src/`（v0.7.0）。

## 1. 目标与架构

一款安卓晶体结构查看/编辑器，功能对齐 CrystalLens v1.1.0。

```
┌──────────────────────── Android APK (Java) ────────────────────────┐
│  MainActivity (WebView 全屏) ←→ WebAppBridge (文件/分享/震动/返回)  │
│      assets/www/  =  Web 产物（与预览版 100% 同一份代码）            │
└────────────────────────────────────────────────────────────────────┘
┌──────────────────── 共享 Web 核心（纯前端，离线） ──────────────────┐
│ index.html + css/ + js/（经典 <script>，全局 CL 命名空间，无打包器） │
│  lib/math   lib/periodic_table                                      │
│  core/cif  core/xyz  core/vesta  core/parsers                       │
│  core/crystal（对称展开/超胞/边界/键/多面体/测量/编辑/导出/格式化） │
│  render/camera  render/gl  render/renderer  render/overlay          │
│  ui/i18n  ui/native  ui/app  ui/panels  ui/dialogs  data/library    │
└────────────────────────────────────────────────────────────────────┘
交付：
  dist/preview/                       免安装预览（本地 HTTP 打开）
  dist/CrystalLens-Android-Preview.html  单文件免安装预览（可直接在安卓 Chrome 打开）
  dist/CrystalLens-v1.1.0-android.apk    签名 APK（侧载安装）
```

- 不使用 ES module / npm / CDN / 第三方库 / 构建工具；所有 JS 为经典脚本，按固定顺序加载，挂到 `globalThis.CL`。
- 每个文件包裹为 `(function (root) { 'use strict'; ... })(typeof globalThis !== 'undefined' ? globalThis : this);`。
- 只允许使用：HTML/CSS/Canvas2D/WebGL2/DOM API/localStorage/Web Worker（可选）/Node（仅测试）。
- 所有业务代码必须能脱离 DOM 在 Node 中执行（`CL.core` 部分），UI/渲染文件可以依赖 DOM。

## 2. 目录与所有权（写入范围）

| 路径 | 所有者 | 说明 |
|---|---|---|
| `docs/CONTRACT.md` | lead | 本文件 |
| `docs/spec/**` | 分析 agents | 源码规格（只读给实现者） |
| `web/index.html`, `web/css/**` | impl-ui | 页面骨架、样式 |
| `web/js/lib/math.js` | impl-core-model（初版由 lead 提供） | 共享数学 |
| `web/js/lib/periodic_table.js` | impl-core-parser | 周期表（来自 spec/elements.json） |
| `web/js/core/cif.js, xyz.js, vesta.js, parsers.js` | impl-core-parser | 解析 |
| `web/js/core/crystal.js, measure.js, edit.js, export.js, format.js` | impl-core-model | 模型 |
| `web/js/render/**` | impl-render | 渲染 |
| `web/js/ui/**`, `web/js/data/**` | impl-ui | UI、i18n、晶体库数据 |
| `web/data/**`, `web/assets/**` | spec-assets | 晶体库/示例/图标（只读给实现者） |
| `android/**`, `tools/build_apk.ps1` | impl-android | APK |
| `tools/**`（除 build_apk）、`tests/**`, `dist/**` | lead / impl-qa | 构建与测试 |
| `reference/**` | 只读 | 禁止修改 |

并行规则：**只写自己所有权内的文件**；跨文件需要修改时通过 lead 或在任务看板留言。UI 可以读取 `CL` 任何公开 API，但不要修改核心/渲染文件。

## 3. 全局约定

- 命名空间：`CL`。子命名空间：`CL.Math`, `CL.periodic`, `CL.parsers`, `CL.crystal`, `CL.Renderer`, `CL.Camera`, `CL.i18n`, `CL.Native`, `CL.App`, `CL.ui`。
- 单位：长度 Å；角度度（API 输入输出），内部三角函数用弧度；时间毫秒。
- 坐标系：右手系；晶格 a 沿 +X；原子坐标区分 `frac`（分数）与 `cart`（笛卡尔 Å）。
- 颜色：渲染 API 使用 `[r,g,b]`（0..1 sRGB），数据层面用 `u32` 整数（`0xRRGGBB`，与 C++ 一致）或 `"#rrggbb"` 字符串。统一：**数据模型/外观设置使用 u32 或 hex 字符串；交给渲染器时由渲染器转换**。
- 数值格式：UI 显示统一经 `CL.crystal.format`（对齐 C++ Format.cpp）。
- 错误处理：解析抛 `CL.ParseError`（`{name:'ParseError', message, line}`）；编辑等返回 `{ok:true}` 或 `{ok:false, error:<i18n key 或文本>}`，不抛异常。
- i18n：所有用户可见文案必须走 `CL.i18n.t(key, args)`；键表见 `docs/spec/i18n.json`（impl-ui 落地为 `web/js/ui/i18n.js`，缺 key 返回 key 本身并 console.warn 一次）。
- 纯 JSON：`StructureData` 必须可 `JSON.stringify/parse` 往返（撤销快照用），不含函数/Map/Set/类实例。显示模型 `DisplayModel` 可以含 TypedArray（渲染侧使用）。
- 性能预算：单文件 HTML ≤ 2 MB；晶体库首次载入 ≤ 300 ms；2×2×2 超胞重建 ≤ 500 ms（PC 基准，手机放宽 2×）；旋转 ≥ 45 fps（中端手机，<5 万原子）。

## 4. 脚本加载顺序（index.html）

```html
<script src="js/lib/math.js"></script>
<script src="js/lib/periodic_table.js"></script>
<script src="js/core/cif.js"></script>
<script src="js/core/xyz.js"></script>
<script src="js/core/vesta.js"></script>
<script src="js/core/parsers.js"></script>
<script src="js/core/crystal.js"></script>
<script src="js/core/measure.js"></script>
<script src="js/core/edit.js"></script>
<script src="js/core/export.js"></script>
<script src="js/core/format.js"></script>
<script src="js/render/camera.js"></script>
<script src="js/render/gl.js"></script>
<script src="js/render/renderer.js"></script>
<script src="js/render/overlay.js"></script>
<script src="js/ui/i18n.js"></script>
<script src="js/ui/native.js"></script>
<script src="js/data/library.js"></script>
<script src="js/ui/app.js"></script>
<script src="js/ui/panels.js"></script>
<script src="js/ui/dialogs.js"></script>
<script src="js/boot.js"></script>
```

`web/js/boot.js` 由 impl-ui 实现，末尾调用 `CL.App.init()`。单文件构建器会按此顺序内联，**文件名与顺序是契约**；新增文件必须同步更新本清单与 `tools/build_web.py`。

## 5. 数据结构

### 5.1 StructureData（解析结果，可在 Node 中测试）

```ts
type Vec3 = [number, number, number];

interface CellData {
  a: number; b: number; c: number;           // Å
  alpha: number; beta: number; gamma: number; // 度
  aVec: Vec3; bVec: Vec3; cVec: Vec3;          // 笛卡尔 Å
  volume: number;
}

interface SymOp { m: [Vec3,Vec3,Vec3]; t: Vec3; text: string; }

interface Site {                    // 不对称单元中的一个位点
  label: string;                    // 原始标签（如 "Na1"）
  baseLabel: string;                // 去对称后缀的标签
  element: string;                  // 元素符号（未知为 "X"）
  z: number;                        // 原子序数（未知 0）
  frac: Vec3 | null;                // 分数坐标（晶体）
  cart: Vec3 | null;                // 笛卡尔坐标（分子，或无分数坐标的晶体）
  occupancy: number;                // (0,1]
  uiso: number; hasUiso: boolean;
  disorderGroup: string;            // 无序组
  disorderAssembly: string;         // 无序集合
  siteIndex: number;                // 在 sites 中的索引（解析时赋值）
}

interface StructureData {
  format: 'cif' | 'xyz' | 'vesta';
  sourceName: string;               // 文件名（不含路径）
  title: string; blockName: string; spaceGroup: string;
  note: string;                     // 警告/备注（已本地化或原始文本，UI 直接用）
  periodic: boolean;                // 是否有晶胞
  cell: CellData | null;
  symops: SymOp[];                  // 显式对称操作（无则空数组）
  sites: Site[];                    // 不对称单元
  symmetryExpanded: boolean;        // 是否已按操作展开（解析阶段恒 false，展开后 true）
  asymmetricAtomCount: number;      // = sites.length
  symmetryOperatorCount: number;
  // 以下由 model 层补全（expand/buildBonds/summary 后）：
  atoms?: Atom[];                   // 展开后晶胞内原子
  bonds?: Bond[];
  elementCounts?: Record<string, number>;
  formula?: string; cellContents?: string;
  center?: Vec3; boundRadius?: number;
}
```

### 5.2 ExpandedStructure（`CL.crystal.expand` + `buildBonds` 后）

```ts
interface Atom {
  label: string; baseLabel: string; element: string; z: number;
  frac: Vec3;                 // 晶体内恒有值；分子表示为分数占位（见实现说明）
  cart: Vec3;
  occupancy: number; uiso: number; hasUiso: boolean;
  disorderGroup: string; disorderAssembly: string;
  siteIndex: number; symmetryIndex: number; symmetryGenerated: boolean;
}
interface Bond {
  a: number; b: number;          // atoms 索引
  length: number;
  shift: [number, number, number]; // 对 b 端施加的晶格平移
  imageOffset: Vec3;               // 渲染用：shift 对应的笛卡尔偏移
  periodic: boolean;
}
// 展开规则、去重、label 生成见 docs/spec/core.md
```

### 5.3 DisplayModel（模型 → 渲染器；`CL.crystal.buildDisplayModel`）

渲染空间：所有 `pos` 已减去结构中心（`origin`），即渲染器以原点为中心。相机 fit 用 `getVisiblePoints()`。
**重要：DisplayModel 与显示样式尽量解耦** —— `atoms`/`bonds` 始终是完整显示集合（不因 style 增删，保证 id 稳定、选择状态可跨样式保留）；
只有多面体几何是按需计算的（`style==='polyhedral'` 或显式 `polyhedra:true` 时计算，否则 `polyhedra.enabled=false`）。
渲染器负责样式过滤：`polyhedral` 时只画 `polyhedra.centers` 中的原子 + 多面体面，且不画键；`space-fill` 不画键；`ball-stick` 全画。

```ts
interface DisplayAtom {
  id: number;                // 本数组索引，渲染/拾取/选中都用它
  siteId: number;            // 对应 StructureData.sites 索引（编辑定位用）
  symmetryIndex: number;
  label: string; element: string; z: number;
  frac: Vec3;                // 超胞分数坐标（用于显示/测量/标签）
  pos: Vec3;                 // 渲染空间笛卡尔坐标（已减 origin）
  color: [number,number,number]; // 0..1 sRGB
  baseRadius: number;        // C++ 规则的元素基准半径（Å）：**过渡金属→共价半径，其余元素（含 Na/Ca/K 等主族金属）→范德华半径**（见 render.md §3）
  kind: 'cell' | 'boundary'; // boundary = 相邻晶胞镜像原子（不可拾取）
  pickable: boolean;         // kind==='cell' 且未被隐藏
}
interface DisplayBond {
  id: number; a: number; b: number;   // atoms 索引（可指向 boundary）
  radius: number; color: [number,number,number];
  periodic: boolean;
}
interface DisplayLine { p0: Vec3; p1: Vec3; kind: 'cell'|'axes'; } // 渲染器按 Appearance 上色
interface DisplayPolyhedra {
  enabled: boolean;
  centers: number[];                       // atom id
  triangles: { v: [Vec3,Vec3,Vec3]; n: Vec3; center: Vec3; color: [number,number,number]; }[];
  edges: { p0: Vec3; p1: Vec3; color: [number,number,number] }[];
}
interface DisplayModel {
  // 元信息（UI 显示）
  title: string; formula: string; cellContents: string; spaceGroup: string;
  note: string; format: string; sourceName: string;
  cell: CellData | null;
  supercell: [number, number, number];     // 请求值
  displayedCells: [number, number, number]; // 实际值（受容量限制）
  showBoundary: boolean;
  origin: Vec3;                            // 渲染空间平移量（atoms.pos = cart - origin）
  stats: {
    asymmetricAtomCount: number; symmetryOperatorCount: number;
    cellAtomCount: number; visibleAtomCount: number; boundaryAtomCount: number;
    visibleBondCount: number; cellBondCount: number;
    polyhedronCount: number; polyhedronTriangleCount: number;
    supercellLimited: boolean; boundaryLimited: boolean;
  };
  atoms: DisplayAtom[];
  bonds: DisplayBond[];
  lines: DisplayLine[];
  polyhedra: DisplayPolyhedra;
  hasCell: boolean;
}
```

`displayedCells` = 实际生效的超胞重复数（受容量限制时可能小于请求值）。
统计口径（**对齐原版 C++ HUD**，v1.1 行为为准；实现必须遵守）：
- `visibleAtomCount` = 当前显示的原子的**实例总数**（含边界像；对应 C++ Renderer::AtomCount/ HUD 原子数，如 halite 2×2×2 为 125）。
- `boundaryAtomCount` = 其中 `kind==='boundary'` 的实例数。
- `cellAtomCount` = 超胞内部位点数（不含边界像；对应 `[0,Nx)×…` 内部集合）。
- `visibleBondCount` = 视口实际绘制的键数（两端都有显示实例，含边界像；对应 C++ Renderer::BondCount）。
- `cellBondCount` = 单胞周期键总数（对应 C++ Renderer::CellBondCount）。
- `polyhedronCount` = 实际绘制的多面体（中心副本）数；`polyhedronTriangleCount` = 三角形数；
  `polyhedronCenterCount` = 多面体中心原子实例数（含边界中心；halite 2×2×2 为 63），未计算多面体时为 0。

### 5.4 外观与渲染选项

```ts
interface AppearanceState {         // 持久化（localStorage）
  cellColor: number;                // 0xD6DEE9
  backgroundColor: number;          // 0x020305
  cellLineWidth: number;            // 1.0
  polyTransparency: number;         // 66（%，100 = 只描边）
  polyEdgeWidth: number;            // 1.2（屏幕像素，0 隐藏）
  polyEdgeColor: number;            // 0x91B4D3
}
interface RenderOptions {
  style: 'ball-stick' | 'space-fill' | 'polyhedral';
  showCell: boolean; showAxes: boolean; showBonds: boolean;
  showLabels: boolean; showBoundary: boolean;     // showBoundary 影响模型重建
  atomScale: number;      // 0.30
  bondRadius: number;     // 0.105
  supercell: [number, number, number];
  appearance: AppearanceState;
  language: 'zh' | 'en';
  // 2D HUD 职责划分（避免 renderer canvas 与 UI DOM 重复绘制）：
  //   默认全为 true（渲染器可独立用于 dev-demo）。
  //   正式应用中 UI 传 { gizmo:false, legend:false, labels:false, measurements:true }：
  //   gizmo/legend/atom 标签由 UI 的 DOM HUD 绘制；测量线/端点/数值、hover tooltip 由渲染器叠层绘制。
  overlay?: {
    gizmo?: boolean;        // 相机轴 gizmo
    legend?: boolean;       // 元素图例
    labels?: boolean;       // 原子标签
    measurements?: boolean; // 测量线+端点标记+数值框
  };
}
```

### 5.5 相机（对齐 C++ Camera）

```ts
class Camera {
  target: Vec3; distance: number;
  yaw: number; pitch: number;        // 弧度；默认 yaw=35°, pitch=24°
  fovY: number;                      // 弧度；38°
  orthographic: boolean;
  setScene(center: Vec3, radius: number): void;
  fit(aspect: number, margin?: number): void;                    // margin 1.12
  fitPoints(points: Vec3[], aspect: number, margin?: number): void; // margin 1.16
  reset(center: Vec3, radius: number, aspect: number): void;
  orbit(dxPx: number, dyPx: number): void;
  pan(dxPx: number, dyPx: number, width: number, height: number): void;
  zoom(wheelSteps: number): void;
  eye(): Vec3; forward(): Vec3; right(): Vec3; up(): Vec3;
  viewMatrix(): Float32Array;        // 列主序（WebGL）
  projectionMatrix(width: number, height: number): Float32Array;
  screenRay(x: number, y: number, width: number, height: number): {origin: Vec3, direction: Vec3};
  worldToScreen(p: Vec3, width: number, height: number): {x:number,y:number,depth:number,visible:boolean};
  nearPlane(): number; farPlane(): number;
}
```

### 5.6 测量与标注

```ts
interface Measurement {
  kind: 'distance' | 'angle';
  atomIds: number[];                 // 2 或 3 个 DisplayAtom id
  value: number;                     // Å 或 度
  points: Vec3[];                    // 渲染空间世界点（已含周期镜像修正）
  offsets: Vec3[];
  label: string;                     // 已格式化，如 "1.234 Å"
}
interface Annotations { measurements: Measurement[]; pending: number[]; }
```

## 6. 模块 API

### 6.1 `CL.Math`
`vec3`（add/sub/scale/dot/cross/length/normalize/distance/lerp/neg）、`mat3`/`mat4`（乘法、逆、透视、正交、lookAt、变换）、`buildCell(a,b,c,alpha,beta,gamma) -> CellData|null`、`fracToCart(cell,frac)`、`cartToFrac(cell,cart)`、`minimumImage(cell,fromCart,toCart) -> Vec3`、`minimumFractionalDelta(cell,delta)`、`cellCorners(cell) -> Vec3[8]`、`convexHull3D(points) -> {triangles:[{a,b,c,normal}], edges:[[i,j]]}`（合并共面、只保留真实棱）、`deg2rad/rad2deg`、`clamp`、`lerp`。

### 6.2 `CL.periodic`
- `get(symbolOrZ) -> ElementEntry | null`：`{symbol, z, name, nameZh, category, metal, metalloid, covalent, vdw, colorU32, colorHex, rgb:[r,g,b]}`
- `all() -> ElementEntry[]`
- `classify(element) -> 'metal'|'nonmetal'|'metalloid'|'unknown'`
- `elementFromInput(text) -> {z, symbol} | null`（"Si"/"si"/"14"）
- 数据源：`docs/spec/elements.json`（spec-core 产出）。

### 6.3 `CL.parsers`
```ts
CL.parsers.detectFormat(text, fileName) -> 'cif'|'xyz'|'vesta'|null
CL.parsers.parse(text, fileName) -> StructureData   // 抛 CL.ParseError
CL.parsers.parseCif(text, fileName) -> StructureData
CL.parsers.parseXyz(text, fileName) -> StructureData
CL.parsers.parseVesta(text, fileName) -> StructureData
```

### 6.4 `CL.crystal`
```ts
// 展开与几何
expand(structure: StructureData) -> StructureData            // 就地/返回均可，幂等
buildBonds(structure: StructureData, tolerance = 1.2) -> StructureData
finalize(structure) -> StructureData                          // expand + bonds + summary
buildDisplayModel(structure, opts: {
  supercell:[n,n,n],
  showBoundary:boolean,
  style?: 'ball-stick'|'space-fill'|'polyhedral',  // 仅决定是否计算多面体
  polyhedra?: boolean                              // true 时强制计算（测试/程序调用）
}) -> DisplayModel
fitsSupercell(structure, copies:[n,n,n]) -> {ok:boolean, limited:boolean}

// 多面体
buildPolyhedra(displayModel, structure) -> DisplayPolyhedra  // 可并入 buildDisplayModel

// 测量
measureDistance(structure, aAtomId, bAtomId) -> Measurement | null   // 基于显示模型/结构
measureAngle(structure, a, b, c) -> Measurement | null
// 语义：输入 DisplayModel 的 atom id（UI 负责映射到结构坐标）。周期最小镜像公式见 spec-core。

// 摘要/格式化（format.js）
computeSummary(structure) -> {formula, cellContents, elementCounts, ...}
formatLength(v) -> string        // "1.234 Å"
formatAngle(v) -> string         // "90.00°"
formatCoord(v) -> string

// 导出（export.js）
exportCif(structure) -> string | null   // 无晶胞/无原子时返回 null；另提供 exportCifResult(structure)->{ok,text|error}
exportXyz(source) -> string | null      // source 可为 DisplayModel 或 StructureData；输出笛卡尔坐标

// 编辑（edit.js，全部纯函数式返回 {ok, structure|error}）
setCellParameters(structure, cellParams) -> Result
addAtomSite(structure, siteInput) -> Result
updateAtomSite(structure, siteIndex, siteInput) -> Result
deleteAtomSite(structure, siteIndex) -> Result
// siteInput = {element:string, frac?:Vec3, cart?:Vec3, occupancy?:number}
```

### 6.5 `CL.Renderer`（渲染）
```ts
const renderer = new CL.Renderer(containerEl);   // 创建 canvas，自适应 container
renderer.setModel(model: DisplayModel): void;
renderer.setOptions(options: RenderOptions): void;
renderer.setHighlight({selected:number[], hovered:number}): void;
renderer.setAnnotations(annotations: Annotations): void;
renderer.resize(width:number, height:number, dpr:number): void;
renderer.render(camera: CL.Camera): void;
renderer.getVisiblePoints(): Vec3[];             // 渲染空间点，供 camera.fitPoints
renderer.pick(camera, x:number, y:number): number; // 返回 DisplayAtom id 或 -1（只 pickable）
renderer.screenshot(): string;                   // data:image/png;base64,...
renderer.dispose(): void;
renderer.supported: boolean;                     // WebGL2 可用性
```

### 6.6 `CL.i18n`
`CL.i18n.t(key, ...args)`、`setLanguage('zh'|'en')`、`language`、`onChange(cb)`。

### 6.7 `CL.Native`（桥）
```ts
CL.Native.isAndroid: boolean
CL.Native.info(): {platform, sdkInt, appVersion, ...}
CL.Native.beginExport(name, mime, mode 'save'|'share'): boolean
CL.Native.appendExportChunk(base64Chunk): void
CL.Native.endExport(): Promise<{ok, uri?}>          // 非 Android 时用 <a download> 回退
CL.Native.toast(msg): void
CL.Native.setKeepScreenOn(on): void
CL.Native.vibrate(ms): void
CL.Native.exitApp(): void
CL.Native.onSharedFile(cb): void                     // 安卓"打开方式"传入文件
```
Java 侧契约见 `android/` 实现（由 impl-android 负责），注册名 `CLNative`。

### 6.8 `CL.assets`（资源，构建器注入）
单文件构建时无法按相对路径读取图片，因此 `tools/build_web.py` 会在应用脚本之前注入：
```js
CL.assets = { logo: 'data:image/png;base64,...', icon32: '...', icon192: '...' };
```
UI 引用品牌图时必须写成 `(CL.assets && CL.assets.logo) || 'assets/logo.png'`，保证目录版/单文件版都可用。
单文件版本约束：**禁止 fetch/XHR/ES module/外部 CDN/Service Worker**；晶体库与示例数据由 `web/js/data/library.js` 内嵌（`CL.data.library` / `CL.data.examples`）。

### 6.9 QA 自动化钩子（impl-ui 必须实现）
- URL 参数：`?lib=<id>`（打开晶体库结构）、`?example=<file>`、`?style=ball-stick|space-fill|polyhedral`、`?supercell=NxNyNz`、`?lang=zh|en`、`?showBoundary=0|1`、`?measure=distance|angle`、`?selftest=1`。
- `?selftest=1`：页面加载后运行内置自检（解析晶体库全部结构、构建显示模型、验证渲染器初始化、检查 UI 基本元素），完成后向 DOM 追加
  `<pre id="cl-selftest" style="display:none">{ "pass": N, "fail": M, "failures": ["..."], "info": {...} }</pre>`。
- 全局错误捕获：`window.onerror` / `unhandledrejection` 写入
  `<pre id="cl-error-log" style="display:none">{json array of strings}</pre>`（供无头测试读取）。
- 渲染状态需在 URL 参数生效后**至少渲染 2 帧**，确保无头截图有内容。

### 6.10 `CL.App`（UI 总控，impl-ui）
负责：状态、打开文件/晶体库、文档标签页（多结构）、面板/对话框、相机交互、测量模式、选择/悬停、编辑撤销、保存/导出/截图、设置持久化、i18n 切换、Android 返回键 `window.__clHandleBack()`、共享文件 `window.__clOpenSharedFile(name, base64)`。

## 7. 测试约定

- Node 测试（无依赖）：`tools/run_node_tests.ps1` 或 `node tests/node/run.js`。
  - `run.js` 按第 4 节核心文件顺序在 Node VM 中加载（跳过 render/ui 与 DOM 文件），定义全局 `CL`，然后 require `tests/node/test_*.js`。
  - 测试文件用 `test('名称', fn)` 注册（harness 提供）；失败即抛异常。
  - 断言用 `node:assert/strict`。
- 渲染/UI 测试（无头浏览器）：
  - `tests/headless/shot.cjs --url file:///.../dist/preview/index.html?lib=halite --out out.png --width 1280 --height 800` 用 Edge headless（路径由脚本自动探测）截图，并捕获 console/pageerror。
  - 页面支持 URL 参数用于自动化：`?lib=<id>` 打开晶体库结构；`?example=<name>` 打开示例；`?style=polyhedral|space-fill`；`?supercell=2x2x2`；`?lang=en`；`?autofit=1`。
- QA 必须提供的证据：Node 测试全部通过截图/日志、无头渲染截图（含多面体/超胞/中英文）、与原版 docs 截图视觉效果对照、APK 构建与签名验证输出。
- 测试夹具：`tests/fixtures/*.json`（StructureData / DisplayModel 快照）。

## 8. 移动端适配要求（impl-ui 必须满足）

- 触控：单指拖动旋转（带惯性）、双指 pinch 缩放 + 双指拖动平移、双击适配视图、长按拾取/选择、单击原子选择；桌面同时支持鼠标（左键旋转、中/右键平移、滚轮缩放、悬停高亮）。
- 布局：竖屏为"视口全屏 + 顶部工具栏 + 底部状态栏 + 左右抽屉面板"；横屏左右面板可并排。安全区（刘海/手势条）用 `env(safe-area-inset-*)`。
- 触控目标 ≥ 44×44 CSS px；面板/对话框用底部弹层（bottom sheet）；支持滚动与横屏。
- 多结构用**标签页**（替代原版多窗口），可关闭/切换，各结构独立相机与编辑栈（或至少独立结构状态）。
- 文本框输入用原生 input，避免自绘输入；数字键盘 `inputmode="decimal"`。
- 沉浸式全屏；状态栏信息精简；中英文完整。
- 性能：不要每帧重建几何；仅在模型/外观变化时重建；透明多面体排序每帧仅排序一次。

## 9. 构建流水线（lead 维护）

1. `powershell -File tools/fetch_toolchain.ps1` → `.toolchain/`（JDK17 + build-tools 36 + platform-36）。
2. `python tools/gen_library.py` → `web/js/data/library.js`（内嵌 12 个 CIF + 示例 + 元数据；数据源 `web/data/`、`docs/spec/library.json`）。
3. `python tools/build_web.py` → `dist/preview/`（目录版）+ `dist/CrystalLens-Android-Preview.html`（单文件版，内联 CSS/JS/数据/图标）。
4. `powershell -File tools/build_apk.ps1` → `dist/CrystalLens-v1.1.0-android.apk`（同步 `dist/preview/` 到 assets）。
5. 测试：`node tests/node/run.js`；`node tests/headless/shot.mjs ...`。

## 10. 验收标准（P0）

- [ ] CIF/XYZ/VESTA 解析 + 对称展开 + 超胞（1–16）+ 边界原子 + 周期键，与原版关键数值一致（NaCl、萤石、钙钛矿、KNiF₃、方钠石、Bi₂Te₃、CrCoBr₃、石英 等）。
- [ ] 球棍/空间填充/多面体三种样式；晶胞/子胞线框、坐标轴、元素图例、原子标签、选中/悬停高亮。
- [ ] 相机旋转/平移/缩放/适配/重置、透视/正交、原子拾取、键长/键角测量（含周期镜像）。
- [ ] 编辑晶胞/添加/编辑/删除原子、撤销/重做（50 步）、保存 CIF/XYZ、导出截图、复制摘要。
- [ ] 经典晶体库（12 个，离线）、打开本地文件（多选）、示例、中英文切换、外观设置持久化。
- [ ] 免安装单文件 HTML 在安卓 Chrome 离线可用；APK 可安装运行、文件打开方式可用、保存/分享可用。
