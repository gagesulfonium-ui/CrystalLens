#!/usr/bin/env python3
"""Build the install-free CrystalLens web preview from web/ sources.

Outputs:
  dist/preview/                          full folder build (serve over HTTP; also
                                         copied into the APK assets by build_apk.ps1)
  dist/CrystalLens-Android-Preview.html  single self-contained file (open directly
                                         in Android Chrome from local storage; works
                                         offline, no server, no install)

The single-file build inlines CSS, every <script src>, the generated data file,
and small PNG assets as data: URIs. The folder build keeps the original layout so
developers can edit and refresh without rebuilding.

Usage: python tools/build_web.py [--assets-dir web/assets] [--no-single]
"""
import base64
import datetime
import html
import json
import os
import re
import shutil
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
DIST = os.path.join(ROOT, "dist")
PREVIEW = os.path.join(DIST, "preview")
SINGLE = os.path.join(DIST, "CrystalLens-Android-Preview.html")
ASSETS = os.path.join(WEB, "assets")

DATA_FILE = "js/data/library.js"
REQUIRED_FILES = [
    "index.html",
    "css/app.css",
    "js/lib/math.js",
    "js/lib/periodic_table.js",
    "js/core/cif.js",
    "js/core/xyz.js",
    "js/core/vesta.js",
    "js/core/parsers.js",
    "js/core/crystal.js",
    "js/core/measure.js",
    "js/core/edit.js",
    "js/core/export.js",
    "js/core/format.js",
    "js/render/camera.js",
    "js/render/gl.js",
    "js/render/renderer.js",
    "js/render/overlay.js",
    "js/ui/i18n.js",
    "js/ui/native.js",
    DATA_FILE,
    "js/ui/app.js",
    "js/ui/panels.js",
    "js/ui/dialogs.js",
    "js/boot.js",
]

ASSET_EXT = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
             ".svg": "image/svg+xml", ".webp": "image/webp", ".gif": "image/gif"}


def read(path):
    with open(path, "rb") as fh:
        return fh.read().decode("utf-8")


def warn(msg):
    print(f"[warn] {msg}", file=sys.stderr)


