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
const segmentListEl = document.querySelector("#segmentList");
const colorThumbButtonEl = document.querySelector("#colorThumbButton");
const depthThumbButtonEl = document.querySelector("#depthThumbButton");
const colorThumbEl = document.querySelector("#colorThumb");
const depthThumbEl = document.querySelector("#depthThumb");
const colorFileInputEl = document.querySelector("#colorFileInput");
const depthFileInputEl = document.querySelector("#depthFileInput");

const colorUrl = "./data/Midori-color.jpg";
const depthUrl = "./data/Midori-depth.jpg";
const segmentUrl = "./data/Midori-segment.jpg";
const invalidDepthThreshold = 1 / 255;
const segmentAnchorDistance = 36;
const segmentMinAnchorPixels = 24;
const segmentMinAnchorRatio = 0.00003;
const segmentMergeThresholdRatio = 0.0008;

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
controls.minPolarAngle = 0.08;
controls.maxPolarAngle = Math.PI - 0.08;
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
  processedDepthTexture: null,
  processedDepthPixels: null,
  baseDepthTexture: null,
  baseDepthPixels: null,
  adjustedDepthTexture: null,
  activeDepthTexture: null,
  activeDepthPixels: null,
  imageWidth: 0,
  imageHeight: 0,
  mesh: null,
  material: null,
  colorObjectUrl: null,
  depthObjectUrl: null,
  generatedDepthTexture: null,
  segmentSourcePixels: null,
  segmentMap: null,
  segmentCount: 0,
  segmentPalette: [],
  segmentPixelCounts: [],
  segmentVisibility: [],
  segmentDepthOffsets: [],
  segmentDepthScales: [],
  segmentPixels: [],
  segmentBounds: [],
  segmentData: [],
  segmentMaskData: null,
  segmentMaskTexture: null,
};

