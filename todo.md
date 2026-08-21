# Project TODO

- [x] Persist subtitle projects, source media metadata, cue data, processing settings, translations, and generated exports in the database.
- [x] Add secure, authenticated project-management APIs to create, list, open, update, and delete subtitle sessions.
- [x] Add secure upload preparation and source-file registration for `.mp4`, `.mkv`, `.srt`, and `.ass` files using S3-backed storage keys.
- [x] Implement format-aware `.srt` and `.ass` parsing that preserves cue timing, raw body text, and inline or ASS styling tags end to end.
- [x] Implement deterministic subtitle serialization and download-ready `.srt` and `.ass` exports that retain corrected timecodes and style tags.
- [x] Implement cue retiming utilities, speech-marker matching, and confidence-scored hybrid alignment recommendations.
- [x] Integrate timestamped Whisper transcription as a second alignment signal and record transcription-processing status.
- [x] Request word-level Whisper timestamps where the transcription provider exposes them, with timestamped segments as a resilience fallback.
- [x] Integrate schema-validated LLM translation that preserves locked formatting tokens, tone, dialogue context, and language metadata.
- [x] Add a deploy-compatible media-processing command layer for FFmpeg waveform extraction with explicit source-size constraints.
- [x] Build a dark NLE-style project dashboard with search, session cards, import actions, and safe deletion confirmation.
- [x] Build the alignment editor with a video preview, subtitle overlay, waveform timeline, draggable cue blocks, timecode inspector, and translation controls.
- [x] Add batch-export controls and project-level activity or processing status feedback.
- [x] Add accessible keyboard interactions, loading/error states, and responsive editor fallbacks.
- [x] Add Vitest coverage for subtitle parsing, formatting-token protection, retiming, export fidelity, and core tRPC workflow validation.
- [x] Validate the UI visually, run type-checking and tests, and create a final project checkpoint.
