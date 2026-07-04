# Composite Source Refactor Tasks

## Phase 1: Define The Shared Model

- [x] Add `src/composite/` directory.
- [x] Define `ColorComposite`, `DepthComposite`, `ComposedSource`, and `ComposedLayer` in comments or JSDoc.
- [x] Add helpers for creating a single-layer composite from flat image inputs.
- [x] Add helpers for creating layered composites from PSD documents.
- [x] Add unit-style browser-safe assertions for dimensions, layer bounds, and pixel array lengths.

## Phase 2: Extract Source Decoders

- [x] Move PSD layer flattening from `src/psd/layers.js` into a reusable decoder helper.
- [x] Keep `agPsd.readPsd` and PSD bitmap/mask normalization in `src/psd/loader.js` or a PSD-specific module.
- [x] Add a color source decoder for PNG/JPG that returns one `ColorComposite` layer.
- [x] Add a color source decoder for PSD that returns N `ColorComposite` layers.
- [x] Add a depth source decoder for PNG/JPG that returns one `DepthComposite` layer.
- [x] Add a depth source decoder for PSD that returns N `DepthComposite` layers.
- [x] Update `loadRasterModel()` and `loadPsdModel()` to call source decoders instead of writing final render fields directly.

## Phase 3: Extract Layer Matching

- [x] Move `buildPsdLayerLookup()`, `takeMatchedPsdLayer()`, `scorePsdLayerMatch()`, and rectangle-overlap helpers out of `src/psd/layers.js`.
- [x] Rename them to format-neutral names.
- [x] Preserve the current matching order:
  - exact normalized identity;
  - normalized name;
  - unnamed rectangle overlap;
  - fallback index.
- [x] Add debug output for unmatched color layers.
- [x] Add debug output for unused depth layers.

## Phase 4: Extract N:1 Depth Splitting

- [x] Move stable-depth splitting logic out of `src/psd/layers.js`.
- [x] Generalize it from `stableDepthPixels` to `DepthComposite` with one layer.
- [x] Move or wrap these current helpers:
  - `buildVisiblePsdLayerMap`
  - `seedPsdLayerDepthPixels`
  - `prunePsdForeignDepthSeeds`
  - `collectPsdForeignVisibleDepthSupport`
  - `hasUpperLayerMaskNearby`
- [x] Rename PSD-specific helper names to color/depth layer names.
- [x] Keep the existing contour cleanup and inpaint behavior unchanged.
- [x] Verify PSD color + stable PNG depth renders through the extracted N:1 path.

## Phase 5: Add The Compositor

- [x] Implement `composeLayeredSource(colorComposite, depthComposite, options)`.
- [x] Support 1:1 as one composed layer.
- [x] Support N:N with layer matching.
- [x] Support N:1 with depth splitting.
- [x] Reject 1:N with a clear error unless a flatten-depth policy is explicitly chosen.
- [x] Return a `ComposedSource` without Three.js textures first.
- [x] Add a second preparation step that creates `colorTexture`, `depthTexture`, `maskTexture`, previews, and debug metadata.

## Phase 6: Move Render Preparation Out Of PSD

- [x] Split the old PSD layer-entry flow into:
  - source decoding;
  - composition;
  - layer preparation.
- [x] Move generic depth cleanup helpers from `src/psd/layers.js` to `src/composite/`.
- [x] Leave PSD preview/export-only helpers in `src/psd/`.
- [x] Remove the temporary `createPsdLayerEntries()` compatibility name.
- [x] Preserve the existing PSD layer preparation behavior while feeding it from `ComposedSource`.

## Phase 7: Unify Render State

- [x] Add `renderState.composedSource`.
- [x] Add `renderState.layerEntries`.
- [x] Migrate consumers directly to `renderState.layerEntries` without keeping a `psdLayerEntries` alias.
- [x] Represent raster PNG+PNG as `layerEntries.length === 1`.
- [x] Stop using `sourceDepthPixels` and `activeDepthPixels` as the primary render source once raster is layered.
- [x] Keep old raster fields only for UI thumbnails and compatibility until all consumers are migrated.

## Phase 8: Unify Rendering

