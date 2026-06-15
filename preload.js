const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('load-data'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  archiveWeek: (weekKey, data) => ipcRenderer.invoke('archive-week', { weekKey, data }),
  checkNewWeek: (currentWeekKey) => ipcRenderer.invoke('check-new-week', currentWeekKey),
  loadHistory: (weekKey) => ipcRenderer.invoke('load-history', weekKey),
  listHistoryWeeks: () => ipcRenderer.invoke('list-history-weeks'),
  togglePanel: () => ipcRenderer.invoke('toggle-panel'),
  collapsePanel: () => ipcRenderer.invoke('collapse-panel'),
  setMode: (mode) => ipcRenderer.invoke('set-mode', mode),
  toggleNano: () => ipcRenderer.invoke('toggle-nano'),
  setNanoMode: (active) => ipcRenderer.invoke('set-nano-mode', active),
  nanoHover: (hovering) => ipcRenderer.invoke('nano-hover', hovering),
  nanoDrag: ({dx, dy}) => ipcRenderer.invoke('nano-drag', {dx, dy}),
  nanoFocusMode: (active, width) => ipcRenderer.invoke('nano-focus-mode', active, width),
  nanoShrink: () => ipcRenderer.invoke('nano-shrink'),
  getNanoState: () => ipcRenderer.invoke('get-nano-state')
});
contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window')
});