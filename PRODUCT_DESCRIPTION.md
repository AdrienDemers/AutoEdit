# AutoEdit: Product Description

## Overview

AutoEdit is a music-video editing tool for projects that use footage from multiple video sources. It analyzes an imported music track to suggest moments for clip changes, then automatically assembles the full timeline from all imported footage.

The goal is to make the repetitive first pass of a music-video edit faster while leaving creative decisions and final timing in the editor's hands.

## The Problem

Music-video editors often review many hours of footage, find usable moments, and repeatedly cut between cameras or other sources to match a song's rhythm. Assigning footage to different parts of a song can also involve a lot of manual sorting and timeline work.

AutoEdit aims to reduce that mechanical work without treating automatic editing as a substitute for editorial judgment.

## Intended Workflow

1. Create a project and import a music track and multiple video files.
2. Open **Analysis**, choose Music and analyze the track for candidate beat/accent cut points.
3. Review the waveform and add accents in Analysis; select and delete markers from either Analysis or Editing to control cuts.
4. Optionally choose a video source, analyze all footage locally, and correct speech, clapping and motion ranges.
5. Switch to **Editing**, set minimum consecutive clips and scene-importance weights, and choose whether to use analysis-guided selection.
6. Review the automatically rebuilt first-pass edit, adjust music volume and source-audio mute, then export an MP4 video or CSV edit list.

## Core Capabilities

- Import and organize a music track and multiple video sources.
- Separate Analysis and Editing workspaces sharing one project and edit.
- A per-source Color workspace with basic correction controls and matching preview/export grades.
- Analyze music and display suggested cut points that users can supplement or remove.
- Automatically select and place footage from all imported sources across the full song.
- Control the minimum number of consecutive clips per source and each source's relative selection weight.
- Prefer motion and clapping for energetic music, and calmer footage with speech for quieter passages, using optional local footage analysis.
- Add, remove and resize timestamped motion, speech and clapping ranges, keeping corrections separate from cached detector output.
- Keep generated edits non-destructive and easy to revise.
- Preview the assembled sequence and render a 1080p, 30 fps MP4 video with the selected audio mix.
- Export a CSV edit list with music and source in/out times for handoff to another editor.

## Product Boundaries

Music analysis should produce suggestions, not claim to know the uniquely correct moment for every cut. A useful first version can focus on measurable cues such as beat timing and musical changes, while allowing users to control cut frequency and correct the results.

The current prototype treats each imported video source as one scene; it does not detect scene boundaries inside a source. Users set a relative importance weight per source, while a minimum consecutive-clip setting controls how soon the edit may switch sources. Optional footage analysis scores image motion and detects speech/clapping to guide source selection and chronological in-points. Visual scene detection, pose classification, transcription and semantic per-shot ranking remain future work.

## Plugin or Standalone App?

Both approaches are plausible, and they are not mutually exclusive over the life of the product.

**Premiere Pro integration** would keep the editor in a familiar environment and make it natural to continue refining the generated sequence there. The main uncertainty is whether Premiere Pro's currently supported extension and project APIs expose all the timeline operations and media access the product needs. That should be tested with a small technical prototype before choosing a plugin-first architecture.

**A standalone app** gives AutoEdit more control over the analysis, preview, and automated assembly experience. It also introduces extra work around media management and moving a finished first pass into an editor. Project interchange and sequence fidelity would need to be validated for each supported workflow.

**Practical direction:** validate the core workflow with a small prototype, then choose the first host based on integration limits and the intended users. A standalone analysis tool with a carefully tested handoff to an editor is one option; a Premiere Pro extension is attractive if its APIs support reliable sequence creation and revision.

## Feasibility

The concept is technically doable. Music beat and section analysis, video preview, source organization, and rule-based clip placement are all achievable with established media-processing techniques. The larger product risks are the quality of automatic shot selection, handling varied media formats and performance constraints, and delivering a reliable editable timeline in the chosen host.

A focused proof of concept should test three things: whether the music analysis produces useful editable cut suggestions, whether automatic weighted source selection generates a helpful first pass, and whether the result can be revised or transferred into the target editing workflow without losing timing or media links.

## Initial Product Goal

Given one song, several video sources, and user-adjusted cut and source-importance settings, generate a coherent, editable first-pass music-video timeline that the editor can quickly refine.

## First Prototype Scope

The first prototype is a standalone Windows desktop app built with Electron. Run it with Node.js 22.12 or newer using `npm start`; build a Windows installer with `npm run dist`.

It imports local audio and video files, estimates a beat grid from changes in audio energy, and lets the user choose cuts every beat, every two beats, or every bar. The default keeps the strongest accent every two beats; accent sensitivity can be adjusted separately. The app automatically rebuilds the full-song timeline from all imported sources whenever footage or assembly settings change. Each source is treated as one scene, with a user-adjustable relative importance weight (0.1–5, default 1) and a minimum consecutive-clip count before switching scenes. Untouched, unanalyzed music uses evenly spaced fallback cuts; manual accent edits override that fallback. In-points for each source remain chronological across the song and are spread across its valid duration, leaving gaps between selections when the footage permits; cuts are omitted only when no source is long enough. Video metadata is loaded separately and clips are sought on demand rather than decoding an entire 30- to 90-minute source into memory. The V1 timeline shows the generated clips. Export renders the timeline to 1080p, 30 fps MP4, with independent music/source audio toggles; the CSV edit list includes source in/out times. The preview mixes music with source-clip audio using independent mute controls. Right-click the preview monitor to choose Full, 1/2, or 1/4 render resolution; lower settings reduce canvas rendering work but do not change the source video's decode resolution or affect exports.