const gaussianKernelCache = new Map();
const depthBlurKernelCache = new Map();
const segmentDepthOffsetStep = 6;
const segmentDepthScaleStep = 0.1;

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
  uniform sampler2D uSegmentMaskTexture;
  varying vec2 vUv;
  varying float vDepthMask;

  void main() {
    if (vDepthMask < 0.5 || texture2D(uSegmentMaskTexture, vUv).r < 0.5) {
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
  const [colorTexture, depthTexture, depthPixels, segmentImage] = await Promise.all([
    loadTexture(colorUrl),
    loadTexture(depthUrl),
    loadDepthPixels(depthUrl),
    loadRgbPixels(segmentUrl),
  ]);

  const imageWidth = colorTexture.image.width;
  const imageHeight = colorTexture.image.height;

  if (imageWidth !== depthTexture.image.width || imageHeight !== depthTexture.image.height) {
    throw new Error("Color and depth image sizes do not match.");
  }

  if (imageWidth !== segmentImage.width || imageHeight !== segmentImage.height) {
    throw new Error("Segment image size must match the color/depth images.");
  }

  colorTexture.encoding = THREE.sRGBEncoding;
  colorTexture.minFilter = THREE.LinearFilter;
  colorTexture.magFilter = THREE.LinearFilter;

  depthTexture.minFilter = THREE.LinearFilter;
  depthTexture.magFilter = THREE.LinearFilter;

  renderState.colorTexture = colorTexture;
  renderState.sourceDepthTexture = depthTexture;
  renderState.sourceDepthPixels = depthPixels;
  renderState.segmentSourcePixels = segmentImage.pixels;
  renderState.imageWidth = imageWidth;
  renderState.imageHeight = imageHeight;

  rebuildSegments();
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
    renderState.segmentMap,
    step,
  );

  geometry.computeVertexNormals();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColorTexture: { value: renderState.colorTexture },
      uDepthTexture: { value: renderState.activeDepthTexture },
      uSegmentMaskTexture: { value: renderState.segmentMaskTexture },
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

function buildMaskedPlaneGeometry(width, height, depthPixels, segmentMap, step) {
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

      const segmentA = getSegmentIndex(segmentMap, width, x0, y0);
      const segmentB = getSegmentIndex(segmentMap, width, x1, y0);
      const segmentC = getSegmentIndex(segmentMap, width, x0, y1);
      const segmentD = getSegmentIndex(segmentMap, width, x1, y1);

      if (
        segmentA < 0 ||
        segmentB < 0 ||
        segmentC < 0 ||
        segmentD < 0 ||
        segmentA !== segmentB ||
        segmentA !== segmentC ||
        segmentA !== segmentD
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

function getSegmentIndex(segmentMap, width, x, y) {
  return segmentMap[y * width + x];
}

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

async function loadDepthPixels(url) {
  const pixels = await loadImagePixels(url);
  const depth = new Uint8Array(pixels.width * pixels.height);

  for (let i = 0, j = 0; i < pixels.data.length; i += 4, j += 1) {
    depth[j] = pixels.data[i];
  }

  return depth;
}

async function loadRgbPixels(url) {
  const pixels = await loadImagePixels(url);
  const rgb = new Uint8Array(pixels.width * pixels.height * 3);

  for (let i = 0, j = 0; i < pixels.data.length; i += 4, j += 3) {
    rgb[j] = pixels.data[i];
    rgb[j + 1] = pixels.data[i + 1];
    rgb[j + 2] = pixels.data[i + 2];
  }

  return {
    width: pixels.width,
    height: pixels.height,
    pixels: rgb,
  };
}

async function loadImagePixels(url) {
  const image = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height);
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
    rebuildSegments();
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
  const visibleSegments = renderState.segmentVisibility.filter(Boolean).length;
  statusEl.textContent = `${renderState.imageWidth}x${renderState.imageHeight} | ${modeLabel} | segments ${visibleSegments}/${renderState.segmentCount} | vertices ${vertexCount.toLocaleString()} | triangles ${triangleCount.toLocaleString()}`;
}

function rebuildDepthModeResources() {
  disposeGeneratedDepthTexture();
  disposeAdjustedDepthTexture();

  if (depthModeEl.value === "raw") {
    renderState.baseDepthTexture = renderState.processedDepthTexture;
    renderState.baseDepthPixels = renderState.processedDepthPixels;
    applySegmentDepthAdjustments();
    return;
  }

  const generated = createSegmentedGridDepthResources(
    renderState.imageWidth,
    renderState.imageHeight,
    renderState.segmentData,
    gridSpecModeEl.value,
    Number(gridXEl.value),
    Number(gridYEl.value),
    Number(kernelSizeEl.value),
    interpModeEl.value,
  );

  renderState.generatedDepthTexture = generated.texture;
  renderState.baseDepthTexture = generated.texture;
  renderState.baseDepthPixels = generated.pixels;
  applySegmentDepthAdjustments();
}

function disposeGeneratedDepthTexture() {
  if (renderState.generatedDepthTexture) {
    renderState.generatedDepthTexture.dispose();
    renderState.generatedDepthTexture = null;
  }
}

function disposeAdjustedDepthTexture() {
  if (renderState.adjustedDepthTexture) {
    renderState.adjustedDepthTexture.dispose();
    renderState.adjustedDepthTexture = null;
  }
}

function disposeProcessedDepthTexture() {
  if (renderState.processedDepthTexture) {
    renderState.processedDepthTexture.dispose();
    renderState.processedDepthTexture = null;
  }
}

function rebuildSegments() {
  disposeSegmentMaskTexture();

  const segmentation = clusterSegmentPixels(
    renderState.segmentSourcePixels,
    renderState.sourceDepthPixels,
    renderState.imageWidth,
    renderState.imageHeight,
  );

  renderState.segmentMap = segmentation.segmentMap;
  renderState.segmentCount = segmentation.count;
  renderState.segmentPalette = segmentation.palette;
  renderState.segmentPixelCounts = segmentation.pixelCounts;
  renderState.segmentVisibility = new Array(segmentation.count).fill(true);
  renderState.segmentDepthOffsets = new Array(segmentation.count).fill(0);
  renderState.segmentDepthScales = new Array(segmentation.count).fill(1);
  renderState.segmentPixels = segmentation.segmentPixels;
  renderState.segmentBounds = segmentation.segmentBounds;
  renderState.segmentData = segmentation.segmentData;
  rebuildProcessedDepthData();
  renderState.segmentMaskData = new Uint8Array(renderState.imageWidth * renderState.imageHeight);
  renderState.segmentMaskTexture = new THREE.DataTexture(
    renderState.segmentMaskData,
    renderState.imageWidth,
    renderState.imageHeight,
    THREE.LuminanceFormat,
  );
  renderState.segmentMaskTexture.flipY = true;
  renderState.segmentMaskTexture.minFilter = THREE.NearestFilter;
  renderState.segmentMaskTexture.magFilter = THREE.NearestFilter;
  renderState.segmentMaskTexture.needsUpdate = true;

  updateSegmentMaskTexture();
  rebuildSegmentList();
}

function rebuildProcessedDepthData() {
  disposeProcessedDepthTexture();

  const processed = preprocessSegmentDepths(
    renderState.imageWidth,
    renderState.imageHeight,
    renderState.segmentData,
  );

  renderState.segmentData = processed.segmentData;
  renderState.processedDepthPixels = processed.pixels;
  renderState.processedDepthTexture = processed.texture;
}

function clusterSegmentPixels(segmentPixels, depthPixels, width, height) {
  const totalPixels = width * height;
  const histogram = new Map();

  for (let index = 0; index < totalPixels; index += 1) {
    const offset = index * 3;
    const r = segmentPixels[offset];
    const g = segmentPixels[offset + 1];
    const b = segmentPixels[offset + 2];
    const key = (r << 16) | (g << 8) | b;
    const count = histogram.get(key) || 0;
    histogram.set(key, count + 1);
  }

  const colorEntries = Array.from(histogram.entries())
    .map(([key, count]) => ({
      key,
      count,
      r: (key >> 16) & 255,
      g: (key >> 8) & 255,
      b: key & 255,
    }))
    .sort((a, b) => b.count - a.count);

  const minAnchorPixels = Math.max(
    segmentMinAnchorPixels,
    Math.round(totalPixels * segmentMinAnchorRatio),
  );
  const anchors = [];

  for (const entry of colorEntries) {
    const nearest = findNearestPaletteColor(entry, anchors);
    if (!nearest || nearest.distance2 > segmentAnchorDistance * segmentAnchorDistance) {
      if (entry.count >= minAnchorPixels || anchors.length === 0) {
        anchors.push({
          r: entry.r,
          g: entry.g,
          b: entry.b,
          count: 0,
          sourceKeys: [entry.key],
        });
      }
    }
  }

  if (anchors.length === 0) {
    anchors.push({
      r: colorEntries[0]?.r ?? 255,
      g: colorEntries[0]?.g ?? 255,
      b: colorEntries[0]?.b ?? 255,
      count: colorEntries[0]?.count ?? totalPixels,
      sourceKeys: colorEntries[0] ? [colorEntries[0].key] : [],
    });
  }

  const colorToAnchor = new Map();

  for (const entry of colorEntries) {
    const nearest = findNearestPaletteColor(entry, anchors);
    if (!nearest) {
      continue;
    }

    colorToAnchor.set(entry.key, nearest.index);
    nearest.anchor.count += entry.count;
    nearest.anchor.sourceKeys.push(entry.key);
  }

  const rawCounts = new Uint32Array(anchors.length);
  const rawAssignments = new Int16Array(totalPixels);
  rawAssignments.fill(-1);

  for (let index = 0; index < totalPixels; index += 1) {
    const offset = index * 3;
    const key = (segmentPixels[offset] << 16) | (segmentPixels[offset + 1] << 8) | segmentPixels[offset + 2];
    const anchorIndex = colorToAnchor.get(key);
    rawAssignments[index] = anchorIndex;
    rawCounts[anchorIndex] += 1;
  }

  const minSegmentPixels = Math.max(16, Math.round(totalPixels * segmentMergeThresholdRatio));
  const activeFlags = Array.from(rawCounts, (count) => count >= minSegmentPixels);

  if (!activeFlags.some(Boolean)) {
    activeFlags[rawCounts.indexOf(Math.max(...rawCounts))] = true;
  }

  const remap = anchors.map((anchor, index) => {
    if (activeFlags[index]) {
      return index;
    }

    const nearest = findNearestPaletteColor(anchor, anchors, activeFlags);
    return nearest ? nearest.index : index;
  });

  const finalKeyToIndex = new Map();
  const finalPalette = [];
  const finalCounts = [];
  const finalSums = [];
  const segmentMap = new Int16Array(totalPixels);
  segmentMap.fill(-1);

  for (let index = 0; index < totalPixels; index += 1) {
    const mergedIndex = remap[rawAssignments[index]];
    let finalIndex = finalKeyToIndex.get(mergedIndex);
    if (finalIndex === undefined) {
      finalIndex = finalPalette.length;
      finalKeyToIndex.set(mergedIndex, finalIndex);
      finalPalette.push({ r: 0, g: 0, b: 0 });
      finalCounts.push(0);
      finalSums.push({ r: 0, g: 0, b: 0 });
    }

    const offset = index * 3;
    finalSums[finalIndex].r += segmentPixels[offset];
    finalSums[finalIndex].g += segmentPixels[offset + 1];
    finalSums[finalIndex].b += segmentPixels[offset + 2];
    finalCounts[finalIndex] += 1;
    segmentMap[index] = finalIndex;
  }

  finalPalette.forEach((color, index) => {
    color.r = Math.round(finalSums[index].r / Math.max(1, finalCounts[index]));
    color.g = Math.round(finalSums[index].g / Math.max(1, finalCounts[index]));
    color.b = Math.round(finalSums[index].b / Math.max(1, finalCounts[index]));
  });

  const splitSegments = splitDisconnectedSegments(
    segmentMap,
    width,
    height,
    finalPalette,
  );
  const filteredSegments = filterSegmentsWithoutDepth(
    splitSegments.segmentMap,
    splitSegments.palette,
    splitSegments.pixelCounts,
    depthPixels,
  );
  const cleanedSegments = filterSmallSegments(
    filteredSegments.segmentMap,
    filteredSegments.palette,
    filteredSegments.pixelCounts,
    2,
  );

  const order = cleanedSegments.palette
    .map((_, index) => index)
    .sort((a, b) => cleanedSegments.pixelCounts[b] - cleanedSegments.pixelCounts[a]);
  const orderedPalette = order.map((index) => cleanedSegments.palette[index]);
  const orderedCounts = order.map((index) => cleanedSegments.pixelCounts[index]);
  const orderedMap = new Int16Array(totalPixels);
  orderedMap.fill(-1);
  const orderRemap = new Map(order.map((originalIndex, sortedIndex) => [originalIndex, sortedIndex]));

  for (let index = 0; index < totalPixels; index += 1) {
    if (cleanedSegments.segmentMap[index] < 0) {
      continue;
    }
    orderedMap[index] = orderRemap.get(cleanedSegments.segmentMap[index]);
  }

  return {
    count: orderedPalette.length,
    palette: orderedPalette,
    pixelCounts: orderedCounts,
    segmentMap: orderedMap,
    segmentPixels: buildSegmentPixelLists(orderedMap, orderedPalette.length),
    segmentBounds: buildSegmentBounds(orderedMap, orderedPalette.length, width, height),
    segmentData: buildSegmentLocalData(
      orderedMap,
      orderedPalette.length,
      width,
      height,
      depthPixels,
    ),
  };
}

function buildSegmentPixelLists(segmentMap, segmentCount) {
  const lists = Array.from({ length: segmentCount }, () => []);

  for (let index = 0; index < segmentMap.length; index += 1) {
    const segmentIndex = segmentMap[index];
    if (segmentIndex < 0) {
      continue;
    }
    lists[segmentIndex].push(index);
  }

  return lists.map((indices) => Int32Array.from(indices));
}

function buildSegmentBounds(segmentMap, segmentCount, width, height) {
  const bounds = Array.from({ length: segmentCount }, () => ({
    minX: width,
    minY: height,
    maxX: -1,
    maxY: -1,
  }));

  for (let index = 0; index < segmentMap.length; index += 1) {
    const segmentIndex = segmentMap[index];
    if (segmentIndex < 0) {
      continue;
    }

    const x = index % width;
    const y = Math.floor(index / width);
    const bound = bounds[segmentIndex];
    bound.minX = Math.min(bound.minX, x);
    bound.minY = Math.min(bound.minY, y);
    bound.maxX = Math.max(bound.maxX, x);
    bound.maxY = Math.max(bound.maxY, y);
  }

  return bounds.map((bound) => (
    bound.maxX < 0
      ? { minX: 0, minY: 0, maxX: -1, maxY: -1 }
      : bound
  ));
}

function buildSegmentLocalData(segmentMap, segmentCount, width, height, depthPixels) {
  const pixelLists = buildSegmentPixelLists(segmentMap, segmentCount);
  const bounds = buildSegmentBounds(segmentMap, segmentCount, width, height);

  return pixelLists.map((indices, segmentIndex) => {
    const boundsForSegment = bounds[segmentIndex];
    if (!indices.length || boundsForSegment.maxX < boundsForSegment.minX) {
      return {
        indices,
        bounds: boundsForSegment,
        localWidth: 0,
        localHeight: 0,
        localDepthPixels: new Uint8Array(0),
        localMask: new Uint8Array(0),
        processedLocalDepthPixels: new Uint8Array(0),
        hasSourceDepth: false,
      };
    }

    const localWidth = boundsForSegment.maxX - boundsForSegment.minX + 1;
    const localHeight = boundsForSegment.maxY - boundsForSegment.minY + 1;
    const localDepthPixels = new Uint8Array(localWidth * localHeight);
    const localMask = new Uint8Array(localWidth * localHeight);
    let hasSourceDepth = false;

    for (let i = 0; i < indices.length; i += 1) {
      const pixelIndex = indices[i];
      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      const localIndex = (y - boundsForSegment.minY) * localWidth + (x - boundsForSegment.minX);
      const depth = depthPixels[pixelIndex];
      localMask[localIndex] = 1;
      localDepthPixels[localIndex] = depth;
      if (depth > 0) {
        hasSourceDepth = true;
      }
    }

    return {
      indices,
      bounds: boundsForSegment,
      localWidth,
      localHeight,
      localDepthPixels,
      localMask,
      processedLocalDepthPixels: localDepthPixels.slice(),
      hasSourceDepth,
    };
  });
}

function preprocessSegmentDepths(width, height, segmentData) {
  const processedPixels = new Uint8Array(width * height);
  const nextSegmentData = segmentData.map((segment) => {
    if (!segment.hasSourceDepth || !segment.localDepthPixels.length) {
      return segment;
    }

    const processedLocalDepthPixels = preprocessSegmentLocalDepth(
      segment.localDepthPixels,
      segment.localMask,
      segment.localWidth,
      segment.localHeight,
    );

    for (let i = 0; i < segment.indices.length; i += 1) {
      const pixelIndex = segment.indices[i];
      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      const localIndex = (y - segment.bounds.minY) * segment.localWidth + (x - segment.bounds.minX);
      processedPixels[pixelIndex] = processedLocalDepthPixels[localIndex];
    }

    return {
      ...segment,
      processedLocalDepthPixels,
    };
  });

  const resources = createDepthTextureResources(width, height, processedPixels);
  return {
    segmentData: nextSegmentData,
    pixels: processedPixels,
    texture: resources.texture,
  };
}

function preprocessSegmentLocalDepth(sourcePixels, mask, width, height) {
  const boundaryCorrected = correctSegmentBoundaryDepthLeakage(sourcePixels, mask, width, height);
  const median = applyMaskedMedianFilter(boundaryCorrected, mask, width, height, 1);
  const blurKernel = getDepthBlurKernel(1);
  const blurred = applyMaskedBlurFilter(median, mask, width, height, 1, blurKernel);
  const sharpened = applyMaskedUnsharpFilter(median, blurred, mask, 0.65);
  const despiked = suppressMaskedDepthSpikes(sharpened, mask, width, height, 2);
  return enforceMaskedDepthContinuity(despiked, mask, width, height, 3);
}

function correctSegmentBoundaryDepthLeakage(sourcePixels, mask, width, height) {
  const output = sourcePixels.slice();
  const boundaryMask = buildBoundaryMask(mask, width, height);
  let trustedMask = erodeMask(mask, width, height, 2);

  if (!trustedMask.some(Boolean)) {
    trustedMask = erodeMask(mask, width, height, 1);
  }
  if (!trustedMask.some(Boolean)) {
    trustedMask = mask;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!boundaryMask[index]) {
        continue;
      }

      const stats = sampleMaskedDepthStats(sourcePixels, trustedMask, width, height, x, y, 3);
      if (!stats) {
        continue;
      }

      const currentDepth = sourcePixels[index];
      const deviationLimit = Math.max(10, stats.mad * 3 + 6);
      if (currentDepth <= 0 || Math.abs(currentDepth - stats.median) > deviationLimit) {
        output[index] = stats.median;
      }
    }
  }

  return output;
}

