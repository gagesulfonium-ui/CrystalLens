# 相机 / 拾取 / 凸包 期望值用例（移植为 JS 测试的精确清单）

> 来源：`../tests/test_camera.cpp`（v1.1.0，只读基线），配合
> `src/render/Camera.cpp`、`src/render/Picking.cpp`、`src/render/PolyhedronMesh.cpp` 的公式。
> 目标：把 C++ 测试里**全部精确数字与不等式**保留下来，供 JS/WebGL2 版逐条复现。
>
> 使用方式：`docs/spec/render.md` §11/§12/§7 是公式权威；本文件是**验收夹具**。
> 建议实现一个最小测试运行器（`check(cond, msg)` / `near(a,b,eps,msg)`），统计 passed/failed，与原 `Check/CheckNear` 语义一致。

---

## 0. 可移植性分级

| 级别 | 用例 | 依赖 | JS 移植成本 |
|---|---|---|---|
| **P0 纯数学**（必做） | A1–A7（相机）、B1–B5（凸包） | 仅 `Camera` 与 `CoordinationHull` | 无外部依赖，可直接搬 |
| **P1 集成**（建议） | C3（拾取） | 结构解析 + 渲染器 `siteRadii` | 需 quartz.cif 解析 |
| **P2 集成**（可选） | C1、C2（显示几何/配位计数） | CIF 解析 + 渲染器计数器 + 示例/库文件 | 依赖解析器完全对齐 |

> C++ 原测试文件把 P2 与 P0 放在同一 `RunCameraTests()` 里；JS 版建议拆成 `camera.spec.js` / `polyhedron.spec.js` / `integration.spec.js`。

---

## 1. 公共约定（照抄，避免误差）

* 内部角度单位：**弧度**（`DEG = Math.PI / 180`）；`yaw/pitch/fovY` 字段都是弧度。UI 文本才写度。
* 屏幕坐标：原点左上、**y 向下**、单位设备像素；`WorldToScreen` 返回 `{x, y, depth, visible}`。
* 相机/凸包数学用 JS `Number`（float64）→ 与 C++ `double` 结果应在 `1e-12` 相对量级一致。
* 断言容差建议：
  * 相机标量/坐标：`1e-9 * max(1, |expected|)`（与原测试 `CHECK_NEAR(...,1e-9)`/`0.05` 对齐或更严）；
  * 屏幕像素：`1e-6` px（本文件参考值给到 6 位小数）；
  * 凸包：三角形数、`boundary` 计数、法线点积为**精确比较**（浮点 `> 0.99` 等原样保留）。
* 参考结构文件：`../examples/srtio3.cif`、`examples/quartz.cif`、`examples/water.xyz`、`library/halite.cif`、`library/fluorite.cif`、`library/perovskite.cif`、`library/quartz.cif`。
* 渲染选项的**初始状态**会影响 P2 计数（尤其 `showImages`），每个用例内已标注。

---

## 2. P0-A：相机用例

### A1 `TestFitFramesTheScene`（test_camera.cpp L39–58）

```js
const cam = new CL.Camera();
cam.reset(new CL.Vec3(1, 2, 3), 6.6, 1.15);          // yaw=35°, pitch=24°, Fit(aspect, margin=1.12)
const center = cam.worldToScreen(new CL.Vec3(1, 2, 3), 1200, 1000);
check(center.visible, "A1 center visible");
near(center.x, 600.0, 1.0, "A1 center.x");
near(center.y, 500.0, 1.0, "A1 center.y");

const target = new CL.Vec3(1, 2, 3);
const top = cam.worldToScreen(target.add(cam.up().mul(6.6)), 1200, 1000);      // target + up*6.6
check(top.visible, "A1 top visible");
check(top.y > 8.0 && top.y < 180.0, "A1 top.y in (8,180)");

const side = cam.worldToScreen(target.add(cam.right().mul(6.6)), 1200, 1000);  // target + right*6.6
check(side.visible, "A1 side visible");
check(side.x > 950.0 && side.x < 1200.0, "A1 side.x in (950,1200)");
```

**参考精确值**（float64，可作更严格的夹具）：

