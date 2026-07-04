export function computeMaskedDepthStats(depthPixels, maskPixels, width, height) {
  let masked = 0;
  let zero = 0;
  let min = 255;
  let max = 0;
  let adjacentMax = 0;
  let adjacentMaxAt = null;
  const adjacentDeltas = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (maskPixels && !maskPixels[index]) {
        continue;
      }
      const depth = depthPixels[index];
      masked += 1;
      if (depth === 0) {
        zero += 1;
      }
      if (depth < min) {
        min = depth;
      }
      if (depth > max) {
        max = depth;
      }
      if (x + 1 < width && (!maskPixels || maskPixels[index + 1])) {
        const delta = Math.abs(depth - depthPixels[index + 1]);
        if (delta > adjacentMax) {
          adjacentMax = delta;
          adjacentMaxAt = { x, y, direction: "x", a: depth, b: depthPixels[index + 1] };
        }
        adjacentDeltas.push(delta);
      }
      if (y + 1 < height && (!maskPixels || maskPixels[index + width])) {
        const delta = Math.abs(depth - depthPixels[index + width]);
        if (delta > adjacentMax) {
          adjacentMax = delta;
          adjacentMaxAt = { x, y, direction: "y", a: depth, b: depthPixels[index + width] };
        }
        adjacentDeltas.push(delta);
      }
    }
  }

  adjacentDeltas.sort((a, b) => a - b);
  const p95Index = adjacentDeltas.length ? Math.floor((adjacentDeltas.length - 1) * 0.95) : 0;
  const p99Index = adjacentDeltas.length ? Math.floor((adjacentDeltas.length - 1) * 0.99) : 0;
  return {
    width,
    height,
    masked,
    zero,
    zeroRatio: masked ? zero / masked : 0,
    min: masked ? min : 0,
    max: masked ? max : 0,
    range: masked ? max - min : 0,
    adjacentMax,
    adjacentMaxAt,
    adjacentP95: adjacentDeltas[p95Index] || 0,
    adjacentP99: adjacentDeltas[p99Index] || 0,
  };
}

export function writeDepthDebugStats(payload) {
  try {
    let nextPayload = payload;
    if (typeof localStorage !== "undefined") {
      const previous = localStorage.getItem("depthDrawDebugStats");
      if (previous) {
        nextPayload = {
          ...JSON.parse(previous),
          ...payload,
        };
      }
    }
    const serialized = JSON.stringify(nextPayload);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("depthDrawDebugStats", serialized);
    }
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.setAttribute("data-depth-draw-debug-stats", serialized);
    }
    console.info("[depth-draw] depth debug stats", nextPayload);
  } catch (error) {
    console.warn("[depth-draw] Failed to write depth debug stats", error);
  }
}

export function buildCompositionDebugStats(composedSource) {
  return {
    mode: composedSource?.mode || "",
    width: composedSource?.width || 0,
    height: composedSource?.height || 0,
    layerCount: composedSource?.layers?.length || 0,
    diagnostics: composedSource?.diagnostics || [],
  };
}
