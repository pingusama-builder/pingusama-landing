"""Measure exact bounding boxes of wheel-wrap, runner-wrap, and runner
so we can compute where the runner's feet need to be to align with
the wheel circle's actual bottom edge."""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 720},
            device_scale_factor=1,
        )
        page = await ctx.new_page()
        await page.goto("http://localhost:8765/", wait_until="networkidle")
        await page.wait_for_selector(".runner img.f0", state="attached")
        # get bounding rects
        data = await page.evaluate("""() => {
            const r = (sel) => {
                const el = document.querySelector(sel);
                if (!el) return null;
                const b = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                return {top: b.top, bottom: b.bottom, left: b.left, right: b.right,
                        w: b.width, h: b.height,
                        ai: cs.alignItems, as: cs.alignSelf, flexEnd: cs.alignSelf};
            };
            // get SVG circle bottom via getBBox
            const svg = document.querySelector('.wheel-svg');
            const circle = svg.querySelector('circle[stroke="#8B6F47"]');
            const bbox = circle.getBBox();
            const ctm = circle.getCTM();
            const svgRect = svg.getBoundingClientRect();
            // circle's bottom in screen coords = svgRect.top + (bbox.y+bbox.height) * (svgRect.height/svg.viewBox.baseVal.height)
            const vbH = svg.viewBox.baseVal.height;
            const vbW = svg.viewBox.baseVal.width;
            const scaleY = svgRect.height / vbH;
            const scaleX = svgRect.width / vbW;
            const circleBottomScreen = svgRect.top + (bbox.y + bbox.height) * scaleY;
            const circleTopScreen = svgRect.top + bbox.y * scaleY;
            const circleLeftScreen = svgRect.left + bbox.x * scaleX;
            const circleRightScreen = svgRect.left + (bbox.x + bbox.width) * scaleX;
            return {
                scene: r('.scene'),
                wheel_wrap: r('.wheel-wrap'),
                wheel_svg: r('.wheel-svg'),
                runner_wrap: r('.runner-wrap'),
                runner: r('.runner'),
                circle_bbox_svg: {x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height},
                circle_screen: {top: circleTopScreen, bottom: circleBottomScreen,
                                 left: circleLeftScreen, right: circleRightScreen,
                                 svgRectTop: svgRect.top, svgRectBottom: svgRect.bottom,
                                 svgRectH: svgRect.height, vbH: vbH, scaleY: scaleY},
            };
        }""")
        for k, v in data.items():
            print(f"\n{k}:")
            for kk, vv in (v or {}).items():
                print(f"  {kk}: {vv}")
        # derived
        circle_bot = data['circle_screen']['bottom']
        runner_bot = data['runner_wrap']['bottom']
        print(f"\nrunner feet bottom: {runner_bot:.1f}")
        print(f"circle bottom: {circle_bot:.1f}")
        print(f"delta (runner - circle): {runner_bot - circle_bot:.1f}px (negative = runner above circle)")
        await browser.close()

asyncio.run(main())
