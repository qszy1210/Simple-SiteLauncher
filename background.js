// background.js - 后台服务工作者 (重构为纯Promise链模式)

// --- 初始化 ---

// 扩展安装或更新时
chrome.runtime.onInstalled.addListener(handleInstalled);

// 注册右键菜单
createContextMenus();

// 注册消息监听器
chrome.runtime.onMessage.addListener(handleMessage);

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

function handleMessage(message, sender, sendResponse) {
    console.log('收到消息:', message.type);
    
    if (message.type === 'fetch-favicon') {
        console.log(`开始获取favicon: ${message.url}`);
        
        // 确保sendResponse在异步操作中仍然有效
        try {
            fetchFavicon(message.url, sendResponse);
            return true; // 保持消息端口开放
        } catch (error) {
            console.error(`[BG] 处理favicon请求时出错: ${message.url}`, error);
            sendResponse({ success: false, error: error.message });
            return false;
        }
    }
    
    if (message.type === 'ping') {
        console.log('收到ping消息');
        sendResponse({ success: true, message: 'pong' });
        return false;
    }
    
    if (message.type === 'test-network') {
        console.log('测试网络连接');
        // 测试一个简单的网络请求
        fetch('https://httpbin.org/get', { 
            method: 'GET',
            mode: 'cors',
            cache: 'no-cache'
        })
        .then(response => {
            if (response.ok) {
                sendResponse({ success: true, message: 'Network OK' });
            } else {
                sendResponse({ success: false, error: `HTTP ${response.status}` });
            }
        })
        .catch(error => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }
    
    console.log('未知消息类型:', message.type);
    return false;
}

// --- 核心功能 ---

/**
 * @description 使用纯Promise链和回调来获取并转换favicon，以确保Service Worker生命周期正确
 * @param {string} url - 要获取的图片URL
 * @param {function} callback - 用于发回响应的回调函数 (sendResponse)
 */
function fetchFavicon(url, callback) {
    console.log(`[BG] 开始获取favicon: ${url}`);
    
    // 添加超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
        console.log(`[BG] ⏰ 请求超时: ${url}`);
        callback({ success: false, error: 'Request timeout' });
    }, 8000); // 8秒超时
    
    fetch(url, { 
        signal: controller.signal,
        mode: 'cors',
        cache: 'default',
        credentials: 'omit',
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; FaviconBot/1.0)'
        }
    })
        .then(response => {
            clearTimeout(timeoutId);
            console.log(`[BG] 收到响应: ${url}, status: ${response.status}, type: ${response.type}`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return response.blob();
        })
        .then(blob => {
            console.log(`[BG] 获取到blob: ${url}, size: ${blob.size}, type: ${blob.type}`);
            
            if (blob.size === 0) {
                throw new Error('Empty response');
            }
            
            // 检查是否是图片类型
            if (!blob.type.startsWith('image/')) {
                console.log(`[BG] ⚠️ 非图片类型: ${url}, type: ${blob.type}`);
                // 仍然尝试处理，可能是服务器没有设置正确的Content-Type
            }
            
            const reader = new FileReader();
            reader.onloadend = () => {
                console.log(`[BG] ✅ 转换为base64成功: ${url}`);
                callback({ success: true, dataUrl: reader.result });
            };
            reader.onerror = () => {
                console.log(`[BG] ❌ FileReader错误: ${url}`, reader.error);
                callback({ success: false, error: reader.error?.message || 'FileReader error' });
            };
            reader.readAsDataURL(blob);
        })
        .catch(error => {
            clearTimeout(timeoutId);
            
            if (error.name === 'AbortError') {
                console.log(`[BG] ❌ 请求被中止: ${url}`);
                // 不调用callback，因为超时已经调用过了
                return;
            }
            
            console.log(`[BG] ❌ 获取失败: ${url}`, error.message);
            callback({ success: false, error: error.message });
        });
}

async function initializeDefaultSettings() {
    const defaultSettings = { openInNewTab: true, firstRun: true };
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
        chrome.contextMenus.create({ id: 'open-options', parentId: 'quick-open-site-main', title: '⚙️ 打开设置', contexts: ['action'] });
        chrome.contextMenus.create({ id: 'manage-bookmarks', parentId: 'quick-open-site-main', title: '📁 管理书签', contexts: ['action'] });
    });
}

chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === 'open-options') {
        chrome.runtime.openOptionsPage();
    } else if (info.menuItemId === 'manage-bookmarks') {
        chrome.tabs.create({ url: 'chrome://bookmarks/' });
    }
});