| 量 | 值 |
|---|---|
| `cam.distance`（`Reset`→`Fit(1.15,1.12)`） | `22.704923374109537` |
| `cam.eye()` | `(17.990835003851924, 13.897110750174518, 12.234924314478585)` |
| `nearPlane()` / `farPlane()`（sceneRadius=6.6） | `8.184923374109538` / `65.70492337410954` |
| `center` 屏幕 | `(600.0, 500.0)`，`depth = 0.461018` |
| `top = target + up*6.6` 屏幕 | `(600.0, 77.893493)` |
| `target + right*6.6` 屏幕 | `(1022.106507, 500.0)` |
| `target - right*6.6` 屏幕 | `(177.893493, 500.0)` |
| `target - up*6.6` 屏幕 | `(600.0, 922.106507)` |
| `viewMatrix()`（列主序 16 浮点） | `[-0.573576436, -0.333179153, 0.748332629, 0, 0.819152044, -0.233294554, 0.523988148, 0, 0.0, 0.913545458, 0.406736643, 0, -1.064727652, -1.940868112, -25.721442229, 1]` |
| `projectionMatrix(1200,1000)`（**注意用 aspect=1.2**） | `[2.420175731,0,0,0, 0,2.904210878,0,0, 0,0,-1.284593998,-1, 0,0,-18.699226812,0]` |

> 说明：`Fit` 用 `aspect=1.15`，而 `worldToScreen` 用 `1200/1000 = 1.2`，二者不同是原测试的既定组合，必须照抄。

### A2 `TestRayThroughCenter`（L60–70）

```js
cam.reset(new CL.Vec3(0,0,0), 5.0, 1.4);
const ray = cam.screenRay(700, 500, 1400, 1000);
near(ray.direction.length(), 1.0, 1e-9, "A2 dir unit");
const tc = (new CL.Vec3(0,0,0).sub(ray.origin)).dot(ray.direction);
check(tc > 0.0, "A2 center in front");
const closest = ray.origin.add(ray.direction.mul(tc));
near(closest.length(), 0.0, 0.05, "A2 ray hits center");
```

参考：`cam.distance = 17.200699525840555`；`eye = (12.871844699887818, 9.012962689526148, 6.9961547836958955)`；像素 (700,500) 即画面正中（ndcX=0, ndcY=0）→ 方向恰为 `forward`，命中中心（精确为 0，误差仅来自 float64）。

### A3 `TestOrbitAndZoom`（L72–85）

```js
cam.reset(new CL.Vec3(0,0,0), 5.0, 1.5);
const yaw0 = cam.yaw, dist0 = cam.distance;
cam.orbit(40.0, 20.0);
check(cam.yaw < yaw0, "A3 yaw decreases");
check(cam.pitch > 24.0*DEG, "A3 pitch increases");
cam.zoom(3.0);
check(cam.distance < dist0, "A3 zoom in");
cam.orbit(0.0, -10000.0);
check(cam.pitch <= 85.0*DEG + 1e-6, "A3 pitch clamp +85");
check(cam.pitch >= -85.0*DEG - 1e-6, "A3 pitch clamp -85");
```

参考值：`dist0 = 17.200699525840555`；`orbit(40,20)` 后 `yaw = 18.49881550023229°`，`pitch = 32.25059224988386°`；`zoom(3)` 后 `distance = 10.643507194037896`（`*= exp(-0.48)`）；最后一次 `pitch = -85°`。

### A4 `TestOrthographic`（L87–97）

```js
cam.reset(new CL.Vec3(0,0,0), 5.0, 1.5);
cam.setProjection(true);                                  // cam.orthographic = true
const c = cam.worldToScreen(new CL.Vec3(0,0,0), 1000, 800);
check(c.visible, "A4 visible");
near(c.x, 500.0, 0.5, "A4 center.x");
near(c.y, 400.0, 0.5, "A4 center.y");
const ray = cam.screenRay(500, 400, 1000, 800);
near(ray.direction.length(), 1.0, 1e-9, "A4 dir unit");
```

