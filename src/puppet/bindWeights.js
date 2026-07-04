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

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function projectPointToSegment(point, head, tail) {
  const abx = tail.x - head.x;
  const aby = tail.y - head.y;
  const abz = tail.z - head.z;
  const apx = point.x - head.x;
  const apy = point.y - head.y;
  const apz = point.z - head.z;
  const abLengthSq = abx * abx + aby * aby + abz * abz;
  if (abLengthSq <= 1e-8) {
    return { t: 0, distanceSq: apx * apx + apy * apy + apz * apz };
  }
  const t = clamp01((apx * abx + apy * aby + apz * abz) / abLengthSq);
  const sx = head.x + abx * t;
  const sy = head.y + aby * t;
  const sz = head.z + abz * t;
  const dx = point.x - sx;
  const dy = point.y - sy;
  const dz = point.z - sz;
  return { t, distanceSq: dx * dx + dy * dy + dz * dz };
}

function hasBoneId(layerBinding, boneId) {
  return !!layerBinding?.allowedBoneIds?.includes(boneId);
}

function computeShoulderSeamMultiplier(rig, side, bone, point) {
  const clavicle = rig.boneMap.get(`clavicle_${side}`);
  const upperArm = rig.boneMap.get(`upper_arm_${side}`);
  const chest = rig.boneMap.get("chest");
  const neck = rig.boneMap.get("neck");
  if (!clavicle || !upperArm || !chest || !neck) {
    return 1;
  }
  const seam = projectPointToSegment(point, clavicle.restHead, upperArm.restTail);
  const seamRadiusSq = Math.max(clavicle.restLength * 1.15, 0.06) ** 2;
  const seamStrength = Math.exp(-seam.distanceSq / seamRadiusSq);
  const t = seam.t;
  if (bone.id === "chest") return 0.8 + seamStrength * (1.6 - 1.2 * t);
  if (bone.id === "neck") return 0.3 + seamStrength * (1.15 - 0.55 * t);
  if (bone.id === `clavicle_${side}`) return 0.8 + seamStrength * (2.2 - Math.abs(t - 0.35) * 1.8);
  if (bone.id === `upper_arm_${side}`) return 0.45 + seamStrength * (0.6 + 1.8 * t);
  if (bone.id === `forearm_${side}`) return 0.05 + seamStrength * Math.max(0, (t - 0.72) * 1.6);
  return 0.01;
}

function computeNeckSeamMultiplier(rig, bone, point) {
  const chest = rig.boneMap.get("chest");
  const neck = rig.boneMap.get("neck");
  const head = rig.boneMap.get("head");
  if (!chest || !neck || !head) {
    return 1;
  }
  const seam = projectPointToSegment(point, chest.restTail, head.restHead);
  const seamRadiusSq = Math.max(neck.restLength * 1.35, 0.045) ** 2;
  const seamStrength = Math.exp(-seam.distanceSq / seamRadiusSq);
  const t = seam.t;
  if (bone.id === "chest") return 0.6 + seamStrength * (1.7 - 1.2 * t);
  if (bone.id === "neck") return 0.8 + seamStrength * (2.4 - Math.abs(t - 0.45) * 2.0);
  if (bone.id === "head") return 0.25 + seamStrength * Math.max(0.2, 1.5 * t);
  return 0.01;
}

