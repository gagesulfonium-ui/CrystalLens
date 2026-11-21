# CrystalLens 渲染规格（C++/OpenGL 3.3 → JS/WebGL2 实现级移植指南）

> **来源基线（只读）**：`upstream tree (repo root) `（v1.1.0，C++17 + Win32 + OpenGL 3.3 Core）。
> 本文只依据该目录的 `src/`、`tests/` 与 `README.md` 提炼；**不依据** `src\`（旧 v0.7.0）。
> 目标形态：经典脚本、全局 `window.CL`、无构建步骤、WebGL2。`Camera` 等 CPU 数学用 JS `Number`（float64），GPU 实例数据用 `Float32Array`（与原 C++ 的 `float` 一致）。
>
> 配套文件：
> - `docs/spec/render-constants.json` —— 本文全部常量/颜色/周期表（机器可读，**以此文件为准查数值**）。
> - `docs/spec/camera-cases.md` —— 相机/拾取/凸包的精确期望值清单（可移植 JS 测试）。
>
> 阅读约定：*公式* 一律给可照抄的数学；*常量名* 与 JSON 键一致；标 **【差异】** 的段落是 WebGL2/Android 必须替换 GL3.3 的地方。
> 所有角度在内部一律用**弧度**（`DEG = Math.PI/180`），UI 文本才用度。屏幕坐标 **y 向下**，NDC **y 向上**。

---

## 0. 术语与源码对照

| 概念 | C++ 源码 | JS 目标 |
|---|---|---|
| 渲染总控 | `src/render/Renderer.{h,cpp}` | `CL.Renderer` |
| 相机 | `src/render/Camera.{h,cpp}` | `CL.Camera` |
| 拾取 | `src/render/Picking.{h,cpp}` | `CL.Picking` / `Renderer.pickAtom` |
| 凸包/配位壳 | `src/render/PolyhedronMesh.{h,cpp}` | `CL.Polyhedron` |
| 2D 叠层 | `src/render/Overlay.{h,cpp}` | `CL.Overlay`（Canvas2D 或 WebGL2 quad） |
| 外观状态 | `src/render/Appearance.h` | `CL.defaults.appearance` |
| 视口/HUD 规则 | `src/ui/Viewport.cpp` | `CL.Viewport` / `CL.Hud` |
| 结构数据 | `src/core/Crystal.{h,cpp}`、`PeriodicTable.{h,cpp}` | `CL.Crystal` |

**结构数据前置契约**（渲染器只读，不在本文展开解析细节）：

```
Structure {
  atoms: Atom[]                 // 对称展开后的晶胞内原子（边界/超胞副本由渲染器生成，不在其中）
  bonds: Bond[]                 // 周期键表（含同一位点的周期像）
  cell:  Cell;  center: Vec3;  boundRadius: number
  periodic: bool;  truncated: bool
}
Atom { label, element, atomicNumber:int, frac:Vec3, cart:Vec3, occupancy, siteIndex, symmetryIndex }
Bond { a:int, b:int, length:number, shift:[tx,ty,tz]:int, imageOffset:Vec3, periodic:bool }
Cell { valid:bool, a,b,c,alpha,beta,gamma, aVec,bVec,cVec:Vec3, volume:number }
```

---

## 1. 坐标系、原点与晶胞基

### 1.1 渲染空间

* 渲染器把**所有**几何平移到“结构居中空间”：`p_centered = p_cart - structure.center`。
* 相机默认 `target = (0,0,0)`（见 §11.6 的 fit 例外：fit 系列会把 target 设为可见点包围盒中心）。
* 世界坐标系：右手系，**z 轴向上**（`WorldUp = (0,0,1)`）。屏幕右 = `camera.Right()`，屏幕上 = `camera.Up()`。
* 屏幕/窗口坐标：原点左上、y 向下、单位为**设备像素**。HUD 用 `dpiScale` 缩放（Android 用 `devicePixelRatio`）。

### 1.2 结构中心与包围半径（`Structure::ComputeBounds`）

```
if cell.valid:
    center = (aVec + bVec + cVec) * 0.5          // 对角线中点，不是“原子包围盒中心”
    maxDist = max(|corner - center| for 8 corners, |atom.cart - center| for atoms)
    boundRadius = max(2.0, maxDist + 1.2) * 1.06
else:
    center = (bboxMin + bboxMax) * 0.5
    maxDist = max |atom.cart - center|
    boundRadius = max(2.5, maxDist + 0.8, 0.5*|bboxMax-bboxMin| + 0.8)
```

`boundRadius` 的用途：相机 `Reset` 的球半径、拾取的兜底容差（§12）、`GetVisiblePoints` 的 fit。注意 `boundRadius` 是“结构级”量，与 `Camera.sceneRadius`（fit 后的可见半径）不是一回事。

### 1.3 晶胞基（`Cell::SetFromParameters`，上三角约定）

```
aVec = (a, 0, 0)
bVec = (b*cosγ, b*sinγ, 0)
cVec = (c*cosβ, c*(cosα - cosβ*cosγ)/sinγ, sqrt(c² - cVec.x² - cVec.y²))
volume = |dot(aVec, cross(bVec, cVec))|
FractionalToCartesian(f) = aVec*f.x + bVec*f.y + cVec*f.z
CartesianToFractional(p): det = dot(a, cross(b, c))
  return ( dot(p,cross(b,c))/det, dot(a,cross(p,c))/det, dot(a,cross(b,p))/det )
Corners() 顺序（i = x + 2y + 4z）：
  for z in 0..1: for y in 0..1: for x in 0..1: corners[i++] = FracToCart({x,y,z})
```

最小镜像（周期键/测量用）：

```
MinimumFractionalDelta(d): 先 WrapHalf(d) 到 [-0.5,0.5)；
  正交胞直接返回；否则按上三角基逐层搜索更短格点（VisitImageRows，半径逐步收缩）返回最短分数位移
WrapHalf(v): r = fmod(v+0.5, 1); r = r<0 ? r+1 : r; return r-0.5
MinimumImageVector(from,to) = FracToCart(MinimumFractionalDelta(CartToFrac(to-from)))
```

**渲染器不调用 `MinimumImageVector`**；它使用预先算好的 `Bond.shift/imageOffset`（§5）。

### 1.4 单位与量级

* 长度单位：Å（晶体学）。原子半径 0.1–3.5 Å，键半径 0.105 Å，晶胞线半径 0.017–0.065 Å。
* 默认相机距离 20（`Camera.distance` 初值），fovY 38°。

---

## 2. 实例数据布局（GPU buffer 契约）

### 2.1 原子实例 `AtomInstance`（9 × float32 = 36 B）

| offset(floats) | 字段 | attrib location | 语义 |
|---|---|---|---|
| 0,1,2 | x,y,z | 1 | 居中空间位置（Å） |
| 3 | radius | 2 | **渲染半径**（Å，已含样式缩放；见 §3） |
| 4,5,6 | r,g,b | 3 | 元素颜色（0..1，**线性 sRGB 直接值，不做 gamma 转换**） |
| 7 | flags | 4 | 位掩码：bit0=选中，bit1=悬停，bit2=ghost（保留，当前未用） |
| 8 | index | 5 | 可拾取站点下标（原始晶胞原子 = 0..N-1；边界/镜像副本 = -1） |

静态单位四边形 `quad`（6 顶点，`TRIANGLES`）：`(-1,-1),(1,-1),(-1,1), (1,-1),(1,1),(-1,1)`，attrib location 0，divisor 0。
实例属性 location 1..5，`vertexAttribDivisor(loc, 1)`。

`flags` 在 C++ 里**只由上传时写**（始终 0）；选中/悬停是**顶点着色器**用 `index` 与 uniform 比较后置位（§10.1），避免悬停重传 VBO。

### 2.2 线段实例 `LineInstance`（14 × float32 = 56 B）

| floats | 字段 | location | 语义 |
|---|---|---|---|
| 0..2 | p0 | 1 | 起点（居中空间） |
| 3..5 | p1 | 2 | 终点 |
| 6 | radius | 3 | **世界单位**圆柱半径（不是像素） |
| 7..9 | c0 | 4 | 起点颜色 |
| 10..12 | c1 | 5 | 终点颜色 |
| 13 | flags | 6 | bit0=虚线，bit1=压暗/扁平，bit2=仅主 pass（见 §10.2） |

`location 0` **故意不用**；绘制调用是 `drawArraysInstanced(LINES, 0, 2, lineCount)`（每实例 2 个“逻辑顶点”，真正的圆柱由几何着色器展开；WebGL2 替换见 §10.2/§14）。

### 2.3 多面体顶点 `PolyVertex`（12 × float32 = 48 B，非实例化）

| floats | 字段 | location |
|---|---|---|
| 0..2 | position | 0 |
| 3..5 | normal（世界空间、已归一化、朝外） | 1 |
| 6..8 | color（中心原子元素色） | 2 |
| 9..11 | bary（重心坐标描边编码） | 3 |

索引缓冲 `Uint32Array`，每三角形 3 个索引；**不透明时用非索引 `drawArrays`，半透明时用排序后的索引 `drawElements`**（§10.4 / §7.6）。

### 2.4 其它

* 全屏背景三角形：3 顶点、无属性（用 `gl_VertexID`/空 VAO）。
* 文本与 2D 图元：动态 CPU 顶点（§13）。
* VBO 生命周期：`quad` 静态；`atoms/lines/poly` 均为 `DYNAMIC_DRAW`，但**只在几何重建时上传**（不是每帧）。

### 2.5 实例数量预算与上限

| 量 | 常量 | 值 | 行为 |
|---|---|---|---|
| 晶胞最大重复 | `kMaxCellRepeats` | 16 | 每轴 clamp(1..16) |
| 超胞内部位点上限 | `kSupercellMaxSites` | 65,536 | `atoms * copies > 65536` → 回退单胞 |
| 超胞内部周期键上限 | `kSupercellMaxBonds` | 300,000 | `bonds * copies > 300000` → 回退单胞 |
| 显示镜像总数（含边界） | `kMaxImages` | 80,000 | 超出则截断边界副本（`boundaryLimited`） |
| 解析层原子/键上限 | `kMaxDisplayAtoms/kMaxBonds` | 30,000 / 150,000 | 解析层负责，不在渲染 |
| 配位壳不同配体上限 | `kMaxCoordinationPoints` | 14 | 超过 → 无凸包 |
| 标签候选原子上限 | — | 400（超过不画标签） | HUD |
| 最多绘制标签数 | — | 90 | HUD |

`FitsSupercell(s, copies) = copies == 1 || (s.atoms.length*copies <= 65536 && s.bonds.length*copies <= 300000)`
（`copies = nx*ny*nz`，**不是**总镜像数。）

---

## 3. 原子半径、颜色与隐藏规则

### 3.1 元素数据

`Element { z, symbol, covalent, vdw, color:u32 }`，`ElementByZ(z)`（z∉[1,118] → `X: covalent 0.77, vdw 1.70, color 0x9AA4B2`）。全表 118 项见 `render-constants.json → periodicTable`。

### 3.2 过渡金属判定（决定球棍半径取共价还是范德华）

```
isTransitionMetal(z) =
   (21 <= z <= 30) || (39 <= z <= 48) || (57 <= z <= 80) || z >= 89
