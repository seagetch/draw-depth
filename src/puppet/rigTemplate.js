import { fitHumanoidSkeleton } from "./humanoidFit.js?v=20260410_8";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function deg(value) {
  return (value * Math.PI) / 180;
}

function roll(value) {
  return deg(value);
}

function step(value) {
  return deg(value);
}

function limits(xMin, xMax, yMin, yMax, zMin, zMax) {
  return {
    x: { min: deg(xMin), max: deg(xMax) },
    y: { min: deg(yMin), max: deg(yMax) },
    z: { min: deg(zMin), max: deg(zMax) },
  };
}

function computeAggregateBounds(layerMeshEntries) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < layerMeshEntries.length; i += 1) {
    const restPositions = layerMeshEntries[i]?.mesh?.geometry?.userData?.restPositions;
    if (!restPositions) {
      continue;
    }
    for (let p = 0; p < restPositions.length; p += 3) {
      const x = restPositions[p];
      const y = restPositions[p + 1];
      const z = restPositions[p + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }

  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function pixelToWorld(imageWidth, imageHeight, bounds, x, y, z = null) {
  const aspect = imageWidth / imageHeight;
  const halfWidth = aspect * 0.5;
  const halfHeight = 0.5;
  const u = clamp(x / Math.max(1, imageWidth - 1), 0, 1);
  const v = clamp(y / Math.max(1, imageHeight - 1), 0, 1);
  return [
    mix(-halfWidth, halfWidth, u),
    mix(halfHeight, -halfHeight, v),
    z == null ? (bounds.minZ + bounds.maxZ) * 0.5 : z,
  ];
}

function distance2d(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

function lerpPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function pointAlongPolyline(points, targetDistance) {
  if (!points.length) {
    return null;
  }
  if (points.length === 1 || targetDistance <= 0) {
    return { x: points[0].x, y: points[0].y };
  }
  let traveled = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const segmentLength = distance2d(points[i], points[i + 1]);
    if (segmentLength <= 1e-6) {
      continue;
    }
    if (traveled + segmentLength >= targetDistance) {
      const localT = (targetDistance - traveled) / segmentLength;
      return lerpPoint(points[i], points[i + 1], localT);
    }
    traveled += segmentLength;
  }
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const segmentLength = distance2d(prev, last);
  if (segmentLength <= 1e-6) {
    return { x: last.x, y: last.y };
  }
  const extra = targetDistance - traveled;
  const dirX = (last.x - prev.x) / segmentLength;
  const dirY = (last.y - prev.y) / segmentLength;
  return {
    x: last.x + dirX * extra,
    y: last.y + dirY * extra,
  };
}

function normalizeChain(points, ratios, minTotalLength) {
  const polyline = points.map((point) => ({ x: point.x, y: point.y }));
  let totalLength = 0;
  for (let i = 0; i < polyline.length - 1; i += 1) {
    totalLength += distance2d(polyline[i], polyline[i + 1]);
  }
  const normalizedTotal = Math.max(totalLength, minTotalLength);
  const output = [polyline[0]];
  let cumulativeRatio = 0;
  for (let i = 0; i < ratios.length; i += 1) {
    cumulativeRatio += ratios[i];
    output.push(pointAlongPolyline(polyline, normalizedTotal * cumulativeRatio));
  }
  return output;
}

function ensureMinimumSegment(start, end, minLength, fallbackDirection) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length >= minLength) {
    return end;
  }
  let dirX = dx;
  let dirY = dy;
  if (length <= 1e-6) {
    dirX = fallbackDirection.x;
    dirY = fallbackDirection.y;
  }
  const dirLength = Math.hypot(dirX, dirY);
  if (dirLength <= 1e-6) {
    return { x: start.x + minLength, y: start.y };
  }
  return {
    x: start.x + (dirX / dirLength) * minLength,
    y: start.y + (dirY / dirLength) * minLength,
  };
}