参考：`distance = 17.200699525840555`；`near/far = 6.200699525840555 / 52.200699525840555`；中心 `screen=(500,400)`、`depth=-0.5217391304347826`、`visible=true`；
正交投影矩阵（`width=1000,height=800` → aspect=1.25；`halfH = distance*tan(19°) = 5.9226758146453555`，`halfW = 8.884013721968033`）：
`[0.135074079,0,0,0, 0,0.168842603,0,0, 0,0,-0.043478261,0, 0,0,-1.269595632,1]`。

### A5 `TestTightPointFit`（L99–126）

```js
cam.setScene(new CL.Vec3(0,0,0), 8.0);
cam.yaw = 35.0*DEG; cam.pitch = 24.0*DEG;
const points = [];
for (const x of [-1,1]) for (const y of [-1,1]) for (const z of [-1,1])
    points.push(new CL.Vec3(5.0*x, 4.0*y, 3.0*z));

cam.fit(1.5);                                             // 球 fit（margin 默认 1.12）
const sphericalDistance = cam.distance;
cam.fitPoints(points, 1.5, 1.18);                         // 点集 fit（margin 1.18）
check(cam.distance < sphericalDistance, "A5 point fit tighter");

let allInside = true, touchesMargin = false;
for (const p of points) {
    const s = cam.worldToScreen(p, 1500, 1000);
    if (!s.visible) allInside = false;
    if (s.x < 0 || s.x > 1500 || s.y < 0 || s.y > 1000) allInside = false;
    if (s.x < 120 || s.x > 1380 || s.y < 90 || s.y > 910) touchesMargin = true;
}
check(allInside, "A5 all corners inside");
check(touchesMargin, "A5 at least one near margin");
```

参考精确值：

| 量 | 值 |
|---|---|
| `fit(1.5)`（sceneRadius 8, margin 1.12） | `27.521119241344895` |
| `fitPoints(..., 1.5, 1.18)` | `22.916426781078908` |
| 拟合后 near/far | `5.316426781078906` / `72.91642678107891` |
| 屏幕（1500×1000）8 个角点 | 见下表 |

| point | screen.x | screen.y | depth |
|---|---|---|---|
| (-5,-4,-3) | 730.1992 | 506.8580 | 0.7747 |
| (-5,-4, 3) | 728.4442 | 218.3893 | 0.7407 |
| (-5, 4,-3) | 1096.0681 | 613.0894 | 0.7124 |
| (-5, 4, 3) | 1132.2498 | 283.9220 | 0.6659 |
| ( 5,-4,-3) | 353.2868 | 724.2538 | 0.6473 |
| ( 5,-4, 3) | 305.0014 | 354.5817 | 0.5853 |
| ( 5, 4,-3) | 782.4342 | 923.7288 | 0.5305 |
| ( 5, 4, 3) | 787.4253 | 487.0377 | 0.4341 |

（`max y = 923.7288 > 910` → `touchesMargin = true`；全部在 `[0,1500]×[0,1000]` 内。）

### A6 `TestSupercellFit`（L250–264）

```js
const points = [];
for (const z of [0,1]) for (const y of [0,1]) for (const x of [0,1])
    points.push(new CL.Vec3(40 + 6*x, -11 + 8*y, 12*z));

for (const ortho of [false, true]) {
    cam.setProjection(ortho);
    cam.fitScenePoints(points, 1.25, 1.18);
    nearDist(cam.target, new CL.Vec3(43, -7, 6), 1e-9, "A6 target = bbox center");
    for (const p of points) {
        const q = cam.worldToScreen(p, 1000, 800);
        check(q.visible && q.x > 0 && q.y > 0 && q.x < 1000 && q.y < 800, "A6 corner inside");
    }
}
```

参考精确值（`FitScenePoints` = `SetScene(bboxCenter, r)` + `FitPoints(points,1.25,1.18)`）：

| 量 | 值 |
|---|---|
| bbox | lo `(40,-11,0)`，hi `(46,-3,12)` |
| `target` | `(43, -7, 6)`（**精确**，测试 `|Δ|<1e-9`） |
| `sceneRadius` | `sqrt(61) = 7.810249675906654` |
| 透视 `distance` | `27.308037887654447` |
| 透视 near/far | `10.125488600659807` / `76.35928626718771` |
| 正交 `distance` | `25.407507266415358` |
| 正交 near/far | `8.224957979420719` / `74.45875564594863` |

