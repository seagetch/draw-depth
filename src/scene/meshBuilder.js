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
    buildPsdLayerGeometry,
    createPsdDepthPreviewUrl,
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
  
    if (renderState.psdLayerMeshes.length) {
      for (let i = 0; i < renderState.psdLayerMeshes.length; i += 1) {
        const entry = renderState.psdLayerMeshes[i];
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
      renderState.psdLayerMeshes = [];
    }
  }
  
  function buildPsdLayerMeshes() {
    const layers = buildPreparedPsdLayerEntries();
    const useSurfaceSmooth = surfaceSmoothEl.checked;
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[i];
      if (!renderState.psdLayerVisibility[i]) {
        continue;
      }
  
      const geometry = buildPsdLayerGeometry(
        renderState.imageWidth,
        renderState.imageHeight,
        layer,
        Number(meshDetailEl.value),
        {
          bakeDepth: useSurfaceSmooth,
          depthScale: Number(depthScaleEl.value),
          invertDepth: invertDepthEl.checked,
          surfaceSmooth: useSurfaceSmooth,
        },
      );
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uColorTexture: { value: layer.colorTexture },
          uMaskTexture: { value: layer.maskTexture },
          ...(useSurfaceSmooth ? {} : {
            uDepthTexture: { value: layer.depthTexture },
            uDepthScale: { value: Number(depthScaleEl.value) },
            uInvertDepth: { value: invertDepthEl.checked ? 1 : 0 },
          }),
        },
        vertexShader: useSurfaceSmooth ? staticVertexShader : psdLayerVertexShader,
        fragmentShader: useSurfaceSmooth ? staticPsdLayerFragmentShader : psdLayerFragmentShader,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = i;
      scene.add(mesh);
      renderState.psdLayerMeshes.push({
        mesh,
        layerIndex: i,
        depthTexture: layer.depthTexture,
        maskTexture: layer.maskTexture,
      });
    }
  }
  
  function buildPreparedPsdLayerEntries() {
    const sourceLayers = renderState.psdLayerEntries || [];
    const preparedLayers = new Array(sourceLayers.length);
    const upperDepthLimit = new Uint16Array(renderState.imageWidth * renderState.imageHeight);
    upperDepthLimit.fill(256);
  
    for (let layerIndex = sourceLayers.length - 1; layerIndex >= 0; layerIndex -= 1) {
      const layer = sourceLayers[layerIndex];
      const baseDepthPixels = layer.baseDepthPixels || layer.depthPixels;
      const effectiveDepthPixels = new Uint8Array(baseDepthPixels.length);
      const renderDepthMask = new Uint8Array(baseDepthPixels.length);
      const effectiveMaskPixels = layer.maskPixels;
      const depthScale = renderState.psdLayerDepthScales[layerIndex] ?? 1;
      const depthOffset = renderState.psdLayerDepthOffsets[layerIndex] ?? 0;
  
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
          let effectiveDepth = clamp(Math.round(baseDepth * depthScale + depthOffset), 1, 255);
          const upperLimit = upperDepthLimit[globalIndex];
          if (!layer.hasDirectDepth && upperLimit <= 255) {
            effectiveDepth = Math.min(effectiveDepth, Math.max(1, upperLimit - 1));
          }
  
          effectiveDepthPixels[localIndex] = effectiveDepth;
        renderDepthMask[localIndex] = 1;
        }
      }
  
      if (renderState.psdLayerVisibility[layerIndex]) {
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
            if (!layer.hasDirectDepth) {
              upperDepthLimit[globalIndex] = Math.min(upperDepthLimit[globalIndex], effectiveDepth);
            }
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
  
    return preparedLayers;
  }
  

  return {
    clearSceneVisuals,
    buildPsdLayerMeshes,
    buildPreparedPsdLayerEntries
  };
}
