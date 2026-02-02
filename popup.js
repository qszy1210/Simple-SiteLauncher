// popup.js - 弹窗主要逻辑
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
        this.hidePopoverTimeout = null;
        this.searchTimeout = null;
        this.filterDebounceTimeout = null;
    }

    initEventListeners() {
        this.searchInput.addEventListener('input', (e) => {
            const value = e.target.value;
            this.toggleClearButton(value);
            
            // 防抖处理，避免频繁过滤
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
        try {
            const result = await chrome.storage.sync.get(['openInNewTab', 'bookmarkFolder']);
            this.settings.openInNewTab = result.openInNewTab !== undefined ? result.openInNewTab : true;
            this.settings.bookmarkFolder = result.bookmarkFolder || '';
        } catch (error) {
            console.error('加载设置失败:', error);
        }
    }

    async loadBookmarks() {
        this.showLoading(true);
        try {
            const bookmarkTree = await chrome.bookmarks.getTree();
            const folderName = this.settings.bookmarkFolder;
            
            if (folderName) {
                // 配置了特定文件夹，只查找该一级文件夹
                const targetFolder = this.findBookmarkFolder(bookmarkTree, folderName);
                if (targetFolder) {
                    const children = await chrome.bookmarks.getChildren(targetFolder.id);
                    this.bookmarks = await this.processBookmarkItems(children);
                } else {
                    this.bookmarks = [];
                }
            } else {
                // 未配置文件夹，加载全部书签
                this.bookmarks = await this.getAllBookmarks(bookmarkTree);
            }
            
            this.parseKeyMappings();
            // 按优先级排序书签
            this.bookmarks = this.sortBookmarksByPriority(this.bookmarks);
            // 使用 this.searchInput.value 来过滤书签
            this.filterBookmarks(this.searchInput.value);
        } catch (error) {
            console.error('加载书签失败:', error);
            this.showEmptyState();
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * 查找指定名称的一级书签文件夹
     * @param {Array} nodes - 书签树节点
     * @param {string} folderName - 要查找的文件夹名称
     * @returns {Object|null} - 找到的文件夹节点或null
     */
    findBookmarkFolder(nodes, folderName) {
        for (const node of nodes) {
            if (node.title === folderName && node.children) return node;
            if (node.children) {
                const found = this.findBookmarkFolder(node.children, folderName);
                if (found) return found;
            }
        }
        return null;
    }

    /**
     * 获取全部书签（当未配置特定文件夹时）
     * @param {Array} nodes - 书签树节点
     * @returns {Promise<Array>} - 所有书签的数组
     */
    async getAllBookmarks(nodes) {
        const bookmarks = [];
        
        const traverse = async (nodeList, parentFolder = null) => {
            for (const node of nodeList) {
                if (node.url) {
                    // 是书签
                    bookmarks.push({
                        id: node.id,
                        title: node.title,
                        url: node.url,
                        folder: parentFolder
                    });
                } else if (node.children) {
                    // 是文件夹，递归遍历
                    await traverse(node.children, node.title || parentFolder);
                }
            }
        };
        
        await traverse(nodes);
        return bookmarks;
    }

    async processBookmarkItems(items) {
        const bookmarkPromises = items.map(async (item) => {
            if (item.url) {
                return { id: item.id, title: item.title, url: item.url };
            } else {
                const subFolderChildren = await chrome.bookmarks.getChildren(item.id);
                return subFolderChildren
                    .filter(child => !!child.url)
                    .map(bookmark => ({
                        id: bookmark.id,
                        title: bookmark.title,
                        url: bookmark.url,
                        folder: item.title
                    }));
            }
        });
        const nestedBookmarks = await Promise.all(bookmarkPromises);
        return nestedBookmarks.flat();
    }

    parseKeyMappings() {
        this.keyMapping.clear();
        this.bookmarks.forEach(bookmark => {
            const match = bookmark.title.match(/\[([a-z0-9])\]/i);
            if (match) {
                const key = match[1].toLowerCase();
                bookmark.key = key;
                bookmark.displayTitle = bookmark.title.replace(/\s*\[[a-z0-9]\]/i, '').trim();
                if (!this.keyMapping.has(key)) this.keyMapping.set(key, []);
                this.keyMapping.get(key).push(bookmark);
            } else {
                bookmark.displayTitle = bookmark.title;
            }
        });
    }

    /**
     * 按优先级对网站进行排序
     * 1. 特殊配置的置顶内容（pinned: true）
     * 2. 有快捷键的内容按快捷键顺序升序排列
     * 3. 没有快捷键的内容按名称排序
     */
    sortBookmarksByPriority(bookmarkList) {
        // 创建副本避免修改原数组
        const bookmarks = [...bookmarkList];
        
        // 分组
        const pinnedBookmarks = [];
        const keyboardBookmarks = [];
        const normalBookmarks = [];
        
        bookmarks.forEach(bookmark => {
            if (bookmark.pinned) {
                pinnedBookmarks.push(bookmark);
            } else if (bookmark.key) {
                keyboardBookmarks.push(bookmark);
            } else {
                normalBookmarks.push(bookmark);
            }
        });
        
        // 对有快捷键的书签按快捷键排序（升序）
        keyboardBookmarks.sort((a, b) => {
            const shortcutA = a.key.toLowerCase();
            const shortcutB = b.key.toLowerCase();
            return shortcutA.localeCompare(shortcutB);
        });
        
        // 对没有快捷键的书签按名称排序
        normalBookmarks.sort((a, b) => {
            return a.displayTitle.localeCompare(b.displayTitle, 'zh-CN', { sensitivity: 'base' });
        });
        
        // 合并所有分组：置顶 -> 快捷键 -> 普通
        return [...pinnedBookmarks, ...keyboardBookmarks, ...normalBookmarks];
    }

    filterBookmarks(query) {
        const lowerQuery = query.toLowerCase();
        if (lowerQuery.length === 1 && /[a-z0-9]/.test(lowerQuery)) {
            const exactMatches = this.keyMapping.get(lowerQuery) || [];
            const otherMatches = this.bookmarks.filter(bookmark =>
                !exactMatches.includes(bookmark) &&
                (bookmark.displayTitle.toLowerCase().includes(lowerQuery) ||
                 bookmark.url.toLowerCase().includes(lowerQuery) ||
                 (bookmark.folder && bookmark.folder.toLowerCase().includes(lowerQuery)))
            );
            this.filteredBookmarks = [...exactMatches, ...otherMatches];
        } else {
            this.filteredBookmarks = this.bookmarks.filter(bookmark =>
                bookmark.displayTitle.toLowerCase().includes(lowerQuery) ||
                bookmark.url.toLowerCase().includes(lowerQuery) ||
                (bookmark.key && bookmark.key.includes(lowerQuery)) ||
                (bookmark.folder && bookmark.folder.toLowerCase().includes(lowerQuery))
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
    }

    handleSearchAutoSelect(value) {
        if (this.searchTimeout) clearTimeout(this.searchTimeout);
        if (value.length > 0) {
            this.searchTimeout = setTimeout(() => {
                if (this.searchInput.value === value) {
                    this.searchInput.focus();
                    this.searchInput.select();
                }
            }, 1000);
        }
    }

    async fetchCurrentTabUrl() {
        try {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (activeTab && activeTab.url && !activeTab.url.startsWith('chrome://')) {
                this.currentTabUrl = activeTab.url;
                this._currentTabUrlFetched = true;
                // 如果当前没有搜索条件，且已经有过滤结果，则尝试将当前页面置顶
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

    // 仅在没有查询条件时调用，将当前页对应的书签（若存在）移动到第一位
    // 返回值：是否找到当前页对应的书签（即使已在第一位也返回 true）
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
        this.bookmarksList.innerHTML = '';
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

    /**
     * 创建书签图标元素
     * 使用 Chrome 原生 _favicon API 获取网站图标
     * 
     * @param {Object} bookmark - 书签对象
     * @returns {HTMLElement} - 图标DOM元素
     */
    createBookmarkIcon(bookmark) {
        const iconElement = document.createElement('div');
        iconElement.className = 'bookmark-icon';

        // 生成首字母作为回退显示
        const fallbackText = bookmark.displayTitle.charAt(0).toUpperCase();
        iconElement.textContent = fallbackText;

        // 使用 Chrome 原生 _favicon API
        const img = new Image();
        const faviconUrl = chrome.runtime.getURL(
            `_favicon/?pageUrl=${encodeURIComponent(bookmark.url)}&size=32`
        );

        img.onload = () => {
            if (iconElement.parentNode) {
                iconElement.innerHTML = '';
                iconElement.appendChild(img);
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.borderRadius = '4px';
                iconElement.classList.add('loaded');
            }
        };

        img.onerror = () => {
            // 加载失败时保持首字母显示
            iconElement.textContent = fallbackText;
        };

        img.src = faviconUrl;
        return iconElement;
    }

    createBookmarkInfo(bookmark) {
        const info = document.createElement('div');
        info.className = 'bookmark-info';
        const title = document.createElement('div');
        title.className = 'bookmark-title';
        title.textContent = bookmark.folder ? `${bookmark.folder} › ${bookmark.displayTitle}` : bookmark.displayTitle;
        const url = document.createElement('div');
        url.className = 'bookmark-url';
        url.textContent = this.formatUrl(bookmark.url);
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
        btn.innerHTML = '✏️';
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
        confirmBtn.innerHTML = '✅';
        confirmBtn.title = '确认删除';
        confirmBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteBookmark(bookmark, true);
        });
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'cancel-btn';
        cancelBtn.innerHTML = '❌';
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
        saveBtn.innerHTML = '✅';
        saveBtn.title = '保存';
        saveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.updateBookmarkKey(bookmark, input.value);
        });
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'cancel-btn';
        cancelBtn.innerHTML = '❌';
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
        btn.innerHTML = '⌫';
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
        btn.innerHTML = '🗑️';
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
            await chrome.bookmarks.update(bookmark.id, { title: bookmark.displayTitle });
            this.loadBookmarks();
        } catch (error) {
            console.error('删除快捷键失败:', error);
        }
    }

    async deleteBookmark(bookmark, confirmed = false) {
        if (!confirmed) return;
        try {
            await chrome.bookmarks.remove(bookmark.id);
            this.loadBookmarks();
        } catch (error) {
            console.error('删除书签失败:', error);
        }
    }

    async updateBookmarkKey(bookmark, newKey) {
        const key = newKey.trim().toLowerCase();
        if (!key || !/^[a-z0-9]$/.test(key)) return;
        try {
            const newTitle = `${bookmark.displayTitle} [${key}]`;
            await chrome.bookmarks.update(bookmark.id, { title: newTitle });
            this.loadBookmarks();
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
        this.popoverContent.innerHTML = '';
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

    formatUrl(url) {
        try {
            return new URL(url).hostname;
        } catch {
            return url;
        }
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
            if (this.settings.openInNewTab) {
                await chrome.tabs.create({ url: bookmark.url });
            } else {
                const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                await chrome.tabs.update(activeTab.id, { url: bookmark.url });
            }
            if (closeAfter) window.close();
        } catch (error) {
            console.error('打开书签失败:', error);
        }
    }

    openBookmarks(bookmarks) {
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
            
            const folderName = this.settings.bookmarkFolder;
            let targetFolderId;
            
            if (folderName) {
                // 配置了特定文件夹，添加到该文件夹
                const targetFolder = this.findBookmarkFolder(await chrome.bookmarks.getTree(), folderName);
                if (!targetFolder) {
                    console.error('未找到配置的书签文件夹:', folderName);
                    this.showEmptyState();
                    return;
                }
                targetFolderId = targetFolder.id;
            } else {
                // 未配置文件夹，添加到书签栏（第一个根节点的第一个子节点）
                const bookmarkTree = await chrome.bookmarks.getTree();
                targetFolderId = bookmarkTree[0].children[0].id; // 通常是"书签栏"
            }
            
            const title = `${activeTab.title} [${key}]`;
            await chrome.bookmarks.create({ parentId: targetFolderId, title: title, url: activeTab.url });
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
