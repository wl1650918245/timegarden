# 🌸 TimeGarden — Desktop Weekly Planner

> A minimalist desktop companion that turns your weekly priorities into a living plant.

[中文](README_CN.md) | English

---

## What is this?

An Electron desktop app that visualizes your weekly tasks as a plant. Complete tasks → flowers bloom. Miss deadlines → leaves wilt. Built-in focus timer, floating flower mode, and dual light/dark themes.

## Three Views, One Plant

| View | Size | Purpose |
|------|------|---------|
| **Nano** (Floating Flower) | 48×68 | A tiny flower at your screen edge. Hover for weekly stats. Doubles as a focus timer HUD |
| **Mini** (Flowerpot) | 360×310 (resizable) | Default view. Ceramic pot + draggable task bubbles floating around the plant |
| **Full** (Dashboard) | 720×520 (resizable) | Full panel with priority tasks, todo list, plant SVG, and petal progress ring |

## Features

- 🌱 **Living Plant System** — 4 leaves = 4 priorities. Complete tasks → leaves bloom. Overdue → leaves wilt/die
- ⏱ **Focus Timer** — Click ⏱ on any task card to start a focus session. Nano strip shows task name + live timer. Auto-adapts width to task length. 25-minute cycle with progress bar
- 🌓 **Dual Theme** — Dark Glass (emerald accents) / Warm Ceramic (Japanese pottery inspired), one-click toggle
- 📅 **Smart Urgency** — Auto-calculated from deadlines. Gradient cards + urgency badges (3d+/2d/1d/overdue)
- 🔄 **Weekly Archive** — Auto-detects week transitions, archives old data to history/
- 🎨 **Rich Animations** — Particle effects on completion, bloom animations, breathing glow, shimmer wave, 25min cycle progress bar
- 📌 **Always on Top** — Stays visible without getting in your way

## Install & Run

### Development

```bash
git clone https://github.com/your-username/timegarden.git
cd timegarden
npm install
npm start
```

### Build

```bash
npm run build
```

Installer output in `dist/`.

## Tech Stack

| Layer | Tech |
|-------|------|
| Desktop | Electron 35 |
| UI | HTML + CSS + Vanilla JS (single-file architecture) |
| Graphics | Inline SVG (plant + petals + nano flower) |
| Storage | Local JSON (`user-data/`) |

## Project Structure

```
├── main.js              # Electron main process
├── preload.js           # IPC bridge
├── package.json
├── src/
│   ├── index.html       # Three-view HTML + inline SVGs
│   ├── style.css        # Dark theme (Dark Glass)
│   ├── style-old.css    # Light theme (Warm Ceramic)
│   └── app.js           # All interaction logic
├── CLAUDE.md            # AI-assisted dev guide
├── SPEC.md              # Product requirements doc
├── nano-spec.md         # Nano mode implementation spec
└── README.md
```

## Shortcuts

| Key | Action |
|-----|--------|
| `ESC` | Full → Mini |
| `Enter` | Confirm input |
| Click flower | Nano → Mini |
| Double-click flower | Nano → Full |
| Right-click flower | Context menu |

## License

MIT
