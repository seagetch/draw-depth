const DEFAULT_FOCUSED_RULES = new Map([
  [17, [{ name: "handwear-l-thumb", x: 72, y: 0, w: 122, h: 132, lift: 10, radius: 18 }]],
  [6, [
    { name: "handwear-r-shoulder", x: 0, y: 0, w: 112, h: 126, lift: 10, radius: 20 },
    { name: "handwear-r-upper", x: 40, y: 0, w: 150, h: 170, lift: 12, radius: 24 },
  ]],
  [10, [{ name: "ears-r-root", x: 0, y: 0, w: 96, h: 120, lift: 8, radius: 16 }]],
  [14, [{ name: "head-right-ear-root-nearby", x: 0, y: 44, w: 96, h: 156, lift: 10, radius: 20 }]],
]);

const EIGHT_NEIGHBORS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

const HISTOGRAM_BINS = 16;
const HISTOGRAM_SHIFT = 4;

export function applyAlphaDepthGapFillToComposite(composedSource, options = {}) {
  const layers = composedSource?.layers || [];
  const focusedRules = options.focusedRules || DEFAULT_FOCUSED_RULES;
  const progress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const throwIfCancelled = typeof options.throwIfCancelled === "function" ? options.throwIfCancelled : () => {};
  const report = [];
  const outputLayers = [];
  let totalMarked = 0;
  let totalFilled = 0;
  let totalRemaining = 0;

  progress({ stage: "alpha-depth-gap-fill", current: 0, total: layers.length, message: "starting" });

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    throwIfCancelled();
    const layer = layers[layerIndex];
    progress({
      stage: "alpha-depth-gap-fill",
      current: layerIndex,
      total: layers.length,
      layerIndex,
      layerName: layer?.name || "",
      message: "detecting gaps",
    });
    const depth = layer?.depthModeSourcePixels || layer?.baseDepthPixels || layer?.depthPixels;
    const mask = layer?.maskPixels || layer?.surfaceMaskPixels || layer?.renderDepthMask;
    const width = layer?.width || 0;
    const height = layer?.height || 0;
    if (!depth || !mask || !width || !height || depth.length !== width * height) {
      report.push({
        index: layerIndex,
        name: layer?.name || "",
        skipped: true,
        reason: "missing layer depth or mask",
      });
      continue;
    }

    const detected = detectAlphaDepthGaps(depth, mask, width, height, layerIndex, focusedRules);
    throwIfCancelled();
    const filled = medianFillDepth(depth, mask, detected.mask, width, height);
    throwIfCancelled();
    applyFilledDepthToLayer(layer, filled.depth);
    outputLayers.push(createLayerDepthOutput(layer, layerIndex));

    totalMarked += detected.total;
    totalFilled += filled.filled;
    totalRemaining += filled.remaining;
    report.push({
      index: layerIndex,
      name: layer.name || "",
      zero: detected.zero,
      depression: detected.depression,
      cliff: detected.cliff,
      focusedAdded: detected.focusedAdded,
      totalMarked: detected.total,
      filled: filled.filled,
      remaining: filled.remaining,
    });
    progress({
      stage: "alpha-depth-gap-fill",
      current: layerIndex + 1,
      total: layers.length,
      layerIndex,
      layerName: layer?.name || "",
      marked: detected.total || 0,
      filled: filled.filled || 0,
      remaining: filled.remaining || 0,
      message: "layer complete",
    });
  }

  composedSource.alphaDepthGapFillPasses = (composedSource.alphaDepthGapFillPasses || 0) + 1;
  composedSource.lastAlphaDepthGapFillReport = report;
  return {
    pass: composedSource.alphaDepthGapFillPasses,
    layerCount: layers.length,
    totalMarked,
    totalFilled,
    totalRemaining,
    layers: report,
    outputLayers,
  };
}

export function detectAlphaDepthGaps(depth, alphaMask, width, height, layerIndex, focusedRules = DEFAULT_FOCUSED_RULES) {
  const mask = new Uint8Array(depth.length);
  const localHistogram = buildDepthHistogramIntegral(depth, alphaMask, width, height);
  let zero = 0;
  let depression = 0;
  let cliff = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!alphaMask[index]) {
        continue;
      }
      const value = depth[index];
      if (value <= 0) {
        mask[index] = 1;
        zero += 1;
        continue;
      }
      const stats16 = localHistogramStats(localHistogram, width, height, x, y, 16, value);
      const stats30 = localHistogramStats(localHistogram, width, height, x, y, 30, value);
      const expected = Math.max(stats16?.p65 || 0, stats30?.p65 || 0);
      if (expected > 0 && expected - value >= Math.max(12, expected * 0.075)) {
        mask[index] = 1;
        depression += 1;
      }
    }
  }

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (!alphaMask[index]) {
        continue;
      }
      const value = depth[index];
      let high = 0;
      for (const sampleIndex of [
        index - 1,
        index + 1,
        index - width,
        index + width,
        index - width - 1,
        index - width + 1,
        index + width - 1,
        index + width + 1,
      ]) {
        if (alphaMask[sampleIndex] && depth[sampleIndex] > high) {
          high = depth[sampleIndex];
        }
      }
      if (high - value >= Math.max(16, high * 0.10)) {
        mask[index] = 1;
        cliff += 1;
      }
    }
  }

  let focusedAdded = 0;
  for (const rule of focusedRules.get(layerIndex) || []) {
    const x0 = Math.max(0, rule.x);
    const y0 = Math.max(0, rule.y);
    const x1 = Math.min(width, rule.x + rule.w);
    const y1 = Math.min(height, rule.y + rule.h);
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const index = y * width + x;
        if (!alphaMask[index]) {
          continue;
        }
        const stats = localHistogramStats(localHistogram, width, height, x, y, rule.radius, depth[index]);
        const expected = stats?.p65 || stats?.p50 || 0;
        if (depth[index] <= 0 || (expected > 0 && expected - depth[index] >= rule.lift)) {
          if (!mask[index]) {
            focusedAdded += 1;
          }
          mask[index] = 1;
        }
      }
    }
  }

  let total = 0;
  for (let i = 0; i < mask.length; i += 1) {
    total += mask[i];
  }
  return { mask, zero, depression, cliff, focusedAdded, total };
}

