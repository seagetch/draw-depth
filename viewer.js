const app = document.querySelector("#app");
const statusEl = document.querySelector("#status");
const depthScaleEl = document.querySelector("#depthScale");
const depthScaleValueEl = document.querySelector("#depthScaleValue");
const meshDetailEl = document.querySelector("#meshDetail");
const meshDetailValueEl = document.querySelector("#meshDetailValue");
const depthDiscontinuityEl = document.querySelector("#depthDiscontinuity");
const depthDiscontinuityValueEl = document.querySelector("#depthDiscontinuityValue");
const invertDepthEl = document.querySelector("#invertDepth");
const sourceModeEl = document.querySelector("#sourceMode");
const contourRepairEl = document.querySelector("#contourRepair");
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
const segmentHudEl = document.querySelector("#segmentHud");
const colorThumbButtonEl = document.querySelector("#colorThumbButton");
const depthThumbButtonEl = document.querySelector("#depthThumbButton");
const segmentThumbButtonEl = document.querySelector("#segmentThumbButton");
const colorThumbEl = document.querySelector("#colorThumb");
const depthThumbEl = document.querySelector("#depthThumb");
const segmentThumbEl = document.querySelector("#segmentThumb");
const colorFileInputEl = document.querySelector("#colorFileInput");
const depthFileInputEl = document.querySelector("#depthFileInput");
const segmentFileInputEl = document.querySelector("#segmentFileInput");
const psdDebugPanelEl = document.querySelector("#psdDebugPanel");
const psdDebugTitleEl = document.querySelector("#psdDebugTitle");
const psdDebugImageEl = document.querySelector("#psdDebugImage");

const colorUrl = "./data/Midori-color.jpg";
const depthUrl = "./data/Midori-depth.jpg";
const segmentUrl = "./data/Midori-segment.jpg";
const psdColorUrl = "./data/Midori-color.psd";
const psdDepthUrl = "./data/Midori-color_depth.psd";
const psdStableDepthUrl = "./data/Midori-depth-st.png";
const cacheBustToken = `${Date.now()}`;
const defaultColorUrl = withCacheBust(colorUrl);
const defaultDepthUrl = withCacheBust(depthUrl);
const defaultSegmentUrl = withCacheBust(segmentUrl);
const defaultPsdColorUrl = withCacheBust(psdColorUrl);
const defaultPsdDepthUrl = withCacheBust(psdDepthUrl);
const defaultPsdStableDepthUrl = withCacheBust(psdStableDepthUrl);
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
initializePsdSupport();

const renderState = {
  colorTexture: null,
  sourceDepthTexture: null,
  sourceDepthPixels: null,
  processedDepthTexture: null,
  processedDepthPixels: null,
  rawDepthTexture: null,
  rawDepthPixels: null,
  baseDepthTexture: null,
  baseDepthPixels: null,
  repairedBaseDepthTexture: null,
  repairedBaseDepthPixels: null,
  repairedBaseGapMask: null,
  adjustedDepthTexture: null,
  activeDepthTexture: null,
  activeDepthPixels: null,
  meshDepthTexture: null,
  meshDepthPixels: null,
  meshGapMask: null,
  imageWidth: 0,
  imageHeight: 0,
  rasterImageWidth: 0,
  rasterImageHeight: 0,
  mesh: null,
  material: null,
  edgePoints: null,
  edgePointMaterial: null,
  colorObjectUrl: null,
  depthObjectUrl: null,
  segmentObjectUrl: null,
  segmentThumbUrl: "",
  generatedDepthTexture: null,
  segmentSourcePixels: null,
  sourceMode: "psd",
  segmentMap: null,
  segmentCount: 0,
  segmentPalette: [],
  segmentPixelCounts: [],
  segmentVisibility: [],
  segmentDepthOffsets: [],
  segmentDepthScales: [],
  segmentDepthMeans: [],
  segmentPixels: [],
  segmentBounds: [],
  segmentData: [],
  rawSegmentData: [],
  segmentMaskData: null,
  segmentMaskTexture: null,
  psdColorDocument: null,
  psdDepthDocument: null,
  psdLayerEntries: [],
  psdLayerMeshes: [],
  psdLayerVisibility: [],
  psdLayerDepthOffsets: [],
  psdLayerDepthScales: [],
  psdDebugLayerIndex: -1,
  psdColorPreviewUrl: "",
  psdDepthPreviewUrl: "",
  psdStableDepthPixels: null,
  psdStableDepthWidth: 0,
  psdStableDepthHeight: 0,
  pendingPsdColorBuffer: null,
  pendingPsdDepthBuffer: null,
};

const gaussianKernelCache = new Map();
const depthBlurKernelCache = new Map();
const relativeDepthFactor = 0.12;
const relativeDepthFloor = 24;
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

const pointVertexShader = `
  uniform sampler2D uDepthTexture;
  uniform float uDepthScale;
  uniform float uInvertDepth;
  uniform float uPointSize;
  varying vec2 vUv;
  varying float vDepthMask;

  void main() {
    vUv = uv;

    float rawDepth = texture2D(uDepthTexture, uv).r;
    vDepthMask = step(${invalidDepthThreshold.toFixed(8)}, rawDepth);

    float depthValue = mix(rawDepth, 1.0 - rawDepth, uInvertDepth);
    vec3 displaced = position;
    displaced.z += depthValue * uDepthScale * vDepthMask;

    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uPointSize;
  }
`;

const pointFragmentShader = `
  uniform sampler2D uSegmentMaskTexture;
  varying vec2 vUv;
  varying float vDepthMask;

  void main() {
    if (vDepthMask < 0.5 || texture2D(uSegmentMaskTexture, vUv).r < 0.5) {
      discard;
    }

    vec2 centered = gl_PointCoord - vec2(0.5);
    if (dot(centered, centered) > 0.25) {
      discard;
    }

    gl_FragColor = vec4(1.0, 0.1, 0.1, 1.0);
  }
`;

const psdLayerVertexShader = `
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

const psdLayerFragmentShader = `
  uniform sampler2D uColorTexture;
  uniform sampler2D uMaskTexture;
  varying vec2 vUv;
  varying float vDepthMask;

  void main() {
    if (vDepthMask < 0.5 || texture2D(uMaskTexture, vUv).r < 0.5) {
      discard;
    }
    vec4 color = texture2D(uColorTexture, vUv);
    if (color.a < 0.01) {
      discard;
    }
    gl_FragColor = color;
  }
