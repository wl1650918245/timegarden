# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## 项目概述

**周计划盆栽 (Weekly Planner Plant Pot)** — 轻量化桌面事项管理工具，以植物生长/枯萎的视觉反馈 + 花瓣进度环提供直观的周计划进度感知。

- **类型**: Electron 35 桌面应用
- **核心隐喻**: 植物状态反映任务完成度，花瓣环反映工作日进度
- **设计风格**: Dark Glass + Rich Emerald（暗色） / Warm Ceramic（亮色），双主题
- **三视图**: Nano（悬浮花）→ Mini（花盆）→ Full（完整面板）

---

## 技术架构

| 层 | 技术 |
|---|------|
| 桌面框架 | Electron 35 |
| 渲染层 | HTML + CSS + Vanilla JS（单文件架构） |
| 数据存储 | 本地 JSON (`user-data/data/`) |
| 图形 | 内联 SVG（植物 + 花瓣环 + Nano 花） |

## 项目结构

```
Time_manage/
├── main.js              # Electron 主进程（窗口管理、IPC、托盘、数据存取）
├── preload.js           # contextBridge IPC 桥接
├── package.json
├── SPEC.md              # 产品需求文档
├── nano-spec.md         # Nano 悬浮花模式实现 Spec
├── CLAUDE.md            # 本文件
├── src/
│   ├── index.html       # 三视图 HTML + 内联 SVG
│   ├── style.css        # 暗色主题样式（~1300 行）
│   ├── style-old.css    # 亮色主题样式（~1600 行）
│   └── app.js           # 全部交互逻辑（~2040 行）
├── user-data/           # 运行时数据目录
└── node_modules/
```

---

## 三视图模式

| 模式 | 尺寸 | 窗口属性 |
|------|------|---------|
| **Nano** (悬浮花) | 48×68 | 不可缩放；专注时可缩放（≥160×56） |
| **Mini** (花盆态) | 360×310（可拖边缩放 ≥280×240） | 可缩放 |
| **Full** (完整面板) | 720×520（可拖边缩放 ≥480×360） | 可缩放 |

### Nano 悬浮花
- 花右对齐 (right:0)，状态圆点（绿=盛开/粉=花苞/棕=枯萎/绿脉冲=专注中）
- 悬停 → 窗口扩展 230×270，显示周进度预览面板（全部任务列表）
- 右键 → 快捷菜单（添加任务/查看进度/展开到花盆/展开到面板/退到托盘）
- 单击 → Mini；双击 → Full
- 可拖动

### Nano 专注模式
- 开始专注：根据任务名长度自适应窗口宽度（180~440px）
- 计时条：⏱ 图标 + 任务名（flex:1, 溢出省略）+ 计时器（0:00 / 1:23:45）
- 点击 ⏱ 或花朵 → 停止专注，累计时间写回 `task.weeklyTimeMs`
- 退出专注后自动缩回 48×68（`nanoShrink` IPC + 冷却期防 hover 回弹）
- 专注窗口可拖边缩放，下次记住自定义尺寸

### Mini 花盆态
- 花盆 + 植物 SVG 居中，气泡任务卡片浮动于花盆上方
- 活跃气泡在右侧（动态均匀分布），已完成气泡在左侧
- 气泡可**自由拖动**，位置保存到 localStorage
- 底部进度条

### Full 完整面板
- 顶栏：周数/日期 + 进度统计 + 窗口控制
- 左面板：植物 + 花瓣环 + 要事列表（可拖拽排序）
- 右面板：待办清单（可折叠）
- 任务双击/单击标题 → 进入编辑（两行布局：标题 + 日期/优先级/确认/取消）

---

## 数据模型

```javascript
interface Task {
  id: string;
  title: string;
  completed: boolean;
  priority: 'high' | 'medium' | 'low';
  deadline: string | null;       // "YYYY-MM-DD"
  createdAt: string;             // ISO
  weeklyTimeMs: number;          // 本周专注累计毫秒
}

interface WeekData {
  weekKey: string;               // "2026-W23"
  important: Task[];
  todos: Task[];
}
```

---

## 主题系统

两个独立 CSS 文件，通过 `<link href>` 切换：

