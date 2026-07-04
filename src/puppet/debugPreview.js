function createImageDataUrl(width, height, fillPixel) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [r, g, b, a] = fillPixel(x, y);
      imageData.data[offset] = r;
      imageData.data[offset + 1] = g;
      imageData.data[offset + 2] = b;
      imageData.data[offset + 3] = a;
    }
  }
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

export function createBinaryMaskPreviewUrl(mask, width, height, colors = {}) {
  const onColor = colors.on || [255, 201, 40, 255];
  const offColor = colors.off || [18, 24, 32, 255];
  return createImageDataUrl(width, height, (x, y) => (
    mask[y * width + x] ? onColor : offColor
  ));
}