function buildBoundaryMask(mask, width, height) {
  const boundary = new Uint8Array(mask.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index]) {
        continue;
      }

      if (
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        !mask[index - 1] ||
        !mask[index + 1] ||
        !mask[index - width] ||
        !mask[index + width]
      ) {
        boundary[index] = 1;
      }
    }
  }

  return boundary;
}

function erodeMask(mask, width, height, iterations) {
  let current = mask.slice();

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = new Uint8Array(mask.length);

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        if (
          current[index] &&
          current[index - 1] &&
          current[index + 1] &&
          current[index - width] &&
          current[index + width]
        ) {
          next[index] = 1;
        }
      }
    }

    current = next;
  }

  return current;
}

function sampleMaskedDepthStats(sourcePixels, mask, width, height, centerX, centerY, radius) {
  const samples = [];

  for (let oy = -radius; oy <= radius; oy += 1) {
    const y = centerY + oy;
    if (y < 0 || y >= height) {
      continue;
    }

    for (let ox = -radius; ox <= radius; ox += 1) {
      const x = centerX + ox;
      if (x < 0 || x >= width) {
        continue;
      }

      const index = y * width + x;
      if (!mask[index] || sourcePixels[index] <= 0) {
        continue;
      }
      samples.push(sourcePixels[index]);
    }
  }

  if (samples.length === 0) {
    return null;
  }

  samples.sort((a, b) => a - b);
  const median = samples[(samples.length - 1) >> 1];
  const deviations = samples.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  const mad = deviations[(deviations.length - 1) >> 1];

  return { median, mad };
}

