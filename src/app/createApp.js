import {
  createDefaultAssetUrls,
  invalidDepthThreshold,
  relativeDepthFactor,
  relativeDepthFloor,
  segmentAnchorDistance,
  segmentDepthOffsetStep,
  segmentDepthScaleStep,
  segmentMergeThresholdRatio,
  segmentMinAnchorPixels,
  segmentMinAnchorRatio,
} from "./constants.js";
import { createAppActions } from "./actions.js";
import { createAppResources } from "./resources.js";
import { createRenderState } from "./state.js";
import { createDepthCore } from "../depth/core.js";
import { wireControls } from "../dom/controls.js";
import { getViewerElements } from "../dom/elements.js";
import { createSegmentPanel } from "../dom/segmentPanel.js";
import {
  createSegmentThumbDataUrl,
  syncThumbs as syncThumbsView,
  syncViewerModeUi as syncViewerModeUiView,
} from "../dom/thumbs.js";
import { createImageLoaders } from "../io/imageLoader.js";
import { revokeObjectUrl as revokeObjectUrlState } from "../io/objectUrls.js";
import { updatePsdDebugPanel as updatePsdDebugPanelView } from "../psd/debug.js";
import { createPsdExport } from "../psd/export.js?v=20260408_1";
import { createPsdLayers } from "../psd/layers.js?v=20260408_4";
import { createPsdLoader } from "../psd/loader.js?v=20260408_3";
import { initializePsdSupport } from "../psd/psdSupport.js";
import { createGeometryHelpers } from "../scene/geometry.js?v=20260408_3";
import { createSceneBuilder } from "../scene/meshBuilder.js?v=20260408_1";
import { createSceneRuntime } from "../scene/runtime.js";
import { createShaders } from "../scene/shaders.js";
import { createThreeContext } from "../scene/threeContext.js";
import { createSegmentAnalysis } from "../segments/analysis.js";
import { createSegmentDepthRuntime } from "../segments/segmentDepth.js";
import { createSegmentRuntime } from "../segments/segmentRuntime.js";

