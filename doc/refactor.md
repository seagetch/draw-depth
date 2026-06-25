# Composite Source Refactor

## Goal

Color and depth inputs should be handled as independent source plugins, then normalized into one shared composite backend before rendering, editing, puppet binding, debug display, and export.

Target input axes:

- Color source A
  - A1: flat image, such as PNG or JPG
  - A2: layered PSD
- Depth source B
  - B1: flat image, such as PNG or JPG
  - B2: layered PSD

Target combinations:

- A:N and B:N
  - Match color layers and depth layers.
  - The matched depth layer becomes the depth information for the corresponding color layer.
- A:N and B:1
  - Split the single depth image into N depth layers using the N color layer masks and visibility order.
  - This replaces the current PSD stable-depth fallback with a general compositor step.
- A:1 and B:1
  - Produce one composite layer.
- A:1 and B:N
  - Not naturally representable without a color layer split policy.
  - Treat this as unsupported at first, or add a later policy that derives color layer masks from depth layers.

The important change is that "PNG vs PSD" should describe only how a source is decoded. It should not decide how the rest of the app renders or edits data.

## Original State

Before this refactor, the app had two main paths selected by `renderState.sourceMode`:

- `raster`
  - Loaded by `loadRasterModel()` in `src/app/actions.js`.
  - Stores one `colorTexture`, one `sourceDepthPixels`, and raster segment data directly on `renderState`.
  - Rendered as one mesh in `buildMesh()`.
- `psd`
  - Loaded by `loadPsdModel()` in `src/app/createApp.js`, then `loadPsdPair()` in `src/psd/loader.js`.
  - `loadPsdPair()` reads both the color PSD and the depth PSD or stable depth PNG.
  - The old layer-entry builder in `src/psd/layers.js` flattened color layers, flattened depth layers, matched them, split fallback stable depth, repaired depth, created textures, created masks, and returned render-ready PSD layer entries.
  - Rendered by the PSD-specific mesh builder in `src/scene/meshBuilder.js`.

This means the source decoding, color-depth pairing, depth splitting, layer repair, render texture preparation, and app state wiring are coupled together.

## Problems With The Current Shape

In the original shape, `sourceMode` was doing too much.

It currently means all of these at once:

- Whether the source came from PNG/JPG or PSD.
- Whether the scene has one layer or many layers.
- Which UI controls are enabled.
- Which render path is used.
- Which debug/export/puppet behavior applies.

The old PSD layer-entry builder was also doing too much. It combined:

- PSD color layer extraction.
- PSD depth layer extraction.
- Color/depth layer matching.
- Stable depth PNG splitting into layer-local depth.
- Depth cleanup and inpainting.
- Texture creation.
- Debug preview creation.
- Final app layer entry construction.

As a result, adding combinations such as PSD color + PNG depth is possible only as a PSD-specific fallback, not as a general A:N + B:1 composition rule.

## Proposed Model

Introduce source plugins that decode each input into normalized source composites.

```text
ColorSourcePlugin
  decode(input) -> ColorComposite

DepthSourcePlugin
  decode(input) -> DepthComposite
```

The decoded forms should be format-neutral:

```text
ColorComposite
  width
  height
  layers[]
    id
    name
    sourceIndex
    left
    top
    width
    height
    canvas
    imageData
    alphaMask
    surfaceMask

DepthComposite
  width
  height
  layers[]
    id
    name
    sourceIndex
    left
    top
    width
    height
    pixels
    alphaMask
    canvas?
    imageData?
```

Then add a compositor:

```text
composeLayeredSource(colorComposite, depthComposite, options) -> ComposedSource
```

The composed output is the app backend. It should contain source pairing data plus user-editable layer parameters that are part of the model state:

```text
ComposedSource
  width
  height
  mode
  colorSource
  depthSource
  globalDepthScale
  globalDepthCentroid
  layers[]
    id
    name
    sourceIndices
    left
    top
    width
    height
    colorCanvas
    colorImageData
    colorTexture
    depthPixels
    baseDepthPixels
    renderDepthMask
    maskPixels
    surfaceMaskPixels
    visible
    depthOffset
    depthScale
    outlierPruneEnabled
    puppetFitEnabled
    puppetBindingOverride
    debug metadata
```