function suppressMaskedDepthSpikes(sourcePixels, mask, width, height, passes) {
  let current = sourcePixels.slice();

  for (let pass = 0; pass < passes; pass += 1) {
    const next = current.slice();

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!mask[index] || current[index] <= 0) {
          continue;
        }

        const stats = sampleMaskedDepthStats(current, mask, width, height, x, y, 1);
        if (!stats) {
          continue;
        }

        const edgeAwareStats = sampleMaskedDepthStats(current, mask, width, height, x, y, 2) || stats;
        const deviation = Math.abs(current[index] - stats.median);
        const localLimit = Math.max(8, stats.mad * 2 + 4, edgeAwareStats.mad * 2 + 4);

        if (deviation > localLimit) {
          next[index] = stats.median;
        }
      }
    }

    current = next;
  }

  return current;
}

function enforceMaskedDepthContinuity(sourcePixels, mask, width, height, passes) {
  let current = sourcePixels.slice();

  for (let pass = 0; pass < passes; pass += 1) {
    const next = current.slice();

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!mask[index] || current[index] <= 0) {
          continue;
        }

        const neighbors = collectMaskedNeighborDepths(current, mask, width, height, x, y);
        if (neighbors.length < 2) {
          continue;
        }

        neighbors.sort((a, b) => a - b);
        const neighborMedian = neighbors[(neighbors.length - 1) >> 1];
        const deviations = neighbors.map((value) => Math.abs(value - neighborMedian)).sort((a, b) => a - b);
        const neighborMad = deviations[(deviations.length - 1) >> 1];
        const maxStep = Math.max(6, neighborMad * 2 + 3);
        const currentDepth = current[index];
        const delta = currentDepth - neighborMedian;

        if (Math.abs(delta) > maxStep) {
          next[index] = clamp(Math.round(neighborMedian + Math.sign(delta) * maxStep), 0, 255);
          continue;
        }

        const minNeighbor = neighbors[0];
        const maxNeighbor = neighbors[neighbors.length - 1];
        if (currentDepth < minNeighbor - maxStep || currentDepth > maxNeighbor + maxStep) {
          next[index] = clamp(Math.round(neighborMedian), 0, 255);
        }
      }
    }

    current = next;
  }

  return current;
}

