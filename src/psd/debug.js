function ensureDebugImage(panelEl, imageEl, id, alt) {
  if (imageEl) {
    return imageEl;
  }
  const existing = panelEl.querySelector(`#${id}`);
  if (existing) {
    return existing;
  }
  const created = panelEl.ownerDocument.createElement("img");
  created.className = "debug-image";
  created.id = id;
  created.alt = alt;
  const legend = panelEl.querySelector("#psdDebugLegend");
  if (legend) {
    panelEl.insertBefore(created, legend);
  } else {
    panelEl.appendChild(created);
  }
  return created;
}

export function updatePsdDebugPanel(elements, renderState) {
  let {
    psdDebugPanelEl,
    psdDebugTitleEl,
    psdDebugImageEl,
    psdDepthImageEl,
    puppetBodyMaskImageEl,
    puppetSkeletonImageEl,
  } = elements;

  if (!psdDebugPanelEl) {
    return;
  }

  puppetBodyMaskImageEl = ensureDebugImage(
    psdDebugPanelEl,
    puppetBodyMaskImageEl,
    "puppetBodyMaskImage",
    "Puppet body mask",
  );
  puppetSkeletonImageEl = ensureDebugImage(
    psdDebugPanelEl,
    puppetSkeletonImageEl,
    "puppetSkeletonImage",
    "Puppet skeletonized mask",
  );

  const hasLayerDebug = renderState.sourceMode === "psd" && renderState.psdDebugLayerIndex >= 0;
  const hasPuppetDebug = !!(renderState.puppetDebugBodyMaskUrl || renderState.puppetDebugSkeletonUrl);

  if (!hasLayerDebug && !hasPuppetDebug) {
    psdDebugPanelEl.classList.remove("is-visible");
    psdDebugImageEl.removeAttribute("src");
    if (psdDepthImageEl) {
      psdDepthImageEl.removeAttribute("src");
    }
    if (puppetBodyMaskImageEl) {
      puppetBodyMaskImageEl.removeAttribute("src");
    }
    if (puppetSkeletonImageEl) {
      puppetSkeletonImageEl.removeAttribute("src");
    }
    return;
  }

  const layer = hasLayerDebug ? renderState.psdLayerEntries[renderState.psdDebugLayerIndex] : null;
  if (layer && layer.debugPreviewUrl) {
    psdDebugImageEl.src = layer.debugPreviewUrl;
    if (psdDepthImageEl && (layer.currentDepthPreviewUrl || layer.depthPreviewUrl)) {
      psdDepthImageEl.src = layer.currentDepthPreviewUrl || layer.depthPreviewUrl;
    }
  } else {
    psdDebugImageEl.removeAttribute("src");
    if (psdDepthImageEl) {
      psdDepthImageEl.removeAttribute("src");
    }
  }

  if (puppetBodyMaskImageEl) {
    if (renderState.puppetDebugBodyMaskUrl) {
      puppetBodyMaskImageEl.src = renderState.puppetDebugBodyMaskUrl;
    } else {
      puppetBodyMaskImageEl.removeAttribute("src");
    }
  }
  if (puppetSkeletonImageEl) {
    if (renderState.puppetDebugSkeletonUrl) {
      puppetSkeletonImageEl.src = renderState.puppetDebugSkeletonUrl;
    } else {
      puppetSkeletonImageEl.removeAttribute("src");
    }
  }

  const titleParts = [];
  if (layer && layer.debugPreviewUrl) {
    titleParts.push(`PSD debug: ${layer.name || `Layer ${renderState.psdDebugLayerIndex + 1}`} | removed ${layer.removedDepthPixels || 0}px`);
  }
  if (renderState.puppetDebugSummary) {
    titleParts.push(renderState.puppetDebugSummary);
  }
  psdDebugTitleEl.textContent = titleParts.join(" | ");
  psdDebugPanelEl.classList.add("is-visible");
}