Do not put transient renderer resources in `ComposedSource`. `THREE.Texture`, `THREE.Mesh`, `ShaderMaterial`, overlay objects, and current hover/selection resources belong to `renderState` or a scene resource cache. `ComposedSource` should be serializable or close to serializable, except for source canvases/image data that still come from decoded browser assets.

This means `globalDepthScale`, layer visibility, layer depth offset, and layer depth scale belong to `ComposedSource`, not `renderState`. They are backend state, not scene resources.

## Matching And Splitting Rules

### N:N

When both color and depth composites have multiple layers:

1. Match by exact normalized identity:
   - name
   - left
   - top
   - width
   - height
2. If exact identity fails, match by normalized name.
3. If names are absent on both sides, match by rectangle overlap and fallback order.
4. Unmatched color layers get an empty depth layer and a warning.
5. Unmatched depth layers are ignored at first, but should be reported in debug stats.

The existing matching helpers in `src/psd/layers.js` can be moved into the compositor because they are not PSD-specific once both sources have layer metadata.

### N:1

When color has N layers and depth has one flat layer:

1. Build a visible color layer map from the color layers.
2. For each color layer, sample the global depth pixels into the layer's local rectangle.
3. Keep only pixels covered by the layer mask.
4. Suppress depth from upper visible layers where needed.
5. Run the existing foreign-depth pruning, contour cleanup, inpainting, and smoothing.

This is the generalized form of the current `stableDepthPixels` fallback in `src/psd/layers.js`.

### 1:1

When both sides have one layer:

1. Validate dimensions or resample by an explicit policy.
2. Use the color alpha as `maskPixels`.
3. Use the depth pixels directly.
4. Produce one composed layer.

This is the current raster path represented as one layer.

### 1:N

Initial policy should be unsupported unless there is a concrete product need.

Reason: a single flat color image does not contain enough information to split color into N semantically useful layers. If this becomes required, add an explicit split policy:

- derive color layer masks from depth layer alpha;
- or require an external segmentation map;
- or flatten depth layers before composing.

## Suggested Module Boundaries

Add new modules:

- `src/composite/colorSources.js`
  - Decode flat image color and PSD color into `ColorComposite`.
- `src/composite/depthSources.js`
  - Decode flat image depth and PSD depth into `DepthComposite`.
- `src/composite/compose.js`
  - Implement N:N, N:1, and 1:1 composition.
- `src/composite/layerMatch.js`
  - Move layer matching helpers out of `src/psd/layers.js`.
- `src/composite/depthSplit.js`
  - Move stable-depth splitting and foreign-depth pruning out of `src/psd/layers.js`.
- `src/composite/prepareLayers.js`
  - Convert `ComposedSource` backend state into render-prepared layer snapshots and GPU resources.
  - Apply `ComposedSource.globalDepthScale`, `layer.visible`, `layer.depthOffset`, and `layer.depthScale` when preparing render data.

Keep PSD-specific code in `src/psd/`:

- PSD decoding with `agPsd.readPsd`.
- PSD alpha and mask normalization.
- PSD export with `agPsd.writePsd`.

Move non-PSD-specific logic out of `src/psd/layers.js`:

- layer matching;
- N:1 depth splitting;
- depth cleanup;
- generic layer entry preparation;
- generic debug stats.

## Backend And Render-State Split

The target split is:

```text
ComposedSource
  Persistent backend state:
    source composition mode
    source metadata
    layer base data
    globalDepthScale
    per-layer visible
    per-layer depthOffset
    per-layer depthScale
    per-layer cleanup/puppet binding settings

renderState
  Temporary app/runtime state:
    current model selection
    current object URLs and pending buffers
    THREE meshes/textures/materials
    prepared render layer snapshots
    hover/selection/drag state
    debug panel selection
    mesh edit history if it is not yet promoted into backend data
```

`renderState.composedSource` can remain as the current active backend pointer. `renderState.layerEntries` should become either:

- an alias to `renderState.composedSource.layers` while migration is in progress; or
- a short-lived prepared snapshot derived from `ComposedSource`, renamed to make that explicit.

