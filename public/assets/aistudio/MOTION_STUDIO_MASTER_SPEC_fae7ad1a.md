# Motion Studio --- Master Product & Development Specification

**Document status:** Foundational product direction approved\
**Version:** 1.0\
**Date:** 17 November 2026\
**Product:** Motion Studio\
**Primary target:** Tablet-first, web-first 2D animation and
storytelling studio\
**Design reference:** Adobe After Effects composition-based workflow,
adapted for approachable 2D storytelling

------------------------------------------------------------------------

## 1. Product vision

Motion Studio is a scene-composition-based animation studio for creating
complete animated movies and stories.

The central mental model is:

-   A **Project** represents the entire movie or storytelling
    production.
-   A **Composition** represents an individual scene or a reusable
    visual unit.
-   A Composition contains layers such as foregrounds, backgrounds,
    characters, props, effects, camera, lighting and audio.
-   A Composition has its own timeline and can be rendered
    independently.
-   A Composition can also be nested inside another Composition as a
    layer.
-   The Project contains the collection of Compositions and a
    project-level timeline for arranging the movie.

The product should feel familiar to users of Adobe After Effects while
remaining optimized for 2D animation, sprite workflows, illustrated
storytelling and touch-first interaction.

The initial release must be a usable scene-first 2D animation studio,
not a standalone sprite editor that later needs to be rebuilt.

## 2. Product principles

1.  **Composition-first:** Project \> Compositions \> Layers \> Objects
    \> Properties and keyframes.
2.  **Non-destructive editing:** Preserve original assets and allow
    edits to be revised.
3.  **Reusable content:** Characters, props, backgrounds, audio and
    Compositions can be reused.
4.  **Renderer independence:** Project data and animation evaluation
    must not depend on PixiJS or any specific renderer.
5.  **Deterministic animation:** A given frame must always evaluate to
    the same visual state.
6.  **Tablet-first usability:** The canvas receives priority; panels are
    contextual and collapsible.
7.  **Progressive capability:** Establish extensible architecture early,
    but ship features in milestones.
8.  **Honest completion:** A feature is not complete until it works,
    persists, reopens and passes tests.

## 3. Core terminology

Use these names consistently in the UI, documentation and code.

  -----------------------------------------------------------------------
  Term                                Meaning
  ----------------------------------- -----------------------------------
  Project                             The complete movie or production

  Composition                         A scene or reusable visual
                                      container

  Layer                               A track/container inside a
                                      Composition

  Object                              An individual visual or audio
                                      element placed in a Layer

  Asset                               A source file or reusable media
                                      item in the Project Library

  Character                           A reusable character asset with one
                                      or more animation sequences

  Instance                            A placed use of an asset or
                                      Composition

  Composition Timeline                Timeline for animation inside one
                                      Composition

  Project Timeline                    Timeline for arranging Compositions
                                      into the movie

  Pre-compose                         Create a new Composition from
                                      selected layers and replace them
                                      with a Composition instance

  Nested Composition                  A Composition used as a layer
                                      inside another Composition
  -----------------------------------------------------------------------

Prefer **Composition** as the primary product term. "Scene" may be used
in explanatory copy, for example "Composition (scene)", but should not
replace Composition in the core UI.

## 4. Project and Composition hierarchy

``` text
Project: The Lost Kingdom
├── Project Settings
├── Project Timeline
├── Shared Asset Library
│   ├── Characters
│   ├── Environments
│   ├── Props
│   ├── Backgrounds
│   ├── Foregrounds
│   ├── Audio
│   └── Effects
├── Composition Collection
│   ├── 01 - Opening
│   │   ├── Composition Settings
│   │   ├── Camera
│   │   ├── Layers
│   │   │   ├── Foreground
│   │   │   ├── Characters
│   │   │   ├── Midground
│   │   │   ├── Props
│   │   │   ├── Background
│   │   │   └── Effects
│   │   ├── Lighting / Environment
│   │   ├── Audio Tracks
│   │   └── Composition Timeline
│   ├── 02 - Forest
│   ├── 03 - The Encounter
│   └── 04 - Ending
└── Export Settings
```

