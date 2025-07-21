# Technology Stack

## Platform & Framework
- **Chrome Extension**: Manifest V3 (latest Chrome extension API)
- **Target Browser**: Chrome 88+ compatibility
- **Architecture**: Service Worker + Popup + Options pages

## Core Technologies
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+)
- **Storage**: Chrome Storage API (sync storage for settings)
- **APIs**: Chrome Bookmarks API, Tabs API, Context Menus API
- **No external dependencies**: Pure vanilla implementation for performance

## Build System
- **No build process required**: Direct file loading for development
- **Development workflow**: Load unpacked extension in Chrome developer mode
- **No compilation step**: All files are directly executable

## File Structure
```
├── manifest.json          # Extension configuration
├── popup.html/js          # Main interface
├── options.html/js        # Settings page  
├── background.js          # Service worker
├── styles.css             # Global styles
└── icons/                 # Extension icons
```

## Development Commands
Since this is a pure client-side extension with no build process:

- **Load extension**: Chrome → Extensions → Developer mode → Load unpacked
- **Reload extension**: Click reload button in chrome://extensions
- **Debug popup**: Right-click extension icon → Inspect popup
- **Debug background**: chrome://extensions → Background page inspect
- **View logs**: Browser DevTools console

## Code Patterns
- **Class-based architecture**: Each major component uses ES6 classes
- **Async/await**: Modern promise handling throughout
- **Event-driven**: Extensive use of addEventListener patterns
- **Chrome API integration**: Proper error handling for all Chrome APIs
- **Storage management**: Sync storage for cross-device settings persistence