import { assertCompositeDimensions, createFullMask } from "./schema.js";

export function flattenCompositeLayers(layers, output = []) {
  for (let i = 0; i < layers.length; i += 1) {
    const layer = layers[i];
    if (layer.hidden) {
      continue;
    }
    if (layer.children && layer.children.length) {
      flattenCompositeLayers(layer.children, output);
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
      sourceIndex: layer.sourceIndex ?? output.length,
    });
  }
  return output;
}

export function getCanvasImageData(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

export function extractAlphaMask(rgbaPixels, minAlpha = 1) {
  const mask = new Uint8Array(rgbaPixels.length / 4);
  for (let i = 0, p = 0; i < rgbaPixels.length; i += 4, p += 1) {
    mask[p] = rgbaPixels[i + 3] >= minAlpha ? 1 : 0;
  }
  return mask;
}

export function createFlatColorCompositeFromTexture(texture, options = {}) {
  const width = texture.image.width;
  const height = texture.image.height;
  const isCanvasImage = typeof HTMLCanvasElement !== "undefined" && texture.image instanceof HTMLCanvasElement;
  const layer = {
    id: options.id || "color:flat:0",
    name: options.name || "Color",
    sourceIndex: 0,
    left: 0,
    top: 0,
    width,
    height,
    canvas: isCanvasImage ? texture.image : null,
    imageData: null,
    alphaMask: createFullMask(width, height),
    surfaceMask: createFullMask(width, height),
    texture,
  };
  const composite = {
    kind: "color",
    format: options.format || "raster",
    width,
    height,
    layers: [layer],
  };
  assertCompositeDimensions(composite, "ColorComposite");
  return composite;
}

export function createColorCompositeFromPsd(psdDocument, options = {}) {
  const layers = flattenCompositeLayers(psdDocument.children || []).map((layer, index) => {
    const imageData = getCanvasImageData(layer.canvas);
    return {
      id: `color:psd:${index}`,
      name: layer.name || `Layer ${index + 1}`,
      sourceIndex: layer.sourceIndex ?? index,
      sourceIndices: [layer.sourceIndex ?? index],
      left: layer.left,
      top: layer.top,
      width: layer.width,
      height: layer.height,
      canvas: layer.canvas,
      imageData,
      alphaMask: extractAlphaMask(imageData.data),
      surfaceMask: extractAlphaMask(imageData.data, options.surfaceAlphaMin || 255),
    };
  });
  const composite = {
    kind: "color",
    format: "psd",
    width: psdDocument.width,
    height: psdDocument.height,
    layers,
    document: psdDocument,
  };
  assertCompositeDimensions(composite, "ColorComposite");
  return composite;
}
