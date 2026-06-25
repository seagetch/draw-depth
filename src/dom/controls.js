import { getGlobalDepthScale, setGlobalDepthScale } from "../composite/schema.js";
import { cancelCompositeWorkerTasks } from "../workers/compositeWorkerClient.js?v=20260626_4";

export function wireControls(deps) {
  const {
    elements,
    renderState,
    syncViewerModeUi,
    syncThumbs,
    buildMesh,
    rebuildLayerEntriesIfNeeded,
    rebuildDepthModeResources,
    startAlphaDepthGapFill,
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
    alphaDepthGapFillButtonEl,
    workerProgressPanelEl,
    workerProgressLabelEl,
    workerProgressFillEl,
    workerCancelButtonEl,
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

  function isCancelledError(error) {
    return /cancel/i.test(error?.message || "");
  }

  depthScaleValueEl.textContent = Number(depthScaleEl.value).toFixed(2);
  if (globalDepthScaleEl && globalDepthScaleValueEl) {
    setGlobalDepthScale(renderState, Number(globalDepthScaleEl.value));
    globalDepthScaleValueEl.textContent = getGlobalDepthScale(renderState).toFixed(1);
  }
  meshDetailValueEl.textContent = meshDetailEl.value;
  depthDiscontinuityValueEl.textContent = depthDiscontinuityEl.value;
  gridXValueEl.textContent = gridXEl.value;
  gridYValueEl.textContent = gridYEl.value;
  kernelSizeValueEl.textContent = kernelSizeEl.value;

  depthScaleEl.addEventListener("input", () => {
    depthScaleValueEl.textContent = Number(depthScaleEl.value).toFixed(2);
    if (surfaceSmoothEl.checked) {
      runUiProgress("Rebuilding mesh", () => {
        buildMesh();
      }).catch((error) => {
        console.error(error);
        statusEl.textContent = `Failed: ${error.message}`;
      });
      return;
    }
    if (renderState.material) {
      renderState.material.uniforms.uDepthScale.value = Number(depthScaleEl.value);
    }
    if (renderState.edgePointMaterial) {
      renderState.edgePointMaterial.uniforms.uDepthScale.value = Number(depthScaleEl.value);
    }
    for (let i = 0; i < renderState.layerMeshes.length; i += 1) {
      renderState.layerMeshes[i].mesh.material.uniforms.uDepthScale.value =
        Number(depthScaleEl.value);
      renderState.layerMeshes[i].mesh.position.z = 0;
    }
  });

  globalDepthScaleEl?.addEventListener("input", () => {
    const scale = Number(globalDepthScaleEl.value);
    globalDepthScaleValueEl.textContent = scale.toFixed(1);
    setGlobalDepthScale(renderState, scale);
    if (renderState.colorComposite?.format === "psd") {
      runUiProgress("Rebuilding mesh", () => {
        buildMesh();
        updatePsdDebugPanel();
      }).catch((error) => {
        console.error(error);
        statusEl.textContent = `Failed: ${error.message}`;
      });
      return;
    }
    runUiProgress("Rebuilding depth scale", () => {
      applySegmentDepthAdjustments();
      buildMesh();
    }).catch((error) => {
      console.error(error);
      statusEl.textContent = `Failed: ${error.message}`;
    });
  });

  meshDetailEl.addEventListener("input", () => {
    meshDetailValueEl.textContent = meshDetailEl.value;
  });

  depthDiscontinuityEl.addEventListener("input", () => {
    depthDiscontinuityValueEl.textContent = depthDiscontinuityEl.value;
  });

  meshDetailEl.addEventListener("change", () => {
    runUiProgress("Rebuilding mesh", () => {
      buildMesh();
    }).catch((error) => {
      console.error(error);
      statusEl.textContent = `Failed: ${error.message}`;
    });
  });

  depthDiscontinuityEl.addEventListener("change", async () => {
    const reloaded = await rebuildLayerEntriesWithProgress("Rebuilding layers");
    if (reloaded == null) {
      return;
    }
    if (reloaded) {
      await runUiProgress("Rebuilding mesh", () => {
        buildMesh();
      });
      return;
    }
    await runUiProgress("Rebuilding depth mode", () => {
      return rebuildDepthModeAndMesh("Rebuilding depth mode");
    });
  });

  invertDepthEl.addEventListener("change", () => {
    if (surfaceSmoothEl.checked) {
      runUiProgress("Rebuilding mesh", () => {
        buildMesh();
      }).catch((error) => {
        console.error(error);
        statusEl.textContent = `Failed: ${error.message}`;
      });
      return;
    }
    if (renderState.material) {
      renderState.material.uniforms.uInvertDepth.value = invertDepthEl.checked ? 1 : 0;
    }
    if (renderState.edgePointMaterial) {
      renderState.edgePointMaterial.uniforms.uInvertDepth.value = invertDepthEl.checked ? 1 : 0;
    }
    for (let i = 0; i < renderState.layerMeshes.length; i += 1) {
      renderState.layerMeshes[i].mesh.material.uniforms.uInvertDepth.value = invertDepthEl.checked ? 1 : 0;
    }
  });

  sourceModeEl.addEventListener("change", async () => {
    try {
      renderState.sourceMode = sourceModeEl.value;
      if (sourceModeEl.value === "psd") {
        statusEl.textContent = "Loading PSD pair...";
        showWorkerProgress("Loading PSD pair");
        try {
          await ensureDefaultPsdPairLoaded({
            onProgress: (progress) => updateWorkerProgress(progress, "Loading PSD pair"),
          });
        } finally {
          hideWorkerProgress();
        }
      } else {
        renderState.imageWidth = renderState.rasterImageWidth;
        renderState.imageHeight = renderState.rasterImageHeight;
      }
      syncViewerModeUi();
      rebuildSegmentList();
      await runUiProgress("Rebuilding view", () => {
        buildMesh();
        updatePsdDebugPanel();
        syncThumbs();
      });
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
    const reloaded = await rebuildLayerEntriesWithProgress("Rebuilding layers");
    if (reloaded == null) {
      return;
    }
    if (reloaded) {
      await runUiProgress("Rebuilding mesh", () => {
        buildMesh();
      });
      return;
    }
    await runUiProgress("Rebuilding depth mode", () => {
      return rebuildDepthModeAndMesh("Repair contour band");
    });
  });

  let activeWorkerTask = null;

  function showWorkerProgress(label) {
    workerProgressPanelEl?.classList.add("is-visible");
    if (workerProgressLabelEl) {
      workerProgressLabelEl.textContent = label;
    }
    if (workerProgressFillEl) {
      workerProgressFillEl.style.width = "0%";
    }
  }

  function updateWorkerProgress(progress, labelPrefix = "Alpha-depth gap fill") {
    if (!progress || progress.total == null) {
      return;
    }
    const current = Math.min(progress.total, progress.current ?? 0);
    const percent = progress.total > 0 ? Math.round((current / progress.total) * 100) : 0;
    const layer = progress.layerName ? ` ${progress.layerName}` : "";
    const message = progress.message ? ` ${progress.message}` : "";
    if (workerProgressLabelEl) {
      workerProgressLabelEl.textContent = `${labelPrefix}: ${current}/${progress.total}${layer}${message}`;
    }
    if (workerProgressFillEl) {
      workerProgressFillEl.style.width = `${percent}%`;
    }
    statusEl.textContent = `${labelPrefix}: ${current}/${progress.total}${layer}${message}`;
  }

  function hideWorkerProgress() {
    workerProgressPanelEl?.classList.remove("is-visible");
    activeWorkerTask = null;
  }

  function waitForPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  async function runUiProgress(label, task) {
    showWorkerProgress(label);
    updateWorkerProgress({ current: 0, total: 1, message: "starting" }, label);
    try {
      await waitForPaint();
      const result = await task();
      updateWorkerProgress({ current: 1, total: 1, message: "done" }, label);
      return result;
    } catch (error) {
      if (isCancelledError(error)) {
        statusEl.textContent = "Cancelled.";
        return null;
      }
      throw error;
    } finally {
      hideWorkerProgress();
    }
  }

  async function rebuildLayerEntriesWithProgress(label) {
    showWorkerProgress(label);
    updateWorkerProgress({ current: 0, total: 1, message: "starting" }, label);
    try {
      const result = await rebuildLayerEntriesIfNeeded({
        onProgress: (progress) => updateWorkerProgress(progress, label),
      });
      updateWorkerProgress({ current: 1, total: 1, message: "done" }, label);
      return result;
    } catch (error) {
      if (isCancelledError(error)) {
        statusEl.textContent = "Cancelled.";
        return null;
      }
      throw error;
    } finally {
      hideWorkerProgress();
    }
  }

  function rebuildDepthModeAndMesh(label) {
    return rebuildDepthModeResources({
      onProgress: (progress) => updateWorkerProgress(progress, label),
    }).then(() => {
      buildMesh();
    });
  }

  workerCancelButtonEl?.addEventListener("click", () => {
    if (activeWorkerTask) {
      activeWorkerTask.cancel();
    } else {
      cancelCompositeWorkerTasks();
    }
    statusEl.textContent = "Cancelling worker task...";
  });

  alphaDepthGapFillButtonEl?.addEventListener("click", () => {
    if (activeWorkerTask) {
      return;
    }
    showWorkerProgress("Starting alpha-depth gap fill...");
    Promise.resolve().then(async () => {
      if (await rebuildLayerEntriesIfNeeded({
        onProgress: (progress) => updateWorkerProgress(progress, "Rebuilding layers"),
      })) {
        // Rebuild may replace the composed source; run after the source is current.
      }
      activeWorkerTask = startAlphaDepthGapFill({
        onProgress: (progress) => updateWorkerProgress(progress, "Alpha-depth gap fill"),
      });
      return activeWorkerTask.promise;
    }).then((result) => {
      statusEl.textContent = `Alpha-depth gap fill pass ${result.pass}: marked ${result.totalMarked}, filled ${result.totalFilled}.`;
      hideWorkerProgress();
    }).catch((error) => {
      console.error(error);
      statusEl.textContent = isCancelledError(error) ? "Cancelled." : `Failed: ${error.message}`;
      hideWorkerProgress();
    });
  });

  surfaceSmoothEl.addEventListener("change", async () => {
    const reloaded = await rebuildLayerEntriesWithProgress("Rebuilding layers");
    if (reloaded == null) {
      return;
    }
    if (reloaded) {
      await runUiProgress("Rebuilding mesh", () => {
        buildMesh();
      });
      return;
    }
    await runUiProgress("Rebuilding mesh", () => {
      applySegmentDepthAdjustments();
      buildMesh();
    });
  });

  generatedMeshDebugEnabledEl?.addEventListener("change", async () => {
    try {
      await runUiProgress("Updating debug mesh", () => setGeneratedMeshDebugEnabled(generatedMeshDebugEnabledEl.checked));
    } catch (error) {
      console.error(error);
      generatedMeshDebugEnabledEl.checked = false;
      renderState.generatedMeshDebugEnabled = false;
      statusEl.textContent = `Failed: ${error.message}`;
    }
  });

  depthModeEl.addEventListener("change", async () => {
    const reloaded = await rebuildLayerEntriesWithProgress("Rebuilding layers");
    if (reloaded == null) {
      return;
    }
    if (reloaded) {
      await runUiProgress("Rebuilding mesh", () => {
        buildMesh();
      });
      return;
    }
    await runUiProgress("Rebuilding depth mode", () => {
      return rebuildDepthModeAndMesh("Rebuilding depth mode");
    });
  });

  gridSpecModeEl.addEventListener("change", async () => {
    const reloaded = await rebuildLayerEntriesWithProgress("Rebuilding layers");
    if (reloaded == null) {
      return;
    }
    if (reloaded) {
      await runUiProgress("Rebuilding mesh", () => {
        buildMesh();
      });
      return;
    }
    await runUiProgress("Rebuilding depth mode", () => {
      return rebuildDepthModeAndMesh("Rebuilding depth mode");
    });
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
    const reloaded = await rebuildLayerEntriesWithProgress("Rebuilding layers");
    if (reloaded == null) {
      return;
    }
    if (reloaded) {
      await runUiProgress("Rebuilding mesh", () => {
        buildMesh();
      });
      return;
    }
    await runUiProgress("Rebuilding depth mode", () => {
      return rebuildDepthModeAndMesh("Rebuilding depth mode");
    });
  });

  gridYEl.addEventListener("change", async () => {
    const reloaded = await rebuildLayerEntriesWithProgress("Rebuilding layers");
    if (reloaded == null) {
      return;
    }
    if (reloaded) {
      await runUiProgress("Rebuilding mesh", () => {
        buildMesh();
      });
      return;
    }
    await runUiProgress("Rebuilding depth mode", () => {
      return rebuildDepthModeAndMesh("Rebuilding depth mode");
    });
  });

  kernelSizeEl.addEventListener("change", async () => {
    const reloaded = await rebuildLayerEntriesWithProgress("Rebuilding layers");
    if (reloaded == null) {
      return;
    }
    if (reloaded) {
      await runUiProgress("Rebuilding mesh", () => {
        buildMesh();
      });
      return;
    }
    await runUiProgress("Rebuilding depth mode", () => {
      return rebuildDepthModeAndMesh("Rebuilding depth mode");
    });
  });

  interpModeEl.addEventListener("change", async () => {
    const reloaded = await rebuildLayerEntriesWithProgress("Rebuilding layers");
    if (reloaded == null) {
      return;
    }
    if (reloaded) {
      await runUiProgress("Rebuilding mesh", () => {
        buildMesh();
      });
      return;
    }
    await runUiProgress("Rebuilding depth mode", () => {
      return rebuildDepthModeAndMesh("Rebuilding depth mode");
    });
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

    showWorkerProgress(`Loading color: ${file.name}`);
    try {
      await replaceImage("color", file, {
        onProgress: (progress) => updateWorkerProgress(progress, "Loading color"),
      });
    } catch (error) {
      console.error(error);
      statusEl.textContent = isCancelledError(error) ? "Cancelled." : `Failed: ${error.message}`;
    } finally {
      hideWorkerProgress();
      colorFileInputEl.value = "";
    }
  });

  depthFileInputEl.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    showWorkerProgress(`Loading depth: ${file.name}`);
    try {
      await replaceImage("depth", file, {
        onProgress: (progress) => updateWorkerProgress(progress, "Loading depth"),
      });
    } catch (error) {
      console.error(error);
      statusEl.textContent = isCancelledError(error) ? "Cancelled." : `Failed: ${error.message}`;
    } finally {
      hideWorkerProgress();
      depthFileInputEl.value = "";
    }
  });

  segmentFileInputEl.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    showWorkerProgress(`Loading segment: ${file.name}`);
    try {
      await replaceImage("segment", file, {
        onProgress: (progress) => updateWorkerProgress(progress, "Loading segment"),
      });
    } catch (error) {
      console.error(error);
      statusEl.textContent = isCancelledError(error) ? "Cancelled." : `Failed: ${error.message}`;
    } finally {
      hideWorkerProgress();
      segmentFileInputEl.value = "";
    }
  });

  window.addEventListener("resize", onResize);
}
