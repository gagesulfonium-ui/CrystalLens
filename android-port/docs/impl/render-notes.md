# 渲染层实现说明（impl-render）

> 基线：`../`（v1.1.0，C++17 / OpenGL 3.3 Core），规格依据
> `docs/spec/render.md` + `docs/spec/render-constants.json`，接口依据 `docs/CONTRACT.md`
> §5.3/§5.4/§5.5/§6.5。本文记录 WebGL2 移植的实现细节、与 C++ 的差异、数值验证与
> 自测截图结论。

## 1. 文件与职责

| 文件 | 内容 |
|---|---|
| `web/js/render/camera.js` | `CL.Camera`：球坐标轨道相机、透视/正交投影、fit/fitPoints/fitScenePoints、orbit/pan/zoom、`screenRay`、`worldToScreen`、near/far、列主序 view/projection。零依赖（自带 vec3 辅助）。 |
| `web/js/render/gl.js` | `CL.GL`：WebGL2 上下文创建与能力探测、`ShaderProgram`（编译/链接/uniform 位置缓存/set* 封装）、全部 GLSL ES 3.00 着色器源码、实例模板（billboard quad、6 面圆柱 14 顶点 TRIANGLE_STRIP）、颜色转换（u32/hex/[r,g,b] → 0..1）。 |
| `web/js/render/renderer.js` | `CL.Renderer`：canvas/overlay 创建与自适应、DisplayModel → GPU 实例缓冲、7 个 pass 的绘制状态、多面体排序、拾取、可见点、截图、dispose、上下文丢失恢复、HUD 职责开关。 |
| `web/js/render/overlay.js` | `CL.Overlay`：Canvas2D HUD（原子标签、元素图例、测量数值框+端点、hover tooltip、坐标轴 gizmo），按 `RenderOptions.overlay` 开关裁剪。 |
| `web/dev/render-demo.html/.js` | 自测页（mock DisplayModel NaCl 2×2×2：125 原子 / 61 边界像 / 300 键 / 27 晶胞线 / 63 个 Na 八面体）。URL 参数见 §9。不进最终应用。 |
| `web/dev/render-annotations-check.html` | 自测页：真实晶体库模型 + 真实 `CL.crystal.measureDistance/measureAngle` 生成的 annotations，用于校验测量叠层（app 的 HUD 职责划分）。不进最终应用。 |

依赖：`CL.GL`（自身文件）+ 可选 `CL.periodic`（仅当 DisplayModel 没给 `baseRadius` 或
space-fill 需要 vdW 时兜底）、可选 `CL.Overlay`（不存在时 3D 照常渲染）。渲染器可在只有
`camera.js/gl.js/renderer.js` 的情况下独立加载运行。

## 2. 帧管线（与 render.md §9 一致）

```
清屏(0.007,0.008,0.011) + depth clear
1 背景（全屏三角，gl_VertexID；近黑背景 + 竖直渐变 + 右上辉光 + 暗角）
2 线段（1 次实例化 draw）：晶胞线 → 3D 坐标轴线（默认关）→ 化学键 → 测量线
3 原子（1 次实例化 draw，billboard impostor + gl_FragDepth 精确球面深度）
4 ghost 原子（可选，边界像半透明材质，独立 blend pass）
5 多面体（半透明：按相机方向排序 + 索引绘制；不透明：无排序 drawArrays）
6 晶胞线"穿透"叠画（depthFunc=GREATER + alpha 0.18，只重画晶胞线实例）
7 2D HUD（Canvas2D overlay，独立 canvas）
```
draw call 数：背景 1 + 线 1 + 原子 1 + ghost 0/1 + 多面体 0/1 + 晶胞穿透 0/1 ≤ 6。
所有几何只在 `setModel`/几何相关 `setOptions` 变化时重建；`render()` 每帧只更新矩阵、
uniform 和多面体排序（方向变化时）。

## 3. Camera

- 状态：`target`、`distance`（默认 20）、`yaw=35°`、`pitch=24°`（clamp ±85°）、
  `fovY=38°`、`orthographic=false`、`sceneRadius≥0.5`（公开，供拾取最小容差用）。
