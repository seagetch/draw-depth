export function updatePsdDebugPanel(elements, renderState) {
  const {
    psdDebugPanelEl,
    psdDebugTitleEl,
    psdDebugImageEl,
    psdDepthImageEl,
  } = elements;

  if (!psdDebugPanelEl) {
    return;
  }

  if (renderState.sourceMode !== "psd" || renderState.psdDebugLayerIndex < 0) {
    psdDebugPanelEl.classList.remove("is-visible");
    psdDebugImageEl.removeAttribute("src");
    if (psdDepthImageEl) {
      psdDepthImageEl.removeAttribute("src");
    }
    return;
  }

  const layer = renderState.psdLayerEntries[renderState.psdDebugLayerIndex];
  if (!layer || !layer.debugPreviewUrl) {
    psdDebugPanelEl.classList.remove("is-visible");
    psdDebugImageEl.removeAttribute("src");
    if (psdDepthImageEl) {
      psdDepthImageEl.removeAttribute("src");
    }
    return;
  }

  psdDebugTitleEl.textContent =
    `PSD debug: ${layer.name || `Layer ${renderState.psdDebugLayerIndex + 1}`} | removed ${layer.removedDepthPixels || 0}px`;
  psdDebugImageEl.src = layer.debugPreviewUrl;
  if (psdDepthImageEl && (layer.currentDepthPreviewUrl || layer.depthPreviewUrl)) {
    psdDepthImageEl.src = layer.currentDepthPreviewUrl || layer.depthPreviewUrl;
  }
  psdDebugPanelEl.classList.add("is-visible");
}