`;

function initializePsdSupport() {
  if (typeof agPsd === "undefined" || typeof agPsd.initializeCanvas !== "function") {
    return;
  }

  agPsd.initializeCanvas((width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  });
}

init().catch((error) => {
  console.error(error);
  statusEl.textContent = `Failed: ${error.message}`;
});

async function init() {
  const [colorTexture, depthTexture, depthPixels, segmentImage] = await Promise.all([
    loadTexture(defaultColorUrl),
    loadTexture(defaultDepthUrl),
    loadDepthPixels(defaultDepthUrl),
    loadRgbPixels(defaultSegmentUrl),
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
  renderState.rasterImageWidth = imageWidth;
  renderState.rasterImageHeight = imageHeight;
  renderState.segmentThumbUrl = createSegmentThumbDataUrl(
    renderState.segmentSourcePixels,
    imageWidth,
    imageHeight,
  );

  rebuildSegments();
  rebuildDepthModeResources();
  sourceModeEl.value = "psd";
  renderState.sourceMode = "psd";
  wireControls();
  statusEl.textContent = "Loading PSD pair...";
  await ensureDefaultPsdPairLoaded();
  syncViewerModeUi();
  rebuildSegmentList();
  buildMesh();
  syncThumbs();
  updatePsdDebugPanel();
  onResize();
  animate();
}

function wireControls() {
  depthScaleValueEl.textContent = Number(depthScaleEl.value).toFixed(2);
  meshDetailValueEl.textContent = meshDetailEl.value;
  depthDiscontinuityValueEl.textContent = depthDiscontinuityEl.value;
  gridXValueEl.textContent = gridXEl.value;
  gridYValueEl.textContent = gridYEl.value;
  kernelSizeValueEl.textContent = kernelSizeEl.value;

  depthScaleEl.addEventListener("input", () => {
    depthScaleValueEl.textContent = Number(depthScaleEl.value).toFixed(2);
    if (renderState.material) {
      renderState.material.uniforms.uDepthScale.value = Number(depthScaleEl.value);
    }
    if (renderState.edgePointMaterial) {
      renderState.edgePointMaterial.uniforms.uDepthScale.value = Number(depthScaleEl.value);
    }
    for (let i = 0; i < renderState.psdLayerMeshes.length; i += 1) {
      const layerIndex = renderState.psdLayerMeshes[i].layerIndex;
      renderState.psdLayerMeshes[i].mesh.material.uniforms.uDepthScale.value =
        Number(depthScaleEl.value) * renderState.psdLayerDepthScales[layerIndex];
      renderState.psdLayerMeshes[i].mesh.position.z =
        renderState.psdLayerDepthOffsets[layerIndex] / 255 * Number(depthScaleEl.value);
    }
  });

  meshDetailEl.addEventListener("input", () => {
    meshDetailValueEl.textContent = meshDetailEl.value;
  });

  depthDiscontinuityEl.addEventListener("input", () => {
    depthDiscontinuityValueEl.textContent = depthDiscontinuityEl.value;
  });

  meshDetailEl.addEventListener("change", () => {
    buildMesh();
  });

  depthDiscontinuityEl.addEventListener("change", async () => {
    if (await rebuildPsdLayerEntriesIfNeeded()) {
      buildMesh();
      return;
    }
    rebuildDepthModeResources();
    buildMesh();
  });

  invertDepthEl.addEventListener("change", () => {
    if (renderState.material) {
      renderState.material.uniforms.uInvertDepth.value = invertDepthEl.checked ? 1 : 0;
    }
    if (renderState.edgePointMaterial) {
      renderState.edgePointMaterial.uniforms.uInvertDepth.value = invertDepthEl.checked ? 1 : 0;
    }
    for (let i = 0; i < renderState.psdLayerMeshes.length; i += 1) {
      renderState.psdLayerMeshes[i].mesh.material.uniforms.uInvertDepth.value = invertDepthEl.checked ? 1 : 0;
    }
  });

  sourceModeEl.addEventListener("change", async () => {
    try {
      renderState.sourceMode = sourceModeEl.value;
      if (renderState.sourceMode === "psd") {
        statusEl.textContent = "Loading PSD pair...";
        await ensureDefaultPsdPairLoaded();
      } else {
        renderState.imageWidth = renderState.rasterImageWidth;
        renderState.imageHeight = renderState.rasterImageHeight;
      }
      syncViewerModeUi();
      rebuildSegmentList();
      buildMesh();
      updatePsdDebugPanel();
      syncThumbs();
    } catch (error) {
      console.error(error);
      renderState.sourceMode = "raster";
      sourceModeEl.value = "raster";
      renderState.imageWidth = renderState.rasterImageWidth;
      renderState.imageHeight = renderState.rasterImageHeight;
      syncViewerModeUi();
      buildMesh();
      updatePsdDebugPanel();
      syncThumbs();
      statusEl.textContent = `Failed: ${error.message}`;
    }
  });

  contourRepairEl.addEventListener("change", async () => {
    if (await rebuildPsdLayerEntriesIfNeeded()) {
      buildMesh();
      return;
    }
    rebuildDepthModeResources();
    buildMesh();
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
  segmentThumbButtonEl.addEventListener("click", () => {
    segmentFileInputEl.click();
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

  segmentFileInputEl.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    await replaceImage("segment", file);
    segmentFileInputEl.value = "";
  });

  window.addEventListener("resize", onResize);
}

function buildMesh() {
  disposeMeshDepthTexture();
  clearSceneVisuals();

  if (renderState.sourceMode === "psd") {
    buildPsdLayerMeshes();
    refreshStatusCounts();
    return;
  }

  const step = Number(meshDetailEl.value);
  renderState.meshDepthTexture = renderState.activeDepthTexture;
  renderState.meshDepthPixels = renderState.activeDepthPixels;
  renderState.meshGapMask = renderState.repairedBaseGapMask || new Uint8Array(renderState.imageWidth * renderState.imageHeight);
  const geometry = buildMaskedPlaneGeometry(
    renderState.imageWidth,
    renderState.imageHeight,
    renderState.meshDepthPixels,
    renderState.segmentMap,
    renderState.segmentDepthMeans,
    renderState.meshGapMask,
    step,
  );

  geometry.computeVertexNormals();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColorTexture: { value: renderState.colorTexture },
      uDepthTexture: { value: renderState.meshDepthTexture },
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

  const edgeGeometry = buildRenderedBoundaryPointGeometry(
    renderState.imageWidth,
    renderState.imageHeight,
    renderState.meshDepthPixels,
    renderState.segmentMap,
    renderState.meshGapMask,
    step,
  );
  const edgePointMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uDepthTexture: { value: renderState.meshDepthTexture },
      uSegmentMaskTexture: { value: renderState.segmentMaskTexture },
      uDepthScale: { value: Number(depthScaleEl.value) },
      uInvertDepth: { value: invertDepthEl.checked ? 1 : 0 },
      uPointSize: { value: 2.2 },
    },
    vertexShader: pointVertexShader,
    fragmentShader: pointFragmentShader,
    transparent: true,
    depthWrite: false,
  });
  const edgePoints = new THREE.Points(edgeGeometry, edgePointMaterial);
  scene.add(edgePoints);

  renderState.mesh = mesh;
  renderState.material = material;
  renderState.edgePoints = edgePoints;
  renderState.edgePointMaterial = edgePointMaterial;

  refreshStatusCounts();
}

function clearSceneVisuals() {
  if (renderState.mesh) {
    scene.remove(renderState.mesh);
    renderState.mesh.geometry.dispose();
    renderState.material.dispose();
    renderState.mesh = null;
    renderState.material = null;
  }

  if (renderState.edgePoints) {
    scene.remove(renderState.edgePoints);
    renderState.edgePoints.geometry.dispose();
    renderState.edgePointMaterial.dispose();
    renderState.edgePoints = null;
    renderState.edgePointMaterial = null;
  }

  if (renderState.psdLayerMeshes.length) {
    for (let i = 0; i < renderState.psdLayerMeshes.length; i += 1) {
      const entry = renderState.psdLayerMeshes[i];
      scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.mesh.material.dispose();
    }
    renderState.psdLayerMeshes = [];
  }
}

function buildPsdLayerMeshes() {
  const layers = renderState.psdLayerEntries || [];
  for (let i = 0; i < layers.length; i += 1) {
    const layer = layers[i];
    if (!renderState.psdLayerVisibility[i]) {
      continue;
    }

    const geometry = buildPsdLayerGeometry(
      renderState.imageWidth,
      renderState.imageHeight,
      layer,
      Number(meshDetailEl.value),
    );
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColorTexture: { value: layer.colorTexture },
        uMaskTexture: { value: layer.maskTexture },
        uDepthTexture: { value: layer.depthTexture },
        uDepthScale: { value: Number(depthScaleEl.value) * renderState.psdLayerDepthScales[i] },
        uInvertDepth: { value: invertDepthEl.checked ? 1 : 0 },
      },
      vertexShader: psdLayerVertexShader,
      fragmentShader: psdLayerFragmentShader,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = i;
    mesh.position.z += renderState.psdLayerDepthOffsets[i] / 255 * Number(depthScaleEl.value);
    scene.add(mesh);
    renderState.psdLayerMeshes.push({ mesh, layerIndex: i });
  }
}

function buildMaskedPlaneGeometry(width, height, depthPixels, segmentMap, segmentDepthMeans, gapMask, step) {
  const cols = Math.floor((width - 1) / step) + 1;
  const rows = Math.floor((height - 1) / step) + 1;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const vertexValid = new Uint8Array(cols * rows);
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
      const index = y * cols + x;

      positions[p++] = sx;
      positions[p++] = sy;
      positions[p++] = 0;

      uvs[t++] = u;
      uvs[t++] = 1 - v;

      vertexValid[index] = isValidDepth(depthPixels, width, px, py) && !gapMask[py * width + px] ? 1 : 0;
    }
  }

  const indices = [];

  for (let y = 0; y < rows - 1; y += 1) {
    for (let x = 0; x < cols - 1; x += 1) {
      const x0 = Math.min(x * step, width - 1);
      const x1 = Math.min((x + 1) * step, width - 1);
      const y0 = Math.min(y * step, height - 1);
      const y1 = Math.min((y + 1) * step, height - 1);

      const a = y * cols + x;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;

      if (!vertexValid[a] || !vertexValid[b] || !vertexValid[c] || !vertexValid[d]) {
        continue;
      }

      const segmentA = getSegmentIndex(segmentMap, width, x0, y0);
      const segmentB = getSegmentIndex(segmentMap, width, x1, y0);
      const segmentC = getSegmentIndex(segmentMap, width, x0, y1);
      const segmentD = getSegmentIndex(segmentMap, width, x1, y1);
      const depthA = depthPixels[y0 * width + x0];
      const depthB = depthPixels[y0 * width + x1];
      const depthC = depthPixels[y1 * width + x0];
      const depthD = depthPixels[y1 * width + x1];

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

function buildRenderedBoundaryPointGeometry(width, height, depthPixels, segmentMap, gapMask, step) {
  const cols = Math.floor((width - 1) / step) + 1;
  const rows = Math.floor((height - 1) / step) + 1;
  const aspect = width / height;
  const halfWidth = aspect * 0.5;
  const halfHeight = 0.5;
  const vertexValid = new Uint8Array(cols * rows);
  let pointCount = 0;

  for (let gy = 0; gy < rows; gy += 1) {
    const py = Math.min(gy * step, height - 1);
    for (let gx = 0; gx < cols; gx += 1) {
      const px = Math.min(gx * step, width - 1);
      const index = gy * cols + gx;
      vertexValid[index] = isValidDepth(depthPixels, width, px, py) && !gapMask[py * width + px] ? 1 : 0;
    }
  }

  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      if (!isRenderedBoundaryVertex(gx, gy, cols, rows, width, height, step, segmentMap, vertexValid)) {
        continue;
      }
      pointCount += 1;
    }
  }

  const positions = new Float32Array(pointCount * 3);
  const uvs = new Float32Array(pointCount * 2);
  let p = 0;
  let t = 0;

  for (let gy = 0; gy < rows; gy += 1) {
    const py = Math.min(gy * step, height - 1);
    const v = py / (height - 1);
    const sy = THREE.MathUtils.lerp(halfHeight, -halfHeight, v);

    for (let gx = 0; gx < cols; gx += 1) {
      if (!isRenderedBoundaryVertex(gx, gy, cols, rows, width, height, step, segmentMap, vertexValid)) {
        continue;
      }

      const px = Math.min(gx * step, width - 1);
      const u = px / (width - 1);
      const sx = THREE.MathUtils.lerp(-halfWidth, halfWidth, u);

      positions[p++] = sx;
      positions[p++] = sy;
      positions[p++] = 0;

      uvs[t++] = u;
      uvs[t++] = 1 - v;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  return geometry;
}

function isRenderedBoundaryVertex(gridX, gridY, cols, rows, width, height, step, segmentMap, vertexValid) {
  const vertexIndex = gridY * cols + gridX;
  if (!vertexValid[vertexIndex]) {
    return false;
  }

  const px = Math.min(gridX * step, width - 1);
  const py = Math.min(gridY * step, height - 1);
  const segmentIndex = segmentMap[py * width + px];
  if (segmentIndex < 0) {
    return false;
  }

  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  for (let i = 0; i < offsets.length; i += 1) {
    const [dx, dy] = offsets[i];
    const ngx = gridX + dx;
    const ngy = gridY + dy;
    if (ngx < 0 || ngx >= cols || ngy < 0 || ngy >= rows) {
      return true;
    }

    const neighborVertexIndex = ngy * cols + ngx;
    if (!vertexValid[neighborVertexIndex]) {
      return true;
    }

    const npx = Math.min(ngx * step, width - 1);
    const npy = Math.min(ngy * step, height - 1);
    if (segmentMap[npy * width + npx] !== segmentIndex) {
      return true;
    }
  }

  return false;
}

function buildPsdLayerGeometry(imageWidth, imageHeight, layer, step) {
  const cols = Math.floor((layer.width - 1) / step) + 1;
  const rows = Math.floor((layer.height - 1) / step) + 1;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const vertexValid = new Uint8Array(cols * rows);
  const indices = [];
  const aspect = imageWidth / imageHeight;
  const halfWidth = aspect * 0.5;
  const halfHeight = 0.5;
  let p = 0;
  let t = 0;

  for (let y = 0; y < rows; y += 1) {
    const py = Math.min(y * step, layer.height - 1);
    const imageY = layer.top + py;
    const v = (py + 0.5) / Math.max(1, layer.height);
    const globalV = imageY / Math.max(1, imageHeight - 1);
    const sy = THREE.MathUtils.lerp(halfHeight, -halfHeight, globalV);

    for (let x = 0; x < cols; x += 1) {
      const px = Math.min(x * step, layer.width - 1);
      const imageX = layer.left + px;
      const u = (px + 0.5) / Math.max(1, layer.width);
      const globalU = imageX / Math.max(1, imageWidth - 1);
      const sx = THREE.MathUtils.lerp(-halfWidth, halfWidth, globalU);
      const localIndex = py * layer.width + px;

      positions[p++] = sx;
      positions[p++] = sy;
      positions[p++] = 0;
      uvs[t++] = u;
      uvs[t++] = 1 - v;
      vertexValid[y * cols + x] = layer.renderDepthMask
        ? layer.renderDepthMask[localIndex]
        : (layer.maskPixels && layer.depthPixels
          ? (layer.maskPixels[localIndex] && layer.depthPixels[localIndex] > 0 ? 1 : 0)
          : 1)
      ;
    }
  }

  for (let y = 0; y < rows - 1; y += 1) {
    for (let x = 0; x < cols - 1; x += 1) {
      const a = y * cols + x;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if (!vertexValid[a] || !vertexValid[b] || !vertexValid[c] || !vertexValid[d]) {
        continue;
      }
      if (!psdCellHasOnlyValidDepth(layer, x, y, step)) {
        continue;
      }
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function psdCellHasOnlyValidDepth(layer, gridX, gridY, step) {
  if (layer.renderDepthMask) {
    const minX = Math.min(gridX * step, layer.width - 1);
    const minY = Math.min(gridY * step, layer.height - 1);
    const maxX = Math.min((gridX + 1) * step, layer.width - 1);
    const maxY = Math.min((gridY + 1) * step, layer.height - 1);

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const index = y * layer.width + x;
        if (!layer.renderDepthMask[index]) {
          return false;
        }
      }
    }

    return true;
  }

  if (!layer.maskPixels || !layer.depthPixels) {
    return true;
  }

  const minX = Math.min(gridX * step, layer.width - 1);
  const minY = Math.min(gridY * step, layer.height - 1);
  const maxX = Math.min((gridX + 1) * step, layer.width - 1);
  const maxY = Math.min((gridY + 1) * step, layer.height - 1);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const index = y * layer.width + x;
      if (!layer.maskPixels[index] || layer.depthPixels[index] <= 0) {
        return false;
      }
    }
  }

  return true;
}

function isSegmentContourPixel(segmentMap, width, height, index) {
  const segmentIndex = segmentMap[index];
  if (segmentIndex < 0) {
    return false;
  }

  const x = index % width;
  const y = Math.floor(index / width);
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  for (let i = 0; i < offsets.length; i += 1) {
    const [dx, dy] = offsets[i];
    const sx = x + dx;
    const sy = y + dy;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      return true;
    }

    if (segmentMap[sy * width + sx] !== segmentIndex) {
      return true;
    }
  }

  return false;
}

function isValidDepth(depthPixels, width, x, y) {
  return depthPixels[y * width + x] > 0;
}

function getSegmentIndex(segmentMap, width, x, y) {
  return segmentMap[y * width + x];
}

function computeSegmentDepthMeans(depthPixels, segmentMap, segmentCount) {
  const sums = new Float32Array(segmentCount);
  const counts = new Uint32Array(segmentCount);

  for (let index = 0; index < depthPixels.length; index += 1) {
    const segmentIndex = segmentMap[index];
    const depth = depthPixels[index];
    if (segmentIndex < 0 || depth <= 0) {
      continue;
    }
    sums[segmentIndex] += depth;
    counts[segmentIndex] += 1;
  }

  const means = new Float32Array(segmentCount);
  for (let i = 0; i < segmentCount; i += 1) {
    means[i] = counts[i] > 0 ? sums[i] / counts[i] : 0;
  }
  return means;
}

function repairDepthDiscontinuities(sourcePixels, segmentMap, segmentDepthMeans, width, height, threshold) {
  let contourAligned = sourcePixels;
  if (contourRepairEl.checked) {
    const contourBandMask = buildSegmentContourBandMask(segmentMap, width, height, 2);
    const contourFilled = inpaintSegmentDepthGaps(
      sourcePixels,
      segmentMap,
      segmentDepthMeans,
      width,
      height,
      contourBandMask,
    );
    contourAligned = alignContourDepthsToInterior(
      contourFilled,
      segmentMap,
      width,
      height,
      threshold,
    );
  }
  const repairedMeans = computeSegmentDepthMeans(
    contourAligned,
    segmentMap,
    segmentDepthMeans.length,
  );
  const edgeMask = detectSegmentDepthEdges(
    contourAligned,
    segmentMap,
    repairedMeans,
    width,
    height,
    threshold,
  );
  const gapMask = detectSegmentDiscontinuityGaps(
    contourAligned,
    segmentMap,
    repairedMeans,
    width,
    height,
    threshold,
  );
  const inpainted = inpaintSegmentDepthGaps(
    contourAligned,
    segmentMap,
    repairedMeans,
    width,
    height,
    gapMask,
  );

  const resources = createDepthTextureResources(width, height, inpainted);
  return {
    ...resources,
    edgeMask,
    gapMask,
  };
}

function buildSegmentContourBandMask(segmentMap, width, height, passes) {
  const contourMask = new Uint8Array(segmentMap.length);
  const mask = new Uint8Array(segmentMap.length);

  for (let index = 0; index < segmentMap.length; index += 1) {
    if (isSegmentContourPixel(segmentMap, width, height, index)) {
      contourMask[index] = 1;
    }
  }

  mask.set(contourMask);
  expandGapMaskWithinSegment(mask, segmentMap, width, height, passes);

  for (let index = 0; index < mask.length; index += 1) {
    if (contourMask[index]) {
      mask[index] = 0;
    }
  }

  return mask;
}

function alignContourDepthsToInterior(sourcePixels, segmentMap, width, height, threshold) {
  const aligned = sourcePixels.slice();

  for (let index = 0; index < aligned.length; index += 1) {
    if (!isSegmentContourPixel(segmentMap, width, height, index) || aligned[index] <= 0) {
      continue;
    }

    const segmentIndex = segmentMap[index];
    if (segmentIndex < 0) {
      continue;
    }

    const interiorDepths = collectSegmentInteriorRayDepths(
      aligned,
      segmentMap,
      width,
      height,
      index,
      segmentIndex,
      6,
    );
    if (interiorDepths.length < 3) {
      continue;
    }

    interiorDepths.sort((a, b) => a - b);
    const median = interiorDepths[(interiorDepths.length - 1) >> 1];
    const deviations = interiorDepths.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
    const mad = deviations[(deviations.length - 1) >> 1];
    const localThreshold = Math.max(2, threshold * 0.28, mad * 1.35 + 1);
    const depthDelta = aligned[index] - median;

    if (Math.abs(depthDelta) > localThreshold) {
      aligned[index] = median;
    }
  }

  return aligned;
}

function detectSegmentDepthEdges(sourcePixels, segmentMap, segmentDepthMeans, width, height, threshold) {
  const edgeMask = new Uint8Array(sourcePixels.length);
  const offsets = [
    [1, 0],
    [0, 1],
    [1, 1],
    [-1, 1],
    [2, 0],
    [0, 2],
  ];
  const edgeThreshold = Math.max(2, threshold * 0.55);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const depth = sourcePixels[index];
      const segmentIndex = segmentMap[index];
      if (depth <= 0 || segmentIndex < 0) {
        continue;
      }

      const mean = segmentDepthMeans[segmentIndex];
      for (let i = 0; i < offsets.length; i += 1) {
        const [dx, dy] = offsets[i];
        const sx = x + dx;
        const sy = y + dy;
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
          continue;
        }

        const sampleIndex = sy * width + sx;
        if (segmentMap[sampleIndex] !== segmentIndex) {
          continue;
        }

        const sampleDepth = sourcePixels[sampleIndex];
        if (sampleDepth <= 0) {
          continue;
        }

        if (!depthDifferenceWithinThreshold(depth, sampleDepth, edgeThreshold, mean, mean)) {
          edgeMask[index] = 1;
          edgeMask[sampleIndex] = 1;
        }
      }
    }
  }

  return edgeMask;
}

function detectSegmentDiscontinuityGaps(sourcePixels, segmentMap, segmentDepthMeans, width, height, threshold) {
  const gapMask = new Uint8Array(sourcePixels.length);
  const visited = new Uint8Array(sourcePixels.length);
  const linkThreshold = Math.max(2, threshold * 0.55);

  for (let segmentIndex = 0; segmentIndex < renderState.segmentPixels.length; segmentIndex += 1) {
    const segmentPixels = renderState.segmentPixels[segmentIndex];
    if (!segmentPixels || segmentPixels.length === 0) {
      continue;
    }

    markContourDepthOutliers(
      gapMask,
      sourcePixels,
      segmentMap,
      width,
      height,
      segmentIndex,
      segmentPixels,
      threshold,
    );

    const components = collectSegmentDepthComponents(
      sourcePixels,
      segmentMap,
      segmentDepthMeans,
      width,
      height,
      segmentIndex,
      segmentPixels,
      visited,
      linkThreshold,
    );

    if (components.length <= 1) {
      continue;
    }

    const stats = computeSegmentAdjustedDepthStats(
      sourcePixels,
      segmentDepthMeans[segmentIndex],
      segmentPixels,
    );
    const targetAdjustedDepth = stats.median;
    const targetThreshold = Math.max(4, threshold * 0.65, stats.mad * 2 + 2);

    let dominant = components[0];
    let dominantScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < components.length; i += 1) {
      const component = components[i];
      const distance = Math.abs(component.adjustedMean - targetAdjustedDepth);
      const score = distance - component.size * 0.002;
      if (score < dominantScore) {
        dominantScore = score;
        dominant = component;
      }
    }

    for (let i = 0; i < components.length; i += 1) {
      const component = components[i];
      if (component === dominant) {
        continue;
      }

      const adjustedDistance = Math.abs(component.adjustedMean - targetAdjustedDepth);
      const isSmall = component.size <= Math.max(8, dominant.size * 0.35);
      const isFar = adjustedDistance > targetThreshold;

      if (!isSmall && !isFar) {
        continue;
      }

      for (let j = 0; j < component.indices.length; j += 1) {
        gapMask[component.indices[j]] = 1;
      }
    }
  }

  expandGapMaskWithinSegment(gapMask, segmentMap, width, height, 1);
  return gapMask;
}

function markContourDepthOutliers(gapMask, sourcePixels, segmentMap, width, height, segmentIndex, segmentPixels, threshold) {
  for (let i = 0; i < segmentPixels.length; i += 1) {
    const index = segmentPixels[i];
    const depth = sourcePixels[index];
    if (depth <= 0 || !isSegmentContourPixel(segmentMap, width, height, index)) {
      continue;
    }

    const interiorDepths = collectSegmentInteriorRayDepths(
      sourcePixels,
      segmentMap,
      width,
      height,
      index,
      segmentIndex,
      6,
    );

    if (interiorDepths.length < 3) {
      continue;
    }

    interiorDepths.sort((a, b) => a - b);
    const median = interiorDepths[(interiorDepths.length - 1) >> 1];
    const deviations = interiorDepths.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
    const mad = deviations[(deviations.length - 1) >> 1];
    const localThreshold = Math.max(3, threshold * 0.45, mad * 1.75 + 1.5);

    if (depth - median > localThreshold) {
      gapMask[index] = 1;
    }
  }
}

function collectSegmentInteriorRayDepths(sourcePixels, segmentMap, width, height, centerIndex, segmentIndex, radius) {
  const x = centerIndex % width;
  const y = Math.floor(centerIndex / width);
  const values = [];
  const inwardDirections = [];
  const cardinalOffsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  for (let i = 0; i < cardinalOffsets.length; i += 1) {
    const [dx, dy] = cardinalOffsets[i];
    const outsideX = x + dx;
    const outsideY = y + dy;
    if (
      outsideX >= 0 &&
      outsideX < width &&
      outsideY >= 0 &&
      outsideY < height &&
      segmentMap[outsideY * width + outsideX] === segmentIndex
    ) {
      continue;
    }

    const insideX = x - dx;
    const insideY = y - dy;
    if (
      insideX < 0 ||
      insideX >= width ||
      insideY < 0 ||
      insideY >= height
    ) {
      continue;
    }

    if (segmentMap[insideY * width + insideX] === segmentIndex) {
      inwardDirections.push([-dx, -dy]);
    }
  }

  if (inwardDirections.length === 0) {
    for (let i = 0; i < cardinalOffsets.length; i += 1) {
      const [dx, dy] = cardinalOffsets[i];
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
        continue;
      }
      if (segmentMap[sy * width + sx] === segmentIndex) {
        inwardDirections.push([dx, dy]);
      }
    }
  }

  if (inwardDirections.length === 0) {
    return values;
  }

  for (let i = 0; i < inwardDirections.length; i += 1) {
    const [dx, dy] = inwardDirections[i];
    let collectedOnRay = 0;
    for (let step = 1; step <= radius; step += 1) {
      const sx = x + dx * step;
      const sy = y + dy * step;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
        break;
      }

      const sampleIndex = sy * width + sx;
      if (segmentMap[sampleIndex] !== segmentIndex) {
        break;
      }
      if (isSegmentContourPixel(segmentMap, width, height, sampleIndex)) {
        continue;
      }

      const sampleDepth = sourcePixels[sampleIndex];
      if (sampleDepth <= 0) {
        continue;
      }

      values.push(sampleDepth);
      collectedOnRay += 1;
      if (collectedOnRay >= 3) {
        break;
      }
    }
  }

  return values;
}

function computeSegmentAdjustedDepthStats(sourcePixels, segmentMean, segmentPixels) {
  const adjusted = [];

  for (let i = 0; i < segmentPixels.length; i += 1) {
    const depth = sourcePixels[segmentPixels[i]];
    if (depth <= 0) {
      continue;
    }
    adjusted.push(depth - segmentMean);
  }

  if (adjusted.length === 0) {
    return { median: 0, mad: 0 };
  }

  adjusted.sort((a, b) => a - b);
  const median = adjusted[(adjusted.length - 1) >> 1];
  const deviations = adjusted.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  const mad = deviations[(deviations.length - 1) >> 1];
  return { median, mad };
}

function collectSegmentDepthComponents(sourcePixels, segmentMap, segmentDepthMeans, width, height, segmentIndex, segmentPixels, visited, linkThreshold) {
  const components = [];
  const queue = new Int32Array(segmentPixels.length);
  const segmentMean = segmentDepthMeans[segmentIndex];

  for (let i = 0; i < segmentPixels.length; i += 1) {
    const startIndex = segmentPixels[i];
    if (visited[startIndex] || sourcePixels[startIndex] <= 0) {
      continue;
    }

    visited[startIndex] = 1;
    queue[0] = startIndex;
    let head = 0;
    let tail = 1;
    const indices = [];
    let adjustedSum = 0;

    while (head < tail) {
      const index = queue[head++];
      indices.push(index);
      adjustedSum += sourcePixels[index] - segmentMean;

      const x = index % width;
      const y = Math.floor(index / width);
      const neighbors = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];

      for (let n = 0; n < neighbors.length; n += 1) {
        const [nx, ny] = neighbors[n];
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          continue;
        }

        const neighborIndex = ny * width + nx;
        if (segmentMap[neighborIndex] !== segmentIndex || visited[neighborIndex]) {
          continue;
        }

        const neighborDepth = sourcePixels[neighborIndex];
        if (neighborDepth <= 0) {
          continue;
        }

        const currentBoundary = isSegmentBoundaryPixel(segmentMap, width, height, index, segmentIndex);
        const neighborBoundary = isSegmentBoundaryPixel(segmentMap, width, height, neighborIndex, segmentIndex);
        const localLinkThreshold = currentBoundary || neighborBoundary
          ? Math.max(1.5, linkThreshold * 0.35)
          : linkThreshold;

        if (!depthDifferenceWithinThreshold(sourcePixels[index], neighborDepth, localLinkThreshold, segmentMean, segmentMean)) {
          continue;
        }

        if ((currentBoundary || neighborBoundary) && !hasSharedSegmentDepthSupport(
          sourcePixels,
          segmentMap,
          width,
          height,
          index,
          neighborIndex,
          segmentIndex,
          segmentMean,
          localLinkThreshold,
        )) {
          continue;
        }

        visited[neighborIndex] = 1;
        queue[tail++] = neighborIndex;
      }
    }

    components.push({
      indices,
      size: indices.length,
      adjustedMean: adjustedSum / Math.max(1, indices.length),
    });
  }

  return components;
}

function isSegmentBoundaryPixel(segmentMap, width, height, index, segmentIndex) {
  const x = index % width;
  const y = Math.floor(index / width);
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  for (let i = 0; i < offsets.length; i += 1) {
    const [dx, dy] = offsets[i];
    const sx = x + dx;
    const sy = y + dy;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      continue;
    }

    if (segmentMap[sy * width + sx] !== segmentIndex) {
      return true;
    }
  }

  return false;
}

function hasSharedSegmentDepthSupport(sourcePixels, segmentMap, width, height, indexA, indexB, segmentIndex, segmentMean, threshold) {
  const ax = indexA % width;
  const ay = Math.floor(indexA / width);
  const bx = indexB % width;
  const by = Math.floor(indexB / width);
  const centerDepth = 0.5 * (sourcePixels[indexA] + sourcePixels[indexB]);
  let support = 0;

  for (let sy = Math.max(0, Math.min(ay, by) - 1); sy <= Math.min(height - 1, Math.max(ay, by) + 1); sy += 1) {
    for (let sx = Math.max(0, Math.min(ax, bx) - 1); sx <= Math.min(width - 1, Math.max(ax, bx) + 1); sx += 1) {
      const sampleIndex = sy * width + sx;
      if (sampleIndex === indexA || sampleIndex === indexB || segmentMap[sampleIndex] !== segmentIndex) {
        continue;
      }

      const sampleDepth = sourcePixels[sampleIndex];
      if (sampleDepth <= 0) {
        continue;
      }

      if (depthDifferenceWithinThreshold(sampleDepth, centerDepth, threshold, segmentMean, segmentMean)) {
        support += 1;
        if (support >= 2) {
          return true;
        }
      }
    }
  }

  return false;
}

function expandGapMaskWithinSegment(gapMask, segmentMap, width, height, passes) {
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

  for (let pass = 0; pass < passes; pass += 1) {
    const next = gapMask.slice();

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (gapMask[index]) {
          continue;
        }

        const segmentIndex = segmentMap[index];
        if (segmentIndex < 0) {
          continue;
        }

        for (const [dx, dy] of offsets) {
          const sx = x + dx;
          const sy = y + dy;
          if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
            continue;
          }

          const sampleIndex = sy * width + sx;
          if (gapMask[sampleIndex] && segmentMap[sampleIndex] === segmentIndex) {
            next[index] = 1;
            break;
          }
        }
      }
    }

    gapMask.set(next);
  }
}

function inpaintSegmentDepthGaps(sourcePixels, segmentMap, segmentDepthMeans, width, height, gapMask) {
  const filled = sourcePixels.slice();
  for (let index = 0; index < filled.length; index += 1) {
    if (gapMask[index]) {
      filled[index] = 0;
    }
  }
  return filled;
}

function enqueueGapNeighbors(queue, queued, gapMask, segmentMap, width, height, x, y, segmentIndex, tail) {
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

  let nextTail = tail;

  for (const [dx, dy] of offsets) {
    const sx = x + dx;
    const sy = y + dy;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      continue;
    }

    const sampleIndex = sy * width + sx;
    if (!gapMask[sampleIndex] || queued[sampleIndex] || segmentMap[sampleIndex] !== segmentIndex) {
      continue;
    }

    queue[nextTail++] = sampleIndex;
    queued[sampleIndex] = 1;
  }

  return nextTail;
}

function hasFilledSegmentNeighbor(sourcePixels, segmentMap, width, height, x, y, segmentIndex) {
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
    if (segmentMap[sampleIndex] === segmentIndex && sourcePixels[sampleIndex] > 0) {
      return true;
    }
  }

  return false;
}

function pixelHasDepthJump(depthPixels, segmentMap, segmentDepthMeans, width, height, px, py, threshold) {
  const center = depthPixels[py * width + px];
  if (center <= 0) {
    return true;
  }

  const centerSegmentIndex = segmentMap[py * width + px];
  if (centerSegmentIndex < 0) {
    return true;
  }

  const centerMean = segmentDepthMeans[centerSegmentIndex];
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
    [-2, 0],
    [2, 0],
    [0, -2],
    [0, 2],
  ];

  let minDepth = center;
  let maxDepth = center;
  let minMean = centerMean;
  let maxMean = centerMean;
  let comparableNeighbors = 0;

  for (const [dx, dy] of offsets) {
    const x = px + dx;
    const y = py + dy;
    if (x < 0 || x >= width || y < 0 || y >= height) {
      continue;
    }

    const sampleIndex = y * width + x;
    if (segmentMap[sampleIndex] !== centerSegmentIndex) {
      continue;
    }

    const depth = depthPixels[sampleIndex];
    if (depth <= 0) {
      continue;
    }

    const sampleMean = segmentDepthMeans[centerSegmentIndex];
    comparableNeighbors += 1;

    if (depth - sampleMean < minDepth - minMean) {
      minDepth = depth;
      minMean = sampleMean;
    }
    if (depth - sampleMean > maxDepth - maxMean) {
      maxDepth = depth;
      maxMean = sampleMean;
    }

    if (!depthDifferenceWithinThreshold(depth, center, threshold, sampleMean, centerMean)) {
      return true;
    }
  }

  if (comparableNeighbors < 2) {
    return false;
  }

  return !depthDifferenceWithinThreshold(maxDepth, minDepth, threshold, maxMean, minMean);
}

function sampleSegmentNeighborDepth(sourcePixels, segmentMap, segmentDepthMeans, width, height, x, y, segmentIndex) {
  const centerMean = segmentDepthMeans[segmentIndex];
  let weightSum = 0;
  let adjustedDepthSum = 0;
  let sampleCount = 0;
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

  for (const [ox, oy] of offsets) {
    const sx = x + ox;
    const sy = y + oy;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      continue;
    }

    const sampleIndex = sy * width + sx;
    if (segmentMap[sampleIndex] !== segmentIndex) {
      continue;
    }

    const sampleDepth = sourcePixels[sampleIndex];
    if (sampleDepth <= 0) {
      continue;
    }

    const distanceSq = ox * ox + oy * oy;
    const weight = 1 / Math.max(1, distanceSq);
    adjustedDepthSum += (sampleDepth - centerMean) * weight;
    weightSum += weight;
    sampleCount += 1;
  }

  if (sampleCount < 1 || weightSum <= 0) {
    return 0;
  }

  const depth = Math.round(centerMean + adjustedDepthSum / weightSum);
  return THREE.MathUtils.clamp(depth, 1, 255);
}

function sampleSegmentMeanDepth(sourcePixels, segmentMap, segmentDepthMeans, width, height, x, y, segmentIndex) {
  const centerMean = segmentDepthMeans[segmentIndex];
  const segmentPixels = renderState.segmentPixels[segmentIndex] || [];
  const maxSamples = 192;
  const stride = Math.max(1, Math.ceil(segmentPixels.length / maxSamples));
  let weightSum = 0;
  let adjustedDepthSum = 0;
  let sampleCount = 0;

  for (let i = 0; i < segmentPixels.length; i += stride) {
    const sampleIndex = segmentPixels[i];
    const sampleDepth = sourcePixels[sampleIndex];
    if (sampleDepth <= 0) {
      continue;
    }

    const sx = sampleIndex % width;
    const sy = Math.floor(sampleIndex / width);
    const dx = sx - x;
    const dy = sy - y;
    const distanceSq = dx * dx + dy * dy;
    const weight = 1 / Math.max(1, distanceSq);
    adjustedDepthSum += (sampleDepth - centerMean) * weight;
    weightSum += weight;
    sampleCount += 1;
  }

  if (sampleCount > 0 && weightSum > 0) {
    return THREE.MathUtils.clamp(Math.round(centerMean + adjustedDepthSum / weightSum), 1, 255);
  }

  return centerMean > 0 ? THREE.MathUtils.clamp(Math.round(centerMean), 1, 255) : 0;
}

function findSegmentDepthReplacement(sourcePixels, segmentMap, segmentDepthMeans, width, height, x, y, segmentIndex, centerDepth, threshold, closeTolerance) {
  const similar = [];
  const different = [];

  for (let oy = -2; oy <= 2; oy += 1) {
    for (let ox = -2; ox <= 2; ox += 1) {
      if (ox === 0 && oy === 0) {
        continue;
      }

      const sx = x + ox;
      const sy = y + oy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
        continue;
      }

      const sampleIndex = sy * width + sx;
      if (segmentMap[sampleIndex] !== segmentIndex) {
        continue;
      }

      const sampleDepth = sourcePixels[sampleIndex];
      if (sampleDepth <= 0) {
        continue;
      }

      if (
        depthDifferenceWithinThreshold(
          sampleDepth,
          centerDepth,
          closeTolerance,
          segmentDepthMeans[segmentIndex],
          segmentDepthMeans[segmentIndex],
        )
      ) {
        similar.push(sampleDepth);
      } else if (
        !depthDifferenceWithinThreshold(
          sampleDepth,
          centerDepth,
          threshold,
          segmentDepthMeans[segmentIndex],
          segmentDepthMeans[segmentIndex],
        )
      ) {
        different.push(sampleDepth);
      }
    }
  }

  if (similar.length >= 3 || different.length < 3) {
    return 0;
  }

  different.sort((a, b) => a - b);
  return different[(different.length - 1) >> 1];
}

function depthDifferenceWithinThreshold(a, b, absThreshold, meanA = 0, meanB = 0) {
  const adjustedA = a - meanA;
  const adjustedB = b - meanB;
  const scale = Math.max(relativeDepthFloor, Math.abs(adjustedA), Math.abs(adjustedB));
  return Math.abs(adjustedA - adjustedB) <= absThreshold + scale * relativeDepthFactor;
}

function isDepthContinuous(a, b, threshold, meanA = 0, meanB = 0) {
  return depthDifferenceWithinThreshold(a, b, threshold, meanA, meanB);
}

function invalidateDiscontinuousVertices(depthPixels, segmentMap, segmentDepthMeans, gapMask, width, height, cols, rows, step, threshold, vertexValid) {
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const px = Math.min(x * step, width - 1);
      const py = Math.min(y * step, height - 1);
      const index = y * cols + x;

      if (!vertexValid[index]) {
        continue;
      }

      if (gapMask[py * width + px]) {
        continue;
      }

      if (vertexHasDepthJump(depthPixels, segmentMap, segmentDepthMeans, width, height, px, py, threshold)) {
        vertexValid[index] = 0;
      }
    }
  }
}

function vertexHasDepthJump(depthPixels, segmentMap, segmentDepthMeans, width, height, px, py, threshold) {
  return pixelHasDepthJump(depthPixels, segmentMap, segmentDepthMeans, width, height, px, py, threshold);
}

function isTriangleDepthContinuous(depthPixels, segmentMap, segmentDepthMeans, gapMask, width, ax, ay, bx, by, cx, cy, edgeThreshold, centerThreshold) {
  if (
    gapMask[ay * width + ax] ||
    gapMask[by * width + bx] ||
    gapMask[cy * width + cx]
  ) {
    return true;
  }

  const depthA = depthPixels[ay * width + ax];
  const depthB = depthPixels[by * width + bx];
  const depthC = depthPixels[cy * width + cx];
  const meanA = getSegmentDepthMean(segmentMap, segmentDepthMeans, width, ax, ay);
  const meanB = getSegmentDepthMean(segmentMap, segmentDepthMeans, width, bx, by);
  const meanC = getSegmentDepthMean(segmentMap, segmentDepthMeans, width, cx, cy);

  if (
    !isDepthContinuous(depthA, depthB, edgeThreshold, meanA, meanB) ||
    !isDepthContinuous(depthB, depthC, edgeThreshold, meanB, meanC) ||
    !isDepthContinuous(depthC, depthA, edgeThreshold, meanC, meanA)
  ) {
    return false;
  }

  if (
    depthLineHasDiscontinuity(depthPixels, segmentMap, segmentDepthMeans, width, ax, ay, bx, by, edgeThreshold) ||
    depthLineHasDiscontinuity(depthPixels, segmentMap, segmentDepthMeans, width, bx, by, cx, cy, edgeThreshold) ||
    depthLineHasDiscontinuity(depthPixels, segmentMap, segmentDepthMeans, width, cx, cy, ax, ay, edgeThreshold)
  ) {
    return false;
  }

  const centerX = Math.round((ax + bx + cx) / 3);
  const centerY = Math.round((ay + by + cy) / 3);
  if (gapMask[centerY * width + centerX]) {
    return true;
  }
  const centerDepth = depthPixels[centerY * width + centerX];
  const centerMean = getSegmentDepthMean(segmentMap, segmentDepthMeans, width, centerX, centerY);
  if (
    centerDepth <= 0 ||
    !isDepthContinuous(centerDepth, depthA, centerThreshold, centerMean, meanA) ||
    !isDepthContinuous(centerDepth, depthB, centerThreshold, centerMean, meanB) ||
    !isDepthContinuous(centerDepth, depthC, centerThreshold, centerMean, meanC)
  ) {
    return false;
  }

  return true;
}

function getSegmentDepthMean(segmentMap, segmentDepthMeans, width, x, y) {
  const segmentIndex = segmentMap[y * width + x];
  return segmentIndex >= 0 ? segmentDepthMeans[segmentIndex] : 0;
}

function depthLineHasDiscontinuity(depthPixels, segmentMap, segmentDepthMeans, width, x0, y0, x1, y1, threshold) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  let prevDepth = depthPixels[y0 * width + x0];
  let prevMean = getSegmentDepthMean(segmentMap, segmentDepthMeans, width, x0, y0);
  let minDepth = prevDepth;
  let maxDepth = prevDepth;
  let minMean = prevMean;
  let maxMean = prevMean;

  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const x = Math.round(x0 + dx * t);
    const y = Math.round(y0 + dy * t);
    const depth = depthPixels[y * width + x];
    if (depth <= 0) {
      return true;
    }

    minDepth = Math.min(minDepth, depth);
    maxDepth = Math.max(maxDepth, depth);
    const currentMean = getSegmentDepthMean(segmentMap, segmentDepthMeans, width, x, y);
    if (depth - currentMean < minDepth - minMean) {
      minDepth = depth;
      minMean = currentMean;
    }
    if (depth - currentMean > maxDepth - maxMean) {
      maxDepth = depth;
      maxMean = currentMean;
    }

    if (
      !depthDifferenceWithinThreshold(depth, prevDepth, threshold, currentMean, prevMean) ||
      !depthDifferenceWithinThreshold(maxDepth, minDepth, threshold, maxMean, minMean)
    ) {
      return true;
    }

    prevDepth = depth;
    prevMean = currentMean;
  }

  return false;
}

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

function withCacheBust(url) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${cacheBustToken}`;
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

