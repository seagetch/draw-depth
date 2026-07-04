function ensureDebugImage(panelEl, imageEl, id, alt) {
  if (imageEl) {
    if (!imageEl.getAttribute("src")) {
      imageEl.hidden = true;
    }
    return imageEl;
  }
  const existing = panelEl.querySelector(`#${id}`);
  if (existing) {
    if (!existing.getAttribute("src")) {
      existing.hidden = true;
    }
    return existing;
  }
  const created = panelEl.ownerDocument.createElement("img");
  created.className = "debug-image";
  created.id = id;
  created.alt = alt;
  created.hidden = true;
  const legend = panelEl.querySelector("#psdDebugLegend");
  if (legend) {
    panelEl.insertBefore(created, legend);
  } else {
    panelEl.appendChild(created);
  }
  return created;
}

function setDebugImageSource(imageEl, sourceUrl) {
  if (!imageEl) {
    return;
  }
  if (sourceUrl) {
    imageEl.src = sourceUrl;
    imageEl.hidden = false;
    return;
  }
  imageEl.removeAttribute("src");
  imageEl.hidden = true;
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
  const psdThinSurfaceImageEl = ensureDebugImage(
    psdDebugPanelEl,
    null,
    "psdThinSurfaceImage",
    "Layer thin alpha surface mask",
  );
  const psdColorAlphaImageEl = ensureDebugImage(
    psdDebugPanelEl,
    null,
    "psdColorAlphaImage",
    "Layer color alpha map",
  );
  const psdDepthAlphaImageEl = ensureDebugImage(
    psdDebugPanelEl,
    null,
    "psdDepthAlphaImage",
    "Layer depth alpha leak map",
  );

  const layerEntries = renderState.layerEntries || [];
  const hasLayerDebug = layerEntries.length > 0 && renderState.psdDebugLayerIndex >= 0;
  const hasPuppetDebug = !!(renderState.puppetDebugBodyMaskUrl || renderState.puppetDebugSkeletonUrl);

  if (!hasLayerDebug && !hasPuppetDebug) {
    psdDebugPanelEl.classList.remove("is-visible");
    setDebugImageSource(psdDebugImageEl, "");
    setDebugImageSource(psdDepthImageEl, "");
    setDebugImageSource(psdThinSurfaceImageEl, "");
    setDebugImageSource(psdColorAlphaImageEl, "");
    setDebugImageSource(psdDepthAlphaImageEl, "");
    setDebugImageSource(puppetBodyMaskImageEl, "");
    setDebugImageSource(puppetSkeletonImageEl, "");
    return;
  }

  const layer = hasLayerDebug ? layerEntries[renderState.psdDebugLayerIndex] : null;
  if (layer && layer.debugPreviewUrl) {
    setDebugImageSource(psdDebugImageEl, layer.debugPreviewUrl);
    setDebugImageSource(psdDepthImageEl, layer.currentDepthPreviewUrl || layer.depthPreviewUrl || "");
    setDebugImageSource(psdThinSurfaceImageEl, layer.thinSurfacePreviewUrl || "");
    setDebugImageSource(psdColorAlphaImageEl, layer.colorAlphaPreviewUrl || "");
    setDebugImageSource(psdDepthAlphaImageEl, layer.depthAlphaPreviewUrl || "");
  } else {
    setDebugImageSource(psdDebugImageEl, "");
    setDebugImageSource(psdDepthImageEl, "");
    setDebugImageSource(psdThinSurfaceImageEl, "");
    setDebugImageSource(psdColorAlphaImageEl, "");
    setDebugImageSource(psdDepthAlphaImageEl, "");
  }

  setDebugImageSource(psdDebugPanelEl.querySelector("#psdPremultipliedDepthImage"), "");
  setDebugImageSource(psdDebugPanelEl.querySelector("#psdOverlapAlphaImage"), "");
  setDebugImageSource(puppetBodyMaskImageEl, renderState.puppetDebugBodyMaskUrl || "");
  setDebugImageSource(puppetSkeletonImageEl, renderState.puppetDebugSkeletonUrl || "");

  const titleParts = [];
  if (layer && layer.debugPreviewUrl) {
    titleParts.push(`Layer debug: ${layer.name || `Layer ${renderState.psdDebugLayerIndex + 1}`} | removed ${layer.removedDepthPixels || 0}px`);
    if (layer.thinSurfacePixels) {
      titleParts.push(`thin alpha surface excluded ${layer.thinSurfacePixels}px`);
    }
    titleParts.push(`color low alpha ${layer.colorLowAlphaPixels || 0}px`);
    titleParts.push(`depth alpha leak ${layer.depthAlphaLeakPixels || 0}px`);
  }
  if (renderState.puppetDebugSummary) {
    titleParts.push(renderState.puppetDebugSummary);
  }
  psdDebugTitleEl.textContent = titleParts.join(" | ");
  psdDebugPanelEl.classList.add("is-visible");
}
