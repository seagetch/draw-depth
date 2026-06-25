import { applyAlphaDepthGapFillToComposite } from "../composite/alphaDepthGapFill.js?v=20260626_4";
import { composeLayeredSource } from "../composite/compose.js";
import { applyPreviousBackendState } from "../composite/prepareLayers.js";
import {
  buildVisibleLayerMap,
  hasUpperLayerMaskNearby,
  seedLayerDepthPixels,
} from "../composite/depthSplit.js";
import {
  buildLayerContourBandMask,
  erodePositiveDepthMask,
  inpaintMaskedLayerDepth,
  smoothMaskedPositiveDepth,
} from "../composite/depthCleanup.js";
import { pruneForeignDepthSeeds } from "../composite/depthPrune.js";
import { buildCompositionDebugStats } from "../composite/debugStats.js";

const cancelledTasks = new Set();

function throwIfCancelled(id) {
  if (cancelledTasks.has(id)) {
    cancelledTasks.delete(id);
    throw new Error("Worker task cancelled.");
  }
}

function composeWithPreviousState(payload, progress) {
  progress({ stage: "compose", current: 0, total: 2, message: "composing layers" });
  const composedSource = composeLayeredSource(payload.colorComposite, payload.depthComposite, payload.options || {});
  progress({ stage: "previous-state", current: 1, total: 2, message: "applying previous state" });
  const result = applyPreviousBackendState(
    composedSource,
    payload.previousLayers || [],
    payload.previousGlobalDepthScale ?? 1,
    payload.depthOverrides || null,
  );
  progress({ stage: "done", current: 2, total: 2, message: "composite ready" });
  return result;
}

function runAlphaDepthGapFill(payload, progress, taskId) {
  const composedSource = {
    layers: payload.layers || [],
    alphaDepthGapFillPasses: payload.passBase || 0,
  };
  return applyAlphaDepthGapFillToComposite(composedSource, {
    onProgress: progress,
    throwIfCancelled: () => throwIfCancelled(taskId),
  });
}

function runDepthCleanup(payload) {
  const { operation, args = {} } = payload;
  if (operation === "buildLayerContourBandMask") {
    return buildLayerContourBandMask(new Uint8Array(args.maskPixels), args.width, args.height, args.thickness);
  }
  if (operation === "erodePositiveDepthMask") {
    return erodePositiveDepthMask(new Uint8Array(args.depthPixels), args.width, args.height, args.thickness);
  }
  if (operation === "inpaintMaskedLayerDepth") {
    return inpaintMaskedLayerDepth(
      new Uint8Array(args.sourceDepthPixels),
      new Uint8Array(args.maskPixels),
      args.width,
      args.height,
    );
  }
  if (operation === "smoothMaskedPositiveDepth") {
    return smoothMaskedPositiveDepth(
      new Uint8Array(args.sourceDepthPixels),
      new Uint8Array(args.maskPixels),
      args.width,
      args.height,
    );
  }
  throw new Error(`Unknown depth cleanup operation: ${operation || ""}`);
}

function runDepthPrune(payload) {
  return pruneForeignDepthSeeds(
    new Uint8Array(payload.depthPixels),
    payload.layer,
    payload.layerIndex,
    payload.imageWidth,
    payload.imageHeight,
    new Uint8Array(payload.stableDepthPixels),
    new Int32Array(payload.visibleLayerMap),
    new Uint8Array(payload.maskPixels),
    payload.threshold,
  );
}

function runDepthSplit(payload) {
  const { operation, args = {} } = payload;
  if (operation === "buildVisibleLayerMap") {
    return buildVisibleLayerMap(args.imageWidth, args.imageHeight, args.layers || []);
  }
  if (operation === "seedLayerDepthPixels") {
    return seedLayerDepthPixels(
      args.layer,
      args.layerIndex,
      args.imageWidth,
      args.imageHeight,
      new Uint8Array(args.stableDepthPixels),
      new Int32Array(args.visibleLayerMap),
      new Uint8Array(args.maskPixels),
      args.layers || [],
      args.options || {},
    );
  }
  if (operation === "hasUpperLayerMaskNearby") {
    return hasUpperLayerMaskNearby(
      args.layers || [],
      args.layerIndex,
      args.globalX,
      args.globalY,
      args.radius,
    );
  }
  throw new Error(`Unknown depth split operation: ${operation || ""}`);
}

function collectTransfers(value, transfers = [], seen = new Set()) {
  if (!value || typeof value !== "object") {
    return transfers;
  }
  if (ArrayBuffer.isView(value)) {
    if (!seen.has(value.buffer)) {
      seen.add(value.buffer);
      transfers.push(value.buffer);
    }
    return transfers;
  }
  if (value instanceof ArrayBuffer) {
    if (!seen.has(value)) {
      seen.add(value);
      transfers.push(value);
    }
    return transfers;
  }
  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    collectTransfers(item, transfers, seen);
  }
  return transfers;
}

self.addEventListener("message", (event) => {
  const { id, type, payload } = event.data || {};
  if (type === "cancel") {
    cancelledTasks.add(id);
    return;
  }
  const progress = (value) => self.postMessage({ id, progress: value });
  try {
    let result;
    if (type === "composeWithPreviousState") {
      result = composeWithPreviousState(payload, progress);
    } else if (type === "alphaDepthGapFill") {
      result = runAlphaDepthGapFill(payload, progress, id);
    } else if (type === "depthCleanup") {
      result = runDepthCleanup(payload);
    } else if (type === "depthPrune") {
      result = runDepthPrune(payload);
    } else if (type === "depthSplit") {
      result = runDepthSplit(payload);
    } else if (type === "buildCompositionDebugStats") {
      result = buildCompositionDebugStats(payload.composedSource);
    } else {
      throw new Error(`Unknown composite worker task: ${type || ""}`);
    }
    cancelledTasks.delete(id);
    self.postMessage({ id, ok: true, result }, collectTransfers(result));
  } catch (error) {
    cancelledTasks.delete(id);
    self.postMessage({ id, ok: false, error: error.message });
  }
});