function normalizeHumanoidPoints(points, imageWidth, imageHeight) {
  const torsoMin = imageHeight * 0.22;
  const armMin = imageHeight * 0.18;
  const legMin = imageHeight * 0.28;

  const torso = normalizeChain(
    [points.pelvis, points.spine, points.chest, points.neck, points.head],
    [0.28, 0.32, 0.16, 0.24],
    torsoMin,
  );
  points.pelvis = torso[0];
  points.spine = torso[1];
  points.chest = torso[2];
  points.neck = torso[3];
  points.head = torso[4];

  const leftHandTip = {
    x: points.hand_l.x + (points.hand_l.x - points.elbow_l.x) * 0.18,
    y: points.hand_l.y + (points.hand_l.y - points.elbow_l.y) * 0.18,
  };
  const rightHandTip = {
    x: points.hand_r.x + (points.hand_r.x - points.elbow_r.x) * 0.18,
    y: points.hand_r.y + (points.hand_r.y - points.elbow_r.y) * 0.18,
  };
  const leftArm = normalizeChain(
    [points.chest, points.shoulder_l, points.elbow_l, points.hand_l, leftHandTip],
    [0.18, 0.34, 0.33, 0.15],
    armMin,
  );
  const rightArm = normalizeChain(
    [points.chest, points.shoulder_r, points.elbow_r, points.hand_r, rightHandTip],
    [0.18, 0.34, 0.33, 0.15],
    armMin,
  );
  points.shoulder_l = leftArm[1];
  points.elbow_l = leftArm[2];
  points.hand_l = leftArm[3];
  points.hand_l_tip = ensureMinimumSegment(
    leftArm[3],
    leftArm[4],
    imageHeight * 0.028,
    { x: leftArm[3].x - leftArm[2].x, y: leftArm[3].y - leftArm[2].y },
  );
  points.shoulder_r = rightArm[1];
  points.elbow_r = rightArm[2];
  points.hand_r = rightArm[3];
  points.hand_r_tip = ensureMinimumSegment(
    rightArm[3],
    rightArm[4],
    imageHeight * 0.028,
    { x: rightArm[3].x - rightArm[2].x, y: rightArm[3].y - rightArm[2].y },
  );

  const leftFootTip = { x: points.foot_l.x - imageWidth * 0.012, y: points.foot_l.y };
  const rightFootTip = { x: points.foot_r.x + imageWidth * 0.012, y: points.foot_r.y };
  const leftLeg = normalizeChain(
    [points.hip_l, points.knee_l, points.foot_l, leftFootTip],
    [0.45, 0.43, 0.12],
    legMin,
  );
  const rightLeg = normalizeChain(
    [points.hip_r, points.knee_r, points.foot_r, rightFootTip],
    [0.45, 0.43, 0.12],
    legMin,
  );
  points.hip_l = leftLeg[0];
  points.knee_l = leftLeg[1];
  points.foot_l = leftLeg[2];
  points.foot_l_tip = ensureMinimumSegment(
    leftLeg[2],
    leftLeg[3],
    imageHeight * 0.03,
    { x: leftLeg[2].x - leftLeg[1].x, y: leftLeg[2].y - leftLeg[1].y },
  );
  points.hip_r = rightLeg[0];
  points.knee_r = rightLeg[1];
  points.foot_r = rightLeg[2];
  points.foot_r_tip = ensureMinimumSegment(
    rightLeg[2],
    rightLeg[3],
    imageHeight * 0.03,
    { x: rightLeg[2].x - rightLeg[1].x, y: rightLeg[2].y - rightLeg[1].y },
  );

  return points;
}

