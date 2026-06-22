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
import { createAppActions } from "./actions.js?v=20260622_1";
import { createAppResources } from "./resources.js";
import { createRenderState } from "./state.js?v=20260622_1";
import { createDepthCore } from "../depth/core.js?v=20260622_1";
import { wireControls } from "../dom/controls.js?v=20260622_1";
import { getViewerElements } from "../dom/elements.js?v=20260622_1";
import { createPuppetPanel } from "../dom/puppetPanel.js?v=20260411_2";
import { createSegmentPanel } from "../dom/segmentPanel.js?v=20260410_2";
import {
  createSegmentThumbDataUrl,
  syncThumbs as syncThumbsView,
  syncViewerModeUi as syncViewerModeUiView,
} from "../dom/thumbs.js";
import { createImageLoaders } from "../io/imageLoader.js";
import { revokeObjectUrl as revokeObjectUrlState } from "../io/objectUrls.js";
import { updatePsdDebugPanel as updatePsdDebugPanelView } from "../psd/debug.js?v=20260621_7";
import { createPsdExport } from "../psd/export.js?v=20260622_2";
import { createPsdLayers } from "../psd/layers.js?v=20260622_3";
import { createPsdLoader } from "../psd/loader.js?v=20260622_1";
import { createPuppetRuntime } from "../puppet/runtime.js?v=20260622_1";
import { PUPPET_BONE_IDS } from "../puppet/layerBinding.js?v=20260622_1";
import { createMeshEditRuntime } from "../meshEdit/runtime.js?v=20260411_2";
import { initializePsdSupport } from "../psd/psdSupport.js";
import { createGeometryHelpers } from "../scene/geometry.js?v=20260621_12";
import { createSceneBuilder } from "../scene/meshBuilder.js?v=20260622_1";
import { createSceneRuntime } from "../scene/runtime.js?v=20260621_3";
import { createShaders } from "../scene/shaders.js?v=20260621_1";
import { createThreeContext, updateViewerCameraProjection } from "../scene/threeContext.js?v=20260621_1";
import { createSegmentAnalysis } from "../segments/analysis.js";
import { createSegmentDepthRuntime } from "../segments/segmentDepth.js";
import { createSegmentRuntime } from "../segments/segmentRuntime.js";
import { createMeshEditPanel } from "../dom/meshEditPanel.js?v=20260411_1";
import { loadGeneratedMeshDebugData } from "../debug/generatedMeshDebug.js?v=20260412_9";

