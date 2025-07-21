# Project Structure & Organization

## File Organization
The project follows a flat structure with clear separation of concerns:

```
├── manifest.json          # Extension metadata and permissions
├── popup.html             # Main popup interface
├── popup.js               # Popup logic and bookmark management
├── options.html           # Settings/preferences page
├── options.js             # Settings management logic
├── background.js          # Service worker for background tasks
├── styles.css             # Global styles for popup interface
├── icon-template.svg      # SVG template for generating icons
├── icon.js                # Icon generation utility
└── README.md              # Documentation (Chinese)
```

## Component Architecture

### Core Components
- **Popup Interface** (`popup.html/js`): Main user interaction point
- **Background Service** (`background.js`): Context menus, message handling, startup logic
- **Options Page** (`options.html/js`): User preferences and settings
- **Styling** (`styles.css`): Unified visual design system

### Key Classes & Patterns
- `QuickOpenSite` class: Main popup controller
- `BackgroundService` class: Service worker management
- `OptionsManager` class: Settings page controller

## Naming Conventions
- **Files**: kebab-case for HTML/CSS, camelCase for JS
- **Classes**: PascalCase (e.g., `QuickOpenSite`)
- **Methods**: camelCase with descriptive names
- **CSS classes**: kebab-case with BEM-like structure
- **IDs**: camelCase for JavaScript interaction

## Code Organization Patterns
- **Single responsibility**: Each file handles one primary concern
- **Event-driven architecture**: Heavy use of addEventListener patterns
- **Async/await**: Consistent promise handling
- **Error boundaries**: Try-catch blocks around Chrome API calls
- **State management**: Local state in classes, persistent state in Chrome storage

## UI Component Structure
- **Container-based layout**: Flex layouts with semantic containers
- **Component isolation**: Each UI component has dedicated CSS classes
- **State-driven styling**: CSS classes reflect application state
- **Responsive considerations**: Fixed popup width with flexible content

## Data Flow
1. **Bookmark loading**: Background → Chrome Bookmarks API → Popup display
2. **User interaction**: Popup → Background service → Chrome APIs
3. **Settings**: Options page → Chrome Storage → Background → Popup
4. **Search/filter**: Local state management within popup component