The long-term invariant should be: changing visibility, depth offset, depth scale, global depth scale, outlier prune, or puppet layer fit updates `ComposedSource` first. Rendering then derives scene resources from that backend state.

Consumers moved from PSD-specific entries to `layerEntries`:

- `src/scene/meshBuilder.js`
- `src/dom/segmentPanel.js`
- `src/dom/meshEditPanel.js`
- `src/psd/debug.js`
- `src/puppet/runtime.js`
- `src/puppet/bodyMask.js`
- `src/puppet/rigTemplate.js`
- `src/app/resources.js`

`sourceMode` is now limited to UI/catalog selection. Rendering should ultimately depend on `renderState.composedSource`, then on prepared render snapshots derived from it.

## Implementation State

The current branch implements the shared composite path with these boundaries:

1. `src/composite/colorSources.js` decodes flat image and PSD color sources into `ColorComposite`.
2. `src/composite/depthSources.js` decodes flat image and PSD depth sources into `DepthComposite`.
3. `src/composite/compose.js` creates `ComposedSource` for 1:1, N:N, and N:1, and rejects 1:N.
4. `src/psd/layers.js` now exposes `createLayerEntries()` and consumes `ComposedSource` plus PSD document context for the remaining PSD-specific repair, preview, and export-compatible preparation.
5. `renderState.layerEntries` is the render source for both raster PNG+PNG and layered PSD-backed sources.
6. `buildMesh()` routes layer entries through `buildLayerMeshes()` instead of branching first on `sourceMode`.
7. Puppet, mesh edit, segment UI, layer debug, and resource counts consume `layerEntries`.

Backend parameters now live on `ComposedSource`, not on parallel arrays in `renderState`.

- `ComposedSource.globalDepthScale` stores the persistent global scale.
- `ComposedSource.globalDepthCentroid` stores the latest derived centroid from preparation.
- `ComposedSource.layers[].visible` stores layer visibility.
- `ComposedSource.layers[].depthOffset` stores per-layer depth offset.
- `ComposedSource.layers[].depthScale` stores per-layer depth scale.
- `ComposedSource.layers[].outlierPruneEnabled` stores per-layer contour cleanup policy.
- `ComposedSource.layers[].puppetFitEnabled` stores per-layer puppet fitting policy.
- `ComposedSource.layers[].puppetBindingOverride` stores per-layer puppet binding overrides.

Renderer-owned arrays such as `layerMeshes` and `layerDebugMeshes` stay in `renderState` or a scene resource module. They are not part of the backend.

The implemented state split is:

```text
renderState.composedSource
  .globalDepthScale
  .globalDepthCentroid
  .layers[].visible
  .layers[].depthOffset
  .layers[].depthScale
  .layers[].outlierPruneEnabled
  .layers[].puppetFitEnabled
  .layers[].puppetBindingOverride

renderState
  .layerMeshes
  .layerDebugMeshes
  .preparedLayerEntries
```

`ComposedSource` is the backend. `renderState` is the active renderer/session state around that backend.

## Open Decisions

- Should PNG color + PSD depth be unsupported, flatten depth PSD, or require an explicit segmentation policy?
- Should layer matching preserve current PSD-specific name normalization exactly?
- Should dimensions be required to match, or should the compositor support resampling?
- Should export target always be depth PSD, or should export be a plugin too?
- Should mesh edit handles become backend data under `ComposedSource.layers[].meshEdit`, or remain session-only until the edit model is formalized?

## Current Decisions

- Keep the existing model catalog and source-format UI initially. The backend now records independent color/depth composites, but the UI can continue loading known model pairs until the source plugin flow is stable.
- Treat PNG color + PSD depth as unsupported for now. A single flat color image needs an explicit split policy before multiple semantic depth layers can be useful.
- Require matching color/depth composite dimensions for now. Resampling can be added later as an explicit compositor policy.
- Keep depth PSD export scoped to PSD-backed color documents for now. PNG+PNG can be exported later through a separate flat depth image exporter or a synthetic one-layer PSD policy.
- Move persistent layer controls into `ComposedSource`. `renderState` should keep only temporary renderer/session data.
