// dashboard.js - 快捷键总览页面逻辑（依赖 shared.js 中的 BookmarkService）
class DashboardManager {
    constructor() {
        this.bookmarks = [];
        this.keyMapping = new Map();
        this.settings = {};
        this.allKeys = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
        this.letterKeys = 'abcdefghijklmnopqrstuvwxyz'.split('');
        this.numberKeys = '0123456789'.split('');

        this.loadingEl = document.getElementById('loading');
        this.mainContent = document.getElementById('mainContent');
        this.statsBar = document.getElementById('statsBar');
        this.letterGrid = document.getElementById('letterGrid');
        this.numberGrid = document.getElementById('numberGrid');
        this.unboundSection = document.getElementById('unboundSection');
        this.unboundList = document.getElementById('unboundList');
        this.toastEl = document.getElementById('toast');
        this.tooltipEl = document.getElementById('dashTooltip');
        this.searchEl = document.getElementById('dashSearch');

        this.popoverEl = document.getElementById('dashPopover');
        this.popoverContentEl = document.getElementById('dashPopoverContent');
        this.hidePopoverTimeout = null;
        this.activePopoverInput = null;

        this.batchMode = false;
        this.selectedBookmarks = new Set();
        this.batchBar = document.getElementById('batchBar');
        this.batchCountEl = document.getElementById('batchCount');

        this.recentSection = document.getElementById('recentSection');
        this.recentList = document.getElementById('recentList');

        this.dragData = null;

        this.init();
    }

    async init() {
        document.getElementById('settingsBtn').addEventListener('click', () => {
            chrome.runtime.openOptionsPage();
        });

        let searchDebounce = null;
        this.searchEl.addEventListener('input', () => {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => {
                this.filterDashboard(this.searchEl.value.trim());
            }, 250);
        });

        document.getElementById('batchModeBtn').addEventListener('click', () => {
            this.toggleBatchMode();
        });
        document.getElementById('batchSelectAll').addEventListener('click', () => {
            this.batchSelectAll();
        });
        document.getElementById('batchUnbind').addEventListener('click', () => {
            this.batchUnbind();
        });
        document.getElementById('batchDelete').addEventListener('click', () => {
            this.batchDelete();
        });

        document.getElementById('clearUsageBtn').addEventListener('click', async () => {
            if (!confirm('确定要清除所有使用记录吗？')) return;
            try {
                await BookmarkService.clearUsageStats();
                this.showToast('使用记录已清除', true);
                await this.refresh();
            } catch (err) {
                this.showToast('清除失败', false);
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.batchMode) {
                this.toggleBatchMode();
            }
        });

        this.popoverEl.addEventListener('mousedown', (e) => e.preventDefault());

