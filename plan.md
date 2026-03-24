# Quick Open Site - 设计与开发计划

## 项目概述

Chrome 扩展，通过快捷键（a-z, 0-9）快速打开收藏的书签网站。基于 Chrome Manifest V3，纯原生 HTML/CSS/JS 实现，无外部依赖。

---

## 技术架构

### 文件结构

```
├── manifest.json        # MV3 配置：permissions, service_worker, commands
├── background.js        # Service Worker：生命周期、右键菜单
├── shared.js            # BookmarkService：书签 CRUD 共享模块
├── popup.html/js        # 弹窗 UI：搜索、快捷键触发、内联编辑
├── dashboard.html/js    # 快捷键总览页：Grid 布局、拖拽、统计
├── options.html/js      # 设置页：bookmarkFolder、openInNewTab、导入导出
├── styles.css           # Popup 专用样式
├── mock-test.html       # 开发调试用 Mock 页面
└── plan.md              # 本文件
```

### 核心数据流

```
chrome.bookmarks API
        │
        ▼
BookmarkService.loadBookmarks(settings)
        │
        ├── findBookmarkFolder()     // 按名称递归查找目标文件夹
        ├── getAllBookmarks()         // 或遍历全部书签树
        ├── processBookmarkItems()   // 处理子文件夹（一级深度展开）
        ├── parseKeyMappings()       // 正则 /\[([a-z0-9])\]/i 提取快捷键
        │       ├── bookmark.key          = 提取的字母/数字
        │       └── bookmark.displayTitle = 去除 [key] 后的标题
        └── sortBookmarksByPriority()
                ├── pinned → keyboard(按key排序) → normal(按中文排序)
                └── 返回 { bookmarks, keyMapping: Map<key, bookmark[]> }
```

### 页面通信机制

| 场景 | 机制 |
|------|------|
| Popup ↔ Options 设置同步 | `chrome.storage.onChanged` 监听器 |
| Background → Popup 重载 | `chrome.runtime.onMessage` (`reload-bookmarks`) |
| 书签数据变更 | 直接调用 `chrome.bookmarks` API → 刷新 UI |

### 快捷键触发路径 (Popup)

```
用户按键 → handleKeyDown()
    ├── INPUT 聚焦中 → 跳过（让输入正常工作）
    ├── ` 键 → 聚焦搜索框
    ├── 搜索框内单字符 → 跳过（让搜索正常工作）
    ├── ↑/↓ → moveSelection() → updateSelection() → scrollIntoView
    ├── Enter → openBookmark() → chrome.tabs.create/update
    ├── Escape → window.close()
    └── a-z/0-9 → keyMapping.get(key) → openBookmarks() → 批量打开
```

---

## 关键实现细节

### 1. 书签标题解析规则

书签标题格式：`网站名称 [快捷键]`，例如 `GitHub [h]`。

```javascript
// shared.js - parseKeyMappings()
const match = bookmark.title.match(/\[([a-z0-9])\]/i);
bookmark.key = match[1].toLowerCase();
bookmark.displayTitle = bookmark.title.replace(/\s*\[[a-z0-9]\]/i, '').trim();
```

- 正则 `/\[([a-z0-9])\]/i` 匹配方括号内单个字母/数字
- `displayTitle` 去除 `[key]` 部分用于 UI 展示
- 同一个 key 可以绑定多个书签（keyMapping 为 `Map<string, bookmark[]>`）

### 2. 自定义 Tooltip 系统

替代浏览器原生 `title` 属性（响应延迟 ~1s），实现 50ms 快速响应。

**核心逻辑：**

```
mouseenter → setTimeout(50ms) → 检查文本是否溢出 → 显示 tooltip
mouseleave → 立即清除定时器 → 隐藏 tooltip
```

**是否显示的判定：**

```javascript
element.scrollWidth > element.clientWidth
```

只有文本被 CSS `text-overflow: ellipsis` 截断时才显示 tooltip，未截断则不显示（避免冗余信息）。

**定位算法：**
- 默认显示在元素上方，居中对齐
- 超出视口左右边界时自动偏移
- 超出视口顶部时翻转到元素下方（添加 `tooltip-below` 类切换箭头方向）

**Popup 和 Dashboard 独立实例：**
- Popup: `#customTooltip` + `.custom-tooltip` 样式（styles.css）
- Dashboard: `#dashTooltip` + `.dash-tooltip` 样式（dashboard.html 内联）
- 两者逻辑相同但独立实现，因为运行在不同页面上下文

### 3. 展示名称策略

| 区域 | 标题显示 | Tooltip 显示 |
|------|----------|-------------|
| Popup 列表 | `displayTitle` | `folder › displayTitle` |
| Dashboard 卡片 | `displayTitle` | `folder › displayTitle` |
| Dashboard 未绑定区域 | `folder › displayTitle` | 同左（仅溢出时） |

去除文件夹路径前缀的原因：卡片和列表空间有限，路径信息在 hover 时通过 tooltip 补充展示。

### 4. Favicon 加载机制

