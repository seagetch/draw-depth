import { normalizeComposedLayerState } from "./schema.js";

export function attachPreparedLayerEntries(composedSource, preparedEntries) {
  if (!composedSource) {
    return preparedEntries || [];
  }
  const entries = preparedEntries || [];
  composedSource.layers = entries.map((entry, index) => {
    const composedLayer = composedSource.layers[index];
    const nextLayer = {
      ...composedLayer,
      ...entry,
      id: composedLayer?.id || `composed:${index}`,
    };
    if (canCarryPreviousDepthPixels(entry, composedLayer)) {
      carryDepthPixels(nextLayer, composedLayer);
    }
    return normalizeComposedLayerState(nextLayer, index);
  });
  return composedSource.layers;
}

export function applyPreviousBackendState(composedSource, previousLayers = [], previousGlobalDepthScale = 1, depthOverrides = null) {
  if (!composedSource) {
    return composedSource;
  }
  composedSource.globalDepthScale = previousGlobalDepthScale ?? composedSource.globalDepthScale ?? 1;
  composedSource.layers = (composedSource.layers || []).map((layer, index) => {
    const previous = findPreviousLayer(layer, index, previousLayers, depthOverrides);
    const nextLayer = {
      ...layer,
      visible: previous?.visible ?? layer.visible,
      depthOffset: previous?.depthOffset ?? layer.depthOffset,
      depthScale: previous?.depthScale ?? layer.depthScale,
      outlierPruneEnabled: previous?.outlierPruneEnabled ?? layer.outlierPruneEnabled,
      puppetFitEnabled: previous?.puppetFitEnabled ?? layer.puppetFitEnabled,
      puppetBindingOverride: previous?.puppetBindingOverride ?? layer.puppetBindingOverride,
    };
    if (canCarryPreviousDepthPixels(layer, previous)) {
      carryDepthPixels(nextLayer, previous);
    }
    return normalizeComposedLayerState(nextLayer, index);
  });
  return composedSource;
}

function carryDepthPixels(targetLayer, sourceLayer) {
  const sourceBaseDepth = sourceLayer.baseDepthPixels || sourceLayer.depthPixels;
  const sourceModeDepth = sourceLayer.depthModeSourcePixels || sourceLayer.directDepthPixels || sourceBaseDepth;
  targetLayer.depthModeSourcePixels = sourceModeDepth.slice();
  targetLayer.baseDepthPixels = sourceBaseDepth.slice();
  targetLayer.depthPixels = sourceLayer.depthPixels ? sourceLayer.depthPixels.slice() : sourceBaseDepth.slice();
  targetLayer.directDepthPixels = sourceLayer.directDepthPixels ? sourceLayer.directDepthPixels.slice() : sourceModeDepth.slice();
  targetLayer.maskPixels = sourceLayer.maskPixels ? sourceLayer.maskPixels.slice() : targetLayer.maskPixels;
  targetLayer.surfaceMaskPixels = sourceLayer.surfaceMaskPixels ? sourceLayer.surfaceMaskPixels.slice() : targetLayer.maskPixels;
  targetLayer.renderDepthMask = sourceLayer.renderDepthMask ? sourceLayer.renderDepthMask.slice() : targetLayer.maskPixels;
  targetLayer.depthMaskPixels = sourceLayer.depthMaskPixels ? sourceLayer.depthMaskPixels.slice() : targetLayer.maskPixels;
  targetLayer.depthSourceOverridden = true;
}

function canCarryPreviousDepthPixels(layer, previous) {
  if (!previous?.depthSourceOverridden) {
    return false;
  }
  const expectedLength = (layer?.width || 0) * (layer?.height || 0);
  const previousDepth = previous.baseDepthPixels || previous.depthPixels;
  return !!previousDepth && previousDepth.length === expectedLength;
}

function findPreviousLayer(layer, index, previousLayers, depthOverrides) {
  const override = findDepthOverride(layer, index, depthOverrides);
  if (override) {
    return override;
  }
  return findMatchingLayer(layer, index, previousLayers);
}

function findDepthOverride(layer, index, depthOverrides) {
  if (!depthOverrides) {
    return null;
  }
  const candidates = [
    depthOverrides[index],
    layer?.sourceIndices?.length ? depthOverrides[`source:${layer.sourceIndices.join(",")}`] : null,
    layer?.name ? depthOverrides[`name:${layer.name}:${layer.width || 0}x${layer.height || 0}`] : null,
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (canCarryPreviousDepthPixels(layer, candidate)) {
      return candidate;
    }
  }
  return null;
}

function findMatchingLayer(layer, index, previousLayers) {
  const candidates = [
    previousLayers[index],
    ...previousLayers.filter((previous) => layerIdentityKey(previous) === layerIdentityKey(layer)),
    ...previousLayers.filter((previous) => previous.name && previous.name === layer.name),
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (candidate && canCarryPreviousDepthPixels(layer, candidate)) {
      return candidate;
    }
  }
  return null;
}

function layerIdentityKey(layer) {
  if (!layer) {
    return "";
  }
  const sourceKey = layer.sourceIndices?.length
    ? layer.sourceIndices.join(",")
    : (layer.sourceIndex ?? "");
  return `${sourceKey}:${layer.name || ""}:${layer.width || 0}x${layer.height || 0}`;
}

export function mapPreviousLayerState(previousLayers, values, fallbackValue) {
  const previousByName = new Map(
    previousLayers.map((layer, index) => [layer.name, values[index] ?? fallbackValue]),
  );
  return (nextLayers) => nextLayers.map((layer) => previousByName.get(layer.name) ?? fallbackValue);
}
