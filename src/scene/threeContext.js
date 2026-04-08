export function createThreeContext(THREE, appEl, win = window) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(win.devicePixelRatio, 2));
  renderer.setSize(win.innerWidth, win.innerHeight);
  appEl.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(42, win.innerWidth / win.innerHeight, 0.01, 20);
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

  return {
    renderer,
    scene,
    camera,
    controls,
  };
}
