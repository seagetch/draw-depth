import {
  flattenCompositeLayers,
  getCanvasImageData as getCompositeCanvasImageData,
} from "../composite/colorSources.js";
import {
  buildLayerContourBandMask as buildLayerContourBandMaskGeneric,
} from "../composite/depthCleanup.js";
import {
  computeMaskedDepthStats as computeMaskedDepthStatsGeneric,
  writeDepthDebugStats as writeDepthDebugStatsGeneric,
} from "../composite/debugStats.js";
import { getLayerOutlierPruneEnabled } from "../composite/schema.js";
import {
  buildLayerLookup,
  takeMatchedLayer,
} from "../composite/layerMatch.js";
import { runCompositeWorker } from "../workers/compositeWorkerClient.js?v=20260627_1";

export function createPsdLayers(deps) {
  const {
    THREE,
    createMaskedGridDepthPixels,
    createDepthTextureResources,
    createBinaryMaskTexture,
    clamp,
    renderState,
    elements,
  } = deps
  const {
    depthDiscontinuityEl,
    contourRepairEl,
    depthModeEl,
    statusEl,
    gridSpecModeEl,
    gridXEl,
    gridYEl,
    kernelSizeEl,
    interpModeEl,
  } = elements
  const surfaceAlphaMin = 255;

  function flattenPsdLayers(layers, output = []) {
    return flattenCompositeLayers(layers, output);
  }

  async function createLayerEntries(source, options = {}) {
    const emitProgress = typeof options.onProgress === "function"
      ? options.onProgress
      : () => {};
    const composedSource = source?.colorSource && source?.depthSource ? source : null;
    const colorPsd = composedSource?.colorSource?.document || options.colorDocument || source;
    const depthPsd = composedSource?.depthSource?.format === "psd"
      ? composedSource.depthSource.document
      : options.depthDocument || null;
    const stableDepthPixels = composedSource?.depthSource?.format === "psd"
      ? null
      : (composedSource?.depthSource?.layers?.[0]?.pixels || options.stableDepthPixels || null);
    const colorLayers = flattenPsdLayers(colorPsd.children || []);
    const depthLayers = depthPsd ? flattenPsdLayers(depthPsd.children || []) : null;
    const depthLayerLookup = depthLayers ? buildLayerLookup(depthLayers) : null;
    if (!depthPsd && !stableDepthPixels) {
      throw new Error("Midori-depth-st.png could not be loaded.");
    }
  
    const layerSources = [];
    const depthDebugStats = [];
  
    for (let i = 0; i < colorLayers.length; i += 1) {
      const colorLayer = colorLayers[i];
      emitProgress({
        stage: "read-layers",
        current: i,
        total: colorLayers.length,
        layerIndex: i,
        layerName: colorLayer?.name || "",
        message: "reading layer pixels",
      });
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
      const strictSurfaceMaskPixels = extractLayerMaskPixels(colorImageData.data, surfaceAlphaMin);
      const colorSurfaceMaskPixels = hasAnyMaskPixel(strictSurfaceMaskPixels)
        ? strictSurfaceMaskPixels
        : colorMaskPixels;
      const depthLayer = depthLayerLookup
        ? takeMatchedLayer(depthLayerLookup, colorLayer, i)
        : (depthLayers && depthLayers[i] ? depthLayers[i] : null);
      const depthImageData = depthLayer
        ? getCanvasImageData(depthLayer.canvas)
        : null;
      const rawDepthPixels = depthImageData
        ? sampleDepthPixelsToTargetLayer(
          depthImageData,
          depthLayer,
          colorLayer,
          {
            ignoreAlpha: false,
            minAlpha: 1,
          },
        )
        : (depthPsd ? null : null);
      if (depthPsd && !rawDepthPixels) {
        console.warn("[depth-draw] Missing matching PSD depth layer", {
          colorLayer: colorLayer.name || `Layer ${i + 1}`,
          left: colorLayer.left,
          top: colorLayer.top,
          width: colorLayer.width,
          height: colorLayer.height,
        });
      }
      const depthPixels = rawDepthPixels;
      const maskPixels = colorMaskPixels;
      if (depthPsd) {
        depthDebugStats.push({
          name: colorLayer.name || `Layer ${i + 1}`,
          depthLayerName: depthLayer ? depthLayer.name : "",
          depthLayerLeft: depthLayer ? depthLayer.left : null,
          depthLayerTop: depthLayer ? depthLayer.top : null,
          depthLayerWidth: depthLayer ? depthLayer.width : null,
          depthLayerHeight: depthLayer ? depthLayer.height : null,
          source: depthImageData ? "matched-black-composited-depth-layer" : "empty",
          left: colorLayer.left,
          top: colorLayer.top,
          ...computeMaskedDepthStats(
            depthPixels || new Uint8Array(colorLayer.width * colorLayer.height),
            maskPixels,
            colorLayer.width,
            colorLayer.height,
          ),
        });
      }
      const depthAlphaPreview = depthImageData
        ? createDepthAlphaLeakPreviewUrl(depthImageData.width, depthImageData.height, depthImageData.data)
        : null;
      const colorAlphaPreview = createColorAlphaPreviewUrl(
        colorLayer.width,
        colorLayer.height,
        colorImageData.data,
      );
  
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
        surfaceMaskPixels: colorSurfaceMaskPixels,
        depthImageData,
        colorAlphaPreviewUrl: colorAlphaPreview.url,
        colorLowAlphaPixels: colorAlphaPreview.lowAlphaCount,
        depthAlphaPreviewUrl: depthAlphaPreview ? depthAlphaPreview.url : "",
        depthAlphaLeakPixels: depthAlphaPreview ? depthAlphaPreview.count : 0,
        directDepthPixels: depthPixels,
        depthMaskPixels: maskPixels,
      });
      emitProgress({
        stage: "read-layers",
        current: i + 1,
        total: colorLayers.length,
        layerIndex: i,
        layerName: colorLayer?.name || "",
        message: "layer pixels ready",
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
      : await buildVisiblePsdLayerMap(
        colorPsd.width,
        colorPsd.height,
        mergedLayerSources,
      );
    const pendingLayers = [];
    const entries = [];
  
    for (let i = 0; i < mergedLayerSources.length; i += 1) {
      const layer = mergedLayerSources[i];
      emitProgress({
        stage: "layer-depth",
        current: i,
        total: mergedLayerSources.length,
        layerIndex: i,
        layerName: layer?.name || "",
        message: "preparing layer depth",
      });
      if (statusEl) {
        statusEl.textContent = `PSD layer processing: ${i + 1}/${mergedLayerSources.length} ${layer.name || ""}`;
      }
      const maskPixels = extractLayerMaskPixels(layer.colorImageData.data);
      const surfaceMaskPixels = hasAnyMaskPixel(layer.surfaceMaskPixels)
        ? layer.surfaceMaskPixels
        : maskPixels;
      if (depthPsd) {
        const rawDepthPixels = (layer.directDepthPixels || new Uint8Array(layer.width * layer.height)).slice();
        const pruneResult = {
          pixels: rawDepthPixels,
          debugState: new Uint8Array(rawDepthPixels.length),
          debugScore: new Uint8Array(rawDepthPixels.length),
        };
        if (contourRepairEl.checked) {
          emitProgress({
            stage: "depth-cleanup",
            current: i,
            total: mergedLayerSources.length,
            layerIndex: i,
            layerName: layer?.name || "",
            message: "building contour mask",
          });
          const contourBandMask = await buildLayerContourBandMask(maskPixels, layer.width, layer.height, 2);
          for (let p = 0; p < rawDepthPixels.length; p += 1) {
            if (contourBandMask[p]) {
              rawDepthPixels[p] = 0;
              pruneResult.debugState[p] = 5;
            }
          }
        }
        emitProgress({
          stage: "depth-cleanup",
          current: i,
          total: mergedLayerSources.length,
          layerIndex: i,
          layerName: layer?.name || "",
          message: "eroding positive depth",
        });
        const erodedPositiveMask = await erodePositiveDepthMask(rawDepthPixels, layer.width, layer.height, 1);
        let removedDepthPixels = 0;
        for (let p = 0; p < rawDepthPixels.length; p += 1) {
          if (maskPixels[p] && rawDepthPixels[p] > 0 && !erodedPositiveMask[p]) {
            rawDepthPixels[p] = 0;
            pruneResult.debugState[p] = 5;
            removedDepthPixels += 1;
          }
        }
        emitProgress({
          stage: "depth-cleanup",
          current: i,
          total: mergedLayerSources.length,
          layerIndex: i,
          layerName: layer?.name || "",
          message: "inpainting layer depth",
        });
        const inpaintResult = await inpaintMaskedLayerDepth(rawDepthPixels, maskPixels, layer.width, layer.height);
        pendingLayers.push({
          layer,
          hasDirectDepth: true,
          maskPixels,
          surfaceMaskPixels,
          pruneResult,
          removedDepthPixels,
          inpaintFilledMask: inpaintResult.filledMask,
          inpaintedDepthPixels: inpaintResult.pixels,
        });
        emitProgress({
          stage: "layer-depth",
          current: i + 1,
          total: mergedLayerSources.length,
          layerIndex: i,
          layerName: layer?.name || "",
          message: "layer depth ready",
        });
        continue;
      }
  
      emitProgress({
        stage: "depth-split",
        current: i,
        total: mergedLayerSources.length,
        layerIndex: i,
        layerName: layer?.name || "",
        message: "seeding layer depth",
      });
      const seededDepthPixels = await seedPsdLayerDepthPixels(
        layer,
        i,
        colorPsd.width,
        colorPsd.height,
        stableDepthPixels,
        visibleLayerMap,
        maskPixels,
        mergedLayerSources,
      );
      emitProgress({
        stage: "depth-prune",
        current: i,
        total: mergedLayerSources.length,
        layerIndex: i,
        layerName: layer?.name || "",
        message: "pruning foreign depth",
      });
      const pruneResult = await prunePsdForeignDepthSeeds(
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
        emitProgress({
          stage: "depth-cleanup",
          current: i,
          total: mergedLayerSources.length,
          layerIndex: i,
          layerName: layer?.name || "",
          message: "building contour mask",
        });
        const contourBandMask = await buildLayerContourBandMask(maskPixels, layer.width, layer.height, 2);
        for (let p = 0; p < depthPixels.length; p += 1) {
          if (contourBandMask[p]) {
            depthPixels[p] = 0;
            pruneResult.debugState[p] = 5;
          }
        }
      }
  
      emitProgress({
        stage: "depth-cleanup",
        current: i,
        total: mergedLayerSources.length,
        layerIndex: i,
        layerName: layer?.name || "",
        message: "eroding positive depth",
      });
      const erodedPositiveMask = await erodePositiveDepthMask(depthPixels, layer.width, layer.height, 1);
      let removedDepthPixels = 0;
      for (let p = 0; p < depthPixels.length; p += 1) {
        if (maskPixels[p] && depthPixels[p] > 0 && !erodedPositiveMask[p]) {
          depthPixels[p] = 0;
          pruneResult.debugState[p] = 5;
          removedDepthPixels += 1;
        }
      }
  
      if (getLayerOutlierPruneEnabled(composedSource, i)) {
        emitProgress({
          stage: "depth-prune",
          current: i,
          total: mergedLayerSources.length,
          layerIndex: i,
          layerName: layer?.name || "",
          message: "pruning outlier clusters",
        });
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
  
      emitProgress({
        stage: "depth-cleanup",
        current: i,
        total: mergedLayerSources.length,
        layerIndex: i,
        layerName: layer?.name || "",
        message: "inpainting layer depth",
      });
      const inpaintResult = await inpaintMaskedLayerDepth(depthPixels, maskPixels, layer.width, layer.height);
      pendingLayers.push({
        layer,
        maskPixels,
        pruneResult,
        removedDepthPixels,
        inpaintFilledMask: inpaintResult.filledMask,
        inpaintedDepthPixels: inpaintResult.pixels,
      });
      emitProgress({
        stage: "layer-depth",
        current: i + 1,
        total: mergedLayerSources.length,
        layerIndex: i,
        layerName: layer?.name || "",
        message: "layer depth ready",
      });
    }
  
    if (!depthPsd) {
      applyPsdSymmetryToPendingLayers(pendingLayers);
    }
  
    for (let i = 0; i < pendingLayers.length; i += 1) {
      const pending = pendingLayers[i];
      const { layer, maskPixels, pruneResult } = pending;
      emitProgress({
        stage: "finalize-layers",
        current: i,
        total: pendingLayers.length,
        layerIndex: i,
        layerName: layer?.name || "",
        message: "building layer textures",
      });
      const surfaceMaskPixels = pending.surfaceMaskPixels || maskPixels;
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
        renderDepthMask[p] = surfaceMaskPixels[p] && finalDepthPixels[p] > 0 ? 1 : 0;
      }
      const depthTexture = createDepthTextureResources(
        layer.width,
        layer.height,
        finalDepthPixels,
      ).texture;
      const maskTexture = createBinaryMaskTexture(layer.width, layer.height, renderDepthMask);
      const debugTexture = createPsdDebugTexture(layer.width, layer.height, maskPixels, pruneResult.debugState, pruneResult.debugScore);
      const thinSurfacePreview = createThinSurfacePreviewUrl(
        layer.width,
        layer.height,
        layer.colorImageData.data,
        maskPixels,
        surfaceMaskPixels,
      );
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
        sourceIndex: layer.sourceIndices?.[0] ?? layer.sourceIndex,
        sourceIndices: layer.sourceIndices ? layer.sourceIndices.slice() : [layer.sourceIndex],
        left: layer.left,
        top: layer.top,
        width: layer.width,
        height: layer.height,
        colorImageData: layer.colorImageData,
        colorTexture: layer.colorTexture,
        depthTexture,
        maskTexture,
        debugTexture: debugTexture.texture,
        debugPreviewUrl: debugTexture.url,
        thinSurfacePreviewUrl: thinSurfacePreview.url,
        thinSurfacePixels: thinSurfacePreview.count,
        colorAlphaPreviewUrl: layer.colorAlphaPreviewUrl || "",
        colorLowAlphaPixels: layer.colorLowAlphaPixels || 0,
        depthAlphaPreviewUrl: layer.depthAlphaPreviewUrl || "",
        depthAlphaLeakPixels: layer.depthAlphaLeakPixels || 0,
        depthPreviewUrl,
        inpaintFilledMask: pending.inpaintFilledMask,
        depthModeSourcePixels: smoothedDepthPixels.slice(),
        directDepthPixels: layer.directDepthPixels ? layer.directDepthPixels.slice() : smoothedDepthPixels.slice(),
        baseDepthPixels: finalDepthPixels.slice(),
        depthPixels: finalDepthPixels,
        renderDepthMask,
        hasDirectDepth: !!pending.hasDirectDepth,
        maskPixels,
        surfaceMaskPixels,
        removedDepthPixels: pending.removedDepthPixels,
        visible: true,
      });
      emitProgress({
        stage: "finalize-layers",
        current: i + 1,
        total: pendingLayers.length,
        layerIndex: i,
        layerName: layer?.name || "",
        message: "layer textures ready",
      });
    }

    if (depthPsd) {
      writeDepthDebugStats({
        image: {
          width: colorPsd.width,
          height: colorPsd.height,
        },
        globalDepth: stableDepthPixels
          ? computeMaskedDepthStats(stableDepthPixels, null, colorPsd.width, colorPsd.height)
          : null,
        sourceLayers: depthDebugStats,
        finalLayers: entries.map((layer) => ({
          name: layer.name,
          left: layer.left,
          top: layer.top,
          ...computeMaskedDepthStats(layer.depthPixels, layer.renderDepthMask, layer.width, layer.height),
        })),
      });
    }

    return entries;
  }

  function computeBinaryMaskBounds(maskPixels, width, height) {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!maskPixels[y * width + x]) {
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
      right: maxX,
      bottom: maxY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
  }

  function computeMaskedDepthStats(depthPixels, maskPixels, width, height) {
    return computeMaskedDepthStatsGeneric(depthPixels, maskPixels, width, height);
  }

  function writeDepthDebugStats(payload) {
    writeDepthDebugStatsGeneric(payload);
  }

  function pruneOutlierSeedDepthClusters(depthPixels, debugState, debugScore, maskPixels, width, height, threshold) {
    const totalPixels = width * height;
    const visited = new Uint8Array(totalPixels);
    const queue = new Int32Array(totalPixels);
    const components = [];
    const linkThreshold = Math.max(6, threshold * 0.2);
    const contourMask = buildLayerContourBandMaskGeneric(maskPixels, width, height, 1);
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

  function createThinSurfacePreviewUrl(width, height, rgbaPixels, maskPixels, surfaceMaskPixels) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = context.createImageData(width, height);
    let count = 0;
    for (let pixelIndex = 0; pixelIndex < maskPixels.length; pixelIndex += 1) {
      const out = pixelIndex * 4;
      const alpha = rgbaPixels[out + 3];
      if (maskPixels[pixelIndex] && !surfaceMaskPixels[pixelIndex]) {
        imageData.data[out] = 255;
        imageData.data[out + 1] = Math.max(32, alpha);
        imageData.data[out + 2] = 255;
        imageData.data[out + 3] = 255;
        count += 1;
      } else if (surfaceMaskPixels[pixelIndex]) {
        imageData.data[out] = 16;
        imageData.data[out + 1] = 96;
        imageData.data[out + 2] = 48;
        imageData.data[out + 3] = 192;
      } else {
        imageData.data[out] = 0;
        imageData.data[out + 1] = 0;
        imageData.data[out + 2] = 0;
        imageData.data[out + 3] = 255;
      }
    }
    context.putImageData(imageData, 0, 0);
    return {
      count,
      url: canvas.toDataURL("image/png"),
    };
  }

  function createColorAlphaPreviewUrl(width, height, rgbaPixels) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = context.createImageData(width, height);
    let lowAlphaCount = 0;
    let opaqueCount = 0;
    for (let pixelIndex = 0; pixelIndex < rgbaPixels.length >> 2; pixelIndex += 1) {
      const out = pixelIndex * 4;
      const alpha = rgbaPixels[out + 3];
      if (alpha === 0) {
        imageData.data[out] = 0;
        imageData.data[out + 1] = 0;
        imageData.data[out + 2] = 0;
      } else if (alpha < 255) {
        imageData.data[out] = 255;
        imageData.data[out + 1] = Math.max(24, alpha);
        imageData.data[out + 2] = 0;
        lowAlphaCount += 1;
      } else {
        imageData.data[out] = 16;
        imageData.data[out + 1] = 110;
        imageData.data[out + 2] = 64;
        opaqueCount += 1;
      }
      imageData.data[out + 3] = 255;
    }
    context.putImageData(imageData, 0, 0);
    return {
      lowAlphaCount,
      opaqueCount,
      url: canvas.toDataURL("image/png"),
    };
  }

  function createDepthAlphaLeakPreviewUrl(width, height, rgbaPixels) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = context.createImageData(width, height);
    let count = 0;
    for (let pixelIndex = 0; pixelIndex < rgbaPixels.length >> 2; pixelIndex += 1) {
      const out = pixelIndex * 4;
      const depth = rgbaPixels[out];
      const alpha = rgbaPixels[out + 3];
      if (alpha !== 255) {
        imageData.data[out] = 255;
        imageData.data[out + 1] = 0;
        imageData.data[out + 2] = 0;
        imageData.data[out + 3] = 255;
        count += 1;
      } else {
        imageData.data[out] = depth;
        imageData.data[out + 1] = depth;
        imageData.data[out + 2] = depth;
        imageData.data[out + 3] = 255;
      }
    }
    context.putImageData(imageData, 0, 0);
    return {
      count,
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
        imageData.data[imageIndex] = 0;
        imageData.data[imageIndex + 1] = 0;
        imageData.data[imageIndex + 2] = 0;
        imageData.data[imageIndex + 3] = 255;
        continue;
      }

      const depth = depthPixels[pixelIndex];
      if (filledMask && filledMask[pixelIndex]) {
        imageData.data[imageIndex] = 0;
        imageData.data[imageIndex + 1] = depth;
        imageData.data[imageIndex + 2] = depth;
      } else {
        imageData.data[imageIndex] = depth;
        imageData.data[imageIndex + 1] = depth;
        imageData.data[imageIndex + 2] = depth;
      }
      imageData.data[imageIndex + 3] = 255;
    }

    context.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  }
  
  function getCanvasImageData(canvas) {
    return getCompositeCanvasImageData(canvas);
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
    const strictSurfaceMaskPixels = extractLayerMaskPixels(targetLayer.colorImageData.data, surfaceAlphaMin);
    targetLayer.surfaceMaskPixels = hasAnyMaskPixel(strictSurfaceMaskPixels)
      ? strictSurfaceMaskPixels
      : targetLayer.maskPixels;
    if (mergeDepth && targetLayer.depthImageData) {
      targetLayer.directDepthPixels = extractDepthPixelsFromCanvas(createCanvasFromImageData(targetLayer.depthImageData));
      targetLayer.depthMaskPixels = extractLayerMaskPixels(targetLayer.depthImageData.data);
    } else if (!targetLayer.depthMaskPixels) {
      targetLayer.depthMaskPixels = targetLayer.maskPixels;
    }
  }
  
  function extractLayerMaskPixels(rgbaPixels, minAlpha = 1) {
    const maskPixels = new Uint8Array(rgbaPixels.length >> 2);
    for (let i = 0, p = 0; i < rgbaPixels.length; i += 4, p += 1) {
      maskPixels[p] = rgbaPixels[i + 3] >= minAlpha ? 1 : 0;
    }
    return maskPixels;
  }

  function hasAnyMaskPixel(maskPixels) {
    if (!maskPixels) {
      return false;
    }
    for (let i = 0; i < maskPixels.length; i += 1) {
      if (maskPixels[i]) {
        return true;
      }
    }
    return false;
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
    return runCompositeWorker("depthPrune", {
      depthPixels: sourceDepthPixels,
      layer: serializePsdWorkerLayer(layer),
      layerIndex,
      imageWidth,
      imageHeight,
      stableDepthPixels,
      visibleLayerMap,
      maskPixels,
      threshold,
    });
  }
  
  function clampByte(value) {
    return Math.max(0, Math.min(255, value));
  }
  
  function medianOfNumbers(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[(sorted.length - 1) >> 1];
  }
  
  function buildVisiblePsdLayerMap(imageWidth, imageHeight, layers) {
    return runCompositeWorker("depthSplit", {
      operation: "buildVisibleLayerMap",
      args: { imageWidth, imageHeight, layers: serializePsdWorkerLayers(layers) },
    });
  }
  
  async function seedPsdLayerDepthPixels(layer, layerIndex, imageWidth, imageHeight, stableDepthPixels, visibleLayerMap, maskPixels, layers) {
    const stableSeedMask = await buildLayerContourBandMask(maskPixels, layer.width, layer.height, 2);
    return runCompositeWorker("depthSplit", {
      operation: "seedLayerDepthPixels",
      args: {
        layer: serializePsdWorkerLayer(layer),
      layerIndex,
      imageWidth,
      imageHeight,
      stableDepthPixels,
      visibleLayerMap,
      maskPixels,
        layers: serializePsdWorkerLayers(layers),
        options: { contourBandMask: stableSeedMask, upperMaskRadius: 2 },
      },
    });
  }
  
  function hasUpperLayerMaskNearby(layers, layerIndex, globalX, globalY, radius) {
    return runCompositeWorker("depthSplit", {
      operation: "hasUpperLayerMaskNearby",
      args: { layers: serializePsdWorkerLayers(layers), layerIndex, globalX, globalY, radius },
    });
  }
  
  function buildLayerContourBandMask(maskPixels, width, height, thickness) {
    return runCompositeWorker("depthCleanup", {
      operation: "buildLayerContourBandMask",
      args: { maskPixels, width, height, thickness },
    });
  }
  
  function erodePositiveDepthMask(depthPixels, width, height, thickness) {
    return runCompositeWorker("depthCleanup", {
      operation: "erodePositiveDepthMask",
      args: { depthPixels, width, height, thickness },
    });
  }
  
  function inpaintMaskedLayerDepth(sourceDepthPixels, maskPixels, width, height) {
    return runCompositeWorker("depthCleanup", {
      operation: "inpaintMaskedLayerDepth",
      args: { sourceDepthPixels, maskPixels, width, height },
    });
  }
  
  function smoothMaskedPositiveDepth(sourceDepthPixels, maskPixels, width, height) {
    return runCompositeWorker("depthCleanup", {
      operation: "smoothMaskedPositiveDepth",
      args: { sourceDepthPixels, maskPixels, width, height },
    });
  }

  function serializePsdWorkerLayer(layer) {
    return {
      name: layer.name || "",
      sourceIndex: layer.sourceIndex,
      sourceIndices: layer.sourceIndices ? layer.sourceIndices.slice() : undefined,
      left: layer.left || 0,
      top: layer.top || 0,
      width: layer.width || 0,
      height: layer.height || 0,
      maskPixels: layer.maskPixels ? layer.maskPixels.slice() : null,
      alphaMask: layer.alphaMask ? layer.alphaMask.slice() : null,
    };
  }

  function serializePsdWorkerLayers(layers) {
    return (layers || []).map(serializePsdWorkerLayer);
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
  
  
  function extractDepthPixelsFromCanvas(canvas, options = {}) {
    const ignoreAlpha = !!options.ignoreAlpha;
    const minAlpha = options.minAlpha == null ? (ignoreAlpha ? 0 : 1) : options.minAlpha;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = new Uint8Array(canvas.width * canvas.height);
  
    for (let i = 0, p = 0; i < imageData.data.length; i += 4, p += 1) {
      if (!ignoreAlpha && imageData.data[i + 3] < minAlpha) {
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
        if (!ignoreAlpha && depthImageData.data[srcIndex + 3] < minAlpha) {
          continue;
        }
        pixels[y * targetWidth + x] = depthImageData.data[srcIndex];
      }
    }
  
    return pixels;
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
    createLayerEntries,
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
