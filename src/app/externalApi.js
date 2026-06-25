import {
  getGlobalDepthScale,
  getLayerDepthOffset,
  getLayerDepthScale,
  getLayerVisible,
  setGlobalDepthScale,
  setLayerDepthOffset,
  setLayerDepthScale,
} from "../composite/schema.js";

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function toRadians(degrees) {
  return (Number(degrees) * Math.PI) / 180;
}

function omitPixelFields(layer) {
  if (!layer) {
    return null;
  }
  const sourceIndices = layer.sourceIndices || [];
  return {
    id: layer.id || "",
    name: layer.name || "",
    sourceIndex: sourceIndices[0] ?? layer.sourceIndex ?? null,
    sourceIndices,
    left: layer.left || 0,
    top: layer.top || 0,
    width: layer.width || 0,
    height: layer.height || 0,
    visible: layer.visible !== false,
    depthOffset: layer.depthOffset ?? 0,
    depthScale: layer.depthScale ?? 1,
    outlierPruneEnabled: !!layer.outlierPruneEnabled,
    puppetFitEnabled: layer.puppetFitEnabled !== false,
    puppetBindingOverride: layer.puppetBindingOverride || null,
  };
}

function serializePsdNode(node, indexPath = []) {
  if (!node) {
    return null;
  }
  return {
    name: node.name || "",
    left: node.left || 0,
    top: node.top || 0,
    width: node.width || node.canvas?.width || 0,
    height: node.height || node.canvas?.height || 0,
    hidden: !!node.hidden,
    indexPath,
    children: Array.isArray(node.children)
      ? node.children.map((child, index) => serializePsdNode(child, [...indexPath, index]))
      : [],
  };
}

function serializeCompositeRef(source) {
  if (!source) {
    return null;
  }
  return {
    format: source.format || "",
    width: source.width || 0,
    height: source.height || 0,
    name: source.name || "",
    layerCount: Array.isArray(source.layers) ? source.layers.length : 0,
  };
}