The layer labels above are example organizational groups, not a rigid
mandatory order. Users must be able to create, rename, reorder, nest,
hide, lock and organize layers freely.

### 4.1 Project responsibilities

A Project owns:

-   Project identity, title, description and metadata.
-   Global frame-rate and default canvas preferences.
-   Composition collection and ordering.
-   Project-level timeline and movie duration.
-   Shared asset, character and audio libraries.
-   Export presets and movie output settings.
-   Project-wide color and rendering preferences.
-   Dependency references and recovery metadata.

### 4.2 Composition responsibilities

A Composition owns:

-   Width, height, pixel aspect ratio and background settings.
-   Frame rate and duration (with an option to inherit the Project frame
    rate).
-   Camera and view settings.
-   Layer hierarchy and object instances.
-   Composition-level environment and lighting settings.
-   Composition timeline, markers and work area.
-   Audio tracks and synchronization.
-   Effects and transitions that occur inside the Composition.
-   Preview and render settings.

A Composition must be independently previewable and renderable. It must
also be usable as a nested Composition layer in another Composition.

### 4.3 Layer and object responsibilities

A Layer owns ordering, visibility, lock state, opacity, blend mode,
compositing behavior and references to one or more objects, depending on
the chosen layer model.

An Object represents a placed item, such as:

-   Sprite or image.
-   Character instance.
-   Text.
-   Shape or vector graphic.
-   Video.
-   Audio clip.
-   Nested Composition.
-   Particle or effect emitter.
-   Camera, light or other scene control object.

Every placed instance must have its own transform and animation
properties without changing the shared source asset.

## 5. Two levels of timeline

Motion Studio must have two distinct timeline concepts.

### 5.1 Composition Timeline

Controls what happens inside one Composition:

-   Layer and object timing.
-   Character animation clips and sprite frames.
-   Position, rotation, scale, opacity and pivot keyframes.
-   Camera movement and zoom.
-   Effects and transitions.
-   Audio clips, dialogue, ambience, music and sound effects.
-   Markers, work area and playback range.

### 5.2 Project Timeline

Controls the complete movie:

-   Composition order.
-   Composition start time and duration.
-   Gaps, overlaps and transitions.
-   Project-level soundtrack and audio continuity where supported.
-   Movie markers and sections.
-   Overall movie duration and export range.

A Composition's internal timeline must remain independent of its
placement in the Project Timeline. Moving a Composition in the Project
Timeline must not unexpectedly alter its internal keyframes.

### 5.3 Timing model

-   Store time internally as integer frames wherever possible.
-   Store the Project frame rate as a rational value, not an imprecise
    floating-point approximation.
-   Convert between frames and seconds only at API or UI boundaries.
-   Define deterministic behavior for nested Composition time mapping,
    offsets, playback speed and time remapping.
-   Support frame stepping, scrubbing, looping and work-area playback.

## 6. After Effects-inspired capabilities

The architecture should support the following concepts. They do not all
need to ship in the first milestone.

### 6.1 Nested Compositions

-   A Composition can be placed inside another Composition.
-   The nested Composition appears as a layer in the parent.
-   Parent transforms and opacity affect the nested instance.
-   The nested Composition retains its own internal layers and timeline.
-   Avoid circular nesting. Detect and reject dependency cycles.
-   Define how parent time maps to child time, including offset and
    playback speed.

### 6.2 Pre-compositions

-   Select multiple layers and create a new Composition from them.
-   Replace the selected layers with a nested Composition instance.
-   Preserve visual appearance, timing and transforms as closely as
    possible.
-   Provide a way to open and edit the pre-composition.
-   Support undo and redo for the entire operation.

### 6.3 Parenting

-   Allow one layer/object to follow another object's transform.
-   Support parent-child hierarchies.
-   Define local and world transforms clearly.
-   Prevent parenting cycles.
-   Allow parent relationships to be changed without unintended jumps.

### 6.4 Masks and mattes

Plan for:

-   Shape masks.
-   Image/alpha masks.
-   Add, subtract, intersect and invert operations where supported.
-   Alpha and luma matte concepts.
-   Animated mask paths in a later milestone.

### 6.5 Blending and compositing

