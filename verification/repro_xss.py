import os
from playwright.sync_api import sync_playwright

def test_xss_repro():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(bypass_csp=True)
        page = context.new_page()

        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        page.on("pageerror", lambda err: print(f"PAGE ERROR: {err.message}"))

        # Load file directly with NO navigation if possible, or use a very simple page
        # Actually, let's just use the file content and set it

        with open("index.html", "r") as f:
            html_content = f.read()

        # We need to serve styles.css and renderer.js too if we want it to work fully.
        # But if we use page.set_content, we might have issues with relative paths.

        # Let's try navigating to a dummy page and THEN setting content,
        # but that won't help with relative scripts.

        # Why is it timing out? Maybe some external resource?
        # <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        # Yes, fonts! The sandbox might not have internet access or it's slow.

        url = "http://localhost:8080/index.html"

        context.add_init_script("""
            window.api = {
                getSettings: async () => ({ apiKey: 'mock', hotkey: 'Ctrl+Shift+T', model: 'gemini-2.5-flash' }),
                getHistory: async () => [],
                getRecentLanguages: async () => [],
                registerHotkey: () => { console.log('registerHotkey called'); },
                unregisterHotkey: () => { console.log('unregisterHotkey called'); },
                translate: async () => ({ success: true, translated: "mocked" }),
                getRecentLanguages: async () => []
            };
        """)

        try:
            print(f"Navigating to {url}...")
            # Route to block fonts
            page.route("https://fonts.googleapis.com/**", lambda route: route.abort())
            page.route("https://fonts.gstatic.com/**", lambda route: route.abort())

            page.goto(url, wait_until="commit", timeout=10000)
            print("Navigation committed.")

            # Wait for some element to appear
            page.wait_for_selector("#source-text", timeout=5000)
            print("Element #source-text found.")

            # 1. Setup target text (must not be placeholder for swap to work)
            print("Setting up target text...")
            page.evaluate("""
                const targetText = document.getElementById('target-text');
                targetText.textContent = 'Existing Translation';
                // Remove placeholder if it exists inside
                const placeholder = targetText.querySelector('.placeholder');
                if (placeholder) {
                    console.log('Removing placeholder');
                    placeholder.remove();
                }
            """)

            # 2. Set malicious source text
            payload = '<img src=x onerror="window.XSS_EXECUTED=true">'
            print(f"Filling source text with payload: {payload}")
            page.fill("#source-text", payload)

            # 3. Click swap button
            print("Clicking swap button...")
            page.click("#swap-btn")

            # 4. Check if XSS executed
            print("Waiting for XSS execution...")
            page.wait_for_timeout(2000)

            is_executed = page.evaluate("window.XSS_EXECUTED || false")

            # 5. Capture screenshot
            page.screenshot(path="verification/xss_repro.png")

            if is_executed:
                print("XSS SUCCESSFUL: window.XSS_EXECUTED is true")
            else:
                print("XSS FAILED: window.XSS_EXECUTED is false")

            target_html = page.inner_html("#target-text")
            print(f"Target HTML: {target_html}")

        except Exception as e:
            print(f"Error during execution: {e}")
            page.screenshot(path="verification/error_screenshot.png")
        finally:
            browser.close()

if __name__ == "__main__":
    test_xss_repro()