function computeTorsoCoreMultiplier(rig, bone, point, layerBinding) {
  const chest = rig.boneMap.get("chest");
  const neck = rig.boneMap.get("neck");
  const clavicleL = rig.boneMap.get("clavicle_l");
  const clavicleR = rig.boneMap.get("clavicle_r");
  const thighL = rig.boneMap.get("thigh_l");
  const thighR = rig.boneMap.get("thigh_r");
  const spine = rig.boneMap.get("spine");
  const pelvis = rig.boneMap.get("pelvis");
  if (!chest || !neck || !clavicleL || !clavicleR || !thighL || !thighR || !spine || !pelvis) {
    return 1;
  }
  const torsoLine = projectPointToSegment(point, pelvis.restHead, chest.restTail);
  const neckLine = projectPointToSegment(point, chest.restTail, neck.restTail);
  const leftClavicle = projectPointToSegment(point, clavicleL.restHead, clavicleL.restTail);
  const rightClavicle = projectPointToSegment(point, clavicleR.restHead, clavicleR.restTail);
  const leftHip = projectPointToSegment(point, pelvis.restHead, thighL.restTail);
  const rightHip = projectPointToSegment(point, pelvis.restHead, thighR.restTail);
  const neckStrength = Math.exp(-neckLine.distanceSq / (Math.max(neck.restLength * 1.5, 0.05) ** 2));
  const leftStrength = Math.exp(-leftClavicle.distanceSq / (Math.max(clavicleL.restLength * 1.4, 0.05) ** 2));
  const rightStrength = Math.exp(-rightClavicle.distanceSq / (Math.max(clavicleR.restLength * 1.4, 0.05) ** 2));
  const leftHipStrength = Math.exp(-leftHip.distanceSq / (Math.max(thighL.restLength * 1.0, 0.06) ** 2));
  const rightHipStrength = Math.exp(-rightHip.distanceSq / (Math.max(thighR.restLength * 1.0, 0.06) ** 2));
  const preferredSide = layerBinding?.side || null;
  const leftDominant = preferredSide ? preferredSide === "l" : leftStrength >= rightStrength;
  const upperTorso = Math.max(0, torsoLine.t);
  const lowerTorso = 1 - upperTorso;
  if (bone.id === "pelvis") return 0.18 + lowerTorso * 1.2 + 0.25 * Math.max(leftHipStrength, rightHipStrength);
  if (bone.id === "spine") return 0.35 + lowerTorso * 0.8;
  if (bone.id === "chest") return 1.8 + upperTorso * 2.1 + 0.45 * neckStrength + 0.3 * Math.max(leftStrength, rightStrength);
  if (bone.id === "neck") return 0.06 + 2.4 * neckStrength;
  if (bone.id === "clavicle_l") {
    const sideGate = leftDominant ? 1 : 0.05;
      return sideGate * (0.03 + 2.5 * leftStrength);
  }
  if (bone.id === "clavicle_r") {
    const sideGate = leftDominant ? 0.05 : 1;
      return sideGate * (0.03 + 2.5 * rightStrength);
  }
  if (bone.id === "upper_arm_l") {
    const sideGate = leftDominant ? 1 : 0.03;
    return sideGate * (0.01 + 0.45 * leftStrength * Math.max(0, leftClavicle.t));
  }
  if (bone.id === "upper_arm_r") {
    const sideGate = leftDominant ? 0.03 : 1;
    return sideGate * (0.01 + 0.45 * rightStrength * Math.max(0, rightClavicle.t));
  }
  if (bone.id === "thigh_l") {
    const sideGate = preferredSide ? (preferredSide === "l" ? 1 : 0.08) : 1;
    return sideGate * (0.02 + lowerTorso * 0.9 * leftHipStrength);
  }
  if (bone.id === "thigh_r") {
    const sideGate = preferredSide ? (preferredSide === "r" ? 1 : 0.08) : 1;
    return sideGate * (0.02 + lowerTorso * 0.9 * rightHipStrength);
  }
  return 0.01;
}

function computeHipSeamMultiplier(rig, bone, point, layerBinding) {
  const pelvis = rig.boneMap.get("pelvis");
  const spine = rig.boneMap.get("spine");
  const thighL = rig.boneMap.get("thigh_l");
  const thighR = rig.boneMap.get("thigh_r");
  if (!pelvis || !spine || !thighL || !thighR) {
    return 1;
  }
  const leftHip = projectPointToSegment(point, pelvis.restHead, thighL.restTail);
  const rightHip = projectPointToSegment(point, pelvis.restHead, thighR.restTail);
  const centerHip = projectPointToSegment(point, pelvis.restHead, spine.restHead);
  const leftStrength = Math.exp(-leftHip.distanceSq / (Math.max(thighL.restLength * 0.95, 0.05) ** 2));
  const rightStrength = Math.exp(-rightHip.distanceSq / (Math.max(thighR.restLength * 0.95, 0.05) ** 2));
  const centerStrength = Math.exp(-centerHip.distanceSq / (Math.max(spine.restLength * 1.0, 0.05) ** 2));
  const preferredSide = layerBinding?.side || null;
  const leftDominant = preferredSide ? preferredSide === "l" : leftStrength >= rightStrength;
  if (bone.id === "pelvis") return 1.7 + 0.8 * centerStrength;
  if (bone.id === "spine") return 0.35 + 0.7 * centerStrength;
  if (bone.id === "thigh_l") {
    const sideGate = leftDominant ? 1 : 0.06;
    return sideGate * (0.1 + 2.2 * leftStrength);
  }
  if (bone.id === "thigh_r") {
    const sideGate = leftDominant ? 0.06 : 1;
    return sideGate * (0.1 + 2.2 * rightStrength);
  }
  if (bone.id === "shin_l") {
    const sideGate = leftDominant ? 1 : 0.04;
    return sideGate * (0.02 + 0.65 * leftStrength * Math.max(0, leftHip.t));
  }
  if (bone.id === "shin_r") {
    const sideGate = leftDominant ? 0.04 : 1;
    return sideGate * (0.02 + 0.65 * rightStrength * Math.max(0, rightHip.t));
  }
  return 0.01;
}