- [x] Change `buildMesh()` so it does not branch first on `sourceMode`.
- [x] Make the single-layer raster path use the same layer-entry mesh builder as PSD layers, or split only on layer count.
- [x] Rename `buildPsdLayerMeshes()` to `buildLayerMeshes()`.
- [x] Rename `buildPreparedPsdLayerEntries()` to `buildPreparedLayerEntries()`.
- [x] Confirm mesh edit target keys work for both single-layer and multi-layer sources.
- [x] Confirm puppet code ignores or gracefully handles one-layer flat sources.

## Phase 9: Update UI And App Loading

- [x] Replace source-mode assumptions with independent color/depth source metadata.
- [x] Update `syncViewerModeUi()` so UI state is based on layer capabilities, not PSD mode.
- [x] Update `segmentPanel` so layer controls work against `layerEntries`.
- [x] Update thumbnails so color and depth previews come from the selected source plugins.
- [x] Decide whether the UI should expose independent source selectors now or keep the current model catalog shape initially.

## Phase 10: Export And Debug

- [x] Keep `src/psd/export.js` as a PSD depth exporter, but feed it `layerEntries` instead of `psdLayerEntries`.
- [x] Decide how PNG+PNG single-layer export should behave.
- [x] Rename PSD debug concepts that are now generic layer debug concepts.
- [x] Keep PSD-specific alpha/mask debug panels only where they are actually PSD-specific.
- [x] Add debug stats for composition mode:
  - `1:1`
  - `N:N`
  - `N:1`
  - rejected `1:N`

## Phase 11: Cleanup

- [x] Remove the compatibility wrapper around `createPsdLayerEntries()`.
- [x] Rename `psdLayerEntries` to `layerEntries` everywhere.
- [x] Reduce `sourceMode` to UI/catalog metadata or remove it.
- [x] Keep raster-only depth fields that are still needed for thumbnails, replacement flows, and segment compatibility.
- [x] Update README with the new source-composition model.

## Phase 12: Promote ComposedSource To Backend State

- [x] Treat `ComposedSource` as the backend model, not only the source pairing result.
- [x] Add `ComposedSource.globalDepthScale`.
- [x] Add `ComposedSource.globalDepthCentroid` as derived output from preparation.
- [x] Add per-layer backend fields:
  - `visible`
  - `depthOffset`
  - `depthScale`
  - `outlierPruneEnabled`
  - `puppetFitEnabled`
  - `puppetBindingOverride`
- [x] Initialize these fields in `composeLayeredSource()` for all modes:
  - `1:1`
  - `N:N`
  - `N:1`
- [x] Preserve previous layer backend settings by layer identity when reloading or recomposing.
- [x] Move `renderState.globalDepthScale` reads/writes to `renderState.composedSource.globalDepthScale`.
- [x] Move `renderState.psdLayerVisibility[]` reads/writes to `renderState.composedSource.layers[].visible`.
- [x] Move `renderState.psdLayerDepthOffsets[]` reads/writes to `renderState.composedSource.layers[].depthOffset`.
- [x] Move `renderState.psdLayerDepthScales[]` reads/writes to `renderState.composedSource.layers[].depthScale`.
- [x] Move `renderState.psdLayerOutlierPruneEnabled[]` reads/writes to `renderState.composedSource.layers[].outlierPruneEnabled`.
- [x] Move `renderState.puppetLayerFitEnabled[]` and `renderState.puppetLayerBindingOverrides[]` to `ComposedSource` layer backend fields.
- [x] Update `buildPreparedLayerEntries()` so it consumes backend fields from `ComposedSource`, not parallel arrays on `renderState`.
- [x] Update `segmentPanel` so visibility, offset, scale, prune, rig toggles mutate `ComposedSource` first.
- [x] Update `controls` so Global depth scale mutates `ComposedSource`.
- [x] Update PSD export so hidden flags and adjusted depths come from prepared data derived from `ComposedSource`.
- [x] Rename renderer-only arrays:
  - `psdLayerMeshes` -> `layerMeshes`
  - `psdLayerDebugMeshes` -> `layerDebugMeshes`
- [x] Keep renderer-owned `THREE.Texture`, `THREE.Mesh`, material, overlay, hover, and drag state out of `ComposedSource`.
- [x] Keep mesh edit handles as session-only state in `renderState` for now.
- [x] Add helper accessors during migration:
  - `getLayerVisible(composedSource, index)`
  - `setLayerVisible(composedSource, index, value)`
  - `getLayerDepthOffset(composedSource, index)`
  - `setLayerDepthOffset(composedSource, index, value)`
  - `getLayerDepthScale(composedSource, index)`
  - `setLayerDepthScale(composedSource, index, value)`