```

### 3.3 半径公式（`RebuildAtoms`）

```
styleScale =
   style == SpaceFill ? 0.92
                      : clamp(atomScale, 0.10, 0.85)         // 默认 atomScale = 0.30

baseRadius =
   (style == SpaceFill || !isTransitionMetal(z)) ? element.vdw : element.covalent

radius = max(0.10, baseRadius * styleScale)                  // 下限 0.10 Å
if (style == Polyhedral && 有配位壳可用) radius *= 0.72       // 仅中心原子可见，缩小
```

要点：
* **球棍(BallAndStick)**：过渡金属用**共价半径**，其余（含主族金属，如 Na、Ca、K）用**范德华半径**，再乘 `atomScale`（默认 0.30）。例：Na vdw 2.27 → 0.681 Å；Ti covalent 1.60 → 0.480 Å；O vdw 1.52 → 0.456 Å。
* **空间填充(SpaceFill)**：所有元素都用 vdw，系数固定 0.92，**忽略 atomScale 滑杆**。
* **多面体(Polyhedral)**：半径规则同球棍，再 ×0.72；只保留有凸包的中心原子。
* 半径下限 `max(0.10, ·)`；`siteRadii_[i] = radius`（仅原始晶胞站点，隐藏站点记 0）。

### 3.4 隐藏规则与 `siteRadii`

```
if (!structure) return
siteRadii = Float32Array(nSites).fill(0)
for each original site i:
    if (polyhedral 且 meshes[i] 为空) -> 该站点不产生原子实例，siteRadii[i] = 0
    else -> siteRadii[i] = radius
```
* `meshes` 是“按**晶胞站点**索引的凸包列表”；`meshes` 为空外层数组（整结构无凸包）时**不隐藏任何原子**（球棍回退）。
* 边界/超胞副本 `selectableIndex = -1`：不写 siteRadii、不可拾取、不可高亮、不进图例/标签。
* `siteRadii` 是渲染器对 HUD/拾取的**唯一**可见性/尺寸真相：图例（`>0`）、标签（`>0`）、拾取（`<=0` 跳过）都用它。

### 3.5 原子实例生成顺序（拾取语义）

1. **先**按原晶胞站点顺序 push 全部原始站点（`index = i`，`tx=ty=tz=0`）。
2. **再**按站点顺序、`(tx,ty,tz)` 字典序 push 周期性副本（`index = -1`）。`(0,0,0)` 跳过。
   → 因此 `instance.index == 原始站点下标` 只对前 `structure.atoms.length` 个实例成立。

---

## 4. 超胞与边界原子（`RebuildAtoms` 精确算法）

```
nx,ny,nz = clamp(supercellX/Y/Z, 1, 16)
periodic = cell.valid && nSites > 0
requested = nx*ny*nz
supercellLimited = periodic && requested > 1 && !FitsSupercell(structure, requested)
if (!periodic || supercellLimited) displayedCells = (1,1,1)
interiorCount = nSites * nx*ny*nz
maxImages = 80000
boundaryBudget = maxImages - min(maxImages, interiorCount)

// A. 原始晶胞站点
for i in 0..nSites-1: appendAtom(atoms[i], atoms[i].cart, selectableIndex=i, tx=ty=tz=0)

// B. 周期副本
if periodic:
  eps = 1e-7
  limits(f, n) =
      !showImages ? [0, n-1]                                   // 关闭边界原子：只画胞内
                  : [ceil(-eps - f), floor(n + eps - f)]        // f = atom.frac ∈ [0,1)
  for i, atom:
    (x0,x1)=limits(atom.frac.x,nx); (y0,y1)=...(y); (z0,z1)=...(z)
    for tx in x0..x1: for ty in y0..y1: for tz in z0..z1:
      if tx==0 && ty==0 && tz==0: continue                       // 原始站点已加
      if tx<0 || ty<0 || tz<0 || tx>=nx || ty>=ny || tz>=nz:    // 边界副本，要预算
          if boundaryBudget == 0: boundaryLimited = true; continue
          boundaryBudget -= 1
      offset = cell.FractionalToCartesian(tx,ty,tz)
      appendAtom(atom, atom.cart + offset, selectableIndex=-1, atomIndex=i, tx,ty,tz)
```

* `atom.frac` 已由解析层 `Wrap01` 到 `[0,1)`；`limits()` 的 `eps` 让晶胞角上的原子（`f≈0`）在正方向多取一层边界副本：`f=0, n=2` → `[0,2]`，而 `f>eps` → `[0,1]`。
* **内部副本**= shift 落在 `[0,n-1]^3` 的副本（不占 80000 预算）；**边界副本**=任一分量 <0 或 ≥n 的副本（占预算，可被截断）。
* `images_` 记录 `{atomIndex, tx,ty,tz, position_centered}`，**包括被隐藏的原子**（供键可见性匹配、多面体实例化）。顺序 = `atoms_` 生成顺序。
* 每帧可用点集 `GetVisiblePoints`（fit 用，§8）另算。

`supercellLimited` / `boundaryLimited` 只影响 HUD 后缀提示（§13.3），不回退原子显示。

---

## 5. 化学键：可见性判定与几何

### 5.1 数据

`Bond { a, b, shift:[int,int,int], imageOffset, length }`：表示原子 `b` 的**第 shift 个周期像**与 `a` 成键。同一原子对可有多条（不同等距邻居）。`a == b` 的周期像也可成键（单质）。

### 5.2 可见键（同时决定 `visibleBondCount` 与线几何）

```
键表参与条件：style != SpaceFill && images.length > 0 && (showBonds || polyhedral非空)
polyhedral = (polyVertices.length > 0)     // 即：已成功生成凸包

lookup = Map<"atom,tx,ty,tz" -> imageIndex>      // 键 "a,tx,ty,tz"（字符串或 (atom<<48)|... 打包）
copies[atom] = 该站点的所有 image 下标（含边界）
for bond in structure.bonds:
  for index in copies[bond.a]:
    src = images[index]
    end = lookup.get(bond.b, src.tx+bond.shift[0], src.ty+bond.shift[1], src.tz+bond.shift[2])
    if end == null: continue                     // 目标像不在显示集合内 → 不可见
    visibleBondCount++
    if polyhedral: continue                      // 多面体模式不画键（但计入可见键数）
    radius = bondRadius                          // 默认 0.105
    if (Z(a)==1 || Z(b)==1) radius *= 0.82       // 含氢键更细
    appendLine(src.position, images[end].position, radius,
               bondColor, bondColor, flags=0)    // bondColor = (0.66,0.70,0.76)
```

* 端点位置都用**居中空间**的 `image.position`（不是 `cart - center` 重新算）。
* 键是**双色渐变**通道（c0/c1 可不同），当前两端同色。
* 关闭边界原子（`showImages=false`）时，跨胞键因缺目标像而不可见 → 可见键数下降（测试量化，见 camera-cases.md）。
* `polyhedral` 判定基于“凸包顶点非空”，所以**无凸包**时即使 style=Polyhedral 也会画键（球棍回退）。

---

## 6. 晶胞线（单位胞 + 每个子晶胞边线）

### 6.1 线半径

```
cellBaseRadius = clamp(0.005 * min(cell.a, cell.b, cell.c), 0.017, 0.065)     // Å
cellRadius     = cellBaseRadius * clamp(cellLineWidth, 0.5, 4.0)              // 默认 cellLineWidth=1
cellColor      = options.cellColor（默认 0xD6DEE9 → (0.839,0.871,0.914)）
```

> `cellBaseRadius` 用 `min(a,b,c)`；立方胞 5.64 Å → 0.0282 Å。
> **【坑】** 放大/缩小时线粗细按世界单位变化（不是屏幕像素）——这也是原程序的行为。

### 6.2 边线生成（三个方向的嵌套循环，逐子晶胞细分）

```
edgePoint(ix,iy,iz) = FractionalToCartesian(ix,iy,iz) - center
edge(p0, p1, outer) = appendLine(p0, p1, cellRadius * (outer ? 1.0 : 0.52),
                                  cellColor, cellColor, flags = outer ? 2 : 6)
   // flags=2  → 外框边：主 pass 全亮 + overlay pass 以 18% 再画一遍（穿透显示）
   // flags=6  → 内部分隔线：只主 pass、且被压暗（bit1+bit2）

// X 方向线：沿 a 轴，网格 (iy,iz) ∈ [0..ny]×[0..nz]
for iy in 0..ny: for iz in 0..nz:
    outer = (iy==0 || iy==ny) && (iz==0 || iz==nz)
    edge(edgePoint(0,iy,iz), edgePoint(nx,iy,iz), outer)

// Y 方向线
for ix in 0..nx: for iz in 0..nz:
    outer = (ix==0 || ix==nx) && (iz==0 || iz==nz)
    edge(edgePoint(ix,0,iz), edgePoint(ix,ny,iz), outer)

// Z 方向线
for ix in 0..nx: for iy in 0..ny:
    outer = (ix==0 || ix==nx) && (iy==0 || iy==ny)
    edge(edgePoint(ix,iy,0), edgePoint(ix,iy,nz), outer)
```

* 线数 = `(ny+1)(nz+1) + (nx+1)(nz+1) + (nx+1)(ny+1)`；单胞 = 12，2×2×2 = 27。
* 外框边 = 每个方向的 4 条外缘 = 共 12 条；其余是内部分隔线（超胞“每个子晶胞”的观感来源）。
* **两次绘制**（§9）：主 pass 全部画（`overlayAlpha=1`，不透明）；overlay pass 只画前 `cellLineCount` 个实例（即晶胞线，不含键/测量线），alpha=0.18、`depthFunc=GREATER`（只画被遮挡部分），且 bit2 的内线在此 pass 被 discard。
* 顺序：晶胞线在 `lines_` 数组最前，**先于键与测量线**；`cellLineCount` 记录其数量。

### 6.3 外观即时修改（不重建几何）

`SetAppearance(cellColor, cellLineWidth)`：只改**前 `cellLineCount` 条**线实例的颜色和半径（重传 line VBO）：
`radius = cellBaseRadius * clamp(cellLineWidth,0.5,4.0)`，边界/内部（flags bit2）判定用 `flags & 4` → `radius*0.52`。
若几何尚未重建（`cellBaseRadius` 未知）则等下次 `RebuildLines` 生效。

---

## 7. 多面体（v1.1 核心）

### 7.1 哪些站点是中心（`CoordinationMeshes`）

```
输入：structure（需要 cell.valid 且 bonds 非空，否则返回空外层数组）
1) 构造配位壳 shells[site]：
   for bond in bonds:
       delta = atoms[bond.b].cart + bond.imageOffset - atoms[bond.a].cart
       shells[bond.a].push(delta)
       shells[bond.b].push(-delta)
   // 注意：直接用周期键表（含最小镜像/同一位点像），与“边界原子是否显示”无关
