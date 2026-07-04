import { assertCompositeDimensions, createMaskFromDepthPixels } from "./schema.js";
import { flattenCompositeLayers, getCanvasImageData, extractAlphaMask } from "./colorSources.js";

export function depthPixelsFromImageData(imageData) {
  const pixels = new Uint8Array(imageData.width * imageData.height);
  for (let i = 0, p = 0; i < imageData.data.length; i += 4, p += 1) {
    pixels[p] = imageData.data[i];
  }
  return pixels;
}

export function createFlatDepthCompositeFromPixels(width, height, pixels, options = {}) {
  const layer = {
    id: options.id || "depth:flat:0",
    name: options.name || "Depth",
    sourceIndex: 0,
    left: 0,
    top: 0,
    width,
    height,
    pixels,
    alphaMask: options.alphaMask || createMaskFromDepthPixels(pixels),
    canvas: options.canvas || null,
    imageData: options.imageData || null,
  };
  const composite = {
    kind: "depth",
    format: options.format || "raster",
    width,
    height,
    layers: [layer],
  };
  assertCompositeDimensions(composite, "DepthComposite");
  return composite;
}

export function createDepthCompositeFromPsd(psdDocument) {
  const layers = flattenCompositeLayers(psdDocument.children || []).map((layer, index) => {
    const imageData = getCanvasImageData(layer.canvas);
    return {
      id: `depth:psd:${index}`,
      name: layer.name || `Layer ${index + 1}`,
      sourceIndex: layer.sourceIndex ?? index,
      left: layer.left,
      top: layer.top,
      width: layer.width,
      height: layer.height,
      pixels: depthPixelsFromImageData(imageData),
      alphaMask: layer.canvas.__depthDrawAlphaMask || extractAlphaMask(imageData.data),
      canvas: layer.canvas,
      imageData,
    };
  });
  const composite = {
    kind: "depth",
    format: "psd",
    width: psdDocument.width,
    height: psdDocument.height,
    layers,
    document: psdDocument,
  };
  assertCompositeDimensions(composite, "DepthComposite");
  return composite;
}
