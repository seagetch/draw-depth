import { createMeshBindingWithPolicy } from "./bindWeights.js?v=20260411_5";
import { applySkinningToGeometry, restoreRestGeometry } from "./deform.js";
import { createPuppetOverlay } from "./overlay.js";
import { applyLayerBindingOverride, createLayerBindingPolicy, PUPPET_BONE_IDS } from "./layerBinding.js?v=20260411_2";
import {
  createRigState,
  moveBoneRestTailTarget,
  resetRigPose,
  setBoneEuler,
  setBoneWorldQuaternion,
  setBoneWorldTailTarget,
  setBoneWorldTailTargetWithOptions,
  solveIkChainToTarget,
  solveRigPose,
} from "./rigState.js?v=20260411_2";
import { createBinaryMaskPreviewUrl } from "./debugPreview.js";
import { createHumanoidRigData } from "./rigTemplate.js?v=20260411_2";

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

function buildAncestorPath(rig, boneId) {
  const path = [];
  let current = rig?.boneMap?.get(boneId) || null;
  while (current) {
    path.push(current.id);
    current = current.parentId ? rig.boneMap.get(current.parentId) : null;
  }
  return path.reverse();
}

function buildIkChains(rig, boneId) {
  const fullPath = buildAncestorPath(rig, boneId);
  if (fullPath.length <= 1) {
    return [];
  }
  const starts = [];
  const pushStart = (startId) => {
    const startIndex = fullPath.indexOf(startId);
    if (startIndex >= 0) {
      const chain = fullPath.slice(startIndex);
      if (chain.length > 1 && !starts.some((candidate) => candidate.join("|") === chain.join("|"))) {
        starts.push(chain);
      }
    }
  };

  if (/_l$|_r$/.test(boneId) && (boneId.includes("arm") || boneId.includes("clavicle") || boneId.includes("hand"))) {
    pushStart(`clavicle${boneId.endsWith("_l") ? "_l" : "_r"}`);
    pushStart("neck");
    pushStart("chest");
  } else if (/_l$|_r$/.test(boneId) && (boneId.includes("thigh") || boneId.includes("shin") || boneId.includes("foot"))) {
    pushStart("pelvis");
  } else if (boneId === "head" || boneId === "neck") {
    pushStart("spine");
    pushStart("pelvis");
  }

  if (!starts.length) {
    starts.push(fullPath);
  }
  return starts;
}

function snapshotRigPose(rig) {
  return rig.bones.map((bone) => ({
    id: bone.id,
    poseEuler: bone.poseEuler.clone(),
    poseTranslation: bone.poseTranslation.clone(),
  }));
}