屏幕参考（1000×800）：

| point | 透视 (x,y) | 正交 (x,y) |
|---|---|---|
| (40,-11, 0) | 446.9794, 520.9262 | 428.8620, 562.2474 |
| (46,-11, 0) | 303.8701, 617.7272 | 271.5113, 653.6493 |
| (40, -3, 0) | 694.1744, 610.3995 | 728.4887, 647.5812 |
| (46, -3, 0) | 571.1380, 738.9831 | 571.1380, 738.9831 |
| (40,-11,12) | 438.1195, 105.1306 | 428.8620,  61.0169 |
| (46,-11,12) | 265.1430, 145.5185 | 271.5113, 152.4188 |
| (40, -3,12) | 732.0585, 142.3878 | 728.4887, 146.3507 |
| (46, -3,12) | 588.0533, 199.1733 | 571.1380, 237.7526 |

### A7 矩阵/近远平面补充夹具（本文件新增，防止“能跑但方向反了”）

| 用例 | 期望 |
|---|---|
| `cam.reset({1,2,3},6.6,1.15)` 的 `eye` | 见 A1 |
| `cam = new Camera()` 默认 | `target=(0,0,0), distance=20, yaw=35°, pitch=24°, fovY=38°, orthographic=false, sceneRadius_=10` |
| `cam.setScene({0,0,0}, 0.2)` → `sceneRadius()` | `max(0.5, 0.2) = 0.5` |
| `nearPlane()` 在 `distance < 2.2*sceneRadius` 时 | `0.02`（下限） |
| `farPlane()` | `max(near+2, distance+5r+10)`，随 distance 增长 |
| `orbit(0, +y)` | pitch **增大**（`pitch += dy*0.0072`），不是减小 |
| `pan(+dx, 0)` | `target` 沿 **-right** 移动（画面内容跟手） |
| `zoom(+1)` | `distance *= exp(-0.16) ≈ 0.85214`（放大） |

---

## 3. P0-B：凸包用例

### B1 `TestPolyhedronFaces` — 立方体 + 内部点（L128–139 前段）

```js
const cube = [];
for (const x of [-1,1]) for (const y of [-1,1]) for (const z of [-1,1]) cube.push(new CL.Vec3(x,y,z));
cube.push(new CL.Vec3(0,0,0), new CL.Vec3(1,0,0), new CL.Vec3(1,1,0), new CL.Vec3(1,1,1));
// 注意 (1,1,1) 与立方体角点重合，会在去重阶段被丢掉（LengthSq < 1e-12）

const mesh = CL.Polyhedron.coordinationHull(cube);
check(mesh.length === 12, "B1 cube hull -> 12 triangles");          // 6 面 × 2
let sides = 0;
for (const tri of mesh) {
    sides += tri.boundary.filter(Boolean).length;
    check(tri.normal.dot(tri.corners[0]) > 0.99, "B1 outward normal");
}
check(sides === 24, "B1 twelve edges x two faces");                 // 12 条真实棱 × 2
```

### B2 `TestPolyhedronFaces` — 共面点（L140）

```js
const coplanar = [[0,0,0],[1,0,0],[0,1,0],[1,1,0]].map(a => new CL.Vec3(...a));
check(CL.Polyhedron.coordinationHull(coplanar).length === 0, "B2 all coplanar -> empty");
```

### B3 `TestPolyhedronFaces` — 四面体（L141）

```js
const tetra = [[1,0,0],[0,1,0],[0,0,1],[-1,-1,-1]].map(a => new CL.Vec3(...a));
check(CL.Polyhedron.coordinationHull(tetra).length === 4, "B3 tetra -> 4 triangles");
```

### B4 建议的补充夹具（本文件新增，覆盖算法分支；可选）

