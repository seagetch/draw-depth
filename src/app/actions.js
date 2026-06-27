import { createFlatColorCompositeFromTexture } from "../composite/colorSources.js";
import { createFlatDepthCompositeFromPixels } from "../composite/depthSources.js";
import { getLayerDepthOffset, getLayerDepthScale, getLayerVisible } from "../composite/schema.js";
import {
  alphaDepthGapFillInWorker,
  composeWithPreviousStateInWorker,
  runCompositeWorker,
  startAlphaDepthGapFillTask,
} from "../workers/compositeWorkerClient.js?v=20260627_1";

function isPsdFilename(name) {
  return /\.psd$/i.test(name || "");
}

function withCacheBust(url) {
  if (/^(data|blob):/i.test(url || "")) {
    return url;
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${Date.now()}`;
}

function dataUrlToArrayBuffer(dataUrl) {
  const match = /^data:[^,]*;base64,(.*)$/i.exec(dataUrl || "");
  if (!match) {
    throw new Error("Expected a base64 data URL.");
  }
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function createAppActions(deps) {
  const {
    THREE,
    scene,
    renderState,
    elements,
    shaders,
    defaults,
    disposeMeshDepthTexture,
    clearSceneVisuals,
    buildLayerMeshes,
    updateAdjustedLayerMeshes,
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
    rebuildSegmentList,
    createSegmentThumbDataUrl,
    disposeGeneratedDepthTexture,
    disposeAdjustedDepthTexture,
    disposeRepairedBaseDepthTexture,
    createSegmentedGridDepthResources,
    createMaskedGridDepthPixels,
    createDepthTextureResources,
    createBinaryMaskTexture,
    rebuildRepairedBaseDepth,
    meshEditRuntime,
  } = deps;

  const {
    depthScaleEl,
    invertDepthEl,
    meshDetailEl,
    surfaceSmoothEl,
    sourceModeEl,
    statusEl,
    contourRepairEl,
    depthModeEl,
    gridSpecModeEl,
    gridXEl,
    gridYEl,
    kernelSizeEl,
    interpModeEl,
  } = elements;

  const {
    vertexShader,
    fragmentShader,
    staticVertexShader,
    staticFragmentShader,
    pointVertexShader,
    pointFragmentShader,
    staticPointVertexShader,
  } = shaders;

  function composeWithPreviousBackendState(colorComposite, depthComposite, options = {}) {
    const hasOption = (key) => Object.prototype.hasOwnProperty.call(options, key);
    return composeWithPreviousStateInWorker({
      colorComposite,
      depthComposite,
      previousLayers: hasOption("previousLayers") ? options.previousLayers : (renderState.layerEntries || []),
      previousGlobalDepthScale: hasOption("previousGlobalDepthScale")
        ? options.previousGlobalDepthScale
        : (renderState.composedSource?.globalDepthScale ?? 1),
      depthOverrides: hasOption("depthOverrides") ? options.depthOverrides : renderState.depthOverrides,
      onProgress: (progress) => {
        options.onProgress?.(progress);
        if (progress?.total != null) {
          statusEl.textContent = `Composite: ${progress.current ?? 0}/${progress.total} ${progress.message || ""}`;
        }
      },
    });
  }

  function buildMesh() {
    disposeMeshDepthTexture();
    clearSceneVisuals();

    if (hasLayeredCompositeSource()) {
      syncRasterLayerEntryFromActiveDepth();
      buildLayerMeshes();
      rebuildSegmentList();
      refreshStatusCounts();
      return;
    }

    const step = Number(meshDetailEl.value);
    renderState.meshDepthTexture = renderState.activeDepthTexture;
    renderState.meshDepthPixels = renderState.activeDepthPixels;
    renderState.meshGapMask = renderState.repairedBaseGapMask || new Uint8Array(
      renderState.imageWidth * renderState.imageHeight,
    );
    const useSurfaceSmooth = surfaceSmoothEl.checked;
    const geometry = buildMaskedPlaneGeometry(
      renderState.imageWidth,
      renderState.imageHeight,
      renderState.meshDepthPixels,
      renderState.segmentMap,
      renderState.segmentDepthMeans,
      renderState.meshGapMask,
      step,
      {
        bakeDepth: useSurfaceSmooth,
        depthScale: Number(depthScaleEl.value),
        invertDepth: invertDepthEl.checked,
        surfaceSmooth: useSurfaceSmooth,
      },
    );

    geometry.computeVertexNormals();

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColorTexture: { value: renderState.colorTexture },
        uSegmentMaskTexture: { value: renderState.segmentMaskTexture },
        uOpacity: { value: 1 },
        ...(useSurfaceSmooth ? {} : {
          uDepthTexture: { value: renderState.meshDepthTexture },
          uDepthScale: { value: Number(depthScaleEl.value) },
          uInvertDepth: { value: invertDepthEl.checked ? 1 : 0 },
        }),
      },
      vertexShader: useSurfaceSmooth ? staticVertexShader : vertexShader,
      fragmentShader: useSurfaceSmooth ? staticFragmentShader : fragmentShader,
      side: THREE.DoubleSide,
      transparent: true,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.targetKey = "raster:base";
    scene.add(mesh);

    const edgeGeometry = buildRenderedBoundaryPointGeometry(
      renderState.imageWidth,
      renderState.imageHeight,
      renderState.meshDepthPixels,
      renderState.segmentMap,
      renderState.meshGapMask,
      step,
    );
    const edgePointMaterial = new THREE.ShaderMaterial({
      uniforms: useSurfaceSmooth
        ? {
          uSegmentMaskTexture: { value: renderState.segmentMaskTexture },
          uOpacity: { value: 1 },
          uPointSize: { value: 2.2 },
        }
        : {
          uDepthTexture: { value: renderState.meshDepthTexture },
          uSegmentMaskTexture: { value: renderState.segmentMaskTexture },
          uOpacity: { value: 1 },
          uDepthScale: { value: Number(depthScaleEl.value) },
          uInvertDepth: { value: invertDepthEl.checked ? 1 : 0 },
          uPointSize: { value: 2.2 },
        },
      vertexShader: useSurfaceSmooth ? staticPointVertexShader : pointVertexShader,
      fragmentShader: pointFragmentShader,
      transparent: true,
      depthWrite: false,
    });
    const edgePoints = new THREE.Points(edgeGeometry, edgePointMaterial);
    scene.add(edgePoints);

    renderState.mesh = mesh;
    renderState.material = material;
    renderState.edgePoints = edgePoints;
    renderState.edgePointMaterial = edgePointMaterial;
    meshEditRuntime?.applyToEntries([{ mesh, targetKey: "raster:base" }]);
    meshEditRuntime?.sync([{ mesh, targetKey: "raster:base" }]);

    refreshStatusCounts();
  }

  function updateLayerDepthAdjustment(layerIndex) {
    if (!hasLayeredCompositeSource() || typeof updateAdjustedLayerMeshes !== "function") {
      buildMesh();
      return;
    }
    updateAdjustedLayerMeshes(layerIndex);
    refreshStatusCounts();
  }

  function rememberAllLayerDepthOverrides() {
    renderState.depthOverrides = renderState.depthOverrides || {};
    const layers = renderState.layerEntries || [];
    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index];
      const depthModeSourcePixels = layer?.depthModeSourcePixels || layer?.directDepthPixels || layer?.baseDepthPixels || layer?.depthPixels;
      const depthPixels = layer?.baseDepthPixels || layer?.depthPixels || depthModeSourcePixels;
      if (!layer || !depthPixels) {
        continue;
      }
      const override = {
        index,
        name: layer.name || "",
        sourceIndex: layer.sourceIndex ?? null,
        sourceIndices: layer.sourceIndices ? layer.sourceIndices.slice() : [],
        width: layer.width,
        height: layer.height,
        depthModeSourcePixels: depthModeSourcePixels ? depthModeSourcePixels.slice() : depthPixels.slice(),
        baseDepthPixels: depthPixels.slice(),
        depthPixels: layer.depthPixels ? layer.depthPixels.slice() : depthPixels.slice(),
        directDepthPixels: layer.directDepthPixels ? layer.directDepthPixels.slice() : (depthModeSourcePixels ? depthModeSourcePixels.slice() : depthPixels.slice()),
        maskPixels: layer.maskPixels ? layer.maskPixels.slice() : null,
        surfaceMaskPixels: layer.surfaceMaskPixels ? layer.surfaceMaskPixels.slice() : null,
        renderDepthMask: layer.renderDepthMask ? layer.renderDepthMask.slice() : null,
        depthMaskPixels: layer.depthMaskPixels ? layer.depthMaskPixels.slice() : null,
        depthSourceOverridden: true,
      };
      renderState.depthOverrides[index] = override;
      if (override.sourceIndices.length) {
        renderState.depthOverrides[`source:${override.sourceIndices.join(",")}`] = override;
      }
      if (override.name) {
        renderState.depthOverrides[`name:${override.name}:${override.width}x${override.height}`] = override;
      }
    }
  }

  async function runAlphaDepthGapFill(options = {}) {
    if (!renderState.composedSource || !(renderState.layerEntries || []).length) {
      throw new Error("Composite layers are not available.");
    }
    const submittedSource = renderState.composedSource;
    const result = await alphaDepthGapFillInWorker(submittedSource, {
      onProgress: options.onProgress,
    });
    if (renderState.composedSource !== submittedSource) {
      throw new Error("Composite source changed before alpha-depth gap fill completed.");
    }
    for (const output of result.outputLayers || []) {
      const layer = renderState.composedSource.layers?.[output.index];
      if (!layer) {
        continue;
      }
      layer.baseDepthPixels = new Uint8Array(output.baseDepthPixels);
      layer.depthModeSourcePixels = new Uint8Array(output.depthModeSourcePixels || output.baseDepthPixels);
      layer.depthPixels = new Uint8Array(output.depthPixels);
      layer.directDepthPixels = new Uint8Array(output.directDepthPixels);
      layer.renderDepthMask = new Uint8Array(output.renderDepthMask);
      layer.depthMaskPixels = new Uint8Array(output.depthMaskPixels);
      layer.depthSourceOverridden = true;
    }
    renderState.composedSource.alphaDepthGapFillPasses = result.pass;
    renderState.composedSource.lastAlphaDepthGapFillReport = result.layers;
    renderState.layerEntries = renderState.composedSource.layers;
    renderState.preparedLayerEntries = [];
    rememberAllLayerDepthOverrides();
    buildMesh();
    refreshStatusCounts();
    statusEl.textContent = `Alpha-depth gap fill pass ${result.pass}: marked ${result.totalMarked}, filled ${result.totalFilled}.`;
    return result;
  }

  function startAlphaDepthGapFill(options = {}) {
    if (!renderState.composedSource || !(renderState.layerEntries || []).length) {
      throw new Error("Composite layers are not available.");
    }
    const submittedSource = renderState.composedSource;
    const task = startAlphaDepthGapFillTask(submittedSource, {
      onProgress: options.onProgress,
    });
    const promise = task.promise.then((result) => {
      if (renderState.composedSource !== submittedSource) {
        throw new Error("Composite source changed before alpha-depth gap fill completed.");
      }
      for (const output of result.outputLayers || []) {
        const layer = renderState.composedSource.layers?.[output.index];
        if (!layer) {
          continue;
        }
        layer.baseDepthPixels = new Uint8Array(output.baseDepthPixels);
        layer.depthModeSourcePixels = new Uint8Array(output.depthModeSourcePixels || output.baseDepthPixels);
        layer.depthPixels = new Uint8Array(output.depthPixels);
        layer.directDepthPixels = new Uint8Array(output.directDepthPixels);
        layer.renderDepthMask = new Uint8Array(output.renderDepthMask);
        layer.depthMaskPixels = new Uint8Array(output.depthMaskPixels);
        layer.depthSourceOverridden = true;
      }
      renderState.composedSource.alphaDepthGapFillPasses = result.pass;
      renderState.composedSource.lastAlphaDepthGapFillReport = result.layers;
      renderState.layerEntries = renderState.composedSource.layers;
      renderState.preparedLayerEntries = [];
      rememberAllLayerDepthOverrides();
      buildMesh();
      refreshStatusCounts();
      statusEl.textContent = `Alpha-depth gap fill pass ${result.pass}: marked ${result.totalMarked}, filled ${result.totalFilled}.`;
      return result;
    });
    return {
      cancel: task.cancel,
      promise,
    };
  }

  function syncRasterLayerEntryFromActiveDepth() {
    if (renderState.colorComposite?.format === "psd" || (renderState.layerEntries || []).length !== 1) {
      return;
    }
    const layer = renderState.layerEntries[0];
    const depthPixels = renderState.activeDepthPixels || renderState.sourceDepthPixels || layer.depthPixels;
    const maskPixels = new Uint8Array(depthPixels.length);
    for (let i = 0; i < depthPixels.length; i += 1) {
      maskPixels[i] = depthPixels[i] > 0 ? 1 : 0;
    }
    layer.left = 0;
    layer.top = 0;
    layer.width = renderState.imageWidth;
    layer.height = renderState.imageHeight;
    layer.colorTexture = renderState.colorTexture || layer.colorTexture;
    layer.depthPixels = depthPixels;
    layer.baseDepthPixels = depthPixels;
    layer.maskPixels = maskPixels;
    layer.surfaceMaskPixels = maskPixels;
    layer.renderDepthMask = maskPixels;
    layer.visible = getLayerVisible(renderState, 0);
    layer.depthOffset = getLayerDepthOffset(renderState, 0);
    layer.depthScale = getLayerDepthScale(renderState, 0);
  }

  async function rebuildLayerDepthModeResources(options = {}) {
    const layers = renderState.layerEntries || [];
    if (!hasLayeredCompositeSource()) {
      return false;
    }

    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index];
      const sourceDepth = layer.depthModeSourcePixels
        || layer.directDepthPixels
        || layer.baseDepthPixels
        || layer.depthPixels;
      if (!sourceDepth || !layer.width || !layer.height || sourceDepth.length !== layer.width * layer.height) {
        continue;
      }

      if (!layer.depthModeSourcePixels) {
        layer.depthModeSourcePixels = sourceDepth.slice();
      }

      const maskPixels = getLayerDepthModeMask(layer);
      const modeSourceDepth = contourRepairEl.checked
        ? await applyContourRepairToLayerDepth(layer.depthModeSourcePixels, maskPixels, layer, index, options)
        : new Uint8Array(layer.depthModeSourcePixels);
      const nextDepth = depthModeEl.value === "raw"
        ? modeSourceDepth
        : createMaskedGridDepthPixels(
          layer.width,
          layer.height,
          modeSourceDepth,
          maskPixels,
          gridSpecModeEl.value,
          Number(gridXEl.value),
          Number(gridYEl.value),
          Number(kernelSizeEl.value),
          interpModeEl.value,
        );
      const renderDepthMask = new Uint8Array(nextDepth.length);
      const surfaceMaskPixels = layer.surfaceMaskPixels || maskPixels;
      for (let i = 0; i < nextDepth.length; i += 1) {
        renderDepthMask[i] = surfaceMaskPixels[i] && nextDepth[i] > 0 ? 1 : 0;
      }

      if (layer.depthTexture) {
        layer.depthTexture.dispose();
      }
      if (layer.maskTexture) {
        layer.maskTexture.dispose();
      }

      const depthTexture = createDepthTextureResources(layer.width, layer.height, nextDepth).texture;
      depthTexture.minFilter = THREE.NearestFilter;
      depthTexture.magFilter = THREE.NearestFilter;
      depthTexture.needsUpdate = true;

      layer.baseDepthPixels = nextDepth.slice();
      layer.depthPixels = nextDepth;
      layer.renderDepthMask = renderDepthMask;
      layer.depthMaskPixels = new Uint8Array(renderDepthMask);
      layer.depthTexture = depthTexture;
      layer.maskTexture = createBinaryMaskTexture(layer.width, layer.height, renderDepthMask);
      layer.depthMode = depthModeEl.value;
      layer.gridSpecMode = gridSpecModeEl.value;
      layer.gridX = Number(gridXEl.value);
      layer.gridY = Number(gridYEl.value);
      layer.kernelSize = Number(kernelSizeEl.value);
      layer.interpMode = interpModeEl.value;
    }

    if (renderState.composedSource) {
      renderState.composedSource.layers = layers;
    }
    renderState.preparedLayerEntries = [];
    rememberAllLayerDepthOverrides();
    return true;
  }

  async function applyContourRepairToLayerDepth(sourceDepth, maskPixels, layer, layerIndex, options = {}) {
    options.onProgress?.({
      stage: "contour-repair",
      current: layerIndex,
      total: (renderState.layerEntries || []).length,
      layerIndex,
      layerName: layer?.name || "",
      message: "building contour band",
    });
    const contourBandMask = await runCompositeWorker("depthCleanup", {
      operation: "buildLayerContourBandMask",
      args: {
        maskPixels,
        width: layer.width,
        height: layer.height,
        thickness: 2,
      },
    });
    const repairedSeed = new Uint8Array(sourceDepth);
    for (let i = 0; i < repairedSeed.length; i += 1) {
      if (contourBandMask[i]) {
        repairedSeed[i] = 0;
      }
    }
    options.onProgress?.({
      stage: "contour-repair",
      current: layerIndex,
      total: (renderState.layerEntries || []).length,
      layerIndex,
      layerName: layer?.name || "",
      message: "inpainting contour band",
    });
    const repaired = await runCompositeWorker("depthCleanup", {
      operation: "inpaintMaskedLayerDepth",
      args: {
        sourceDepthPixels: repairedSeed,
        maskPixels,
        width: layer.width,
        height: layer.height,
      },
    });
    options.onProgress?.({
      stage: "contour-repair",
      current: layerIndex + 1,
      total: (renderState.layerEntries || []).length,
      layerIndex,
      layerName: layer?.name || "",
      message: "layer repaired",
    });
    return new Uint8Array(repaired.pixels || repaired);
  }

  function getLayerDepthModeMask(layer) {
    const mask = layer.maskPixels || layer.surfaceMaskPixels || layer.renderDepthMask;
    if (mask && mask.length === layer.width * layer.height) {
      return mask;
    }
    return new Uint8Array(layer.width * layer.height).fill(1);
  }

  async function loadRasterModel(model) {
    if (!model?.colorUrl || !model?.depthUrl) {
      throw new Error("Model is missing color or depth image URLs.");
    }

    const colorUrl = withCacheBust(model.colorUrl);
    const depthUrl = withCacheBust(model.depthUrl);
    statusEl.textContent = `Loading ${model.label || model.id || "model"}...`;

    const [colorTexture, depthTexture, depthPixels] = await Promise.all([
      loadTexture(colorUrl),
      loadTexture(depthUrl),
      loadDepthPixels(depthUrl),
    ]);

    const imageWidth = colorTexture.image.width;
    const imageHeight = colorTexture.image.height;
    if (imageWidth !== depthTexture.image.width || imageHeight !== depthTexture.image.height) {
      colorTexture.dispose();
      depthTexture.dispose();
      throw new Error("Color and depth image sizes do not match.");
    }

    if (renderState.colorTexture) {
      renderState.colorTexture.dispose();
    }
    if (renderState.sourceDepthTexture) {
      renderState.sourceDepthTexture.dispose();
    }

    revokeObjectUrl("color");
    revokeObjectUrl("depth");
    revokeObjectUrl("segment");

    colorTexture.encoding = THREE.sRGBEncoding;
    colorTexture.minFilter = THREE.LinearFilter;
    colorTexture.magFilter = THREE.LinearFilter;
    depthTexture.minFilter = THREE.LinearFilter;
    depthTexture.magFilter = THREE.LinearFilter;

    renderState.sourceMode = "raster";
    sourceModeEl.value = "raster";
    renderState.colorComposite = createFlatColorCompositeFromTexture(colorTexture, {
      format: "raster",
      name: model.label || "Color",
    });
    resetCompositeRuntimeState();
    renderState.depthOverrides = {};
    renderState.depthComposite = createFlatDepthCompositeFromPixels(imageWidth, imageHeight, depthPixels, {
      format: "raster",
      name: model.label || "Depth",
    });
    renderState.composedSource = await composeWithPreviousBackendState(renderState.colorComposite, renderState.depthComposite, {
      previousLayers: [],
      previousGlobalDepthScale: 1,
      depthOverrides: null,
    });
    renderState.layerEntries = renderState.composedSource.layers;
    renderState.psdColorDocument = null;
    renderState.psdDepthDocument = null;
    renderState.psdStableDepthPixels = null;
    renderState.psdStableDepthWidth = 0;
    renderState.psdStableDepthHeight = 0;
    renderState.psdDebugLayerIndex = -1;
    renderState.colorTexture = colorTexture;
    renderState.sourceDepthTexture = depthTexture;
    renderState.sourceDepthPixels = depthPixels;
    renderState.imageWidth = imageWidth;
    renderState.imageHeight = imageHeight;
    renderState.rasterImageWidth = imageWidth;
    renderState.rasterImageHeight = imageHeight;
    renderState.segmentSourcePixels = new Uint8Array(imageWidth * imageHeight * 3).fill(255);
    renderState.segmentThumbUrl = createSegmentThumbDataUrl(renderState.segmentSourcePixels, imageWidth, imageHeight);
    renderState.meshEditHandlesByTarget = {};
    renderState.meshEditHistory = [];
    renderState.meshEditHistoryIndex = -1;
    defaults.defaultColorUrl = colorUrl;
    defaults.defaultDepthUrl = depthUrl;

    rebuildSegments();
    await rebuildDepthModeResources();
    syncViewerModeUi();
    rebuildSegmentList();
    buildMesh();
    syncThumbs();
  }

  async function loadSourcePair(options = {}) {
    const colorDataUrl = options.colorDataUrl || options.colorUrl;
    const depthDataUrl = options.depthDataUrl || options.depthUrl || options.depthPsdUrl || options.stableDepthUrl;
    const colorName = options.colorName || options.name || "Color";
    const depthName = options.depthName || "Depth";
    if (!colorDataUrl || !depthDataUrl) {
      throw new Error("colorDataUrl and depthDataUrl are required.");
    }

    if (isPsdFilename(colorName)) {
      const colorBuffer = dataUrlToArrayBuffer(colorDataUrl);
      renderState.pendingPsdColorBuffer = colorBuffer;
      resetCompositeRuntimeState();
      renderState.depthOverrides = {};
      renderState.psdStableDepthPixels = null;
      renderState.psdStableDepthWidth = 0;
      renderState.psdStableDepthHeight = 0;
      const depthOptions = isPsdFilename(depthName)
        ? { depthPsdUrl: depthDataUrl, stableDepthUrl: null }
        : { depthPsdUrl: null, stableDepthUrl: depthDataUrl };
      await loadPsdPair(colorBuffer, depthOptions);
      renderState.sourceMode = "psd";
      sourceModeEl.value = "psd";
      renderState.currentModel = {
        id: options.id || "api:psd",
        type: "psd",
        label: options.label || colorName,
        colorUrl: "",
        depthPsdUrl: isPsdFilename(depthName) ? "" : null,
        stableDepthUrl: isPsdFilename(depthName) ? null : "",
      };
      renderState.currentPsdColorUrl = "";
      renderState.currentPsdDepthUrl = "";
      renderState.currentPsdExportName = options.exportName || `${colorName.replace(/\.psd$/i, "")}-depth.psd`;
      syncViewerModeUi();
      buildMesh();
      syncThumbs();
      statusEl.textContent = `Loaded ${colorName} / ${depthName}.`;
      return {
        sourceMode: renderState.sourceMode,
        width: renderState.imageWidth,
        height: renderState.imageHeight,
        layerCount: renderState.layerEntries?.length || 0,
      };
    }

    if (isPsdFilename(depthName)) {
      throw new Error("Depth PSD requires a color PSD source.");
    }

    await loadRasterModel({
      id: options.id || "api:raster",
      type: "raster",
      label: options.label || `${colorName} / ${depthName}`,
      colorUrl: colorDataUrl,
      depthUrl: depthDataUrl,
    });
    renderState.currentModel = {
      id: options.id || "api:raster",
      type: "raster",
      label: options.label || `${colorName} / ${depthName}`,
      colorUrl: "",
      depthUrl: "",
    };
    statusEl.textContent = `Loaded ${colorName} / ${depthName}.`;
    return {
      sourceMode: renderState.sourceMode,
      width: renderState.imageWidth,
      height: renderState.imageHeight,
      layerCount: renderState.layerEntries?.length || 0,
    };
  }

  async function replaceImage(kind, file, options = {}) {
    statusEl.textContent = `Loading ${kind}...`;

    if (kind === "color" && isPsdFilename(file.name)) {
      try {
        const buffer = await file.arrayBuffer();
        renderState.pendingPsdColorBuffer = buffer;
        resetCompositeRuntimeState();
        renderState.depthOverrides = {};
        renderState.psdStableDepthPixels = null;
        renderState.psdStableDepthWidth = 0;
        renderState.psdStableDepthHeight = 0;
        await loadPsdPair(renderState.pendingPsdColorBuffer, {
          onProgress: options.onProgress,
        });
        renderState.sourceMode = "psd";
        sourceModeEl.value = "psd";
        syncViewerModeUi();
        buildMesh();
        syncThumbs();
        statusEl.textContent = "Loaded PSD.";
      } catch (error) {
        statusEl.textContent = `Failed: ${error.message}`;
        console.error(error);
      }
      return;
    }

    const objectUrl = URL.createObjectURL(file);

    try {
      renderState.sourceMode = "raster";
      sourceModeEl.value = "raster";
      renderState.imageWidth = renderState.rasterImageWidth;
      renderState.imageHeight = renderState.rasterImageHeight;
      syncViewerModeUi();

      if (kind === "color") {
        const texture = await loadTexture(objectUrl);

        if (
          texture.image.width !== renderState.imageWidth ||
          texture.image.height !== renderState.imageHeight
        ) {
          throw new Error("Color image size must match the current depth image.");
        }

        texture.encoding = THREE.sRGBEncoding;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;

        if (renderState.colorTexture) {
          renderState.colorTexture.dispose();
        }

        revokeObjectUrl("color");
        renderState.colorTexture = texture;
        renderState.colorObjectUrl = objectUrl;
        renderState.rasterImageWidth = texture.image.width;
        renderState.rasterImageHeight = texture.image.height;
        renderState.colorComposite = createFlatColorCompositeFromTexture(texture, {
          format: "raster",
          name: file.name || "Color",
        });
        resetCompositeRuntimeState();
        renderState.depthOverrides = {};
        if (renderState.depthComposite) {
          renderState.composedSource = await composeWithPreviousBackendState(renderState.colorComposite, renderState.depthComposite, {
            onProgress: options.onProgress,
            previousLayers: [],
            previousGlobalDepthScale: 1,
            depthOverrides: null,
          });
          renderState.layerEntries = renderState.composedSource.layers;
        }
        if (renderState.material) {
          renderState.material.uniforms.uColorTexture.value = texture;
        }
        buildMesh();
        syncThumbs();
        refreshStatusCounts();
        return;
      }

      if (kind === "depth") {
        const [texture, depthPixels] = await Promise.all([
          loadTexture(objectUrl),
          loadDepthPixels(objectUrl),
        ]);

        if (
          texture.image.width !== renderState.imageWidth ||
          texture.image.height !== renderState.imageHeight
        ) {
          throw new Error("Depth image size must match the current color image.");
        }

        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;

        if (renderState.sourceDepthTexture) {
          renderState.sourceDepthTexture.dispose();
        }

        revokeObjectUrl("depth");
        renderState.sourceDepthTexture = texture;
        renderState.sourceDepthPixels = depthPixels;
        renderState.depthObjectUrl = objectUrl;
        renderState.rasterImageWidth = texture.image.width;
        renderState.rasterImageHeight = texture.image.height;
        renderState.depthComposite = createFlatDepthCompositeFromPixels(texture.image.width, texture.image.height, depthPixels, {
          format: "raster",
          name: file.name || "Depth",
        });
        resetCompositeRuntimeState();
        renderState.depthOverrides = {};
        if (renderState.colorComposite) {
          renderState.composedSource = await composeWithPreviousBackendState(renderState.colorComposite, renderState.depthComposite, {
            onProgress: options.onProgress,
            previousLayers: [],
            previousGlobalDepthScale: 1,
            depthOverrides: null,
          });
          renderState.layerEntries = renderState.composedSource.layers;
        }
        rebuildSegments();
        await rebuildDepthModeResources();
        buildMesh();
        syncThumbs();
        return;
      }

      const segmentImage = await loadRgbPixels(objectUrl);
      if (
        segmentImage.width !== renderState.imageWidth ||
        segmentImage.height !== renderState.imageHeight
      ) {
        throw new Error("Segment image size must match the current color/depth image.");
      }

      revokeObjectUrl("segment");
      renderState.segmentSourcePixels = segmentImage.pixels;
      renderState.segmentObjectUrl = objectUrl;
      renderState.rasterImageWidth = segmentImage.width;
      renderState.rasterImageHeight = segmentImage.height;
      renderState.segmentThumbUrl = createSegmentThumbDataUrl(
        renderState.segmentSourcePixels,
        renderState.imageWidth,
        renderState.imageHeight,
      );
      rebuildSegments();
      await rebuildDepthModeResources();
      buildMesh();
      syncThumbs();
      rebuildSegmentList();
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      statusEl.textContent = `Failed: ${error.message}`;
      console.error(error);
    }
  }

  async function rebuildDepthModeResources(options = {}) {
    disposeGeneratedDepthTexture();
    disposeAdjustedDepthTexture();
    disposeRepairedBaseDepthTexture();

    if (await rebuildLayerDepthModeResources(options)) {
      return;
    }

    if (depthModeEl.value === "raw") {
      renderState.baseDepthTexture = renderState.rawDepthTexture;
      renderState.baseDepthPixels = renderState.rawDepthPixels;
      rebuildRepairedBaseDepth();
      return;
    }

    const generated = createSegmentedGridDepthResources(
      renderState.imageWidth,
      renderState.imageHeight,
      renderState.rawSegmentData,
      gridSpecModeEl.value,
      Number(gridXEl.value),
      Number(gridYEl.value),
      Number(kernelSizeEl.value),
      interpModeEl.value,
    );

    renderState.generatedDepthTexture = generated.texture;
    renderState.baseDepthTexture = generated.texture;
    renderState.baseDepthPixels = generated.pixels;
    rebuildRepairedBaseDepth();
  }

  function hasLayeredCompositeSource() {
    return renderState.colorComposite?.format === "psd" || (renderState.layerEntries || []).length > 1;
  }

  function resetCompositeRuntimeState() {
    renderState.layerEntries = [];
    renderState.preparedLayerEntries = [];
    renderState.composedSource = null;
    renderState.displayMeshOverrides = {};
    renderState.puppetRig = null;
    renderState.puppetRigSignature = "";
    renderState.puppetMeshSignature = "";
    renderState.puppetLayerBindings = [];
    renderState.puppetBindingsByLayer = [];
  }

  return {
    buildMesh,
    updateLayerDepthAdjustment,
    loadRasterModel,
    loadSourcePair,
    replaceImage,
    rebuildDepthModeResources,
    runAlphaDepthGapFill,
    startAlphaDepthGapFill,
    defaults,
  };
}
