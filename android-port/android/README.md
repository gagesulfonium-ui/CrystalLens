# CrystalLens v1.1.0 — Android 宿主（`android/`）

纯 Java + Android SDK 平台 API 的 WebView 宿主，**不依赖 Gradle / AndroidX / 任何网络依赖**，
构建走 `aapt2 → javac → d8 → zipalign → apksigner` 直通流程（`tools/build_apk.ps1`）。

Web 核心（`web/` → `dist/preview/`）负责全部晶体渲染与业务功能，宿主只提供外壳与原生能力：
全屏沉浸式 WebView、系统文件选择器、共享文件接收、导出/分享、返回键转发、外链跳转。

---

## 1. 交付物与验证结果

| 项 | 值 |
|---|---|
| APK | [`dist/CrystalLens-v1.1.0-android.apk`](../dist/CrystalLens-v1.1.0-android.apk) |
| 大小 | **148,876 字节（0.142 MB）** |
| SHA-256 | `09911aba43711ec6369756b426a93643be7f0921fa45715b41f5257012a6860c` |
| 构建时间 | 2026-11-21T21:35:54+08:00（耗时 3.6 s） |
| 包名 / 版本 | `com.crystallens.android` / versionName `1.1.0`，versionCode `110` |
| SDK | minSdk 24，targetSdk 36，compileSdk 36 |
| 签名 | `apksigner verify` → **Verifies**（APK Signature Scheme v2: true，v3: true） |
| 证书 | `CN=CrystalLens Debug, O=Android, C=US`，RSA 2048 |
| 权限 | 仅 `android.permission.VIBRATE`（normal，安装时自动授予；无 INTERNET / 存储权限） |
| 当前内置 Web 资源 | **占位页**（`assets/www/index.html`，Web 核心未生成完毕） |

> ⚠️ 该 APK 用**调试密钥**签名（`.toolchain/debug.keystore`，口令 `android`），可直接侧载安装，
> 但不是发布签名；正式发布需换成自己的 keystore。
>
> ⚠️ 每次构建的 APK 字节不同（zip 条目时间戳来自文件修改时间/当前时间），内容一致；
> 上表 SHA-256 对应当前磁盘上的这一份产物。

### 1.1 验证输出（本次构建）

```text
$ apksigner verify --verbose --print-certs dist/CrystalLens-v1.1.0-android.apk
Verifies
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): true
Verified using v3.1 scheme (APK Signature Scheme v3.1): false
Verified using v4 scheme (APK Signature Scheme v4): false
Number of signers: 1
Signer #1 certificate DN: CN=CrystalLens Debug, O=Android, C=US
Signer #1 certificate SHA-256 digest: 4ae7fd81a35d9447ffddb31c9b5b064c4fcf800065efdb3d5854dde5df5dd1b4
Signer #1 key algorithm: RSA
Signer #1 key size (bits): 2048

$ aapt2 dump badging dist/CrystalLens-v1.1.0-android.apk
package: name='com.crystallens.android' versionCode='110' versionName='1.1.0' ... compileSdkVersion='36'
minSdkVersion:'24'
targetSdkVersion:'36'
uses-permission: name='android.permission.VIBRATE'
application-label:'CrystalLens'
launchable-activity: name='com.crystallens.android.MainActivity'
  uses-gl-es: '0x30000'

$ aapt2 dump permissions dist/CrystalLens-v1.1.0-android.apk
package: com.crystallens.android
uses-permission: name='android.permission.VIBRATE'

$ zipalign -c -v 4 dist/CrystalLens-v1.1.0-android.apk
Verification successful            # resources.arsc 为 STORED 且 4 字节对齐

$ jar tf dist/CrystalLens-v1.1.0-android.apk
AndroidManifest.xml
res/mipmap-mdpi-v4/ic_launcher.png
...（mdpi～xxxhdpi 的 ic_launcher / ic_launcher_foreground）
res/mipmap-anydpi-v26/ic_launcher.xml
resources.arsc
assets/www/index.html
classes.dex
META-INF/ANDROIDD.SF
META-INF/ANDROIDD.RSA
META-INF/MANIFEST.MF
```

### 1.2 构建日志摘要（最后一次构建）

