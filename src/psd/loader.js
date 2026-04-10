export function createPsdLoader(deps) {
  const {
    agPsd,
    renderState,
    defaults,
    loadImagePixels,
    createPsdLayerEntries,
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

  const { defaultPsdColorUrl, defaultPsdDepthPsdUrl, defaultPsdStableDepthUrl } = defaults

  async function ensureDefaultPsdPairLoaded() {
    if (renderState.psdLayerEntries.length) {
      return;
    }
  
    if (!renderState.pendingPsdColorBuffer) {
      const colorBuffer = await fetchArrayBuffer(defaultPsdColorUrl);
      renderState.pendingPsdColorBuffer = colorBuffer;
    }
  
    await loadPsdPair(renderState.pendingPsdColorBuffer);
  }
  
  async function fetchArrayBuffer(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load ${url}`);
    }
    return response.arrayBuffer();
  }
  
  async function fetchOptionalArrayBuffer(url) {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return response.arrayBuffer();
  }
  
  async function loadPsdPair(colorBuffer) {
    const previousDebugLayerName = renderState.psdDebugLayerIndex >= 0
      ? renderState.psdLayerEntries[renderState.psdDebugLayerIndex]?.name
      : null;
    const previousVisibilityByName = new Map(
      renderState.psdLayerEntries.map((layer, index) => [layer.name, !!renderState.psdLayerVisibility[index]]),
    );
    const previousOffsetByName = new Map(
      renderState.psdLayerEntries.map((layer, index) => [layer.name, renderState.psdLayerDepthOffsets[index] ?? 0]),
    );
    const previousScaleByName = new Map(
      renderState.psdLayerEntries.map((layer, index) => [layer.name, renderState.psdLayerDepthScales[index] ?? 1]),
    );
    const previousPruneByName = new Map(
      renderState.psdLayerEntries.map((layer, index) => [layer.name, !!renderState.psdLayerOutlierPruneEnabled[index]]),
    );
    const previousPuppetFitByName = new Map(
      renderState.psdLayerEntries.map((layer, index) => [layer.name, renderState.puppetLayerFitEnabled[index] ?? true]),
    );
    const previousPuppetBindingOverrideByName = new Map(
      renderState.psdLayerEntries.map((layer, index) => [layer.name, renderState.puppetLayerBindingOverrides[index] ?? null]),
    );
    disposePsdLayerTexturesExternal();
    const colorPsd = agPsd.readPsd(colorBuffer);
    const scaledPsd = prepareScaledPsdDocument(colorPsd, 1280);
    const depthPsdBuffer = await fetchOptionalArrayBuffer(defaultPsdDepthPsdUrl);
    const depthPsd = depthPsdBuffer ? prepareScaledPsdDocument(agPsd.readPsd(depthPsdBuffer), 1280) : null;
    const stableDepthResult = depthPsd ? null : await ensurePsdStableDepthPixels(scaledPsd);
    const layerEntries = createPsdLayerEntries(scaledPsd, depthPsd, stableDepthResult ? stableDepthResult.pixels : null);
  
    renderState.psdColorDocument = scaledPsd;
    renderState.psdDepthDocument = depthPsd;
    renderState.psdStableDepthPixels = stableDepthResult ? stableDepthResult.pixels : null;
    renderState.psdLayerEntries = layerEntries;
    renderState.psdLayerVisibility = layerEntries.map((layer) => previousVisibilityByName.get(layer.name) ?? true);
    renderState.psdLayerDepthOffsets = layerEntries.map((layer) => previousOffsetByName.get(layer.name) ?? 0);
    renderState.psdLayerDepthScales = layerEntries.map((layer) => previousScaleByName.get(layer.name) ?? 1);
    renderState.psdLayerOutlierPruneEnabled = layerEntries.map((layer) => previousPruneByName.get(layer.name) ?? false);
    renderState.puppetLayerFitEnabled = layerEntries.map((layer) => previousPuppetFitByName.get(layer.name) ?? true);
    renderState.puppetLayerBindingOverrides = layerEntries.map((layer) => previousPuppetBindingOverrideByName.get(layer.name) ?? null);
    renderState.psdDebugLayerIndex = previousDebugLayerName
      ? layerEntries.findIndex((layer) => layer.name === previousDebugLayerName)
      : -1;
    renderState.imageWidth = scaledPsd.width;
    renderState.imageHeight = scaledPsd.height;
    renderState.psdColorPreviewUrl = scaledPsd.canvas ? scaledPsd.canvas.toDataURL("image/png") : "";
    renderState.psdDepthPreviewUrl = depthPsd?.canvas
      ? depthPsd.canvas.toDataURL("image/png")
      : (stableDepthResult ? stableDepthResult.previewUrl : "");
    rebuildSegmentList();
    updatePsdDebugPanel();
  }
  
  async function rebuildPsdLayerEntriesIfNeeded() {
    if (renderState.sourceMode !== "psd") {
      return false;
    }
  
    if (renderState.pendingPsdColorBuffer) {
      await loadPsdPair(renderState.pendingPsdColorBuffer);
      return true;
    }
  
    if (renderState.psdColorDocument) {
      const colorBuffer = await fetchArrayBuffer(defaultPsdColorUrl);
      renderState.pendingPsdColorBuffer = colorBuffer;
      await loadPsdPair(colorBuffer);
      return true;
    }
  
    return false;
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
  
  async function ensurePsdStableDepthPixels(psdDocument) {
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
  
    const stableImage = await loadImagePixels(defaultPsdStableDepthUrl);
    const mergedMask = buildMergedOpacityMaskFromPsd(psdDocument);
    const aligned = alignStableDepthToMergedMask(
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
  
  function alignStableDepthToMergedMask(stableImage, mergedMask, targetWidth, targetHeight) {
    const stablePixels = new Uint8Array(stableImage.width * stableImage.height);
    const stableMask = new Uint8Array(stableImage.width * stableImage.height);
    for (let i = 0, p = 0; i < stableImage.data.length; i += 4, p += 1) {
      const value = stableImage.data[i];
      stablePixels[p] = value;
      stableMask[p] = value > 0 ? 1 : 0;
    }
  
    const stableBounds = computeBinaryMaskBounds(stableMask, stableImage.width, stableImage.height);
    const mergedBounds = computeBinaryMaskBounds(mergedMask, targetWidth, targetHeight);
    if (!stableBounds || !mergedBounds) {
      return {
        pixels: new Uint8Array(targetWidth * targetHeight),
        previewUrl: "",
      };
    }
  
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = stableBounds.width;
    cropCanvas.height = stableBounds.height;
    const cropContext = cropCanvas.getContext("2d", { willReadFrequently: true });
    cropContext.putImageData(
      new ImageData(
        stableImage.data.slice(
          0,
          stableImage.data.length,
        ),
        stableImage.width,
        stableImage.height,
      ),
      -stableBounds.left,
      -stableBounds.top,
    );
    const cropMask = new Uint8Array(cropCanvas.width * cropCanvas.height);
    const cropImage = cropContext.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
    for (let i = 0, p = 0; i < cropImage.data.length; i += 4, p += 1) {
      cropMask[p] = cropImage.data[i] > 0 ? 1 : 0;
    }
  
    const baseScaleX = mergedBounds.width / stableBounds.width;
    const baseScaleY = mergedBounds.height / stableBounds.height;
    const baseScale = (baseScaleX + baseScaleY) * 0.5;
    const targetCenterX = mergedBounds.left + mergedBounds.width * 0.5;
    const targetCenterY = mergedBounds.top + mergedBounds.height * 0.5;
  
    let best = {
      scale: baseScale,
      offsetX: targetCenterX - stableBounds.width * baseScale * 0.5,
      offsetY: targetCenterY - stableBounds.height * baseScale * 0.5,
      score: Number.POSITIVE_INFINITY,
    };
  
    const searchConfigs = [
      { scaleRange: 0.35, scaleSteps: 11, shiftRangeX: Math.max(64, targetWidth * 0.08), shiftRangeY: Math.max(64, targetHeight * 0.08), shiftStep: 16 },
      { scaleRange: 0.12, scaleSteps: 9, shiftRangeX: 24, shiftRangeY: 24, shiftStep: 6 },
      { scaleRange: 0.04, scaleSteps: 7, shiftRangeX: 8, shiftRangeY: 8, shiftStep: 2 },
    ];
  
    for (let configIndex = 0; configIndex < searchConfigs.length; configIndex += 1) {
      const config = searchConfigs[configIndex];
      const scaleStart = best.scale * (1 - config.scaleRange);
      const scaleEnd = best.scale * (1 + config.scaleRange);
      const scaleDivisor = Math.max(1, config.scaleSteps - 1);
      for (let scaleStep = 0; scaleStep < config.scaleSteps; scaleStep += 1) {
        const scale = scaleStart + (scaleEnd - scaleStart) * (scaleStep / scaleDivisor);
        for (let offsetY = best.offsetY - config.shiftRangeY; offsetY <= best.offsetY + config.shiftRangeY; offsetY += config.shiftStep) {
          for (let offsetX = best.offsetX - config.shiftRangeX; offsetX <= best.offsetX + config.shiftRangeX; offsetX += config.shiftStep) {
            const score = scoreStableAlignment(
              cropMask,
              cropCanvas.width,
              cropCanvas.height,
              mergedMask,
              targetWidth,
              targetHeight,
              offsetX,
              offsetY,
              scale,
            );
            if (score < best.score) {
              best = { scale, offsetX, offsetY, score };
            }
          }
        }
      }
    }
  
    const alignedCanvas = document.createElement("canvas");
    alignedCanvas.width = targetWidth;
    alignedCanvas.height = targetHeight;
    const alignedContext = alignedCanvas.getContext("2d", { willReadFrequently: true });
    alignedContext.clearRect(0, 0, targetWidth, targetHeight);
    alignedContext.imageSmoothingEnabled = true;
    alignedContext.drawImage(
      cropCanvas,
      best.offsetX,
      best.offsetY,
      cropCanvas.width * best.scale,
      cropCanvas.height * best.scale,
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
  
  function scoreStableAlignment(cropMask, cropWidth, cropHeight, mergedMask, targetWidth, targetHeight, offsetX, offsetY, scale) {
    const sampleStep = Math.max(1, Math.round(targetHeight / 180));
    const drawnLeft = offsetX;
    const drawnTop = offsetY;
    const drawnWidth = cropWidth * scale;
    const drawnHeight = cropHeight * scale;
    let diff = 0;
    let overlap = 0;
  
    for (let y = 0; y < targetHeight; y += sampleStep) {
      for (let x = 0; x < targetWidth; x += sampleStep) {
        const inMask = mergedMask[y * targetWidth + x] > 0;
        let inStable = false;
        if (x >= drawnLeft && x < drawnLeft + drawnWidth && y >= drawnTop && y < drawnTop + drawnHeight) {
          const u = Math.floor(((x - drawnLeft) / Math.max(1, drawnWidth)) * cropWidth);
          const v = Math.floor(((y - drawnTop) / Math.max(1, drawnHeight)) * cropHeight);
          if (u >= 0 && u < cropWidth && v >= 0 && v < cropHeight) {
            inStable = cropMask[v * cropWidth + u] > 0;
          }
        }
        if (inMask !== inStable) {
          diff += 1;
        }
        if (inMask && inStable) {
          overlap += 1;
        }
      }
    }
  
    return diff - overlap * 0.25;
  }
  

  return {
    ensureDefaultPsdPairLoaded,
    fetchArrayBuffer,
    fetchOptionalArrayBuffer,
    loadPsdPair,
    rebuildPsdLayerEntriesIfNeeded,
    prepareScaledPsdDocument,
    ensurePsdStableDepthPixels
  };
}
