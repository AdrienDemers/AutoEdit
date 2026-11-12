const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { pathToFileURL } = require('url');

contextBridge.exposeInMainWorld('autoEditDesktop', Object.freeze({
  getPathForFile: (file) => webUtils.getPathForFile(file),
  pathToFileURL: (filePath) => pathToFileURL(filePath).href,
  loadSession: () => ipcRenderer.invoke('session:load'),
  saveSession: (session) => ipcRenderer.sendSync('session:save', session),
  readAudioFile: (filePath) => ipcRenderer.invoke('media:read-audio', filePath),
  openAnalysisWindow: (options) => ipcRenderer.invoke('analysis:open', options),
  applyAnalysisSettings: (settings) => ipcRenderer.sendSync('analysis:apply', settings),
  onAnalysisSettings: (callback) => {
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on('analysis:apply-settings', listener);
    return () => ipcRenderer.removeListener('analysis:apply-settings', listener);
  },
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (project) => ipcRenderer.invoke('project:save', project)
}));