Exports seek directly to each clip once metadata is available and wait for a decoded frame at that position. Music and recording pause while the next clip is prepared, so slow source seeks do not advance the exported timeline or record loading gaps. Source seeks time out after 90 seconds with drive and media diagnostics; inaccessible drives and unsupported or damaged media still require user intervention.

The **Analysis** workspace has a music/source selector. Music mode displays editable cut markers: Shift-click the waveform or use **Add accent at playhead**, select a marker to remove it with the button or Delete, and reset to restore detector results. In Editing, cut markers are also selectable and can be removed with **Delete selected marker** or Delete. Manual additions force cuts independently of cadence; additions/removals survive re-analysis. Removing all accents leaves one uncut interval, not evenly spaced fallback cuts. Double-clicking the music asset opens this workspace.
Music cue markers can also be dragged horizontally to change their times, with assembly updated on release; Escape cancels. Moves are saved as manual corrections and survive re-analysis. Playback cursors update on animation frames from the active media clock for smoother motion, without extrapolating during buffering.

Source mode previews footage independently, without playing or seeking the music. Speech, clapping and motion lanes show all editable ranges. Select a range and change its start/end seconds, or add/remove ranges; motion has a normalized 0-100% level. Manual edits replace only that source's chosen range type, with unmarked regions scoring zero. Same-type overlaps and out-of-bounds ranges are rejected. Resetting a type restores its detections without changing other types. Corrections and raw results are stored separately; changed media invalidates both.

The navigator below each timeline also controls the visible range: drag its middle to pan and either end to resize the view around the opposite endpoint. **Fit** shows the full duration; arrow keys, Shift and Home/End provide keyboard adjustment. **Space** toggles the active workspace's playback, except while editing input fields or exporting.

**Scrub audio: On/Off** beside the transport controls enables short audio previews while dragging the playhead in Analysis, Editing or Color. Editing previews the music/source mix at the corresponding source position; source timelines preview their own audio. Track mute and music volume are respected. Audio stops on release, with previously running playback resumed. This switch defaults off and persists in projects and sessions; scrubbing does not affect exports.

Use **Ctrl + mouse wheel up/down** over the timeline in either workspace to zoom in/out around the pointer. The music waveform, cut markers, ruler and V1 clips remain aligned; source-analysis lanes zoom together. Horizontal scrollbars navigate zoomed timelines. Zoom ranges from full-duration fit to 64x, independently for music and footage.

Workspaces are ordered **Analysis**, **Editing**, **Color**. In Color, choose an input video and adjust temperature, tint, exposure, contrast, highlights, shadows, whites, blacks and saturation with sliders or numeric values. Grades are saved per source and apply to every use of that source in previews and MP4 exports, without modifying original files or raw analysis inputs. Reset returns just that source to its original appearance. Source playback, Space, timeline zoom and the navigator work here too. Non-neutral grading uses WebGL and reports GPU failures explicitly. The controls are Lumetri-style basic correction, using AutoEdit's own approximate processing rather than Adobe's exact color engine; advanced Lumetri sections and LUTs are outside this scope.

The **Editing** workspace contains assembly controls, the generated V1 timeline and the audio mix. Switching workspaces pauses playback and preserves the edit; workspace, analysis target and source cursor are saved. The main timeline has a saved music-volume slider (0-100%, default 80%) that applies to preview and export independently of mute. Keep source audio enabled to include speech, clapping and other original recorded sounds. There is no automatic music ducking or source-audio separation.

**Analyze all footage** processes reduced-resolution video frames and five-second mono audio windows in a cancellable background worker. First use downloads an approximately 91 MB quantized AudioSet AST model; footage is never uploaded. FFmpeg performs local decoding and the CPU model classifies speech and clapping/applause independently. Results are saved with source size/modification-time fingerprints and reused when valid. Motion includes camera movement; speech detection does not establish who is speaking or provide word/phrase boundaries. Talking clips can still be truncated by musical cuts and must be reviewed. Analysis-guided assembly favors energetic motion/clapping for higher-energy music and calm footage/speech for quieter music, while preserving source-order constraints and scene controls. Disabling **Use analysis for clip selection** restores the original assembly rules. Sources without analysis remain usable.

This remains a workflow prototype, not a finished editing system. The native window title includes the app version. Tempo estimation uses a lightweight onset autocorrelation model and may misread half-time or double-time; beat grids and cut points should be reviewed. The desktop app automatically restores the last session and also reads/writes versioned `.autoedit` project files containing media paths, analysis, scene weights, assembly settings, and the edit list. Project files reference the original media rather than copying it, so the media must remain at the recorded paths. It does not create a native Premiere Pro sequence. Real-world codec compatibility and seeking performance with camera originals still need testing.