export function createAppResources(deps) {
  const { renderState, elements } = deps

  const { statusEl, depthModeEl, interpModeEl } = elements

  function refreshStatusCounts() {
    if (renderState.sourceMode === "psd") {
      const layerCount = renderState.psdLayerEntries.length;
      const visibleLayers = renderState.psdLayerVisibility.filter(Boolean).length;
      const triangleCount = renderState.psdLayerMeshes.reduce(
        (sum, entry) => sum + (entry.mesh.geometry.index ? entry.mesh.geometry.index.count / 3 : 0),
        0,
      );
      const vertexCount = renderState.psdLayerMeshes.reduce(
        (sum, entry) => sum + entry.mesh.geometry.attributes.position.count,
        0,
      );
      const debugSuffix = renderState.psdDebugLayerIndex >= 0
        ? ` | debug D=kept R=pixel M=component Y=contour dark=empty`
        : "";
      statusEl.textContent = `${renderState.imageWidth}x${renderState.imageHeight} | psd-layers ${visibleLayers}/${layerCount} | vertices ${vertexCount.toLocaleString()} | triangles ${triangleCount.toLocaleString()}${debugSuffix}`;
      return;
    }
  
    if (!renderState.mesh) {
      return;
    }
  
    const triangleCount = renderState.mesh.geometry.index.count / 3;
    const vertexCount = renderState.mesh.geometry.attributes.position.count;
    const modeLabel = depthModeEl.value === "raw"
      ? "raw"
      : `grid-${interpModeEl.value}`;
    const visibleSegments = renderState.segmentVisibility.filter(Boolean).length;
    statusEl.textContent = `${renderState.imageWidth}x${renderState.imageHeight} | ${modeLabel} | segments ${visibleSegments}/${renderState.segmentCount} | vertices ${vertexCount.toLocaleString()} | triangles ${triangleCount.toLocaleString()}`;
  }
  
  function rebuildDepthModeResources() {
    disposeGeneratedDepthTexture();
    disposeAdjustedDepthTexture();
    disposeRepairedBaseDepthTexture();
  
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
  
  function disposeGeneratedDepthTexture() {
    if (renderState.generatedDepthTexture) {
      renderState.generatedDepthTexture.dispose();
      renderState.generatedDepthTexture = null;
    }
  }
  
  function disposeAdjustedDepthTexture() {
    if (renderState.adjustedDepthTexture) {
      renderState.adjustedDepthTexture.dispose();
      renderState.adjustedDepthTexture = null;
    }
  }
  
  function disposeRepairedBaseDepthTexture() {
    if (renderState.repairedBaseDepthTexture) {
      renderState.repairedBaseDepthTexture.dispose();
      renderState.repairedBaseDepthTexture = null;
      renderState.repairedBaseDepthPixels = null;
      renderState.repairedBaseGapMask = null;
    }
  }
  
  function disposeMeshDepthTexture() {
    if (renderState.meshDepthTexture) {
      if (renderState.meshDepthTexture !== renderState.activeDepthTexture) {
        renderState.meshDepthTexture.dispose();
      }
      renderState.meshDepthTexture = null;
      renderState.meshDepthPixels = null;
    }
  }
  
  function disposeProcessedDepthTexture() {
    if (renderState.processedDepthTexture) {
      renderState.processedDepthTexture.dispose();
      renderState.processedDepthTexture = null;
    }
  }
  
  function disposeRawDepthTexture() {
    if (renderState.rawDepthTexture) {
      renderState.rawDepthTexture.dispose();
      renderState.rawDepthTexture = null;
      renderState.rawDepthPixels = null;
    }
  }
  

  return {
    refreshStatusCounts,
    disposeGeneratedDepthTexture,
    disposeAdjustedDepthTexture,
    disposeRepairedBaseDepthTexture,
    disposeMeshDepthTexture,
    disposeProcessedDepthTexture,
    disposeRawDepthTexture
  };
}
