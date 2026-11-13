(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AutoEditAudioScrubber = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  class AudioScrubber {
    constructor(onError) {
      this.onError = onError;
      this.entries = new Map();
      this.idleTimer = null;
    }

    preview(tracks) {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => this.stop(), 180);
      const audible = tracks.filter((track) => track.volume > 0);
      for (const [key, entry] of this.entries) {
        if (!audible.some((track) => track.key === key && track.url === entry.player.src)) {
          this.release(entry);
          this.entries.delete(key);
        }
      }
      for (const track of audible) {
        let entry = this.entries.get(track.key);
        if (!entry) {
          const player = document.createElement('audio');
          player.preload = 'auto';
          entry = { player, phase: 'idle', generation: 0, pending: null, timer: null };
          this.entries.set(track.key, entry);
          for (const name of ['loadedmetadata', 'loadeddata', 'canplay', 'seeked']) {
            player.addEventListener(name, () => this.ready(entry));
          }
          player.addEventListener('error', () => {
            if (entry.phase !== 'idle' && entry.phase !== 'failed') {
              this.fail(entry, new Error(`Could not decode scrub audio: ${player.error?.message || track.url}`));
            }
          });
          player.src = track.url;
        }
        entry.pending = track;
        if (entry.phase === 'idle') this.start(entry);
      }
    }

    start(entry) {
      const track = entry.pending;
      entry.pending = null;
      entry.track = track;
      entry.phase = 'metadata';
      entry.generation++;
      entry.timer = setTimeout(() => this.fail(entry, new Error('Timed out preparing scrub audio.')), 1500);
      this.ready(entry);
    }

    ready(entry) {
      const player = entry.player;
      if (entry.phase === 'metadata' && player.readyState >= 1) {
        if (entry.pending) {
          entry.track = entry.pending;
          entry.pending = null;
        }
        entry.phase = 'seeking';
        player.volume = entry.track.volume;
        try {
          player.currentTime = Math.max(0, Math.min(player.duration - 0.001, entry.track.time));
        } catch (error) {
          this.fail(entry, error);
          return;
        }
      }
      if (entry.phase !== 'seeking' || player.seeking || player.readyState < 2) return;
      entry.phase = 'starting';
      const generation = entry.generation;
      player.play().then(() => {
        if (entry.generation !== generation) return;
        clearTimeout(entry.timer);
        entry.phase = 'playing';
        const remaining = (entry.track.end ?? player.duration) - player.currentTime;
        entry.timer = setTimeout(() => {
          player.pause();
          entry.phase = 'idle';
          if (entry.pending) this.start(entry);
        }, Math.max(0, Math.min(120, remaining * 1000)));
      }).catch((error) => {
        if (entry.generation === generation) this.fail(entry, error);
      });
    }

    stop() {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
      for (const entry of this.entries.values()) {
        entry.generation++;
        clearTimeout(entry.timer);
        entry.pending = null;
        entry.phase = 'idle';
        entry.player.pause();
      }
    }

    fail(entry, error) {
      entry.generation++;
      clearTimeout(entry.timer);
      entry.player.pause();
      entry.pending = null;
      entry.phase = 'failed';
      this.onError(error);
    }

    release(entry) {
      entry.generation++;
      clearTimeout(entry.timer);
      entry.phase = 'idle';
      entry.player.pause();
      entry.player.removeAttribute('src');
      entry.player.load();
    }

    dispose() {
      this.stop();
      for (const entry of this.entries.values()) this.release(entry);
      this.entries.clear();
    }
  }
  return AudioScrubber;
});
