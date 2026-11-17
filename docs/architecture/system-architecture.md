# Motion Studio — System Architecture

## Core Hierarchy

Motion Studio strictly follows the Composition-first hierarchy:

1. **Project (`MotionProject`)**: The complete movie or production, owning global settings (`RationalFps`), shared `AssetRecord[]`, reusable `CharacterDefinition[]`, `CompositionRecord[]`, `ProjectTimeline`, and `ExportSettings`.
2. **Composition (`CompositionRecord`)**: An independent scene or reusable visual unit with its own dimensions, duration, `CameraDocument`, `EnvironmentDocument`, `LayerDocument[]`, and `AudioTrackDocument[]`.
3. **Layer & Object (`LayerDocument` / `SceneObjectDocument`)**: Layers manage visibility, locking, soloing, blend mode, parallax depth (`depth`), parenting (`parentId`), and animatable property keyframes (`x`, `y`, `rotation`, `scaleX`, `scaleY`, `opacity`).
4. **Renderer Independence**: `src/schema/`, `src/commands/`, and `src/engine/` contain zero references to DOM canvas or external renderers. Rendering goes through `IRendererAdapter`, implemented first by `Canvas2DRenderer`.
5. **Command-Driven State**: Persistent edits dispatch typed `ProjectCommand` instances through `CommandManager`, guaranteeing schema validation (`zod`), undo/redo history, and debounced IndexedDB persistence.
