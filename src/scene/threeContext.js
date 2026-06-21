export function createThreeContext(THREE, appEl, win = window) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(win.devicePixelRatio, 2));
  renderer.setSize(win.innerWidth, win.innerHeight);
  appEl.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = createViewerCamera(THREE, win);
  camera.position.set(0, 0, 2);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enablePan = true;
  controls.enableDamping = true;
  controls.minDistance = 0.7;
  controls.maxDistance = 2.4;
  controls.minZoom = 0.7;
  controls.maxZoom = 3.2;
  controls.minPolarAngle = 0.08;
  controls.maxPolarAngle = Math.PI - 0.08;
  controls.rotateSpeed = 0.7;
  controls.panSpeed = 0.9;
  controls.zoomSpeed = 0.35;
  controls.screenSpacePanning = true;
  controls.target.set(0, 0, 0);

  return {
    renderer,
    scene,
    camera,
    controls,
  };
}

export function updateViewerCameraProjection(camera, win = window) {
  if (!camera.isOrthographicCamera) {
    camera.aspect = win.innerWidth / win.innerHeight;
    camera.updateProjectionMatrix();
    return;
  }

  const aspect = win.innerWidth / Math.max(1, win.innerHeight);
  const viewHeight = camera.userData.viewHeight || 1.55;
  camera.left = -0.5 * viewHeight * aspect;
  camera.right = 0.5 * viewHeight * aspect;
  camera.top = 0.5 * viewHeight;
  camera.bottom = -0.5 * viewHeight;
  camera.updateProjectionMatrix();
}

function createViewerCamera(THREE, win) {
  const viewHeight = 1.55;
  const aspect = win.innerWidth / Math.max(1, win.innerHeight);
  const camera = new THREE.OrthographicCamera(
    -0.5 * viewHeight * aspect,
    0.5 * viewHeight * aspect,
    0.5 * viewHeight,
    -0.5 * viewHeight,
    0.01,
    20,
  );
  camera.userData.viewHeight = viewHeight;
  return camera;
}
