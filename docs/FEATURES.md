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

### Timeline and Assembly

- Define non-overlapping ranges on the music timeline and assign one or more video sources to each range.
- Select ranges from the timeline or range list, drag their endpoints, and remove them with Delete/Backspace.
- Generate a first pass whose source in-points advance chronologically; shorter music cuts create proportionally shorter source-time jumps.
- Start source sampling at least 15 seconds into the video and omit cuts when there is not enough remaining footage.
- View generated clips in a V1 lane and drag the playhead to scrub the music timeline.

### Preview and Output

- Preview video synchronized to the music track.
- Independently enable or mute music audio and source-clip audio.
- Choose Full, 1/2, or 1/4 preview render resolution.
- Export the generated edit list as CSV, including music and source in/out times.

## Not Yet Available

- Render a finished video file.
- Export a native Premiere Pro sequence or project.
- Inspect or rank footage semantically, detect usable takes, or select shots based on image content.
- Reliably detect musical sections, downbeats, or half-time/double-time across arbitrary tracks; the current detector is approximate.
- Relink missing media automatically when files move. Project media paths must remain valid.
- Guarantee decode and seeking performance for every camera codec or variable-frame-rate recording.

## Development

- Requires Node.js 22.12 or newer.
- Start the desktop app with `npm start`.
- Build the Windows installer with `npm run dist`.