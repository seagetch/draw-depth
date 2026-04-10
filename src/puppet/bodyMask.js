function normalizeLayerName(name) {
  return (name || "").toLowerCase();
}

function detectLayerSide(name) {
  if (/\bleft\b|_l\b|::l\b|\bl\b|hidari/.test(name)) {
    return "left";
  }
  if (/\bright\b|_r\b|::r\b|\br\b|migi/.test(name)) {
    return "right";
  }
  return null;
}

function maybeSwapSide(side, enabled) {
  if (!enabled) {
    return side;
  }
  if (side === "left") {
    return "right";
  }
  if (side === "right") {
    return "left";
  }
  return side;
}

function detectLayerRole(name) {
  if (/head|face|kao|atama/.test(name)) return "head";
  if (/neck|kubi/.test(name)) return "neck";
  if (/body|torso|trunk|chest|spine|waist|hip|pelvis/.test(name)) return "torso";
  if (/shoulder|clavicle/.test(name)) return "shoulder";
  if (/upper.*arm|arm.*upper/.test(name)) return "upper_arm";
  if (/forearm|lower.*arm|elbow/.test(name)) return "forearm";
  if (/hand|wrist|palm|thumb|finger/.test(name)) return "hand";
  if (/thigh|upper.*leg/.test(name)) return "thigh";
  if (/shin|calf|lower.*leg|knee/.test(name)) return "shin";
  if (/foot|ankle|boot|boots|leg/.test(name)) return "foot";
  return null;
}

function isExcludedAccessoryLayer(name) {
  return /hair|bang|fringe|ear|tail|ribbon|bow|hat|cap|horn|wing|weapon|sword|staff|coat|skirt|dress|cloak|cape|sleeve|glove|lace|ornament|accessory/.test(name);
}

