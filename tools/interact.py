import os
import sys
import json
import time
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

URL = os.environ.get("URL", "http://127.0.0.1:5173/")
logs = []

def snapshot(page):
    return page.evaluate("window.__wormhole.snapshot()")

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--enable-unsafe-swiftshader",
                "--use-angle=swiftshader",
                "--disable-gpu-sandbox",
                "--ignore-gpu-blocklist",
            ],
        )
        page = browser.new_page(viewport={"width": 1000, "height": 640}, device_scale_factor=1)
        page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: logs.append(f"[pageerror] {err}"))
        page.goto(URL, wait_until="networkidle", timeout=60000)
        try:
            page.wait_for_function("!!window.__wormhole", timeout=20000)
        except Exception:
            print("debug interface missing; console logs:")
            for line in logs:
                print(line[:2000])
            raise
        page.click("#startBtn")
        page.wait_for_timeout(2600)
        s0 = snapshot(page)
        print("after start:", json.dumps(s0, ensure_ascii=False))
        print("audio:", page.evaluate("(() => { const a = window.__wormhole.audio; return { ready: a.ready, state: a.ctx ? a.ctx.state : null, muted: a.muted, volume: a.volume }; })()"))

        # auto progression
        page.wait_for_timeout(1600)
        s1 = snapshot(page)
        print("auto progressed:", s0["journey"], "->", s1["journey"])

        # manual takeover via W
        page.keyboard.down("w")
        page.wait_for_timeout(900)
        page.keyboard.up("w")
        s2 = snapshot(page)
        print("manual:", page.evaluate("window.__wormhole.state.auto"), "stage", s2["stage"], "cam", s2["camera"])

        # boost
        page.keyboard.down("Shift")
        page.wait_for_timeout(450)
        boost_state = page.evaluate("({boost: window.__wormhole.state.boost, held: document.getElementById('boostBtn').className})")
        print("boost:", boost_state)
        page.keyboard.up("Shift")
        page.wait_for_timeout(200)

        # brake
        page.keyboard.down("Space")
        page.wait_for_timeout(300)
        print("brake:", page.evaluate("window.__wormhole.state.brake"))
        page.keyboard.up("Space")

        # drag look
        canvas = page.locator("#stage canvas")
        box = canvas.bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] / 2 + 160, box["y"] + box["height"] / 2 - 60, steps=8)
        page.mouse.up()
        page.wait_for_timeout(300)
        print("look:", page.evaluate("({yaw: window.__wormhole.input.lookYaw, pitch: window.__wormhole.input.lookPitch})"))

        # parameter panel
        page.click("#paramsToggle")
        page.wait_for_timeout(300)
        print("panel open:", page.evaluate("document.getElementById('paramsPanel').classList.contains('is-open')"))
        page.eval_on_selector(
            "#paramLens",
            "el => { el.value = 1.8; el.dispatchEvent(new Event('input', { bubbles: true })); }",
        )
        page.eval_on_selector(
            "#paramChroma",
            "el => { el.value = 1.1; el.dispatchEvent(new Event('input', { bubbles: true })); }",
        )
        page.eval_on_selector(
            "#paramThroat",
            "el => { el.value = 12; el.dispatchEvent(new Event('input', { bubbles: true })); }",
        )
        print("uniforms:", page.evaluate("({lens: window.__wormhole.sceneUniforms.uLens.value, chroma: window.__wormhole.sceneUniforms.uChroma.value, throat: window.__wormhole.sceneUniforms.uThroat.value})"))

        # mute
        page.click("#audioToggle")
        page.wait_for_timeout(250)
        print("muted:", page.evaluate("window.__wormhole.state.muted"))

        # close parameter panel before using bottom HUD
        page.click("#paramsClose")
        page.wait_for_timeout(300)

        # reset journey
        page.click("#resetBtn")
        page.wait_for_timeout(800)
        print("after reset:", page.evaluate("({journey: window.__wormhole.state.journey, auto: window.__wormhole.state.auto, stage: window.__wormhole.state.stage})"))

        # mobile viewport screenshot
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(900)
        page.evaluate("window.__wormhole.pause()")
        page.wait_for_timeout(300)
        os.makedirs("shots", exist_ok=True)
        page.screenshot(path="shots/06-mobile.png", timeout=60000)
        page.evaluate("window.__wormhole.resume()")
        print("mobile screenshot captured")

        print("--- console ---")
        for line in logs:
            print(line[:2000])
        browser.close()

if __name__ == "__main__":
    run()