```text
[1] Locate toolchain        -> JDK 17.0.21.1 / build-tools 36.0.0 / platform android-36
[2] Prepare build dirs      -> android/.build
[3] Sync web assets         -> placeholder（dist/preview 未就绪）
[4] Launcher icons          -> legacy PNG ×5 密度 + adaptive foreground ×5 密度
[5] aapt2 compile           -> res.zip                       (0.1 s)
[6] aapt2 link              -> app-unsigned.apk              (0.1 s)
[7] javac -source/-target 8 -> 12 个 .class（3 源文件 + R.java）(1.0 s)
[8] d8 --release --min-api 24 -> classes.dex                 (1.3 s)
[9] append assets + dex     -> 2 条目                         
[10] zipalign -p -f 4       -> app-aligned.apk
[11] apksigner sign         -> dist/CrystalLens-v1.1.0-android.apk
[12] verify                 -> apksigner Verifies；badging 断言全部通过
[13] archive sanity         -> 18 个 zip 条目，含 assets/www/index.html、classes.dex
[14] build-info.json        -> dist/build-info.json
BUILD SUCCEEDED
```

机器可读信息见 [`dist/build-info.json`](../dist/build-info.json)（版本、大小、SHA-256、构建时间、
工具链版本、assets 数量、签名与 badging 摘要）。

---

## 2. 如何构建

前置：工具链已由 `tools/fetch_toolchain.ps1` 下载到 `.toolchain/`（JDK 17 + build-tools 36 +
platform-36；完成标志 `.toolchain/TOOLCHAIN_READY.json`）。本机**不需要**安装 Android Studio / Gradle / Java。

```powershell
# 1) 首次：拉取工具链（已完成可跳过）
powershell -ExecutionPolicy Bypass -File tools\fetch_toolchain.ps1

# 2) 构建 + 签名 + 验证（默认：有 dist/preview 就用它，否则用占位页）
powershell -ExecutionPolicy Bypass -File tools\build_apk.ps1

# 可选参数
#   -WebSource auto|preview|placeholder   强制选择 Web 资源来源（默认 auto）
#   -KeepBuild                            复用 android/.build（默认每次清理）
```

产物：`dist/CrystalLens-v1.1.0-android.apk` + `dist/build-info.json`。

### 2.1 Web 资源同步规则

* `-WebSource auto`（默认）：`dist/preview/index.html` 存在 → **清空** `android/app/src/main/assets/www/`
  后整体复制 `dist/preview/`；否则恢复 `android/placeholder/index.html` 占位页。
* `-WebSource preview`：强制要求 `dist/preview/index.html` 存在。
* `-WebSource placeholder`：忽略 `dist/preview`，打包占位页（用于链路自检）。
* 若 `dist/preview/index.html` 引用的本地 `src/href` 文件尚不存在（Web 核心构建中），脚本会逐条
  **告警**（不中断），便于在 Web 未完成时仍能产出可安装 APK。

集成真实 Web 核心只需等 `dist/preview/` 完整后重新执行一次：
`powershell -ExecutionPolicy Bypass -File tools\build_apk.ps1`。

### 2.2 无 Gradle 直通流水线（`tools/build_apk.ps1`）

1. 读 `.toolchain/TOOLCHAIN_READY.json` 定位 JDK / build-tools / platform；校验 9 个工具文件；
   设置 `JAVA_HOME` 并把 `jdk\bin`、`build-tools` 前置到 `PATH`（`.bat` 工具依赖）。
2. 同步 Web 产物到 `assets/www`（见上）。
3. `aapt2 compile --dir res -o .build/res.zip`
4. `aapt2 link -o .build/app-unsigned.apk -I android.jar --manifest ... --java .build/gen -R res.zip
   --auto-add-overlay --min-sdk-version 24 --target-sdk-version 36`
   （**故意不用 `-A`**，见 §6.1）
5. `javac -source 8 -target 8 -bootclasspath "android.jar;core-lambda-stubs.jar" ...`
   （lambda 需要 build-tools 自带的 `core-lambda-stubs.jar`；失败自动回退 `-classpath android.jar`）