| 主题 | 文件 | 触发 |
|------|------|------|
| 暗色 (Dark Glass) | `style.css` | 默认，`data-theme="dark"` |
| 亮色 (Warm Ceramic) | `style-old.css` | `data-theme="light"` |

**关键规则**：任何样式改动必须在两个文件中**同步**。用 `grep` 对比验证。

---

## 专注计时系统

```javascript
let focusState = {
  taskId: null,          // 当前专注的任务 ID
  taskTitle: '',         // 缓存任务标题
  taskList: '',          // 'important' | 'todos'
  startedAt: null,       // 本次专注开始时间戳
  accumulatedMs: 0,      // 历史累积毫秒
};
let focusInterval = null;  // 1秒 tick
```

### 关键函数
| 函数 | 用途 |
|------|------|
| `startFocus(taskId, listType)` | 开始专注：切到 Nano → 自适应宽度 → 启动计时 |
| `stopFocus()` | 停止专注：累积时间写回 → 缩窗 → 防 hover 回弹 |
| `formatFocusTime(ms)` | 格式化：<1h 显示 m:ss，≥1h 显示 h:mm:ss |
| `updateNanoFocusDisplay()` | 每秒更新计时条（任务名 + 计时器） |

### 全局冷却变量
`nanoCoolingDown` 是**全局变量**（非 `setupEventListeners` 内部），供 `stopFocus()` 和 hover 守卫共用。

---

## 关键函数速查 (src/app.js)

| 函数 | 用途 |
|------|------|
| `init()` | 入口：加载主题 → 加载气泡位置 → 加载数据 → renderAll |
| `renderAll()` | 核心渲染：同时更新 nano/mini/full 三视图 |
| `renderMini()` | Mini 气泡渲染（动态位置 + 自定义拖拽位置） |
| `renderFull()` | Full 面板渲染（要事 + 待办） |
| `renderNano()` | Nano 花状态更新（专注/盛开/花苞/枯萎） |
| `renderNanoHover()` | Nano 预览面板（全部任务列表） |
| `updateMiniPlant()` / `updateFullPlant()` | 植物 SVG 更新 |
| `switchView(target, focusWidth?)` | 三态切换，专注时可传宽度 |
| `startFocus(id, listType)` / `stopFocus()` | 专注计时控制 |
| `handleTaskDblClick(e)` | 双击/单击标题进入编辑（两行布局） |
| `getTaskUrgency(task)` | 紧迫度计算 |
| `setupBubbleDrag()` | Mini 气泡自由拖动 |
| `loadBubblePositions()` / `saveBubblePositions()` | 气泡位置 localStorage 持久化 |

---

## IPC 通道

### invoke (renderer → main)
| Channel | 参数 | 用途 |
|---------|------|------|
| `load-data` / `save-data` | (data?) | 读写 current.json |
| `archive-week` | ({weekKey, data}) | 归档旧周 |
| `set-mode` | (mode) | 切换 nano/mini/full + 控制缩放 |
| `nano-hover` | (hovering) | 悬停扩展/恢复窗口 |
| `nano-focus-mode` | (active, suggestedWidth?) | 进入/退出专注，传递建议宽度 |
| `nano-shrink` | () | 强制缩回普通 Nano（无守卫兜底） |
| `nano-drag` | ({dx, dy}) | 拖动 Nano 窗口 |
| `collapse-panel` | () | Full→Mini |

### send (单向)
| Channel | 用途 |
|---------|------|
| `minimize-window` | 最小化 |
| `close-window` | 隐藏到托盘 |

---

## 开发注意事项

1. **双主题同步**：改 style.css 必须同步改 style-old.css，用 `grep` 对比验证
2. **`nanoCoolingDown` 是全局变量**：`stopFocus()` 在 `setupEventListeners()` 外部，必须能碰到它
3. **三个视图共享 `state`**：`renderAll()` 同时更新所有视图
4. **SVG 的 `data-task` 属性**：叶子和任务映射靠索引 `0-3`
5. **`migrateTask()` 在每次 `init()` 调用**：确保向前兼容旧数据
6. **专注窗口宽度**：main.js 中 `Math.max(180, Math.min(440, baseW))` 控制范围
7. **气泡位置保存**：直接存字符串 `"55%"`，不要 `parseFloat`（会丢 %）
8. **窗口缩放**：Mini/Full `setResizable(true)`，Nano 普通态 `false`，专注态 `true`
