import {
  getLayerDepthOffset,
  getLayerDepthScale,
  getLayerOutlierPruneEnabled,
  getLayerPuppetBindingOverride,
  getLayerPuppetFitEnabled,
  getLayerVisible,
  setLayerDepthOffset,
  setLayerDepthScale,
  setLayerOutlierPruneEnabled,
  setLayerPuppetFitEnabled,
  setLayerVisible,
} from "../composite/schema.js";

export function createSegmentPanel(deps) {
  const {
    elements,
    renderState,
    segmentDepthOffsetStep,
    segmentDepthScaleStep,
    buildMesh,
    updateLayerDepthAdjustment,
    refreshStatusCounts,
    updateSegmentMaskTexture,
    updatePsdDebugPanel,
    rebuildLayerEntriesIfNeeded,
    applySegmentDepthAdjustments,
    runUiProgress,
    puppetBoneIds = [],
    setLayerBindingPrimary,
    onError,
  } = deps;

  const { segmentListEl } = elements;

  function hasLayerControls() {
    return renderState.colorComposite?.format === "psd" || (renderState.layerEntries || []).length > 1;
  }

  function getLayerEntries() {
    return renderState.layerEntries || [];
  }

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

  function createGroupControlButton(label, groupTitle) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "segment-button";
    button.textContent = label;
    button.dataset.groupAction = "rig-toggle";
    button.dataset.groupTitle = groupTitle;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      applyGroupPuppetFitToggle(groupTitle);
    });
    return button;
  }

  function syncSegmentCheckboxes() {
    const checkboxes = segmentListEl.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((checkbox) => {
      const index = Number(checkbox.dataset.segmentIndex);
      checkbox.checked = hasLayerControls()
        ? getLayerVisible(renderState, index)
        : renderState.segmentVisibility[index];
    });
  }

  function syncSegmentAdjustmentLabels() {
    const labels = segmentListEl.querySelectorAll("[data-segment-metrics]");
    labels.forEach((label) => {
      const index = Number(label.dataset.segmentMetrics);
      if (hasLayerControls()) {
        label.textContent =
          `o${getLayerDepthOffset(renderState, index)} s${getLayerDepthScale(renderState, index).toFixed(2)}`;
      } else {
        label.textContent =
          `o${renderState.segmentDepthOffsets[index]} s${renderState.segmentDepthScales[index].toFixed(2)}`;
      }
    });

    const puppetLabels = segmentListEl.querySelectorAll("[data-segment-puppet-binding]");
    puppetLabels.forEach((label) => {
      const index = Number(label.dataset.segmentPuppetBinding);
      const binding = renderState.puppetLayerBindings[index];
      if (!binding) {
        label.textContent = "rig:-";
        label.title = "No puppet layer binding";
        return;
      }
      const dominant = (binding.dominantBoneIds || []).slice(0, 3);
      const dominantSummary = dominant.length
        ? dominant.map((item) => `${item.boneId} ${item.weight.toFixed(2)}`).join(", ")
        : "none";
      label.textContent = `rig:${binding.primaryBoneId}`;
      label.title =
        `class=${binding.classification} | deform=${binding.deformClass || "-"} | allowed=${binding.allowedBoneIds.join(", ")} | dominant=${dominantSummary}`;
    });

    const puppetSelects = segmentListEl.querySelectorAll("[data-segment-puppet-primary]");
    puppetSelects.forEach((select) => {
      const index = Number(select.dataset.segmentPuppetPrimary);
      const binding = renderState.puppetLayerBindings[index];
      const override = getLayerPuppetBindingOverride(renderState, index);
      select.value = override?.primaryBoneId || binding?.primaryBoneId || "";
      select.title = override?.primaryBoneId
        ? "Manual puppet binding override"
        : "Auto puppet binding";
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
      const active = getLayerOutlierPruneEnabled(renderState, index);
      button.title = active ? "Disable outlier segment prune" : "Enable outlier segment prune";
      button.style.background = active ? "rgba(255, 200, 120, 0.28)" : "rgba(255, 255, 255, 0.05)";
    });

    const rigButtons = segmentListEl.querySelectorAll('[data-segment-action="rig-toggle"]');
    rigButtons.forEach((button) => {
      const index = Number(button.dataset.segmentIndex);
      const active = getLayerPuppetFitEnabled(renderState, index);
      button.textContent = active ? "R" : "X";
      button.title = active ? "Exclude from puppet fit" : "Include in puppet fit";
      button.style.background = active ? "rgba(100, 210, 140, 0.25)" : "rgba(255, 120, 120, 0.28)";
    });

    const groupRigButtons = segmentListEl.querySelectorAll('[data-group-action="rig-toggle"]');
    groupRigButtons.forEach((button) => {
      const groupTitle = button.dataset.groupTitle || "";
      const groupIndexes = [...segmentListEl.querySelectorAll(`.segment-item[data-group-title="${CSS.escape(groupTitle)}"]`)]
        .map((row) => Number(row.dataset.segmentIndex));
      const enabledCount = groupIndexes.filter((index) => getLayerPuppetFitEnabled(renderState, index)).length;
      const allEnabled = enabledCount === groupIndexes.length;
      const noneEnabled = enabledCount === 0;
      button.textContent = allEnabled ? "R" : (noneEnabled ? "X" : "~");
      button.title = allEnabled
        ? "Exclude whole group from puppet fit"
        : (noneEnabled ? "Include whole group in puppet fit" : "Toggle whole group puppet fit");
      button.style.background = allEnabled
        ? "rgba(100, 210, 140, 0.25)"
        : (noneEnabled ? "rgba(255, 120, 120, 0.28)" : "rgba(255, 210, 120, 0.28)");
    });

    updatePsdDebugPanel();
  }

  function applyGroupPuppetFitToggle(groupTitle) {
    const groupIndexes = [...segmentListEl.querySelectorAll(`.segment-item[data-group-title="${CSS.escape(groupTitle)}"]`)]
      .map((row) => Number(row.dataset.segmentIndex));
    if (!groupIndexes.length) {
      return;
    }
    const shouldEnable = groupIndexes.some((index) => !getLayerPuppetFitEnabled(renderState, index));
    for (let i = 0; i < groupIndexes.length; i += 1) {
      setLayerPuppetFitEnabled(renderState, groupIndexes[i], shouldEnable);
    }
    syncSegmentAdjustmentLabels();
    runPanelProgress("Rebuilding mesh", () => {
      buildMesh();
    });
  }

  function applySegmentToggle(segmentIndex, invertOthers) {
    if (hasLayerControls()) {
      if (invertOthers) {
        const nextTargetState = !getLayerVisible(renderState, segmentIndex);
        getLayerEntries().forEach((_, index) => {
          setLayerVisible(renderState, index, index === segmentIndex ? nextTargetState : !nextTargetState);
        });
      } else {
        setLayerVisible(renderState, segmentIndex, !getLayerVisible(renderState, segmentIndex));
      }

      syncSegmentCheckboxes();
      runPanelProgress("Rebuilding mesh", () => {
        buildMesh();
        refreshStatusCounts();
      });
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
    runPanelProgress("Updating segment visibility", () => {
      updateSegmentMaskTexture();
      refreshStatusCounts();
    });
  }

  function applySegmentDepthAdjustment(action, segmentIndex) {
    if (action === "debug-toggle" && hasLayerControls()) {
      renderState.psdDebugLayerIndex = renderState.psdDebugLayerIndex === segmentIndex ? -1 : segmentIndex;
      syncSegmentAdjustmentLabels();
      runPanelProgress("Rebuilding debug view", () => {
        buildMesh();
      });
      return;
    }

    if (action === "prune-toggle" && hasLayerControls()) {
      setLayerOutlierPruneEnabled(
        renderState,
        segmentIndex,
        !getLayerOutlierPruneEnabled(renderState, segmentIndex),
      );
      syncSegmentAdjustmentLabels();
      runPanelProgress("Rebuilding layers", async () => {
        const reloaded = await rebuildLayerEntriesIfNeeded();
        if (reloaded) {
          rebuildSegmentList();
        }
        buildMesh();
      }).catch(onError);
      return;
    }

    if (action === "rig-toggle" && hasLayerControls()) {
      setLayerPuppetFitEnabled(renderState, segmentIndex, !getLayerPuppetFitEnabled(renderState, segmentIndex));
      syncSegmentAdjustmentLabels();
      runPanelProgress("Rebuilding mesh", () => {
        buildMesh();
      });
      return;
    }

    if (hasLayerControls()) {
      if (action === "offset-down") {
        setLayerDepthOffset(renderState, segmentIndex, getLayerDepthOffset(renderState, segmentIndex) - segmentDepthOffsetStep);
      } else if (action === "offset-up") {
        setLayerDepthOffset(renderState, segmentIndex, getLayerDepthOffset(renderState, segmentIndex) + segmentDepthOffsetStep);
      } else if (action === "scale-down") {
        setLayerDepthScale(
          renderState,
          segmentIndex,
          Math.max(0.1, Number((getLayerDepthScale(renderState, segmentIndex) - segmentDepthScaleStep).toFixed(2))),
        );
      } else if (action === "scale-up") {
        setLayerDepthScale(
          renderState,
          segmentIndex,
          Number((getLayerDepthScale(renderState, segmentIndex) + segmentDepthScaleStep).toFixed(2)),
        );
      }
    } else if (action === "offset-down") {
      renderState.segmentDepthOffsets[segmentIndex] -= segmentDepthOffsetStep;
    } else if (action === "offset-up") {
      renderState.segmentDepthOffsets[segmentIndex] += segmentDepthOffsetStep;
    } else if (action === "scale-down") {
      renderState.segmentDepthScales[segmentIndex] = Math.max(0.1, Number((renderState.segmentDepthScales[segmentIndex] - segmentDepthScaleStep).toFixed(2)));
    } else if (action === "scale-up") {
      renderState.segmentDepthScales[segmentIndex] = Number((renderState.segmentDepthScales[segmentIndex] + segmentDepthScaleStep).toFixed(2));
    }

    syncSegmentAdjustmentLabels();
    if (hasLayerControls() && ["offset-down", "offset-up", "scale-down", "scale-up"].includes(action)) {
      if (typeof updateLayerDepthAdjustment === "function") {
        runPanelProgress("Updating layer depth", () => {
          updateLayerDepthAdjustment(segmentIndex);
        });
      } else {
        runPanelProgress("Rebuilding mesh", () => {
          buildMesh();
        });
      }
      return;
    }
    if (!hasLayerControls()) {
      runPanelProgress("Rebuilding segment depth", () => {
        applySegmentDepthAdjustments();
        buildMesh();
      });
      return;
    }
    runPanelProgress("Rebuilding mesh", () => {
      buildMesh();
    });
  }

  function runPanelProgress(label, task) {
    if (typeof runUiProgress === "function") {
      return runUiProgress(label, task).catch(onError);
    }
    try {
      return Promise.resolve(task());
    } catch (error) {
      onError?.(error);
      return Promise.resolve(null);
    }
  }

  function rebuildSegmentList() {
    segmentListEl.textContent = "";

    if (hasLayerControls()) {
      const groups = groupPsdLayerEntries(getLayerEntries());
      groups.forEach((group) => {
        const groupEl = document.createElement("div");
        groupEl.className = "segment-group";

        if (group.title) {
          const titleEl = document.createElement("div");
          titleEl.className = "segment-group-title";
          const titleLabel = document.createElement("span");
          titleLabel.textContent = group.title;
          const groupRigButton = createGroupControlButton("R", group.title);
          titleEl.append(titleLabel, groupRigButton);
          groupEl.appendChild(titleEl);
        }

        group.items.forEach(({ layer, index, label }) => {
          const row = document.createElement("div");
          row.className = "segment-item";
          row.dataset.segmentIndex = String(index);
          row.dataset.groupTitle = group.title;

          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = getLayerVisible(renderState, index);
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
          const rigButton = createSegmentControlButton("R", "rig-toggle", index);
          const offsetDown = createSegmentControlButton("-", "offset-down", index);
          const offsetUp = createSegmentControlButton("+", "offset-up", index);
          const scaleDown = createSegmentControlButton("<", "scale-down", index);
          const scaleUp = createSegmentControlButton(">", "scale-up", index);
          const metrics = document.createElement("span");
          metrics.className = "segment-metrics";
          metrics.dataset.segmentMetrics = String(index);
          const puppetBinding = document.createElement("span");
          puppetBinding.className = "segment-metrics";
          puppetBinding.dataset.segmentPuppetBinding = String(index);
          const puppetSelect = document.createElement("select");
          puppetSelect.className = "segment-select";
          puppetSelect.dataset.segmentPuppetPrimary = String(index);
          const autoOption = document.createElement("option");
          autoOption.value = "";
          autoOption.textContent = "auto";
          puppetSelect.appendChild(autoOption);
          puppetBoneIds.forEach((boneId) => {
            const option = document.createElement("option");
            option.value = boneId;
            option.textContent = boneId;
            puppetSelect.appendChild(option);
          });
          puppetSelect.addEventListener("click", (event) => {
            event.stopPropagation();
          });
          puppetSelect.addEventListener("change", (event) => {
            event.stopPropagation();
            setLayerBindingPrimary?.(index, event.currentTarget.value || null);
            syncSegmentAdjustmentLabels();
          });

          controls.append(debugButton, pruneButton, rigButton, offsetDown, offsetUp, scaleDown, scaleUp, metrics, puppetBinding, puppetSelect);
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
