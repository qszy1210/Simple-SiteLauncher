// favicon-cache.js - Favicon缓存管理器
// 
// 设计思路：
// 1. 完全基于chrome.storage.local实现持久化缓存，避免popup生命周期问题
// 2. 缓存base64数据而非URL，实现真正的离线缓存，消除闪烁
// 3. 区分成功和失败状态，避免重复请求已知失败的favicon
// 4. 通过background script处理网络请求，解决CORS和权限问题
class FaviconCache {
    constructor() {
        // 缓存配置 - 针对不同状态使用不同的过期时间
        this.maxAge = 7 * 24 * 60 * 60 * 1000; // 成功缓存7天过期 - 较长时间，因为favicon很少变化
        this.failedMaxAge = 24 * 60 * 60 * 1000; // 失败缓存1天过期 - 较短时间，允许重试
        this.storageKey = 'favicon_cache'; // chrome.storage.local中的键名
        
        // 特殊标记 - 用于标识缓存的失败状态
        this.FAVICON_NOT_FOUND = '__FAVICON_NOT_FOUND__';
        
        // 加载状态跟踪 - 防止同一域名的重复请求
        // 使用Map存储正在进行的Promise，key为domain，value为Promise
        this.loadingPromises = new Map();
        
        // 初始化状态标记
        this.initialized = false;
        
        // 异步初始化 - 启动定期清理等后台任务
        this.init();
    }

    /**
     * 初始化缓存系统
     * 启动定期清理任务，标记初始化完成
     */
    async init() {
        try {
            // 启动定期清理定时器 - 每小时清理一次过期缓存
            this.startCleanupTimer();
            
            // 标记初始化完成 - 其他方法会等待此标记
            this.initialized = true;
            console.log('✅ FaviconCache 初始化完成（基于chrome.storage持久化缓存）');
        } catch (error) {
            console.error('❌ FaviconCache 初始化失败:', error);
            // 即使失败也标记为已初始化，避免阻塞其他操作
            this.initialized = true;
        }
    }

    /**
     * 获取favicon的主要入口方法
     * 
     * 工作流程：
     * 1. 检查持久化缓存（chrome.storage.local）
     * 2. 缓存命中：返回base64数据或null（失败状态）
     * 3. 缓存未命中：触发网络加载并缓存结果
     * 4. 防重复：同一域名的并发请求会共享Promise
     * 
     * @param {string} domain - 域名（如：github.com）
     * @param {string} url - 完整URL（用于生成favicon URL）
     * @returns {Promise<string|null>} - 返回base64格式的favicon数据，失败返回null
     */
    async get(domain, url) {
        try {
            // 等待初始化完成 - 确保定时器等已启动
            await this.waitForInit();
            
            // 1. 检查持久化缓存
            const storageItem = await this.getFromStorage(domain);
            if (storageItem && !this.isExpired(storageItem)) {
                // 缓存命中且未过期
                if (storageItem.data === this.FAVICON_NOT_FOUND) {
                    // 失败状态缓存 - 避免重复请求已知失败的favicon
                    console.log(`[CACHE HIT - FAILED] ${domain} 存在失败缓存。`);
                    return null;
                }
                // 成功状态缓存 - 返回base64数据
                console.log(`[CACHE HIT - SUCCESS] ${domain} 发现有效缓存 (Base64)。`);
                return storageItem.data;
            }

            // 2. 缓存未命中或已过期
            if (storageItem) {
                console.log(`[CACHE EXPIRED] ${domain} 的缓存已过期。`);
            } else {
                console.log(`[CACHE MISS] ${domain} 无缓存，准备从网络加载。`);
            }

            // 3. 防重复请求 - 如果同一域名正在加载，返回现有Promise
            if (this.loadingPromises.has(domain)) {
                return this.loadingPromises.get(domain);
            }

            // 4. 开始新的网络加载
            const loadingPromise = this.fetchAndCacheFavicon(domain, url);
            this.loadingPromises.set(domain, loadingPromise);

            try {
                return await loadingPromise;
            } finally {
                // 清理加载状态 - 无论成功失败都要清理
                this.loadingPromises.delete(domain);
            }
        } catch (error) {
            console.error(`获取favicon失败 (${domain}):`, error);
            return null;
        }
    }