        this.settings = await BookmarkService.loadSettings();
        await this.refresh();
    }

    async refresh() {
        this.loadingEl.style.display = 'flex';
        this.mainContent.style.display = 'none';

        try {
            const { bookmarks, keyMapping } = await BookmarkService.loadBookmarks(this.settings);
            this.bookmarks = bookmarks;
            this.keyMapping = keyMapping;
            this.render();
        } catch (error) {
            console.error('加载书签失败:', error);
            this.showToast('加载书签失败', false);
        } finally {
            this.loadingEl.style.display = 'none';
            this.mainContent.style.display = 'block';
        }
    }

    render() {
        this.renderStats();
        this.renderRecentBookmarks();
        this.renderGrid(this.letterGrid, this.letterKeys);
        this.renderGrid(this.numberGrid, this.numberKeys);
        this.renderUnboundBookmarks();
        if (this.searchEl.value.trim()) {
            this.filterDashboard(this.searchEl.value.trim());
        }
    }

    // --- Search / filter ---
    filterDashboard(query) {
        const lowerQ = query.toLowerCase();

        document.querySelectorAll('.key-card').forEach(card => {
            if (!lowerQ) {
                card.style.display = '';
                card.querySelectorAll('.card-bookmark').forEach(r => r.style.display = '');
                return;
            }
            const key = card.dataset.key;
            const keyMatch = key === lowerQ;
            const rows = card.querySelectorAll('.card-bookmark');
            let anyRowMatch = false;

            rows.forEach(row => {
                const bm = row.__bookmarkData;
                if (!bm) { row.style.display = ''; return; }
                const rowMatch = bm.displayTitle.toLowerCase().includes(lowerQ) ||
                    bm.url.toLowerCase().includes(lowerQ) ||
                    (bm.folder && bm.folder.toLowerCase().includes(lowerQ));
                row.style.display = (keyMatch || rowMatch) ? '' : 'none';
                if (rowMatch) anyRowMatch = true;
            });

            card.style.display = (keyMatch || anyRowMatch) ? '' : 'none';
        });

        document.querySelectorAll('.unbound-item').forEach(item => {
            if (!lowerQ) { item.style.display = ''; return; }
            const bm = item.__bookmarkData;
            if (!bm) { item.style.display = ''; return; }
            const match = bm.displayTitle.toLowerCase().includes(lowerQ) ||
                bm.url.toLowerCase().includes(lowerQ) ||
                (bm.folder && bm.folder.toLowerCase().includes(lowerQ));
            item.style.display = match ? '' : 'none';
        });
    }

    // --- Recent usage ---
    renderRecentBookmarks() {
        this.recentList.textContent = '';
        const recentItems = this.bookmarks
            .filter(bm => bm.lastUsed > 0)
            .sort((a, b) => b.lastUsed - a.lastUsed)
            .slice(0, 8);

        if (recentItems.length === 0) {
            this.recentSection.style.display = 'none';
            return;
        }

        this.recentSection.style.display = 'block';

        recentItems.forEach(bookmark => {
            const card = document.createElement('div');
            card.className = 'recent-card';

            const top = document.createElement('div');
            top.className = 'recent-card-top';

            const favicon = document.createElement('div');
            favicon.className = 'card-favicon';
            const fallback = document.createElement('span');
            fallback.className = 'fav-fallback';
            fallback.textContent = bookmark.displayTitle.charAt(0).toUpperCase();
            favicon.appendChild(fallback);
            const img = new Image();
            img.className = 'fav-img';
            img.onload = () => { favicon.classList.add('loaded'); };
            img.onerror = () => { if (img.parentNode) img.remove(); };
            img.src = BookmarkService.getFaviconUrl(bookmark.url);
            favicon.appendChild(img);
            top.appendChild(favicon);

            if (bookmark.key) {
                const badge = document.createElement('span');
                badge.className = 'recent-key-badge';
                badge.textContent = bookmark.key.toUpperCase();
                top.appendChild(badge);
            }

            card.appendChild(top);

            const title = document.createElement('div');
            title.className = 'recent-card-title';
            title.textContent = bookmark.displayTitle;
            this.setupTooltip(title, bookmark.folder ? `${bookmark.folder} \u203A ${bookmark.displayTitle}` : bookmark.displayTitle);
            card.appendChild(title);

            const meta = document.createElement('div');
            meta.className = 'recent-card-meta';
            const time = document.createElement('span');
            time.className = 'recent-time';
            time.textContent = this.formatRelativeTime(bookmark.lastUsed);
            const count = document.createElement('span');
            count.className = 'recent-count';
            count.textContent = `x${bookmark.usageCount}`;
            meta.appendChild(time);
            meta.appendChild(count);
            card.appendChild(meta);

            card.addEventListener('click', () => {
                BookmarkService.recordUsage(bookmark.id);
                chrome.tabs.create({ url: bookmark.url });
            });

            this.recentList.appendChild(card);
        });
    }

    formatRelativeTime(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        const weeks = Math.floor(days / 7);

        if (seconds < 60) return '\u521A\u521A';
        if (minutes < 60) return `${minutes}\u5206\u949F\u524D`;
        if (hours < 24) return `${hours}\u5C0F\u65F6\u524D`;
        if (days === 1) return '\u6628\u5929';
        if (days < 7) return `${days}\u5929\u524D`;
        if (weeks < 4) return `${weeks}\u5468\u524D`;
        return `${Math.floor(days / 30)}\u6708\u524D`;
    }

    // --- Batch mode ---
    toggleBatchMode() {
        this.batchMode = !this.batchMode;
        this.selectedBookmarks.clear();
        this.updateBatchCount();

        const container = document.querySelector('.container');
        if (this.batchMode) {
            container.classList.add('batch-mode');
            this.batchBar.classList.add('show');
        } else {
            container.classList.remove('batch-mode');
            this.batchBar.classList.remove('show');
            document.querySelectorAll('.batch-selected').forEach(el => el.classList.remove('batch-selected'));
        }
    }

    handleBatchClick(element, bookmark) {
        if (!this.batchMode) return false;
        const bmId = bookmark.id;
        if (this.selectedBookmarks.has(bmId)) {
            this.selectedBookmarks.delete(bmId);
            element.classList.remove('batch-selected');
        } else {
            this.selectedBookmarks.add(bmId);
            element.classList.add('batch-selected');
        }
        this.updateBatchCount();
        return true;
    }

    updateBatchCount() {
        this.batchCountEl.textContent = this.selectedBookmarks.size;
    }

    batchSelectAll() {
        const visibleItems = [
            ...document.querySelectorAll('.card-bookmark:not([style*="display: none"])'),
            ...document.querySelectorAll('.unbound-item:not([style*="display: none"])')
        ];
        const allSelected = visibleItems.length > 0 && visibleItems.every(el => el.classList.contains('batch-selected'));

        visibleItems.forEach(el => {
            const bm = el.__bookmarkData;
            if (!bm) return;
            if (allSelected) {
                this.selectedBookmarks.delete(bm.id);
                el.classList.remove('batch-selected');
            } else {
                this.selectedBookmarks.add(bm.id);
                el.classList.add('batch-selected');
            }
        });
        this.updateBatchCount();
    }

    async batchUnbind() {
        if (this.selectedBookmarks.size === 0) return;
        const toUnbind = this.bookmarks.filter(bm => bm.key && this.selectedBookmarks.has(bm.id));
        if (toUnbind.length === 0) {
            this.showToast('选中书签均无快捷键', false);
            return;
        }
        try {
            for (const bm of toUnbind) {
                await BookmarkService.deleteBookmarkKey(bm);
            }
            this.showToast(`已解绑 ${toUnbind.length} 个书签`, true);
            this.toggleBatchMode();
            await this.refresh();
        } catch (err) {
            this.showToast('批量解绑失败', false);
        }
    }

    async batchDelete() {
        if (this.selectedBookmarks.size === 0) return;
        const count = this.selectedBookmarks.size;
        if (!confirm(`确定要删除选中的 ${count} 个书签吗？此操作不可撤销。`)) return;
        try {
            for (const bmId of this.selectedBookmarks) {
                await BookmarkService.deleteBookmark(bmId);
            }
            this.showToast(`已删除 ${count} 个书签`, true);
            this.toggleBatchMode();
            await this.refresh();
        } catch (err) {
            this.showToast('批量删除失败', false);
        }
    }

    // --- Popover for available keys ---
    updateDashPopover(excludeKey) {
        const usedKeys = new Set(this.keyMapping.keys());
        if (excludeKey) usedKeys.delete(excludeKey);
        const availableKeys = this.allKeys.filter(k => !usedKeys.has(k));

        this.popoverContentEl.textContent = '';
        if (availableKeys.length === 0) {
            this.popoverContentEl.textContent = '所有快捷键已被占用';
            return;
        }
        availableKeys.forEach(key => {
            const el = document.createElement('div');
            el.className = 'available-key';
            el.textContent = key;
            el.addEventListener('click', () => {
                if (this.activePopoverInput) {
                    this.activePopoverInput.value = key;
                    this.activePopoverInput.focus();
                }
            });
            this.popoverContentEl.appendChild(el);
        });
    }

    showDashPopover(inputEl, excludeKey) {
        clearTimeout(this.hidePopoverTimeout);
        this.activePopoverInput = inputEl;
        this.updateDashPopover(excludeKey);

        const rect = inputEl.getBoundingClientRect();
        const popW = 280;
        let left = rect.left + (rect.width / 2) - (popW / 2);
        if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
        if (left < 8) left = 8;

        this.popoverEl.style.width = popW + 'px';
        this.popoverEl.style.display = 'block';

        const popH = this.popoverEl.offsetHeight;
        let top = rect.top - popH - 8;
        if (top < 8) top = rect.bottom + 8;

        this.popoverEl.style.left = `${left}px`;
        this.popoverEl.style.top = `${top}px`;
    }

    hideDashPopover() {
        this.hidePopoverTimeout = setTimeout(() => {
            this.popoverEl.style.display = 'none';
            this.activePopoverInput = null;
        }, 150);
    }

    setupPopoverForInput(inputEl, excludeKey) {
        inputEl.addEventListener('focus', () => {
            this.showDashPopover(inputEl, excludeKey);
        });
        inputEl.addEventListener('blur', () => {
            this.hideDashPopover();
        });
    }

    // --- Tooltip system (same fast approach as popup) ---
    setupTooltip(element, fullText) {
        let showTimeout = null;
        let current = null;
        element.addEventListener('mouseenter', () => {
            current = element;
            showTimeout = setTimeout(() => {
                if (current === element && element.scrollWidth > element.clientWidth) {
                    this.showTip(element, fullText);
                }
            }, 50);
        });
        element.addEventListener('mouseleave', () => {
            current = null;
            if (showTimeout) { clearTimeout(showTimeout); showTimeout = null; }
            this.hideTip();
        });
    }

    showTip(element, text) {
        const tip = this.tooltipEl;
        tip.textContent = text;
        tip.style.display = 'block';
        const rect = element.getBoundingClientRect();
        const tipW = tip.offsetWidth || 300;
        const tipH = tip.offsetHeight || 40;
        let left = rect.left + (rect.width / 2) - (tipW / 2);
        let top = rect.top - tipH - 10;
        if (left + tipW > window.innerWidth - 8) left = window.innerWidth - tipW - 8;
        if (left < 8) left = 8;
        tip.classList.remove('tip-below');
        if (top < 8) { top = rect.bottom + 10; tip.classList.add('tip-below'); }
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
        requestAnimationFrame(() => { tip.classList.add('show'); });
    }

    hideTip() {
        this.tooltipEl.classList.remove('show');
        setTimeout(() => {
            if (!this.tooltipEl.classList.contains('show')) this.tooltipEl.style.display = 'none';
        }, 100);
    }

    // --- Stats ---
    renderStats() {
        const boundCount = new Set(this.keyMapping.keys()).size;
        const totalKeys = this.allKeys.length;
        const unboundBookmarks = this.bookmarks.filter(b => !b.key).length;
        const totalBookmarks = this.bookmarks.length;

        this.statsBar.textContent = '';
        const stats = [
            { value: boundCount, label: '已绑定' },
            { value: totalKeys - boundCount, label: '可用' },
            { value: totalBookmarks, label: '总书签' },
            { value: unboundBookmarks, label: '未绑定' }
        ];

        stats.forEach(s => {
            const card = document.createElement('div');
            card.className = 'stat-card';
            const val = document.createElement('div');
            val.className = 'stat-value';
            val.textContent = s.value;
            const lbl = document.createElement('div');
            lbl.className = 'stat-label';
            lbl.textContent = s.label;
            card.appendChild(val);
            card.appendChild(lbl);
            this.statsBar.appendChild(card);
        });
    }

    // --- Grid rendering ---
    renderGrid(container, keys) {
        container.textContent = '';
        keys.forEach(key => {
            const boundBookmarks = this.keyMapping.get(key) || [];
            const card = this.createKeyCard(key, boundBookmarks);
            container.appendChild(card);
        });
    }

    createKeyCard(key, boundBookmarks) {
        const card = document.createElement('div');
        card.className = 'key-card' + (boundBookmarks.length === 0 ? ' empty' : '');
        card.dataset.key = key;

        const header = document.createElement('div');
        header.className = 'key-card-header';

        const badge = document.createElement('div');
        badge.className = 'key-badge';
        badge.textContent = key.toUpperCase();
        header.appendChild(badge);

        const addBtn = document.createElement('button');
        addBtn.className = 'key-add-btn';
        addBtn.textContent = '+';
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showAddForm(card, key);
        });
        header.appendChild(addBtn);

        card.appendChild(header);

        if (boundBookmarks.length > 0) {
            boundBookmarks.forEach(bm => {
                card.appendChild(this.createCardBookmark(bm, card));
            });
        } else {
            const hint = document.createElement('div');
            hint.className = 'empty-hint';
            hint.textContent = '未绑定';
            card.appendChild(hint);
        }

        const editForm = this.createCardEditForm(key, card);
        card.appendChild(editForm);

        const addForm = this.createCardAddForm(key, card);
        card.appendChild(addForm);

        const confirmOverlay = this.createConfirmDeleteOverlay();
        card.appendChild(confirmOverlay);

        this.setupDropTarget(card, key);

        return card;
    }

    setupDropTarget(card, key) {
        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!this.dragData) return;
            if (this.dragData.sourceKey === key) return;
            e.dataTransfer.dropEffect = 'move';
            card.classList.add('drag-over');
        });

        card.addEventListener('dragleave', (e) => {
            if (!card.contains(e.relatedTarget)) {
                card.classList.remove('drag-over');
            }
        });

        card.addEventListener('drop', async (e) => {
            e.preventDefault();
            card.classList.remove('drag-over');
            if (!this.dragData) return;
            const bm = this.dragData.bookmark;
            if (this.dragData.sourceKey === key) return;
            try {
                await BookmarkService.updateBookmarkKey(bm, key);
                this.showToast(`${bm.displayTitle} \u2192 [${key.toUpperCase()}]`, true);
                await this.refresh();
            } catch (err) {
                this.showToast('\u62D6\u62FD\u5931\u8D25', false);
            }
            this.dragData = null;
        });
    }

    createCardBookmark(bookmark, card) {
        const row = document.createElement('div');
        row.className = 'card-bookmark';
        row.draggable = true;
        row.__bookmarkData = bookmark;

        row.addEventListener('dragstart', (e) => {
            if (this.batchMode) { e.preventDefault(); return; }
            this.dragData = { bookmark, sourceKey: bookmark.key };
            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', bookmark.displayTitle);
        });

        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            this.dragData = null;
            document.querySelectorAll('.key-card.drag-over').forEach(c => c.classList.remove('drag-over'));
        });

        const favicon = document.createElement('div');
        favicon.className = 'card-favicon';
        const fallback = document.createElement('span');
        fallback.className = 'fav-fallback';
        fallback.textContent = bookmark.displayTitle.charAt(0).toUpperCase();
        favicon.appendChild(fallback);

        const img = new Image();
        img.className = 'fav-img';
        img.onload = () => { favicon.classList.add('loaded'); };
        img.onerror = () => { if (img.parentNode) img.remove(); };
        img.src = BookmarkService.getFaviconUrl(bookmark.url);
        favicon.appendChild(img);
        row.appendChild(favicon);

        const info = document.createElement('div');
        info.className = 'card-info';
        const title = document.createElement('div');
        title.className = 'card-title';
        title.textContent = bookmark.displayTitle;
        const fullPath = bookmark.folder ? `${bookmark.folder} \u203A ${bookmark.displayTitle}` : bookmark.displayTitle;
        this.setupTooltip(title, fullPath);
        const urlRow = document.createElement('div');
        urlRow.className = 'card-url';
        urlRow.style.display = 'flex';
        urlRow.style.alignItems = 'center';
        const urlText = document.createElement('span');
        urlText.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0';
        urlText.textContent = BookmarkService.formatUrl(bookmark.url);
        this.setupTooltip(urlText, bookmark.url);
        urlRow.appendChild(urlText);
        if (bookmark.usageCount > 0) {
            const usageBadge = document.createElement('span');
            usageBadge.className = 'usage-badge';
            usageBadge.textContent = `${bookmark.usageCount}\u6B21`;
            urlRow.appendChild(usageBadge);
        }
        info.appendChild(title);
        info.appendChild(urlRow);
        row.appendChild(info);

        const actions = document.createElement('div');
        actions.className = 'card-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'card-action-btn';
        editBtn.textContent = '\u270F\uFE0F';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showEditForm(card, bookmark);
        });

        const unbindBtn = document.createElement('button');
        unbindBtn.className = 'card-action-btn';
        unbindBtn.textContent = '\u232B';
        unbindBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                await BookmarkService.deleteBookmarkKey(bookmark);
                this.showToast('快捷键已删除', true);
                await this.refresh();
            } catch (err) {
                this.showToast('操作失败', false);
            }
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'card-action-btn danger';
        deleteBtn.textContent = '\uD83D\uDDD1\uFE0F';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showConfirmDelete(card, bookmark);
        });

        actions.appendChild(editBtn);
        actions.appendChild(unbindBtn);
        actions.appendChild(deleteBtn);
        row.appendChild(actions);

        row.style.cursor = 'pointer';
        row.addEventListener('click', (e) => {
            if (this.handleBatchClick(row, bookmark)) return;
            BookmarkService.recordUsage(bookmark.id);
            chrome.tabs.create({ url: bookmark.url });
        });

        return row;
    }

    // --- Edit form (change key) ---
    createCardEditForm(key, card) {
        const form = document.createElement('div');
        form.className = 'card-edit-form';

        const row = document.createElement('div');
        row.className = 'card-edit-row';

        const label = document.createElement('span');
        label.textContent = '改键:';
        label.style.cssText = 'font-size:11px;color:#64748B';

        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 1;
        input.className = 'card-edit-input key-input';
        input.placeholder = key;

        this.setupPopoverForInput(input, key);

        const saveBtn = document.createElement('button');
        saveBtn.className = 'card-edit-btn save';
        saveBtn.textContent = '\u2705';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'card-edit-btn cancel';
        cancelBtn.textContent = '\u274C';

        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            form.classList.remove('active');
            form.__bookmark = null;
        });

        saveBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const bm = form.__bookmark;
            if (!bm) return;
            const newKey = input.value.trim().toLowerCase();
            if (!newKey || !/^[a-z0-9]$/.test(newKey)) return;
            try {
                await BookmarkService.updateBookmarkKey(bm, newKey);
                this.showToast('快捷键已更新', true);
                await this.refresh();
            } catch (err) {
                this.showToast('操作失败', false);
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveBtn.click();
            if (e.key === 'Escape') cancelBtn.click();
        });

        row.appendChild(label);
        row.appendChild(input);
        row.appendChild(saveBtn);
        row.appendChild(cancelBtn);
        form.appendChild(row);
        return form;
    }

    showEditForm(card, bookmark) {
        card.querySelectorAll('.card-edit-form, .card-add-form').forEach(f => f.classList.remove('active'));
        const form = card.querySelector('.card-edit-form');
        form.__bookmark = bookmark;
        form.classList.add('active');
        const input = form.querySelector('.key-input');
        input.value = bookmark.key || '';
        input.focus();
    }

    // --- Add form (bind existing bookmark to this key) ---
    createCardAddForm(key, card) {
        const form = document.createElement('div');
        form.className = 'card-add-form';

        const row = document.createElement('div');
        row.className = 'card-edit-row';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'card-edit-input';
        input.placeholder = '输入书签名称搜索...';
        input.style.flex = '1';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'card-edit-btn cancel';
        cancelBtn.textContent = '\u274C';
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            form.classList.remove('active');
            results.textContent = '';
        });

        row.appendChild(input);
        row.appendChild(cancelBtn);
        form.appendChild(row);

        const results = document.createElement('div');
        results.className = 'add-search-results';
        form.appendChild(results);

        let debounce = null;
        input.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                this.renderAddSearchResults(results, input.value.trim(), key);
            }, 200);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') cancelBtn.click();
        });

        return form;
    }

    renderAddSearchResults(container, query, targetKey) {
        container.textContent = '';
        if (!query) return;

        const lowerQ = query.toLowerCase();
        const unboundBookmarks = this.bookmarks.filter(b => !b.key);
        const matches = unboundBookmarks.filter(b =>
            b.displayTitle.toLowerCase().includes(lowerQ) ||
            b.url.toLowerCase().includes(lowerQ) ||
            (b.folder && b.folder.toLowerCase().includes(lowerQ))
        ).slice(0, 5);

        if (matches.length === 0) {
            const hint = document.createElement('div');
            hint.className = 'add-no-result';
            hint.textContent = '未找到匹配的未绑定书签';
            container.appendChild(hint);
            return;
        }

        matches.forEach(bm => {
            const item = document.createElement('div');
            item.className = 'add-result-item';

            const name = document.createElement('span');
            name.className = 'add-result-name';
            name.textContent = bm.displayTitle;

            const bindBtn = document.createElement('button');
            bindBtn.className = 'quick-bind-btn';
            bindBtn.textContent = `\u7ED1\u5B9A [${targetKey.toUpperCase()}]`;
            bindBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    await BookmarkService.updateBookmarkKey(bm, targetKey);
                    this.showToast(`${bm.displayTitle} \u2192 [${targetKey.toUpperCase()}]`, true);
                    await this.refresh();
                } catch (err) {
                    this.showToast('绑定失败', false);
                }
            });

            item.appendChild(name);
            item.appendChild(bindBtn);
            container.appendChild(item);
        });
    }

    showAddForm(card, key) {
        card.querySelectorAll('.card-edit-form, .card-add-form').forEach(f => f.classList.remove('active'));
        const form = card.querySelector('.card-add-form');
        form.classList.add('active');
        const input = form.querySelector('input');
        input.value = '';
        form.querySelector('.add-search-results').textContent = '';
        input.focus();
    }

    // --- Confirm delete ---
    createConfirmDeleteOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'card-confirm-delete';

        const msg = document.createElement('p');
        msg.textContent = '确认删除此书签？';

        const actions = document.createElement('div');
        actions.className = 'card-confirm-actions';

        const noBtn = document.createElement('button');
        noBtn.className = 'confirm-no';
        noBtn.textContent = '取消';
        noBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            overlay.classList.remove('active');
        });

        const yesBtn = document.createElement('button');
        yesBtn.className = 'confirm-yes';
        yesBtn.textContent = '删除';

        actions.appendChild(noBtn);
        actions.appendChild(yesBtn);
        overlay.appendChild(msg);
        overlay.appendChild(actions);
        return overlay;
    }

    showConfirmDelete(card, bookmark) {
        const overlay = card.querySelector('.card-confirm-delete');
        overlay.classList.add('active');
        const yesBtn = overlay.querySelector('.confirm-yes');
        const handler = async (e) => {
            e.stopPropagation();
            yesBtn.removeEventListener('click', handler);
            try {
                await BookmarkService.deleteBookmark(bookmark.id);
                this.showToast('书签已删除', true);
                await this.refresh();
            } catch (err) {
                this.showToast('删除失败', false);
            }
        };
        yesBtn.addEventListener('click', handler);
    }

    // --- Unbound bookmarks (keep full path here) ---
    renderUnboundBookmarks() {
        const unboundBookmarks = this.bookmarks.filter(b => !b.key);
        this.unboundList.textContent = '';

        if (unboundBookmarks.length === 0) {
            this.unboundSection.style.display = 'none';
            return;
        }

        this.unboundSection.style.display = 'block';

        unboundBookmarks.forEach(bookmark => {
            const item = document.createElement('div');
            item.className = 'unbound-item';
            item.draggable = true;
            item.__bookmarkData = bookmark;

            item.addEventListener('dragstart', (e) => {
                if (this.batchMode) { e.preventDefault(); return; }
                this.dragData = { bookmark, sourceKey: null };
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', bookmark.displayTitle);
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                this.dragData = null;
                document.querySelectorAll('.key-card.drag-over').forEach(c => c.classList.remove('drag-over'));
            });

            item.addEventListener('click', (e) => {
                if (this.batchMode) {
                    this.handleBatchClick(item, bookmark);
                }
            });

            const favicon = document.createElement('div');
            favicon.className = 'card-favicon';
            const fallback = document.createElement('span');
            fallback.className = 'fav-fallback';
            fallback.textContent = bookmark.displayTitle.charAt(0).toUpperCase();
            favicon.appendChild(fallback);

            const img = new Image();
            img.className = 'fav-img';
            img.onload = () => { favicon.classList.add('loaded'); };
            img.onerror = () => { if (img.parentNode) img.remove(); };
            img.src = BookmarkService.getFaviconUrl(bookmark.url);
            favicon.appendChild(img);
            item.appendChild(favicon);

            const info = document.createElement('div');
            info.className = 'unbound-info';
            const title = document.createElement('div');
            title.className = 'unbound-title';
            title.textContent = bookmark.folder ? `${bookmark.folder} \u203A ${bookmark.displayTitle}` : bookmark.displayTitle;
            this.setupTooltip(title, title.textContent);
            const url = document.createElement('div');
            url.className = 'unbound-url';
            url.textContent = BookmarkService.formatUrl(bookmark.url);
            this.setupTooltip(url, bookmark.url);
            info.appendChild(title);
            info.appendChild(url);
            item.appendChild(info);

            const actions = document.createElement('div');
            actions.className = 'unbound-actions';

            const input = document.createElement('input');
            input.type = 'text';
            input.maxLength = 1;
            input.className = 'quick-bind-input';
            input.placeholder = 'key';

            this.setupPopoverForInput(input, null);

            const bindBtn = document.createElement('button');
            bindBtn.className = 'quick-bind-btn';
            bindBtn.textContent = '绑定';
            bindBtn.addEventListener('click', async () => {
                const key = input.value.trim().toLowerCase();
                if (!key || !/^[a-z0-9]$/.test(key)) {
                    input.style.borderColor = '#DC2626';
                    setTimeout(() => { input.style.borderColor = '#E2E8F0'; }, 800);
                    return;
                }
                try {
                    await BookmarkService.updateBookmarkKey(bookmark, key);
                    this.showToast(`已绑定到 [${key.toUpperCase()}]`, true);
                    await this.refresh();
                } catch (err) {
                    this.showToast('绑定失败', false);
                }
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') bindBtn.click();
            });

            actions.appendChild(input);
            actions.appendChild(bindBtn);
            item.appendChild(actions);

            this.unboundList.appendChild(item);
        });
    }

    showToast(message, success) {
        this.toastEl.textContent = message;
        this.toastEl.className = 'toast ' + (success ? 'success' : 'error');
        this.toastEl.classList.add('show');
        setTimeout(() => {
            this.toastEl.classList.remove('show');
        }, 2000);
    }
}

document.addEventListener('DOMContentLoaded', () => new DashboardManager());
