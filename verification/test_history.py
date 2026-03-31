import os
from playwright.sync_api import sync_playwright

def test_history_xss():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(bypass_csp=True)
        page = context.new_page()

        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        page.on("pageerror", lambda err: print(f"PAGE ERROR: {err.message}"))

        url = "http://localhost:8080/index.html"

        # Malicious history item
        malicious_item = {
            "id": 12345,
            "sourceText": "Hello",
            "targetText": "Privet",
            "sourceLang": "<img src=x onerror='window.HISTORY_XSS=true'>",
            "targetLang": "Russian",
            "timestamp": "2023-01-01T00:00:00.000Z"
        }

        context.add_init_script(f"""
            window.api = {{
                getSettings: async () => ({{ apiKey: 'mock', hotkey: 'Ctrl+Shift+T', model: 'gemini-2.5-flash' }}),
                getHistory: async () => [{malicious_item}],
                getRecentLanguages: async () => [],
                registerHotkey: () => {{}},
                unregisterHotkey: () => {{}},
                translate: async () => ({{ success: true, translated: "mocked" }}),
                getRecentLanguages: async () => []
            }};
        """)

        try:
            page.route("https://fonts.googleapis.com/**", lambda route: route.abort())
            page.route("https://fonts.gstatic.com/**", lambda route: route.abort())

            page.goto(url, wait_until="commit", timeout=10000)
            page.wait_for_selector("#btn-history", timeout=5000)

            # Click history button to show history view
            page.click("#btn-history")

            # Wait for history list to be populated
            page.wait_for_selector(".history-item", timeout=5000)

            # Check for XSS
            page.wait_for_timeout(2000)
            is_executed = page.evaluate("window.HISTORY_XSS || false")

            page.screenshot(path="verification/history_xss_check.png")

            if is_executed:
                print("HISTORY XSS SUCCESSFUL: window.HISTORY_XSS is true")
            else:
                print("HISTORY XSS FAILED: window.HISTORY_XSS is false")

            history_html = page.inner_html("#history-list")
            print(f"History List HTML: {history_html}")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    test_history_xss()