async function ensureDefaultPsdPairLoaded() {
  if (renderState.psdLayerEntries.length) {
    return;
  }

  if (!renderState.pendingPsdColorBuffer || !renderState.pendingPsdDepthBuffer) {
    const [colorBuffer, depthBuffer] = await Promise.all([
      fetchArrayBuffer(defaultPsdColorUrl),
      fetchArrayBuffer(defaultPsdDepthUrl),
    ]);
    renderState.pendingPsdColorBuffer = colorBuffer;
    renderState.pendingPsdDepthBuffer = depthBuffer;
  }

  await loadPsdPair(renderState.pendingPsdColorBuffer, renderState.pendingPsdDepthBuffer);
}

async function fetchArrayBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}`);
  }
  return response.arrayBuffer();
}

async function loadPsdPair(colorBuffer, depthBuffer) {
  disposePsdLayerTextures();
  const colorPsd = agPsd.readPsd(colorBuffer);
  const depthPsd = agPsd.readPsd(depthBuffer);
  const stableDepthPixels = await ensurePsdStableDepthPixels(colorPsd.width, colorPsd.height);
  const layerEntries = createPsdLayerEntries(colorPsd, depthPsd, stableDepthPixels);

  renderState.psdColorDocument = colorPsd;
  renderState.psdDepthDocument = depthPsd;
  renderState.psdStableDepthPixels = stableDepthPixels;
  renderState.psdLayerEntries = layerEntries;
  renderState.psdLayerVisibility = new Array(layerEntries.length).fill(true);
  renderState.psdLayerDepthOffsets = new Array(layerEntries.length).fill(0);
  renderState.psdLayerDepthScales = new Array(layerEntries.length).fill(1);
  renderState.psdDebugLayerIndex = -1;
  renderState.imageWidth = colorPsd.width;
  renderState.imageHeight = colorPsd.height;
  renderState.psdColorPreviewUrl = colorPsd.canvas ? colorPsd.canvas.toDataURL("image/png") : "";
  renderState.psdDepthPreviewUrl = depthPsd.canvas ? depthPsd.canvas.toDataURL("image/png") : "";
  rebuildSegmentList();
  updatePsdDebugPanel();
}

async function rebuildPsdLayerEntriesIfNeeded() {
  if (renderState.sourceMode !== "psd") {
    return false;
  }

  if (renderState.pendingPsdColorBuffer && renderState.pendingPsdDepthBuffer) {
    await loadPsdPair(renderState.pendingPsdColorBuffer, renderState.pendingPsdDepthBuffer);
    return true;
  }

  if (renderState.psdColorDocument && renderState.psdDepthDocument) {
    const [colorBuffer, depthBuffer] = await Promise.all([
      fetchArrayBuffer(defaultPsdColorUrl),
      fetchArrayBuffer(defaultPsdDepthUrl),
    ]);
    renderState.pendingPsdColorBuffer = colorBuffer;
    renderState.pendingPsdDepthBuffer = depthBuffer;
    await loadPsdPair(colorBuffer, depthBuffer);
    return true;
  }

  return false;
}

function disposePsdLayerTextures() {
  for (let i = 0; i < renderState.psdLayerEntries.length; i += 1) {
    const layer = renderState.psdLayerEntries[i];
    if (layer.colorTexture) {
      layer.colorTexture.dispose();
    }
    if (layer.depthTexture) {
      layer.depthTexture.dispose();
    }
    if (layer.maskTexture) {
      layer.maskTexture.dispose();
    }
    if (layer.debugTexture) {
      layer.debugTexture.dispose();
    }
  }
  renderState.psdLayerEntries = [];
}

async function ensurePsdStableDepthPixels(expectedWidth, expectedHeight) {
  if (
    renderState.psdStableDepthPixels &&
    renderState.psdStableDepthWidth === expectedWidth &&
    renderState.psdStableDepthHeight === expectedHeight
  ) {
    return renderState.psdStableDepthPixels;
  }

  const stableImage = await loadImagePixels(defaultPsdStableDepthUrl);
  if (stableImage.width !== expectedWidth || stableImage.height !== expectedHeight) {
    throw new Error("Stable depth image size must match PSD size.");
  }

  const pixels = new Uint8Array(stableImage.width * stableImage.height);
  for (let i = 0, p = 0; i < stableImage.data.length; i += 4, p += 1) {
    pixels[p] = stableImage.data[i];
  }

  renderState.psdStableDepthPixels = pixels;
  renderState.psdStableDepthWidth = stableImage.width;
  renderState.psdStableDepthHeight = stableImage.height;
  return pixels;
}

function createPsdLayerEntries(colorPsd, depthPsd, stableDepthPixels) {
  const colorLayers = flattenPsdLayers(colorPsd.children || []);
  const depthLayers = flattenPsdLayers(depthPsd.children || []);
  const depthByName = new Map();

  for (let i = 0; i < depthLayers.length; i += 1) {
    const layer = depthLayers[i];
    const key = layer.name || `#${i}`;
    if (!depthByName.has(key)) {
      depthByName.set(key, []);
    }
    depthByName.get(key).push(layer);
  }

  const layerSources = [];

  for (let i = 0; i < colorLayers.length; i += 1) {
    const colorLayer = colorLayers[i];
    const key = colorLayer.name || `#${i}`;
    let depthLayer = null;

    if (depthByName.has(key) && depthByName.get(key).length) {
      depthLayer = depthByName.get(key).shift();
    } else if (depthLayers[i]) {
      depthLayer = depthLayers[i];
    }

    if (!depthLayer || colorLayer.width <= 0 || colorLayer.height <= 0) {
      continue;
    }

    const colorTexture = new THREE.CanvasTexture(colorLayer.canvas);
    colorTexture.encoding = THREE.sRGBEncoding;
    colorTexture.minFilter = THREE.LinearFilter;
    colorTexture.magFilter = THREE.LinearFilter;
    colorTexture.needsUpdate = true;

    const colorImageData = getCanvasImageData(colorLayer.canvas);
    const depthImageData = getCanvasImageData(depthLayer.canvas);

    layerSources.push({
      name: colorLayer.name || `Layer ${layerSources.length + 1}`,
      sourceIndex: i,
      left: colorLayer.left,
      top: colorLayer.top,
      width: colorLayer.width,
      height: colorLayer.height,
      colorTexture,
      colorImageData,
      depthImageData,
      depthMaskPixels: extractLayerMaskPixels(depthImageData.data),
    });
  }

  const mergedLayerSources = mergePsdFaceFeatureLayers(layerSources, colorPsd.width, colorPsd.height);

  const visibleLayerMap = buildVisiblePsdLayerMap(
    colorPsd.width,
    colorPsd.height,
    mergedLayerSources,
  );
  const entries = [];

  for (let i = 0; i < mergedLayerSources.length; i += 1) {
    const layer = mergedLayerSources[i];
    const maskPixels = extractLayerMaskPixels(layer.colorImageData.data);
    const seededDepthPixels = seedPsdLayerDepthPixels(
      layer,
      i,
      colorPsd.width,
      colorPsd.height,
      stableDepthPixels,
      visibleLayerMap,
      maskPixels,
    );
    const pruneResult = prunePsdForeignDepthSeeds(
      seededDepthPixels,
      layer,
      i,
      colorPsd.width,
      colorPsd.height,
      stableDepthPixels,
      visibleLayerMap,
      maskPixels,
      Number(depthDiscontinuityEl.value),
    );
    const depthPixels = pruneResult.pixels;
    if (contourRepairEl.checked) {
      const contourBandMask = buildLayerContourBandMask(maskPixels, layer.width, layer.height, 2);
      for (let p = 0; p < depthPixels.length; p += 1) {
        if (contourBandMask[p]) {
          depthPixels[p] = 0;
          pruneResult.debugState[p] = 5;
        }
      }
    }

    const erodedPositiveMask = erodePositiveDepthMask(depthPixels, layer.width, layer.height, 1);
    let removedDepthPixels = 0;
    for (let p = 0; p < depthPixels.length; p += 1) {
      if (maskPixels[p] && depthPixels[p] > 0 && !erodedPositiveMask[p]) {
        depthPixels[p] = 0;
        pruneResult.debugState[p] = 5;
        removedDepthPixels += 1;
      }
    }

    const inpaintedDepthPixels = inpaintMaskedLayerDepth(depthPixels, maskPixels, layer.width, layer.height);
    const renderDepthMask = new Uint8Array(inpaintedDepthPixels.length);
    for (let p = 0; p < inpaintedDepthPixels.length; p += 1) {
      renderDepthMask[p] = maskPixels[p] && inpaintedDepthPixels[p] > 0 ? 1 : 0;
    }
    const depthTexture = createDepthTextureResources(layer.width, layer.height, inpaintedDepthPixels).texture;
    const maskTexture = createBinaryMaskTexture(layer.width, layer.height, renderDepthMask);
    const debugTexture = createPsdDebugTexture(layer.width, layer.height, maskPixels, pruneResult.debugState, pruneResult.debugScore);
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;
    depthTexture.needsUpdate = true;

    entries.push({
      name: layer.name,
      left: layer.left,
      top: layer.top,
      width: layer.width,
      height: layer.height,
      colorTexture: layer.colorTexture,
      depthTexture,
      maskTexture,
      debugTexture: debugTexture.texture,
      debugPreviewUrl: debugTexture.url,
      depthPixels: inpaintedDepthPixels,
      renderDepthMask,
      maskPixels,
      removedDepthPixels,
      visible: true,
    });
  }

  return entries;
}

