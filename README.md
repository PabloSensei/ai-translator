<div align="center">

<img src="assets/icon.png" width="128" height="128" alt="AI Translator Icon">

# ✦ AI Translator

**Desktop Translator powered by Google Gemini and OpenRouter**

*Fast, beautiful, and smart text translation supporting 30+ languages*

[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Gemini AI](https://img.shields.io/badge/Gemini-supported-4285F4?logo=google&logoColor=white)](https://ai.google.dev/)
[![OpenRouter](https://img.shields.io/badge/OpenRouter-supported-6366F1)](https://openrouter.ai/)
[![License: Non-Commercial](https://img.shields.io/badge/License-Non--Commercial-A855F7)](LICENSE)

[![Release](https://img.shields.io/github/v/release/PabloSensei/ai-translator)](https://github.com/PabloSensei/ai-translator/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/PabloSensei/ai-translator/total)](https://github.com/PabloSensei/ai-translator/releases)
[![Stars](https://img.shields.io/github/stars/PabloSensei/ai-translator)](https://github.com/PabloSensei/ai-translator/stargazers)
[![Build](https://github.com/PabloSensei/ai-translator/actions/workflows/release.yml/badge.svg)](https://github.com/PabloSensei/ai-translator/actions/workflows/release.yml)

</div>

---

## 🌟 Features

- 🌍 **30+ Languages** — supports translation between English, Russian, German, French, Spanish, Ukrainian, Chinese, Japanese, Korean, Arabic, and many other languages
- 🔎 **Automatic Language Detection** — leave the source set to *Detect language* and the model works it out
- 🛠️ **Translate / Fix text Modes** — one toggle switches between translating and correcting spelling and grammar in place
- 🎨 **10 Translation Styles + Custom** — formal, neutral, casual, technical, academic, creative, concise, simple, marketing and polite, plus your own saved styles
- 🌓 **Light, Dark & System Themes** — switch from the title bar or follow the OS theme
- ⚡ **Instant Translation** — use `Ctrl+Enter` or the "Translate" button
- 🔥 **Gemini & OpenRouter** — pick from the latest Gemini models (including Gemini 3.8 Flash), or plug in an OpenRouter key and choose from its whole catalogue
- 🔄 **Quick Language Swap** — the swap button instantly switches languages and text
- 📋 **Translation History** — automatically saves the last 100 translations
- ⌨️ **Global Hotkey** — summon the translator from any application (default `Ctrl+Shift+T`)
- 🎯 **Recent Language Pairs** — the quick-access row is built from the pairs you actually use
- 🔒 **System Tray** — runs in the background and is always at your fingertips
- 🔔 **Update Check** — see at a glance when a newer release is published

## 🖥️ Screenshots

<div align="center">

| Dark theme | Light theme |
|:---:|:---:|
| <img src="assets/screenshot-dark.png" width="420" alt="Main interface in the dark theme"> | <img src="assets/screenshot-light.png" width="420" alt="Main interface in the light theme"> |
| **Fix text mode** | **Settings** |
| <img src="assets/screenshot-fix.png" width="420" alt="Fix text mode correcting spelling and grammar"> | <img src="assets/screenshot-settings.png" width="420" alt="Settings with theme, provider and model options"> |

</div>

## 🚀 Installation

### Requirements

- [Node.js](https://nodejs.org/) 18+
- A [Google Gemini](https://aistudio.google.com/apikey) API key, or an [OpenRouter](https://openrouter.ai/keys) API key

### Pre-built Release (recommended)

Download the latest version from [Releases](https://github.com/PabloSensei/ai-translator/releases):

| Platform | Package |
|----------|---------|
| 🪟 **Windows** | `AI Translator Setup <version>.exe` |
| 🍏 **macOS** | `AI Translator-<version>-arm64.dmg` |
| 🐧 **Linux** | `AI Translator-<version>.AppImage` or `.deb` |

After downloading, install and launch — no Node.js or npm required.

### Build from Source

1. **Clone the repository:**

```bash
git clone https://github.com/pablosensei/ai-translator.git
cd ai-translator
```

2. **Install dependencies:**

```bash
npm install
```

3. **Run the application:**

```bash
npm start
```

4. **Configure your API Key:**
   - Click the ⚙️ icon in the top panel
   - Pick a provider — **Google Gemini** or **OpenRouter**
   - Paste the matching API key, then press *Refresh* / *Load models* to pick a model
   - Click "Save Settings"

## 📖 Usage

### Basic Translation
1. Pick the target language — leave the source on **Detect language** or choose one
2. Enter or paste text
3. Click **"Translate"** or press `Ctrl+Enter`

The row under the language bar shows the language pairs you used most recently — click one to restore it.

### Translate / Fix text
The toggle above the language bar switches between the two modes:

| Mode | What it does |
|------|--------------|
| 🌐 **Translate** | Translates from the source (or auto-detected) language into the target language |
| ✏️ **Fix text** | Corrects spelling, grammar, and punctuation **in the original language** — the target language is hidden |

The selected style applies in both modes, so *Fix text* + *Formal* also rewrites the text in a formal tone.

### Translation Styles
Switch style with one click:

| Style | Description |
|-------|-------------|
| 😊 **Neutral** | Standard translation, no tonal shift |
| 💼 **Formal** | Business, professional tone |
| 💬 **Casual** | Informal and friendly |
| 🔧 **Technical** | Keeps terminology, identifiers, and units intact |
| 🎓 **Academic** | Scholarly register, measured phrasing |
| ✨ **Creative** | Expressive and literary, preserves imagery |
| ✂️ **Concise** | Strips filler, keeps only the essentials |
| 🧒 **Simple** | Plain language, no jargon or idioms |
| 📣 **Marketing** | Persuasive, benefit-focused copy |
| 🙏 **Polite** | Especially courteous and diplomatic |

Press **+ Custom** to define your own: give it a name and an instruction (for example *"Use legal contract wording"*). Custom styles are saved and appear alongside the built-in ones; the `×` on a custom chip deletes it.

### Themes
Use the ☀️/🌙 button in the title bar to flip between light and dark, or pick **System** under Settings → Appearance to follow the OS theme.

### AI Providers

| Provider | Notes |
|----------|-------|
| **Google Gemini** | Ships with a curated list of current models; *Refresh* queries the API for every model your key can access |
| **OpenRouter** | Paste an OpenRouter key, press *Load models*, then filter and select any model in its catalogue |

Either way the picker only lists models that reply with text — image, audio, video, music and embedding models are filtered out, even though the APIs report many of them as usable.

### Updates
Settings → About → **Check for updates** compares your version against the latest GitHub release and links to the download page.

### Global Hotkey
- Default: `Ctrl+Shift+T`
- Configurable in the ⚙️ Settings section

### History
- All translations are saved automatically
- Click an entry to use it again
- Click 🕐 to view your history

## 🛠️ Technologies

| Technology | Purpose |
|-----------|-----------|
| [Electron](https://www.electronjs.org/) | Desktop application |
| [Google Gemini AI](https://ai.google.dev/) | Translation engine |
| [OpenRouter](https://openrouter.ai/) | Alternative model provider |
| [electron-store](https://github.com/sindresorhus/electron-store) | Storing settings and history |
| HTML/CSS/JS | Interface |

## 📁 Project Structure

```
ai-translator/
├── main.js          # Main Electron process, providers, updates, IPC
├── preload.js       # Preload script, bridge between main and renderer
├── renderer.js      # UI logic, interface management
├── index.html       # Interface layout
├── styles.css       # Application styles
├── package.json     # Dependencies and metadata
└── README.md        # Documentation
```

## ⚙️ Configuration

Settings are stored locally via `electron-store`:

| Parameter | Description | Default |
|---------|----------|-------------|
| `provider` | Active provider (`gemini` or `openrouter`) | `gemini` |
| `apiKey` | Google Gemini API key (encrypted at rest) | — |
| `openrouterApiKey` | OpenRouter API key (encrypted at rest) | — |
| `model` / `openrouterModel` | Selected model per provider | `gemini-2.5-flash` / — |
| `theme` | `dark`, `light`, or `system` | `dark` |
| `style` | Selected translation style | `neutral` |
| `customStyles` | Your own saved styles | `[]` |
| `hotkey` | Global Hotkey | `Ctrl+Shift+T` |
| `windowBounds` | Window Size | `860×640` |
| `recentPairs` | Recently used language pairs | `[]` |

## 🤝 Contributing

Contributions are welcome! Pull requests, bug reports, and suggestions are all welcome.

1. Fork the repository
2. Create a branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is available for **non-commercial use only**. You may freely use, copy, and modify the code for personal, educational, and non-commercial purposes.

**For commercial use** — please contact the author: [GitHub](https://github.com/pablosensei).

Details are in the [LICENSE](LICENSE) file.

---
