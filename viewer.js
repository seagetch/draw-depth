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
  segmentSourcePixels: null,
  segmentMap: null,
  segmentCount: 0,
  segmentPalette: [],
  segmentPixelCounts: [],
  segmentVisibility: [],
  segmentMaskData: null,
  segmentMaskTexture: null,
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
  };
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

    row.append(checkbox, swatch, name, size);
    segmentListEl.appendChild(row);
  });
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