6. `jar cf classes.jar .` → `d8 --release --min-api 24 --lib android.jar --output .build\dex classes.jar`
7. 用 .NET `ZipArchive`（Update 模式）把 `classes.dex` 与 `assets/**` 以 **`/` 分隔条目名**追加进 APK
8. `zipalign -p -f 4`（`resources.arsc` 保持 STORED 且对齐）
9. 首次自动 `keytool -genkeypair` 生成 `.toolchain/debug.keystore`；`apksigner sign` 输出到 `dist/`
10. `apksigner verify` + `aapt2 dump badging/permissions` 断言（包名/版本/SDK/启动 Activity/无危险权限/
    APK 内必需条目/无含反斜杠条目）+ SHA-256 + `dist/build-info.json`

脚本 `$ErrorActionPreference='Stop'`，每步校验退出码，失败立即打印原因与诊断路径。
注意：Windows PowerShell 5.1 下 native 工具的 stderr 不重定向捕获，避免 EAP=Stop 把正常告警当异常。

---

## 3. 如何安装 / 侧载

```powershell
# USB 调试安装
.toolchain\android-sdk\platform-tools\adb.exe install -r dist\CrystalLens-v1.1.0-android.apk

# 或把 APK 拷到手机，允许"安装未知应用"后点击安装
```

安装后可直接用系统"打开方式"打开 `.cif / .xyz / .vesta / .txt` 文件（`ACTION_VIEW`），
或从其它应用分享文件给 CrystalLens（`ACTION_SEND` / `ACTION_SEND_MULTIPLE`）。

---

## 4. 架构说明

```
android/app/src/main/
  AndroidManifest.xml          单 Activity + 自写 ContentProvider；无危险权限
  java/com/crystallens/android/
    MainActivity.java          WebView 宿主：沉浸式全屏 / 设置 / 导航拦截 / 文件选择 /
                               ACTION_VIEW|SEND 文件读取与注入 / 返回键转发 / 启动遮罩
    WebAppBridge.java          @JavascriptInterface 注册名 CLNative：toast / 屏幕常亮 /
                               震动 / 分块导出 + FileProvider 分享 + ACTION_CREATE_DOCUMENT /
                               外链 / 退出；单线程 Executor 保证分块顺序
    CacheFileProvider.java     极简 ContentProvider：content://com.crystallens.android.files/<name>
                               从 cacheDir/exports/ 只读提供文件（替代 AndroidX FileProvider）
  res/values/{strings,styles,colors}.xml
  res/mipmap-*/                legacy 图标（来自 web 图标资产）+ adaptive foreground（脚本生成）
  res/mipmap-anydpi-v26/        adaptive icon（背景纯色 #020305 + 前景宝石图形）
  assets/www/                  Web 核心产物（构建时同步；当前为占位页）
android/placeholder/index.html 占位页源文件（dist/preview 缺失时由构建脚本恢复）
android/tools/make_icons.py    图标生成脚本（Pillow；已生成 PNG 已入库，构建不依赖 Python）
android/icon-512.png           512×512 图标母版副本
```

### 4.1 MainActivity

* 全屏沉浸式：API 30+ 用 `WindowInsetsController` 隐藏状态栏/导航栏（滑动临时唤出）；
  API 24–29 用 `SYSTEM_UI_FLAG_IMMERSIVE_STICKY` 系列；API 28+ 刘海 `LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES`
  （`styles.xml` 里也声明 `windowLayoutInDisplayCutoutMode=shortEdges`）；窗口背景 `#020305`、禁用启动白闪。
  屏幕默认常亮（`FLAG_KEEP_SCREEN_ON`），Web 可经 `setKeepScreenOn(false)` 关闭。
* `configChanges=orientation|screenSize|smallestScreenSize|keyboardHidden|screenLayout|uiMode|density|fontScale`，
  旋转/键盘变化不重建 Activity，WebView 状态不丢；`screenOrientation=fullSensor`、`resizeableActivity=true`。
* WebView 设置：JS、DOM storage、`setAllowFileAccess(true)`（targetSdk≥30 默认关闭，必须显式开；
  `file:///android_asset` 资产访问本身不受该开关限制）、禁用缩放（手势交给 Web 核心）、
  `setMediaPlaybackRequiresUserGesture(false)`、`WebView.setWebContentsDebuggingEnabled(true)`、
  深色背景避免白闪。