def data_uri(path):
    ext = os.path.splitext(path)[1].lower()
    mime = ASSET_EXT.get(ext, "application/octet-stream")
    with open(path, "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode("ascii")
    return f"data:{mime};base64,{b64}", len(b64)


def collect_asset_map():
    """Map 'assets/...' relative URL -> data URI for small images referenced by CSS/JS."""
    amap = {}
    if not os.path.isdir(ASSETS):
        return amap
    for dirpath, _dirs, files in os.walk(ASSETS):
        for f in sorted(files):
            abs_path = os.path.join(dirpath, f)
            rel = os.path.relpath(abs_path, WEB).replace("\\", "/")
            ext = os.path.splitext(f)[1].lower()
            if ext not in ASSET_EXT:
                continue
            if os.path.getsize(abs_path) > 512 * 1024:
                warn(f"asset too large to inline, skipped: {rel}")
                continue
            uri, _ = data_uri(abs_path)
            amap[rel] = uri
    return amap


def inline_assets(text, amap):
    """Replace relative asset paths with data: URIs (safe inside quotes/url())."""
    for rel, uri in sorted(amap.items(), key=lambda kv: -len(kv[0])):
        text = text.replace(rel, uri)
    return text


def _ignore_web_data(dirpath, names):
    """Skip web/data (raw CIF sources, already embedded in js/data/library.js)
    and web/dev (developer-only demo pages) but keep web/js/data/library.js."""
    ignored = []
    for n in names:
        full = os.path.abspath(os.path.join(dirpath, n))
        if full == os.path.abspath(os.path.join(WEB, "data")):
            ignored.append(n)
        elif full == os.path.abspath(os.path.join(WEB, "dev")):
            ignored.append(n)
    return ignored


def build_folder():
    if os.path.isdir(PREVIEW):
        shutil.rmtree(PREVIEW)
    shutil.copytree(WEB, PREVIEW, ignore=_ignore_web_data)
    # app metadata
    meta = {
        "app": "CrystalLens",
        "version": "1.1.0",
        "build": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "mode": "preview",
    }
    with open(os.path.join(PREVIEW, "build.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    total = 0
    for dirpath, _d, files in os.walk(PREVIEW):
        total += sum(os.path.getsize(os.path.join(dirpath, f)) for f in files)
    print(f"[ok] folder build -> {PREVIEW} ({total} bytes)")
    return PREVIEW


CSS_LINK_RE = re.compile(r'<link[^>]+rel=["\']stylesheet["\'][^>]*href=["\']([^"\']+)["\'][^>]*>', re.I)
SCRIPT_RE = re.compile(r'<script[^>]+src=["\']([^"\']+)["\'][^>]*>\s*</script>', re.I)


def build_single():
    index_path = os.path.join(WEB, "index.html")
    htmltext = read(index_path)
    amap = collect_asset_map()

    # 1) inline stylesheets
    def css_repl(m):
        href = m.group(1)
        path = os.path.normpath(os.path.join(WEB, href))
        if not os.path.exists(path):
            warn(f"CSS missing: {href}")
            return m.group(0)
        css = inline_assets(read(path), amap)
        return "<style>\n" + css + "\n</style>"

    htmltext = CSS_LINK_RE.sub(css_repl, htmltext)

    # 2) inline scripts in document order
    def script_repl(m):
        src = m.group(1)
        path = os.path.normpath(os.path.join(WEB, src))
        if not os.path.exists(path):
            warn(f"script missing: {src}")
            return m.group(0)
        js = inline_assets(read(path), amap)
        # guard against '</script>' inside strings
        js = js.replace("</script>", "<\\/script>")
        return '<script data-src="' + html.escape(src) + '">\n' + js + "\n</script>"

    htmltext = SCRIPT_RE.sub(script_repl, htmltext)

    # 3) remaining asset URL references in the html itself
    htmltext = inline_assets(htmltext, amap)

    # 3b) inject CL.assets (data URIs) before the first application script, so the
    # UI can reference the logo/icon without network/file access from file://.
    def asset_uri(rel):
        return amap.get(rel, "")

    assets_js = "window.CL = window.CL || {};(window.CL.assets = {"
    assets_js += "logo: %s," % json.dumps(asset_uri("assets/logo.png"))
    assets_js += "icon32: %s," % json.dumps(asset_uri("assets/icons/icon-favicon-32.png"))
    assets_js += "icon192: %s," % json.dumps(asset_uri("assets/icons/icon-192.png"))
    assets_js += "icon512: %s" % json.dumps(asset_uri("assets/icons/icon-512.png"))
    assets_js += "});"
    first_script = htmltext.find("<script")
    if first_script >= 0:
        htmltext = (htmltext[:first_script]
                    + "<script>/* CL.assets inlined by tools/build_web.py */\n" + assets_js + "\n</script>\n"
                    + htmltext[first_script:])
    else:
        warn("no <script> tag found; CL.assets not injected")

    # 3c) self-contained validation: no remaining local script/style references
    # (match only real attributes, not the data-src markers we injected above)
    leftovers = re.findall(r'(?:^|\s)(?:src|href)=["\'](?!data:|https?:|#|mailto:)([^"\']+)["\']', htmltext)
    leftovers = [x for x in leftovers if not x.startswith("assets/")]
    if leftovers:
        warn("single-file build still references local files: " + ", ".join(sorted(set(leftovers))[:10]))
    # 3d) sanity: the embedded crystal library must be present
    if not re.search(r"CL\.data\.library\s*=", htmltext):
        warn("single-file build does not contain the embedded crystal library (CL.data.library)")

    # 4) build metadata + offline banner
    htmltext = htmltext.replace(
        "</head>",
        "  <meta name=\"crystallens-build\" content=\"preview "
        + datetime.datetime.now().astimezone().isoformat(timespec="seconds") + "\">\n</head>",
    )
    os.makedirs(DIST, exist_ok=True)
    with open(SINGLE, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(htmltext)
    print(f"[ok] single-file preview -> {SINGLE} ({os.path.getsize(SINGLE)} bytes)")
    return SINGLE


def main():
    no_single = "--no-single" in sys.argv
    missing = [f for f in REQUIRED_FILES if not os.path.exists(os.path.join(WEB, f))]
    if missing:
        warn("missing expected files: " + ", ".join(missing))
    build_folder()
    if not no_single:
        build_single()


if __name__ == "__main__":
    main()
