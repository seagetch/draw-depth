export function clampByte(value) {
  return Math.max(0, Math.min(255, value));
}

export function medianOfNumbers(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
}

export function percentileFromSorted(sorted, percentile) {
  if (!sorted.length) {
    return 0;
  }
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * percentile)));
  return sorted[index];
}

export function buildLayerContourBandMask(maskPixels, width, height, thickness) {
  const contourMask = new Uint8Array(maskPixels.length);
  const bandMask = new Uint8Array(maskPixels.length);

  for (let index = 0; index < maskPixels.length; index += 1) {
    if (isMaskContourPixel(maskPixels, width, height, index)) {
      contourMask[index] = 1;
      bandMask[index] = 1;
    }
  }

  let frontier = contourMask;
  for (let pass = 1; pass < thickness; pass += 1) {
    frontier = expandMaskFrontier(maskPixels, width, height, frontier, bandMask);
  }

  return bandMask;
}

export function erodePositiveDepthMask(depthPixels, width, height, thickness) {
  let mask = new Uint8Array(depthPixels.length);
  for (let i = 0; i < depthPixels.length; i += 1) {
    mask[i] = depthPixels[i] > 0 ? 1 : 0;
  }

  for (let pass = 0; pass < thickness; pass += 1) {
    mask = erodeBinaryMask(mask, width, height);
  }

  return mask;
}

export function inpaintMaskedLayerDepth(sourceDepthPixels, maskPixels, width, height) {
  const depthPixels = sourceDepthPixels.slice();
  const totalPixels = width * height;
  const filledMask = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  const queued = new Uint8Array(totalPixels);
  let head = 0;
  let tail = 0;

  for (let index = 0; index < totalPixels; index += 1) {
    if (!maskPixels[index] || depthPixels[index] > 0) {
      continue;
    }
    if (!hasPositiveMaskedNeighbor(depthPixels, maskPixels, width, height, index)) {
      continue;
    }
    queue[tail++] = index;
    queued[index] = 1;
  }

  while (head < tail) {
    const index = queue[head++];
    queued[index] = 0;
    if (!maskPixels[index] || depthPixels[index] > 0) {
      continue;
    }

    const fillDepth = sampleMaskedMultiscaleDepth(depthPixels, maskPixels, width, height, index);
    if (fillDepth <= 0) {
      continue;
    }

    depthPixels[index] = fillDepth;
    filledMask[index] = 1;
    tail = enqueueMaskedGapNeighbors(queue, queued, depthPixels, maskPixels, width, height, index, tail);
  }

  return {
    pixels: depthPixels,
    filledMask,
  };
}

export function smoothMaskedPositiveDepth(sourceDepthPixels, maskPixels, width, height) {
  const kernel = [
    [-1, -1, 1],
    [0, -1, 2],
    [1, -1, 1],
    [-1, 0, 2],
    [0, 0, 4],
    [1, 0, 2],
    [-1, 1, 1],
    [0, 1, 2],
    [1, 1, 1],
  ];
  let input = sourceDepthPixels.slice();

  for (let pass = 0; pass < 3; pass += 1) {
    const output = input.slice();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!maskPixels[index] || input[index] <= 0) {
          continue;
        }

        let weightedSum = 0;
        let totalWeight = 0;
        for (let i = 0; i < kernel.length; i += 1) {
          const [dx, dy, weight] = kernel[i];
          const sx = x + dx;
          const sy = y + dy;
          if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
            continue;
          }

          const sampleIndex = sy * width + sx;
          const sampleDepth = input[sampleIndex];
          if (!maskPixels[sampleIndex] || sampleDepth <= 0) {
            continue;
          }

          weightedSum += sampleDepth * weight;
          totalWeight += weight;
        }

        if (totalWeight > 0) {
          output[index] = clampByte(Math.round(weightedSum / totalWeight));
        }
      }
    }
    input = output;
  }

  return input;
}

