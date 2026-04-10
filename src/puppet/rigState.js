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

function clampAngle(value, min, max) {
  return Math.max(min, Math.min(max, normalizeAngle(value)));
}

function clampEulerToLimits(euler, limits) {
  if (!limits) {
    return euler;
  }
  return {
    x: clampAngle(euler.x, limits.x?.min ?? -Math.PI, limits.x?.max ?? Math.PI),
    y: clampAngle(euler.y, limits.y?.min ?? -Math.PI, limits.y?.max ?? Math.PI),
    z: clampAngle(euler.z, limits.z?.min ?? -Math.PI, limits.z?.max ?? Math.PI),
  };
}

function applyClampedEuler(bone, euler, limits) {
  const clamped = clampEulerToLimits(euler, limits);
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
  const bone = rig.boneMap.get(boneId);
  if (!bone) {
    return false;
  }
  applyClampedEuler(bone, {
    x: euler.x ?? bone.poseEuler.x,
    y: euler.y ?? bone.poseEuler.y,
    z: euler.z ?? bone.poseEuler.z,
  }, bone.limits);
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
  setBoneWorldQuaternion(rig, boneId, desiredWorldQuaternion);
  rig.version += 1;
  return true;
}

export function setBoneWorldQuaternion(rig, boneId, desiredWorldQuaternion) {
  const bone = rig.boneMap.get(boneId);
  if (!bone) {
    return false;
  }
  const parent = bone.parentId ? rig.boneMap.get(bone.parentId) : null;
  const baseQuaternion = parent
    ? parent.worldQuaternion.clone().multiply(bone.localRestQuaternion)
    : bone.localRestQuaternion.clone();
  const poseQuaternion = baseQuaternion.invert().multiply(desiredWorldQuaternion);
  const euler = new bone.poseEuler.constructor().setFromQuaternion(poseQuaternion, "XYZ");
  applyClampedEuler(bone, euler, bone.limits);
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
  const effector = chain[chain.length - 1];
  const toEffector = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const rotationDelta = new THREE.Quaternion();

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    solveRigPose(THREE, rig);
    if (effector.worldTail.distanceTo(target) <= epsilon) {
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
      setBoneWorldQuaternion(rig, bone.id, desiredWorldQuaternion);
      solveRigPose(THREE, rig);
    }
  }

  rig.version += 1;
  return effector.worldTail.distanceTo(target) <= (options.acceptDistance ?? 0.05);
}