function computeMaskedLayerBounds(layer) {
  if (!layer?.maskPixels) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let area = 0;
  for (let y = 0; y < layer.height; y += 1) {
    for (let x = 0; x < layer.width; x += 1) {
      if (!layer.maskPixels[y * layer.width + x]) {
        continue;
      }
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) {
    return null;
  }
  return {
    left: layer.left + minX,
    top: layer.top + minY,
    right: layer.left + maxX,
    bottom: layer.top + maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    centerX: layer.left + (minX + maxX) * 0.5,
    centerY: layer.top + (minY + maxY) * 0.5,
    area,
  };
}

export function buildLayerDescriptors(psdLayerEntries, imageWidth, imageHeight, options = {}) {
  const {
    puppetLayerFitEnabled = [],
    puppetLayerBindingOverrides = [],
    puppetSwapLeftRightMapping = false,
  } = options;
  const descriptors = [];
  for (let i = 0; i < psdLayerEntries.length; i += 1) {
    const layer = psdLayerEntries[i];
    const bounds = computeMaskedLayerBounds(layer);
    if (!bounds) {
      continue;
    }
    const normalizedName = normalizeLayerName(layer.name);
    const roleHint = detectLayerRole(normalizedName);
    descriptors.push({
      layer,
      index: i,
      bounds,
      normalizedName,
      sideHint: maybeSwapSide(detectLayerSide(normalizedName), puppetSwapLeftRightMapping),
      roleHint,
      overridePrimaryBoneId: puppetLayerBindingOverrides[i]?.primaryBoneId || null,
      puppetFitEnabled: puppetLayerFitEnabled[i] ?? true,
      accessoryExcluded: !roleHint && isExcludedAccessoryLayer(normalizedName),
      areaRatio: bounds.area / Math.max(1, imageWidth * imageHeight),
      widthRatio: bounds.width / Math.max(1, imageWidth),
      heightRatio: bounds.height / Math.max(1, imageHeight),
      centerXRatio: bounds.centerX / Math.max(1, imageWidth),
      centerYRatio: bounds.centerY / Math.max(1, imageHeight),
      aspect: bounds.width / Math.max(1, bounds.height),
    });
  }
  return descriptors;
}

function partMatchesOverride(part, primaryBoneId) {
  if (!primaryBoneId) {
    return false;
  }
  if (part === "torso") {
    return ["pelvis", "spine", "chest", "neck", "head"].includes(primaryBoneId);
  }
  if (part === "arm_l") {
    return /^(clavicle_l|upper_arm_l|forearm_l|hand_l)$/.test(primaryBoneId);
  }
  if (part === "arm_r") {
    return /^(clavicle_r|upper_arm_r|forearm_r|hand_r)$/.test(primaryBoneId);
  }
  if (part === "leg_l") {
    return /^(thigh_l|shin_l|foot_l)$/.test(primaryBoneId);
  }
  if (part === "leg_r") {
    return /^(thigh_r|shin_r|foot_r)$/.test(primaryBoneId);
  }
  return false;
}

export function estimateBodyCenterX(descriptors, imageWidth) {
  const torsoHints = descriptors.filter((item) => item.roleHint === "torso");
  if (torsoHints.length) {
    let sum = 0;
    for (let i = 0; i < torsoHints.length; i += 1) {
      sum += torsoHints[i].bounds.centerX;
    }
    return sum / torsoHints.length;
  }
  const central = descriptors.filter((item) => (
    !item.accessoryExcluded &&
    item.centerYRatio > 0.15 &&
    item.centerYRatio < 0.72 &&
    item.widthRatio > 0.08 &&
    item.heightRatio > 0.08 &&
    Math.abs(item.centerXRatio - 0.5) < 0.18
  ));
  if (central.length) {
    let sum = 0;
    for (let i = 0; i < central.length; i += 1) {
      sum += central[i].bounds.centerX;
    }
    return sum / central.length;
  }
  return imageWidth * 0.5;
}

export function selectBodyCoreDescriptors(descriptors, imageWidth, imageHeight, bodyCenterX) {
  return descriptors.filter((item) => {
    if (!item.puppetFitEnabled) {
      return false;
    }
    if (item.accessoryExcluded) {
      return false;
    }
    if (item.roleHint && ["head", "neck", "torso", "shoulder", "upper_arm", "forearm", "hand", "thigh", "shin", "foot"].includes(item.roleHint)) {
      return true;
    }
    const dx = Math.abs(item.bounds.centerX - bodyCenterX) / Math.max(1, imageWidth);
    const torsoLike = item.widthRatio > 0.10 && item.heightRatio > 0.10 && dx < 0.16;
    const limbLike = item.heightRatio > 0.10 && item.widthRatio < 0.18 && dx < 0.28;
    const obviousTail = item.centerYRatio > 0.42 && dx < 0.10 && item.heightRatio > 0.22 && item.aspect < 0.55;
    const hugeBackAccessory = item.areaRatio > 0.08 && item.centerYRatio > 0.44 && item.widthRatio > 0.16 && dx < 0.14;
    if (obviousTail || hugeBackAccessory) {
      return false;
    }
    return torsoLike || limbLike;
  });
}

export function buildUnionMaskFromDescriptors(descriptors, imageWidth, imageHeight) {
  const mask = new Uint8Array(imageWidth * imageHeight);
  for (let i = 0; i < descriptors.length; i += 1) {
    const layer = descriptors[i].layer;
    for (let y = 0; y < layer.height; y += 1) {
      const globalY = layer.top + y;
      if (globalY < 0 || globalY >= imageHeight) {
        continue;
      }
      for (let x = 0; x < layer.width; x += 1) {
        if (!layer.maskPixels[y * layer.width + x]) {
          continue;
        }
        const globalX = layer.left + x;
        if (globalX < 0 || globalX >= imageWidth) {
          continue;
        }
        mask[globalY * imageWidth + globalX] = 1;
      }
    }
  }
  return mask;
}

function isUpperBody(item) {
  return item.centerYRatio < 0.72;
}

function isLowerBody(item) {
  return item.centerYRatio > 0.35;
}

function isLeftOfCenter(item, bodyCenterX) {
  return item.bounds.centerX <= bodyCenterX + 8;
}

function isRightOfCenter(item, bodyCenterX) {
  return item.bounds.centerX >= bodyCenterX - 8;
}

export function selectDescriptorsForRigPart(descriptors, part, bodyCenterX) {
  return descriptors.filter((item) => {
    if (!item.puppetFitEnabled) {
      return false;
    }
    if (item.overridePrimaryBoneId) {
      return partMatchesOverride(part, item.overridePrimaryBoneId);
    }

    switch (part) {
      case "torso":
        if (["head", "neck", "torso", "shoulder"].includes(item.roleHint)) {
          return true;
        }
        return !item.accessoryExcluded
          && Math.abs(item.bounds.centerX - bodyCenterX) < Math.max(24, item.bounds.width * 0.75)
          && item.centerYRatio > 0.04
          && item.centerYRatio < 0.74
          && item.widthRatio > 0.04
          && item.heightRatio > 0.05;
      case "arm_l":
        if (item.sideHint !== "left" && !isLeftOfCenter(item, bodyCenterX)) {
          return false;
        }
        if (!isUpperBody(item)) {
          return false;
        }
        return ["shoulder", "upper_arm", "forearm", "hand"].includes(item.roleHint)
          || (["sleeve", "outerwear"].includes(item.roleHint) && item.centerYRatio < 0.70);
      case "arm_r":
        if (item.sideHint !== "right" && !isRightOfCenter(item, bodyCenterX)) {
          return false;
        }
        if (!isUpperBody(item)) {
          return false;
        }
        return ["shoulder", "upper_arm", "forearm", "hand"].includes(item.roleHint)
          || (["sleeve", "outerwear"].includes(item.roleHint) && item.centerYRatio < 0.70);
      case "leg_l":
        if (item.sideHint !== "left" && !isLeftOfCenter(item, bodyCenterX)) {
          return false;
        }
        if (!isLowerBody(item)) {
          return false;
        }
        return ["thigh", "shin", "foot", "hip_accessory"].includes(item.roleHint);
      case "leg_r":
        if (item.sideHint !== "right" && !isRightOfCenter(item, bodyCenterX)) {
          return false;
        }
        if (!isLowerBody(item)) {
          return false;
        }
        return ["thigh", "shin", "foot", "hip_accessory"].includes(item.roleHint);
      default:
        return false;
    }
  });
}