| 输入 | 期望 | 覆盖点 |
|---|---|---|
| 正八面体 6 点 `±x,±y,±z` | `8` 三角形，每个 `boundary` 全为 `true` | 全三角面 |
| 立方体 + 面心点（6 个面心） | 仍 `12` 三角形；面心点不产生额外轮廓 | 面内点被单调链消除 + 共面合并 |
| 立方体 + 棱中点（12 个） | 仍 `12` 三角形 | 共线点消除 |
| 15 个互不相同的凸位置点 | `[]`（空） | `points.length > 14` 早退 |
| 5 点：正方形 + 顶点上方一点（四棱锥） | `6` 三角形（4 侧 + 2 底） | 三角化 + 部分边为 boundary |
| 正四面体边长 1（顶点到中心距离 `sqrt(3/8)`） | `4` 三角形 | 一般位置 |
| 立方体 8 点但带 1e-7 抖动（< eps） | 仍 `12` 三角形 | `eps=1e-6` 共面判定 |

> 提示：`CoordinationHull` 输入是**相对中心**的配体向量；`Corner` 直接使用该向量（不归一化），因此 B1 的法线点积 0.99 断言只在中心位于原点成立。

### B5 配位壳筛选（`coordinationMeshes`，P2 级，依赖 CIF）

| 结构 | 期望中心（任一 hull 非空的站点） | 每中心三角形 | 说明 |
|---|---|---|---|
| `halite.cif`（NaCl） | 仅 Na | 8（八面体） | Cl 是配体（Z=17）被排除；Na 走“碱金属”第二轮 |
| `fluorite.cif`（CaF₂） | 仅 Ca | 12（立方体） | Ca 碱土 → 第二轮；F 配体 |
| `perovskite.cif` | 仅 Ti | 8（八面体） | Ti 非碱 → 第一轮 |
| `quartz.cif` | 仅 Si | 4（四面体） | Si 非碱 → 第一轮；O 配体 |
| `water.xyz` | 无（返回 `[]`） | — | 无晶胞/无周期键 |
| `srtio3.cif` | 仅 Ti | 8（八面体，**推断**：测试只断言每胞 1 个中心） | Sr 碱土但 Ti 第一轮已命中 → 返回 Ti 壳 |

接口：`coordinationMeshes(structure) -> Array<PolyTriangle[]>`，长度 = `structure.atoms.length`；未命中中心为 `[]`；整结构无壳时返回 `[]`（外层空数组 ≠ 长度 N 的全空数组）。

---

## 4. P2-C：集成计数用例（需解析器 + 渲染器计数器）

> 计数器与渲染规格的对应：`AtomCount()` = 原子实例数（含边界副本）；`BondCount()` = 可见键数；`CellBondCount()` = 结构周期键表长度；`LineCount()` = 晶胞线 + 可见键 + 测量线；`PolyhedronTriangleCount()` = 凸包三角形总数；`SiteRadii()` = 每站点可见半径（隐藏=0）；`SupercellLimited()/BoundaryLimited()` 标志。

### C1 `TestDisplayGeometry`（srtio3.cif，L144–184）

按测试顺序（**注意 `showImages` 状态**）：

| 步骤 | 选项 | 断言 |
|---|---|---|
| 1 | 默认 + `supercell=2×2×2`（`showImages=true`） | `AtomCount == 71`；`CellBondCount == 18`；`BondCount == 192`；`LineCount == 192 + 27`（=219） |
| 2 | `setAnnotations([], [])` | `LineCount == 219`（无测量线） |
| 3 | `showImages=false` | `AtomCount == 40`；`BondCount < 192` |
| 4 | `supercell=16×16×16`（showImages 仍 false） | `!SupercellLimited()`；`AtomCount == 5*16*16*16 = 20480` |
| 5 | `style=Polyhedral`（同超胞） | `AtomCount == 16*16*16 = 4096`（只剩 Ti 中心） |
| 6 | `style=BallAndStick`，`supercell=2×2×2` | — |
| 7 | `structure.atoms.push(atoms[0])` 后 `SetStructure` | `AtomCount == 48`（6 站点 × 8 内部；showImages=false） |
| 8 | `structure.atoms.resize(9000, atoms[0])` 后 `SetStructure` | `SupercellLimited()`；`AtomCount == 9000`；`LineCount - BondCount == 12`（单胞 12 条晶胞线） |
| 9 | `SetStructure(null)` | `AtomCount==0 && BondCount==0 && LineCount==0` |