Support a documented set of common blend modes. The renderer adapter
must declare unsupported modes rather than silently producing incorrect
output.

### 6.6 Keyframes and graph editing

-   Position, rotation, scale, opacity and pivot.
-   Sprite animation and clip selection.
-   Camera and effect properties.
-   Linear, hold and Bezier interpolation.
-   Easing presets.
-   Graph editor in a later milestone.
-   Keyframe copy, paste, duplicate, move and delete.

## 7. Composition contents: environment and layers

A Composition should provide an environment workflow that makes it easy
to build a complete visual scene.

### 7.1 Environment settings

Provide controls for:

-   Environment presets and templates.
-   Background color or image.
-   Sky and distant scenery.
-   Lighting direction, intensity and color where supported.
-   Atmosphere, fog and haze.
-   Weather overlays such as rain, snow and dust.
-   Time-of-day color treatments.
-   Camera and depth presets.

Environment presets are editable starting points, not flattened final
images. Users should be able to replace individual components.

### 7.2 Foreground, midground and background

Support independent layers for:

-   Sky and distant background.
-   Background environment.
-   Midground scenery.
-   Characters.
-   Props.
-   Foreground scenery.
-   Overlays and effects.

Each layer should support:

-   Position, rotation, scale and pivot.
-   Opacity and visibility.
-   Locking and ordering.
-   Rename, duplicate and delete.
-   Blend mode where supported.
-   Depth assignment for parallax.
-   Animation and keyframes.
-   Replace-source operation that preserves instance transforms and
    animation when compatible.

### 7.3 Parallax

-   Assign depth values to layers.
-   Preview depth-based movement.
-   Support camera movement that creates relative layer motion.
-   Provide simple depth presets such as shallow, cinematic, deep
    environment and infinite background.
-   Keep the underlying depth model renderer-independent.

## 8. Character and sprite animation

The first release must support both pixel art and high-resolution
illustrated artwork.

### 8.1 Import paths

Support:

1.  Sprite-sheet image import.
2.  Individual image import and manual frame organization.
3.  Reusable character asset import.
4.  Transparent PNG and WebP images at minimum.

### 8.2 Sprite-sheet workflow

-   Import a sprite sheet.
-   Detect regular grids automatically.
-   Allow manual correction of rows, columns, cell dimensions, spacing
    and margins.
-   Support non-uniform frame selection through manual slicing.
-   Preview extracted frames.
-   Name and save animation sequences.
-   Configure frame rate, looping and playback mode.
-   Preserve the source sheet and slicing metadata.

### 8.3 Individual-image workflow

-   Import a sequence of individual images.
-   Arrange them into an animation sequence.
-   Reorder, duplicate and remove frames.
-   Set per-frame duration where appropriate.
-   Preview and save the sequence as a reusable animation clip.

### 8.4 Character instances

-   Keep reusable character definitions in the Project Character
    Library.
-   Place multiple instances in Compositions.
-   Give each instance its own transform, animation selection and
    timing.
-   Avoid changing the shared character source when editing an instance.
-   Support replacement and relinking while preserving compatible
    instance settings.

### 8.5 Automatic rigging --- later milestone

Plan for two distinct workflows:

-   Sprite-sheet analysis and animation sequence extraction.
-   Single-illustration analysis, segmentation, skeleton proposal,
    pivots and deformation.

AI should propose structures; the user must be able to inspect and
correct them. Preserve the original artwork and store generated rig data
separately. Do not make automatic rigging a dependency of the initial
release.

## 9. Audio system

Audio must be integrated into Composition timelines.

Initial audio categories:

-   Dialogue and narration.
-   Background music.
-   Ambient environment.
-   Sound effects.
-   Character movement and Foley.

Required editing features:

-   Multiple audio tracks.
-   Waveform display.
-   Trim, split and move clips.
-   Volume and fades.
-   Mute and solo.
-   Looping.
-   Clip offset and synchronization.
-   Timeline markers.
-   Preview playback synchronized with animation.

Use the Web Audio API for browser playback and mixing. Keep audio clip
metadata and timing independent of the playback engine. Validate
audio/video synchronization during export.

## 10. Shared Asset Library

The Project should provide a central library for reusable content.

