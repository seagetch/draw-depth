import {
  buildLayerContourBandMask,
  clampByte,
  medianOfNumbers,
  percentileFromSorted,
} from "./depthCleanup.js";

export function pruneForeignDepthSeeds(
  sourceDepthPixels,
  layer,
  layerIndex,
  imageWidth,
  imageHeight,
  stableDepthPixels,
  visibleLayerMap,
  maskPixels,
  threshold,
) {
  const filtered = sourceDepthPixels.slice();
  const debugState = new Uint8Array(filtered.length);
  const debugScore = new Uint8Array(filtered.length);
  const globalSupport = collectPositiveValues(filtered);
  const globalMedian = globalSupport.length ? medianOfNumbers(globalSupport) : 0;

  for (let i = 0; i < filtered.length; i += 1) {
    if (!maskPixels[i]) {
      continue;
    }
    debugState[i] = filtered[i] > 0 ? 2 : 1;
  }

  for (let y = 0; y < layer.height; y += 1) {
    for (let x = 0; x < layer.width; x += 1) {
      const localIndex = y * layer.width + x;
      const seedDepth = filtered[localIndex];
      if (!maskPixels[localIndex] || seedDepth === 0) {
        continue;
      }

      const globalX = layer.left + x;
      const globalY = layer.top + y;
      const sameLayerSupport = collectLocalDepthSupport(
        filtered,
        maskPixels,
        layer.width,
        layer.height,
        x,
        y,
        4,
      );
      if (sameLayerSupport.length < 4) {
        continue;
      }

      const sameMedian = medianOfNumbers(sameLayerSupport);
      const sortedSupport = sameLayerSupport.slice().sort((a, b) => a - b);
      const q1 = percentileFromSorted(sortedSupport, 0.25);
      const q3 = percentileFromSorted(sortedSupport, 0.75);
      const localRange = sortedSupport[sortedSupport.length - 1] - sortedSupport[0];
      const foreignSupport = collectForeignVisibleDepthSupport(
        imageWidth,
        imageHeight,
        globalX,
        globalY,
        4,
        layerIndex,
        stableDepthPixels,
        visibleLayerMap,
      );
      if (foreignSupport.length < 3) {
        continue;
      }

      const foreignMedian = medianOfNumbers(foreignSupport);
      const sameDistance = Math.abs(seedDepth - sameMedian);
      const foreignDistance = Math.abs(seedDepth - foreignMedian);
      const globalDistance = Math.abs(seedDepth - globalMedian);
      const localThreshold = Math.max(2, Math.min(6, threshold * 0.1));
      const bandDistance = seedDepth < q1 ? q1 - seedDepth : seedDepth > q3 ? seedDepth - q3 : 0;
      const hasSharpLocalGradient = localRange > localThreshold * 3 && bandDistance > localThreshold;
      const score = Math.max(sameDistance, globalDistance) - foreignDistance;
      debugScore[localIndex] = Math.max(debugScore[localIndex], clampByte(Math.round(score * 24)));

      if (
        (
          (sameDistance > localThreshold && globalDistance > localThreshold) ||
          hasSharpLocalGradient
        ) &&
        foreignDistance < Math.min(sameDistance, globalDistance)
      ) {
        filtered[localIndex] = 0;
        debugState[localIndex] = 3;
      }
    }
  }

  pruneThinForeignSeedComponents(
    filtered,
    debugState,
    debugScore,
    layer,
    layerIndex,
    imageWidth,
    imageHeight,
    stableDepthPixels,
    visibleLayerMap,
    maskPixels,
    globalMedian,
    threshold,
  );

  return {
    pixels: filtered,
    debugState,
    debugScore,
  };
}

