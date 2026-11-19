"""Bump the release number before pushing an update.

Raises VERSION in sw.js by one and stamps the same number on the CSS/JS links in index.html
(styles.css?v=N, app.js?v=N, ...), so a browser can never mix new HTML with old styles or code.
Usage: python scripts/bump-version.py
"""
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
sw = root / "sw.js"
text = sw.read_bytes().decode("utf-8")
n = int(re.search(r"streakorbust-v(\d+)", text).group(1)) + 1
sw.write_bytes(re.sub(r"streakorbust-v\d+", f"streakorbust-v{n}", text, count=1).encode("utf-8"))

index = root / "index.html"
html = index.read_bytes().decode("utf-8")
html = re.sub(r'(href="styles\.css)(\?v=\d+)?"', rf'\1?v={n}"', html)
html = re.sub(r'(src="(?:engine|net|app)\.js)(\?v=\d+)?"', rf'\1?v={n}"', html)
index.write_bytes(html.encode("utf-8"))
print(f"version {n}")