2) 两轮筛选（ionicCenters = false 然后 true）：
   ligand(Z) = Z ∈ {7(N),8(O),9(F),16(S),17(Cl),34(Se),35(Br),53(I)}
   for site:
       Z = atoms[site].atomicNumber
       若 Z==0 || ligand(Z) || IsAlkaliOrAlkaline(Z) != ionicCenters || shells[site].length < 4 → 跳过
       meshes[site] = CoordinationHull(shells[site])
       记录是否找到任何非空 hull
   若本轮找到非空 hull → 立刻返回 meshes（空 hull 的站点保持空数组）
3) 两轮都没有 → 返回空外层数组（渲染器回退球棍，HUD 提示“无三维配位 · 球棍”）
```

`IsAlkaliOrAlkaline(z) = z ∈ {3,4,11,12,19,20,37,38,55,56,87,88}`。

效果：
* 第 1 轮处理“非碱/碱土、非配体”中心：Ti(钙钛矿)、Si(石英)、B、C、过渡金属等。
* 第 2 轮处理碱/碱土中心：Na/Cl 盐里 Na 为中心（**配体卤素被排除**，不会把 Cl 当中心）、萤石的 Ca。
* 中心数 < 4 个配体、或凸包退化 → 该站点无外壳；若全结构都失败 → 显示球棍 + 提示。
* 配位壳**完整周期**：即使边界原子被隐藏，中心原子的壳仍包含相邻晶胞的配体（`imageOffset` 已含平移）。因此边界中心的多面体也是完整凸包（由 `images_` 中的边界副本实例化，§7.5）。

### 7.2 凸包算法（`CoordinationHull`，精确步骤）

所有容差 `eps = 1e-6`（长度/距离平方阈值分别为 `eps`、`eps*eps`）。

```
输入 ligands: Vec3[]（相对中心的配体向量）
points = []
for p in ligands:
    if 不存在 q∈points 使 LengthSq(p-q) < 1e-12 (即 eps²): points.push(p)
    if points.length > 14: return []                       // 不同配位点 > 14 → 放弃

mesh = []; planes = Set<number>()
for a in 0..n-1: for b in a+1..n-1: for c in b+1..n-1:
    normal = cross(points[b]-points[a], points[c]-points[a])
    len = |normal|; if len < eps: continue
    normal /= len
    above=false; below=false; mask=0
    for i in 0..n-1:
        d = dot(normal, points[i]-points[a])
        if d >  eps: above = true
        else if d < -eps: below = true
        else: mask |= 1<<i                                  // 共面点（含 a,b,c）
    if (above == below) continue                            // 非支撑面（或共线/全共面）
    if !planes.insert(mask).second: continue                // 同一共面点集只处理一次（共面合并）
    if above: normal = -normal                              // 统一朝外（其余点都在下方）
    face = [points[i] for i in mask]
    polygon = FaceBoundary(face, normal)                    // §7.3
    for i in 1..polygon.length-1:                            // 扇形三角化
        mesh.push({ corners:[polygon[0],polygon[i],polygon[i+1]], normal,
                    boundary:[ true, i+2==polygon.length, i==1 ] })
return mesh
```

**性质**：
* 三角形数 = `2V-4`（V=顶点数）：四面体 4、八面体 8、立方体 12。
* 法线**世界空间、单位长度、朝外**（测试断言 `dot(normal, corner) > 0.99` 仅对中心在原点的立方体成立，是测试用例特性）。
* 共面点（如立方体 6 个面 × 4 点）只产生一个平面；`planes` 以“共面点下标集合”为键去重。
* 内部点、棱上共线点被 `FaceBoundary` 的凸包消除，不产生额外轮廓/重叠三角形。
* 退化情形：4 点全部共面 → 无支撑面 → 空数组。3 个以下/共线 → 空。

### 7.3 单面边界（2D 单调链，`FaceBoundary`）

```
u = normalize(face[1]-face[0])          // 要求 face.length >= 3
v = cross(normal, u)
按 (dot(p,u), dot(p,v)) 字典序升序排序 face
hull = []
append(p, base):
    while hull.length >= base+2:
        a = hull[len-2]
        if dot(normal, cross(hull.last - a, p - a)) > eps: break   // 保留凸点
        hull.pop()
    hull.push(p)
for p in face (升序): append(p, 0)
split = hull.length - 1
for p in reverse(face) 从倒数第二项起: append(p, split)
hull.pop()             // 去掉重复的首点
return hull            // 逆时针/顺时针（由 normal 决定，扇形三角化始终朝外）
```

### 7.4 三角形描边编码（bary）

`PolyTriangle.boundary[j]`（j=0,1,2，表示**第 j 个顶点对面那条边**是凸包真实棱）：
在扇形三角化 `(A,B,C) = (polygon[0], polygon[i], polygon[i+1])` 中：
* `boundary[0] = true` —— 边 B–C 是相邻 polygon 顶点的连线，必为真实棱；
* `boundary[1] = (i+2 == polygon.length)` —— 边 C–A 是 polygon 的闭合边，最后一颗扇形三角形才是真实棱；
* `boundary[2] = (i == 1)` —— 边 A–B 只在第一颗扇形三角形时是 polygon 的首条边。

写入 GPU 顶点的 bary（i = 三角形内顶点号，j = 分量）：
```
bary[j] = (i == j || !boundary[j]) ? 1.0 : 0.0
```
即“非真实棱”的分量在所有顶点恒为 1 → 其 0 等值线落在三角形外（扇形对角线不描边）；真实棱对面的分量在两个端点取 0 → 0 等值线正好是那条棱。

### 7.5 实例化到所有显示副本（`BuildPolyhedra`）

```
polyVertices = []
for image in images_:                                    // 含边界/超胞副本，含隐藏原子
    color = ElementByZ(atoms[image.atom].atomicNumber).color
    for tri in meshes[image.atom]:
        for i in 0..2:
            p = image.position + tri.corners[i]          // 居中空间
            push({p, tri.normal, color, bary(tri,i)})    // 三角形顺序固定 → 排序索引 3*ti
```

* 凸包拓扑按**站点**缓存，实例只做平移 + 颜色（同一位点的所有副本共享三角形拓扑与法线）。
* 顶点数 = 3 × Σ_images triangles(center)；`PolyhedronTriangleCount = polyVertexCount/3`。
* 多面体中心原子仍以原子实例渲染（半径 ×0.72）；配体与无关原子被隐藏（§3.4）。

### 7.6 三角形排序（半透明画法）

```
triangleCenters[t] = 三角形 3 顶点世界（居中）坐标均值        // 上传时算一次
SortPolyhedra(forward):
    if LengthSq(forward - sortedDirection) < 1e-14: return    // 方向几乎没变，复用上次索引
    sortedDirection = forward
    order = [( -dot(forward, center[t]), 3*t ) for t]         // 键升序 → dot 大的（远的）在前
    sort(order)                                               // 按 pair 字典序（键相等时 3t 升序）
    indices = concat([3t,3t+1,3t+2] for each item in order)
    upload indices to ELEMENT_ARRAY_BUFFER (DYNAMIC_DRAW)
```

`forward = camera.Forward()` 指向屏幕内（从相机指向场景）。`-dot(forward, center)` 升序 = **从远到近**（画家算法）。每帧只在相机旋转时重算索引，平移/缩放不重算。

### 7.7 多面体渲染参数（`Draw`）

| 参数 | 公式/默认 |
|---|---|
| 面透明度 | `polyTransparency`（%，默认 66）；`uAlpha = 1 - transparency/100`（默认 0.34） |
| 0% | 不透明：`uAlpha=1`，**开深度写**，`drawArrays` 不排序 |
| 100% | `uAlpha=0`：只画描边（内部片段 alpha=0 → discard） |
| 描边宽度 | `polyEdgeWidth` 像素，默认 1.2；0 = 关闭（若同时 transparency=100，整 pass 跳过） |
| 描边颜色 | `polyEdgeColor` 默认 `0x91B4D3` = (0.5686,0.7059,0.8275) |
| 混合 | `SRC_ALPHA, ONE_MINUS_SRC_ALPHA`；透明时 `depthMask=false` |
| 双面 | 关闭背面剔除；片元 `if (!gl_FrontFacing) normal = -normal` |
| 深度测试 | 保持 `LEQUAL`（与已画的原子/键比较）；透明面之间靠排序而非深度写 |
| 顶点色 | 中心原子的元素色 RGB（不含 alpha） |

**玻璃质感** = 半透明面 + 屏幕空间细描边 + 朝向相关的双面朗伯光照（无高光，见 §10.4）。

### 7.8 ghost / 失败提示

* **失败提示**：`style==Polyhedral && PolyhedronTriangleCount==0` 时 HUD 追加 `"  ·  无三维配位 · 球棍"`（英文 `No 3D shell · ball and stick`），并且实际以球棍显示（键/原子不隐藏）。
* **ghost 通道**：C++ 保留了一套 ghost 协议——原子着色器 `flags bit2`（颜色 mix 到 `(0.085,0.115,0.155)` 22%，`alpha *= 0.36`）、`ghosts_` VBO、独立 blend pass、`depthMask=false`、关闭 alpha-to-coverage。**v1.1.0 中 `ghosts_` 从未被填充，`ghostCount_` 恒为 0，属于预留死代码**。→ WebGL2 实现可保留 `flags bit2` 分支与一个 ghost 实例数组钩子，但默认不产生数据。边界中心多面体**不需要** ghost：它们靠周期配位壳 + 边界原子副本即可完整渲染（README 明确“边界中心的多面体也包含相邻周期晶胞提供的配体”）。

---

## 8. 可见点集与自动取景（`GetVisiblePoints`）

```
points = []
if cell.valid:
    for i in 0..7:                                    // 显示超胞（displayedCells）的 8 个角
        frac = ((i&1)?nx:0, (i&2)?ny:0, (i&4)?nz:0)
        points.push(FracToCart(frac) - center)
for atom in atoms_:                                   // 每个原子实例的 AABB 8 角
    for i in 0..7:
        points.push(atom.pos + (±radius, ±radius, ±radius))
for p in polyVertices: points.push(p.position)
```

用途：`Viewport::FitToStructure` → `Camera.FitScenePoints(points, aspect, 1.18)`（§11.4）。
若渲染器未就绪/点集为空：退化为“晶胞 8 角 + 原子 cart-center”。

注意原子包围盒是**轴对齐立方体**（半径三轴相同），略大于真实球，用于取景足够。

---

## 9. 帧管线（pass 顺序与 GL 状态）

```
viewport(0,0,w,h)
depthMask=true; clearColor(0.007,0.008,0.011,1); clear(COLOR|DEPTH)   // 清屏色固定，与 backgroundColor 无关
disable(BLEND); disable(CULL_FACE); enable(DEPTH_TEST); depthFunc(LEQUAL)
if (samples > 0) enable(SAMPLE_ALPHA_TO_COVERAGE)

