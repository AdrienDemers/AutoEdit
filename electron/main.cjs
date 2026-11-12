const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');

const sessionFilePath = () => path.join(app.getPath('userData'), 'session.json');
const projectPaths = new WeakMap();
const projectMediaPaths = new WeakMap();
const analysisWindows = new WeakMap();
const analysisWindowOwners = new WeakMap();

const mediaPathsFor = (session) => new Set([
  session?.music?.path,
  ...(session?.videos || []).map((video) => video.path)
].filter(Boolean));

function readSession() {
  try {
    return JSON.parse(fs.readFileSync(sessionFilePath(), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

ipcMain.handle('session:load', () => readSession());

ipcMain.on('session:save', (event, session) => {
  const filePath = sessionFilePath();
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporaryPath, JSON.stringify(session), 'utf8');
    fs.renameSync(temporaryPath, filePath);
    event.returnValue = true;
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
    event.returnValue = false;
  }
});

ipcMain.handle('media:read-audio', async (event, filePath) => {
  const session = readSession();
  const savedSessionPath = session?.music?.path;
  const projectPaths = projectMediaPaths.get(event.sender);
  if (savedSessionPath !== filePath && !projectPaths?.has(filePath)) {
    throw new Error('Audio file is not part of the current AutoEdit session.');
  }
  return fs.promises.readFile(filePath);
});

ipcMain.handle('analysis:open', async (event, options = {}) => {
  const { filePath, name } = options;
  const allowedPaths = projectMediaPaths.get(event.sender);
  if (typeof filePath !== 'string' || (readSession()?.music?.path !== filePath && !allowedPaths?.has(filePath))) {
    throw new Error('Audio file is not part of the current AutoEdit session.');
  }

  const parent = BrowserWindow.fromWebContents(event.sender);
  if (!parent) throw new Error('The main AutoEdit window is no longer available.');
  const windowOptions = {
    width: 720,
    height: 620,
    minWidth: 560,
    minHeight: 520,
    parent,
    title: `Fine-tune analysis · ${name || path.basename(filePath)}`,
    backgroundColor: '#171a18',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };
  let analysisWindow = analysisWindows.get(event.sender);
  if (!analysisWindow || analysisWindow.isDestroyed()) {
    analysisWindow = new BrowserWindow(windowOptions);
    analysisWindows.set(event.sender, analysisWindow);
    analysisWindowOwners.set(analysisWindow.webContents, event.sender);
    analysisWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  } else {
    analysisWindow.setTitle(windowOptions.title);
    analysisWindow.focus();
  }

  const mediaPaths = new Set([...(allowedPaths || []), ...mediaPathsFor(readSession())]);
  projectMediaPaths.set(analysisWindow.webContents, mediaPaths);
  await analysisWindow.loadFile(path.join(__dirname, 'fine-tune.html'), {
    query: {
      filePath,
      name: name || path.basename(filePath),
      sensitivity: String(options.sensitivity ?? 55),
      cadence: String(options.cadence ?? 2)
    }
  });
  analysisWindow.show();
});

ipcMain.on('analysis:apply', (event, settings) => {
  const owner = analysisWindowOwners.get(event.sender);
  if (!owner || owner.isDestroyed()) {
    event.returnValue = false;
    return;
  }
  const sensitivity = Number(settings?.sensitivity);
  const cadence = String(settings?.cadence);
  if (!Number.isInteger(sensitivity) || sensitivity < 25 || sensitivity > 85 || !['1', '2', '4'].includes(cadence)) {
    event.returnValue = false;
    return;
  }
  owner.send('analysis:apply-settings', { sensitivity, cadence });
  event.returnValue = true;
});

ipcMain.handle('project:open', async (event) => {
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    properties: ['openFile'],
    filters: [{ name: 'AutoEdit Project', extensions: ['autoedit'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;

  const filePath = result.filePaths[0];
  const project = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
  if (project.format !== 'autoedit-project' || project.version !== 1 || project.session?.version !== 1) {
    throw new Error('This is not a supported AutoEdit project file.');
  }
  projectPaths.set(event.sender, filePath);
  projectMediaPaths.set(event.sender, mediaPathsFor(project.session));
  return {
    filePath,
    name: project.name || path.basename(filePath, path.extname(filePath)),
    session: project.session
  };
});

ipcMain.handle('project:save', async (event, project) => {
  let filePath = projectPaths.get(event.sender);
  if (!filePath) {
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      defaultPath: `${project.name || 'Untitled music video'}.autoedit`,
      filters: [{ name: 'AutoEdit Project', extensions: ['autoedit'] }]
    });
    if (result.canceled || !result.filePath) return null;
    filePath = result.filePath.endsWith('.autoedit') ? result.filePath : `${result.filePath}.autoedit`;
  }

  const projectFile = {
    format: 'autoedit-project',
    version: 1,
    name: project.name || path.basename(filePath, path.extname(filePath)),
    savedAt: new Date().toISOString(),
    session: project.session
  };
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await fs.promises.writeFile(temporaryPath, JSON.stringify(projectFile, null, 2), 'utf8');
    await fs.promises.rename(temporaryPath, filePath);
  } catch (error) {
    try { await fs.promises.rm(temporaryPath, { force: true }); } catch {}
    throw error;
  }
  projectPaths.set(event.sender, filePath);
  projectMediaPaths.set(event.sender, mediaPathsFor(project.session));
  return { filePath, name: projectFile.name };
});

function createMainWindow() {
  const windowTitle = `AutoEdit v${app.getVersion()}`;
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 680,
    title: windowTitle,
    backgroundColor: '#171a18',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.webContents.on('page-title-updated', (event) => {
    event.preventDefault();
    window.setTitle(windowTitle);
  });
  window.loadFile(path.join(__dirname, '..', 'index.html'));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

app.whenReady().then(() => {
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});