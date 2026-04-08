function readPixelsFromImage(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);

  return context.getImageData(0, 0, image.width, image.height);
}

export function createImageLoaders(THREE) {
  const loader = new THREE.TextureLoader();

  function loadTexture(url) {
    return new Promise((resolve, reject) => {
      loader.load(url, resolve, undefined, reject);
    });
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load ${url}`));
      image.src = url;
    });
  }

  async function loadImagePixels(url) {
    const image = await loadImage(url);
    return readPixelsFromImage(image);
  }

  async function loadDepthPixels(url) {
    const pixels = await loadImagePixels(url);
    const output = new Uint8Array(pixels.width * pixels.height);
    for (let src = 0, dst = 0; dst < output.length; src += 4, dst += 1) {
      output[dst] = pixels.data[src];
    }
    return output;
  }

  async function loadRgbPixels(url) {
    const image = await loadImagePixels(url);
    const rgb = new Uint8Array(image.width * image.height * 3);
    for (let src = 0, dst = 0; src < image.data.length; src += 4, dst += 3) {
      rgb[dst] = image.data[src];
      rgb[dst + 1] = image.data[src + 1];
      rgb[dst + 2] = image.data[src + 2];
    }
    return {
      width: image.width,
      height: image.height,
      pixels: rgb,
    };
  }

  return {
    loadTexture,
    loadImage,
    loadImagePixels,
    loadDepthPixels,
    loadRgbPixels,
  };
}
