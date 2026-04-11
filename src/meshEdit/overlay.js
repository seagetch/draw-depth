export function createMeshEditOverlay(THREE, scene) {
  const group = new THREE.Group();
  scene.add(group);
  const handleMeshes = [];

  const activeMaterial = new THREE.MeshBasicMaterial({ color: 0xffb74d, depthTest: false });
  const idleMaterial = new THREE.MeshBasicMaterial({ color: 0x4ac26b, depthTest: false });
  const geometry = new THREE.SphereGeometry(0.012, 12, 12);

  function update(handles, selectedHandleId, visible) {
    const nextHandles = handles || [];
    while (handleMeshes.length < nextHandles.length) {
      const mesh = new THREE.Mesh(geometry, idleMaterial.clone());
      mesh.renderOrder = 1000;
      group.add(mesh);
      handleMeshes.push(mesh);
    }

    for (let i = 0; i < handleMeshes.length; i += 1) {
      const mesh = handleMeshes[i];
      const handle = nextHandles[i];
      if (!visible || !handle) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(handle.position.x, handle.position.y, handle.position.z);
      mesh.material.color.copy((handle.id === selectedHandleId ? activeMaterial : idleMaterial).color);
      mesh.scale.setScalar(handle.id === selectedHandleId ? 1.35 : 1);
      mesh.userData.handleId = handle.id;
    }
  }

  return {
    update,
    getHandleMeshes: () => handleMeshes,
    dispose() {
      scene.remove(group);
      geometry.dispose();
      for (let i = 0; i < handleMeshes.length; i += 1) {
        handleMeshes[i].material.dispose();
      }
    },
  };
}