export function createHumanoidRigData(context) {
  const {
    layerMeshEntries,
    psdLayerEntries,
    imageWidth,
    imageHeight,
    puppetLayerFitEnabled,
    puppetLayerBindingOverrides,
    puppetSwapLeftRightMapping = false,
  } = context;
  const bounds = computeAggregateBounds(layerMeshEntries);
  if (!bounds || !psdLayerEntries?.length || !imageWidth || !imageHeight) {
    return null;
  }

  const fit = fitHumanoidSkeleton({
    psdLayerEntries,
    imageWidth,
    imageHeight,
    puppetLayerFitEnabled,
    puppetLayerBindingOverrides,
    puppetSwapLeftRightMapping,
  });
  if (!fit) {
    return null;
  }

  const points = normalizeHumanoidPoints(structuredClone(fit.points), imageWidth, imageHeight);
  const p = (point) => pixelToWorld(imageWidth, imageHeight, bounds, point.x, point.y);
  const upperChestPoint = { x: points.chest.x, y: mix(points.chest.y, points.neck.y, 0.6) };

  return {
    fit,
    template: [
    { id: "pelvis", head: p(points.pelvis), tail: p(points.spine), lockRotation: true, lockTranslation: true, maxStepRadians: 0, limits: limits(0, 0, 0, 0, 0, 0) },
    { id: "spine", parentId: "pelvis", head: p(points.spine), tail: p(points.chest), maxStepRadians: step(6), limits: limits(-20, 20, -18, 18, -24, 24) },
    { id: "chest", parentId: "spine", head: p(points.chest), tail: p(upperChestPoint), maxStepRadians: step(6), limits: limits(-18, 18, -20, 20, -30, 30) },
    { id: "neck", parentId: "chest", head: p(upperChestPoint), tail: p(points.neck), maxStepRadians: step(8), limits: limits(-30, 30, -35, 35, -45, 45) },
    { id: "head", parentId: "neck", head: p(points.neck), tail: p(points.head), maxStepRadians: step(8), limits: limits(-35, 35, -45, 45, -60, 60) },

    { id: "clavicle_l", parentId: "neck", head: p(upperChestPoint), tail: p(points.shoulder_l), restRoll: roll(180), maxStepRadians: step(8), limits: limits(-20, 30, -25, 40, -35, 20) },
    { id: "upper_arm_l", parentId: "clavicle_l", head: p(points.shoulder_l), tail: p(points.elbow_l), restRoll: roll(180), maxStepRadians: step(10), limits: limits(-110, 80, -85, 85, -140, 60) },
    { id: "forearm_l", parentId: "upper_arm_l", head: p(points.elbow_l), tail: p(points.hand_l), restRoll: roll(180), constraintType: "hinge", hingeAxis: "x", maxStepRadians: step(12), limits: limits(-5, 145, 0, 0, 0, 0) },
    { id: "hand_l", parentId: "forearm_l", head: p(points.hand_l), tail: p(points.hand_l_tip), restRoll: roll(180), maxStepRadians: step(10), limits: limits(-35, 35, -30, 30, -45, 45) },

    { id: "clavicle_r", parentId: "neck", head: p(upperChestPoint), tail: p(points.shoulder_r), restRoll: roll(180), maxStepRadians: step(8), limits: limits(-20, 30, -40, 25, -20, 35) },
    { id: "upper_arm_r", parentId: "clavicle_r", head: p(points.shoulder_r), tail: p(points.elbow_r), restRoll: roll(180), maxStepRadians: step(10), limits: limits(-110, 80, -85, 85, -60, 140) },
    { id: "forearm_r", parentId: "upper_arm_r", head: p(points.elbow_r), tail: p(points.hand_r), restRoll: roll(180), constraintType: "hinge", hingeAxis: "x", maxStepRadians: step(12), limits: limits(-5, 145, 0, 0, 0, 0) },
    { id: "hand_r", parentId: "forearm_r", head: p(points.hand_r), tail: p(points.hand_r_tip), restRoll: roll(180), maxStepRadians: step(10), limits: limits(-35, 35, -30, 30, -45, 45) },

    { id: "thigh_l", parentId: "pelvis", head: p(points.hip_l), tail: p(points.knee_l), restRoll: roll(180), maxStepRadians: step(10), limits: limits(-110, 45, -35, 35, -40, 25) },
    { id: "shin_l", parentId: "thigh_l", head: p(points.knee_l), tail: p(points.foot_l), restRoll: roll(180), constraintType: "hinge", hingeAxis: "x", maxStepRadians: step(12), limits: limits(-5, 150, 0, 0, 0, 0) },
    { id: "foot_l", parentId: "shin_l", head: p(points.foot_l), tail: p(points.foot_l_tip), restRoll: roll(180), maxStepRadians: step(10), limits: limits(-35, 35, -20, 20, -20, 20) },

    { id: "thigh_r", parentId: "pelvis", head: p(points.hip_r), tail: p(points.knee_r), restRoll: roll(180), maxStepRadians: step(10), limits: limits(-110, 45, -35, 35, -25, 40) },
    { id: "shin_r", parentId: "thigh_r", head: p(points.knee_r), tail: p(points.foot_r), restRoll: roll(180), constraintType: "hinge", hingeAxis: "x", maxStepRadians: step(12), limits: limits(-5, 150, 0, 0, 0, 0) },
    { id: "foot_r", parentId: "shin_r", head: p(points.foot_r), tail: p(points.foot_r_tip), restRoll: roll(180), maxStepRadians: step(10), limits: limits(-35, 35, -20, 20, -20, 20) },
    ],
  };
}

export function createHumanoidRigTemplate(context) {
  const data = createHumanoidRigData(context);
  return data ? data.template : [];
}
