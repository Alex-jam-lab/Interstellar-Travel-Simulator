"""把 Vite 生产构建打包成可直接双击打开的单个 HTML 文件。
用法：python tools/make_standalone.py
输出：dist/interstellar-standalone.html
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
INDEX = DIST / "index.html"
OUT = DIST / "interstellar-standalone.html"
OUT_ROOT = ROOT / "星际穿越-离线版.html"


def inline_assets() -> None:
    html = INDEX.read_text(encoding="utf-8")

    # 内联 CSS
    def css_repl(match: re.Match[str]) -> str:
        href = match.group(1)
        path = DIST / href.lstrip("/")
        css = path.read_text(encoding="utf-8")
        return f"<style>\n{css}\n</style>"

    html = re.sub(
        r'<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>',
        css_repl,
        html,
    )

    # 取出 JS，稍后放到 </body> 前，避免在 DOM 尚未解析时执行
    js_match = re.search(r'<script[^>]+src="([^"]+)"[^>]*></script>', html)
    if not js_match:
        raise SystemExit("未找到构建产物中的 JS 入口")
    js_path = DIST / js_match.group(1).lstrip("/")
    js = js_path.read_text(encoding="utf-8").replace("</script>", "<\\/script>")
    html = html[: js_match.start()] + html[js_match.end() :]

    html = html.replace("</body>", f"<script>\n{js}\n</script>\n</body>")

    html = html.replace(
        "<title>星际穿越 · 虫洞穿梭</title>",
        "<title>星际穿越 · 虫洞穿梭（离线单文件）</title>",
    )
    OUT.write_text(html, encoding="utf-8")
    OUT_ROOT.write_text(html, encoding="utf-8")
    print(f"written: {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")
    print(f"written: {OUT_ROOT} ({OUT_ROOT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    inline_assets()
