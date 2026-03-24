// popup.js - 弹窗主要逻辑（依赖 shared.js 中的 BookmarkService）
class QuickOpenSite {
    constructor() {
        this.bookmarks = [];
        this.keyMapping = new Map();
        this.filteredBookmarks = [];
        this.selectedIndex = 0;
        this.settings = { openInNewTab: true, bookmarkFolder: '' };
        this.currentTabUrl = null;
        this._currentTabUrlFetched = false;

        this.initElements();
        this.initEventListeners();
        this.init();
    }

    async init() {
        await this.loadSettings();
        this.loadBookmarks();
        this.fetchCurrentTabUrl();
        this.autoFocusTimeout = setTimeout(() => {
            this.searchInput.focus();
        }, 1000);
    }

    initElements() {
        this.searchInput = document.getElementById('searchInput');
        this.searchIcon = document.querySelector('.search-icon');
        this.clearSearchBtn = document.getElementById('clearSearchBtn');
        this.bookmarksList = document.getElementById('bookmarksList');
        this.loading = document.getElementById('loading');
        this.emptyState = document.getElementById('emptyState');
        this.noResults = document.getElementById('noResults');
        this.addKeyInput = document.getElementById('addKeyInput');
        this.addBookmarkBtn = document.getElementById('addBookmarkBtn');
        this.popover = document.getElementById('availableKeysPopover');
        this.popoverContent = document.getElementById('popoverContent');
        this.tooltip = document.getElementById('customTooltip');
        this.settingsBtn = document.getElementById('settingsBtn');
        this.dashboardBtn = document.getElementById('dashboardBtn');
        this.hidePopoverTimeout = null;
        this.searchTimeout = null;
        this.filterDebounceTimeout = null;
        this.tooltipTimeout = null;
        this.autoFocusTimeout = null;
    }