### C2 `TestCoordinationRendering`（L186–248）

初始 `style=Polyhedral, showImages=false`（`setOptions` 在加载结构前调用）：

| 结构 | 期望 |
|---|---|
| halite.cif | `AtomCount==4`；`PolyhedronTriangleCount==4*8=32`；`coordinationMeshes().length == atoms.length` |
| fluorite.cif | `AtomCount==4`；`Triangles==4*12=48` |
| perovskite.cif | `AtomCount==4`；`Triangles==4*8=32` |
| quartz.cif | `AtomCount==3`；`Triangles==3*4=12` |
| 每个站点 | `SiteRadii()[site] > 0` ⇔ 该站点元素 == 中心元素；`meshes[site].length == (是中心 ? 每中心三角形 : 0)` |
| halite + `supercell=2`（showImages=false） | `AtomCount==32`；`Triangles==256`（=32×8） |
| halite + `supercell=2`、`showImages=true`、`showBonds=false` | `AtomCount==63`；`Triangles==504`（=63×8）；`LineCount==27`（只有晶胞线；多面体模式不画键） |
| halite 所有凸包顶点长度 | `== cell.a / 2`（=2.82 Å），误差 1e-6（Na–Cl 距离） |
| `structure.bonds.clear()`（halite，supercell2，showImages=true，showBonds=false，Polyhedral） | `Triangles==0`；`AtomCount==125`（无壳 → 球棍回退，显示全部原子+边界副本） |
| water.xyz（默认选项、无测量） | `AtomCount==3`；`Triangles==0`；`LineCount==2`（showBonds=true，2 条水分子键） |
| `SetStructure(null)` | `SiteRadii().length==0`；`Triangles==0` |

### C3 `TestAtomPicking`（quartz.cif，L266–293）

```js
// 注意：测试里相机 target 是 structure.center（绝对坐标），而被拾取球心是 cart - center；
// 这不是笔误，投影与拾取都基于同一相机，因此自洽。
const cam = new CL.Camera();
cam.reset(structure.center, structure.boundRadius, 1.35);
let visibleAtoms = 0;
for (let i = 0; i < structure.atoms.length; ++i) {
    const s = cam.worldToScreen(structure.atoms[i].cart.sub(structure.center), 1200, 900);
    if (!s.visible) continue;
    ++visibleAtoms;
    const picked = CL.Picking.pickAtom(structure, cam, 1200, 900, s.x, s.y, renderer.siteRadii());
    check(picked >= 0, "C3 every visible atom is pickable");
}
check(visibleAtoms === structure.atoms.length, "C3 all atoms visible");
check(CL.Picking.pickAtom(structure, cam, 1200, 900, 4.0, 4.0) === -1, "C3 empty corner -> -1");
check(CL.Picking.pickAtom(structure, cam, 1200, 900, 1196.0, 4.0) === -1, "C3 other corner -> -1");
cam.setProjection(true);
const s0 = cam.worldToScreen(structure.atoms[0].cart.sub(structure.center), 1200, 900);
check(CL.Picking.pickAtom(structure, cam, 1200, 900, s0.x, s0.y) >= 0, "C3 ortho pick");
```

> 注意：`renderer` 必须已 `setStructure`（默认 BallAndStick），使 `siteRadii` 有效；quartz 的原子全可见（无隐藏）。
> 该用例不依赖具体坐标数值，只依赖“投影→拾取往返一致”，适合作为 JS 集成冒烟测试。

---

## 5. 公式速查（复现参考值时的计算顺序）

