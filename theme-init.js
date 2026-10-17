// Runs in <head>, before any content is parsed, so the window never flashes the
// wrong theme. The preload script resolves the saved theme synchronously.
(function () {
    try {
        var theme = window.api && window.api.initialTheme;
        if (theme === 'light' || theme === 'dark' || theme === 'glass') {
            document.documentElement.setAttribute('data-theme', theme);
        }
        // The glass theme over the system blur: the page itself stays clear.
        if (window.api && window.api.initialSeeThrough) {
            document.documentElement.setAttribute('data-see-through', '');
        }
    } catch (e) {
        // Keep the default dark theme from the markup.
    }
})();
