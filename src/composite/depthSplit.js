import { createMaskFromDepthPixels } from "./schema.js";

export function splitFlatDepthByColorLayers(colorComposite, flatDepthLayer) {
  return colorComposite.layers.map((colorLayer, index) => {
    const sourceIndices = colorLayer.sourceIndices || [colorLayer.sourceIndex ?? index];
    const depthPixels = sampleDepthLayerToColorLayer(flatDepthLayer, colorLayer);
    for (let i = 0; i < depthPixels.length; i += 1) {
      if (!colorLayer.alphaMask[i]) {
        depthPixels[i] = 0;
      }
    }
    return {
      id: `split-depth:${index}`,
      name: colorLayer.name || `Layer ${index + 1}`,
      sourceIndex: sourceIndices[0] ?? index,
      sourceIndices,
      left: colorLayer.left,
      top: colorLayer.top,
      width: colorLayer.width,
      height: colorLayer.height,
      colorCanvas: colorLayer.canvas,
      colorImageData: colorLayer.imageData,
      colorTexture: colorLayer.texture || null,
      maskPixels: colorLayer.alphaMask,
      surfaceMaskPixels: colorLayer.surfaceMask || colorLayer.alphaMask,
      directDepthPixels: null,
      depthPixels,
      depthMaskPixels: colorLayer.alphaMask,
      renderDepthMask: createMaskFromDepthPixels(depthPixels),
      depthLayerName: flatDepthLayer?.name || "",
      hasDirectDepth: false,
    };
  });
}

export function buildVisibleLayerMap(imageWidth, imageHeight, layers) {
  const visibleLayerMap = new Int32Array(imageWidth * imageHeight);
  visibleLayerMap.fill(-1);

  for (let layerIndex = layers.length - 1; layerIndex >= 0; layerIndex -= 1) {
    const layer = layers[layerIndex];
    const maskPixels = layer.maskPixels || layer.alphaMask;

    for (let y = 0; y < layer.height; y += 1) {
      for (let x = 0; x < layer.width; x += 1) {
        const localIndex = y * layer.width + x;
        if (!maskPixels[localIndex]) {
          continue;
        }

        const globalX = layer.left + x;
        const globalY = layer.top + y;
        if (globalX < 0 || globalX >= imageWidth || globalY < 0 || globalY >= imageHeight) {
          continue;
        }

        const globalIndex = globalY * imageWidth + globalX;
        if (visibleLayerMap[globalIndex] < 0) {
          visibleLayerMap[globalIndex] = layerIndex;
        }
      }
    }
  }

  return visibleLayerMap;
}

export function seedLayerDepthPixels(layer, layerIndex, imageWidth, imageHeight, stableDepthPixels, visibleLayerMap, maskPixels, layers, options = {}) {
  const depthPixels = new Uint8Array(layer.width * layer.height);
  if (!stableDepthPixels || !visibleLayerMap) {
    return depthPixels;
  }
  const contourBandMask = options.contourBandMask || new Uint8Array(maskPixels.length);

  for (let y = 0; y < layer.height; y += 1) {
    for (let x = 0; x < layer.width; x += 1) {
      const localIndex = y * layer.width + x;
      if (!maskPixels[localIndex]) {
        continue;
      }
      if (contourBandMask[localIndex]) {
        continue;
      }

      const globalX = layer.left + x;
      const globalY = layer.top + y;
      if (globalX < 0 || globalX >= imageWidth || globalY < 0 || globalY >= imageHeight) {
        continue;
      }

      const globalIndex = globalY * imageWidth + globalX;
      if (visibleLayerMap[globalIndex] === layerIndex) {
        if (hasUpperLayerMaskNearby(layers, layerIndex, globalX, globalY, options.upperMaskRadius ?? 2)) {
          continue;
        }
        depthPixels[localIndex] = stableDepthPixels[globalIndex];
      }
    }
  }

  return depthPixels;
}

export function hasUpperLayerMaskNearby(layers, layerIndex, globalX, globalY, radius) {
  for (let upperIndex = layerIndex + 1; upperIndex < layers.length; upperIndex += 1) {
    const layer = layers[upperIndex];
    const maskPixels = layer.maskPixels || layer.alphaMask;
    if (
      globalX < layer.left - radius ||
      globalX >= layer.left + layer.width + radius ||
      globalY < layer.top - radius ||
      globalY >= layer.top + layer.height + radius
    ) {
      continue;
    }

    for (let dy = -radius; dy <= radius; dy += 1) {
      const sy = globalY + dy;
      const localY = sy - layer.top;
      if (localY < 0 || localY >= layer.height) {
        continue;
      }
      for (let dx = -radius; dx <= radius; dx += 1) {
        const sx = globalX + dx;
        const localX = sx - layer.left;
        if (localX < 0 || localX >= layer.width) {
          continue;
        }
        if (maskPixels[localY * layer.width + localX]) {
          return true;
        }
      }
    }
  }

  return false;
}

export function sampleDepthLayerToColorLayer(depthLayer, colorLayer) {
  const pixels = new Uint8Array(colorLayer.width * colorLayer.height);
  if (!depthLayer?.pixels) {
    return pixels;
  }
  for (let y = 0; y < colorLayer.height; y += 1) {
    const globalY = colorLayer.top + y;
    const depthY = globalY - (depthLayer.top || 0);
    if (depthY < 0 || depthY >= depthLayer.height) {
      continue;
    }
    for (let x = 0; x < colorLayer.width; x += 1) {
      const globalX = colorLayer.left + x;
      const depthX = globalX - (depthLayer.left || 0);
      if (depthX < 0 || depthX >= depthLayer.width) {
        continue;
      }
      const localIndex = y * colorLayer.width + x;
      const depthIndex = depthY * depthLayer.width + depthX;
      if (depthLayer.alphaMask && !depthLayer.alphaMask[depthIndex]) {
        continue;
      }
      pixels[localIndex] = depthLayer.pixels[depthIndex] || 0;
    }
  }
  return pixels;
}
