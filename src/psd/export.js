export function createPsdExport(deps) {
  const {
    agPsd,
    renderState,
    statusEl,
    buildPreparedPsdLayerEntries,
  } = deps

  async function saveCurrentPsdDepthAsPsd() {
    if (renderState.sourceMode !== "psd" || !renderState.psdColorDocument) {
      throw new Error("PSD pair mode is not active.");
    }
    if (typeof agPsd === "undefined" || typeof agPsd.writePsd !== "function") {
      throw new Error("PSD writer is not available.");
    }
  
    statusEl.textContent = "Saving Midori-full-depth.psd...";
  
    const preparedLayers = buildPreparedPsdLayerEntries();
    const exportDocument = buildPsdDepthExportDocument(renderState.psdColorDocument, preparedLayers);
    const buffer = agPsd.writePsd(exportDocument, { generateThumbnail: true });
    triggerArrayBufferDownload(buffer, "Midori-full-depth.psd");
  
    statusEl.textContent = "Saved Midori-full-depth.psd";
  }
  
  function buildPsdDepthExportDocument(psdDocument, preparedLayers) {
    const sourceLayers = flattenPsdLayers(psdDocument.children || []);
    const preparedBySourceIndex = new Array(sourceLayers.length).fill(null);
  
    for (let i = 0; i < preparedLayers.length; i += 1) {
      const prepared = preparedLayers[i];
      const sourceIndices = prepared.sourceIndices || [];
      for (let j = 0; j < sourceIndices.length; j += 1) {
        const sourceIndex = sourceIndices[j];
        if (sourceIndex >= 0 && sourceIndex < preparedBySourceIndex.length) {
          preparedBySourceIndex[sourceIndex] = {
            layer: prepared,
            visibilityIndex: i,
          };
        }
      }
    }
  
    const children = [];
    for (let i = 0; i < sourceLayers.length; i += 1) {
      const sourceLayer = sourceLayers[i];
      const preparedInfo = preparedBySourceIndex[i];
      const canvas = createPsdExportDepthCanvas(sourceLayer, preparedInfo ? preparedInfo.layer : null);
      const mask = createPsdExportLayerMask(sourceLayer);
      children.push({
        name: sourceLayer.name || `Layer ${i + 1}`,
        left: sourceLayer.left || 0,
        top: sourceLayer.top || 0,
        canvas,
        mask,
        hidden: preparedInfo ? !renderState.psdLayerVisibility[preparedInfo.visibilityIndex] : false,
      });
    }
  
    const compositeCanvas = document.createElement("canvas");
    compositeCanvas.width = psdDocument.width;
    compositeCanvas.height = psdDocument.height;
    const compositeContext = compositeCanvas.getContext("2d", { willReadFrequently: true });
    compositeContext.clearRect(0, 0, compositeCanvas.width, compositeCanvas.height);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const layer = children[i];
      if (layer.hidden || !layer.canvas) {
        continue;
      }
      compositeContext.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
    }
  
    return {
      width: psdDocument.width,
      height: psdDocument.height,
      canvas: compositeCanvas,
      children,
    };
  }
  
  function createPsdExportDepthCanvas(sourceLayer, preparedLayer) {
    const canvas = document.createElement("canvas");
    canvas.width = sourceLayer.width;
    canvas.height = sourceLayer.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const output = context.createImageData(canvas.width, canvas.height);
  
    for (let y = 0; y < sourceLayer.height; y += 1) {
      const globalY = sourceLayer.top + y;
      for (let x = 0; x < sourceLayer.width; x += 1) {
        const localIndex = y * sourceLayer.width + x;
        const rgbaIndex = localIndex * 4;
        let depth = 0;
        if (preparedLayer) {
          const globalX = sourceLayer.left + x;
          const preparedLocalX = globalX - preparedLayer.left;
          const preparedLocalY = globalY - preparedLayer.top;
          if (
            preparedLocalX >= 0 &&
            preparedLocalX < preparedLayer.width &&
            preparedLocalY >= 0 &&
            preparedLocalY < preparedLayer.height
          ) {
            const preparedIndex = preparedLocalY * preparedLayer.width + preparedLocalX;
            depth = preparedLayer.depthPixels[preparedIndex] || 0;
          }
        }
  
        output.data[rgbaIndex] = depth;
        output.data[rgbaIndex + 1] = depth;
        output.data[rgbaIndex + 2] = depth;
        output.data[rgbaIndex + 3] = 255;
      }
    }
  
    context.putImageData(output, 0, 0);
    return canvas;
  }
  
  function createPsdExportLayerMask(sourceLayer) {
    const width = sourceLayer.width || 0;
    const height = sourceLayer.height || 0;
    if (width <= 0 || height <= 0) {
      return undefined;
    }
  
    const sourceImageData = sourceLayer.colorImageData || getCanvasImageData(sourceLayer.canvas);
    const maskImageData = new ImageData(width, height);
  
    for (let i = 0, p = 0; p < width * height; i += 4, p += 1) {
      const alpha = sourceImageData.data[i + 3];
      maskImageData.data[i] = alpha;
      maskImageData.data[i + 1] = alpha;
      maskImageData.data[i + 2] = alpha;
      maskImageData.data[i + 3] = 255;
    }
  
    return {
      top: sourceLayer.top || 0,
      left: sourceLayer.left || 0,
      bottom: (sourceLayer.top || 0) + height,
      right: (sourceLayer.left || 0) + width,
      defaultColor: 0,
      disabled: false,
      imageData: maskImageData,
    };
  }
  
  function triggerArrayBufferDownload(buffer, filename) {
    const blob = new Blob([buffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  return {
    saveCurrentPsdDepthAsPsd,
  };
}