* `WebViewClient`：只允许 `file:///android_asset/` 在应用内导航；http(s) 及未知 scheme 交外部
  `ACTION_VIEW` 浏览器；主框架加载失败时显示原生错误提示（含 `assets/www/index.html` 提示）。
  `onPageFinished` 后把排队的共享文件注入 Web 核心。
* `WebChromeClient`：`onShowFileChooser` → `ACTION_OPEN_DOCUMENT`（多选、`*/*`；`.cif/.xyz/.vesta`
  没有可靠 MIME，过滤会隐藏目标文件，故不过滤）；`console.log/warn/error` 转发 Logcat（tag
  `CrystalLensWeb`）；`onProgressChanged` 提前收起启动遮罩。
* 返回键：`evaluateJavascript("window.__clHandleBack ? ... : false")`，返回 JSON `true` 则消费；
  否则"再按一次返回键退出"双击退出策略（页面未就绪/加载失败时直接进入该策略）。
* `ACTION_VIEW` / `ACTION_SEND` / `ACTION_SEND_MULTIPLE` / `EXTRA_TEXT`：后台线程读取 content URI
  （UTF-8 原样字节，上限 **8 MB**）→ base64 → 页面就绪后逐个 `window.__clOpenSharedFile(name, base64)`。
* `singleTop` + `onNewIntent` 处理运行中再次"打开方式"传入的文件；`android:enableOnBackInvokedCallback="false"`
  保证 API 33+ 仍走 `onBackPressed` 逻辑。

### 4.2 `CLNative` 桥契约（与 `docs/CONTRACT.md` §6.7 对齐）

| 方法 | 说明 |
|---|---|
| `String getInfo()` | JSON：`{"available":true,"platform":"android","sdkInt":...,"model":"...","appVersion":"1.1.0","versionCode":110}`；Web 端 `JSON.parse` 后视为 Android 环境 |
| `void toast(msg)` | 主线程 Toast |
| `void setKeepScreenOn(on)` | 主线程增删 `FLAG_KEEP_SCREEN_ON` |
| `void vibrate(ms)` | 1–2000 ms 夹取；API 26+ `VibrationEffect`（`VIBRATE` normal 权限） |
| `boolean beginExport(fileName, mimeType, mode)` | 开始分块导出，写入 `cacheDir/exports/<fileName>`；`mode = "share" \| "save"`。返回 true 表示已受理（契约要求 boolean；忽略返回值也兼容） |
| `void appendExportChunk(base64)` | base64 解码后追加；单线程 Executor 保证顺序；总量上限 512 MB |
| `String endExport()` | 完成写入，返回 JSON `{"ok":true,"uri":"content://com.crystallens.android.files/<name>"}` 或 `{"ok":false,"error":"..."}`；**UI 线程**触发 Intent：`save` → `ACTION_CREATE_DOCUMENT`（无处理器/失败回退 `ACTION_SEND` 分享面板）；`share` → `ACTION_SEND` 系统分享面板（带 `FLAG_GRANT_READ_URI_PERMISSION` + ClipData） |
| `void abortExport()` | 丢弃当前导出并删除临时文件 |
| `void openUrl(url)` | 仅 http/https 交外部浏览器 |
| `void exitApp()` | `finishAndRemoveTask()` |

Web 侧需要提供的全局钩子：`window.CLNative`（宿主注入）、`window.__clHandleBack()`（返回 true 表示已消费返回键）、
`window.__clOpenSharedFile(name, base64)`（接收"打开方式"传入的文件）。

### 4.3 `CacheFileProvider`

自写 `ContentProvider`（不引入 AndroidX）：`content://com.crystallens.android.files/<name>` →
`cacheDir/exports/<name>`；`getType`/`query`（`OpenableColumns`）/`openFile` 只读；Manifest 注册
`exported="false"` + `grantUriPermissions="true"`，按 URI 授权给分享目标；canonical path 校验防目录穿越。

### 4.4 Manifest / 资源

