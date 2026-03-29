const app = document.querySelector("#app");
const statusEl = document.querySelector("#status");
const depthScaleEl = document.querySelector("#depthScale");
const depthScaleValueEl = document.querySelector("#depthScaleValue");
const meshDetailEl = document.querySelector("#meshDetail");
const meshDetailValueEl = document.querySelector("#meshDetailValue");
const invertDepthEl = document.querySelector("#invertDepth");
const depthModeEl = document.querySelector("#depthMode");
const gridSpecModeEl = document.querySelector("#gridSpecMode");
const gridXEl = document.querySelector("#gridX");
const gridYEl = document.querySelector("#gridY");
const gridXValueEl = document.querySelector("#gridXValue");
const gridYValueEl = document.querySelector("#gridYValue");
const kernelSizeEl = document.querySelector("#kernelSize");
const kernelSizeValueEl = document.querySelector("#kernelSizeValue");
const interpModeEl = document.querySelector("#interpMode");
const colorThumbButtonEl = document.querySelector("#colorThumbButton");
const depthThumbButtonEl = document.querySelector("#depthThumbButton");
const colorThumbEl = document.querySelector("#colorThumb");
const depthThumbEl = document.querySelector("#depthThumb");
const colorFileInputEl = document.querySelector("#colorFileInput");
const depthFileInputEl = document.querySelector("#depthFileInput");

const colorUrl = "./data/Midori-color.jpg";
const depthUrl = "./data/Midori-depth.jpg";
const invalidDepthThreshold = 1 / 255;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.01, 20);
camera.position.set(0, 0, 1.65);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enablePan = true;
controls.enableDamping = true;
controls.minDistance = 0.7;
controls.maxDistance = 2.4;
controls.minPolarAngle = Math.PI * 0.35;
controls.maxPolarAngle = Math.PI * 0.65;
controls.rotateSpeed = 0.7;
controls.panSpeed = 0.9;
controls.zoomSpeed = 0.35;
controls.screenSpacePanning = true;
controls.target.set(0, 0, 0);

const loader = new THREE.TextureLoader();

const renderState = {
  colorTexture: null,
  sourceDepthTexture: null,
  sourceDepthPixels: null,
  activeDepthTexture: null,
  activeDepthPixels: null,
  imageWidth: 0,
  imageHeight: 0,
  mesh: null,
  material: null,
  colorObjectUrl: null,
  depthObjectUrl: null,
  generatedDepthTexture: null,
};

const vertexShader = `
  uniform sampler2D uDepthTexture;
  uniform float uDepthScale;
  uniform float uInvertDepth;
  varying vec2 vUv;
  varying float vDepthMask;

  void main() {
    vUv = uv;

    float rawDepth = texture2D(uDepthTexture, uv).r;
    vDepthMask = step(${invalidDepthThreshold.toFixed(8)}, rawDepth);

    float depthValue = mix(rawDepth, 1.0 - rawDepth, uInvertDepth);
    vec3 displaced = position;
    displaced.z += depthValue * uDepthScale * vDepthMask;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const fragmentShader = `
  uniform sampler2D uColorTexture;
  varying vec2 vUv;
  varying float vDepthMask;

  void main() {
    if (vDepthMask < 0.5) {
      discard;
    }

    vec4 color = texture2D(uColorTexture, vUv);
    gl_FragColor = color;
  }
