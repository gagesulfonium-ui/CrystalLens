#!/usr/bin/env python3
"""Serve the install-free preview over local HTTP (better than file:// for
testing on a phone over the LAN; the single-file HTML works without a server).

Usage:
  python tools/serve_preview.py [--dir dist/preview] [--port 8000] [--no-browser]

Prints every reachable URL (localhost + LAN IPv4) so an Android phone on the
same Wi-Fi network can open the preview without installing anything.
"""
import argparse
import functools
import http.server
import os
import socket
import socketserver
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def lan_ips():
    ips = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except OSError:
        pass
    # Fallback: UDP trick to find the primary outbound interface address.
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip not in ips and not ip.startswith("127."):
            ips.insert(0, ip)
    except OSError:
        pass
    return ips


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".cif": "text/plain; charset=utf-8",
        ".xyz": "text/plain; charset=utf-8",
        ".vesta": "text/plain; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.join(ROOT, "dist", "preview"))
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    directory = os.path.abspath(args.dir)
    if not os.path.exists(os.path.join(directory, "index.html")):
        print(f"[error] no index.html under {directory}; run: python tools/build_web.py", file=sys.stderr)
        return 1

    handler = functools.partial(Handler, directory=directory)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("0.0.0.0", args.port), handler) as httpd:
        httpd.daemon_threads = True
        print(f"[CrystalLens] serving {directory}")
        print(f"  local:  http://127.0.0.1:{args.port}/")
        for ip in lan_ips():
            print(f"  phone:  http://{ip}:{args.port}/   (same Wi-Fi, open in Chrome)")
        print("  single-file alternative: dist/CrystalLens-Android-Preview.html")
        print("  Ctrl+C to stop")
        if not args.no_browser:
            threading.Timer(0.8, lambda: webbrowser.open(f"http://127.0.0.1:{args.port}/")).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[stopped]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
