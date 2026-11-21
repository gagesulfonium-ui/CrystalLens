#!/usr/bin/env python3
"""Generate web/js/data/library.js: embed the offline crystal library, bundled
examples and app metadata as plain JS data (no fetch/XHR, works from file://).

Inputs:
  web/data/library/*.cif          (copied from the original v1.1.0 release)
  web/data/library/index.tsv
  web/data/examples/*
  docs/spec/library.json          (metadata produced by the spec-assets agent)
  docs/spec/i18n.json             (optional; not used here)

Output:
  web/js/data/library.js          (CL.data.library / CL.data.examples / CL.data.app)

The script is deterministic and idempotent.
"""
import hashlib
import json
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
DATA = os.path.join(WEB, "data")
OUT = os.path.join(WEB, "js", "data", "library.js")
SPEC = os.path.join(ROOT, "docs", "spec")

APP_VERSION = "1.1.0"


def read_text(path):
    with open(path, "rb") as fh:
        raw = fh.read()
    for enc in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_metadata():
    path = os.path.join(SPEC, "library.json")
    if not os.path.exists(path):
        print(f"[warn] {path} missing; falling back to filename metadata", file=sys.stderr)
        return {}, {}
    with open(path, "r", encoding="utf-8") as fh:
        meta = json.load(fh)
    if isinstance(meta, list):
        lib = meta
        examples = []
    else:
        lib = meta.get("library") or meta.get("entries") or meta.get("crystals") or []
        examples = meta.get("examples") or []
    by_file = {}
    for entry in lib:
        fname = entry.get("file") or ""
        by_file[os.path.basename(fname)] = entry
    ex_by_file = {}
    for entry in examples:
        fname = entry.get("file") or ""
        ex_by_file[os.path.basename(fname)] = entry
    return by_file, examples, ex_by_file


def pretty_title(fname):
    stem = os.path.splitext(os.path.basename(fname))[0]
    return stem[:1].upper() + stem[1:]


def cif_summary(text):
    """Cheap CIF field probe for metadata fallback."""
    out = {}

    def grab(tag):
        m = re.search(r"^" + re.escape(tag) + r"\s+(?:'([^']*)'|\"([^\"]*)\"|(\S+))", text, re.M)
        if not m:
            return None
        return next((g for g in m.groups() if g is not None), None)

    def num(tag):
        v = grab(tag)
        try:
            return float(re.sub(r"\(.*?\)", "", v)) if v else None
        except (TypeError, ValueError):
            return None

    out["formula"] = grab("_chemical_formula_sum")
    out["title"] = grab("_chemical_name_common") or grab("_chemical_name_systematic")
    out["spaceGroup"] = grab("_space_group_name_H-M_alt") or grab("_symmetry_space_group_name_H-M")
    cell = {}
    for key in ("a", "b", "c", "alpha", "beta", "gamma"):
        cell[key] = num(f"_cell_length_{key}" if key in "abc" else f"_cell_angle_{key}")
    out["cell"] = cell
    return out


