// background.js - 后台服务工作者
class BackgroundService {
    constructor() {
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.createContextMenus();
    }

    setupEventListeners() {
        // 扩展安装时
        chrome.runtime.onInstalled.addListener((details) => {
            this.handleInstalled(details);
        });

        // 扩展启动时
        chrome.runtime.onStartup.addListener(() => {
            this.handleStartup();
        });

        // 右键菜单点击事件
        chrome.contextMenus.onClicked.addListener((info, tab) => {
            this.handleContextMenuClick(info, tab);
        });

        // 快捷键命令
        chrome.commands.onCommand.addListener((command) => {
            this.handleCommand(command);
        });

        // 消息处理
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
        });
    }

    handleInstalled(details) {
        if (details.reason === 'install') {
            console.log('Quick Open Site 扩展已安装');
            this.initializeDefaultSettings();
            this.showWelcomeNotification();
        } else if (details.reason === 'update') {
            console.log('Quick Open Site 扩展已更新');
            this.handleUpdate(details.previousVersion);
        }
    }

    handleStartup() {
        console.log('Quick Open Site 扩展已启动');
    }

    async initializeDefaultSettings() {
        const defaultSettings = {
            openInNewTab: true,
            firstRun: true
        };

        try {
            const existing = await chrome.storage.sync.get();
            if (Object.keys(existing).length === 0) {
                await chrome.storage.sync.set(defaultSettings);
                console.log('默认设置已初始化');
            }
        } catch (error) {
            console.error('初始化设置失败:', error);
        }
    }

    showWelcomeNotification() {
        // 在新标签页中打开欢迎页面
        chrome.tabs.create({
            url: chrome.runtime.getURL('options.html'),
            active: true
        });
    }

    handleUpdate(previousVersion) {
        console.log(`扩展已从版本 ${previousVersion} 更新`);
        // 这里可以添加版本更新逻辑
    }

    createContextMenus() {
        // 清除现有菜单
        chrome.contextMenus.removeAll(() => {
            // 创建主菜单
            chrome.contextMenus.create({
                id: 'quick-open-site-main',
                title: 'Quick Open Site',
                contexts: ['action']
            });

            chrome.contextMenus.create({
                id: 'open-options',
                parentId: 'quick-open-site-main',
                title: '⚙️ 打开设置',
                contexts: ['action']
            });

            chrome.contextMenus.create({
                id: 'manage-bookmarks',
                parentId: 'quick-open-site-main',
                title: '📁 管理书签',
                contexts: ['action']
            });

            chrome.contextMenus.create({
                id: 'separator-1',
                parentId: 'quick-open-site-main',
                type: 'separator',
                contexts: ['action']
            });

            chrome.contextMenus.create({
                id: 'reload-bookmarks',
                parentId: 'quick-open-site-main',
                title: '🔄 刷新书签',
                contexts: ['action']
            });

            chrome.contextMenus.create({
                id: 'about',
                parentId: 'quick-open-site-main',
                title: 'ℹ️ 关于',
                contexts: ['action']
            });
        });
    }

    handleContextMenuClick(info, tab) {
        switch (info.menuItemId) {
            case 'open-options':
                chrome.runtime.openOptionsPage();
                break;
            case 'manage-bookmarks':
                chrome.tabs.create({ url: 'chrome://bookmarks/' });
                break;
            case 'reload-bookmarks':
                this.notifyReloadBookmarks();
                break;
            case 'about':
                this.showAboutInfo();
                break;
        }
    }

    handleCommand(command) {
        switch (command) {
            case '_execute_action':
                // 这个命令会自动触发popup，不需要额外处理
                console.log('快捷键触发popup');
                break;
        }
    }

    handleMessage(message, sender, sendResponse) {
        switch (message.type) {
            case 'get-settings':
                this.getSettings().then(sendResponse);
                return true; // 保持消息通道开放
            case 'save-settings':
                this.saveSettings(message.settings).then(sendResponse);
                return true;
            case 'open-bookmark':
                this.openBookmark(message.url, message.openInNewTab).then(sendResponse);
                return true;
            default:
                console.log('未知消息类型:', message.type);
        }
    }

    async getSettings() {
        try {
            const settings = await chrome.storage.sync.get({
                openInNewTab: true
            });
            return { success: true, settings };
        } catch (error) {
            console.error('获取设置失败:', error);
            return { success: false, error: error.message };
        }
    }

    async saveSettings(settings) {
        try {
            await chrome.storage.sync.set(settings);
            return { success: true };
        } catch (error) {
            console.error('保存设置失败:', error);
            return { success: false, error: error.message };
        }
    }

    async openBookmark(url, openInNewTab = true) {
        try {
            if (openInNewTab) {
                await chrome.tabs.create({ url });
            } else {
                const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                await chrome.tabs.update(activeTab.id, { url });
            }
            return { success: true };
        } catch (error) {
            console.error('打开书签失败:', error);
            return { success: false, error: error.message };
        }
    }

    notifyReloadBookmarks() {
        // 通知所有popup重新加载书签
        chrome.runtime.sendMessage({
            type: 'reload-bookmarks'
        }).catch(() => {
            // 忽略没有监听器的错误
        });
    }

    showAboutInfo() {
        const manifest = chrome.runtime.getManifest();
        const aboutInfo = `
Quick Open Site v${manifest.version}

一个快速打开书签网站的Chrome扩展

功能特点：
• 快捷键快速打开 (Cmd/Ctrl + G)
• 支持按键映射 (a-z, 0-9)
• 优雅的用户界面
• 灵活的设置选项
• 支持子文件夹书签

使用说明：
1. 在书签栏创建"SiteLauncher"文件夹
2. 添加书签，格式：网站名称 [快捷键]
3. 也可以添加子文件夹来组织书签
4. 使用 Cmd/Ctrl + G 打开扩展
5. 按对应字母/数字快速打开网站
        `;

        console.log(aboutInfo);

        // 创建一个临时通知
        this.showNotification('关于 Quick Open Site', `版本 ${manifest.version} - 查看控制台了解更多信息`);
    }

    showNotification(title, message) {
        // 注意：Chrome扩展的通知需要在manifest中声明notifications权限
        if (chrome.notifications) {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: chrome.runtime.getURL('icon48.png'),
                title: title,
                message: message
            });
        }
    }

    // 监听存储变化
    monitorStorageChanges() {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'sync') {
                console.log('设置已更改:', changes);
                // 通知popup重新加载设置
                chrome.runtime.sendMessage({
                    type: 'settings-changed',
                    changes: changes
                }).catch(() => {
                    // 忽略没有监听器的错误
                });
            }
        });
    }

    // 检查书签文件夹
    async checkSiteLauncherFolder() {
        try {
            const tree = await chrome.bookmarks.getTree();
            const folder = this.findSiteLauncherFolder(tree);

            if (folder) {
                // 检查文件夹内容
                const children = await chrome.bookmarks.getChildren(folder.id);
                const bookmarks = children.filter(child => child.url);
                const subfolders = children.filter(child => !child.url);

                console.log(`SiteLauncher文件夹包含 ${bookmarks.length} 个书签和 ${subfolders.length} 个子文件夹`);

                // 如果有子文件夹，检查其中的书签
                if (subfolders.length > 0) {
                    for (const subfolder of subfolders) {
                        const subChildren = await chrome.bookmarks.getChildren(subfolder.id);
                        const subBookmarks = subChildren.filter(child => child.url);
                        console.log(`- 子文件夹 "${subfolder.title}" 包含 ${subBookmarks.length} 个书签`);
                    }
                }
            }

            return !!folder;
        } catch (error) {
            console.error('检查书签文件夹失败:', error);
            return false;
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
}

// 初始化后台服务
const backgroundService = new BackgroundService();

// 监听存储变化
backgroundService.monitorStorageChanges();

// 定期检查书签文件夹 (可选)
setInterval(async () => {
    const hasFolder = await backgroundService.checkSiteLauncherFolder();
    if (!hasFolder) {
        console.warn('未找到SiteLauncher书签文件夹');
    }
}, 60000); // 每分钟检查一次