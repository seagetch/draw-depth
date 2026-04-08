export function createSegmentDepthRuntime(deps) {
  const {
    renderState,
    depthDiscontinuityEl,
    createDepthTextureResources,
    computeSegmentDepthMeans,
    repairDepthDiscontinuities,
    clamp,
    disposeAdjustedDepthTexture,
  } = deps

  function applySegmentDepthAdjustments() {
    disposeAdjustedDepthTexture();
  
    if (!renderState.repairedBaseDepthPixels) {
      return;
    }
  
    const adjustedPixels = new Uint8Array(renderState.baseDepthPixels.length);
  
    for (let index = 0; index < renderState.repairedBaseDepthPixels.length; index += 1) {
      const baseDepth = renderState.repairedBaseDepthPixels[index];
      const segmentIndex = renderState.segmentMap[index];
      if (baseDepth <= 0 || segmentIndex < 0) {
        adjustedPixels[index] = 0;
        continue;
      }
  
      const scaled = baseDepth * renderState.segmentDepthScales[segmentIndex];
      const shifted = scaled + renderState.segmentDepthOffsets[segmentIndex];
      adjustedPixels[index] = clamp(Math.round(shifted), 1, 255);
    }
  
    const finalPixels = adjustedPixels;
  
    const adjusted = createDepthTextureResources(
      renderState.imageWidth,
      renderState.imageHeight,
      finalPixels,
    );
  
    renderState.adjustedDepthTexture = adjusted.texture;
    renderState.activeDepthTexture = adjusted.texture;
    renderState.activeDepthPixels = adjusted.pixels;
  }
  
  function rebuildRepairedBaseDepth() {
    const baseSegmentDepthMeans = computeSegmentDepthMeans(
      renderState.baseDepthPixels,
      renderState.segmentMap,
      renderState.segmentCount,
    );
    const repaired = repairDepthDiscontinuities(
      renderState.baseDepthPixels,
      renderState.segmentMap,
      baseSegmentDepthMeans,
      renderState.imageWidth,
      renderState.imageHeight,
      Number(depthDiscontinuityEl.value),
    );
  
    renderState.repairedBaseDepthTexture = repaired.texture;
    renderState.repairedBaseDepthPixels = repaired.pixels;
    renderState.repairedBaseGapMask = repaired.gapMask;
    renderState.segmentDepthMeans = computeSegmentDepthMeans(
      repaired.pixels,
      renderState.segmentMap,
      renderState.segmentCount,
    );
    applySegmentDepthAdjustments();
  }
  
  function updateSegmentMaskTexture() {
    if (!renderState.segmentMaskData || !renderState.segmentMaskTexture) {
      return;
    }
  
    for (let i = 0; i < renderState.segmentMap.length; i += 1) {
      const segmentIndex = renderState.segmentMap[i];
      renderState.segmentMaskData[i] = segmentIndex >= 0 && renderState.segmentVisibility[segmentIndex]
        ? 255
        : 0;
    }
  
    renderState.segmentMaskTexture.needsUpdate = true;
    if (renderState.material) {
      renderState.material.uniforms.uSegmentMaskTexture.value = renderState.segmentMaskTexture;
    }
  }
  
  function disposeSegmentMaskTexture() {
    if (renderState.segmentMaskTexture) {
      renderState.segmentMaskTexture.dispose();
      renderState.segmentMaskTexture = null;
    }
  }
  

  return {
    applySegmentDepthAdjustments,
    rebuildRepairedBaseDepth,
    updateSegmentMaskTexture,
    disposeSegmentMaskTexture,
  };
}