Pass 1  背景：
  disable(DEPTH_TEST); depthMask=false
  backgroundProgram: uResolution=(w,h); uBackgroundColor=backgroundColor(0..1)
  drawArrays(TRIANGLES, 0, 3)

Pass 2  场景基础态：
  enable(DEPTH_TEST); depthMask=true
  view = camera.ViewMatrix(); proj = camera.ProjectionMatrix(w,h)

Pass 3  线段（晶胞线 + 键 + 测量线，一次实例化 draw）：
  lineProgram: uView,uProj, uOverlayAlpha=1.0
  drawArraysInstanced(LINES, 0, 2, lineCount)          // 每实例 2 个逻辑顶点

Pass 4  原子（不透明 impostor）：
  atomProgram: uView,uProj, uHovered, uSelected0..2
  drawArraysInstanced(TRIANGLES, 0, 6, atomCount)

Pass 5  ghost 原子（默认空）：
  atomProgram, uHovered=-1, uSelected*=-1
  enable(BLEND); blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA); depthMask=false
  disable(SAMPLE_ALPHA_TO_COVERAGE)
  drawArraysInstanced(TRIANGLES, 0, 6, ghostCount)
  depthMask=true; disable(BLEND)

Pass 6  多面体（§7.7）：
  if polyVertices>0 && (transparency<100 || edgeWidth>0):
    polyProgram: uView,uProj,uAlpha=1-transp/100,uEdgeWidth,uEdgeColor
    enable(BLEND); blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)
    depthMask = (transparency==0); disable(CULL_FACE)
    disable(SAMPLE_ALPHA_TO_COVERAGE)
    if transparency==0: drawArrays(TRIANGLES, 0, polyVertexCount)
    else: SortPolyhedra(camera.Forward()); drawElements(TRIANGLES, polyVertexCount, UNSIGNED_INT, 0)
    depthMask=true; disable(BLEND)

Pass 7  晶胞线“穿透”叠画（只画 cellLineCount 个实例）：
  lineProgram: uOverlayAlpha=0.18
  enable(BLEND); blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)
  depthMask=false; depthFunc(GREATER); enable(CULL_FACE)
  disable(SAMPLE_ALPHA_TO_COVERAGE)
  drawArraysInstanced(LINES, 0, 2, cellLineCount)
  uOverlayAlpha=1.0; disable(CULL_FACE); depthFunc(LEQUAL); depthMask=true; disable(BLEND)

收尾：disable(SAMPLE_ALPHA_TO_COVERAGE); 解绑 VAO/buffer/program
之后：Overlay.Begin() → HUD 2D → Overlay.End()（深度测试关闭、混合开启、深度写关闭）
```

原语状态说明：
* 主 pass **关闭混合**：原子用 alpha-to-coverage/MSAA 做边缘，线/多面体不透明阶段不需要混合。
* 线段 pass 的 `radius` 是**世界单位**，所以线宽随缩放变化（不是 GL lineWidth）。
* `depthFunc=GREATER` + `uOverlayAlpha=0.18` 是“被遮挡晶胞线以 18% 透出”的实现：先以 1.0 画可见部分，再画深度更远（被挡住）的部分。

---

## 10. 着色器逐项规格

### 10.1 原子 impostor 程序（`atomProgram`）

**输入**：quad 顶点 `aCorner`（loc0, vec2，±1）＋实例属性（loc1 center vec3, loc2 radius, loc3 color vec3, loc4 flags, loc5 index）。
**uniform**：`uView, uProj : mat4`，`uHovered : int`，`uSelected0..2 : int`。

**顶点着色器（等价数学）**：
```
centerView = (uView * vec4(center,1)).xyz
pos        = centerView + vec3(corner.x * radius, corner.y * radius, 0)
gl_Position = uProj * vec4(pos,1)
vCenterView = centerView; vLocal = corner; vColor = color; vRadius = radius

flags = int(round(aFlags)); index = int(aIndex)
if (index >= 0):
    if (index == uHovered) flags |= 2
    if (index == uSelected0 || index == uSelected1 || index == uSelected2) flags |= 1
vFlags = flags
```
billboard 在**视空间**展开（永远正对相机）；quad 半径 = 球半径 → 屏幕上球体直径正确（透视由投影完成；片元再算真实球面深度）。

**片元着色器**：
```
r2 = dot(vLocal, vLocal)
if (r2 > 1.0) discard
z = sqrt(max(0.0, 1.0 - r2))                     // 视空间朝相机分量 ∈[0,1]
n = normalize(vec3(vLocal, z))                   // 球面法线（视空间）
viewPos = vCenterView + vec3(vLocal, z) * vRadius
clip = uProj * vec4(viewPos, 1)
if (clip.w <= 0.0) discard
gl_FragDepth = clamp((clip.z / clip.w) * 0.5 + 0.5, 0.0, 1.0)   // 精确球面深度

key  = normalize(vec3(-0.42, 0.50, 0.76))        // 视空间常量！光随相机走
fill = normalize(vec3( 0.55,-0.18, 0.58))
diffuse  = max(dot(n,key), 0)
fillLight= max(dot(n,fill), 0)
keyHalf  = normalize(key  + vec3(0,0,1))         // 视方向 = +z
fillHalf = normalize(fill + vec3(0,0,1))
specular = pow(max(dot(n,keyHalf), 0), 64.0)
softSpec = pow(max(dot(n,fillHalf),0), 16.0)

base  = vColor
color = base * (0.24 + 0.80*diffuse) + base * 0.16*fillLight
color += vec3(1.0,0.96,0.88) * specular * 0.30
color += base * softSpec * 0.07
rim = pow(1.0 - z, 3.0)
color += base * rim * 0.12 + vec3(0.10,0.18,0.26) * rim * 0.07

if (flags & 1):                                   // 选中：金色环
    ring  = smoothstep(0.38, 0.92, 1.0 - z)
    color = mix(color, vec3(1.0,0.80,0.30), ring * 0.90)
    color += vec3(0.22,0.15,0.03) * rim
else if (flags & 2):                              // 悬停：青色内缘光
    color = mix(color, vec3(0.62,0.86,1.0), rim * 0.55)
    color *= 1.08

alpha = smoothstep(0.0, 0.075, 1.0 - r2)          // 边缘 1 像素级淡出
if (flags & 4):                                   // ghost（预留，默认不出现）
    color = mix(color, vec3(0.085,0.115,0.155), 0.22)
    alpha *= 0.36
FragColor = vec4(color, alpha)
```

**抗锯齿/深度**：`alpha` 在轮廓处 <1，主 pass 关闭混合 → 依赖 **MSAA + alpha-to-coverage** 把 alpha 转成覆盖率（4× → 轮廓平滑）；`gl_FragDepth` 手写让球体交点深度正确（所以相邻球/键的遮挡关系正确，球不会“方块化”）。**【差异】** WebGL2 需要 MSAA 的默认帧缓冲或 MSAA FBO（§14）。

**选中判定限制**：只有 `index>=0` 的实例（原始晶胞原子）能被高亮；最多 3 个同时选中（3 个 uniform 槽）。

### 10.2 线段程序（原实现：VS + 几何着色器 + FS）

原实现：顶点着色器把实例属性透传并把 `gl_Position=vec4(0)`；几何着色器 `layout(lines) in; layout(triangle_strip, max_vertices=14) out` 把每条线段展开成**六棱柱管**。

**顶点着色器（透传）**：输出 `gP0,gP1,gRadius,gC0,gC1,gFlags`。

**几何着色器（等价数学，逐线段实例）**：
```
segment = p1 - p0; L = |segment|
if (L < 1e-7 || radius <= 0) return                  // 不发射
axis = segment / L
reference = |axis.z| < 0.85 ? (0,0,1) : (1,0,0)      // 避免平行
side = normalize(cross(axis, reference))
up   = normalize(cross(side, axis))                  // 与 side/axis 正交
normalMatrix = mat3(uView)                           // 视矩阵是正交旋转
viewP0 = uView * vec4(p0,1); viewP1 = uView * vec4(p1,1)
for i in 0..6:                                        // 7 圈（最后一圈=第一圈，闭合接缝）
    angle = 2π * i / 6
    normal = side*cos(angle) + up*sin(angle)          // 径向法线（世界空间）
    for end in 0..1:
        vNormal = normalMatrix * normal               // 视空间法线
        vC0 = c0; vC1 = c1; vFlags = flags; vT = end  // t=0 起点，t=1 终点
        endpoint = (end==0 ? viewP0 : viewP1)
        gl_Position = uProj * (endpoint + vec4(vNormal * radius, 0))   // 视空间侧移
        EmitVertex()
```
* 14 个顶点组成一条 `TRIANGLE_STRIP`：6 个侧面四边形 + 接缝重复环；**没有端盖**（开口，端面通常藏在原子球内）。
* 法线按径向给平滑法线（6 边在正常视距看起来是圆管）。
* 每顶点颜色 = 端点线性插值（`vT` 0/1）。

**片元着色器**：
```
if (uOverlayAlpha < 1.0 && (flags & 4)) discard            // 内部分隔线不参与穿透叠画
if (flags & 1):                                            // 虚线：15 个周期，占空比 58%
    if (fract(vT * 15.0) > 0.58) discard
normal = normalize(vNormal)                                // 注意：不做 gl_FrontFacing 翻转
key  = normalize(vec3(-0.42,0.50,0.76)); fill = normalize(vec3(0.55,-0.18,0.58))
base = mix(c0, c1, clamp(vT,0,1))
diffuse = max(dot(normal,key),0); fillLight = max(dot(normal,fill),0)
color = base*(0.28 + 0.80*diffuse) + base*0.16*fillLight
halfDir = normalize(key + vec3(0,0,1))
specular = pow(max(dot(normal,halfDir),0), 48.0)
color += vec3(1.0,0.97,0.92) * specular * 0.22
rim = pow(1.0 - max(normal.z,0), 3.0)
color += base * rim * 0.09
if (flags & 2):                                            // 压暗（晶胞内部线）
    color = mix(base, color, 0.30)
    if (flags & 4) color *= 0.57
