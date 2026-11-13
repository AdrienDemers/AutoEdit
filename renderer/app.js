(() => {
  const state = { music: null, audioBuffer: null, musicEnergy: [], beatTimes: [], detectedCutTimes: [], musicCutOverrides: { added: [], removed: [] }, beatCandidates: [], tempoBpm: 0, videos: [], edit: [], activeCut: null, objectUrls: new Set(), playing: false, musicAudioEnabled: true, clipAudioEnabled: true, musicVolume: 0.8, scrubAudioEnabled: false, useFootageAnalysis: true, previewResolution: 'full', workspace: 'editing', analysisTarget: 'music', analysisTime: 0 };
  const footage = window.AutoEditFootage;
  const accents = window.AutoEditAccents;
  const colors = window.AutoEditColor;
  const audioScrubber = new window.AutoEditAudioScrubber((error) => {
    showNotice('generateNotice', `Audio scrubbing failed: ${error.message}`, 'warning');
  });
  const rangeKinds = { speech: 'Speech', clapping: 'Clapping', motion: 'Motion' };
  let selectedAccentTime = null;
  let selectedRangeIndex = null;
  let selectedCutIndex = null;
  let rangeKind = 'speech';
  let sourceDrag = null;
  let sourceSlipDrag = null;
  const $ = (id) => document.getElementById(id);
  const panelLayoutStorageKey = 'autoedit-panel-layout';
  const panelLayout = { libraryWidth: 248, inspectorWidth: 268, monitorRatio: 0.6 };
  const musicInput = $('musicInput');
  const videoInput = $('videoInput');
  const musicPlayer = $('musicPlayer');
  const previewVideo = $('previewVideo');
  let activePreviewVideo = previewVideo;
  let previewSourceId = null;
  let colorPreviewError = null;
  const previewCanvas = $('previewCanvas');
  const monitorElement = $('monitor');
  const previewContextMenu = $('previewContextMenu');
  const clipSlipOverlay = $('clipSlipOverlay');
  const clipSlipPreview = $('clipSlipPreview');
  const clipSlipTrack = $('clipSlipTrack');
  const clipSlipWindow = $('clipSlipWindow');
  const previewContext = previewCanvas.getContext('2d', { alpha: false });
  previewVideo.preload = 'metadata';
  const canvas = $('waveform');
  const context = canvas.getContext('2d');
  const desktopApi = window.autoEditDesktop || null;
  let activeExport = null;
  let footageTask = null;
  let musicAnalysisTask = null;
  const timelineZoom = { music: 1, footage: 1 };
  const maximumTimelineZoom = 64;
  const trackHeaderWidth = 82;
  let navigatorDrag = null;
  let playheadDrag = null;
  let resumeAfterScrub = false;
  let musicAccentDrag = null;
  let playheadAnimationFrameId = null;
  let suppressWaveClick = false;
  let saveSessionTimer = null;
  let frameSampleTimer = null;
  let previewFrameCallbackId = null;
  let previewAnimationFrameId = null;
  let lastDroppedFrameCount = null;
  let droppedFrameCount = 0;
  const previewPlayers = new Map();
  const maximumCachedPreviewPlayers = 3;
  const videoExportTypes = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4'
  ];

  function getSupportedMp4Type() {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
    return videoExportTypes.find((type) => MediaRecorder.isTypeSupported(type)) || null;
  }

  function supportsMp4Export() {
    return Boolean(getSupportedMp4Type());
  }

  function getExportDiagnostics(available) {
    const exportApiMethods = ['beginVideoExport', 'writeVideoExport', 'finishVideoExport', 'cancelVideoExport'];
    const missingMethods = exportApiMethods.filter((method) => typeof desktopApi?.[method] !== 'function');
    const audioContextConstructor = window.AudioContext || window.webkitAudioContext;
    const hasAudioCapture = typeof audioContextConstructor === 'function'
      && typeof audioContextConstructor.prototype.createMediaStreamDestination === 'function';
    const videosWithDuration = state.videos.filter((video) => video.duration > 0).length;
    const supportedMp4Type = getSupportedMp4Type();
    const audioDuration = duration();
    const checks = [
      {
        label: 'Desktop bridge',
        available: missingMethods.length === 0,
        detail: missingMethods.length ? `Missing API: ${missingMethods.join(', ')}` : 'All video export IPC methods are available.'
      },
      {
        label: 'MP4 encoder',
        available: Boolean(supportedMp4Type),
        detail: supportedMp4Type || 'MediaRecorder does not report an MP4 format as supported.'
      },
      {
        label: 'Canvas capture',
        available: typeof HTMLCanvasElement.prototype.captureStream === 'function',
        detail: typeof HTMLCanvasElement.prototype.captureStream === 'function' ? 'Canvas captureStream is available.' : 'HTMLCanvasElement.captureStream is unavailable.'
      },
      {
        label: 'Audio capture',
        available: hasAudioCapture,
        detail: hasAudioCapture ? 'Web Audio can create an audio output stream.' : 'AudioContext.createMediaStreamDestination is unavailable.'
      },
      {
        label: 'Music track',
        available: Boolean(state.music),
        detail: state.music ? state.music.file.name : 'Import a music track.'
      },
      {
        label: 'Music duration',
        available: Boolean(state.music && audioDuration > 0),
        detail: audioDuration > 0 ? `${audioDuration.toFixed(2)} seconds` : 'Waiting for the music duration to load.'
      },
      {
        label: 'Video sources',
        available: videosWithDuration > 0,
        detail: `${videosWithDuration} of ${state.videos.length} source videos have a loaded duration.`
      },
      {
        label: 'Timeline',
        available: Boolean(available && state.edit.length),
        detail: state.edit.length ? `${state.edit.length} generated clips.` : 'Generate a timeline with at least one clip.'
      }
    ];
    return checks;
  }

  function renderExportDiagnostics(checks) {
    const readyCount = checks.filter((check) => check.available).length;
    $('exportDiagnosticsSummary').textContent = `Export checks ${readyCount}/${checks.length}`;
    $('exportDiagnosticsList').replaceChildren(...checks.map((check) => {
      const item = document.createElement('li');
      item.dataset.status = check.available ? 'ready' : 'missing';
      const status = document.createElement('span');
      status.className = 'export-check-status';
      status.textContent = check.available ? 'Ready' : 'Missing';
      const detail = document.createElement('span');
      detail.className = 'export-check-detail';
      const label = document.createElement('strong');
      label.textContent = check.label;
      const message = document.createElement('span');
      message.textContent = check.detail;
      detail.append(label, message);
      item.append(status, detail);
      return item;
    }));
  }

  function setExportAvailability(available) {
    $('exportButton').disabled = !available;
    const reasons = [];
    if (footageTask || musicAnalysisTask) reasons.push('Wait for analysis to finish before exporting.');
    if (!state.music) reasons.push('Import a music track first.');
    else if (!duration()) reasons.push('Waiting for the music duration to load.');
    if (!state.videos.length) reasons.push('Add at least one video source.');
    else if (!state.videos.some((video) => video.duration > 0)) reasons.push('Waiting for video source durations to load.');
    if (!available && state.music && duration() && state.videos.some((video) => video.duration > 0)) {
      reasons.push('No timeline clips were generated. Check the assembly notice; the sources may be too short for the cuts.');
    }
    const checks = getExportDiagnostics(available);
    if (!checks[0].available) reasons.push('The desktop video export bridge is unavailable. Check Export checks for details.');
    if (!supportsMp4Export()) reasons.push('This app window cannot encode MP4 video.');
    if (!checks[2].available) reasons.push('Canvas video capture is unavailable.');
    if (!checks[3].available) reasons.push('Audio capture is unavailable.');
    renderExportDiagnostics(checks);

    const button = $('exportVideoButton');
    const tooltip = $('exportVideoTooltip');
    const reason = reasons.join(' ');
    button.disabled = Boolean(reason);
    button.title = reason || 'Render the generated timeline to an MP4 video';
    tooltip.title = button.title;
    tooltip.tabIndex = reason ? 0 : -1;
    tooltip.setAttribute('aria-label', reason || 'Export video as MP4');
  }

  function savePanelLayout() {
    try {
      localStorage.setItem(panelLayoutStorageKey, JSON.stringify(panelLayout));
    } catch (error) {
      console.warn('AutoEdit could not save the panel layout.', error);
    }
  }

  function setSeparatorValue(separator, value, min, max) {
    separator.setAttribute('aria-valuemin', String(Math.round(min)));
    separator.setAttribute('aria-valuemax', String(Math.round(max)));
    separator.setAttribute('aria-valuenow', String(Math.round(value)));
    separator.setAttribute('aria-valuetext', `${Math.round(value)}${separator.classList.contains('horizontal') ? '%' : ' pixels'}`);
  }

  function columnLimits(panel) {
    const compact = window.matchMedia('(max-width: 1050px)').matches;
    const layoutWidth = $('layout')?.clientWidth || document.querySelector('.layout').clientWidth;
    const inspectorWidth = compact ? 0 : $('inspectorPanel').getBoundingClientRect().width;
    const libraryWidth = panel === 'library' ? 0 : $('library').getBoundingClientRect().width;
    const centerMinimum = compact ? 350 : 390;
    const dividerWidth = compact ? 8 : 16;
    const maximum = layoutWidth - centerMinimum - dividerWidth - inspectorWidth - libraryWidth;
    return { min: panel === 'library' ? 160 : 210, max: Math.max(panel === 'library' ? 160 : 210, maximum) };
  }

  function setColumnWidth(panel, width, preservePreference = false) {
    const limits = columnLimits(panel);
    const safeWidth = Math.round(Math.min(limits.max, Math.max(limits.min, width)));
    const setting = panel === 'library' ? 'libraryWidth' : 'inspectorWidth';
    const property = panel === 'library' ? '--library-width' : '--inspector-width';
    if (!preservePreference) panelLayout[setting] = safeWidth;
    document.querySelector('.layout').style.setProperty(property, `${safeWidth}px`);
    const separator = $(`${panel}Resizer`);
    setSeparatorValue(separator, safeWidth, limits.min, limits.max);
  }

  function setupColumnResizer(panel) {
    const separator = $(`${panel}Resizer`);
    const changeWidth = (width) => setColumnWidth(panel, width);
    separator.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      separator.setPointerCapture(event.pointerId);
      separator.classList.add('dragging');
      document.body.classList.add('panel-resizing');
      const startX = event.clientX;
      const startWidth = $(panel === 'library' ? 'library' : 'inspectorPanel').getBoundingClientRect().width;
      const direction = panel === 'library' ? 1 : -1;
      const onMove = (moveEvent) => changeWidth(startWidth + (moveEvent.clientX - startX) * direction);
      const onEnd = () => {
        separator.classList.remove('dragging');
        document.body.classList.remove('panel-resizing');
        savePanelLayout();
        separator.removeEventListener('pointermove', onMove);
        separator.removeEventListener('pointerup', onEnd);
        separator.removeEventListener('pointercancel', onEnd);
      };
      separator.addEventListener('pointermove', onMove);
      separator.addEventListener('pointerup', onEnd);
      separator.addEventListener('pointercancel', onEnd);
    });
    separator.addEventListener('keydown', (event) => {
      const limits = columnLimits(panel);
      const current = panel === 'library' ? panelLayout.libraryWidth : panelLayout.inspectorWidth;
      const direction = panel === 'library' ? 1 : -1;
      if (event.key === 'Home') changeWidth(limits.min);
      else if (event.key === 'End') changeWidth(limits.max);
      else if (event.key === 'ArrowLeft') changeWidth(current - 10 * direction);
      else if (event.key === 'ArrowRight') changeWidth(current + 10 * direction);
      else return;
      event.preventDefault();
      savePanelLayout();
    });
  }

  function setMonitorRatio(ratio) {
    const total = $('monitor').getBoundingClientRect().height + activeTimelinePanel().getBoundingClientRect().height;
    if (total <= 360) return;
    const minRatio = 180 / total;
    const safeRatio = Math.min(1 - minRatio, Math.max(minRatio, ratio));
    panelLayout.monitorRatio = safeRatio;
    $('workbench').style.setProperty('--monitor-fr', `${safeRatio * 100}fr`);
    $('workbench').style.setProperty('--timeline-fr', `${(1 - safeRatio) * 100}fr`);
    setSeparatorValue($('workbenchResizer'), safeRatio * 100, minRatio * 100, (1 - minRatio) * 100);
  }

  function setupWorkbenchResizer() {
    const separator = $('workbenchResizer');
    separator.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      separator.setPointerCapture(event.pointerId);
      separator.classList.add('dragging');
      document.body.classList.add('panel-resizing-horizontal');
      const startY = event.clientY;
      const startMonitorHeight = $('monitor').getBoundingClientRect().height;
      const total = startMonitorHeight + activeTimelinePanel().getBoundingClientRect().height;
      const onMove = (moveEvent) => setMonitorRatio((startMonitorHeight + moveEvent.clientY - startY) / total);
      const onEnd = () => {
        separator.classList.remove('dragging');
        document.body.classList.remove('panel-resizing-horizontal');
        savePanelLayout();
        separator.removeEventListener('pointermove', onMove);
        separator.removeEventListener('pointerup', onEnd);
        separator.removeEventListener('pointercancel', onEnd);
      };
      separator.addEventListener('pointermove', onMove);
      separator.addEventListener('pointerup', onEnd);
      separator.addEventListener('pointercancel', onEnd);
    });
    separator.addEventListener('keydown', (event) => {
      const current = panelLayout.monitorRatio * 100;
      if (event.key === 'Home') setMonitorRatio(0.25);
      else if (event.key === 'End') setMonitorRatio(0.75);
      else if (event.key === 'ArrowUp') setMonitorRatio((current - 2) / 100);
      else if (event.key === 'ArrowDown') setMonitorRatio((current + 2) / 100);
      else return;
      event.preventDefault();
      savePanelLayout();
    });
  }

  function setupPanelResizers() {
    try {
      const saved = JSON.parse(localStorage.getItem(panelLayoutStorageKey) || 'null');
      if (saved && typeof saved === 'object') {
        if (Number.isFinite(saved.libraryWidth)) panelLayout.libraryWidth = saved.libraryWidth;
        if (Number.isFinite(saved.inspectorWidth)) panelLayout.inspectorWidth = saved.inspectorWidth;
        if (Number.isFinite(saved.monitorRatio)) panelLayout.monitorRatio = saved.monitorRatio;
      }
    } catch (error) {
      console.warn('AutoEdit could not load the saved panel layout.', error);
    }
    setupColumnResizer('library');
    setupColumnResizer('inspector');
    setupWorkbenchResizer();
    const applySavedLayout = () => {
      if (!window.matchMedia('(min-width: 651px)').matches) return;
      setColumnWidth('library', panelLayout.libraryWidth, true);
      setColumnWidth('inspector', panelLayout.inspectorWidth, true);
      setMonitorRatio(panelLayout.monitorRatio);
    };
    applySavedLayout();
    window.addEventListener('resize', applySavedLayout);
  }
  const formatTime = (seconds, tenths = false) => {
    if (!Number.isFinite(seconds)) return tenths ? '00:00.0' : '00:00';
    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60).toString().padStart(2, '0');
    const wholeSeconds = Math.floor(safe % 60).toString().padStart(2, '0');
    return `${minutes}:${wholeSeconds}${tenths ? `.${Math.floor((safe % 1) * 10)}` : ''}`;
  };
  const formatSourceTime = (seconds, tenths = false) => {
    if (!Number.isFinite(seconds) || seconds < 3600) return formatTime(seconds, tenths);
    const safe = Math.max(0, seconds);
    const hours = Math.floor(safe / 3600).toString().padStart(2, '0');
    const minutes = Math.floor((safe % 3600) / 60).toString().padStart(2, '0');
    const wholeSeconds = Math.floor(safe % 60).toString().padStart(2, '0');
    return `${hours}:${minutes}:${wholeSeconds}${tenths ? `.${Math.floor((safe % 1) * 10)}` : ''}`;
  };
  const duration = () => state.audioBuffer?.duration || musicPlayer.duration || 0;
  const getVideo = (id) => state.videos.find((video) => video.id === id);
  const showNotice = (id, message, level = 'status') => {
    const notice = $(id);
    notice.textContent = message;
    if (!message) {
      notice.removeAttribute('data-level');
      notice.removeAttribute('role');
      return;
    }
    notice.dataset.level = level === 'warning' ? 'warning' : 'status';
    notice.setAttribute('role', level === 'warning' ? 'alert' : 'status');
    if (level === 'warning') notice.scrollIntoView({ block: 'nearest' });
  };
  const makeUrl = (file) => { const url = URL.createObjectURL(file); state.objectUrls.add(url); return url; };
  const getMediaPath = (file) => {
    try { return desktopApi?.getPathForFile(file) || null; } catch { return null; }
  };
  const mediaUrl = (file) => makeUrl(file);

  function sourceAnalysisMode() {
    return (state.workspace === 'analysis' || state.workspace === 'color') && state.analysisTarget !== 'music' && Boolean(getVideo(state.analysisTarget));
  }

  function activeTimelinePanel() {
    return $(sourceAnalysisMode() ? 'sourceAnalysisPanel' : 'timelinePanel');
  }

  function analysisMotionScale() {
    return Math.max(0.005, footage.percentile(state.videos.filter((video) => video.analysis)
      .flatMap((video) => video.analysis.motion.map((range) => range.score)), 0.9));
  }

  function getTimelineWindow(kind) {
    const prefix = kind === 'music' ? 'music' : 'source';
    const viewport = $(`${prefix}TimelineViewport`);
    const span = 1 / timelineZoom[kind];
    const width = (viewport.clientWidth - trackHeaderWidth) * timelineZoom[kind];
    const start = width > 0 ? Math.max(0, Math.min(1 - span, viewport.scrollLeft / width)) : 0;
    return { start, end: start + span };
  }

  function moveTimelineWindow(range, part, delta) {
    const span = range.end - range.start;
    if (part === 'start') return { start: Math.max(0, Math.min(range.end - 1 / maximumTimelineZoom, range.start + delta)), end: range.end };
    if (part === 'end') return { start: range.start, end: Math.min(1, Math.max(range.start + 1 / maximumTimelineZoom, range.end + delta)) };
    const start = Math.max(0, Math.min(1 - span, range.start + delta));
    return { start, end: start + span };
  }

  function renderTimelineNavigator(kind) {
    const prefix = kind === 'music' ? 'music' : 'source';
    const navigator = $(`${prefix}TimelineNavigator`);
    const range = getTimelineWindow(kind);
    const span = range.end - range.start;
    const total = kind === 'music' ? duration() : getVideo(state.analysisTarget)?.duration || 0;
    const label = `${formatSourceTime(range.start * total, true)} to ${formatSourceTime(range.end * total, true)} · ${timelineZoom[kind].toFixed(2)}x`;
    const thumb = navigator.querySelector('.navigator-window');
    thumb.style.left = `${range.start * 100}%`;
    thumb.style.width = `${span * 100}%`;
    const pan = navigator.querySelector('.navigator-pan');
    pan.setAttribute('aria-valuemin', '0');
    pan.setAttribute('aria-valuemax', String((1 - span) * 100));
    pan.setAttribute('aria-valuenow', String(range.start * 100));
    pan.setAttribute('aria-valuetext', label);
    navigator.querySelector('.navigator-rail').title = `${label}. Drag middle to pan; drag ends to zoom.`;
    navigator.querySelector('.navigator-fit').disabled = timelineZoom[kind] === 1;
    for (const part of ['start', 'end']) {
      const handle = navigator.querySelector(`[data-navigator-edge="${part}"]`);
      handle.setAttribute('aria-valuemin', String(part === 'start' ? 0 : (range.start + 1 / maximumTimelineZoom) * 100));
      handle.setAttribute('aria-valuemax', String(part === 'end' ? 100 : (range.end - 1 / maximumTimelineZoom) * 100));
      handle.setAttribute('aria-valuenow', String(range[part] * 100));
      handle.setAttribute('aria-valuetext', formatSourceTime(range[part] * total, true));
    }
  }

  function updateTimelineWidths() {
    for (const [kind, prefix] of [['music', 'music'], ['footage', 'source']]) {
      const viewport = $(`${prefix}TimelineViewport`);
      if (viewport.clientWidth <= trackHeaderWidth) continue;
      $(`${prefix}TimelineContent`).style.width = `${trackHeaderWidth + (viewport.clientWidth - trackHeaderWidth) * timelineZoom[kind]}px`;
      renderTimelineNavigator(kind);
    }
  }

  function setTimelineWindow(kind, start, end) {
    const prefix = kind === 'music' ? 'music' : 'source';
    const viewport = $(`${prefix}TimelineViewport`);
    const span = Math.min(1, Math.max(1 / maximumTimelineZoom, end - start));
    start = Math.max(0, Math.min(1 - span, start));
    timelineZoom[kind] = 1 / span;
    updateTimelineWidths();
    viewport.scrollLeft = start * (viewport.clientWidth - trackHeaderWidth) * timelineZoom[kind];
    if (kind === 'music') {
      renderRuler();
      drawWaveform();
    } else {
      const video = getVideo(state.analysisTarget);
      renderTimeRuler($('sourceAnalysisRuler'), video?.duration || 0, formatSourceTime);
    }
    renderTimelineNavigator(kind);
  }

  function zoomTimeline(event, kind) {
    if (!event.ctrlKey || !event.deltaY) return;
    event.preventDefault();
    const prefix = kind === 'music' ? 'music' : 'source';
    const viewport = $(`${prefix}TimelineViewport`);
    if (viewport.clientWidth <= trackHeaderWidth) return;
    const previous = timelineZoom[kind];
    const next = Math.min(maximumTimelineZoom, Math.max(1, previous * (event.deltaY < 0 ? 1.25 : 0.8)));
    const anchor = Math.max(0, Math.min(viewport.clientWidth - trackHeaderWidth,
      event.clientX - viewport.getBoundingClientRect().left - trackHeaderWidth));
    const scrollLeft = (viewport.scrollLeft + anchor) * next / previous - anchor;
    const start = scrollLeft / ((viewport.clientWidth - trackHeaderWidth) * next);
    setTimelineWindow(kind, start, start + 1 / next);
  }

  function canEditAnalysis() {
    if (footageTask || musicAnalysisTask || activeExport) {
      showNotice('analysisEditNotice', 'Wait for analysis or export to finish before changing analysis.', 'warning');
      return false;
    }
    return true;
  }

  function setWorkspace(workspace, save = true) {
    endAudioScrub(false);
    sourceDrag = null;
    playheadDrag = null;
    finishMusicAccentDrag(null, true);
    musicPlayer.pause();
    pausePreviewPlayers();
    state.workspace = workspace;
    state.activeCut = null;
    document.querySelector('.app').dataset.workspace = workspace;
    document.querySelectorAll('[data-workspace-only]').forEach((element) => {
      element.hidden = element.dataset.workspaceOnly !== workspace;
    });
    document.querySelectorAll('[data-workspace-target]').forEach((button) => {
      const selected = button.dataset.workspaceTarget === workspace;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    $('layout').setAttribute('aria-labelledby', `${workspace}WorkspaceTab`);
    $('workbenchTitle').textContent = workspace === 'analysis' ? 'Analysis' : workspace === 'color' ? 'Color' : 'Assembly';
    $('workspaceHint').textContent = workspace === 'analysis' ? 'Review and correct analysis before editing.'
      : workspace === 'color' ? 'Color correction for each source video.' : 'Assemble, preview and export your edit.';
    const sourceTime = getVideo(state.analysisTarget) ? state.analysisTime : 0;
    renderAnalysisEditor();
    if (sourceAnalysisMode()) seekAnalysisSource(sourceTime);
    else syncPreview(true);
    updatePlayButton();
    drawWaveform();
    if (save) persistSession(true);
  }

  function setAnalysisTarget(target, time = 0) {
    endAudioScrub(false);
    sourceDrag = null;
    playheadDrag = null;
    if (target !== 'music' && !getVideo(target)) {
      showNotice('analysisEditNotice', 'Select a source in the current project.', 'warning');
      return;
    }
    finishMusicAccentDrag(null, true);
    musicPlayer.pause();
    pausePreviewPlayers();
    state.analysisTarget = target;
    state.analysisTime = time;
    selectedRangeIndex = null;
    showNotice('analysisEditNotice', '');
    renderAnalysisEditor();
    if (sourceAnalysisMode()) seekAnalysisSource(time);
    else syncPreview(true);
    drawWaveform();
    updatePlayButton();
    persistSession(true);
  }

  function renderAnalysisEditor() {
    if (state.analysisTarget !== 'music' && !getVideo(state.analysisTarget)) state.analysisTarget = 'music';
    if (state.workspace === 'color' && state.analysisTarget === 'music') {
      state.analysisTarget = state.videos.find((video) => video.duration > 0)?.id || 'music';
      state.analysisTime = 0;
    }
    $('analysisTarget').innerHTML = `<option value="music">${escapeHtml(state.music?.file.name || 'Music')}</option>`
      + state.videos.map((video) => `<option value="${video.id}" ${video.duration ? '' : 'disabled'}>${escapeHtml(video.file.name)}</option>`).join('');
    $('analysisTarget').value = state.analysisTarget;
    const sourceMode = sourceAnalysisMode();
    document.querySelector('.app').dataset.analysisTarget = sourceMode ? 'footage' : 'music';
    $('timelinePanel').hidden = sourceMode || state.workspace === 'color';
    $('sourceAnalysisPanel').hidden = !sourceMode;
    updateTimelineWidths();
    $('musicAnalysisSettings').hidden = state.workspace !== 'analysis' || sourceMode;
    $('footageAnalysisSettings').hidden = state.workspace !== 'analysis' || !sourceMode;
    $('footageRangeEditor').hidden = state.workspace !== 'analysis' || !sourceMode;
    $('workbenchResizer').setAttribute('aria-controls', `monitor ${sourceMode ? 'sourceAnalysisPanel' : 'timelinePanel'}`);
    $('timelineHelp').textContent = state.workspace === 'analysis'
      ? 'Shift-click: add accent · Ctrl+wheel: zoom'
      : 'Select marker to delete · Select clip · F: source segment · Ctrl+wheel: zoom';
    $('waveEmpty').textContent = state.music ? 'Analyze music in the Analysis workspace to display a waveform.' : 'Import music to view waveform and suggested edit points';
    $('monitorEmpty').querySelector('strong').textContent = state.workspace === 'analysis' && !sourceMode ? 'Music analysis' : 'Your first cut starts here.';
    $('monitorEmpty').querySelector('p').textContent = state.workspace === 'analysis' && !sourceMode
      ? 'Analyze the track, then add or remove cut accents on the waveform below.'
      : 'Import a track and footage. AutoEdit assembles clips from every source automatically.';
    if (state.workspace === 'color') {
      $('monitorEmpty').querySelector('strong').textContent = 'Source color correction';
      $('monitorEmpty').querySelector('p').textContent = 'Import footage and choose a source to adjust its color.';
    }
    $('sourceTimelineHelp').textContent = state.workspace === 'color' ? 'Drag to scrub · Ctrl+wheel to zoom' : 'Click ranges to edit; drag empty track to scrub';
    renderMusicAccentEditor();
    renderRangeEditor();
    renderSourceAnalysisTracks();
    renderColorEditor();
  }

  function renderColorEditor() {
    const video = getVideo(state.analysisTarget);
    $('colorTarget').innerHTML = state.videos.length ? state.videos.map((source) =>
      `<option value="${source.id}" ${source.duration ? '' : 'disabled'}>${escapeHtml(source.file.name)}</option>`).join('')
      : '<option value="">Import footage</option>';
    $('colorTarget').value = video?.id || '';
    const value = video?.color || colors.defaults;
    for (const key of Object.keys(colors.controls)) {
      $(`color-${key}`).value = String(value[key]);
      $(`color-${key}-value`).value = String(value[key]);
      $(`color-${key}`).disabled = Boolean(activeExport || !video?.duration);
      $(`color-${key}-value`).disabled = Boolean(activeExport || !video?.duration);
    }
    $('resetSourceColor').disabled = Boolean(activeExport || !colors.adjusted(video?.color));
  }

  function changeSourceColor(key, value) {
    const video = getVideo(state.analysisTarget);
    if (activeExport || !video) {
      showNotice('colorNotice', 'Select a source and wait for export to finish before changing color.', 'warning');
      return;
    }
    const next = key ? { ...(video.color || colors.defaults), [key]: value } : null;
    if (next && !colors.valid(next)) {
      showNotice('colorNotice', 'Invalid source color settings.', 'warning');
      return;
    }
    video.color = next;
    colorPreviewError = null;
    showNotice('colorNotice', '');
    renderColorEditor();
    drawPreviewFrame();
    persistSession(!key);
  }

  function refreshMusicCuts() {
    state.beatTimes = accents.effectiveCuts(state.detectedCutTimes, state.musicCutOverrides, duration() || Infinity);
    if (selectedAccentTime !== null && !state.beatTimes.some((time) => accents.near(time, selectedAccentTime))) selectedAccentTime = null;
    $('beatCount').textContent = `${state.beatTimes.length} cuts${state.tempoBpm ? ` · ${Math.round(state.tempoBpm)} BPM` : ''}`;
    $('cutList').innerHTML = state.beatTimes.length ? state.beatTimes.slice(0, 12).map((time) => {
      const manual = state.musicCutOverrides.added.some((added) => accents.near(time, added));
      return `<li><button class="cut-accent-button ${selectedAccentTime !== null && accents.near(time, selectedAccentTime) ? 'selected' : ''}" data-music-accent="${time}"><span>${manual ? 'Manual' : 'Detected'} accent</span><span>${formatTime(time, true)}</span></button></li>`;
    }).join('') : '<li class="cut-empty">No cut accents. Add an accent or analyze music to suggest cuts.</li>';
    renderMusicAccentEditor();
  }

  function renderMusicAccentEditor() {
    const blocked = Boolean(footageTask || musicAnalysisTask || activeExport);
    $('addMusicAccent').disabled = blocked || !state.music || duration() <= 0.24;
    $('removeMusicAccent').disabled = blocked || selectedAccentTime === null;
    $('deleteMusicMarker').disabled = blocked || selectedAccentTime === null;
    $('resetMusicAccents').disabled = blocked || !accents.hasEdits(state.musicCutOverrides);
    const selectedTime = musicAccentDrag?.moved ? musicAccentDrag.time : selectedAccentTime;
    $('selectedMusicAccent').textContent = selectedTime === null ? 'No accent selected' : `Selected: ${selectedTime.toFixed(3)} s`;
    $('selectedMusicMarker').textContent = selectedTime === null ? 'No marker selected' : `Selected: ${selectedTime.toFixed(3)} s`;
    const total = duration();
    if (musicAccentDrag) {
      for (const marker of $('accentMarkers').querySelectorAll('[data-music-accent]')) {
        const time = Number(marker.dataset.musicAccent);
        const selected = time === musicAccentDrag.from;
        const shownTime = selected && musicAccentDrag.moved ? musicAccentDrag.time : time;
        marker.disabled = blocked;
        marker.classList.toggle('selected', selected);
        marker.classList.toggle('dragging', selected && musicAccentDrag.moved);
        marker.setAttribute('aria-pressed', String(selected));
        marker.style.left = `${shownTime / total * 100}%`;
        const label = marker.classList.contains('manual') ? 'Manual' : 'Detected';
        marker.setAttribute('aria-label', `${label} accent at ${shownTime.toFixed(3)} seconds`);
        marker.title = `${label} accent · ${shownTime.toFixed(3)} s · Drag to move`;
      }
      return;
    }
    $('accentMarkers').innerHTML = total ? state.beatTimes.map((time) => {
      const manual = state.musicCutOverrides.added.some((added) => accents.near(time, added));
      const selected = selectedAccentTime !== null && accents.near(time, selectedAccentTime);
      return `<button class="accent-marker ${manual ? 'manual' : ''} ${selected ? 'selected' : ''}" data-music-accent="${time}" style="left:${time / total * 100}%" ${blocked ? 'disabled' : ''} aria-label="${manual ? 'Manual' : 'Detected'} accent at ${time.toFixed(3)} seconds" aria-pressed="${selected}" title="${manual ? 'Manual' : 'Detected'} accent · ${time.toFixed(3)} s · Drag to move"></button>`;
    }).join('') : '';
  }

  function changeMusicAccent(action, time) {
    if (!canEditAnalysis()) return;
    try {
      state.musicCutOverrides = accents.editAccent(state.musicCutOverrides, time, action, duration());
      selectedAccentTime = action === 'add' ? Number(time.toFixed(3)) : null;
      refreshMusicCuts();
      drawWaveform();
      rebuildAutomaticEdit();
      persistSession(true);
      showNotice('analysisEditNotice', `${action === 'add' ? 'Added' : 'Removed'} cut accent at ${time.toFixed(3)} seconds.`);
    } catch (error) {
      showNotice('analysisEditNotice', error.message, 'warning');
    }
  }

  function removeSelectedMusicAccent() {
    if (selectedAccentTime !== null) changeMusicAccent('remove', selectedAccentTime);
  }

  function selectMusicAccent(time) {
    selectedAccentTime = time;
    musicPlayer.currentTime = time;
    syncPreview(true);
    refreshMusicCuts();
    persistSession();
  }

  function updateMusicAccentDrag(event) {
    if (musicAccentDrag?.pointerId !== event.pointerId) return;
    const drag = musicAccentDrag;
    if (drag.cancelled) return;
    drag.moved ||= Math.abs(event.clientX - drag.originX) >= 3;
    if (!drag.moved) return;
    const rect = waveWrap.getBoundingClientRect();
    const lastTime = Math.floor((drag.duration - 0.121) * 1000) / 1000;
    drag.time = Number(Math.max(0.121, Math.min(lastTime,
      (event.clientX - rect.left - drag.grabOffset) / rect.width * drag.duration)).toFixed(3));
    const marker = $('accentMarkers').querySelector(`[data-music-accent="${drag.from}"]`);
    if (marker) {
      marker.style.left = `${drag.time / drag.duration * 100}%`;
      marker.classList.add('dragging');
      marker.title = `Move accent · ${drag.time.toFixed(3)} s`;
      marker.setAttribute('aria-label', `Accent at ${drag.time.toFixed(3)} seconds`);
    }
    $('selectedMusicAccent').textContent = `Selected: ${drag.time.toFixed(3)} s`;
  }

  function finishMusicAccentDrag(event, cancelled = false) {
    if (!musicAccentDrag || (event && event.pointerId !== musicAccentDrag.pointerId)) return;
    if (!cancelled && event) updateMusicAccentDrag(event);
    const drag = musicAccentDrag;
    musicAccentDrag = null;
    if (waveWrap.hasPointerCapture(drag.pointerId)) waveWrap.releasePointerCapture(drag.pointerId);
    if (event?.type === 'pointerup') {
      suppressWaveClick = true;
      setTimeout(() => { suppressWaveClick = false; }, 0);
    }
    if (cancelled || drag.cancelled) {
      renderMusicAccentEditor();
      return;
    }
    if (!drag.moved) {
      selectMusicAccent(drag.from);
      return;
    }
    if (drag.time === drag.from) {
      renderMusicAccentEditor();
      return;
    }
    if (!canEditAnalysis()) {
      renderMusicAccentEditor();
      return;
    }
    try {
      state.musicCutOverrides = accents.moveAccent(state.musicCutOverrides, drag.from, drag.time, duration());
      selectedAccentTime = drag.time;
      refreshMusicCuts();
      rebuildAutomaticEdit();
      persistSession(true);
      showNotice('analysisEditNotice', `Moved cut accent from ${drag.from.toFixed(3)} to ${drag.time.toFixed(3)} seconds.`);
    } catch (error) {
      renderMusicAccentEditor();
      showNotice('analysisEditNotice', error.message, 'warning');
    }
  }

  function currentFootageRanges() {
    const video = getVideo(state.analysisTarget);
    return video ? footage.editableRanges(video, rangeKind, analysisMotionScale()) : [];
  }

  function renderRangeEditor() {
    const video = getVideo(state.analysisTarget);
    const ranges = currentFootageRanges();
    if (selectedRangeIndex !== null && !ranges[selectedRangeIndex]) selectedRangeIndex = null;
    const selected = selectedRangeIndex === null ? null : ranges[selectedRangeIndex];
    const blocked = Boolean(footageTask || musicAnalysisTask || activeExport || !video?.analysis);
    $('footageRangeKind').value = rangeKind;
    $('rangeEditStatus').textContent = video?.analysisEdits?.[rangeKind] ? 'Manual' : 'Detected';
    $('footageRangeList').innerHTML = ranges.map((range, index) => `<li><button class="${index === selectedRangeIndex ? 'selected' : ''}" data-analysis-range="${index}" data-range-kind="${rangeKind}"><span>${formatSourceTime(range.start, true)}–${formatSourceTime(range.end, true)}</span><span>${Math.round(range.score * 100)}%</span></button></li>`).join('')
      || '<li class="cut-empty">No ranges of this type. Analyze this source, or add a range after analysis.</li>';
    $('newFootageRange').disabled = blocked;
    $('removeFootageRange').disabled = blocked || selectedRangeIndex === null;
    $('resetFootageRanges').disabled = blocked || !video?.analysisEdits?.[rangeKind];
    for (const id of ['footageRangeStart', 'footageRangeEnd', 'motionRangeLevel', 'saveFootageRange']) $(id).disabled = blocked;
    const lastTime = Math.floor((video?.duration || 0) * 1000) / 1000;
    const start = selected?.start ?? Math.min(lastTime, state.analysisTime);
    $('footageRangeStart').value = start.toFixed(3);
    $('footageRangeEnd').value = Math.min(lastTime, selected?.end ?? start + 5).toFixed(3);
    $('footageRangeStart').max = String(lastTime);
    $('footageRangeEnd').max = String(lastTime);
    $('motionRangeLevel').value = String(Math.round((selected?.score ?? 1) * 100));
    $('motionRangeLevelValue').textContent = `${$('motionRangeLevel').value}%`;
    $('motionRangeLevelField').hidden = rangeKind !== 'motion';
  }

  function renderSourceAnalysisTracks() {
    const video = getVideo(state.analysisTarget);
    if (!video) {
      $('sourceAnalysisTracks').replaceChildren();
      return;
    }
    $('sourceAnalysisName').textContent = video.file.name;
    $('sourceAnalysisName').title = video.file.name;
    $('sourceAnalysisDuration').textContent = formatSourceTime(video.duration);
    $('sourceAnalysisStatus').textContent = video.analysis
      ? video.analysis.audioStatus === 'none' ? 'No source audio track. Motion ranges remain editable.' : 'Speech and clapping ranges are approximate. Manual ranges are saved separately from detections.'
      : 'Analyze this footage before editing its ranges.';
    $('analysisSourceAudioToggle').disabled = video.analysis?.audioStatus === 'none';
    renderTimeRuler($('sourceAnalysisRuler'), video.duration, formatSourceTime);
    if (state.workspace === 'color') {
      $('sourceAnalysisStatus').textContent = 'Source color corrections apply to every use of this video. Analysis continues to use the original footage.';
      $('sourceAnalysisTracks').innerHTML = `<div class="source-analysis-track"><span class="source-analysis-track-label">Source</span><div class="source-analysis-lane" data-source-track="source">
        <div class="color-source-range">${escapeHtml(video.file.name)}</div><div class="playhead" data-source-playhead></div></div></div>`;
      updateAnalysisPlayhead();
      return;
    }
    const colors = { speech: '#c9ef74', clapping: '#83b9d1', motion: '#ff806b' };
    $('sourceAnalysisTracks').innerHTML = Object.entries(rangeKinds).map(([kind, label]) => {
      const ranges = footage.editableRanges(video, kind, analysisMotionScale());
      return `<div class="source-analysis-track"><span class="source-analysis-track-label">${label}</span><div class="source-analysis-lane" data-source-track="${kind}">
        ${ranges.map((range, index) => `<button class="analysis-range ${rangeKind === kind && selectedRangeIndex === index ? 'selected' : ''}" data-analysis-range="${index}" data-range-kind="${kind}" style="left:${range.start / video.duration * 100}%;width:${(range.end - range.start) / video.duration * 100}%;--range-color:${colors[kind]}" title="${label} · ${range.start.toFixed(3)}–${range.end.toFixed(3)} s · ${Math.round(range.score * 100)}%">${label}</button>`).join('')}
        <div class="playhead" data-source-playhead></div></div></div>`;
    }).join('');
    updateAnalysisPlayhead();
  }

  function selectFootageRange(kind, index) {
    rangeKind = kind;
    selectedRangeIndex = index;
    renderRangeEditor();
    renderSourceAnalysisTracks();
    const range = currentFootageRanges()[index];
    if (range) seekAnalysisSource(range.start);
  }

  function saveFootageRange(remove = false) {
    if (!canEditAnalysis()) return;
    const video = getVideo(state.analysisTarget);
    if (!video?.analysis || (remove && selectedRangeIndex === null)) {
      showNotice('analysisEditNotice', 'Analyze a source and select a range before editing it.', 'warning');
      return;
    }
    try {
      const replacement = remove ? null : {
        start: Number($('footageRangeStart').value), end: Number($('footageRangeEnd').value),
        score: rangeKind === 'motion' ? Number($('motionRangeLevel').value) / 100 : (currentFootageRanges()[selectedRangeIndex]?.score ?? 1)
      };
      const ranges = footage.editRanges(currentFootageRanges(), selectedRangeIndex, replacement, video.duration);
      video.analysisEdits = { ...(video.analysisEdits || { version: 1 }), [rangeKind]: ranges };
      selectedRangeIndex = replacement ? ranges.findIndex((range) => range.start === replacement.start && range.end === replacement.end) : null;
      renderFootageAnalysis();
      rebuildAutomaticEdit();
      persistSession(true);
      showNotice('analysisEditNotice', `${rangeKinds[rangeKind]} range ${remove ? 'removed' : 'saved'}. Detector results are unchanged.`);
    } catch (error) {
      showNotice('analysisEditNotice', error.message, 'warning');
    }
  }

  function seekAnalysisSource(time) {
    const video = getVideo(state.analysisTarget);
    if (!video) return;
    state.analysisTime = Math.max(0, Math.min(video.duration, time));
    setPreviewSource(video, state.analysisTime);
    updateAnalysisPlayhead();
  }

  function updateAnalysisPlayhead() {
    if (!sourceAnalysisMode()) return;
    const video = getVideo(state.analysisTarget);
    if (previewPlayers.get(video.id) === activePreviewVideo && activePreviewVideo.readyState >= 1 && !activePreviewVideo.seeking) state.analysisTime = activePreviewVideo.currentTime;
    $('timeDisplay').textContent = formatSourceTime(state.analysisTime, true);
    $('monitorTime').textContent = `SOURCE ${formatSourceTime(state.analysisTime, true)}`;
    document.querySelectorAll('[data-source-playhead]').forEach((playhead) => {
      playhead.style.left = `${video.duration ? state.analysisTime / video.duration * 100 : 0}%`;
    });
  }

  function sessionSnapshot() {
    return {
      version: 1,
      music: state.music?.path ? { path: state.music.path, name: state.music.file.name, type: state.music.file.type } : null,
      videos: state.videos.filter((video) => video.path).map((video) => ({ id: video.id, path: video.path, name: video.file.name, type: video.file.type, duration: video.duration, importance: video.importance, analysis: video.analysis || null, analysisEdits: video.analysisEdits || null, color: video.color || null })),
      edit: state.edit,
      beatTimes: state.beatTimes,
      detectedCutTimes: state.detectedCutTimes,
      musicCutOverrides: state.musicCutOverrides,
      workspace: state.workspace,
      analysisTarget: state.analysisTarget,
      analysisTime: state.analysisTime,
      beatCandidates: state.beatCandidates,
      tempoBpm: state.tempoBpm,
      currentTime: musicPlayer.currentTime || 0,
      minimumConsecutiveClips: $('minimumConsecutiveClips').value,
      cadence: $('cutCadence').value,
      sensitivity: $('sensitivity').value,
      musicAudioEnabled: state.musicAudioEnabled,
      clipAudioEnabled: state.clipAudioEnabled,
      musicVolume: state.musicVolume,
      scrubAudioEnabled: state.scrubAudioEnabled,
      useFootageAnalysis: state.useFootageAnalysis,
      previewResolution: state.previewResolution,
      audioAnalyzed: Boolean(state.audioBuffer)
    };
  }

  function persistSession(immediate = false) {
    if (!desktopApi?.saveSession) {
      if (state.music || state.videos.length) {
        $('statusText').textContent = 'Browser preview cannot save media sessions. Use the AutoEdit desktop app.';
      }
      return;
    }
    clearTimeout(saveSessionTimer);
    const save = () => {
      try {
        if (!desktopApi.saveSession(sessionSnapshot())) console.warn('AutoEdit could not save the current session.');
      } catch (error) {
        console.warn('AutoEdit could not save the current session.', error);
      }
    };
    if (immediate) save();
    else saveSessionTimer = setTimeout(save, 300);
  }

  async function readMusicBytes() {
    if (state.music?.file.arrayBuffer) return state.music.file.arrayBuffer();
    if (state.music?.path && desktopApi?.readAudioFile) return desktopApi.readAudioFile(state.music.path);
    throw new Error('The audio file is not available in this session.');
  }

  async function decodeMusicBuffer() {
    const bytes = await readMusicBytes();
    const audioData = bytes instanceof ArrayBuffer
      ? bytes
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    try {
      return await audioContext.decodeAudioData(audioData);
    } finally {
      await audioContext.close();
    }
  }

  function clearCurrentProject() {
    endAudioScrub(false);
    audioScrubber.dispose();
    finishMusicAccentDrag(null, true);
    musicPlayer.pause();
    for (const player of previewPlayers.values()) {
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
    previewVideo.pause();
    activePreviewVideo = previewVideo;
    previewPlayers.clear();
    previewSourceId = null;
    colorPreviewError = null;
    showNotice('colorNotice', '');
    for (const url of state.objectUrls) URL.revokeObjectURL(url);
    state.objectUrls.clear();
    state.music = null;
    state.audioBuffer = null;
    state.musicEnergy = [];
    state.beatTimes = [];
    state.detectedCutTimes = [];
    state.musicCutOverrides = { added: [], removed: [] };
    state.analysisTarget = 'music';
    state.analysisTime = 0;
    selectedAccentTime = null;
    selectedRangeIndex = null;
    state.beatCandidates = [];
    state.tempoBpm = 0;
    state.videos = [];
    clearSelectedClip();
    state.edit = [];
    state.activeCut = null;
    musicPlayer.removeAttribute('src');
    musicPlayer.load();
    previewVideo.removeAttribute('src');
    previewVideo.load();
    cancelPreviewRendering();
    previewCanvas.classList.add('hidden');
    previewCanvas.width = 0;
    previewCanvas.height = 0;
    $('monitorEmpty').classList.remove('hidden');
    $('monitorSource').textContent = 'No source selected';
    $('musicList').innerHTML = '<div class="empty-note">Import a song to begin building your cut.</div>';
    $('sceneList').innerHTML = '<div class="cut-empty">Add video sources to set their scene importance.</div>';
    $('beatCount').textContent = 'No edit points';
    $('cutList').innerHTML = '<li class="cut-empty">Suggested cut points will appear here for review.</li>';
    $('analysisLabel').textContent = 'Not analyzed';
    $('analysisNotice').textContent = '';
    $('generateNotice').textContent = '';
    $('waveEmpty').classList.remove('hidden');
    $('analyzeButton').disabled = true;
    state.musicVolume = 0.8;
    state.scrubAudioEnabled = false;
    state.useFootageAnalysis = true;
    $('useFootageAnalysis').checked = true;
    updateAudioToggles();
    showNotice('footageNotice', '');
    renderFootageAnalysis();
    $('minimumConsecutiveClips').value = '2';
    showNotice('assemblyNotice', '');
    setExportAvailability(false);
    renderVideos();
    renderSceneWeights();
    renderVideoTrack();
    updateDuration();
    drawWaveform();
    $('statusText').textContent = 'Open or create a project';
  }

  async function openProject() {
    if (footageTask || musicAnalysisTask) {
      showNotice('footageNotice', footageTask ? 'Cancel footage analysis before opening another project.' : 'Wait for music analysis before opening another project.', 'warning');
      return;
    }
    if (!desktopApi?.openProject) {
      const message = 'Open project files and restore saved sessions in the AutoEdit desktop app.';
      $('statusText').textContent = message;
      showNotice('assemblyNotice', message);
      return;
    }
    if ((state.music || state.videos.length) && !window.confirm('Open another project and replace the current workspace?')) return;
    try {
      const project = await desktopApi.openProject();
      if (!project) return;
      clearCurrentProject();
      $('projectName').textContent = project.name;
      await restoreSession(project.session);
      persistSession(true);
    } catch (error) {
      showNotice('assemblyNotice', `Could not open project: ${error.message}`);
    }
  }

  async function saveProject() {
    if (!desktopApi?.saveProject) {
      const message = 'Save project files and media sessions in the AutoEdit desktop app.';
      $('statusText').textContent = message;
      showNotice('assemblyNotice', message);
      return;
    }
    try {
      const result = await desktopApi.saveProject({
        name: $('projectName').textContent,
        session: sessionSnapshot()
      });
      if (!result) return;
      $('projectName').textContent = result.name;
      showNotice('assemblyNotice', `Saved project: ${result.name}`);
      persistSession(true);
    } catch (error) {
      showNotice('assemblyNotice', `Could not save project: ${error.message}`);
    }
  }

  async function restoreSession(projectSession = null) {
    if (!desktopApi?.loadSession && !projectSession) return;
    try {
      const session = projectSession || await desktopApi.loadSession();
      if (!session || session.version !== 1) return;
      $('cutCadence').value = ['1', '2', '4'].includes(String(session.cadence)) ? String(session.cadence) : '2';
      $('sensitivity').value = String(session.sensitivity ?? 55);
      $('sensitivityValue').textContent = `${$('sensitivity').value}%`;
      const minimumConsecutiveClips = Number(session.minimumConsecutiveClips);
      $('minimumConsecutiveClips').value = String(Number.isInteger(minimumConsecutiveClips) && minimumConsecutiveClips >= 1 ? minimumConsecutiveClips : 2);
      state.previewResolution = ['full', 'half', 'quarter'].includes(session.previewResolution) ? session.previewResolution : 'full';
      $('previewResolution').value = state.previewResolution;
      state.musicAudioEnabled = session.musicAudioEnabled !== false;
      state.clipAudioEnabled = session.clipAudioEnabled !== false;
      state.musicVolume = Number.isFinite(session.musicVolume) ? Math.min(1, Math.max(0, session.musicVolume)) : 0.8;
      state.scrubAudioEnabled = session.scrubAudioEnabled === true;
      state.useFootageAnalysis = session.useFootageAnalysis !== false;
      $('useFootageAnalysis').checked = state.useFootageAnalysis;
      updateAudioToggles();
      state.videos = (session.videos || []).filter((video) => video.path && video.id).map((video) => ({
        id: video.id,
        path: video.path,
        file: { name: video.name, type: video.type || 'video/*' },
        url: desktopApi.pathToFileURL(video.path),
        duration: Number(video.duration) || 0,
        importance: Number.isFinite(Number(video.importance)) ? Math.min(5, Math.max(0.1, Number(video.importance))) : 1,
        color: colors.valid(video.color) ? video.color : null,
        analysis: footage.validAnalysis(video.analysis) && video.analysis.duration === Number(video.duration) ? video.analysis : null,
        analysisEdits: footage.validAnalysis(video.analysis) && video.analysis.duration === Number(video.duration)
          && footage.validEdits(video.analysisEdits, Number(video.duration)) ? video.analysisEdits : null,
        thumb: ''
      }));
      if ((session.videos || []).some((video) => video.color && !colors.valid(video.color))) {
        showNotice('colorNotice', 'Invalid saved source color settings were discarded.', 'warning');
      }
      if ((session.videos || []).some((video) => video.analysis
        && (!footage.validAnalysis(video.analysis) || video.analysis.duration !== Number(video.duration)))) {
        showNotice('footageNotice', 'Invalid saved footage analysis was discarded. Analyze footage again.', 'warning');
      }
      if ((session.videos || []).some((video) => video.analysisEdits
        && (!footage.validAnalysis(video.analysis) || video.analysis.duration !== Number(video.duration)
          || !footage.validEdits(video.analysisEdits, Number(video.duration))))) {
        showNotice('analysisEditNotice', 'Invalid saved footage range edits were discarded.', 'warning');
      }
      for (const video of state.videos.filter((video) => video.analysis)) {
        try {
          const fingerprint = await desktopApi.getFootageFingerprint(video.path);
          if (!footage.sameFingerprint(video.analysis.fingerprint, fingerprint)) {
            video.analysis = null;
            video.analysisEdits = null;
            showNotice('footageNotice', `${video.file.name} changed since analysis. Its range edits were discarded; analyze footage again.`);
          }
        } catch (error) {
          video.analysis = null;
          video.analysisEdits = null;
          showNotice('footageNotice', `Could not validate analysis for ${video.file.name}: ${error.message}`, 'warning');
        }
      }
      const videoIds = new Set(state.videos.map((video) => video.id));
      state.analysisTarget = videoIds.has(session.analysisTarget) ? session.analysisTarget : 'music';
      state.analysisTime = Number.isFinite(session.analysisTime) ? Math.max(0, Math.min(getVideo(state.analysisTarget)?.duration || 0, session.analysisTime)) : 0;
      clearSelectedClip();
      state.edit = (session.edit || []).filter((cut) => videoIds.has(cut.sourceId));
      state.beatTimes = Array.isArray(session.beatTimes) ? session.beatTimes : [];
      state.detectedCutTimes = (Array.isArray(session.detectedCutTimes) ? session.detectedCutTimes : state.beatTimes)
        .filter(Number.isFinite).sort((left, right) => left - right);
      state.musicCutOverrides = accents.validOverrides(session.musicCutOverrides) ? session.musicCutOverrides : { added: [], removed: [] };
      if (session.musicCutOverrides && !accents.validOverrides(session.musicCutOverrides)) {
        showNotice('analysisEditNotice', 'Invalid saved music accent edits were discarded.', 'warning');
      }
      state.beatCandidates = Array.isArray(session.beatCandidates) ? session.beatCandidates : [];
      state.tempoBpm = Number(session.tempoBpm) || 0;

      if (session.music?.path) {
        let file = { name: session.music.name, type: session.music.type || 'audio/*' };
        let url = desktopApi.pathToFileURL(session.music.path);
        try {
          const bytes = await desktopApi.readAudioFile(session.music.path);
          file = new File([bytes], session.music.name, { type: session.music.type || 'audio/*' });
          url = makeUrl(file);
        } catch (error) {
          showNotice('analysisNotice', `Could not reopen the music file: ${error.message}`);
        }
        state.music = { file, path: session.music.path, url };
        $('musicList').innerHTML = `<div class="asset selected music-asset" title="Double-click to open the Analysis workspace"><div class="asset-thumb">♫</div><div class="asset-copy"><div class="asset-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div><div class="asset-meta">Double-click to edit analysis</div></div><span class="asset-action">♪</span></div>`;
        $('trackName').textContent = file.name.toUpperCase();
        $('analyzeButton').disabled = false;
        musicPlayer.addEventListener('loadedmetadata', () => {
          musicPlayer.currentTime = Math.max(0, Math.min(Number(session.currentTime) || 0, musicPlayer.duration || 0));
          syncPreview(true);
        }, { once: true });
        musicPlayer.src = state.music.url;
      }

      renderVideos();
      renderSceneWeights();
      setExportAvailability(state.edit.length > 0);
      refreshMusicCuts();
      if (state.tempoBpm) {
        $('analysisLabel').textContent = `~${Math.round(state.tempoBpm)} BPM`;
        showNotice('analysisNotice', `Restored beat grid at ~${Math.round(state.tempoBpm)} BPM.`);
      }
      updateDuration();
      rebuildAutomaticEdit();

      if (state.music && session.audioAnalyzed) {
        state.audioBuffer = await decodeMusicBuffer();
        state.musicEnergy = footage.musicEnergy(state.audioBuffer);
        $('waveEmpty').classList.add('hidden');
        updateDuration();
        drawWaveform();
        if ('ResizeObserver' in window) new ResizeObserver(drawWaveform).observe($('waveWrap'));
        rebuildAutomaticEdit();
      }
      $('statusText').textContent = projectSession ? 'Project opened' : 'Last session restored';
      setWorkspace(['analysis', 'editing', 'color'].includes(session.workspace) ? session.workspace : 'editing', false);
      persistSession(true);
    } catch (error) {
      showNotice('analysisNotice', `Could not restore the last session: ${error.message}`);
    }
  }

  $('addMusic').addEventListener('click', () => musicInput.click());
  $('addVideos').addEventListener('click', () => videoInput.click());
  $('openProjectButton').addEventListener('click', openProject);
  $('saveProjectButton').addEventListener('click', saveProject);
  $('musicList').addEventListener('dblclick', () => {
    if (!state.music) return;
    setWorkspace('analysis');
    setAnalysisTarget('music');
  });
  desktopApi?.onAnalysisSettings?.(({ sensitivity, cadence }) => {
    $('sensitivity').value = String(sensitivity);
    $('sensitivityValue').textContent = `${sensitivity}%`;
    $('cutCadence').value = cadence;
    if (state.audioBuffer) updateBeatAnalysis();
    else analyzeMusic();
  });
  musicInput.addEventListener('change', () => { if (musicInput.files[0]) loadMusic(musicInput.files[0]); musicInput.value = ''; });
  videoInput.addEventListener('change', () => { if (videoInput.files.length) addVideos([...videoInput.files]); videoInput.value = ''; });
  $('sensitivity').addEventListener('input', () => {
    $('sensitivityValue').textContent = `${$('sensitivity').value}%`;
    if (state.audioBuffer) updateBeatAnalysis();
    persistSession();
  });
  $('cutCadence').addEventListener('change', applyCutCadence);
  $('minimumConsecutiveClips').addEventListener('change', () => {
    const value = Number($('minimumConsecutiveClips').value);
    $('minimumConsecutiveClips').value = String(Number.isInteger(value) ? Math.max(1, value) : 2);
    rebuildAutomaticEdit();
    persistSession(true);
  });
  $('sceneList').addEventListener('input', (event) => {
    const slider = event.target.closest('[data-scene-importance]');
    if (!slider) return;
    const video = getVideo(slider.dataset.sceneImportance);
    if (!video) return;
    video.importance = Number(slider.value);
    slider.closest('.scene-weight-row').querySelector('.scene-weight-value').textContent = video.importance.toFixed(1);
    rebuildAutomaticEdit();
    persistSession();
  });
  $('musicVolume').addEventListener('input', () => {
    state.musicVolume = Number($('musicVolume').value) / 100;
    updateAudioToggles();
    persistSession();
  });
  $('useFootageAnalysis').addEventListener('change', () => {
    state.useFootageAnalysis = $('useFootageAnalysis').checked;
    rebuildAutomaticEdit();
    persistSession(true);
  });
  $('analyzeFootageButton').addEventListener('click', analyzeFootage);
  $('cancelFootageButton').addEventListener('click', async () => {
    if (!footageTask) return;
    footageTask.cancelled = true;
    $('cancelFootageButton').disabled = true;
    showNotice('footageNotice', 'Canceling footage analysis…');
    try { await desktopApi.cancelFootageAnalysis(); } catch (error) {
      showNotice('footageNotice', `Could not cancel footage analysis: ${error.message}`, 'warning');
    }
  });
  document.querySelectorAll('[data-workspace-target]').forEach((button) => {
    button.addEventListener('click', () => setWorkspace(button.dataset.workspaceTarget));
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...document.querySelectorAll('[data-workspace-target]')];
      const index = tabs.indexOf(button);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
      const target = tabs[next].dataset.workspaceTarget;
      setWorkspace(target);
      $(`${target}WorkspaceTab`).focus();
    });
  });
  $('analysisTarget').addEventListener('change', () => setAnalysisTarget($('analysisTarget').value));
  $('colorTarget').addEventListener('change', () => setAnalysisTarget($('colorTarget').value));
  $('colorControls').innerHTML = Object.entries(colors.controls).map(([key, control]) => `<div class="field">
    <label for="color-${key}">${control.label}</label>
    <div class="color-control-row">
      <input id="color-${key}" type="range" min="${control.min}" max="${control.max}" step="${control.step}" value="${control.value}" disabled>
      <input id="color-${key}-value" type="number" aria-label="${control.label} value" min="${control.min}" max="${control.max}" step="${control.step}" value="${control.value}" required disabled>
    </div>
  </div>`).join('');
  for (const key of Object.keys(colors.controls)) {
    $(`color-${key}`).addEventListener('input', () => changeSourceColor(key, Number($(`color-${key}`).value)));
    $(`color-${key}-value`).addEventListener('change', () => {
      const input = $(`color-${key}-value`);
      if (!input.checkValidity()) {
        showNotice('colorNotice', `Enter a valid ${colors.controls[key].label.toLowerCase()} value.`, 'warning');
        input.reportValidity();
        return;
      }
      changeSourceColor(key, Number(input.value));
    });
  }
  $('resetSourceColor').addEventListener('click', () => changeSourceColor(null));
  $('addMusicAccent').addEventListener('click', () => changeMusicAccent('add', musicPlayer.currentTime || 0));
  $('removeMusicAccent').addEventListener('click', () => {
    removeSelectedMusicAccent();
  });
  $('deleteMusicMarker').addEventListener('click', removeSelectedMusicAccent);
  $('resetMusicAccents').addEventListener('click', () => {
    if (!canEditAnalysis() || !window.confirm('Reset all manual music accent additions and removals?')) return;
    state.musicCutOverrides = { added: [], removed: [] };
    selectedAccentTime = null;
    refreshMusicCuts();
    drawWaveform();
    rebuildAutomaticEdit();
    persistSession(true);
    showNotice('analysisEditNotice', 'Restored detected cut accents.');
  });
  $('cutList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-music-accent]');
    if (button) selectMusicAccent(Number(button.dataset.musicAccent));
  });
  $('footageRangeKind').addEventListener('change', () => {
    rangeKind = $('footageRangeKind').value;
    selectedRangeIndex = null;
    renderRangeEditor();
    renderSourceAnalysisTracks();
  });
  const selectRangeFromEvent = (event) => {
    const button = event.target.closest('[data-analysis-range]');
    if (button) selectFootageRange(button.dataset.rangeKind, Number(button.dataset.analysisRange));
  };
  $('footageRangeList').addEventListener('click', selectRangeFromEvent);
  $('sourceAnalysisTracks').addEventListener('click', selectRangeFromEvent);
  $('newFootageRange').addEventListener('click', () => {
    selectedRangeIndex = null;
    renderRangeEditor();
    renderSourceAnalysisTracks();
    $('footageRangeStart').focus();
  });
  $('footageRangeForm').addEventListener('submit', (event) => { event.preventDefault(); saveFootageRange(); });
  $('removeFootageRange').addEventListener('click', () => saveFootageRange(true));
  $('motionRangeLevel').addEventListener('input', () => { $('motionRangeLevelValue').textContent = `${$('motionRangeLevel').value}%`; });
  $('resetFootageRanges').addEventListener('click', () => {
    if (!canEditAnalysis() || !window.confirm(`Reset manual ${rangeKinds[rangeKind].toLowerCase()} ranges to detector results?`)) return;
    const video = getVideo(state.analysisTarget);
    if (!video?.analysisEdits) return;
    const edits = { ...video.analysisEdits };
    delete edits[rangeKind];
    video.analysisEdits = Object.keys(edits).length > 1 ? edits : null;
    selectedRangeIndex = null;
    renderFootageAnalysis();
    rebuildAutomaticEdit();
    persistSession(true);
    showNotice('analysisEditNotice', `Restored detected ${rangeKinds[rangeKind].toLowerCase()} ranges.`);
  });
  $('sourceAnalysisTracks').addEventListener('pointerdown', (event) => {
    const track = event.target.closest('[data-source-track]');
    if (event.button !== 0 || activeExport || !track || event.target.closest('[data-analysis-range]')) return;
    event.preventDefault();
    sourceDrag = { pointerId: event.pointerId, track };
    beginAudioScrub();
    $('sourceAnalysisTracks').setPointerCapture(event.pointerId);
    const rect = track.getBoundingClientRect();
    seekAnalysisSource((event.clientX - rect.left) / rect.width * getVideo(state.analysisTarget).duration);
    previewScrubAudio();
  });
  $('sourceAnalysisTracks').addEventListener('pointermove', (event) => {
    if (sourceDrag?.pointerId !== event.pointerId) return;
    const rect = sourceDrag.track.getBoundingClientRect();
    seekAnalysisSource((event.clientX - rect.left) / rect.width * getVideo(state.analysisTarget).duration);
    previewScrubAudio();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) $('sourceAnalysisTracks').addEventListener(name, () => {
    if (!sourceDrag) return;
    sourceDrag = null;
    endAudioScrub();
    persistSession();
  });
  monitorElement.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    previewContextMenu.classList.remove('hidden');
    const bounds = monitorElement.getBoundingClientRect();
    const maxLeft = Math.max(0, monitorElement.clientWidth - previewContextMenu.offsetWidth);
    const maxTop = Math.max(0, monitorElement.clientHeight - previewContextMenu.offsetHeight);
    previewContextMenu.style.left = `${Math.max(0, Math.min(event.clientX - bounds.left - monitorElement.clientLeft, maxLeft))}px`;
    previewContextMenu.style.top = `${Math.max(0, Math.min(event.clientY - bounds.top - monitorElement.clientTop, maxTop))}px`;
    $('previewResolution').focus({ preventScroll: true });
  });
  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 2 && !previewContextMenu.contains(event.target)) closePreviewContextMenu();
  });
  $('previewResolution').addEventListener('change', () => {
    state.previewResolution = $('previewResolution').value;
    drawPreviewFrame();
    persistSession(true);
  });
  $('analyzeButton').addEventListener('click', analyzeMusic);
  $('playButton').addEventListener('click', togglePlayback);
  $('scrubAudioToggle').addEventListener('click', () => {
    state.scrubAudioEnabled = !state.scrubAudioEnabled;
    updateAudioToggles();
    persistSession(true);
  });
  $('musicAudioToggle').addEventListener('click', () => {
    state.musicAudioEnabled = !state.musicAudioEnabled;
    updateAudioToggles();
    persistSession(true);
  });
  $('clipAudioToggle').addEventListener('click', () => {
    state.clipAudioEnabled = !state.clipAudioEnabled;
    updateAudioToggles();
    persistSession(true);
  });
  $('analysisSourceAudioToggle').addEventListener('click', () => {
    state.clipAudioEnabled = !state.clipAudioEnabled;
    updateAudioToggles();
    persistSession(true);
  });
  $('previousButton').addEventListener('click', () => seekEditPoint(-1));
  $('nextButton').addEventListener('click', () => seekEditPoint(1));
  $('exportButton').addEventListener('click', exportEdit);
  $('exportVideoButton').addEventListener('click', exportVideo);
  $('cancelExportButton').addEventListener('click', () => {
    if (!activeExport) return;
    activeExport.cancelled = true;
    activeExport.controller.abort();
    $('exportMessage').textContent = 'Canceling export…';
    $('cancelExportButton').disabled = true;
    if (activeExport.recorder && activeExport.recorder.state !== 'inactive') activeExport.recorder.stop();
  });
  const waveWrap = $('waveWrap');
  waveWrap.addEventListener('pointerdown', (event) => {
    const marker = event.target.closest('.accent-marker');
    if (event.button !== 0 || !marker || marker.disabled || state.workspace !== 'analysis') return;
    if (!canEditAnalysis()) return;
    event.preventDefault();
    musicPlayer.pause();
    const from = Number(marker.dataset.musicAccent);
    const rect = waveWrap.getBoundingClientRect();
    selectedAccentTime = from;
    musicAccentDrag = { pointerId: event.pointerId, from, time: from, duration: duration(), originX: event.clientX,
      grabOffset: event.clientX - rect.left - from / duration() * rect.width, moved: false };
    waveWrap.setPointerCapture(event.pointerId);
    renderMusicAccentEditor();
  });
  waveWrap.addEventListener('pointermove', updateMusicAccentDrag);
  waveWrap.addEventListener('pointerup', (event) => finishMusicAccentDrag(event));
  for (const name of ['pointercancel', 'lostpointercapture']) waveWrap.addEventListener(name, (event) => finishMusicAccentDrag(event, true));
  $('timelinePanel').addEventListener('wheel', (event) => zoomTimeline(event, 'music'), { passive: false });
  $('sourceAnalysisPanel').addEventListener('wheel', (event) => zoomTimeline(event, 'footage'), { passive: false });
  $('musicTimelineViewport').addEventListener('scroll', drawWaveform);
  $('sourceTimelineViewport').addEventListener('scroll', () => renderTimelineNavigator('footage'));
  for (const navigator of document.querySelectorAll('.timeline-navigator')) {
    const kind = navigator.dataset.timelineKind;
    navigator.querySelector('.navigator-fit').addEventListener('click', () => setTimelineWindow(kind, 0, 1));
    navigator.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !event.target.closest('.navigator-rail')) return;
      event.preventDefault();
      const rail = navigator.querySelector('.navigator-rail').getBoundingClientRect();
      const range = getTimelineWindow(kind);
      const thumb = event.target.closest('.navigator-window');
      if (!thumb) {
        const start = (event.clientX - rail.left) / rail.width - (range.end - range.start) / 2;
        setTimelineWindow(kind, start, start + range.end - range.start);
        return;
      }
      const handle = event.target.closest('[data-navigator-edge]');
      (handle || thumb.querySelector('.navigator-pan')).focus({ preventScroll: true });
      navigatorDrag = { kind, part: handle?.dataset.navigatorEdge || 'pan', pointerId: event.pointerId, origin: event.clientX, width: rail.width, range };
      navigator.setPointerCapture(event.pointerId);
    });
    navigator.addEventListener('pointermove', (event) => {
      if (navigatorDrag?.pointerId !== event.pointerId || navigatorDrag.kind !== kind) return;
      const range = moveTimelineWindow(navigatorDrag.range, navigatorDrag.part, (event.clientX - navigatorDrag.origin) / navigatorDrag.width);
      setTimelineWindow(kind, range.start, range.end);
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) navigator.addEventListener(name, (event) => {
      if (navigatorDrag?.kind === kind && navigatorDrag.pointerId === event.pointerId) navigatorDrag = null;
    });
    navigator.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !event.target.closest('.navigator-window')) return;
      event.preventDefault();
      const part = event.target.closest('[data-navigator-edge]')?.dataset.navigatorEdge || 'pan';
      const range = getTimelineWindow(kind);
      let delta = (range.end - range.start) * 0.1 * (event.shiftKey ? 10 : 1) * (event.key === 'ArrowLeft' ? -1 : 1);
      if (event.key === 'Home') delta = part === 'end' ? range.start + 1 / maximumTimelineZoom - range.end : -range.start;
      if (event.key === 'End') delta = part === 'start' ? range.end - 1 / maximumTimelineZoom - range.start : 1 - range.end;
      const next = moveTimelineWindow(range, part, delta);
      setTimelineWindow(kind, next.start, next.end);
    });
  }
  waveWrap.addEventListener('click', (event) => {
    if (suppressWaveClick) {
      suppressWaveClick = false;
      return;
    }
    const marker = event.target.closest('[data-music-accent]');
    if (marker && ['analysis', 'editing'].includes(state.workspace)) {
      selectMusicAccent(Number(marker.dataset.musicAccent));
      return;
    }
    seekFromWaveform(event);
    if (state.workspace === 'analysis' && event.shiftKey) changeMusicAccent('add', musicPlayer.currentTime);
  });
  attachPlayheadDrag(waveWrap);
  attachPlayheadDrag($('musicTimelineContent'));
  $('videoTrack').addEventListener('click', (event) => {
    const clipElement = event.target.closest('[data-cut-index]');
    if (!clipElement) return;
    selectedCutIndex = Number(clipElement.dataset.cutIndex);
    const cut = state.edit[selectedCutIndex];
    if (!cut) return;
    $('videoTrack').querySelectorAll('[data-cut-index]').forEach((clip) => {
      const selected = Number(clip.dataset.cutIndex) === selectedCutIndex;
      clip.classList.toggle('selected', selected);
      clip.setAttribute('aria-pressed', String(selected));
    });
    musicPlayer.currentTime = cut.start;
    syncPreview(true);
  });
  clipSlipTrack.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || clipSlipOverlay.classList.contains('hidden')) return;
    const rect = clipSlipTrack.getBoundingClientRect();
    const selection = clipSlipWindow.getBoundingClientRect();
    const grabbedWindow = event.target.closest('#clipSlipWindow');
    const offset = grabbedWindow ? event.clientX - selection.left : selection.width / 2;
    sourceSlipDrag = { pointerId: event.pointerId, offset };
    clipSlipTrack.classList.add('dragging');
    clipSlipTrack.setPointerCapture(event.pointerId);
    clipSlipPreview.pause();
    updateClipSlipFromPointer(event.clientX, rect);
    event.preventDefault();
  });
  clipSlipTrack.addEventListener('pointermove', (event) => {
    if (sourceSlipDrag?.pointerId !== event.pointerId) return;
    updateClipSlipFromPointer(event.clientX, clipSlipTrack.getBoundingClientRect());
  });
  clipSlipTrack.addEventListener('pointerup', (event) => {
    if (sourceSlipDrag?.pointerId !== event.pointerId) return;
    sourceSlipDrag = null;
    clipSlipTrack.classList.remove('dragging');
    persistSession();
  });
  for (const name of ['pointercancel', 'lostpointercapture']) clipSlipTrack.addEventListener(name, (event) => {
    if (sourceSlipDrag?.pointerId !== event.pointerId) return;
    sourceSlipDrag = null;
    clipSlipTrack.classList.remove('dragging');
    persistSession();
  });
  clipSlipTrack.addEventListener('keydown', handleClipSlipTrackKeydown);
  $('clipSlipSetStart').addEventListener('click', () => setClipSlipPoint('start'));
  $('clipSlipSetEnd').addEventListener('click', () => setClipSlipPoint('end'));
  clipSlipPreview.addEventListener('timeupdate', updateClipSlipPlayerTime);
  clipSlipPreview.addEventListener('seeked', updateClipSlipPlayerTime);
  $('closeClipSlip').addEventListener('click', closeClipSlipEditor);
  $('doneClipSlip').addEventListener('click', closeClipSlipEditor);
  clipSlipOverlay.addEventListener('click', (event) => {
    if (event.target === clipSlipOverlay) closeClipSlipEditor();
  });
  clipSlipPreview.addEventListener('error', () => {
    if (!clipSlipOverlay.classList.contains('hidden')) {
      showNotice('generateNotice', `Could not preview the source video: ${getExportMediaError(clipSlipPreview).message}`, 'warning');
    }
  });
  window.addEventListener('resize', drawWaveform);
  window.addEventListener('resize', closePreviewContextMenu);
  window.addEventListener('keydown', handlePlaybackShortcut);
  window.addEventListener('keydown', handleClipSlipShortcut);
  function handleWorkspaceDeleteShortcut(event) {
    if (event.key !== 'Delete' || !['analysis', 'editing'].includes(state.workspace)
      || event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
    if (sourceAnalysisMode() && selectedRangeIndex !== null) {
      event.preventDefault();
      saveFootageRange(true);
    } else if (!sourceAnalysisMode() && selectedAccentTime !== null) {
      event.preventDefault();
      removeSelectedMusicAccent();
    }
  }
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && musicAccentDrag) {
      event.preventDefault();
      musicAccentDrag.cancelled = true;
      musicAccentDrag.moved = false;
      musicAccentDrag.time = musicAccentDrag.from;
      renderMusicAccentEditor();
      return;
    }
    if (event.key === 'Delete') {
      handleWorkspaceDeleteShortcut(event);
      return;
    }
    if (event.key === 'Escape' && !previewContextMenu.classList.contains('hidden')) {
      closePreviewContextMenu();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveProject();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      openProject();
      return;
    }
  });
  musicPlayer.addEventListener('timeupdate', syncPreview);
  musicPlayer.addEventListener('play', () => { state.playing = true; updatePlayButton(); startFrameMonitoring(); startPlayheadAnimation(); });
  musicPlayer.addEventListener('pause', () => { state.playing = false; pausePreviewPlayers(); stopFrameMonitoring(); stopPlayheadAnimation(); updatePlayButton(); persistSession(); });
  musicPlayer.addEventListener('ended', () => { state.playing = false; pausePreviewPlayers(); stopFrameMonitoring(); stopPlayheadAnimation(); updatePlayButton(); });
  musicPlayer.addEventListener('loadedmetadata', () => {
    updateDuration();
    refreshMusicCuts();
    rebuildAutomaticEdit();
  });
  musicPlayer.addEventListener('error', () => {
    const code = musicPlayer.error?.code;
    showNotice('generateNotice', `Music playback failed${code ? ` (media error ${code})` : ''}. Re-import the track or check that the file is available.`);
  });
  previewVideo.addEventListener('loadedmetadata', () => { if (activePreviewVideo === previewVideo) syncPreview(true); });
  previewVideo.addEventListener('loadedmetadata', () => { if (activePreviewVideo === previewVideo) drawPreviewFrame(); });
  previewVideo.addEventListener('seeked', () => { if (activePreviewVideo === previewVideo) drawPreviewFrame(); });
  previewVideo.addEventListener('pause', () => {
    if (activePreviewVideo !== previewVideo) return;
    cancelPreviewRendering();
    drawPreviewFrame();
  });
  previewVideo.addEventListener('playing', () => { if (activePreviewVideo === previewVideo) schedulePreviewRendering(); });
  previewVideo.addEventListener('error', () => {
    if (activePreviewVideo !== previewVideo) return;
    setFrameIndicator('error', 'FRAME ERROR', 'Preview video could not be decoded; dropped frame metrics are unavailable.');
    if (state.edit.length) showNotice('generateNotice', 'A source clip could not be decoded. Check its file path and codec.');
  });
  previewVideo.addEventListener('playing', () => { if (activePreviewVideo === previewVideo) sampleDroppedFrames(); });
  for (const name of ['timeupdate', 'seeked', 'playing', 'pause', 'ended']) previewVideo.addEventListener(name, () => {
    if (activePreviewVideo !== previewVideo || !sourceAnalysisMode()) return;
    updateAnalysisPlayhead();
    updatePlayButton();
    if (name === 'playing') startPlayheadAnimation();
    if (name === 'pause' || name === 'ended') stopPlayheadAnimation();
    if (name === 'pause' || name === 'ended') persistSession();
  });

  const dropZone = $('dropZone');
  for (const eventName of ['dragenter', 'dragover']) dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add('dragging'); });
  for (const eventName of ['dragleave', 'drop']) dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); });
  dropZone.addEventListener('drop', (event) => {
    const files = [...event.dataTransfer.files];
    const audio = files.find((file) => file.type.startsWith('audio/'));
    if (audio) loadMusic(audio);
    addVideos(files.filter((file) => file.type.startsWith('video/')));
  });

  function loadMusic(file) {
    if (footageTask || musicAnalysisTask) {
      showNotice('footageNotice', footageTask ? 'Cancel footage analysis before replacing the music.' : 'Wait for music analysis before replacing the music.', 'warning');
      return;
    }
    finishMusicAccentDrag(null, true);
    endAudioScrub(false);
    audioScrubber.dispose();
    if (state.music?.url?.startsWith('blob:')) URL.revokeObjectURL(state.music.url);
    const filePath = getMediaPath(file);
    state.music = { file, path: filePath, url: mediaUrl(file, filePath) };
    state.audioBuffer = null;
    state.musicEnergy = [];
    state.beatTimes = [];
    state.detectedCutTimes = [];
    state.musicCutOverrides = { added: [], removed: [] };
    selectedAccentTime = null;
    state.analysisTarget = 'music';
    state.beatCandidates = [];
    state.tempoBpm = 0;
    clearSelectedClip();
    state.edit = [];
    renderVideoTrack();
    musicPlayer.pause();
    musicPlayer.src = state.music.url;
    $('musicList').innerHTML = `<div class="asset selected music-asset" title="Double-click to open the Analysis workspace"><div class="asset-thumb">♫</div><div class="asset-copy"><div class="asset-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div><div class="asset-meta">Double-click to edit analysis</div></div><span class="asset-action">♪</span></div>`;
    $('trackName').textContent = file.name.toUpperCase();
    $('analyzeButton').disabled = false;
    setExportAvailability(false);
    $('analysisLabel').textContent = 'Not analyzed';
    $('cutList').innerHTML = '<li class="cut-empty">Suggested cut points will appear here for review.</li>';
    showNotice('assemblyNotice', '');
    $('beatCount').textContent = 'No edit points';
    $('analysisNotice').textContent = '';
    $('generateNotice').textContent = '';
    $('waveEmpty').classList.remove('hidden');
    $('statusText').textContent = 'Analyze the track to find edit points';
    previewCanvas.classList.add('hidden');
    $('monitorEmpty').classList.remove('hidden');
    $('monitorSource').textContent = 'No source selected';
    updateDuration();
    drawWaveform();
    renderAnalysisEditor();
    persistSession(true);
  }

  async function addVideos(files) {
    if (footageTask) {
      showNotice('footageNotice', 'Cancel footage analysis before adding footage.', 'warning');
      return;
    }
    for (const file of files) {
      if (!file.type.startsWith('video/')) continue;
      const filePath = getMediaPath(file);
      const video = { id: crypto.randomUUID(), file, path: filePath, url: mediaUrl(file, filePath), duration: 0, thumb: '', importance: 1 };
      state.videos.push(video);
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.muted = true;
      probe.src = video.url;
      probe.addEventListener('loadedmetadata', () => {
        video.duration = Number.isFinite(probe.duration) ? probe.duration : 0;
        persistSession();
        try {
          probe.currentTime = Math.min(0.5, probe.duration / 2);
          probe.addEventListener('seeked', () => {
            const thumbCanvas = document.createElement('canvas');
            thumbCanvas.width = 70;
            thumbCanvas.height = 70;
            thumbCanvas.getContext('2d').drawImage(probe, 0, 0, 70, 70);
            video.thumb = thumbCanvas.toDataURL('image/jpeg', 0.65);
            renderVideos();
          }, { once: true });
        } catch { renderVideos(); }
        renderVideos();
        rebuildAutomaticEdit();
      }, { once: true });
      probe.addEventListener('error', () => {
        renderVideos();
        showNotice('assemblyNotice', `${file.name} could not be read as a video source.`);
      }, { once: true });
    }
    renderVideos();
    renderSceneWeights();
    rebuildAutomaticEdit();
    persistSession(true);
  }

  function renderVideos() {
    renderFootageAnalysis();
    $('videoCount').textContent = `${state.videos.length} ${state.videos.length === 1 ? 'source' : 'sources'}`;
    if (!state.videos.length) {
      $('videoList').innerHTML = '<div class="empty-note">Add camera angles or other footage sources.</div>';
      return;
    }
    $('videoList').innerHTML = state.videos.map((video) => `<div class="asset video-asset ${state.activeCut?.sourceId === video.id ? 'selected' : ''}" data-video-id="${video.id}" draggable="true" title="Drag to reorder; click to preview"><div class="asset-thumb">${video.thumb ? `<img src="${video.thumb}" alt="">` : '▶'}</div><div class="asset-copy"><div class="asset-name" title="${escapeHtml(video.file.name)}">${escapeHtml(video.file.name)}</div><div class="asset-meta">${video.duration ? formatSourceTime(video.duration) : 'Loading media'}</div></div><button class="asset-action" data-remove-video="${video.id}" aria-label="Remove ${escapeHtml(video.file.name)}">×</button></div>`).join('');
    $('videoList').querySelectorAll('[data-video-id]').forEach((row) => row.addEventListener('click', (event) => {
      if (event.target.closest('[data-remove-video]')) return;
      const video = getVideo(row.dataset.videoId);
      if (!video) return;
      if (state.workspace === 'analysis' || state.workspace === 'color') {
        setAnalysisTarget(video.id);
        return;
      }
      setPreviewSource(video, 0);
      musicPlayer.pause();
      renderVideos();
    }));
    $('videoList').querySelectorAll('[data-remove-video]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      removeVideo(button.dataset.removeVideo);
    }));
  }

  $('videoList').addEventListener('dragstart', (event) => {
    const row = event.target.closest('[data-video-id]');
    if (!row || event.target.closest('[data-remove-video]')) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', row.dataset.videoId);
    row.classList.add('dragging');
  });
  $('videoList').addEventListener('dragover', (event) => {
    const row = event.target.closest('[data-video-id]');
    if (!row) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    $('videoList').querySelectorAll('.drop-before, .drop-after').forEach((item) => item.classList.remove('drop-before', 'drop-after'));
    const position = event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2 ? 'drop-before' : 'drop-after';
    row.classList.add(position);
  });
  $('videoList').addEventListener('drop', (event) => {
    const row = event.target.closest('[data-video-id]');
    if (!row) return;
    event.preventDefault();
    const draggedId = event.dataTransfer.getData('text/plain');
    const targetId = row.dataset.videoId;
    if (!draggedId || draggedId === targetId) return;

    const bounds = row.getBoundingClientRect();
    const afterTarget = event.clientY >= bounds.top + bounds.height / 2;
    const draggedVideo = getVideo(draggedId);
    if (!draggedVideo) return;
    const reorderedVideos = state.videos.filter((video) => video.id !== draggedId);
    const targetIndex = reorderedVideos.findIndex((video) => video.id === targetId);
    if (targetIndex < 0) return;
    reorderedVideos.splice(targetIndex + (afterTarget ? 1 : 0), 0, draggedVideo);
    state.videos = reorderedVideos;
    renderVideos();
    renderSceneWeights();
    rebuildAutomaticEdit();
    persistSession(true);
  });
  $('videoList').addEventListener('dragend', () => {
    $('videoList').querySelectorAll('.dragging, .drop-before, .drop-after').forEach((row) => row.classList.remove('dragging', 'drop-before', 'drop-after'));
  });

  function renderSceneWeights() {
    const sceneList = $('sceneList');
    if (!state.videos.length) {
      sceneList.innerHTML = '<div class="cut-empty">Add video sources to set their scene importance.</div>';
      return;
    }
    sceneList.innerHTML = state.videos.map((video) => {
      const importance = Number.isFinite(video.importance) ? Math.min(5, Math.max(0.1, video.importance)) : 1;
      video.importance = importance;
      return `<div class="scene-weight-row"><div class="scene-weight-heading"><span title="${escapeHtml(video.file.name)}">${escapeHtml(video.file.name)}</span><span class="scene-weight-value">${importance.toFixed(1)}</span></div><input type="range" min="0.1" max="5" step="0.1" value="${importance}" data-scene-importance="${video.id}" aria-label="Scene importance for ${escapeHtml(video.file.name)}"></div>`;
    }).join('');
  }

  function renderFootageAnalysis() {
    const analyzed = state.videos.filter((video) => video.analysis);
    $('footageAnalysisLabel').textContent = footageTask ? 'Analyzing' : `${analyzed.length}/${state.videos.length} analyzed`;
    $('analyzeFootageButton').disabled = Boolean(footageTask || musicAnalysisTask || activeExport) || !state.videos.some((video) => video.duration > 0);
    renderAnalysisEditor();
    setExportAvailability(state.edit.length > 0);
  }

  async function analyzeFootage() {
    if (footageTask) return;
    if (musicAnalysisTask) {
      showNotice('footageNotice', 'Wait for music analysis to finish before analyzing footage.', 'warning');
      return;
    }
    if (activeExport) {
      showNotice('footageNotice', 'Wait for video export to finish before analyzing footage.', 'warning');
      return;
    }
    if (!desktopApi?.analyzeFootage) {
      showNotice('footageNotice', 'Local footage analysis is available in the AutoEdit desktop app.', 'warning');
      return;
    }
    const videos = state.videos.filter((video) => video.duration > 0);
    if (!videos.length || videos.some((video) => !video.path)) {
      showNotice('footageNotice', 'Import local video files and wait for their durations to load.', 'warning');
      return;
    }
    if (!state.videos.some((video) => video.analysis?.audioStatus === 'available')
      && !window.confirm('Analyze footage locally? First use downloads an audio-event model from Hugging Face (about 91 MB). Videos and audio are never uploaded. Long recordings can take considerable time.')) return;
    const task = { cancelled: false };
    footageTask = task;
    musicPlayer.pause();
    $('cancelFootageButton').classList.remove('hidden');
    $('cancelFootageButton').disabled = false;
    $('footageProgress').classList.remove('hidden');
    $('footageProgress').value = 0;
    renderFootageAnalysis();
    let completed = 0;
    const unsubscribe = desktopApi.onFootageProgress(({ message, fraction }) => {
      $('footageProgress').value = (completed + Math.max(0, Math.min(1, fraction))) / videos.length;
      showNotice('footageNotice', `${videos[completed]?.file.name || 'Footage'}: ${message}`);
    });
    let currentVideo = null;
    try {
      persistSession(true);
      if (state.music && !state.audioBuffer) {
        showNotice('footageNotice', 'Analyzing music energy and edit points…');
        const buffer = await decodeMusicBuffer();
        if (task.cancelled) throw new Error('Footage analysis canceled.');
        state.audioBuffer = buffer;
        state.musicEnergy = footage.musicEnergy(buffer);
        $('waveEmpty').classList.add('hidden');
        updateDuration();
        updateBeatAnalysis();
      }
      for (const video of videos) {
        if (task.cancelled) throw new Error('Footage analysis canceled.');
        currentVideo = video;
        const analysis = await desktopApi.analyzeFootage({
          filePath: video.path, duration: video.duration, cached: video.analysis || null
        });
        if (task.cancelled) throw new Error('Footage analysis canceled.');
        if (!footage.validAnalysis(analysis)) throw new Error(`${video.file.name} returned invalid analysis.`);
        if (video.analysisEdits && !footage.sameFingerprint(video.analysis?.fingerprint, analysis.fingerprint)) {
          video.analysisEdits = null;
          showNotice('analysisEditNotice', `${video.file.name} changed. Its manual range edits were discarded.`);
        }
        video.analysis = analysis;
        completed++;
        currentVideo = null;
        renderFootageAnalysis();
        persistSession(true);
      }
      rebuildAutomaticEdit();
      showNotice('footageNotice', `Analyzed ${completed} sources locally.${state.musicEnergy.length ? ' The timeline now uses motion, speech and clapping preferences when enabled.' : ' Analyze music to enable energy-matched clip selection.'}`);
    } catch (error) {
      if (currentVideo?.analysis) {
        try {
          const fingerprint = await desktopApi.getFootageFingerprint(currentVideo.path);
          if (!footage.sameFingerprint(currentVideo.analysis.fingerprint, fingerprint)) {
            currentVideo.analysis = null;
            currentVideo.analysisEdits = null;
            showNotice('analysisEditNotice', `${currentVideo.file.name} changed. Its analysis and range edits were discarded.`);
          }
        } catch (validationError) {
          currentVideo.analysis = null;
          currentVideo.analysisEdits = null;
          showNotice('analysisEditNotice', `Could not validate saved ranges: ${validationError.message}. The stale ranges were discarded.`, 'warning');
        }
      }
      if (completed || currentVideo) rebuildAutomaticEdit();
      showNotice('footageNotice', task.cancelled
        ? `Analysis canceled. Results for ${completed} completed sources were saved.`
        : `Footage analysis failed: ${error.message}. Results for ${completed} completed sources were saved.`, task.cancelled ? 'status' : 'warning');
    } finally {
      unsubscribe();
      footageTask = null;
      $('cancelFootageButton').classList.add('hidden');
      $('footageProgress').classList.add('hidden');
      renderFootageAnalysis();
      persistSession(true);
    }
  }

  function removeVideo(id) {
    if (footageTask) {
      showNotice('footageNotice', 'Cancel footage analysis before removing footage.', 'warning');
      return;
    }
    const video = getVideo(id);
    if (!video) return;
    endAudioScrub(false);
    audioScrubber.dispose();
    const cachedPlayer = previewPlayers.get(id);
    if (cachedPlayer) {
      cachedPlayer.pause();
      cachedPlayer.removeAttribute('src');
      cachedPlayer.load();
      previewPlayers.delete(id);
      if (activePreviewVideo === cachedPlayer) {
        cancelPreviewRendering();
        activePreviewVideo = previewVideo;
        updatePreviewPlayerAudio();
      }
    }
    if (video.url.startsWith('blob:')) URL.revokeObjectURL(video.url);
    state.videos = state.videos.filter((item) => item.id !== id);
    state.activeCut = null;
    renderVideos();
    renderSceneWeights();
    rebuildAutomaticEdit();
    $('monitorSource').textContent = 'No source selected';
    persistSession(true);
  }

  async function analyzeMusic() {
    if (!state.music) return;
    if (footageTask || musicAnalysisTask || activeExport) {
      showNotice('analysisNotice', 'Wait for analysis or export to finish before analyzing music.', 'warning');
      return;
    }
    const music = state.music;
    musicAnalysisTask = music;
    $('analyzeButton').disabled = true;
    $('analysisLabel').textContent = 'Analyzing';
    showNotice('analysisNotice', 'Reading the track locally…');
    renderFootageAnalysis();
    try {
      const buffer = await decodeMusicBuffer();
      if (state.music !== music) {
        showNotice('analysisNotice', 'The music changed during analysis; old results were discarded.', 'warning');
        return;
      }
      state.audioBuffer = buffer;
      state.musicEnergy = footage.musicEnergy(state.audioBuffer);
      updateBeatAnalysis();
      $('waveEmpty').classList.add('hidden');
      updateDuration();
      drawWaveform();
      persistSession(true);
    } catch (error) {
      $('analysisLabel').textContent = 'Could not analyze';
      showNotice('analysisNotice', `This track could not be decoded by the browser: ${error.message}`);
    } finally {
      musicAnalysisTask = null;
      $('analyzeButton').disabled = false;
      renderFootageAnalysis();
    }
  }

  function findAccents(buffer, sensitivity) {
    const channelCount = buffer.numberOfChannels;
    const samplesPerFrame = Math.max(256, Math.floor(buffer.sampleRate * 0.025));
    const frameDuration = samplesPerFrame / buffer.sampleRate;
    const frameCount = Math.ceil(buffer.length / samplesPerFrame);
    const envelope = new Float32Array(frameCount);
    for (let channel = 0; channel < channelCount; channel++) {
      const data = buffer.getChannelData(channel);
      for (let frame = 0; frame < frameCount; frame++) {
        const start = frame * samplesPerFrame;
        const end = Math.min(data.length, start + samplesPerFrame);
        let sum = 0;
        for (let index = start; index < end; index++) sum += data[index] * data[index];
        envelope[frame] += Math.sqrt(sum / Math.max(1, end - start)) / channelCount;
      }
    }
    const flux = new Float32Array(frameCount);
    for (let index = 2; index < frameCount; index++) flux[index] = Math.max(0, envelope[index] - envelope[index - 2]);
    const sorted = [...flux].sort((a, b) => a - b);
    const percentile = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * (1 - sensitivity * 0.55)))];
    const mean = flux.reduce((sum, value) => sum + value, 0) / Math.max(1, flux.length);
    const threshold = Math.max(percentile, mean * 1.25, 0.003);
    const onsets = [];
    const minGap = Math.max(1, Math.round(0.08 / frameDuration));
    for (let index = 3; index < frameCount - 2; index++) {
      const value = flux[index];
      if (value < threshold || value < flux[index - 1] || value < flux[index + 1] || value < flux[index - 2] || value < flux[index + 2]) continue;
      const previous = onsets[onsets.length - 1];
      if (previous && index - previous.frame < minGap) {
        if (value > previous.value) onsets[onsets.length - 1] = { frame: index, value };
      } else onsets.push({ frame: index, value });
    }
    const periodFrames = estimateBeatPeriod(flux, frameDuration);
    const phase = estimateBeatPhase(flux, periodFrames);
    const tolerance = Math.max(1, Math.round(Math.min(0.18, periodFrames * frameDuration * 0.2) / frameDuration));
    const beatCandidates = [];
    for (let beatIndex = 0, frame = phase; frame < frameCount; beatIndex++, frame = Math.round(phase + beatIndex * periodFrames)) {
      const nearest = onsets
        .filter((onset) => Math.abs(onset.frame - frame) <= tolerance)
        .sort((left, right) => right.value - left.value)[0];
      beatCandidates.push({ beatIndex, time: frame * frameDuration, strength: nearest?.value || 0, hasAccent: Boolean(nearest) });
    }
    return { tempoBpm: 60 / (periodFrames * frameDuration), beatCandidates };
  }

  function estimateBeatPeriod(flux, frameDuration) {
    const average = flux.reduce((sum, value) => sum + value, 0) / Math.max(1, flux.length);
    const minLag = Math.max(1, Math.round(60 / 190 / frameDuration));
    const maxLag = Math.min(Math.floor(flux.length / 2), Math.round(60 / 55 / frameDuration));
    const correlation = (lag) => {
      if (lag < 1 || lag >= flux.length) return 0;
      let product = 0;
      let leftEnergy = 0;
      let rightEnergy = 0;
      for (let index = lag; index < flux.length; index++) {
        const left = flux[index] - average;
        const right = flux[index - lag] - average;
        product += left * right;
        leftEnergy += left * left;
        rightEnergy += right * right;
      }
      return product / Math.sqrt(leftEnergy * rightEnergy || 1);
    };
    const scores = [];
    for (let lag = minLag; lag <= maxLag; lag++) {
      scores.push({ lag, score: correlation(lag) });
    }
    const bestScore = Math.max(...scores.map((item) => item.score));
    if (bestScore < 0.1) return Math.round(0.5 / frameDuration);
    let bestLag = scores.find((item) => item.score >= bestScore * 0.88).lag;
    const halfLag = Math.round(bestLag / 2);
    if (halfLag >= minLag) {
      const phase = estimateBeatPhase(flux, bestLag);
      const radius = Math.max(1, Math.round(bestLag * 0.08));
      const localPeak = (frame) => {
        let strongest = 0;
        for (let offset = -radius; offset <= radius; offset++) {
          const candidate = frame + offset;
          if (candidate >= 0 && candidate < flux.length) strongest = Math.max(strongest, flux[candidate]);
        }
        return strongest;
      };
      let onBeat = 0;
      let offBeat = 0;
      let count = 0;
      for (let frame = phase; frame + bestLag < flux.length; frame += bestLag) {
        onBeat += localPeak(frame);
        offBeat += localPeak(frame + halfLag);
        count++;
      }
      if (count && offBeat / count >= onBeat / count * 0.3) bestLag = halfLag;
    }
    return bestLag;
  }

  function estimateBeatPhase(flux, periodFrames) {
    let bestPhase = 0;
    let bestScore = -Infinity;
    const radius = Math.max(1, Math.round(periodFrames * 0.08));
    for (let phase = 0; phase < periodFrames; phase++) {
      let total = 0;
      let count = 0;
      for (let frame = phase; frame < flux.length; frame += periodFrames) {
        let strongest = 0;
        for (let offset = -radius; offset <= radius; offset++) {
          const candidate = frame + offset;
          if (candidate >= 0 && candidate < flux.length) strongest = Math.max(strongest, flux[candidate]);
        }
        total += strongest;
        count++;
      }
      const score = total / Math.max(1, count);
      if (score > bestScore) {
        bestScore = score;
        bestPhase = phase;
      }
    }
    return bestPhase;
  }

  function updateBeatAnalysis() {
    const analysis = findAccents(state.audioBuffer, Number($('sensitivity').value) / 100);
    state.tempoBpm = analysis.tempoBpm;
    state.beatCandidates = analysis.beatCandidates;
    $('analysisLabel').textContent = `~${Math.round(state.tempoBpm)} BPM`;
    applyCutCadence();
  }

  function applyCutCadence() {
    const cadence = Number($('cutCadence').value) || 2;
    const selected = [];
    for (let index = 0; index < state.beatCandidates.length; index += cadence) {
      const group = state.beatCandidates.slice(index, index + cadence).filter((beat) => beat.hasAccent);
      if (group.length) selected.push(group.reduce((strongest, beat) => beat.strength > strongest.strength ? beat : strongest).time);
    }
    state.detectedCutTimes = selected.filter((time) => time > 0.12 && time < (duration() || Infinity) - 0.12);
    refreshMusicCuts();
    clearSelectedClip();
    state.edit = [];
    state.activeCut = null;
    setExportAvailability(false);
    $('statusText').textContent = `${state.beatTimes.length} cut points at ~${Math.round(state.tempoBpm)} BPM`;
    showNotice('analysisNotice', `Beat grid estimated at ~${Math.round(state.tempoBpm)} BPM. Keeping the strongest accent every ${cadence === 4 ? 'bar' : cadence === 2 ? '2 beats' : 'beat'}.`);
    drawWaveform();
    rebuildAutomaticEdit();
    persistSession();
  }

  function rebuildAutomaticEdit() {
    const total = duration();
    const sources = state.videos.filter((video) => video.duration > 0);
    const minimumClips = Number($('minimumConsecutiveClips').value) || 2;
    if (!total || !sources.length) {
      clearSelectedClip();
      state.edit = [];
      state.activeCut = null;
      setExportAvailability(false);
      const message = !total
        ? 'Import a music track to create the timeline.'
        : state.videos.length
          ? 'Waiting for video source durations to load.'
          : 'Add video sources to build the timeline.';
      $('statusText').textContent = !total
        ? 'Import music to build the timeline'
        : state.videos.length ? 'Reading video source durations' : 'Add footage to build the timeline';
      showNotice('assemblyNotice', message);
      renderVideoTrack();
      return;
    }

    const cuts = [];
    const beats = state.beatTimes.filter((time) => time > 0.12 && time < total - 0.12);
    if (beats.length || state.tempoBpm > 0 || accents.hasEdits(state.musicCutOverrides)) {
      const boundaries = [0, ...beats, total];
      for (let index = 0; index < boundaries.length - 1; index++) {
        if (boundaries[index + 1] > boundaries[index]) cuts.push({ start: boundaries[index], end: boundaries[index + 1] });
      }
    } else {
      const fallbackCutLength = 2.5;
      for (let start = 0; start < total; start += fallbackCutLength) {
        cuts.push({ start, end: Math.min(total, start + fallbackCutLength) });
      }
    }

    const credits = new Map(sources.map((video) => [video.id, 0]));
    const motionScale = Math.max(0.005, footage.percentile(sources.filter((video) => video.analysis)
      .flatMap((video) => video.analysis.motion.map((range) => range.score)), 0.9));
    const result = [];
    let activeSourceId = null;
    let consecutiveClips = 0;
    let omittedClips = 0;

    for (const cut of cuts) {
      const cutLength = cut.end - cut.start;
      const eligibleSources = sources.filter((video) => video.duration >= cutLength);
      if (!eligibleSources.length) {
        omittedClips++;
        continue;
      }

      let selected = eligibleSources.find((video) => video.id === activeSourceId);
      if (!selected || consecutiveClips >= minimumClips) {
        const totalWeight = eligibleSources.reduce((sum, video) => {
          let weight = Number.isFinite(video.importance) ? video.importance : 1;
          if (state.useFootageAnalysis && state.musicEnergy.length) {
            weight *= footage.sourcePreference(video, cut, state.musicEnergy, motionScale);
          }
          credits.set(video.id, (credits.get(video.id) || 0) + weight);
          return sum + weight;
        }, 0);
        selected = eligibleSources.reduce((best, video) => {
          const bestCredit = credits.get(best.id) || 0;
          const credit = credits.get(video.id) || 0;
          return credit > bestCredit ? video : best;
        });
        credits.set(selected.id, (credits.get(selected.id) || 0) - totalWeight);
      }

      if (selected.id === activeSourceId) consecutiveClips++;
      else {
        activeSourceId = selected.id;
        consecutiveClips = 1;
      }
      result.push({ ...cut, sourceId: selected.id });
    }

    for (const video of sources) {
      const sourceCuts = result.filter((cut) => cut.sourceId === video.id);
      if (!sourceCuts.length) continue;
      if (sourceCuts.length === 1) {
        sourceCuts[0].sourceStart = (video.duration - (sourceCuts[0].end - sourceCuts[0].start))
          * sourceSampleFraction(video.id, 0);
        continue;
      }

      const sourceUse = sourceCuts.reduce((sum, cut) => sum + cut.end - cut.start, 0);
      if (sourceUse < video.duration) {
        const gap = (video.duration - sourceUse) / (sourceCuts.length + 1);
        let sourceTime = gap;
        for (const cut of sourceCuts) {
          cut.sourceStart = sourceTime;
          sourceTime += cut.end - cut.start + gap;
        }
      } else {
        const longestClip = Math.max(...sourceCuts.map((cut) => cut.end - cut.start));
        const lastValidStart = video.duration - longestClip;
        sourceCuts.forEach((cut, index) => {
          cut.sourceStart = lastValidStart * (index + 1) / (sourceCuts.length + 1);
        });
      }
    }

    if (state.useFootageAnalysis && state.musicEnergy.length) {
      footage.guideSourceStarts(result, sources, state.musicEnergy);
    }
    clearSelectedClip();
    state.edit = result;
    state.activeCut = null;
    setExportAvailability(result.length > 0);
    $('statusText').textContent = `${result.length} clips automatically assembled`;
    showNotice('assemblyNotice', result.length
      ? `${result.length} clips arranged across all available scenes.${omittedClips ? ` ${omittedClips} clips omitted because no source was long enough.` : ''}`
      : 'No clips generated. Check that the imported sources contain footage long enough for the music cuts.');
    drawWaveform();
    renderVideoTrack();
    syncPreview(true);
    persistSession(true);
  }

  function sourceSampleFraction(sourceId, sampleIndex) {
    let hash = 2166136261;
    for (const character of sourceId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    const phase = (hash >>> 0) / 4294967296;
    return (phase + sampleIndex * 0.618033988749895) % 1;
  }

  function setFrameIndicator(status, label, description) {
    const indicator = $('frameIndicator');
    indicator.dataset.status = status;
    indicator.textContent = label;
    indicator.title = description;
    indicator.setAttribute('aria-label', description);
  }

  function sampleDroppedFrames() {
    if (!state.playing) return;
    if (!activePreviewVideo.currentSrc || activePreviewVideo.paused || activePreviewVideo.ended) {
      if (droppedFrameCount) {
        setFrameIndicator('dropped', `DROPPED ${droppedFrameCount}`, `${droppedFrameCount} preview frames dropped during this playback.`);
      } else if (activePreviewVideo.getAttribute('src') && activePreviewVideo.readyState < 2) {
        setFrameIndicator('waiting', 'WAITING', 'Waiting for preview video frames.');
      } else {
        setFrameIndicator('idle', 'NO VIDEO', 'No preview video is currently playing.');
      }
      return;
    }

    const quality = typeof activePreviewVideo.getVideoPlaybackQuality === 'function'
      ? activePreviewVideo.getVideoPlaybackQuality()
      : null;
    const currentDroppedFrames = Number.isFinite(quality?.droppedVideoFrames)
      ? quality.droppedVideoFrames
      : Number.isFinite(activePreviewVideo.webkitDroppedFrameCount) ? activePreviewVideo.webkitDroppedFrameCount : null;
    if (currentDroppedFrames === null) {
      setFrameIndicator('idle', 'METRICS N/A', 'Dropped frame metrics are not available for this preview.');
      return;
    }

    if (lastDroppedFrameCount !== null && currentDroppedFrames >= lastDroppedFrameCount) {
      droppedFrameCount += currentDroppedFrames - lastDroppedFrameCount;
    }
    lastDroppedFrameCount = currentDroppedFrames;
    if (droppedFrameCount) {
      setFrameIndicator('dropped', `DROPPED ${droppedFrameCount}`, `${droppedFrameCount} preview frames dropped during this playback.`);
    } else {
      setFrameIndicator('ok', 'FRAMES OK', 'No dropped preview frames detected during this playback.');
    }
  }

  function startFrameMonitoring() {
    clearInterval(frameSampleTimer);
    droppedFrameCount = 0;
    lastDroppedFrameCount = null;
    setFrameIndicator('waiting', 'WAITING', 'Waiting for preview video frames.');
    sampleDroppedFrames();
    frameSampleTimer = setInterval(sampleDroppedFrames, 500);
  }

  function stopFrameMonitoring() {
    clearInterval(frameSampleTimer);
    frameSampleTimer = null;
    lastDroppedFrameCount = null;
    if ($('frameIndicator').dataset.status === 'waiting') {
      setFrameIndicator('idle', 'FRAME STATUS', 'Dropped frame status appears during preview playback.');
    }
  }

  function getPreviewPlayer(video) {
    let player = previewPlayers.get(video.id);
    if (player) {
      previewPlayers.delete(video.id);
      previewPlayers.set(video.id, player);
      return player;
    }

    player = previewPlayers.size === 0 ? previewVideo : document.createElement('video');
    player.preload = 'auto';
    player.muted = true;
    player.playsInline = true;
    player.volume = 0.65;
    if (player !== previewVideo) {
      for (const name of ['timeupdate', 'seeked', 'playing', 'pause', 'ended']) player.addEventListener(name, () => {
        if (activePreviewVideo !== player || !sourceAnalysisMode()) return;
        updateAnalysisPlayhead();
        updatePlayButton();
        if (name === 'playing') startPlayheadAnimation();
        if (name === 'pause' || name === 'ended') stopPlayheadAnimation();
        if (name === 'pause' || name === 'ended') persistSession();
      });
      player.addEventListener('loadedmetadata', () => { if (activePreviewVideo === player) drawPreviewFrame(); });
      player.addEventListener('seeked', () => { if (activePreviewVideo === player) drawPreviewFrame(); });
      player.addEventListener('pause', () => {
        if (activePreviewVideo !== player) return;
        cancelPreviewRendering();
        drawPreviewFrame();
      });
      player.addEventListener('playing', () => { if (activePreviewVideo === player) schedulePreviewRendering(); });
      player.addEventListener('playing', () => { if (activePreviewVideo === player) sampleDroppedFrames(); });
      player.addEventListener('error', () => {
        if (activePreviewVideo !== player) return;
        setFrameIndicator('error', 'FRAME ERROR', 'Preview video could not be decoded; dropped frame metrics are unavailable.');
        if (state.edit.length) showNotice('generateNotice', 'A source clip could not be decoded. Check its file path and codec.');
      });
    }
    previewPlayers.set(video.id, player);
    while (previewPlayers.size > maximumCachedPreviewPlayers) {
      const [oldestId, oldestPlayer] = previewPlayers.entries().next().value;
      if (oldestPlayer === activePreviewVideo) {
        previewPlayers.delete(oldestId);
        previewPlayers.set(oldestId, oldestPlayer);
        continue;
      }
      previewPlayers.delete(oldestId);
      oldestPlayer.pause();
      oldestPlayer.removeAttribute('src');
      oldestPlayer.load();
    }
    return player;
  }

  function pausePreviewPlayers() {
    for (const player of new Set([...previewPlayers.values(), previewVideo])) player.pause();
  }

  function updatePreviewPlayerAudio() {
    for (const player of new Set([...previewPlayers.values(), previewVideo])) {
      player.muted = player !== activePreviewVideo || !state.clipAudioEnabled;
    }
  }

  function waitForPreviewEvent(player, eventName) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error(`Timed out while preparing preview ${eventName}.`)), 15000);
      const onReady = () => finish();
      const onError = () => finish(new Error('A source clip could not be decoded while preparing playback.'));
      function finish(error) {
        clearTimeout(timeout);
        player.removeEventListener(eventName, onReady);
        player.removeEventListener('error', onError);
        if (error) reject(error);
        else resolve();
      }
      player.addEventListener(eventName, onReady, { once: true });
      player.addEventListener('error', onError, { once: true });
    });
  }

  async function preparePreviewWindow(startTime) {
    const endTime = startTime + 4;
    const cuts = state.edit.filter((cut) => cut.end > startTime && cut.start < endTime);
    const preparedSources = new Set();
    for (const cut of cuts) {
      if (preparedSources.has(cut.sourceId) || preparedSources.size >= maximumCachedPreviewPlayers) continue;
      const video = getVideo(cut.sourceId);
      if (!video) continue;
      preparedSources.add(cut.sourceId);
      const player = getPreviewPlayer(video);
      if (player.src !== video.url) {
        const metadataReady = waitForPreviewEvent(player, 'loadedmetadata');
        player.src = video.url;
        await metadataReady;
      }
      const offset = Math.max(0, Math.min(
        cut.sourceStart + Math.max(0, startTime - cut.start),
        video.duration ? video.duration - 0.05 : cut.sourceStart
      ));
      if (Math.abs(player.currentTime - offset) > 0.08) {
        const seeked = waitForPreviewEvent(player, 'seeked');
        const frameReady = player.readyState >= 2 ? Promise.resolve() : waitForPreviewEvent(player, 'loadeddata');
        player.currentTime = offset;
        await Promise.all([seeked, frameReady]);
      } else if (player.readyState < 2) {
        await waitForPreviewEvent(player, 'loadeddata');
      }
    }
  }

  async function preparePlayback() {
    const button = $('playButton');
    button.disabled = true;
    button.textContent = '…';
    button.setAttribute('aria-label', 'Preparing preview');
    setFrameIndicator('waiting', 'PREPARING', 'Preparing the next few seconds of video before playback.');
    try {
      await preparePreviewWindow(musicPlayer.currentTime || 0);
    } catch (error) {
      showNotice('generateNotice', `Preview preparation could not complete: ${error.message} Playback will continue without the full prebuffer.`);
    }
    syncPreview(true);
    try {
      await musicPlayer.play();
      syncPreview();
    } catch (error) {
      showNotice('generateNotice', `Music playback could not start: ${error.message}`);
    } finally {
      button.disabled = false;
      updatePlayButton();
    }
  }

  function drawPreviewFrame() {
    if (!previewContext || !activePreviewVideo.videoWidth || !activePreviewVideo.videoHeight) return;
    const scale = state.previewResolution === 'quarter' ? 0.25 : state.previewResolution === 'half' ? 0.5 : 1;
    const width = Math.max(1, Math.round(activePreviewVideo.videoWidth * scale));
    const height = Math.max(1, Math.round(activePreviewVideo.videoHeight * scale));
    if (previewCanvas.width !== width || previewCanvas.height !== height) {
      previewCanvas.width = width;
      previewCanvas.height = height;
    }
    try {
      colors.render(previewContext, activePreviewVideo, getVideo(previewSourceId)?.color, 0, 0, width, height);
      colorPreviewError = null;
    } catch (error) {
      if (colorPreviewError !== error.message) showNotice('colorNotice', `Color preview failed: ${error.message}`, 'warning');
      colorPreviewError = error.message;
      musicPlayer.pause();
      activePreviewVideo.pause();
      cancelPreviewRendering();
    }
  }

  function startPlayheadAnimation() {
    if (playheadAnimationFrameId !== null || activeExport) return;
    const animate = () => {
      playheadAnimationFrameId = null;
      if (activeExport) return;
      const player = sourceAnalysisMode() ? activePreviewVideo : musicPlayer;
      syncPreview();
      if (!player.paused && !player.ended) playheadAnimationFrameId = requestAnimationFrame(animate);
    };
    playheadAnimationFrameId = requestAnimationFrame(animate);
  }

  function stopPlayheadAnimation() {
    if (playheadAnimationFrameId !== null) cancelAnimationFrame(playheadAnimationFrameId);
    playheadAnimationFrameId = null;
    syncPreview();
  }

  function closePreviewContextMenu() {
    previewContextMenu.classList.add('hidden');
  }

  function sourceSlipStartAtPointer(clientX, trackRect, grabOffset, sourceDuration, clipDuration) {
    const sourceStart = (clientX - trackRect.left - grabOffset) / trackRect.width * sourceDuration;
    return Math.min(Math.max(0, sourceStart), Math.max(0, sourceDuration - clipDuration));
  }

  function sourceStartForMarkedPoint(edge, currentTime, sourceDuration, clipDuration) {
    const sourceStart = edge === 'start' ? currentTime : currentTime - clipDuration;
    return Math.min(Math.max(0, sourceStart), Math.max(0, sourceDuration - clipDuration));
  }

  function updateClipSlipFromPointer(clientX, trackRect) {
    if (selectedCutIndex === null) return;
    const cut = state.edit[selectedCutIndex];
    const video = cut && getVideo(cut.sourceId);
    if (!cut || !video?.duration) return;
    const sourceStart = sourceSlipStartAtPointer(
      clientX, trackRect, sourceSlipDrag.offset, video.duration, cut.end - cut.start
    );
    updateClipSlipView(cut, video, sourceStart);
  }

  function updateClipSlipView(cut, video, sourceStart = cut.sourceStart, seekPreview = true) {
    const clipDuration = cut.end - cut.start;
    const maximumStart = Math.max(0, video.duration - clipDuration);
    cut.sourceStart = Math.min(Math.max(0, sourceStart), maximumStart);
    clipSlipWindow.style.left = `${cut.sourceStart / video.duration * 100}%`;
    clipSlipWindow.style.width = `${Math.min(100, clipDuration / video.duration * 100)}%`;
    clipSlipTrack.setAttribute('aria-valuemin', '0');
    clipSlipTrack.setAttribute('aria-valuemax', String(maximumStart));
    clipSlipTrack.setAttribute('aria-valuenow', String(cut.sourceStart));
    clipSlipTrack.setAttribute('aria-valuetext', `${formatSourceTime(cut.sourceStart, true)} to ${formatSourceTime(cut.sourceStart + clipDuration, true)}`);
    $('clipSlipRange').textContent = `Source: ${formatSourceTime(cut.sourceStart, true)} – ${formatSourceTime(cut.sourceStart + clipDuration, true)}`;
    if (seekPreview && clipSlipPreview.readyState >= 1 && Math.abs(clipSlipPreview.currentTime - cut.sourceStart) > 0.04) {
      clipSlipPreview.pause();
      clipSlipPreview.currentTime = cut.sourceStart;
    }
    const timelineClip = $('videoTrack').querySelector(`[data-cut-index="${selectedCutIndex}"]`);
    if (timelineClip) {
      timelineClip.title = `${formatTime(cut.start, true)}-${formatTime(cut.end, true)} · ${video.file.name} at ${formatSourceTime(cut.sourceStart, true)}`;
    }
  }

  function updateClipSlipPlayerTime() {
    const playerTime = clipSlipPreview.currentTime;
    $('clipSlipPlayerTime').textContent = `Player: ${Number.isFinite(playerTime) ? formatSourceTime(playerTime, true) : '00:00.0'}`;
    const cut = selectedCutIndex === null ? null : state.edit[selectedCutIndex];
    const video = cut && getVideo(cut.sourceId);
    const valid = Boolean(!clipSlipOverlay.classList.contains('hidden') && clipSlipPreview.readyState >= 1
      && cut && video?.duration && video.duration >= cut.end - cut.start);
    const maximumStart = valid ? video.duration - (cut.end - cut.start) : 0;
    $('clipSlipSetStart').disabled = !valid || playerTime > maximumStart + 0.001;
    $('clipSlipSetEnd').disabled = !valid || playerTime + 0.001 < cut.end - cut.start;
  }

  function setClipSlipPoint(edge) {
    const cut = selectedCutIndex === null ? null : state.edit[selectedCutIndex];
    const video = cut && getVideo(cut.sourceId);
    if (!cut || !video?.duration || clipSlipPreview.readyState < 1) return;
    const playerTime = clipSlipPreview.currentTime;
    const clipDuration = cut.end - cut.start;
    clipSlipPreview.pause();
    const sourceStart = sourceStartForMarkedPoint(edge, playerTime, video.duration, clipDuration);
    updateClipSlipView(cut, video, sourceStart, false);
    updateClipSlipPlayerTime();
    persistSession();
  }

  function handleClipSlipTrackKeydown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || selectedCutIndex === null) return;
    const cut = state.edit[selectedCutIndex];
    const video = cut && getVideo(cut.sourceId);
    if (!cut || !video?.duration) return;
    event.preventDefault();
    const step = event.shiftKey ? 1 : 0.1;
    const nextStart = event.key === 'Home' ? 0
      : event.key === 'End' ? video.duration - (cut.end - cut.start)
        : cut.sourceStart + (event.key === 'ArrowLeft' ? -step : step);
    updateClipSlipView(cut, video, nextStart);
    persistSession();
  }

  function openClipSlipEditor() {
    const cut = selectedCutIndex === null ? null : state.edit[selectedCutIndex];
    const video = cut && getVideo(cut.sourceId);
    if (!cut || !video) {
      showNotice('generateNotice', 'Select a timeline clip before pressing F.', 'warning');
      return;
    }
    if (!video.duration || !video.url) {
      showNotice('generateNotice', 'Wait for the selected source video to finish loading before editing its segment.', 'warning');
      return;
    }
    musicPlayer.pause();
    pausePreviewPlayers();
    $('clipSlipSourceName').textContent = video.file.name;
    $('clipSlipTimelineRange').textContent = `Timeline clip: ${formatTime(cut.start, true)} – ${formatTime(cut.end, true)} · ${(cut.end - cut.start).toFixed(2)} s`;
    $('clipSlipRuler').replaceChildren(...[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
      const mark = document.createElement('span');
      mark.textContent = formatSourceTime(video.duration * fraction, true);
      return mark;
    }));
    const cutIndex = selectedCutIndex;
    const sourceUrl = video.url;
    clipSlipOverlay.classList.remove('hidden');
    clipSlipPreview.pause();
    clipSlipPreview.addEventListener('loadedmetadata', () => {
      if (selectedCutIndex !== cutIndex || clipSlipPreview.getAttribute('src') !== sourceUrl
        || clipSlipOverlay.classList.contains('hidden')) return;
      clipSlipPreview.currentTime = cut.sourceStart;
      updateClipSlipView(cut, video);
      updateClipSlipPlayerTime();
    }, { once: true });
    clipSlipPreview.src = video.url;
    if (clipSlipPreview.readyState >= 1) {
      clipSlipPreview.currentTime = cut.sourceStart;
      updateClipSlipView(cut, video);
      updateClipSlipPlayerTime();
    } else updateClipSlipView(cut, video);
    $('closeClipSlip').focus();
  }

  function closeClipSlipEditor() {
    if (clipSlipOverlay.classList.contains('hidden')) return;
    sourceSlipDrag = null;
    clipSlipTrack.classList.remove('dragging');
    clipSlipOverlay.classList.add('hidden');
    clipSlipPreview.pause();
    clipSlipPreview.removeAttribute('src');
    clipSlipPreview.load();
    syncPreview(true);
    persistSession();
    $('videoTrack').querySelector(`[data-cut-index="${selectedCutIndex}"]`)?.focus({ preventScroll: true });
  }

  function clearSelectedClip() {
    if (!clipSlipOverlay.classList.contains('hidden')) closeClipSlipEditor();
    selectedCutIndex = null;
    sourceSlipDrag = null;
  }

  function handleClipSlipShortcut(event) {
    if (event.key === 'Escape' && !clipSlipOverlay.classList.contains('hidden')) {
      event.preventDefault();
      closeClipSlipEditor();
      return;
    }
    if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey
      || event.key.toLowerCase() !== 'f'
      || event.target?.closest?.('input, select, textarea, [contenteditable]:not([contenteditable="false"])')
      || state.workspace !== 'editing' || activeExport
      || !clipSlipOverlay.classList.contains('hidden')) return;
    event.preventDefault();
    openClipSlipEditor();
  }

  function cancelPreviewRendering() {
    if (previewFrameCallbackId !== null && typeof activePreviewVideo.cancelVideoFrameCallback === 'function') {
      activePreviewVideo.cancelVideoFrameCallback(previewFrameCallbackId);
    }
    if (previewAnimationFrameId !== null) cancelAnimationFrame(previewAnimationFrameId);
    previewFrameCallbackId = null;
    previewAnimationFrameId = null;
  }

  function schedulePreviewRendering() {
    if (activePreviewVideo.paused || activePreviewVideo.ended) return;
    if (typeof activePreviewVideo.requestVideoFrameCallback === 'function') {
      previewFrameCallbackId = activePreviewVideo.requestVideoFrameCallback(() => {
        previewFrameCallbackId = null;
        drawPreviewFrame();
        schedulePreviewRendering();
      });
      return;
    }
    previewAnimationFrameId = requestAnimationFrame(() => {
      previewAnimationFrameId = null;
      drawPreviewFrame();
      schedulePreviewRendering();
    });
  }

  function syncPreview(force = false) {
    if (sourceAnalysisMode()) {
      updateAnalysisPlayhead();
      return;
    }
    const time = musicPlayer.currentTime || 0;
    $('timeDisplay').textContent = formatTime(time, true);
    $('monitorTime').textContent = `TIMECODE ${formatTime(time, true)}`;
    const total = duration();
    $('playhead').style.left = `${total ? Math.min(100, time / total * 100) : 0}%`;
    if (state.workspace === 'analysis' || state.workspace === 'color') {
      pausePreviewPlayers();
      previewCanvas.classList.add('hidden');
      $('monitorEmpty').classList.remove('hidden');
      $('monitorSource').textContent = state.workspace === 'color' ? 'No source selected' : state.music?.file.name || 'No music selected';
      renderPlayhead();
      return;
    }
    const cut = state.edit.find((item) => time >= item.start && time < item.end);
    if (cut) {
      const video = getVideo(cut.sourceId);
      if (video) {
        if (force || state.activeCut !== cut || activePreviewVideo.src !== video.url) {
          state.activeCut = cut;
          setPreviewSource(video, cut.sourceStart + time - cut.start);
        }
        if (state.playing && activePreviewVideo.paused) activePreviewVideo.play().catch((error) => {
          musicPlayer.pause();
          showNotice('generateNotice', `Preview playback failed: ${error.message}`, 'warning');
        });
        $('monitorSource').textContent = `${video.file.name} · ${formatSourceTime(cut.sourceStart + time - cut.start, true)}`;
      }
    } else if (state.edit.length) {
      activePreviewVideo.pause();
      $('monitorSource').textContent = 'Outside assigned ranges';
    }
    renderPlayhead();
  }

  function setPreviewSource(video, offset) {
    previewSourceId = video.id;
    colorPreviewError = null;
    const player = getPreviewPlayer(video);
    if (player !== activePreviewVideo) {
      cancelPreviewRendering();
      activePreviewVideo.pause();
      activePreviewVideo = player;
      updatePreviewPlayerAudio();
      lastDroppedFrameCount = null;
    }
    previewCanvas.classList.remove('hidden');
    $('monitorEmpty').classList.add('hidden');
    if (player.src !== video.url) {
      cancelPreviewRendering();
      player.src = video.url;
      player.addEventListener('loadedmetadata', () => {
        if (activePreviewVideo !== player) return;
        const target = sourceAnalysisMode() && state.analysisTarget === video.id ? state.analysisTime : offset;
        player.currentTime = Math.max(0, Math.min(target, video.duration ? video.duration - 0.05 : 0));
        drawPreviewFrame();
        if (state.playing) player.play().catch((error) => showNotice('generateNotice', `Preview playback failed: ${error.message}`));
      }, { once: true });
    } else if (video.duration) {
      if (Math.abs(player.currentTime - offset) > 0.08 && player.readyState >= 2) {
        player.currentTime = Math.max(0, Math.min(offset, video.duration - 0.05));
      }
      drawPreviewFrame();
    }
    $('monitorSource').textContent = video.file.name;
  }

  function handlePlaybackShortcut(event) {
    if ((event.code !== 'Space' && event.key !== ' ') || event.defaultPrevented
      || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
      || event.target.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return;
    event.preventDefault();
    if (!event.repeat && !activeExport) togglePlayback();
  }

  function togglePlayback() {
    audioScrubber.stop();
    resumeAfterScrub = false;
    if (sourceAnalysisMode()) {
      if (activePreviewVideo.paused) {
        if (activePreviewVideo.ended) seekAnalysisSource(0);
        activePreviewVideo.play().catch((error) => showNotice('analysisEditNotice', `Source playback failed: ${error.message}`, 'warning'));
      } else activePreviewVideo.pause();
      return;
    }
    if (state.workspace === 'color' || !state.music) return;
    if (state.workspace === 'analysis') {
      if (musicPlayer.paused) {
        if (musicPlayer.ended) musicPlayer.currentTime = 0;
        musicPlayer.play().catch((error) => showNotice('analysisEditNotice', `Music playback failed: ${error.message}`, 'warning'));
      } else musicPlayer.pause();
      return;
    }
    if (musicPlayer.paused) {
      if (duration() && musicPlayer.currentTime >= duration()) musicPlayer.currentTime = 0;
      preparePlayback();
    } else musicPlayer.pause();
  }

  function updateAudioToggles() {
    audioScrubber.stop();
    clipSlipPreview.muted = !state.clipAudioEnabled;
    clipSlipPreview.volume = 0.65;
    $('scrubAudioToggle').textContent = `Scrub audio: ${state.scrubAudioEnabled ? 'On' : 'Off'}`;
    $('scrubAudioToggle').setAttribute('aria-pressed', String(state.scrubAudioEnabled));
    musicPlayer.volume = state.musicVolume;
    $('musicVolume').value = String(Math.round(state.musicVolume * 100));
    $('musicVolumeValue').textContent = `${Math.round(state.musicVolume * 100)}%`;
    $('musicVolume').setAttribute('aria-valuetext', `${Math.round(state.musicVolume * 100)} percent`);
    musicPlayer.muted = !state.musicAudioEnabled;
    updatePreviewPlayerAudio();
    $('musicAudioToggle').textContent = state.musicAudioEnabled ? 'On' : 'Off';
    $('musicAudioToggle').setAttribute('aria-pressed', String(state.musicAudioEnabled));
    $('musicAudioToggle').setAttribute('aria-label', state.musicAudioEnabled ? 'Mute music track' : 'Unmute music track');
    $('clipAudioToggle').textContent = state.clipAudioEnabled ? 'On' : 'Off';
    $('clipAudioToggle').setAttribute('aria-pressed', String(state.clipAudioEnabled));
    $('clipAudioToggle').setAttribute('aria-label', state.clipAudioEnabled ? 'Mute source clip audio' : 'Unmute source clip audio');
    $('analysisSourceAudioToggle').textContent = state.clipAudioEnabled ? 'On' : 'Off';
    $('analysisSourceAudioToggle').setAttribute('aria-pressed', String(state.clipAudioEnabled));
    $('analysisSourceAudioToggle').setAttribute('aria-label', state.clipAudioEnabled ? 'Mute source audio' : 'Unmute source audio');
  }

  function updatePlayButton() {
    const playing = sourceAnalysisMode() ? !activePreviewVideo.paused : state.playing;
    $('playButton').textContent = playing ? 'Ⅱ' : '▶';
    $('playButton').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  function seekFromWaveform(event) {
    if (!duration()) return;
    const rect = $('waveWrap').getBoundingClientRect();
    musicPlayer.currentTime = Math.max(0, Math.min(duration(), (event.clientX - rect.left) / rect.width * duration()));
    syncPreview(true);
    persistSession();
  }

  function seekEditPoint(direction) {
    if (sourceAnalysisMode()) {
      const video = getVideo(state.analysisTarget);
      const points = state.workspace === 'color' ? [0, video.duration]
        : currentFootageRanges().flatMap((range) => [range.start, range.end]).sort((left, right) => left - right);
      const target = direction < 0 ? points.filter((time) => time < state.analysisTime - 0.05).pop() ?? 0
        : points.find((time) => time > state.analysisTime + 0.05) ?? video.duration;
      seekAnalysisSource(target);
      persistSession();
      return;
    }
    if (!duration()) return;
    const points = state.edit.length ? state.edit.map((cut) => cut.start) : state.beatTimes;
    const currentTime = musicPlayer.currentTime || 0;
    const target = direction < 0
      ? [...points].filter((point) => point < currentTime - 0.05).pop() ?? 0
      : points.find((point) => point > currentTime + 0.05) ?? duration();
    musicPlayer.currentTime = target;
    syncPreview(true);
    persistSession();
  }

  function attachPlayheadDrag(container) {
    container.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || activeExport || !event.target.closest('.playhead')) return;
      event.preventDefault();
      beginAudioScrub();
      playheadDrag = { pointerId: event.pointerId, container };
      container.setPointerCapture(event.pointerId);
      seekToTimelineX(event.clientX, container);
    });
    container.addEventListener('pointermove', (event) => {
      if (playheadDrag?.pointerId === event.pointerId && playheadDrag.container === container) seekToTimelineX(event.clientX, container);
    });
    container.addEventListener('pointerup', (event) => {
      if (playheadDrag?.pointerId !== event.pointerId || playheadDrag.container !== container) return;
      playheadDrag = null;
      endAudioScrub();
      suppressWaveClick = container === waveWrap;
      persistSession();
    });
    for (const name of ['pointercancel', 'lostpointercapture']) container.addEventListener(name, (event) => {
      if (playheadDrag?.pointerId !== event.pointerId || playheadDrag.container !== container) return;
      playheadDrag = null;
      endAudioScrub();
    });
  }

  function seekToTimelineX(clientX, container) {
    if (!duration()) return;
    const rect = container.getBoundingClientRect();
    const headerWidth = container.id === 'musicTimelineContent' ? trackHeaderWidth : 0;
    const timeWidth = rect.width - headerWidth;
    if (timeWidth <= 0) return;
    const progress = Math.max(0, Math.min(1, (clientX - rect.left - headerWidth) / timeWidth));
    musicPlayer.currentTime = progress * duration();
    syncPreview(true);
    previewScrubAudio();
  }

  function beginAudioScrub() {
    audioScrubber.stop();
    resumeAfterScrub = false;
    if (!state.scrubAudioEnabled || activeExport) return;
    resumeAfterScrub = sourceAnalysisMode() ? !activePreviewVideo.paused : !musicPlayer.paused;
    musicPlayer.pause();
    pausePreviewPlayers();
  }

  function endAudioScrub(resume = true) {
    audioScrubber.stop();
    const wasPlaying = resumeAfterScrub;
    resumeAfterScrub = false;
    if (resume && wasPlaying && !activeExport) togglePlayback();
  }

  function previewScrubAudio() {
    if (!state.scrubAudioEnabled || activeExport) return;
    const tracks = [];
    if (sourceAnalysisMode()) {
      const video = getVideo(state.analysisTarget);
      if (video && state.clipAudioEnabled) tracks.push({
        key: 'source', url: video.url, time: state.analysisTime, volume: activePreviewVideo.volume
      });
    } else {
      const time = musicPlayer.currentTime;
      if (state.music && state.musicAudioEnabled) tracks.push({
        key: 'music', url: state.music.url, time, volume: state.musicVolume
      });
      const cut = state.workspace === 'editing' && state.edit.find((cut) => time >= cut.start && time < cut.end);
      const video = cut && getVideo(cut.sourceId);
      if (video && state.clipAudioEnabled) tracks.push({
        key: 'source', url: video.url, time: cut.sourceStart + time - cut.start,
        end: cut.sourceStart + cut.end - cut.start, volume: activePreviewVideo.volume
      });
    }
    audioScrubber.preview(tracks);
  }

  function updateDuration() {
    const total = duration();
    $('musicDuration').textContent = state.music ? (total ? formatTime(total) : 'Loading') : 'No track';
    $('timelineDuration').textContent = formatTime(duration());
    renderRuler();
  }

  function renderRuler() {
    renderTimeRuler($('timeRuler'), duration(), formatTime);
  }

  function renderTimeRuler(element, total, formatter) {
    if (!total) {
      element.innerHTML = '';
      return;
    }
    const zoom = element.id === 'sourceAnalysisRuler' ? timelineZoom.footage : timelineZoom.music;
    const viewport = $(element.id === 'sourceAnalysisRuler' ? 'sourceTimelineViewport' : 'musicTimelineViewport');
    const visibleTicks = Math.max(2, Math.floor((viewport.clientWidth - trackHeaderWidth) / 80));
    const rawStep = total / (visibleTicks * zoom);
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const normalized = rawStep / magnitude;
    const step = magnitude * (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10);
    const ticks = [];
    for (let time = 0; time < total; time += step) ticks.push(time);
    if (total - ticks[ticks.length - 1] > step * 0.35) ticks.push(total);
    const precision = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
    const scale = 10 ** precision;
    element.innerHTML = ticks.map((time, index) => {
      const rounded = Math.round(time * scale);
      const label = precision ? `${formatter(Math.floor(rounded / scale))}.${String(rounded % scale).padStart(precision, '0')}` : formatter(time);
      return `<span class="ruler-mark ${index === ticks.length - 1 ? 'edge' : ''}" style="left:${time / total * 100}%">${label}</span>`;
    }).join('');
  }

  function renderVideoTrack() {
    const lane = $('videoTrack');
    if (!lane) return;
    const total = duration();
    if (selectedCutIndex !== null && !state.edit[selectedCutIndex]) selectedCutIndex = null;
    const colors = ['#c9ef74', '#83b9d1', '#ff806b', '#d8a56a', '#bcb7ea'];
    const clips = total ? state.edit.map((cut, index) => {
      const video = getVideo(cut.sourceId);
      if (!video) return '';
      const left = cut.start / total * 100;
      const width = (cut.end - cut.start) / total * 100;
      const color = colors[state.videos.indexOf(video) % colors.length];
      const label = width >= 8 ? escapeHtml(video.file.name) : '';
      const title = `${formatTime(cut.start, true)}-${formatTime(cut.end, true)} · ${video.file.name} at ${formatSourceTime(cut.sourceStart, true)}`;
      const selected = selectedCutIndex === index;
      return `<button type="button" class="video-clip ${selected ? 'selected' : ''}" data-cut-index="${index}" aria-pressed="${selected}" style="left:${left}%;width:${width}%;--clip-color:${color}" title="${escapeHtml(title)}">${label}</button>`;
    }).join('') : '';
    lane.innerHTML = clips || '<div class="video-track-empty">Automatic clips appear here when music and footage are loaded</div>';
    renderPlayhead();
  }

  function drawWaveform() {
    updateTimelineWidths();
    renderMusicAccentEditor();
    const viewport = $('musicTimelineViewport');
    const rect = $('waveWrap').getBoundingClientRect();
    const width = Math.max(0, viewport.clientWidth - trackHeaderWidth);
    const offset = viewport.scrollLeft;
    canvas.style.width = `${width}px`;
    canvas.style.left = `${offset}px`;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const height = rect.height;
    context.clearRect(0, 0, width, height);
    if (!state.audioBuffer) {
      renderPlayhead();
      return;
    }
    const data = state.audioBuffer.getChannelData(0);
    const middle = height / 2;
    context.fillStyle = '#9ab84d';
    for (let x = 0; x < width; x++) {
      const start = Math.floor((offset + x) / rect.width * data.length);
      const end = Math.min(data.length, Math.ceil((offset + x + 1) / rect.width * data.length));
      let peak = 0;
      for (let index = start; index < end; index++) peak = Math.max(peak, Math.abs(data[index]));
      const barHeight = Math.max(1, peak * (height * 0.82));
      context.fillRect(x, middle - barHeight / 2, 1, barHeight);
    }
    const total = duration();
    for (const time of state.workspace === 'analysis' ? [] : state.beatTimes) {
      const x = time / total * rect.width - offset;
      context.fillStyle = '#ff806b';
      context.fillRect(x, 0, 1, height);
    }
    renderPlayhead();
  }

  function renderPlayhead() {
    const total = duration();
    const progress = total ? Math.min(1, musicPlayer.currentTime / total) : 0;
    $('playhead').style.left = `${progress * 100}%`;
    const content = $('musicTimelineContent');
    $('timelinePlayhead').style.left = `${trackHeaderWidth + Math.max(0, content.clientWidth - trackHeaderWidth) * progress}px`;
  }

  function exportEdit() {
    if (!state.edit.length) return;
    const rows = [['music_start_seconds', 'music_end_seconds', 'duration_seconds', 'source', 'source_in_seconds', 'source_out_seconds']];
    for (const cut of state.edit) {
      const source = getVideo(cut.sourceId);
      rows.push([cut.start.toFixed(3), cut.end.toFixed(3), (cut.end - cut.start).toFixed(3), source?.file.name || '', cut.sourceStart.toFixed(3), (cut.sourceStart + cut.end - cut.start).toFixed(3)]);
    }
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = 'autoedit-first-pass.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function waitForExportMedia(player, eventName, signal) {
    const readyState = eventName === 'loadedmetadata' ? 1 : eventName === 'loadeddata' ? 2 : 0;
    if (signal?.aborted) return Promise.reject(new Error('Export canceled.'));
    if (readyState && player.readyState >= readyState) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error(`Timed out waiting for ${eventName} from ${player.currentSrc || 'media'} after 30 seconds.`)), 30000);
      const onReady = () => finish();
      const onError = () => finish(getExportMediaError(player));
      const onAbort = () => finish(new Error('Export canceled.'));
      function finish(error) {
        clearTimeout(timeout);
        player.removeEventListener(eventName, onReady);
        player.removeEventListener('error', onError);
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve();
      }
      player.addEventListener(eventName, onReady, { once: true });
      player.addEventListener('error', onError, { once: true });
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  function getExportMediaError(player) {
    const errorCode = player.error?.code;
    const errorReasons = {
      1: 'playback was aborted',
      2: 'the media file could not be read',
      3: 'the media could not be decoded; the file may be corrupt or use an unsupported codec',
      4: 'the file format or codec is not supported'
    };
    const detail = player.error?.message || errorReasons[errorCode] || 'unknown media decode error';
    return new Error(`Could not load ${player.currentSrc || 'media'}${errorCode ? ` (media error ${errorCode})` : ''}: ${detail}.`);
  }

  function waitForExportSeek(player, targetTime, sourceName, signal) {
    if (signal?.aborted) return Promise.reject(new Error('Export canceled.'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const interval = setInterval(checkSeek, 100);
      const timeout = setTimeout(() => {
        const seekableRanges = [];
        for (let index = 0; index < player.seekable.length; index++) {
          seekableRanges.push(`${formatSourceTime(player.seekable.start(index), true)}-${formatSourceTime(player.seekable.end(index), true)}`);
        }
        const currentTime = Number.isFinite(player.currentTime) ? formatSourceTime(player.currentTime, true) : 'unknown';
        const ranges = seekableRanges.length ? seekableRanges.join(', ') : 'none reported';
        finish(new Error(`Timed out seeking source video "${sourceName}" to ${formatSourceTime(targetTime, true)} (current ${currentTime}; seeking=${player.seeking}; readyState=${player.readyState}; networkState=${player.networkState}; seekable ranges=${ranges}). Check that the source drive is connected. If it is on a network or removable drive, copy the video to a local drive or re-encode it with a seekable index.`));
      }, 90000);
      const onSeeked = () => checkSeek();
      const onReady = () => checkSeek();
      const onError = () => finish(getExportMediaError(player));
      const onAbort = () => finish(new Error('Export canceled.'));

      function finish(error) {
        if (settled) return;
        settled = true;
        clearInterval(interval);
        clearTimeout(timeout);
        player.removeEventListener('seeked', onSeeked);
        player.removeEventListener('loadeddata', onReady);
        player.removeEventListener('canplay', onReady);
        player.removeEventListener('error', onError);
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve();
      }

      function checkSeek() {
        if (signal?.aborted) {
          finish(new Error('Export canceled.'));
        } else if (player.error) {
          finish(getExportMediaError(player));
        } else if (!player.seeking && player.readyState >= 2 && Math.abs(player.currentTime - targetTime) <= 0.25) {
          finish();
        }
      }

      player.addEventListener('seeked', onSeeked);
      player.addEventListener('loadeddata', onReady);
      player.addEventListener('canplay', onReady);
      player.addEventListener('error', onError);
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        player.currentTime = targetTime;
        checkSeek();
      } catch (error) {
        finish(error);
      }
    });
  }

  function describeExportError(error) {
    if (error == null) return 'No error details were provided by the encoder or file writer.';
    if (typeof error === 'string') return error;
    if (typeof error === 'object') {
      const name = typeof error.name === 'string' ? error.name : '';
      const message = typeof error.message === 'string' ? error.message : '';
      const code = typeof error.code === 'string' || typeof error.code === 'number' ? ` (${error.code})` : '';
      if (message) return `${name && name !== 'Error' ? `${name}: ` : ''}${message}${code}`;
      if (name) return `${name}${code}`;
    }
    return String(error);
  }

  async function exportVideo() {
    if (!state.music || !state.edit.length || activeExport) return;
    endAudioScrub(false);
    showNotice('generateNotice', '');
    if (!desktopApi?.beginVideoExport) {
      showNotice('generateNotice', 'Video export is available in the AutoEdit desktop app.');
      return;
    }

    let filePath;
    try {
      filePath = await desktopApi.beginVideoExport();
    } catch (error) {
      showNotice('generateNotice', `Could not start video export: ${describeExportError(error)}`, 'warning');
      return;
    }
    if (!filePath) return;

    const task = { cancelled: false, recorder: null, controller: new AbortController() };
    activeExport = task;
    $('musicVolume').disabled = true;
    renderFootageAnalysis();
    $('exportOverlay').classList.remove('hidden');
    $('exportMessage').textContent = 'Preparing music and source footage…';
    $('exportProgress').value = 0;
    $('cancelExportButton').disabled = false;
    let audioContext = null;
    let music = null;
    let exportPlayers = new Map();
    let recorderStopped = null;
    let recorderStarted = false;
    let outputStream = null;
    let animationFrame = null;
    let pendingFrame = null;
    let writeChain = Promise.resolve();
    let writeError = null;
    let finished = false;
    let exportPhase = 'preparing the export';

    const stopRecorder = () => {
      if (task.recorder && task.recorder.state !== 'inactive') task.recorder.stop();
    };
    const checkCancelled = () => {
      if (task.cancelled) throw new Error('Export canceled.');
    };

    try {
      exportPhase = 'checking the music and timeline';
      const exportDuration = duration();
      if (!Number.isFinite(exportDuration) || exportDuration <= 0) throw new Error('The music duration is not available.');
      const cuts = [...state.edit]
        .filter((cut) => Number.isFinite(cut.start) && Number.isFinite(cut.end) && cut.end > cut.start)
        .sort((left, right) => left.start - right.start);
      if (!cuts.length) throw new Error('There are no valid video clips to export.');

      const mediaRecorderTypes = [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4'
      ];
      const mimeType = mediaRecorderTypes.find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('This system cannot encode MP4 video.');

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = 1920;
      exportCanvas.height = 1080;
      const exportContext = exportCanvas.getContext('2d', { alpha: false });
      if (!exportContext) throw new Error('Could not create the video render surface.');
      exportContext.fillStyle = '#000';
      exportContext.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

      exportPhase = 'initializing audio and video capture';
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioDestination = audioContext.createMediaStreamDestination();

      exportPhase = 'loading the music track';
      music = new Audio(state.music.url);
      music.preload = 'auto';
      music.volume = 1;
      music.muted = false;
      await waitForExportMedia(music, 'loadedmetadata', task.controller.signal);
      checkCancelled();
      const musicSource = audioContext.createMediaElementSource(music);
      const musicGain = audioContext.createGain();
      musicGain.gain.value = state.musicAudioEnabled ? state.musicVolume : 0;
      musicSource.connect(musicGain).connect(audioDestination);

      const usedSourceIds = new Set(cuts.map((cut) => cut.sourceId));
      for (const sourceId of usedSourceIds) {
        checkCancelled();
        const video = getVideo(sourceId);
        if (!video) throw new Error('A timeline clip refers to a missing video source.');
        exportPhase = `loading source video "${video.file.name}"`;
        const player = document.createElement('video');
        player.preload = 'auto';
        player.playsInline = true;
        player.volume = 1;
        player.muted = false;
        exportPlayers.set(sourceId, { player, gain: null, video });
        const ready = waitForExportMedia(player, 'loadedmetadata', task.controller.signal);
        player.src = video.url;
        await ready;
        checkCancelled();
        const source = audioContext.createMediaElementSource(player);
        const gain = audioContext.createGain();
        gain.gain.value = 0;
        source.connect(gain).connect(audioDestination);
        exportPlayers.set(sourceId, { player, gain, video });
      }

      checkCancelled();
      const options = { mimeType, videoBitsPerSecond: 8000000, audioBitsPerSecond: 192000 };
      let recorder = null;
      let resolveRecorderStopped;
      let rejectRecorderStopped;
      recorderStopped = new Promise((resolve, reject) => {
        resolveRecorderStopped = resolve;
        rejectRecorderStopped = reject;
      });
      const startEncoder = () => {
        // Capture only after painting the first frame, not the initial black render surface.
        outputStream = exportCanvas.captureStream(30);
        for (const track of audioDestination.stream.getAudioTracks()) outputStream.addTrack(track);
        task.recorder = new MediaRecorder(outputStream, options);
        recorder = task.recorder;
        recorder.addEventListener('stop', resolveRecorderStopped, { once: true });
        recorder.addEventListener('error', (event) => {
          rejectRecorderStopped(new Error(`MP4 encoder error: ${describeExportError(event.error || new Error('The encoder supplied no error details.'))}`));
        }, { once: true });
        recorder.addEventListener('dataavailable', (event) => {
          if (!event.data.size) return;
          writeChain = writeChain.then(async () => {
            if (writeError) return;
            await desktopApi.writeVideoExport(new Uint8Array(await event.data.arrayBuffer()));
          }).catch((error) => {
            writeError = new Error(`Could not write encoded video data to "${filePath}": ${describeExportError(error)}`);
            stopRecorder();
          });
        });
        recorder.start(1000);
        recorderStarted = true;
      };

      await audioContext.resume();
      checkCancelled();
      music.currentTime = 0;

      let currentCut = null;
      let cutIndex = 0;
      let lastProgressSecond = -1;
      let activePlayer = null;
      let activePlayerReady = false;
      const activateCut = async (cut, time) => {
        for (const { player, gain } of exportPlayers.values()) {
          gain.gain.setValueAtTime(0, audioContext.currentTime);
          player.pause();
        }
        if (!cut) return;
        const entry = exportPlayers.get(cut.sourceId);
        const player = entry.player;
        const targetTime = Math.max(0, Math.min(
          cut.sourceStart + Math.max(0, time - cut.start),
          entry.video.duration ? entry.video.duration - 0.04 : cut.sourceStart
        ));
        // Seek as soon as metadata is available; an initial frame may never load while paused.
        await waitForExportSeek(player, targetTime, entry.video.file.name, task.controller.signal);
        checkCancelled();
        await player.play();
        checkCancelled();
        entry.gain.gain.setValueAtTime(state.clipAudioEnabled ? 1 : 0, audioContext.currentTime);
        activePlayerReady = true;
      };

      const renderFrame = async () => {
        checkCancelled();
        if (writeError) throw writeError;
        if (music.ended || music.currentTime >= exportDuration) {
          stopRecorder();
          return;
        }
        const time = music.currentTime;
        while (cutIndex < cuts.length && cuts[cutIndex].end <= time) cutIndex++;
        const nextCut = cuts[cutIndex] && cuts[cutIndex].start <= time ? cuts[cutIndex] : null;
        if (nextCut !== currentCut) {
          currentCut = nextCut;
          music.pause();
          if (recorder?.state === 'recording') recorder.pause();
          activePlayer = nextCut ? exportPlayers.get(nextCut.sourceId).player : null;
          activePlayerReady = false;
          lastProgressSecond = -1;
          $('exportMessage').textContent = 'Preparing next source clip…';
          try {
            await activateCut(nextCut, time);
          } catch (error) {
            const sourceName = getVideo(nextCut?.sourceId)?.file.name || nextCut?.sourceId || 'timeline gap';
            throw new Error(`Could not play source video "${sourceName}" at ${formatSourceTime(nextCut?.sourceStart || 0, true)}: ${describeExportError(error)}`);
          }
        }
        checkCancelled();
        if (writeError) throw writeError;

        try {
          exportContext.fillStyle = '#000';
          exportContext.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
          if (activePlayerReady && activePlayer?.readyState >= 2 && activePlayer.videoWidth && activePlayer.videoHeight) {
            const scale = Math.min(exportCanvas.width / activePlayer.videoWidth, exportCanvas.height / activePlayer.videoHeight);
            const width = activePlayer.videoWidth * scale;
            const height = activePlayer.videoHeight * scale;
            colors.render(exportContext, activePlayer, getVideo(currentCut.sourceId)?.color, (exportCanvas.width - width) / 2, (exportCanvas.height - height) / 2, width, height);
          }
          if (!recorderStarted) {
            startEncoder();
          } else if (recorder.state === 'paused') {
            recorder.resume();
          }
          if (music.paused) await music.play();
          checkCancelled();
          $('exportProgress').value = Math.min(1, time / exportDuration);
          const progressSecond = Math.floor(time);
          if (progressSecond !== lastProgressSecond) {
            $('exportMessage').textContent = `Rendering ${formatTime(time, true)} of ${formatTime(exportDuration, true)}…`;
            lastProgressSecond = progressSecond;
          }
        } catch (error) {
          throw new Error(`Could not render a video frame: ${describeExportError(error)}`);
        }
        scheduleFrame();
      };
      let rejectRendering;
      const renderingFailed = new Promise((_resolve, reject) => { rejectRendering = reject; });
      const scheduleFrame = () => {
        animationFrame = requestAnimationFrame(() => {
          pendingFrame = renderFrame();
          pendingFrame.catch(rejectRendering);
        });
      };
      exportPhase = 'rendering the video';
      scheduleFrame();
      await Promise.race([recorderStopped, renderingFailed]);
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      await writeChain;
      if (writeError) throw writeError;
      checkCancelled();
      $('exportProgress').value = 1;
      $('exportMessage').textContent = 'Saving MP4 file…';
      $('cancelExportButton').disabled = true;
      exportPhase = 'saving the MP4 file';
      await desktopApi.finishVideoExport();
      finished = true;
      $('statusText').textContent = 'Video export complete';
      showNotice('generateNotice', `Video saved to ${filePath}`);
    } catch (error) {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      stopRecorder();
      if (recorderStarted && recorderStopped) await recorderStopped.catch(() => {});
      await writeChain;
      if (task.cancelled) {
        showNotice('generateNotice', 'Video export canceled.');
      } else {
        const message = `Video export failed while ${exportPhase}: ${describeExportError(error)}`;
        console.error(message, error);
        $('statusText').textContent = 'Video export failed';
        showNotice('generateNotice', message, 'warning');
      }
    } finally {
      task.controller.abort();
      if (pendingFrame) await pendingFrame.catch(() => {});
      if (music) {
        music.pause();
        music.removeAttribute('src');
        music.load();
      }
      for (const { player } of exportPlayers.values()) {
        player.pause();
        player.removeAttribute('src');
        player.load();
      }
      if (audioContext && audioContext.state !== 'closed') {
        try { await audioContext.close(); } catch (error) { console.warn('Could not close the export audio context.', error); }
      }
      if (outputStream) outputStream.getTracks().forEach((track) => track.stop());
      if (!finished) {
        try { await desktopApi.cancelVideoExport(); } catch (error) {
          const previousNotice = $('generateNotice').textContent;
          const cleanupWarning = `Cleanup of the incomplete MP4 also failed: ${describeExportError(error)}`;
          showNotice('generateNotice', `${previousNotice} ${cleanupWarning}`.trim(), 'warning');
          console.error(cleanupWarning, error);
        }
      }
      $('exportOverlay').classList.add('hidden');
      $('cancelExportButton').disabled = false;
      activeExport = null;
      $('musicVolume').disabled = false;
      renderFootageAnalysis();
    }
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  updatePlayButton();
  updateDuration();
  drawWaveform();
  renderVideoTrack();
  renderSceneWeights();
  previewVideo.volume = 0.65;
  updateAudioToggles();
  setupPanelResizers();
  setWorkspace('editing', false);
  setExportAvailability(false);
  restoreSession();
  if (!desktopApi) $('statusText').textContent = 'Browser preview only. Session auto-save requires the AutoEdit desktop app.';
  window.addEventListener('beforeunload', () => {
    audioScrubber.dispose();
    persistSession(true);
    state.objectUrls.forEach((url) => URL.revokeObjectURL(url));
  });
})();
