export function createPuppetOverlay(THREE, scene) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
  const material = new THREE.LineBasicMaterial({
    color: 0x29d3ff,
    transparent: true,
    opacity: 0.75,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.visible = false;
  scene.add(lines);
  const handleGroup = new THREE.Group();
  handleGroup.visible = false;
  scene.add(handleGroup);
  const handleGeometry = new THREE.SphereGeometry(0.012, 12, 12);
  const defaultHandleMaterial = new THREE.MeshBasicMaterial({ color: 0xffc837 });
  const selectedHandleMaterial = new THREE.MeshBasicMaterial({ color: 0xff4d6d });
  const hoveredHandleMaterial = new THREE.MeshBasicMaterial({ color: 0x6af2ff });
  const handleMeshes = [];

  function ensureHandleCount(count) {
    while (handleMeshes.length < count) {
      const handle = new THREE.Mesh(handleGeometry, defaultHandleMaterial);
      handle.visible = false;
      handleGroup.add(handle);
      handleMeshes.push(handle);
    }
    for (let i = 0; i < handleMeshes.length; i += 1) {
      handleMeshes[i].visible = i < count;
    }
  }

  function update(rig, visible, selectedBoneId = null, hoveredBoneId = null) {
    lines.visible = !!visible && !!rig && rig.bones.length > 0;
    handleGroup.visible = lines.visible;
    if (!lines.visible) {
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
      ensureHandleCount(0);
      return;
    }

    const positions = new Float32Array(rig.bones.length * 2 * 3);
    ensureHandleCount(rig.bones.length);
    let offset = 0;
    for (let i = 0; i < rig.bones.length; i += 1) {
      positions[offset++] = rig.bones[i].worldHead.x;
      positions[offset++] = rig.bones[i].worldHead.y;
      positions[offset++] = rig.bones[i].worldHead.z;
      positions[offset++] = rig.bones[i].worldTail.x;
      positions[offset++] = rig.bones[i].worldTail.y;
      positions[offset++] = rig.bones[i].worldTail.z;
      handleMeshes[i].position.copy(rig.bones[i].worldTail);
      handleMeshes[i].material = rig.bones[i].id === selectedBoneId
        ? selectedHandleMaterial
        : rig.bones[i].id === hoveredBoneId
          ? hoveredHandleMaterial
          : defaultHandleMaterial;
      handleMeshes[i].scale.setScalar(rig.bones[i].id === selectedBoneId ? 1.45 : rig.bones[i].id === hoveredBoneId ? 1.25 : 1);
      handleMeshes[i].userData.boneId = rig.bones[i].id;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
  }

  function dispose() {
    scene.remove(lines);
    scene.remove(handleGroup);
    geometry.dispose();
    material.dispose();
    handleGeometry.dispose();
    defaultHandleMaterial.dispose();
    selectedHandleMaterial.dispose();
    hoveredHandleMaterial.dispose();
  }

  return {
    update,
    dispose,
    lines,
    getHandleMeshes: () => handleMeshes,
  };
}