* `uses-feature glEsVersion=0x00030000 required=false`；`hardwareAccelerated=true`；`largeHeap=true`；
  `supportsRtl=true`；`forceDarkAllowed=false`；`allowBackup=false`。
* Activity `exported=true`，intent-filter：LAUNCHER、VIEW（`content`/`file` scheme + `*/*`，
  另有 `pathPattern` 匹配 `.cif/.xyz/.vesta` 的高优先级 filter）、SEND / SEND_MULTIPLE。
* 主题 `Theme.Material.NoActionBar` 深色：`windowBackground=#020305`、`windowDisablePreview=true`、
  透明状态栏/导航栏、`windowLayoutInDisplayCutoutMode=shortEdges`。
* 图标：legacy `ic_launcher.png` 直接复用 `web/assets/icons/icon-{48,72,96,144,192}.png`；
  adaptive icon 前景按 `docs/spec/assets.md` §4.4（108 dp 画布、主体 60 dp 内、纯宝石图形、无圆角底板）
  由 `android/tools/make_icons.py` 生成（Pillow，已入库的 PNG 参与构建，构建过程不依赖 Python）。
  重新生成：`python android/tools/make_icons.py`。

---

## 5. 当前状态与集成步骤

* 本次交付的 APK 内置**占位页** `assets/www/index.html`：深色诊断页，显示 `CLNative.getInfo()`、
  WebGL2 支持、`file://` 位置、`__clOpenSharedFile` 检测，并提供 Toast/Vibrate/导出（share·save）
  自测按钮——用于在真机验证"WebView → 桥 → 文件选择 → 导出/分享"全链路。
* Web 核心就绪后（`dist/preview/` 由 `tools/build_web.py` 生成完整），主控只需重新执行：
  ```powershell
  powershell -ExecutionPolicy Bypass -File tools\build_apk.ps1
  ```
  即会把真实 Web 产物打包进 APK；构建日志会列出缺失引用（若 Web 仍不完整）。
* 构建脚本**不修改** `web/`、`dist/preview/`、`docs/`、`reference/`；只写 `android/`、`tools/build_apk.ps1`、
  `dist/` 下的 APK 与 `build-info.json`。

---

## 6. 已知风险与限制

1. **未在真机/模拟器运行过**：本机 `adb devices` 无设备、工具链无 emulator/system image，仅完成
   aapt2/apksigner/d8 静态与打包验证。真机首装需重点检查：WebView 版本与 WebGL2、SAF 文件选择器、
   返回键、导出分享、沉浸式安全区、旋转。
2. **targetSdk 36 的 WebView 文件访问策略**：`setAllowFileAccess(true)` 显式开启（API 30+ 默认 false），
   `file:///android_asset` 资产访问不依赖该开关；但 target≥30 时
   `setAllowFileAccessFromFileURLs` / `setAllowUniversalAccessFromFileURLs` 会被系统钳制为 false，
   因此 **Web 核心不要在 `file://` 下用 `fetch()/XHR` 读本地文件**（必须用 `<script>` 内嵌数据；
   CONTRACT 的单文件版约束与此一致）。
3. **当前 APK 不是最终 UI**：内置占位页；最终集成由主控重建（一条命令）。
4. **调试签名**：`.toolchain/debug.keystore`（`android/android`）仅供侧载测试，不是发布签名。
5. **APK 非字节级可复现**：zip 条目时间戳随构建变化，SHA-256 每次构建不同（内容一致）。
6. **无网络权限**：Web 核心必须离线自足；`http(s)` 链接会交外部浏览器，WebView 内无法联网。
7. **共享文件上限 8 MB**（宿主读取并 base64 注入 WebView），超出会 Toast 提示。
8. **返回键**依赖 Web 核心实现 `window.__clHandleBack()`；未实现/抛错时退化为"双击退出"。
9. **aapt2 2.20 Windows 的 `-A` 缺陷**：会生成 `assets/www\index.html`（反斜杠）条目导致 AssetManager
   找不到资源；构建脚本不使用 `-A`，改为自行以 `/` 断言追加 assets（并检查 APK 内无含反斜杠条目）。
10. **adaptive icon** 由规范几何重绘，风格与 web legacy 图标接近但非逐像素一致。
