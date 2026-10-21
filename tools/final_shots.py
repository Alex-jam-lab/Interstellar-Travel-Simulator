import os
import sys
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

URL = os.environ.get("URL", "http://127.0.0.1:4173/")
OUT = "shots"
os.makedirs(OUT, exist_ok=True)
logs = []


def snap(page, name, wait_ms=7000):
    page.wait_for_timeout(wait_ms)
    page.evaluate("window.__wormhole.pause()")
    page.wait_for_timeout(1600)
    page.screenshot(path=os.path.join(OUT, name), timeout=120000)
    print("captured", name)
    page.evaluate("window.__wormhole.resume()")


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--disable-gpu-sandbox", "--ignore-gpu-blocklist"],
        )
        page = browser.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
        page.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
        page.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
        page.goto(URL, wait_until="networkidle", timeout=60000)
        page.wait_for_function("!!window.__wormhole", timeout=30000)
        page.wait_for_timeout(3000)
        page.evaluate("window.__wormhole.pause()")
        page.wait_for_timeout(1500)
        page.screenshot(path=os.path.join(OUT, "final-intro.png"), timeout=120000)
        print("captured final-intro.png")
        page.evaluate("window.__wormhole.resume()")

        page.click("#startBtn")
        page.wait_for_timeout(1500)
        page.evaluate("window.__wormhole.jump(0.26)")
        snap(page, "final-approach.png", 8000)

        page.evaluate("window.__wormhole.jump(0.48)")
        snap(page, "final-throat.png", 8000)

        page.evaluate("window.__wormhole.jump(0.9)")
        snap(page, "final-emergence.png", 8000)

        # 参数面板
        page.click("#paramsToggle")
        snap(page, "final-params.png", 1200)
        page.click("#paramsClose")

        # 移动端
        page.set_viewport_size({"width": 390, "height": 844})
        page.evaluate("window.__wormhole.jump(0.26)")
        snap(page, "final-mobile.png", 7000)

        print("snapshot:", page.evaluate("window.__wormhole.snapshot()"))
        print("errors:", [line for line in logs if "error" in line.lower()])
        browser.close()


if __name__ == "__main__":
    run()