export function medianFillDepth(sourceDepth, alphaMask, fillMask, width, height) {
  const depth = new Uint8Array(sourceDepth);
  const pending = new Uint8Array(fillMask);
  const queued = new Uint8Array(fillMask.length);
  const pendingIndices = [];
  let frontier = [];
  let filled = 0;

  for (let index = 0; index < pending.length; index += 1) {
    if (!pending[index] || !alphaMask[index]) {
      continue;
    }
    pendingIndices.push(index);
    if (hasFillNeighbor(depth, alphaMask, pending, width, height, index)) {
      queued[index] = 1;
      frontier.push(index);
    }
  }

  while (frontier.length) {
    const updates = [];
    for (let i = 0; i < frontier.length; i += 1) {
      const index = frontier[i];
      queued[index] = 0;
      if (!pending[index] || !alphaMask[index]) {
        continue;
      }
      const value = neighborMedianValue(depth, alphaMask, pending, width, height, index);
      if (value > 0) {
        updates.push([index, value]);
      }
    }
    if (!updates.length) {
      break;
    }
    const nextFrontier = [];
    for (const [index, value] of updates) {
      depth[index] = value;
      pending[index] = 0;
      filled += 1;
      enqueuePendingNeighbors(nextFrontier, queued, pending, alphaMask, width, height, index);
    }
    frontier = nextFrontier;
  }

  for (let i = 0; i < pendingIndices.length; i += 1) {
    const index = pendingIndices[i];
    if (!pending[index] || !alphaMask[index]) {
      continue;
    }
    const x = index % width;
    const y = Math.floor(index / width);
    const value = sampleFallbackMedian(depth, alphaMask, pending, width, height, x, y);
    if (value > 0) {
      depth[index] = value;
      pending[index] = 0;
      filled += 1;
    }
  }

  let remaining = 0;
  for (let i = 0; i < pendingIndices.length; i += 1) {
    remaining += pending[pendingIndices[i]];
  }
  return { depth, filled, remaining };
}

function hasFillNeighbor(depth, alphaMask, pending, width, height, index) {
  return neighborMedianValue(depth, alphaMask, pending, width, height, index) > 0;
}

function neighborMedianValue(depth, alphaMask, pending, width, height, index) {
  const x = index % width;
  const y = Math.floor(index / width);
  const values = [];
  for (const [dx, dy] of EIGHT_NEIGHBORS) {
    const sx = x + dx;
    const sy = y + dy;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      continue;
    }
    const sampleIndex = sy * width + sx;
    if (alphaMask[sampleIndex] && !pending[sampleIndex] && depth[sampleIndex] > 0) {
      values.push(depth[sampleIndex]);
    }
  }
  return values.length ? median(values) : 0;
}

function enqueuePendingNeighbors(frontier, queued, pending, alphaMask, width, height, index) {
  const x = index % width;
  const y = Math.floor(index / width);
  for (const [dx, dy] of EIGHT_NEIGHBORS) {
    const sx = x + dx;
    const sy = y + dy;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      continue;
    }
    const sampleIndex = sy * width + sx;
    if (pending[sampleIndex] && alphaMask[sampleIndex] && !queued[sampleIndex]) {
      queued[sampleIndex] = 1;
      frontier.push(sampleIndex);
    }
  }
}

function applyFilledDepthToLayer(layer, depth) {
  const nextDepth = new Uint8Array(depth);
  const baseMask = layer.maskPixels || layer.surfaceMaskPixels || layer.renderDepthMask || new Uint8Array(nextDepth.length);
  const renderDepthMask = new Uint8Array(nextDepth.length);
  for (let i = 0; i < nextDepth.length; i += 1) {
    renderDepthMask[i] = baseMask[i] && nextDepth[i] > 0 ? 1 : 0;
  }
  layer.baseDepthPixels = nextDepth;
  layer.depthModeSourcePixels = new Uint8Array(nextDepth);
  layer.depthPixels = new Uint8Array(nextDepth);
  layer.directDepthPixels = new Uint8Array(nextDepth);
  layer.maskPixels = baseMask;
  layer.renderDepthMask = renderDepthMask;
  layer.depthMaskPixels = renderDepthMask;
  layer.depthSourceOverridden = true;
}

