# 资源完整性校验清单（CrystalLens v1.1.0 → Android/Web）

> 用途：QA 逐文件核对资源是否被正确复制/生成。
> 生成时间：2026-11-21；生成方式：Python 3 `hashlib` + `Pillow`（SHA-256 均为小写十六进制）。
> 权威源（只读）：`../`；便携包 `../` 的 library/examples/docs 与源码树逐字节一致（已核对）。
> 本清单范围：`web/data/`、`web/assets/`、`docs/spec/library.json`；`web/js/`、`web/css/` 由其他实现方负责，不在本清单内。

## 1. 预期总量

| 分组 | 文件数 | 字节数 |
|---|---:|---:|
| `web/data/library` | 14 | 44,993 |
| `web/data/examples` | 6 | 3,739 |
| `web/assets` | 1 | 70,639 |
| `web/assets/icons` | 8 | 142,516 |
| `docs/spec` | 1 | 8,955 |
| **合计** | **30** | **270,842** |

- 运行时数据（`web/data/`）合计 **48,732 B**；素材（`web/assets/`）合计 **213,155 B**。
- 若 QA 环境还包含其他实现方交付的 `web/js/`、`web/css/`，总量会更大，属正常。

## 2. 文件清单与 SHA-256

### `web/data/library/`

| 路径 | 字节 | SHA-256 |
|---|---:|---|
| `web/data/library/anatase.cif` | 2,818 | `bc8b1ade9afc6780ca3e6011f471654ccd2d881b2562d942f7d02e0a41c7ee9b` |
| `web/data/library/brookite.cif` | 2,671 | `d9a9e87c70e7c81280f2c4fc3b8901c067a4bde5ccfbfaa6e64642ed0f6615f1` |
| `web/data/library/calcite.cif` | 3,063 | `26a570b996696a456f041b3ac196cf050926a74bd7e034e38623dca3e9367147` |
| `web/data/library/cooperite.cif` | 2,346 | `22cefe809e3e2b49bcc39619fd36776372e6c26095ec6e0ebc7c9c3d91ac60db` |
| `web/data/library/diamond.cif` | 5,822 | `fc43316d0cc970f009039e6b3581482931a1f95a28c6682e745478f603180ffe` |
| `web/data/library/fluorite.cif` | 4,599 | `9ccbdf57c182826b9673078c463138a164ce3e81869f0d80f6c71ab2824c36ab` |
| `web/data/library/halite.cif` | 4,730 | `78f4a515a6a034b3d3a0308bc7eb1bd9618fb04da99329bd96f68bbf19be8103` |
| `web/data/library/perovskite.cif` | 2,325 | `dac4b6abcca28ccc806ea87b1699a208f2c5cd794f4bd1d994fa718c3048e19b` |
| `web/data/library/quartz.cif` | 2,670 | `12c534551da2eceeedbbc88942fa72d108098f5c4acc1724e44db0274bbe4b30` |
| `web/data/library/rutile.cif` | 2,648 | `99f2f735243120d0e3b9d40619fcd17642048a44f08f1c85bc5a9a7077434cd5` |
| `web/data/library/sphalerite.cif` | 3,329 | `ce1343a2f46a6db52b1ae136d083a4f27ad3b590d2377146fb06c799ed4b55ce` |
| `web/data/library/wurtzite.cif` | 2,302 | `afd2197b3078388bfd25528385eb6358fdfffa170b4b90373b024ad2c79aafae` |
| `web/data/library/index.tsv` | 735 | `391441676ea2a3c5e9079f4d772f1c566af2ea850e4dbdcaf806a1075f8cfc90` |
| `web/data/library/SOURCES.md` | 4,935 | `4d133805d05540092ecb29ce42c7bae6e20925b2cf98af76e7db53e6f4f6a079` |

### `web/data/examples/`

| 路径 | 字节 | SHA-256 |
|---|---:|---|
| `web/data/examples/benzene.xyz` | 498 | `5577b712783addced5b549aa979f0e7b2583bf040acc8d1727e05b9fe9798864` |
| `web/data/examples/diamond.cif` | 746 | `e0fcb748873f57df666f3f5e627d6e05c9c12cad9332b5a92539f1c8178a8e76` |
| `web/data/examples/nacl.vesta` | 851 | `d29e0847aaf66ea80640df8a85a92a9c635f52c98e24c974f30387b93113adb7` |
| `web/data/examples/quartz.cif` | 822 | `005f38e99d34806fb704e65183f0a94d1249e942b1d87bb4f50d453db9b193fb` |
| `web/data/examples/srtio3.cif` | 694 | `455c5cd141c09af03c21a76097f52846e60ee634710778dd2e4b25608a1663c8` |
| `web/data/examples/water.xyz` | 128 | `be39ee8b69fc4cf050fa938e38bf2cbe0281161c6056c35f5bd6ccc02d7f6f5e` |

### `web/assets/`

| 路径 | 字节 | SHA-256 |
|---|---:|---|
| `web/assets/logo.png` | 70,639 | `d75cd58cbfc727fc1cf9f07773cd5c0a21a401b05bd7c29ff34a5fbabced3f36` |

### `web/assets/icons/`

