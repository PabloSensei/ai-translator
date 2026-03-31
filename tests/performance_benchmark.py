import http.server
import socketserver
import threading
import time
import os
import socket
from playwright.sync_api import sync_playwright

def get_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]

PORT = get_free_port()

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

def start_server():
    with socketserver.TCPServer(("", PORT), QuietHandler) as httpd:
        print(f"Serving at port {PORT}")
        httpd.serve_forever()

# Start server in a separate thread
server_thread = threading.Thread(target=start_server, daemon=True)
server_thread.start()

# Give the server a moment to start
time.sleep(2)

def run_benchmark():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Block external requests
        def handle_route(route):
            if "google" in route.request.url:
                route.abort()
            else:
                route.continue_()
        page.route("**/*", handle_route)

        # Navigate to the app, use wait_until="domcontentloaded" to avoid timeout on external fonts
        try:
            page.goto(f"http://localhost:{PORT}", wait_until="domcontentloaded", timeout=10000)
        except Exception as e:
            print(f"Navigation error (ignoring if DOM is ready): {e}")

        # Ensure globals exist or mock them
        page.evaluate("""
            if (typeof window.api === 'undefined') {
                window.api = {};
            }
        """)

        benchmark_script = """
        (async function benchmark() {
            const results = {};

            // 1. Benchmark buildDropdown
            const container = document.createElement('div');
            // Mock LANGUAGES if it doesn't exist (it should from renderer.js)
            const startBuild = performance.now();
            for (let i = 0; i < 100; i++) {
                buildDropdown(container, 'source');
            }
            const endBuild = performance.now();
            results.buildDropdown = (endBuild - startBuild) / 100;

            // 2. Benchmark renderRecentLanguages
            const recentCodes = ['en', 'ru', 'de', 'fr', 'es', 'uk', 'zh', 'ja', 'ko', 'ar'];
            const startRecent = performance.now();
            for (let i = 0; i < 100; i++) {
                renderRecentLanguages(recentCodes);
            }
            const endRecent = performance.now();
            results.renderRecentLanguages = (endRecent - startRecent) / 100;

            // 3. Benchmark loadHistory
            // Mock window.api.getHistory
            const mockHistory = [];
            for (let i = 0; i < 50; i++) {
                mockHistory.push({
                    id: i,
                    sourceText: 'Hello ' + i,
                    targetText: 'Привет ' + i,
                    sourceLang: 'English',
                    targetLang: 'Russian',
                    timestamp: new Date().toISOString()
                });
            }
            window.api.getHistory = () => Promise.resolve(mockHistory);

            const startHistory = performance.now();
            for (let i = 0; i < 20; i++) {
                await loadHistory();
            }
            const endHistory = performance.now();
            results.loadHistory = (endHistory - startHistory) / 20;

            return results;
        })()
        """

        results = page.evaluate(benchmark_script)
        print("--- Benchmark Results (ms per call) ---")
        print(f"buildDropdown: {results['buildDropdown']:.4f} ms")
        print(f"renderRecentLanguages: {results['renderRecentLanguages']:.4f} ms")
        print(f"loadHistory: {results['loadHistory']:.4f} ms")

        browser.close()

if __name__ == "__main__":
    run_benchmark()