function collectMaskedNeighborDepths(sourcePixels, mask, width, height, x, y) {
  const neighbors = [];
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];

  for (const [dx, dy] of offsets) {
    const sx = x + dx;
    const sy = y + dy;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      continue;
    }

    const sampleIndex = sy * width + sx;
    if (!mask[sampleIndex] || sourcePixels[sampleIndex] <= 0) {
      continue;
    }
    neighbors.push(sourcePixels[sampleIndex]);
  }

  return neighbors;
}

function applyMaskedMedianFilter(sourcePixels, mask, width, height, radius) {
  const output = new Uint8Array(sourcePixels.length);
  const samples = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index]) {
        continue;
      }

      if (sourcePixels[index] <= 0) {
        output[index] = 0;
        continue;
      }

      samples.length = 0;
      for (let oy = -radius; oy <= radius; oy += 1) {
        const sy = y + oy;
        if (sy < 0 || sy >= height) {
          continue;
        }

        for (let ox = -radius; ox <= radius; ox += 1) {
          const sx = x + ox;
          if (sx < 0 || sx >= width) {
            continue;
          }

          const sampleIndex = sy * width + sx;
          if (!mask[sampleIndex] || sourcePixels[sampleIndex] <= 0) {
            continue;
          }
          samples.push(sourcePixels[sampleIndex]);
        }
      }

      if (samples.length === 0) {
        output[index] = sourcePixels[index];
        continue;
      }

      samples.sort((a, b) => a - b);
      output[index] = samples[(samples.length - 1) >> 1];
    }
  }

  return output;
}

function applyMaskedBlurFilter(sourcePixels, mask, width, height, radius, kernel) {
  const output = new Uint8Array(sourcePixels.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index]) {
        continue;
      }

      if (sourcePixels[index] <= 0) {
        output[index] = 0;
        continue;
      }

      let weightedSum = 0;
      let weightTotal = 0;

      for (let oy = -radius; oy <= radius; oy += 1) {
        const sy = y + oy;
        if (sy < 0 || sy >= height) {
          continue;
        }

        for (let ox = -radius; ox <= radius; ox += 1) {
          const sx = x + ox;
          if (sx < 0 || sx >= width) {
            continue;
          }

          const sampleIndex = sy * width + sx;
          if (!mask[sampleIndex] || sourcePixels[sampleIndex] <= 0) {
            continue;
          }

          const kernelIndex = (oy + radius) * (radius * 2 + 1) + (ox + radius);
          const weight = kernel[kernelIndex];
          weightedSum += sourcePixels[sampleIndex] * weight;
          weightTotal += weight;
        }
      }

      output[index] = weightTotal > 0
        ? Math.round(weightedSum / weightTotal)
        : sourcePixels[index];
    }
  }

  return output;
}

function applyMaskedUnsharpFilter(basePixels, blurredPixels, mask, amount) {
  const output = new Uint8Array(basePixels.length);

  for (let index = 0; index < basePixels.length; index += 1) {
    if (!mask[index] || basePixels[index] <= 0) {
      output[index] = basePixels[index];
      continue;
    }

    const enhanced = basePixels[index] + (basePixels[index] - blurredPixels[index]) * amount;
    output[index] = clamp(Math.round(enhanced), 0, 255);
  }

  return output;
}

function getDepthBlurKernel(radius) {
  const cached = depthBlurKernelCache.get(radius);
  if (cached) {
    return cached;
  }

  const kernel = createGaussianKernel(radius);
  depthBlurKernelCache.set(radius, kernel);
  return kernel;
}

