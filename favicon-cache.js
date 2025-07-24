// favicon-cache.js - Favicon缓存管理器
class FaviconCache {
    constructor() {
        // 缓存配置
        this.maxAge = 7 * 24 * 60 * 60 * 1000; // 7天过期时间
        this.failedMaxAge = 24 * 60 * 60 * 1000; // 失败缓存1天过期时间
        this.storageKey = 'favicon_cache';
        
        // 特殊标记
        this.FAVICON_NOT_FOUND = '__FAVICON_NOT_FOUND__';
        
        // 加载状态跟踪
        this.loadingPromises = new Map();
        
        this.initialized = false;
        this.init();
    }

    async init() {
        try {
            this.startCleanupTimer();
            this.initialized = true;
            console.log('✅ FaviconCache 初始化完成');
        } catch (error) {
            console.error('❌ FaviconCache 初始化失败:', error);
        }
    }

    /**
     * 获取favicon，处理缓存、网络请求和Base64转换
     * @param {string} domain - 域名
     * @param {string} url - 完整URL
     * @returns {Promise<string|null>} - 返回Base64数据URL或null
     */
    async get(domain, url) {
        try {
            await this.waitForInit();
            
            const storageItem = await this.getFromStorage(domain);
            if (storageItem && !this.isExpired(storageItem)) {
                if (storageItem.data === this.FAVICON_NOT_FOUND) {
                    console.log(`[CACHE HIT - FAILED] ${domain} 存在失败缓存。`);
                    return null;
                }
                console.log(`[CACHE HIT - SUCCESS] ${domain} 发现有效缓存 (Base64)。`);
                return storageItem.data;
            }

            if (storageItem) {
                console.log(`[CACHE EXPIRED] ${domain} 的缓存已过期。`);
            } else {
                console.log(`[CACHE MISS] ${domain} 无缓存，准备从网络加载。`);
            }

            if (this.loadingPromises.has(domain)) {
                return this.loadingPromises.get(domain);
            }

            const loadingPromise = this.fetchAndCacheFavicon(domain, url);
            this.loadingPromises.set(domain, loadingPromise);

            try {
                return await loadingPromise;
            } finally {
                this.loadingPromises.delete(domain);
            }
        } catch (error) {
            console.error(`获取favicon失败 (${domain}):`, error);
            return null;
        }
    }

    /**
     * 核心逻辑：获取、转换并缓存favicon
     */
    async fetchAndCacheFavicon(domain, url) {
        try {
            // 首先测试background通信是否正常
            const pingResult = await this.testBackgroundConnection();
            if (!pingResult) {
                throw new Error('Background script communication failed');
            }
            
            const faviconUrls = this.generateFaviconUrl(url);
            console.log(`[CACHE] 为 ${domain} 生成了 ${faviconUrls.length} 个候选favicon URL`);
            
            // 尝试每个URL直到成功
            for (let i = 0; i < faviconUrls.length; i++) {
                const faviconUrl = faviconUrls[i];
                console.log(`[CACHE] 尝试 ${domain} 的第 ${i + 1} 个URL: ${faviconUrl}`);
                
                const base64Data = await this.fetchAndConvertToBase64(faviconUrl);
                
                if (base64Data) {
                    await this.set(domain, base64Data, false);
                    console.log(`[CACHE] ✅ ${domain} 已成功获取并缓存为Base64 (使用第 ${i + 1} 个URL)`);
                    return base64Data;
                }
                
                console.log(`[CACHE] ❌ ${domain} 第 ${i + 1} 个URL失败，尝试下一个`);
            }
            
            throw new Error('All favicon URLs failed');
        } catch (error) {
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
