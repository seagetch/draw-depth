import {
  applyHandleDeformToGeometry,
  cloneMeshEditHandlesByTarget,
  findClosestVertexForUv,
} from "./deform.js";
import { createMeshEditOverlay } from "./overlay.js";

function deepEqualHandles(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

export function createMeshEditRuntime({
  THREE,
  scene,
  camera,
  controls,
  renderer,
  renderState,
  onStateChanged,
  onGeometryChanged,
}) {
  const overlay = createMeshEditOverlay(THREE, scene);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const dragPoint = new THREE.Vector3();
  const dragOrigin = new THREE.Vector3();
  const dragOffsetStart = new THREE.Vector3();
  const planeNormal = new THREE.Vector3();
  const anchorPosition = new THREE.Vector3();
  let interactionAttached = false;
  let activeEntries = [];
  let draggingHandleId = null;
  let draggingTargetKey = null;
  let dragChanged = false;
  let geometryChangedCallback = onGeometryChanged || null;
  let altPressed = false;

  function isAddHandleGesture(event) {
    return !!(event.altKey
      || event.getModifierState?.("Alt")
      || altPressed);
  }

  function getTargetKey(entry) {
    return entry?.targetKey || null;
  }

  function snapshotHistory() {
    return cloneMeshEditHandlesByTarget(renderState.meshEditHandlesByTarget);
  }

  function pushHistorySnapshot() {
    const snapshot = snapshotHistory();
    const current = renderState.meshEditHistory[renderState.meshEditHistoryIndex];
    if (deepEqualHandles(current, snapshot)) {
      return;
    }
    renderState.meshEditHistory = renderState.meshEditHistory.slice(0, renderState.meshEditHistoryIndex + 1);
    renderState.meshEditHistory.push(snapshot);
    renderState.meshEditHistoryIndex = renderState.meshEditHistory.length - 1;
  }

  function ensureHistoryInitialized() {
    if (renderState.meshEditHistory.length) {
      return;
    }
    renderState.meshEditHistory = [snapshotHistory()];
    renderState.meshEditHistoryIndex = 0;
  }

  function applyHistorySnapshot(snapshot) {
    renderState.meshEditHandlesByTarget = cloneMeshEditHandlesByTarget(snapshot || {});
    renderState.meshEditSelection = null;
    geometryChangedCallback?.();
    sync(activeEntries);
  }

  function getPointerNdc(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    return pointer;
  }

  function getHandlesForTarget(targetKey) {
    if (!renderState.meshEditHandlesByTarget[targetKey]) {
      renderState.meshEditHandlesByTarget[targetKey] = [];
    }
    return renderState.meshEditHandlesByTarget[targetKey];
  }

  function findEntryForTarget(targetKey) {
    for (let i = 0; i < activeEntries.length; i += 1) {
      if (activeEntries[i].targetKey === targetKey) {
        return activeEntries[i];
      }
    }
    return null;
  }

  function findHandle(targetKey, handleId) {
    const handles = getHandlesForTarget(targetKey);
    for (let i = 0; i < handles.length; i += 1) {
      if (handles[i].id === handleId) {
        return handles[i];
      }
    }
    return null;
  }

  function computeHandleWorldPosition(entry, handle, out = new THREE.Vector3()) {
    if (!entry?.mesh?.geometry || !handle) {
      return null;
    }
    const anchor = findClosestVertexForUv(entry.mesh.geometry, handle.u, handle.v, undefined, true);
    if (!anchor) {
      return null;
    }
    out.set(
      anchor.x + (handle.offset?.x || 0),
      anchor.y + (handle.offset?.y || 0),
      anchor.z + (handle.offset?.z || 0),
    );
    return out;
  }

  function buildOverlayHandles() {
    const entry = findEntryForTarget(renderState.meshEditTargetKey);
    if (!entry) {
      return [];
    }
    const handles = getHandlesForTarget(renderState.meshEditTargetKey);
    const visibleHandles = [];
    for (let i = 0; i < handles.length; i += 1) {
      const position = computeHandleWorldPosition(entry, handles[i], new THREE.Vector3());
      if (!position) {
        continue;
      }
      visibleHandles.push({
        id: handles[i].id,
        position,
      });
    }
    return visibleHandles;
  }

  function updateOverlay() {
    overlay.update(
      buildOverlayHandles(),
      renderState.meshEditSelection,
      !!renderState.meshEditEnabled && !!renderState.meshEditOverlayVisible,
    );
  }

  function sync(entries = activeEntries) {
    activeEntries = entries || [];
    updateOverlay();
    onStateChanged?.();
  }

  function applyToEntry(entry) {
    if (!entry?.mesh?.geometry) {
      return;
    }
    applyHandleDeformToGeometry(
      entry.mesh.geometry,
      renderState.meshEditHandlesByTarget?.[entry.targetKey] || [],
    );
  }

  function applyToEntries(entries) {
    const targets = entries || activeEntries;
    for (let i = 0; i < targets.length; i += 1) {
      applyToEntry(targets[i]);
    }
  }

  function syncAfterMutation() {
    geometryChangedCallback?.();
    sync(activeEntries);
  }

  function findMeshHit(event) {
    if (!renderState.meshEditEnabled) {
      return null;
    }
    const meshes = activeEntries
      .map((entry) => entry?.mesh)
      .filter(Boolean);
    if (!meshes.length) {
      return null;
    }
    raycaster.setFromCamera(getPointerNdc(event), camera);
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) {
      return null;
    }
    const hit = hits[0];
    const targetKey = hit.object?.userData?.targetKey || null;
    return targetKey ? { ...hit, targetKey } : null;
  }

  function findHandleHit(event) {
    if (!renderState.meshEditEnabled || !renderState.meshEditOverlayVisible) {
      return null;
    }
    const rect = renderer.domElement.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const thresholdPx = 20;
    let best = null;
    let bestDistanceSq = thresholdPx * thresholdPx;
    const handles = overlay.getHandleMeshes();
    for (let i = 0; i < handles.length; i += 1) {
      const handleMesh = handles[i];
      if (!handleMesh.visible) {
        continue;
      }
      anchorPosition.copy(handleMesh.position).project(camera);
      if (anchorPosition.z < -1 || anchorPosition.z > 1) {
        continue;
      }
      const screenX = (anchorPosition.x * 0.5 + 0.5) * rect.width;
      const screenY = (-anchorPosition.y * 0.5 + 0.5) * rect.height;
      const dx = screenX - pointerX;
      const dy = screenY - pointerY;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq <= bestDistanceSq) {
        bestDistanceSq = distanceSq;
        best = handleMesh;
      }
    }
    return best;
  }

  function setSelectedHandle(handleId) {
    renderState.meshEditSelection = handleId || null;
    sync(activeEntries);
  }

  function getSelectedHandle() {
    const targetKey = renderState.meshEditTargetKey;
    return targetKey && renderState.meshEditSelection
      ? findHandle(targetKey, renderState.meshEditSelection)
      : null;
  }

  function addHandleFromHit(hit) {
    if (!hit?.uv || !hit?.targetKey) {
      return false;
    }
    ensureHistoryInitialized();
    renderState.meshEditTargetKey = hit.targetKey;
    const handles = getHandlesForTarget(hit.targetKey);
    const handle = {
      id: `mh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      u: hit.uv.x,
      v: hit.uv.y,
      radius: 0.18,
      offset: { x: 0, y: 0, z: 0 },
    };
    handles.push(handle);
    renderState.meshEditSelection = handle.id;
    pushHistorySnapshot();
    syncAfterMutation();
    return true;
  }

  function removeSelectedHandle() {
    const targetKey = renderState.meshEditTargetKey;
    const handleId = renderState.meshEditSelection;
    if (!targetKey || !handleId) {
      return false;
    }
    const handles = getHandlesForTarget(targetKey);
    const nextHandles = handles.filter((handle) => handle.id !== handleId);
    if (nextHandles.length === handles.length) {
      return false;
    }
    ensureHistoryInitialized();
    renderState.meshEditHandlesByTarget[targetKey] = nextHandles;
    renderState.meshEditSelection = null;
    pushHistorySnapshot();
    syncAfterMutation();
    return true;
  }

  function setSelectedHandleRadius(radius) {
    const handle = getSelectedHandle();
    if (!handle) {
      return false;
    }
    handle.radius = Math.max(0.03, Math.min(0.8, radius));
    syncAfterMutation();
    return true;
  }

  function resetTarget(targetKey) {
    ensureHistoryInitialized();
    renderState.meshEditHandlesByTarget[targetKey] = [];
    if (renderState.meshEditTargetKey === targetKey) {
      renderState.meshEditSelection = null;
    }
    pushHistorySnapshot();
    syncAfterMutation();
  }

  function setEnabled(enabled) {
    renderState.meshEditEnabled = !!enabled;
    renderer.domElement.style.cursor = "";
    sync(activeEntries);
  }

  function setAddMode(enabled) {
    renderState.meshEditAddMode = !!enabled;
    renderer.domElement.style.cursor = renderState.meshEditEnabled
      ? (renderState.meshEditAddMode ? "copy" : "crosshair")
      : "";
    sync(activeEntries);
  }

  function setTarget(targetKey) {
    renderState.meshEditTargetKey = targetKey || "raster:base";
    renderState.meshEditSelection = null;
    sync(activeEntries);
  }

  function undo() {
    if (renderState.meshEditHistoryIndex <= 0) {
      return false;
    }
    renderState.meshEditHistoryIndex -= 1;
    applyHistorySnapshot(renderState.meshEditHistory[renderState.meshEditHistoryIndex]);
    return true;
  }

  function redo() {
    if (renderState.meshEditHistoryIndex >= renderState.meshEditHistory.length - 1) {
      return false;
    }
    renderState.meshEditHistoryIndex += 1;
    applyHistorySnapshot(renderState.meshEditHistory[renderState.meshEditHistoryIndex]);
    return true;
  }

  function onPointerDown(event) {
    if (!renderState.meshEditEnabled || event.button !== 0) {
      return;
    }

    const handleHit = findHandleHit(event);
    if (handleHit) {
      draggingHandleId = handleHit.userData.handleId;
      draggingTargetKey = renderState.meshEditTargetKey;
      renderState.meshEditSelection = draggingHandleId;
      const entry = findEntryForTarget(draggingTargetKey);
      const handle = findHandle(draggingTargetKey, draggingHandleId);
      if (!entry || !handle) {
        return;
      }
      computeHandleWorldPosition(entry, handle, anchorPosition);
      dragOrigin.copy(anchorPosition);
      dragOffsetStart.set(handle.offset?.x || 0, handle.offset?.y || 0, handle.offset?.z || 0);
      camera.getWorldDirection(planeNormal);
      dragPlane.setFromNormalAndCoplanarPoint(planeNormal, anchorPosition);
      dragChanged = false;
      controls.enabled = false;
      renderer.domElement.setPointerCapture?.(event.pointerId);
      renderer.domElement.style.cursor = "grabbing";
      event.preventDefault();
      sync(activeEntries);
      return;
    }

    if (renderState.meshEditAddMode || isAddHandleGesture(event)) {
      const meshHit = findMeshHit(event);
      if (meshHit && addHandleFromHit(meshHit)) {
        event.preventDefault();
      }
      return;
    }

    const meshHit = findMeshHit(event);
    if (!meshHit) {
      setSelectedHandle(null);
      return;
    }
    renderState.meshEditTargetKey = meshHit.targetKey;
    renderState.meshEditSelection = null;
    sync(activeEntries);
  }

  function onPointerMove(event) {
    if (!draggingHandleId) {
      const handleHit = findHandleHit(event);
      renderer.domElement.style.cursor = handleHit
        ? "grab"
        : (renderState.meshEditEnabled ? (renderState.meshEditAddMode ? "copy" : "crosshair") : "");
      return;
    }

    raycaster.setFromCamera(getPointerNdc(event), camera);
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
      return;
    }

    const handle = findHandle(draggingTargetKey, draggingHandleId);
    if (!handle) {
      return;
    }
    handle.offset.x = dragOffsetStart.x + (dragPoint.x - dragOrigin.x);
    handle.offset.y = dragOffsetStart.y + (dragPoint.y - dragOrigin.y);
    handle.offset.z = dragOffsetStart.z + (event.shiftKey ? (dragPoint.y - dragOrigin.y) : (dragPoint.z - dragOrigin.z));
    if (event.shiftKey) {
      handle.offset.x = dragOffsetStart.x;
      handle.offset.y = dragOffsetStart.y;
    }
    dragChanged = true;
    syncAfterMutation();
  }

  function onPointerUp(event) {
    if (event?.pointerId != null) {
      renderer.domElement.releasePointerCapture?.(event.pointerId);
    }
    if (draggingHandleId && dragChanged) {
      ensureHistoryInitialized();
      pushHistorySnapshot();
    }
    draggingHandleId = null;
    draggingTargetKey = null;
    dragChanged = false;
    controls.enabled = true;
    renderer.domElement.style.cursor = renderState.meshEditEnabled ? (renderState.meshEditAddMode ? "copy" : "crosshair") : "";
    sync(activeEntries);
  }

  function onKeyDown(event) {
    if (event.key === "Alt") {
      altPressed = true;
    }
    if (!renderState.meshEditEnabled) {
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && removeSelectedHandle()) {
      event.preventDefault();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
      if (undo()) {
        event.preventDefault();
      }
      return;
    }
    if (((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "z")
      || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y")) {
      if (redo()) {
        event.preventDefault();
      }
    }
  }

  function onKeyUp(event) {
    if (event.key === "Alt") {
      altPressed = false;
    }
  }

  function onWindowBlur() {
    altPressed = false;
  }

  function attachInteraction() {
    if (interactionAttached) {
      return;
    }
    interactionAttached = true;
    ensureHistoryInitialized();
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
  }

  return {
    applyToEntries,
    sync,
    attachInteraction,
    setEnabled,
    setAddMode,
    setTarget,
    setSelectedHandle,
    getSelectedHandle,
    setSelectedHandleRadius,
    resetTarget,
    undo,
    redo,
    setOnGeometryChanged(callback) {
      geometryChangedCallback = callback || null;
    },
    dispose: () => overlay.dispose(),
  };
}