FragColor = vec4(color, uOverlayAlpha)                     // 主 pass alpha=1；穿透 pass=0.18
```

flags 语义表：

| bit | 值 | 含义 | 产生者 |
|---|---|---|---|
| 0 | 1 | 虚线（15 周期，58% 实线） | 测量线/待选测量线 |
| 1 | 2 | 压暗、偏平（`mix(base,shaded,0.30)`） | 晶胞线全部 |
| 2 | 4 | 只在主 pass 出现（穿透 pass 丢弃）+ 再乘 0.57 | 晶胞内部分隔线（flags=6） |
| — | 0 | 普通键 | 化学键 |
| — | 2 | 外框晶胞线 | 晶胞外框 |
| — | 1 | 测量线 | 测量 |

### 10.3 背景程序（`backgroundProgram`）

**顶点**（无属性，3 顶点全屏三角形）：
```
p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0)
gl_Position = vec4(p, 0.0, 1.0)
vUV = p * 0.5 + 0.5
```
**片元**：
```
uv = gl_FragCoord.xy / uResolution            // uResolution = 绘制缓冲尺寸（设备像素）
aspect = uResolution.x / max(1.0, uResolution.y)
base = uBackgroundColor                        // 0..1 的 backgroundColor
color = base * (0.55 + 0.55 * pow(clamp(uv.y,0,1), 0.82))      // 上亮下暗的竖直渐变
glow = (uv - vec2(0.60,0.50)) * vec2(aspect,1.0)
color += base * 0.45 * exp(-dot(glow,glow) * 3.5)              // 偏右中辉光（uv 0.60,0.50）
vignette = length((uv - 0.5) * vec2(aspect,1.0))
color *= 1.0 - 0.22 * smoothstep(0.35, 1.05, vignette)         // 四角压暗
FragColor = vec4(color, 1.0)
```
* 深度测试关闭、深度写关闭、不混合；背景盖满全屏。
* `backgroundColor` 默认 `0x020305` = (0.00784,0.01176,0.01961)；实际画面值约为 base×0.55..1.1，非常暗。
* 清屏色常量 `(0.007,0.008,0.011,1.0)` 与背景色不同（清屏色只在着色器失败时可见）。

### 10.4 多面体程序（`polyProgram`）

**顶点**：
```
viewPos = (uView * vec4(aPosition,1)).xyz
gl_Position = uProj * vec4(viewPos,1)
vNormal = mat3(uView) * aNormal       // 视空间法线
vColor = aColor
vBary = aBary                          // noperspective（必须）
```
**片元**：
```
normal = normalize(vNormal)
if (!gl_FrontFacing) normal = -normal                        // 双面渲染
key  = normalize(vec3(-0.42,0.50,0.76)); fill = normalize(vec3(0.55,-0.18,0.58))
diffuse = max(dot(normal,key),0); fillLight = max(dot(normal,fill),0)
color = vColor * (0.34 + 0.66*diffuse) + vColor * 0.18 * fillLight

// 屏幕空间描边：noperspective bary → 每像素重心梯度 → 到最近边的像素距离
gradient = sqrt(dFdx(vBary)*dFdx(vBary) + dFdy(vBary)*dFdy(vBary))
dist     = vBary / max(gradient, vec3(1e-7))
pixels   = min(dist.x, min(dist.y, dist.z))                  // ≈ 到三角形某条边的像素距离
edge     = (uEdgeWidth > 0.0) ? clamp(0.5*uEdgeWidth + 0.5 - pixels, 0.0, 1.0) : 0.0
alpha    = edge + (1.0 - edge) * uAlpha
if (alpha <= 0.0) discard
FragColor = vec4(mix(color*uAlpha, uEdgeColor, edge) / alpha, alpha)
```
* `uEdgeWidth` 单位 = **设备像素**（原始逻辑即 1.2 px，未乘 dpiScale；WebGL2 在 DPR>1 时应乘 dpr 保持视觉宽度，见 §14）。
* 描边是解析式 antialias，不依赖 MSAA。
* 面 alpha 与描边 alpha 用同一 `alpha` 输出做混合（见 §7.7）；混合公式 `SRC_ALPHA, ONE_MINUS_SRC_ALPHA`。
* `dFdx/dFdy` 在 WebGL2/GLSL ES 3.00 可用（无需扩展）。

### 10.5 2D Overlay 着色器（原实现）

**图元**（屏幕像素 → NDC）：
```
ndc = vec2(pos.x / uScreen.x * 2 - 1, 1 - pos.y / uScreen.y * 2)
FragColor = vColor        // 顶点色，逐图元混合
```
**文本**：
```
VS: p = uOrigin + aUV * uSize;  ndc 同上;  vUV = aUV
FS: a = texture(uTex, vUV).r;  FragColor = vec4(uColor.rgb, uColor.a * a)
```
文本纹理是 `R8` 单通道字形 alpha（GDI 光栅化 → 取 RGB 最大值为 alpha），`LINEAR` 过滤；每个文本串独立纹理并缓存（缓存 >600 条清空）。
**【差异】** Android/WebView 没有 GDI：用 Canvas2D overlay（推荐）或预烘焙字形图集（§14）。

---

## 11. 相机

### 11.1 状态与默认值

| 字段 | 默认 | 说明 |
|---|---|---|
| `target` | (0,0,0) | 注视点；fit 系列会改写 |
| `distance` | 20.0 | 眼点距离（沿球坐标） |
| `yaw` | 35° | 绕 z 轴（世界 up） |
| `pitch` | 24° | 仰角，clamp ±85° |
| `fovY` | 38° | 竖直视场角 |
| `orthographic` | false | 透视/正交 |
| `sceneRadius_` | 10.0（私有） | `SetScene` 写入，`max(0.5, radius)` |

`WorldUp = (0,0,1)`；`kPitchLimit = 85°`。

### 11.2 基与眼点

```
Eye() = target + (cos(pitch)*cos(yaw), cos(pitch)*sin(yaw), sin(pitch)) * distance
Basis(f,r,u):
    f = normalize(target - Eye())                       // 指向屏幕内
    worldUp = (0,0,1); if |dot(f, worldUp)| > 0.999: worldUp = (0,1,0)
    r = normalize(cross(f, worldUp))
    u = normalize(cross(r, f))
Forward()=f; Right()=r; Up()=u
```
（yaw=0,pitch=0 时 f=(-1,0,0), r=(0,1,0), u=(0,0,1)：屏幕右=+y、屏幕上=+z。）

### 11.3 近远平面（随距离自适应）

```
NearPlane() = max(0.02, distance - sceneRadius_ * 2.2)
FarPlane()  = max(NearPlane() + 2.0, distance + sceneRadius_ * 5.0 + 10.0)
```

### 11.4 取景算法（fit）

**A. `SetScene(center, radius)`**：`target = center; sceneRadius_ = max(0.5, radius)`。

**B. `Fit(aspect, margin=1.12)`（球取景）**：
```
if (aspect <= 0.05) aspect = 1.0
vhalf = fovY * 0.5
hhalf = atan(tan(vhalf) * aspect)
vertical   = sceneRadius_ / max(1e-4, sin(vhalf))
horizontal = sceneRadius_ / max(1e-4, sin(hhalf))
distance = max(vertical, horizontal) * max(1.0, margin)
distance = clamp(distance, sceneRadius_*0.06 + 0.05, sceneRadius_*30.0 + 50.0)
```

**C. `FitPoints(worldPoints, aspect, margin=1.16)`（点集取景）**：
```
if points.empty: Fit(aspect, margin); return
if (aspect <= 0.05) aspect = 1.0
tanHalf = tan(fovY*0.5)
(f,r,u) = Basis()                                  // 当前 yaw/pitch
required = 0
for p in points:
    q = p - target
    x = |dot(q,r)|; y = |dot(q,u)|; z = dot(q,f)   // z>0 = 在相机前方
    if orthographic:
        required = max(required, y*margin/tanHalf,
                              x*margin/(tanHalf*aspect))
    else:
        required = max(required, y*margin/tanHalf - z,
                              x*margin/(tanHalf*aspect) - z)
distance = clamp(required, sceneRadius_*0.05 + 0.05, sceneRadius_*30.0 + 50.0)
```
含义：对每个点求“让它在 margin 内可见所需的最小距离”，取最大；透视时减去该点的前向深度 z（近的点要求更大距离）。`required` 可能为负（都在相机后方很近）→ 被下界 clamp。

**D. `FitScenePoints(points, aspect, margin)`（视口实际使用）**：
```
if points.empty: Fit(aspect, margin); return
lo/hi = 各轴 min/max
center = (lo+hi)*0.5
radius = sqrt(max |p-center|²)
SetScene(center, radius)
FitPoints(points, aspect, margin)
```
→ **注意 target 变成可见点 AABB 中心**（可能不是原点）；随后 `FitPoints` 用 `Basis()`（由 yaw/pitch 和新 target 决定的方向，方向与 distance 无关）。

**E. Viewport 的调用链**：
```
SetStructure:
    camera.Reset(Vec3{}, structure.boundRadius, Aspect())      // yaw=35°,pitch=24°, Fit(1.12)
    FitToStructure()                                          // 覆盖 distance/target/sceneRadius
ResetView: 同 SetStructure 的相机部分
FitView:   FitToStructure()
FitToStructure:
    points = renderer.GetVisiblePoints()   // §8
    若空则用晶胞 8 角 + 原子
    camera.FitScenePoints(points, Aspect(), 1.18)   // margin = 1.18
```
`Aspect() = width/height`（height>0，否则 1.6）。
窗口 `WM_SIZE` 时：若 `!userAdjustedCamera`（用户未手动操作相机）自动 `FitToStructure()`。
边界/样式/超胞改变时（`boundaryChanged`）也会 `FitToStructure()` 并把 `pendingFit=false`。

**F. `Reset(center, radius, aspect)`**：`SetScene`；`yaw=35°; pitch=24°; Fit(aspect)`（margin 默认 1.12）。

### 11.5 交互灵敏度

| 操作 | 公式/常量 |
|---|---|
| Orbit(dx,dy) | `yaw -= dx*0.0072; pitch += dy*0.0072; pitch=clamp(pitch,-85°,85°)`（弧度/像素） |
| Pan(dx,dy,w,h) | `wpp = 2*distance*tan(fovY*0.5)/h; target += r*(-dx*wpp); target += u*(dy*wpp)` |
| Zoom(steps) | `distance *= exp(-steps*0.16)`；`clamp(distance, max(0.05, sceneRadius*0.035), sceneRadius*40+100)` |
| 滚轮 | `steps = wheelDelta / 120`（`WHEEL_DELTA=120`） |
| 拖拽判定 | 鼠标移动累计 `|dx|+|dy| > 3*dpiScale` → 视为拖动（不触发点击选择） |
| 键盘 | ←→ Orbit(∓8,0)；↑↓ Orbit(0,∓8)；+/- Zoom(±1)；F=Fit；Home=Reset；Esc=取消测量/取消选择 |
| 惯性 | 见下 |

拖拽惯性（Viewport 实现，非 Camera）：
```
dt = clamp(now-last, 0.001, 0.05)               // 动画步
输入时：inputDt = clamp(now-lastInput, 0.004, 0.05)
        yawDelta=-dx*0.0072; pitchDelta=dy*0.0072
        orbitTargetYaw += yawDelta; orbitTargetPitch = clamp(...±85°)
        velYaw   = clamp(velYaw*0.70   + (yawDelta/inputDt)*0.30,   -4, 4)
        velPitch = clamp(velPitch*0.70 + (pitchDelta/inputDt)*0.30, -4, 4)
