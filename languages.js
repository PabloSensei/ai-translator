/**
 * Supported languages. Loaded by the renderer as a plain <script> and required
 * by the main process, so both sides agree on the same codes.
 *
 * `name` is what the UI shows (the language's own name), `english` is what goes
 * into the prompt — models follow "Translate to Japanese" more reliably than
 * "Translate to 日本語".
 */

// 'auto' is source-only and always sits at the top of the source dropdown.
const AUTO_LANG = { code: 'auto', name: 'Detect language', english: 'auto', flag: '🌐' };

const LANGUAGES = [
    { code: 'en', name: 'English', english: 'English', flag: '🇬🇧' },
    { code: 'ru', name: 'Русский', english: 'Russian', flag: '🇷🇺' },
    { code: 'de', name: 'Deutsch', english: 'German', flag: '🇩🇪' },
    { code: 'fr', name: 'Français', english: 'French', flag: '🇫🇷' },
    { code: 'es', name: 'Español', english: 'Spanish', flag: '🇪🇸' },
    { code: 'it', name: 'Italiano', english: 'Italian', flag: '🇮🇹' },
    { code: 'pt', name: 'Português', english: 'Portuguese', flag: '🇵🇹' },
    { code: 'uk', name: 'Українська', english: 'Ukrainian', flag: '🇺🇦' },
    { code: 'pl', name: 'Polski', english: 'Polish', flag: '🇵🇱' },
    { code: 'cs', name: 'Čeština', english: 'Czech', flag: '🇨🇿' },
    { code: 'nl', name: 'Nederlands', english: 'Dutch', flag: '🇳🇱' },
    { code: 'sv', name: 'Svenska', english: 'Swedish', flag: '🇸🇪' },
    { code: 'da', name: 'Dansk', english: 'Danish', flag: '🇩🇰' },
    { code: 'fi', name: 'Suomi', english: 'Finnish', flag: '🇫🇮' },
    { code: 'no', name: 'Norsk', english: 'Norwegian', flag: '🇳🇴' },
    { code: 'zh', name: '中文', english: 'Chinese (Simplified)', flag: '🇨🇳' },
    { code: 'ja', name: '日本語', english: 'Japanese', flag: '🇯🇵' },
    { code: 'ko', name: '한국어', english: 'Korean', flag: '🇰🇷' },
    { code: 'ar', name: 'العربية', english: 'Arabic', flag: '🇸🇦' },
    { code: 'hi', name: 'हिन्दी', english: 'Hindi', flag: '🇮🇳' },
    { code: 'tr', name: 'Türkçe', english: 'Turkish', flag: '🇹🇷' },
    { code: 'el', name: 'Ελληνικά', english: 'Greek', flag: '🇬🇷' },
    { code: 'he', name: 'עברית', english: 'Hebrew', flag: '🇮🇱' },
    { code: 'th', name: 'ไทย', english: 'Thai', flag: '🇹🇭' },
    { code: 'vi', name: 'Tiếng Việt', english: 'Vietnamese', flag: '🇻🇳' },
    { code: 'id', name: 'Bahasa Indonesia', english: 'Indonesian', flag: '🇮🇩' },
    { code: 'ms', name: 'Bahasa Melayu', english: 'Malay', flag: '🇲🇾' },
    { code: 'ro', name: 'Română', english: 'Romanian', flag: '🇷🇴' },
    { code: 'hu', name: 'Magyar', english: 'Hungarian', flag: '🇭🇺' },
    { code: 'bg', name: 'Български', english: 'Bulgarian', flag: '🇧🇬' },
    { code: 'hr', name: 'Hrvatski', english: 'Croatian', flag: '🇭🇷' },
    { code: 'sk', name: 'Slovenčina', english: 'Slovak', flag: '🇸🇰' },
    { code: 'lt', name: 'Lietuvių', english: 'Lithuanian', flag: '🇱🇹' },
    { code: 'lv', name: 'Latviešu', english: 'Latvian', flag: '🇱🇻' },
    { code: 'et', name: 'Eesti', english: 'Estonian', flag: '🇪🇪' },
    { code: 'ka', name: 'ქართული', english: 'Georgian', flag: '🇬🇪' },
];

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AUTO_LANG, LANGUAGES };
}
