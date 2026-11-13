const { parentPort, workerData } = require('node:worker_threads');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { frameMotion, audioEvents, validAnalysis, sameFingerprint } = require('../shared/footage-analysis.js');

const ffmpegPath = require('ffmpeg-static').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
let cancelled = false;
let decoder = null;
parentPort.on('message', (message) => {
  if (message.type !== 'cancel') return;
  cancelled = true;
  if (decoder) decoder.kill();
});
function checkCancelled() {
  if (cancelled) throw new Error('Footage analysis canceled.');
}
const progress = (message, fraction) => parentPort.postMessage({ type: 'progress', message, fraction });

async function decode(args, blockBytes, consume, allowNoAudio = false) {
  checkCancelled();
  const child = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '2', ...args], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  decoder = child;
  parentPort.postMessage({ type: 'decoder', pid: child.pid });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
  const closed = new Promise((resolve) => {
    child.once('error', (error) => resolve({ error }));
    child.once('close', (code) => resolve({ code }));
  });
  let pending = Buffer.alloc(0);
  try {
    for await (const chunk of child.stdout) {
      checkCancelled();
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= blockBytes) {
        await consume(pending.subarray(0, blockBytes));
        pending = pending.subarray(blockBytes);
      }
    }
    const result = await closed;
    checkCancelled();
    if (result.error) throw result.error;
    if (result.code !== 0) {
      if (allowNoAudio && /Stream map ['"]0:a:0['"] matches no streams/.test(stderr)) return false;
      throw new Error(`Media decoding failed: ${stderr.trim() || `FFmpeg exit ${result.code}`}`);
    }
    if (pending.length) await consume(pending);
    return true;
  } finally {
    if (child.exitCode === null) child.kill();
    await closed;
    decoder = null;
    parentPort.postMessage({ type: 'decoder', pid: null });
  }
}

async function analyze() {
  const { filePath, duration, cacheDir, cached } = workerData;
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error('The source path is not a video file.');
  const fingerprint = { size: stat.size, mtimeMs: stat.mtimeMs };
  if (validAnalysis(cached) && sameFingerprint(cached.fingerprint, fingerprint) && cached.duration === duration) {
    return cached;
  }
  const motion = [];
  let previous = null;
  let frame = 0;
  let sum = 0;
  let count = 0;
  await decode(['-i', filePath, '-map', '0:v:0', '-an', '-vf', 'fps=4,scale=64:36', '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1'],
    64 * 36, async (pixels) => {
      if (pixels.length !== 64 * 36) throw new Error('The video decoder returned an incomplete frame.');
      sum += frameMotion(previous, pixels);
      count++;
      previous = Buffer.from(pixels);
      frame++;
      if (frame % 8 === 0) {
        const start = (frame - 8) / 4;
        if (start < duration) motion.push({ start, end: Math.min(duration, frame / 4), score: sum / count });
        sum = 0;
        count = 0;
        progress('Measuring video motion', Math.min(0.45, frame / 4 / duration * 0.45));
      }
    });
  if (count) {
    const start = (frame - count) / 4;
    if (start < duration) motion.push({ start, end: Math.min(duration, frame / 4), score: sum / count });
  }
  if (!motion.length) throw new Error('No video frames could be analyzed.');

  let classifier = null;
  const audio = [];
  let sample = 0;
  const modelProgress = new Map();
  const hasAudio = await decode(['-i', filePath, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'],
    16000 * 5 * 4, async (bytes) => {
      if (!classifier) {
        progress('Loading audio model (first use downloads model files; footage stays local)', 0.45);
        const { pipeline, env } = await import('@huggingface/transformers');
        env.cacheDir = cacheDir;
        classifier = await pipeline('audio-classification', 'onnx-community/ast-finetuned-audioset-10-10-0.4593-ONNX', {
          dtype: 'q8', device: 'cpu',
          revision: '2fe67046c486b8b8bc90a7b469239b2dec822f72',
          session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
          progress_callback: (event) => {
            if (event.status === 'download') progress(`Downloading audio model file: ${event.file} (footage stays local)`, 0.45);
            if (event.status === 'progress' && event.progress >= (modelProgress.get(event.file) || 0) + 10) {
              modelProgress.set(event.file, event.progress);
              progress(`Downloading audio model: ${Math.round(event.progress)}% (footage stays local)`, 0.45);
            }
          }
        });
      }
      checkCancelled();
      if (bytes.length % 4) throw new Error('The audio decoder returned incomplete samples.');
      const samples = new Float32Array(bytes.length / 4);
      for (let index = 0; index < samples.length; index++) samples[index] = bytes.readFloatLE(index * 4);
      const start = sample / 16000;
      sample += samples.length;
      if (start >= duration) return;
      const inputs = await classifier.processor(samples);
      const output = await classifier.model(inputs);
      const events = audioEvents(output.logits.data, classifier.model.config.id2label);
      audio.push({ start, end: Math.min(duration, sample / 16000), ...events });
      progress('Detecting speech and clapping', 0.45 + Math.min(0.55, sample / 16000 / duration * 0.55));
    }, true);
  if (classifier) await classifier.dispose();
  checkCancelled();
  const currentStat = await fs.stat(filePath);
  if (!sameFingerprint(fingerprint, { size: currentStat.size, mtimeMs: currentStat.mtimeMs })) {
    throw new Error('The source file changed during analysis. Analyze it again.');
  }
  const result = { version: 1, fingerprint, duration, motion, audio, audioStatus: hasAudio ? 'available' : 'none' };
  if (!validAnalysis(result)) throw new Error('The source did not produce valid analysis ranges.');
  return result;
}

analyze().then(
  (result) => parentPort.postMessage({ type: 'result', result }),
  (error) => parentPort.postMessage({ type: 'error', message: error.message })
).finally(() => parentPort.close());