| 路径 | 字节 | SHA-256 |
|---|---:|---|
| `web/assets/icons/icon-48.png` | 3,465 | `ccb52611d8d7e828a5c7258dad6d550ce4148aa48a4566e253f3071696a92eba` |
| `web/assets/icons/icon-72.png` | 6,004 | `86ca0ecc839846a32cd710cfc461e80464c440448d32e08300c35355d5efba73` |
| `web/assets/icons/icon-96.png` | 8,872 | `df8cff8f58a58b250929b7eee9f427c52a00066d7e7cddc4db73631f5209408b` |
| `web/assets/icons/icon-144.png` | 15,435 | `05aff554b43ef0e0fe16d72051609bb45d079976042d0d05ed4ba593d4ece84d` |
| `web/assets/icons/icon-192.png` | 22,714 | `77a75cc4a9f5926b4f5e9ee5064d95fb473ca6a055914e2362619ad5b9e188f1` |
| `web/assets/icons/icon-512.png` | 81,894 | `9520d490e3fb3446dc627a2e4430b741e824bf1864cb2d31d91bde7d1d187d57` |
| `web/assets/icons/icon-favicon-32.png` | 1,932 | `bb681281da6e0307db5d1767ddd687d0af899ebfb7434106c922d042b0833b66` |
| `web/assets/icons/README.md` | 2,200 | `d316fad87591bd79586572db3f4718db5a26b260f450c9ccbc3be28ec47d7d9b` |

### `docs/spec/`

| 路径 | 字节 | SHA-256 |
|---|---:|---|
| `docs/spec/library.json` | 8,955 | `35f09887cc316b85996abe5cc76530ff76300b58a18c5b7c1a75492905bb18ab` |

## 3. 与权威源的一致性

- 与 `../` 对应文件逐字节相同：**21 / 21**（12 CIF + index.tsv + SOURCES.md + 6 示例 + logo.png）。
- 12 份 CIF 的 SHA-256 与 `library/SOURCES.md` 表内记录一致：**12 / 12**。

## 4. 图标几何校验（`web/assets/icons/`）

| 文件 | 尺寸 | 四角 alpha | 内容 bbox | 左/右/上/下边距(%) |
|---|---|---|---|---|
| `icon-favicon-32.png` | 32×32 | 0,0,0,0 | (2,2,30,30) | 6.2 / 6.2 / 6.2 / 6.2 |
| `icon-48.png` | 48×48 | 0,0,0,0 | (3,3,45,45) | 6.2 / 6.2 / 6.2 / 6.2 |
| `icon-72.png` | 72×72 | 0,0,0,0 | (4,4,67,67) | 5.6 / 6.9 / 5.6 / 6.9 |
| `icon-96.png` | 96×96 | 0,0,0,0 | (6,6,90,90) | 6.2 / 6.2 / 6.2 / 6.2 |
| `icon-144.png` | 144×144 | 0,0,0,0 | (8,8,135,135) | 5.6 / 6.2 / 5.6 / 6.2 |
| `icon-192.png` | 192×192 | 0,0,0,0 | (11,11,180,180) | 5.7 / 6.2 / 5.7 / 6.2 |
| `icon-512.png` | 512×512 | 0,0,0,0 | (30,30,481,481) | 5.9 / 6.1 / 5.9 / 6.1 |

通过标准：尺寸与文件名一致；四角 alpha = 0；四边边距各在 **5%–7%** 区间（目标 6%）；PNG 可正常解码。

## 5. `docs/spec/library.json` 结构校验

- 顶层键：`schemaVersion`, `app`, `version`, `generatedFrom`, `crystals`, `examples`。
- `crystals` 数组：**12** 项；每项字段固定为 `id / file / titleZh / titleEn / formula / spaceGroup / cell / sourceId / sourceNote / kind`，`kind` 均为 `crystal`。
- `examples` 数组：**6** 项；每项字段固定为 `file / titleZh / titleEn / format / formula / note`。
- 与 `web/data/library/index.tsv` 交叉核对：12/12 的 file、titleZh、titleEn、formula、spaceGroup、sourceId 完全一致。
- 与 12 份 CIF 的 `_cell_*` 交叉核对：12/12 晶胞参数一致（容差 1e-9）。
- JSON 可被 `json.loads` 解析，UTF-8 无 BOM。

## 6. 复核命令

```powershell
$py = "python"
& $py -c "import pathlib,hashlib; root=pathlib.Path(r'.'); [print(hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_size, p.relative_to(root)) for p in sorted((root/'web').rglob('*')) if p.is_file()]"
```

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath web\data\library\halite.cif | Format-List
Get-ChildItem web\assets\icons -Filter *.png | ForEach-Object { Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue; $i=[System.Drawing.Image]::FromFile($_.FullName); "{0} {1}x{2}" -f $_.Name,$i.Width,$i.Height; $i.Dispose() }
```

## 7. 已知非校验项

- `docs/` 截图（12 张，4,873,051 B）仅用于说明书，**不在**本清单校验范围，也不得打进 APK。
- Windows `resources/app.ico`（64,710 B）不随 Android/Web 交付，无需校验。
- `web/assets/icons/README.md` 为说明文档；若改动图标说明或重新生成图标，需同步更新本表（SHA-256 会变化）。

