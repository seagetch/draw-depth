export function createSegmentAnalysis(constants) {
  const {
    segmentAnchorDistance,
    segmentMinAnchorPixels,
    segmentMinAnchorRatio,
    segmentMergeThresholdRatio,
  } = constants;

  function clusterSegmentPixels(segmentPixels, depthPixels, width, height) {
    const totalPixels = width * height;
    const histogram = new Map();
  
    for (let index = 0; index < totalPixels; index += 1) {
      const offset = index * 3;
      const r = segmentPixels[offset];
      const g = segmentPixels[offset + 1];
      const b = segmentPixels[offset + 2];
      const key = (r << 16) | (g << 8) | b;
      const count = histogram.get(key) || 0;
      histogram.set(key, count + 1);
    }
  
    const colorEntries = Array.from(histogram.entries())
      .map(([key, count]) => ({
        key,
        count,
        r: (key >> 16) & 255,
        g: (key >> 8) & 255,
        b: key & 255,
      }))
      .sort((a, b) => b.count - a.count);
  
    const minAnchorPixels = Math.max(
      segmentMinAnchorPixels,
      Math.round(totalPixels * segmentMinAnchorRatio),
    );
    const anchors = [];
  
    for (const entry of colorEntries) {
      const nearest = findNearestPaletteColor(entry, anchors);
      if (!nearest || nearest.distance2 > segmentAnchorDistance * segmentAnchorDistance) {
        if (entry.count >= minAnchorPixels || anchors.length === 0) {
          anchors.push({
            r: entry.r,
            g: entry.g,
            b: entry.b,
            count: 0,
            sourceKeys: [entry.key],
          });
        }
      }
    }
  
    if (anchors.length === 0) {
      anchors.push({
        r: colorEntries[0]?.r ?? 255,
        g: colorEntries[0]?.g ?? 255,
        b: colorEntries[0]?.b ?? 255,
        count: colorEntries[0]?.count ?? totalPixels,
        sourceKeys: colorEntries[0] ? [colorEntries[0].key] : [],
      });
    }
  
    const colorToAnchor = new Map();
  
    for (const entry of colorEntries) {
      const nearest = findNearestPaletteColor(entry, anchors);
      if (!nearest) {
        continue;
      }
  
      colorToAnchor.set(entry.key, nearest.index);
      nearest.anchor.count += entry.count;
      nearest.anchor.sourceKeys.push(entry.key);
    }
  
    const rawCounts = new Uint32Array(anchors.length);
    const rawAssignments = new Int16Array(totalPixels);
    rawAssignments.fill(-1);
  
    for (let index = 0; index < totalPixels; index += 1) {
      const offset = index * 3;
      const key = (segmentPixels[offset] << 16) | (segmentPixels[offset + 1] << 8) | segmentPixels[offset + 2];
      const anchorIndex = colorToAnchor.get(key);
      rawAssignments[index] = anchorIndex;
      rawCounts[anchorIndex] += 1;
    }
  
    const minSegmentPixels = Math.max(16, Math.round(totalPixels * segmentMergeThresholdRatio));
    const activeFlags = Array.from(rawCounts, (count) => count >= minSegmentPixels);
  
    if (!activeFlags.some(Boolean)) {
      activeFlags[rawCounts.indexOf(Math.max(...rawCounts))] = true;
    }
  
    const remap = anchors.map((anchor, index) => {
      if (activeFlags[index]) {
        return index;
      }
  
      const nearest = findNearestPaletteColor(anchor, anchors, activeFlags);
      return nearest ? nearest.index : index;
    });
  
    const finalKeyToIndex = new Map();
    const finalPalette = [];
    const finalCounts = [];
    const finalSums = [];
    const segmentMap = new Int16Array(totalPixels);
    segmentMap.fill(-1);
  
    for (let index = 0; index < totalPixels; index += 1) {
      const mergedIndex = remap[rawAssignments[index]];
      let finalIndex = finalKeyToIndex.get(mergedIndex);
      if (finalIndex === undefined) {
        finalIndex = finalPalette.length;
        finalKeyToIndex.set(mergedIndex, finalIndex);
        finalPalette.push({ r: 0, g: 0, b: 0 });
        finalCounts.push(0);
        finalSums.push({ r: 0, g: 0, b: 0 });
      }
  
      const offset = index * 3;
      finalSums[finalIndex].r += segmentPixels[offset];
      finalSums[finalIndex].g += segmentPixels[offset + 1];
      finalSums[finalIndex].b += segmentPixels[offset + 2];
      finalCounts[finalIndex] += 1;
      segmentMap[index] = finalIndex;
    }
  
    refineAntialiasedSegmentBoundaries(
      segmentMap,
      finalPalette,
      segmentPixels,
      width,
      height,
      2,
    );
  
    finalCounts.fill(0);
    for (let i = 0; i < finalSums.length; i += 1) {
      finalSums[i].r = 0;
      finalSums[i].g = 0;
      finalSums[i].b = 0;
    }
  
    for (let index = 0; index < totalPixels; index += 1) {
      const finalIndex = segmentMap[index];
      if (finalIndex < 0) {
        continue;
      }
      const offset = index * 3;
      finalSums[finalIndex].r += segmentPixels[offset];
      finalSums[finalIndex].g += segmentPixels[offset + 1];
      finalSums[finalIndex].b += segmentPixels[offset + 2];
      finalCounts[finalIndex] += 1;
    }
  
    finalPalette.forEach((color, index) => {
      color.r = Math.round(finalSums[index].r / Math.max(1, finalCounts[index]));
      color.g = Math.round(finalSums[index].g / Math.max(1, finalCounts[index]));
      color.b = Math.round(finalSums[index].b / Math.max(1, finalCounts[index]));
    });
  
    const splitSegments = splitDisconnectedSegments(
      segmentMap,
      width,
      height,
      finalPalette,
    );
    const filteredSegments = filterSegmentsWithoutDepth(
      splitSegments.segmentMap,
      splitSegments.palette,
      splitSegments.pixelCounts,
      depthPixels,
    );
    const cleanedSegments = filterSmallSegments(
      filteredSegments.segmentMap,
      filteredSegments.palette,
      filteredSegments.pixelCounts,
      2,
    );
  
    const order = cleanedSegments.palette
      .map((_, index) => index)
      .sort((a, b) => cleanedSegments.pixelCounts[b] - cleanedSegments.pixelCounts[a]);
    const orderedPalette = order.map((index) => cleanedSegments.palette[index]);
    const orderedCounts = order.map((index) => cleanedSegments.pixelCounts[index]);
    const orderedMap = new Int16Array(totalPixels);
    orderedMap.fill(-1);
    const orderRemap = new Map(order.map((originalIndex, sortedIndex) => [originalIndex, sortedIndex]));
  
    for (let index = 0; index < totalPixels; index += 1) {
      if (cleanedSegments.segmentMap[index] < 0) {
        continue;
      }
      orderedMap[index] = orderRemap.get(cleanedSegments.segmentMap[index]);
    }
  
    return {
      count: orderedPalette.length,
      palette: orderedPalette,
      pixelCounts: orderedCounts,
      segmentMap: orderedMap,
      segmentPixels: buildSegmentPixelLists(orderedMap, orderedPalette.length),
      segmentBounds: buildSegmentBounds(orderedMap, orderedPalette.length, width, height),
      segmentData: buildSegmentLocalData(
        orderedMap,
        orderedPalette.length,
        width,
        height,
        depthPixels,
      ),
    };
  }
  
  function refineAntialiasedSegmentBoundaries(segmentMap, palette, segmentPixels, width, height, passes) {
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
  
    for (let pass = 0; pass < passes; pass += 1) {
      const next = segmentMap.slice();
  
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const index = y * width + x;
          const current = segmentMap[index];
          if (current < 0) {
            continue;
          }
  
          const counts = new Map();
          for (let i = 0; i < offsets.length; i += 1) {
            const [dx, dy] = offsets[i];
            const neighbor = segmentMap[(y + dy) * width + (x + dx)];
            if (neighbor < 0) {
              continue;
            }
            counts.set(neighbor, (counts.get(neighbor) || 0) + 1);
          }
  
          if (counts.size < 2) {
            continue;
          }
  
          let dominant = current;
          let dominantCount = counts.get(current) || 0;
          for (const [segmentIndex, count] of counts.entries()) {
            if (count > dominantCount) {
              dominant = segmentIndex;
              dominantCount = count;
            }
          }
  
          if (dominant === current || dominantCount < 4) {
            continue;
          }
  
          const offset = index * 3;
          const color = {
            r: segmentPixels[offset],
            g: segmentPixels[offset + 1],
            b: segmentPixels[offset + 2],
          };
          const currentDistance = colorDistanceSquared(color, palette[current]);
          const dominantDistance = colorDistanceSquared(color, palette[dominant]);
  
          if (dominantDistance <= currentDistance * 1.15 || (counts.get(current) || 0) <= 1) {
            next[index] = dominant;
          }
        }
      }
  
      segmentMap.set(next);
    }
  }
  
  function buildSegmentPixelLists(segmentMap, segmentCount) {
    const lists = Array.from({ length: segmentCount }, () => []);
  
    for (let index = 0; index < segmentMap.length; index += 1) {
      const segmentIndex = segmentMap[index];
      if (segmentIndex < 0) {
        continue;
      }
      lists[segmentIndex].push(index);
    }
  
    return lists.map((indices) => Int32Array.from(indices));
  }
  
  function buildSegmentBounds(segmentMap, segmentCount, width, height) {
    const bounds = Array.from({ length: segmentCount }, () => ({
      minX: width,
      minY: height,
      maxX: -1,
      maxY: -1,
    }));
  
    for (let index = 0; index < segmentMap.length; index += 1) {
      const segmentIndex = segmentMap[index];
      if (segmentIndex < 0) {
        continue;
      }
  
      const x = index % width;
      const y = Math.floor(index / width);
      const bound = bounds[segmentIndex];
      bound.minX = Math.min(bound.minX, x);
      bound.minY = Math.min(bound.minY, y);
      bound.maxX = Math.max(bound.maxX, x);
      bound.maxY = Math.max(bound.maxY, y);
    }
  
    return bounds.map((bound) => (
      bound.maxX < 0
        ? { minX: 0, minY: 0, maxX: -1, maxY: -1 }
        : bound
    ));
  }
  
  function buildSegmentLocalData(segmentMap, segmentCount, width, height, depthPixels) {
    const pixelLists = buildSegmentPixelLists(segmentMap, segmentCount);
    const bounds = buildSegmentBounds(segmentMap, segmentCount, width, height);
  
    return pixelLists.map((indices, segmentIndex) => {
      const boundsForSegment = bounds[segmentIndex];
      if (!indices.length || boundsForSegment.maxX < boundsForSegment.minX) {
        return {
          indices,
          bounds: boundsForSegment,
          localWidth: 0,
          localHeight: 0,
          localDepthPixels: new Uint8Array(0),
          localMask: new Uint8Array(0),
          processedLocalDepthPixels: new Uint8Array(0),
          hasSourceDepth: false,
        };
      }
  
      const localWidth = boundsForSegment.maxX - boundsForSegment.minX + 1;
      const localHeight = boundsForSegment.maxY - boundsForSegment.minY + 1;
      const localDepthPixels = new Uint8Array(localWidth * localHeight);
      const localMask = new Uint8Array(localWidth * localHeight);
      let hasSourceDepth = false;
  
      for (let i = 0; i < indices.length; i += 1) {
        const pixelIndex = indices[i];
        const x = pixelIndex % width;
        const y = Math.floor(pixelIndex / width);
        const localIndex = (y - boundsForSegment.minY) * localWidth + (x - boundsForSegment.minX);
        const depth = depthPixels[pixelIndex];
        localMask[localIndex] = 1;
        localDepthPixels[localIndex] = depth;
        if (depth > 0) {
          hasSourceDepth = true;
        }
      }
  
      return {
        indices,
        bounds: boundsForSegment,
        localWidth,
        localHeight,
        localDepthPixels,
        localMask,
        processedLocalDepthPixels: localDepthPixels.slice(),
        hasSourceDepth,
      };
    });
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
  
  function splitDisconnectedSegments(segmentMap, width, height, palette) {
    const totalPixels = width * height;
    const visited = new Uint8Array(totalPixels);
    const splitMap = new Int16Array(totalPixels);
    splitMap.fill(-1);
    const splitPalette = [];
    const splitCounts = [];
    const queue = new Int32Array(totalPixels);
  
    for (let start = 0; start < totalPixels; start += 1) {
      const sourceSegment = segmentMap[start];
      if (sourceSegment < 0 || visited[start]) {
        continue;
      }
  
      const nextSegmentIndex = splitPalette.length;
      splitPalette.push({ ...palette[sourceSegment] });
      splitCounts.push(0);
      visited[start] = 1;
      queue[0] = start;
      let head = 0;
      let tail = 1;
  
      while (head < tail) {
        const index = queue[head++];
        splitMap[index] = nextSegmentIndex;
        splitCounts[nextSegmentIndex] += 1;
  
        const x = index % width;
        const y = Math.floor(index / width);
  
        if (x > 0) {
          const left = index - 1;
          if (!visited[left] && segmentMap[left] === sourceSegment) {
            visited[left] = 1;
            queue[tail++] = left;
          }
        }
  
        if (x + 1 < width) {
          const right = index + 1;
          if (!visited[right] && segmentMap[right] === sourceSegment) {
            visited[right] = 1;
            queue[tail++] = right;
          }
        }
  
        if (y > 0) {
          const up = index - width;
          if (!visited[up] && segmentMap[up] === sourceSegment) {
            visited[up] = 1;
            queue[tail++] = up;
          }
        }
  
        if (y + 1 < height) {
          const down = index + width;
          if (!visited[down] && segmentMap[down] === sourceSegment) {
            visited[down] = 1;
            queue[tail++] = down;
          }
        }
      }
    }
  
    return {
      segmentMap: splitMap,
      palette: splitPalette,
      pixelCounts: splitCounts,
    };
  }
  
  function filterSegmentsWithoutDepth(segmentMap, palette, pixelCounts, depthPixels) {
    const hasDepth = new Uint8Array(palette.length);
  
    for (let index = 0; index < segmentMap.length; index += 1) {
      const segmentIndex = segmentMap[index];
      if (segmentIndex < 0 || depthPixels[index] <= 0) {
        continue;
      }
      hasDepth[segmentIndex] = 1;
    }
  
    const remap = new Int16Array(palette.length);
    remap.fill(-1);
    const filteredPalette = [];
    const filteredCounts = [];
  
    for (let index = 0; index < palette.length; index += 1) {
      if (!hasDepth[index]) {
        continue;
      }
  
      remap[index] = filteredPalette.length;
      filteredPalette.push(palette[index]);
      filteredCounts.push(pixelCounts[index]);
    }
  
    const filteredMap = new Int16Array(segmentMap.length);
    filteredMap.fill(-1);
  
    for (let index = 0; index < segmentMap.length; index += 1) {
      const segmentIndex = segmentMap[index];
      if (segmentIndex < 0) {
        continue;
      }
      filteredMap[index] = remap[segmentIndex];
    }
  
    return {
      segmentMap: filteredMap,
      palette: filteredPalette,
      pixelCounts: filteredCounts,
    };
  }
  
  function filterSmallSegments(segmentMap, palette, pixelCounts, maxSegmentSize) {
    const remap = new Int16Array(palette.length);
    remap.fill(-1);
    const filteredPalette = [];
    const filteredCounts = [];
  
    for (let index = 0; index < palette.length; index += 1) {
      if (pixelCounts[index] <= maxSegmentSize) {
        continue;
      }
  
      remap[index] = filteredPalette.length;
      filteredPalette.push(palette[index]);
      filteredCounts.push(pixelCounts[index]);
    }
  
    const filteredMap = new Int16Array(segmentMap.length);
    filteredMap.fill(-1);
  
    for (let index = 0; index < segmentMap.length; index += 1) {
      const segmentIndex = segmentMap[index];
      if (segmentIndex < 0) {
        continue;
      }
      filteredMap[index] = remap[segmentIndex];
    }
  
    return {
      segmentMap: filteredMap,
      palette: filteredPalette,
      pixelCounts: filteredCounts,
    };
  }
  
  function findNearestPaletteColor(color, palette, activeFlags = null) {
    if (palette.length === 0) {
      return null;
    }
  
    let nearestIndex = -1;
    let nearestDistance = Infinity;
  
    for (let i = 0; i < palette.length; i += 1) {
      if (activeFlags && !activeFlags[i]) {
        continue;
      }
  
      const distance = colorDistanceSquared(color, palette[i]);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    }
  
    if (nearestIndex < 0) {
      return null;
    }
  
    return {
      index: nearestIndex,
      distance2: nearestDistance,
      anchor: palette[nearestIndex],
    };
  }
  
  function colorDistanceSquared(a, b) {
    const dr = a.r - b.r;
    const dg = a.g - b.g;
    const db = a.b - b.b;
    return dr * dr + dg * dg + db * db;
  }

  return {
    clusterSegmentPixels,
  };
}