不拖拽时：targetYaw += velYaw*dt; targetPitch += velPitch*dt; 衰减 decay=exp(-6*dt)
        速度 <0.04 rad/s 归零
每帧缓动：alpha = 1-exp(-easing*dt)，easing = dragging ? 26.0 : 18.0
        yaw += (targetYaw-yaw)*alpha; pitch += (targetPitch-pitch)*alpha; clamp ±85°
        收敛阈值 |Δ|<0.0004 rad 且无速度 → 吸附并结束
定时器：拖拽 8ms，空闲 16ms
```

### 11.6 矩阵

**View（列主序，与 WebGL/`mat4` 一致）**：
```
View =
|  r.x   u.x  -f.x   0 |
|  r.y   u.y  -f.y   0 |
|  r.z   u.z  -f.z   0 |
| -dot(r,eye) -dot(u,eye) dot(f,eye) 1 |
```
（即数组 `[r.x, u.x, -f.x, 0, r.y, u.y, -f.y, 0, r.z, u.z, -f.z, 0, -r·eye, -u·eye, f·eye, 1]`。）

**Projection（透视）**：
```
n = NearPlane(); f = FarPlane(); fscale = 1/tan(fovY/2)
| fscale/aspect   0        0            0 |
| 0               fscale   0            0 |
| 0               0        (f+n)/(n-f)  -1|
| 0               0        2fn/(n-f)    0 |
```
（列主序数组：`m[0]=fscale/aspect, m[5]=fscale, m[10]=(f+n)/(n-f), m[11]=-1, m[14]=2fn/(n-f), 其余 0`。）

**Projection（正交）**：
```
halfH = distance * tan(fovY*0.5)
halfW = halfH * aspect
| 1/halfW  0        0            0 |
| 0        1/halfH  0            0 |
| 0        0        -2/(f-n)     0 |
| 0        0        -(f+n)/(f-n) 1 |
```
（`m[0]=1/halfW, m[5]=1/halfH, m[10]=-2/(f-n), m[14]=-(f+n)/(f-n), m[15]=1`。）

> 正交模式**仍用 `distance` 决定视锥大小**（缩放 = 改 distance），near/far 公式不变；`aspect` 从窗口尺寸取。

### 11.7 ScreenRay（屏幕 → 世界射线）

```
if (width<=0 || height<=0) return {origin: Eye(), dir: Forward()}
(f,r,u) = Basis(); aspect = width/height
ndcX = 2*x/width - 1
ndcY = 1 - 2*y/height
tanHalf = tan(fovY*0.5)
if orthographic:
    halfH = distance*tanHalf; halfW = halfH*aspect
    origin = Eye() + r*(ndcX*halfW) + u*(ndcY*halfH)
    dir = f
else:
    origin = Eye()
    dir = normalize(f + r*(ndcX*tanHalf*aspect) + u*(ndcY*tanHalf))
```

### 11.8 WorldToScreen（世界 → 屏幕 + 深度）

```
if (width<=0||height<=0) return {visible:false}
(f,r,u)=Basis(); v = point - Eye()
xc = dot(v,r); yc = dot(v,u); zc = dot(v,f)
if (zc <= 0) return {visible:false}
aspect = width/height; tanHalf = tan(fovY*0.5); n=Near; fa=Far
if orthographic:
    halfH = distance*tanHalf; halfW = halfH*aspect
    ndcX = xc/halfW; ndcY = yc/halfH
    ndcZ = 2*(zc - n)/(fa - n) - 1
else:
    ndcX = xc/(zc*tanHalf*aspect)
    ndcY = yc/(zc*tanHalf)
    ndcZ = ((-zc)*(fa+n)/(n-fa) + 2*fa*n/(n-fa)) / zc
x = (ndcX*0.5 + 0.5)*width
y = (1 - (ndcY*0.5 + 0.5))*height
depth = ndcZ
visible = (zc > Near*0.5) && (ndcZ >= -1.25) && (ndcZ <= 1.25)
```
`visible` 的宽松 ±1.25 允许“稍微在近/远平面外但仍可投影”的点用于标签/测量（避免闪烁）。

---

## 12. 拾取（`PickAtom`）

```
PickAtom(structure, camera, w, h, sx, sy, siteRadii):
    if (w<=0||h<=0||atoms.empty) return -1
    if (siteRadii.length != atoms.length) return -1
    ray = camera.ScreenRay(sx, sy, w, h)
    best = -1; bestT = +inf
    for i, atom in atoms:                          // 只遍历原始晶胞站点（不含边界副本）
        R = siteRadii[i]
        if (R <= 0) continue                       // 隐藏原子不可拾取
        pickRadius = max(R*1.04, structure.boundRadius*0.007)   // 视觉半径放宽 4%，并有最小容差
        center = atom.cart - structure.center
        oc = center - ray.origin
        tca = dot(oc, ray.direction)
        if (tca < 0) continue                      // 球心在相机后方
        d2 = dot(oc,oc) - tca*tca                  // 球心到射线垂距²
        r2 = pickRadius*pickRadius
        if (d2 > r2) continue
        thc = sqrt(max(0, r2 - d2))
        t = tca - thc                              // 近交点
        if (t > 0 && t < bestT) { bestT = t; best = i }
    return best
```

要点：
* **不做深度遮挡测试**：射线最先命中的球即返回（球可能被更近的几何挡住——原实现如此）。
* 边界/超胞镜像副本（`index=-1`）**不可拾取**；但原始站点在超胞中显示在其原位置。
* `pickRadius` 最小 = `0.007*boundRadius`，保证极小原子也易点中；×1.04 的容差。
* 正交模式同样可用（ScreenRay 平行射线）。
* 悬停 = 每次 `mousemove`（未拖拽时）调用一次 `PickAtom` → 更新 `hoveredAtom` → 设置着色器 uniform（**不重建 VBO**）；hover 为 -1 时清除。
* 点击选择：`mousedown→mouseup` 移动 <3dpi 视为点击；点到原子 → 选中；点空 → 若不在测量模式则清除选择。
* 测量模式：点击把原子压入 `pendingPicks`（重复点击同一原子忽略），达到 2（距离）/3（角度）后生成测量、清空 pending；pending 期间这些原子以“选中”金色环高亮（最多 3 个），优先于普通选中。
* 测量计算（与渲染配套，周期最小镜像）：
  * 距离：`delta = MinimumImageVector(pa,pb); value=|delta|; offsetB = delta-(pb-pa); offsetA=0`
  * 角度：`va=MinimumImageVector(pb,pa); vc=MinimumImageVector(pb,pc); degrees=acos(clamp(dot(va,vc)/(|va||vc|),-1,1))*180/π; offsetA=va-(pa-pb); offsetC=vc-(pc-pb)`
* 光标：悬停原子 → hand；测量模式 → crosshair；拖拽 → sizeall。

---

## 13. 2D Overlay / HUD（`Viewport::DrawHud`）

全部坐标为**屏幕像素、y 向下**；`S(v) = v * dpiScale`（Android：`dpr`）。Overlay 在 3D 之后绘制：关闭深度测试、关闭深度写、开启混合 `SRC_ALPHA/ONE_MINUS`。

### 13.1 调色板（HUD）

| 名称 | hex | 用途 |
|---|---|---|
| kHudText | `0xEAF0F8` | 主文本/标题 |
| kHudDim | `0x9DABBF` | 次级文本、图例符号、提示 |
| kHudFaint | `0x718097` | 弱文本（后缀、脚注） |
| kHudAccent | `0x6392FF` | 强调蓝 |
| kHudAccentLight | `0x8DB0FF` | 标题圆点 |
| kHudTeal | `0x35D3AF` | 坐标轴 b / 状态点 |
| kHudGold | `0xFFC95B` | 距离测量 |
| kHudCyan | `0x5BCCFF` | 角度测量 / 坐标轴 c |
| kHudRed | `0xFF6B7A` | 坐标轴 a |
| kHudPanel | `0x0B111B` α0.80 | 标题面板填充 |
| kHudPanelSoft | `0x0A0F18` α0.58 | 提示/坐标轴面板 |
| kHudBorder | `0x2A3549` α0.85 | 面板描边 |

### 13.2 图元规则（`Overlay`）

* `FillRect`：2 三角形。
* `FillRoundedRect`：`radius = clamp(r, 0, min(w,h)/2)`；`radius < 0.6` 直接矩形；否则 4 段圆弧拼接，`segments = clamp(4..12, int(radius*0.45)+4)`，以中心扇形三角化。
* `Panel(x,y,w,h,radius,fill,border,thickness)`：先画外圈 border 圆角矩形，再画内缩 `t=max(0.5,thickness)` 的 fill 圆角矩形（内部 radius-t）。
* `Line(x0,y0,x1,y1,thickness,color)`：按法线方向 `±max(0.5,thickness)/2` 展开成 2 三角形。
* `Circle(cx,cy,r,color,segments=36)`：扇形三角形，`segments>=8`。
* `Ring(cx,cy,r,thickness,color,segments=36)`：外/内圆环带。
* `Text(text,x,y,pixelSize,color,align,vAlign,bold)`：`pixelSize` 取整 clamp 7..96；对齐 `Left/Center/Right` + `Top/Middle/Bottom`；绘制时**四舍五入到整数像素**（`round(left)-pad`）；`dpiScale` 只参与 pad 与调用方字号。
* `MeasureText / TextHeight`：字体度量（Android 用 Canvas `measureText` / 字体高度）。

### 13.3 结构 HUD

**标题面板**（左上角，锚点 `(16,14)`）：
```
title = structure.title || 文件名 stem || AppName
suffix = "   ·   " + 格式名 + "   ·   " + atomCount + " 原子"
if (bonds>0 && PolyhedronTriangleCount==0) suffix += "   " + bonds + " 化学键"
if (compact: width < S(700)) suffix = "   ·   " + 格式名
if (style==Polyhedral && PolyhedronTriangleCount==0) suffix += "  ·  无三维配位 · 球棍"
if (renderer.SupercellLimited()) suffix += "  ·  超胞过大，显示单胞"
else if (renderer.BoundaryLimited()) suffix += "  ·  边界副本已截断"

maxWidth = min(w*0.60, S(580))
availableTitle = max(S(60), maxWidth - S(110) - measure(suffix, S(10)))
title = Ellipsize(title, S(12.5), bold, availableTitle)        // 超长加 "…"
panelWidth = min(S(36) + measure(title,S(12.5),bold) + measure(suffix,S(10)), maxWidth)
panelH = S(34); radius S(10); fill kHudPanel; border kHudBorder 1px
圆点: Circle(S(31), topY+panelH/2, S(3.2), kHudAccentLight, 24)
环:   Ring(S(31), ..., S(5.5), S(0.8), 0x6392FF α0.35, 24)
title: Text(S(43), mid, S(12.5), kHudText, Left, Middle, bold)
suffix: Text(S(43)+measure(title), mid, S(10), kHudFaint, Left, Middle)
```

**元素图例**（右上，v1.0 起无深色底板）：
```
条件：structure 有原子 且 width >= S(560)
元素集合：按结构站点顺序遍历 radii[i]>0 的原子，收集不重复 atomicNumber，最多 8 个；
          然后按元素 symbol 字符串升序排序
