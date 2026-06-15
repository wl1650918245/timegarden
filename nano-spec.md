# Nano 悬浮花模式 · 实现 Spec（v3 最新版）

## 概述

Nano 是周计划盆栽的第三视图——桌面右侧边缘一朵小花，反映周进度。支持三种状态：普通态（仅花朵）、hover 预览态（展开预览面板）、专注计时态（展开计时条）。

---

## 窗口尺寸

| 状态 | 尺寸 | 说明 |
|------|------|------|
| 普通态 | 48×68 | 花右对齐 right:0，仅左边 6px 空白 |
| Hover 预览 | 230×270 | 花保持在右侧，预览面板在左侧 |
| 专注计时 | 自适应宽度（180~440）× 60 | 根据任务名长度动态计算 |
| 用户拖拽专注窗 | 自适应（≥160×56） | 下次专注记住自定义尺寸 |

---

## 状态与过渡

```
普通 Nano (48×68)
  ├─ hover 200ms → 窗口扩至 230×270 显示预览
  │   └─ 鼠标离开预览/花 400ms → 缩回 48×68
  │
  ├─ 开始专注 → 窗口扩至自适应宽度 (e.g. 220×60)
  │   ├─ 花保持右侧，左侧出现计时条（⏱ 图标 + 任务名 + 计时器）
  │   ├─ 窗口可自由拖边缩放
  │   ├─ 点击 ⏱ 或花 → 停止专注 → 缩回 48×68
  │   └─ 专注中 hover/右键 均有冷却防抖
  │
  ├─ 单击 → Mini 花盆
  ├─ 双击 → Full 面板
  └─ 右键 → 快捷菜单（添加任务/查看进度/展开到花盆/展开到面板/退到托盘）
```

---

## 专注计时系统

### 进入专注
1. Mini/Full 任务卡片点击 ⏱ → `startFocus(taskId, listType)`
2. 自动切换到 Nano → 根据任务名计算窗口宽度（中文≈11px/字，英文≈6px/字）
3. 显示计时条：⏱ + 任务名 + 计时器（格式 0:00 / 1:23:45）
4. 每秒更新计时器显示

### 退出专注
1. 点击计时条 ⏱ 或点击花朵 → `stopFocus()`
2. 累积时间写回 `task.weeklyTimeMs`
3. 先设冷却期（`nanoCoolingDown = true`）防 hover 回弹
4. 缩窗至 48×68 → 800ms 后恢复 hover 功能

### 关键状态变量
- `focusState`：{ taskId, taskTitle, taskList, startedAt, accumulatedMs }
- `focusInterval`：1 秒 tick 更新计时器
- `nanoCoolingDown`：**全局变量**，防止缩窗后 hover 重新扩窗
- `isNanoFocusMode`（main.js）：专注窗口标记

---

## 布局

### 普通态 (48×68)
```
┌────────────┐
│          🌸│  花 42×54（含状态点），right:0
│            │  左边 6px 空白
└────────────┘
```

### 专注态 (自适应宽×60)
```
┌──────────────────────────────┐
│ ⏱ 完成任务报告  1:23:45    🌸│
└──────────────────────────────┘
  ↑ 计时条 left:8, right:50    ↑ 花 right:0
```

---

## IPC 通道

| Channel | 方向 | 参数 | 说明 |
|---------|------|------|------|
| `nano-focus-mode` | invoke | (active, suggestedWidth?) | 进入/退出专注，传递建议宽度 |
| `nano-shrink` | invoke | () | 强制缩回普通 Nano（无守卫） |
| `nano-hover` | invoke | (hovering) | hover 扩展/恢复 |
| `nano-drag` | invoke | ({dx, dy}) | 拖动窗口 |
| `set-mode` | invoke | (mode) | 切换 nano/mini/full |

---

## CSS 关键规则

```css
/* 普通态花：右对齐，居中 */
#nano-flower { position: absolute; right: 0; top: 50%; transform: translateY(-50%); }

/* 专注计时条：填充花左侧空间，可随窗口自适应 */
#nano-focus-info { position: absolute; left: 8px; right: 50px; top: 50%; transform: translateY(-50%); }
#nano-focus-info.active { opacity: 1; pointer-events: auto; }

/* 专注模式花 hover: 稍大缩放 */
#nano-view.focus-active #nano-flower:hover { transform: translateY(-50%) scale(1.15); }

/* 编辑中的任务卡片 */
.task-card.editing { overflow: visible; align-items: flex-start; min-height: 72px; }
```

---

## 主题

- **暗色**: `style.css`（默认）, `data-theme="dark"`
- **亮色**: `style-old.css`, `data-theme="light"`
- 切换方式：`applyTheme()` 替换 `<link href>` + 设置 `data-theme` 属性

---

## 边缘情况

| 场景 | 处理 |
|------|------|
| 专注中切换到 Mini/Full | 计时器继续，`stopFocus()` 时 `nanoShrink()` 仅当 `cur.width < 500` 才缩窗 |
| 专注中右键 | 窗口临时扩展显示菜单（hover 守卫在专注模式被屏蔽） |
| 快速双击 ⏱ | `startFocus` 内部 `if (sameTask) stopFocus()` 防竞态 |
| 完成正在专注的任务 | `toggleTask` → `stopFocus()` 先停止再切换 |
| 窗口拖拽后立即点击 | `window._dragJustEnded` 标志 100ms 内忽略点击 |
| 专注窗口自定义尺寸 | 退出专注时保存到 `nanoFocusSavedW/H`，下次恢复 |