function computeDeformScoreMultiplier(layerBinding, bone, point, rig) {
  const deformClass = layerBinding?.deformClass || "cloth_follow";
  const primaryBoneId = layerBinding?.primaryBoneId || "";
  const side = layerBinding?.side || null;
  const isPrimary = primaryBoneId === bone.id;
  const sameSide = side ? bone.id.endsWith(`_${side}`) : true;

  switch (deformClass) {
    case "rigid_face":
      if (bone.id === "head") return 4.0;
      if (bone.id === "neck") return 0.12;
      return 0.001;
    case "rigid_head":
      if (bone.id === "head") return 3.5;
      if (bone.id === "neck") return 0.2;
      return 0.001;
    case "torso_core":
      return computeTorsoCoreMultiplier(rig, bone, point, layerBinding);
    case "neck_seam":
      return computeNeckSeamMultiplier(rig, bone, point);
    case "shoulder_seam":
    case "shoulder_seam_l":
    case "shoulder_seam_r":
      if (!sameSide && /_(l|r)$/.test(bone.id)) return 0.001;
      return computeShoulderSeamMultiplier(rig, side, bone, point);
    case "arm_chain":
    case "arm_chain_l":
    case "arm_chain_r":
      if (!sameSide && /_(l|r)$/.test(bone.id)) return 0.001;
      if (bone.id === `clavicle_${side}`) return 0.9;
      if (bone.id === `upper_arm_${side}`) return primaryBoneId.includes("upper_arm") ? 2.2 : 1.5;
      if (bone.id === `forearm_${side}`) return primaryBoneId.includes("forearm") ? 2.2 : 1.6;
      if (bone.id === `hand_${side}`) return primaryBoneId.includes("hand") ? 2.6 : 1.4;
      if (bone.id === "chest") return 0.18;
      return 0.01;
    case "leg_chain":
    case "leg_chain_l":
    case "leg_chain_r":
      if (!sameSide && /_(l|r)$/.test(bone.id)) return 0.001;
      if (bone.id === "pelvis") return 0.5;
      if (bone.id === `thigh_${side}`) return primaryBoneId.includes("thigh") ? 2.1 : 1.5;
      if (bone.id === `shin_${side}`) return primaryBoneId.includes("shin") ? 2.2 : 1.6;
      if (bone.id === `foot_${side}`) return primaryBoneId.includes("foot") ? 2.4 : 1.5;
      return 0.01;
    case "hip_seam":
      return computeHipSeamMultiplier(rig, bone, point, layerBinding);
    case "cloth_follow":
    default:
      if (isPrimary) return 1.8;
      if (hasBoneId(layerBinding, bone.id)) return 0.9;
      return 0.04;
  }
}

function rigidifyWeights(layerBinding, candidates) {
  const deformClass = layerBinding?.deformClass || "";
  if (deformClass !== "rigid_face" && deformClass !== "rigid_head") {
    return candidates;
  }
  if (!candidates.length) {
    return candidates;
  }
  const primary = candidates[0];
  return [{
    boneIndex: primary.boneIndex,
    score: 1,
  }];
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
      const deformMultiplier = computeDeformScoreMultiplier(layerBinding, bone, point, rig);
      candidates.push({
        boneIndex,
        score: Math.exp(-distanceSq / (sigma * sigma)) * primaryBoost * deformMultiplier,
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    const weightedCandidates = rigidifyWeights(layerBinding, candidates);
    let weightSum = 0;
    for (let k = 0; k < 4; k += 1) {
      const entry = weightedCandidates[k];
      skinIndices[vertexIndex * 4 + k] = entry ? entry.boneIndex : 0;
      skinWeights[vertexIndex * 4 + k] = entry ? entry.score : 0;
      weightSum += entry ? entry.score : 0;
    }

    if (weightSum <= 1e-8) {
      skinIndices[vertexIndex * 4] = weightedCandidates[0]?.boneIndex ?? 0;
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