Asset categories:

-   Characters.
-   Sprite sheets and animation frames.
-   Environments.
-   Backgrounds and foregrounds.
-   Props.
-   Images and textures.
-   Audio and sound effects.
-   Video.
-   Effects and presets.
-   Fonts and other supported resources.

Required features:

-   Import and preview.
-   Folders, tags and search.
-   Reuse across Compositions.
-   Duplicate detection using file hashes.
-   Replace or relink source assets.
-   Preserve original files.
-   Track dependencies and missing assets.
-   Show where an asset is used.
-   Avoid destructive edits to shared source media.

Suggested asset metadata:

``` ts
interface AssetRecord {
  id: string;
  name: string;
  type: "image" | "spritesheet" | "audio" | "video" | "font" | "other";
  mimeType: string;
  sourcePath: string;
  width?: number;
  height?: number;
  durationFrames?: number;
  hash?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}
```

## 11. Tablet-first user interface

The interface should be inspired by After Effects' workflow, but must
not copy its dense desktop panel layout onto a tablet.

### 11.1 Main workspace

-   Top bar: Project name, undo, redo, save status, playback, export and
    workspace switcher.
-   Main canvas: largest available area.
-   Compact contextual toolbar: select, move, rotate, scale, draw, text,
    camera, assets and audio.
-   Bottom timeline: collapsible and resizable.
-   Contextual inspector: appears when a layer or object is selected.
-   Project/Composition navigator: accessible without permanently
    consuming large canvas space.

### 11.2 Workspaces

Potential workspaces:

-   Composition Editor.
-   Project Timeline.
-   Storyboard.
-   Character Studio.
-   Asset Library.
-   Audio Editor.
-   Export.

Switching workspaces must preserve selection, playhead and project state
where appropriate.

### 11.3 Touch and stylus interaction

-   Use Pointer Events for mouse, touch and stylus.
-   Target interactive controls at approximately 44--48 CSS pixels.
-   Do not make essential controls hover-only.
-   Tap to select.
-   Drag to move.
-   Two-finger pan.
-   Pinch to zoom.
-   Use visible handles for rotate and scale.
-   Drag the playhead to scrub.
-   Long-press for contextual actions.
-   Provide undo for accidental gestures.

Test portrait and landscape layouts on real tablet viewports, including
8-inch, 10--11-inch and 12--13-inch devices.

## 12. Technical architecture

### 12.1 Recommended stack

  Area                     Technology
  ------------------------ -------------------------------------
  Frontend                 React + TypeScript + Vite
  UI primitives            Tailwind CSS + Radix UI
  State management         Zustand
  Validation               Zod
  2D rendering             PixiJS 8
  Future 3D/2.5D           Three.js
  Animation runtime        Custom renderer-independent runtime
  Timeline                 Custom Canvas-based timeline
  Audio                    Web Audio API
  Browser storage          IndexedDB + OPFS where available
  Background work          Web Workers
  Export                   WebCodecs with FFmpeg WASM fallback
  Testing                  Vitest + Playwright
  Monorepo                 pnpm workspaces + Turborepo
  Future desktop wrapper   Tauri 2

### 12.2 Architectural rule: renderer independence

Do not let project schema, Composition data or animation evaluation
depend directly on PixiJS objects.

Define renderer interfaces for:

-   Creating and destroying visual nodes.
-   Updating transforms.
-   Updating textures and media.
-   Managing masks and blend modes.
-   Rendering a frame.
-   Capturing/exporting frames.
-   Reporting supported capabilities.

PixiJS is the first 2D renderer implementation. Three.js may be added
later behind a separate adapter.

### 12.3 Suggested package structure

``` text
apps/
  web/
packages/
  core/
  schema/
  commands/
  project-model/
  composition-model/
  rendering/
  renderer-pixi/
  sprite-animation/
  character-studio/
  environment/
  layer-manager/
  parallax/
  asset-library/
  audio-engine/
  camera/
  timeline/
  project-timeline/
  effects/
  storyboard/
  export/
  storage/
  touch-interactions/
docs/
  architecture/
  data-model/
  development/
  decisions/
```

Avoid circular dependencies. Keep packages focused and define dependency
direction explicitly.