function pruneThinForeignSeedComponents(
  depthPixels,
  debugState,
  debugScore,
  layer,
  layerIndex,
  imageWidth,
  imageHeight,
  stableDepthPixels,
  visibleLayerMap,
  maskPixels,
  globalMedian,
  threshold,
) {
  const totalPixels = layer.width * layer.height;
  const visited = new Uint8Array(totalPixels);
  const componentIds = new Int32Array(totalPixels);
  componentIds.fill(-1);
  const contourMask = buildLayerContourBandMask(maskPixels, layer.width, layer.height, 1);
  const wideContourMask = buildLayerContourBandMask(maskPixels, layer.width, layer.height, 4);
  const linkThreshold = Math.max(8, threshold * 0.35);
  const queue = new Int32Array(totalPixels);
  const neighbors = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  let componentId = 0;

  for (let start = 0; start < totalPixels; start += 1) {
    if (visited[start] || !maskPixels[start] || depthPixels[start] === 0) {
      continue;
    }

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    componentIds[start] = componentId;
    const indices = [];
    const values = [];
    let minX = layer.width;
    let maxX = 0;
    let minY = layer.height;
    let maxY = 0;
    let contourHits = 0;
    let wideContourHits = 0;

    while (head < tail) {
      const index = queue[head++];
      indices.push(index);
      values.push(depthPixels[index]);
      const x = index % layer.width;
      const y = Math.floor(index / layer.width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      if (contourMask[index]) {
        contourHits += 1;
      }
      if (wideContourMask[index]) {
        wideContourHits += 1;
      }

      for (let i = 0; i < neighbors.length; i += 1) {
        const [dx, dy] = neighbors[i];
        const sx = x + dx;
        const sy = y + dy;
        if (sx < 0 || sx >= layer.width || sy < 0 || sy >= layer.height) {
          continue;
        }

        const sampleIndex = sy * layer.width + sx;
        if (visited[sampleIndex] || !maskPixels[sampleIndex] || depthPixels[sampleIndex] === 0) {
          continue;
        }

        if (Math.abs(depthPixels[sampleIndex] - depthPixels[index]) > linkThreshold) {
          continue;
        }

        visited[sampleIndex] = 1;
        componentIds[sampleIndex] = componentId;
        queue[tail++] = sampleIndex;
      }
    }

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const componentMedian = medianOfNumbers(values);
    const sameLayerSupport = collectComponentExternalDepthSupport(
      depthPixels,
      maskPixels,
      componentIds,
      componentId,
      wideContourMask,
      layer.width,
      layer.height,
      minX,
      minY,
      maxX,
      maxY,
      5,
    );
    const foreignSupport = collectComponentForeignVisibleDepthSupport(
      indices,
      layer,
      imageWidth,
      imageHeight,
      stableDepthPixels,
      visibleLayerMap,
      layerIndex,
    );
    const contourRatio = contourHits / indices.length;
    const wideContourRatio = wideContourHits / indices.length;
    const sameMedian = sameLayerSupport.length ? medianOfNumbers(sameLayerSupport) : globalMedian;
    const foreignMedian = foreignSupport.length ? medianOfNumbers(foreignSupport) : componentMedian;
    const sameDistance = Math.abs(componentMedian - sameMedian);
    const foreignDistance = Math.abs(componentMedian - foreignMedian);
    const isThin = Math.min(width, height) <= 3 || indices.length <= Math.max(width, height) * 2;
    const isSmallish = indices.length <= Math.max(48, threshold * 8);
    const localThreshold = Math.max(2, Math.min(6, threshold * 0.1));
    const componentScore = sameDistance - foreignDistance;

    if (
      foreignSupport.length >= 4 &&
      (
        sameDistance > localThreshold ||
        (sameLayerSupport.length < 4 && wideContourRatio > 0.7)
      ) &&
      foreignDistance < sameDistance &&
      (contourRatio >= 0.35 || wideContourRatio >= 0.7) &&
      (isThin || isSmallish)
    ) {
      for (let i = 0; i < indices.length; i += 1) {
        depthPixels[indices[i]] = 0;
        debugState[indices[i]] = 4;
        debugScore[indices[i]] = Math.max(debugScore[indices[i]], clampByte(Math.round(componentScore * 24)));
      }
    }

    componentId += 1;
  }
}

function collectComponentExternalDepthSupport(
  depthPixels,
  maskPixels,
  componentIds,
  componentId,
  contourMask,
  width,
  height,
  minX,
  minY,
  maxX,
  maxY,
  radius,
) {
  const values = [];
  const startX = Math.max(0, minX - radius);
  const startY = Math.max(0, minY - radius);
  const endX = Math.min(width - 1, maxX + radius);
  const endY = Math.min(height - 1, maxY + radius);

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const index = y * width + x;
      if (
        !maskPixels[index] ||
        depthPixels[index] === 0 ||
        componentIds[index] === componentId ||
        contourMask[index]
      ) {
        continue;
      }

      values.push(depthPixels[index]);
    }
  }

  return values;
}