    /**
     * 核心逻辑：获取、转换并缓存favicon
     * 
     * 实现多重回退策略：
     * 1. 测试background通信是否正常
     * 2. 生成多个候选favicon URL（网站自有 → 第三方服务）
     * 3. 依次尝试每个URL，直到成功或全部失败
     * 4. 成功时缓存base64数据，失败时缓存失败状态
     * 
     * @param {string} domain - 域名
     * @param {string} url - 完整URL
     * @returns {Promise<string|null>} - 成功返回base64数据，失败返回null
     */
    async fetchAndCacheFavicon(domain, url) {
        try {
            // 1. 测试background通信 - 确保消息传递正常工作
            const pingResult = await this.testBackgroundConnection();
            if (!pingResult) {
                throw new Error('Background script communication failed');
            }
            
            // 2. 生成多个候选favicon URL - 实现回退策略
            const faviconUrls = this.generateFaviconUrl(url);
            console.log(`[CACHE] 为 ${domain} 生成了 ${faviconUrls.length} 个候选favicon URL`);
            
            // 3. 依次尝试每个URL - 直到成功或全部失败
            for (let i = 0; i < faviconUrls.length; i++) {
                const faviconUrl = faviconUrls[i];
                console.log(`[CACHE] 尝试 ${domain} 的第 ${i + 1} 个URL: ${faviconUrl}`);
                
                // 通过background script获取并转换为base64
                const base64Data = await this.fetchAndConvertToBase64(faviconUrl);
                
                if (base64Data) {
                    // 成功：缓存base64数据
                    await this.set(domain, base64Data, false);
                    console.log(`[CACHE] ✅ ${domain} 已成功获取并缓存为Base64 (使用第 ${i + 1} 个URL)`);
                    return base64Data;
                }
                
                console.log(`[CACHE] ❌ ${domain} 第 ${i + 1} 个URL失败，尝试下一个`);
            }
            
            // 所有URL都失败
            throw new Error('All favicon URLs failed');
        } catch (error) {
            // 失败：缓存失败状态，避免重复请求
            await this.set(domain, this.FAVICON_NOT_FOUND, true);
            console.warn(`[CACHE] ❌ ${domain} 所有favicon URL都失败，已缓存失败状态。原因:`, error.message);
            return null;
        }
    }

