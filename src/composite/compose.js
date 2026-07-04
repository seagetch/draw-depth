import { assertCompositeDimensions, createComposedSource, createMaskFromDepthPixels } from "./schema.js";
import { buildLayerLookup, takeMatchedLayer } from "./layerMatch.js";
import { sampleDepthLayerToColorLayer, splitFlatDepthByColorLayers } from "./depthSplit.js";

export function composeLayeredSource(colorComposite, depthComposite, options = {}) {
  assertCompositeDimensions(colorComposite, "ColorComposite");
  assertCompositeDimensions(depthComposite, "DepthComposite");

  if (colorComposite.width !== depthComposite.width || colorComposite.height !== depthComposite.height) {
    throw new Error("Color and depth composite sizes do not match.");
  }

  const colorCount = colorComposite.layers.length;
  const depthCount = depthComposite.layers.length;
  const diagnostics = [];

  if (colorCount === 1 && depthCount === 1) {
    return createComposedSource({
      width: colorComposite.width,
      height: colorComposite.height,
      mode: "1:1",
      colorSource: colorComposite,
      depthSource: depthComposite,
      layers: [composeDirectLayer(colorComposite.layers[0], depthComposite.layers[0], 0)],
      diagnostics,
    });
  }

  if (colorCount > 1 && depthCount === 1) {
    const layers = splitFlatDepthByColorLayers(colorComposite, depthComposite.layers[0], options);
    return createComposedSource({
      width: colorComposite.width,
      height: colorComposite.height,
      mode: "N:1",
      colorSource: colorComposite,
      depthSource: depthComposite,
      layers,
      diagnostics,
    });
  }

  if (colorCount > 1 && depthCount > 1) {
    const lookup = buildLayerLookup(depthComposite.layers);
    const layers = colorComposite.layers.map((colorLayer, index) => {
      const depthLayer = takeMatchedLayer(lookup, colorLayer, index);
      if (!depthLayer) {
        diagnostics.push({
          type: "missing-depth-layer",
          colorLayer: colorLayer.name || `Layer ${index + 1}`,
        });
      }
      return composeDirectLayer(colorLayer, depthLayer, index);
    });
    let unusedDepthLayerCount = 0;
    for (const entries of lookup.values()) {
      unusedDepthLayerCount += entries.length;
    }
    if (unusedDepthLayerCount) {
      diagnostics.push({ type: "unused-depth-layers", count: unusedDepthLayerCount });
    }
    return createComposedSource({
      width: colorComposite.width,
      height: colorComposite.height,
      mode: "N:N",
      colorSource: colorComposite,
      depthSource: depthComposite,
      layers,
      diagnostics,
    });
  }

  throw new Error("A single color layer cannot be composed with multiple depth layers without a split policy.");
}

function composeDirectLayer(colorLayer, depthLayer, index) {
  const depthPixels = depthLayer
    ? sampleDepthLayerToColorLayer(depthLayer, colorLayer)
    : new Uint8Array(colorLayer.width * colorLayer.height);
  const sourceIndices = colorLayer.sourceIndices || [colorLayer.sourceIndex ?? index];
  return {
    id: `composed:${index}`,
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
    directDepthPixels: depthPixels,
    depthPixels,
    depthMaskPixels: colorLayer.alphaMask,
    renderDepthMask: createMaskFromDepthPixels(depthPixels),
    depthLayerName: depthLayer?.name || "",
    hasDirectDepth: !!depthLayer,
  };
}