`;

init().catch((error) => {
  console.error(error);
  statusEl.textContent = `Failed: ${error.message}`;
});

async function init() {
  const [colorTexture, depthTexture, depthPixels] = await Promise.all([
    loadTexture(colorUrl),
    loadTexture(depthUrl),
    loadDepthPixels(depthUrl),
  ]);

  const imageWidth = colorTexture.image.width;
  const imageHeight = colorTexture.image.height;

  if (imageWidth !== depthTexture.image.width || imageHeight !== depthTexture.image.height) {
    throw new Error("Color and depth image sizes do not match.");
  }

  colorTexture.encoding = THREE.sRGBEncoding;
  colorTexture.minFilter = THREE.LinearFilter;
  colorTexture.magFilter = THREE.LinearFilter;

  depthTexture.minFilter = THREE.LinearFilter;
  depthTexture.magFilter = THREE.LinearFilter;

  renderState.colorTexture = colorTexture;
  renderState.sourceDepthTexture = depthTexture;
  renderState.sourceDepthPixels = depthPixels;
  renderState.imageWidth = imageWidth;
  renderState.imageHeight = imageHeight;

  rebuildDepthModeResources();
  buildMesh();
  wireControls();
  syncThumbs();
  onResize();
  animate();
}

function wireControls() {
  depthScaleValueEl.textContent = Number(depthScaleEl.value).toFixed(2);
  meshDetailValueEl.textContent = meshDetailEl.value;
  gridXValueEl.textContent = gridXEl.value;
  gridYValueEl.textContent = gridYEl.value;
  kernelSizeValueEl.textContent = kernelSizeEl.value;

  depthScaleEl.addEventListener("input", () => {
    depthScaleValueEl.textContent = Number(depthScaleEl.value).toFixed(2);
    renderState.material.uniforms.uDepthScale.value = Number(depthScaleEl.value);
  });

  meshDetailEl.addEventListener("input", () => {
    meshDetailValueEl.textContent = meshDetailEl.value;
  });

  meshDetailEl.addEventListener("change", () => {
    buildMesh();
  });

  invertDepthEl.addEventListener("change", () => {
    renderState.material.uniforms.uInvertDepth.value = invertDepthEl.checked ? 1 : 0;
  });

  depthModeEl.addEventListener("change", () => {
    rebuildDepthModeResources();
    buildMesh();
  });

  gridSpecModeEl.addEventListener("change", () => {
    rebuildDepthModeResources();
    buildMesh();
  });

  gridXEl.addEventListener("input", () => {
    gridXValueEl.textContent = gridXEl.value;
  });

  gridYEl.addEventListener("input", () => {
    gridYValueEl.textContent = gridYEl.value;
  });

  kernelSizeEl.addEventListener("input", () => {
    kernelSizeValueEl.textContent = kernelSizeEl.value;
  });

  gridXEl.addEventListener("change", () => {
    rebuildDepthModeResources();
    buildMesh();
  });

  gridYEl.addEventListener("change", () => {
    rebuildDepthModeResources();
    buildMesh();
  });

  kernelSizeEl.addEventListener("change", () => {
    rebuildDepthModeResources();
    buildMesh();
  });

  interpModeEl.addEventListener("change", () => {
    rebuildDepthModeResources();
    buildMesh();
  });

  colorThumbButtonEl.addEventListener("click", () => {
    colorFileInputEl.click();
  });

  depthThumbButtonEl.addEventListener("click", () => {
    depthFileInputEl.click();
  });

  colorFileInputEl.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    await replaceImage("color", file);
    colorFileInputEl.value = "";
  });

  depthFileInputEl.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    await replaceImage("depth", file);
    depthFileInputEl.value = "";
  });

  window.addEventListener("resize", onResize);
}

function buildMesh() {
  if (renderState.mesh) {
    scene.remove(renderState.mesh);
    renderState.mesh.geometry.dispose();
    renderState.material.dispose();
  }

  const step = Number(meshDetailEl.value);
  const geometry = buildMaskedPlaneGeometry(
    renderState.imageWidth,
    renderState.imageHeight,
    renderState.activeDepthPixels,
    step,
  );

  geometry.computeVertexNormals();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColorTexture: { value: renderState.colorTexture },
      uDepthTexture: { value: renderState.activeDepthTexture },
      uDepthScale: { value: Number(depthScaleEl.value) },
      uInvertDepth: { value: invertDepthEl.checked ? 1 : 0 },
    },
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    transparent: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  renderState.mesh = mesh;
  renderState.material = material;

  refreshStatusCounts();
}

function buildMaskedPlaneGeometry(width, height, depthPixels, step) {
  const cols = Math.floor((width - 1) / step) + 1;
  const rows = Math.floor((height - 1) / step) + 1;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const aspect = width / height;
  const halfWidth = aspect * 0.5;
  const halfHeight = 0.5;

  let p = 0;
  let t = 0;

  for (let y = 0; y < rows; y += 1) {
    const py = Math.min(y * step, height - 1);
    const v = py / (height - 1);
    const sy = THREE.MathUtils.lerp(halfHeight, -halfHeight, v);

    for (let x = 0; x < cols; x += 1) {
      const px = Math.min(x * step, width - 1);
      const u = px / (width - 1);
      const sx = THREE.MathUtils.lerp(-halfWidth, halfWidth, u);

      positions[p++] = sx;
      positions[p++] = sy;
      positions[p++] = 0;

      uvs[t++] = u;
      uvs[t++] = 1 - v;
    }
  }

  const indices = [];

  for (let y = 0; y < rows - 1; y += 1) {
    for (let x = 0; x < cols - 1; x += 1) {
      const x0 = Math.min(x * step, width - 1);
      const x1 = Math.min((x + 1) * step, width - 1);
      const y0 = Math.min(y * step, height - 1);
      const y1 = Math.min((y + 1) * step, height - 1);

      if (
        !isValidDepth(depthPixels, width, x0, y0) ||
        !isValidDepth(depthPixels, width, x1, y0) ||
        !isValidDepth(depthPixels, width, x0, y1) ||
        !isValidDepth(depthPixels, width, x1, y1)
      ) {
        continue;
      }

      const a = y * cols + x;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;

      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  return geometry;
}

function isValidDepth(depthPixels, width, x, y) {
  return depthPixels[y * width + x] > 0;
}

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

async function loadDepthPixels(url) {
  const image = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  const depth = new Uint8Array(image.width * image.height);

  for (let i = 0, j = 0; i < pixels.length; i += 4, j += 1) {
    depth[j] = pixels[i];
  }

  return depth;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load ${url}`));
    image.src = url;
  });
}

