# AutoEdit Features

This document describes the current prototype. “Available” means implemented in the desktop app; it does not imply production-grade reliability across all media formats.

## Available

### Media and Projects

- Import one local music track and multiple local video sources.
- Save and open versioned `.autoedit` project files.
- Automatically restore the last desktop session on startup.
- Keep references to original media paths instead of copying long source files into the project.

### Music Analysis

- Estimate tempo and beat phase from audio-energy onsets.
- Suggest cut points at every beat, every two beats, or every bar.
- Keep the strongest detected accent in each selected beat group.
- Adjust accent sensitivity independently from cut cadence.
- Measure relative music energy in two-second windows for footage selection; this is not musical section detection.
- Add cut accents in Analysis by Shift-clicking the waveform or using **Add accent at playhead**. Select a marker in either Analysis or Editing, then remove it with the button or Delete.
- Manual additions always create cuts, independent of cadence; removals suppress detected accents. Both survive cadence changes and re-analysis. **Reset accent edits** restores detector results.
- Drag a cue marker horizontally in music Analysis to move it. The original accent is suppressed and the new time becomes a manual accent; assembly updates on release. Escape cancels a drag.
- Removing every accent leaves one uncut music interval instead of introducing fallback cuts.

### Workspaces and Analysis Corrections

- Switch between **Analysis** and **Editing** in the same window, sharing media, settings and the generated edit. Switching pauses playback without rebuilding the edit.
- In Analysis, choose Music or a video source from the target selector. Double-clicking the music asset also opens its Analysis workspace.
- Review source footage independently of the music timeline, with speech, clapping and motion lanes. Source playback does not play or seek the music.
- Select a range to resize its start/end in seconds, or add/remove ranges. Motion ranges also have a 0-100% intensity control.
- The first manual edit replaces only that range type for the selected source; unmarked regions score zero for that type. Ranges of the same type cannot overlap or exceed source duration; different types may overlap.
- Reset each range type independently to its detected results. Detector output remains unchanged, with manual corrections saved separately.
- Save workspace, target, source cursor and corrections in projects and sessions. Changed media invalidates its footage analysis and corrections.
- In Editing, adjust assembly weights, minimum consecutive clips, analysis-guided selection and audio mix, then preview/export.
- Use **Ctrl + mouse wheel up/down** over a timeline to zoom in/out in either workspace, including source-analysis lanes. Zoom stays anchored under the pointer; use the resizable custom navigator below each timeline to navigate. Music and footage zoom are independent, from full-duration fit to 64x.
- A zoom/scroll navigator below each timeline represents the full duration: drag its middle to pan, or either end to change the visible range while keeping the opposite end fixed. **Fit** restores the full timeline. Arrow keys adjust the focused handle/window, Shift increases the step, and Home/End jump to its limits.
- **Space** toggles play/pause in Editing, music Analysis or source Analysis. It does not intercept editable fields or modified shortcuts, repeat while held, or start preview during export.
- **Scrub audio: On/Off** beside the playback controls previews short audio snippets while dragging the playhead in any workspace. Editing mixes music and the active clip at its source offset; source workspaces preview only that source. It respects track mute and music volume, stops on release, and resumes playback if it was running before the drag. The switch defaults off and is saved with the project/session.

### Source Color Correction

- Workspaces are listed **Analysis**, **Editing**, then **Color**.
- Choose a source in Color and adjust temperature, tint, exposure, contrast, highlights, shadows, whites, blacks and saturation using sliders or numeric values.
- Corrections apply to the whole source, including every assembled clip that uses it; there are no per-clip grades.
- Preview the source independently with Space, source scrubbing, Ctrl+wheel zoom and the range navigator. The same grade applies in Editing previews and MP4 exports.
- Save independent source grades with projects and sessions; **Reset source color** restores the original appearance without changing other sources.
- Original media and footage-analysis inputs remain unchanged. GPU/WebGL rendering is required for non-neutral grades; rendering failures are reported, not replaced by ungraded output.
- These are Lumetri-style basic controls with AutoEdit's own approximate tonal/color processing, not Adobe's exact color engine. Creative looks, LUTs, wheels, curves, HSL secondary and vignette are not included.

### Footage Analysis

