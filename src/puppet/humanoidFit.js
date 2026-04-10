import {
  buildLayerDescriptors,
  buildUnionMaskFromDescriptors,
  estimateBodyCenterX,
  selectDescriptorsForRigPart,
} from "./bodyMask.js?v=20260410_3";
import { buildSkeletonGraph, collectPathPoints, findClosestNode, findGraphPath } from "./graph.js";
import { skeletonizeMask } from "./skeletonize.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeBoundsFromMask(mask, width, height) {
  let top = -1;
  let bottom = -1;
  let left = width;
  let right = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) {
        continue;
      }
      if (top < 0) top = y;
      bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  return { top, bottom, left, right };
}

function rowProfile(mask, width, height) {
  const left = new Int32Array(height);
  const right = new Int32Array(height);
  const center = new Float32Array(height);
  left.fill(-1);
  right.fill(-1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) {
        continue;
      }
      if (left[y] < 0) left[y] = x;
      right[y] = x;
    }
    center[y] = left[y] >= 0 ? (left[y] + right[y]) * 0.5 : 0;
  }
  return { left, right, center };
}

function findEndpoints(graph) {
  return graph.nodes.filter((node) => node.degree <= 1);
}

function interpolatePathPoint(points, t) {
  if (!points.length) {
    return null;
  }
  const index = clamp(Math.round((points.length - 1) * t), 0, points.length - 1);
  return points[index];
}

function pointOrFallback(point, fallback) {
  return point ? { x: point.x, y: point.y } : fallback;
}

function squaredDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function mergeMasks(masks, width, height) {
  const merged = new Uint8Array(width * height);
  for (let i = 0; i < masks.length; i += 1) {
    const mask = masks[i];
    if (!mask) {
      continue;
    }
    for (let p = 0; p < merged.length; p += 1) {
      if (mask[p]) {
        merged[p] = 1;
      }
    }
  }
  return merged;
}

function buildPartFit(descriptors, width, height) {
  const mask = buildUnionMaskFromDescriptors(descriptors, width, height);
  const bounds = computeBoundsFromMask(mask, width, height);
  if (bounds.top < 0) {
    return null;
  }
  const skeleton = skeletonizeMask(mask, width, height);
  const graph = buildSkeletonGraph(skeleton, width, height);
  const profile = rowProfile(mask, width, height);
  return {
    descriptors,
    mask,
    skeleton,
    graph,
    bounds,
    profile,
  };
}

function sidePredicate(side, bodyCenterX) {
  return (node) => (side === "left" ? node.x <= bodyCenterX + 8 : node.x >= bodyCenterX - 8);
}

function chooseFarthestEndpoint(graph, root, side, bodyCenterX, preferLowest = false) {
  if (!graph || !root) {
    return null;
  }
  const endpoints = findEndpoints(graph).filter((node) => node.id !== root.id && sidePredicate(side, bodyCenterX)(node));
  if (!endpoints.length) {
    return null;
  }
  endpoints.sort((a, b) => {
    if (preferLowest) {
      if (b.y !== a.y) {
        return b.y - a.y;
      }
    }
    return squaredDistance(b, root) - squaredDistance(a, root);
  });
  return endpoints[0];
}

