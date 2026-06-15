# 🌸 TimeGarden — Desktop Weekly Planner

> A living plant on your desktop that grows with your weekly progress.

[中文](README_CN.md) | English

<p align="center">
  <img src="screenshots/dark-mini.png" width="360" alt="Mini view — Dark theme" />
  <img src="screenshots/dark-full.png" width="360" alt="Full view — Dark theme" />
</p>

---

## ✨ What is this?

TimeGarden turns your weekly priorities into a desktop plant. Complete tasks — leaves bloom into flowers. Miss deadlines — leaves wilt. Built-in focus timer, three view modes, and dual light/dark themes.

<p align="center">
  <img src="screenshots/nano-focus.png" height="60" alt="Nano focus mode" />
  <br/><sub>Nano focus mode — 25min cycle with progress bar</sub>
</p>

## 🪴 Three Views

| View | Size | What it does |
|------|------|--------------|
| **Nano** | 48×68 | A tiny flower pinned to your screen edge. Hover for weekly stats. Transforms into a focus timer HUD |
| **Mini** | 360×310 ↕ | Default home. A ceramic flowerpot with draggable task bubbles floating around the plant |
| **Full** | 720×520 ↕ | Complete dashboard: priority board + todo list + plant + petal progress ring |

## ⚡ Features

- 🌱 **Plant Metaphor** — 4 leaves = 4 priorities. Healthy if on track, wilted if overdue, blooming when complete
- ⏱ **Focus Timer** — Click ⏱ on any task to enter focus mode. Nano strip shows task name + live timer with 25-min cycle progress bar
- 🌓 **Dual Theme** — Dark Glass (emerald accents) / Warm Ceramic (Japanese pottery inspired). One-click toggle
- 📅 **Smart Urgency** — Auto-calculated from deadlines. Gradient cards with urgency labels
- 🎨 **Rich Animations** — Particle effects, bloom sequences, breathing glow, shimmer wave, focus progress bar
- 🔒 **100% Local** — All data stored on your machine. No accounts, no cloud, no telemetry

<p align="center">
  <img src="screenshots/light-mini.png" width="280" alt="Mini view — Light theme" />
  <img src="screenshots/light-full.png" width="360" alt="Full view — Light theme" />
  <br/><sub>Light theme — Warm Ceramic</sub>
</p>

## 🚀 Quick Start

```bash
git clone https://github.com/wl1650918245/timegarden.git
cd timegarden
npm install
npm start
```

## 🔧 Tech

| Layer | Choice |
|-------|--------|
| Desktop | Electron 35 |
| UI | HTML + CSS + Vanilla JS |
| Graphics | Inline SVG |
| Storage | Local JSON |

## ⌨️ Shortcuts

| Key | Action |
|-----|--------|
| `ESC` | Full → Mini |
| Click flower | Nano → Mini |
| Double-click flower | Nano → Full |
| Right-click flower | Context menu |

## 🔐 Privacy

Everything stays on your machine. No telemetry, no analytics, no accounts, no network requests. Period.

## 📄 License

MIT
