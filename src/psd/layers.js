export function createPsdLayers(deps) {
  const {
    THREE,
    createMaskedGridDepthPixels,
    createDepthTextureResources,
    createBinaryMaskTexture,
    clamp,
    elements,
  } = deps
  const {
    depthDiscontinuityEl,
    contourRepairEl,
    depthModeEl,
    gridSpecModeEl,
    gridXEl,
    gridYEl,
    kernelSizeEl,
    interpModeEl,
  } = elements

  function createPsdLayerEntries(colorPsd, depthPsd, stableDepthPixels) {
    const colorLayers = flattenPsdLayers(colorPsd.children || []);
    const depthLayers = depthPsd ? flattenPsdLayers(depthPsd.children || []) : null;
    const depthLayerLookup = depthLayers ? buildPsdLayerLookup(depthLayers) : null;
    if (!depthPsd && !stableDepthPixels) {
      throw new Error("Midori-depth-st.png could not be loaded.");
    }
  
    const layerSources = [];
  
    for (let i = 0; i < colorLayers.length; i += 1) {
      const colorLayer = colorLayers[i];
      if (colorLayer.width <= 0 || colorLayer.height <= 0) {
        continue;
      }
  
      const colorTexture = new THREE.CanvasTexture(colorLayer.canvas);
      colorTexture.encoding = THREE.sRGBEncoding;
      colorTexture.minFilter = THREE.LinearFilter;
      colorTexture.magFilter = THREE.LinearFilter;
      colorTexture.needsUpdate = true;
  
      const colorImageData = getCanvasImageData(colorLayer.canvas);
      const colorMaskPixels = extractLayerMaskPixels(colorImageData.data);
      const depthLayer = depthLayerLookup
        ? takeMatchedPsdLayer(depthLayerLookup, colorLayer, i)
        : (depthLayers && depthLayers[i] ? depthLayers[i] : null);
      const depthImageData = depthLayer ? getCanvasImageData(depthLayer.canvas) : null;
      const sampledDepthRgba = depthImageData && depthLayer
        ? sampleLayerRgbaToTargetLayer(depthImageData, depthLayer, colorLayer)
        : null;
      const rawDepthPixels = depthImageData
        ? sampleDepthPixelsToTargetLayer(
          depthImageData,
          depthLayer,
          colorLayer,
          {
            ignoreAlpha: !!depthPsd,
            minAlpha: depthPsd ? 0 : 1,
          },
        )
        : (depthPsd ? new Uint8Array(colorLayer.width * colorLayer.height) : null);
      const depthPixels = depthPsd && depthImageData
        ? repairDirectDepthEdgePixels(
          rawDepthPixels,
          sampledDepthRgba,
          colorMaskPixels,
          colorLayer.width,
          colorLayer.height,
        )
        : rawDepthPixels;
      const maskPixels = colorMaskPixels;
  
      layerSources.push({
        name: colorLayer.name || `Layer ${layerSources.length + 1}`,
        sourceIndex: i,
        sourceIndices: [i],
        left: colorLayer.left,
        top: colorLayer.top,
        width: colorLayer.width,
        height: colorLayer.height,
        colorTexture,
        colorImageData,
        maskPixels,
        depthImageData,
        directDepthPixels: depthPixels,
        depthMaskPixels: maskPixels,
      });
    }
  
    const mergedLayerSources = mergePsdFaceFeatureLayers(
      layerSources,
      colorPsd.width,
      colorPsd.height,
      { mergeDepth: !depthPsd },
    );
  
    const visibleLayerMap = depthPsd || !stableDepthPixels
      ? null
      : buildVisiblePsdLayerMap(
        colorPsd.width,
        colorPsd.height,
        mergedLayerSources,
      );
    const pendingLayers = [];
    const entries = [];
  
    for (let i = 0; i < mergedLayerSources.length; i += 1) {
      const layer = mergedLayerSources[i];
      const maskPixels = extractLayerMaskPixels(layer.colorImageData.data);
      if (depthPsd) {
        const rawDepthPixels = (layer.directDepthPixels || new Uint8Array(layer.width * layer.height)).slice();
        pendingLayers.push({
          layer,
          hasDirectDepth: true,
          maskPixels,
          pruneResult: {
            pixels: rawDepthPixels,
            debugState: new Uint8Array(rawDepthPixels.length),
            debugScore: new Uint8Array(rawDepthPixels.length),
          },
          removedDepthPixels: 0,
          inpaintFilledMask: new Uint8Array(rawDepthPixels.length),
          inpaintedDepthPixels: rawDepthPixels,
        });
        continue;
      }
  
      const seededDepthPixels = seedPsdLayerDepthPixels(
        layer,
        i,
        colorPsd.width,
        colorPsd.height,
        stableDepthPixels,
        visibleLayerMap,
        maskPixels,
        mergedLayerSources,
      );
      const pruneResult = prunePsdForeignDepthSeeds(
        seededDepthPixels,
        layer,
        i,
        colorPsd.width,
        colorPsd.height,
        stableDepthPixels,
        visibleLayerMap,
        maskPixels,
        Number(depthDiscontinuityEl.value),
      );
      const depthPixels = pruneResult.pixels;
      if (contourRepairEl.checked) {
        const contourBandMask = buildLayerContourBandMask(maskPixels, layer.width, layer.height, 2);
        for (let p = 0; p < depthPixels.length; p += 1) {
          if (contourBandMask[p]) {
            depthPixels[p] = 0;
            pruneResult.debugState[p] = 5;
          }
        }
      }
  
      const erodedPositiveMask = erodePositiveDepthMask(depthPixels, layer.width, layer.height, 1);
      let removedDepthPixels = 0;
      for (let p = 0; p < depthPixels.length; p += 1) {
        if (maskPixels[p] && depthPixels[p] > 0 && !erodedPositiveMask[p]) {
          depthPixels[p] = 0;
          pruneResult.debugState[p] = 5;
          removedDepthPixels += 1;
        }
      }
  
      if (renderState.psdLayerOutlierPruneEnabled[i]) {
        pruneOutlierSeedDepthClusters(
          depthPixels,
          pruneResult.debugState,
          pruneResult.debugScore,
          maskPixels,
          layer.width,
          layer.height,
          Number(depthDiscontinuityEl.value),
        );
      }
  
      const inpaintResult = inpaintMaskedLayerDepth(depthPixels, maskPixels, layer.width, layer.height);
      pendingLayers.push({
        layer,
        maskPixels,
        pruneResult,
        removedDepthPixels,
        inpaintFilledMask: inpaintResult.filledMask,
        inpaintedDepthPixels: inpaintResult.pixels,
      });
    }
  
    if (!depthPsd) {
      applyPsdSymmetryToPendingLayers(pendingLayers);
    }
  
    for (let i = 0; i < pendingLayers.length; i += 1) {
      const pending = pendingLayers[i];
      const { layer, maskPixels, pruneResult } = pending;
      const smoothedDepthPixels = pending.inpaintedDepthPixels;
      const finalDepthPixels = pending.hasDirectDepth || depthModeEl.value === "raw"
        ? smoothedDepthPixels
        : createMaskedGridDepthPixels(
          layer.width,
          layer.height,
          smoothedDepthPixels,
          maskPixels,
          gridSpecModeEl.value,
          Number(gridXEl.value),
          Number(gridYEl.value),
          Number(kernelSizeEl.value),
          interpModeEl.value,
        );
      const renderDepthMask = new Uint8Array(finalDepthPixels.length);
      for (let p = 0; p < finalDepthPixels.length; p += 1) {
        renderDepthMask[p] = maskPixels[p] && finalDepthPixels[p] > 0 ? 1 : 0;
      }
      const depthTexture = createDepthTextureResources(layer.width, layer.height, finalDepthPixels).texture;
      const maskTexture = createBinaryMaskTexture(layer.width, layer.height, renderDepthMask);
      const debugTexture = createPsdDebugTexture(layer.width, layer.height, maskPixels, pruneResult.debugState, pruneResult.debugScore);
      const depthPreviewUrl = createPsdDepthPreviewUrl(
        layer.width,
        layer.height,
        finalDepthPixels,
        maskPixels,
        pending.inpaintFilledMask,
      );
      depthTexture.minFilter = THREE.NearestFilter;
      depthTexture.magFilter = THREE.NearestFilter;
      depthTexture.needsUpdate = true;
  
      entries.push({
        name: layer.name,
        sourceIndices: layer.sourceIndices ? layer.sourceIndices.slice() : [layer.sourceIndex],
        left: layer.left,
        top: layer.top,
        width: layer.width,
        height: layer.height,
        colorTexture: layer.colorTexture,
        depthTexture,
        maskTexture,
        debugTexture: debugTexture.texture,
        debugPreviewUrl: debugTexture.url,
        depthPreviewUrl,
        inpaintFilledMask: pending.inpaintFilledMask,
        baseDepthPixels: finalDepthPixels.slice(),
        depthPixels: finalDepthPixels,
        renderDepthMask,
        hasDirectDepth: !!pending.hasDirectDepth,
        maskPixels,
        removedDepthPixels: pending.removedDepthPixels,
        visible: true,
      });
    }
  
    return entries;
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
  
  function getCanvasImageData(canvas) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    return context.getImageData(0, 0, canvas.width, canvas.height);
  }
  
  function intersectBinaryMasks(maskA, maskB) {
    const output = new Uint8Array(maskA.length);
    for (let i = 0; i < maskA.length; i += 1) {
      output[i] = maskA[i] && maskB[i] ? 1 : 0;
    }
    return output;
  }
  
  function mergePsdFaceFeatureLayers(layerSources, imageWidth, imageHeight, options = {}) {
    const merged = layerSources.slice();
    const mergeDepth = options.mergeDepth !== false;
    const featureRegex = /(?:^|[\s_:#-])(nose|mouth|lower[\s_-]?lip|upper[\s_-]?lip|lower[\s_-]?teeth|upper[\s_-]?teeth|tongue|eyewhite|eyebrow\d*|irides?|eyelash|eyelid\d*|eylid\d*|eye|iris|sclera)(?:$|[\s_:#-])/i;
    const faceRegex = /(?:^|[\s_:#-])#?face(?:$|[\s_:#-])/i;
    const mergePlans = [];
  
    for (let i = 0; i < merged.length; i += 1) {
      if (featureRegex.test(merged[i].name)) {
        const targetIndex = findPsdFeatureMergeTarget(merged, i, faceRegex, imageWidth, imageHeight);
        if (targetIndex >= 0) {
          mergePlans.push({
            sourceIndex: i,
            targetIndex,
          });
        }
      }
    }
  
    mergePlans.sort((a, b) => a.sourceIndex - b.sourceIndex);
  
    const removed = new Uint8Array(merged.length);
    for (let i = 0; i < mergePlans.length; i += 1) {
      const { sourceIndex, targetIndex } = mergePlans[i];
      if (removed[sourceIndex] || removed[targetIndex]) {
        continue;
      }
      compositePsdLayerIntoTarget(merged[targetIndex], merged[sourceIndex], imageWidth, imageHeight, { mergeDepth });
      merged[targetIndex].sourceIndices = [
        ...(merged[targetIndex].sourceIndices || [merged[targetIndex].sourceIndex]),
        ...(merged[sourceIndex].sourceIndices || [merged[sourceIndex].sourceIndex]),
      ];
      removed[sourceIndex] = 1;
    }
  
    for (let i = merged.length - 1; i >= 0; i -= 1) {
      if (removed[i]) {
        merged.splice(i, 1);
      }
    }
  
    return merged;
  }
  
  function buildPsdLayerLookup(layers) {
    const lookup = new Map();
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[i];
      const key = getPsdLayerMatchKey(layer);
      if (!lookup.has(key)) {
        lookup.set(key, []);
      }
      lookup.get(key).push({ layer, index: i });
    }
    return lookup;
  }
  
  function getPsdLayerMatchKey(layer) {
    return [
      layer.name || "",
      layer.left || 0,
      layer.top || 0,
      layer.canvas ? layer.canvas.width : (layer.width || 0),
      layer.canvas ? layer.canvas.height : (layer.height || 0),
    ].join("|");
  }
  
  function takeMatchedPsdLayer(lookup, colorLayer, fallbackIndex) {
    const exactKey = getPsdLayerMatchKey(colorLayer);
    const exactMatches = lookup.get(exactKey);
    if (exactMatches && exactMatches.length) {
      return exactMatches.shift().layer;
    }
  
    let bestEntries = null;
    let bestEntryIndex = -1;
    let bestScore = -1;
  
    for (const entries of lookup.values()) {
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        const score = scorePsdLayerMatch(colorLayer, entry.layer, fallbackIndex, entry.index);
        if (score > bestScore) {
          bestScore = score;
          bestEntries = entries;
          bestEntryIndex = i;
        }
      }
    }
  
    if (bestEntries && bestEntryIndex >= 0 && bestScore > 0) {
      return bestEntries.splice(bestEntryIndex, 1)[0].layer;
    }
  
    return null;
  }
  
  function scorePsdLayerMatch(colorLayer, depthLayer, fallbackColorIndex, fallbackDepthIndex) {
    const colorName = normalizePsdLayerName(colorLayer.name || "");
    const depthName = normalizePsdLayerName(depthLayer.name || "");
    const overlap = estimatePsdLayerRectOverlap(colorLayer, depthLayer);
    const exactPosition = (
      (depthLayer.left || 0) === (colorLayer.left || 0) &&
      (depthLayer.top || 0) === (colorLayer.top || 0)
    ) ? 1 : 0;
    const indexBonus = fallbackColorIndex === fallbackDepthIndex ? 0.01 : 0;
  
    if (colorName && depthName && colorName === depthName) {
      return 1000000 + overlap + exactPosition + indexBonus;
    }
    return overlap + exactPosition + indexBonus;
  }
  
  function normalizePsdLayerName(name) {
    return String(name || "").trim().toLowerCase();
  }
  
  function estimatePsdLayerRectOverlap(layerA, layerB) {
    const left = Math.max(layerA.left || 0, layerB.left || 0);
    const top = Math.max(layerA.top || 0, layerB.top || 0);
    const right = Math.min(
      (layerA.left || 0) + (layerA.width || (layerA.canvas ? layerA.canvas.width : 0)),
      (layerB.left || 0) + (layerB.width || (layerB.canvas ? layerB.canvas.width : 0)),
    );
    const bottom = Math.min(
      (layerA.top || 0) + (layerA.height || (layerA.canvas ? layerA.canvas.height : 0)),
      (layerB.top || 0) + (layerB.height || (layerB.canvas ? layerB.canvas.height : 0)),
    );
    if (right <= left || bottom <= top) {
      return 0;
    }
    return (right - left) * (bottom - top);
  }
  
  function shouldSymmetrizePsdLayerDepth(layerName) {
    return /(?:^|[\s_:#-])(face|body|torso|chest|breast|arm|hand|finger|leg|boot|boots|foot)(?:$|[\s_:#-])/i.test(layerName);
  }
  
  function applyPsdSymmetryToPendingLayers(pendingLayers) {
    for (let i = 0; i < pendingLayers.length; i += 1) {
      const pending = pendingLayers[i];
      if (isSingleSymmetryPsdLayer(pending.layer.name)) {
        pending.inpaintedDepthPixels = symmetrizeMaskedDepthHorizontally(
          pending.inpaintedDepthPixels,
          pending.maskPixels,
          pending.layer.width,
          pending.layer.height,
        );
      }
    }
  
    const pairGroups = new Map();
    for (let i = 0; i < pendingLayers.length; i += 1) {
      const sideInfo = parsePairedSymmetryLayerName(pendingLayers[i].layer.name);
      if (!sideInfo) {
        continue;
      }
      const existing = pairGroups.get(sideInfo.key) || {};
      existing[sideInfo.side] = pendingLayers[i];
      pairGroups.set(sideInfo.key, existing);
    }
  
    for (const pair of pairGroups.values()) {
      if (pair.left && pair.right) {
        symmetrizePsdLayerPair(pair.left, pair.right);
      }
    }
  }
  
  function isSingleSymmetryPsdLayer(layerName) {
    return /(?:^|[\s_:#-])(face|body|torso|chest|breast)(?:$|[\s_:#-])/i.test(layerName);
  }
  
  function parsePairedSymmetryLayerName(layerName) {
    let side = null;
    if (/(?:^|::|\b)(l|left)(?:$|::|\b)/i.test(layerName)) {
      side = "left";
    } else if (/(?:^|::|\b)(r|right)(?:$|::|\b)/i.test(layerName)) {
      side = "right";
    }
  
    if (!side) {
      return null;
    }
  
    const key = layerName
      .replace(/(?:^|::|\b)(l|left|r|right)(?:$|::|\b)/gi, "::")
      .replace(/:+/g, "::")
      .replace(/^[\s:]+|[\s:]+$/g, "")
      .toLowerCase();
  
    return { key, side };
  }
  
  function symmetrizeMaskedDepthHorizontally(sourceDepthPixels, maskPixels, width, height) {
    const output = sourceDepthPixels.slice();
    const bounds = computeBinaryMaskBounds(maskPixels, width, height);
    if (!bounds) {
      return output;
    }
  
    const axisX = bounds.left + (bounds.width - 1) * 0.5;
  
    for (let y = bounds.top; y < bounds.top + bounds.height; y += 1) {
      for (let x = bounds.left; x < bounds.left + bounds.width; x += 1) {
        const mirrorX = Math.round(axisX + (axisX - x));
        if (mirrorX < bounds.left || mirrorX >= bounds.left + bounds.width) {
          continue;
        }
        if (mirrorX < x) {
          continue;
        }
  
        const leftIndex = y * width + x;
        const rightIndex = y * width + mirrorX;
        const leftMasked = maskPixels[leftIndex] > 0;
        const rightMasked = maskPixels[rightIndex] > 0;
        if (!leftMasked && !rightMasked) {
          continue;
        }
  
        const leftDepth = leftMasked ? output[leftIndex] : 0;
        const rightDepth = rightMasked ? output[rightIndex] : 0;
  
        if (leftMasked && rightMasked && leftDepth > 0 && rightDepth > 0) {
          const averaged = clampByte(Math.round((leftDepth + rightDepth) * 0.5));
          output[leftIndex] = averaged;
          output[rightIndex] = averaged;
          continue;
        }
  
        if (leftMasked && rightMasked) {
          const propagated = leftDepth > 0 ? leftDepth : rightDepth;
          if (propagated > 0) {
            output[leftIndex] = propagated;
            output[rightIndex] = propagated;
          }
        }
      }
    }
  
    return output;
  }
  
  function symmetrizePsdLayerPair(leftPending, rightPending) {
    const leftBounds = computeLayerGlobalBounds(leftPending.layer, leftPending.maskPixels);
    const rightBounds = computeLayerGlobalBounds(rightPending.layer, rightPending.maskPixels);
    if (!leftBounds || !rightBounds) {
      return;
    }
  
    const axisX = (
      leftBounds.left +
      leftBounds.right +
      rightBounds.left +
      rightBounds.right
    ) * 0.25;
  
    const nextLeft = leftPending.inpaintedDepthPixels.slice();
    const nextRight = rightPending.inpaintedDepthPixels.slice();
  
    for (let y = leftBounds.top; y <= leftBounds.bottom; y += 1) {
      for (let x = leftBounds.left; x <= leftBounds.right; x += 1) {
        const leftLocalX = x - leftPending.layer.left;
        const leftLocalY = y - leftPending.layer.top;
        if (
          leftLocalX < 0 ||
          leftLocalX >= leftPending.layer.width ||
          leftLocalY < 0 ||
          leftLocalY >= leftPending.layer.height
        ) {
          continue;
        }
  
        const leftIndex = leftLocalY * leftPending.layer.width + leftLocalX;
        if (!leftPending.maskPixels[leftIndex]) {
          continue;
        }
  
        const mirrorX = Math.round(axisX + (axisX - x));
        const rightLocalX = mirrorX - rightPending.layer.left;
        const rightLocalY = y - rightPending.layer.top;
        if (
          rightLocalX < 0 ||
          rightLocalX >= rightPending.layer.width ||
          rightLocalY < 0 ||
          rightLocalY >= rightPending.layer.height
        ) {
          continue;
        }
  
        const rightIndex = rightLocalY * rightPending.layer.width + rightLocalX;
        if (!rightPending.maskPixels[rightIndex]) {
          continue;
        }
  
        const leftDepth = nextLeft[leftIndex];
        const rightDepth = nextRight[rightIndex];
        if (leftDepth > 0 && rightDepth > 0) {
          const averaged = clampByte(Math.round((leftDepth + rightDepth) * 0.5));
          nextLeft[leftIndex] = averaged;
          nextRight[rightIndex] = averaged;
        } else if (leftDepth > 0 || rightDepth > 0) {
          const propagated = leftDepth > 0 ? leftDepth : rightDepth;
          nextLeft[leftIndex] = propagated;
          nextRight[rightIndex] = propagated;
        }
      }
    }
  
    leftPending.inpaintedDepthPixels = nextLeft;
    rightPending.inpaintedDepthPixels = nextRight;
  }
  
  function computeLayerGlobalBounds(layer, maskPixels) {
    const bounds = computeBinaryMaskBounds(maskPixels, layer.width, layer.height);
    if (!bounds) {
      return null;
    }
    return {
      left: layer.left + bounds.left,
      top: layer.top + bounds.top,
      right: layer.left + bounds.left + bounds.width - 1,
      bottom: layer.top + bounds.top + bounds.height - 1,
    };
  }
  
  function findPsdFeatureMergeTarget(layerSources, featureIndex, faceRegex, imageWidth, imageHeight) {
    const featureLayer = layerSources[featureIndex];
    let bestIndex = -1;
    let bestScore = -1;
  
    for (let i = 0; i < layerSources.length; i += 1) {
      if (i === featureIndex) {
        continue;
      }
  
      const candidate = layerSources[i];
      if (!faceRegex.test(candidate.name)) {
        continue;
      }
  
      const overlap = estimateLayerMaskOverlap(featureLayer, candidate, imageWidth, imageHeight);
      if (overlap <= 0) {
        continue;
      }
  
      if (overlap > bestScore) {
        bestScore = overlap;
        bestIndex = i;
      }
    }
  
    return bestIndex;
  }
  
  function estimateLayerMaskOverlap(layerA, layerB, imageWidth, imageHeight) {
    const left = Math.max(layerA.left, layerB.left, 0);
    const top = Math.max(layerA.top, layerB.top, 0);
    const right = Math.min(layerA.left + layerA.width, layerB.left + layerB.width, imageWidth);
    const bottom = Math.min(layerA.top + layerA.height, layerB.top + layerB.height, imageHeight);
    if (right <= left || bottom <= top) {
      return 0;
    }
  
    let overlap = 0;
    for (let y = top; y < bottom; y += 1) {
      const ay = y - layerA.top;
      const by = y - layerB.top;
      for (let x = left; x < right; x += 1) {
        const ax = x - layerA.left;
        const bx = x - layerB.left;
        const aIndex = ay * layerA.width + ax;
        const bIndex = by * layerB.width + bx;
        if (layerA.colorImageData.data[aIndex * 4 + 3] > 0 && layerB.colorImageData.data[bIndex * 4 + 3] > 0) {
          overlap += 1;
        }
      }
    }
  
    return overlap;
  }
  
  function compositePsdLayerIntoTarget(targetLayer, featureLayer, imageWidth, imageHeight, options = {}) {
    const mergeDepth = options.mergeDepth !== false;
    const left = Math.max(targetLayer.left, featureLayer.left, 0);
    const top = Math.max(targetLayer.top, featureLayer.top, 0);
    const right = Math.min(targetLayer.left + targetLayer.width, featureLayer.left + featureLayer.width, imageWidth);
    const bottom = Math.min(targetLayer.top + targetLayer.height, featureLayer.top + featureLayer.height, imageHeight);
    if (right <= left || bottom <= top) {
      return;
    }
  
    const targetPixels = targetLayer.colorImageData.data;
    const featurePixels = featureLayer.colorImageData.data;
    const targetDepthPixels = mergeDepth && targetLayer.depthImageData ? targetLayer.depthImageData.data : null;
    const featureDepthPixels = mergeDepth && featureLayer.depthImageData ? featureLayer.depthImageData.data : null;
  
    for (let y = top; y < bottom; y += 1) {
      const ty = y - targetLayer.top;
      const fy = y - featureLayer.top;
      for (let x = left; x < right; x += 1) {
        const tx = x - targetLayer.left;
        const fx = x - featureLayer.left;
        const targetOffset = (ty * targetLayer.width + tx) * 4;
        const featureOffset = (fy * featureLayer.width + fx) * 4;
        const srcAlpha = featurePixels[featureOffset + 3];
        if (srcAlpha <= 0) {
          continue;
        }
  
        const srcAlphaN = srcAlpha / 255;
        const dstAlphaN = targetPixels[targetOffset + 3] / 255;
        const outAlpha = srcAlphaN + dstAlphaN * (1 - srcAlphaN);
        if (outAlpha <= 0) {
          continue;
        }
  
        for (let c = 0; c < 3; c += 1) {
          const src = featurePixels[featureOffset + c] / 255;
          const dst = targetPixels[targetOffset + c] / 255;
          const out = (src * srcAlphaN + dst * dstAlphaN * (1 - srcAlphaN)) / outAlpha;
          targetPixels[targetOffset + c] = clampByte(Math.round(out * 255));
        }
        targetPixels[targetOffset + 3] = clampByte(Math.round(outAlpha * 255));
  
        if (targetDepthPixels && featureDepthPixels) {
          targetDepthPixels[targetOffset] = featureDepthPixels[featureOffset];
          targetDepthPixels[targetOffset + 1] = featureDepthPixels[featureOffset + 1];
          targetDepthPixels[targetOffset + 2] = featureDepthPixels[featureOffset + 2];
          targetDepthPixels[targetOffset + 3] = featureDepthPixels[featureOffset + 3];
        }
      }
    }
  
    const targetCanvas = document.createElement("canvas");
    targetCanvas.width = targetLayer.width;
    targetCanvas.height = targetLayer.height;
    const targetContext = targetCanvas.getContext("2d", { willReadFrequently: true });
    targetContext.putImageData(targetLayer.colorImageData, 0, 0);
  
    targetLayer.colorTexture.dispose();
    const colorTexture = new THREE.CanvasTexture(targetCanvas);
    colorTexture.encoding = THREE.sRGBEncoding;
    colorTexture.minFilter = THREE.LinearFilter;
    colorTexture.magFilter = THREE.LinearFilter;
    colorTexture.needsUpdate = true;
    targetLayer.colorTexture = colorTexture;
    targetLayer.maskPixels = extractLayerMaskPixels(targetLayer.colorImageData.data);
    if (mergeDepth && targetLayer.depthImageData) {
      targetLayer.directDepthPixels = extractDepthPixelsFromCanvas(createCanvasFromImageData(targetLayer.depthImageData));
      targetLayer.depthMaskPixels = extractLayerMaskPixels(targetLayer.depthImageData.data);
    } else if (!targetLayer.depthMaskPixels) {
      targetLayer.depthMaskPixels = targetLayer.maskPixels;
    }
  }
  
  function extractLayerMaskPixels(rgbaPixels) {
    const maskPixels = new Uint8Array(rgbaPixels.length >> 2);
    for (let i = 0, p = 0; i < rgbaPixels.length; i += 4, p += 1) {
      maskPixels[p] = rgbaPixels[i + 3] > 0 ? 1 : 0;
    }
    return maskPixels;
  }
  
  function extractLayerRelativeDepthPixels(rgbaPixels) {
    const depthPixels = new Uint8Array(rgbaPixels.length >> 2);
    for (let i = 0, p = 0; i < rgbaPixels.length; i += 4, p += 1) {
      depthPixels[p] = rgbaPixels[i + 3] > 0 ? rgbaPixels[i] : 255;
    }
    return depthPixels;
  }
  
  function prunePsdForeignDepthSeeds(
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
        const sameLayerSupport = collectPsdLocalDepthSupport(
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
        const foreignSupport = collectPsdForeignVisibleDepthSupport(
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
  
  function clampByte(value) {
    return Math.max(0, Math.min(255, value));
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
  
  function collectPsdLocalDepthSupport(depthPixels, maskPixels, width, height, centerX, centerY, radius) {
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
  
  function collectPsdForeignVisibleDepthSupport(imageWidth, imageHeight, centerX, centerY, radius, layerIndex, stableDepthPixels, visibleLayerMap) {
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
  
  function medianOfNumbers(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[(sorted.length - 1) >> 1];
  }
  
  function percentileFromSorted(sorted, percentile) {
    if (!sorted.length) {
      return 0;
    }
    const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * percentile)));
    return sorted[index];
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
  
  function buildVisiblePsdLayerMap(imageWidth, imageHeight, layers) {
    const visibleLayerMap = new Int32Array(imageWidth * imageHeight);
    visibleLayerMap.fill(-1);
  
    for (let layerIndex = layers.length - 1; layerIndex >= 0; layerIndex -= 1) {
      const layer = layers[layerIndex];
      const maskPixels = layer.maskPixels;
  
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
  
  function seedPsdLayerDepthPixels(layer, layerIndex, imageWidth, imageHeight, stableDepthPixels, visibleLayerMap, maskPixels, layers) {
    const depthPixels = new Uint8Array(layer.width * layer.height);
    if (!stableDepthPixels || !visibleLayerMap) {
      return depthPixels;
    }
    const stableSeedMask = buildLayerContourBandMask(maskPixels, layer.width, layer.height, 2);
  
    for (let y = 0; y < layer.height; y += 1) {
      for (let x = 0; x < layer.width; x += 1) {
        const localIndex = y * layer.width + x;
        if (!maskPixels[localIndex]) {
          continue;
        }
        if (stableSeedMask[localIndex]) {
          continue;
        }
  
        const globalX = layer.left + x;
        const globalY = layer.top + y;
        if (globalX < 0 || globalX >= imageWidth || globalY < 0 || globalY >= imageHeight) {
          continue;
        }
  
        const globalIndex = globalY * imageWidth + globalX;
        if (visibleLayerMap[globalIndex] === layerIndex) {
          if (hasUpperLayerMaskNearby(layers, layerIndex, globalX, globalY, 2)) {
            continue;
          }
          depthPixels[localIndex] = stableDepthPixels[globalIndex];
        }
      }
    }
  
    return depthPixels;
  }
  
  function hasUpperLayerMaskNearby(layers, layerIndex, globalX, globalY, radius) {
    for (let upperIndex = layerIndex + 1; upperIndex < layers.length; upperIndex += 1) {
      const layer = layers[upperIndex];
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
          if (layer.maskPixels[localY * layer.width + localX]) {
            return true;
          }
        }
      }
    }
  
    return false;
  }
  
  function buildLayerContourBandMask(maskPixels, width, height, thickness) {
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
  
  function buildPositiveDepthErodeMask(depthPixels, width, height, thickness) {
    const positiveMask = new Uint8Array(depthPixels.length);
    for (let i = 0; i < depthPixels.length; i += 1) {
      positiveMask[i] = depthPixels[i] > 0 ? 1 : 0;
    }
  
    let eroded = positiveMask.slice();
    for (let pass = 0; pass < thickness; pass += 1) {
      eroded = erodeBinaryMask(eroded, width, height);
    }
  
    const removedMask = new Uint8Array(depthPixels.length);
    for (let i = 0; i < positiveMask.length; i += 1) {
      if (positiveMask[i] && !eroded[i]) {
        removedMask[i] = 1;
      }
    }
  
    return removedMask;
  }
  
  function erodePositiveDepthMask(depthPixels, width, height, thickness) {
    let mask = new Uint8Array(depthPixels.length);
    for (let i = 0; i < depthPixels.length; i += 1) {
      mask[i] = depthPixels[i] > 0 ? 1 : 0;
    }
  
    for (let pass = 0; pass < thickness; pass += 1) {
      mask = erodeBinaryMask(mask, width, height);
    }
  
    return mask;
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
  
  function inpaintMaskedLayerDepth(sourceDepthPixels, maskPixels, width, height) {
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
  
  function smoothMaskedPositiveDepth(sourceDepthPixels, maskPixels, width, height) {
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
  
  function smoothSegmentedPositiveDepth(sourceDepthPixels, segmentMap, width, height, passes) {
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
  
    for (let pass = 0; pass < passes; pass += 1) {
      const output = input.slice();
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = y * width + x;
          const centerDepth = input[index];
          const centerSegment = segmentMap[index];
          if (centerDepth <= 0 || centerSegment < 0) {
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
            if (segmentMap[sampleIndex] !== centerSegment) {
              continue;
            }
  
            const sampleDepth = input[sampleIndex];
            if (sampleDepth <= 0) {
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
    const robustDepth = clamp(Math.round(planeDepth * 0.7 + medianDepth * 0.3), lo, hi);
  
    return {
      valid: true,
      depth: robustDepth,
      confidence: clamp(values.length / 9, 0, 1),
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
        const targetX = clamp(Math.round(x0 + gx * radius), 0, width - 1);
        const targetY = clamp(Math.round(y0 + gy * radius), 0, height - 1);
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
  
  function sampleMaskedNeighborDepth(depthPixels, maskPixels, width, height, index) {
    const x = index % width;
    const y = Math.floor(index / width);
    const offsets = [
      [-1, 0, 1],
      [1, 0, 1],
      [0, -1, 1],
      [0, 1, 1],
      [-1, -1, Math.SQRT2],
      [1, -1, Math.SQRT2],
      [-1, 1, Math.SQRT2],
      [1, 1, Math.SQRT2],
    ];
  
    let weightedSum = 0;
    let totalWeight = 0;
  
    for (let i = 0; i < offsets.length; i += 1) {
      const [dx, dy, distance] = offsets[i];
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
        continue;
      }
      const sampleIndex = sy * width + sx;
      if (!maskPixels[sampleIndex] || depthPixels[sampleIndex] <= 0) {
        continue;
      }
      const weight = 1 / distance;
      weightedSum += depthPixels[sampleIndex] * weight;
      totalWeight += weight;
    }
  
    return totalWeight > 0 ? Math.max(1, Math.min(255, Math.round(weightedSum / totalWeight))) : 0;
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
  
  function flattenPsdLayers(layers, output = []) {
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[i];
      if (layer.hidden) {
        continue;
      }
  
      if (layer.children && layer.children.length) {
        flattenPsdLayers(layer.children, output);
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
  }
  
  function extractDepthPixelsFromCanvas(canvas, options = {}) {
    const ignoreAlpha = !!options.ignoreAlpha;
    const minAlpha = options.minAlpha == null ? (ignoreAlpha ? 0 : 1) : options.minAlpha;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = new Uint8Array(canvas.width * canvas.height);
  
    for (let i = 0, p = 0; i < imageData.data.length; i += 4, p += 1) {
      const alpha = imageData.data[i + 3];
      if (alpha < minAlpha || (!ignoreAlpha && alpha === 0)) {
        pixels[p] = 0;
        continue;
      }
      pixels[p] = imageData.data[i];
    }
  
    return pixels;
  }
  
  function sampleDepthPixelsToTargetLayer(depthImageData, depthLayer, targetLayer, options = {}) {
    const ignoreAlpha = !!options.ignoreAlpha;
    const minAlpha = options.minAlpha == null ? (ignoreAlpha ? 0 : 1) : options.minAlpha;
    const targetWidth = targetLayer.width || (targetLayer.canvas ? targetLayer.canvas.width : 0);
    const targetHeight = targetLayer.height || (targetLayer.canvas ? targetLayer.canvas.height : 0);
    const sourceWidth = depthImageData.width;
    const sourceHeight = depthImageData.height;
    const pixels = new Uint8Array(targetWidth * targetHeight);
    const sourceLeft = depthLayer.left || 0;
    const sourceTop = depthLayer.top || 0;
    const sourceLayerWidth = depthLayer.width || sourceWidth;
    const sourceLayerHeight = depthLayer.height || sourceHeight;
    const targetLeft = targetLayer.left || 0;
    const targetTop = targetLayer.top || 0;
  
    for (let y = 0; y < targetHeight; y += 1) {
      for (let x = 0; x < targetWidth; x += 1) {
        const globalX = targetLeft + x + 0.5;
        const globalY = targetTop + y + 0.5;
        const sourceLocalX = globalX - sourceLeft;
        const sourceLocalY = globalY - sourceTop;
        if (
          sourceLocalX < 0 ||
          sourceLocalY < 0 ||
          sourceLocalX >= sourceLayerWidth ||
          sourceLocalY >= sourceLayerHeight
        ) {
          continue;
        }
        const sx = clamp(
          Math.round((sourceLocalX * sourceWidth) / Math.max(1, sourceLayerWidth) - 0.5),
          0,
          sourceWidth - 1,
        );
        const sy = clamp(
          Math.round((sourceLocalY * sourceHeight) / Math.max(1, sourceLayerHeight) - 0.5),
          0,
          sourceHeight - 1,
        );
        const srcIndex = (sy * sourceWidth + sx) * 4;
        const alpha = depthImageData.data[srcIndex + 3];
        if (alpha < minAlpha || (!ignoreAlpha && alpha === 0)) {
          continue;
        }
        pixels[y * targetWidth + x] = depthImageData.data[srcIndex];
      }
    }
  
    return pixels;
  }
  
  function sampleLayerRgbaToTargetLayer(imageData, sourceLayer, targetLayer) {
    const targetWidth = targetLayer.width || (targetLayer.canvas ? targetLayer.canvas.width : 0);
    const targetHeight = targetLayer.height || (targetLayer.canvas ? targetLayer.canvas.height : 0);
    const sourceWidth = imageData.width;
    const sourceHeight = imageData.height;
    const sampled = new Uint8ClampedArray(targetWidth * targetHeight * 4);
    const sourceLeft = sourceLayer.left || 0;
    const sourceTop = sourceLayer.top || 0;
    const sourceLayerWidth = sourceLayer.width || sourceWidth;
    const sourceLayerHeight = sourceLayer.height || sourceHeight;
    const targetLeft = targetLayer.left || 0;
    const targetTop = targetLayer.top || 0;
  
    for (let y = 0; y < targetHeight; y += 1) {
      for (let x = 0; x < targetWidth; x += 1) {
        const globalX = targetLeft + x + 0.5;
        const globalY = targetTop + y + 0.5;
        const sourceLocalX = globalX - sourceLeft;
        const sourceLocalY = globalY - sourceTop;
        if (
          sourceLocalX < 0 ||
          sourceLocalY < 0 ||
          sourceLocalX >= sourceLayerWidth ||
          sourceLocalY >= sourceLayerHeight
        ) {
          continue;
        }
        const sx = clamp(
          Math.round((sourceLocalX * sourceWidth) / Math.max(1, sourceLayerWidth) - 0.5),
          0,
          sourceWidth - 1,
        );
        const sy = clamp(
          Math.round((sourceLocalY * sourceHeight) / Math.max(1, sourceLayerHeight) - 0.5),
          0,
          sourceHeight - 1,
        );
        const srcIndex = (sy * sourceWidth + sx) * 4;
        const dstIndex = (y * targetWidth + x) * 4;
        sampled[dstIndex] = imageData.data[srcIndex];
        sampled[dstIndex + 1] = imageData.data[srcIndex + 1];
        sampled[dstIndex + 2] = imageData.data[srcIndex + 2];
        sampled[dstIndex + 3] = imageData.data[srcIndex + 3];
      }
    }
  
    return sampled;
  }
  
  function repairDirectDepthEdgePixels(sourceDepthPixels, rgbaPixels, maskPixels, width, height) {
    const depthPixels = sourceDepthPixels.slice();
    const targetMask = new Uint8Array(depthPixels.length);
    const queue = new Int32Array(depthPixels.length);
    const queued = new Uint8Array(depthPixels.length);
    let head = 0;
    let tail = 0;
  
    for (let i = 0; i < depthPixels.length; i += 1) {
      if (!maskPixels[i]) {
        depthPixels[i] = 0;
        continue;
      }
      const alpha = rgbaPixels[i * 4 + 3];
      if (alpha < 254) {
        targetMask[i] = 1;
        depthPixels[i] = 0;
      }
    }
  
    for (let i = 0; i < depthPixels.length; i += 1) {
      if (!targetMask[i] || depthPixels[i] > 0) {
        continue;
      }
      if (sampleMaskedMedianDepth(depthPixels, maskPixels, width, height, i) > 0) {
        queue[tail++] = i;
        queued[i] = 1;
      }
    }
  
    while (head < tail) {
      const index = queue[head++];
      const fillDepth = sampleMaskedMedianDepth(depthPixels, maskPixels, width, height, index);
      if (fillDepth <= 0) {
        continue;
      }
      depthPixels[index] = fillDepth;
      tail = enqueueMaskedGapNeighbors(queue, queued, depthPixels, targetMask, width, height, index, tail);
    }
  
    return depthPixels;
  }
  
  function sampleMaskedMedianDepth(depthPixels, maskPixels, width, height, index) {
    const x = index % width;
    const y = Math.floor(index / width);
    const values = [];
  
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }
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
    }
  
    return values.length ? medianOfNumbers(values) : 0;
  }
  
  function createCanvasFromImageData(imageData) {
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.putImageData(imageData, 0, 0);
    return canvas;
  }

  return {
    createPsdLayerEntries,
    pruneOutlierSeedDepthClusters,
    createPsdDebugTexture,
    createPsdDepthPreviewUrl,
    medianOfNumbers,
    clampByte,
    buildLayerContourBandMask,
    createCanvasFromImageData,
    flattenPsdLayers,
    getCanvasImageData,
  };
}