layout: rowH=S(20); panelW=S(50); panelX = w - S(18) - panelW; panelY = S(54)
for idx,element:
    cy = panelY + rowH*idx + rowH*0.5
    Circle(panelX + S(6), cy, S(4.2), elementColor(α0.90), 20)
    Text(symbol, panelX+panelW, cy, S(9.2), kHudDim, Right, Middle)
```
（隐藏原子不进图例 → 多面体模式图例只列中心元素。）

**测量模式横幅**（标题面板下方，`mode != None` 时）：
```
modeColor = 距离 ? kHudGold : kHudCyan
status = picked>0 ? format("已选 %d / %d", picked, required) : 提示文案
banner = (距离? "键长" : "键角") + "   ·   " + status
textSize=S(10.5); bannerY = topY + panelH + S(8)
Panel(S(16), bannerY, measure(banner)+S(34), S(30), radius S(9),
      fill 0x0D1118 α0.82, border 距离?0x6B5421:0x1F536A α0.9, 1px)
Circle(S(30), bannerY+S(15), S(3), modeColor, 20)
Text(banner, S(42), bannerY+S(15), S(10.5), modeColor, Left, Middle)
```

**底部提示面板**（左下）：
```
hint = mode==None ? "左键拖动旋转   ·   滚轮缩放   ·   中键 / 右键平移"
                  : 距离/角度测量提示（Esc 退出）
hintSize=S(10); hintMax = max(S(120), gizmoX - S(28))
hint = Ellipsize(...); hintWidth = min(hintMax, measure(hint)+S(24))
Panel(S(16), h-S(16)-S(28), hintWidth, S(28), S(9), kHudPanelSoft, 0x222C3D α0.6, S(0.8))
Text(hint, S(16)+S(12), h-S(16)-S(14), S(10), kHudDim, Left, Middle)
```

**边界原子图例**（存在周期键 `|imageOffset|²>1e-12` 时，提示面板上方）：
```
legend = showImages ? "边界原子 = 相邻晶胞中的原子" : "仅显示晶胞内原子与键"
legendSize=S(9.2); legendY = h - S(16) - S(28) - S(8) - S(24)
Panel(S(16), legendY, measure(legend)+S(34), S(24), S(8), kHudPanelSoft, 0x222C3D α0.55, S(0.8))
Circle(S(16)+S(13), legendY+S(12), S(3), showImages?0x6EA8FF:0xE0B45A (α0.75/0.8), 20)
Text(legend, S(16)+S(24), legendY+S(12), S(9.2), kHudFaint, Left, Middle)
```

**Flash 提示气泡**（底部居中）：
```
时长 2400 ms；最后 500 ms alpha 线性淡出
flashSize = S(10.5); flashW = measure(text)+S(30)
flashX = (w-flashW)/2; flashY = h - S(58) - S(28)
Panel(flashX, flashY, flashW, S(28), S(9),
      fill 0x0C1119 α(0.88*a), border 0x8A6B2E α(0.9*a), 1px)
Text(text, w/2, flashY+S(14), S(10.5), 0xFFD98A α a, Center, Middle)
```
用途：测量成功提示（“✓ 表达式  数值”）、载入成功、截图保存等（`Flash()` 由 UI 层调用）。

### 13.4 坐标轴 gizmo（右下）

```
size = width < S(700) ? S(86) : S(100)
x = w - S(16) - size; y = h - S(16) - size
Panel(x, y, size, size, S(11), kHudPanelSoft, 0x253044 α0.65, S(0.8))

axes = cell.valid ? [ (normalize(aVec), "a", kHudRed),
                      (normalize(bVec), "b", kHudTeal),
                      (normalize(cVec), "c", kHudCyan) ]
                  : [ ((1,0,0),"x",kHudRed), ((0,1,0),"y",kHudTeal), ((0,0,1),"z",kHudCyan) ]
for axis: depth = dot(axis.dir, camera.Forward())
按 depth 降序排序（先画背向的）
center = (x + size*0.5, y + size*0.53)
len = size*0.27
Ring(center, S(2.2), S(0.8), 0x94A5BE α0.5, 20)
for axis (已排序):
    dx = dot(axis.dir, camera.Right())
    dy = -dot(axis.dir, camera.Up())
    l = hypot(dx,dy)
    ex = center.x + dx*len; ey = center.y + dy*len
    alpha = depth > 0 ? 0.55 : 1.0
    Line(center, (ex,ey), S(1.7), axis.color αalpha)
    Circle((ex,ey), S(2.2), axis.color αalpha, 20)
    labelPos = (ex,ey) + (dx/l, dy/l)*S(10)      // l>0.1 时，否则 (+1,0) 方向
    Text(label, labelPos, S(9.5), axis.color α(alpha*0.9), Center, Middle, bold)
```
（坐标系 gizmo 是相机朝向的屏幕投影，`depth>0` 表示指向屏幕内 → 变暗。）

### 13.5 测量数值标签

```
最多画 24 条；每条：
world = 距离 ? (a.cart+offsetA + b.cart+offsetB)*0.5 - center
             : 角度：vertex=b.cart-center（顶点是中间原子 b）；
               ua=normalize(a.cart+offsetA-center - vertex); uc=normalize(c.cart+offsetC-center - vertex)
               bisector = normalize(ua+uc)（退化时 normalize(cross(ua, camera.Up()))，再退化用 camera.Up()）
               world = vertex + bisector * 0.7
screen = camera.WorldToScreen(world, w, h)
if (!visible) continue
if (screen.x < S(20) || > w-S(20) || screen.y < S(20) || > h-S(20)) continue
color = 距离 ? kHudGold : kHudCyan
value = 距离 ? value.toFixed(3)+" Å" : value.toFixed(2)+"°"
textSize = S(10); boxW = measure(value, bold)+S(16); boxH = S(22)
left = screen.x + S(8); top = screen.y - boxH - S(4)
最多 5 次碰撞上移：若与已放置框重叠 → top -= boxH + S(3)
Panel(left, top, boxW, boxH, S(7), fill 0x0A0F18 α0.88, border color α0.55, S(0.9))
Text(value, left+boxW/2, top+boxH/2, S(10), color, Center, Middle, bold)
```

### 13.6 原子标签

```
条件：showLabels && structure.atoms.length <= 400
候选：radii[i] > 0 的原始站点；WorldToScreen；visible；屏幕内且距边 >= S(8)
排序：按 screen.depth 升序（近的优先）
placed = []（已放置矩形）
maxDrawn = 90
for 候选:
    text = atom.label（空则元素符号）；长度 >12 → 截断为 11 字符 + "…"
    textSize = S(9)
    x = screen.x + S(5); y = screen.y - textHeight - S(3)
    box = (x-2, y-1, x+textW+2, y+textH+1)
    if 与 placed 任一矩形重叠: continue                 // 遮挡/碰撞：直接跳过
    placed.push(box)
    颜色 = clamp(0.38 + 0.62*elementRGB, 0..1) 各通道，α=0.96
    阴影：Text(text, x+S(1), y+S(1), S(9), 0x000000 α0.65, Left, Top)
    正文：Text(text, x, y, S(9), color, Left, Top)
```
**注意**：原子标签**不做深度遮挡**（不读深度缓冲，不判断被球/键挡住），只做矩形碰撞剔除；用“近处优先放置”保证近处标签不被远处挤掉。

### 13.7 悬停 tooltip / 状态覆盖层

原 v1.1 的 3D 场景悬停反馈 = ①原子着色器青色内缘光（§10.1）；②鼠标手型；③状态栏文本（`MainWindow::HoverStatusText`）：
```
格式： "%s  ·  %s  ·  点击选择"   // label · 元素符号 · click to inspect
```
Android 移植建议：在状态栏/底部 HUD 用同一格式显示；若要做浮动 tooltip，用同一文本 + `Panel` 小面板（沿用测量标签的样式，`S(10)` 字号、`kHudPanel` 底、`kHudBorder` 边），放在鼠标/触摸点上方 `S(14)` 并做屏幕边缘翻转。工具条按钮的 tooltip 与场景悬停无关，属 UI 层。

### 13.8 空状态（无结构）

```
背景：5 层同心圆（r = radius*(1.4+i*0.34)，i=5..1，颜色 0x355CFF α 0.012*(6-i)）
      六边形（半径 radius，角度 -90,-30,30,90,150,210；y 方向压扁 *0.95，中心上移 radius*0.35）
      交替色边 0x6F9BFF α0.85 / 0x35D3AF α0.70，粗细 S(1.8)；
      三根中心连线；顶点圆点 S(2.4)；中心环 Ring(radius*0.24, S(1.0), 0x91B4FF α0.35, 32)
      radius = clamp(min(w,h)*0.075, S(38), S(58))；中心 (w/2, h/2 - S(22))
标题：S(21) bold（放不下退 S(17)/省略号），kHudText，Center；副标题 S(12) kHudDim
按钮：宽 max(S(198), measure+ S(58))，高 S(44)，圆角 S(12)
      fill 0x5B8CFF α0.94（hover 0x7CA3FF α0.98）；上半透白高光 0xFFFFFF α0.06；
      底边线 0x9CB8FF α0.35；文字 S(12.5) bold 白色 α0.98
脚注：支持格式行 S(9.5) kHudFaint；底部脚注 S(9.5) 0x596981 α0.9
点击按钮 → 打开结构库
```

### 13.9 渲染失败覆盖层

渲染器/GL 初始化失败时，视口用 GDI 兜底（`DrawFallback`）：背景 `RGB(9,13,21)`；标题 `S(18) semibold` 文字 `RGB(232,238,248)`；提示 `S(11)` `RGB(155,168,188)`；错误详情 `S(9)` `Consolas` `RGB(108,121,143)`。
Android 移植：用 HTML overlay 显示同样三段文本（标题/提示/错误详情），背景 `#090D15`。

---

## 14. WebGL2 适配差异清单（必读）