function getCanvasImageData(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function mergePsdFaceFeatureLayers(layerSources, imageWidth, imageHeight) {
  const merged = layerSources.slice();
  const featureRegex = /(?:^|[\s_-])(nose|mouth|eyewhite|eyebrow|irides|eyelash|eye)(?:$|[\s_-])/i;
  const faceRegex = /(face|skin|head)/i;
  const mergePlans = [];

  for (let i = 0; i < merged.length; i += 1) {
    if (featureRegex.test(merged[i].name)) {
      const targetIndex = findPsdFeatureMergeTarget(merged, i, faceRegex, imageWidth, imageHeight);
      if (targetIndex >= 0) {
        mergePlans.push({
          sourceIndex: i,
          targetIndex,
        });
      }
    }
  }

  mergePlans.sort((a, b) => b.sourceIndex - a.sourceIndex);

  const removed = new Uint8Array(merged.length);
  for (let i = 0; i < mergePlans.length; i += 1) {
    const { sourceIndex, targetIndex } = mergePlans[i];
    if (removed[sourceIndex] || removed[targetIndex]) {
      continue;
    }
    compositePsdLayerIntoTarget(merged[targetIndex], merged[sourceIndex], imageWidth, imageHeight);
    removed[sourceIndex] = 1;
  }

  for (let i = merged.length - 1; i >= 0; i -= 1) {
    if (removed[i]) {
      merged.splice(i, 1);
    }
  }

  return merged;
}

function findPsdFeatureMergeTarget(layerSources, featureIndex, faceRegex, imageWidth, imageHeight) {
  const featureLayer = layerSources[featureIndex];
  let bestIndex = -1;
  let bestScore = -1;

  for (let i = 0; i < layerSources.length; i += 1) {
    if (i === featureIndex) {
      continue;
    }

    const candidate = layerSources[i];
    if (!faceRegex.test(candidate.name)) {
      continue;
    }

    const overlap = estimateLayerMaskOverlap(featureLayer, candidate, imageWidth, imageHeight);
    if (overlap <= 0) {
      continue;
    }

    if (overlap > bestScore) {
      bestScore = overlap;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function estimateLayerMaskOverlap(layerA, layerB, imageWidth, imageHeight) {
  const left = Math.max(layerA.left, layerB.left, 0);
  const top = Math.max(layerA.top, layerB.top, 0);
  const right = Math.min(layerA.left + layerA.width, layerB.left + layerB.width, imageWidth);
  const bottom = Math.min(layerA.top + layerA.height, layerB.top + layerB.height, imageHeight);
  if (right <= left || bottom <= top) {
    return 0;
  }

  let overlap = 0;
  for (let y = top; y < bottom; y += 1) {
    const ay = y - layerA.top;
    const by = y - layerB.top;
    for (let x = left; x < right; x += 1) {
      const ax = x - layerA.left;
      const bx = x - layerB.left;
      const aIndex = ay * layerA.width + ax;
      const bIndex = by * layerB.width + bx;
      if (layerA.colorImageData.data[aIndex * 4 + 3] > 0 && layerB.colorImageData.data[bIndex * 4 + 3] > 0) {
        overlap += 1;
      }
    }
  }

  return overlap;
}

function compositePsdLayerIntoTarget(targetLayer, featureLayer, imageWidth, imageHeight) {
  const left = Math.max(targetLayer.left, featureLayer.left, 0);
  const top = Math.max(targetLayer.top, featureLayer.top, 0);
  const right = Math.min(targetLayer.left + targetLayer.width, featureLayer.left + featureLayer.width, imageWidth);
  const bottom = Math.min(targetLayer.top + targetLayer.height, featureLayer.top + featureLayer.height, imageHeight);
  if (right <= left || bottom <= top) {
    return;
  }

  const targetPixels = targetLayer.colorImageData.data;
  const featurePixels = featureLayer.colorImageData.data;
  const targetDepthPixels = targetLayer.depthImageData.data;
  const featureDepthPixels = featureLayer.depthImageData.data;

  for (let y = top; y < bottom; y += 1) {
    const ty = y - targetLayer.top;
    const fy = y - featureLayer.top;
    for (let x = left; x < right; x += 1) {
      const tx = x - targetLayer.left;
      const fx = x - featureLayer.left;
      const targetOffset = (ty * targetLayer.width + tx) * 4;
      const featureOffset = (fy * featureLayer.width + fx) * 4;
      const srcAlpha = featurePixels[featureOffset + 3];
      if (srcAlpha <= 0) {
        continue;
      }

      const srcDepthAlpha = featureDepthPixels[featureOffset + 3];
      const dstDepthAlpha = targetDepthPixels[targetOffset + 3];
      const srcDepth = featureDepthPixels[featureOffset];
      const dstDepth = targetDepthPixels[targetOffset];
      const featureIsFront = srcDepthAlpha > 0 && (dstDepthAlpha <= 0 || srcDepth <= dstDepth);
      if (!featureIsFront && targetPixels[targetOffset + 3] > 0) {
        continue;
      }

      const srcAlphaN = srcAlpha / 255;
      const dstAlphaN = targetPixels[targetOffset + 3] / 255;
      const outAlpha = srcAlphaN + dstAlphaN * (1 - srcAlphaN);
      if (outAlpha <= 0) {
        continue;
      }

      for (let c = 0; c < 3; c += 1) {
        const src = featurePixels[featureOffset + c] / 255;
        const dst = targetPixels[targetOffset + c] / 255;
        const out = (src * srcAlphaN + dst * dstAlphaN * (1 - srcAlphaN)) / outAlpha;
        targetPixels[targetOffset + c] = clampByte(Math.round(out * 255));
      }
      targetPixels[targetOffset + 3] = clampByte(Math.round(outAlpha * 255));
      for (let c = 0; c < 3; c += 1) {
        targetDepthPixels[targetOffset + c] = featureDepthPixels[featureOffset + c];
      }
      targetDepthPixels[targetOffset + 3] = Math.max(dstDepthAlpha, srcDepthAlpha);
    }
  }

  const targetCanvas = document.createElement("canvas");
  targetCanvas.width = targetLayer.width;
  targetCanvas.height = targetLayer.height;
  const targetContext = targetCanvas.getContext("2d");
  targetContext.putImageData(targetLayer.colorImageData, 0, 0);

  targetLayer.colorTexture.dispose();
  const colorTexture = new THREE.CanvasTexture(targetCanvas);
  colorTexture.encoding = THREE.sRGBEncoding;
  colorTexture.minFilter = THREE.LinearFilter;
  colorTexture.magFilter = THREE.LinearFilter;
  colorTexture.needsUpdate = true;
  targetLayer.colorTexture = colorTexture;
  targetLayer.depthMaskPixels = extractLayerMaskPixels(targetLayer.depthImageData.data);
}

function extractLayerMaskPixels(rgbaPixels) {
  const maskPixels = new Uint8Array(rgbaPixels.length >> 2);
  for (let i = 0, p = 0; i < rgbaPixels.length; i += 4, p += 1) {
    maskPixels[p] = rgbaPixels[i + 3] > 0 ? 1 : 0;
  }
  return maskPixels;
}

function extractLayerRelativeDepthPixels(rgbaPixels) {
  const depthPixels = new Uint8Array(rgbaPixels.length >> 2);
  for (let i = 0, p = 0; i < rgbaPixels.length; i += 4, p += 1) {
    depthPixels[p] = rgbaPixels[i + 3] > 0 ? rgbaPixels[i] : 255;
  }
  return depthPixels;
}

function prunePsdForeignDepthSeeds(
  sourceDepthPixels,
  layer,
  layerIndex,
  imageWidth,
  imageHeight,
  stableDepthPixels,
  visibleLayerMap,
  maskPixels,
  threshold,
) {
  const filtered = sourceDepthPixels.slice();
  const debugState = new Uint8Array(filtered.length);
  const debugScore = new Uint8Array(filtered.length);
  const globalSupport = collectPositiveValues(filtered);
  const globalMedian = globalSupport.length ? medianOfNumbers(globalSupport) : 0;

  for (let i = 0; i < filtered.length; i += 1) {
    if (!maskPixels[i]) {
      continue;
    }
    debugState[i] = filtered[i] > 0 ? 2 : 1;
  }

  for (let y = 0; y < layer.height; y += 1) {
    for (let x = 0; x < layer.width; x += 1) {
      const localIndex = y * layer.width + x;
      const seedDepth = filtered[localIndex];
      if (!maskPixels[localIndex] || seedDepth === 0) {
        continue;
      }

      const globalX = layer.left + x;
      const globalY = layer.top + y;
      const sameLayerSupport = collectPsdLocalDepthSupport(
        filtered,
        maskPixels,
        layer.width,
        layer.height,
        x,
        y,
        4,
      );
      if (sameLayerSupport.length < 4) {
        continue;
      }

      const sameMedian = medianOfNumbers(sameLayerSupport);
      const sortedSupport = sameLayerSupport.slice().sort((a, b) => a - b);
      const q1 = percentileFromSorted(sortedSupport, 0.25);
      const q3 = percentileFromSorted(sortedSupport, 0.75);
      const localRange = sortedSupport[sortedSupport.length - 1] - sortedSupport[0];
      const foreignSupport = collectPsdForeignVisibleDepthSupport(
        imageWidth,
        imageHeight,
        globalX,
        globalY,
        4,
        layerIndex,
        stableDepthPixels,
        visibleLayerMap,
      );
      if (foreignSupport.length < 3) {
        continue;
      }

      const foreignMedian = medianOfNumbers(foreignSupport);
      const sameDistance = Math.abs(seedDepth - sameMedian);
      const foreignDistance = Math.abs(seedDepth - foreignMedian);
      const globalDistance = Math.abs(seedDepth - globalMedian);
      const localThreshold = Math.max(2, Math.min(6, threshold * 0.1));
      const bandDistance = seedDepth < q1 ? q1 - seedDepth : seedDepth > q3 ? seedDepth - q3 : 0;
      const hasSharpLocalGradient = localRange > localThreshold * 3 && bandDistance > localThreshold;
      const score = Math.max(sameDistance, globalDistance) - foreignDistance;
      debugScore[localIndex] = Math.max(debugScore[localIndex], clampByte(Math.round(score * 24)));

      if (
        (
          (sameDistance > localThreshold && globalDistance > localThreshold) ||
          hasSharpLocalGradient
        ) &&
        foreignDistance < Math.min(sameDistance, globalDistance)
      ) {
        filtered[localIndex] = 0;
        debugState[localIndex] = 3;
      }
    }
  }

  pruneThinForeignSeedComponents(
    filtered,
    debugState,
    debugScore,
    layer,
    layerIndex,
    imageWidth,
    imageHeight,
    stableDepthPixels,
    visibleLayerMap,
    maskPixels,
    globalMedian,
    threshold,
  );

  return {
    pixels: filtered,
    debugState,
    debugScore,
  };
}

function pruneThinForeignSeedComponents(
  depthPixels,
  debugState,
  debugScore,
  layer,
  layerIndex,
  imageWidth,
  imageHeight,
  stableDepthPixels,
  visibleLayerMap,
  maskPixels,
  globalMedian,
  threshold,
) {
  const totalPixels = layer.width * layer.height;
  const visited = new Uint8Array(totalPixels);
  const componentIds = new Int32Array(totalPixels);
  componentIds.fill(-1);
  const contourMask = buildLayerContourBandMask(maskPixels, layer.width, layer.height, 1);
  const wideContourMask = buildLayerContourBandMask(maskPixels, layer.width, layer.height, 4);
  const linkThreshold = Math.max(8, threshold * 0.35);
  const queue = new Int32Array(totalPixels);
  const neighbors = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  let componentId = 0;

  for (let start = 0; start < totalPixels; start += 1) {
    if (visited[start] || !maskPixels[start] || depthPixels[start] === 0) {
      continue;
    }

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    componentIds[start] = componentId;
    const indices = [];
    const values = [];
    let minX = layer.width;
    let maxX = 0;
    let minY = layer.height;
    let maxY = 0;
    let contourHits = 0;
    let wideContourHits = 0;

    while (head < tail) {
      const index = queue[head++];
      indices.push(index);
      values.push(depthPixels[index]);
      const x = index % layer.width;
      const y = Math.floor(index / layer.width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      if (contourMask[index]) {
        contourHits += 1;
      }
      if (wideContourMask[index]) {
        wideContourHits += 1;
      }

      for (let i = 0; i < neighbors.length; i += 1) {
        const [dx, dy] = neighbors[i];
        const sx = x + dx;
        const sy = y + dy;
        if (sx < 0 || sx >= layer.width || sy < 0 || sy >= layer.height) {
          continue;
        }

        const sampleIndex = sy * layer.width + sx;
        if (visited[sampleIndex] || !maskPixels[sampleIndex] || depthPixels[sampleIndex] === 0) {
          continue;
        }

        if (Math.abs(depthPixels[sampleIndex] - depthPixels[index]) > linkThreshold) {
          continue;
        }

        visited[sampleIndex] = 1;
        componentIds[sampleIndex] = componentId;
        queue[tail++] = sampleIndex;
      }
    }

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const componentMedian = medianOfNumbers(values);
    const sameLayerSupport = collectComponentExternalDepthSupport(
      depthPixels,
      maskPixels,
      componentIds,
      componentId,
      wideContourMask,
      layer.width,
      layer.height,
      minX,
      minY,
      maxX,
      maxY,
      5,
    );
    const foreignSupport = collectComponentForeignVisibleDepthSupport(
      indices,
      layer,
      imageWidth,
      imageHeight,
      stableDepthPixels,
      visibleLayerMap,
      layerIndex,
    );
    const contourRatio = contourHits / indices.length;
    const wideContourRatio = wideContourHits / indices.length;
    const sameMedian = sameLayerSupport.length ? medianOfNumbers(sameLayerSupport) : globalMedian;
    const foreignMedian = foreignSupport.length ? medianOfNumbers(foreignSupport) : componentMedian;
    const sameDistance = Math.abs(componentMedian - sameMedian);
    const foreignDistance = Math.abs(componentMedian - foreignMedian);
    const isThin = Math.min(width, height) <= 3 || indices.length <= Math.max(width, height) * 2;
    const isSmallish = indices.length <= Math.max(48, threshold * 8);
    const localThreshold = Math.max(2, Math.min(6, threshold * 0.1));
    const componentScore = sameDistance - foreignDistance;

    if (
      foreignSupport.length >= 4 &&
      (
        sameDistance > localThreshold ||
        (sameLayerSupport.length < 4 && wideContourRatio > 0.7)
      ) &&
      foreignDistance < sameDistance &&
      (contourRatio >= 0.35 || wideContourRatio >= 0.7) &&
      (isThin || isSmallish)
    ) {
      for (let i = 0; i < indices.length; i += 1) {
        depthPixels[indices[i]] = 0;
        debugState[indices[i]] = 4;
        debugScore[indices[i]] = Math.max(debugScore[indices[i]], clampByte(Math.round(componentScore * 24)));
      }
    }

    componentId += 1;
  }
}

function clampByte(value) {
  return Math.max(0, Math.min(255, value));
}

function collectComponentExternalDepthSupport(
  depthPixels,
  maskPixels,
  componentIds,
  componentId,
  contourMask,
  width,
  height,
  minX,
  minY,
  maxX,
  maxY,
  radius,
) {
  const values = [];
  const startX = Math.max(0, minX - radius);
  const startY = Math.max(0, minY - radius);
  const endX = Math.min(width - 1, maxX + radius);
  const endY = Math.min(height - 1, maxY + radius);

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const index = y * width + x;
      if (
        !maskPixels[index] ||
        depthPixels[index] === 0 ||
        componentIds[index] === componentId ||
        contourMask[index]
      ) {
        continue;
      }

      values.push(depthPixels[index]);
    }
  }

  return values;
}

function collectComponentForeignVisibleDepthSupport(
  indices,
  layer,
  imageWidth,
  imageHeight,
  stableDepthPixels,
  visibleLayerMap,
  layerIndex,
) {
  const values = [];

  for (let i = 0; i < indices.length; i += 1) {
    const index = indices[i];
    const x = index % layer.width;
    const y = Math.floor(index / layer.width);
    const globalX = layer.left + x;
    const globalY = layer.top + y;
    if (globalX < 0 || globalX >= imageWidth || globalY < 0 || globalY >= imageHeight) {
      continue;
    }

    for (let dy = -2; dy <= 2; dy += 1) {
      const sy = globalY + dy;
      if (sy < 0 || sy >= imageHeight) {
        continue;
      }

      for (let dx = -2; dx <= 2; dx += 1) {
        const sx = globalX + dx;
        if (sx < 0 || sx >= imageWidth) {
          continue;
        }

        const globalIndex = sy * imageWidth + sx;
        const visibleLayer = visibleLayerMap[globalIndex];
        if (visibleLayer < 0 || visibleLayer === layerIndex) {
          continue;
        }

        values.push(stableDepthPixels[globalIndex]);
      }
    }
  }

  return values;
}

function collectPsdLocalDepthSupport(depthPixels, maskPixels, width, height, centerX, centerY, radius) {
  const values = [];

  for (let dy = -radius; dy <= radius; dy += 1) {
    const sy = centerY + dy;
    if (sy < 0 || sy >= height) {
      continue;
    }

    for (let dx = -radius; dx <= radius; dx += 1) {
      const sx = centerX + dx;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height || (dx === 0 && dy === 0)) {
        continue;
      }

      const sampleIndex = sy * width + sx;
      const sampleDepth = depthPixels[sampleIndex];
      if (!maskPixels[sampleIndex] || sampleDepth === 0) {
        continue;
      }

      values.push(sampleDepth);
    }
  }

  return values;
}

function collectPsdForeignVisibleDepthSupport(imageWidth, imageHeight, centerX, centerY, radius, layerIndex, stableDepthPixels, visibleLayerMap) {
  const values = [];

  for (let dy = -radius; dy <= radius; dy += 1) {
    const sy = centerY + dy;
    if (sy < 0 || sy >= imageHeight) {
      continue;
    }

    for (let dx = -radius; dx <= radius; dx += 1) {
      const sx = centerX + dx;
      if (sx < 0 || sx >= imageWidth || (dx === 0 && dy === 0)) {
        continue;
      }

      const globalIndex = sy * imageWidth + sx;
      const visibleLayer = visibleLayerMap[globalIndex];
      if (visibleLayer < 0 || visibleLayer === layerIndex) {
        continue;
      }

      values.push(stableDepthPixels[globalIndex]);
    }
  }

  return values;
}

function medianOfNumbers(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
}

function percentileFromSorted(sorted, percentile) {
  if (!sorted.length) {
    return 0;
  }
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * percentile)));
  return sorted[index];
}