function collectComponentForeignVisibleDepthSupport(
  indices,
  layer,
  imageWidth,
  imageHeight,
  stableDepthPixels,
  visibleLayerMap,
  layerIndex,
) {
  const values = [];

  for (let i = 0; i < indices.length; i += 1) {
    const index = indices[i];
    const x = index % layer.width;
    const y = Math.floor(index / layer.width);
    const globalX = layer.left + x;
    const globalY = layer.top + y;
    if (globalX < 0 || globalX >= imageWidth || globalY < 0 || globalY >= imageHeight) {
      continue;
    }

    for (let dy = -2; dy <= 2; dy += 1) {
      const sy = globalY + dy;
      if (sy < 0 || sy >= imageHeight) {
        continue;
      }

      for (let dx = -2; dx <= 2; dx += 1) {
        const sx = globalX + dx;
        if (sx < 0 || sx >= imageWidth) {
          continue;
        }

        const globalIndex = sy * imageWidth + sx;
        const visibleLayer = visibleLayerMap[globalIndex];
        if (visibleLayer < 0 || visibleLayer === layerIndex) {
          continue;
        }

        values.push(stableDepthPixels[globalIndex]);
      }
    }
  }

  return values;
}

function collectLocalDepthSupport(depthPixels, maskPixels, width, height, centerX, centerY, radius) {
  const values = [];

  for (let dy = -radius; dy <= radius; dy += 1) {
    const sy = centerY + dy;
    if (sy < 0 || sy >= height) {
      continue;
    }

    for (let dx = -radius; dx <= radius; dx += 1) {
      const sx = centerX + dx;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height || (dx === 0 && dy === 0)) {
        continue;
      }

      const sampleIndex = sy * width + sx;
      const sampleDepth = depthPixels[sampleIndex];
      if (!maskPixels[sampleIndex] || sampleDepth === 0) {
        continue;
      }

      values.push(sampleDepth);
    }
  }

  return values;
}

function collectForeignVisibleDepthSupport(imageWidth, imageHeight, centerX, centerY, radius, layerIndex, stableDepthPixels, visibleLayerMap) {
  const values = [];

  for (let dy = -radius; dy <= radius; dy += 1) {
    const sy = centerY + dy;
    if (sy < 0 || sy >= imageHeight) {
      continue;
    }

    for (let dx = -radius; dx <= radius; dx += 1) {
      const sx = centerX + dx;
      if (sx < 0 || sx >= imageWidth || (dx === 0 && dy === 0)) {
        continue;
      }

      const globalIndex = sy * imageWidth + sx;
      const visibleLayer = visibleLayerMap[globalIndex];
      if (visibleLayer < 0 || visibleLayer === layerIndex) {
        continue;
      }

      values.push(stableDepthPixels[globalIndex]);
    }
  }

  return values;
}

function collectPositiveValues(values) {
  const positive = [];
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] > 0) {
      positive.push(values[i]);
    }
  }
  return positive;
}