| # | C++/GL3.3 原实现 | WebGL2 做法 |
|---|---|---|
| 1 | **几何着色器**展开六棱柱管 | 不可用。做法：静态“单位圆柱”网格 14 顶点 `TRIANGLE_STRIP`（7 圈 × 2 端，属性：`ringAngle`/`ringCos`/`ringSin`、`end∈{0,1}`），每实例属性 p0,p1,radius,c0,c1,flags；VS 内算 `axis/side/up`（与 §10.2 相同公式），`worldPos = mix(p0,p1,end) + (side*cos+up*sin)*radius`，`worldNormal = side*cos+up*sin`，再乘 view/proj。一次 `drawArraysInstanced(TRIANGLE_STRIP, 0, 14, lineCount)`，**与原来字节级等价的几何**。 |
| 2 | `gl_FragDepth`（球面精确深度） | GLSL ES 3.00 支持写 `gl_FragDepth`（无需扩展）。注意写深度会关闭该 draw 的 early-Z；保持原样即可。 |
| 3 | 4× MSAA（WGL 像素格式）+ `SAMPLE_ALPHA_TO_COVERAGE` | WebGL2 默认画布**不保证**多重采样。两种方案：<br>**A（推荐、视觉一致）**：自建 4× 多重采样 FBO（`RGBA8 + DEPTH24_STENCIL8`，`renderbufferStorageMultisample`），3D + HUD 全部画进 FBO，最后 `blitFramebuffer` 到默认画布；FBO 上 `SAMPLE_ALPHA_TO_COVERAGE` 可用。<br>**B（省 GPU）**：`antialias:true` 上下文 + 关闭 alpha-to-coverage，原子边缘仅靠 `alpha smoothstep` 的透明混合（需开 blend），多边形描边本就是解析 AA。**风险**：球轮廓会出现硬锯齿；提供开关。 |
| 4 | 线段是几何管，`glLineWidth` 无关 | 同原实现（实例圆柱），无需 `LINE_SMOOTH`。 |
| 5 | `noperspective` bary | GLSL ES 3.00 支持 `noperspective`（`vBary`），保持；`dFdx/dFdy` 亦为内置。 |
| 6 | 双面渲染 + `gl_FrontFacing` | 支持；`disable(CULL_FACE)` + `if(!gl_FrontFacing) normal=-normal` 照抄。 |
| 7 | 全屏三角形用 `gl_VertexID` | WebGL2 有 `gl_VertexID`；绑一个空 VAO 即可 `drawArrays(TRIANGLES,0,3)`。 |
| 8 | 实例化属性 divisor | `vertexAttribDivisor` 原生支持。 |
| 9 | VAO | 原生支持。 |
| 10 | Uint32 索引 | WebGL2 支持 `UNSIGNED_INT` 索引（无需 OES_element_index_uint）。 |
| 11 | 高 DPI：`dpiScale` 只作用于 HUD | Android：画布尺寸 = CSS 尺寸 × `devicePixelRatio`；HUD 布局 `S(v)=v*dpr`；**屏幕像素量**（HUD 尺寸、多面体描边宽度）乘 dpr；**世界单位量**（原子/键/晶胞线半径）不乘；`uResolution` 用设备像素。 |
| 12 | OpenGL 默认左上/左下差异 | 原实现自己算 NDC（`1 - y/h*2`），无翻转问题；WebGL 同样处理，不必 `UNPACK_FLIP_Y`。 |
| 13 | 文本（GDI 字形纹理） | 无 GDI。用 ①Canvas2D 叠层（最简单：WebGL 画布 + 透明 `<canvas>` 2D 叠层，HUD 全部用 `fillText/roundRect`）；或 ②预烘焙字形图集（SDF/alpha 图集）+ WebGL 四边形。两种都按 §13 的屏幕像素布局。 |
| 14 | `GL_MULTISAMPLE` | WebGL2 无此开关；MSAA 由 FBO/上下文属性控制。 |
| 15 | `clearColor` 固定 `(0.007,0.008,0.011,1)` | 照抄（`clearColor(0.007,0.008,0.011,1)`）。 |
| 16 | 深度精度 | 保持 `DEPTH_COMPONENT24`；near/far 自适应公式照抄（避免 z-fighting）。若用 MSAA FBO，`DEPTH24_STENCIL8` + 4 samples。 |
| 17 | 驱动差异/上下文丢失 | 加 `webglcontextlost/restored`：销毁并重建全部 GL 资源（几何可从头重建）。 |
| 18 | `alpha:false` 画布 | 建议 `{alpha:false, depth:true, stencil:false, antialias:...}`；背景 shader 覆盖全屏，清屏色仅兜底。 |
| 19 | 着色器精度声明 | ES 3.00 片元必须显式 `precision highp float;`（原子深度用 highp）；顶点默认 highp。 |
| 20 | 每帧 CPU 工作量 | 保持“几何只在结构/选项变化时重建；每帧只排序多面体（方向变化时）”；HUD 文本若用 Canvas2D，直接绘制即可（缓存 measureText 结果）。 |

**建议的 JS 模块骨架（经典脚本，挂 `window.CL`）**：
```
CL.Math      // Vec3 操作（对象或 Float64Array，与 Camera/凸包共用）
CL.Camera    // §11
CL.Picking   // §12
CL.Polyhedron// §7.2–7.4
CL.Renderer  // §2–§9（含 WebGL2 程序、几何重建、绘制）
CL.Overlay   // §13（Canvas2D 或 GL）
CL.Viewport  // 输入/相机/拾取/测量 编排（对应 src/ui/Viewport.cpp）
CL.Defaults  // render-constants.json 的 JS 镜像
```

---

## 15. 默认值汇总

### 15.1 RenderOptions（`Renderer.h`，含继承的 AppearanceState）

| 字段 | 默认 | 说明 |
|---|---|---|
| `cellColor` | `0xD6DEE9` | 晶胞线颜色 |
| `backgroundColor` | `0x020305` | 背景基色 |
| `cellLineWidth` | 1.0 | clamp 0.5–4.0 |
| `polyTransparency` | 66 | %，100 = 只描边 |
| `polyEdgeWidth` | 1.2 | 屏幕像素，0 关闭 |
| `polyEdgeColor` | `0x91B4D3` | 描边色 |
| `showCell` | true | |
| `showAxes` | true | **死选项**（Renderer/Viewport 均不读取；gizmo 始终画） |
| `showBonds` | true | |
| `showLabels` | false | |
| `showImages` | true | 边界原子 |
| `style` | BallAndStick(0) | 0/1/2 |
| `atomScale` | 0.30 | UI 滑杆映射 0.15–0.80；settings 读取接受 0.15–0.85；渲染内部 clamp 0.10–0.85 |
| `bondRadius` | 0.105 | Å |
| `supercellX/Y/Z` | 1 | clamp 1–16 |
| `ambientOcclusion` | true | **死选项**（无任何使用） |

### 15.2 相机 / 拾取 / 交互

见 §11、§12。要点再列：yaw 35°、pitch 24°、fovY 38°、pitch 限 ±85°、orbit 0.0072 rad/px、zoom `exp(-0.16*steps)`、fit margin 1.12/1.16/1.18(视口)、pick 容差 `max(r*1.04, boundRadius*0.007)`。

### 15.3 渲染精度与上限

MSAA 请求 4×（驱动不支持则 0）；`kMaxCellRepeats=16`；超胞 65,536 位点 / 300,000 周期键；显示镜像上限 80,000；配位壳 ≤14 点；高亮槽 3；标签候选 ≤400、最多画 90；测量标签最多 24；文本缓存 >600 条清空。

### 15.4 单位表

| 量 | 单位 | 典型值 |
|---|---|---|
| 原子半径 | Å | 0.2–3.2 |
| 键半径 | Å | 0.105（含 H ×0.82） |
| 晶胞线半径 | Å | 0.017–0.065 × 0.5..4 |
| 测量线半径 | Å | 0.028（已确认）/0.030（待选） |
| 多面体描边 | 设备像素 | 0–4，默认 1.2 |
| HUD 字号 | CSS 像素 × dpiScale | 8.6–21 |
| 面板圆角 | 像素 | 7–12 |
| 相机距离 | Å | 默认 20，clamp 自适应 |

---

## 16. 性能策略（必须保留的行为）

1. **静态/半静态几何**：原子/线实例缓冲只在 `SetStructure/SetOptions/SetAppearance`（几何相关字段）时重建上传；绘制阶段零 CPU 顶点工作。
2. **选中/悬停零上传**：实例里存 `index`，VS 比较 uniform（`uHovered/uSelected0..2`）——鼠标移动只改 uniform。
3. **一次 draw call/类别**：全部原子 1 次实例化 draw；全部线 1 次实例化 draw（+晶胞线穿透 pass 1 次）；多面体 1 次。
4. **晶胞线两次绘制**：先不透明画全部，再用 `depthFunc=GREATER` + α0.18 画被遮挡部分（比每条线做深度排序便宜）。
5. **多面体排序只在相机方向变化时重算**：`LengthSq(forward - lastForward) < 1e-14` 直接复用索引缓冲。
6. **不透明/透明多面体分流**：`polyTransparency==0` 时开深度写、免排序、非索引绘制。
7. **uniform location 缓存**：初始化时 `getUniformLocation` 一次；每帧只 `uniform*` 调用（JS 侧同样缓存 location 对象）。
8. **几何缓存拓扑**：凸包按站点算一次，所有超胞/边界副本共享三角形拓扑（只平移+换色）。
9. **HUD 文本缓存**：原实现按 (文本,字号,bold) 缓存字形纹理；Canvas2D 方案直接绘制，但 `measureText` 结果可缓存。
10. **拖拽期间跳过悬停拾取**（原 Viewport 在 mouseDown 时不调 `UpdateHover`），并提高刷新定时器频率；大超胞可再加“拖动时降级”策略。
11. **自适应 near/far**（§11.3）保证深度精度，避免为超大/超小场景调参。
12. 建议 JS 侧加 **dirty flags**：`showLabels` 只影响 HUD，不应触发 `RebuildGeometry`（原实现在 `SetOptions` 无条件重建，是可优化点，但**不要改变渲染结果**）。
13. 绘制顺序不可随意调整（背景→线→原子→ghost→多面体→晶胞线穿透→HUD），否则多重透明/深度结果不同。

---

## 17. 实现验收清单（对着写代码时逐条勾）

- [ ] 原子 billboard 在视空间展开；球面深度写 `gl_FragDepth`；光照常量/系数与 §10.1 完全一致。
- [ ] 线圆柱 6 边、无端盖、径向平滑法线、颜色端点插值、flag 语义（虚线/压暗/仅主 pass）。
- [ ] 背景渐变/辉光/暗角公式逐项一致；`uResolution` 用设备像素。
- [ ] 多面体：凸包 eps=1e-6、多边形共面合并、bary 描边编码、双面法线翻转、排序键 `-dot(forward,center)`、面 α=1-transparency/100、边缘像素宽度。
- [ ] 相机：View/Proj 矩阵逐元素一致；near/far；Fit/FitPoints/FitScenePoints 的 clamp 上下界；yaw/pitch 符号（`yaw -= dx*0.0072`、`pitch += dy*0.0072`）。
- [ ] 拾取：只拾取原始站点、`max(1.04r, 0.007*boundRadius)`、近交点、忽略遮挡。
- [ ] 超胞/边界：limits 公式、80000 预算、边界截断标志；可见键的 image 匹配算法。
- [ ] 晶胞线：三方向逐子胞生成、外框/内线半径与 flags、两次 pass。
- [ ] HUD：标题/图例/测量标签/原子标签/坐标轴/提示/Flash 的布局常量与颜色；字号随 dpiScale。
- [ ] 与 `camera-cases.md` 的数值用例对齐（相机、凸包、可见键数/原子数/三角形数）。