function collectPositiveValues(values) {
  const positive = [];
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] > 0) {
      positive.push(values[i]);
    }
  }
  return positive;
}

function buildVisiblePsdLayerMap(imageWidth, imageHeight, layers) {
  const visibleLayerMap = new Int32Array(imageWidth * imageHeight);
  const visibleDepthMap = new Uint8Array(imageWidth * imageHeight);
  visibleLayerMap.fill(-1);
  visibleDepthMap.fill(255);

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex];
    const maskPixels = layer.depthMaskPixels;
    const relativeDepthPixels = extractLayerRelativeDepthPixels(layer.depthImageData.data);

    for (let y = 0; y < layer.height; y += 1) {
      for (let x = 0; x < layer.width; x += 1) {
        const localIndex = y * layer.width + x;
        if (!maskPixels[localIndex]) {
          continue;
        }

        const globalX = layer.left + x;
        const globalY = layer.top + y;
        if (globalX < 0 || globalX >= imageWidth || globalY < 0 || globalY >= imageHeight) {
          continue;
        }

        const globalIndex = globalY * imageWidth + globalX;
        const relativeDepth = relativeDepthPixels[localIndex];
        if (visibleLayerMap[globalIndex] < 0 || relativeDepth < visibleDepthMap[globalIndex]) {
          visibleLayerMap[globalIndex] = layerIndex;
          visibleDepthMap[globalIndex] = relativeDepth;
        }
      }
    }
  }

  return visibleLayerMap;
}

