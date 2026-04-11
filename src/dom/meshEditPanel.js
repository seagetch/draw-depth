function ensureOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

export function createMeshEditPanel({ elements, renderState, meshEditRuntime }) {
  const {
    meshEditPanelEl,
    meshEditEnabledEl,
    meshEditAddModeEl,
    meshEditTargetEl,
    meshEditRadiusEl,
    meshEditRadiusValueEl,
    meshEditUndoButtonEl,
    meshEditRedoButtonEl,
    meshEditResetButtonEl,
  } = elements;

  function syncTargetOptions() {
    const previous = renderState.meshEditTargetKey || "raster:base";
    meshEditTargetEl.replaceChildren();
    ensureOption(meshEditTargetEl, "raster:base", "Raster mesh");
    const layers = renderState.psdLayerEntries || [];
    for (let i = 0; i < layers.length; i += 1) {
      ensureOption(meshEditTargetEl, `psd:${i}`, `PSD: ${layers[i].name || `Layer ${i + 1}`}`);
    }
    let hasPrevious = false;
    for (let i = 0; i < meshEditTargetEl.options.length; i += 1) {
      if (meshEditTargetEl.options[i].value === previous) {
        hasPrevious = true;
        break;
      }
    }
    const nextValue = hasPrevious ? previous : "raster:base";
    meshEditTargetEl.value = nextValue;
    renderState.meshEditTargetKey = nextValue;
  }

  function sync() {
    syncTargetOptions();
    meshEditPanelEl.style.display = "";
    meshEditEnabledEl.checked = !!renderState.meshEditEnabled;
    meshEditAddModeEl.checked = !!renderState.meshEditAddMode;
    meshEditTargetEl.value = renderState.meshEditTargetKey || "raster:base";
    const selectedHandle = meshEditRuntime.getSelectedHandle();
    const radius = selectedHandle?.radius ?? Number(meshEditRadiusEl.value);
    meshEditRadiusEl.value = String(radius);
    meshEditRadiusValueEl.textContent = Number(radius).toFixed(2);
    meshEditRadiusEl.disabled = !selectedHandle;
    meshEditUndoButtonEl.disabled = renderState.meshEditHistoryIndex <= 0;
    meshEditRedoButtonEl.disabled = renderState.meshEditHistoryIndex >= renderState.meshEditHistory.length - 1;
    meshEditResetButtonEl.disabled = !(renderState.meshEditHandlesByTarget?.[renderState.meshEditTargetKey]?.length);
  }

  meshEditEnabledEl.addEventListener("change", () => {
    meshEditRuntime.setEnabled(meshEditEnabledEl.checked);
  });
  meshEditAddModeEl.addEventListener("change", () => {
    meshEditRuntime.setAddMode(meshEditAddModeEl.checked);
  });
  meshEditTargetEl.addEventListener("change", () => {
    meshEditRuntime.setTarget(meshEditTargetEl.value);
  });
  meshEditRadiusEl.addEventListener("input", () => {
    meshEditRadiusValueEl.textContent = Number(meshEditRadiusEl.value).toFixed(2);
    meshEditRuntime.setSelectedHandleRadius(Number(meshEditRadiusEl.value));
  });
  meshEditUndoButtonEl.addEventListener("click", () => {
    meshEditRuntime.undo();
  });
  meshEditRedoButtonEl.addEventListener("click", () => {
    meshEditRuntime.redo();
  });
  meshEditResetButtonEl.addEventListener("click", () => {
    meshEditRuntime.resetTarget(meshEditTargetEl.value);
  });

  sync();

  return { sync };
}