def main():
    entries = []
    by_file, lib_meta, ex_meta = load_metadata()

    lib_dir = os.path.join(DATA, "library")
    files = sorted(f for f in os.listdir(lib_dir) if f.lower().endswith(".cif")) if os.path.isdir(lib_dir) else []
    if not files:
        print(f"[error] no CIF files under {lib_dir}; run spec-assets copy first", file=sys.stderr)

    for fname in files:
        path = os.path.join(lib_dir, fname)
        text = read_text(path)
        meta = by_file.get(fname, {})
        probe = cif_summary(text)
        entry = {
            "id": meta.get("id") or os.path.splitext(fname)[0],
            "file": fname,
            "kind": "crystal",
            "titleZh": meta.get("titleZh") or probe.get("title") or pretty_title(fname),
            "titleEn": meta.get("titleEn") or probe.get("title") or pretty_title(fname),
            "formula": meta.get("formula") or probe.get("formula") or "",
            "spaceGroup": meta.get("spaceGroup") or probe.get("spaceGroup") or "",
            "sourceId": meta.get("sourceId") or "",
            "sourceNote": meta.get("sourceNote") or "",
            "size": len(text.encode("utf-8")),
            "sha256": sha256(text),
            "text": text,
        }
        if meta.get("cell"):
            entry["cell"] = meta["cell"]
        elif any(v is not None for v in probe.get("cell", {}).values()):
            entry["cell"] = probe["cell"]
        else:
            entry["cell"] = {}
        entries.append(entry)
    # order: metadata order first (matches the shipped library listing), then extras
    order = {os.path.basename(f): i for i, f in enumerate(by_file.keys())}
    entries.sort(key=lambda e: (order.get(e["file"], 10_000), e["id"]))

    examples = []
    ex_dir = os.path.join(DATA, "examples")
    ex_files = sorted(f for f in os.listdir(ex_dir) if os.path.isfile(os.path.join(ex_dir, f))) if os.path.isdir(ex_dir) else []
    for fname in ex_files:
        if fname.startswith("."):
            continue
        text = read_text(os.path.join(ex_dir, fname))
        meta = ex_meta.get(fname, {})
        ext = os.path.splitext(fname)[1].lower()
        fmt = {".cif": "cif", ".xyz": "xyz", ".vesta": "vesta", ".txt": "text"}.get(ext, "text")
        examples.append({
            "file": fname,
            "kind": "example",
            "format": meta.get("format") or fmt,
            "titleZh": meta.get("titleZh") or pretty_title(fname),
            "titleEn": meta.get("titleEn") or pretty_title(fname),
            "formula": meta.get("formula") or "",
            "note": meta.get("note") or "",
            "size": len(text.encode("utf-8")),
            "sha256": sha256(text),
            "text": text,
        })

    payload = {
        "app": {
            "name": "CrystalLens",
            "version": APP_VERSION,
            "versionCode": 110,
            "sourceVersion": "CrystalLens v1.1.0 (C++/Win32/OpenGL 3.3)",
            "license": "MIT",
            "builtAt": "",  # filled by build_web.py
        },
        "library": [{k: v for k, v in e.items() if k != "text"} for e in entries],
        "examples": [{k: v for k, v in e.items() if k != "text"} for e in examples],
    }

    lines = []
    lines.append("/* GENERATED FILE - do not edit. Produced by tools/gen_library.py */")
    lines.append("(function (root) {")
    lines.append("  'use strict';")
    lines.append("  var CL = root.CL = root.CL || {};")
    lines.append("  CL.data = CL.data || {};")
    lines.append("  CL.data.app = " + json.dumps(payload["app"], ensure_ascii=False, indent=2) + ";")
    lines.append("  CL.data.library = [")
    for e in entries:
        head = {k: v for k, v in e.items() if k != "text"}
        lines.append("    Object.assign(" + json.dumps(head, ensure_ascii=False) + ", {")
        lines.append("      text: " + json.dumps(e["text"], ensure_ascii=False) + " }),")
    lines.append("  ];")
    lines.append("  CL.data.examples = [")
    for e in examples:
        head = {k: v for k, v in e.items() if k != "text"}
        lines.append("    Object.assign(" + json.dumps(head, ensure_ascii=False) + ", {")
        lines.append("      text: " + json.dumps(e["text"], ensure_ascii=False) + " }),")
    lines.append("  ];")
    lines.append("  CL.data.summary = { library: CL.data.library.length, examples: CL.data.examples.length };")
    lines.append("})(typeof globalThis !== 'undefined' ? globalThis : this);")
    lines.append("")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines))

    # machine-readable report for QA
    report = {
        "generated": OUT,
        "libraryCount": len(entries),
        "exampleCount": len(examples),
        "totalBytes": sum(e["size"] for e in entries) + sum(e["size"] for e in examples),
        "library": [{"id": e["id"], "file": e["file"], "titleZh": e["titleZh"],
                     "formula": e["formula"], "sha256": e["sha256"]} for e in entries],
        "examples": [{"file": e["file"], "titleZh": e["titleZh"], "sha256": e["sha256"]} for e in examples],
    }
    rep_path = os.path.join(ROOT, "tests", "fixtures", "library-embed-report.json")
    os.makedirs(os.path.dirname(rep_path), exist_ok=True)
    with open(rep_path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    print(f"[ok] {OUT}: {len(entries)} crystal(s), {len(examples)} example(s), "
          f"{os.path.getsize(OUT)} bytes")
    for e in entries:
        print(f"     - {e['id']:<12} {e['titleZh']:<8} {e['formula']:<12} {e['size']:>6} B")
    for e in examples:
        print(f"     - ex {e['file']:<16} {e['format']:<6} {e['size']:>6} B")


if __name__ == "__main__":
    main()
