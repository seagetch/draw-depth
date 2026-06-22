export function wireControls(deps) {
  const {
    elements,
    renderState,
    syncViewerModeUi,
    syncThumbs,
    buildMesh,
    rebuildPsdLayerEntriesIfNeeded,
    rebuildDepthModeResources,
    applySegmentDepthAdjustments,
    rebuildSegmentList,
    updatePsdDebugPanel,
    ensureDefaultPsdPairLoaded,
    saveCurrentPsdDepthAsPsd,
    setGeneratedMeshDebugEnabled,
    replaceImage,
    onResize,
  } = deps;

  const {
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
  } = elements;

  depthScaleValueEl.textContent = Number(depthScaleEl.value).toFixed(2);
  if (globalDepthScaleEl && globalDepthScaleValueEl) {
    globalDepthScaleValueEl.textContent = Number(globalDepthScaleEl.value).toFixed(1);
    renderState.globalDepthScale = Number(globalDepthScaleEl.value);
  }
  meshDetailValueEl.textContent = meshDetailEl.value;
  depthDiscontinuityValueEl.textContent = depthDiscontinuityEl.value;
  gridXValueEl.textContent = gridXEl.value;
  gridYValueEl.textContent = gridYEl.value;
  kernelSizeValueEl.textContent = kernelSizeEl.value;

  depthScaleEl.addEventListener("input", () => {
    depthScaleValueEl.textContent = Number(depthScaleEl.value).toFixed(2);
    if (surfaceSmoothEl.checked) {
      buildMesh();
      return;
    }
    if (renderState.material) {
      renderState.material.uniforms.uDepthScale.value = Number(depthScaleEl.value);
    }
    if (renderState.edgePointMaterial) {
      renderState.edgePointMaterial.uniforms.uDepthScale.value = Number(depthScaleEl.value);
    }
    for (let i = 0; i < renderState.psdLayerMeshes.length; i += 1) {
      renderState.psdLayerMeshes[i].mesh.material.uniforms.uDepthScale.value =
        Number(depthScaleEl.value);
      renderState.psdLayerMeshes[i].mesh.position.z = 0;
    }
  });

  globalDepthScaleEl?.addEventListener("input", () => {
    const scale = Number(globalDepthScaleEl.value);
    globalDepthScaleValueEl.textContent = scale.toFixed(1);
    renderState.globalDepthScale = scale;
    if (renderState.sourceMode === "psd") {
      buildMesh();
      updatePsdDebugPanel();
      return;
    }
    applySegmentDepthAdjustments();
    buildMesh();
  });

  meshDetailEl.addEventListener("input", () => {
    meshDetailValueEl.textContent = meshDetailEl.value;
  });

  depthDiscontinuityEl.addEventListener("input", () => {
    depthDiscontinuityValueEl.textContent = depthDiscontinuityEl.value;
  });

  meshDetailEl.addEventListener("change", () => {
    buildMesh();
  });

  depthDiscontinuityEl.addEventListener("change", async () => {
    if (await rebuildPsdLayerEntriesIfNeeded()) {
      buildMesh();
      return;
    }
    rebuildDepthModeResources();
    buildMesh();
  });

  invertDepthEl.addEventListener("change", () => {
    if (surfaceSmoothEl.checked) {
      buildMesh();
      return;
    }
    if (renderState.material) {
      renderState.material.uniforms.uInvertDepth.value = invertDepthEl.checked ? 1 : 0;
    }
    if (renderState.edgePointMaterial) {
      renderState.edgePointMaterial.uniforms.uInvertDepth.value = invertDepthEl.checked ? 1 : 0;
    }
    for (let i = 0; i < renderState.psdLayerMeshes.length; i += 1) {
      renderState.psdLayerMeshes[i].mesh.material.uniforms.uInvertDepth.value = invertDepthEl.checked ? 1 : 0;
    }
  });

  sourceModeEl.addEventListener("change", async () => {
    try {
      renderState.sourceMode = sourceModeEl.value;
      if (renderState.sourceMode === "psd") {
        statusEl.textContent = "Loading PSD pair...";
        await ensureDefaultPsdPairLoaded();
      } else {
        renderState.imageWidth = renderState.rasterImageWidth;
        renderState.imageHeight = renderState.rasterImageHeight;
      }
      syncViewerModeUi();
      rebuildSegmentList();
      buildMesh();
      updatePsdDebugPanel();
      syncThumbs();
    } catch (error) {
      console.error(error);
      renderState.sourceMode = "raster";
      sourceModeEl.value = "raster";
      renderState.imageWidth = renderState.rasterImageWidth;
      renderState.imageHeight = renderState.rasterImageHeight;
      syncViewerModeUi();
      buildMesh();
      updatePsdDebugPanel();
      syncThumbs();
      statusEl.textContent = `Failed: ${error.message}`;
    }
  });

  contourRepairEl.addEventListener("change", async () => {
    if (await rebuildPsdLayerEntriesIfNeeded()) {
      buildMesh();
      return;
    }
    rebuildDepthModeResources();
    buildMesh();
  });

  surfaceSmoothEl.addEventListener("change", async () => {
    if (await rebuildPsdLayerEntriesIfNeeded()) {
      buildMesh();
      return;
    }
    applySegmentDepthAdjustments();
    buildMesh();
  });

  generatedMeshDebugEnabledEl?.addEventListener("change", async () => {
    try {
      await setGeneratedMeshDebugEnabled(generatedMeshDebugEnabledEl.checked);
    } catch (error) {
      console.error(error);
      generatedMeshDebugEnabledEl.checked = false;
      renderState.generatedMeshDebugEnabled = false;
      statusEl.textContent = `Failed: ${error.message}`;
    }
  });

  depthModeEl.addEventListener("change", async () => {
    if (await rebuildPsdLayerEntriesIfNeeded()) {
      buildMesh();
      return;
    }
    rebuildDepthModeResources();
    buildMesh();
  });

  gridSpecModeEl.addEventListener("change", async () => {
    if (await rebuildPsdLayerEntriesIfNeeded()) {
      buildMesh();
      return;
    }
    rebuildDepthModeResources();
    buildMesh();
  });

  gridXEl.addEventListener("input", () => {
    gridXValueEl.textContent = gridXEl.value;
  });

  gridYEl.addEventListener("input", () => {
    gridYValueEl.textContent = gridYEl.value;
  });

  kernelSizeEl.addEventListener("input", () => {
    kernelSizeValueEl.textContent = kernelSizeEl.value;
  });

  gridXEl.addEventListener("change", async () => {
    if (await rebuildPsdLayerEntriesIfNeeded()) {
      buildMesh();
      return;
    }
    rebuildDepthModeResources();
    buildMesh();
  });

  gridYEl.addEventListener("change", async () => {
    if (await rebuildPsdLayerEntriesIfNeeded()) {
      buildMesh();
      return;
    }
    rebuildDepthModeResources();
    buildMesh();
  });

  kernelSizeEl.addEventListener("change", async () => {
    if (await rebuildPsdLayerEntriesIfNeeded()) {
      buildMesh();
      return;
    }
    rebuildDepthModeResources();
    buildMesh();
  });

  interpModeEl.addEventListener("change", async () => {
    if (await rebuildPsdLayerEntriesIfNeeded()) {
      buildMesh();
      return;
    }
    rebuildDepthModeResources();
    buildMesh();
  });

  colorThumbButtonEl.addEventListener("click", () => {
    colorFileInputEl.click();
  });

  depthThumbButtonEl.addEventListener("click", () => {
    depthFileInputEl.click();
  });

  segmentThumbButtonEl.addEventListener("click", () => {
    segmentFileInputEl.click();
  });

  saveDepthPsdButtonEl.addEventListener("click", async () => {
    try {
      await saveCurrentPsdDepthAsPsd();
    } catch (error) {
      console.error(error);
      statusEl.textContent = `Failed: ${error.message}`;
    }
  });

  colorFileInputEl.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    await replaceImage("color", file);
    colorFileInputEl.value = "";
  });

  depthFileInputEl.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    await replaceImage("depth", file);
    depthFileInputEl.value = "";
  });

  segmentFileInputEl.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    await replaceImage("segment", file);
    segmentFileInputEl.value = "";
  });

  window.addEventListener("resize", onResize);
}
