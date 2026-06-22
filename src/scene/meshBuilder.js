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

    if (renderState.psdLayerDebugMeshes.length) {
      for (let i = 0; i < renderState.psdLayerDebugMeshes.length; i += 1) {
        const entry = renderState.psdLayerDebugMeshes[i];
        scene.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        entry.mesh.material.dispose();
      }
      renderState.psdLayerDebugMeshes = [];
    }
  }
  
  function buildPsdLayerMeshes() {
    const layers = buildPreparedPsdLayerEntries();
    const usePuppetDeform = !!renderState.puppetEnabled;
    const useSurfaceSmooth = surfaceSmoothEl.checked;
    const bakeDepth = useSurfaceSmooth || usePuppetDeform;
    const fadeBaseMeshes = !!renderState.generatedMeshDebugEnabled;
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
          bakeDepth,
          depthScale: Number(depthScaleEl.value),
          invertDepth: invertDepthEl.checked,
          surfaceSmooth: useSurfaceSmooth,
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
      mesh.userData.targetKey = `psd:${i}`;
      mesh.renderOrder = i;
      scene.add(mesh);
      renderState.psdLayerMeshes.push({
        mesh,
        layerIndex: i,
        targetKey: `psd:${i}`,
        depthTexture: layer.depthTexture,
        maskTexture: layer.maskTexture,
      });

      if (renderState.generatedMeshDebugEnabled && renderState.generatedMeshDebugData) {
        const debugLayer = renderState.generatedMeshDebugData.layersByIndex?.[i]
          || renderState.generatedMeshDebugData.layersByName.get(layer.name);
        const debugMesh = createGeneratedMeshDebugMesh(debugLayer, i);
        if (debugMesh) {
          scene.add(debugMesh);
          renderState.psdLayerDebugMeshes.push({
            mesh: debugMesh,
            layerIndex: i,
          });
        }
      }
    }
    if (meshEditRuntime) {
      meshEditRuntime.applyToEntries(renderState.psdLayerMeshes);
      meshEditRuntime.sync(renderState.psdLayerMeshes);
    }
    if (puppetRuntime) {
      puppetRuntime.sync(renderState.psdLayerMeshes);
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
  
  function buildPreparedPsdLayerEntries() {
    const sourceLayers = renderState.psdLayerEntries || [];
    const preparedLayers = new Array(sourceLayers.length);
    const upperDepthLimit = new Uint16Array(renderState.imageWidth * renderState.imageHeight);
    upperDepthLimit.fill(256);
    const globalDepthCenter = computePreparedPsdDepthCentroid(sourceLayers);
  
    for (let layerIndex = sourceLayers.length - 1; layerIndex >= 0; layerIndex -= 1) {
      const layer = sourceLayers[layerIndex];
      const baseDepthPixels = layer.baseDepthPixels || layer.depthPixels;
      const effectiveDepthPixels = new Uint8Array(baseDepthPixels.length);
      const renderDepthMask = new Uint8Array(baseDepthPixels.length);
      const effectiveMaskPixels = layer.surfaceMaskPixels || layer.maskPixels;
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
          const layerDepth = clamp(Math.round(baseDepth * depthScale + depthOffset), 1, 255);
          const scaledDepth = scaleDepthValueAroundCenter(
            layerDepth,
            renderState.globalDepthScale,
            globalDepthCenter,
          );
          let sortDepth = invertDepthEl.checked ? 255 - scaledDepth : scaledDepth;
          const upperLimit = upperDepthLimit[globalIndex];
          if (upperLimit <= 255) {
            const limitedDepth = Math.max(1, upperLimit - 1);
            sortDepth = Math.min(sortDepth, limitedDepth);
          }
          const effectiveDepth = invertDepthEl.checked ? 255 - sortDepth : sortDepth;
  
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

    return preparedLayers;
  }

  function computePreparedPsdDepthCentroid(sourceLayers) {
    let sum = 0;
    let count = 0;

    for (let layerIndex = 0; layerIndex < sourceLayers.length; layerIndex += 1) {
      if (!renderState.psdLayerVisibility[layerIndex]) {
        continue;
      }
      const layer = sourceLayers[layerIndex];
      const baseDepthPixels = layer.baseDepthPixels || layer.depthPixels;
      const effectiveMaskPixels = layer.surfaceMaskPixels || layer.maskPixels;
      if (!baseDepthPixels || !effectiveMaskPixels) {
        continue;
      }
      const depthScale = renderState.psdLayerDepthScales[layerIndex] ?? 1;
      const depthOffset = renderState.psdLayerDepthOffsets[layerIndex] ?? 0;

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

    renderState.globalDepthCentroid = count > 0 ? sum / count : 0;
    return renderState.globalDepthCentroid;
  }
  

  return {
    clearSceneVisuals,
    buildPsdLayerMeshes,
    buildPreparedPsdLayerEntries
  };
}