export function createApp() {
  const THREE = globalThis.THREE;
  const agPsd = globalThis.agPsd;
  const elements = getViewerElements();
  const {
    app,
    statusEl,
    depthScaleEl,
    depthScaleValueEl,
    meshDetailEl,
    meshDetailValueEl,
    depthDiscontinuityEl,
    depthDiscontinuityValueEl,
    invertDepthEl,
    sourceModeEl,
    contourRepairEl,
    surfaceSmoothEl,
    depthModeEl,
    gridSpecModeEl,
    gridXEl,
    gridYEl,
    gridXValueEl,
    gridYValueEl,
    kernelSizeEl,
    kernelSizeValueEl,
    interpModeEl,
    segmentListEl,
    segmentHudEl,
    colorThumbButtonEl,
    depthThumbButtonEl,
    segmentThumbButtonEl,
    saveDepthPsdButtonEl,
    colorThumbEl,
    depthThumbEl,
    segmentThumbEl,
    colorFileInputEl,
    depthFileInputEl,
    segmentFileInputEl,
    psdDebugPanelEl,
    psdDebugTitleEl,
    psdDebugImageEl,
    psdDepthImageEl,
  } = elements;

  const defaults = createDefaultAssetUrls();
  const renderState = createRenderState();
  const { renderer, scene, camera, controls } = createThreeContext(THREE, app);
  const { onResize, animate } = createSceneRuntime({ renderer, scene, camera, controls });
  const { loadTexture, loadImage, loadImagePixels, loadDepthPixels, loadRgbPixels } = createImageLoaders(THREE);
  const depthCore = createDepthCore(THREE);
  const {
    clamp,
    composeSegmentDepthResources,
    preprocessSegmentDepths,
    createSegmentedGridDepthResources,
    createGridDepthResources,
    createMaskedGridDepthPixels,
    createDepthTextureResources,
    createBinaryMaskTexture,
  } = depthCore;
  const geometry = createGeometryHelpers({
    THREE,
    invalidDepthThreshold,
    relativeDepthFactor,
    relativeDepthFloor,
    renderState,
    createDepthTextureResources,
    elements: {
      depthDiscontinuityEl,
      contourRepairEl,
    },
  });
  const {
    buildMaskedPlaneGeometry,
    buildRenderedBoundaryPointGeometry,
    buildPsdLayerGeometry,
    computeSegmentDepthMeans,
    repairDepthDiscontinuities,
  } = geometry;
  const shaders = createShaders(invalidDepthThreshold);
  const segmentAnalysis = createSegmentAnalysis({
    segmentAnchorDistance,
    segmentMinAnchorPixels,
    segmentMinAnchorRatio,
    segmentMergeThresholdRatio,
  });
  const { clusterSegmentPixels } = segmentAnalysis;

  initializePsdSupport(agPsd);

  const resources = createAppResources({
    renderState,
    elements: {
      statusEl,
      depthModeEl,
      interpModeEl,
    },
  });
  const {
    refreshStatusCounts,
    disposeGeneratedDepthTexture,
    disposeAdjustedDepthTexture,
    disposeRepairedBaseDepthTexture,
    disposeMeshDepthTexture,
    disposeProcessedDepthTexture,
    disposeRawDepthTexture,
  } = resources;

  const segmentDepthRuntime = createSegmentDepthRuntime({
    renderState,
    depthDiscontinuityEl,
    createDepthTextureResources,
    computeSegmentDepthMeans,
    repairDepthDiscontinuities,
    clamp,
    disposeAdjustedDepthTexture,
  });
  const {
    applySegmentDepthAdjustments,
    rebuildRepairedBaseDepth,
    updateSegmentMaskTexture,
    disposeSegmentMaskTexture,
  } = segmentDepthRuntime;

  const psdLayers = createPsdLayers({
    THREE,
    createMaskedGridDepthPixels,
    createDepthTextureResources,
    createBinaryMaskTexture,
    clamp,
    elements: {
      depthDiscontinuityEl,
      contourRepairEl,
      depthModeEl,
      gridSpecModeEl,
      gridXEl,
      gridYEl,
      kernelSizeEl,
      interpModeEl,
    },
  });
  const {
    createPsdLayerEntries,
    flattenPsdLayers,
    getCanvasImageData,
    createPsdDepthPreviewUrl,
  } = psdLayers;

  const sceneBuilder = createSceneBuilder({
    THREE,
    scene,
    renderState,
    elements: {
      meshDetailEl,
      surfaceSmoothEl,
      depthScaleEl,
      invertDepthEl,
    },
    shaders,
    createDepthTextureResources,
    createBinaryMaskTexture,
    clamp,
    buildPsdLayerGeometry,
    createPsdDepthPreviewUrl,
  });
  const { clearSceneVisuals, buildPsdLayerMeshes, buildPreparedPsdLayerEntries } = sceneBuilder;

  const psdLoader = createPsdLoader({
    agPsd,
    renderState,
    defaults,
    loadImagePixels,
    createPsdLayerEntries,
    disposePsdLayerTextures: psdLoaderDispose,
    flattenPsdLayers,
    getCanvasImageData,
    rebuildSegmentList: () => rebuildSegmentList(),
    updatePsdDebugPanel,
  });
  const {
    ensureDefaultPsdPairLoaded,
    loadPsdPair,
    rebuildPsdLayerEntriesIfNeeded,
  } = psdLoader;

  const psdExport = createPsdExport({
    agPsd,
    renderState,
    statusEl,
    buildPreparedPsdLayerEntries,
  });
  const { saveCurrentPsdDepthAsPsd } = psdExport;

  let rebuildSegmentList = () => {};
  const segmentRuntime = createSegmentRuntime({
    THREE,
    renderState,
    clusterSegmentPixels,
    composeSegmentDepthResources,
    preprocessSegmentDepths,
    rebuildSegmentList: () => rebuildSegmentList(),
    disposeSegmentMaskTexture,
    disposeRawDepthTexture,
    disposeProcessedDepthTexture,
    updateSegmentMaskTexture,
  });
  const { rebuildSegments } = segmentRuntime;

  function syncThumbs() {
    syncThumbsView(
      { colorThumbEl, depthThumbEl, segmentThumbEl },
      renderState,
      {
        defaultColorUrl: defaults.defaultColorUrl,
        defaultDepthUrl: defaults.defaultDepthUrl,
        defaultSegmentUrl: defaults.defaultSegmentUrl,
      },
    );
  }

  function syncViewerModeUi() {
    syncViewerModeUiView({ segmentHudEl, segmentThumbButtonEl }, renderState);
  }

  function revokeObjectUrl(kind) {
    revokeObjectUrlState(renderState, kind);
  }

  function updatePsdDebugPanel() {
    updatePsdDebugPanelView(
      { psdDebugPanelEl, psdDebugTitleEl, psdDebugImageEl, psdDepthImageEl },
      renderState,
    );
  }

  const { buildMesh, replaceImage, rebuildDepthModeResources } = createAppActions({
    THREE,
    scene,
    renderState,
    elements: {
      depthScaleEl,
      invertDepthEl,
      meshDetailEl,
      surfaceSmoothEl,
      sourceModeEl,
      statusEl,
      depthModeEl,
      gridSpecModeEl,
      gridXEl,
      gridYEl,
      kernelSizeEl,
      interpModeEl,
    },
    shaders,
    defaults,
    disposeMeshDepthTexture,
    clearSceneVisuals,
    buildPsdLayerMeshes,
    refreshStatusCounts,
    buildMaskedPlaneGeometry,
    buildRenderedBoundaryPointGeometry,
    loadPsdPair,
    syncViewerModeUi,
    syncThumbs,
    revokeObjectUrl,
    loadTexture,
    loadDepthPixels,
    loadRgbPixels,
    rebuildSegments,
    rebuildSegmentList: () => rebuildSegmentList(),
    createSegmentThumbDataUrl,
    disposeGeneratedDepthTexture,
    disposeAdjustedDepthTexture,
    disposeRepairedBaseDepthTexture,
    createSegmentedGridDepthResources,
    rebuildRepairedBaseDepth,
  });

  const segmentPanel = createSegmentPanel({
    elements: { segmentListEl },
    renderState,
    segmentDepthOffsetStep,
    segmentDepthScaleStep,
    buildMesh,
    refreshStatusCounts,
    updateSegmentMaskTexture,
    updatePsdDebugPanel,
    rebuildPsdLayerEntriesIfNeeded,
    applySegmentDepthAdjustments,
    onError: (error) => {
      console.error(error);
      statusEl.textContent = `Failed: ${error.message}`;
    },
  });
  rebuildSegmentList = segmentPanel.rebuildSegmentList;

  wireControls({
    elements: {
      statusEl,
      depthScaleEl,
      depthScaleValueEl,
      meshDetailEl,
      meshDetailValueEl,
      depthDiscontinuityEl,
      depthDiscontinuityValueEl,
      invertDepthEl,
      sourceModeEl,
      contourRepairEl,
      surfaceSmoothEl,
      depthModeEl,
      gridSpecModeEl,
      gridXEl,
      gridYEl,
      gridXValueEl,
      gridYValueEl,
      kernelSizeEl,
      kernelSizeValueEl,
      interpModeEl,
      colorThumbButtonEl,
      depthThumbButtonEl,
      segmentThumbButtonEl,
      saveDepthPsdButtonEl,
      colorFileInputEl,
      depthFileInputEl,
      segmentFileInputEl,
    },
    renderState,
    syncViewerModeUi,
    syncThumbs,
    buildMesh,
    rebuildPsdLayerEntriesIfNeeded,
    rebuildDepthModeResources,
    applySegmentDepthAdjustments,
    rebuildSegmentList: () => rebuildSegmentList(),
    updatePsdDebugPanel,
    ensureDefaultPsdPairLoaded,
    saveCurrentPsdDepthAsPsd,
    replaceImage,
    onResize,
  });

  init().catch((error) => {
    console.error(error);
    statusEl.textContent = `Failed: ${error.message}`;
  });

  async function init() {
    const [colorTexture, depthTexture, depthPixels, segmentImage] = await Promise.all([
      loadTexture(defaults.defaultColorUrl),
      loadTexture(defaults.defaultDepthUrl),
      loadDepthPixels(defaults.defaultDepthUrl),
      loadRgbPixels(defaults.defaultSegmentUrl),
    ]);

    const imageWidth = colorTexture.image.width;
    const imageHeight = colorTexture.image.height;

    if (imageWidth !== depthTexture.image.width || imageHeight !== depthTexture.image.height) {
      throw new Error("Color and depth image sizes do not match.");
    }
    if (imageWidth !== segmentImage.width || imageHeight !== segmentImage.height) {
      throw new Error("Segment image size must match the color/depth images.");
    }

    colorTexture.encoding = THREE.sRGBEncoding;
    colorTexture.minFilter = THREE.LinearFilter;
    colorTexture.magFilter = THREE.LinearFilter;
    depthTexture.minFilter = THREE.LinearFilter;
    depthTexture.magFilter = THREE.LinearFilter;

    renderState.colorTexture = colorTexture;
    renderState.sourceDepthTexture = depthTexture;
    renderState.sourceDepthPixels = depthPixels;
    renderState.segmentSourcePixels = segmentImage.pixels;
    renderState.imageWidth = imageWidth;
    renderState.imageHeight = imageHeight;
    renderState.rasterImageWidth = imageWidth;
    renderState.rasterImageHeight = imageHeight;
    renderState.segmentThumbUrl = createSegmentThumbDataUrl(renderState.segmentSourcePixels, imageWidth, imageHeight);

    rebuildSegments();
    rebuildDepthModeResources();
    sourceModeEl.value = "psd";
    renderState.sourceMode = "psd";
    statusEl.textContent = "Loading PSD pair...";
    await ensureDefaultPsdPairLoaded();
    syncViewerModeUi();
    rebuildSegmentList();
    buildMesh();
    syncThumbs();
    updatePsdDebugPanel();
    onResize();
    animate();
  }

  function psdLoaderDispose() {
    for (let i = 0; i < renderState.psdLayerEntries.length; i += 1) {
      const layer = renderState.psdLayerEntries[i];
      if (layer.colorTexture) {
        layer.colorTexture.dispose();
      }
      if (layer.depthTexture) {
        layer.depthTexture.dispose();
      }
      if (layer.maskTexture) {
        layer.maskTexture.dispose();
      }
      if (layer.debugTexture) {
        layer.debugTexture.dispose();
      }
    }
    renderState.psdLayerEntries = [];
  }

  return { renderState };
}
