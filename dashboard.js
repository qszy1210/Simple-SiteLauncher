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

        this.init();
    }

    async init() {
        document.getElementById('settingsBtn').addEventListener('click', () => {
            chrome.runtime.openOptionsPage();
        });

        this.dragData = null;

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
        this.renderGrid(this.letterGrid, this.letterKeys);
        this.renderGrid(this.numberGrid, this.numberKeys);
        this.renderUnboundBookmarks();
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

        row.addEventListener('dragstart', (e) => {
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
        const url = document.createElement('div');
        url.className = 'card-url';
        url.textContent = BookmarkService.formatUrl(bookmark.url);
        this.setupTooltip(url, bookmark.url);
        info.appendChild(title);
        info.appendChild(url);
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
        row.addEventListener('click', () => {
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

            item.addEventListener('dragstart', (e) => {
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