function seedPsdLayerDepthPixels(layer, layerIndex, imageWidth, imageHeight, stableDepthPixels, visibleLayerMap, maskPixels) {
  const depthPixels = new Uint8Array(layer.width * layer.height);
  const stableSeedMask = buildLayerContourBandMask(layer.depthMaskPixels, layer.width, layer.height, 2);

  for (let y = 0; y < layer.height; y += 1) {
    for (let x = 0; x < layer.width; x += 1) {
      const localIndex = y * layer.width + x;
      if (!maskPixels[localIndex]) {
        continue;
      }
      if (stableSeedMask[localIndex]) {
        continue;
      }

      const globalX = layer.left + x;
      const globalY = layer.top + y;
      if (globalX < 0 || globalX >= imageWidth || globalY < 0 || globalY >= imageHeight) {
        continue;
      }

      const globalIndex = globalY * imageWidth + globalX;
      if (visibleLayerMap[globalIndex] === layerIndex) {
        depthPixels[localIndex] = stableDepthPixels[globalIndex];
      }
    }
  }

  return depthPixels;
}

function buildLayerContourBandMask(maskPixels, width, height, thickness) {
  const contourMask = new Uint8Array(maskPixels.length);
  const bandMask = new Uint8Array(maskPixels.length);

  for (let index = 0; index < maskPixels.length; index += 1) {
    if (isMaskContourPixel(maskPixels, width, height, index)) {
      contourMask[index] = 1;
      bandMask[index] = 1;
    }
  }

  let frontier = contourMask;
  for (let pass = 1; pass < thickness; pass += 1) {
    frontier = expandMaskFrontier(maskPixels, width, height, frontier, bandMask);
  }

  return bandMask;
}

function buildPositiveDepthErodeMask(depthPixels, width, height, thickness) {
  const positiveMask = new Uint8Array(depthPixels.length);
  for (let i = 0; i < depthPixels.length; i += 1) {
    positiveMask[i] = depthPixels[i] > 0 ? 1 : 0;
  }

  let eroded = positiveMask.slice();
  for (let pass = 0; pass < thickness; pass += 1) {
    eroded = erodeBinaryMask(eroded, width, height);
  }

  const removedMask = new Uint8Array(depthPixels.length);
  for (let i = 0; i < positiveMask.length; i += 1) {
    if (positiveMask[i] && !eroded[i]) {
      removedMask[i] = 1;
    }
  }

  return removedMask;
}

function erodePositiveDepthMask(depthPixels, width, height, thickness) {
  let mask = new Uint8Array(depthPixels.length);
  for (let i = 0; i < depthPixels.length; i += 1) {
    mask[i] = depthPixels[i] > 0 ? 1 : 0;
  }

  for (let pass = 0; pass < thickness; pass += 1) {
    mask = erodeBinaryMask(mask, width, height);
  }

  return mask;
}

function erodeBinaryMask(maskPixels, width, height) {
  const eroded = new Uint8Array(maskPixels.length);
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

  for (let index = 0; index < maskPixels.length; index += 1) {
    if (!maskPixels[index]) {
      continue;
    }

    const x = index % width;
    const y = Math.floor(index / width);
    let keep = true;
    for (let i = 0; i < offsets.length; i += 1) {
      const [dx, dy] = offsets[i];
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height || !maskPixels[sy * width + sx]) {
        keep = false;
        break;
      }
    }

    if (keep) {
      eroded[index] = 1;
    }
  }

  return eroded;
}

function isMaskContourPixel(maskPixels, width, height, index) {
  if (!maskPixels[index]) {
    return false;
  }

  const x = index % width;
  const y = Math.floor(index / width);
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  for (let i = 0; i < offsets.length; i += 1) {
    const [dx, dy] = offsets[i];
    const sx = x + dx;
    const sy = y + dy;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      return true;
    }

    if (!maskPixels[sy * width + sx]) {
      return true;
    }
  }

  return false;
}

function expandMaskFrontier(maskPixels, width, height, frontier, bandMask) {
  const next = new Uint8Array(maskPixels.length);
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

  for (let index = 0; index < frontier.length; index += 1) {
    if (!frontier[index]) {
      continue;
    }

    const x = index % width;
    const y = Math.floor(index / width);
    for (let i = 0; i < offsets.length; i += 1) {
      const [dx, dy] = offsets[i];
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
        continue;
      }

      const sampleIndex = sy * width + sx;
      if (!maskPixels[sampleIndex] || bandMask[sampleIndex]) {
        continue;
      }

      bandMask[sampleIndex] = 1;
      next[sampleIndex] = 1;
    }
  }

  return next;
}

