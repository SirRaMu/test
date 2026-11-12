#!/usr/bin/env python3
"""Baut die claude.ai-Artifact-Version des Trainers in einen Zielordner.

Die Artifact-Seite darf kein eigenes <html>/<head>/<body> haben und bindet das CSS
inline ein; die JS-Module werden als zusätzliche Dateien veröffentlicht.

Aufruf:  python3 schach/tools/build-artifact.py ZIELORDNER
"""
import pathlib
import re
import shutil
import sys

src = pathlib.Path(__file__).resolve().parent.parent
dst = pathlib.Path(sys.argv[1]).resolve()
if dst.exists():
    shutil.rmtree(dst)
(dst / "js").mkdir(parents=True)
(dst / "vendor").mkdir()

for f in (src / "js").glob("*.js"):
    shutil.copy(f, dst / "js" / f.name)
shutil.copy(src / "vendor" / "chess.js", dst / "vendor" / "chess.js")

html = (src / "index.html").read_text(encoding="utf-8")
head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)
css = (src / "style.css").read_text(encoding="utf-8")
keep = [l for l in head.splitlines() if re.search(r"<title>|claude:viewport|theme-color", l)]
page = "\n".join(keep) + "\n<style>\n" + css + "</style>\n" + body
(dst / "index.html").write_text(page, encoding="utf-8")
print(f"Artifact gebaut in {dst}")
