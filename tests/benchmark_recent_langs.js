
const LANGUAGES = [
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'ru', name: 'Russian', flag: '🇷🇺' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'it', name: 'Italiano', flag: '🇮🇹' },
    { code: 'pt', name: 'Português', flag: '🇵🇹' },
    { code: 'uk', name: 'Українська', flag: '🇺🇦' },
    { code: 'pl', name: 'Polski', flag: '🇵🇱' },
    { code: 'cs', name: 'Čeština', flag: '🇨🇿' },
    { code: 'nl', name: 'Nederlands', flag: '🇳🇱' },
    { code: 'sv', name: 'Svenska', flag: '🇸🇪' },
    { code: 'da', name: 'Dansk', flag: '🇩🇰' },
    { code: 'fi', name: 'Suomi', flag: '🇫🇮' },
    { code: 'no', name: 'Norsk', flag: '🇳🇴' },
    { code: 'zh', name: '中文', flag: '🇨🇳' },
    { code: 'ja', name: '日本語', flag: '🇯🇵' },
    { code: 'ko', name: '한국어', flag: '🇰🇷' },
    { code: 'ar', name: 'العربية', flag: '🇸🇦' },
    { code: 'hi', name: 'हिन्दी', flag: '🇮🇳' },
    { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
    { code: 'el', name: 'Ελληνικά', flag: '🇬🇷' },
    { code: 'he', name: 'עברית', flag: '🇮🇱' },
    { code: 'th', name: 'ไทย', flag: 'ไทย' },
    { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
    { code: 'id', name: 'Bahasa Indonesia', flag: '🇮🇩' },
    { code: 'ms', name: 'Bahasa Melayu', flag: '🇲🇾' },
    { code: 'ro', name: 'Română', flag: '🇷🇴' },
    { code: 'hu', name: 'Magyar', flag: '🇭🇺' },
    { code: 'bg', name: 'Български', flag: '🇧🇬' },
    { code: 'hr', name: 'Hrvatski', flag: '🇭🇷' },
    { code: 'sk', name: 'Slovenčina', flag: '🇸🇰' },
    { code: 'lt', name: 'Lietuvių', flag: '🇱🇹' },
    { code: 'lv', name: 'Latviešu', flag: '🇱🇻' },
    { code: 'et', name: 'Eesti', flag: '🇪🇪' },
    { code: 'ka', name: 'ქართული', flag: '🇬🇪' },
];

const recentCodes = ['en', 'ru', 'de', 'fr', 'es', 'uk', 'zh', 'ja', 'ko', 'ar'];

function benchmarkArrayFind(iterations) {
    let sum = 0;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        for (let j = 0; j < recentCodes.length - 1; j += 2) {
            const src = LANGUAGES.find(l => l.code === recentCodes[j]);
            const tgt = LANGUAGES.find(l => l.code === recentCodes[j + 1]);
            if (src && tgt) {
                sum++;
            }
        }
    }
    const end = performance.now();
    return { time: end - start, sum };
}

function benchmarkMapLookup(iterations) {
    const LANG_MAP = new Map(LANGUAGES.map(l => [l.code, l]));
    let sum = 0;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        for (let j = 0; j < recentCodes.length - 1; j += 2) {
            const src = LANG_MAP.get(recentCodes[j]);
            const tgt = LANG_MAP.get(recentCodes[j + 1]);
            if (src && tgt) {
                sum++;
            }
        }
    }
    const end = performance.now();
    return { time: end - start, sum };
}

const iterations = 100000;
console.log(`Running benchmark with ${iterations} iterations...`);

const arrayResult = benchmarkArrayFind(iterations);
console.log(`Array.find: ${arrayResult.time.toFixed(4)}ms (sum: ${arrayResult.sum})`);

const mapResult = benchmarkMapLookup(iterations);
console.log(`Map.get: ${mapResult.time.toFixed(4)}ms (sum: ${mapResult.sum})`);

const improvement = ((arrayResult.time - mapResult.time) / arrayResult.time * 100).toFixed(2);
console.log(`Improvement: ${improvement}%`);