function fitTorso(torsoFit, bodyCenterX, imageWidth, imageHeight) {
  if (!torsoFit?.graph?.nodes?.length) {
    return null;
  }
  const { bounds, graph, profile } = torsoFit;
  const topEndpoint = findClosestNode(
    graph,
    bodyCenterX,
    bounds.top,
    (node) => node.y <= bounds.top + (bounds.bottom - bounds.top) * 0.25,
  ) || findEndpoints(graph).sort((a, b) => a.y - b.y)[0];
  const pelvisNode = findClosestNode(
    graph,
    bodyCenterX,
    bounds.top + (bounds.bottom - bounds.top) * 0.78,
    (node) => node.y >= bounds.top + (bounds.bottom - bounds.top) * 0.45,
  ) || findClosestNode(graph, bodyCenterX, bounds.bottom);
  if (!topEndpoint || !pelvisNode) {
    return null;
  }
  const torsoPath = collectPathPoints(graph, findGraphPath(graph, topEndpoint.id, pelvisNode.id));
  const head = pointOrFallback(interpolatePathPoint(torsoPath, 0.0), { x: bodyCenterX, y: bounds.top });
  const neck = pointOrFallback(interpolatePathPoint(torsoPath, 0.30), { x: bodyCenterX, y: bounds.top + (bounds.bottom - bounds.top) * 0.18 });
  const chest = pointOrFallback(interpolatePathPoint(torsoPath, 0.55), { x: bodyCenterX, y: bounds.top + (bounds.bottom - bounds.top) * 0.36 });
  const spine = pointOrFallback(interpolatePathPoint(torsoPath, 0.78), { x: bodyCenterX, y: bounds.top + (bounds.bottom - bounds.top) * 0.56 });
  const pelvis = { x: pelvisNode.x, y: pelvisNode.y };
  const chestRow = clamp(Math.round(chest.y), 0, imageHeight - 1);
  const pelvisRow = clamp(Math.round(pelvis.y), 0, imageHeight - 1);
  const leftShoulderAnchor = {
    x: profile.left[chestRow] >= 0 ? profile.left[chestRow] : bodyCenterX - imageWidth * 0.10,
    y: chest.y,
  };
  const rightShoulderAnchor = {
    x: profile.right[chestRow] >= 0 ? profile.right[chestRow] : bodyCenterX + imageWidth * 0.10,
    y: chest.y,
  };
  const leftHipAnchor = {
    x: profile.left[pelvisRow] >= 0 ? profile.left[pelvisRow] + Math.max(4, imageWidth * 0.01) : bodyCenterX - imageWidth * 0.03,
    y: pelvis.y,
  };
  const rightHipAnchor = {
    x: profile.right[pelvisRow] >= 0 ? profile.right[pelvisRow] - Math.max(4, imageWidth * 0.01) : bodyCenterX + imageWidth * 0.03,
    y: pelvis.y,
  };
  return {
    head,
    neck,
    chest,
    spine,
    pelvis,
    leftShoulderAnchor,
    rightShoulderAnchor,
    leftHipAnchor,
    rightHipAnchor,
  };
}

function fitLimb(partFit, rootAnchor, side, bodyCenterX, defaults, preferLowest = false) {
  if (!partFit?.graph?.nodes?.length) {
    return defaults;
  }
  const root = findClosestNode(partFit.graph, rootAnchor.x, rootAnchor.y, sidePredicate(side, bodyCenterX))
    || findClosestNode(partFit.graph, rootAnchor.x, rootAnchor.y);
  if (!root) {
    return defaults;
  }
  const end = chooseFarthestEndpoint(partFit.graph, root, side, bodyCenterX, preferLowest);
  if (!end) {
    return {
      root: { x: rootAnchor.x, y: rootAnchor.y },
      joint: defaults.joint,
      end: defaults.end,
    };
  }
  const path = collectPathPoints(partFit.graph, findGraphPath(partFit.graph, root.id, end.id));
  return {
    root: { x: rootAnchor.x, y: rootAnchor.y },
    joint: pointOrFallback(interpolatePathPoint(path, preferLowest ? 0.44 : 0.52), defaults.joint),
    end: pointOrFallback(interpolatePathPoint(path, 1.0), defaults.end),
  };
}

function partInnerTopAnchor(partFit, side, fallback) {
  if (!partFit?.bounds || partFit.bounds.top < 0) {
    return fallback;
  }
  return {
    x: side === "left" ? partFit.bounds.right : partFit.bounds.left,
    y: partFit.bounds.top,
  };
}