function restoreRigPoseSnapshot(THREE, rig, snapshot) {
  for (let i = 0; i < snapshot.length; i += 1) {
    const saved = snapshot[i];
    const bone = rig.boneMap.get(saved.id);
    if (!bone) {
      continue;
    }
    bone.poseEuler.copy(saved.poseEuler);
    bone.poseTranslation.copy(saved.poseTranslation);
  }
  solveRigPose(THREE, rig);
}

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
  const projectedHandle = new THREE.Vector3();
  let draggingBoneId = null;
  let draggingRestEdit = false;
  let interactionAttached = false;
  let hoveredBoneId = null;
  const hoverPopupEl = document.createElement("div");
  hoverPopupEl.style.position = "fixed";
  hoverPopupEl.style.zIndex = "30";
  hoverPopupEl.style.pointerEvents = "none";
  hoverPopupEl.style.padding = "5px 8px";
  hoverPopupEl.style.border = "1px solid rgba(255,255,255,0.18)";
  hoverPopupEl.style.borderRadius = "999px";
  hoverPopupEl.style.background = "rgba(12, 18, 26, 0.92)";
  hoverPopupEl.style.color = "#e6edf3";
  hoverPopupEl.style.font = '11px/1.2 "Segoe UI", sans-serif';
  hoverPopupEl.style.letterSpacing = "0.02em";
  hoverPopupEl.style.whiteSpace = "nowrap";
  hoverPopupEl.style.transform = "translate(-50%, calc(-100% - 12px))";
  hoverPopupEl.style.boxShadow = "0 8px 24px rgba(0,0,0,0.28)";
  hoverPopupEl.style.display = "none";
  (renderer.domElement.parentElement || document.body).appendChild(hoverPopupEl);

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
          deformClass: previousBinding.deformClass || "cloth_follow",
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
      overlay.update(null, false, renderState.puppetSelectedBoneId, hoveredBoneId);
      hideHoverPopup();
      onStateChanged?.();
      return;
    }

    const rig = ensureRig(layerMeshEntries);
    if (!rig) {
      overlay.update(null, false, renderState.puppetSelectedBoneId, hoveredBoneId);
      hideHoverPopup();
      onStateChanged?.();
      return;
    }

    solveRigPose(THREE, rig);
    for (let i = 0; i < layerMeshEntries.length; i += 1) {
      applySkinningToGeometry(THREE, rig, layerMeshEntries[i].mesh.geometry);
    }
    overlay.update(rig, renderState.puppetOverlayVisible, renderState.puppetSelectedBoneId, hoveredBoneId);
    updateHoverPopup();
    onStateChanged?.();
  }

  function hideHoverPopup() {
    hoverPopupEl.style.display = "none";
  }

  function updateHoverPopup() {
    if (!renderState.puppetEnabled || !renderState.puppetOverlayVisible || !renderState.puppetRig || !hoveredBoneId) {
      hideHoverPopup();
      return;
    }
    const bone = renderState.puppetRig.boneMap.get(hoveredBoneId);
    if (!bone) {
      hideHoverPopup();
      return;
    }
    const rect = renderer.domElement.getBoundingClientRect();
    projectedHandle.copy(bone.worldTail).project(camera);
    if (projectedHandle.z < -1 || projectedHandle.z > 1) {
      hideHoverPopup();
      return;
    }
    hoverPopupEl.textContent = hoveredBoneId;
    hoverPopupEl.style.left = `${rect.left + (projectedHandle.x * 0.5 + 0.5) * rect.width}px`;
    hoverPopupEl.style.top = `${rect.top + (-projectedHandle.y * 0.5 + 0.5) * rect.height}px`;
    hoverPopupEl.style.display = "block";
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
      renderState.puppetSelectedBoneId = boneId;
      sync();
    }
    return updated;
  }

  function setBoneTranslation(boneId, translation) {
    if (!renderState.puppetRig) {
      sync();
    }
    if (!renderState.puppetRig) {
      return false;
    }
    const bone = renderState.puppetRig.boneMap.get(boneId);
    if (!bone || bone.lockTranslation) {
      return false;
    }
    bone.poseTranslation.set(
      translation.x ?? bone.poseTranslation.x,
      translation.y ?? bone.poseTranslation.y,
      translation.z ?? bone.poseTranslation.z,
    );
    renderState.puppetSelectedBoneId = boneId;
    renderState.puppetRig.version += 1;
    sync();
    return true;
  }

  function setSelectedBone(boneId) {
    if (boneId && !renderState.puppetRig?.boneMap?.has(boneId)) {
      return false;
    }
    renderState.puppetSelectedBoneId = boneId || null;
    hoveredBoneId = boneId || null;
    sync();
    return true;
  }

  function getSelectedBoneId() {
    return renderState.puppetSelectedBoneId || null;
  }

  function getBoneState(boneId) {
    if (!renderState.puppetRig) {
      return null;
    }
    const bone = renderState.puppetRig.boneMap.get(boneId);
    if (!bone) {
      return null;
    }
    return {
      id: bone.id,
      lockRotation: !!bone.lockRotation,
      lockTranslation: !!bone.lockTranslation,
      poseEuler: {
        x: bone.poseEuler.x,
        y: bone.poseEuler.y,
        z: bone.poseEuler.z,
      },
      poseTranslation: {
        x: bone.poseTranslation.x,
        y: bone.poseTranslation.y,
        z: bone.poseTranslation.z,
      },
      worldHead: {
        x: bone.worldHead.x,
        y: bone.worldHead.y,
        z: bone.worldHead.z,
      },
      worldTail: {
        x: bone.worldTail.x,
        y: bone.worldTail.y,
        z: bone.worldTail.z,
      },
    };
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
    const chains = buildIkChains(renderState.puppetRig, boneId);
    let updated = false;
    if (chains.length) {
      const poseSnapshot = snapshotRigPose(renderState.puppetRig);
      let bestDistance = Number.POSITIVE_INFINITY;
      let bestSnapshot = poseSnapshot;
      for (let i = 0; i < chains.length; i += 1) {
        restoreRigPoseSnapshot(THREE, renderState.puppetRig, poseSnapshot);
        const chainUpdated = solveIkChainToTarget(THREE, renderState.puppetRig, chains[i], target, {
          iterations: 24,
          epsilon: 1e-4,
          acceptDistance: 0.01,
          ignoreStepLimit: true,
        });
        const endBone = renderState.puppetRig.boneMap.get(boneId);
        const distance = endBone ? endBone.worldTail.distanceTo(target) : Number.POSITIVE_INFINITY;
        if (chainUpdated && distance < bestDistance) {
          bestDistance = distance;
          bestSnapshot = snapshotRigPose(renderState.puppetRig);
          updated = true;
        }
      }
      restoreRigPoseSnapshot(THREE, renderState.puppetRig, bestSnapshot);
      if (updated) {
        const endBone = renderState.puppetRig.boneMap.get(boneId);
        if (endBone) {
          const distanceBeforeOrientation = endBone.worldTail.distanceTo(target);
          const poseBeforeOrientation = endBone.poseEuler.clone();
          const desiredDirection = new THREE.Vector3().subVectors(target, endBone.worldHead);
          if (desiredDirection.lengthSq() > 1e-8) {
            const desiredWorldQuaternion = new THREE.Quaternion().setFromUnitVectors(
              new THREE.Vector3(0, 1, 0),
              desiredDirection.normalize(),
            );
            setBoneWorldQuaternion(renderState.puppetRig, boneId, desiredWorldQuaternion, { ignoreStepLimit: true });
            solveRigPose(THREE, renderState.puppetRig);
            if (endBone.worldTail.distanceTo(target) > distanceBeforeOrientation + 1e-6) {
              endBone.poseEuler.copy(poseBeforeOrientation);
              solveRigPose(THREE, renderState.puppetRig);
            }
          }
        }
      }
    } else {
      updated = setBoneWorldTailTargetWithOptions(THREE, renderState.puppetRig, boneId, target, { ignoreStepLimit: true });
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

  function findHandleHit(event) {
    if (!renderState.puppetEnabled || !renderState.puppetOverlayVisible || !renderState.puppetRig) {
      return null;
    }
    const rect = renderer.domElement.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const thresholdPx = 22;
    let best = null;
    let bestDistanceSq = thresholdPx * thresholdPx;
    const handles = overlay.getHandleMeshes();
    for (let i = 0; i < handles.length; i += 1) {
      const handle = handles[i];
      if (!handle.visible) {
        continue;
      }
      projectedHandle.copy(handle.position).project(camera);
      if (projectedHandle.z < -1 || projectedHandle.z > 1) {
        continue;
      }
      const screenX = (projectedHandle.x * 0.5 + 0.5) * rect.width;
      const screenY = (-projectedHandle.y * 0.5 + 0.5) * rect.height;
      const dx = screenX - pointerX;
      const dy = screenY - pointerY;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq <= bestDistanceSq) {
        bestDistanceSq = distanceSq;
        best = handle;
      }
    }
    return best ? { object: best } : null;
  }

  function updateCursor(event) {
    if (!renderState.puppetEnabled || !renderState.puppetOverlayVisible || !renderState.puppetRig) {
      hoveredBoneId = null;
      hideHoverPopup();
      renderer.domElement.style.cursor = "";
      return;
    }
    const hit = findHandleHit(event);
    hoveredBoneId = hit?.object?.userData?.boneId || null;
    updateHoverPopup();
    overlay.update(renderState.puppetRig, renderState.puppetOverlayVisible, renderState.puppetSelectedBoneId, hoveredBoneId);
    renderer.domElement.style.cursor = hit ? "grab" : "";
  }

  function onPointerDown(event) {
    if (renderState.meshEditEnabled) {
      return;
    }
    if (!renderState.puppetEnabled || !renderState.puppetOverlayVisible || !renderState.puppetRig) {
      return;
    }
    if (event.button !== 0 && event.button !== 1) {
      return;
    }
    const hit = findHandleHit(event);
    if (!hit) {
      return;
    }
    draggingBoneId = hit.object.userData.boneId;
    draggingRestEdit = event.button === 1;
    renderState.puppetSelectedBoneId = draggingBoneId;
    hoveredBoneId = draggingBoneId;
    const bone = renderState.puppetRig.boneMap.get(draggingBoneId);
    camera.getWorldDirection(planeNormal);
    dragPlane.setFromNormalAndCoplanarPoint(planeNormal, bone.worldTail);
    controls.enabled = false;
    renderer.domElement.setPointerCapture?.(event.pointerId);
    renderer.domElement.style.cursor = draggingRestEdit ? "move" : "grabbing";
    event.preventDefault();
    sync();
  }

  function onPointerMove(event) {
    if (renderState.meshEditEnabled) {
      hoveredBoneId = null;
      hideHoverPopup();
      renderer.domElement.style.cursor = "";
      return;
    }
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
    updateHoverPopup();
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
      setBoneTranslation,
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
      setSelectedBone,
      reset,
      sync: () => sync(),
      getSelectedBoneId,
      getBoneState,
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
    setBoneTranslation,
    setBoneTargetWorld,
    setBoneRestTargetWorld,
    solveIkTargetWorld,
    setSelectedBone,
    getSelectedBoneId,
    getBoneState,
    setLayerFitEnabled,
    setLayerBindingPrimary,
    setSwapLeftRightMapping,
    attachInteraction,
    getDebugApi,
    dispose: () => overlay.dispose(),
  };
}