function splitDisconnectedSegments(segmentMap, width, height, palette) {
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const splitMap = new Int16Array(totalPixels);
  splitMap.fill(-1);
  const splitPalette = [];
  const splitCounts = [];
  const queue = new Int32Array(totalPixels);

  for (let start = 0; start < totalPixels; start += 1) {
    const sourceSegment = segmentMap[start];
    if (sourceSegment < 0 || visited[start]) {
      continue;
    }

    const nextSegmentIndex = splitPalette.length;
    splitPalette.push({ ...palette[sourceSegment] });
    splitCounts.push(0);
    visited[start] = 1;
    queue[0] = start;
    let head = 0;
    let tail = 1;

    while (head < tail) {
      const index = queue[head++];
      splitMap[index] = nextSegmentIndex;
      splitCounts[nextSegmentIndex] += 1;

      const x = index % width;
      const y = Math.floor(index / width);

      if (x > 0) {
        const left = index - 1;
        if (!visited[left] && segmentMap[left] === sourceSegment) {
          visited[left] = 1;
          queue[tail++] = left;
        }
      }

      if (x + 1 < width) {
        const right = index + 1;
        if (!visited[right] && segmentMap[right] === sourceSegment) {
          visited[right] = 1;
          queue[tail++] = right;
        }
      }

      if (y > 0) {
        const up = index - width;
        if (!visited[up] && segmentMap[up] === sourceSegment) {
          visited[up] = 1;
          queue[tail++] = up;
        }
      }

      if (y + 1 < height) {
        const down = index + width;
        if (!visited[down] && segmentMap[down] === sourceSegment) {
          visited[down] = 1;
          queue[tail++] = down;
        }
      }
    }
  }

  return {
    segmentMap: splitMap,
    palette: splitPalette,
    pixelCounts: splitCounts,
  };
}

function filterSegmentsWithoutDepth(segmentMap, palette, pixelCounts, depthPixels) {
  const hasDepth = new Uint8Array(palette.length);

  for (let index = 0; index < segmentMap.length; index += 1) {
    const segmentIndex = segmentMap[index];
    if (segmentIndex < 0 || depthPixels[index] <= 0) {
      continue;
    }
    hasDepth[segmentIndex] = 1;
  }

  const remap = new Int16Array(palette.length);
  remap.fill(-1);
  const filteredPalette = [];
  const filteredCounts = [];

  for (let index = 0; index < palette.length; index += 1) {
    if (!hasDepth[index]) {
      continue;
    }

    remap[index] = filteredPalette.length;
    filteredPalette.push(palette[index]);
    filteredCounts.push(pixelCounts[index]);
  }

  const filteredMap = new Int16Array(segmentMap.length);
  filteredMap.fill(-1);

  for (let index = 0; index < segmentMap.length; index += 1) {
    const segmentIndex = segmentMap[index];
    if (segmentIndex < 0) {
      continue;
    }
    filteredMap[index] = remap[segmentIndex];
  }

  return {
    segmentMap: filteredMap,
    palette: filteredPalette,
    pixelCounts: filteredCounts,
  };
}

function filterSmallSegments(segmentMap, palette, pixelCounts, maxSegmentSize) {
  const remap = new Int16Array(palette.length);
  remap.fill(-1);
  const filteredPalette = [];
  const filteredCounts = [];

  for (let index = 0; index < palette.length; index += 1) {
    if (pixelCounts[index] <= maxSegmentSize) {
      continue;
    }

    remap[index] = filteredPalette.length;
    filteredPalette.push(palette[index]);
    filteredCounts.push(pixelCounts[index]);
  }

  const filteredMap = new Int16Array(segmentMap.length);
  filteredMap.fill(-1);

  for (let index = 0; index < segmentMap.length; index += 1) {
    const segmentIndex = segmentMap[index];
    if (segmentIndex < 0) {
      continue;
    }
    filteredMap[index] = remap[segmentIndex];
  }

  return {
    segmentMap: filteredMap,
    palette: filteredPalette,
    pixelCounts: filteredCounts,
  };
}

function findNearestPaletteColor(color, palette, activeFlags = null) {
  if (palette.length === 0) {
    return null;
  }

  let nearestIndex = -1;
  let nearestDistance = Infinity;

  for (let i = 0; i < palette.length; i += 1) {
    if (activeFlags && !activeFlags[i]) {
      continue;
    }

    const distance = colorDistanceSquared(color, palette[i]);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = i;
    }
  }

  if (nearestIndex < 0) {
    return null;
  }

  return {
    index: nearestIndex,
    distance2: nearestDistance,
    anchor: palette[nearestIndex],
  };
}

function colorDistanceSquared(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

function rebuildSegmentList() {
  segmentListEl.textContent = "";

  renderState.segmentPalette.forEach((color, index) => {
    const row = document.createElement("div");
    row.className = "segment-item";
    row.dataset.segmentIndex = String(index);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.dataset.segmentIndex = String(index);
    checkbox.tabIndex = -1;
    checkbox.style.pointerEvents = "none";

    row.addEventListener("click", (event) => {
      const segmentIndex = Number(row.dataset.segmentIndex);
      applySegmentToggle(segmentIndex, event.shiftKey);
    });

    const swatch = document.createElement("span");
    swatch.className = "segment-swatch";
    swatch.style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;

    const name = document.createElement("span");
    name.className = "segment-name";
    name.textContent = `Part ${index + 1}`;

    const size = document.createElement("span");
    size.className = "segment-size";
    size.textContent = renderState.segmentPixelCounts[index].toLocaleString();

    const controls = document.createElement("div");
    controls.className = "segment-controls";

    const offsetDown = createSegmentControlButton("-", "offset-down", index);
    const offsetUp = createSegmentControlButton("+", "offset-up", index);
    const scaleDown = createSegmentControlButton("<", "scale-down", index);
    const scaleUp = createSegmentControlButton(">", "scale-up", index);
    const metrics = document.createElement("span");
    metrics.className = "segment-metrics";
    metrics.dataset.segmentMetrics = String(index);

    controls.append(offsetDown, offsetUp, scaleDown, scaleUp, metrics);

    row.append(checkbox, swatch, name, size, controls);
    segmentListEl.appendChild(row);
  });

  syncSegmentAdjustmentLabels();
}

function createSegmentControlButton(label, action, segmentIndex) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "segment-button";
  button.textContent = label;
  button.dataset.segmentAction = action;
  button.dataset.segmentIndex = String(segmentIndex);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    applySegmentDepthAdjustment(action, segmentIndex);
  });
  return button;
}