function inpaintMaskedLayerDepth(sourceDepthPixels, maskPixels, width, height) {
  const depthPixels = sourceDepthPixels.slice();
  const totalPixels = width * height;
  const queue = new Int32Array(totalPixels);
  const queued = new Uint8Array(totalPixels);
  let head = 0;
  let tail = 0;

  for (let index = 0; index < totalPixels; index += 1) {
    if (!maskPixels[index] || depthPixels[index] > 0) {
      continue;
    }
    if (!hasPositiveMaskedNeighbor(depthPixels, maskPixels, width, height, index)) {
      continue;
    }
    queue[tail++] = index;
    queued[index] = 1;
  }

  while (head < tail) {
    const index = queue[head++];
    if (!maskPixels[index] || depthPixels[index] > 0) {
      continue;
    }

    const fillDepth = sampleMaskedNeighborMedian(depthPixels, maskPixels, width, height, index);
    if (fillDepth <= 0) {
      continue;
    }

    depthPixels[index] = fillDepth;
    tail = enqueueMaskedGapNeighbors(queue, queued, depthPixels, maskPixels, width, height, index, tail);
  }

  return depthPixels;
}

function hasPositiveMaskedNeighbor(depthPixels, maskPixels, width, height, index) {
  const x = index % width;
  const y = Math.floor(index / width);
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

  for (let i = 0; i < offsets.length; i += 1) {
    const [dx, dy] = offsets[i];
    const sx = x + dx;
    const sy = y + dy;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      continue;
    }
    const sampleIndex = sy * width + sx;
    if (maskPixels[sampleIndex] && depthPixels[sampleIndex] > 0) {
      return true;
    }
  }

  return false;
}

function sampleMaskedNeighborMedian(depthPixels, maskPixels, width, height, index) {
  const x = index % width;
  const y = Math.floor(index / width);
  const values = [];
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

  for (let i = 0; i < offsets.length; i += 1) {
    const [dx, dy] = offsets[i];
    const sx = x + dx;
    const sy = y + dy;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      continue;
    }

    const sampleIndex = sy * width + sx;
    if (!maskPixels[sampleIndex] || depthPixels[sampleIndex] <= 0) {
      continue;
    }

    values.push(depthPixels[sampleIndex]);
  }

  if (!values.length) {
    return 0;
  }

  return medianOfNumbers(values);
}

function sampleMaskedNeighborDepth(depthPixels, maskPixels, width, height, index) {
  const x = index % width;
  const y = Math.floor(index / width);
  const offsets = [
    [-1, 0, 1],
    [1, 0, 1],
    [0, -1, 1],
    [0, 1, 1],
    [-1, -1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [1, 1, Math.SQRT2],
  ];

  let weightedSum = 0;
  let totalWeight = 0;

  for (let i = 0; i < offsets.length; i += 1) {
    const [dx, dy, distance] = offsets[i];
    const sx = x + dx;
    const sy = y + dy;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      continue;
    }
    const sampleIndex = sy * width + sx;
    if (!maskPixels[sampleIndex] || depthPixels[sampleIndex] <= 0) {
      continue;
    }
    const weight = 1 / distance;
    weightedSum += depthPixels[sampleIndex] * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? Math.max(1, Math.min(255, Math.round(weightedSum / totalWeight))) : 0;
}

function enqueueMaskedGapNeighbors(queue, queued, depthPixels, maskPixels, width, height, index, tail) {
  const x = index % width;
  const y = Math.floor(index / width);
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

  let nextTail = tail;

  for (let i = 0; i < offsets.length; i += 1) {
    const [dx, dy] = offsets[i];
    const sx = x + dx;
    const sy = y + dy;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      continue;
    }
    const sampleIndex = sy * width + sx;
    if (!maskPixels[sampleIndex] || depthPixels[sampleIndex] > 0 || queued[sampleIndex]) {
      continue;
    }
    queue[nextTail++] = sampleIndex;
    queued[sampleIndex] = 1;
  }

  return nextTail;
}

function flattenPsdLayers(layers, output = []) {
  for (let i = 0; i < layers.length; i += 1) {
    const layer = layers[i];
    if (layer.hidden) {
      continue;
    }

    if (layer.children && layer.children.length) {
      flattenPsdLayers(layer.children, output);
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
    });
  }

  return output;
}

function extractDepthPixelsFromCanvas(canvas) {
  const context = canvas.getContext("2d");
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = new Uint8Array(canvas.width * canvas.height);

  for (let i = 0, p = 0; i < imageData.data.length; i += 4, p += 1) {
    const alpha = imageData.data[i + 3];
    if (alpha === 0) {
      pixels[p] = 0;
      continue;
    }
    const gray = imageData.data[i];
    pixels[p] = gray;
  }

  return pixels;
}

async function replaceImage(kind, file) {
  statusEl.textContent = `Loading ${kind}...`;

  if ((kind === "color" || kind === "depth") && isPsdFilename(file.name)) {
    const buffer = await file.arrayBuffer();
    if (kind === "color") {
      renderState.pendingPsdColorBuffer = buffer;
    } else {
      renderState.pendingPsdDepthBuffer = buffer;
    }

    if (renderState.pendingPsdColorBuffer && renderState.pendingPsdDepthBuffer) {
      await loadPsdPair(renderState.pendingPsdColorBuffer, renderState.pendingPsdDepthBuffer);
      renderState.sourceMode = "psd";
      sourceModeEl.value = "psd";
      syncViewerModeUi();
      buildMesh();
      syncThumbs();
      statusEl.textContent = "Loaded PSD pair.";
    } else {
      statusEl.textContent = `Waiting for ${kind === "color" ? "depth" : "color"} PSD...`;
    }
    return;
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    renderState.sourceMode = "raster";
    sourceModeEl.value = "raster";
    renderState.imageWidth = renderState.rasterImageWidth;
    renderState.imageHeight = renderState.rasterImageHeight;
    syncViewerModeUi();

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
      renderState.rasterImageWidth = texture.image.width;
      renderState.rasterImageHeight = texture.image.height;
      if (renderState.material) {
      renderState.material.uniforms.uColorTexture.value = texture;
      }
      syncThumbs();
      refreshStatusCounts();
      return;
    }

    if (kind === "depth") {
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
      renderState.rasterImageWidth = texture.image.width;
      renderState.rasterImageHeight = texture.image.height;
      rebuildSegments();
      rebuildDepthModeResources();
      buildMesh();
      syncThumbs();
      return;
    }

    const segmentImage = await loadRgbPixels(objectUrl);
    if (
      segmentImage.width !== renderState.imageWidth ||
      segmentImage.height !== renderState.imageHeight
    ) {
      throw new Error("Segment image size must match the current color/depth image.");
    }

    revokeObjectUrl("segment");
    renderState.segmentSourcePixels = segmentImage.pixels;
    renderState.segmentObjectUrl = objectUrl;
    renderState.rasterImageWidth = segmentImage.width;
    renderState.rasterImageHeight = segmentImage.height;
    renderState.segmentThumbUrl = createSegmentThumbDataUrl(
      renderState.segmentSourcePixels,
      renderState.imageWidth,
      renderState.imageHeight,
    );
    rebuildSegments();
    rebuildDepthModeResources();
    buildMesh();
    syncThumbs();
    rebuildSegmentList();
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    statusEl.textContent = `Failed: ${error.message}`;
    console.error(error);
  }
}

function syncThumbs() {
  if (renderState.sourceMode === "psd") {
    colorThumbEl.src = renderState.psdColorPreviewUrl || defaultColorUrl;
    depthThumbEl.src = renderState.psdDepthPreviewUrl || defaultDepthUrl;
    segmentThumbEl.src = "";
    return;
  }

  colorThumbEl.src = renderState.colorObjectUrl || defaultColorUrl;
  depthThumbEl.src = renderState.depthObjectUrl || defaultDepthUrl;
  segmentThumbEl.src = renderState.segmentThumbUrl || renderState.segmentObjectUrl || defaultSegmentUrl;
}

function isPsdFilename(name) {
  return /\.psd$/i.test(name || "");
}

