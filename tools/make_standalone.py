"""把两个单页构建分别内联成可直接双击打开的 HTML 文件。
用法：npm run standalone
输出：
  星际穿越-离线版.html
  米勒星-离线版.html
  dist/interstellar-standalone.html
  dist/miller-standalone.html
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

TASKS = [
    {
        "source": ROOT / "dist-standalone-index" / "index.html",
        "root_out": ROOT / "星际穿越-离线版.html",
        "dist_out": DIST / "interstellar-standalone.html",
        "replacements": {
            'href="./miller.html"': 'href="./米勒星-离线版.html"',
        },
    },
    {
        "source": ROOT / "dist-standalone-miller" / "miller.html",
        "root_out": ROOT / "米勒星-离线版.html",
        "dist_out": DIST / "miller-standalone.html",
        "replacements": {
            'href="./index.html"': 'href="./星际穿越-离线版.html"',
        },
    },
]


def inline_page(source: Path, replacements: dict[str, str]) -> str:
    html = source.read_text(encoding="utf-8")

    # 去掉 modulepreload：单文件里没有外链 chunk
    html = re.sub(r'<link[^>]+rel="modulepreload"[^>]*>', "", html)

    # 内联全部样式表
    def css_repl(match: re.Match[str]) -> str:
        href = match.group(1)
        css_path = source.parent / href.lstrip("./")
        css = css_path.read_text(encoding="utf-8")
        return f"<style>\n{css}\n</style>"

    html = re.sub(
        r'<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>',
        css_repl,
        html,
    )

    # 提取全部入口脚本，统一放到 </body> 前，避免 DOM 尚未构建时执行
    scripts = re.findall(r'<script[^>]+src="([^"]+)"[^>]*></script>', html)
    html = re.sub(r'<script[^>]+src="[^"]+"[^>]*></script>', "", html)
    chunks = []
    for src in scripts:
        js_path = source.parent / src.lstrip("./")
        js = js_path.read_text(encoding="utf-8").replace("</script>", "<\\/script>")
        chunks.append(js)
    inline_js = "\n".join(chunks)

    for old, new in replacements.items():
        html = html.replace(old, new)

    html = html.replace("</body>", f"<script>\n{inline_js}\n</script>\n</body>")
    return html


def main() -> None:
    DIST.mkdir(exist_ok=True)
    for task in TASKS:
        source = task["source"]
        if not source.exists():
            raise SystemExit(f"缺少构建产物：{source}，请先运行对应的 Vite 单页构建")
        html = inline_page(source, task["replacements"])
        for out in (task["root_out"], task["dist_out"]):
            out.write_text(html, encoding="utf-8")
            print(f"written: {out} ({out.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