## 13. Data model

Use a versioned, renderer-independent project document.

Conceptual structure:

``` ts
interface MotionProject {
  schemaVersion: number;
  id: string;
  name: string;
  settings: ProjectSettings;
  assets: AssetRegistry;
  characters: CharacterLibrary;
  compositions: CompositionRecord[];
  projectTimeline: ProjectTimeline;
  exportSettings: ExportSettings;
}

interface CompositionRecord {
  id: string;
  name: string;
  settings: CompositionSettings;
  camera: CameraDocument;
  layers: LayerDocument[];
  timeline: CompositionTimeline;
  audioTracks: AudioTrack[];
  environment: EnvironmentDocument;
}

interface LayerDocument {
  id: string;
  name: string;
  type: "visual" | "audio" | "camera" | "control";
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: string;
  parentId?: string;
  objects: SceneObjectDocument[];
}
```

These are conceptual starting interfaces, not a complete schema. Define
all fields, defaults, constraints and migration behavior before relying
on the format in production.

### 13.1 Coordinate conventions

-   2D origin: top-left.
-   X increases to the right.
-   Y increases downward.
-   Store internal rotations in radians; display degrees in the UI.
-   Use explicit coordinate conversion at renderer boundaries.
-   Define a consistent transform and pivot convention.
-   Define how nested Composition transforms are composed.

### 13.2 Animation evaluation

-   Integer frame is the primary time unit.
-   Evaluate any requested frame directly from document data.
-   Do not accumulate animation state by repeatedly applying frame
    deltas.
-   Keep interpolation deterministic.
-   Make playback, scrubbing, preview and export use the same evaluation
    path.

## 14. Commands, undo and redo

All persistent edits must go through a command system.

Examples:

-   Add layer.
-   Delete layer.
-   Rename layer.
-   Move layer.
-   Add object.
-   Change transform.
-   Add or move keyframe.
-   Change asset source.
-   Create Composition.
-   Pre-compose layers.
-   Nest Composition.
-   Change parent.
-   Edit audio clip.

Each command should define:

-   Validation.
-   Execute behavior.
-   Undo behavior.
-   Redo behavior.
-   Affected document IDs.
-   Serialization or recovery behavior where required.

React components must not mutate persistent project documents directly.

## 15. Storage, saving and project portability

The browser app must provide reliable project persistence while
acknowledging browser storage limitations.

### 15.1 Browser storage

-   IndexedDB for structured project data and metadata.
-   OPFS for large binary assets where supported.
-   Use a storage adapter so other storage implementations can be added.
-   Cache and thumbnails must be disposable and rebuildable.

### 15.2 Project archive

Provide an explicit portable project archive, initially `.motionx`,
containing a structure similar to:

``` text
TheLostKingdom.motionx/
├── project.json
├── compositions/
├── assets/
├── characters/
├── audio/
├── thumbnails/
├── cache/
└── exports/
```

The exact archive implementation may be a ZIP-based container. The
project document is authoritative; cache files are not.

### 15.3 Reliability features

-   Autosave.
-   Manual save.
-   Save As / duplicate project.
-   Recovery after unexpected closure.
-   Backup snapshots.
-   Schema migration.
-   Missing-asset detection and relinking.
-   Atomic or recoverable writes.
-   Import/export of complete project archives.

Never imply that browser storage is an unlimited or permanent substitute
for a user-controlled backup.

## 16. Rendering and export

Initial export targets should be selected according to browser support
and tested device performance.

Planned outputs:

-   MP4 video.
-   WebM where useful.
-   GIF.
-   WebP animation where supported.
-   PNG image sequence.
-   Audio-only export.

Use WebCodecs when available, with FFmpeg WASM fallback where practical.
Keep export behind an adapter so future native or server rendering can
be introduced.

Export must:

-   Render using deterministic frame evaluation.
-   Preserve frame rate and duration.
-   Synchronize audio.
-   Respect Composition nesting and time mapping.
-   Report progress and failures.
-   Avoid silently producing incomplete output.
-   Offer a clear fallback when the device lacks required codec support.

## 17. Development roadmap