export function createApp() {
  const THREE = globalThis.THREE;
  const agPsd = globalThis.agPsd;
  const elements = getViewerElements();
  const {
    app,
    statusEl,
    modelSelectEl,
    depthScaleEl,
    depthScaleValueEl,
    globalDepthScaleEl,
    globalDepthScaleValueEl,
    meshDetailEl,
    meshDetailValueEl,
    depthDiscontinuityEl,
    depthDiscontinuityValueEl,
    invertDepthEl,
    sourceModeEl,
    contourRepairEl,
    surfaceSmoothEl,
    generatedMeshDebugEnabledEl,
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
    puppetSwapSidesButtonEl,
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
    puppetBodyMaskImageEl,
    puppetSkeletonImageEl,
    meshEditPanelEl,
    meshEditEnabledEl,
    meshEditAddModeEl,
    meshEditTargetEl,
    meshEditRadiusEl,
    meshEditRadiusValueEl,
    meshEditUndoButtonEl,
    meshEditRedoButtonEl,
    meshEditResetButtonEl,
  } = elements;

  const defaults = createDefaultAssetUrls();
  const renderState = createRenderState();
  globalThis.__depthDrawRenderState = renderState;
  const { renderer, scene, camera, controls } = createThreeContext(THREE, app);
  globalThis.__depthDrawRenderer = renderer;
  globalThis.__depthDrawCamera = camera;
  globalThis.__depthDrawControls = controls;
  const { onResize, animate } = createSceneRuntime({
    renderer,
    scene,
    camera,
    controls,
    updateViewerCameraProjection,
  });
  const { loadTexture, loadImage, loadImagePixels, loadDepthPixels, loadRgbPixels } = createImageLoaders(THREE);
  let puppetPanel = null;
  let meshEditPanel = null;
  const handlePuppetUiStateChanged = () => {
    updatePsdDebugPanel();
    puppetPanel?.sync();
    meshEditPanel?.sync();
  };
  const puppetRuntime = createPuppetRuntime({
    THREE,
    scene,
    camera,
    controls,
    renderer,
    renderState,
    onStateChanged: handlePuppetUiStateChanged,
    onSwapChanged: () => {
      rebuildSegmentList();
      syncPuppetSwapButton();
    },
  });
  globalThis.__depthDrawPuppet = puppetRuntime.getDebugApi();
  const meshEditRuntime = createMeshEditRuntime({
    THREE,
    scene,
    camera,
    controls,
    renderer,
    renderState,
    onStateChanged: () => {
      meshEditPanel?.sync();
    },
    onGeometryChanged: null,
  });
  puppetPanel = createPuppetPanel({
    elements,
    puppetRuntime,
  });
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
    scaleDepthValueAroundCenter,
    applyGlobalDepthScale,
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
    applyGlobalDepthScale,
  });
  const {
    applySegmentDepthAdjustments,
    rebuildRepairedBaseDepth,
    updateSegmentMaskTexture,
    disposeSegmentMaskTexture,
  } = segmentDepthRuntime;

  const psdLayers = createPsdLayers({
    THREE,
    renderState,
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
    scaleDepthValueAroundCenter,
    buildPsdLayerGeometry,
    createPsdDepthPreviewUrl,
    puppetRuntime,
    meshEditRuntime,
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
    updatePsdDebugPanel: handlePuppetUiStateChanged,
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
    flattenPsdLayers,
    getCanvasImageData,
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
    if (!renderState.currentModel) {
      colorThumbEl.removeAttribute("src");
      depthThumbEl.removeAttribute("src");
      segmentThumbEl.removeAttribute("src");
      return;
    }

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
      { psdDebugPanelEl, psdDebugTitleEl, psdDebugImageEl, psdDepthImageEl, puppetBodyMaskImageEl, puppetSkeletonImageEl },
      renderState,
    );
  }

  function syncPuppetSwapButton() {
    if (!puppetSwapSidesButtonEl) {
      return;
    }
    const active = !!renderState.puppetSwapLeftRightMapping;
    puppetSwapSidesButtonEl.textContent = active ? "Swap L/R On" : "Swap L/R Off";
    puppetSwapSidesButtonEl.style.background = active ? "rgba(255, 180, 120, 0.28)" : "";
  }

  async function setGeneratedMeshDebugEnabled(enabled) {
    if (enabled && !renderState.generatedMeshDebugData) {
      statusEl.textContent = "Loading generated mesh debug data...";
      renderState.generatedMeshDebugData = await loadGeneratedMeshDebugData();
      const debugLayerCount = renderState.generatedMeshDebugData?.manifest?.layers?.length || 0;
      statusEl.textContent = `Loaded generated mesh debug data (${debugLayerCount} layers).`;
    }
    renderState.generatedMeshDebugEnabled = !!enabled;
    if (generatedMeshDebugEnabledEl) {
      generatedMeshDebugEnabledEl.checked = !!enabled;
    }
    buildMesh();
    if (enabled) {
      const visibleDebugLayers = renderState.psdLayerDebugMeshes?.length || 0;
      statusEl.textContent = `Generated meshes: ${visibleDebugLayers} debug overlays visible.`;
    }
    refreshStatusCounts();
  }

  const { buildMesh, loadRasterModel, replaceImage, rebuildDepthModeResources } = createAppActions({
    THREE,
    scene,
    renderState,
    elements: {
      depthScaleEl,
      globalDepthScaleEl,
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
    meshEditRuntime,
  });
  meshEditRuntime.setOnGeometryChanged(() => {
    buildMesh();
  });

  let rasterModels = [];

  function normalizeAssetPath(url) {
    return (url || "").replace(/^\./, "").split("?")[0];
  }

  function withCacheBust(url) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}v=${Date.now()}`;
  }

  function basenameFromUrl(url) {
    const pathPart = normalizeAssetPath(url).split("/").pop() || "";
    return pathPart.replace(/\.[^.]+$/, "");
  }

  function createPsdExportFileName(model) {
    const colorStem = basenameFromUrl(model?.colorUrl || defaults.defaultPsdColorUrl || "depth");
    const depthStem = basenameFromUrl(model?.depthPsdUrl || model?.stableDepthUrl || "");
    if (!depthStem) {
      return `${colorStem}-depth.psd`;
    }
    return `${depthStem}.psd`;
  }

  function syncPsdSaveButtonLabel() {
    if (!saveDepthPsdButtonEl) {
      return;
    }
    if (renderState.sourceMode !== "psd" || !renderState.currentPsdExportName) {
      saveDepthPsdButtonEl.textContent = "Save depth PSD";
      saveDepthPsdButtonEl.disabled = true;
      return;
    }
    saveDepthPsdButtonEl.textContent = `Save ${renderState.currentPsdExportName}`;
    saveDepthPsdButtonEl.disabled = false;
  }

  renderState.currentPsdColorUrl = "";
  renderState.currentPsdDepthUrl = "";
  renderState.currentPsdExportName = "";
  syncPsdSaveButtonLabel();

  function syncModelSelect(selectedModelId = "") {
    if (!modelSelectEl) {
      return;
    }
    modelSelectEl.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a model...";
    modelSelectEl.append(placeholder);
    if (!rasterModels.length) {
      placeholder.textContent = "No data models found";
      modelSelectEl.disabled = true;
      return;
    }

    for (const model of rasterModels) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.label;
      modelSelectEl.append(option);
    }
    modelSelectEl.disabled = false;
    modelSelectEl.value = selectedModelId || "";
  }

  async function loadRasterModelCatalog() {
    if (!modelSelectEl) {
      return;
    }
    try {
      const response = await fetch("./api/models", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const catalog = await response.json();
      rasterModels = Array.isArray(catalog.models) ? catalog.models : [];
      syncModelSelect();
      statusEl.textContent = rasterModels.length
        ? "Select a model."
        : "No data models found.";
    } catch (error) {
      console.error(error);
      rasterModels = [];
      syncModelSelect();
      statusEl.textContent = `Failed to load model list: ${error.message}`;
    }
  }

  async function loadPsdModel(model) {
    if (!model?.colorUrl || (!model?.depthPsdUrl && !model?.stableDepthUrl)) {
      throw new Error("PSD model is missing color or depth URLs.");
    }

    const colorUrl = withCacheBust(model.colorUrl);
    const depthPsdUrl = model.depthPsdUrl ? withCacheBust(model.depthPsdUrl) : null;
    const stableDepthUrl = model.stableDepthUrl ? withCacheBust(model.stableDepthUrl) : defaults.defaultPsdStableDepthUrl;
    statusEl.textContent = `Loading ${model.label || model.id || "PSD model"}...`;

    defaults.defaultPsdColorUrl = colorUrl;
    defaults.defaultPsdDepthPsdUrl = depthPsdUrl;
    defaults.defaultPsdStableDepthUrl = stableDepthUrl;
    renderState.currentModel = model;
    renderState.currentPsdColorUrl = model.colorUrl || "";
    renderState.currentPsdDepthUrl = model.depthPsdUrl || model.stableDepthUrl || "";
    renderState.currentPsdExportName = createPsdExportFileName(model);
    renderState.pendingPsdColorBuffer = await fetch(colorUrl).then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load ${colorUrl}`);
      }
      return response.arrayBuffer();
    });
    renderState.pendingPsdDepthBuffer = null;
    renderState.psdStableDepthPixels = null;
    renderState.psdStableDepthWidth = 0;
    renderState.psdStableDepthHeight = 0;

    await loadPsdPair(renderState.pendingPsdColorBuffer, { depthPsdUrl, stableDepthUrl });
    renderState.sourceMode = "psd";
    sourceModeEl.value = "psd";
    renderState.meshEditHandlesByTarget = {};
    renderState.meshEditHistory = [];
    renderState.meshEditHistoryIndex = -1;
    syncViewerModeUi();
    rebuildSegmentList();
    buildMesh();
    updatePsdDebugPanel();
    syncThumbs();
    meshEditPanel?.sync();
    syncPsdSaveButtonLabel();
  }

  modelSelectEl?.addEventListener("change", async () => {
    const selectedModel = rasterModels.find((model) => model.id === modelSelectEl.value);
    if (!selectedModel) {
      return;
    }
    try {
      if (selectedModel.type === "psd") {
        await loadPsdModel(selectedModel);
        return;
      }
      await loadRasterModel(selectedModel);
      renderState.currentModel = selectedModel;
      renderState.currentPsdColorUrl = "";
      renderState.currentPsdDepthUrl = "";
      renderState.currentPsdExportName = "";
      syncPsdSaveButtonLabel();
    } catch (error) {
      console.error(error);
      statusEl.textContent = `Failed: ${error.message}`;
    }
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
    puppetBoneIds: PUPPET_BONE_IDS,
    setLayerBindingPrimary: (layerIndex, primaryBoneId) => {
      puppetRuntime.setLayerBindingPrimary(layerIndex, primaryBoneId);
      rebuildSegmentList();
    },
    onError: (error) => {
      console.error(error);
      statusEl.textContent = `Failed: ${error.message}`;
    },
  });
  rebuildSegmentList = segmentPanel.rebuildSegmentList;
  meshEditPanel = createMeshEditPanel({
    elements: {
      meshEditPanelEl,
      meshEditEnabledEl,
      meshEditAddModeEl,
      meshEditTargetEl,
      meshEditRadiusEl,
      meshEditRadiusValueEl,
      meshEditUndoButtonEl,
      meshEditRedoButtonEl,
      meshEditResetButtonEl,
    },
    renderState,
    meshEditRuntime,
  });

  if (puppetSwapSidesButtonEl) {
    puppetSwapSidesButtonEl.addEventListener("click", () => {
      puppetRuntime.setSwapLeftRightMapping(!renderState.puppetSwapLeftRightMapping);
      rebuildSegmentList();
      syncPuppetSwapButton();
    });
  }

  wireControls({
    elements: {
      statusEl,
      depthScaleEl,
      depthScaleValueEl,
      globalDepthScaleEl,
      globalDepthScaleValueEl,
      meshDetailEl,
      meshDetailValueEl,
      depthDiscontinuityEl,
      depthDiscontinuityValueEl,
      invertDepthEl,
      sourceModeEl,
      contourRepairEl,
      surfaceSmoothEl,
      generatedMeshDebugEnabledEl,
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
    setGeneratedMeshDebugEnabled,
    replaceImage,
    onResize,
  });

  init().catch((error) => {
    console.error(error);
    statusEl.textContent = `Failed: ${error.message}`;
  });

  async function init() {
    sourceModeEl.value = "raster";
    renderState.sourceMode = "raster";
    syncViewerModeUi();
    rebuildSegmentList();
    syncPuppetSwapButton();
    syncThumbs();
    updatePsdDebugPanel();
    meshEditPanel?.sync();
    await loadRasterModelCatalog();
    puppetRuntime.attachInteraction();
    meshEditRuntime.attachInteraction();
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