- 基：`eye=target+(cosP cosY, cosP sinY, sinP)*d`；`f=normalize(target-eye)`，
  worldUp=(0,0,1)（与 f 近平行时退化为 (0,1,0)），`r=normalize(cross(f,worldUp))`，
  `u=normalize(cross(r,f))`。basis 带 dirty 缓存。
- 矩阵逐元素照抄 render.md §11.6（列主序）：View = `[r.x,u.x,-f.x,0, r.y,u.y,-f.y,0,
  r.z,u.z,-f.z,0, -r·eye,-u·eye,f·eye,1]`；透视 `fovY` 用 `1/tan(fovY/2)`；
  正交用 `distance*tan(fovY/2)` 决定视锥大小。
- 近远平面：`near=max(0.02, d-2.2R)`、`far=max(near+2, d+5R+10)`。
- `fit`（球，margin 1.12）/`fitPoints`（点集，margin 1.16）/`fitScenePoints`
  （先 setScene 到点集 AABB 中心再拟合，视口 margin 1.18），距离 clamp
  下界 `R*0.06+0.05`(球)/`R*0.05+0.05`(点)，上界 `R*30+50`。
- 交互常量：orbit `0.0072 rad/px`（yaw-=dx、pitch+=dy），pan
  `wpp=2·d·tan(fovY/2)/h`，zoom `d*=exp(-steps*0.16)`，滚轮 steps=deltaY/120。
- `screenRay` 正交/透视两条分支；`worldToScreen` 返回 `{x,y,depth,visible}`，
  `visible = zc>near*0.5 && |ndcZ|≤1.25`（宽松，避免标签闪烁）。

## 4. 原子（球体 impostor）

- 实例布局 9×float32：`pos(3) radius color(3) flags index`，单位四边形 + 5 个
  divisor=1 的实例属性；着色器照抄 render.md §10.1（视空间 billboard、片元射线-球求
  交、`gl_FragDepth`、主光/补光/双高光/rim、选中金色环/悬停青色内缘、ghost 混色）。
- 选中/悬停零上传：实例里存 `index`，VS 与 `uHovered/uSelected0..2` 比较置 flag。
- 半径规则（C++ §3.3）：baseRadius 由模型层给（过渡金属共价/其余 vdW）；
  ball-stick 与 polyhedral 用 `max(0.1, baseRadius*clamp(atomScale,0.1,0.85))`，
  polyhedral 有凸包时再 `×0.72`；space-fill `max(0.1, vdw*0.92)`，忽略 atomScale
  （`CL.periodic` 提供 vdW，模型层未给时按 baseRadius 兜底）。
- 抗锯齿：上下文 `antialias:true`（无头 SwiftShader 也能拿到 4× MSAA）；MSAA 可用时
  原子 pass 开 `SAMPLE_ALPHA_TO_COVERAGE`（与 C++ 相同），否则退化为
  `SRC_ALPHA/ONE_MINUS_SRC_ALPHA` 混合，片元 alpha smoothstep 产生轮廓柔化。
- 边界原子（`kind==='boundary'`）：可选用 ghost 材质（flags bit2，C++ §7.8 的预留
  协议；默认**关闭**以对齐 v1.1.0 实际外观，`options.boundaryGhost=true` 打开，
  单独 blend pass + 不写深度）。

## 5. 线段（晶胞 / 键 / 测量）

WebGL2 没有几何着色器：预生成 14 顶点（7 圈×2 端）TRIANGLE_STRIP 圆柱模板，实例属性
`p0,p1,radius,c0,c1,flags`，VS 内构造 `axis/side/up` 正交基并沿轴向变换，一次
`drawArraysInstanced(TRIANGLE_STRIP, 0, 14, n)` 即与 C++ 几何着色器字节级等价的六棱柱管
（无端盖、径向平滑法线、端点颜色插值、虚线/压暗/仅主 pass 的 flags 全部保留）。

