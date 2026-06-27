import {
  getGlobalDepthScale,
  getLayerDepthOffset,
  getLayerDepthScale,
  getLayerVisible,
} from "../composite/schema.js";

export function createSceneBuilder(deps) {
  const {
    THREE,
    scene,
    renderState,
    elements,
    shaders,
    createDepthTextureResources,
    createBinaryMaskTexture,
    clamp,
    scaleDepthValueAroundCenter,
    buildPsdLayerGeometry,
    createPsdDepthPreviewUrl,
    puppetRuntime,
    meshEditRuntime,
  } = deps

  const { meshDetailEl, surfaceSmoothEl, depthScaleEl, invertDepthEl } = elements
  const { staticVertexShader, psdLayerVertexShader, staticPsdLayerFragmentShader, psdLayerFragmentShader } = shaders

  function clearSceneVisuals() {
    if (renderState.mesh) {
      scene.remove(renderState.mesh);
      renderState.mesh.geometry.dispose();
      renderState.material.dispose();
      renderState.mesh = null;
      renderState.material = null;
    }
  
    if (renderState.edgePoints) {
      scene.remove(renderState.edgePoints);
      renderState.edgePoints.geometry.dispose();
      renderState.edgePointMaterial.dispose();
      renderState.edgePoints = null;
      renderState.edgePointMaterial = null;
    }
  
    if (renderState.layerMeshes.length) {
      for (let i = 0; i < renderState.layerMeshes.length; i += 1) {
        const entry = renderState.layerMeshes[i];
        scene.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        entry.mesh.material.dispose();
        if (entry.depthTexture) {
          entry.depthTexture.dispose();
        }
        if (entry.maskTexture) {
          entry.maskTexture.dispose();
        }
      }
      renderState.layerMeshes = [];
    }

    if (renderState.layerDebugMeshes.length) {
      for (let i = 0; i < renderState.layerDebugMeshes.length; i += 1) {
        const entry = renderState.layerDebugMeshes[i];
        scene.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        entry.mesh.material.dispose();
      }
      renderState.layerDebugMeshes = [];
    }
  }

  function disposeLayerMeshEntry(entry) {
    scene.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    entry.mesh.material.dispose();
    if (entry.depthTexture) {
      entry.depthTexture.dispose();
    }
    if (entry.maskTexture) {
      entry.maskTexture.dispose();
    }
  }

  function disposeLayerDebugMeshEntry(entry) {
    scene.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    entry.mesh.material.dispose();
  }

  function layerBoundsOverlap(a, b) {
    if (!a || !b) {
      return false;
    }
    const ax2 = a.left + a.width;
    const ay2 = a.top + a.height;
    const bx2 = b.left + b.width;
    const by2 = b.top + b.height;
    return a.left < bx2 && ax2 > b.left && a.top < by2 && ay2 > b.top;
  }

  function collectDepthAdjustmentAffectedIndexes(changedLayerIndex) {
    const sourceLayers = renderState.layerEntries || [];
    const changedLayer = sourceLayers[changedLayerIndex];
    const affected = new Set([changedLayerIndex]);
    if (!changedLayer) {
      return affected;
    }

    for (let i = 0; i < sourceLayers.length; i += 1) {
      if (i === changedLayerIndex) {
        continue;
      }
      if (!layerBoundsOverlap(changedLayer, sourceLayers[i])) {
        continue;
      }
      const isNeighbor = Math.abs(i - changedLayerIndex) === 1;
      const canDependOnChangedDepth = i < changedLayerIndex;
      if (isNeighbor || canDependOnChangedDepth) {
        affected.add(i);
      }
    }
    return affected;
  }

  function createLayerMeshEntry(layer, layerIndex, bakeDepth, fadeBaseMeshes) {
    const geometry = buildPsdLayerGeometry(
      renderState.imageWidth,
      renderState.imageHeight,
      layer,
      Number(meshDetailEl.value),
      {
        bakeDepth,
        depthScale: Number(depthScaleEl.value),
        invertDepth: invertDepthEl.checked,
        surfaceSmooth: surfaceSmoothEl.checked,
      },
    );
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColorTexture: { value: layer.colorTexture },
        uMaskTexture: { value: layer.maskTexture },
        uOpacity: { value: fadeBaseMeshes ? 0.1 : 1 },
        ...(bakeDepth ? {} : {
          uDepthTexture: { value: layer.depthTexture },
          uDepthScale: { value: Number(depthScaleEl.value) },
          uInvertDepth: { value: invertDepthEl.checked ? 1 : 0 },
          uUseDepthMask: { value: 1 },
        }),
      },
      vertexShader: bakeDepth ? staticVertexShader : psdLayerVertexShader,
      fragmentShader: bakeDepth ? staticPsdLayerFragmentShader : psdLayerFragmentShader,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: fadeBaseMeshes ? 0.1 : 1,
      depthTest: true,
      depthWrite: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const targetKey = renderState.colorComposite?.format !== "psd" && (renderState.layerEntries || []).length === 1
      ? "raster:base"
      : `psd:${layerIndex}`;
    mesh.userData.targetKey = targetKey;
    mesh.renderOrder = layerIndex;
    const entry = {
      mesh,
      layerIndex,
      targetKey,
      depthTexture: layer.depthTexture,
      maskTexture: layer.maskTexture,
    };
    applyDisplayMeshOverrideToEntry(entry, layer);
    scene.add(mesh);
    return entry;
  }

  function applyDisplayMeshOverrideToEntry(entry, layer = null) {
    const override = renderState.displayMeshOverrides?.[entry.layerIndex];
    if (!override?.positions?.length) {
      return false;
    }
    const positionArray = new Float32Array(override.positions.map((value) => Number(value) || 0));
    if (positionArray.length % 3 !== 0) {
      console.warn("[depth-draw] Ignoring invalid display mesh override positions", entry.layerIndex);
      return false;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positionArray, 3));
    if (override.uvs?.length) {
      geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(override.uvs.map((value) => Number(value) || 0)), 2));
    } else {
      const currentUv = entry.mesh.geometry.getAttribute("uv");
      if (currentUv && currentUv.count === positionArray.length / 3) {
        geometry.setAttribute("uv", currentUv.clone());
      }
    }
    if (override.indices?.length) {
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(override.indices.map((value) => Number(value) || 0)), 1));
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
    if (uniforms?.uMaskTexture && layer?.maskPixels && layer.width && layer.height) {
      if (entry.maskTexture && entry.maskTexture !== layer.maskTexture) {
        entry.maskTexture.dispose();
      }
      entry.maskTexture = createBinaryMaskTexture(layer.width, layer.height, layer.maskPixels);
      uniforms.uMaskTexture.value = entry.maskTexture;
    }
    return true;
  }
  
  function buildLayerMeshes() {
    const layers = buildPreparedLayerEntries();
    const usePuppetDeform = !!renderState.puppetEnabled;
    const useSurfaceSmooth = surfaceSmoothEl.checked;
    const bakeDepth = useSurfaceSmooth || usePuppetDeform;
    const fadeBaseMeshes = !!renderState.generatedMeshDebugEnabled;
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[i];
      if (!getLayerVisible(renderState, i)) {
        continue;
      }
      renderState.layerMeshes.push(createLayerMeshEntry(layer, i, bakeDepth, fadeBaseMeshes));

      if (renderState.generatedMeshDebugEnabled && renderState.generatedMeshDebugData) {
        const debugLayer = renderState.generatedMeshDebugData.layersByIndex?.[i]
          || renderState.generatedMeshDebugData.layersByName.get(layer.name);
        const debugMesh = createGeneratedMeshDebugMesh(debugLayer, i);
        if (debugMesh) {
          scene.add(debugMesh);
          renderState.layerDebugMeshes.push({
            mesh: debugMesh,
            layerIndex: i,
          });
        }
      }
    }
    if (meshEditRuntime) {
      meshEditRuntime.applyToEntries(renderState.layerMeshes);
      meshEditRuntime.sync(renderState.layerMeshes);
    }
    if (puppetRuntime && (renderState.colorComposite?.format === "psd" || renderState.layerMeshes.length > 1)) {
      puppetRuntime.sync(renderState.layerMeshes);
    }
  }

  function updateAdjustedLayerMeshes(changedLayerIndex) {
    const sourceLayers = renderState.layerEntries || [];
    if (!sourceLayers.length || changedLayerIndex < 0 || changedLayerIndex >= sourceLayers.length) {
      buildLayerMeshes();
      return;
    }

    const affectedIndexes = collectDepthAdjustmentAffectedIndexes(changedLayerIndex);
    const affectedLayerIndexSet = affectedIndexes;
    const layers = buildPreparedLayerEntries({ affectedLayerIndexSet });
    const usePuppetDeform = !!renderState.puppetEnabled;
    const bakeDepth = surfaceSmoothEl.checked || usePuppetDeform;
    const fadeBaseMeshes = !!renderState.generatedMeshDebugEnabled;

    renderState.layerMeshes = renderState.layerMeshes.filter((entry) => {
      if (!affectedIndexes.has(entry.layerIndex)) {
        return true;
      }
      disposeLayerMeshEntry(entry);
      return false;
    });

    renderState.layerDebugMeshes = renderState.layerDebugMeshes.filter((entry) => {
      if (!affectedIndexes.has(entry.layerIndex)) {
        return true;
      }
      disposeLayerDebugMeshEntry(entry);
      return false;
    });

    [...affectedIndexes].sort((a, b) => a - b).forEach((layerIndex) => {
      const layer = layers[layerIndex];
      if (!layer || !getLayerVisible(renderState, layerIndex)) {
        return;
      }
      renderState.layerMeshes.push(createLayerMeshEntry(layer, layerIndex, bakeDepth, fadeBaseMeshes));

      if (renderState.generatedMeshDebugEnabled && renderState.generatedMeshDebugData) {
        const debugLayer = renderState.generatedMeshDebugData.layersByIndex?.[layerIndex]
          || renderState.generatedMeshDebugData.layersByName.get(layer.name);
        const debugMesh = createGeneratedMeshDebugMesh(debugLayer, layerIndex);
        if (debugMesh) {
          scene.add(debugMesh);
          renderState.layerDebugMeshes.push({
            mesh: debugMesh,
            layerIndex,
          });
        }
      }
    });

    renderState.layerMeshes.sort((a, b) => a.layerIndex - b.layerIndex);
    renderState.layerDebugMeshes.sort((a, b) => a.layerIndex - b.layerIndex);

    if (meshEditRuntime) {
      meshEditRuntime.applyToEntries(renderState.layerMeshes);
      meshEditRuntime.sync(renderState.layerMeshes);
    }
    if (puppetRuntime && (renderState.colorComposite?.format === "psd" || renderState.layerMeshes.length > 1)) {
      puppetRuntime.sync(renderState.layerMeshes);
    }
  }

  function createGeneratedMeshDebugMesh(debugLayer, layerIndex) {
    const vertices = debugLayer?.mesh?.vertices;
    const faces = debugLayer?.mesh?.faces;
    if (!vertices || !vertices.length || !faces || !faces.length) {
      return null;
    }

    const positions = new Float32Array(vertices.length * 3);
    const aspect = renderState.imageWidth / Math.max(1, renderState.imageHeight);
    const depthScale = Number(depthScaleEl.value);
    const invertDepth = !!invertDepthEl.checked;
    for (let i = 0; i < vertices.length; i += 1) {
      const vertex = vertices[i];
      const base = i * 3;
      const rawDepth = THREE.MathUtils.clamp(-vertex[2], 0, 1);
      const depthValue = invertDepth ? 1 - rawDepth : rawDepth;
      positions[base] = vertex[0] * aspect;
      positions[base + 1] = vertex[1];
      positions[base + 2] = depthValue * depthScale;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const indices = new Uint32Array(faces.length * 3);
    for (let i = 0; i < faces.length; i += 1) {
      const face = faces[i];
      const base = i * 3;
      indices[base] = face[0];
      indices[base + 1] = face[1];
      indices[base + 2] = face[2];
    }
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    const hue = (layerIndex * 0.097) % 1;
    const color = new THREE.Color().setHSL(hue, 0.95, 0.55);
    const material = new THREE.MeshBasicMaterial({
      color,
      depthTest: true,
      depthWrite: true,
      transparent: false,
      opacity: 1,
      side: THREE.DoubleSide,
      wireframe: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = layerIndex;
    return mesh;
  }
  
  function buildPreparedLayerEntries(options = {}) {
    const { affectedLayerIndexSet = null } = options;
    const sourceLayers = renderState.layerEntries || [];
    const preparedLayers = affectedLayerIndexSet
      ? [...(renderState.preparedLayerEntries || [])]
      : new Array(sourceLayers.length);
    const upperDepthLimit = new Uint16Array(renderState.imageWidth * renderState.imageHeight);
    upperDepthLimit.fill(256);
    const globalDepthCenter = affectedLayerIndexSet
      ? (renderState.composedSource?.globalDepthCentroid ?? 0)
      : computePreparedPsdDepthCentroid(sourceLayers);
  
    for (let layerIndex = sourceLayers.length - 1; layerIndex >= 0; layerIndex -= 1) {
      const layer = sourceLayers[layerIndex];
      let shouldRebuildLayer = !affectedLayerIndexSet || affectedLayerIndexSet.has(layerIndex);
      const baseDepthPixels = layer.baseDepthPixels || layer.depthPixels;
      const effectiveMaskPixels = layer.surfaceMaskPixels || layer.maskPixels;
      const depthScale = getLayerDepthScale(renderState, layerIndex);
      const depthOffset = getLayerDepthOffset(renderState, layerIndex);
      const shouldClampStacking = !layer.hasDirectDepth;
      let effectiveDepthPixels = shouldRebuildLayer
        ? new Uint8Array(baseDepthPixels.length)
        : preparedLayers[layerIndex]?.depthPixels;
      let renderDepthMask = shouldRebuildLayer
        ? new Uint8Array(baseDepthPixels.length)
        : preparedLayers[layerIndex]?.renderDepthMask;

      if (!shouldRebuildLayer && (!effectiveDepthPixels || !renderDepthMask)) {
        affectedLayerIndexSet.add(layerIndex);
        shouldRebuildLayer = true;
        effectiveDepthPixels = new Uint8Array(baseDepthPixels.length);
        renderDepthMask = new Uint8Array(baseDepthPixels.length);
      }

      if (!shouldRebuildLayer && effectiveDepthPixels && renderDepthMask) {
        if (getLayerVisible(renderState, layerIndex)) {
          updateUpperDepthLimitForLayer(layer, effectiveDepthPixels, upperDepthLimit);
        }
        continue;
      }
  
      for (let y = 0; y < layer.height; y += 1) {
        const globalY = layer.top + y;
        if (globalY < 0 || globalY >= renderState.imageHeight) {
          continue;
        }
  
        for (let x = 0; x < layer.width; x += 1) {
          const localIndex = y * layer.width + x;
          if (!effectiveMaskPixels[localIndex]) {
            continue;
          }
  
          const baseDepth = baseDepthPixels[localIndex];
          if (baseDepth <= 0) {
            continue;
          }
  
          const globalX = layer.left + x;
          if (globalX < 0 || globalX >= renderState.imageWidth) {
            continue;
          }
  
          const globalIndex = globalY * renderState.imageWidth + globalX;
          const layerDepth = clamp(Math.round(baseDepth * depthScale + depthOffset), 1, 255);
          const scaledDepth = scaleDepthValueAroundCenter(
            layerDepth,
            getGlobalDepthScale(renderState),
            globalDepthCenter,
          );
          let sortDepth = invertDepthEl.checked ? 255 - scaledDepth : scaledDepth;
          const upperLimit = upperDepthLimit[globalIndex];
          if (shouldClampStacking && upperLimit <= 255) {
            const limitedDepth = Math.max(1, upperLimit - 1);
            sortDepth = Math.min(sortDepth, limitedDepth);
          }
          const effectiveDepth = invertDepthEl.checked ? 255 - sortDepth : sortDepth;
  
          effectiveDepthPixels[localIndex] = effectiveDepth;
          renderDepthMask[localIndex] = 1;
        }
      }
  
      if (getLayerVisible(renderState, layerIndex)) {
        for (let y = 0; y < layer.height; y += 1) {
          const globalY = layer.top + y;
          if (globalY < 0 || globalY >= renderState.imageHeight) {
            continue;
          }
  
          for (let x = 0; x < layer.width; x += 1) {
            const localIndex = y * layer.width + x;
            const effectiveDepth = effectiveDepthPixels[localIndex];
            if (effectiveDepth <= 0) {
              continue;
            }
  
            const globalX = layer.left + x;
            if (globalX < 0 || globalX >= renderState.imageWidth) {
              continue;
            }
  
            const globalIndex = globalY * renderState.imageWidth + globalX;
            const sortDepth = invertDepthEl.checked ? 255 - effectiveDepth : effectiveDepth;
            upperDepthLimit[globalIndex] = Math.min(upperDepthLimit[globalIndex], sortDepth);
          }
        }
      }
  
      const depthTexture = createDepthTextureResources(
        layer.width,
        layer.height,
        effectiveDepthPixels,
      ).texture;
      depthTexture.minFilter = THREE.NearestFilter;
      depthTexture.magFilter = THREE.NearestFilter;
      depthTexture.needsUpdate = true;
      const maskTexture = createBinaryMaskTexture(layer.width, layer.height, renderDepthMask);
      const depthPreviewUrl = createPsdDepthPreviewUrl(
        layer.width,
        layer.height,
        effectiveDepthPixels,
        renderDepthMask,
        layer.inpaintFilledMask,
      );
  
      layer.currentDepthPreviewUrl = depthPreviewUrl;
      preparedLayers[layerIndex] = {
        ...layer,
        depthPixels: effectiveDepthPixels,
        renderDepthMask,
        maskPixels: effectiveMaskPixels,
        depthTexture,
        maskTexture,
        depthPreviewUrl,
      };
    }

    renderState.preparedLayerEntries = preparedLayers;
    return preparedLayers;
  }

  function updateUpperDepthLimitForLayer(layer, effectiveDepthPixels, upperDepthLimit) {
    for (let y = 0; y < layer.height; y += 1) {
      const globalY = layer.top + y;
      if (globalY < 0 || globalY >= renderState.imageHeight) {
        continue;
      }

      for (let x = 0; x < layer.width; x += 1) {
        const localIndex = y * layer.width + x;
        const effectiveDepth = effectiveDepthPixels[localIndex];
        if (effectiveDepth <= 0) {
          continue;
        }

        const globalX = layer.left + x;
        if (globalX < 0 || globalX >= renderState.imageWidth) {
          continue;
        }

        const globalIndex = globalY * renderState.imageWidth + globalX;
        const sortDepth = invertDepthEl.checked ? 255 - effectiveDepth : effectiveDepth;
        upperDepthLimit[globalIndex] = Math.min(upperDepthLimit[globalIndex], sortDepth);
      }
    }
  }

  function computePreparedPsdDepthCentroid(sourceLayers) {
    let sum = 0;
    let count = 0;

    for (let layerIndex = 0; layerIndex < sourceLayers.length; layerIndex += 1) {
      if (!getLayerVisible(renderState, layerIndex)) {
        continue;
      }
      const layer = sourceLayers[layerIndex];
      const baseDepthPixels = layer.baseDepthPixels || layer.depthPixels;
      const effectiveMaskPixels = layer.surfaceMaskPixels || layer.maskPixels;
      if (!baseDepthPixels || !effectiveMaskPixels) {
        continue;
      }
      const depthScale = getLayerDepthScale(renderState, layerIndex);
      const depthOffset = getLayerDepthOffset(renderState, layerIndex);

      for (let y = 0; y < layer.height; y += 1) {
        const globalY = layer.top + y;
        if (globalY < 0 || globalY >= renderState.imageHeight) {
          continue;
        }

        for (let x = 0; x < layer.width; x += 1) {
          const localIndex = y * layer.width + x;
          if (!effectiveMaskPixels[localIndex] || baseDepthPixels[localIndex] <= 0) {
            continue;
          }

          const globalX = layer.left + x;
          if (globalX < 0 || globalX >= renderState.imageWidth) {
            continue;
          }

          sum += clamp(Math.round(baseDepthPixels[localIndex] * depthScale + depthOffset), 1, 255);
          count += 1;
        }
      }
    }

    const centroid = count > 0 ? sum / count : 0;
    if (renderState.composedSource) {
      renderState.composedSource.globalDepthCentroid = centroid;
    }
    return centroid;
  }
  

  return {
    clearSceneVisuals,
    buildLayerMeshes,
    updateAdjustedLayerMeshes,
    buildPreparedLayerEntries
  };
}
