export function buildLayerLookup(layers) {
  const lookup = new Map();
  for (let i = 0; i < layers.length; i += 1) {
    const layer = layers[i];
    const key = getLayerMatchKey(layer);
    if (!lookup.has(key)) {
      lookup.set(key, []);
    }
    lookup.get(key).push({ layer, index: i });
  }
  return lookup;
}

export function getLayerMatchKey(layer) {
  return [
    normalizeLayerName(layer.name || ""),
    layer.left || 0,
    layer.top || 0,
    layer.width || 0,
    layer.height || 0,
  ].join("\u0000");
}

export function takeMatchedLayer(lookup, colorLayer, fallbackIndex) {
  const exactKey = getLayerMatchKey(colorLayer);
  const exactMatches = lookup.get(exactKey);
  if (exactMatches && exactMatches.length) {
    return exactMatches.shift().layer;
  }

  const colorName = normalizeLayerName(colorLayer.name || "");
  let bestNamedEntries = null;
  let bestNamedEntryIndex = -1;
  let bestNamedScore = -1;

  if (colorName) {
    for (const entries of lookup.values()) {
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (normalizeLayerName(entry.layer.name || "") !== colorName) {
          continue;
        }
        const score = scoreLayerMatch(colorLayer, entry.layer, fallbackIndex, entry.index);
        if (score > bestNamedScore) {
          bestNamedScore = score;
          bestNamedEntries = entries;
          bestNamedEntryIndex = i;
        }
      }
    }
  }

  if (bestNamedEntries && bestNamedEntryIndex >= 0) {
    return bestNamedEntries.splice(bestNamedEntryIndex, 1)[0].layer;
  }

  let bestEntries = null;
  let bestEntryIndex = -1;
  let bestScore = -1;
  let bestOverlap = 0;

  for (const entries of lookup.values()) {
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (colorName || normalizeLayerName(entry.layer.name || "")) {
        continue;
      }
      const overlap = estimateLayerRectOverlap(colorLayer, entry.layer);
      if (overlap <= 0) {
        continue;
      }
      const score = scoreLayerMatch(colorLayer, entry.layer, fallbackIndex, entry.index);
      if (score > bestScore) {
        bestScore = score;
        bestOverlap = overlap;
        bestEntries = entries;
        bestEntryIndex = i;
      }
    }
  }

  if (bestEntries && bestEntryIndex >= 0 && bestOverlap > 0) {
    return bestEntries.splice(bestEntryIndex, 1)[0].layer;
  }

  const fallbackEntries = lookup.get(["", 0, 0, 0, 0].join("\u0000"));
  if (fallbackEntries && fallbackEntries.length) {
    return fallbackEntries.shift().layer;
  }

  return null;
}

export function scoreLayerMatch(colorLayer, depthLayer, fallbackColorIndex, fallbackDepthIndex) {
  const colorName = normalizeLayerName(colorLayer.name || "");
  const depthName = normalizeLayerName(depthLayer.name || "");
  const overlap = estimateLayerRectOverlap(colorLayer, depthLayer);
  const samePosition = (
    (depthLayer.left || 0) === (colorLayer.left || 0) &&
    (depthLayer.top || 0) === (colorLayer.top || 0)
  );
  const sameSize = (
    (depthLayer.width || 0) === (colorLayer.width || 0) &&
    (depthLayer.height || 0) === (colorLayer.height || 0)
  );
  let score = overlap;
  if (colorName && colorName === depthName) score += 100000000;
  if (samePosition) score += 1000000;
  if (sameSize) score += 100000;
  if (fallbackColorIndex === fallbackDepthIndex) score += 1000;
  return score;
}

export function normalizeLayerName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function estimateLayerRectOverlap(layerA, layerB) {
  const left = Math.max(layerA.left || 0, layerB.left || 0);
  const top = Math.max(layerA.top || 0, layerB.top || 0);
  const right = Math.min(
    (layerA.left || 0) + (layerA.width || 0),
    (layerB.left || 0) + (layerB.width || 0),
  );
  const bottom = Math.min(
    (layerA.top || 0) + (layerA.height || 0),
    (layerB.top || 0) + (layerB.height || 0),
  );
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}
