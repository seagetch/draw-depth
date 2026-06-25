import { getLayerVisible } from "../composite/schema.js";

export function createPsdExport(deps) {
  const {
    agPsd,
    renderState,
    statusEl,
    buildPreparedLayerEntries,
    flattenPsdLayers,
    getCanvasImageData,
  } = deps

  async function saveCurrentPsdDepthAsPsd(options = {}) {
    if (!(renderState.layerEntries || []).length) {
      throw new Error("No layer source is active.");
    }
    if (typeof agPsd === "undefined" || typeof agPsd.writePsd !== "function") {
      throw new Error("PSD writer is not available.");
    }
  
    const filename = options.filename || renderState.currentPsdExportName || "depth.psd";
    statusEl.textContent = `Saving ${filename}...`;
  
    const preparedLayers = buildPreparedLayerEntries();
    const exportDocument = renderState.psdColorDocument
      ? buildPsdDepthExportDocument(renderState.psdColorDocument, preparedLayers)
      : buildRasterDepthExportDocument(preparedLayers);
    const buffer = agPsd.writePsd(exportDocument, { generateThumbnail: true });
    const saveResult = await saveArrayBufferToData(buffer, filename);
  
    statusEl.textContent = `Saved ${saveResult.filename}`;
    return saveResult;
  }

  function buildRasterDepthExportDocument(preparedLayers) {
    const width = renderState.imageWidth || preparedLayers[0]?.width || 1;
    const height = renderState.imageHeight || preparedLayers[0]?.height || 1;
    const children = preparedLayers.map((layer, index) => ({
      name: layer.name || `Layer ${index + 1}`,
      left: layer.left || 0,
      top: layer.top || 0,
      canvas: createRasterExportDepthCanvas(layer),
      hidden: !getLayerVisible(renderState, index),
    }));

    const compositeCanvas = document.createElement("canvas");
    compositeCanvas.width = width;
    compositeCanvas.height = height;
    const compositeContext = compositeCanvas.getContext("2d", { willReadFrequently: true });
    compositeContext.clearRect(0, 0, width, height);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const layer = children[i];
      if (!layer.hidden && layer.canvas) {
        compositeContext.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
      }
    }

    return {
      width,
      height,
      canvas: compositeCanvas,
      children,
    };
  }

  function createRasterExportDepthCanvas(layer) {
    const canvas = document.createElement("canvas");
    canvas.width = layer.width;
    canvas.height = layer.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const output = context.createImageData(canvas.width, canvas.height);
    const depthPixels = layer.depthPixels || layer.baseDepthPixels || new Uint8Array(layer.width * layer.height);
    const mask = layer.renderDepthMask || layer.maskPixels || layer.surfaceMaskPixels;
    for (let i = 0; i < depthPixels.length; i += 1) {
      const depth = mask && !mask[i] ? 0 : (depthPixels[i] || 0);
      const rgbaIndex = i * 4;
      output.data[rgbaIndex] = depth;
      output.data[rgbaIndex + 1] = depth;
      output.data[rgbaIndex + 2] = depth;
      output.data[rgbaIndex + 3] = 255;
    }
    context.putImageData(output, 0, 0);
    return canvas;
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
      const canvas = createPsdExportDepthCanvas(
        sourceLayer,
        preparedInfo ? preparedInfo.layer : null,
        preparedInfo ? preparedInfo.visibilityIndex : -1,
      );
      children.push({
        name: sourceLayer.name || `Layer ${i + 1}`,
        left: sourceLayer.left || 0,
        top: sourceLayer.top || 0,
        canvas,
        hidden: preparedInfo ? !getLayerVisible(renderState, preparedInfo.visibilityIndex) : false,
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
  
  function createPsdExportDepthCanvas(sourceLayer, preparedLayer, layerIndex) {
    const canvas = document.createElement("canvas");
    canvas.width = sourceLayer.width;
    canvas.height = sourceLayer.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const output = context.createImageData(canvas.width, canvas.height);
    const sourceImageData = sourceLayer.colorImageData || getCanvasImageData(sourceLayer.canvas);
  
    for (let y = 0; y < sourceLayer.height; y += 1) {
      const globalY = sourceLayer.top + y;
      for (let x = 0; x < sourceLayer.width; x += 1) {
        const localIndex = y * sourceLayer.width + x;
        const rgbaIndex = localIndex * 4;
        let depth = 0;
        const sourceAlpha = getSourceLayerAlpha(sourceImageData, localIndex);
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
            const exportDepthPixels = preparedLayer.depthPixels || preparedLayer.baseDepthPixels;
            const hasDepth = preparedLayer.renderDepthMask
              ? preparedLayer.renderDepthMask[preparedIndex]
              : (exportDepthPixels[preparedIndex] > 0 ? 1 : 0);
            depth = hasDepth
              ? Math.round(((exportDepthPixels[preparedIndex] || 0) * sourceAlpha) / 255)
              : 0;
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

  function getSourceLayerAlpha(sourceImageData, localIndex) {
    return sourceImageData?.data?.[localIndex * 4 + 3] || 0;
  }
  
  async function saveArrayBufferToData(buffer, filename) {
    const response = await fetch(`/api/save-depth-psd?filename=${encodeURIComponent(filename)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      body: buffer,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      throw new Error(result.error || `Failed to save ${filename}`);
    }
    return result;
  }

  return {
    saveCurrentPsdDepthAsPsd,
  };
}
