export function createSceneRuntime({ renderer, scene, camera, controls, updateViewerCameraProjection }) {
  function onResize() {
    updateViewerCameraProjection(camera, window);
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  return {
    onResize,
    animate,
  };
}
