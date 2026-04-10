function distanceToSegmentSquared(point, head, tail) {
  const abx = tail.x - head.x;
  const aby = tail.y - head.y;
  const abz = tail.z - head.z;
  const apx = point.x - head.x;
  const apy = point.y - head.y;
  const apz = point.z - head.z;
  const abLengthSq = abx * abx + aby * aby + abz * abz;
  if (abLengthSq <= 1e-8) {
    return apx * apx + apy * apy + apz * apz;
  }
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / abLengthSq));
  const sx = head.x + abx * t;
  const sy = head.y + aby * t;
  const sz = head.z + abz * t;
  const dx = point.x - sx;
  const dy = point.y - sy;
  const dz = point.z - sz;
  return dx * dx + dy * dy + dz * dz;
}

export function createMeshBinding(THREE, rig, geometry) {
  return createMeshBindingWithPolicy(THREE, rig, geometry, null);
}

export function createMeshBindingWithPolicy(THREE, rig, geometry, layerBinding) {
  const restPositions = geometry.userData.restPositions;
  if (!restPositions) {
    return null;
  }

  const vertexCount = restPositions.length / 3;
  const skinIndices = new Uint16Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);
  const point = new THREE.Vector3();
  const candidates = [];
  const allowedBoneIndexSet = new Set();
  const primaryBone = layerBinding?.primaryBoneId ? rig.boneMap.get(layerBinding.primaryBoneId) : null;
  const dominantWeightSums = new Float32Array(rig.bones.length);

  if (layerBinding?.allowedBoneIds?.length) {
    for (let i = 0; i < layerBinding.allowedBoneIds.length; i += 1) {
      const bone = rig.boneMap.get(layerBinding.allowedBoneIds[i]);
      if (bone) {
        allowedBoneIndexSet.add(bone.index);
      }
    }
  }
  if (!allowedBoneIndexSet.size) {
    for (let i = 0; i < rig.bones.length; i += 1) {
      allowedBoneIndexSet.add(i);
    }
  }

  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    point.fromArray(restPositions, vertexIndex * 3);
    candidates.length = 0;

    for (let boneIndex = 0; boneIndex < rig.bones.length; boneIndex += 1) {
      if (!allowedBoneIndexSet.has(boneIndex)) {
        continue;
      }
      const bone = rig.bones[boneIndex];
      const distanceSq = distanceToSegmentSquared(point, bone.restHead, bone.restTail);
      const sigma = Math.max(bone.restLength * 0.85, 0.03);
      const primaryBoost = primaryBone && primaryBone.index === boneIndex ? 1.15 : 1;
      candidates.push({
        boneIndex,
        score: Math.exp(-distanceSq / (sigma * sigma)) * primaryBoost,
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    let weightSum = 0;
    for (let k = 0; k < 4; k += 1) {
      const entry = candidates[k];
      skinIndices[vertexIndex * 4 + k] = entry ? entry.boneIndex : 0;
      skinWeights[vertexIndex * 4 + k] = entry ? entry.score : 0;
      weightSum += entry ? entry.score : 0;
    }

    if (weightSum <= 1e-8) {
      skinIndices[vertexIndex * 4] = candidates[0]?.boneIndex ?? 0;
      skinWeights[vertexIndex * 4] = 1;
      weightSum = 1;
    }

    for (let k = 0; k < 4; k += 1) {
      skinWeights[vertexIndex * 4 + k] /= weightSum;
      dominantWeightSums[skinIndices[vertexIndex * 4 + k]] += skinWeights[vertexIndex * 4 + k];
    }
  }

  geometry.userData.skinIndices = skinIndices;
  geometry.userData.skinWeights = skinWeights;
  const dominantBoneIds = [...dominantWeightSums]
    .map((weight, boneIndex) => ({ weight, boneIndex }))
    .filter((item) => item.weight > 1e-4)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
    .map((item) => ({
      boneId: rig.bones[item.boneIndex].id,
      weight: item.weight / Math.max(1, vertexCount),
    }));

  return {
    skinIndices,
    skinWeights,
    layerBinding,
    dominantBoneIds,
  };
}
