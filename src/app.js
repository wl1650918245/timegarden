// ===== 全局状态 =====
let state = { weekKey: '', important: [], todos: [] };
let isFullMode = false;
let isNanoMode = false;
let nanoHoverTimer = null;
let nanoCoolingDown = false;  // hover 冷却期，防止窗口 resize 触发 mouseleave 回弹
let dragSource = null;
let windowDrag = null;  // 统一窗口拖动状态: { startX, startY, moved, threshold }
let bubbleDrag = null;  // Mini 气泡拖动状态: { el, startX, startY, startLeft, startTop, moved }
let bubblePositions = {};  // { taskId: { left, top } } — 百分比定位
let currentTheme = 'dark';    // 'dark' | 'light'

// ===== 专注计时器 =====
let focusState = {
  taskId: null,        // 当前专注的任务 ID
  taskTitle: '',       // 缓存任务标题
  taskList: '',        // 'important' | 'todos'
  startedAt: null,     // 本次专注开始时间戳
  accumulatedMs: 0,    // 历史累积毫秒
  isPaused: false,     // 是否暂停
};
let focusInterval = null;

function formatFocusTime(ms) {
  if (ms <= 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getFocusElapsed() {
  if (!focusState.startedAt) return focusState.accumulatedMs;
  return focusState.accumulatedMs + (Date.now() - focusState.startedAt);
}

function getTaskTotalMs(task) {
  let total = task.weeklyTimeMs || 0;
  if (focusState.taskId === task.id && focusState.startedAt) {
    total += Date.now() - focusState.startedAt;
  }
  return total;
}

async function startFocus(taskId, listType) {
  // 如果点击的是正在专注的任务 → 停止
  if (focusState.taskId === taskId) {
    await stopFocus();
    return;
  }

  // 停止当前专注（如果有）
  if (focusState.taskId) await stopFocus();

  const list = listType === 'important' ? state.important : state.todos;
  const task = list.find(t => t.id === taskId);
  if (!task || task.completed) return;

  focusState = {
    taskId,
    taskTitle: task.title,
    taskList: listType,
    startedAt: Date.now(),
    accumulatedMs: task.weeklyTimeMs || 0,
    isPaused: false,
  };

  startFocusTicking();

  // 根据任务名长度计算窗口宽度（中文字符≈11px，英文≈6px）
  const titleW = [...task.title].reduce((w, ch) => w + (ch.charCodeAt(0) > 127 ? 11 : 6), 0);
  const focusWidth = Math.round(168 + titleW);  // 图标+间距+计时器+边距≈168px

  // 先切换到 Nano 视图并展开到专注尺寸
  if (!isNanoMode) {
    await switchView('nano', focusWidth);
  } else {
    // 已在 Nano 模式：直接调整窗口宽度
    if (window.api && window.api.nanoFocusMode) {
      await window.api.nanoFocusMode(true, focusWidth);
    }
    document.getElementById('nano-view').classList.add('focus-active');
  }

  // 防止竞态：确认仍是当前任务
  if (focusState.taskId !== taskId) return;

  // 窗口已就位，更新 Nano 显示
  renderNano();
  updateNanoFocusDisplay();

  await saveData();
}

function togglePause() {
  if (!focusState.taskId) return;
  if (focusState.isPaused) {
    // 恢复
    focusState.isPaused = false;
    focusState.startedAt = Date.now();
    startFocusTicking();
  } else {
    // 暂停：累积已过时间，停止计时
    focusState.isPaused = true;
    if (focusState.startedAt) {
      focusState.accumulatedMs += Date.now() - focusState.startedAt;
      focusState.startedAt = null;
    }
    stopFocusTicking();
  }
  updateNanoFocusDisplay();
}

async function stopFocus() {
  if (!focusState.taskId) return;

  // 先开冷却防 hover 回弹：缩窗后鼠标还在花上会触发 mouseenter 重新扩窗
  nanoCoolingDown = true;

  // 如果暂停中，先同步累积时间（startedAt 为 null，跳过即可）
  // 如果计时中，累积剩余时间
  const list = focusState.taskList === 'important' ? state.important : state.todos;
  const task = list.find(t => t.id === focusState.taskId);
  if (task) {
    const extra = focusState.startedAt ? (Date.now() - focusState.startedAt) : 0;
    task.weeklyTimeMs = (task.weeklyTimeMs || 0) + focusState.accumulatedMs + extra;
  }

  focusState = { taskId: null, taskTitle: '', taskList: '', startedAt: null, accumulatedMs: 0, isPaused: false };
  stopFocusTicking();
  updateNanoFocusDisplay();
  renderNano();
  document.getElementById('nano-view').classList.remove('focus-active');

  // 缩回窗口（main.js 自行判断当前是否在 Nano 模式）
  if (window.api && window.api.nanoFocusMode) {
    await window.api.nanoFocusMode(false);
  }
  // 兜底：强制缩到 Nano 尺寸
  if (window.api && window.api.nanoShrink) {
    await window.api.nanoShrink();
  }

  await saveData();
  renderAll();
  setTimeout(() => { nanoCoolingDown = false; }, 800);
}

function startFocusTicking() {
  if (focusInterval) return;
  focusInterval = setInterval(() => {
    updateNanoFocusDisplay();
  }, 1000);
}

function stopFocusTicking() {
  if (focusInterval) {
    clearInterval(focusInterval);
    focusInterval = null;
  }
}

const FOCUS_CYCLE_MS = 25 * 60 * 1000; // 25 分钟一个循环

function updateNanoFocusDisplay() {
  const strip = document.getElementById('nano-focus-info');
  const taskName = document.getElementById('focus-task-name');
  const timer = document.getElementById('focus-timer');
  if (!strip || !taskName || !timer) return;

  if (focusState.taskId) {
    strip.classList.add('active');
    taskName.textContent = focusState.taskTitle;
    timer.textContent = formatFocusTime(getFocusElapsed());

    // 暂停/继续按钮图标
    const pauseBtn = document.getElementById('focus-pause-btn');
    if (pauseBtn) {
      pauseBtn.textContent = focusState.isPaused ? '▶' : '⏸';
      pauseBtn.title = focusState.isPaused ? '继续专注' : '暂停专注';
    }

    // 25 分钟循环进度
    const totalMs = getFocusElapsed();
    const cycleMs = totalMs % FOCUS_CYCLE_MS;
    const progress = cycleMs / FOCUS_CYCLE_MS; // 0 ~ 1
    strip.style.setProperty('--focus-progress', progress.toFixed(4));

    // 最后 5 分钟预警
    const remaining = FOCUS_CYCLE_MS - cycleMs;
    if (remaining <= 5 * 60 * 1000 && remaining > 0) {
      strip.classList.add('focus-warning');
    } else {
      strip.classList.remove('focus-warning');
    }
  } else {
    strip.classList.remove('active');
    strip.classList.remove('focus-warning');
    strip.style.removeProperty('--focus-progress');
  }
}

// ===== 主题切换（统一 CSS 变量方案） =====
function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme();
  try { localStorage.setItem('timegarden-theme', currentTheme); } catch(e) {}
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', currentTheme);
  // 同时保留旧 stylesheet 切换作为兼容
  const link = document.getElementById('theme-stylesheet');
  if (link) link.href = currentTheme === 'dark' ? 'style.css' : 'style-old.css';
}

function loadTheme() {
  try {
    const saved = localStorage.getItem('timegarden-theme');
    if (saved === 'light' || saved === 'dark') currentTheme = saved;
  } catch(e) {}
  applyTheme();
}

// ===== 数据迁移 =====
/** 为旧数据补充默认值：无deadline补本周五，无priority补medium，无计时补0 */
function migrateTask(t) {
  if (!t.deadline) {
    // 默认截止日：本周五
      const d = new Date();
    const day = d.getDay();
    const fridayOffset = day <= 5 ? (5 - day) : (5 + 7 - day);
    const fri = new Date(d);
    fri.setDate(d.getDate() + fridayOffset);
    t.deadline = fri.toISOString().slice(0, 10);
  }
  if (!t.priority) t.priority = 'medium';
  if (t.weeklyTimeMs === undefined) t.weeklyTimeMs = 0;
  return t;
}

// ===== 计时器 =====
function defaultDeadline() {
  const d = new Date();
  const day = d.getDay();
  const fridayOffset = day <= 5 ? (5 - day) : (5 + 7 - day);
  const fri = new Date(d);
  fri.setDate(d.getDate() + fridayOffset);
  return fri.toISOString().slice(0, 10);
}

// ===== 工具函数 =====
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// 获取 ISO 周键（与 main.js 算法保持一致），如 "2026-W24"
function getWeekKey(date) {
  const d = new Date(date);
  const dayNum = d.getDay() || 7;           // 1=Mon … 7=Sun
  d.setDate(d.getDate() + 4 - dayNum);      // 推到该周四
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/** 计算任务紧迫度：基于截止日与今天的天数差 */
function getTaskUrgency(task) {
  if (task.completed) return { days: 99, label: '已完成', cls: 'done' };
  if (!task.deadline) return { days: -99, label: '无截止', cls: 'none' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadline = new Date(task.deadline + 'T00:00:00');
  if (isNaN(deadline.getTime())) return { days: -99, label: '无截止', cls: 'none' };
  const diff = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diff >= 3) return { days: diff, label: `剩${diff}天`, cls: 'urgent-green' };
  if (diff === 2) return { days: 2, label: '剩2天', cls: 'urgent-yellow' };
  if (diff === 1) return { days: 1, label: '⚠️明天截止', cls: 'urgent-orange' };
  if (diff === 0) return { days: 0, label: '🔴今天截止', cls: 'urgent-red' };
  return { days: diff, label: `🔴过期${Math.abs(diff)}天`, cls: 'urgent-red' };
}

/** 获取当前工作日索引：1-5=周一~周五，周末返回5(周五) */
function getCurrentDayIndex() {
  const day = new Date().getDay();
  return day >= 1 && day <= 5 ? day : 5;
}

/** 获取星期中文名，支持1-7（周一到周日） */
function getDayName(idx) {
  return ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'][idx] || '';
}

// ===== 植物渲染 =====
function getGrowthStage(completed, total) {
  if (total === 0) return 'growth-sprout';
  const r = completed / total;
  if (r <= 0)    return 'growth-sprout';
  if (r < 0.25)  return 'growth-seed';
  if (r < 0.5)   return 'growth-grow';
  if (r < 0.75)  return 'growth-mature';
  if (r < 1)     return 'growth-pre';
  return 'growth-bloom';
}

function applyGrowthStage(stemEl, stage) {
  if (!stemEl) return;
  const stages = ['growth-sprout','growth-seed','growth-grow','growth-mature','growth-pre','growth-bloom'];
  stemEl.classList.remove(...stages);
  stemEl.classList.add(stage);
}

function updateMiniPlant() {
  const currentDay = getCurrentDayIndex();
  const total = state.important.length;
  const completed = state.important.filter(t => t.completed).length;
  const ratio = total > 0 ? completed / total : 0;
  const leafCount = Math.min(total, 4);
  const stem = document.querySelector('#plant-svg-mini .plant-stem');

  // 渐进生长阶段
  applyGrowthStage(stem, getGrowthStage(completed, total));

  for (let i = 1; i <= 4; i++) {
    const leaf = document.querySelector(`#plant-svg-mini .plant-leaf[data-task="${i-1}"]`);
    if (leaf) leaf.style.display = i <= leafCount ? '' : 'none';
  }

  state.important.forEach((task, idx) => {
    if (idx >= 4) return;
    const leaf = document.querySelector(`#plant-svg-mini .plant-leaf[data-task="${idx}"]`);
    if (!leaf) return;
    const shape = leaf.querySelector('.leaf-shape');
    const bud = leaf.querySelector('.flower-bud');

    leaf.classList.remove('wilting', 'dying', 'dead', 'leaf-drop');

    if (task.completed) {
      if (shape) shape.setAttribute('fill', 'url(#leafG2)');
      if (bud) { bud.style.opacity = '1'; bud.classList.add('blooming'); }
      leaf.style.opacity = '1';
    } else {
      if (bud) { bud.style.opacity = '0'; bud.classList.remove('blooming'); }
      if (!shape) return;
      const urgency = getTaskUrgency(task);
      const daysOverdue = urgency.days <= 0 && urgency.days !== -99 ? Math.abs(urgency.days) : 0;

      if (daysOverdue <= 1) {
        shape.setAttribute('fill', 'url(#leafG)');
      } else if (daysOverdue === 2) {
        leaf.classList.add('wilting');
        shape.setAttribute('fill', 'url(#leafG)');
      } else if (daysOverdue === 3) {
        leaf.classList.add('dying');
      } else {
        leaf.classList.add('dead');
      }
    }
  });

  // 茎颜色
  const stemBody = stem ? stem.querySelector('.stem-body') : null;
  if (stemBody) {
    if (ratio >= 0.8) stemBody.setAttribute('stroke', '#3a7c2f');
    else if (ratio >= 0.5) stemBody.setAttribute('stroke', '#5a9c4f');
    else if (ratio >= 0.2) stemBody.setAttribute('stroke', '#7a7c4f');
    else stemBody.setAttribute('stroke', '#8a6a4a');
  }

  // 主花
  const flower = document.querySelector('#plant-svg-mini .main-flower');
  if (flower) {
    const allDone = total > 0 && completed === total;
    flower.style.opacity = allDone ? '1' : ratio > 0.7 ? '0.7' : '0.4';
  }

  // 逾期下雨
  const urgentCount = state.important.filter(t => !t.completed && getTaskUrgency(t).days <= 0 && getTaskUrgency(t).days !== -99).length;
  if (urgentCount >= 2) triggerRain('#water-container');
  else stopRain();
}

function updateFullPlant() {
  const currentDay = getCurrentDayIndex();
  const total = state.important.length;
  const completed = state.important.filter(t => t.completed).length;
  const ratio = total > 0 ? completed / total : 0;
  const leafCount = Math.min(total, 4);
  const stem = document.querySelector('#plant-svg-full .plant-stem');

  applyGrowthStage(stem, getGrowthStage(completed, total));

  for (let i = 1; i <= 4; i++) {
    const leaf = document.querySelector(`#plant-svg-full .plant-leaf[data-task="${i-1}"]`);
    if (leaf) leaf.style.display = i <= leafCount ? '' : 'none';
  }

  state.important.forEach((task, idx) => {
    if (idx >= 4) return;
    const leaf = document.querySelector(`#plant-svg-full .plant-leaf[data-task="${idx}"]`);
    if (!leaf) return;
    const shape = leaf.querySelector('.leaf-shape');
    const bud = leaf.querySelector('.flower-bud');

    leaf.classList.remove('wilting', 'dying', 'dead');

    if (task.completed) {
      shape.setAttribute('fill', 'url(#leafG2F)');
      if (bud) { bud.style.opacity = '1'; bud.classList.add('blooming'); }
    } else {
      if (bud) { bud.style.opacity = '0'; bud.classList.remove('blooming'); }
      if (!shape) return;
      const urgency = getTaskUrgency(task);
      const daysOverdue = urgency.days <= 0 && urgency.days !== -99 ? Math.abs(urgency.days) : 0;
      if (daysOverdue <= 1) shape.setAttribute('fill', 'url(#leafGF)');
      else if (daysOverdue === 2) { leaf.classList.add('wilting'); shape.setAttribute('fill', 'url(#leafGF)'); }
      else if (daysOverdue === 3) { leaf.classList.add('dying'); }
      else { leaf.classList.add('dead'); }
    }
  });

  // 茎颜色
  const stemBody = stem ? stem.querySelector('.stem-body') : null;
  if (stemBody) {
    if (ratio >= 0.8) stemBody.setAttribute('stroke', '#3a7c2f');
    else if (ratio >= 0.5) stemBody.setAttribute('stroke', '#5a9c4f');
    else if (ratio >= 0.2) stemBody.setAttribute('stroke', '#7a7c4f');
    else stemBody.setAttribute('stroke', '#8a6a4a');
  }

  // 主花
  const flower = document.querySelector('#plant-svg-full .main-flower');
  if (flower) {
    const allDone = total > 0 && completed === total;
    flower.style.opacity = allDone ? '1' : ratio > 0.7 ? '0.7' : '0.4';
  }

  // 逾期下雨
  const urgentCount = state.important.filter(t => !t.completed && getTaskUrgency(t).days <= 0 && getTaskUrgency(t).days !== -99).length;
  if (urgentCount >= 2) triggerRain('#rain-container-full');
  else stopRain();
}

// ===== Mini视图渲染 =====
function renderMini() {
  const list = document.getElementById('bubble-list');
  const doneList = document.getElementById('plant-done-list');

  // 更新日期显示
  const dateEl = document.getElementById('plant-date');
  if (dateEl) {
    const wkRaw = state.weekKey || getWeekKey(new Date());
    const wk = '第' + parseInt(wkRaw.split('-W')[1], 10) + '周';
    const day = getDayName(new Date().getDay() || 7);
    dateEl.textContent = day + ' · ' + wk;
  }

  // 空状态：种子 + 花盆呼吸光 + 提示文字
  const isEmpty = state.important.length === 0;
  const hint = document.getElementById('empty-state-hint');
  const potWrap = document.getElementById('plant-pot-wrap');
  const seedOrb = document.getElementById('seed-orb');
  const addBtn = document.getElementById('add-important-btn');

  if (hint) hint.classList.toggle('visible', isEmpty);
  if (potWrap) potWrap.classList.toggle('pot-empty', isEmpty);
  if (seedOrb) seedOrb.classList.toggle('visible', isEmpty);
  if (addBtn) addBtn.classList.toggle('pulse-attention', isEmpty);

  if (isEmpty) {
    startSeedSparkles();
    list.innerHTML = '';
    if (doneList) doneList.innerHTML = '';
    updateMiniProgress();
    return;
  } else {
    stopSeedSparkles();
  }

  // 分离已完成/未完成，各自独立定位
  const active = state.important.filter(t => !t.completed);
  const done = state.important.filter(t => t.completed);

  // 未完成 → 右侧（活跃区），动态均匀分布
  const activeCount = active.length;
  const rightPositions = Array.from({ length: Math.max(activeCount, 1) }, (_, i) => ({
    top: (8 + (i / Math.max(activeCount, 1)) * 68) + '%',
    right: '4%', left: 'auto', bottom: 'auto'
  }));

  // 已完成 → 左侧（安静区），动态均匀分布
  const doneCount = done.length;
  const leftPositions = Array.from({ length: Math.max(doneCount, 1) }, (_, i) => ({
    top: (8 + (i / Math.max(doneCount, 1)) * 68) + '%',
    left: '4%', right: 'auto', bottom: 'auto'
  }));

  // 未完成按紧迫度排序
  const sortedActive = [...active].sort((a, b) => getTaskUrgency(a).days - getTaskUrgency(b).days);

  // 渲染未完成气泡（右侧）
  const activeHTML = sortedActive.map((task, idx) => {
    const urg = getTaskUrgency(task);
    const cls = urg.cls === 'urgent-green' ? 'mtb-green'
      : urg.cls === 'urgent-yellow' ? 'mtb-yellow'
      : urg.cls === 'urgent-orange' ? 'mtb-orange'
      : urg.cls === 'urgent-red' ? 'mtb-red'
      : 'mtb-none';
    const customPos = bubblePositions[task.id];
    const pos = customPos || rightPositions[idx];
    const style = Object.entries(pos).filter(([k,v]) => v !== 'auto').map(([k,v]) => `${k}:${typeof v === 'number' ? v + '%' : v}`).join(';');
    const isFocusing = focusState.taskId === task.id;
    const focusIcon = isFocusing ? '⏹' : '⏱';
    const focusTitle = isFocusing ? '停止专注' : '开始专注';
    return `<div class="mini-task-bubble ${cls}${isFocusing ? ' bubble-focusing' : ''}" data-id="${task.id}" style="${style};animation-delay:${(idx * 0.1).toFixed(2)}s">
      <span class="mtb-dot"></span>
      <span class="mtb-text" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span>
      <span class="mtb-urgency">${urg.label}</span>
      <span class="mtb-focus-btn" data-action="focus" data-id="${task.id}" data-list="important" title="${focusTitle}">${focusIcon}</span>
    </div>`;
  }).join('');

  // 渲染已完成气泡（左侧）
  const doneHTML = done.map((task, idx) => {
    const customPos = bubblePositions[task.id];
    const pos = customPos || leftPositions[idx];
    const style = Object.entries(pos).filter(([k,v]) => v !== 'auto').map(([k,v]) => `${k}:${typeof v === 'number' ? v + '%' : v}`).join(';');
    return `<div class="mini-task-bubble mtb-done" data-id="${task.id}" style="${style};animation-delay:${(idx * 0.1).toFixed(2)}s">
      <span class="mtb-dot"></span>
      <span class="mtb-text" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span>
      <span class="mtb-urgency">✓ 完成</span>
    </div>`;
  }).join('');

  list.innerHTML = activeHTML + doneHTML;

  // 底部已完成标签
  if (doneList) {
    doneList.innerHTML = done.map(t =>
      `<span class="plant-done-item" title="${escapeHtml(t.title)}">${escapeHtml(t.title)} ✓</span>`
    ).join('');
  }

  updateMiniProgress();
}

function updateMiniProgress() {
  // 更新底部进度条宽度
  const fill = document.getElementById('plantProgressFill');
  if (fill) {
    const total = state.important.length;
    const done = state.important.filter(t => t.completed).length;
    fill.style.width = total > 0 ? (done / total * 100) + '%' : '0%';
  }
}

// ===== Nano视图渲染 =====
function renderNano() {
  const total = state.important.length;
  const completed = state.important.filter(t => t.completed).length;
  const urgent = state.important.filter(t => !t.completed && getTaskUrgency(t).days <= 0 && getTaskUrgency(t).days !== -99).length;
  const petals = document.querySelectorAll('.nano-petal');
  const statusDot = document.getElementById('nano-status-dot');

  // 专注模式：绿色脉冲
  if (focusState.taskId) {
    statusDot.className = 'dot-focus';
    petals.forEach(p => { p.classList.remove('wilted'); p.setAttribute('fill', ''); });
    return;
  }

  if (total === 0 || completed === total) {
    statusDot.className = 'dot-bloom';
    petals.forEach(p => { p.classList.remove('wilted'); p.setAttribute('fill', ''); });
  } else if (urgent > 0) {
    statusDot.className = 'dot-wilt';
    petals.forEach(p => { p.classList.add('wilted'); p.setAttribute('fill', '#d4b880'); });
  } else {
    statusDot.className = 'dot-bud';
    petals.forEach(p => { p.classList.remove('wilted'); p.setAttribute('fill', ''); });
  }
}

function renderNanoHover() {
  const total = state.important.length;
  const done = state.important.filter(t => t.completed).length;
  const pct = total > 0 ? Math.round(done / total * 100) : 0;
  const wk = state.weekKey || getWeekKey(new Date());
  const day = getDayName(new Date().getDay() || 7);
  const weekNum = '第' + parseInt(wk.split('-W')[1], 10) + '周';

  document.getElementById('nanoHoverDay').textContent = day;
  document.getElementById('nanoHoverWeek').textContent = weekNum;
  document.getElementById('nanoHoverProgressFill').style.width = pct + '%';
  document.getElementById('nanoStatUrgent').textContent = state.important.filter(t => !t.completed && getTaskUrgency(t).days <= 0 && getTaskUrgency(t).days !== -99).length;
  document.getElementById('nanoStatDone').textContent = done;
  document.getElementById('nanoStatTotal').textContent = total;

  // 预览面板：全部任务，未完成按紧迫度排前，已完成沉底
    const activeTasks = state.important.filter(t => !t.completed).sort((a, b) => getTaskUrgency(a).days - getTaskUrgency(b).days);
  const doneTasks = state.important.filter(t => t.completed);
  const allTasks = [...activeTasks, ...doneTasks];
  const container = document.getElementById('nanoHoverTasks');
  if (allTasks.length === 0) {
    container.innerHTML = '<div style="font-size:9px;color:#b0a090;text-align:center;padding:4px 0;">🌱 还没有重要事项';
  } else {
    container.innerHTML = allTasks.map(t => {
      const urg = getTaskUrgency(t);
      const isOverdue = urg.days <= 0 && urg.days !== -99;
      const dotColor = t.completed ? '#8a7a6a' : isOverdue ? '#d47070' : urg.days <= 1 ? '#d08040' : urg.days <= 2 ? '#c89040' : '#509050';
      return `<div class="nano-hover-task ${t.completed ? 'nht-done' : ''}">
        <span class="nht-dot" style="background:${dotColor};"></span>
        <span class="nht-text">${escapeHtml(t.title)}</span>
        <span class="nht-label">${urg.label}</span>
      </div>`;
    }).join('');
  }
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function renderFull() {
  renderWeekProgress();
  renderImportantList();
  renderTodoList();
  updateCounts();
}

function renderWeekProgress() {
  const currentDay = getCurrentDayIndex();
  document.querySelectorAll('.day-label').forEach(el => {
    const day = parseInt(el.dataset.day);
    el.classList.remove('active', 'past');
    if (day === currentDay) el.classList.add('active');
    else if (day < currentDay) el.classList.add('past');
  });
}

function renderImportantList() {
  const container = document.getElementById('important-list');
  const seedOrb = document.getElementById('seed-orb-full');
  const addBtn = document.getElementById('add-important-btn');

  if (state.important.length === 0) {
    if (seedOrb) seedOrb.classList.add('visible');
    if (addBtn) addBtn.classList.add('pulse-attention');
    container.innerHTML = '<div class="empty-state">还没有最重要的事，点击下方添加';
    return;
  } else {
    if (seedOrb) seedOrb.classList.remove('visible');
    if (addBtn) addBtn.classList.remove('pulse-attention');
  }
  // 已完成任务沉底
    const sorted = [...state.important].sort((a, b) => (a.completed === b.completed ? 0 : a.completed ? 1 : -1));
  container.innerHTML = sorted.map((task) => {
    const urg = getTaskUrgency(task);
    const completedClass = task.completed ? 'completed' : '';
    const urgClass = task.completed ? 'urg-done'
      : urg.cls === 'urgent-green' ? 'urg-green'
      : urg.cls === 'urgent-yellow' ? 'urg-yellow'
      : urg.cls === 'urgent-orange' ? 'urg-orange'
      : urg.cls === 'urgent-red' ? 'urg-red'
      : 'urg-none';
    const totalMs = getTaskTotalMs(task);
    const isFocusing = focusState.taskId === task.id;
    const prioCls = task.priority === 'high' ? 'prio-high' : task.priority === 'low' ? 'prio-low' : 'prio-medium';
    // 叶子编号（对应植物上的 4 片叶子）
    const leafIdx = sorted.indexOf(task);
    const leafIcons = ['🌿','🍃','🌱','🍀'];
    const leafIcon = leafIdx < 4 ? leafIcons[leafIdx] : '🌿';
    return `
      <div class="task-card ${completedClass} ${urgClass} ${isFocusing ? 'task-focusing' : ''}" draggable="true" data-index="${leafIdx}" data-list="important" data-id="${task.id}">
        <span class="leaf-index" title="对应第${leafIdx+1}片叶子">${leafIcon}</span>
        <div class="task-checkbox" data-action="toggle"></div>
        <div class="task-content">
          <div class="task-title" data-action="edit" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</div>
        </div>
        ${totalMs > 0 ? `<span class="focus-time-badge" title="本周已专注 ${formatFocusTime(totalMs)}">${formatFocusTime(totalMs)}</span>` : ''}
        ${!task.completed ? `<span class="card-focus-btn" data-action="focus" data-id="${task.id}" data-list="important" title="${isFocusing ? '停止专注' : '开始专注'}">${isFocusing ? '⏹' : '⏱'}</span>` : ''}
        <span class="urgency-badge urgency-${urg.cls.replace('urgent-','')}"><span class="task-prio-dot ${prioCls}"></span>${urg.label}</span>
        <button class="task-delete" data-action="delete">✕</button>
      </div>
    `;
  }).join('');
}

function renderTodoList() {
  const container = document.getElementById('todo-list');
  if (state.todos.length === 0) {
    container.innerHTML = '<div class="empty-state">还没有待办事项';
    return;
  }
  // 已完成沉底
  const sortedTodos = [...state.todos].sort((a, b) => (a.completed === b.completed ? 0 : a.completed ? 1 : -1));
  container.innerHTML = sortedTodos.map((task, idx) => {
    const completedClass = task.completed ? 'completed' : '';
    const prioIcon = task.priority === 'high' ? '🔴' : task.priority === 'low' ? '🔵' : '🟡';
    const prioLabel = task.priority === 'high' ? '高优' : task.priority === 'low' ? '低优' : '中优';
    return `
      <div class="task-card ${completedClass}" draggable="true" data-index="${idx}" data-list="todo" data-id="${task.id}">
        <div class="task-checkbox" data-action="toggle"></div>
        <div class="task-content">
          <div class="task-title" data-action="edit" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</div>
        </div>
        <span class="todo-prio">${prioIcon} ${prioLabel}</span>
        <button class="task-delete" data-action="delete">✕</button>
      </div>
    `;
  }).join('');
}

function updateCounts() {
  const done = state.important.filter(t => t.completed).length;
  document.getElementById('important-count').textContent = `${done}/${state.important.length}`;
  const pendingTodos = state.todos.filter(t => !t.completed);
  document.getElementById('todo-count').textContent = pendingTodos.length;
  // 更新优先级统计（高/中/低 待办计数）
  const highCount = pendingTodos.filter(t => t.priority === 'high').length;
  const medCount = pendingTodos.filter(t => t.priority === 'medium').length;
  const lowCount = pendingTodos.filter(t => t.priority === 'low').length;
  const priorityEl = document.querySelector('#priority-summary');
  if (priorityEl) {
    const parts = [];
    if (highCount > 0) parts.push(`🔴${highCount}`);
    if (medCount > 0) parts.push(`🟡${medCount}`);
    if (lowCount > 0) parts.push(`🔵${lowCount}`);
    priorityEl.textContent = parts.length > 0 ? parts.join(' ') : '';
  }
}

// ===== 粒子特效 =====
function createParticles(x, y) {
  const container = document.getElementById('particle-container');
  const colors = ['#6abf4b','#f5a0b8','#f5d76e','#8abf7a','#f5e6d0'];
  const emojis = ['🌱','🌿','🌸','🌻','🌺','🍀'];
  for (let i = 0; i < 12; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const angle = (Math.PI * 2 * i) / 12;
    const dist = 30 + Math.random() * 40;
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.left = `${x}px`; p.style.top = `${y}px`;
    p.style.width = `${4+Math.random()*4}px`;
    p.style.height = p.style.width;
    container.appendChild(p);
    setTimeout(() => p.remove(), 800);
  }
  for (let i = 0; i < 3; i++) {
    const e = document.createElement('div');
    e.style.position = 'absolute'; e.style.left = `${x + (Math.random()-0.5)*30}px`; e.style.top = `${y}px`;
    e.style.fontSize = '16px'; e.style.pointerEvents = 'none';
    e.style.animation = `particleBurst ${0.6+Math.random()*0.4}s ease-out forwards`;
    e.style.setProperty('--dx', `${(Math.random()-0.5)*60}px`);
    e.style.setProperty('--dy', `${-30-Math.random()*30}px`);
    e.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    container.appendChild(e);
    setTimeout(() => e.remove(), 1000);
  }
}

// ===== 植物交互系统 =====

let rainInterval = null;
let speechTimer = null;
let idleTimer = null;
let seedSparkleTimer = null;

function startSeedSparkles() {
  if (seedSparkleTimer) return;
  const container = document.getElementById('seed-sparkles');
  if (!container) return;

  seedSparkleTimer = setInterval(() => {
    const sparkle = document.createElement('div');
    sparkle.className = 'seed-sparkle';
    sparkle.style.left = (35 + Math.random() * 30) + '%';
    sparkle.style.top = (55 + Math.random() * 25) + '%';
    sparkle.style.animationDuration = (1.5 + Math.random() * 1.5) + 's';
    container.appendChild(sparkle);
    setTimeout(() => sparkle.remove(), 2200);
  }, 400);
}

function stopSeedSparkles() {
  if (seedSparkleTimer) { clearInterval(seedSparkleTimer); seedSparkleTimer = null; }
  const container = document.getElementById('seed-sparkles');
  if (container) container.innerHTML = '';
}

function triggerRain(containerSelector) {
  if (rainInterval) return;
  const container = document.querySelector(containerSelector);
  if (!container) return;

  rainInterval = setInterval(() => {
    const drop = document.createElement('div');
    drop.className = 'rain-drop';
    drop.style.left = (15 + Math.random() * 70) + '%';
    drop.style.height = (6 + Math.random() * 8) + 'px';
    drop.style.animationDuration = (0.8 + Math.random() * 0.6) + 's';
    container.appendChild(drop);
    setTimeout(() => drop.remove(), 1500);
  }, 300);
}

function stopRain() {
  if (rainInterval) { clearInterval(rainInterval); rainInterval = null; }
  document.querySelectorAll('.rain-drop').forEach(d => d.remove());
}

function waterPlant(containerSelector) {
  const container = document.querySelector(containerSelector);
  if (!container) return;

  for (let i = 0; i < 4; i++) {
    const drop = document.createElement('div');
    drop.className = 'water-drop';
    drop.style.left = (35 + Math.random() * 30) + '%';
    drop.style.top = (5 + Math.random() * 10) + '%';
    drop.style.animationDelay = (i * 0.15) + 's';
    container.appendChild(drop);
    setTimeout(() => drop.remove(), 1000);
  }

  setTimeout(() => {
    const splash = document.createElement('div');
    splash.className = 'water-splash';
    splash.style.left = '48%';
    splash.style.top = '82%';
    container.appendChild(splash);
    setTimeout(() => splash.remove(), 700);
  }, 400);
}

function showPlantSpeech(plantEl) {
  const miniView = document.getElementById('mini-view');
  const isMini = !miniView.classList.contains('hidden');
  const speech = isMini
    ? document.getElementById('plant-speech')
    : document.getElementById('plant-speech-full');
  if (!speech) return;

  const total = state.important.length;
  const completed = state.important.filter(t => t.completed).length;
  const overdue = state.important.filter(t => !t.completed && getTaskUrgency(t).days < 0).length;
  const todayDue = state.important.filter(t => !t.completed && getTaskUrgency(t).days === 0).length;

  let msg;
  if (total === 0) msg = '🌰 种下一颗种子吧';
  else if (completed === total) msg = '🌸 全部完成，太棒了！';
  else if (overdue > 0) msg = '😰 ' + overdue + ' 项已逾期，快浇水！';
  else if (todayDue > 0) msg = '⏰ ' + todayDue + ' 项今天截止，加油！';
  else msg = '🌱 ' + completed + '/' + total + ' 已完成，继续加油';

  speech.textContent = msg;

  const rect = plantEl.getBoundingClientRect();
  speech.style.left = (rect.left + rect.width / 2) + 'px';
  speech.style.top = (rect.top - 12) + 'px';
  speech.style.transform = 'translate(-50%, -100%) translateY(4px)';
  speech.classList.add('visible');

  if (speechTimer) clearTimeout(speechTimer);
  speechTimer = setTimeout(() => speech.classList.remove('visible'), 2500);
}

function morningAnimation() {
  // 每天只播一次
  const today = new Date().toISOString().slice(0, 10);
  const lastPlayed = localStorage.getItem('timegarden-morning');
  if (lastPlayed === today) return;
  try { localStorage.setItem('timegarden-morning', today); } catch(e) {}

  const stemMini = document.querySelector('#plant-svg-mini .plant-stem');
  const stemFull = document.querySelector('#plant-svg-full .plant-stem');

  [stemMini, stemFull].forEach(stem => {
    if (!stem) return;
    stem.classList.add('morning-grow');
    setTimeout(() => stem.classList.remove('morning-grow'), 1300);
  });
}

function startIdleAnimations() {
  if (idleTimer) clearInterval(idleTimer);

  idleTimer = setInterval(() => {
    const stem = document.querySelector('#plant-svg-mini .plant-stem');
    if (!stem) return;

    const r = Math.random();

    if (r < 0.15) {
      // Leaf twitch
      const leaves = document.querySelectorAll('#plant-svg-mini .plant-leaf:not([style*="display: none"])');
      if (leaves.length > 0) {
        const leaf = leaves[Math.floor(Math.random() * leaves.length)];
        leaf.classList.add('leaf-twitch');
        setTimeout(() => leaf.classList.remove('leaf-twitch'), 500);
      }
    } else if (r < 0.25) {
      // Sparkle
      const plant = document.getElementById('plant-svg-mini');
      if (!plant) return;
      const rect = plant.getBoundingClientRect();
      const sparkle = document.createElement('div');
      sparkle.className = 'plant-sparkle';
      sparkle.style.left = (rect.left + 30 + Math.random() * 40) + 'px';
      sparkle.style.top = (rect.top + 10 + Math.random() * 30) + 'px';
      document.body.appendChild(sparkle);
      setTimeout(() => sparkle.remove(), 1600);
    } else if (r < 0.28 && document.querySelector('.growth-bloom')) {
      // Petal fall when blooming
      const plant = document.getElementById('plant-svg-mini');
      if (!plant) return;
      const rect = plant.getBoundingClientRect();
      const petal = document.createElement('div');
      petal.className = 'petal-fall';
      petal.textContent = '🌸';
      petal.style.fontSize = '10px';
      petal.style.left = (rect.left + 40 + Math.random() * 20) + 'px';
      petal.style.top = (rect.top - 5) + 'px';
      document.body.appendChild(petal);
      setTimeout(() => petal.remove(), 3100);
    }
  }, 8000 + Math.random() * 7000);
}

// ===== Mini 气泡自由拖动 =====
function loadBubblePositions() {
  try {
    const saved = localStorage.getItem('timegarden-bubble-pos');
    if (saved) bubblePositions = JSON.parse(saved);
  } catch(e) { bubblePositions = {}; }
}

function saveBubblePositions() {
  try { localStorage.setItem('timegarden-bubble-pos', JSON.stringify(bubblePositions)); } catch(e) {}
}

function setupBubbleDrag() {
  const scene = document.getElementById('bubble-scene');
  if (!scene) return;

  scene.addEventListener('mousedown', (e) => {
    const bubble = e.target.closest('.mini-task-bubble');
    if (!bubble || e.button !== 0) return;
    // 不拦截 ⏱ 按钮的点击
    if (e.target.closest('.mtb-focus-btn')) return;
    const rect = bubble.getBoundingClientRect();
    const sceneRect = scene.getBoundingClientRect();
    bubbleDrag = {
      el: bubble,
      id: bubble.dataset.id,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: ((rect.left - sceneRect.left) / sceneRect.width) * 100,
      startTop: ((rect.top - sceneRect.top) / sceneRect.height) * 100,
      moved: false
    };
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!bubbleDrag) return;
    const dx = e.clientX - bubbleDrag.startX;
    const dy = e.clientY - bubbleDrag.startY;
    if (!bubbleDrag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    bubbleDrag.moved = true;
    const sceneRect = document.getElementById('bubble-scene').getBoundingClientRect();
    const leftPct = bubbleDrag.startLeft + (dx / sceneRect.width) * 100;
    const topPct = bubbleDrag.startTop + (dy / sceneRect.height) * 100;
    bubbleDrag.el.style.left = leftPct + '%';
    bubbleDrag.el.style.top = topPct + '%';
    bubbleDrag.el.style.right = 'auto';
    bubbleDrag.el.style.bottom = 'auto';
    bubbleDrag.el.classList.add('bubble-dragging');
  });

  document.addEventListener('mouseup', () => {
    if (!bubbleDrag) return;
    const el = bubbleDrag.el;
    const id = bubbleDrag.id;
    const moved = bubbleDrag.moved;
    if (moved && el && id) {
      // 保存最终位置
      bubblePositions[id] = {
        left: el.style.left || '50%',
        top: el.style.top || '50%'
      };
      saveBubblePositions();
      el.classList.remove('bubble-dragging');
    }
    window._bubbleDragJustEnded = moved;
    bubbleDrag = null;
    setTimeout(() => { window._bubbleDragJustEnded = false; }, 50);
  });
}

function setupPlantInteractions() {
  const miniPlant = document.getElementById('plant-svg-mini');
  const fullPlant = document.getElementById('plant-svg-full');

  [miniPlant, fullPlant].forEach(plant => {
    if (!plant) return;
    plant.addEventListener('click', (e) => {
      e.stopPropagation();
      showPlantSpeech(plant);
    });
  });
}

// ===== 任务管理 =====
async function addTask(listType, title, deadline, priority) {
  const wasEmpty = listType === 'important' && state.important.length === 0;
  const task = {
    id: uid(),
    title: title.trim(),
    completed: false,
    deadline: deadline || defaultDeadline(),
    priority: priority || 'medium',
    createdAt: new Date().toISOString(),
    weeklyTimeMs: 0
  };
  if (listType === 'important') state.important.push(task);
  else state.todos.push(task);
  await saveData();
  renderAll();

  // 第一颗种子入土 → 生长动画
  if (wasEmpty) {
    const seedOrb = document.getElementById('seed-orb');
    if (seedOrb) {
      seedOrb.style.transition = 'transform 0.5s cubic-bezier(0.55,0,1,0.45), opacity 0.4s ease';
      seedOrb.style.transform = 'translate(-50%, 80px) scale(0.3)';
      seedOrb.style.opacity = '0';
      setTimeout(() => {
        if (seedOrb) { seedOrb.style.transition = ''; seedOrb.style.transform = ''; }
      }, 600);
    }
    // 植物从土里长出来
    setTimeout(() => morningAnimation(), 500);
  }
}

async function toggleTask(listType, id) {
  const list = listType === 'important' ? state.important : state.todos;
  const task = list.find(t => t.id === id);
  if (!task) return;
  // 完成任务时：如果正在专注此任务，先停止
  if (!task.completed && focusState.taskId === id) await stopFocus();
  task.completed = !task.completed;

  // 完成时：粒子特效 + 卡片沉底
    if (task.completed && listType === 'important') {
    // 将已完成卡片移到列表末尾
    const idx = list.findIndex(t => t.id === id);
    if (idx !== -1) {
      list.splice(idx, 1);
      list.push(task);
    }
    // 粒子特效 + 浇水动画
    const card = document.querySelector(`.task-card[data-id="${id}"]`);
    if (card) {
      const rect = card.getBoundingClientRect();
      createParticles(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const waterTarget = document.getElementById('full-view').classList.contains('hidden')
        ? '#water-container' : '#water-container-full';
      waterPlant(waterTarget);
    }
  } else if (task.completed) {
    // todo 完成动画
      const card = document.querySelector(`.task-card[data-id="${id}"]`);
    if (card) {
      const rect = card.getBoundingClientRect();
      createParticles(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
  }

  await saveData();
  renderAll();
}

async function deleteTask(listType, id) {
  // 删除正在专注的任务先停止
  if (focusState.taskId === id) await stopFocus();
  const list = listType === 'important' ? state.important : state.todos;
  const idx = list.findIndex(t => t.id === id);
  if (idx === -1) return;
  list.splice(idx, 1);
  await saveData();
  renderAll();
}

async function editTask(listType, id, updates) {
  const list = listType === 'important' ? state.important : state.todos;
  const task = list.find(t => t.id === id);
  if (!task) return;
  if (updates.title !== undefined) task.title = updates.title.trim();
  if (updates.priority !== undefined) task.priority = updates.priority;
  if (updates.deadline !== undefined) task.deadline = updates.deadline;
  await saveData();
  renderAll();
}

async function moveTask(listType, displayFrom, displayTo) {
  const list = listType === 'important' ? state.important : state.todos;
  // 构建与渲染一致的显示序
  const sorted = [...list].sort((a, b) => (a.completed === b.completed ? 0 : a.completed ? 1 : -1));
  if (displayFrom < 0 || displayFrom >= sorted.length || displayTo < 0 || displayTo >= sorted.length) return;
  const movedTask = sorted[displayFrom];
  sorted.splice(displayFrom, 1);
  sorted.splice(displayTo, 0, movedTask);
  // 将排序结果写回原数组（保持已完成沉底规则）
  state[listType === 'important' ? 'important' : 'todos'] = sorted;
  await saveData();
  renderAll();
}

async function saveData() {
  await window.api.saveData({
    weekKey: state.weekKey,
    important: state.important,
    todos: state.todos,
    lastModified: new Date().toISOString()
  });
}

let wasAllDone = false;

function renderAll() {
  renderMini();
  updateMiniPlant();
  updatePetalRing();
  updateStatusBar();
  renderNano();
  renderNanoHover();
  if (isFullMode) {
    renderFull();
    updateFullPlant();
  }
  updateNanoFocusDisplay();

  // 全部完成庆祝（仅触发一次，直到状态改变）
  const total = state.important.length;
  const done = state.important.filter(t => t.completed).length;
  const allDone = total > 0 && done === total;
  if (allDone && !wasAllDone && state.important.some(t => t.completed)) {
    triggerCelebration();
  }
  wasAllDone = allDone;
}

function updatePetalRing() {
  const currentDay = getCurrentDayIndex();
  for (let i = 1; i <= 5; i++) {
    const petal = document.querySelector(`.petal.p${i}`);
    if (!petal) continue;
    petal.classList.remove('past', 'active', 'future');
    if (i < currentDay) petal.classList.add('past');
    else if (i === currentDay) petal.classList.add('active');
    else petal.classList.add('future');
  }
  const numEl = document.getElementById('ring-day-num');
  const labelEl = document.getElementById('ring-day-label');
  const realDay = new Date().getDay() || 7;
  if (numEl) numEl.textContent = realDay;
  if (labelEl) labelEl.textContent = getDayName(realDay);
}

function updateStatusBar() {
  const currentDay = getCurrentDayIndex();  // 1-5 用于表情判断
  const total = state.important.length;
  const completed = state.important.filter(t => t.completed).length;
  const dayName = getDayName(new Date().getDay() || 7);  // 显示实际星期

  // 更新顶栏：周数 · 星期 + 表情
    const el = document.getElementById('status-text');
  const emojiEl = document.getElementById('status-emoji');
  if (el) {
    const weekNum = state.weekKey ? '第' + parseInt(state.weekKey.split('-W')[1], 10) + '周' : '第1周';
    el.innerHTML = `<strong>${weekNum}</strong> · ${dayName}`;
  }
  if (emojiEl) {
    const emoji = completed === total && total > 0 ? '🎉' : currentDay >= 4 ? '😰' : '😊';
    emojiEl.textContent = emoji;
  }

  // 更新进度统计文字
  let progressHTML = '';
  if (total > 0) {
    const pct = Math.round(completed / total * 100);
    progressHTML = `<span style="font-size:10px;color:var(--text-secondary);">${completed}/${total} 已完成</span>
      <span style="font-size:11px;color:#509050;font-weight:600;">完成 ${pct}%</span>`;
  }
  const progressEl = document.getElementById('status-progress');
  if (progressEl) progressEl.innerHTML = progressHTML;
}

// ===== 视图切换 =====
async function switchView(target, focusWidth) {
  const miniView = document.getElementById('mini-view');
  const fullView = document.getElementById('full-view');
  const nanoView = document.getElementById('nano-view');

  // 隐藏所有视图
  miniView.classList.add('hidden');
  fullView.classList.add('hidden');
  nanoView.classList.add('hidden');

  if (target === 'nano') {
    nanoView.classList.remove('hidden');
    isNanoMode = true;
    isFullMode = false;
    document.body.classList.remove('mini-mode');
    await window.api.setMode('nano');
    // 专注中切回 Nano → 展开到专注尺寸（优先用传入宽度，否则根据任务名计算）
    if (focusState.taskId && window.api && window.api.nanoFocusMode) {
      let fw = focusWidth;
      if (!fw) {
        const tw = [...focusState.taskTitle].reduce((w, ch) => w + (ch.charCodeAt(0) > 127 ? 11 : 6), 0);
        fw = Math.round(168 + tw);
      }
      await window.api.nanoFocusMode(true, fw);
      nanoView.classList.add('focus-active');
      renderNano();
      updateNanoFocusDisplay();
    }
  } else if (target === 'mini') {
    miniView.classList.remove('hidden');
    isNanoMode = false;
    isFullMode = false;
    document.body.classList.add('mini-mode');
    await window.api.setMode('mini');
    // 专注中切回 Mini：刷新视图
    if (focusState.taskId) renderAll();
  } else if (target === 'full') {
    fullView.classList.remove('hidden');
    isNanoMode = false;
    isFullMode = true;
    document.body.classList.remove('mini-mode');
    renderFull();
    updateFullPlant();
    await window.api.setMode('full');
    // 专注中切到 Full：刷新视图
    if (focusState.taskId) { renderFull(); updateFullPlant(); }
  }
}

async function toggleMode() {
  if (isNanoMode) {
    switchView('mini');
    return;
  }

  if (isFullMode) {
    // full → mini
    document.getElementById('full-view').classList.add('view-exit');
    setTimeout(() => {
      document.getElementById('full-view').classList.add('hidden');
      document.getElementById('full-view').classList.remove('view-exit');
      document.getElementById('mini-view').classList.remove('hidden');
      document.getElementById('mini-view').classList.add('view-enter');
      setTimeout(() => document.getElementById('mini-view').classList.remove('view-enter'), 250);
    }, 150);
    document.body.classList.add('mini-mode');
    await window.api.setMode('mini');
    isFullMode = false;
    isNanoMode = false;
  } else {
    // mini → full
    document.getElementById('mini-view').classList.add('view-exit');
    setTimeout(() => {
      document.getElementById('mini-view').classList.add('hidden');
      document.getElementById('mini-view').classList.remove('view-exit');
      document.getElementById('full-view').classList.remove('hidden');
      document.getElementById('full-view').classList.add('view-enter');
      setTimeout(() => document.getElementById('full-view').classList.remove('view-enter'), 250);
      renderFull();
      updateFullPlant();
    }, 150);
    document.body.classList.remove('mini-mode');
    await window.api.setMode('full');
    isFullMode = true;
    isNanoMode = false;
  }
}

// ===== 事件绑定 =====
function setupEventListeners() {
  // 绑定点击切换 → Mini/Full/Nano 视图、任务操作、拖拽等
  let miniClickTimer = null;
  document.getElementById('bubble-scene').addEventListener('click', (e) => {
      // 拖拽气泡后不触发场景点击
      if (window._bubbleDragJustEnded) return;
      // 忽略交互元素上的点击（气泡、花盆、顶栏等）
      if (e.target.closest('.mini-task-bubble')) return;
    if (e.target.closest('#plant-pot-wrap')) return;
    if (e.target.closest('#plant-top-bar')) return;
    if (e.target.closest('#plant-done-list')) return;
    if (e.target.closest('#nano-focus-info')) return;
    if (e.target.closest('#mini-drag-handle')) return;
    // 双击检测
    if (miniClickTimer) {
      clearTimeout(miniClickTimer);
      miniClickTimer = null;
      // 双击 → Nano
      switchView('nano');
      return;
    }
    miniClickTimer = setTimeout(() => {
      miniClickTimer = null;
      // 单击 → Full
      toggleMode();
    }, 250);
  });

  // 主题切换
  document.getElementById('btn-theme-mini').addEventListener('click', toggleTheme);
  document.getElementById('btn-theme-full').addEventListener('click', toggleTheme);

  // 专注计时器 — Mini气泡⏱按钮
  document.getElementById('bubble-list').addEventListener('click', (e) => {
    const focusBtn = e.target.closest('.mtb-focus-btn');
    if (focusBtn) {
      e.stopPropagation();
      const id = focusBtn.dataset.id;
      const list = focusBtn.dataset.list;
      startFocus(id, list);
      return;
    }
    const bubble = e.target.closest('.mini-task-bubble');
    if (!bubble) return;
    if (window._bubbleDragJustEnded) return;
    const id = bubble.dataset.id;
    if (id) toggleTask('important', id);
  });

  // 专注条 ⏱ 点击 = 停止专注
  const focusIcon = document.getElementById('focus-icon-click');
  if (focusIcon) focusIcon.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (focusState.taskId) await stopFocus();
  });

  // 专注条 ⏸/▶ 点击 = 暂停/继续
  const pauseBtn = document.getElementById('focus-pause-btn');
  if (pauseBtn) pauseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePause();
  });

  // 一键收到 Nano 悬浮花
  document.getElementById('btn-nano-mini').addEventListener('click', () => switchView('nano'));

  // Full视图按钮
  const btnShrink = document.getElementById('btn-shrink');
  if (btnShrink) btnShrink.addEventListener('click', () => { if (isFullMode) switchView('mini'); });
  const btnNano = document.getElementById('btn-nano');
  if (btnNano) btnNano.addEventListener('click', () => { if (isFullMode) switchView('nano'); });

  // 引导下一步按钮
  const obNext = document.getElementById('onboarding-next');
  if (obNext) obNext.addEventListener('click', advanceOnboarding);

  // ESC 快捷键
    document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // 如果引导页开着，先关引导
      const ob = document.getElementById('onboarding-overlay');
      if (ob && !ob.classList.contains('hidden')) { finishOnboarding(); return; }
      if (isFullMode) toggleMode();
      else if (isNanoMode) { /* nano 模式下 ESC 不操作 */ }
    }
  });

  // 最小化/关闭按钮
    document.getElementById('btn-minimize').addEventListener('click', () => { if (window.electronAPI) window.electronAPI.minimizeWindow(); });
  document.getElementById('btn-close').addEventListener('click', () => { if (window.electronAPI) window.electronAPI.closeWindow(); });

  // 添加任务按钮
  document.getElementById('add-important-btn').addEventListener('click', () => promptForNewTask('important', '请输入本周最重要的事'));
  document.getElementById('add-todo-btn').addEventListener('click', () => promptForNewTask('todo', '请输入待办事项'));

  // 任务列表点击/双击
    document.getElementById('important-list').addEventListener('click', handleTaskClick);
  document.getElementById('todo-list').addEventListener('click', handleTaskClick);
  document.getElementById('important-list').addEventListener('dblclick', handleTaskDblClick);
  document.getElementById('todo-list').addEventListener('dblclick', handleTaskDblClick);

  // 拖拽排序
  ['important-list', 'todo-list'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('dragstart', handleDragStart);
    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('drop', handleDrop);
    el.addEventListener('dragend', handleDragEnd);
  });

  // 右侧面板折叠
    document.getElementById('right-toggle').addEventListener('click', () => {
    document.getElementById('right-panel').classList.toggle('collapsed');
  });

  // 左右面板分割线拖动
    const divider = document.getElementById('panel-divider');
  let isDragging = false;
  divider.addEventListener('mousedown', (e) => {
    isDragging = true;
    divider.classList.add('active');
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const app = document.getElementById('app');
    const rect = app.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    const leftPct = Math.max(25, Math.min(65, pct));
    document.getElementById('left-panel').style.flex = `0 0 ${leftPct}%`;
    document.getElementById('right-panel').style.flex = `0 0 ${100 - leftPct - 0.5}%`;
  });
  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      divider.classList.remove('active');
    }
  });

  // ===== 统一窗口拖动（三种模式通用） =====
  const DRAG_THRESHOLD = 5;  // 移动超过5px才算拖动，避免点击时图标抖动

  function initDragHandle(el) {
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      // 不拦截按钮、输入框、右键菜单的点击
      if (e.target.closest('button, input, [data-nano-action]')) return;
      if (document.getElementById('nano-context-menu').classList.contains('visible')) return;
      windowDrag = { startX: e.screenX, startY: e.screenY, moved: false };
    });
  }

  // 全局 mousemove — 统一处理所有模式的窗口拖动
  document.addEventListener('mousemove', (e) => {
    if (!windowDrag) return;
    const dx = e.screenX - windowDrag.startX;
    const dy = e.screenY - windowDrag.startY;
    if (!windowDrag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    windowDrag.moved = true;
    windowDrag.startX = e.screenX;
    windowDrag.startY = e.screenY;
    if (window.api.nanoDrag) window.api.nanoDrag({ dx, dy });
  });

  // 全局 mouseup — 结束拖动
  document.addEventListener('mouseup', () => {
    if (windowDrag) {
      window._dragJustEnded = windowDrag.moved;
      windowDrag = null;
      setTimeout(() => { window._dragJustEnded = false; }, 100);
    }
  });

  // 为三种视图注册拖动句柄
  initDragHandle(document.getElementById('mini-drag-handle'));  // Mini: 顶部把手
  initDragHandle(document.getElementById('titlebar'));          // Full: 顶栏

  // ===== Nano事件（hover + 点击 + 右键菜单） =====
  const nanoFlower = document.getElementById('nano-flower');
  const nanoView = document.getElementById('nano-view');
  let nanoHoverActive = false;
  // nanoCoolingDown 已提升为全局变量，stopFocus() 需要访问它

  initDragHandle(nanoFlower);

  // Hover 预览：200ms 后展现，带防抖冷却（专注模式下不触发窗口缩放）
  nanoFlower.addEventListener('mouseenter', (e) => {
    if (nanoCoolingDown) return;  // 冷却中，忽略
    if (focusState.taskId) return; // 专注模式：不触发 hover 缩放
    const menuOpen = document.getElementById('nano-context-menu').classList.contains('visible');
    const previewOpen = document.getElementById('nano-hover-preview').classList.contains('visible');
    if (menuOpen) return;
    // 如果鼠标来自预览面板 → 说明预览已展开，不重复触发
    if (e.relatedTarget && e.relatedTarget.closest('#nano-hover-preview')) return;
    clearTimeout(nanoHoverTimer);
    nanoHoverActive = true;
    if (previewOpen) return;
    nanoHoverTimer = setTimeout(() => {
      if (nanoHoverActive && !nanoCoolingDown && !focusState.taskId) {
        // 先标冷却再扩窗口，防止窗口 resize 立即触发 mouseleave 回弹
        nanoCoolingDown = true;
        document.getElementById('nano-hover-preview').classList.add('visible');
        if (window.api.nanoHover) window.api.nanoHover(true);
        setTimeout(() => { nanoCoolingDown = false; }, 600);
      }
    }, 200);
  });

  nanoFlower.addEventListener('mouseleave', (e) => {
    if (nanoCoolingDown) return;  // 冷却中，忽略 leave
    if (focusState.taskId) return; // 专注模式：不触发 hover 缩放
    // 鼠标移入了预览面板 → 不收缩（用户在预览面板中操作）
    if (e.relatedTarget && e.relatedTarget.closest('#nano-hover-preview')) return;
    nanoHoverActive = false;
    clearTimeout(nanoHoverTimer);
    const menuVisible = document.getElementById('nano-context-menu').classList.contains('visible');
    if (menuVisible) return;
    nanoHoverTimer = setTimeout(() => {
      if (!nanoCoolingDown && !focusState.taskId) {
        nanoCoolingDown = true;
        document.getElementById('nano-hover-preview').classList.remove('visible');
        if (window.api.nanoHover) window.api.nanoHover(false);
        setTimeout(() => { nanoCoolingDown = false; }, 600);
      }
    }, 400);
  });

  // 预览面板自身：鼠标离开时关闭预览
  const nanoPreview = document.getElementById('nano-hover-preview');
  if (nanoPreview) {
    nanoPreview.addEventListener('mouseleave', (e) => {
      // 如果鼠标移回了花朵 → 不关闭
      if (e.relatedTarget && e.relatedTarget.closest('#nano-flower')) return;
      if (focusState.taskId) return;
      if (nanoCoolingDown) return;
      clearTimeout(nanoHoverTimer);
      nanoCoolingDown = true;
      nanoPreview.classList.remove('visible');
      if (window.api.nanoHover) window.api.nanoHover(false);
      setTimeout(() => { nanoCoolingDown = false; }, 600);
    });
  }

  // 单击：专注中 → 停止专注；否则 → mini（拖拽后不触发）
  nanoFlower.addEventListener('click', async () => {
    if (window._dragJustEnded) return;
    clearTimeout(nanoHoverTimer);
    nanoHoverActive = false;
    document.getElementById('nano-hover-preview').classList.remove('visible');
    document.getElementById('nano-context-menu').classList.remove('visible');
    if (window.api.nanoHover) window.api.nanoHover(false);
    // 专注模式：点击花 = 停止专注
    if (focusState.taskId) {
      await stopFocus();
      return;
    }
    await switchView('mini');
  });

  // 双击 → full（拖拽后不触发）
  nanoFlower.addEventListener('dblclick', async () => {
    if (window._dragJustEnded) return;
    clearTimeout(nanoHoverTimer);
    nanoHoverActive = false;
    document.getElementById('nano-hover-preview').classList.remove('visible');
    document.getElementById('nano-context-menu').classList.remove('visible');
    if (window.api.nanoHover) window.api.nanoHover(false);
    await switchView('full');
    if (focusState.taskId) { renderFull(); updateFullPlant(); }
  });

    nanoFlower.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    clearTimeout(nanoHoverTimer);
    nanoHoverActive = true;
    // 只展开窗口 + 显示菜单，不显示预览面板（避免重叠）
    if (window.api.nanoHover) window.api.nanoHover(true);
    document.getElementById('nano-context-menu').classList.add('visible');
  });

  // 右键菜单项点击
    document.querySelectorAll('[data-nano-action]').forEach(el => {
    el.addEventListener('click', async () => {
      const action = el.dataset.nanoAction;
      document.getElementById('nano-context-menu').classList.remove('visible');
      document.getElementById('nano-hover-preview').classList.remove('visible');
      if (window.api.nanoHover) window.api.nanoHover(false);

      switch (action) {
        case 'add-task':
          switchView('full');
          setTimeout(() => promptForNewTask('important', '请输入本周最重要的事'), 500);
          break;
        case 'view-progress':
          switchView('full');
          break;
        case 'to-mini':
          switchView('mini');
          break;
        case 'to-full':
          switchView('full');
          break;
        case 'to-tray':
          if (window.electronAPI) window.electronAPI.closeWindow();
          break;
      }
    });
  });

  // 点击空白处关闭右键菜单和预览（但保留任务选择器点击）
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#nano-context-menu') && !e.target.closest('#nano-flower') && !e.target.closest('#nano-hover-preview')) {
      document.getElementById('nano-context-menu').classList.remove('visible');
      document.getElementById('nano-hover-preview').classList.remove('visible');
      nanoHoverActive = false;
      if (window.api.nanoHover) window.api.nanoHover(false);
    }
  });

  // 初始化：默认mini模式
    document.body.classList.add('mini-mode');
  switchView('mini');
}

