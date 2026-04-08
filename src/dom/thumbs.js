export function syncThumbs(elements, renderState, defaults) {
  const {
    colorThumbEl,
    depthThumbEl,
    segmentThumbEl,
  } = elements;

  const {
    defaultColorUrl,
    defaultDepthUrl,
    defaultSegmentUrl,
  } = defaults;

  if (renderState.sourceMode === "psd") {
    colorThumbEl.src = renderState.psdColorPreviewUrl || defaultColorUrl;
    depthThumbEl.src = renderState.psdDepthPreviewUrl || defaultDepthUrl;
    segmentThumbEl.src = "";
    return;
  }

  colorThumbEl.src = renderState.colorObjectUrl || defaultColorUrl;
  depthThumbEl.src = renderState.depthObjectUrl || defaultDepthUrl;
  segmentThumbEl.src = renderState.segmentThumbUrl || renderState.segmentObjectUrl || defaultSegmentUrl;
}

export function syncViewerModeUi(elements, renderState) {
  const isPsd = renderState.sourceMode === "psd";
  elements.segmentHudEl.style.display = "";
  elements.segmentThumbButtonEl.parentElement.style.display = isPsd ? "none" : "";
}

export function createSegmentThumbDataUrl(rgbPixels, width, height) {
  if (!rgbPixels || !width || !height) {
    return "";
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = context.createImageData(width, height);

  for (let src = 0, dst = 0; src < rgbPixels.length; src += 3, dst += 4) {
    imageData.data[dst] = rgbPixels[src];
    imageData.data[dst + 1] = rgbPixels[src + 1];
    imageData.data[dst + 2] = rgbPixels[src + 2];
    imageData.data[dst + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}
