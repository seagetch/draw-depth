function normalizeName(name) {
  return (name || "").toLowerCase();
}

function detectSide(name) {
  if (/\bleft\b|_l\b|::l\b|\bl\b|hidari/.test(name)) {
    return "l";
  }
  if (/\bright\b|_r\b|::r\b|\br\b|migi/.test(name)) {
    return "r";
  }
  return null;
}

function swapSide(side, swapSides) {
  if (!swapSides) {
    return side;
  }
  if (side === "l") {
    return "r";
  }
  if (side === "r") {
    return "l";
  }
  return side;
}

function hasAny(name, patterns) {
  for (let i = 0; i < patterns.length; i += 1) {
    if (patterns[i].test(name)) {
      return true;
    }
  }
  return false;
}

function classifyLayer(name) {
  if (hasAny(name, [/face/, /head/, /ear/, /bang/, /hair/])) return "head";
  if (hasAny(name, [/neck/, /kubi/])) return "neck";
  if (hasAny(name, [/body/, /torso/, /trunk/, /chest/, /breast/, /spine/, /waist/, /pelvis/, /hip/])) return "torso";
  if (hasAny(name, [/shoulder/, /clavicle/])) return "shoulder";
  if (hasAny(name, [/upper.*arm/, /arm.*upper/])) return "upper_arm";
  if (hasAny(name, [/forearm/, /lower.*arm/, /elbow/])) return "forearm";
  if (hasAny(name, [/hand/, /wrist/, /palm/, /thumb/, /finger/])) return "hand";
  if (hasAny(name, [/thigh/, /upper.*leg/])) return "thigh";
  if (hasAny(name, [/shin/, /calf/, /lower.*leg/, /knee/])) return "shin";
  if (hasAny(name, [/foot/, /ankle/, /boot/])) return "foot";
  if (hasAny(name, [/sleeve/, /glove/])) return "sleeve";
  if (hasAny(name, [/jacket/, /coat/, /hood/, /cape/, /cloak/])) return "outerwear";
  if (hasAny(name, [/skirt/, /belt/])) return "hip_accessory";
  if (hasAny(name, [/tail/])) return "tail";
  return "unknown";
}

function classifyDeformClass(classification, name, side) {
  if (classification === "head") {
    if (hasAny(name, [/face/, /eye/, /brow/, /nose/, /mouth/, /lip/, /tooth/, /tongue/, /ear/])) {
      return "rigid_face";
    }
    if (hasAny(name, [/hair/, /bang/])) {
      return "cloth_follow";
    }
    return "rigid_head";
  }
  if (classification === "neck") {
    return "neck_seam";
  }
  if (classification === "shoulder") {
    return side ? `shoulder_seam_${side}` : "shoulder_seam";
  }
  if (classification === "upper_arm" || classification === "forearm" || classification === "hand") {
    return side ? `arm_chain_${side}` : "arm_chain";
  }
  if (classification === "sleeve") {
    return side ? `shoulder_seam_${side}` : "cloth_follow";
  }
  if (classification === "torso") {
    return "torso_core";
  }
  if (classification === "thigh" || classification === "shin" || classification === "foot") {
    return side ? `leg_chain_${side}` : "leg_chain";
  }
  if (classification === "outerwear") {
    return side ? `shoulder_seam_${side}` : "cloth_follow";
  }
  if (classification === "hip_accessory") {
    return "hip_seam";
  }
  if (classification === "tail") {
    return "cloth_follow";
  }
  return "cloth_follow";
}