function applySegmentToggle(segmentIndex, invertOthers) {
  if (invertOthers) {
    const nextTargetState = !renderState.segmentVisibility[segmentIndex];
    renderState.segmentVisibility = renderState.segmentVisibility.map((_, index) => (
      index === segmentIndex ? nextTargetState : !nextTargetState
    ));
  } else {
    renderState.segmentVisibility[segmentIndex] = !renderState.segmentVisibility[segmentIndex];
  }

  syncSegmentCheckboxes();
  updateSegmentMaskTexture();
  refreshStatusCounts();
}

function syncSegmentCheckboxes() {
  const checkboxes = segmentListEl.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach((checkbox) => {
    const index = Number(checkbox.dataset.segmentIndex);
    checkbox.checked = renderState.segmentVisibility[index];
  });
}

function syncSegmentAdjustmentLabels() {
  const labels = segmentListEl.querySelectorAll("[data-segment-metrics]");
  labels.forEach((label) => {
    const index = Number(label.dataset.segmentMetrics);
    label.textContent = `o${renderState.segmentDepthOffsets[index]} s${renderState.segmentDepthScales[index].toFixed(2)}`;
  });
}

function applySegmentDepthAdjustment(action, segmentIndex) {
  if (action === "offset-down") {
    renderState.segmentDepthOffsets[segmentIndex] -= segmentDepthOffsetStep;
  } else if (action === "offset-up") {
    renderState.segmentDepthOffsets[segmentIndex] += segmentDepthOffsetStep;
  } else if (action === "scale-down") {
    renderState.segmentDepthScales[segmentIndex] = Math.max(
      0.1,
      Number((renderState.segmentDepthScales[segmentIndex] - segmentDepthScaleStep).toFixed(2)),
    );
  } else if (action === "scale-up") {
    renderState.segmentDepthScales[segmentIndex] = Number(
      (renderState.segmentDepthScales[segmentIndex] + segmentDepthScaleStep).toFixed(2),
    );
  }

  syncSegmentAdjustmentLabels();
  applySegmentDepthAdjustments();
  buildMesh();
}

function applySegmentDepthAdjustments() {
  disposeAdjustedDepthTexture();

  if (!renderState.baseDepthPixels) {
    return;
  }

  const adjustedPixels = new Uint8Array(renderState.baseDepthPixels.length);

  for (let index = 0; index < renderState.baseDepthPixels.length; index += 1) {
    const baseDepth = renderState.baseDepthPixels[index];
    const segmentIndex = renderState.segmentMap[index];
    if (baseDepth <= 0 || segmentIndex < 0) {
      adjustedPixels[index] = 0;
      continue;
    }

    const scaled = baseDepth * renderState.segmentDepthScales[segmentIndex];
    const shifted = scaled + renderState.segmentDepthOffsets[segmentIndex];
    adjustedPixels[index] = clamp(Math.round(shifted), 1, 255);
  }

  const adjusted = createDepthTextureResources(
    renderState.imageWidth,
    renderState.imageHeight,
    adjustedPixels,
  );

  renderState.adjustedDepthTexture = adjusted.texture;
  renderState.activeDepthTexture = adjusted.texture;
  renderState.activeDepthPixels = adjusted.pixels;
}

function updateSegmentMaskTexture() {
  if (!renderState.segmentMaskData || !renderState.segmentMaskTexture) {
    return;
  }

  for (let i = 0; i < renderState.segmentMap.length; i += 1) {
    const segmentIndex = renderState.segmentMap[i];
    renderState.segmentMaskData[i] = segmentIndex >= 0 && renderState.segmentVisibility[segmentIndex]
      ? 255
      : 0;
  }

  renderState.segmentMaskTexture.needsUpdate = true;
  if (renderState.material) {
    renderState.material.uniforms.uSegmentMaskTexture.value = renderState.segmentMaskTexture;
  }
}

function disposeSegmentMaskTexture() {
  if (renderState.segmentMaskTexture) {
    renderState.segmentMaskTexture.dispose();
    renderState.segmentMaskTexture = null;
  }
}

function createSegmentedGridDepthResources(
  width,
  height,
  segmentData,
  specMode,
  gridX,
  gridY,
  kernelSize,
  interpMode,
) {
  const pixels = new Uint8Array(width * height);
  const gridSpec = createGridSpec(width, height, specMode, gridX, gridY, kernelSize);
  const kernel = createGaussianKernel(gridSpec.radius);

  for (let segmentIndex = 0; segmentIndex < segmentData.length; segmentIndex += 1) {
    const segment = segmentData[segmentIndex];
    if (!segment || !segment.indices.length || !segment.hasSourceDepth) {
      continue;
    }

    writeSegmentGridDepthPixels(
      width,
      segment,
      gridSpec,
      kernel,
      interpMode,
      pixels,
    );
  }

  return createDepthTextureResources(width, height, pixels);
}

function createGridDepthResources(width, height, sourcePixels, specMode, gridX, gridY, kernelSize, interpMode) {
  const gridSpec = createGridSpec(width, height, specMode, gridX, gridY, kernelSize);
  const kernel = createGaussianKernel(gridSpec.radius);
  const pixels = createGridDepthPixels(width, height, sourcePixels, gridSpec, kernel, interpMode);
  return createDepthTextureResources(width, height, pixels);
}

function createGridSpec(width, height, specMode, gridX, gridY, kernelSize) {
  const gridWidth = specMode === "size"
    ? Math.max(2, Math.ceil((width - 1) / Math.max(1, gridX)) + 1)
    : Math.max(2, gridX + 1);
  const gridHeight = specMode === "size"
    ? Math.max(2, Math.ceil((height - 1) / Math.max(1, gridY)) + 1)
    : Math.max(2, gridY + 1);

  return {
    gridWidth,
    gridHeight,
    radius: Math.max(1, Math.floor(kernelSize / 2)),
  };
}

