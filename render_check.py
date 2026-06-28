"""Capture three screenshots of the hero at t=0, t=360, t=720 ms
to verify the runner (a) is now baseline-aligned with the wheel and
(b) is cycling through distinct frames.

Run:  python render_check.py
"""

import asyncio, os, sys
from playwright.async_api import async_playwright

URL = "http://localhost:8765/"
OUT = os.path.dirname(os.path.abspath(__file__))

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 720},
            device_scale_factor=1,
        )
        page = await ctx.new_page()
        await page.goto(URL, wait_until="networkidle")
        # wait for sprite base64 to parse
        await page.wait_for_selector(".runner img.f0", state="attached")
        # capture the hero region only
        hero = page.locator(".scene").first
        # three samples across the 960ms cycle: t=0 (f0), t=360 (f3), t=720 (f6)
        for label, delay in (("initial", 0), ("mid", 360), ("later", 720)):
            await asyncio.sleep(delay / 1000 if label != "initial" else 0.05)
            await hero.screenshot(path=f"{OUT}/hero-{label}.png")
            print(f"captured hero-{label}.png at +{delay}ms")
        await browser.close()

asyncio.run(main())
