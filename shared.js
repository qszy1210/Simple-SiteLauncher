// shared.js - 书签加载、解析、CRUD 共享逻辑
const BookmarkService = {

    defaultSettings: { openInNewTab: true, bookmarkFolder: '' },

    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get(['openInNewTab', 'bookmarkFolder']);
            return {
                openInNewTab: result.openInNewTab !== undefined ? result.openInNewTab : true,
                bookmarkFolder: result.bookmarkFolder || ''
            };
        } catch (error) {
            console.error('加载设置失败:', error);
            return { ...this.defaultSettings };
        }
    },

    async loadBookmarks(settings) {
        const bookmarkTree = await chrome.bookmarks.getTree();
        const folderName = settings.bookmarkFolder;
        let bookmarks;

        if (folderName) {
            const targetFolder = this.findBookmarkFolder(bookmarkTree, folderName);
            if (targetFolder) {
                const children = await chrome.bookmarks.getChildren(targetFolder.id);
                bookmarks = await this.processBookmarkItems(children);
            } else {
                bookmarks = [];
            }
        } else {
            bookmarks = await this.getAllBookmarks(bookmarkTree);
        }

        const keyMapping = this.parseKeyMappings(bookmarks);
        bookmarks = this.sortBookmarksByPriority(bookmarks);
        return { bookmarks, keyMapping };
    },

    findBookmarkFolder(nodes, folderName) {
        for (const node of nodes) {
            if (node.title === folderName && node.children) return node;
            if (node.children) {
                const found = this.findBookmarkFolder(node.children, folderName);
                if (found) return found;
            }
        }
        return null;
    },

    async getAllBookmarks(nodes) {
        const bookmarks = [];
        const traverse = async (nodeList, parentFolder = null) => {
            for (const node of nodeList) {
                if (node.url) {
                    bookmarks.push({ id: node.id, title: node.title, url: node.url, folder: parentFolder });
                } else if (node.children) {
                    await traverse(node.children, node.title || parentFolder);
                }
            }
        };
        await traverse(nodes);
        return bookmarks;
    },

    async processBookmarkItems(items) {
        const bookmarkPromises = items.map(async (item) => {
            if (item.url) {
                return { id: item.id, title: item.title, url: item.url };
            } else {
                const subFolderChildren = await chrome.bookmarks.getChildren(item.id);
                return subFolderChildren
                    .filter(child => !!child.url)
                    .map(bookmark => ({
                        id: bookmark.id, title: bookmark.title, url: bookmark.url, folder: item.title
                    }));
            }
        });
        const nestedBookmarks = await Promise.all(bookmarkPromises);
        return nestedBookmarks.flat();
    },

    parseKeyMappings(bookmarks) {
        const keyMapping = new Map();
        bookmarks.forEach(bookmark => {
            const match = bookmark.title.match(/\[([a-z0-9])\]/i);
            if (match) {
                const key = match[1].toLowerCase();
                bookmark.key = key;
                bookmark.displayTitle = bookmark.title.replace(/\s*\[[a-z0-9]\]/i, '').trim();
                if (!keyMapping.has(key)) keyMapping.set(key, []);
                keyMapping.get(key).push(bookmark);
            } else {
                bookmark.displayTitle = bookmark.title;
            }
        });
        return keyMapping;
    },

    sortBookmarksByPriority(bookmarkList) {
        const bookmarks = [...bookmarkList];
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

        keyboardBookmarks.sort((a, b) => a.key.toLowerCase().localeCompare(b.key.toLowerCase()));
        normalBookmarks.sort((a, b) => a.displayTitle.localeCompare(b.displayTitle, 'zh-CN', { sensitivity: 'base' }));

        return [...pinnedBookmarks, ...keyboardBookmarks, ...normalBookmarks];
    },

    async updateBookmarkKey(bookmark, newKey) {
        const key = newKey.trim().toLowerCase();
        if (!key || !/^[a-z0-9]$/.test(key)) return false;
        const newTitle = `${bookmark.displayTitle} [${key}]`;
        await chrome.bookmarks.update(bookmark.id, { title: newTitle });
        return true;
    },

    async deleteBookmarkKey(bookmark) {
        await chrome.bookmarks.update(bookmark.id, { title: bookmark.displayTitle });
    },

    async deleteBookmark(bookmarkId) {
        await chrome.bookmarks.remove(bookmarkId);
    },

    async addBookmarkWithKey(url, title, key, settings) {
        const bookmarkTree = await chrome.bookmarks.getTree();
        let targetFolderId;

        if (settings.bookmarkFolder) {
            const targetFolder = this.findBookmarkFolder(bookmarkTree, settings.bookmarkFolder);
            if (!targetFolder) throw new Error('未找到配置的书签文件夹: ' + settings.bookmarkFolder);
            targetFolderId = targetFolder.id;
        } else {
            targetFolderId = bookmarkTree[0].children[0].id;
        }

        const bookmarkTitle = `${title} [${key}]`;
        await chrome.bookmarks.create({ parentId: targetFolderId, title: bookmarkTitle, url });
    },

    getFaviconUrl(pageUrl) {
        const url = new URL(chrome.runtime.getURL('/_favicon/'));
        url.searchParams.set('pageUrl', pageUrl);
        url.searchParams.set('size', '24');
        return url.toString();
    },

    formatUrl(url) {
        try { return new URL(url).hostname; }
        catch { return url; }
    }
};