async function replaceImage(kind, file) {
  statusEl.textContent = `Loading ${kind}...`;

  const objectUrl = URL.createObjectURL(file);

  try {
    if (kind === "color") {
      const texture = await loadTexture(objectUrl);

      if (
        texture.image.width !== renderState.imageWidth ||
        texture.image.height !== renderState.imageHeight
      ) {
        throw new Error("Color image size must match the current depth image.");
      }

      texture.encoding = THREE.sRGBEncoding;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;

      if (renderState.colorTexture) {
        renderState.colorTexture.dispose();
      }

      revokeObjectUrl("color");
      renderState.colorTexture = texture;
      renderState.colorObjectUrl = objectUrl;
      if (renderState.material) {
      renderState.material.uniforms.uColorTexture.value = texture;
      }
      syncThumbs();
      refreshStatusCounts();
      return;
    }

    const [texture, depthPixels] = await Promise.all([
      loadTexture(objectUrl),
      loadDepthPixels(objectUrl),
    ]);

    if (
      texture.image.width !== renderState.imageWidth ||
      texture.image.height !== renderState.imageHeight
    ) {
      throw new Error("Depth image size must match the current color image.");
    }

    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    if (renderState.sourceDepthTexture) {
      renderState.sourceDepthTexture.dispose();
    }

    revokeObjectUrl("depth");
    renderState.sourceDepthTexture = texture;
    renderState.sourceDepthPixels = depthPixels;
    renderState.depthObjectUrl = objectUrl;
    rebuildDepthModeResources();
    buildMesh();
    syncThumbs();
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    statusEl.textContent = `Failed: ${error.message}`;
    console.error(error);
  }
}