function erodeBinaryMask(maskPixels, width, height) {
  const eroded = new Uint8Array(maskPixels.length);
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];

  for (let index = 0; index < maskPixels.length; index += 1) {
    if (!maskPixels[index]) {
      continue;
    }

    const x = index % width;
    const y = Math.floor(index / width);
    let keep = true;
    for (let i = 0; i < offsets.length; i += 1) {
      const [dx, dy] = offsets[i];
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height || !maskPixels[sy * width + sx]) {
        keep = false;
        break;
      }
    }

    if (keep) {
      eroded[index] = 1;
    }
  }

  return eroded;
}

function isMaskContourPixel(maskPixels, width, height, index) {
  if (!maskPixels[index]) {
    return false;
  }

  const x = index % width;
  const y = Math.floor(index / width);
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  for (let i = 0; i < offsets.length; i += 1) {
    const [dx, dy] = offsets[i];
    const sx = x + dx;
    const sy = y + dy;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      return true;
    }

    if (!maskPixels[sy * width + sx]) {
      return true;
    }
  }

  return false;
}

function expandMaskFrontier(maskPixels, width, height, frontier, bandMask) {
  const next = new Uint8Array(maskPixels.length);
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];

  for (let index = 0; index < frontier.length; index += 1) {
    if (!frontier[index]) {
      continue;
    }

    const x = index % width;
    const y = Math.floor(index / width);
    for (let i = 0; i < offsets.length; i += 1) {
      const [dx, dy] = offsets[i];
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
        continue;
      }

      const sampleIndex = sy * width + sx;
      if (!maskPixels[sampleIndex] || bandMask[sampleIndex]) {
        continue;
      }

      bandMask[sampleIndex] = 1;
      next[sampleIndex] = 1;
    }
  }

  return next;
}

function hasPositiveMaskedNeighbor(depthPixels, maskPixels, width, height, index) {
  const x = index % width;
  const y = Math.floor(index / width);
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];

  for (let i = 0; i < offsets.length; i += 1) {
    const [dx, dy] = offsets[i];
    const sx = x + dx;
    const sy = y + dy;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      continue;
    }
    const sampleIndex = sy * width + sx;
    if (maskPixels[sampleIndex] && depthPixels[sampleIndex] > 0) {
      return true;
    }
  }

  return false;
}

function sampleMaskedNeighborMedian(depthPixels, maskPixels, width, height, index) {
  const x = index % width;
  const y = Math.floor(index / width);
  const values = [];
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];

  for (let i = 0; i < offsets.length; i += 1) {
    const [dx, dy] = offsets[i];
    const sx = x + dx;
    const sy = y + dy;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      continue;
    }

    const sampleIndex = sy * width + sx;
    if (!maskPixels[sampleIndex] || depthPixels[sampleIndex] <= 0) {
      continue;
    }

    values.push(depthPixels[sampleIndex]);
  }

  if (!values.length) {
    return 0;
  }

  return medianOfNumbers(values);
}

function sampleMaskedMultiscaleDepth(depthPixels, maskPixels, width, height, index, contexts = null) {
  const activeContexts = contexts || [
    estimateMaskedDepthAtScale(depthPixels, maskPixels, width, height, index, 1, 4, 0.48),
    estimateMaskedDepthAtScale(depthPixels, maskPixels, width, height, index, 7, 5, 0.32),
    estimateMaskedDepthAtScale(depthPixels, maskPixels, width, height, index, 37, 5, 0.20),
  ];
  let weightedDepth = 0;
  let totalWeight = 0;

  for (let i = 0; i < activeContexts.length; i += 1) {
    const estimate = activeContexts[i];
    if (!estimate.valid) {
      continue;
    }
    const confidence = estimate.weight * estimate.confidence;
    weightedDepth += estimate.depth * confidence;
    totalWeight += confidence;
  }

  if (totalWeight > 0) {
    return clampByte(Math.round(weightedDepth / totalWeight));
  }

  return sampleMaskedNeighborMedian(depthPixels, maskPixels, width, height, index);
}

