export function assertCompositeDimensions(composite, label) {
  if (!composite || !Number.isFinite(composite.width) || !Number.isFinite(composite.height)) {
    throw new Error(`${label} is missing valid dimensions.`);
  }
  if (composite.width <= 0 || composite.height <= 0) {
    throw new Error(`${label} has empty dimensions.`);
  }
  if (!Array.isArray(composite.layers)) {
    throw new Error(`${label} is missing layers.`);
  }
}

export function assertLayerPixels(layer, pixelField, label) {
  const pixels = layer?.[pixelField];
  const expectedLength = (layer?.width || 0) * (layer?.height || 0);
  if (!pixels || pixels.length !== expectedLength) {
    throw new Error(`${label} has invalid ${pixelField} length.`);
  }
}

export function createComposedSource({
  width,
  height,
  mode,
  colorSource,
  depthSource,
  layers,
  diagnostics = [],
  globalDepthScale = 1,
  globalDepthCentroid = 0,
}) {
  const composed = {
    width,
    height,
    mode,
    colorSource,
    depthSource,
    globalDepthScale,
    globalDepthCentroid,
    layers: (layers || []).map(normalizeComposedLayerState),
    diagnostics,
  };
  assertCompositeDimensions(composed, "ComposedSource");
  return composed;
}

export function normalizeComposedLayerState(layer, index = 0) {
  return {
    ...layer,
    id: layer?.id || `composed:${index}`,
    visible: layer?.visible ?? true,
    depthOffset: layer?.depthOffset ?? 0,
    depthScale: layer?.depthScale ?? 1,
    outlierPruneEnabled: layer?.outlierPruneEnabled ?? false,
    puppetFitEnabled: layer?.puppetFitEnabled ?? true,
    puppetBindingOverride: layer?.puppetBindingOverride ?? null,
  };
}

export function getComposedSource(renderStateOrSource) {
  return renderStateOrSource?.composedSource || renderStateOrSource || null;
}

export function getComposedLayers(renderStateOrSource) {
  return getComposedSource(renderStateOrSource)?.layers || [];
}

export function getGlobalDepthScale(renderStateOrSource) {
  return getComposedSource(renderStateOrSource)?.globalDepthScale ?? 1;
}

export function setGlobalDepthScale(renderStateOrSource, value) {
  const source = getComposedSource(renderStateOrSource);
  if (source) {
    source.globalDepthScale = Number.isFinite(value) ? value : 1;
  }
}

export function getLayerVisible(renderStateOrSource, index) {
  return getComposedLayers(renderStateOrSource)[index]?.visible !== false;
}

export function setLayerVisible(renderStateOrSource, index, value) {
  const layer = getComposedLayers(renderStateOrSource)[index];
  if (layer) {
    layer.visible = !!value;
  }
}

export function getLayerDepthOffset(renderStateOrSource, index) {
  return getComposedLayers(renderStateOrSource)[index]?.depthOffset ?? 0;
}

export function setLayerDepthOffset(renderStateOrSource, index, value) {
  const layer = getComposedLayers(renderStateOrSource)[index];
  if (layer) {
    layer.depthOffset = Number.isFinite(value) ? value : 0;
  }
}

export function getLayerDepthScale(renderStateOrSource, index) {
  return getComposedLayers(renderStateOrSource)[index]?.depthScale ?? 1;
}

export function setLayerDepthScale(renderStateOrSource, index, value) {
  const layer = getComposedLayers(renderStateOrSource)[index];
  if (layer) {
    layer.depthScale = Number.isFinite(value) ? value : 1;
  }
}

export function getLayerOutlierPruneEnabled(renderStateOrSource, index) {
  return !!getComposedLayers(renderStateOrSource)[index]?.outlierPruneEnabled;
}

export function setLayerOutlierPruneEnabled(renderStateOrSource, index, value) {
  const layer = getComposedLayers(renderStateOrSource)[index];
  if (layer) {
    layer.outlierPruneEnabled = !!value;
  }
}

export function getLayerPuppetFitEnabled(renderStateOrSource, index) {
  return getComposedLayers(renderStateOrSource)[index]?.puppetFitEnabled ?? true;
}

export function setLayerPuppetFitEnabled(renderStateOrSource, index, value) {
  const layer = getComposedLayers(renderStateOrSource)[index];
  if (layer) {
    layer.puppetFitEnabled = !!value;
  }
}

export function getLayerPuppetBindingOverride(renderStateOrSource, index) {
  return getComposedLayers(renderStateOrSource)[index]?.puppetBindingOverride ?? null;
}

export function setLayerPuppetBindingOverride(renderStateOrSource, index, value) {
  const layer = getComposedLayers(renderStateOrSource)[index];
  if (layer) {
    layer.puppetBindingOverride = value || null;
  }
}

export function createFullMask(width, height, value = 1) {
  return new Uint8Array(width * height).fill(value);
}

export function createMaskFromDepthPixels(depthPixels) {
  const mask = new Uint8Array(depthPixels.length);
  for (let i = 0; i < depthPixels.length; i += 1) {
    mask[i] = depthPixels[i] > 0 ? 1 : 0;
  }
  return mask;
}
