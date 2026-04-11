function normalizeAngle(angle) {
  let value = angle;
  while (value > Math.PI) {
    value -= Math.PI * 2;
  }
  while (value < -Math.PI) {
    value += Math.PI * 2;
  }
  return value;
}

function nearestEquivalentAngle(reference, value) {
  const normalized = normalizeAngle(value);
  let best = normalized;
  let bestDistance = Math.abs(normalized - reference);
  for (let turns = -2; turns <= 2; turns += 1) {
    const candidate = normalized + turns * Math.PI * 2;
    const distance = Math.abs(candidate - reference);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function clampEulerToLimits(euler, limits, referenceEuler = null) {
  const reference = referenceEuler || { x: 0, y: 0, z: 0 };
  const normalized = {
    x: nearestEquivalentAngle(reference.x, euler.x),
    y: nearestEquivalentAngle(reference.y, euler.y),
    z: nearestEquivalentAngle(reference.z, euler.z),
  };
  if (!limits) {
    return normalized;
  }
  return {
    x: Math.max(limits.x?.min ?? -Math.PI, Math.min(limits.x?.max ?? Math.PI, normalized.x)),
    y: Math.max(limits.y?.min ?? -Math.PI, Math.min(limits.y?.max ?? Math.PI, normalized.y)),
    z: Math.max(limits.z?.min ?? -Math.PI, Math.min(limits.z?.max ?? Math.PI, normalized.z)),
  };
}

function chooseNearestEulerSolution(referenceEuler, euler) {
  const candidates = [
    { x: euler.x, y: euler.y, z: euler.z },
    { x: euler.x + Math.PI, y: Math.PI - euler.y, z: euler.z + Math.PI },
    { x: euler.x - Math.PI, y: Math.PI - euler.y, z: euler.z - Math.PI },
  ];
  let best = candidates[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = {
      x: nearestEquivalentAngle(referenceEuler.x, candidates[i].x),
      y: nearestEquivalentAngle(referenceEuler.y, candidates[i].y),
      z: nearestEquivalentAngle(referenceEuler.z, candidates[i].z),
    };
    const distance =
      Math.abs(candidate.x - referenceEuler.x)
      + Math.abs(candidate.y - referenceEuler.y)
      + Math.abs(candidate.z - referenceEuler.z);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function clampEulerStep(candidate, referenceEuler, maxStepRadians) {
  if (!(maxStepRadians > 0)) {
    return candidate;
  }
  const clampAxis = (value, reference) => {
    const delta = value - reference;
    if (delta > maxStepRadians) {
      return reference + maxStepRadians;
    }
    if (delta < -maxStepRadians) {
      return reference - maxStepRadians;
    }
    return value;
  };
  return {
    x: clampAxis(candidate.x, referenceEuler.x),
    y: clampAxis(candidate.y, referenceEuler.y),
    z: clampAxis(candidate.z, referenceEuler.z),
  };
}

function applyClampedEuler(bone, euler, limits, options = {}) {
  const { ignoreStepLimit = false } = options;
  if (bone.lockRotation) {
    bone.poseEuler.set(0, 0, 0, "XYZ");
    return;
  }
  const nearest = chooseNearestEulerSolution(bone.poseEuler, euler);
  let candidate = nearest;
  if (bone.constraintType === "hinge") {
    const hingeAxis = bone.hingeAxis || "x";
    candidate = {
      x: hingeAxis === "x" ? nearest.x : 0,
      y: hingeAxis === "y" ? nearest.y : 0,
      z: hingeAxis === "z" ? nearest.z : 0,
    };
  }
  const stepped = ignoreStepLimit
    ? candidate
    : clampEulerStep(candidate, bone.poseEuler, bone.maxStepRadians ?? 0);
  const clamped = clampEulerToLimits(stepped, limits, bone.poseEuler);
  bone.poseEuler.set(clamped.x, clamped.y, clamped.z, "XYZ");
}

function recomputeBoneRestState(THREE, bone, parent = null) {
  const upAxis = new THREE.Vector3(0, 1, 0);
  const restDirection = new THREE.Vector3().subVectors(bone.restTail, bone.restHead);
  bone.restLength = Math.max(restDirection.length(), 1e-4);
  bone.restQuaternion = new THREE.Quaternion().setFromUnitVectors(
    upAxis,
    restDirection.clone().normalize(),
  ).multiply(
    new THREE.Quaternion().setFromAxisAngle(upAxis, bone.restRoll ?? 0),
  );
  bone.localRestQuaternion = parent
    ? parent.restQuaternion.clone().invert().multiply(bone.restQuaternion)
    : bone.restQuaternion.clone();
  bone.localRestOffset = parent
    ? bone.restHead.clone().sub(parent.restHead).applyQuaternion(parent.restQuaternion.clone().invert())
    : bone.restHead.clone();
  bone.bindMatrix.compose(
    bone.restHead,
    bone.restQuaternion,
    new THREE.Vector3(1, 1, 1),
  );
  bone.inverseBindMatrix.copy(bone.bindMatrix).invert();
}

export function createRigState(THREE, boneDefinitions, options = {}) {
  const bones = boneDefinitions.map((definition, index) => {
    const restHead = new THREE.Vector3().fromArray(definition.head);
    const restTail = new THREE.Vector3().fromArray(definition.tail);
    return {
      id: definition.id,
      parentId: definition.parentId || null,
      index,
      restHead,
      restTail,
      restLength: 0,
      restRoll: definition.restRoll ?? 0,
      restQuaternion: new THREE.Quaternion(),
      localRestQuaternion: new THREE.Quaternion(),
      localRestOffset: new THREE.Vector3(),
      constraintType: definition.constraintType || null,
      hingeAxis: definition.hingeAxis || null,
      lockRotation: !!definition.lockRotation,
      lockTranslation: !!definition.lockTranslation,
      maxStepRadians: definition.maxStepRadians ?? 0,
      limits: definition.limits || null,
      poseEuler: new THREE.Euler(0, 0, 0, "XYZ"),
      poseQuaternion: new THREE.Quaternion(),
      poseTranslation: new THREE.Vector3(),
      worldHead: restHead.clone(),
      worldTail: restTail.clone(),
      worldQuaternion: new THREE.Quaternion(),
      bindMatrix: new THREE.Matrix4(),
      inverseBindMatrix: new THREE.Matrix4(),
      skinMatrix: new THREE.Matrix4(),
    };
  });
  const boneMap = new Map(bones.map((bone) => [bone.id, bone]));

  for (let i = 0; i < bones.length; i += 1) {
    const bone = bones[i];
    const parent = bone.parentId ? boneMap.get(bone.parentId) : null;
    recomputeBoneRestState(THREE, bone, parent);
  }

  const rig = {
    bones,
    boneMap,
    version: 0,
  };
  solveRigPose(THREE, rig);
  return rig;
}

export function solveRigPose(THREE, rig) {
  const tailAxis = new THREE.Vector3(0, 1, 0);
  const translationBuffer = new THREE.Vector3();
  const offsetBuffer = new THREE.Vector3();

  for (let i = 0; i < rig.bones.length; i += 1) {
    const bone = rig.bones[i];
    const parent = bone.parentId ? rig.boneMap.get(bone.parentId) : null;
    bone.poseQuaternion.setFromEuler(bone.poseEuler);
    if (bone.lockTranslation) {
      bone.poseTranslation.set(0, 0, 0);
    }
    if (bone.lockRotation) {
      bone.poseEuler.set(0, 0, 0, "XYZ");
      bone.poseQuaternion.identity();
    }

    if (parent) {
      translationBuffer.copy(bone.poseTranslation).applyQuaternion(parent.worldQuaternion);
      offsetBuffer.copy(bone.localRestOffset).applyQuaternion(parent.worldQuaternion);
      bone.worldHead.copy(parent.worldHead).add(offsetBuffer).add(translationBuffer);
      bone.worldQuaternion.copy(parent.worldQuaternion)
        .multiply(bone.localRestQuaternion)
        .multiply(bone.poseQuaternion);
    } else {
      bone.worldHead.copy(bone.restHead).add(bone.poseTranslation);
      bone.worldQuaternion.copy(bone.localRestQuaternion).multiply(bone.poseQuaternion);
    }

    bone.worldTail.copy(tailAxis)
      .multiplyScalar(bone.restLength)
      .applyQuaternion(bone.worldQuaternion)
      .add(bone.worldHead);

    bone.skinMatrix.compose(
      bone.worldHead,
      bone.worldQuaternion,
      new THREE.Vector3(1, 1, 1),
    ).multiply(bone.inverseBindMatrix);
  }
}

export function resetRigPose(rig) {
  for (let i = 0; i < rig.bones.length; i += 1) {
    rig.bones[i].poseEuler.set(0, 0, 0, "XYZ");
    rig.bones[i].poseTranslation.set(0, 0, 0);
  }
  rig.version += 1;
}

export function setBoneEuler(rig, boneId, euler) {
  return setBoneEulerWithOptions(rig, boneId, euler, {});
}

export function setBoneEulerWithOptions(rig, boneId, euler, options = {}) {
  const bone = rig.boneMap.get(boneId);
  if (!bone) {
    return false;
  }
  if (bone.lockRotation) {
    bone.poseEuler.set(0, 0, 0, "XYZ");
    return false;
  }
  applyClampedEuler(bone, {
    x: euler.x ?? bone.poseEuler.x,
    y: euler.y ?? bone.poseEuler.y,
    z: euler.z ?? bone.poseEuler.z,
  }, bone.limits, options);
  rig.version += 1;
  return true;
}

export function moveBoneRestTailTarget(THREE, rig, boneId, target) {
  const bone = rig.boneMap.get(boneId);
  if (!bone) {
    return false;
  }
  const delta = new THREE.Vector3().subVectors(target, bone.restTail);
  if (delta.lengthSq() <= 1e-10) {
    return false;
  }

  bone.restTail.copy(target);

  const queue = rig.bones.filter((candidate) => candidate.parentId === bone.id);
  while (queue.length) {
    const child = queue.shift();
    child.restHead.add(delta);
    child.restTail.add(delta);
    for (let i = 0; i < rig.bones.length; i += 1) {
      if (rig.bones[i].parentId === child.id) {
        queue.push(rig.bones[i]);
      }
    }
  }

  for (let i = 0; i < rig.bones.length; i += 1) {
    const current = rig.bones[i];
    const parent = current.parentId ? rig.boneMap.get(current.parentId) : null;
    recomputeBoneRestState(THREE, current, parent);
  }

  rig.version += 1;
  return true;
}

export function setBoneWorldTailTarget(THREE, rig, boneId, target) {
  return setBoneWorldTailTargetWithOptions(THREE, rig, boneId, target, {});
}

export function setBoneWorldTailTargetWithOptions(THREE, rig, boneId, target, options = {}) {
  const bone = rig.boneMap.get(boneId);
  if (!bone) {
    return false;
  }

  const desiredDirection = new THREE.Vector3().subVectors(target, bone.worldHead);
  if (desiredDirection.lengthSq() <= 1e-8) {
    return false;
  }
  desiredDirection.normalize();
  const desiredWorldQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), desiredDirection);
  setBoneWorldQuaternion(rig, boneId, desiredWorldQuaternion, options);
  rig.version += 1;
  return true;
}

export function setBoneWorldQuaternion(rig, boneId, desiredWorldQuaternion, options = {}) {
  const bone = rig.boneMap.get(boneId);
  if (!bone) {
    return false;
  }
  if (bone.lockRotation) {
    bone.poseEuler.set(0, 0, 0, "XYZ");
    return false;
  }
  const parent = bone.parentId ? rig.boneMap.get(bone.parentId) : null;
  const baseQuaternion = parent
    ? parent.worldQuaternion.clone().multiply(bone.localRestQuaternion)
    : bone.localRestQuaternion.clone();
  const poseQuaternion = baseQuaternion.invert().multiply(desiredWorldQuaternion);
  const euler = new bone.poseEuler.constructor().setFromQuaternion(poseQuaternion, "XYZ");
  applyClampedEuler(bone, euler, bone.limits, options);
  return true;
}

export function solveIkChainToTarget(THREE, rig, chainBoneIds, target, options = {}) {
  if (!Array.isArray(chainBoneIds) || !chainBoneIds.length) {
    return false;
  }
  const chain = chainBoneIds
    .map((boneId) => rig.boneMap.get(boneId))
    .filter(Boolean);
  if (!chain.length) {
    return false;
  }

  const iterations = options.iterations ?? 8;
  const epsilon = options.epsilon ?? 1e-3;
  const ignoreStepLimit = options.ignoreStepLimit ?? false;
  const effector = chain[chain.length - 1];
  const toEffector = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const rotationDelta = new THREE.Quaternion();
  const snapshot = chain.map((bone) => bone.poseEuler.clone());
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestPose = snapshot.map((euler) => euler.clone());
  let initialDistance = Number.POSITIVE_INFINITY;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    solveRigPose(THREE, rig);
    const currentDistance = effector.worldTail.distanceTo(target);
    if (iteration === 0) {
      initialDistance = currentDistance;
    }
    if (currentDistance < bestDistance) {
      bestDistance = currentDistance;
      bestPose = chain.map((bone) => bone.poseEuler.clone());
    }
    if (currentDistance <= epsilon) {
      rig.version += 1;
      return true;
    }

    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const bone = chain[i];
      toEffector.copy(effector.worldTail).sub(bone.worldHead);
      toTarget.copy(target).sub(bone.worldHead);
      if (toEffector.lengthSq() <= 1e-8 || toTarget.lengthSq() <= 1e-8) {
        continue;
      }
      toEffector.normalize();
      toTarget.normalize();
      rotationDelta.setFromUnitVectors(toEffector, toTarget);
      const desiredWorldQuaternion = rotationDelta.multiply(bone.worldQuaternion.clone());
      setBoneWorldQuaternion(rig, bone.id, desiredWorldQuaternion, { ignoreStepLimit });
      solveRigPose(THREE, rig);
    }
  }

  for (let i = 0; i < chain.length; i += 1) {
    chain[i].poseEuler.copy(bestPose[i]);
  }

  rig.version += 1;
  solveRigPose(THREE, rig);
  return bestDistance < initialDistance - 1e-6
    || effector.worldTail.distanceTo(target) <= (options.acceptDistance ?? 0.05);
}
