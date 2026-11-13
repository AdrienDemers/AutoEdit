const { contextBridge, ipcRenderer, webUtils } = require('electron');

function pathToFileURL(filePath) {
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/%/g, '%25');
  const url = new URL('file:///');
  if (normalizedPath.startsWith('//')) {
    const [, , host, ...segments] = normalizedPath.split('/');
    url.hostname = host;
    url.pathname = `/${segments.join('/')}`;
  } else {
    url.pathname = `/${normalizedPath.replace(/^\/+/, '')}`;
  }
  return url.href;
}

contextBridge.exposeInMainWorld('autoEditDesktop', Object.freeze({
  getPathForFile: (file) => webUtils.getPathForFile(file),
  pathToFileURL,
  loadSession: () => ipcRenderer.invoke('session:load'),
  saveSession: (session) => ipcRenderer.sendSync('session:save', session),
  readAudioFile: (filePath) => ipcRenderer.invoke('media:read-audio', filePath),
  getFootageFingerprint: (filePath) => ipcRenderer.invoke('footage:fingerprint', filePath),
  analyzeFootage: (options) => ipcRenderer.invoke('footage:analyze', options),
  cancelFootageAnalysis: () => ipcRenderer.invoke('footage:cancel'),
  onFootageProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('footage:progress', listener);
    return () => ipcRenderer.removeListener('footage:progress', listener);
  },
  openAnalysisWindow: (options) => ipcRenderer.invoke('analysis:open', options),
  applyAnalysisSettings: (settings) => ipcRenderer.sendSync('analysis:apply', settings),
  onAnalysisSettings: (callback) => {
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on('analysis:apply-settings', listener);
    return () => ipcRenderer.removeListener('analysis:apply-settings', listener);
  },
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (project) => ipcRenderer.invoke('project:save', project),
  beginVideoExport: () => ipcRenderer.invoke('video-export:begin'),
  writeVideoExport: (chunk) => ipcRenderer.invoke('video-export:write', chunk),
  finishVideoExport: () => ipcRenderer.invoke('video-export:finish'),
  cancelVideoExport: () => ipcRenderer.invoke('video-export:cancel')
}));