function promptForNewTask(listType, placeholder) {
  const containerId = listType === 'important' ? 'important-list' : 'todo-list';
  const container = document.getElementById(containerId);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:6px 0;align-items:center;';

  let html = `<input type="text" class="task-edit-input" placeholder="${placeholder}" autofocus style="flex:1;min-width:120px;" />`;

  // 要事任务额外显示截止日和优先级选择
    if (listType === 'important') {
    html += `<input type="date" class="task-deadline-input" value="${defaultDeadline()}"
      placeholder="明天/周五/下周一"
      title="输入日期或自然语言：明天、周五、下周一、3天后"
      style="width:110px;border:1px solid var(--border);border-radius:6px;padding:2px 4px;font-size:10px;color:#333;background:white;" />`;
  }

    html += `<select class="task-prio-select"
    style="width:58px;border:1px solid var(--border);border-radius:6px;padding:2px 4px;font-size:10px;color:#333;background:white;">
    <option value="high">🔴 高优</option>
    <option value="medium" selected>🟡 中优</option>
    <option value="low">🔵 低优</option>
  </select>`;

  html += `<button style="border:none;background:var(--accent-pink);color:white;border-radius:6px;padding:2px 10px;cursor:pointer;font-size:12px;">确认</button>`;
  html += `<button class="task-cancel-btn" style="border:1px solid var(--border);background:transparent;color:var(--text-secondary);border-radius:6px;padding:2px 8px;cursor:pointer;font-size:12px;">取消</button>`;

  row.innerHTML = html;

  const empty = container.querySelector('.empty-state');
  if (empty) empty.style.display = 'none';

  container.appendChild(row);
  const input = row.querySelector('input[type="text"]');
  const confirmBtn = row.querySelector('button');
  const cancelBtn = row.querySelector('.task-cancel-btn');

  function submit() {
    const val = input.value.trim();
    if (!val) return;
    let deadline = row.querySelector('.task-deadline-input')?.value || null;
    // 自然语言日期解析
    if (deadline) {
      const parsed = parseNaturalDeadline(deadline);
      if (parsed) deadline = parsed;
    }
    const priority = row.querySelector('.task-prio-select')?.value || 'medium';
    addTask(listType, val, deadline || defaultDeadline(), priority);
    row.remove();
  }

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') row.remove(); });
  confirmBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', () => row.remove());
  input.focus();
}

function handleTaskClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const card = target.closest('.task-card');
  if (!card) return;
  const id = card.dataset.id;
  const listType = card.dataset.list;
  const action = target.dataset.action;
  if (action === 'toggle') toggleTask(listType, id);
  else if (action === 'delete') deleteTask(listType, id);
  else if (action === 'focus') startFocus(id, listType);
  else if (action === 'edit') handleTaskDblClick(e);
}

function handleTaskDblClick(e) {
  const titleEl = e.target.closest('.task-title');
  if (!titleEl) return;
  const card = titleEl.closest('.task-card');
  if (!card || card.classList.contains('completed')) return;
  // 已在编辑中则跳过
  if (card.querySelector('.task-edit-input')) return;
  const listType = card.dataset.list;
  const id = card.dataset.id;
  const list = listType === 'important' ? state.important : state.todos;
  const task = list.find(t => t.id === id);
  if (!task) return;

  // 用编辑行替换卡片内容
  card.classList.add('editing');
  const contentEl = card.querySelector('.task-content');
  contentEl.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;flex:1;';

  // 第一行：文字输入 (全宽)
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'task-edit-input';
  input.value = task.title;
  input.autofocus = true;
  input.style.cssText = 'width:100%;color:#333;background:#fff;border:1px solid #ccc;border-radius:4px;padding:4px 8px;font-size:12px;outline:none;';
  wrap.appendChild(input);

  // 第二行：日期 + 优先级 + 确认 + 取消
  const row2 = document.createElement('div');
  row2.style.cssText = 'display:flex;gap:4px;align-items:center;';

  if (listType === 'important') {
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'task-deadline-input';
    dateInput.value = task.deadline || defaultDeadline();
    dateInput.min = new Date().toISOString().slice(0, 10);
    dateInput.style.cssText = 'width:110px;border:1px solid #ccc;border-radius:4px;padding:2px 4px;font-size:10px;color:#333;background:#fff;';
    row2.appendChild(dateInput);
  }

  const select = document.createElement('select');
  select.className = 'task-prio-select';
  select.style.cssText = 'width:70px;border:1px solid #ccc;border-radius:4px;padding:2px 4px;font-size:10px;color:#333;background:#fff;';
  select.innerHTML = `
    <option value="high" ${task.priority === 'high' ? 'selected' : ''}>🔴 高优</option>
    <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>🟡 中优</option>
    <option value="low" ${task.priority === 'low' ? 'selected' : ''}>🔵 低优</option>`;
  row2.appendChild(select);

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = '确认';
  confirmBtn.style.cssText = 'border:none;background:var(--accent-pink);color:#fff;border-radius:4px;padding:3px 12px;cursor:pointer;font-size:11px;white-space:nowrap;';
  row2.appendChild(confirmBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '取消';
  cancelBtn.style.cssText = 'border:1px solid #ccc;background:transparent;color:var(--text-secondary);border-radius:4px;padding:3px 10px;cursor:pointer;font-size:11px;white-space:nowrap;';
  row2.appendChild(cancelBtn);

  wrap.appendChild(row2);

  contentEl.appendChild(wrap);
  input.focus();
  input.select();

  function submit() {
    const val = input.value.trim();
    if (!val) { renderAll(); return; }
    const deadline = listType === 'important' ? (wrap.querySelector('.task-deadline-input')?.value || null) : undefined;
    const priority = wrap.querySelector('.task-prio-select')?.value;
    editTask(listType, id, { title: val, priority, deadline });
  }

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') renderAll(); });
  confirmBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', () => renderAll());
}

// ===== 拖拽排序 =====
function handleDragStart(e) {
  const card = e.target.closest('.task-card');
  if (!card) return;
  dragSource = { list: card.dataset.list, index: parseInt(card.dataset.index) };
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const card = e.target.closest('.task-card');
  if (!card || card.dataset.list !== dragSource?.list) return;
  document.querySelectorAll('.task-card.drag-over').forEach(el => el.classList.remove('drag-over'));
  card.classList.add('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  document.querySelectorAll('.task-card.drag-over').forEach(el => el.classList.remove('drag-over'));
  const card = e.target.closest('.task-card');
  if (!card || !dragSource) return;
  const targetIndex = parseInt(card.dataset.index);
  if (dragSource.list === card.dataset.list && dragSource.index !== targetIndex) {
    moveTask(dragSource.list, dragSource.index, targetIndex);
  }
  dragSource = null;
}

function handleDragEnd() {
  document.querySelectorAll('.task-card.dragging, .task-card.drag-over').forEach(el => el.classList.remove('dragging', 'drag-over'));
  dragSource = null;
}

// ===== 引导系统 =====
let onboardingStep = 0;
const ONBOARDING_KEY = 'timegarden-onboarded';

const ONBOARDING_STEPS = [
  { plant: '🌰', title: '欢迎来到周计划盆栽', desc: '我是你的桌面植物伙伴<br>用一片叶子代表一项要事<br>用花朵庆祝你的每一周' },
  { plant: '🌱', title: '种下你的第一颗种子', desc: '每项要事 = 一片叶子<br>叶子会随截止日临近而变色<br>完成任务 = 浇水让叶子开花' },
  { plant: '🌸', title: '我会陪你度过这周', desc: '每天打开看看我<br>逾期太久叶子会枯萎<br>全部完成我就会盛开!' }
];

function showOnboarding() {
  const overlay = document.getElementById('onboarding-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  onboardingStep = 0;
  renderOnboardingStep();
}

function renderOnboardingStep() {
  const s = ONBOARDING_STEPS[onboardingStep];
  document.getElementById('onboarding-plant').textContent = s.plant;
  document.getElementById('onboarding-title').textContent = s.title;
  document.getElementById('onboarding-desc').innerHTML = s.desc;
  document.getElementById('onboarding-next').textContent = onboardingStep < 2 ? '下一步' : '开始使用';

  const dots = document.querySelectorAll('#onboarding-dots span');
  dots.forEach((d, i) => d.classList.toggle('active', i === onboardingStep));
}

function advanceOnboarding() {
  onboardingStep++;
  if (onboardingStep >= 3) {
    finishOnboarding();
  } else {
    // Step animation
    const card = document.getElementById('onboarding-card');
    card.style.animation = 'none';
    card.offsetHeight;
    card.style.animation = 'obCardIn 0.5s cubic-bezier(0.34,1.56,0.64,1)';
    renderOnboardingStep();
  }
}

function finishOnboarding() {
  try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch(e) {}
  const overlay = document.getElementById('onboarding-overlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  setTimeout(() => { if (overlay) overlay.remove(); }, 600);
}

// ===== 完成庆祝 =====
let celebTimeout = null;

function triggerCelebration() {
  const overlay = document.getElementById('celebration-overlay');
  if (!overlay || overlay.classList.contains('active')) return;

  // 总耗时统计
  const totalMs = state.important.reduce((s, t) => s + (t.weeklyTimeMs || 0), 0);
  const sub = document.getElementById('celebration-sub');
  if (totalMs > 0) {
    const h = Math.floor(totalMs / 3600000);
    const m = Math.floor((totalMs % 3600000) / 60000);
    sub.textContent = '本周投入 ' + (h > 0 ? h + 'h' : '') + m + 'min · 全部完成!';
  } else {
    sub.textContent = '所有要事全部完成!';
  }

  overlay.classList.add('active');
  spawnConfetti();

  if (celebTimeout) clearTimeout(celebTimeout);
  celebTimeout = setTimeout(() => {
    overlay.classList.remove('active');
    document.getElementById('celebration-confetti').innerHTML = '';
  }, 3500);
}

function spawnConfetti() {
  const container = document.getElementById('celebration-confetti');
  const colors = ['#4ade80','#f5a0b8','#f5d76e','#60a5fa','#fb7185','#a78bfa','#fbbf24'];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = (Math.random() * 100) + '%';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = (Math.random() * 0.8) + 's';
    piece.style.animationDuration = (2 + Math.random() * 2) + 's';
    piece.style.width = (6 + Math.random() * 8) + 'px';
    piece.style.height = (6 + Math.random() * 8) + 'px';
    container.appendChild(piece);
    setTimeout(() => piece.remove(), 4000);
  }
}

// ===== 每日仪式 =====
function checkDailyRitual() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const lastDate = localStorage.getItem('timegarden-last-open');
  const isFirstToday = lastDate !== today;

  try { localStorage.setItem('timegarden-last-open', today); } catch(e) {}

  if (!isFirstToday) return;

  const hour = now.getHours();
  const total = state.important.length;
  const done = state.important.filter(t => t.completed).length;
  const overdue = state.important.filter(t => !t.completed && getTaskUrgency(t).days < 0).length;
  const todayDue = state.important.filter(t => !t.completed && getTaskUrgency(t).days === 0).length;

  if (hour < 12) {
    // 早安
    let msg = '☀️ 早安! ';
    if (total === 0) msg += '今天种点什么吧';
    else if (done === total) msg += '昨天全部完成，今天继续加油!';
    else if (overdue > 0) msg += overdue + ' 项已逾期，今天抓紧哦';
    else if (todayDue > 0) msg += todayDue + ' 项今天截止，加油!';
    else msg += '今天也要元气满满!';
    showRitualToast(msg);
  } else if (hour >= 18) {
    // 晚间
    let msg = '🌙 ';
    if (done === total && total > 0) msg += '今天的努力都开花结果了';
    else if (done > 0) msg += '已完成 ' + done + '/' + total + '，明天继续';
    else if (total > 0) msg += '今天还没完成任务，加油!';
    else msg += '晚安，明天记得种下种子';
    showRitualToast(msg);
  }
}

let ritualTimer = null;
function showRitualToast(msg) {
  // 复用 plant-speech 做仪式提示
  const miniSpeech = document.getElementById('plant-speech');
  if (!miniSpeech) return;

  miniSpeech.textContent = msg;
  const potWrap = document.getElementById('plant-pot-wrap');
  if (potWrap) {
    const rect = potWrap.getBoundingClientRect();
    miniSpeech.style.left = (rect.left + rect.width / 2) + 'px';
    miniSpeech.style.top = (rect.top - 12) + 'px';
    miniSpeech.style.transform = 'translate(-50%, -100%) translateY(4px)';
  }
  miniSpeech.classList.add('visible');
  if (ritualTimer) clearTimeout(ritualTimer);
  ritualTimer = setTimeout(() => miniSpeech.classList.remove('visible'), 4000);
}

// ===== Spring Ripple =====
function setupRippleEffect() {
  document.addEventListener('click', (e) => {
    const target = e.target.closest('button, .task-card, .mini-task-bubble, .task-checkbox');
    if (!target) return;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
    ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
    target.style.overflow = target.style.overflow || 'hidden';
    target.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });
}

// ===== 自然语言日期解析 =====
function parseNaturalDeadline(input) {
  if (!input || !input.trim()) return null;
  const raw = input.trim();

  // 已是标准日期
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const today = new Date();
  const dayMap = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':7,'天':7 };
  const relativeMap = {
    '今天':0, '明天':1, '后天':2, '大后天':3,
    '昨天':-1, '前天':-2
  };

  // 相对日期
  for (const [k, v] of Object.entries(relativeMap)) {
    if (raw === k) {
      const d = new Date(today); d.setDate(d.getDate() + v);
      return d.toISOString().slice(0, 10);
    }
  }

  // "下周一" "下周三"
  const nextMatch = raw.match(/^下周([一二三四五六日天])$/);
  if (nextMatch) {
    const targetDay = dayMap[nextMatch[1]];
    const currentDay = today.getDay() || 7;
    let daysUntil = targetDay - currentDay;
    if (daysUntil <= 0) daysUntil += 7;
    daysUntil += 7; // "下周" = 再加7天
    const d = new Date(today); d.setDate(d.getDate() + daysUntil);
    return d.toISOString().slice(0, 10);
  }

  // "周五" "周三"
  const weekMatch = raw.match(/^周([一二三四五六日天])$|^星期([一二三四五六日天])$/);
  if (weekMatch) {
    const targetDay = dayMap[weekMatch[1] || weekMatch[2]];
    const currentDay = today.getDay() || 7;
    let daysUntil = targetDay - currentDay;
    if (daysUntil <= 0) daysUntil += 7;
    const d = new Date(today); d.setDate(d.getDate() + daysUntil);
    return d.toISOString().slice(0, 10);
  }

  // "3天后" "5天后"
  const daysMatch = raw.match(/^(\d+)天后?$/);
  if (daysMatch) {
    const d = new Date(today); d.setDate(d.getDate() + parseInt(daysMatch[1]));
    return d.toISOString().slice(0, 10);
  }

  return null;
}

// ===== 智能提醒 =====
function showSmartNudge() {
  const todayUrgent = state.important.filter(t => !t.completed && getTaskUrgency(t).days === 0);
  if (todayUrgent.length === 0) return;

  const names = todayUrgent.map(t => t.title).join('、');
  const miniSpeech = document.getElementById('plant-speech');
  if (!miniSpeech || miniSpeech.classList.contains('visible')) return;

  miniSpeech.textContent = '⏰ ' + names + ' 今天截止!';
  const potWrap = document.getElementById('plant-pot-wrap');
  if (potWrap) {
    const rect = potWrap.getBoundingClientRect();
    miniSpeech.style.left = (rect.left + rect.width / 2) + 'px';
    miniSpeech.style.top = (rect.top - 12) + 'px';
    miniSpeech.style.transform = 'translate(-50%, -100%) translateY(4px)';
  }
  miniSpeech.classList.add('visible');
  setTimeout(() => miniSpeech.classList.remove('visible'), 3000);
}

// ===== 初始化 =====
async function init() {
  loadTheme();  // 在渲染前加载主题偏好
  loadBubblePositions();
  try {
    const saved = await window.api.loadData();
    const currentWeek = getWeekKey(new Date());

    if (saved && saved.weekKey && saved.weekKey !== currentWeek) {
        await window.api.archiveWeek(saved.weekKey, saved);
      state.weekKey = currentWeek;
      state.important = [];
      state.todos = [];
    } else if (saved) {
      state.weekKey = saved.weekKey || currentWeek;
      state.important = (saved.important || []).map(migrateTask);
      state.todos = (saved.todos || []).map(migrateTask);
    } else {
      state.weekKey = currentWeek;
    }
  } catch (e) {
    console.error('初始化数据失败:', e);
    state.weekKey = getWeekKey(new Date());
  }
  renderAll();
  setupEventListeners();
  setupPlantInteractions();
  setupRippleEffect();
  setupBubbleDrag();
  morningAnimation();
  startIdleAnimations();

  // 首次使用 → 引导
  const onboarded = localStorage.getItem(ONBOARDING_KEY);
  if (!onboarded) showOnboarding();

  // 每日仪式
  setTimeout(checkDailyRitual, 1500);

  // 智能提醒（每5分钟检查一次即将截止的任务）
  setInterval(showSmartNudge, 300000);
}

init();