Build a working application incrementally. Do not attempt to implement
every advanced After Effects feature before the core Composition
workflow works.

### Milestone 0 --- Foundation

-   Repository and monorepo setup.
-   TypeScript strict mode.
-   Project schema and validation.
-   Command system and undo/redo foundation.
-   Storage abstraction.
-   Renderer adapter contract.
-   Basic tablet-first application shell.

**Acceptance:** A new Project can be created, saved, reopened and
validated.

### Milestone 1 --- Project and Asset Library

-   Project creation and management.
-   Asset import.
-   Asset categories, folders, tags and search.
-   Asset preview.
-   Missing asset handling.
-   Reusable Project Library.

**Acceptance:** Assets can be imported, organized, reused and retained
after reopening a Project.

### Milestone 2 --- Composition Editor

-   Create, rename, duplicate and delete Compositions.
-   Composition settings.
-   Canvas and zoom/pan.
-   Add images and basic objects.
-   Foreground, midground and background organization.
-   Layer visibility, lock, reorder and transforms.
-   Contextual inspector.

**Acceptance:** A user can create a Composition, arrange layers and
reopen it with the same appearance.

### Milestone 3 --- Sprite Animation

-   Sprite-sheet import and slicing.
-   Manual frame selection.
-   Individual-image sequences.
-   Animation clips.
-   Preview, loop and frame-rate settings.
-   Character instances.

**Acceptance:** A character can be animated in a Composition and saved
as a reusable asset/clip.

### Milestone 4 --- Composition Timeline

-   Frame ruler and playhead.
-   Tracks and layer timing.
-   Keyframes.
-   Transform animation.
-   Interpolation and easing.
-   Scrubbing and playback.
-   Copy, paste, duplicate and delete keyframes.

**Acceptance:** Animation evaluates consistently during playback,
scrubbing and reopening.

### Milestone 5 --- Audio

-   Audio import.
-   Multiple tracks.
-   Waveforms.
-   Trim, split and move.
-   Volume, fades, mute and solo.
-   Synchronized preview.

**Acceptance:** Dialogue, music and sound effects play in sync with the
Composition.

### Milestone 6 --- Camera and Parallax

-   Camera settings.
-   Camera movement and zoom.
-   Layer depth.
-   Parallax preview.
-   Environment presets.
-   Atmosphere and basic effects.

**Acceptance:** A user can create a multi-depth environment and animate
a camera move.

### Milestone 7 --- Project Timeline and Nested Compositions

-   Project-level timeline.
-   Composition arrangement.
-   Duration and offsets.
-   Transitions.
-   Nested Compositions.
-   Dependency-cycle detection.
-   Pre-compose workflow.

**Acceptance:** Multiple Compositions can be arranged into a complete
movie and nested without corrupting their internal timing.

### Milestone 8 --- Export

-   Video export.
-   Audio synchronization.
-   Progress and cancellation.
-   Export presets.
-   Project archive export and import.

**Acceptance:** A multi-Composition Project can produce a verified
playable output.

### Milestone 9 --- Advanced animation

-   Parenting.
-   Masks and mattes.
-   More blend modes.
-   Graph editor.
-   Advanced effects.
-   More sophisticated environment controls.

### Milestone 10 --- Automatic rigging and AI assistance

-   Sprite-sheet analysis.
-   Illustration segmentation.
-   Skeleton proposals.
-   User-correctable pivots and joints.
-   Deformation and rig preview.
-   AI-assisted environment and asset workflows.

## 18. Testing strategy

Use:

-   Vitest for schemas, commands, timeline math and animation
    evaluation.
-   Playwright for user workflows and browser integration.
-   Visual regression for Composition rendering.
-   Tablet viewport tests in portrait and landscape.
-   Performance tests for large layers, long timelines and many
    keyframes.
-   Export verification for duration, frame rate, audio synchronization
    and output integrity.

Critical tests:

1.  Create Project \> create Composition \> add layers \> save \>
    reopen.
2.  Import asset \> place in two Compositions \> replace source while
    preserving compatible instances.
3.  Animate object \> scrub to arbitrary frame \> verify deterministic
    state.