function syncThumbs() {
  colorThumbEl.src = renderState.colorObjectUrl || colorUrl;
  depthThumbEl.src = renderState.depthObjectUrl || depthUrl;
}

function revokeObjectUrl(kind) {
  if (kind === "color" && renderState.colorObjectUrl) {
    URL.revokeObjectURL(renderState.colorObjectUrl);
    renderState.colorObjectUrl = null;
  }

  if (kind === "depth" && renderState.depthObjectUrl) {
    URL.revokeObjectURL(renderState.depthObjectUrl);
    renderState.depthObjectUrl = null;
  }
}

function refreshStatusCounts() {
  if (!renderState.mesh) {
    return;
  }

  const triangleCount = renderState.mesh.geometry.index.count / 3;
  const vertexCount = renderState.mesh.geometry.attributes.position.count;
  const modeLabel = depthModeEl.value === "raw"
    ? "raw"
    : `grid-${interpModeEl.value}`;
  statusEl.textContent = `${renderState.imageWidth}x${renderState.imageHeight} | ${modeLabel} | vertices ${vertexCount.toLocaleString()} | triangles ${triangleCount.toLocaleString()}`;
}

function rebuildDepthModeResources() {
  disposeGeneratedDepthTexture();

  if (depthModeEl.value === "raw") {
    renderState.activeDepthTexture = renderState.sourceDepthTexture;
    renderState.activeDepthPixels = renderState.sourceDepthPixels;
    return;
  }

  const generated = createGridDepthResources(
    renderState.imageWidth,
    renderState.imageHeight,
    renderState.sourceDepthPixels,
    gridSpecModeEl.value,
    Number(gridXEl.value),
    Number(gridYEl.value),
    Number(kernelSizeEl.value),
    interpModeEl.value,
  );

  renderState.generatedDepthTexture = generated.texture;
  renderState.activeDepthTexture = generated.texture;
  renderState.activeDepthPixels = generated.pixels;
}

function disposeGeneratedDepthTexture() {
  if (renderState.generatedDepthTexture) {
    renderState.generatedDepthTexture.dispose();
    renderState.generatedDepthTexture = null;
  }
}