export function fitHumanoidSkeleton(context) {
  const {
    psdLayerEntries,
    imageWidth,
    imageHeight,
    puppetLayerFitEnabled,
    puppetLayerBindingOverrides,
    puppetSwapLeftRightMapping = false,
  } = context;
  const descriptors = buildLayerDescriptors(psdLayerEntries, imageWidth, imageHeight, {
    puppetLayerFitEnabled,
    puppetLayerBindingOverrides,
    puppetSwapLeftRightMapping,
  });
  const bodyCenterX = estimateBodyCenterX(descriptors, imageWidth);

  const torsoFit = buildPartFit(selectDescriptorsForRigPart(descriptors, "torso", bodyCenterX), imageWidth, imageHeight);
  if (!torsoFit) {
    return null;
  }
  const torso = fitTorso(torsoFit, bodyCenterX, imageWidth, imageHeight);
  if (!torso) {
    return null;
  }

  const leftArmFit = buildPartFit(selectDescriptorsForRigPart(descriptors, "arm_l", bodyCenterX), imageWidth, imageHeight);
  const rightArmFit = buildPartFit(selectDescriptorsForRigPart(descriptors, "arm_r", bodyCenterX), imageWidth, imageHeight);
  const leftLegFit = buildPartFit(selectDescriptorsForRigPart(descriptors, "leg_l", bodyCenterX), imageWidth, imageHeight);
  const rightLegFit = buildPartFit(selectDescriptorsForRigPart(descriptors, "leg_r", bodyCenterX), imageWidth, imageHeight);
  const leftArmAnchor = partInnerTopAnchor(leftArmFit, "left", torso.leftShoulderAnchor);
  const rightArmAnchor = partInnerTopAnchor(rightArmFit, "right", torso.rightShoulderAnchor);
  const leftLegAnchor = partInnerTopAnchor(leftLegFit, "left", torso.leftHipAnchor);
  const rightLegAnchor = partInnerTopAnchor(rightLegFit, "right", torso.rightHipAnchor);

  const leftArm = fitLimb(
    leftArmFit,
    leftArmAnchor,
    "left",
    bodyCenterX,
    {
      root: torso.leftShoulderAnchor,
      joint: { x: bodyCenterX - imageWidth * 0.10, y: torso.chest.y + (torso.pelvis.y - torso.chest.y) * 0.28 },
      end: { x: bodyCenterX - imageWidth * 0.17, y: torso.pelvis.y - (torso.pelvis.y - torso.chest.y) * 0.24 },
    },
  );
  const rightArm = fitLimb(
    rightArmFit,
    rightArmAnchor,
    "right",
    bodyCenterX,
    {
      root: torso.rightShoulderAnchor,
      joint: { x: bodyCenterX + imageWidth * 0.10, y: torso.chest.y + (torso.pelvis.y - torso.chest.y) * 0.28 },
      end: { x: bodyCenterX + imageWidth * 0.17, y: torso.pelvis.y - (torso.pelvis.y - torso.chest.y) * 0.24 },
    },
  );
  const leftLeg = fitLimb(
    leftLegFit,
    leftLegAnchor,
    "left",
    bodyCenterX,
    {
      root: torso.leftHipAnchor,
      joint: { x: bodyCenterX - imageWidth * 0.04, y: torso.pelvis.y + (torsoFit.bounds.bottom - torso.pelvis.y) * 0.40 },
      end: { x: bodyCenterX - imageWidth * 0.06, y: torsoFit.bounds.bottom },
    },
    true,
  );
  const rightLeg = fitLimb(
    rightLegFit,
    rightLegAnchor,
    "right",
    bodyCenterX,
    {
      root: torso.rightHipAnchor,
      joint: { x: bodyCenterX + imageWidth * 0.04, y: torso.pelvis.y + (torsoFit.bounds.bottom - torso.pelvis.y) * 0.40 },
      end: { x: bodyCenterX + imageWidth * 0.06, y: torsoFit.bounds.bottom },
    },
    true,
  );

  return {
    bodyCenterX,
    bodyMask: mergeMasks(
      [torsoFit.mask, leftArmFit?.mask, rightArmFit?.mask, leftLegFit?.mask, rightLegFit?.mask],
      imageWidth,
      imageHeight,
    ),
    skeleton: mergeMasks(
      [torsoFit.skeleton, leftArmFit?.skeleton, rightArmFit?.skeleton, leftLegFit?.skeleton, rightLegFit?.skeleton],
      imageWidth,
      imageHeight,
    ),
    graph: torsoFit.graph,
    points: {
      head: torso.head,
      neck: torso.neck,
      chest: torso.chest,
      spine: torso.spine,
      pelvis: torso.pelvis,
      shoulder_l: leftArm.root,
      shoulder_r: rightArm.root,
      elbow_l: leftArm.joint,
      elbow_r: rightArm.joint,
      hand_l: leftArm.end,
      hand_r: rightArm.end,
      hip_l: leftLeg.root,
      hip_r: rightLeg.root,
      knee_l: leftLeg.joint,
      knee_r: rightLeg.joint,
      foot_l: leftLeg.end,
      foot_r: rightLeg.end,
    },
  };
}
