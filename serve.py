#!/usr/bin/env python3
"""Winziger lokaler Webserver, um den Finanzplaner zu starten.

Aufruf:  python3 serve.py [PORT]
Danach im Browser öffnen: http://localhost:PORT (Standard-Port: 8765)
"""
import http.server
import socketserver
import sys
import webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765

Handler = http.server.SimpleHTTPRequestHandler

if __name__ == "__main__":
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        url = f"http://localhost:{PORT}"
        print(f"Finanzplaner läuft auf {url} (zum Beenden: Strg+C)")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        httpd.serve_forever()
