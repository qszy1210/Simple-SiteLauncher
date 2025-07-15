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
        // document.addEventListener('contextmenu', (e) => {
        //     e.preventDefault();
        //     this.openSettings();
        // });

        // // 阻止输入框的右键菜单
        // this.searchInput.addEventListener('contextmenu', (e) => {
        //     e.stopPropagation();
        // });
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
                    this.filteredBookmarks = [...this.bookmarks];
                    this.renderBookmarks();
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
                this.keyMapping.set(key, bookmark);
            } else {
                bookmark.displayTitle = bookmark.title;
            }
        });
    }

    filterBookmarks(query) {
        const lowerQuery = query.toLowerCase();
        this.filteredBookmarks = this.bookmarks.filter(bookmark =>
            bookmark.displayTitle.toLowerCase().includes(lowerQuery) ||
            bookmark.url.toLowerCase().includes(lowerQuery) ||
            (bookmark.key && bookmark.key.includes(lowerQuery)) ||
            (bookmark.folder && bookmark.folder.toLowerCase().includes(lowerQuery))
        );

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

        const icon = this.createBookmarkIcon(bookmark);
        const info = this.createBookmarkInfo(bookmark);
        const keyBadge = bookmark.key ? this.createKeyBadge(bookmark.key) : null;

        item.appendChild(icon);
        item.appendChild(info);
        if (keyBadge) item.appendChild(keyBadge);

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
                    const bookmark = this.keyMapping.get(e.key.toLowerCase());
                    if (bookmark) {
                        e.preventDefault();
                        this.openBookmark(bookmark);
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

    async openBookmark(bookmark) {
        try {
            if (this.settings.openInNewTab) {
                await chrome.tabs.create({ url: bookmark.url });
            } else {
                const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                await chrome.tabs.update(activeTab.id, { url: bookmark.url });
            }
            window.close();
        } catch (error) {
            console.error('打开书签失败:', error);
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