    async testBackgroundConnection() {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'ping' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('[TEST] Background通信失败:', chrome.runtime.lastError.message);
                    resolve(false);
                } else if (response && response.success) {
                    console.log('[TEST] Background通信正常');
                    resolve(true);
                } else {
                    console.error('[TEST] Background响应异常:', response);
                    resolve(false);
                }
            });
        });
    }

    // 测试方法：手动测试单个favicon
    async testSingleFavicon(domain) {
        const testUrl = `https://${domain}`;
        const faviconUrls = this.generateFaviconUrl(testUrl);
        
        console.log(`[TEST] 测试 ${domain} 的favicon获取`);
        
        for (let i = 0; i < faviconUrls.length; i++) {
            const url = faviconUrls[i];
            console.log(`[TEST] 尝试URL ${i + 1}: ${url}`);
            
            const result = await this.fetchAndConvertToBase64(url);
            if (result) {
                console.log(`[TEST] ✅ 成功获取 ${domain} 的favicon (URL ${i + 1})`);
                return { success: true, url, data: result };
            }
        }
        
        console.log(`[TEST] ❌ 所有URL都失败: ${domain}`);
        return { success: false };
    }

    /**
     * 使用后台脚本进行fetch和转换，以规避CORS问题
     */
    async fetchAndConvertToBase64(url) {
        return new Promise((resolve, reject) => {
            console.log(`[FETCH] 向background发送请求: ${url}`);
            
            // 设置超时机制，避免无限等待
            const timeout = setTimeout(() => {
                console.log(`[FETCH] ⏰ 请求超时: ${url}`);
                resolve(null);
            }, 10000); // 10秒超时
            
            chrome.runtime.sendMessage({ type: 'fetch-favicon', url: url }, (response) => {
                clearTimeout(timeout);
                
                if (chrome.runtime.lastError) {
                    console.error(`[FETCH] ❌ 消息发送错误: ${url}`, chrome.runtime.lastError.message);
                    resolve(null);
                    return;
                }

                console.log(`[FETCH] 收到background响应: ${url}`, response);

                if (response && response.success) {
                    console.log(`[FETCH] ✅ 成功获取favicon: ${url}`);
                    resolve(response.dataUrl);
                } else {
                    console.log(`[FETCH] ❌ 获取favicon失败: ${url}`, response?.error);
                    resolve(null);
                }
            });
        });
    }

    generateFaviconUrl(url) {
        try {
            const urlObj = new URL(url);
            const domain = urlObj.hostname;
            
            // 返回多个可能的favicon URL，按优先级排序
            // 优先使用网站自己的favicon，然后是第三方服务
            return [
                `${urlObj.protocol}//${domain}/favicon.ico`,
                `${urlObj.protocol}//${domain}/favicon.png`,
                `${urlObj.protocol}//${domain}/apple-touch-icon.png`,
                `https://icons.duckduckgo.com/ip3/${domain}.ico`,
                `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
            ];
        } catch {
            return [];
        }
    }

    async set(domain, data, isFailed = false) {
        try {
            const cacheItem = {
                data: data,
                timestamp: Date.now(),
                isFailed: isFailed
            };
            await this.saveToStorage(domain, cacheItem);
        } catch (error) {
            console.error(`存储favicon失败 (${domain}):`, error);
        }
    }

    async saveToStorage(domain, item) {
        try {
            const result = await chrome.storage.local.get([this.storageKey]);
            const storageCache = result[this.storageKey] || {};
            storageCache[domain] = item;
            await chrome.storage.local.set({ [this.storageKey]: storageCache });
        } catch (error) {
            console.error('保存到存储失败:', error);
        }
    }

    async getFromStorage(domain) {
        try {
            const result = await chrome.storage.local.get([this.storageKey]);
            const storageCache = result[this.storageKey] || {};
            return storageCache[domain] || null;
        } catch (error) {
            console.error('从存储获取失败:', error);
            return null;
        }
    }

    isExpired(item) {
        const maxAge = item.isFailed ? this.failedMaxAge : this.maxAge;
        return Date.now() - item.timestamp > maxAge;
    }

    startCleanupTimer() {
        setInterval(() => {
            this.cleanupExpiredCache();
        }, 60 * 60 * 1000);
    }

    async cleanupExpiredCache() {
        try {
            const result = await chrome.storage.local.get([this.storageKey]);
            const storageCache = result[this.storageKey] || {};
            let cleanedCount = 0;
            for (const [domain, item] of Object.entries(storageCache)) {
                if (this.isExpired(item)) {
                    delete storageCache[domain];
                    cleanedCount++;
                }
            }
            if (cleanedCount > 0) {
                await chrome.storage.local.set({ [this.storageKey]: storageCache });
                console.log(`🧹 定期清理: 清理了 ${cleanedCount} 个过期缓存项`);
            }
        } catch (error) {
            console.error('定期清理失败:', error);
        }
    }
    
    async clear() {
        try {
            await chrome.storage.local.remove([this.storageKey]);
            console.log('🗑️ 所有favicon缓存已清空');
            
            // 也清除加载状态
            this.loadingPromises.clear();
            
            return true;
        } catch (error) {
            console.error('清空缓存失败:', error);
            return false;
        }
    }

    async waitForInit() {
        while (!this.initialized) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }
}
