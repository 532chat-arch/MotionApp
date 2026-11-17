# Motion Studio — Known Limitations

1. **WebM Export Audio Mixing**: Current browser-based WebM export captures the deterministic video canvas stream via `MediaRecorder`. Offline audio-track muxing into the exported WebM container is not yet wired; audio synchronization currently runs during live Composition playback via `WebAudioEngine`.
2. **Storage Limits**: Browser persistence uses IndexedDB for complete project storage including embedded asset data URLs. Very large video/image libraries should be backed up periodically using the `.motionx` archive export in the Export workspace.
3. **Out of Scope for Initial Release**: Automatic AI character rigging, 3D mesh rendering, node-based compositing, and animated Bezier mask paths remain reserved for later milestones.