function createGridDepthPixels(width, height, sourcePixels, gridSpec, kernel, interpMode) {
  const pixels = new Uint8Array(width * height);
  const { gridWidth, gridHeight, radius } = gridSpec;
  const controlValues = new Float32Array(gridWidth * gridHeight);
  const controlValid = new Uint8Array(gridWidth * gridHeight);

  for (let gy = 0; gy < gridHeight; gy += 1) {
    const py = sampleGridPosition(gy, gridHeight, height);
    for (let gx = 0; gx < gridWidth; gx += 1) {
      const px = sampleGridPosition(gx, gridWidth, width);
      const sample = convolveDepthAt(sourcePixels, width, height, px, py, radius, kernel);
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
      pixels[pixelIndex] = rounded;
    }
  }

  return pixels;
}

function writeSegmentGridDepthPixels(
  imageWidth,
  segment,
  gridSpec,
  kernel,
  interpMode,
  outputPixels,
) {
  const {
    indices,
    bounds,
    localWidth,
    localHeight,
    processedLocalDepthPixels,
  } = segment;
  const { gridWidth, gridHeight, radius } = gridSpec;
  const controlValues = new Float32Array(gridWidth * gridHeight);
  const controlValid = new Uint8Array(gridWidth * gridHeight);

  for (let gy = 0; gy < gridHeight; gy += 1) {
    const py = sampleGridPositionInBounds(gy, gridHeight, bounds.minY, bounds.maxY);
    for (let gx = 0; gx < gridWidth; gx += 1) {
      const px = sampleGridPositionInBounds(gx, gridWidth, bounds.minX, bounds.maxX);
      const sample = convolveDepthAtBounds(
        processedLocalDepthPixels,
        localWidth,
        localHeight,
        px - bounds.minX,
        py - bounds.minY,
        radius,
        kernel,
      );
      const index = gy * gridWidth + gx;
      controlValues[index] = sample.value;
      controlValid[index] = sample.valid ? 1 : 0;
    }
  }

  const boundWidth = Math.max(1, bounds.maxX - bounds.minX);
  const boundHeight = Math.max(1, bounds.maxY - bounds.minY);

  for (let i = 0; i < indices.length; i += 1) {
    const pixelIndex = indices[i];
    const x = pixelIndex % imageWidth;
    const y = Math.floor(pixelIndex / imageWidth);
    const fx = ((x - bounds.minX) / boundWidth) * (gridWidth - 1);
    const fy = ((y - bounds.minY) / boundHeight) * (gridHeight - 1);
    const value = interpMode === "cubic"
      ? sampleCubicGrid(controlValues, controlValid, gridWidth, gridHeight, fx, fy)
      : sampleLinearGrid(controlValues, controlValid, gridWidth, gridHeight, fx, fy);
    outputPixels[pixelIndex] = Math.max(0, Math.min(255, Math.round(value)));
  }
}

function createGaussianKernel(radius) {
  const cached = gaussianKernelCache.get(radius);
  if (cached) {
    return cached;
  }

  const size = radius * 2 + 1;
  const kernel = new Float32Array(size * size);
  const sigma = Math.max(1, radius * 0.5);
  let index = 0;

  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      const distance2 = x * x + y * y;
      kernel[index++] = Math.exp(-distance2 / (2 * sigma * sigma));
    }
  }

  gaussianKernelCache.set(radius, kernel);
  return kernel;
}

function createDepthTextureResources(width, height, pixels) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const imageData = context.createImageData(width, height);

  for (let pixelIndex = 0; pixelIndex < pixels.length; pixelIndex += 1) {
    const rounded = pixels[pixelIndex];
    const imageIndex = pixelIndex * 4;
    imageData.data[imageIndex] = rounded;
    imageData.data[imageIndex + 1] = rounded;
    imageData.data[imageIndex + 2] = rounded;
    imageData.data[imageIndex + 3] = rounded > 0 ? 255 : 0;
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

function sampleGridPositionInBounds(index, count, min, max) {
  if (count <= 1 || max <= min) {
    return min;
  }

  return Math.round(min + (index / (count - 1)) * (max - min));
}

function convolveDepthAt(sourcePixels, width, height, centerX, centerY, radius, kernel) {
  let weightedSum = 0;
  let weightTotal = 0;

  for (let oy = -radius; oy <= radius; oy += 1) {
    const y = centerY + oy;
    if (y < 0 || y >= height) {
      continue;
    }

    for (let ox = -radius; ox <= radius; ox += 1) {
      const x = centerX + ox;
      if (x < 0 || x >= width) {
        continue;
      }

      const value = sourcePixels[y * width + x];
      if (value <= 0) {
        continue;
      }

      const kernelIndex = (oy + radius) * (radius * 2 + 1) + (ox + radius);
      const weight = kernel[kernelIndex];
      weightedSum += value * weight;
      weightTotal += weight;
    }
  }

  if (weightTotal === 0) {
    return { value: 0, valid: false };
  }

  return { value: weightedSum / weightTotal, valid: true };
}

function convolveDepthAtBounds(sourcePixels, width, height, centerX, centerY, radius, kernel) {
  let weightedSum = 0;
  let weightTotal = 0;

  for (let oy = -radius; oy <= radius; oy += 1) {
    const y = centerY + oy;
    if (y < 0 || y >= height) {
      continue;
    }

    for (let ox = -radius; ox <= radius; ox += 1) {
      const x = centerX + ox;
      if (x < 0 || x >= width) {
        continue;
      }

      const value = sourcePixels[y * width + x];
      if (value <= 0) {
        continue;
      }

      const kernelIndex = (oy + radius) * (radius * 2 + 1) + (ox + radius);
      const weight = kernel[kernelIndex];
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
