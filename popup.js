// popup.js - 弹窗主要逻辑
class QuickOpenSite {
    constructor() {
        this.bookmarks = [];
        this.keyMapping = new Map();
        this.filteredBookmarks = [];
        this.selectedIndex = 0;
        this.settings = { openInNewTab: true };

        this.initElements();
        this.initEventListeners();
        this.loadSettings();
        this.loadBookmarks();
    }

    initElements() {
        this.searchInput = document.getElementById('searchInput');
        this.bookmarksList = document.getElementById('bookmarksList');
        this.loading = document.getElementById('loading');
        this.emptyState = document.getElementById('emptyState');
        this.noResults = document.getElementById('noResults');
        this.addKeyInput = document.getElementById('addKeyInput');
        this.addBookmarkBtn = document.getElementById('addBookmarkBtn');
        this.popover = document.getElementById('availableKeysPopover');
        this.popoverContent = document.getElementById('popoverContent');
        this.hidePopoverTimeout = null;
    }

    initEventListeners() {
        // 搜索输入事件
        this.searchInput.addEventListener('input', (e) => {
            this.filterBookmarks(e.target.value);
        });

        // 键盘事件
        document.addEventListener('keydown', (e) => {
            this.handleKeyDown(e);
        });

        // 右键菜单 - 打开设置
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.openSettings();
        });

        // // 阻止输入框的右键菜单
        this.searchInput.addEventListener('contextmenu', (e) => {
            e.stopPropagation();
        });

        // 添加书签按钮事件
        this.addBookmarkBtn.addEventListener('click', () => {
            this.addCurrentPageAsBookmark();
        });

        // 统一处理触发popover的输入框的焦点事件
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

        // 阻止点击popover时输入框失焦
        this.popover.addEventListener('mousedown', (e) => {
            e.preventDefault();
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
        try {
            const result = await chrome.storage.sync.get(['openInNewTab']);
            this.settings.openInNewTab = result.openInNewTab !== undefined ? result.openInNewTab : true;
        } catch (error) {
            console.error('加载设置失败:', error);
        }
    }

    async loadBookmarks() {
        try {
            this.showLoading(true);
            const bookmarkTree = await chrome.bookmarks.getTree();
            const siteLauncherFolder = this.findSiteLauncherFolder(bookmarkTree);

            if (siteLauncherFolder) {
                console.log('✅ 找到SiteLauncher文件夹:', siteLauncherFolder);
                const children = await chrome.bookmarks.getChildren(siteLauncherFolder.id);
                console.log(`➡️ SiteLauncher包含 ${children.length} 个直接子项目。`);

                this.bookmarks = await this.processBookmarkItems(children);
                console.log(`✅ 处理后共找到 ${this.bookmarks.length} 个书签。`, this.bookmarks);

                if (this.bookmarks.length > 0) {
                    this.parseKeyMappings();

                    // 排序书签：有快捷键的优先
                    this.bookmarks.sort((a, b) => {
                        const aHasKey = !!a.key;
                        const bHasKey = !!b.key;
                        if (aHasKey && !bHasKey) return -1;
                        if (!aHasKey && bHasKey) return 1;
                        return a.displayTitle.localeCompare(b.displayTitle);
                    });

                    this.filteredBookmarks = [...this.bookmarks];
                    this.renderBookmarks();
                    this.updateAvailableKeysPopover(); // 更新popover内容
                } else {
                    console.warn('SiteLauncher文件夹及其直接子文件夹中没有找到任何书签。');
                    this.showEmptyState();
                }
            } else {
                console.error('❌ 未找到SiteLauncher文件夹');
                this.showEmptyState();
            }
        } catch (error) {
            console.error('加载书签失败:', error);
            this.showEmptyState();
        } finally {
            this.showLoading(false);
        }
    }

    findSiteLauncherFolder(nodes) {
        for (const node of nodes) {
            if (node.title === 'SiteLauncher' && node.children) {
                return node;
            }
            if (node.children) {
                const found = this.findSiteLauncherFolder(node.children);
                if (found) return found;
            }
        }
        return null;
    }

    async processBookmarkItems(items) {
        const bookmarkPromises = items.map(async (item) => {
            // A bookmark item has a `url` property.
            if (item.url) {
                console.log(`➡️ 处理直接书签: "${item.title}"`);
                return {
                    id: item.id,
                    title: item.title,
                    url: item.url,
                    favicon: this.getFavicon(item.url)
                };
            }
            // A folder item does NOT have a `url` property.
            else {
                console.log(`➡️ 处理子文件夹: "${item.title}". 正在获取其内容...`);
                const subFolderChildren = await chrome.bookmarks.getChildren(item.id);
                console.log(`   - 子文件夹 "${item.title}" 包含 ${subFolderChildren.length} 个项目。`);

                return subFolderChildren
                    .filter(child => {
                        const isBookmark = !!child.url;
                        if (!isBookmark) {
                            console.log(`   - 忽略嵌套的子文件夹: "${child.title}"`);
                        }
                        return isBookmark;
                    }) // 只处理书签，忽略更深层的文件夹
                    .map(bookmark => {
                        console.log(`   - ✅ 成功从 "${item.title}" 中提取书签: "${bookmark.title}"`);
                        return {
                            id: bookmark.id,
                            title: bookmark.title,
                            url: bookmark.url,
                            favicon: this.getFavicon(bookmark.url),
                            folder: item.title // 记录其所属的文件夹名称
                        };
                    });
            }
        });

        // 等待所有异步操作完成，然后将多维数组展平为一维数组
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

                // 如果快捷键不存在，则初始化一个空数组
                if (!this.keyMapping.has(key)) {
                    this.keyMapping.set(key, []);
                }
                // 将当前书签添加到对应快捷键的数组中
                this.keyMapping.get(key).push(bookmark);
            } else {
                bookmark.displayTitle = bookmark.title;
            }
        });
    }

    filterBookmarks(query) {
        const lowerQuery = query.toLowerCase();

        // 如果输入是单个字母或数字，优先匹配快捷键
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
            // 否则，执行常规的模糊搜索
            this.filteredBookmarks = this.bookmarks.filter(bookmark =>
                bookmark.displayTitle.toLowerCase().includes(lowerQuery) ||
                bookmark.url.toLowerCase().includes(lowerQuery) ||
                (bookmark.key && bookmark.key.includes(lowerQuery)) ||
                (bookmark.folder && bookmark.folder.toLowerCase().includes(lowerQuery))
            );
        }

        this.selectedIndex = 0;
        this.renderBookmarks();
    }

    renderBookmarks() {
        this.bookmarksList.innerHTML = ''; // 先清空列表

        if (this.filteredBookmarks.length === 0) {
            // 如果是在搜索后没有结果，显示“无结果”
            if (this.searchInput.value) {
                this.showNoResults();
            } else { // 如果是初始加载就没有书签，显示“空状态”
                this.showEmptyState();
            }
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
        item.__bookmarkData = bookmark; // 将书签数据附加到DOM元素

        const icon = this.createBookmarkIcon(bookmark);
        const info = this.createBookmarkInfo(bookmark);
        const actionsContainer = this.createActionsContainer(bookmark);

        item.appendChild(icon);
        item.appendChild(info);
        item.appendChild(actionsContainer);

        item.addEventListener('click', () => this.openBookmark(bookmark));

        return item;
    }

    createBookmarkIcon(bookmark) {
        const icon = document.createElement('div');
        icon.className = 'bookmark-icon';

        // 尝试使用网站图标，失败则使用首字母
        const img = new Image();
        img.src = bookmark.favicon;
        img.onload = () => {
            icon.innerHTML = '';
            icon.appendChild(img);
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.borderRadius = '4px';
        };
        img.onerror = () => {
            icon.textContent = bookmark.displayTitle.charAt(0).toUpperCase();
        };

        // 默认显示首字母
        icon.textContent = bookmark.displayTitle.charAt(0).toUpperCase();

        return icon;
    }

    createBookmarkInfo(bookmark) {
        const info = document.createElement('div');
        info.className = 'bookmark-info';

        const title = document.createElement('div');
        title.className = 'bookmark-title';

        // 如果有文件夹信息，添加到标题前
        if (bookmark.folder) {
            title.textContent = `${bookmark.folder} › ${bookmark.displayTitle}`;
        } else {
            title.textContent = bookmark.displayTitle;
        }

        const url = document.createElement('div');
        url.className = 'bookmark-url';
        url.textContent = this.formatUrl(bookmark.url);

        info.appendChild(title);
        info.appendChild(url);

        return info;
    }

    createKeyBadge(key) {
        const badge = document.createElement('div');
        badge.className = 'bookmark-key';
        badge.textContent = key.toUpperCase();
        return badge;
    }

    createActionsContainer(bookmark) {
        const container = document.createElement('div');
        container.className = 'actions-container';

        // --- 1. 默认显示的按钮 ---
        const defaultActions = document.createElement('div');
        defaultActions.className = 'default-actions';

        if (bookmark.key) {
            defaultActions.appendChild(this.createKeyBadge(bookmark.key));
            defaultActions.appendChild(this.createDeleteKeyButton(bookmark));
        }
        defaultActions.appendChild(this.createEditShortcutButton(bookmark));
        defaultActions.appendChild(this.createDeleteBookmarkButton(bookmark));

        // --- 2. 确认删除时显示的按钮 ---
        const confirmationControls = this.createConfirmationControls(bookmark);

        // --- 3. 编辑快捷键时显示的表单 ---
        const editShortcutForm = this.createEditShortcutForm(bookmark);

        // --- 将所有部分都添加到主容器中 ---
        container.appendChild(defaultActions);
        container.appendChild(confirmationControls);
        container.appendChild(editShortcutForm);

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

            // 关闭所有其他正在操作的项
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
        form.addEventListener('click', e => e.stopPropagation()); // 阻止整个表单的点击冒泡

        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 1;
        input.className = 'edit-shortcut-input';

        // 将popover事件绑定委托给initEventListeners中的统一处理器
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
        btn.textContent = 'X'; // 使用大写X以示区别
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
        btn.innerHTML = '🗑️'; // 使用垃圾桶图标
        btn.title = '删除书签';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            // 切换到确认状态
            const currentItem = e.currentTarget.closest('.bookmark-item');
            // 先移除其他所有项的确认状态
            this.bookmarksList.querySelectorAll('.is-confirming-delete').forEach(item => {
                item.classList.remove('is-confirming-delete');
            });
            currentItem.classList.add('is-confirming-delete');
        });
        return btn;
    }

    async deleteBookmarkKey(bookmark) {
        try {
            const newTitle = bookmark.displayTitle;
            await chrome.bookmarks.update(bookmark.id, { title: newTitle });
            console.log(`✅ 快捷键已从 "${bookmark.title}" 中删除。`);
            this.loadBookmarks();
        } catch (error) {
            console.error('删除快捷键失败:', error);
        }
    }

    async deleteBookmark(bookmark, confirmed = false) {
        if (!confirmed) return; // 如果没有确认，则不执行任何操作

        try {
            await chrome.bookmarks.remove(bookmark.id);
            console.log(`✅ 书签 "${bookmark.displayTitle}" 已被删除。`);
            this.loadBookmarks();
        } catch (error) {
            console.error('删除书签失败:', error);
        }
    }

    async updateBookmarkKey(bookmark, newKey) {
        const key = newKey.trim().toLowerCase();
        if (!key || !/^[a-z0-9]$/.test(key)) {
            console.warn('无效的快捷键输入。');
            // 可以在这里添加视觉反馈
            return;
        }

        try {
            // 移除旧的快捷键（如果有的话），然后添加新的
            const baseTitle = bookmark.displayTitle;
            const newTitle = `${baseTitle} [${key}]`;

            await chrome.bookmarks.update(bookmark.id, { title: newTitle });
            console.log(`✅ 书签 "${baseTitle}" 的快捷键已更新为 "${key}"`);
            this.loadBookmarks(); // 重新加载以反映变化
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

        // 在编辑模式下，当前快捷键也应被视为可用
        if (currentKeyToIgnore) {
            usedKeys.delete(currentKeyToIgnore);
        }

        const availableKeys = allKeys.filter(key => !usedKeys.has(key));

        this.popoverContent.innerHTML = ''; // 清空旧内容

        if (availableKeys.length === 0) {
            this.popoverContent.textContent = '所有快捷键已被占用。';
            return;
        }

        availableKeys.forEach(key => {
            const keyElement = document.createElement('div');
            keyElement.className = 'available-key';
            keyElement.textContent = key;
            keyElement.addEventListener('click', () => {
                // 尝试找到当前聚焦的内联输入框并填入值
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
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch {
            return url;
        }
    }

    getFavicon(url) {
        try {
            const urlObj = new URL(url);
            return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
        } catch {
            return '';
        }
    }

    handleKeyDown(e) {
        // 新增：如果焦点在任何一个快捷键输入框中，则不执行任何快捷键操作
        if (document.activeElement.tagName === 'INPUT' &&
            (document.activeElement.id === 'addKeyInput' || document.activeElement.classList.contains('edit-shortcut-input'))) {
            return;
        }

        // 新增：按 ` 聚焦搜索框
        if (e.key === '`' && document.activeElement !== this.searchInput) {
            e.preventDefault();
            this.searchInput.focus();
            return; // 聚焦后，不再执行后续的 switch 逻辑
        }

        // 如果搜索框聚焦且是普通输入，不处理
        if (document.activeElement === this.searchInput && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            return;
        }

        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                this.moveSelection(-1);
                break;
            case 'ArrowDown':
                e.preventDefault();
                this.moveSelection(1);
                break;
            case 'Enter':
                e.preventDefault();
                if (this.filteredBookmarks[this.selectedIndex]) {
                    this.openBookmark(this.filteredBookmarks[this.selectedIndex]);
                }
                break;
            case 'Escape':
                window.close();
                break;
            default:
                // 检查是否是快捷键
                if (e.key.length === 1 && /[a-z0-9]/i.test(e.key)) {
                    const bookmarks = this.keyMapping.get(e.key.toLowerCase());
                    if (bookmarks && bookmarks.length > 0) {
                        e.preventDefault();
                        this.openBookmarks(bookmarks);
                    }
                }
        }
    }

    moveSelection(direction) {
        this.selectedIndex += direction;

        if (this.selectedIndex < 0) {
            this.selectedIndex = this.filteredBookmarks.length - 1;
        } else if (this.selectedIndex >= this.filteredBookmarks.length) {
            this.selectedIndex = 0;
        }

        this.updateSelection();
    }

    updateSelection() {
        const items = this.bookmarksList.querySelectorAll('.bookmark-item');
        items.forEach((item, index) => {
            item.classList.toggle('highlighted', index === this.selectedIndex);
        });

        // 滚动到选中项
        if (items[this.selectedIndex]) {
            items[this.selectedIndex].scrollIntoView({
                behavior: 'smooth',
                block: 'nearest'
            });
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
            if (closeAfter) {
                window.close();
            }
        } catch (error) {
            console.error('打开书签失败:', error);
        }
    }

    openBookmarks(bookmarks) {
        bookmarks.forEach(bookmark => {
            this.openBookmark(bookmark, false); // 打开书签，但不关闭弹窗
        });
        window.close(); // 所有书签打开后，关闭弹窗
    }

    async addCurrentPageAsBookmark() {
        const key = this.addKeyInput.value.trim().toLowerCase();
        if (!key || !/^[a-z0-9]$/.test(key)) {
            console.warn('无效的快捷键输入。');
            // 可以在这里给用户一些视觉反馈，比如输入框闪烁
            this.addKeyInput.style.borderColor = 'red';
            setTimeout(() => { this.addKeyInput.style.borderColor = '#ddd'; }, 1000);
            return;
        }

        try {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!activeTab || !activeTab.url || activeTab.url.startsWith('chrome://')) {
                console.warn('无法收藏当前页面。');
                // 可以在页面上给用户提示
                return;
            }

            const siteLauncherFolder = this.findSiteLauncherFolder(await chrome.bookmarks.getTree());
            if (!siteLauncherFolder) {
                console.error('未找到SiteLauncher文件夹，无法添加书签。');
                this.showEmptyState(); // 提示用户创建文件夹
                return;
            }

            const title = `${activeTab.title} [${key}]`;

            await chrome.bookmarks.create({
                parentId: siteLauncherFolder.id,
                title: title,
                url: activeTab.url
            });

            console.log(`✅ 书签 "${title}" 已成功添加。`);
            // 清空输入框并重新加载书签列表
            this.addKeyInput.value = '';
            this.loadBookmarks(); // 重新加载以显示新书签

        } catch (error) {
            console.error('添加书签失败:', error);
        }
    }

    openSettings() {
        chrome.runtime.openOptionsPage();
    }

    showLoading(show) {
        this.loading.style.display = show ? 'flex' : 'none';
    }

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

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    new QuickOpenSite();
});