function createDepthImageDataUrl(layer) {
  if (!layer?.depthPixels || !layer.width || !layer.height) {
    throw new Error("Layer depth pixels are not available.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = layer.width;
  canvas.height = layer.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = context.createImageData(layer.width, layer.height);
  const mask = layer.renderDepthMask || layer.maskPixels;
  for (let i = 0; i < layer.depthPixels.length; i += 1) {
    const depth = mask && !mask[i] ? 0 : layer.depthPixels[i];
    const rgba = i * 4;
    imageData.data[rgba] = depth;
    imageData.data[rgba + 1] = depth;
    imageData.data[rgba + 2] = depth;
    imageData.data[rgba + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function flattenPsdCanvasLayers(layers, output = []) {
  for (let i = 0; i < layers.length; i += 1) {
    const layer = layers[i];
    if (layer.hidden) {
      continue;
    }
    if (layer.children && layer.children.length) {
      flattenPsdCanvasLayers(layer.children, output);
      continue;
    }
    if (layer.canvas) {
      output.push(layer);
    }
  }
  return output;
}

function createColorImageDataUrl(layer, sourceLayer = null) {
  if (!layer || !layer.width || !layer.height) {
    throw new Error("Layer color image is not available.");
  }
  const sourceCanvas = sourceLayer?.canvas;
  if (sourceCanvas) {
    const canvas = document.createElement("canvas");
    canvas.width = layer.width;
    canvas.height = layer.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  }
  if (layer.colorImageData) {
    const canvas = document.createElement("canvas");
    canvas.width = layer.width;
    canvas.height = layer.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.putImageData(layer.colorImageData, 0, 0);
    return canvas.toDataURL("image/png");
  }
  const fallbackCanvas = layer.colorCanvas || layer.canvas || layer.colorTexture?.image;
  if (fallbackCanvas) {
    const canvas = document.createElement("canvas");
    canvas.width = layer.width;
    canvas.height = layer.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(fallbackCanvas, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  }
  throw new Error("Layer color image is not available.");
}

function serializeMeshEntry(entry) {
  if (!entry?.mesh?.geometry) {
    return null;
  }
  const geometry = entry.mesh.geometry;
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const index = geometry.getIndex();
  const normal = geometry.getAttribute("normal");
  return {
    layerIndex: entry.layerIndex,
    targetKey: entry.targetKey,
    geometryId: geometry.id,
    vertexCount: position?.count || 0,
    positions: position ? Array.from(position.array) : [],
    uvs: uv ? Array.from(uv.array) : [],
    normals: normal ? Array.from(normal.array) : [],
    indices: index ? Array.from(index.array) : [],
  };
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode image data."));
    image.src = dataUrl;
  });
}

async function decodeGrayscaleDepthPixels(dataUrl, width, height) {
  const image = await loadImageFromDataUrl(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i += 1) {
    const rgba = i * 4;
    const alpha = imageData.data[rgba + 3];
    pixels[i] = alpha <= 0
      ? 0
      : clampByte((imageData.data[rgba] + imageData.data[rgba + 1] + imageData.data[rgba + 2]) / 3);
  }
  return pixels;
}

function createMaskPixelsFromColorImageData(colorImageData, width, height, minAlpha = 8) {
  if (!colorImageData?.data || !width || !height) {
    return null;
  }
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i += 1) {
    pixels[i] = colorImageData.data[i * 4 + 3] > minAlpha ? 1 : 0;
  }
  return pixels;
}

function hasAnyMaskPixel(maskPixels) {
  if (!maskPixels) {
    return false;
  }
  for (let i = 0; i < maskPixels.length; i += 1) {
    if (maskPixels[i]) {
      return true;
    }
  }
  return false;
}

function applyDepthPixelsToLayer(layer, depthPixels) {
  if (!layer || !depthPixels || depthPixels.length !== layer.width * layer.height) {
    throw new Error("Depth pixels do not match layer dimensions.");
  }
  const nextDepth = new Uint8Array(depthPixels);
  const colorMask = createMaskPixelsFromColorImageData(layer.colorImageData, layer.width, layer.height, 8)
    || layer.maskPixels
    || new Uint8Array(nextDepth.length);
  const strictSurfaceMask = createMaskPixelsFromColorImageData(layer.colorImageData, layer.width, layer.height, 254);
  const surfaceMask = hasAnyMaskPixel(strictSurfaceMask)
    ? strictSurfaceMask
    : colorMask;
  const renderDepthMask = new Uint8Array(nextDepth.length);
  for (let i = 0; i < nextDepth.length; i += 1) {
    renderDepthMask[i] = surfaceMask[i] && nextDepth[i] > 0 ? 1 : 0;
  }
  layer.baseDepthPixels = nextDepth;
  layer.depthModeSourcePixels = new Uint8Array(nextDepth);
  layer.depthPixels = new Uint8Array(nextDepth);
  layer.directDepthPixels = new Uint8Array(nextDepth);
  layer.maskPixels = colorMask;
  layer.surfaceMaskPixels = surfaceMask;
  layer.renderDepthMask = renderDepthMask;
  layer.depthSourceOverridden = true;
  return nextDepth;
}

function depthPixelsFromMesh(mesh, layer, depthScale, invertDepth) {
  const positions = mesh?.positions || mesh?.position || [];
  const uvs = mesh?.uvs || mesh?.uv || [];
  if (!positions.length || !uvs.length) {
    throw new Error("Mesh must include positions and uvs arrays.");
  }
  const pixels = new Uint8Array(layer.width * layer.height);
  const weights = new Uint16Array(layer.width * layer.height);
  const vertexCount = Math.min(Math.floor(positions.length / 3), Math.floor(uvs.length / 2));
  const scale = Math.max(0.0001, Number(depthScale) || 1);
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    const u = Number(uvs[vertexIndex * 2]);
    const v = Number(uvs[vertexIndex * 2 + 1]);
    if (!Number.isFinite(u) || !Number.isFinite(v)) {
      continue;
    }
    const x = Math.max(0, Math.min(layer.width - 1, Math.round(u * (layer.width - 1))));
    const y = Math.max(0, Math.min(layer.height - 1, Math.round((1 - v) * (layer.height - 1))));
    const z = Number(positions[vertexIndex * 3 + 2]);
    let depth = clampByte((z / scale) * 255);
    if (invertDepth) {
      depth = 255 - depth;
    }
    const index = y * layer.width + x;
    pixels[index] = clampByte((pixels[index] * weights[index] + depth) / (weights[index] + 1));
    weights[index] += 1;
  }

  const previousDepth = layer.baseDepthPixels || layer.depthPixels;
  for (let i = 0; i < pixels.length; i += 1) {
    if (!weights[i]) {
      pixels[i] = previousDepth?.[i] || 0;
    }
  }
  return pixels;
}

function normalizeDisplayMeshOverride(mesh) {
  const positions = mesh?.positions || mesh?.position || [];
  const uvs = mesh?.uvs || mesh?.uv || [];
  const indices = mesh?.indices || mesh?.index || [];
  if (!positions.length || positions.length % 3 !== 0) {
    throw new Error("Display mesh must include positions with length divisible by 3.");
  }
  if (uvs.length && uvs.length / 2 !== positions.length / 3) {
    throw new Error("Display mesh uvs must match the position vertex count.");
  }
  return {
    positions: Array.from(positions, (value) => Number(value) || 0),
    uvs: uvs.length ? Array.from(uvs, (value) => Number(value) || 0) : [],
    indices: indices.length ? Array.from(indices, (value) => Math.max(0, Math.floor(Number(value) || 0))) : [],
  };
}

export function createExternalApi(deps) {
  const {
    THREE,
    renderState,
    elements,
    renderer,
    scene,
    camera,
    controls,
    getModels,
    loadModelById,
    loadSourcePair,
    buildMesh,
    updateLayerDepthAdjustment,
    runAlphaDepthGapFill: runAlphaDepthGapFillAction,
    rebuildLayerEntriesIfNeeded,
    rebuildDepthModeResources,
    applySegmentDepthAdjustments,
    updatePsdDebugPanel,
    saveCurrentPsdDepthAsPsd,
    createBinaryMaskTexture,
  } = deps;

  const {
    contourRepairEl,
    surfaceSmoothEl,
    globalDepthScaleEl,
    globalDepthScaleValueEl,
    depthScaleEl,
    invertDepthEl,
  } = elements;

  function requireLayer(index) {
    const layer = renderState.layerEntries?.[index];
    if (!layer) {
      throw new Error(`Layer ${index} is not available.`);
    }
    return layer;
  }

  function getSingleSourcePsdColorLayer(layer) {
    const sourceIndices = layer?.sourceIndices || [];
    if (sourceIndices.length !== 1 || !renderState.psdColorDocument) {
      return null;
    }
    return flattenPsdCanvasLayers(renderState.psdColorDocument.children || [])[sourceIndices[0]] || null;
  }

  function rebuildAfterDepthSourceChange() {
    renderState.preparedLayerEntries = [];
    buildMesh();
    updatePsdDebugPanel();
  }

  function rememberLayerDepthOverride(index) {
    const layer = renderState.layerEntries?.[index];
    const depthModeSourcePixels = layer?.depthModeSourcePixels || layer?.directDepthPixels || layer?.baseDepthPixels || layer?.depthPixels;
    const depthPixels = layer?.baseDepthPixels || layer?.depthPixels || depthModeSourcePixels;
    if (!layer || !depthPixels) {
      return;
    }
    renderState.depthOverrides = renderState.depthOverrides || {};
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

  function applyDisplayMeshOverride(index, meshOverride) {
    const layer = requireLayer(index);
    const entry = renderState.layerMeshes.find((item) => item.layerIndex === index);
    if (!entry?.mesh?.geometry) {
      return false;
    }
    const vertexCount = meshOverride.positions.length / 3;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(meshOverride.positions), 3));
    if (meshOverride.uvs.length) {
      geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(meshOverride.uvs), 2));
    } else {
      const currentUv = entry.mesh.geometry.getAttribute("uv");
      if (currentUv && currentUv.count === vertexCount) {
        geometry.setAttribute("uv", currentUv.clone());
      }
    }
    if (meshOverride.indices.length) {
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(meshOverride.indices), 1));
    }
    geometry.computeVertexNormals();
    geometry.userData.displayMeshOverride = true;
    const oldGeometry = entry.mesh.geometry;
    entry.mesh.geometry = geometry;
    oldGeometry.dispose();
    const uniforms = entry.mesh.material?.uniforms;
    if (uniforms?.uDepthScale) {
      uniforms.uDepthScale.value = 0;
    }
    if (uniforms?.uUseDepthMask) {
      uniforms.uUseDepthMask.value = 0;
    }
    if (uniforms?.uMaskTexture && createBinaryMaskTexture && layer.maskPixels && layer.width && layer.height) {
      if (entry.maskTexture && entry.maskTexture !== layer.maskTexture) {
        entry.maskTexture.dispose();
      }
      entry.maskTexture = createBinaryMaskTexture(layer.width, layer.height, layer.maskPixels);
      uniforms.uMaskTexture.value = entry.maskTexture;
    }
    return true;
  }

  async function setContourRepair(enabled) {
    if (enabled && typeof enabled === "object") {
      enabled = enabled.enabled;
    }
    contourRepairEl.checked = !!enabled;
    if (await rebuildLayerEntriesIfNeeded()) {
      buildMesh();
    } else {
      await rebuildDepthModeResources();
      buildMesh();
    }
    return getSettings();
  }

  async function setSurfaceSmooth(enabled) {
    if (enabled && typeof enabled === "object") {
      enabled = enabled.enabled;
    }
    surfaceSmoothEl.checked = !!enabled;
    if (await rebuildLayerEntriesIfNeeded()) {
      buildMesh();
    } else {
      applySegmentDepthAdjustments();
      buildMesh();
    }
    return getSettings();
  }

  function getSettings() {
    return {
      globalDepthScale: getGlobalDepthScale(renderState),
      contourRepair: !!contourRepairEl.checked,
      surfaceSmooth: !!surfaceSmoothEl.checked,
    };
  }

  return {
    listModels() {
      return getModels();
    },

    async loadModel(id) {
      if (id && typeof id === "object") {
        id = id.id;
      }
      await loadModelById(id);
      return this.getCompositeSource();
    },

    async loadSources(options = {}) {
      if (typeof loadSourcePair !== "function") {
        throw new Error("Source pair loading is not available.");
      }
      await loadSourcePair(options);
      return this.getCompositeSource();
    },

    getCompositeSource() {
      const composedSource = renderState.composedSource;
      return {
        currentModel: renderState.currentModel,
        sourceMode: renderState.sourceMode,
        settings: getSettings(),
        composedSource: composedSource ? {
          width: composedSource.width,
          height: composedSource.height,
          mode: composedSource.mode,
          colorSource: serializeCompositeRef(composedSource.colorSource),
          depthSource: serializeCompositeRef(composedSource.depthSource),
          globalDepthScale: composedSource.globalDepthScale,
          globalDepthCentroid: composedSource.globalDepthCentroid,
          diagnostics: composedSource.diagnostics || [],
          layers: (composedSource.layers || []).map((layer, index) => ({
            index,
            ...omitPixelFields(layer),
            visible: getLayerVisible(renderState, index),
            depthOffset: getLayerDepthOffset(renderState, index),
            depthScale: getLayerDepthScale(renderState, index),
          })),
        } : null,
        psdColorTree: renderState.psdColorDocument
          ? serializePsdNode({ name: "root", children: renderState.psdColorDocument.children || [] })
          : null,
        psdDepthTree: renderState.psdDepthDocument
          ? serializePsdNode({ name: "root", children: renderState.psdDepthDocument.children || [] })
          : null,
      };
    },

    getLayerDepthImage(index) {
      if (index && typeof index === "object") {
        index = index.index;
      }
      const prepared = renderState.preparedLayerEntries?.[index] || requireLayer(index);
      return {
        index,
        name: prepared.name || `Layer ${index + 1}`,
        width: prepared.width,
        height: prepared.height,
        left: prepared.left || 0,
        top: prepared.top || 0,
        dataUrl: createDepthImageDataUrl(prepared),
      };
    },

    getLayerColorImage(index) {
      if (index && typeof index === "object") {
        index = index.index;
      }
      const prepared = renderState.preparedLayerEntries?.[index] || requireLayer(index);
      const sourceLayer = getSingleSourcePsdColorLayer(prepared);
      return {
        index,
        name: prepared.name || `Layer ${index + 1}`,
        width: prepared.width,
        height: prepared.height,
        left: prepared.left || 0,
        top: prepared.top || 0,
        dataUrl: createColorImageDataUrl(prepared, sourceLayer),
      };
    },

    getLayerMesh(index) {
      if (index && typeof index === "object") {
        index = index.index;
      }
      const entry = renderState.layerMeshes.find((item) => item.layerIndex === index);
      if (!entry) {
        throw new Error(`Layer mesh ${index} is not available or visible.`);
      }
      return serializeMeshEntry(entry);
    },

    getAllLayerMeshes() {
      return renderState.layerMeshes.map(serializeMeshEntry).filter(Boolean);
    },

    captureView(options = {}) {
      if (!renderer || !scene || !camera || !controls || !THREE) {
        throw new Error("Renderer context is not available.");
      }
      const previous = {
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
        zoom: camera.zoom,
        target: controls.target.clone(),
        size: renderer.getSize(new THREE.Vector2()),
      };
      const target = options.target || {};
      const focus = new THREE.Vector3(
        Number(target.x ?? 0),
        Number(target.y ?? 0),
        Number(target.z ?? 0),
      );
      const distance = Number(options.distance ?? (previous.position.distanceTo(previous.target) || 2));
      const yaw = toRadians(options.yaw ?? 0);
      const pitch = toRadians(options.pitch ?? 0);
      camera.position.set(
        focus.x + distance * Math.cos(pitch) * Math.sin(yaw),
        focus.y + distance * Math.sin(pitch),
        focus.z + distance * Math.cos(pitch) * Math.cos(yaw),
      );
      controls.target.copy(focus);
      camera.zoom = Number(options.zoom ?? previous.zoom);
      camera.lookAt(focus);
      camera.updateProjectionMatrix();
      controls.update();

      if (options.width && options.height) {
        renderer.setSize(Number(options.width), Number(options.height), false);
      }
      renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL(options.mimeType || "image/png");
      const width = renderer.domElement.width;
      const height = renderer.domElement.height;

      if (!options.keepCamera) {
        controls.target.copy(previous.target);
        camera.position.copy(previous.position);
        camera.quaternion.copy(previous.quaternion);
        camera.zoom = previous.zoom;
        camera.updateProjectionMatrix();
        controls.update();
      }
      if (options.width && options.height) {
        renderer.setSize(previous.size.x, previous.size.y, false);
      }
      renderer.render(scene, camera);

      return { width, height, dataUrl };
    },

    setLayerDepthTransform(index, values = {}) {
      if (index && typeof index === "object") {
        values = index;
        index = values.index;
      }
      requireLayer(index);
      if (values.offset != null) {
        setLayerDepthOffset(renderState, index, Number(values.offset));
      }
      if (values.scale != null) {
        setLayerDepthScale(renderState, index, Number(values.scale));
      }
      updateLayerDepthAdjustment(index);
      updatePsdDebugPanel();
      return {
        index,
        depthOffset: getLayerDepthOffset(renderState, index),
        depthScale: getLayerDepthScale(renderState, index),
      };
    },

    async setLayerDepthImage(args = {}) {
      const index = Number(args.index);
      const layer = requireLayer(index);
      if (!args.dataUrl) {
        throw new Error("dataUrl is required.");
      }
      const pixels = await decodeGrayscaleDepthPixels(args.dataUrl, layer.width, layer.height);
      applyDepthPixelsToLayer(layer, pixels);
      if (renderState.composedSource?.layers?.[index] && renderState.composedSource.layers[index] !== layer) {
        applyDepthPixelsToLayer(renderState.composedSource.layers[index], pixels);
      }
      rememberLayerDepthOverride(index);
      rebuildAfterDepthSourceChange();
      return {
        index,
        width: layer.width,
        height: layer.height,
        nonZeroPixels: pixels.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0),
      };
    },

    setLayerDepthMesh(args = {}) {
      const index = Number(args.index);
      const layer = requireLayer(index);
      const pixels = depthPixelsFromMesh(
        args.mesh || args,
        layer,
        Number(depthScaleEl?.value || 1),
        !!invertDepthEl?.checked,
      );
      applyDepthPixelsToLayer(layer, pixels);
      if (renderState.composedSource?.layers?.[index] && renderState.composedSource.layers[index] !== layer) {
        applyDepthPixelsToLayer(renderState.composedSource.layers[index], pixels);
      }
      rememberLayerDepthOverride(index);
      rebuildAfterDepthSourceChange();
      return {
        index,
        width: layer.width,
        height: layer.height,
        nonZeroPixels: pixels.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0),
      };
    },

    setLayerDisplayMesh(args = {}) {
      const index = Number(args.index);
      requireLayer(index);
      const meshOverride = normalizeDisplayMeshOverride(args.mesh || args);
      renderState.displayMeshOverrides = renderState.displayMeshOverrides || {};
      renderState.displayMeshOverrides[index] = meshOverride;
      const applied = applyDisplayMeshOverride(index, meshOverride);
      return {
        index,
        applied,
        vertexCount: meshOverride.positions.length / 3,
        indexCount: meshOverride.indices.length,
      };
    },

    clearLayerDisplayMesh(args = {}) {
      const index = Number(args.index);
      requireLayer(index);
      if (renderState.displayMeshOverrides) {
        delete renderState.displayMeshOverrides[index];
      }
      buildMesh();
      return { index, cleared: true };
    },

    clearAllDisplayMeshes() {
      renderState.displayMeshOverrides = {};
      buildMesh();
      return { cleared: true };
    },

    setGlobalDepthScale(value) {
      if (value && typeof value === "object") {
        value = value.value;
      }
      const scale = Number(value);
      setGlobalDepthScale(renderState, scale);
      if (globalDepthScaleEl) {
        globalDepthScaleEl.value = String(scale);
      }
      if (globalDepthScaleValueEl) {
        globalDepthScaleValueEl.textContent = scale.toFixed(1);
      }
      if (renderState.colorComposite?.format === "psd") {
        buildMesh();
        updatePsdDebugPanel();
      } else {
        applySegmentDepthAdjustments();
        buildMesh();
      }
      return getSettings();
    },

    setContourRepair,
    setSurfaceSmooth,

    runAlphaDepthGapFill() {
      if (typeof runAlphaDepthGapFillAction !== "function") {
        throw new Error("Alpha-depth gap fill is not available.");
      }
      return runAlphaDepthGapFillAction();
    },

    async saveDepthPsd(options = {}) {
      return saveCurrentPsdDepthAsPsd(options);
    },
  };
}

export function startRestCommandBridge(api, options = {}) {
  const endpoint = options.endpoint || "/api/app-api";
  let stopped = false;

  async function execute(command) {
    const action = command?.action;
    const args = command?.args || {};
    if (!action || typeof api[action] !== "function") {
      throw new Error(`Unknown API action: ${action || ""}`);
    }
    if (Array.isArray(args)) {
      return api[action](...args);
    }
    return api[action](args);
  }

  async function poll() {
    while (!stopped) {
      let command = null;
      try {
        const response = await fetch(`${endpoint}/next`, { cache: "no-store" });
        if (!response.ok) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        command = await response.json();
        if (!command?.id) {
          continue;
        }
        try {
          const result = await execute(command);
          await fetch(`${endpoint}/result`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: command.id, ok: true, result }),
          });
        } catch (error) {
          await fetch(`${endpoint}/result`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: command.id, ok: false, error: error.message }),
          });
        }
      } catch (error) {
        await new Promise((resolve) => setTimeout(resolve, command ? 0 : 1000));
      }
    }
  }

  poll();
  return {
    stop() {
      stopped = true;
    },
  };
}