function createGridDepthResources(width, height, sourcePixels, specMode, gridX, gridY, kernelSize, interpMode) {
  const pixels = new Uint8Array(width * height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const imageData = context.createImageData(width, height);

  const gridWidth = specMode === "size"
    ? Math.max(2, Math.ceil((width - 1) / Math.max(1, gridX)) + 1)
    : Math.max(2, gridX + 1);
  const gridHeight = specMode === "size"
    ? Math.max(2, Math.ceil((height - 1) / Math.max(1, gridY)) + 1)
    : Math.max(2, gridY + 1);

  const controlValues = new Float32Array(gridWidth * gridHeight);
  const controlValid = new Uint8Array(gridWidth * gridHeight);
  const radius = Math.max(1, Math.floor(kernelSize / 2));

  for (let gy = 0; gy < gridHeight; gy += 1) {
    const py = sampleGridPosition(gy, gridHeight, height);
    for (let gx = 0; gx < gridWidth; gx += 1) {
      const px = sampleGridPosition(gx, gridWidth, width);
      const sample = convolveDepthAt(sourcePixels, width, height, px, py, radius);
      const index = gy * gridWidth + gx;
      controlValues[index] = sample.value;
      controlValid[index] = sample.valid ? 1 : 0;
    }
  }

  for (let y = 0; y < height; y += 1) {
    const fy = ((y / Math.max(1, height - 1)) * (gridHeight - 1));
    for (let x = 0; x < width; x += 1) {
      const fx = ((x / Math.max(1, width - 1)) * (gridWidth - 1));
      const value = interpMode === "cubic"
        ? sampleCubicGrid(controlValues, controlValid, gridWidth, gridHeight, fx, fy)
        : sampleLinearGrid(controlValues, controlValid, gridWidth, gridHeight, fx, fy);
      const rounded = Math.max(0, Math.min(255, Math.round(value)));
      const pixelIndex = y * width + x;
      const imageIndex = pixelIndex * 4;
      pixels[pixelIndex] = rounded;
      imageData.data[imageIndex] = rounded;
      imageData.data[imageIndex + 1] = rounded;
      imageData.data[imageIndex + 2] = rounded;
      imageData.data[imageIndex + 3] = rounded > 0 ? 255 : 0;
    }
  }

  context.putImageData(imageData, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  return { texture, pixels };
}

function sampleGridPosition(index, count, extent) {
  if (count <= 1) {
    return 0;
  }

  return Math.round((index / (count - 1)) * (extent - 1));
}

function convolveDepthAt(sourcePixels, width, height, centerX, centerY, radius) {
  let weightedSum = 0;
  let weightTotal = 0;

  for (let y = Math.max(0, centerY - radius); y <= Math.min(height - 1, centerY + radius); y += 1) {
    for (let x = Math.max(0, centerX - radius); x <= Math.min(width - 1, centerX + radius); x += 1) {
      const value = sourcePixels[y * width + x];
      if (value <= 0) {
        continue;
      }

      const dx = x - centerX;
      const dy = y - centerY;
      const distance2 = dx * dx + dy * dy;
      const sigma = Math.max(1, radius * 0.5);
      const weight = Math.exp(-distance2 / (2 * sigma * sigma));
      weightedSum += value * weight;
      weightTotal += weight;
    }
  }

  if (weightTotal === 0) {
    return { value: 0, valid: false };
  }

  return { value: weightedSum / weightTotal, valid: true };
}

function sampleLinearGrid(values, valid, gridWidth, gridHeight, fx, fy) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(gridWidth - 1, x0 + 1);
  const y1 = Math.min(gridHeight - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;

  return blendValidSamples([
    { x: x0, y: y0, weight: (1 - tx) * (1 - ty) },
    { x: x1, y: y0, weight: tx * (1 - ty) },
    { x: x0, y: y1, weight: (1 - tx) * ty },
    { x: x1, y: y1, weight: tx * ty },
  ], values, valid, gridWidth);
}

function sampleCubicGrid(values, valid, gridWidth, gridHeight, fx, fy) {
  const baseX = Math.floor(fx);
  const baseY = Math.floor(fy);
  const tx = fx - baseX;
  const ty = fy - baseY;
  const samples = [];

  for (let oy = -1; oy <= 2; oy += 1) {
    const sy = clamp(baseY + oy, 0, gridHeight - 1);
    const wy = catmullRomWeight(oy - ty);
    for (let ox = -1; ox <= 2; ox += 1) {
      const sx = clamp(baseX + ox, 0, gridWidth - 1);
      const wx = catmullRomWeight(ox - tx);
      samples.push({ x: sx, y: sy, weight: wx * wy });
    }
  }

  return blendValidSamples(samples, values, valid, gridWidth);
}

function blendValidSamples(samples, values, valid, gridWidth) {
  let weightedSum = 0;
  let weightTotal = 0;

  for (const sample of samples) {
    if (sample.weight === 0) {
      continue;
    }

    const index = sample.y * gridWidth + sample.x;
    if (!valid[index]) {
      continue;
    }

    weightedSum += values[index] * sample.weight;
    weightTotal += sample.weight;
  }

  if (weightTotal === 0) {
    return 0;
  }

  return weightedSum / weightTotal;
}

function catmullRomWeight(x) {
  const ax = Math.abs(x);
  if (ax <= 1) {
    return 1.5 * ax * ax * ax - 2.5 * ax * ax + 1;
  }
  if (ax < 2) {
    return -0.5 * ax * ax * ax + 2.5 * ax * ax - 4 * ax + 2;
  }
  return 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
