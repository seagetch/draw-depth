export function createSegmentPanel(deps) {
  const {
    elements,
    renderState,
    segmentDepthOffsetStep,
    segmentDepthScaleStep,
    buildMesh,
    refreshStatusCounts,
    updateSegmentMaskTexture,
    updatePsdDebugPanel,
    rebuildPsdLayerEntriesIfNeeded,
    applySegmentDepthAdjustments,
    onError,
  } = deps;

  const { segmentListEl } = elements;

  function groupPsdLayerEntries(layers) {
    const groups = [];
    const groupMap = new Map();

    layers.forEach((layer, index) => {
      const fullName = layer.name || `Layer ${index + 1}`;
      const separatorIndex = fullName.indexOf("::");
      const groupKey = separatorIndex >= 0 ? fullName.slice(0, separatorIndex) : "";
      const label = separatorIndex >= 0 ? fullName.slice(separatorIndex + 2) || fullName : fullName;

      let group = groupMap.get(groupKey);
      if (!group) {
        group = { title: groupKey, items: [] };
        groupMap.set(groupKey, group);
        groups.push(group);
      }

      group.items.push({ layer, index, label });
    });

    return groups;
  }

  function createSegmentControlButton(label, action, segmentIndex) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "segment-button";
    button.textContent = label;
    button.dataset.segmentAction = action;
    button.dataset.segmentIndex = String(segmentIndex);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      applySegmentDepthAdjustment(action, segmentIndex);
    });
    return button;
  }

  function syncSegmentCheckboxes() {
    const checkboxes = segmentListEl.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((checkbox) => {
      const index = Number(checkbox.dataset.segmentIndex);
      checkbox.checked = renderState.sourceMode === "psd"
        ? renderState.psdLayerVisibility[index]
        : renderState.segmentVisibility[index];
    });
  }

  function syncSegmentAdjustmentLabels() {
    const labels = segmentListEl.querySelectorAll("[data-segment-metrics]");
    labels.forEach((label) => {
      const index = Number(label.dataset.segmentMetrics);
      if (renderState.sourceMode === "psd") {
        label.textContent =
          `o${renderState.psdLayerDepthOffsets[index]} s${renderState.psdLayerDepthScales[index].toFixed(2)}`;
      } else {
        label.textContent =
          `o${renderState.segmentDepthOffsets[index]} s${renderState.segmentDepthScales[index].toFixed(2)}`;
      }
    });

    const debugButtons = segmentListEl.querySelectorAll('[data-segment-action="debug-toggle"]');
    debugButtons.forEach((button) => {
      const index = Number(button.dataset.segmentIndex);
      const active = renderState.psdDebugLayerIndex === index;
      button.textContent = active ? "H" : "D";
      button.title = active ? "Hide debug evidence" : "Show debug evidence";
      button.style.background = active ? "rgba(255, 120, 120, 0.28)" : "rgba(255, 255, 255, 0.05)";
    });

    const pruneButtons = segmentListEl.querySelectorAll('[data-segment-action="prune-toggle"]');
    pruneButtons.forEach((button) => {
      const index = Number(button.dataset.segmentIndex);
      const active = !!renderState.psdLayerOutlierPruneEnabled[index];
      button.title = active ? "Disable outlier segment prune" : "Enable outlier segment prune";
      button.style.background = active ? "rgba(255, 200, 120, 0.28)" : "rgba(255, 255, 255, 0.05)";
    });

    updatePsdDebugPanel();
  }

  function applySegmentToggle(segmentIndex, invertOthers) {
    if (renderState.sourceMode === "psd") {
      if (invertOthers) {
        const nextTargetState = !renderState.psdLayerVisibility[segmentIndex];
        renderState.psdLayerVisibility = renderState.psdLayerVisibility.map((_, index) => (
          index === segmentIndex ? nextTargetState : !nextTargetState
        ));
      } else {
        renderState.psdLayerVisibility[segmentIndex] = !renderState.psdLayerVisibility[segmentIndex];
      }

      syncSegmentCheckboxes();
      buildMesh();
      refreshStatusCounts();
      return;
    }

    if (invertOthers) {
      const nextTargetState = !renderState.segmentVisibility[segmentIndex];
      renderState.segmentVisibility = renderState.segmentVisibility.map((_, index) => (
        index === segmentIndex ? nextTargetState : !nextTargetState
      ));
    } else {
      renderState.segmentVisibility[segmentIndex] = !renderState.segmentVisibility[segmentIndex];
    }

    syncSegmentCheckboxes();
    updateSegmentMaskTexture();
    refreshStatusCounts();
  }

  function applySegmentDepthAdjustment(action, segmentIndex) {
    if (action === "debug-toggle" && renderState.sourceMode === "psd") {
      renderState.psdDebugLayerIndex = renderState.psdDebugLayerIndex === segmentIndex ? -1 : segmentIndex;
      syncSegmentAdjustmentLabels();
      buildMesh();
      return;
    }

    if (action === "prune-toggle" && renderState.sourceMode === "psd") {
      renderState.psdLayerOutlierPruneEnabled[segmentIndex] = !renderState.psdLayerOutlierPruneEnabled[segmentIndex];
      syncSegmentAdjustmentLabels();
      rebuildPsdLayerEntriesIfNeeded().then((reloaded) => {
        if (reloaded) {
          rebuildSegmentList();
        }
        buildMesh();
      }).catch(onError);
      return;
    }

    const offsets = renderState.sourceMode === "psd"
      ? renderState.psdLayerDepthOffsets
      : renderState.segmentDepthOffsets;
    const scales = renderState.sourceMode === "psd"
      ? renderState.psdLayerDepthScales
      : renderState.segmentDepthScales;

    if (action === "offset-down") {
      offsets[segmentIndex] -= segmentDepthOffsetStep;
    } else if (action === "offset-up") {
      offsets[segmentIndex] += segmentDepthOffsetStep;
    } else if (action === "scale-down") {
      scales[segmentIndex] = Math.max(0.1, Number((scales[segmentIndex] - segmentDepthScaleStep).toFixed(2)));
    } else if (action === "scale-up") {
      scales[segmentIndex] = Number((scales[segmentIndex] + segmentDepthScaleStep).toFixed(2));
    }

    syncSegmentAdjustmentLabels();
    if (renderState.sourceMode !== "psd") {
      applySegmentDepthAdjustments();
    }
    buildMesh();
  }

  function rebuildSegmentList() {
    segmentListEl.textContent = "";

    if (renderState.sourceMode === "psd") {
      const groups = groupPsdLayerEntries(renderState.psdLayerEntries);
      groups.forEach((group) => {
        const groupEl = document.createElement("div");
        groupEl.className = "segment-group";

        if (group.title) {
          const titleEl = document.createElement("div");
          titleEl.className = "segment-group-title";
          titleEl.textContent = group.title;
          groupEl.appendChild(titleEl);
        }

        group.items.forEach(({ layer, index, label }) => {
          const row = document.createElement("div");
          row.className = "segment-item";
          row.dataset.segmentIndex = String(index);

          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = renderState.psdLayerVisibility[index];
          checkbox.dataset.segmentIndex = String(index);
          checkbox.tabIndex = -1;
          checkbox.style.pointerEvents = "none";

          row.addEventListener("click", (event) => {
            applySegmentToggle(Number(row.dataset.segmentIndex), event.shiftKey);
          });

          const swatch = document.createElement("span");
          swatch.className = "segment-swatch";
          swatch.style.backgroundColor = "#d0d7de";

          const name = document.createElement("span");
          name.className = "segment-name";
          name.textContent = label;

          const size = document.createElement("span");
          size.className = "segment-size";
          size.textContent = `${layer.width}x${layer.height}`;

          const controls = document.createElement("div");
          controls.className = "segment-controls";

          const debugButton = createSegmentControlButton("D", "debug-toggle", index);
          const pruneButton = createSegmentControlButton("P", "prune-toggle", index);
          const offsetDown = createSegmentControlButton("-", "offset-down", index);
          const offsetUp = createSegmentControlButton("+", "offset-up", index);
          const scaleDown = createSegmentControlButton("<", "scale-down", index);
          const scaleUp = createSegmentControlButton(">", "scale-up", index);
          const metrics = document.createElement("span");
          metrics.className = "segment-metrics";
          metrics.dataset.segmentMetrics = String(index);

          controls.append(debugButton, pruneButton, offsetDown, offsetUp, scaleDown, scaleUp, metrics);
          row.append(checkbox, swatch, name, size, controls);
          groupEl.appendChild(row);
        });

        segmentListEl.appendChild(groupEl);
      });

      syncSegmentAdjustmentLabels();
      syncSegmentCheckboxes();
      return;
    }

    renderState.segmentPalette.forEach((color, index) => {
      const row = document.createElement("div");
      row.className = "segment-item";
      row.dataset.segmentIndex = String(index);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.dataset.segmentIndex = String(index);
      checkbox.tabIndex = -1;
      checkbox.style.pointerEvents = "none";

      row.addEventListener("click", (event) => {
        applySegmentToggle(Number(row.dataset.segmentIndex), event.shiftKey);
      });

      const swatch = document.createElement("span");
      swatch.className = "segment-swatch";
      swatch.style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;

      const name = document.createElement("span");
      name.className = "segment-name";
      name.textContent = `Part ${index + 1}`;

      const size = document.createElement("span");
      size.className = "segment-size";
      size.textContent = renderState.segmentPixelCounts[index].toLocaleString();

      const controls = document.createElement("div");
      controls.className = "segment-controls";

      const offsetDown = createSegmentControlButton("-", "offset-down", index);
      const offsetUp = createSegmentControlButton("+", "offset-up", index);
      const scaleDown = createSegmentControlButton("<", "scale-down", index);
      const scaleUp = createSegmentControlButton(">", "scale-up", index);
      const metrics = document.createElement("span");
      metrics.className = "segment-metrics";
      metrics.dataset.segmentMetrics = String(index);

      controls.append(offsetDown, offsetUp, scaleDown, scaleUp, metrics);
      row.append(checkbox, swatch, name, size, controls);
      segmentListEl.appendChild(row);
    });

    syncSegmentAdjustmentLabels();
  }

  return {
    rebuildSegmentList,
    syncSegmentCheckboxes,
    syncSegmentAdjustmentLabels,
    applySegmentDepthAdjustment,
  };
}
