// Runs in <head>, before any content is parsed, so the window never flashes the
// wrong theme. The preload script resolves the saved theme synchronously.
(function () {
    try {
        var theme = window.api && window.api.initialTheme;
        if (theme === 'light' || theme === 'dark') {
            document.documentElement.setAttribute('data-theme', theme);
        }
    } catch (e) {
        // Keep the default dark theme from the markup.
    }
})();
