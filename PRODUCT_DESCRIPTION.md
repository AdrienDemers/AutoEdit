# AutoEdit: Product Description

## Overview

AutoEdit is a music-video editing tool for projects that use footage from multiple video sources. It analyzes an imported music track to suggest moments for clip changes, then automatically assembles the full timeline from all imported footage.

The goal is to make the repetitive first pass of a music-video edit faster while leaving creative decisions and final timing in the editor's hands.

## The Problem

Music-video editors often review many hours of footage, find usable moments, and repeatedly cut between cameras or other sources to match a song's rhythm. Assigning footage to different parts of a song can also involve a lot of manual sorting and timeline work.

AutoEdit aims to reduce that mechanical work without treating automatic editing as a substitute for editorial judgment.

## Intended Workflow

1. Create a project and import a music track and multiple video files.
2. Analyze the track to identify candidate edit points, such as beats, strong musical accents, and phrase or section boundaries.
3. Review and adjust the suggested points on a music timeline.
4. Set the minimum consecutive clips before switching sources and adjust each source's scene-importance weight.
5. Review the automatically rebuilt first-pass edit, adjust the audio mix, then export an MP4 video or CSV edit list.

## Core Capabilities

- Import and organize a music track and multiple video sources.
- Analyze music and display suggested cut points that users can accept, move, or remove.
- Automatically select and place footage from all imported sources across the full song.
- Control the minimum number of consecutive clips per source and each source's relative selection weight.
- Keep generated edits non-destructive and easy to revise.
- Preview the assembled sequence and render a 1080p, 30 fps MP4 video with the selected audio mix.
- Export a CSV edit list with music and source in/out times for handoff to another editor.

## Product Boundaries

Music analysis should produce suggestions, not claim to know the uniquely correct moment for every cut. A useful first version can focus on measurable cues such as beat timing and musical changes, while allowing users to control cut frequency and correct the results.

The current prototype treats each imported video source as one scene; it does not detect scene boundaries inside a source. Users set a relative importance weight per source, while a minimum consecutive-clip setting controls how soon the edit may switch sources. Visual scene detection and per-shot ranking remain future work.

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

It imports local audio and video files, estimates a beat grid from changes in audio energy, and lets the user choose cuts every beat, every two beats, or every bar. The default keeps the strongest accent every two beats; accent sensitivity can be adjusted separately. The app automatically rebuilds the full-song timeline from all imported sources whenever footage or assembly settings change. Each source is treated as one scene, with a user-adjustable relative importance weight (0.1–5, default 1) and a minimum consecutive-clip count before switching scenes. Before music analysis is available, evenly spaced cuts are used. In-points for each source remain chronological across the song and are spread across its valid duration, leaving gaps between selections when the footage permits; cuts are omitted only when no source is long enough. Video metadata is loaded separately and clips are sought on demand rather than decoding an entire 30- to 90-minute source into memory. The V1 timeline shows the generated clips. Export renders the timeline to 1080p, 30 fps MP4, with independent music/source audio toggles; the CSV edit list includes source in/out times. The preview mixes music with source-clip audio using independent mute controls. Right-click the preview monitor to choose Full, 1/2, or 1/4 render resolution; lower settings reduce canvas rendering work but do not change the source video's decode resolution or affect exports.

Exports seek directly to each clip once metadata is available and wait for a decoded frame at that position. Music and recording pause while the next clip is prepared, so slow source seeks do not advance the exported timeline or record loading gaps. Source seeks time out after 90 seconds with drive and media diagnostics; inaccessible drives and unsupported or damaged media still require user intervention.

This remains a workflow prototype, not a finished editing system. The native window title includes the app version. Tempo estimation uses a lightweight onset autocorrelation model and may misread half-time or double-time; beat grids and cut points should be reviewed. The desktop app automatically restores the last session and also reads/writes versioned `.autoedit` project files containing media paths, analysis, scene weights, assembly settings, and the edit list. Project files reference the original media rather than copying it, so the media must remain at the recorded paths. It does not create a native Premiere Pro sequence. Real-world codec compatibility and seeking performance with camera originals still need testing.