function createLayerDepthOutput(layer, index) {
  return {
    index,
    depthModeSourcePixels: layer.depthModeSourcePixels ? layer.depthModeSourcePixels.slice() : null,
    baseDepthPixels: layer.baseDepthPixels ? layer.baseDepthPixels.slice() : null,
    depthPixels: layer.depthPixels ? layer.depthPixels.slice() : null,
    directDepthPixels: layer.directDepthPixels ? layer.directDepthPixels.slice() : null,
    renderDepthMask: layer.renderDepthMask ? layer.renderDepthMask.slice() : null,
    depthMaskPixels: layer.depthMaskPixels ? layer.depthMaskPixels.slice() : null,
  };
}

function sampleFallbackMedian(depth, alphaMask, pending, width, height, x, y) {
  for (const radius of [6, 12, 24, 48, 96]) {
    const values = [];
    for (const [dx, dy] of diskOffsets(radius)) {
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
        continue;
      }
      const sampleIndex = sy * width + sx;
      if (alphaMask[sampleIndex] && !pending[sampleIndex] && depth[sampleIndex] > 0) {
        values.push(depth[sampleIndex]);
      }
    }
    if (values.length) {
      return median(values);
    }
  }
  return 0;
}

function buildDepthHistogramIntegral(depth, alphaMask, width, height) {
  const stride = width + 1;
  const size = stride * (height + 1);
  const bins = Array.from({ length: HISTOGRAM_BINS }, () => new Uint32Array(size));
  const rowCounts = new Uint32Array(HISTOGRAM_BINS);

  for (let y = 1; y <= height; y += 1) {
    rowCounts.fill(0);
    const sourceRow = (y - 1) * width;
    const outputRow = y * stride;
    const previousRow = (y - 1) * stride;
    for (let x = 1; x <= width; x += 1) {
      const sourceIndex = sourceRow + x - 1;
      const value = depth[sourceIndex];
      if (alphaMask[sourceIndex] && value > 0) {
        rowCounts[value >> HISTOGRAM_SHIFT] += 1;
      }
      const outputIndex = outputRow + x;
      const previousIndex = previousRow + x;
      for (let bin = 0; bin < HISTOGRAM_BINS; bin += 1) {
        bins[bin][outputIndex] = bins[bin][previousIndex] + rowCounts[bin];
      }
    }
  }

  return { bins, stride };
}

function localHistogramStats(histogram, width, height, x, y, radius, centerValue = 0) {
  const x0 = Math.max(0, x - radius);
  const y0 = Math.max(0, y - radius);
  const x1 = Math.min(width, x + radius + 1);
  const y1 = Math.min(height, y + radius + 1);
  let total = 0;

  for (let bin = 0; bin < HISTOGRAM_BINS; bin += 1) {
    let count = integralRangeSum(histogram.bins[bin], histogram.stride, x0, y0, x1, y1);
    if (centerValue > 0 && bin === (centerValue >> HISTOGRAM_SHIFT)) {
      count = Math.max(0, count - 1);
    }
    total += count;
  }

  if (total < 10) {
    return null;
  }

  const target50 = Math.max(1, Math.ceil(total * 0.50));
  const target65 = Math.max(1, Math.ceil(total * 0.65));
  const target80 = Math.max(1, Math.ceil(total * 0.80));
  let cumulative = 0;
  let p50 = 255;
  let p65 = 255;
  let p80 = 255;

  for (let bin = 0; bin < HISTOGRAM_BINS; bin += 1) {
    let count = integralRangeSum(histogram.bins[bin], histogram.stride, x0, y0, x1, y1);
    if (centerValue > 0 && bin === (centerValue >> HISTOGRAM_SHIFT)) {
      count = Math.max(0, count - 1);
    }
    cumulative += count;
    const value = Math.min(255, (bin << HISTOGRAM_SHIFT) + (1 << (HISTOGRAM_SHIFT - 1)));
    if (p50 === 255 && cumulative >= target50) {
      p50 = value;
    }
    if (p65 === 255 && cumulative >= target65) {
      p65 = value;
    }
    if (cumulative >= target80) {
      p80 = value;
      break;
    }
  }

  return { p50, p65, p80 };
}

function integralRangeSum(integral, stride, x0, y0, x1, y1) {
  const topLeft = y0 * stride + x0;
  const topRight = y0 * stride + x1;
  const bottomLeft = y1 * stride + x0;
  const bottomRight = y1 * stride + x1;
  return integral[bottomRight] - integral[topRight] - integral[bottomLeft] + integral[topLeft];
}

function median(values) {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

const offsetCache = new Map();
function diskOffsets(radius) {
  if (offsetCache.has(radius)) {
    return offsetCache.get(radius);
  }
  const offsets = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq > 0 && distanceSq <= radius * radius) {
        offsets.push([dx, dy]);
      }
    }
  }
  offsetCache.set(radius, offsets);
  return offsets;
}