- 晶胞线：`radius = clamp(0.005*min(a,b,c),0.017,0.065) Å × clamp(cellLineWidth,0.5,4)`，
  外框 flags=2、内部细分线 flags=6（半径×0.52 + 压暗），再叠加
  `depthFunc=GREATER + alpha 0.18` 的穿透 pass。模型层 `lines[].kind` 只有
  `cell/axes`，外框/内部由渲染器把端点转成分数坐标判定（与 C++ §6.2 三方向生成规则等价）。
- 化学键：`model.bonds` 已由模型层解析到显示像，直接按 `radius/color` 画；
  含 H 时半径 ×0.82；space-fill 与"多面体已生效"时不画键（C++ §5.2）。
- 测量线：取 `Measurement.points`（渲染空间、含周期镜像修正）直接画；距离金色
  (1,0.76,0.28) 半径 0.028、角度青色 (0.38,0.83,1.0)；`pending` 连续原子间金色
  半径 0.030；flags=1 虚线（15 周期、58% 占空比）。
- 3D 坐标轴线：`model.lines` 中 `kind==='axes'` 默认**不画**（v1.1.0 中 showAxes 是
  死选项、只有 gizmo）；新增 `options.show3dAxes=true` 才画（a/b/c 红/绿/蓝）。

## 6. 多面体（重点）

- 顶点数据：`pos(3) normal(3) color(3) edgeMask(3) triA(3) triB(3) triC(3)`（21 float）。
- 面 alpha = `1 - polyTransparency/100`（66 → 0.34）；颜色 = 中心原子元素色；
  双面渲染（关 cull + `gl_FrontFacing` 翻转法线）；透明时 `depthMask=false` 且按
  `-dot(forward, triangleCenter)` 升序（远→近）排序后 `drawElements`；不透明
  （transparency=0）时不排序、开深度写、`drawArrays`。
- **描边（WebGL2 差异）**：GLSL ES 3.00 没有 `noperspective`，无法照抄 C++ 的
  "noperspective bary + dFdx/dFdy" 技巧。本实现给每个顶点附带其三角形的 3 个世界
  坐标 + 每条边是否描边的 mask，VS 把它们投影到像素空间输出为 `flat` varying，
  FS 用 `gl_FragCoord` 与 3 条屏幕空间边做精确点-线距离，得到与 C++ 视觉等价的
  "屏幕像素恒定宽度的解析描边"：`edge = clamp(0.5*w_px + 0.5 - dist_px, 0, 1)`，
  颜色 `polyEdgeColor`（默认 0x91B4D3），宽度 = `polyEdgeWidth × dpr` 设备像素。
- **哪些边描边**：只画多边形面的边界，不画共面扇形三角化的对角线。模型层
  `DisplayPolyhedra.triangles` 不含 bary/boundary 信息，渲染器按"平面分组 + 边计数"
  重建：同一平面（法线+平面距量化到 1e-4）内出现 2 次的边是扇形对角线（不描边），
  出现 1 次的是真实棱。数值验证（Node 直接喂真实模型数据）：
  halite 1×1×1 / 2×2×2、quartz 2×2×2、fluorite 1×1×1 上
  **重建描边边集合与 `model.polyhedra.edges` 完全一致（missing=0，extra=0）**。
- 排序：方向变化 `|Δforward|²<1e-14` 直接复用索引；>6 万三角形时加角度阈值节流
  （cos>0.9995 复用），>40 万三角形时跳过共面合并（所有边按棱处理）以控制重建耗时。

## 7. 2D HUD overlay

- 独立透明 Canvas2D，叠在 WebGL canvas 上，`pointer-events:none`。
- **坐标/DPR**：canvas 尺寸 = CSS 尺寸 × dpr，`ctx.setTransform(dpr,...)`，所有绘制在
  CSS 像素空间；HUD "设计像素"直接就是 CSS 像素（= 设备像素 / dpr），与 C++ `S(v)`
  语义一致。修复了早期版本在 dpr>1 时 gizmo 位置翻倍的问题（已用 dpr=2 无头截图回归）。
