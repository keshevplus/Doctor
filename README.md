# Reel

A single-file voice notes app. No backend, no build step — open `index.html` in a browser (Chrome or Edge recommended for speech recognition support).

## Features

- Record voice notes with live transcription (Web Speech API)
- Optionally save the actual audio alongside the transcript for playback
- Tag notes and filter by tag
- Search across transcripts and tags
- Export a single note or your whole (filtered) library as `.txt`, `.md`, or `.json`
- Analysis tab: total notes/words, average words per note, a 7-day activity chart, and your most-used words

## Data

Everything is stored in the browser's `localStorage` (key `reel-voice-notes`) — nothing leaves your machine. Clearing site data or switching browsers will lose your notes.

## Browser support

Speech recognition requires `SpeechRecognition` / `webkitSpeechRecognition` (Chrome, Edge). Audio playback recording requires `MediaRecorder`. Notes still work for search/edit/export without either.
