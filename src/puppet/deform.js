export function applySkinningToGeometry(THREE, rig, geometry) {
  const restPositions = geometry.userData.restPositions;
  const skinIndices = geometry.userData.skinIndices;
  const skinWeights = geometry.userData.skinWeights;
  const positionAttribute = geometry.getAttribute("position");
  if (!restPositions || !skinIndices || !skinWeights || !positionAttribute) {
    return false;
  }

  const vector = new THREE.Vector3();
  const transformed = new THREE.Vector3();
  const accum = new THREE.Vector3();
  const array = positionAttribute.array;

  for (let vertexIndex = 0; vertexIndex < positionAttribute.count; vertexIndex += 1) {
    vector.fromArray(restPositions, vertexIndex * 3);
    accum.set(0, 0, 0);

    for (let k = 0; k < 4; k += 1) {
      const weight = skinWeights[vertexIndex * 4 + k];
      if (weight <= 0) {
        continue;
      }
      const bone = rig.bones[skinIndices[vertexIndex * 4 + k]];
      transformed.copy(vector).applyMatrix4(bone.skinMatrix);
      accum.addScaledVector(transformed, weight);
    }

    array[vertexIndex * 3] = accum.x;
    array[vertexIndex * 3 + 1] = accum.y;
    array[vertexIndex * 3 + 2] = accum.z;
  }

  positionAttribute.needsUpdate = true;
  geometry.computeBoundingSphere();
  return true;
}

export function restoreRestGeometry(geometry) {
  const restPositions = geometry.userData.restPositions;
  const positionAttribute = geometry.getAttribute("position");
  if (!restPositions || !positionAttribute) {
    return false;
  }
  positionAttribute.array.set(restPositions);
  positionAttribute.needsUpdate = true;
  geometry.computeBoundingSphere();
  return true;
}
