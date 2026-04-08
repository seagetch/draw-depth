export function createDepthCore(THREE) {
  const gaussianKernelCache = new Map();
  const depthBlurKernelCache = new Map();

  function composeSegmentDepthResources(width, height, segmentData, depthKey) {
    const pixels = new Uint8Array(width * height);
  
    for (let segmentIndex = 0; segmentIndex < segmentData.length; segmentIndex += 1) {
      const segment = segmentData[segmentIndex];
      if (!segment || !segment.indices.length || !segment.hasSourceDepth) {
        continue;
      }
  
      const localPixels = segment[depthKey];
      if (!localPixels || !localPixels.length) {
        continue;
      }
  
      for (let i = 0; i < segment.indices.length; i += 1) {
        const pixelIndex = segment.indices[i];
        const x = pixelIndex % width;
        const y = Math.floor(pixelIndex / width);
        const localIndex = (y - segment.bounds.minY) * segment.localWidth + (x - segment.bounds.minX);
        pixels[pixelIndex] = localPixels[localIndex];
      }
    }
  
    return createDepthTextureResources(width, height, pixels);
  }

  function preprocessSegmentDepths(width, height, segmentData) {
    const processedPixels = new Uint8Array(width * height);
    const nextSegmentData = segmentData.map((segment) => {
      if (!segment.hasSourceDepth || !segment.localDepthPixels.length) {
        return segment;
      }
  
      const processedLocalDepthPixels = preprocessSegmentLocalDepth(
        segment.localDepthPixels,
        segment.localMask,
        segment.localWidth,
        segment.localHeight,
      );
  
      for (let i = 0; i < segment.indices.length; i += 1) {
        const pixelIndex = segment.indices[i];
        const x = pixelIndex % width;
        const y = Math.floor(pixelIndex / width);
        const localIndex = (y - segment.bounds.minY) * segment.localWidth + (x - segment.bounds.minX);
        processedPixels[pixelIndex] = processedLocalDepthPixels[localIndex];
      }
  
      return {
        ...segment,
        processedLocalDepthPixels,
      };
    });
  
    const resources = createDepthTextureResources(width, height, processedPixels);
    return {
      segmentData: nextSegmentData,
      pixels: processedPixels,
      texture: resources.texture,
    };
  }
  
  function preprocessSegmentLocalDepth(sourcePixels, mask, width, height) {
    const filtered = rejectMaskedDepthOutliers(sourcePixels, mask, width, height);
    const holeFilled = fillMaskedDepthHoles(filtered, mask, width, height, 12);
    const boundaryCorrected = correctSegmentBoundaryDepthLeakage(holeFilled, mask, width, height);
    const median = applyMaskedMedianFilter(boundaryCorrected, mask, width, height, 1);
    const blurKernel = getDepthBlurKernel(1);
    const blurred = applyMaskedBlurFilter(median, mask, width, height, 1, blurKernel);
    const sharpened = applyMaskedUnsharpFilter(median, blurred, mask, 0.65);
    const despiked = suppressMaskedDepthSpikes(sharpened, mask, width, height, 2);
    return enforceMaskedDepthContinuity(despiked, mask, width, height, 3);
  }
  
  function rejectMaskedDepthOutliers(sourcePixels, mask, width, height) {
    const output = sourcePixels.slice();
    const rowStats = computeMaskedAxisStats(sourcePixels, mask, width, height, "row");
    const colStats = computeMaskedAxisStats(sourcePixels, mask, width, height, "col");
  
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const depth = sourcePixels[index];
        if (!mask[index] || depth <= 0) {
          continue;
        }
  
        const localStats = sampleMaskedDepthStats(sourcePixels, mask, width, height, x, y, 2);
        const rowVote = axisOutlierVote(depth, rowStats, y, 2.5, 8);
        const colVote = axisOutlierVote(depth, colStats, x, 2.5, 8);
        const localVote = statsOutlierVote(depth, localStats, 2.25, 6);
        const similarNeighbors = countSimilarNeighbors(sourcePixels, mask, width, height, x, y, depth, localStats);
  
        const votes = rowVote + colVote + localVote;
        if (votes >= 2 && similarNeighbors <= 1) {
          output[index] = 0;
        }
      }
    }
  
    return output;
  }
  
  function computeMaskedAxisStats(sourcePixels, mask, width, height, axis) {
    const lineCount = axis === "row" ? height : width;
    const lineSpan = axis === "row" ? width : height;
    const medians = new Float32Array(lineCount);
    const mads = new Float32Array(lineCount);
    const valid = new Uint8Array(lineCount);
    const samples = [];
  
    for (let line = 0; line < lineCount; line += 1) {
      samples.length = 0;
  
      for (let step = 0; step < lineSpan; step += 1) {
        const x = axis === "row" ? step : line;
        const y = axis === "row" ? line : step;
        const index = y * width + x;
        if (!mask[index] || sourcePixels[index] <= 0) {
          continue;
        }
        samples.push(sourcePixels[index]);
      }
  
      if (samples.length < 3) {
        continue;
      }
  
      samples.sort((a, b) => a - b);
      const median = samples[(samples.length - 1) >> 1];
      const deviations = samples.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
      medians[line] = median;
      mads[line] = deviations[(deviations.length - 1) >> 1];
      valid[line] = 1;
    }
  
    return { medians, mads, valid };
  }
  
  function axisOutlierVote(depth, axisStats, lineIndex, madScale, floor) {
    if (!axisStats.valid[lineIndex]) {
      return 0;
    }
  
    const median = axisStats.medians[lineIndex];
    const mad = axisStats.mads[lineIndex];
    const limit = Math.max(floor, mad * madScale + floor * 0.5);
    return Math.abs(depth - median) > limit ? 1 : 0;
  }
  
  function statsOutlierVote(depth, stats, madScale, floor) {
    if (!stats) {
      return 0;
    }
  
    const limit = Math.max(floor, stats.mad * madScale + floor * 0.5);
    return Math.abs(depth - stats.median) > limit ? 1 : 0;
  }
  
  function countSimilarNeighbors(sourcePixels, mask, width, height, x, y, depth, localStats) {
    const tolerance = localStats ? Math.max(8, localStats.mad * 2 + 4) : 10;
    let count = 0;
  
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        if (ox === 0 && oy === 0) {
          continue;
        }
  
        const sx = x + ox;
        const sy = y + oy;
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
          continue;
        }
  
        const index = sy * width + sx;
        if (!mask[index] || sourcePixels[index] <= 0) {
          continue;
        }
  
        if (Math.abs(sourcePixels[index] - depth) <= tolerance) {
          count += 1;
        }
      }
    }
  
    return count;
  }
  
  function fillMaskedDepthHoles(sourcePixels, mask, width, height, passes) {
    let current = sourcePixels.slice();
  
    for (let pass = 0; pass < passes; pass += 1) {
      const next = current.slice();
      let filled = 0;
  
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = y * width + x;
          if (!mask[index] || current[index] > 0) {
            continue;
          }
  
          const neighbors = collectMaskedNeighborDepths(current, mask, width, height, x, y);
          if (neighbors.length < 2) {
            continue;
          }
  
          neighbors.sort((a, b) => a - b);
          next[index] = neighbors[(neighbors.length - 1) >> 1];
          filled += 1;
        }
      }
  
      current = next;
      if (filled === 0) {
        break;
      }
    }
  
    return current;
  }
  
  function correctSegmentBoundaryDepthLeakage(sourcePixels, mask, width, height) {
    const output = sourcePixels.slice();
    const boundaryMask = buildBoundaryMask(mask, width, height);
    let trustedMask = erodeMask(mask, width, height, 2);
  
    if (!trustedMask.some(Boolean)) {
      trustedMask = erodeMask(mask, width, height, 1);
    }
    if (!trustedMask.some(Boolean)) {
      trustedMask = mask;
    }
  
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!boundaryMask[index]) {
          continue;
        }
  
        const stats = sampleMaskedDepthStats(sourcePixels, trustedMask, width, height, x, y, 3);
        if (!stats) {
          continue;
        }
  
        const currentDepth = sourcePixels[index];
        const deviationLimit = Math.max(10, stats.mad * 3 + 6);
        if (currentDepth <= 0 || Math.abs(currentDepth - stats.median) > deviationLimit) {
          output[index] = stats.median;
        }
      }
    }
  
    return output;
  }
  
  function buildBoundaryMask(mask, width, height) {
    const boundary = new Uint8Array(mask.length);
  
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!mask[index]) {
          continue;
        }
  
        if (
          x === 0 ||
          y === 0 ||
          x === width - 1 ||
          y === height - 1 ||
          !mask[index - 1] ||
          !mask[index + 1] ||
          !mask[index - width] ||
          !mask[index + width]
        ) {
          boundary[index] = 1;
        }
      }
    }
  
    return boundary;
  }
  
  function erodeMask(mask, width, height, iterations) {
    let current = mask.slice();
  
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const next = new Uint8Array(mask.length);
  
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const index = y * width + x;
          if (
            current[index] &&
            current[index - 1] &&
            current[index + 1] &&
            current[index - width] &&
            current[index + width]
          ) {
            next[index] = 1;
          }
        }
      }
  
      current = next;
    }
  
    return current;
  }
  
  function sampleMaskedDepthStats(sourcePixels, mask, width, height, centerX, centerY, radius) {
    const samples = [];
  
    for (let oy = -radius; oy <= radius; oy += 1) {
      const y = centerY + oy;
      if (y < 0 || y >= height) {
        continue;
      }
  
      for (let ox = -radius; ox <= radius; ox += 1) {
        const x = centerX + ox;
        if (x < 0 || x >= width) {
          continue;
        }
  
        const index = y * width + x;
        if (!mask[index] || sourcePixels[index] <= 0) {
          continue;
        }
        samples.push(sourcePixels[index]);
      }
    }
  
    if (samples.length === 0) {
      return null;
    }
  
    samples.sort((a, b) => a - b);
    const median = samples[(samples.length - 1) >> 1];
    const deviations = samples.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
    const mad = deviations[(deviations.length - 1) >> 1];
  
    return { median, mad };
  }
  
  function suppressMaskedDepthSpikes(sourcePixels, mask, width, height, passes) {
    let current = sourcePixels.slice();
  
    for (let pass = 0; pass < passes; pass += 1) {
      const next = current.slice();
  
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = y * width + x;
          if (!mask[index] || current[index] <= 0) {
            continue;
          }
  
          const stats = sampleMaskedDepthStats(current, mask, width, height, x, y, 1);
          if (!stats) {
            continue;
          }
  
          const edgeAwareStats = sampleMaskedDepthStats(current, mask, width, height, x, y, 2) || stats;
          const deviation = Math.abs(current[index] - stats.median);
          const localLimit = Math.max(8, stats.mad * 2 + 4, edgeAwareStats.mad * 2 + 4);
  
          if (deviation > localLimit) {
            next[index] = stats.median;
          }
        }
      }
  
      current = next;
    }
  
    return current;
  }
  
  function enforceMaskedDepthContinuity(sourcePixels, mask, width, height, passes) {
    let current = sourcePixels.slice();
  
    for (let pass = 0; pass < passes; pass += 1) {
      const next = current.slice();
  
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = y * width + x;
          if (!mask[index] || current[index] <= 0) {
            continue;
          }
  
          const neighbors = collectMaskedNeighborDepths(current, mask, width, height, x, y);
          if (neighbors.length < 2) {
            continue;
          }
  
          neighbors.sort((a, b) => a - b);
          const neighborMedian = neighbors[(neighbors.length - 1) >> 1];
          const deviations = neighbors.map((value) => Math.abs(value - neighborMedian)).sort((a, b) => a - b);
          const neighborMad = deviations[(deviations.length - 1) >> 1];
          const maxStep = Math.max(6, neighborMad * 2 + 3);
          const currentDepth = current[index];
          const delta = currentDepth - neighborMedian;
  
          if (Math.abs(delta) > maxStep) {
            next[index] = clamp(Math.round(neighborMedian + Math.sign(delta) * maxStep), 0, 255);
            continue;
          }
  
          const minNeighbor = neighbors[0];
          const maxNeighbor = neighbors[neighbors.length - 1];
          if (currentDepth < minNeighbor - maxStep || currentDepth > maxNeighbor + maxStep) {
            next[index] = clamp(Math.round(neighborMedian), 0, 255);
          }
        }
      }
  
      current = next;
    }
  
    return current;
  }
  
  function collectMaskedNeighborDepths(sourcePixels, mask, width, height, x, y) {
    const neighbors = [];
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
  
    for (const [dx, dy] of offsets) {
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
        continue;
      }
  
      const sampleIndex = sy * width + sx;
      if (!mask[sampleIndex] || sourcePixels[sampleIndex] <= 0) {
        continue;
      }
      neighbors.push(sourcePixels[sampleIndex]);
    }
  
    return neighbors;
  }
  
  function applyMaskedMedianFilter(sourcePixels, mask, width, height, radius) {
    const output = new Uint8Array(sourcePixels.length);
    const samples = [];
  
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!mask[index]) {
          continue;
        }
  
        if (sourcePixels[index] <= 0) {
          output[index] = 0;
          continue;
        }
  
        samples.length = 0;
        for (let oy = -radius; oy <= radius; oy += 1) {
          const sy = y + oy;
          if (sy < 0 || sy >= height) {
            continue;
          }
  
          for (let ox = -radius; ox <= radius; ox += 1) {
            const sx = x + ox;
            if (sx < 0 || sx >= width) {
              continue;
            }
  
            const sampleIndex = sy * width + sx;
            if (!mask[sampleIndex] || sourcePixels[sampleIndex] <= 0) {
              continue;
            }
            samples.push(sourcePixels[sampleIndex]);
          }
        }
  
        if (samples.length === 0) {
          output[index] = sourcePixels[index];
          continue;
        }
  
        samples.sort((a, b) => a - b);
        output[index] = samples[(samples.length - 1) >> 1];
      }
    }
  
    return output;
  }
  
  function applyMaskedBlurFilter(sourcePixels, mask, width, height, radius, kernel) {
    const output = new Uint8Array(sourcePixels.length);
  
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!mask[index]) {
          continue;
        }
  
        if (sourcePixels[index] <= 0) {
          output[index] = 0;
          continue;
        }
  
        let weightedSum = 0;
        let weightTotal = 0;
  
        for (let oy = -radius; oy <= radius; oy += 1) {
          const sy = y + oy;
          if (sy < 0 || sy >= height) {
            continue;
          }
  
          for (let ox = -radius; ox <= radius; ox += 1) {
            const sx = x + ox;
            if (sx < 0 || sx >= width) {
              continue;
            }
  
            const sampleIndex = sy * width + sx;
            if (!mask[sampleIndex] || sourcePixels[sampleIndex] <= 0) {
              continue;
            }
  
            const kernelIndex = (oy + radius) * (radius * 2 + 1) + (ox + radius);
            const weight = kernel[kernelIndex];
            weightedSum += sourcePixels[sampleIndex] * weight;
            weightTotal += weight;
          }
        }
  
        output[index] = weightTotal > 0
          ? Math.round(weightedSum / weightTotal)
          : sourcePixels[index];
      }
    }
  
    return output;
  }
  
  function applyMaskedUnsharpFilter(basePixels, blurredPixels, mask, amount) {
    const output = new Uint8Array(basePixels.length);
  
    for (let index = 0; index < basePixels.length; index += 1) {
      if (!mask[index] || basePixels[index] <= 0) {
        output[index] = basePixels[index];
        continue;
      }
  
      const enhanced = basePixels[index] + (basePixels[index] - blurredPixels[index]) * amount;
      output[index] = clamp(Math.round(enhanced), 0, 255);
    }
  
    return output;
  }
  
  function getDepthBlurKernel(radius) {
    const cached = depthBlurKernelCache.get(radius);
    if (cached) {
      return cached;
    }
  
    const kernel = createGaussianKernel(radius);
    depthBlurKernelCache.set(radius, kernel);
    return kernel;
  }
  

  function createSegmentedGridDepthResources(
    width,
    height,
    segmentData,
    specMode,
    gridX,
    gridY,
    kernelSize,
    interpMode,
  ) {
    const pixels = new Uint8Array(width * height);
    const gridSpec = createGridSpec(width, height, specMode, gridX, gridY, kernelSize);
    const kernel = createGaussianKernel(gridSpec.radius);
  
    for (let segmentIndex = 0; segmentIndex < segmentData.length; segmentIndex += 1) {
      const segment = segmentData[segmentIndex];
      if (!segment || !segment.indices.length || !segment.hasSourceDepth) {
        continue;
      }
  
      writeSegmentGridDepthPixels(
        width,
        segment,
        gridSpec,
        kernel,
        interpMode,
        pixels,
      );
    }
  
    return createDepthTextureResources(width, height, pixels);
  }
  
  function createGridDepthResources(width, height, sourcePixels, specMode, gridX, gridY, kernelSize, interpMode) {
    const gridSpec = createGridSpec(width, height, specMode, gridX, gridY, kernelSize);
    const kernel = createGaussianKernel(gridSpec.radius);
    const pixels = createGridDepthPixels(width, height, sourcePixels, gridSpec, kernel, interpMode);
    return createDepthTextureResources(width, height, pixels);
  }
  
  function createMaskedGridDepthPixels(width, height, sourcePixels, maskPixels, specMode, gridX, gridY, kernelSize, interpMode) {
    const gridSpec = createGridSpec(width, height, specMode, gridX, gridY, kernelSize);
    const kernel = createGaussianKernel(gridSpec.radius);
    const pixels = createGridDepthPixels(width, height, sourcePixels, gridSpec, kernel, interpMode);
    for (let i = 0; i < pixels.length; i += 1) {
      if (!maskPixels[i]) {
        pixels[i] = 0;
      }
    }
    return pixels;
  }
  
  function createGridSpec(width, height, specMode, gridX, gridY, kernelSize) {
    const gridWidth = specMode === "size"
      ? Math.max(2, Math.ceil((width - 1) / Math.max(1, gridX)) + 1)
      : Math.max(2, gridX + 1);
    const gridHeight = specMode === "size"
      ? Math.max(2, Math.ceil((height - 1) / Math.max(1, gridY)) + 1)
      : Math.max(2, gridY + 1);
  
    return {
      gridWidth,
      gridHeight,
      radius: Math.max(1, Math.floor(kernelSize / 2)),
    };
  }
  
  function createGridDepthPixels(width, height, sourcePixels, gridSpec, kernel, interpMode) {
    const pixels = new Uint8Array(width * height);
    const { gridWidth, gridHeight, radius } = gridSpec;
    const controlValues = new Float32Array(gridWidth * gridHeight);
    const controlValid = new Uint8Array(gridWidth * gridHeight);
  
    for (let gy = 0; gy < gridHeight; gy += 1) {
      const py = sampleGridPosition(gy, gridHeight, height);
      for (let gx = 0; gx < gridWidth; gx += 1) {
        const px = sampleGridPosition(gx, gridWidth, width);
        const sample = convolveDepthAt(sourcePixels, width, height, px, py, radius, kernel);
        const index = gy * gridWidth + gx;
        controlValues[index] = sample.value;
        controlValid[index] = sample.valid ? 1 : 0;
      }
    }
  
    for (let y = 0; y < height; y += 1) {
      const fy = ((y / Math.max(1, height - 1)) * (gridHeight - 1));
      for (let x = 0; x < width; x += 1) {
        const fx = ((x / Math.max(1, width - 1)) * (gridWidth - 1));
        const value = interpMode === "cubic"
          ? sampleCubicGrid(controlValues, controlValid, gridWidth, gridHeight, fx, fy)
          : sampleLinearGrid(controlValues, controlValid, gridWidth, gridHeight, fx, fy);
        const rounded = Math.max(0, Math.min(255, Math.round(value)));
        const pixelIndex = y * width + x;
        pixels[pixelIndex] = rounded;
      }
    }
  
    return pixels;
  }
  
  function writeSegmentGridDepthPixels(
    imageWidth,
    segment,
    gridSpec,
    kernel,
    interpMode,
    outputPixels,
  ) {
    const {
      indices,
      bounds,
      localWidth,
      localHeight,
      processedLocalDepthPixels,
    } = segment;
    const { gridWidth, gridHeight, radius } = gridSpec;
    const controlValues = new Float32Array(gridWidth * gridHeight);
    const controlValid = new Uint8Array(gridWidth * gridHeight);
  
    for (let gy = 0; gy < gridHeight; gy += 1) {
      const py = sampleGridPositionInBounds(gy, gridHeight, bounds.minY, bounds.maxY);
      for (let gx = 0; gx < gridWidth; gx += 1) {
        const px = sampleGridPositionInBounds(gx, gridWidth, bounds.minX, bounds.maxX);
        const sample = convolveDepthAtBounds(
          processedLocalDepthPixels,
          localWidth,
          localHeight,
          px - bounds.minX,
          py - bounds.minY,
          radius,
          kernel,
        );
        const index = gy * gridWidth + gx;
        controlValues[index] = sample.value;
        controlValid[index] = sample.valid ? 1 : 0;
      }
    }
  
    const boundWidth = Math.max(1, bounds.maxX - bounds.minX);
    const boundHeight = Math.max(1, bounds.maxY - bounds.minY);
  
    for (let i = 0; i < indices.length; i += 1) {
      const pixelIndex = indices[i];
      const x = pixelIndex % imageWidth;
      const y = Math.floor(pixelIndex / imageWidth);
      const fx = ((x - bounds.minX) / boundWidth) * (gridWidth - 1);
      const fy = ((y - bounds.minY) / boundHeight) * (gridHeight - 1);
      const value = interpMode === "cubic"
        ? sampleCubicGrid(controlValues, controlValid, gridWidth, gridHeight, fx, fy)
        : sampleLinearGrid(controlValues, controlValid, gridWidth, gridHeight, fx, fy);
      outputPixels[pixelIndex] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
  
  function createGaussianKernel(radius) {
    const cached = gaussianKernelCache.get(radius);
    if (cached) {
      return cached;
    }
  
    const size = radius * 2 + 1;
    const kernel = new Float32Array(size * size);
    const sigma = Math.max(1, radius * 0.5);
    let index = 0;
  
    for (let y = -radius; y <= radius; y += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        const distance2 = x * x + y * y;
        kernel[index++] = Math.exp(-distance2 / (2 * sigma * sigma));
      }
    }
  
    gaussianKernelCache.set(radius, kernel);
    return kernel;
  }
  
  function createDepthTextureResources(width, height, pixels) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = context.createImageData(width, height);
  
    for (let pixelIndex = 0; pixelIndex < pixels.length; pixelIndex += 1) {
      const rounded = pixels[pixelIndex];
      const imageIndex = pixelIndex * 4;
      imageData.data[imageIndex] = rounded;
      imageData.data[imageIndex + 1] = rounded;
      imageData.data[imageIndex + 2] = rounded;
      imageData.data[imageIndex + 3] = rounded > 0 ? 255 : 0;
    }
  
    context.putImageData(imageData, 0, 0);
  
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
  
    return { texture, pixels };
  }
  
  function createBinaryMaskTexture(width, height, maskPixels) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = context.createImageData(width, height);
  
    for (let pixelIndex = 0; pixelIndex < maskPixels.length; pixelIndex += 1) {
      const value = maskPixels[pixelIndex] ? 255 : 0;
      const imageIndex = pixelIndex * 4;
      imageData.data[imageIndex] = value;
      imageData.data[imageIndex + 1] = value;
      imageData.data[imageIndex + 2] = value;
      imageData.data[imageIndex + 3] = 255;
    }
  
    context.putImageData(imageData, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
  }
  
  function updatePsdDebugPanel() {
    if (!psdDebugPanelEl) {
      return;
    }
  
    if (renderState.sourceMode !== "psd" || renderState.psdDebugLayerIndex < 0) {
      psdDebugPanelEl.classList.remove("is-visible");
      psdDebugImageEl.removeAttribute("src");
      if (psdDepthImageEl) {
        psdDepthImageEl.removeAttribute("src");
      }
      return;
    }
  
    const layer = renderState.psdLayerEntries[renderState.psdDebugLayerIndex];
    if (!layer || !layer.debugPreviewUrl) {
      psdDebugPanelEl.classList.remove("is-visible");
      psdDebugImageEl.removeAttribute("src");
      if (psdDepthImageEl) {
        psdDepthImageEl.removeAttribute("src");
      }
      return;
    }
  
    psdDebugTitleEl.textContent = `PSD debug: ${layer.name || `Layer ${renderState.psdDebugLayerIndex + 1}`} | removed ${layer.removedDepthPixels || 0}px`;
    psdDebugImageEl.src = layer.debugPreviewUrl;
    if (psdDepthImageEl && (layer.currentDepthPreviewUrl || layer.depthPreviewUrl)) {
      psdDepthImageEl.src = layer.currentDepthPreviewUrl || layer.depthPreviewUrl;
    }
    psdDebugPanelEl.classList.add("is-visible");
  }
  
  function pruneOutlierSeedDepthClusters(depthPixels, debugState, debugScore, maskPixels, width, height, threshold) {
    const totalPixels = width * height;
    const visited = new Uint8Array(totalPixels);
    const queue = new Int32Array(totalPixels);
    const components = [];
    const linkThreshold = Math.max(6, threshold * 0.2);
    const contourMask = buildLayerContourBandMask(maskPixels, width, height, 1);
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
  
    for (let start = 0; start < totalPixels; start += 1) {
      if (visited[start] || !maskPixels[start] || depthPixels[start] === 0) {
        continue;
      }
  
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      visited[start] = 1;
      const indices = [];
      const values = [];
      let contourHits = 0;
  
      while (head < tail) {
        const index = queue[head++];
        indices.push(index);
        values.push(depthPixels[index]);
        if (contourMask[index]) {
          contourHits += 1;
        }
        const x = index % width;
        const y = Math.floor(index / width);
  
        for (let i = 0; i < neighbors.length; i += 1) {
          const [dx, dy] = neighbors[i];
          const sx = x + dx;
          const sy = y + dy;
          if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
            continue;
          }
          const sampleIndex = sy * width + sx;
          if (visited[sampleIndex] || !maskPixels[sampleIndex] || depthPixels[sampleIndex] === 0) {
            continue;
          }
          if (Math.abs(depthPixels[sampleIndex] - depthPixels[index]) > linkThreshold) {
            continue;
          }
          visited[sampleIndex] = 1;
          queue[tail++] = sampleIndex;
        }
      }
  
      components.push({
        indices,
        size: indices.length,
        contourRatio: contourHits / indices.length,
        median: medianOfNumbers(values),
      });
    }
  
    if (components.length < 2) {
      return;
    }
  
    let dominant = components[0];
    for (let i = 1; i < components.length; i += 1) {
      if (components[i].size > dominant.size) {
        dominant = components[i];
      }
    }
  
    const clusterThreshold = Math.max(4, threshold * 0.18);
    const dominantSizeFloor = Math.max(12, dominant.size * 0.45);
  
    for (let i = 0; i < components.length; i += 1) {
      const component = components[i];
      if (component === dominant) {
        continue;
      }
  
      const medianDistance = Math.abs(component.median - dominant.median);
      if (medianDistance <= clusterThreshold) {
        continue;
      }
      if (component.size >= dominantSizeFloor && component.contourRatio < 0.55) {
        continue;
      }
  
      for (let j = 0; j < component.indices.length; j += 1) {
        const index = component.indices[j];
        depthPixels[index] = 0;
        debugState[index] = 6;
        debugScore[index] = Math.max(debugScore[index], clampByte(Math.round(medianDistance * 24)));
      }
    }
  }
  
  function createPsdDebugTexture(width, height, maskPixels, debugState, debugScore) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = context.createImageData(width, height);
  
    for (let pixelIndex = 0; pixelIndex < maskPixels.length; pixelIndex += 1) {
      const imageIndex = pixelIndex * 4;
      if (!maskPixels[pixelIndex]) {
        imageData.data[imageIndex + 3] = 0;
        continue;
      }
  
      const state = debugState[pixelIndex];
      const score = debugScore[pixelIndex] / 255;
      let r = 24;
      let g = 24;
      let b = 30;
      let a = 220;
  
      if (state === 1) {
        r = 18;
        g = 18;
        b = 28;
        a = 120;
      } else if (state === 2) {
        r = Math.round(20 + score * 40);
        g = Math.round(70 + score * 120);
        b = Math.round(180 + score * 60);
      } else if (state === 3) {
        r = 255;
        g = Math.round(170 * (1 - score * 0.7));
        b = Math.round(40 * (1 - score * 0.3));
      } else if (state === 4) {
        r = 255;
        g = Math.round(60 + score * 30);
        b = Math.round(170 + score * 60);
      } else if (state === 5) {
        r = 255;
        g = 235;
        b = 90;
      } else if (state === 6) {
        r = 120;
        g = Math.round(220 + score * 20);
        b = 255;
      }
  
      imageData.data[imageIndex] = r;
      imageData.data[imageIndex + 1] = g;
      imageData.data[imageIndex + 2] = b;
      imageData.data[imageIndex + 3] = a;
    }
  
    context.putImageData(imageData, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return {
      texture,
      url: canvas.toDataURL("image/png"),
    };
  }
  
  function createPsdDepthPreviewUrl(width, height, depthPixels, maskPixels, filledMask = null) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = context.createImageData(width, height);
  
    for (let pixelIndex = 0; pixelIndex < depthPixels.length; pixelIndex += 1) {
      const imageIndex = pixelIndex * 4;
      if (!maskPixels[pixelIndex]) {
        imageData.data[imageIndex + 3] = 0;
        continue;
      }
  
      const depth = depthPixels[pixelIndex];
      if (filledMask && filledMask[pixelIndex]) {
        imageData.data[imageIndex] = 0;
        imageData.data[imageIndex + 1] = depth;
        imageData.data[imageIndex + 2] = depth;
      } else {
        imageData.data[imageIndex] = 0;
        imageData.data[imageIndex + 1] = depth;
        imageData.data[imageIndex + 2] = 0;
      }
      imageData.data[imageIndex + 3] = 255;
    }
  
    context.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  }
  
  function sampleGridPosition(index, count, extent) {
    if (count <= 1) {
      return 0;
    }
  
    return Math.round((index / (count - 1)) * (extent - 1));
  }
  
  function sampleGridPositionInBounds(index, count, min, max) {
    if (count <= 1 || max <= min) {
      return min;
    }
  
    return Math.round(min + (index / (count - 1)) * (max - min));
  }
  
  function convolveDepthAt(sourcePixels, width, height, centerX, centerY, radius, kernel) {
    let weightedSum = 0;
    let weightTotal = 0;
  
    for (let oy = -radius; oy <= radius; oy += 1) {
      const y = centerY + oy;
      if (y < 0 || y >= height) {
        continue;
      }
  
      for (let ox = -radius; ox <= radius; ox += 1) {
        const x = centerX + ox;
        if (x < 0 || x >= width) {
          continue;
        }
  
        const value = sourcePixels[y * width + x];
        if (value <= 0) {
          continue;
        }
  
        const kernelIndex = (oy + radius) * (radius * 2 + 1) + (ox + radius);
        const weight = kernel[kernelIndex];
        weightedSum += value * weight;
        weightTotal += weight;
      }
    }
  
    if (weightTotal === 0) {
      return { value: 0, valid: false };
    }
  
    return { value: weightedSum / weightTotal, valid: true };
  }
  
  function convolveDepthAtBounds(sourcePixels, width, height, centerX, centerY, radius, kernel) {
    let weightedSum = 0;
    let weightTotal = 0;
  
    for (let oy = -radius; oy <= radius; oy += 1) {
      const y = centerY + oy;
      if (y < 0 || y >= height) {
        continue;
      }
  
      for (let ox = -radius; ox <= radius; ox += 1) {
        const x = centerX + ox;
        if (x < 0 || x >= width) {
          continue;
        }
  
        const value = sourcePixels[y * width + x];
        if (value <= 0) {
          continue;
        }
  
        const kernelIndex = (oy + radius) * (radius * 2 + 1) + (ox + radius);
        const weight = kernel[kernelIndex];
        weightedSum += value * weight;
        weightTotal += weight;
      }
    }
  
    if (weightTotal === 0) {
      return { value: 0, valid: false };
    }
  
    return { value: weightedSum / weightTotal, valid: true };
  }
  
  function sampleLinearGrid(values, valid, gridWidth, gridHeight, fx, fy) {
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(gridWidth - 1, x0 + 1);
    const y1 = Math.min(gridHeight - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
  
    return blendValidSamples([
      { x: x0, y: y0, weight: (1 - tx) * (1 - ty) },
      { x: x1, y: y0, weight: tx * (1 - ty) },
      { x: x0, y: y1, weight: (1 - tx) * ty },
      { x: x1, y: y1, weight: tx * ty },
    ], values, valid, gridWidth);
  }
  
  function sampleCubicGrid(values, valid, gridWidth, gridHeight, fx, fy) {
    const baseX = Math.floor(fx);
    const baseY = Math.floor(fy);
    const tx = fx - baseX;
    const ty = fy - baseY;
    const samples = [];
  
    for (let oy = -1; oy <= 2; oy += 1) {
      const sy = clamp(baseY + oy, 0, gridHeight - 1);
      const wy = catmullRomWeight(oy - ty);
      for (let ox = -1; ox <= 2; ox += 1) {
        const sx = clamp(baseX + ox, 0, gridWidth - 1);
        const wx = catmullRomWeight(ox - tx);
        samples.push({ x: sx, y: sy, weight: wx * wy });
      }
    }
  
    return blendValidSamples(samples, values, valid, gridWidth);
  }
  
  function blendValidSamples(samples, values, valid, gridWidth) {
    let weightedSum = 0;
    let weightTotal = 0;
  
    for (const sample of samples) {
      if (sample.weight === 0) {
        continue;
      }
  
      const index = sample.y * gridWidth + sample.x;
      if (!valid[index]) {
        continue;
      }
  
      weightedSum += values[index] * sample.weight;
      weightTotal += sample.weight;
    }
  
    if (weightTotal === 0) {
      return 0;
    }
  
    return weightedSum / weightTotal;
  }
  
  function catmullRomWeight(x) {
    const ax = Math.abs(x);
    if (ax <= 1) {
      return 1.5 * ax * ax * ax - 2.5 * ax * ax + 1;
    }
    if (ax < 2) {
      return -0.5 * ax * ax * ax + 2.5 * ax * ax - 4 * ax + 2;
    }
    return 0;
  }
  
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  

  return {
    clamp,
    composeSegmentDepthResources,
    preprocessSegmentDepths,
    createSegmentedGridDepthResources,
    createGridDepthResources,
    createMaskedGridDepthPixels,
    createDepthTextureResources,
    createBinaryMaskTexture,
  };
}
