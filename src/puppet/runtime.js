import { createMeshBindingWithPolicy } from "./bindWeights.js?v=20260409_1";
import { applySkinningToGeometry, restoreRestGeometry } from "./deform.js";
import { createPuppetOverlay } from "./overlay.js";
import { applyLayerBindingOverride, createLayerBindingPolicy, PUPPET_BONE_IDS } from "./layerBinding.js?v=20260410_1";
import {
  createRigState,
  moveBoneRestTailTarget,
  resetRigPose,
  setBoneEuler,
  setBoneWorldQuaternion,
  setBoneWorldTailTarget,
  solveIkChainToTarget,
  solveRigPose,
} from "./rigState.js?v=20260410_1";
import { createBinaryMaskPreviewUrl } from "./debugPreview.js";
import { createHumanoidRigData } from "./rigTemplate.js?v=20260410_10";

function buildMeshSignature(layerMeshEntries, puppetSwapLeftRightMapping) {
  return layerMeshEntries
    .map((entry) => `${entry.layerIndex}:${entry.mesh.geometry.getAttribute("position")?.count || 0}`)
    .join("|")
    + `::swap=${puppetSwapLeftRightMapping ? "1" : "0"}`;
}

function buildRigSignature(psdLayerEntries, puppetLayerFitEnabled, puppetLayerBindingOverrides, imageWidth, imageHeight) {
  return `${imageWidth}x${imageHeight}::${(psdLayerEntries || []).map((layer, index) => {
    const enabled = puppetLayerFitEnabled?.[index] ?? true;
    const override = puppetLayerBindingOverrides?.[index]?.primaryBoneId || "";
    return `${layer.name || index}:${layer.left},${layer.top},${layer.width},${layer.height}:${enabled ? "1" : "0"}:${override}`;
  }).join("|")}`;
}

const IK_EFFECTOR_CHAINS = {
  hand_l: ["upper_arm_l", "forearm_l", "hand_l"],
  hand_r: ["upper_arm_r", "forearm_r", "hand_r"],
  foot_l: ["thigh_l", "shin_l", "foot_l"],
  foot_r: ["thigh_r", "shin_r", "foot_r"],
};