4.  Nest Composition \> preview \> export.
5.  Attempt circular nesting \> ensure validation rejects it.
6.  Create parent relationship \> attempt cycle \> ensure rejection.
7.  Recover after simulated interruption.
8.  Export a multi-Composition movie and verify audio/video timing.

## 19. Antigravity / coding-agent development instructions

The coding agent must follow these rules:

1.  Read the repository README and relevant documentation before
    editing.
2.  Read the current architecture and status documents before starting a
    milestone.
3.  Work on one milestone or clearly bounded task at a time.
4.  Inspect existing code before creating or replacing files.
5.  Do not silently change the approved Project \> Composition \> Layer
    hierarchy.
6.  Do not introduce renderer-specific objects into persistent project
    data.
7.  Do not allow React components to mutate persistent documents
    directly.
8.  Route persistent edits through commands.
9.  Validate imported and persisted data.
10. Preserve existing working functionality.
11. Do not claim placeholders or mock interactions are complete
    features.
12. Run lint, typecheck, tests and production build after meaningful
    changes.
13. Add tests for new behavior and regression tests for bug fixes.
14. Test touch interaction and actual tablet-sized layouts.
15. Document architectural changes and trade-offs.
16. Report limitations and unfinished work honestly.
17. Avoid unnecessary dependencies and circular package references.
18. Do not implement future features prematurely if they destabilize the
    current milestone.

### Required agent workflow

``` text
Understand
  -> Inspect current code and documentation
  -> Plan the smallest implementation
  -> Implement
  -> Add/update tests
  -> Run lint, typecheck and tests
  -> Run production build
  -> Verify in browser and tablet viewport
  -> Update documentation and status
  -> Report results
```

### Definition of done

A task is complete only when:

-   The feature is usable in the application.
-   Data persists and can be reopened.
-   Undo/redo works where the operation is an editable action.
-   Invalid input and failure cases are handled.
-   Tests pass.
-   Production build succeeds.
-   Tablet interaction has been checked when relevant.
-   Documentation and current status are updated.
-   Known limitations are reported.

### Required completion report

At the end of each task, the agent must report:

-   What was implemented.
-   Files and packages changed.
-   Tests added or updated.
-   Lint/typecheck/test results.
-   Production build result.
-   Browser/tablet verification.
-   Known limitations.
-   Next recommended task.

## 20. Required documentation files

``` text
docs/
├── architecture/
│   ├── system-architecture.md
│   ├── renderer-architecture.md
│   ├── animation-runtime.md
│   ├── composition-system.md
│   ├── timeline-architecture.md
│   ├── audio-architecture.md
│   └── security-model.md
├── data-model/
│   ├── project-schema.md
│   ├── composition-schema.md
│   ├── layer-and-object-schema.md
│   ├── character-schema.md
│   └── migration-policy.md
├── development/
│   ├── roadmap.md
│   ├── current-status.md
│   ├── testing-strategy.md
│   └── known-limitations.md
└── decisions/
    ├── ADR-001-web-first.md
    ├── ADR-002-renderer-abstraction.md
    ├── ADR-003-project-format.md
    ├── ADR-004-frame-based-runtime.md
    └── ADR-005-project-composition-hierarchy.md
```

## 21. Explicitly out of scope for the first usable release

Do not delay the core 2D Composition workflow to implement:

-   Full automatic character rigging.
-   Full 3D modelling and animation.
-   Advanced node-based compositing.
-   Professional-grade color grading.
-   Complex particle simulation.
-   AI generation of every asset type.
-   Collaborative real-time editing.
-   A complete desktop-native application.

Design extension points where appropriate, but prioritize a stable and
usable 2D studio.

## 22. Final product definition

Motion Studio is a **Project- and Composition-based animation studio**.

The Project is the movie. Compositions are the scenes and reusable
visual units. Each Composition contains its own layers, objects,
characters, environment, camera, effects, audio and animation timeline.
The Project Timeline arranges Compositions into the final movie.

The application should combine the compositional workflow familiar from
After Effects with approachable sprite animation, illustrated
storytelling, reusable assets, sound design and tablet-first
interaction.

**This hierarchy is foundational. Do not replace it with a model where
scenes are the top-level project unit or where the application is only a
sprite-sheet editor.**