    initEventListeners() {
        this.searchInput.addEventListener('input', (e) => {
            const value = e.target.value;
            this.toggleClearButton(value);
            clearTimeout(this.filterDebounceTimeout);
            this.filterDebounceTimeout = setTimeout(() => {
                this.filterBookmarks(value);
                this.handleSearchAutoSelect(value);
            }, 250);
        });

        this.searchIcon.addEventListener('click', () => {
            this.searchInput.focus();
            this.filterBookmarks(this.searchInput.value);
        });

        this.clearSearchBtn.addEventListener('click', () => this.clearSearch());
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        this.searchInput.addEventListener('contextmenu', (e) => e.stopPropagation());
        this.addBookmarkBtn.addEventListener('click', () => this.addCurrentPageAsBookmark());

        this.settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            chrome.runtime.openOptionsPage();
        });

        this.dashboardBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
        });

        const setupPopoverEvents = (input) => {
            input.addEventListener('focus', () => {
                clearTimeout(this.hidePopoverTimeout);
                const currentKey = (input === this.addKeyInput) ? null : input.closest('.bookmark-item').__bookmarkData.key;
                this.updateAvailableKeysPopover(currentKey);
                this.popover.style.display = 'block';
            });
            input.addEventListener('blur', () => {
                this.hidePopoverTimeout = setTimeout(() => {
                    this.popover.style.display = 'none';
                }, 150);
            });
        };

        setupPopoverEvents(this.addKeyInput);
        this.popover.addEventListener('mousedown', (e) => e.preventDefault());

        window.addEventListener('beforeunload', () => this.hideTooltip());
        this.bookmarksList.addEventListener('scroll', () => this.hideTooltip());

        chrome.storage.onChanged.addListener((changes) => {
            if (changes.openInNewTab || changes.bookmarkFolder) {
                this.loadSettings().then(() => this.loadBookmarks());
            }
        });
    }

    initPopoverEventsForInput(input) {
        input.addEventListener('focus', () => {
            clearTimeout(this.hidePopoverTimeout);
            const bookmarkItem = input.closest('.bookmark-item');
            const currentKey = bookmarkItem ? bookmarkItem.__bookmarkData.key : null;
            this.updateAvailableKeysPopover(currentKey);
            this.popover.style.display = 'block';
        });
        input.addEventListener('blur', () => {
            this.hidePopoverTimeout = setTimeout(() => {
                this.popover.style.display = 'none';
            }, 150);
        });
    }

    async loadSettings() {
        this.settings = await BookmarkService.loadSettings();
    }

    async loadBookmarks() {
        this.showLoading(true);
        try {
            const { bookmarks, keyMapping } = await BookmarkService.loadBookmarks(this.settings);
            this.bookmarks = bookmarks;
            this.keyMapping = keyMapping;
            this.filterBookmarks(this.searchInput.value);
        } catch (error) {
            console.error('加载书签失败:', error);
            this.showEmptyState();
        } finally {
            this.showLoading(false);
        }
    }

    matchSubsequence(text, query) {
        if (!query) return true;
        if (!text) return false;
        const lowerText = text.toLowerCase();
        let queryIndex = 0;
        for (let i = 0; i < lowerText.length && queryIndex < query.length; i++) {
            if (lowerText[i] === query[queryIndex]) queryIndex++;
        }
        return queryIndex === query.length;
    }

    matchBookmark(bookmark, lowerQuery) {
        return this.matchSubsequence(bookmark.displayTitle, lowerQuery) ||
               this.matchSubsequence(bookmark.url, lowerQuery) ||
               (bookmark.key && bookmark.key.includes(lowerQuery)) ||
               (bookmark.folder && this.matchSubsequence(bookmark.folder, lowerQuery));
    }

    filterBookmarks(query) {
        const lowerQuery = query.toLowerCase();
        if (lowerQuery.length === 1 && /[a-z0-9]/.test(lowerQuery)) {
            const exactMatches = this.keyMapping.get(lowerQuery) || [];
            const otherMatches = this.bookmarks.filter(bookmark =>
                !exactMatches.includes(bookmark) && this.matchBookmark(bookmark, lowerQuery)
            );
            this.filteredBookmarks = [...exactMatches, ...otherMatches];
        } else {
            this.filteredBookmarks = this.bookmarks.filter(bookmark =>
                this.matchBookmark(bookmark, lowerQuery)
            );
        }
        if (lowerQuery.length === 0) {
            const found = this.promoteCurrentUrlInFiltered();
            this.selectedIndex = found ? 0 : -1;
        } else {
            this.selectedIndex = 0;
        }
        this.renderBookmarks();
    }

    toggleClearButton(value) {
        this.clearSearchBtn.style.display = value.length > 0 ? 'flex' : 'none';
    }

    clearSearch() {
        this.searchInput.value = '';
        this.filterBookmarks('');
        this.toggleClearButton('');
        this.searchInput.focus();
        if (this.searchTimeout) clearTimeout(this.searchTimeout);
        if (this.filterDebounceTimeout) clearTimeout(this.filterDebounceTimeout);
        if (this.autoFocusTimeout) clearTimeout(this.autoFocusTimeout);
    }

    handleSearchAutoSelect(value) {
        if (this.searchTimeout) clearTimeout(this.searchTimeout);
        if (value.length > 0) {
            this.searchTimeout = setTimeout(() => {
                if (this.searchInput.value === value) {
                    this.searchInput.focus();
                    this.searchInput.select();
                }
            }, 2000);
        }
    }

    async fetchCurrentTabUrl() {
        try {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (activeTab && activeTab.url && !activeTab.url.startsWith('chrome://')) {
                this.currentTabUrl = activeTab.url;
                this._currentTabUrlFetched = true;
                if (this.searchInput && this.searchInput.value === '' && this.filteredBookmarks.length > 0) {
                    const found = this.promoteCurrentUrlInFiltered();
                    this.selectedIndex = found ? 0 : -1;
                    this.renderBookmarks();
                }
            }
        } catch (error) {
            console.error('获取当前标签页URL失败:', error);
        }
    }

    promoteCurrentUrlInFiltered() {
        if (!this.currentTabUrl || !Array.isArray(this.filteredBookmarks)) return false;
        const index = this.filteredBookmarks.findIndex(b => b.url === this.currentTabUrl);
        if (index > 0) {
            const [item] = this.filteredBookmarks.splice(index, 1);
            this.filteredBookmarks.unshift(item);
        }
        return index >= 0;
    }

    renderBookmarks() {
        this.hideTooltip();
        this.bookmarksList.textContent = '';
        if (this.filteredBookmarks.length === 0) {
            this.searchInput.value ? this.showNoResults() : this.showEmptyState();
            return;
        }
        this.bookmarksList.style.display = 'block';
        this.emptyState.style.display = 'none';
        this.noResults.style.display = 'none';
        this.filteredBookmarks.forEach((bookmark, index) => {
            const item = this.createBookmarkItem(bookmark, index);
            this.bookmarksList.appendChild(item);
        });
    }

    createBookmarkItem(bookmark, index) {
        const item = document.createElement('div');
        item.className = `bookmark-item ${index === this.selectedIndex ? 'highlighted' : ''}`;
        item.__bookmarkData = bookmark;
        item.appendChild(this.createBookmarkIcon(bookmark));
        item.appendChild(this.createBookmarkInfo(bookmark));
        item.appendChild(this.createActionsContainer(bookmark));
        item.addEventListener('click', () => this.openBookmark(bookmark));
        return item;
    }

    createBookmarkIcon(bookmark) {
        const iconElement = document.createElement('div');
        iconElement.className = 'bookmark-icon';

        const fallbackText = bookmark.displayTitle.charAt(0).toUpperCase();
        const textSpan = document.createElement('span');
        textSpan.className = 'icon-fallback';
        textSpan.textContent = fallbackText;
        iconElement.appendChild(textSpan);

        const img = new Image();
        img.className = 'icon-img';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.borderRadius = '4px';
        img.style.position = 'absolute';
        img.style.top = '0';
        img.style.left = '0';

        img.onload = () => {
            if (iconElement.parentNode) iconElement.classList.add('loaded');
        };
        img.onerror = () => {
            if (img.parentNode) img.remove();
        };

        img.src = BookmarkService.getFaviconUrl(bookmark.url);
        iconElement.appendChild(img);
        return iconElement;
    }

    createBookmarkInfo(bookmark) {
        const info = document.createElement('div');
        info.className = 'bookmark-info';

        const title = document.createElement('div');
        title.className = 'bookmark-title';
        title.textContent = bookmark.displayTitle;
        const fullPath = bookmark.folder ? `${bookmark.folder} \u203A ${bookmark.displayTitle}` : bookmark.displayTitle;
        this.setupTooltip(title, fullPath);

        const url = document.createElement('div');
        url.className = 'bookmark-url';
        url.textContent = BookmarkService.formatUrl(bookmark.url);
        this.setupTooltip(url, bookmark.url);

        info.appendChild(title);
        info.appendChild(url);
        return info;
    }

    createActionsContainer(bookmark) {
        const container = document.createElement('div');
        container.className = 'actions-container';
        const defaultActions = document.createElement('div');
        defaultActions.className = 'default-actions';
        if (bookmark.key) {
            const badge = document.createElement('div');
            badge.className = 'bookmark-key';
            badge.textContent = bookmark.key.toUpperCase();
            defaultActions.appendChild(badge);
            defaultActions.appendChild(this.createDeleteKeyButton(bookmark));
        }
        defaultActions.appendChild(this.createEditShortcutButton(bookmark));
        defaultActions.appendChild(this.createDeleteBookmarkButton(bookmark));
        container.appendChild(defaultActions);
        container.appendChild(this.createConfirmationControls(bookmark));
        container.appendChild(this.createEditShortcutForm(bookmark));
        return container;
    }

    createEditShortcutButton(bookmark) {
        const btn = document.createElement('button');
        btn.className = 'edit-shortcut-btn';
        btn.textContent = '\u270F\uFE0F';
        btn.title = bookmark.key ? '修改快捷键' : '添加快捷键';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentItem = e.currentTarget.closest('.bookmark-item');
            this.resetAllItemStates();
            currentItem.classList.add('is-editing-shortcut');
            const input = currentItem.querySelector('.edit-shortcut-input');
            input.focus();
            input.value = bookmark.key || '';
        });
        return btn;
    }

    createConfirmationControls(bookmark) {
        const controls = document.createElement('div');
        controls.className = 'confirmation-controls';
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'confirm-btn';
        confirmBtn.textContent = '\u2705';
        confirmBtn.title = '确认删除';
        confirmBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteBookmark(bookmark);
        });
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'cancel-btn';
        cancelBtn.textContent = '\u274C';
        cancelBtn.title = '取消';
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.currentTarget.closest('.bookmark-item').classList.remove('is-confirming-delete');
        });
        controls.appendChild(cancelBtn);
        controls.appendChild(confirmBtn);
        return controls;
    }

    createEditShortcutForm(bookmark) {
        const form = document.createElement('div');
        form.className = 'edit-shortcut-form';
        form.addEventListener('click', e => e.stopPropagation());
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 1;
        input.className = 'edit-shortcut-input';
        this.initPopoverEventsForInput(input);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.stopPropagation();
                this.updateBookmarkKey(bookmark, input.value);
            }
        });
        const saveBtn = document.createElement('button');
        saveBtn.className = 'confirm-btn';
        saveBtn.textContent = '\u2705';
        saveBtn.title = '保存';
        saveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.updateBookmarkKey(bookmark, input.value);
        });
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'cancel-btn';
        cancelBtn.textContent = '\u274C';
        cancelBtn.title = '取消';
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.currentTarget.closest('.bookmark-item').classList.remove('is-editing-shortcut');
        });
        form.appendChild(input);
        form.appendChild(saveBtn);
        form.appendChild(cancelBtn);
        return form;
    }

    createDeleteKeyButton(bookmark) {
        const btn = document.createElement('button');
        btn.className = 'delete-key-btn';
        btn.textContent = '\u232B';
        btn.title = '删除快捷键';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteBookmarkKey(bookmark);
        });
        return btn;
    }

    createDeleteBookmarkButton(bookmark) {
        const btn = document.createElement('button');
        btn.className = 'delete-bookmark-btn';
        btn.textContent = '\uD83D\uDDD1\uFE0F';
        btn.title = '删除书签';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentItem = e.currentTarget.closest('.bookmark-item');
            this.resetAllItemStates();
            currentItem.classList.add('is-confirming-delete');
        });
        return btn;
    }

    async deleteBookmarkKey(bookmark) {
        try {
            await BookmarkService.deleteBookmarkKey(bookmark);
            this.loadBookmarks();
        } catch (error) {
            console.error('删除快捷键失败:', error);
        }
    }

    async deleteBookmark(bookmark) {
        try {
            await BookmarkService.deleteBookmark(bookmark.id);
            this.loadBookmarks();
        } catch (error) {
            console.error('删除书签失败:', error);
        }
    }

    async updateBookmarkKey(bookmark, newKey) {
        try {
            const success = await BookmarkService.updateBookmarkKey(bookmark, newKey);
            if (success) this.loadBookmarks();
        } catch (error) {
            console.error('更新快捷键失败:', error);
        }
    }

    resetAllItemStates() {
        this.bookmarksList.querySelectorAll('.bookmark-item').forEach(item => {
            item.classList.remove('is-confirming-delete', 'is-editing-shortcut');
        });
    }

    updateAvailableKeysPopover(currentKeyToIgnore = null) {
        const allKeys = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
        const usedKeys = new Set(this.keyMapping.keys());
        if (currentKeyToIgnore) usedKeys.delete(currentKeyToIgnore);
        const availableKeys = allKeys.filter(key => !usedKeys.has(key));
        this.popoverContent.textContent = '';
        if (availableKeys.length === 0) {
            this.popoverContent.textContent = '所有快捷键已被占用。';
            return;
        }
        availableKeys.forEach(key => {
            const keyElement = document.createElement('div');
            keyElement.className = 'available-key';
            keyElement.textContent = key;
            keyElement.addEventListener('click', () => {
                const focusedItem = this.bookmarksList.querySelector('.is-editing-shortcut');
                const input = focusedItem ? focusedItem.querySelector('.edit-shortcut-input') : this.addKeyInput;
                input.value = key;
                input.focus();
            });
            this.popoverContent.appendChild(keyElement);
        });
    }

    isTextTruncated(element) {
        return element.scrollWidth > element.clientWidth;
    }

    setupTooltip(element, fullText) {
        let showTimeout = null;
        let currentElement = null;

        element.addEventListener('mouseenter', () => {
            currentElement = element;
            showTimeout = setTimeout(() => {
                if (currentElement === element && this.isTextTruncated(element)) {
                    this.showTooltip(element, fullText);
                }
            }, 50);
        });

        element.addEventListener('mouseleave', () => {
            currentElement = null;
            if (showTimeout) { clearTimeout(showTimeout); showTimeout = null; }
            this.hideTooltip();
        });
    }

    showTooltip(element, text) {
        this.tooltip.textContent = text;
        this.tooltip.style.display = 'block';
        this.positionTooltip(element);
        requestAnimationFrame(() => { this.tooltip.classList.add('show'); });
    }

    hideTooltip() {
        this.tooltip.classList.remove('show');
        setTimeout(() => {
            if (!this.tooltip.classList.contains('show')) {
                this.tooltip.style.display = 'none';
            }
        }, 100);
    }

    positionTooltip(element) {
        const tooltip = this.tooltip;
        const padding = 10;
        const arrowHeight = 12;
        const rect = element.getBoundingClientRect();
        const tooltipWidth = tooltip.offsetWidth || 300;
        const tooltipHeight = tooltip.offsetHeight || 50;

        let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
        let top = rect.top - tooltipHeight - padding - arrowHeight;

        if (left + tooltipWidth > window.innerWidth - padding) {
            left = window.innerWidth - tooltipWidth - padding;
        }
        if (left < padding) left = padding;

        if (top < padding) {
            top = rect.bottom + padding + arrowHeight;
            tooltip.classList.add('tooltip-below');
        } else {
            tooltip.classList.remove('tooltip-below');
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }

    handleKeyDown(e) {
        if (document.activeElement.tagName === 'INPUT' && (document.activeElement.id === 'addKeyInput' || document.activeElement.classList.contains('edit-shortcut-input'))) return;
        if (e.key === '`' && document.activeElement !== this.searchInput) {
            e.preventDefault();
            this.searchInput.focus();
            return;
        }
        if (document.activeElement === this.searchInput && e.key.length === 1 && !e.ctrlKey && !e.metaKey) return;

        switch (e.key) {
            case 'ArrowUp': e.preventDefault(); this.moveSelection(-1); break;
            case 'ArrowDown': e.preventDefault(); this.moveSelection(1); break;
            case 'Enter':
                e.preventDefault();
                if (this.filteredBookmarks[this.selectedIndex]) {
                    this.openBookmark(this.filteredBookmarks[this.selectedIndex]);
                }
                break;
            case 'Escape': window.close(); break;
            default:
                if (e.key.length === 1 && /[a-z0-9]/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                    const bookmarks = this.keyMapping.get(e.key.toLowerCase());
                    if (bookmarks && bookmarks.length > 0) {
                        e.preventDefault();
                        if (this.autoFocusTimeout) clearTimeout(this.autoFocusTimeout);
                        this.openBookmarks(bookmarks);
                    }
                }
        }
    }

    moveSelection(direction) {
        const len = this.filteredBookmarks.length;
        if (len === 0) return;
        if (this.selectedIndex === -1) {
            this.selectedIndex = direction > 0 ? 0 : len - 1;
        } else {
            this.selectedIndex = (this.selectedIndex + direction + len) % len;
        }
        this.updateSelection();
    }

    updateSelection() {
        const items = this.bookmarksList.querySelectorAll('.bookmark-item');
        items.forEach((item, index) => {
            item.classList.toggle('highlighted', index === this.selectedIndex);
        });
        if (items[this.selectedIndex]) {
            items[this.selectedIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    async openBookmark(bookmark, closeAfter = true) {
        try {
            if (this.autoFocusTimeout) clearTimeout(this.autoFocusTimeout);
            if (this.settings.openInNewTab) {
                await chrome.tabs.create({ url: bookmark.url });
            } else {
                const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                await chrome.tabs.update(activeTab.id, { url: bookmark.url });
            }
            BookmarkService.recordUsage(bookmark.id);
            if (closeAfter) window.close();
        } catch (error) {
            console.error('打开书签失败:', error);
        }
    }

    openBookmarks(bookmarks) {
        if (this.autoFocusTimeout) clearTimeout(this.autoFocusTimeout);
        bookmarks.forEach(bookmark => this.openBookmark(bookmark, false));
        window.close();
    }

    async addCurrentPageAsBookmark() {
        const key = this.addKeyInput.value.trim().toLowerCase();
        if (!key || !/^[a-z0-9]$/.test(key)) {
            this.addKeyInput.style.borderColor = 'red';
            setTimeout(() => { this.addKeyInput.style.borderColor = '#ddd'; }, 1000);
            return;
        }
        try {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!activeTab || !activeTab.url || activeTab.url.startsWith('chrome://')) return;
            await BookmarkService.addBookmarkWithKey(activeTab.url, activeTab.title, key, this.settings);
            this.addKeyInput.value = '';
            this.loadBookmarks();
        } catch (error) {
            console.error('添加书签失败:', error);
        }
    }

    showLoading(show) { this.loading.style.display = show ? 'flex' : 'none'; }
    showEmptyState() {
        this.loading.style.display = 'none';
        this.bookmarksList.style.display = 'none';
        this.emptyState.style.display = 'block';
        this.noResults.style.display = 'none';
    }
    showNoResults() {
        this.loading.style.display = 'none';
        this.bookmarksList.style.display = 'none';
        this.emptyState.style.display = 'none';
        this.noResults.style.display = 'block';
    }
}

document.addEventListener('DOMContentLoaded', () => new QuickOpenSite());
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'reload-bookmarks') window.location.reload();
});
