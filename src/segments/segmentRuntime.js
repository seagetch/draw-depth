export function createSegmentRuntime(deps) {
  const {
    THREE,
    renderState,
    clusterSegmentPixels,
    composeSegmentDepthResources,
    preprocessSegmentDepths,
    rebuildSegmentList,
    disposeSegmentMaskTexture,
    disposeRawDepthTexture,
    disposeProcessedDepthTexture,
    updateSegmentMaskTexture,
  } = deps

  function rebuildSegments() {
    disposeSegmentMaskTexture();
  
    const segmentation = clusterSegmentPixels(
      renderState.segmentSourcePixels,
      renderState.sourceDepthPixels,
      renderState.imageWidth,
      renderState.imageHeight,
    );
  
    renderState.segmentMap = segmentation.segmentMap;
    renderState.segmentCount = segmentation.count;
    renderState.segmentPalette = segmentation.palette;
    renderState.segmentPixelCounts = segmentation.pixelCounts;
    renderState.segmentVisibility = new Array(segmentation.count).fill(true);
    renderState.segmentDepthOffsets = new Array(segmentation.count).fill(0);
    renderState.segmentDepthScales = new Array(segmentation.count).fill(1);
    renderState.rawSegmentData = segmentation.segmentData;
    renderState.segmentPixels = segmentation.segmentPixels;
    renderState.segmentBounds = segmentation.segmentBounds;
    renderState.segmentData = segmentation.segmentData;
    rebuildProcessedDepthData();
    renderState.segmentMaskData = new Uint8Array(renderState.imageWidth * renderState.imageHeight);
    renderState.segmentMaskTexture = new THREE.DataTexture(
      renderState.segmentMaskData,
      renderState.imageWidth,
      renderState.imageHeight,
      THREE.LuminanceFormat,
    );
    renderState.segmentMaskTexture.flipY = true;
    renderState.segmentMaskTexture.minFilter = THREE.NearestFilter;
    renderState.segmentMaskTexture.magFilter = THREE.NearestFilter;
    renderState.segmentMaskTexture.needsUpdate = true;
  
    updateSegmentMaskTexture();
    rebuildSegmentList();
  }
  
  function rebuildProcessedDepthData() {
    disposeRawDepthTexture();
    disposeProcessedDepthTexture();
  
    const raw = composeSegmentDepthResources(
      renderState.imageWidth,
      renderState.imageHeight,
      renderState.rawSegmentData,
      "localDepthPixels",
    );
    renderState.rawDepthPixels = raw.pixels;
    renderState.rawDepthTexture = raw.texture;
  
    const processed = preprocessSegmentDepths(
      renderState.imageWidth,
      renderState.imageHeight,
      renderState.rawSegmentData,
    );
  
    renderState.segmentData = processed.segmentData;
    renderState.processedDepthPixels = processed.pixels;
    renderState.processedDepthTexture = processed.texture;
  }
  

  return {
    rebuildSegments,
    rebuildProcessedDepthData
  };
}
