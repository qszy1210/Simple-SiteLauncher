// options.js - 设置页面逻辑
class OptionsManager {
    constructor() {
        this.defaultSettings = {
            openInNewTab: true
        };

        this.init();
    }

    async init() {
        await this.loadSettings();
        this.bindEvents();
    }

    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get(this.defaultSettings);
            this.applySettings(result);
        } catch (error) {
            console.error('加载设置失败:', error);
            this.applySettings(this.defaultSettings);
        }
    }

    applySettings(settings) {
        // 应用设置到UI
        document.getElementById('openInNewTab').checked = settings.openInNewTab;
    }

    bindEvents() {
        // 开关状态变化事件
        const openInNewTabSwitch = document.getElementById('openInNewTab');
        openInNewTabSwitch.addEventListener('change', (e) => {
            this.saveSetting('openInNewTab', e.target.checked);
        });

        // 管理书签按钮
        document.getElementById('manageBookmarksBtn').addEventListener('click', () => {
            chrome.tabs.create({ url: 'chrome://bookmarks/' });
        });

        // 重置设置按钮
        document.getElementById('resetSettingsBtn').addEventListener('click', () => {
            if (confirm('确定要重置所有设置吗？此操作无法撤销。')) {
                this.resetSettings();
            }
        });
    }

    async saveSetting(key, value) {
        try {
            await chrome.storage.sync.set({ [key]: value });
            this.showSaveStatus();
            console.log(`设置已保存: ${key} = ${value}`);
        } catch (error) {
            console.error('保存设置失败:', error);
            this.showSaveStatus('保存失败', false);
        }
    }

    async saveAllSettings() {
        const settings = {
            openInNewTab: document.getElementById('openInNewTab').checked
        };

        try {
            await chrome.storage.sync.set(settings);
            this.showSaveStatus();
            console.log('所有设置已保存:', settings);
        } catch (error) {
            console.error('保存设置失败:', error);
            this.showSaveStatus('保存失败', false);
        }
    }

    showSaveStatus(message = '✅ 设置已保存', success = true) {
        const statusElement = document.getElementById('saveStatus');

        statusElement.textContent = message;
        statusElement.style.background = success ? '#28a745' : '#dc3545';
        statusElement.classList.add('show');

        setTimeout(() => {
            statusElement.classList.remove('show');
        }, 2000);
    }

    async resetSettings() {
        try {
            await chrome.storage.sync.clear();
            this.applySettings(this.defaultSettings);
            this.showSaveStatus('✅ 设置已重置');
            console.log('设置已重置');
        } catch (error) {
            console.error('重置设置失败:', error);
            this.showSaveStatus('重置失败', false);
        }
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    const optionsManager = new OptionsManager();

    // 添加一些动画效果
    animateElements();
});

function animateElements() {
    // 为选项组添加淡入动画
    const optionGroups = document.querySelectorAll('.option-group');
    optionGroups.forEach((group, index) => {
        group.style.opacity = '0';
        group.style.transform = 'translateY(20px)';

        setTimeout(() => {
            group.style.transition = 'all 0.5s ease';
            group.style.opacity = '1';
            group.style.transform = 'translateY(0)';
        }, index * 100);
    });
}

// 快捷键处理
document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + S 保存设置
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        optionsManager.saveAllSettings();
    }

    // Esc 关闭页面
    if (e.key === 'Escape') {
        window.close();
    }
});

// 主题切换 (未来功能预留)
function toggleTheme() {
    const body = document.body;
    const isDark = body.classList.contains('dark-theme');

    if (isDark) {
        body.classList.remove('dark-theme');
        localStorage.setItem('theme', 'light');
    } else {
        body.classList.add('dark-theme');
        localStorage.setItem('theme', 'dark');
    }
}

// 导出设置
async function exportSettings() {
    try {
        const settings = await chrome.storage.sync.get();
        const dataStr = JSON.stringify(settings, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);

        const link = document.createElement('a');
        link.href = url;
        link.download = 'quick-open-site-settings.json';
        link.click();

        URL.revokeObjectURL(url);
        optionsManager.showSaveStatus('✅ 设置已导出');
    } catch (error) {
        console.error('导出设置失败:', error);
        optionsManager.showSaveStatus('导出失败', false);
    }
}

// 导入设置
function importSettings() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const settings = JSON.parse(text);

            await chrome.storage.sync.set(settings);
            // We need a way to call applySettings and showSaveStatus
            // For now, reloading might be the simplest fix.
            location.reload();
        } catch (error) {
            console.error('导入设置失败:', error);
            // And show a status message... this is getting complex.
            alert('导入设置失败，请检查文件格式。');
        }
    };

    input.click();
}