# AutoEdit: Product Description

## Overview

AutoEdit is a music-video editing tool for projects that use footage from multiple video sources. It analyzes an imported music track to suggest moments for clip changes, then helps editors fill chosen sections of the timeline with footage from sources they assign to those sections.

The goal is to make the repetitive first pass of a music-video edit faster while leaving creative decisions and final timing in the editor's hands.

## The Problem

Music-video editors often review many hours of footage, find usable moments, and repeatedly cut between cameras or other sources to match a song's rhythm. Assigning footage to different parts of a song can also involve a lot of manual sorting and timeline work.

AutoEdit aims to reduce that mechanical work without treating automatic editing as a substitute for editorial judgment.

## Intended Workflow

1. Create a project and import a music track and multiple video files.
2. Analyze the track to identify candidate edit points, such as beats, strong musical accents, and phrase or section boundaries.
3. Review and adjust the suggested points on a music timeline.
4. Mark timeline ranges and assign one or more video sources to each range.
5. Generate a first-pass edit using clips from the assigned sources, aligned to the selected edit points.
6. Review, replace, trim, and rearrange clips before exporting or continuing the edit in a video editor.

## Core Capabilities

- Import and organize a music track and multiple video sources.
- Analyze music and display suggested cut points that users can accept, move, or remove.
- Define timeline ranges and assign preferred video sources to each range.
- Automatically select and place footage from the assigned sources within those ranges.
- Keep generated edits non-destructive and easy to revise.
- Preview the assembled sequence and export it or hand it off to a supported editing workflow.

## Product Boundaries

Music analysis should produce suggestions, not claim to know the uniquely correct moment for every cut. A useful first version can focus on measurable cues such as beat timing and musical changes, while allowing users to control cut frequency and correct the results.

Footage selection also needs clear rules. A later design decision should specify whether AutoEdit chooses clips randomly, cycles through sources, avoids repeating recent shots, or uses user-marked selects. The first version should make its choices visible and easy to override.

## Plugin or Standalone App?

Both approaches are plausible, and they are not mutually exclusive over the life of the product.

**Premiere Pro integration** would keep the editor in a familiar environment and make it natural to continue refining the generated sequence there. The main uncertainty is whether Premiere Pro's currently supported extension and project APIs expose all the timeline operations and media access the product needs. That should be tested with a small technical prototype before choosing a plugin-first architecture.

**A standalone app** gives AutoEdit more control over the analysis, preview, and automated assembly experience. It also introduces extra work around media management and moving a finished first pass into an editor. Project interchange and sequence fidelity would need to be validated for each supported workflow.

**Practical direction:** validate the core workflow with a small prototype, then choose the first host based on integration limits and the intended users. A standalone analysis tool with a carefully tested handoff to an editor is one option; a Premiere Pro extension is attractive if its APIs support reliable sequence creation and revision.

## Feasibility

The concept is technically doable. Music beat and section analysis, video preview, source organization, and rule-based clip placement are all achievable with established media-processing techniques. The larger product risks are the quality of automatic shot selection, handling varied media formats and performance constraints, and delivering a reliable editable timeline in the chosen host.

A focused proof of concept should test three things: whether the music analysis produces useful editable cut suggestions, whether source-assigned timeline ranges generate a helpful first pass, and whether the result can be revised or transferred into the target editing workflow without losing timing or media links.

## Initial Product Goal

Given one song, several video sources, user-approved cut suggestions, and source assignments for sections of the song, generate a coherent, editable first-pass music-video timeline that the editor can quickly refine.

## First Prototype Scope

The first prototype is a standalone Windows desktop app built with Electron. Run it with Node.js 22.12 or newer using `npm start`; build a Windows installer with `npm run dist`.

It imports local audio and video files, estimates a beat grid from changes in audio energy, and lets the user choose cuts every beat, every two beats, or every bar. The default keeps the strongest accent every two beats; accent sensitivity can be adjusted separately. For each assigned source, generated in-points advance chronologically and always start at least 15 seconds into the source; clips are omitted when a source does not have enough footage after that point. The source-time jump scales with the duration between music cuts, so shorter cuts create shorter jumps. Video metadata is loaded separately and clips are sought on demand rather than decoding an entire 30- to 90-minute source into memory. The V1 timeline shows the generated clips, and the CSV edit list includes source in/out times. Timeline ranges can be selected and removed, and the preview mixes music with source-clip audio using independent mute controls. Right-click the preview monitor to choose Full, 1/2, or 1/4 render resolution; lower settings reduce canvas rendering work but do not change the source video's decode resolution or affect exports.

This remains a workflow prototype, not a finished editing system. The native window title includes the app version. Tempo estimation uses a lightweight onset autocorrelation model and may misread half-time or double-time; beat grids and cut points should be reviewed. The desktop app automatically restores the last session and also reads/writes versioned `.autoedit` project files containing media paths, analysis, ranges, settings, and the edit list. Project files reference the original media rather than copying it, so the media must remain at the recorded paths. It does not render a finished video or create a native Premiere Pro sequence. Real-world codec compatibility and seeking performance with camera originals still need testing.