- 内容：原子标签（≤400 原子、最多 90 个、近处优先 + 矩形碰撞剔除、元素色提亮 +
  黑色阴影）、元素图例（右上、最多 8 种、按符号排序）、测量数值框（最多 24 个、
  5 次碰撞上移、距离金/角度青）+ 测量线段端点圆点、hover tooltip（跟随原子投影位置，
  自动翻转避免出屏）、右下角坐标轴 gizmo（a/b/c 红/绿/蓝，按深度排序）。
- **HUD 职责划分（CONTRACT §5.4）**：`RenderOptions.overlay = {gizmo, legend, labels,
  measurements}` 默认全 true；正式应用传 `{gizmo:false, legend:false, labels:false,
  measurements:true}` → 渲染器只画测量叠层（3D 测量线 + 端点 + 数值框）与 hover
  tooltip，legend/gizmo/原子标签由 UI DOM 绘制，避免双份。已验证：app 截图只有 1 份
  图例/gizmo；`web/dev/render-annotations-check.html` 用真实晶体库模型 + 真实
  `measureDistance/measureAngle` + app 同款 overlay flags 截图确认测量叠层可见。

## 8. 拾取 / 可见点 / 截图 / 容错

- `pick(camera,x,y)`：x,y 为 CSS 像素；`ScreenRay` 后遍历原子实例（只取 `index>=0`，
  即 pickable），`pickRadius=max(r*1.04, modelRadius*0.007)`，取近交点，忽略遮挡，
  返回 DisplayAtom id / -1。
- `getVisiblePoints()`：晶胞 8 角 + 原子 AABB 并集（8 角，按最大实例半径外扩）+ 多面体
  顶点采样。C++ 是逐原子 8 角；这里用并集是 O(n) 近似（略大，fit margin 1.18 下无感），
  5 万原子也不会产生 40 万点数组。
- `screenshot()`：把 WebGL canvas + overlay canvas 合成到离屏 canvas，返回
  `data:image/png;base64,...`（上下文 `preserveDrawingBuffer:true`）。
- 容错：无 WebGL2 / 着色器失败 → `supported=false` + `error`，overlay 画出
  render.md §13.9 三段式提示（不抛异常）；空模型只画背景；监听
  `webglcontextlost/restored` 重建全部 GL 资源；`dispose()` 移除监听/observer/GL 对象。

## 9. 自测（无头 Edge/SwiftShader，`tests/headless/shot.cjs`）

dev-demo URL 参数：`?style=ball-stick|space-fill|polyhedral`、`?poly=1`（非多面体样式也
强制生成面，调试用）、`?refcheck=1`（halite 2×2×2 多面体对照场景：含边界中心多面体、
yaw35/pitch24、fit 1.18）、`?light=1`（浅色背景，对照 v11 docs 图）、`?labels=1`、
`?ghost=1`、`?axes=1`（3D 轴线）、`?cells=0 ?bonds=0 ?boundary=0`、`?measure=1`、
`?atomScale=`、`?transp=`、`?edgew=`。支持鼠标轨道/平移/缩放/点击选择/悬停拾取。
页面把渲染器 `info()`（含 GL/SAMPLES/实例数/draw call/模型统计）同步写入
`#cl-render-log`，以便 `--dom` 无头断言。

`web/dev/render-annotations-check.html` 参数：`?lib=halite&style=...&supercell=2x2x2`、
`?close=1`（贴近测量对象）、`?hover=<id>`。

截图与结论（路径相对 `tests/headless/out/`）：