export function createPuppetRuntime({
  THREE,
  scene,
  camera,
  controls,
  renderer,
  renderState,
  onStateChanged,
  onSwapChanged,
}) {
  const overlay = createPuppetOverlay(THREE, scene);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const dragPoint = new THREE.Vector3();
  const planeNormal = new THREE.Vector3();
  let draggingBoneId = null;
  let draggingRestEdit = false;
  let interactionAttached = false;

  function computeFlipPenalty(points) {
    if (!points) {
      return Number.POSITIVE_INFINITY;
    }
    const pairs = [
      ["shoulder_l", "shoulder_r", 2],
      ["elbow_l", "elbow_r", 2],
      ["hand_l", "hand_r", 3],
      ["hip_l", "hip_r", 2],
      ["knee_l", "knee_r", 2],
      ["foot_l", "foot_r", 3],
    ];
    let penalty = 0;
    for (let i = 0; i < pairs.length; i += 1) {
      const [leftKey, rightKey, weight] = pairs[i];
      const left = points[leftKey];
      const right = points[rightKey];
      if (!left || !right) {
        continue;
      }
      if (left.x >= right.x) {
        penalty += weight;
      }
    }
    if (points.chest) {
      if (points.shoulder_l?.x > points.chest.x) penalty += 2;
      if (points.shoulder_r?.x < points.chest.x) penalty += 2;
      if (points.hand_l?.x > points.chest.x) penalty += 2;
      if (points.hand_r?.x < points.chest.x) penalty += 2;
    }
    if (points.pelvis) {
      if (points.hip_l?.x > points.pelvis.x) penalty += 2;
      if (points.hip_r?.x < points.pelvis.x) penalty += 2;
      if (points.foot_l?.x > points.pelvis.x) penalty += 2;
      if (points.foot_r?.x < points.pelvis.x) penalty += 2;
    }
    return penalty;
  }

  function createRigDataForSwap(layerMeshEntries, swapLeftRight) {
    return createHumanoidRigData({
      layerMeshEntries,
      psdLayerEntries: renderState.psdLayerEntries,
      puppetLayerFitEnabled: renderState.puppetLayerFitEnabled,
      puppetLayerBindingOverrides: renderState.puppetLayerBindingOverrides,
      puppetSwapLeftRightMapping: swapLeftRight,
      imageWidth: renderState.imageWidth,
      imageHeight: renderState.imageHeight,
    });
  }

  function rebuildBindings(layerMeshEntries = renderState.psdLayerMeshes, options = {}) {
    const { preservePolicy = false } = options;
    if (!renderState.puppetRig) {
      return;
    }
    renderState.puppetBindingsByLayer = [];
    const nextLayerBindings = new Array(renderState.psdLayerEntries.length).fill(null);
    for (let i = 0; i < layerMeshEntries.length; i += 1) {
      const entry = layerMeshEntries[i];
      const layer = renderState.psdLayerEntries[entry.layerIndex];
      const previousBinding = renderState.puppetLayerBindings?.[entry.layerIndex];
      const layerBinding = preservePolicy && previousBinding
        ? {
          layerIndex: entry.layerIndex,
          layerName: previousBinding.layerName || layer?.name || "",
          side: previousBinding.side ?? null,
          classification: previousBinding.classification || "unknown",
          primaryBoneId: previousBinding.primaryBoneId || "chest",
          allowedBoneIds: [...(previousBinding.allowedBoneIds || [])],
        }
        : {
          ...applyLayerBindingOverride(
            createLayerBindingPolicy(layer, { swapLeftRight: renderState.puppetSwapLeftRightMapping }),
            renderState.puppetLayerBindingOverrides?.[entry.layerIndex] ?? null,
          ),
          layerIndex: entry.layerIndex,
        };
      const binding = createMeshBindingWithPolicy(THREE, renderState.puppetRig, entry.mesh.geometry, layerBinding);
      renderState.puppetBindingsByLayer.push(binding);
      nextLayerBindings[entry.layerIndex] = {
        ...layerBinding,
        dominantBoneIds: binding?.dominantBoneIds || [],
      };
      entry.puppetLayerBinding = nextLayerBindings[entry.layerIndex];
    }
    renderState.puppetLayerBindings = nextLayerBindings;
  }

  function ensureRig(layerMeshEntries) {
    const rigSignature = buildRigSignature(
      renderState.psdLayerEntries,
      renderState.puppetLayerFitEnabled,
      renderState.puppetLayerBindingOverrides,
      renderState.imageWidth,
      renderState.imageHeight,
    );
    const meshSignature = buildMeshSignature(
      layerMeshEntries,
      renderState.puppetSwapLeftRightMapping,
    );

    if (!renderState.puppetRig || renderState.puppetRigSignature !== rigSignature) {
      let rigData = createRigDataForSwap(layerMeshEntries, renderState.puppetSwapLeftRightMapping);
      if (rigData) {
        const currentPenalty = computeFlipPenalty(rigData.fit?.points);
        const flippedRigData = createRigDataForSwap(layerMeshEntries, !renderState.puppetSwapLeftRightMapping);
        const flippedPenalty = computeFlipPenalty(flippedRigData?.fit?.points);
        if (flippedRigData && flippedPenalty + 1 < currentPenalty) {
          renderState.puppetSwapLeftRightMapping = !renderState.puppetSwapLeftRightMapping;
          onSwapChanged?.(renderState.puppetSwapLeftRightMapping);
          rigData = flippedRigData;
        }
      }
      if (!rigData || !rigData.template.length) {
        renderState.puppetRig = null;
        renderState.puppetBindingsByLayer = [];
        renderState.puppetLayerBindings = [];
        renderState.puppetRigSignature = "";
        renderState.puppetMeshSignature = "";
        renderState.puppetDebugBodyMaskUrl = "";
        renderState.puppetDebugSkeletonUrl = "";
        renderState.puppetDebugSummary = "";
        return null;
      }

      renderState.puppetRig = createRigState(THREE, rigData.template);
      renderState.puppetRigSignature = rigSignature;
      renderState.puppetMeshSignature = "";
      renderState.puppetDebugBodyMaskUrl = createBinaryMaskPreviewUrl(
        rigData.fit.bodyMask,
        renderState.imageWidth,
        renderState.imageHeight,
        { on: [255, 201, 40, 255], off: [10, 14, 18, 255] },
      );
      renderState.puppetDebugSkeletonUrl = createBinaryMaskPreviewUrl(
        rigData.fit.skeleton,
        renderState.imageWidth,
        renderState.imageHeight,
        { on: [0, 210, 255, 255], off: [10, 14, 18, 255] },
      );
      renderState.puppetDebugSummary = "Puppet debug: body mask / skeletonized mask";
    }

    if (renderState.puppetRig && renderState.puppetMeshSignature === meshSignature) {
      return renderState.puppetRig;
    }

    rebuildBindings(layerMeshEntries);
    renderState.puppetMeshSignature = meshSignature;
    return renderState.puppetRig;
  }

  function sync(layerMeshEntries = renderState.psdLayerMeshes) {
    if (!renderState.puppetEnabled) {
      for (let i = 0; i < layerMeshEntries.length; i += 1) {
        restoreRestGeometry(layerMeshEntries[i].mesh.geometry);
      }
      overlay.update(null, false, renderState.puppetSelectedBoneId);
      onStateChanged?.();
      return;
    }

    const rig = ensureRig(layerMeshEntries);
    if (!rig) {
      overlay.update(null, false, renderState.puppetSelectedBoneId);
      onStateChanged?.();
      return;
    }

    solveRigPose(THREE, rig);
    for (let i = 0; i < layerMeshEntries.length; i += 1) {
      applySkinningToGeometry(THREE, rig, layerMeshEntries[i].mesh.geometry);
    }
    overlay.update(rig, renderState.puppetOverlayVisible, renderState.puppetSelectedBoneId);
    onStateChanged?.();
  }

  function reset() {
    if (!renderState.puppetRig) {
      return;
    }
    resetRigPose(renderState.puppetRig);
    sync();
  }

  function setEnabled(enabled) {
    renderState.puppetEnabled = !!enabled;
    sync();
  }

  function setOverlayVisible(visible) {
    renderState.puppetOverlayVisible = !!visible;
    sync();
  }

  function setBonePose(boneId, euler) {
    if (!renderState.puppetRig) {
      sync();
    }
    if (!renderState.puppetRig) {
      return false;
    }
    const updated = setBoneEuler(renderState.puppetRig, boneId, euler);
    if (updated) {
      sync();
    }
    return updated;
  }

  function setBoneTargetWorld(boneId, target) {
    if (!renderState.puppetRig) {
      sync();
    }
    if (!renderState.puppetRig) {
      return false;
    }
    const updated = setBoneWorldTailTarget(THREE, renderState.puppetRig, boneId, target);
    if (updated) {
      renderState.puppetSelectedBoneId = boneId;
      sync();
    }
    return updated;
  }

  function solveIkTargetWorld(boneId, target) {
    if (!renderState.puppetRig) {
      sync();
    }
    if (!renderState.puppetRig) {
      return false;
    }
    const chain = IK_EFFECTOR_CHAINS[boneId];
    let updated = false;
    if (chain) {
      updated = solveIkChainToTarget(THREE, renderState.puppetRig, chain, target, { iterations: 10 });
      if (updated) {
        const endBone = renderState.puppetRig.boneMap.get(boneId);
        if (endBone) {
          const desiredDirection = new THREE.Vector3().subVectors(target, endBone.worldHead);
          if (desiredDirection.lengthSq() > 1e-8) {
            const desiredWorldQuaternion = new THREE.Quaternion().setFromUnitVectors(
              new THREE.Vector3(0, 1, 0),
              desiredDirection.normalize(),
            );
            setBoneWorldQuaternion(renderState.puppetRig, boneId, desiredWorldQuaternion);
          }
        }
      }
    } else {
      updated = setBoneWorldTailTarget(THREE, renderState.puppetRig, boneId, target);
    }
    if (updated) {
      renderState.puppetSelectedBoneId = boneId;
      sync();
    }
    return updated;
  }

  function setLayerFitEnabled(layerIndex, enabled) {
    if (layerIndex < 0 || layerIndex >= renderState.psdLayerEntries.length) {
      return false;
    }
    renderState.puppetLayerFitEnabled[layerIndex] = !!enabled;
    renderState.puppetRigSignature = "";
    renderState.puppetMeshSignature = "";
    sync();
    return true;
  }

  function setSwapLeftRightMapping(enabled) {
    renderState.puppetSwapLeftRightMapping = !!enabled;
    renderState.puppetMeshSignature = "";
    onSwapChanged?.(renderState.puppetSwapLeftRightMapping);
    sync();
    return true;
  }

  function setLayerBindingPrimary(layerIndex, primaryBoneId) {
    if (layerIndex < 0 || layerIndex >= renderState.psdLayerEntries.length) {
      return false;
    }
    if (primaryBoneId && !PUPPET_BONE_IDS.includes(primaryBoneId)) {
      return false;
    }
    renderState.puppetLayerBindingOverrides[layerIndex] = primaryBoneId ? { primaryBoneId } : null;
    renderState.puppetRigSignature = "";
    renderState.puppetMeshSignature = "";
    sync();
    return true;
  }

  function setBoneRestTargetWorld(boneId, target) {
    if (!renderState.puppetRig) {
      sync();
    }
    if (!renderState.puppetRig) {
      return false;
    }
    const updated = moveBoneRestTailTarget(THREE, renderState.puppetRig, boneId, target);
    if (updated) {
      rebuildBindings(renderState.psdLayerMeshes, { preservePolicy: true });
      renderState.puppetSelectedBoneId = boneId;
      sync();
    }
    return updated;
  }

  function getPointerNdc(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    return pointer;
  }

  function updateCursor(event) {
    if (!renderState.puppetEnabled || !renderState.puppetOverlayVisible || !renderState.puppetRig) {
      renderer.domElement.style.cursor = "";
      return;
    }
    const ndc = getPointerNdc(event);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(overlay.getHandleMeshes().filter((mesh) => mesh.visible), false)[0];
    renderer.domElement.style.cursor = hit ? "grab" : "";
  }

  function onPointerDown(event) {
    if (!renderState.puppetEnabled || !renderState.puppetOverlayVisible || !renderState.puppetRig) {
      return;
    }
    if (event.button !== 0 && event.button !== 1) {
      return;
    }
    const ndc = getPointerNdc(event);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(overlay.getHandleMeshes().filter((mesh) => mesh.visible), false)[0];
    if (!hit) {
      return;
    }
    draggingBoneId = hit.object.userData.boneId;
    draggingRestEdit = event.button === 1;
    renderState.puppetSelectedBoneId = draggingBoneId;
    const bone = renderState.puppetRig.boneMap.get(draggingBoneId);
    camera.getWorldDirection(planeNormal);
    dragPlane.setFromNormalAndCoplanarPoint(planeNormal, draggingRestEdit ? bone.worldTail : bone.worldHead);
    controls.enabled = false;
    renderer.domElement.setPointerCapture?.(event.pointerId);
    renderer.domElement.style.cursor = draggingRestEdit ? "move" : "grabbing";
    event.preventDefault();
    sync();
  }

  function onPointerMove(event) {
    if (!draggingBoneId) {
      updateCursor(event);
      return;
    }
    const ndc = getPointerNdc(event);
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
      return;
    }
    if (draggingRestEdit) {
      if (moveBoneRestTailTarget(THREE, renderState.puppetRig, draggingBoneId, dragPoint.clone())) {
        rebuildBindings(renderState.psdLayerMeshes, { preservePolicy: true });
        sync();
      }
      return;
    }
    solveIkTargetWorld(draggingBoneId, dragPoint);
  }

  function onPointerUp(event) {
    if (!draggingBoneId) {
      return;
    }
    if (event?.pointerId != null) {
      renderer.domElement.releasePointerCapture?.(event.pointerId);
    }
    draggingBoneId = null;
    draggingRestEdit = false;
    controls.enabled = true;
    renderer.domElement.style.cursor = "";
  }

  function suppressAuxiliaryDefault(event) {
    if (event.button === 1) {
      event.preventDefault();
    }
  }

  function attachInteraction() {
    if (interactionAttached) {
      return;
    }
    interactionAttached = true;
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("auxclick", suppressAuxiliaryDefault);
    renderer.domElement.addEventListener("contextmenu", suppressAuxiliaryDefault);
  }

  function getDebugApi() {
    return {
      setEnabled,
      setOverlayVisible,
      setBonePose,
      solveIkTargetWorld: (boneId, target) => solveIkTargetWorld(
        boneId,
        new THREE.Vector3(target.x, target.y, target.z),
      ),
      setBoneTargetWorld: (boneId, target) => setBoneTargetWorld(
        boneId,
        new THREE.Vector3(target.x, target.y, target.z),
      ),
      setBoneRestTargetWorld: (boneId, target) => setBoneRestTargetWorld(
        boneId,
        new THREE.Vector3(target.x, target.y, target.z),
      ),
      setLayerFitEnabled,
      setLayerBindingPrimary,
      setSwapLeftRightMapping,
      reset,
      sync: () => sync(),
      getBoneIds: () => renderState.puppetRig ? renderState.puppetRig.bones.map((bone) => bone.id) : [],
      getRig: () => renderState.puppetRig,
      getLayerBindings: () => renderState.puppetLayerBindings,
    };
  }

  return {
    sync,
    reset,
    setEnabled,
    setOverlayVisible,
    setBonePose,
    setBoneTargetWorld,
    setBoneRestTargetWorld,
    solveIkTargetWorld,
    setLayerFitEnabled,
    setLayerBindingPrimary,
    setSwapLeftRightMapping,
    attachInteraction,
    getDebugApi,
    dispose: () => overlay.dispose(),
  };
}
