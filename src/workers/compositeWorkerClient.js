let worker = null;
let nextTaskId = 1;
const pendingTasks = new Map();
const CANCELLED_ERROR_MESSAGE = "Worker task cancelled.";

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./compositeWorker.js?v=20260627_1", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event) => {
      const { id, ok, result, error } = event.data || {};
      const pending = pendingTasks.get(id);
      if (!pending) {
        return;
      }
      if (event.data?.progress) {
        pending.onProgress?.(event.data.progress);
        return;
      }
      pendingTasks.delete(id);
      if (ok) {
        pending.resolve(result);
      } else {
        pending.reject(new Error(error || "Composite worker failed."));
      }
    });
  }
  return worker;
}

export function runCompositeWorker(type, payload, options = {}) {
  return startCompositeWorkerTask(type, payload, options).promise;
}

export function cancelCompositeWorkerTasks(message = CANCELLED_ERROR_MESSAGE) {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  for (const pending of pendingTasks.values()) {
    pending.reject(new Error(message));
  }
  pendingTasks.clear();
}

export function startCompositeWorkerTask(type, payload, options = {}) {
  const id = String(nextTaskId++);
  const promise = new Promise((resolve, reject) => {
    pendingTasks.set(id, { resolve, reject, onProgress: options.onProgress });
    getWorker().postMessage({ id, type, payload });
  });
  return {
    id,
    promise,
    cancel() {
      cancelCompositeWorkerTasks(CANCELLED_ERROR_MESSAGE);
    },
  };
}

export async function composeWithPreviousStateInWorker({
  colorComposite,
  depthComposite,
  previousLayers = [],
  previousGlobalDepthScale = 1,
  depthOverrides = null,
  options = {},
  onProgress = null,
}) {
  const result = await runCompositeWorker("composeWithPreviousState", {
    colorComposite: serializeComposite(colorComposite),
    depthComposite: serializeComposite(depthComposite),
    previousLayers: serializeLayers(previousLayers),
    previousGlobalDepthScale,
    depthOverrides: serializeDepthOverrides(depthOverrides),
    options,
  }, { onProgress });
  return reconnectCompositeRuntimeData(result, colorComposite, depthComposite);
}

export async function alphaDepthGapFillInWorker(composedSource, options = {}) {
  return startAlphaDepthGapFillTask(composedSource, options).promise;
}

export function startAlphaDepthGapFillTask(composedSource, options = {}) {
  return startCompositeWorkerTask("alphaDepthGapFill", {
    layers: serializeLayers(composedSource?.layers || []),
    passBase: composedSource?.alphaDepthGapFillPasses || 0,
    options: options.options || {},
  }, { onProgress: options.onProgress });
}

export function buildCompositionDebugStatsInWorker(composedSource) {
  return runCompositeWorker("buildCompositionDebugStats", {
    composedSource: {
      ...copyPlainFields(composedSource || {}),
      colorSource: composedSource?.colorSource ? serializeComposite(composedSource.colorSource) : null,
      depthSource: composedSource?.depthSource ? serializeComposite(composedSource.depthSource) : null,
      layers: serializeLayers(composedSource?.layers || []),
    },
  });
}

function serializeComposite(composite) {
  if (!composite) {
    return null;
  }
  return {
    ...copyPlainFields(composite),
    layers: serializeLayers(composite.layers || []),
  };
}

function serializeLayers(layers) {
  return (layers || []).map((layer) => ({
    ...copyPlainFields(layer),
    alphaMask: cloneTypedArray(layer.alphaMask),
    surfaceMask: cloneTypedArray(layer.surfaceMask),
    maskPixels: cloneTypedArray(layer.maskPixels),
    surfaceMaskPixels: cloneTypedArray(layer.surfaceMaskPixels),
    pixels: cloneTypedArray(layer.pixels),
    depthModeSourcePixels: cloneTypedArray(layer.depthModeSourcePixels),
    baseDepthPixels: cloneTypedArray(layer.baseDepthPixels),
    depthPixels: cloneTypedArray(layer.depthPixels),
    directDepthPixels: cloneTypedArray(layer.directDepthPixels),
    renderDepthMask: cloneTypedArray(layer.renderDepthMask),
    depthMaskPixels: cloneTypedArray(layer.depthMaskPixels),
  }));
}

function serializeDepthOverrides(overrides) {
  if (!overrides) {
    return null;
  }
  const out = {};
  for (const [key, value] of Object.entries(overrides)) {
    out[key] = serializeLayers([value])[0];
  }
  return out;
}

function copyPlainFields(source) {
  const out = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (isRuntimeField(key) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
      continue;
    }
    const clonedValue = clonePlainValue(value);
    if (clonedValue !== undefined) {
      out[key] = clonedValue;
    }
  }
  return out;
}

function clonePlainValue(value) {
  if (value == null || typeof value !== "object") {
    return value;
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map(clonePlainValue).filter((item) => item !== undefined);
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return undefined;
  }
  const out = {};
  for (const [key, childValue] of Object.entries(value)) {
    if (isRuntimeField(key)) {
      continue;
    }
    const clonedValue = clonePlainValue(childValue);
    if (clonedValue !== undefined) {
      out[key] = clonedValue;
    }
  }
  return out;
}

function isRuntimeField(key) {
  return key === "canvas"
    || key === "document"
    || key === "imageData"
    || key === "texture"
    || key === "colorCanvas"
    || key === "colorImageData"
    || key === "colorTexture"
    || key === "debugTexture"
    || key === "maskTexture";
}

function cloneTypedArray(value) {
  return ArrayBuffer.isView(value) ? value.slice() : null;
}

function reconnectCompositeRuntimeData(composedSource, colorComposite, depthComposite) {
  if (!composedSource) {
    return composedSource;
  }
  composedSource.colorSource = colorComposite;
  composedSource.depthSource = depthComposite;
  const colorLayers = colorComposite?.layers || [];
  composedSource.layers = (composedSource.layers || []).map((layer, index) => {
    const sourceIndex = layer.sourceIndex ?? layer.sourceIndices?.[0] ?? index;
    const colorLayer = colorLayers[sourceIndex] || colorLayers[index] || null;
    return {
      ...layer,
      colorCanvas: colorLayer?.canvas || null,
      colorImageData: colorLayer?.imageData || null,
      colorTexture: colorLayer?.texture || null,
    };
  });
  return composedSource;
}