- [x] Remove obsolete parallel arrays from `renderState` after all consumers migrate.

## Validation Checklist

- [x] `node --check` passes for all `src/**/*.js`.
- [x] Static import resolution from `src/main.js` reaches all local modules.
- [x] Compositor unit-style checks pass for 1:1, N:N, N:1, and rejected 1:N.
- [x] Browser validation runs without CDN access by loading Three.js from local `node_modules`.
- [x] PNG color + PNG depth loads and renders as one layer.
- [x] PSD color + PSD depth loads and renders as matched layers.
- [x] PSD color + PNG depth splits depth into color layers.
- [x] Missing depth layer in N:N gives an empty layer and warning, not a crash.
- [x] Layer visibility still controls rendering.
- [x] Layer depth offset and scale still work.
- [x] Global depth scale still works.
- [x] PSD depth export preserves layer names, positions, visibility, and alpha-weighted depth.
- [x] Puppet rig generation still works for layered sources.
- [x] Mesh edit undo/redo still works after changing source combinations.

Validated with Playwright against local Chrome:

- Raster `Aka-20260615`: `composeMode=1:1`, `layerCount=1`, `meshCount=1`, target `raster:base`.
- PSD color + PNG depth `Midori-20260621-color-psd-depth.png`: `composeMode=N:1`, `layerCount=19`, `meshCount=19`.
- PSD color + PSD depth `Midori-20260621-color-psd-depth.psd`: `composeMode=N:N`, `layerCount=19`, `meshCount=19`, 11 missing-depth diagnostics/warnings without crash.
- Visibility toggle changed mesh count `19 -> 18 -> 19`.
- Layer controls changed first layer offset `0 -> 6` and scale `1 -> 1.1`.
- Global depth scale changed `1 -> 1.5`.
- Puppet generated a rig with 19 bones and 19 layer bindings.
- Mesh edit undo/redo changed handle count `1 -> 0 -> 1`.
- PSD export produced a non-empty PSD buffer, preserved 29 source layer names/positions, and verified an alpha-weighted depth sample.

## Phase 12 Validation Checklist

- [x] Changing Global depth scale updates `ComposedSource.globalDepthScale` and rebuilds the same visual result.
- [x] Toggling layer visibility updates `ComposedSource.layers[].visible` and changes rendered mesh count.
- [x] Changing per-layer offset updates `ComposedSource.layers[].depthOffset` and affects prepared depth.
- [x] Changing per-layer scale updates `ComposedSource.layers[].depthScale` and affects prepared depth.
- [x] Recompose/reload preserves backend settings by stable layer identity where possible.
- [x] PSD export uses visibility and adjusted depth derived from `ComposedSource`.
- [x] No remaining production reads of `renderState.psdLayerVisibility`, `renderState.psdLayerDepthOffsets`, `renderState.psdLayerDepthScales`, or `renderState.globalDepthScale`.
- [x] `renderState` still owns and disposes only temporary renderer/session resources.

Validated Phase 12 with Playwright against local Chrome:

- Raster `Aka-20260615`: `composeMode=1:1`, `layerEntries === composedSource.layers`, no obsolete layer-control arrays on `renderState`.
- PSD color + PNG depth `Midori-20260621-color-psd-depth.png`: `composeMode=N:1`, `layerEntries === composedSource.layers`, no obsolete layer-control arrays on `renderState`.
- Layer visibility updated `ComposedSource.layers[0].visible` and changed mesh count `19 -> 18 -> 19`.
- Layer controls updated `ComposedSource.layers[0].depthOffset` `0 -> 6` and `depthScale` `1 -> 1.1`.
- Global depth scale updated `ComposedSource.globalDepthScale` `1 -> 1.5`.
- Recompose preserved backend settings: global scale `1.7`, layer offset `12`, layer scale `1.2`.
- PSD color + PSD depth `Midori-20260621-color-psd-depth.psd`: `composeMode=N:N`, `layerEntries === composedSource.layers`, 11 missing-depth diagnostics/warnings without crash.
- PSD export produced a non-empty PSD buffer, preserved 29 source layer names/positions, and verified an alpha-weighted depth sample.
