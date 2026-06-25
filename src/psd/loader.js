import { createColorCompositeFromPsd } from "../composite/colorSources.js";
import { createDepthCompositeFromPsd, createFlatDepthCompositeFromPixels } from "../composite/depthSources.js";
import { writeDepthDebugStats } from "../composite/debugStats.js";
import { attachPreparedLayerEntries } from "../composite/prepareLayers.js";
import {
  buildCompositionDebugStatsInWorker,
  composeWithPreviousStateInWorker,
} from "../workers/compositeWorkerClient.js?v=20260626_4";

export function createPsdLoader(deps) {
  const {
    agPsd,
    renderState,
    defaults,
    loadImagePixels,
    createLayerEntries,
    disposePsdLayerTextures: disposePsdLayerTexturesExternal,
    flattenPsdLayers,
    getCanvasImageData,
    rebuildSegmentList,
    updatePsdDebugPanel,
  } = deps

  const flattenPsdLayersSafe = typeof flattenPsdLayers === "function"
    ? flattenPsdLayers
    : function flattenPsdLayersFallback(layers, output = []) {
      for (let i = 0; i < layers.length; i += 1) {
        const layer = layers[i];
        if (layer.hidden) {
          continue;
        }
        if (layer.children && layer.children.length) {
          flattenPsdLayersFallback(layer.children, output);
          continue;
        }
        if (!layer.canvas) {
          continue;
        }
        output.push({
          name: layer.name || "",
          left: layer.left || 0,
          top: layer.top || 0,
          width: layer.canvas.width,
          height: layer.canvas.height,
          canvas: layer.canvas,
        });
      }
      return output;
    };
  const getCanvasImageDataSafe = typeof getCanvasImageData === "function"
    ? getCanvasImageData
    : function getCanvasImageDataFallback(canvas) {
      const context = canvas.getContext("2d", { willReadFrequently: true });
      return context.getImageData(0, 0, canvas.width, canvas.height);
    };

  async function ensureDefaultPsdPairLoaded(options = {}) {
    if ((renderState.layerEntries || []).length) {
      return;
    }
  
    if (!renderState.pendingPsdColorBuffer) {
      const colorBuffer = await fetchArrayBuffer(defaults.defaultPsdColorUrl);
      renderState.pendingPsdColorBuffer = colorBuffer;
    }
  
    await loadPsdPair(renderState.pendingPsdColorBuffer, options);
  }
  
  async function fetchArrayBuffer(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load ${url}`);
    }
    return response.arrayBuffer();
  }
  
  async function fetchOptionalArrayBuffer(url) {
    if (!url) {
      return null;
    }
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return response.arrayBuffer();
  }
  
  async function loadPsdPair(colorBuffer, options = {}) {
    const previousLayers = renderState.layerEntries || [];
    const previousDebugLayerName = renderState.psdDebugLayerIndex >= 0
      ? previousLayers[renderState.psdDebugLayerIndex]?.name
      : null;
    const previousGlobalDepthScale = renderState.composedSource?.globalDepthScale ?? 1;
    disposePsdLayerTexturesExternal();
    const colorPsd = agPsd.readPsd(colorBuffer);
    const scaledPsd = prepareScaledPsdDocument(colorPsd, 1280);
    const depthPsdUrl = Object.prototype.hasOwnProperty.call(options, "depthPsdUrl")
      ? options.depthPsdUrl
      : defaults.defaultPsdDepthPsdUrl;
    const stableDepthUrl = options.stableDepthUrl || defaults.defaultPsdStableDepthUrl;
    const depthPsdBuffer = await fetchOptionalArrayBuffer(depthPsdUrl);
    const depthPsd = depthPsdBuffer
      ? prepareScaledPsdDocument(normalizeDepthPsdDocument(agPsd.readPsd(depthPsdBuffer, { useImageData: true })), 1280)
      : null;
    const flattenedDepthPreview = depthPsd
      ? createFlattenedGrayscaleDepthPreview(depthPsd)
      : null;
    const stableDepthResult = depthPsd ? null : await ensurePsdStableDepthPixels(scaledPsd, stableDepthUrl);
    const colorComposite = createColorCompositeFromPsd(scaledPsd);
    const depthComposite = depthPsd
      ? createDepthCompositeFromPsd(depthPsd)
      : createFlatDepthCompositeFromPixels(
        scaledPsd.width,
        scaledPsd.height,
        stableDepthResult ? stableDepthResult.pixels : new Uint8Array(scaledPsd.width * scaledPsd.height),
        {
          format: "raster",
          name: "Stable depth",
        },
      );
    const composedSource = await composeWithPreviousStateInWorker({
      colorComposite,
      depthComposite,
      previousLayers,
      previousGlobalDepthScale,
      depthOverrides: renderState.depthOverrides,
      onProgress: options.onProgress,
    });
    const layerEntries = await createLayerEntries(composedSource, {
      colorDocument: scaledPsd,
      depthDocument: depthPsd,
      stableDepthPixels: stableDepthResult ? stableDepthResult.pixels : null,
      onProgress: options.onProgress,
    });
  
    renderState.psdColorDocument = scaledPsd;
    renderState.psdDepthDocument = depthPsd;
    renderState.colorComposite = colorComposite;
    renderState.depthComposite = depthComposite;
    renderState.composedSource = composedSource;
    renderState.psdStableDepthPixels = stableDepthResult ? stableDepthResult.pixels : null;
    renderState.layerEntries = attachPreparedLayerEntries(composedSource, layerEntries);
    renderState.psdDebugLayerIndex = previousDebugLayerName
      ? layerEntries.findIndex((layer) => layer.name === previousDebugLayerName)
      : -1;
    renderState.imageWidth = scaledPsd.width;
    renderState.imageHeight = scaledPsd.height;
    renderState.psdColorPreviewUrl = scaledPsd.canvas ? scaledPsd.canvas.toDataURL("image/png") : "";
    renderState.psdDepthPreviewUrl = depthPsd?.canvas
      ? depthPsd.canvas.toDataURL("image/png")
      : (stableDepthResult ? stableDepthResult.previewUrl : "");
    renderState.psdPremultipliedDepthPreviewUrl = flattenedDepthPreview ? flattenedDepthPreview.previewUrl : "";
    options.onProgress?.({
      stage: "debug-stats",
      current: 0,
      total: 1,
      message: "building composition debug stats",
    });
    writeDepthDebugStats({
      composition: await buildCompositionDebugStatsInWorker(composedSource),
    });
    options.onProgress?.({
      stage: "debug-stats",
      current: 1,
      total: 1,
      message: "composition debug stats ready",
    });
    rebuildSegmentList();
    updatePsdDebugPanel();
  }
  
  async function rebuildLayerEntriesIfNeeded(options = {}) {
    if (renderState.colorComposite?.format !== "psd") {
      return false;
    }

    if (hasDepthOverrides()) {
      return false;
    }
  
    if (renderState.pendingPsdColorBuffer) {
      await loadPsdPair(renderState.pendingPsdColorBuffer, options);
      return true;
    }
  
    if (renderState.psdColorDocument) {
      const colorBuffer = await fetchArrayBuffer(defaults.defaultPsdColorUrl);
      renderState.pendingPsdColorBuffer = colorBuffer;
      await loadPsdPair(colorBuffer, options);
      return true;
    }
  
    return false;
  }

  function hasDepthOverrides() {
    return !!renderState.depthOverrides && Object.keys(renderState.depthOverrides).length > 0;
  }
  
  function prepareScaledPsdDocument(psd, maxHeight) {
    const scale = psd.height > maxHeight ? maxHeight / psd.height : 1;
    if (scale >= 0.9999) {
      return psd;
    }
  
    const scaledWidth = Math.max(1, Math.round(psd.width * scale));
    const scaledHeight = Math.max(1, Math.round(psd.height * scale));
    const compositeCanvas = document.createElement("canvas");
    compositeCanvas.width = scaledWidth;
    compositeCanvas.height = scaledHeight;
    const compositeContext = compositeCanvas.getContext("2d", { willReadFrequently: true });
    compositeContext.drawImage(psd.canvas, 0, 0, scaledWidth, scaledHeight);
  
    const scaledLayers = flattenPsdLayersSafe(psd.children || []).map((layer, index) => {
      const width = Math.max(1, Math.round(layer.width * scale));
      const height = Math.max(1, Math.round(layer.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(layer.canvas, 0, 0, width, height);
      const depthAlphaMask = scaleDepthAlphaMask(layer.canvas, width, height);
      if (depthAlphaMask) {
        canvas.__depthDrawAlphaMask = depthAlphaMask;
      }
      return {
        ...layer,
        left: Math.round(layer.left * scale),
        top: Math.round(layer.top * scale),
        width,
        height,
        canvas,
        sourceIndex: index,
      };
    });
  
    return {
      ...psd,
      width: scaledWidth,
      height: scaledHeight,
      canvas: compositeCanvas,
      children: scaledLayers,
      scaleFactor: scale,
    };
  }

  function normalizeDepthPsdDocument(psd) {
    normalizeDepthBitmapAlpha(psd);
    const layers = flattenPsdBitmapLayers(psd.children || []);
    for (let i = 0; i < layers.length; i += 1) {
      normalizeDepthLayerCanvas(layers[i]);
    }
    return psd;
  }

  function flattenPsdBitmapLayers(layers, output = []) {
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[i];
      if (layer.hidden) {
        continue;
      }
      if (layer.children && layer.children.length) {
        flattenPsdBitmapLayers(layer.children, output);
        continue;
      }
      if (!layer.canvas && !layer.imageData) {
        continue;
      }
      output.push(layer);
    }
    return output;
  }

  function createFlattenedGrayscaleDepthPreview(psd) {
    const canvas = document.createElement("canvas");
    canvas.width = psd.width || 1;
    canvas.height = psd.height || 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "black";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const layers = flattenPsdLayersSafe(psd.children || []);
    for (let i = layers.length - 1; i >= 0; i -= 1) {
      const layer = layers[i];
      if (!layer.canvas) {
        continue;
      }
      context.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
    }

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0, p = 0; i < imageData.data.length; i += 4, p += 1) {
      pixels[p] = imageData.data[i];
    }

    return {
      pixels,
      previewUrl: canvas.toDataURL("image/png"),
    };
  }

  function normalizeDepthBitmapAlpha(target) {
    const sourceImageData = getBitmapImageData(target);
    if (!sourceImageData) {
      return;
    }
    const alphaMask = new Uint8Array(sourceImageData.width * sourceImageData.height);
    for (let i = 0, p = 0; i < sourceImageData.data.length; i += 4, p += 1) {
      alphaMask[p] = sourceImageData.data[i + 3] > 0 ? 1 : 0;
    }
    target.__depthDrawAlphaMask = alphaMask;

    for (let i = 0, p = 0; i < sourceImageData.data.length; i += 4, p += 1) {
      const alpha = sourceImageData.data[i + 3];
      const depth = Math.round((sourceImageData.data[i] * alpha) / 255);
      sourceImageData.data[i] = depth;
      sourceImageData.data[i + 1] = depth;
      sourceImageData.data[i + 2] = depth;
      sourceImageData.data[i + 3] = 255;
    }
    commitBitmapImageData(target, sourceImageData);
  }

  function normalizeDepthLayerCanvas(layer) {
    if (!layer || (!layer.canvas && !layer.imageData)) {
      return;
    }
    applyDepthLayerMaskToBitmap(layer);
    normalizeDepthBitmapAlpha(layer);
  }

  function applyDepthLayerMaskToBitmap(layer) {
    const imageData = getBitmapImageData(layer);
    const maskImageData = getLayerMaskImageData(layer);
    if (!imageData || !maskImageData) {
      return;
    }

    const maskLeft = (layer.mask?.positionRelativeToLayer ? layer.mask.left || 0 : (layer.mask?.left || 0) - (layer.left || 0));
    const maskTop = (layer.mask?.positionRelativeToLayer ? layer.mask.top || 0 : (layer.mask?.top || 0) - (layer.top || 0));
    const defaultMask = layer.mask?.defaultColor == null ? 255 : layer.mask.defaultColor;

    for (let y = 0; y < imageData.height; y += 1) {
      for (let x = 0; x < imageData.width; x += 1) {
        const pixelOffset = (y * imageData.width + x) * 4;
        const maskX = x - maskLeft;
        const maskY = y - maskTop;
        let maskValue = defaultMask;
        if (maskX >= 0 && maskX < maskImageData.width && maskY >= 0 && maskY < maskImageData.height) {
          maskValue = maskImageData.data[(maskY * maskImageData.width + maskX) * 4];
        }
        imageData.data[pixelOffset + 3] = Math.round((imageData.data[pixelOffset + 3] * maskValue) / 255);
      }
    }

    commitBitmapImageData(layer, imageData);
  }

  function getLayerMaskImageData(layer) {
    const mask = layer?.mask;
    if (!mask || mask.disabled) {
      return null;
    }
    if (mask.imageData) {
      return mask.imageData;
    }
    if (mask.canvas) {
      return mask.canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, mask.canvas.width, mask.canvas.height);
    }
    return null;
  }

  function getBitmapImageData(target) {
    if (target?.imageData) {
      return target.imageData;
    }
    if (target?.canvas) {
      return target.canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, target.canvas.width, target.canvas.height);
    }
    return null;
  }

  function commitBitmapImageData(target, imageData) {
    target.imageData = imageData;
    target.canvas = createCanvasFromImageData(imageData);
    if (target.canvas) {
      target.canvas.__depthDrawAlphaMask = target.__depthDrawAlphaMask;
    }
  }

  function createCanvasFromImageData(imageData) {
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext("2d", { willReadFrequently: true }).putImageData(imageData, 0, 0);
    return canvas;
  }

  function scaleDepthAlphaMask(sourceCanvas, width, height) {
    const sourceMask = sourceCanvas?.__depthDrawAlphaMask;
    if (!sourceMask) {
      return null;
    }
    const sourceWidth = sourceCanvas.width;
    const sourceHeight = sourceCanvas.height;
    const scaled = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      const sy = Math.min(sourceHeight - 1, Math.max(0, Math.floor((y + 0.5) * sourceHeight / height)));
      for (let x = 0; x < width; x += 1) {
        const sx = Math.min(sourceWidth - 1, Math.max(0, Math.floor((x + 0.5) * sourceWidth / width)));
        scaled[y * width + x] = sourceMask[sy * sourceWidth + sx] ? 1 : 0;
      }
    }
    return scaled;
  }
  
  async function ensurePsdStableDepthPixels(psdDocument, stableDepthUrl = defaults.defaultPsdStableDepthUrl) {
    if (
      renderState.psdStableDepthPixels &&
      renderState.psdStableDepthWidth === psdDocument.width &&
      renderState.psdStableDepthHeight === psdDocument.height
    ) {
      return {
        pixels: renderState.psdStableDepthPixels,
        previewUrl: renderState.psdDepthPreviewUrl,
      };
    }
  
    const stableImage = await loadImagePixels(stableDepthUrl);
    const mergedMask = buildMergedOpacityMaskFromPsd(psdDocument);
    const aligned = alignStableDepthToMergedMaskBounds(
      stableImage,
      mergedMask,
      psdDocument.width,
      psdDocument.height,
    );
  
    renderState.psdStableDepthPixels = aligned.pixels;
    renderState.psdStableDepthWidth = psdDocument.width;
    renderState.psdStableDepthHeight = psdDocument.height;
    return aligned;
  }
  
  function buildMergedOpacityMaskFromPsd(psdDocument) {
    const mask = new Uint8Array(psdDocument.width * psdDocument.height);
    const layers = flattenPsdLayersSafe(psdDocument.children || []);
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[i];
      const imageData = getCanvasImageDataSafe(layer.canvas);
      const alphaPixels = imageData.data;
      for (let y = 0; y < layer.height; y += 1) {
        const globalY = layer.top + y;
        if (globalY < 0 || globalY >= psdDocument.height) {
          continue;
        }
        for (let x = 0; x < layer.width; x += 1) {
          const globalX = layer.left + x;
          if (globalX < 0 || globalX >= psdDocument.width) {
            continue;
          }
          const localIndex = (y * layer.width + x) * 4 + 3;
          if (alphaPixels[localIndex] > 0) {
            mask[globalY * psdDocument.width + globalX] = 1;
          }
        }
      }
    }
    return mask;
  }
  
  function alignStableDepthToMergedMaskBounds(stableImage, mergedMask, targetWidth, targetHeight) {
    const stableMask = new Uint8Array(stableImage.width * stableImage.height);
    let hasTransparentPixels = false;
    for (let i = 0, p = 0; i < stableImage.data.length; i += 4, p += 1) {
      const alpha = stableImage.data[i + 3];
      if (alpha < 255) {
        hasTransparentPixels = true;
      }
      stableMask[p] = alpha > 0 ? 1 : 0;
    }
    if (!hasTransparentPixels) {
      for (let i = 0, p = 0; i < stableImage.data.length; i += 4, p += 1) {
        stableMask[p] = stableImage.data[i] > 0 ? 1 : 0;
      }
    }

    const stableBounds = computeBinaryMaskBounds(stableMask, stableImage.width, stableImage.height);
    const mergedBounds = computeBinaryMaskBounds(mergedMask, targetWidth, targetHeight);
    if (!stableBounds || !mergedBounds) {
      return {
        pixels: new Uint8Array(targetWidth * targetHeight),
        previewUrl: "",
      };
    }

    const scaleX = mergedBounds.width / stableBounds.width;
    const scaleY = mergedBounds.height / stableBounds.height;
    const offsetX = mergedBounds.left - stableBounds.left * scaleX;
    const offsetY = mergedBounds.top - stableBounds.top * scaleY;

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = stableImage.width;
    sourceCanvas.height = stableImage.height;
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    sourceContext.putImageData(stableImage, 0, 0);

    const alignedCanvas = document.createElement("canvas");
    alignedCanvas.width = targetWidth;
    alignedCanvas.height = targetHeight;
    const alignedContext = alignedCanvas.getContext("2d", { willReadFrequently: true });
    alignedContext.clearRect(0, 0, targetWidth, targetHeight);
    alignedContext.imageSmoothingEnabled = true;
    alignedContext.drawImage(
      sourceCanvas,
      offsetX,
      offsetY,
      stableImage.width * scaleX,
      stableImage.height * scaleY,
    );
    const alignedImage = alignedContext.getImageData(0, 0, targetWidth, targetHeight);
    const alignedPixels = new Uint8Array(targetWidth * targetHeight);
    for (let i = 0, p = 0; i < alignedImage.data.length; i += 4, p += 1) {
      alignedPixels[p] = alignedImage.data[i];
    }
  
    return {
      pixels: alignedPixels,
      previewUrl: alignedCanvas.toDataURL("image/png"),
    };
  }
  
  function computeBinaryMaskBounds(mask, width, height) {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!mask[y * width + x]) {
          continue;
        }
        if (x < minX) {
          minX = x;
        }
        if (y < minY) {
          minY = y;
        }
        if (x > maxX) {
          maxX = x;
        }
        if (y > maxY) {
          maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) {
      return null;
    }
    return {
      left: minX,
      top: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
  }
  

  return {
    ensureDefaultPsdPairLoaded,
    fetchArrayBuffer,
    fetchOptionalArrayBuffer,
    loadPsdPair,
    rebuildLayerEntriesIfNeeded,
    prepareScaledPsdDocument,
    ensurePsdStableDepthPixels
  };
}