function createSegmentThumbDataUrl(rgbPixels, width, height) {
  if (!rgbPixels || !width || !height) {
    return "";
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const imageData = context.createImageData(width, height);

  for (let src = 0, dst = 0; src < rgbPixels.length; src += 3, dst += 4) {
    imageData.data[dst] = rgbPixels[src];
    imageData.data[dst + 1] = rgbPixels[src + 1];
    imageData.data[dst + 2] = rgbPixels[src + 2];
    imageData.data[dst + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function syncViewerModeUi() {
  const isPsd = renderState.sourceMode === "psd";
  segmentHudEl.style.display = "";
  segmentThumbButtonEl.parentElement.style.display = isPsd ? "none" : "";
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

  if (kind === "segment" && renderState.segmentObjectUrl) {
    URL.revokeObjectURL(renderState.segmentObjectUrl);
    renderState.segmentObjectUrl = null;
  }
}

function refreshStatusCounts() {
  if (renderState.sourceMode === "psd") {
    const layerCount = renderState.psdLayerEntries.length;
    const visibleLayers = renderState.psdLayerVisibility.filter(Boolean).length;
    const triangleCount = renderState.psdLayerMeshes.reduce(
      (sum, entry) => sum + (entry.mesh.geometry.index ? entry.mesh.geometry.index.count / 3 : 0),
      0,
    );
    const vertexCount = renderState.psdLayerMeshes.reduce(
      (sum, entry) => sum + entry.mesh.geometry.attributes.position.count,
      0,
    );
    const debugSuffix = renderState.psdDebugLayerIndex >= 0
      ? ` | debug D=kept R=pixel M=component Y=contour dark=empty`
      : "";
    statusEl.textContent = `${renderState.imageWidth}x${renderState.imageHeight} | psd-layers ${visibleLayers}/${layerCount} | vertices ${vertexCount.toLocaleString()} | triangles ${triangleCount.toLocaleString()}${debugSuffix}`;
    return;
  }

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
  disposeRepairedBaseDepthTexture();

  if (depthModeEl.value === "raw") {
    renderState.baseDepthTexture = renderState.rawDepthTexture;
    renderState.baseDepthPixels = renderState.rawDepthPixels;
    rebuildRepairedBaseDepth();
    return;
  }

  const generated = createSegmentedGridDepthResources(
    renderState.imageWidth,
    renderState.imageHeight,
    renderState.rawSegmentData,
    gridSpecModeEl.value,
    Number(gridXEl.value),
    Number(gridYEl.value),
    Number(kernelSizeEl.value),
    interpModeEl.value,
  );

  renderState.generatedDepthTexture = generated.texture;
  renderState.baseDepthTexture = generated.texture;
  renderState.baseDepthPixels = generated.pixels;
  rebuildRepairedBaseDepth();
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

function disposeRepairedBaseDepthTexture() {
  if (renderState.repairedBaseDepthTexture) {
    renderState.repairedBaseDepthTexture.dispose();
    renderState.repairedBaseDepthTexture = null;
    renderState.repairedBaseDepthPixels = null;
    renderState.repairedBaseGapMask = null;
  }
}

function disposeMeshDepthTexture() {
  if (renderState.meshDepthTexture) {
    if (renderState.meshDepthTexture !== renderState.activeDepthTexture) {
      renderState.meshDepthTexture.dispose();
    }
    renderState.meshDepthTexture = null;
    renderState.meshDepthPixels = null;
  }
}

function disposeProcessedDepthTexture() {
  if (renderState.processedDepthTexture) {
    renderState.processedDepthTexture.dispose();
    renderState.processedDepthTexture = null;
  }
}

function disposeRawDepthTexture() {
  if (renderState.rawDepthTexture) {
    renderState.rawDepthTexture.dispose();
    renderState.rawDepthTexture = null;
    renderState.rawDepthPixels = null;
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
  renderState.rawSegmentData = segmentation.segmentData;
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
  disposeRawDepthTexture();
  disposeProcessedDepthTexture();

  const raw = composeSegmentDepthResources(
    renderState.imageWidth,
    renderState.imageHeight,
    renderState.rawSegmentData,
    "localDepthPixels",
  );
  renderState.rawDepthPixels = raw.pixels;
  renderState.rawDepthTexture = raw.texture;

  const processed = preprocessSegmentDepths(
    renderState.imageWidth,
    renderState.imageHeight,
    renderState.rawSegmentData,
  );

  renderState.segmentData = processed.segmentData;
  renderState.processedDepthPixels = processed.pixels;
  renderState.processedDepthTexture = processed.texture;
}

function composeSegmentDepthResources(width, height, segmentData, depthKey) {
  const pixels = new Uint8Array(width * height);

  for (let segmentIndex = 0; segmentIndex < segmentData.length; segmentIndex += 1) {
    const segment = segmentData[segmentIndex];
    if (!segment || !segment.indices.length || !segment.hasSourceDepth) {
      continue;
    }

    const localPixels = segment[depthKey];
    if (!localPixels || !localPixels.length) {
      continue;
    }

    for (let i = 0; i < segment.indices.length; i += 1) {
      const pixelIndex = segment.indices[i];
      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      const localIndex = (y - segment.bounds.minY) * segment.localWidth + (x - segment.bounds.minX);
      pixels[pixelIndex] = localPixels[localIndex];
    }
  }

  return createDepthTextureResources(width, height, pixels);
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

  refineAntialiasedSegmentBoundaries(
    segmentMap,
    finalPalette,
    segmentPixels,
    width,
    height,
    2,
  );

  finalCounts.fill(0);
  for (let i = 0; i < finalSums.length; i += 1) {
    finalSums[i].r = 0;
    finalSums[i].g = 0;
    finalSums[i].b = 0;
  }

  for (let index = 0; index < totalPixels; index += 1) {
    const finalIndex = segmentMap[index];
    if (finalIndex < 0) {
      continue;
    }
    const offset = index * 3;
    finalSums[finalIndex].r += segmentPixels[offset];
    finalSums[finalIndex].g += segmentPixels[offset + 1];
    finalSums[finalIndex].b += segmentPixels[offset + 2];
    finalCounts[finalIndex] += 1;
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

function refineAntialiasedSegmentBoundaries(segmentMap, palette, segmentPixels, width, height, passes) {
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

  for (let pass = 0; pass < passes; pass += 1) {
    const next = segmentMap.slice();

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        const current = segmentMap[index];
        if (current < 0) {
          continue;
        }

        const counts = new Map();
        for (let i = 0; i < offsets.length; i += 1) {
          const [dx, dy] = offsets[i];
          const neighbor = segmentMap[(y + dy) * width + (x + dx)];
          if (neighbor < 0) {
            continue;
          }
          counts.set(neighbor, (counts.get(neighbor) || 0) + 1);
        }

        if (counts.size < 2) {
          continue;
        }

        let dominant = current;
        let dominantCount = counts.get(current) || 0;
        for (const [segmentIndex, count] of counts.entries()) {
          if (count > dominantCount) {
            dominant = segmentIndex;
            dominantCount = count;
          }
        }

        if (dominant === current || dominantCount < 4) {
          continue;
        }

        const offset = index * 3;
        const color = {
          r: segmentPixels[offset],
          g: segmentPixels[offset + 1],
          b: segmentPixels[offset + 2],
        };
        const currentDistance = colorDistanceSquared(color, palette[current]);
        const dominantDistance = colorDistanceSquared(color, palette[dominant]);

        if (dominantDistance <= currentDistance * 1.15 || (counts.get(current) || 0) <= 1) {
          next[index] = dominant;
        }
      }
    }

    segmentMap.set(next);
  }
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
  const filtered = rejectMaskedDepthOutliers(sourcePixels, mask, width, height);
  const holeFilled = fillMaskedDepthHoles(filtered, mask, width, height, 12);
  const boundaryCorrected = correctSegmentBoundaryDepthLeakage(holeFilled, mask, width, height);
  const median = applyMaskedMedianFilter(boundaryCorrected, mask, width, height, 1);
  const blurKernel = getDepthBlurKernel(1);
  const blurred = applyMaskedBlurFilter(median, mask, width, height, 1, blurKernel);
  const sharpened = applyMaskedUnsharpFilter(median, blurred, mask, 0.65);
  const despiked = suppressMaskedDepthSpikes(sharpened, mask, width, height, 2);
  return enforceMaskedDepthContinuity(despiked, mask, width, height, 3);
}

function rejectMaskedDepthOutliers(sourcePixels, mask, width, height) {
  const output = sourcePixels.slice();
  const rowStats = computeMaskedAxisStats(sourcePixels, mask, width, height, "row");
  const colStats = computeMaskedAxisStats(sourcePixels, mask, width, height, "col");

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const depth = sourcePixels[index];
      if (!mask[index] || depth <= 0) {
        continue;
      }

      const localStats = sampleMaskedDepthStats(sourcePixels, mask, width, height, x, y, 2);
      const rowVote = axisOutlierVote(depth, rowStats, y, 2.5, 8);
      const colVote = axisOutlierVote(depth, colStats, x, 2.5, 8);
      const localVote = statsOutlierVote(depth, localStats, 2.25, 6);
      const similarNeighbors = countSimilarNeighbors(sourcePixels, mask, width, height, x, y, depth, localStats);

      const votes = rowVote + colVote + localVote;
      if (votes >= 2 && similarNeighbors <= 1) {
        output[index] = 0;
      }
    }
  }

  return output;
}

function computeMaskedAxisStats(sourcePixels, mask, width, height, axis) {
  const lineCount = axis === "row" ? height : width;
  const lineSpan = axis === "row" ? width : height;
  const medians = new Float32Array(lineCount);
  const mads = new Float32Array(lineCount);
  const valid = new Uint8Array(lineCount);
  const samples = [];

  for (let line = 0; line < lineCount; line += 1) {
    samples.length = 0;

    for (let step = 0; step < lineSpan; step += 1) {
      const x = axis === "row" ? step : line;
      const y = axis === "row" ? line : step;
      const index = y * width + x;
      if (!mask[index] || sourcePixels[index] <= 0) {
        continue;
      }
      samples.push(sourcePixels[index]);
    }

    if (samples.length < 3) {
      continue;
    }

    samples.sort((a, b) => a - b);
    const median = samples[(samples.length - 1) >> 1];
    const deviations = samples.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
    medians[line] = median;
    mads[line] = deviations[(deviations.length - 1) >> 1];
    valid[line] = 1;
  }

  return { medians, mads, valid };
}

function axisOutlierVote(depth, axisStats, lineIndex, madScale, floor) {
  if (!axisStats.valid[lineIndex]) {
    return 0;
  }

  const median = axisStats.medians[lineIndex];
  const mad = axisStats.mads[lineIndex];
  const limit = Math.max(floor, mad * madScale + floor * 0.5);
  return Math.abs(depth - median) > limit ? 1 : 0;
}

function statsOutlierVote(depth, stats, madScale, floor) {
  if (!stats) {
    return 0;
  }

  const limit = Math.max(floor, stats.mad * madScale + floor * 0.5);
  return Math.abs(depth - stats.median) > limit ? 1 : 0;
}

function countSimilarNeighbors(sourcePixels, mask, width, height, x, y, depth, localStats) {
  const tolerance = localStats ? Math.max(8, localStats.mad * 2 + 4) : 10;
  let count = 0;

  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      if (ox === 0 && oy === 0) {
        continue;
      }

      const sx = x + ox;
      const sy = y + oy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
        continue;
      }

      const index = sy * width + sx;
      if (!mask[index] || sourcePixels[index] <= 0) {
        continue;
      }

      if (Math.abs(sourcePixels[index] - depth) <= tolerance) {
        count += 1;
      }
    }
  }

  return count;
}

function fillMaskedDepthHoles(sourcePixels, mask, width, height, passes) {
  let current = sourcePixels.slice();

  for (let pass = 0; pass < passes; pass += 1) {
    const next = current.slice();
    let filled = 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!mask[index] || current[index] > 0) {
          continue;
        }

        const neighbors = collectMaskedNeighborDepths(current, mask, width, height, x, y);
        if (neighbors.length < 2) {
          continue;
        }

        neighbors.sort((a, b) => a - b);
        next[index] = neighbors[(neighbors.length - 1) >> 1];
        filled += 1;
      }
    }

    current = next;
    if (filled === 0) {
      break;
    }
  }

  return current;
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

  if (renderState.sourceMode === "psd") {
    renderState.psdLayerEntries.forEach((layer, index) => {
      const row = document.createElement("div");
      row.className = "segment-item";
      row.dataset.segmentIndex = String(index);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = renderState.psdLayerVisibility[index];
      checkbox.dataset.segmentIndex = String(index);
      checkbox.tabIndex = -1;
      checkbox.style.pointerEvents = "none";

      row.addEventListener("click", (event) => {
        const itemIndex = Number(row.dataset.segmentIndex);
        applySegmentToggle(itemIndex, event.shiftKey);
      });

      const swatch = document.createElement("span");
      swatch.className = "segment-swatch";
      swatch.style.backgroundColor = "#d0d7de";

      const name = document.createElement("span");
      name.className = "segment-name";
      name.textContent = layer.name || `Layer ${index + 1}`;

      const size = document.createElement("span");
      size.className = "segment-size";
      size.textContent = `${layer.width}x${layer.height}`;

      const controls = document.createElement("div");
      controls.className = "segment-controls";

      const debugButton = createSegmentControlButton("D", "debug-toggle", index);
      const offsetDown = createSegmentControlButton("-", "offset-down", index);
      const offsetUp = createSegmentControlButton("+", "offset-up", index);
      const scaleDown = createSegmentControlButton("<", "scale-down", index);
      const scaleUp = createSegmentControlButton(">", "scale-up", index);
      const metrics = document.createElement("span");
      metrics.className = "segment-metrics";
      metrics.dataset.segmentMetrics = String(index);

      controls.append(debugButton, offsetDown, offsetUp, scaleDown, scaleUp, metrics);
      row.append(checkbox, swatch, name, size, controls);
      segmentListEl.appendChild(row);
    });

    syncSegmentAdjustmentLabels();
    syncSegmentCheckboxes();
    return;
  }

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
  if (renderState.sourceMode === "psd") {
    if (invertOthers) {
      const nextTargetState = !renderState.psdLayerVisibility[segmentIndex];
      renderState.psdLayerVisibility = renderState.psdLayerVisibility.map((_, index) => (
        index === segmentIndex ? nextTargetState : !nextTargetState
      ));
    } else {
      renderState.psdLayerVisibility[segmentIndex] = !renderState.psdLayerVisibility[segmentIndex];
    }

    syncSegmentCheckboxes();
    buildMesh();
    refreshStatusCounts();
    return;
  }

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
    checkbox.checked = renderState.sourceMode === "psd"
      ? renderState.psdLayerVisibility[index]
      : renderState.segmentVisibility[index];
  });
}

function syncSegmentAdjustmentLabels() {
  const labels = segmentListEl.querySelectorAll("[data-segment-metrics]");
  labels.forEach((label) => {
    const index = Number(label.dataset.segmentMetrics);
    if (renderState.sourceMode === "psd") {
      label.textContent = `o${renderState.psdLayerDepthOffsets[index]} s${renderState.psdLayerDepthScales[index].toFixed(2)}`;
    } else {
      label.textContent = `o${renderState.segmentDepthOffsets[index]} s${renderState.segmentDepthScales[index].toFixed(2)}`;
    }
  });

  const debugButtons = segmentListEl.querySelectorAll('[data-segment-action="debug-toggle"]');
  debugButtons.forEach((button) => {
    const index = Number(button.dataset.segmentIndex);
    const active = renderState.psdDebugLayerIndex === index;
    button.textContent = active ? "H" : "D";
    button.title = active ? "Hide debug evidence" : "Show debug evidence";
    button.style.background = active ? "rgba(255, 120, 120, 0.28)" : "rgba(255, 255, 255, 0.05)";
  });

  updatePsdDebugPanel();
}

function applySegmentDepthAdjustment(action, segmentIndex) {
  if (action === "debug-toggle" && renderState.sourceMode === "psd") {
    renderState.psdDebugLayerIndex = renderState.psdDebugLayerIndex === segmentIndex ? -1 : segmentIndex;
    syncSegmentAdjustmentLabels();
    buildMesh();
    return;
  }

  const offsets = renderState.sourceMode === "psd"
    ? renderState.psdLayerDepthOffsets
    : renderState.segmentDepthOffsets;
  const scales = renderState.sourceMode === "psd"
    ? renderState.psdLayerDepthScales
    : renderState.segmentDepthScales;

  if (action === "offset-down") {
    offsets[segmentIndex] -= segmentDepthOffsetStep;
  } else if (action === "offset-up") {
    offsets[segmentIndex] += segmentDepthOffsetStep;
  } else if (action === "scale-down") {
    scales[segmentIndex] = Math.max(
      0.1,
      Number((scales[segmentIndex] - segmentDepthScaleStep).toFixed(2)),
    );
  } else if (action === "scale-up") {
    scales[segmentIndex] = Number(
      (scales[segmentIndex] + segmentDepthScaleStep).toFixed(2),
    );
  }

  syncSegmentAdjustmentLabels();
  if (renderState.sourceMode !== "psd") {
    applySegmentDepthAdjustments();
  }
  buildMesh();
}

function applySegmentDepthAdjustments() {
  disposeAdjustedDepthTexture();

  if (!renderState.repairedBaseDepthPixels) {
    return;
  }

  const adjustedPixels = new Uint8Array(renderState.baseDepthPixels.length);

  for (let index = 0; index < renderState.repairedBaseDepthPixels.length; index += 1) {
    const baseDepth = renderState.repairedBaseDepthPixels[index];
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

function rebuildRepairedBaseDepth() {
  const baseSegmentDepthMeans = computeSegmentDepthMeans(
    renderState.baseDepthPixels,
    renderState.segmentMap,
    renderState.segmentCount,
  );
  const repaired = repairDepthDiscontinuities(
    renderState.baseDepthPixels,
    renderState.segmentMap,
    baseSegmentDepthMeans,
    renderState.imageWidth,
    renderState.imageHeight,
    Number(depthDiscontinuityEl.value),
  );

  renderState.repairedBaseDepthTexture = repaired.texture;
  renderState.repairedBaseDepthPixels = repaired.pixels;
  renderState.repairedBaseGapMask = repaired.gapMask;
  renderState.segmentDepthMeans = computeSegmentDepthMeans(
    repaired.pixels,
    renderState.segmentMap,
    renderState.segmentCount,
  );
  applySegmentDepthAdjustments();
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

function createBinaryMaskTexture(width, height, maskPixels) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const imageData = context.createImageData(width, height);

  for (let pixelIndex = 0; pixelIndex < maskPixels.length; pixelIndex += 1) {
    const value = maskPixels[pixelIndex] ? 255 : 0;
    const imageIndex = pixelIndex * 4;
    imageData.data[imageIndex] = value;
    imageData.data[imageIndex + 1] = value;
    imageData.data[imageIndex + 2] = value;
    imageData.data[imageIndex + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function updatePsdDebugPanel() {
  if (!psdDebugPanelEl) {
    return;
  }

  if (renderState.sourceMode !== "psd" || renderState.psdDebugLayerIndex < 0) {
    psdDebugPanelEl.classList.remove("is-visible");
    psdDebugImageEl.removeAttribute("src");
    return;
  }

  const layer = renderState.psdLayerEntries[renderState.psdDebugLayerIndex];
  if (!layer || !layer.debugPreviewUrl) {
    psdDebugPanelEl.classList.remove("is-visible");
    psdDebugImageEl.removeAttribute("src");
    return;
  }

  psdDebugTitleEl.textContent = `PSD debug: ${layer.name || `Layer ${renderState.psdDebugLayerIndex + 1}`} | removed ${layer.removedDepthPixels || 0}px`;
  psdDebugImageEl.src = layer.debugPreviewUrl;
  psdDebugPanelEl.classList.add("is-visible");
}

function createPsdDebugTexture(width, height, maskPixels, debugState, debugScore) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const imageData = context.createImageData(width, height);

  for (let pixelIndex = 0; pixelIndex < maskPixels.length; pixelIndex += 1) {
    const imageIndex = pixelIndex * 4;
    if (!maskPixels[pixelIndex]) {
      imageData.data[imageIndex + 3] = 0;
      continue;
    }

    const state = debugState[pixelIndex];
    const score = debugScore[pixelIndex] / 255;
    let r = 24;
    let g = 24;
    let b = 30;
    let a = 220;

    if (state === 1) {
      r = 18;
      g = 18;
      b = 28;
      a = 120;
    } else if (state === 2) {
      r = Math.round(20 + score * 40);
      g = Math.round(70 + score * 120);
      b = Math.round(180 + score * 60);
    } else if (state === 3) {
      r = 255;
      g = Math.round(170 * (1 - score * 0.7));
      b = Math.round(40 * (1 - score * 0.3));
    } else if (state === 4) {
      r = 255;
      g = Math.round(60 + score * 30);
      b = Math.round(170 + score * 60);
    } else if (state === 5) {
      r = 255;
      g = 235;
      b = 90;
    }

    imageData.data[imageIndex] = r;
    imageData.data[imageIndex + 1] = g;
    imageData.data[imageIndex + 2] = b;
    imageData.data[imageIndex + 3] = a;
  }

  context.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return {
    texture,
    url: canvas.toDataURL("image/png"),
  };
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
