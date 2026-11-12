# AutoEdit App Target

## Product Goal

AutoEdit is a standalone desktop tool that helps music-video editors assemble a first cut from one song and multiple long video sources. It identifies candidate musical cut points, lets the editor assign sources to timeline ranges, and places footage in a reviewable sequence.

The app is intended to reduce repetitive source review and rough-cut assembly, while keeping timing, source assignments, and final editorial decisions under the user's control.

## Intended Users

- Music-video editors and creators working with multiple camera angles or long-form recordings.
- Editors who want a faster, editable first pass rather than a fully automated finished video.
- Users who prefer a focused timeline workflow and may later continue editing in another NLE.

## Product Form

- Standalone Windows desktop application built with Electron.
- Premiere-inspired timeline interaction, but not a Premiere Pro plugin.
- Local-first media workflow: source files remain at their original paths.
- Named `.autoedit` project files store project state and media references, not copies of source media.

## Core Workflow

1. Import a music track and video sources.
2. Analyze the track and review suggested beat-aligned cut points.
3. Choose a cut cadence and assign video sources to sections of the music timeline.
4. Generate a first-pass edit using clips from those sources in chronological source order.
5. Review and adjust ranges, playback position, and audio mix, then export an MP4 video or CSV edit list.
6. Save the project and reopen it later to continue.

## Product Boundaries

AutoEdit proposes a rough edit; it does not decide which shots are artistically best. The current beat detector is approximate and its suggestions should be reviewed. The desktop app renders a 1080p, 30 fps MP4 video and exports an edit list, but does not create a native Premiere Pro sequence.

See [Features](FEATURES.md) for the current prototype scope and planned capabilities.