```javascript
// Chrome 扩展内置 favicon 服务
chrome.runtime.getURL('/_favicon/')  + ?pageUrl=...&size=24

// 渐进式加载：先显示首字母 fallback → 图片加载成功后切换
img.onload → 父元素.classList.add('loaded')
              └── CSS: .loaded .fav-fallback { opacity: 0 }
                       .loaded .fav-img { opacity: 1 }
```

### 5. 搜索与过滤

- **子序列匹配**：`matchSubsequence()` 支持非连续字符匹配（如 `gh` 匹配 `GitHub`）
- **单字符优先**：输入单个 a-z/0-9 时，精确快捷键匹配结果排在前面
- **当前页面置顶**：搜索为空时，当前浏览器标签页对应的书签自动置顶
- **防抖 250ms**：避免快速输入时频繁重渲染

### 6. Dashboard 拖拽换键

书签可在不同 key-card 之间拖拽，实现快捷键的快速重新分配。

**实现方案：HTML5 Drag and Drop API**

```
dragstart → 记录源书签数据 + 添加拖拽视觉效果
dragover  → 目标 card 高亮 + preventDefault 允许放置
dragleave → 移除高亮
drop      → 调用 BookmarkService.updateBookmarkKey(bookmark, targetKey)
dragend   → 清理所有拖拽状态
```

- 拖拽元素：`.card-bookmark` 行
- 放置目标：`.key-card`（通过 data-key 属性识别目标键位）
- 跨 Grid 拖拽支持（字母区 → 数字区）
- 未绑定区域的书签也可拖入卡片实现绑定

---

## 已完成功能

### Phase 1: 基础功能 ✅

- [x] 书签列表展示与搜索
- [x] 快捷键 a-z/0-9 快速打开
- [x] 子序列模糊搜索
- [x] 当前页面自动置顶
- [x] Ctrl+G / Cmd+G 全局快捷键唤起
- [x] 键盘导航（↑/↓/Enter/Escape/`）

### Phase 2: 书签管理 ✅

- [x] 内联编辑快捷键
- [x] 删除快捷键（保留书签）
- [x] 删除书签（含确认对话框）
- [x] 添加当前页面为快捷书签
- [x] 可用快捷键 Popover 提示

### Phase 3: 设置与配置 ✅

- [x] 书签文件夹范围配置
- [x] 新标签页/当前页打开选项
- [x] 右键菜单（设置/Dashboard/管理书签）
- [x] 设置实时同步（storage.onChanged）
- [x] 设置导入/导出

### Phase 4: 架构重构 ✅

- [x] shared.js 公共模块抽取（BookmarkService）
- [x] Popup header 增加 Dashboard/Settings 图标按钮
- [x] 移除无效的"右键打开设置"提示

### Phase 5: Dashboard 快捷键总览 ✅

- [x] A-Z / 0-9 Grid 布局卡片展示
- [x] 统计栏（已绑定/可用/总数/未绑定）
- [x] 卡片内书签展示（favicon + 标题 + URL）
- [x] 卡片内操作（编辑键、解绑、删除书签）
- [x] 未绑定书签列表（快速绑定输入）
- [x] Toast 通知

### Phase 6: UI/UX 优化 ✅

- [x] 展示名称优化：标题去掉文件夹路径，tooltip 展示完整路径
- [x] 自定义快速 Tooltip 替代原生 title（50ms 响应）
- [x] 卡片 header 增加"+"按钮（搜索绑定未绑定书签）
- [x] Dashboard 布局紧凑化（padding/margin/font-size 全面缩减）
- [x] 操作按钮 hover 时显示，非 hover 不占空间
- [x] Mock 测试页面

### Phase 7: 交互增强 ✅

- [x] Dashboard 书签拖拽换键（跨卡片拖拽重新分配快捷键）

---

## 后续功能规划

### 优先级 P0（近期）

- [ ] **搜索功能增强**：Dashboard 增加全局搜索框，快速定位某个键位或书签
- [ ] **键盘导航**：Dashboard 支持方向键在卡片间导航
- [ ] **批量操作**：多选书签批量解绑/删除

### 优先级 P1（中期）

- [ ] **书签分组**：支持按文件夹/标签对书签进行分组展示
- [ ] **最近使用**：记录书签打开频率，自动排序推荐
- [ ] **自定义主题**：支持暗色模式切换
- [ ] **快捷键冲突检测**：同一 key 绑定多个书签时的可视化提示

### 优先级 P2（远期）

- [ ] **云同步**：通过 chrome.storage.sync 跨设备同步快捷键配置
- [ ] **书签导入向导**：从浏览器书签批量导入并分配快捷键
- [ ] **Popup 分组视图**：按文件夹折叠/展开显示
- [ ] **快捷键方案**：支持多套快捷键方案切换（工作/个人/开发）
- [ ] **统计分析**：书签使用频率统计与可视化

---

## 开发约定

- **无外部依赖**：纯原生 HTML/CSS/JS，保持简单
- **Manifest V3**：使用 Service Worker，不使用 background page
- **共享逻辑统一**：所有书签 CRUD 通过 `BookmarkService`（shared.js）
- **页面独立样式**：Popup 用 styles.css，Dashboard 用内联 style（避免加载冲突）
- **安全规范**：不使用 innerHTML，使用 textContent + DOM API