function estimateMaskedDepthAtScale(depthPixels, maskPixels, width, height, index, radius, minSamples, weight) {
  const x0 = index % width;
  const y0 = Math.floor(index / width);
  const sampled = sampleMaskedSparseGridDepths(depthPixels, maskPixels, width, height, x0, y0, radius);
  const values = sampled.values;
  if (values.length < minSamples) {
    return { valid: false, depth: 0, confidence: 0, weight };
  }

  const sortedValues = values.slice().sort((a, b) => a - b);
  const grid = sampled.grid;
  const centerMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  for (let i = 0; i < grid.length; i += 1) {
    if (grid[i] <= 0) {
      grid[i] = centerMean;
    }
  }

  const planeDepth = estimateGridPlaneDepth(grid);
  const medianDepth = medianOfNumbers(values);
  const lo = percentileFromSorted(sortedValues, 0.2);
  const hi = percentileFromSorted(sortedValues, 0.8);
  const robustDepth = Math.max(lo, Math.min(hi, Math.round(planeDepth * 0.7 + medianDepth * 0.3)));

  return {
    valid: true,
    depth: robustDepth,
    confidence: Math.max(0, Math.min(1, values.length / 9)),
    weight,
  };
}

function sampleMaskedSparseGridDepths(depthPixels, maskPixels, width, height, x0, y0, radius) {
  const grid = new Float32Array(9);
  const values = [];
  let cursor = 0;
  const searchRadius = Math.max(1, Math.floor(radius / 3));

  for (let gy = -1; gy <= 1; gy += 1) {
    for (let gx = -1; gx <= 1; gx += 1) {
      const targetX = Math.max(0, Math.min(width - 1, Math.round(x0 + gx * radius)));
      const targetY = Math.max(0, Math.min(height - 1, Math.round(y0 + gy * radius)));
      const sampledDepth = sampleNearestMaskedDepth(
        depthPixels,
        maskPixels,
        width,
        height,
        targetX,
        targetY,
        searchRadius,
      );
      grid[cursor] = sampledDepth;
      if (sampledDepth > 0) {
        values.push(sampledDepth);
      }
      cursor += 1;
    }
  }

  return { grid, values };
}

function sampleNearestMaskedDepth(depthPixels, maskPixels, width, height, targetX, targetY, searchRadius) {
  let bestDepth = 0;
  let bestDistanceSq = Infinity;

  for (let dy = -searchRadius; dy <= searchRadius; dy += 1) {
    const y = targetY + dy;
    if (y < 0 || y >= height) {
      continue;
    }
    for (let dx = -searchRadius; dx <= searchRadius; dx += 1) {
      const x = targetX + dx;
      if (x < 0 || x >= width) {
        continue;
      }

      const index = y * width + x;
      const depth = depthPixels[index];
      if (!maskPixels[index] || depth <= 0) {
        continue;
      }

      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestDepth = depth;
      }
    }
  }

  return bestDepth;
}

function estimateGridPlaneDepth(grid) {
  const tl = grid[0];
  const tc = grid[1];
  const tr = grid[2];
  const ml = grid[3];
  const mc = grid[4];
  const mr = grid[5];
  const bl = grid[6];
  const bc = grid[7];
  const br = grid[8];

  const gradX = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
  const gradY = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
  return mc + (gradX + gradY) * 0.125;
}

function enqueueMaskedGapNeighbors(queue, queued, depthPixels, maskPixels, width, height, index, tail) {
  const x = index % width;
  const y = Math.floor(index / width);
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];

  let nextTail = tail;

  for (let i = 0; i < offsets.length; i += 1) {
    const [dx, dy] = offsets[i];
    const sx = x + dx;
    const sy = y + dy;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      continue;
    }
    const sampleIndex = sy * width + sx;
    if (!maskPixels[sampleIndex] || depthPixels[sampleIndex] > 0 || queued[sampleIndex]) {
      continue;
    }
    queue[nextTail++] = sampleIndex;
    queued[sampleIndex] = 1;
  }

  return nextTail;
}
