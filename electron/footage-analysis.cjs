const { Worker } = require('node:worker_threads');
const fs = require('node:fs/promises');
const path = require('node:path');

function registerFootageAnalysis({ app, ipcMain, allowedPaths }) {
  const jobs = new Map();
  const authorize = (sender, filePath) => {
    if (typeof filePath !== 'string' || !allowedPaths(sender).has(filePath)) {
      throw new Error('Video file is not part of the current AutoEdit project.');
    }
  };
  ipcMain.handle('footage:fingerprint', async (event, filePath) => {
    authorize(event.sender, filePath);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('The source path is not a video file.');
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  });
  ipcMain.handle('footage:analyze', (event, options) => {
    authorize(event.sender, options?.filePath);
    if (!Number.isFinite(options.duration) || options.duration <= 0) throw new Error('The video duration is not available.');
    if (jobs.has(event.sender)) throw new Error('Footage analysis is already running.');
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, 'footage-worker.cjs'), {
        workerData: {
          filePath: options.filePath, duration: options.duration, cached: options.cached,
          cacheDir: path.join(app.getPath('userData'), 'audio-models')
        }
      });
      const job = { worker, cancelTimer: null, decoderPid: null };
      jobs.set(event.sender, job);
      let outcome = null;
      const cancel = () => {
        worker.postMessage({ type: 'cancel' });
        if (job.decoderPid) {
          try { process.kill(job.decoderPid); } catch (error) {
            if (error.code !== 'ESRCH') console.error('Could not stop the footage decoder.', error);
          }
        }
        // Model loading/inference may not yield to cancellation immediately.
        if (!job.cancelTimer) job.cancelTimer = setTimeout(() => worker.terminate(), 3000);
      };
      event.sender.once('destroyed', cancel);
      worker.on('message', (message) => {
        if (message.type === 'progress') {
          if (!event.sender.isDestroyed()) event.sender.send('footage:progress', message);
        } else if (message.type === 'decoder') {
          job.decoderPid = message.pid;
        } else if (message.type === 'result' || message.type === 'error') {
          outcome = message;
        }
      });
      worker.once('error', (error) => { outcome = { type: 'error', message: error.message }; });
      worker.once('exit', (code) => {
        clearTimeout(job.cancelTimer);
        jobs.delete(event.sender);
        event.sender.removeListener('destroyed', cancel);
        if (job.cancelTimer) reject(new Error('Footage analysis canceled.'));
        else if (outcome?.type === 'result') resolve(outcome.result);
        else reject(new Error(outcome?.message || `Analysis worker exited unexpectedly (${code}).`));
      });
      job.cancel = cancel;
    });
  });
  ipcMain.handle('footage:cancel', (event) => { jobs.get(event.sender)?.cancel(); });
  app.on('before-quit', () => { for (const job of jobs.values()) job.cancel(); });
}

module.exports = { registerFootageAnalysis };