| 截图 | 内容 / 结论 |
|---|---|
| `render-ball-stick.png` / `-dpr2-down.png` | mock NaCl 2×2×2 球棍：球/键/晶胞线正常，深色专业风格 |
| `render-space-fill.png` | 空间填充：全原子 vdW*0.92，无键，晶胞线与穿透 pass 正常 |
| `render-polyhedral.png` / `-dpr2-down.png` | 多面体：63 个 Na 八面体、半透明面 + 细描边、排序正确 |
| `render-demo-axes3d.png` | `show3dAxes` 可选 3D 轴线（红/绿/蓝）验证 |
| `refcheck-halite-poly-light.png` / `-dpr2-down.png` | 与 `reference/.../halite-polyhedra-v11.png` 同结构同视角对照：面透明度/描边颜色宽度/八面体簇形态一致（浅色背景时几乎重合） |
| `refcheck-halite-poly-dark.png` | 同上，深色主题 |
| `overlay-annotations.png` / `-dpr2-down.png` | 真实晶体库模型 + 真实 measure API：距离 2.820 Å 金色框、角度 90.00° 青色框、虚线测量线 + 端点、hover tooltip；app 同款 overlay flags |
| `app-quartz-poly-222.png` / `-dpr2-down.png` | 集成 app：quartz 2×2×2 多面体，32 中心/128 三角形，无 3D 轴线，HUD 无双份 |
| `app-halite-bs.png` / `-dpr2-down.png` | 集成 app：halite 球棍 27 原子/54 键 |

数值/视觉对照结论（回 lead 的 4 点）：

1. **多面体描边**：只描多边形边界（重建边集合与 `model.polyhedra.edges` 100% 相同，
   missing=0/extra=0，共 4 组结构验证）；`uAlpha = 1-66/100 = 0.34`；描边色
   `#91B4D3`、宽度 `1.2×dpr` 设备像素、`edge=clamp(0.5w+0.5-dist)`——截图取色确认
   边缘核心像素恰为 (145,180,211)=0x91B4D3。深色主题下描边显得"亮"，是因为参考图
   是 HiDPI/缩放后保存（参考图 2707px 宽、表格 1.2px 设备像素描边被缩到 <1px 视觉），
   本实现按 `dpr` 换算后在高 dpi 下同样细；`--dpr 2` 截图再缩到 1× 后与参考图几乎一致。
2. **晶胞线**：世界单位半径 `clamp(0.005·min(a,b,c),0.017,0.065) Å × cellLineWidth`，
   外框/内部 1.0/0.52，主 pass 不透明 + `depthFunc=GREATER`/alpha 0.18 穿透 pass
   全部实现（不是屏幕像素线宽）。按参考图反推：halite a=5.64 时线直径 0.0564 Å；
   参考截图按晶胞比例测得 ~0.06 Å，一致。视觉粗细差异同样来自 HiDPI 缩放。
3. **球棍键半径**：`render.md §5.1` 与 C++ `Renderer::RebuildLines` 中
   `radius = options_.bondRadius`（0.105）传入的是**半径**（几何着色器里
   `endpoint + normal*radius`）；直径 0.21 Å，含 H ×0.82。已按半径实现，与参考图
   键/球比例一致。
4. **space-fill 半径**：`vdw*0.92`（忽略 atomScale）已实现；`CL.periodic` 提供 vdW，
   不可用时回退 `baseRadius*0.92`。

## 10. 与 C++ 的差异 / 风险

| 项 | 处理 | 风险 |
|---|---|---|
| 几何着色器 → 实例化圆柱 | 14 顶点 strip 等效 | 无（已验证外观/深度正常） |
| `noperspective` bary | 屏幕空间边距（flat 三角形顶点 + 片元距离） | 大三角形/极端透视下数学上更精确，无风险 |
| `gl_FragDepth` 球面深度 | GLSL ES 3.00 原生支持 | 关闭 early-Z，属预期 |
| 4× MSAA | 用默认帧缓冲（浏览器给 4×） | 若设备默认 FB 无 MSAA：原子改用混合轮廓，视觉略硬（可接受，已降级） |
| 多面体排序 | 质心画家算法 + 方向阈值复用 | 相交/极薄面偶有排序瑕疵（C++ 相同算法） |
| 边界原子 ghost | 可选（默认关，对齐 v1.1.0） | 无 |
| 3D 坐标轴线 | 默认关（v1.1.0 亦不画） | 无 |
| HUD | Canvas2D 替代 GDI；app 中大部分由 UI DOM 绘制 | 字体/度量与 GDI 略有差异 |
| 超大超胞 | 几何仅在变化时重建；>6 万三角形排序节流 | 极端数据（>40 万三角形）描边合并降级 |
| 上下文丢失 | 监听并重建 | 未做异步资源重编译的 UX 提示 |