```text
Fit(aspect, margin=1.12):
    vhalf = fovY/2; hhalf = atan(tan(vhalf)*aspect)
    d = max(sceneRadius/sin(vhalf), sceneRadius/sin(hhalf)) * max(1, margin)
    d = clamp(d, sceneRadius*0.06 + 0.05, sceneRadius*30 + 50)

FitPoints(points, aspect, margin=1.16):
    (f,r,u) = basis(yaw,pitch); tanHalf = tan(fovY/2)
    for p: q = p - target
        x=|q·r|; y=|q·u|; z=q·f
        perspective: required = max(required, y*margin/tanHalf - z, x*margin/(tanHalf*aspect) - z)
        ortho:       required = max(required, y*margin/tanHalf,     x*margin/(tanHalf*aspect))
    d = clamp(required, sceneRadius*0.05 + 0.05, sceneRadius*30 + 50)

FitScenePoints(points, aspect, margin):
    center = (min+max)/2 逐轴； radius = sqrt(max |p-center|²)
    SetScene(center, radius)  // sceneRadius = max(0.5, radius)
    FitPoints(points, aspect, margin)

Reset(center, radius, aspect):
    SetScene(center, radius); yaw=35°; pitch=24°; Fit(aspect)   // margin 1.12

Near = max(0.02, distance - 2.2*sceneRadius)
Far  = max(Near + 2.0, distance + 5*sceneRadius + 10.0)
```

说明：`Reset`/`Fit` 用球半径；`FitPoints`/`FitScenePoints` 用“可见点集的每点最紧距离”，因此同一组数字在 A1（球 fit）与 A5/A6（点 fit）不同是正常的。

---

## 6. P2/P1 移植注意

1. **解析一致性**：C1/C2 的计数对 `structure.atoms/bonds` 敏感（对称展开、键容差、边界像）。若解析器尚未完全对齐，先把 C1/C2 标 `skip`，仅跑 P0。
2. **渲染器计数器语义**：不要用“想要显示的原子数”代替 `AtomCount()`；它=实例数（原始站点+内部副本+边界副本，受 80000 预算）。
3. **`showImages` 状态在用例间会变化**：C1 中第 3 步之后一直为 `false`；C2 分两段（先 false，后 true）。JS 测试务必按顺序写或在每个 case 前显式设置。
4. **浮点**：相机数学用 float64；若中间存储到 `Float32Array`（例如把相机矩阵喂给 GPU）再回读断言，会引入 ~1e-7 误差——断言请直接对 float64 的 `Camera` 字段做。
5. **屏幕取整**：原 HUD 绘制会 `Math.round` 文本/图元坐标；相机 `worldToScreen` **不取整**（HUD 层才取整）。
6. **角度单位**：C++ `Camera` 字段全是弧度；原测试里的 `24.0 * kDegToRad` 必须保持为“度→弧度”的乘法，不能把字段当度用。
7. **`CoordinationHull` 的顺序依赖**：
   * 去重按输入顺序保留首个点（B1 里 `(1,1,1)` 被丢弃而不是替换角点）；
   * 平面遍历顺序为 `a<b<c` 字典序，`planes` 去重键是共面点下标掩码；
   * 输出三角形顺序 = 平面遍历顺序；若 JS 测试比较整个数组顺序，必须复刻 `Set<mask>` 语义（掩码本身是唯一键，顺序不影响成员）。
8. **`FaceBoundary` 的排序**：按 `(dot(p,u), dot(p,v))` 升序，`u=normalize(face[1]-face[0])`——依赖 `face` 的原始顺序（掩码位序 → 点序）。如果 JS 用 `Set`/对象去重改变了 `face` 顺序，结果三角形数不变但**顶点排列顺序可能变化**；测试只断言数量/法线/边界计数即可。
9. **边界标记**：`sides == 24` 依赖 `boundary` 数组；务必按 §7.4 的 `boundary=[true, i+2==n, i==1]` 与 `bary` 规则实现，否则描边会缺边或多出扇形对角线。

---

## 7. 一条命令跑完的清单（建议 JS 测试用例名）

```
camera.fitFramesScene                 A1
camera.rayThroughCenter               A2
camera.orbitAndZoom                   A3
camera.orthographic                   A4
camera.tightPointFit                  A5
camera.supercellFit                   A6
camera.matricesAndNearFar             A7
polyhedron.cubeHull                   B1
polyhedron.coplanarIsEmpty            B2
polyhedron.tetraHull                  B3
polyhedron.edgeCases                  B4 (optional)
polyhedron.coordinationSelection      B5 (P2)
renderer.srtio3DisplayGeometry        C1 (P2)
renderer.coordinationRendering        C2 (P2)
picking.quartzRoundTrip               C3 (P1)
```