- Analyze local sources with an explicit **Analyze all footage** action in Analysis, progress display, and cancellation.
- Measure overall image motion from reduced-resolution grayscale frames at 4 fps, summarized in two-second ranges.
- Detect speech and clapping/applause in five-second audio windows using a local AudioSet model; these are separate scores, not guesses based on loudness.
- Review and edit all ranges for the selected source in the Analysis workspace.
- Save analysis with the project and last session. Reuse results when source size and modification time match; discard stale results when reopening changed media.
- First audio analysis downloads approximately 91 MB of model files from Hugging Face into the app's user-data `audio-models` cache. Video frames and source audio are processed locally and are not uploaded. Cached models can run offline.
- Handle sources without audio explicitly; motion analysis still works.

### Timeline and Assembly

- Automatically assemble the full music timeline from all imported video sources; adding or removing footage rebuilds the edit.
- Set a minimum number of consecutive clips before switching to another source.
- Adjust each source's relative scene-selection weight from 0.1 to 5; 1 is neutral.
- Treat each imported video source as one scene. The app does not detect scene boundaries inside a source.
- Generate clips at effective music accents, or use evenly spaced fallback cuts for untouched, unanalyzed music.
- Initially distribute each source's in-points chronologically and spread them across its duration, leaving gaps between selections when footage permits; omit cuts when no source is long enough.
- Optionally use footage analysis to favor motion and clapping during energetic music, and calmer footage with speech during quieter passages. Scene weights and the minimum consecutive-clip setting still apply.
- Keep the original source-selection and in-point behavior when analysis is disabled or unavailable. Analyzed sources use content-ranked in-points within chronological source bounds rather than strictly evenly spaced in-points.
- View generated clips in a V1 lane and drag the shared A1/V1 playhead to scrub the music timeline.
- Select a timeline clip and press **F** to preview its source video and drag the highlighted source segment to choose which part it uses. **Set Start to player time** and **Set End to player time** anchor either edge at the preview timestamp while keeping the segment length fixed. The clip's timeline position and duration stay the same; arrow keys also adjust the segment, and changes are saved with the project.

### Preview and Output

- Preview video synchronized to the music track.
- Update the current-time cursor on animation frames in all workspaces, using the actual media clock so it stops advancing during buffering or pauses.
- Independently enable or mute music audio and source-clip audio.
- Adjust music volume from 0–100% directly in the main timeline (default 80%). Volume is saved and applies to both preview and MP4 export; mute does not reset it.
- Include original speech when source-clip audio is enabled. This also includes any background noise or music recorded in the source; music volume is manual, not automatic speech ducking.
- Choose Full, 1/2, or 1/4 preview render resolution.
- Render the generated timeline to a 1080p, 30 fps MP4 video with the selected audio mix; unassigned timeline areas render black.
- Export the generated edit list as CSV, including music and source in/out times.

## Not Yet Available

- Export a native Premiere Pro sequence or project.
- Generate transcripts, identify the visible speaker, classify body poses, detect usable takes, or rank footage semantically.
- Guarantee speech phrase boundaries. Five-second speech windows are approximate and clips still follow music edit points, so review talking clips for truncated words.
- Separate camera movement from subject movement. The motion score includes both, as well as some transitions and other image changes.
- Reliably detect musical sections, downbeats, or half-time/double-time across arbitrary tracks; the current detector is approximate.
- Relink missing media automatically when files move. Project media paths must remain valid.
- Guarantee decode and seeking performance for every camera codec or variable-frame-rate recording.

## Development

- Requires Node.js 22.12 or newer.
- Start the desktop app with `npm start`.
- Build the Windows installer with `npm run dist`.
- Run regression tests, including local FFmpeg decoding, with `npm test`. Tests do not download models.
- Windows packaging unpacks FFmpeg and ONNX Runtime native binaries. The bundled FFmpeg executable is GPL v3; its license and build/source information accompany it in `node_modules/ffmpeg-static`. Consult these notices before redistributing binaries. Audio classification uses the [ONNX AudioSet AST model](https://huggingface.co/onnx-community/ast-finetuned-audioset-10-10-0.4593-ONNX), derived from [MIT's AST model](https://huggingface.co/MIT/ast-finetuned-audioset-10-10-0.4593).