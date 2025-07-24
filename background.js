// background.js - 后台服务工作者
// 
// 主要职责：
// 1. 处理favicon网络请求 - 解决popup中的CORS限制
// 2. 将图片转换为base64格式 - 实现真正的离线缓存
// 3. 管理扩展生命周期事件 - 安装、更新等
// 4. 提供右键菜单功能
//
// 设计要点：
// - 使用Service Worker模式，支持Manifest V3
// - 纯Promise链实现，避免async/await在Service Worker中的问题
// - 通过消息传递与popup通信

// --- 初始化 ---

// 扩展安装或更新时的处理
chrome.runtime.onInstalled.addListener(handleInstalled);

// 注册右键菜单
createContextMenus();

// 注册消息监听器 - 处理来自popup的请求
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

/**
 * 处理来自popup的消息
 * 
 * 支持的消息类型：
 * - fetch-favicon: 获取并转换favicon为base64
 * - ping: 测试通信连接
 * - test-network: 测试网络连接
 * 
 * @param {Object} message - 消息对象
 * @param {Object} sender - 发送者信息
 * @param {Function} sendResponse - 响应回调函数
 * @returns {boolean} - 是否异步响应
 */
function handleMessage(message, sender, sendResponse) {
    console.log('收到消息:', message.type);
    
    if (message.type === 'fetch-favicon') {
        console.log(`开始获取favicon: ${message.url}`);
        
        // 处理favicon获取请求
        try {
            fetchFavicon(message.url, sendResponse);
            return true; // 保持消息端口开放，等待异步响应
        } catch (error) {
            console.error(`[BG] 处理favicon请求时出错: ${message.url}`, error);
            sendResponse({ success: false, error: error.message });
            return false;
        }
    }
    
    if (message.type === 'ping') {
        // 简单的连通性测试
        console.log('收到ping消息');
        sendResponse({ success: true, message: 'pong' });
        return false; // 同步响应
    }
    
    if (message.type === 'test-network') {
        // 网络连接测试 - 用于诊断网络问题
        console.log('测试网络连接');
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
        return true; // 异步响应
    }
    
    console.log('未知消息类型:', message.type);
    return false;
}

// --- 核心功能 ---

/**
 * 获取favicon并转换为base64格式
 * 
 * 工作流程：
 * 1. 发起网络请求获取favicon图片
 * 2. 将响应转换为Blob对象
 * 3. 使用FileReader将Blob转换为base64
 * 4. 通过callback返回结果
 * 
 * 关键特性：
 * - 8秒超时控制，避免长时间等待
 * - 支持AbortController取消请求
 * - 详细的错误处理和日志记录
 * - 兼容不同的Content-Type
 * 
 * @param {string} url - 要获取的favicon URL
 * @param {function} callback - 响应回调函数，格式：{success: boolean, dataUrl?: string, error?: string}
 */
function fetchFavicon(url, callback) {
    console.log(`[BG] 开始获取favicon: ${url}`);
    
    // 超时控制 - 避免长时间等待
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
        console.log(`[BG] ⏰ 请求超时: ${url}`);
        callback({ success: false, error: 'Request timeout' });
    }, 8000); // 8秒超时
    
    // 发起网络请求
    fetch(url, { 
        signal: controller.signal,
        mode: 'cors', // 允许跨域请求
        cache: 'default', // 使用浏览器缓存
        credentials: 'omit', // 不发送凭据
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; FaviconBot/1.0)' // 模拟浏览器请求
        }
    })
        .then(response => {
            clearTimeout(timeoutId);
            console.log(`[BG] 收到响应: ${url}, status: ${response.status}, type: ${response.type}`);
            
            // 检查HTTP状态码
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            // 转换为Blob对象
            return response.blob();
        })
        .then(blob => {
            console.log(`[BG] 获取到blob: ${url}, size: ${blob.size}, type: ${blob.type}`);
            
            // 检查响应是否为空
            if (blob.size === 0) {
                throw new Error('Empty response');
            }
            
            // 检查Content-Type（警告但不阻止）
            if (!blob.type.startsWith('image/')) {
                console.log(`[BG] ⚠️ 非图片类型: ${url}, type: ${blob.type}`);
                // 仍然尝试处理，可能是服务器没有设置正确的Content-Type
            }
            
            // 使用FileReader转换为base64
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
            
            // 处理中止错误（避免重复回调）
            if (error.name === 'AbortError') {
                console.log(`[BG] ❌ 请求被中止: ${url}`);
                return; // 超时处理器已经调用了callback
            }
            
            // 处理其他错误
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