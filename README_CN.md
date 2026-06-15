# 🌸 周计划盆栽 (Weekly Planner Plant Pot)

> 轻量化桌面事项管理工具 — 把每周最重要的事种成一盆花

[English](README.md) | 中文

---

## 这是什么

一个 Electron 桌面应用，把本周最重要的事变成一盆植物。完成越多 → 花越盛；逾期越多 → 叶越枯。支持专注计时、悬浮花模式、暗色/亮色双主题。

## 三视图

| 视图 | 尺寸 | 用途 |
|------|------|------|
| **Nano 悬浮花** | 48×68 | 桌面右侧边缘一朵小花，反映周进度。悬停看详情，托管专注计时 |
| **Mini 花盆** | 360×310（可缩放） | 默认视图，花盆+气泡任务卡片，可自由拖动排列 |
| **Full 面板** | 720×520（可缩放） | 完整操作面板：要事/待办双栏，植物+花瓣环，拖拽排序 |

## 核心功能

- 🌱 **植物隐喻** — 4片叶子对应4项要事，按时完成→开花，逾期→枯萎
- ⏱ **专注计时** — 点击任务卡片 ⏱ 进入专注模式，Nano 悬浮条显示任务名+计时器，记录每项任务耗时
- 🌓 **双主题** — 暗色（Dark Glass）+ 亮色（Warm Ceramic），一键切换
- 📅 **紧迫度系统** — 基于截止日自动计算紧迫度，渐变色卡片+进度标签
- 🔄 **周归档** — 自动检测跨周，旧数据归档到 history/
- 🎨 **动效丰富** — 粒子特效、开花动画、呼吸光晕、25分钟专注循环进度条
- 📌 **始终置顶** — 桌面可见，不干扰工作流

## 安装与运行

### 开发环境

```bash
# 克隆项目
git clone https://github.com/your-username/weekly-planner.git
cd weekly-planner

# 安装依赖（仅 electron）
npm install

# 启动
npm start
```

### 构建安装包

```bash
npm run build
```

生成的安装包在 `dist/` 目录。

## 技术栈

| 层 | 技术 |
|---|------|
| 桌面框架 | Electron 35 |
| 渲染层 | HTML + CSS + Vanilla JS（单文件架构） |
| 图形 | 内联 SVG（植物+花瓣环+悬浮花） |
| 存储 | 本地 JSON（user-data/） |

## 项目结构

```
├── main.js              # Electron 主进程
├── preload.js           # IPC 桥接
├── package.json
├── src/
│   ├── index.html       # 三视图 HTML
│   ├── style.css        # 暗色主题
│   ├── style-old.css    # 亮色主题
│   └── app.js           # 全部交互逻辑
├── CLAUDE.md            # AI 辅助开发指南
├── SPEC.md              # 产品需求文档
├── nano-spec.md         # Nano 模式实现 Spec
└── README_CN.md
```

## 快捷键

| 键 | 功能 |
|---|------|
| `ESC` | Full → Mini |
| `Enter` | 确认输入 |
| 单击花 | Nano → Mini |
| 双击花 | Nano → Full |
| 右键花 | 快捷菜单 |

## 隐私说明

所有数据**仅存储在本地**（`user-data/` 目录）。无埋点、无统计、无云同步、无网络请求。你的任务、截止日、专注记录永远不会离开你的电脑。

## License

MIT