function sideBones(side, names) {
  if (!side) {
    return [];
  }
  return names.map((name) => `${name}_${side}`);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export const PUPPET_BONE_IDS = [
  "pelvis",
  "spine",
  "chest",
  "neck",
  "head",
  "clavicle_l",
  "upper_arm_l",
  "forearm_l",
  "hand_l",
  "clavicle_r",
  "upper_arm_r",
  "forearm_r",
  "hand_r",
  "thigh_l",
  "shin_l",
  "foot_l",
  "thigh_r",
  "shin_r",
  "foot_r",
];

function inferAllowedBoneIds(primaryBoneId) {
  if (!primaryBoneId) {
    return ["pelvis", "spine", "chest"];
  }
  if (primaryBoneId === "pelvis") return ["pelvis", "spine", "chest", "thigh_l", "thigh_r", "shin_l", "shin_r"];
  if (primaryBoneId === "spine") return ["pelvis", "spine", "chest", "neck", "clavicle_l", "clavicle_r", "thigh_l", "thigh_r"];
  if (primaryBoneId === "chest") return ["pelvis", "spine", "chest", "neck", "clavicle_l", "clavicle_r", "upper_arm_l", "upper_arm_r", "thigh_l", "thigh_r"];
  if (primaryBoneId === "neck") return ["chest", "neck", "head"];
  if (primaryBoneId === "head") return ["chest", "neck", "head"];
  if (/^clavicle_(l|r)$/.test(primaryBoneId)) {
    const side = primaryBoneId.endsWith("_l") ? "l" : "r";
    return unique(["chest", `clavicle_${side}`, `upper_arm_${side}`, `forearm_${side}`]);
  }
  if (/^upper_arm_(l|r)$/.test(primaryBoneId)) {
    const side = primaryBoneId.endsWith("_l") ? "l" : "r";
    return unique(["chest", `clavicle_${side}`, `upper_arm_${side}`, `forearm_${side}`, `hand_${side}`]);
  }
  if (/^forearm_(l|r)$/.test(primaryBoneId)) {
    const side = primaryBoneId.endsWith("_l") ? "l" : "r";
    return unique(["chest", `clavicle_${side}`, `upper_arm_${side}`, `forearm_${side}`, `hand_${side}`]);
  }
  if (/^hand_(l|r)$/.test(primaryBoneId)) {
    const side = primaryBoneId.endsWith("_l") ? "l" : "r";
    return unique([`forearm_${side}`, `hand_${side}`]);
  }
  if (/^thigh_(l|r)$/.test(primaryBoneId)) {
    const side = primaryBoneId.endsWith("_l") ? "l" : "r";
    return unique(["pelvis", `thigh_${side}`, `shin_${side}`, `foot_${side}`]);
  }
  if (/^shin_(l|r)$/.test(primaryBoneId)) {
    const side = primaryBoneId.endsWith("_l") ? "l" : "r";
    return unique(["pelvis", `thigh_${side}`, `shin_${side}`, `foot_${side}`]);
  }
  if (/^foot_(l|r)$/.test(primaryBoneId)) {
    const side = primaryBoneId.endsWith("_l") ? "l" : "r";
    return unique([`thigh_${side}`, `shin_${side}`, `foot_${side}`]);
  }
  return [primaryBoneId];
}

export function applyLayerBindingOverride(layerBinding, override = null) {
  if (!override?.primaryBoneId) {
    return layerBinding;
  }
  return {
    ...layerBinding,
    primaryBoneId: override.primaryBoneId,
    allowedBoneIds: inferAllowedBoneIds(override.primaryBoneId),
    deformClass: layerBinding.deformClass || "cloth_follow",
    overridePrimaryBoneId: override.primaryBoneId,
  };
}

export function createLayerBindingPolicy(layer, options = {}) {
  const { swapLeftRight = false } = options;
  const normalizedName = normalizeName(layer?.name);
  const side = swapSide(detectSide(normalizedName), swapLeftRight);
  const classification = classifyLayer(normalizedName);
  const deformClass = classifyDeformClass(classification, normalizedName, side);
  let primaryBoneId = "chest";
  let allowedBoneIds = ["pelvis", "spine", "chest"];

  switch (classification) {
    case "head":
      primaryBoneId = "head";
      allowedBoneIds = ["chest", "neck", "head"];
      break;
    case "neck":
      primaryBoneId = "neck";
      allowedBoneIds = ["chest", "neck", "head"];
      break;
    case "torso":
      primaryBoneId = "spine";
      allowedBoneIds = ["pelvis", "spine", "chest", "neck", "clavicle_l", "clavicle_r", "upper_arm_l", "upper_arm_r", "thigh_l", "thigh_r"];
      break;
    case "shoulder":
      primaryBoneId = side ? `clavicle_${side}` : "chest";
      allowedBoneIds = unique(["chest", ...sideBones(side, ["clavicle", "upper_arm"])]);
      break;
    case "upper_arm":
      primaryBoneId = side ? `upper_arm_${side}` : "chest";
      allowedBoneIds = unique(["chest", ...sideBones(side, ["clavicle", "upper_arm", "forearm"])]);
      break;
    case "forearm":
      primaryBoneId = side ? `forearm_${side}` : "chest";
      allowedBoneIds = unique(["chest", ...sideBones(side, ["clavicle", "upper_arm", "forearm", "hand"])]);
      break;
    case "hand":
      primaryBoneId = side ? `hand_${side}` : "chest";
      allowedBoneIds = unique(sideBones(side, ["forearm", "hand"]));
      break;
    case "thigh":
      primaryBoneId = side ? `thigh_${side}` : "pelvis";
      allowedBoneIds = unique(["pelvis", ...sideBones(side, ["thigh", "shin"])]);
      break;
    case "shin":
      primaryBoneId = side ? `shin_${side}` : "pelvis";
      allowedBoneIds = unique(["pelvis", ...sideBones(side, ["thigh", "shin", "foot"])]);
      break;
    case "foot":
      primaryBoneId = side ? `foot_${side}` : "pelvis";
      allowedBoneIds = unique(sideBones(side, ["shin", "foot"]));
      break;
    case "sleeve":
      primaryBoneId = side ? `upper_arm_${side}` : "chest";
      allowedBoneIds = unique(["chest", ...sideBones(side, ["clavicle", "upper_arm", "forearm", "hand"])]);
      break;
    case "outerwear":
      primaryBoneId = side ? `clavicle_${side}` : "chest";
      allowedBoneIds = side
        ? unique(["pelvis", "spine", "chest", "neck", ...sideBones(side, ["clavicle", "upper_arm", "forearm"])])
        : ["pelvis", "spine", "chest", "neck", "clavicle_l", "clavicle_r", "upper_arm_l", "upper_arm_r"];
      break;
    case "hip_accessory":
      primaryBoneId = "pelvis";
      allowedBoneIds = ["pelvis", "spine", "thigh_l", "thigh_r", "shin_l", "shin_r"];
      break;
    case "tail":
      primaryBoneId = "pelvis";
      allowedBoneIds = ["pelvis"];
      break;
    default:
      primaryBoneId = side ? `upper_arm_${side}` : "chest";
      allowedBoneIds = side
        ? unique(["pelvis", "spine", "chest", ...sideBones(side, ["clavicle", "upper_arm", "forearm", "hand", "thigh", "shin", "foot"])])
        : ["pelvis", "spine", "chest", "neck", "head"];
      break;
  }

  return {
    layerIndex: -1,
    layerName: layer?.name || "",
    side,
    classification,
    deformClass,
    primaryBoneId,
    allowedBoneIds,
  };
}
