// background.js - 后台服务工作者
// 
// 主要职责：
// 1. 管理扩展生命周期事件 - 安装、更新等
// 2. 提供右键菜单功能
//
// 设计要点：
// - 使用Service Worker模式，支持Manifest V3

// --- 初始化 ---

// 扩展安装或更新时的处理
chrome.runtime.onInstalled.addListener(handleInstalled);

// 注册右键菜单
createContextMenus();

// --- 事件处理函数 ---

function handleInstalled(details) {
    if (details.reason === 'install') {
        console.log('Quick Open Site 扩展已安装');
        initializeDefaultSettings();
        chrome.tabs.create({ url: chrome.runtime.getURL('options.html'), active: true });
    } else if (details.reason === 'update') {
        console.log('Quick Open Site 扩展已更新');
    }
}

async function initializeDefaultSettings() {
    const defaultSettings = { openInNewTab: true, bookmarkFolder: '' };
    try {
        const existing = await chrome.storage.sync.get();
        if (Object.keys(existing).length === 0) {
            await chrome.storage.sync.set(defaultSettings);
        }
    } catch (error) {
        console.error('初始化设置失败:', error);
    }
}

// --- 右键菜单 ---

function createContextMenus() {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({ id: 'quick-open-site-main', title: 'Quick Open Site', contexts: ['action'] });
        chrome.contextMenus.create({ id: 'open-dashboard', parentId: 'quick-open-site-main', title: '\u2328\uFE0F \u5FEB\u6377\u952E\u603B\u89C8', contexts: ['action'] });
        chrome.contextMenus.create({ id: 'open-options', parentId: 'quick-open-site-main', title: '\u2699\uFE0F \u6253\u5F00\u8BBE\u7F6E', contexts: ['action'] });
        chrome.contextMenus.create({ id: 'manage-bookmarks', parentId: 'quick-open-site-main', title: '\uD83D\uDCC1 \u7BA1\u7406\u4E66\u7B7E', contexts: ['action'] });
    });
}

chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === 'open-dashboard') {
        chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    } else if (info.menuItemId === 'open-options') {
        chrome.runtime.openOptionsPage();
    } else if (info.menuItemId === 'manage-bookmarks') {
        chrome.tabs.create({ url: 'chrome://bookmarks/' });
    }
});
