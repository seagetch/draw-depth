function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function setInputValue(input, value, digits = 2) {
  input.value = Number.isFinite(value) ? value.toFixed(digits) : "0.00";
}

export function createPuppetPanel({ elements, puppetRuntime }) {
  const {
    puppetPanelEl,
    puppetBoneSelectEl,
    puppetResetBoneButtonEl,
    puppetTargetXEl,
    puppetTargetYEl,
    puppetTargetZEl,
    puppetRotXEl,
    puppetRotYEl,
    puppetRotZEl,
    puppetRotXValueEl,
    puppetRotYValueEl,
    puppetRotZValueEl,
  } = elements;

  let syncing = false;
  let boneOptionsSignature = "";

  function updateRotationLabels() {
    puppetRotXValueEl.textContent = `${Math.round(Number(puppetRotXEl.value))}deg`;
    puppetRotYValueEl.textContent = `${Math.round(Number(puppetRotYEl.value))}deg`;
    puppetRotZValueEl.textContent = `${Math.round(Number(puppetRotZEl.value))}deg`;
  }

  function ensureBoneOptions() {
    const boneIds = puppetRuntime.getDebugApi().getBoneIds();
    const signature = boneIds.join("|");
    if (signature === boneOptionsSignature) {
      return;
    }
    boneOptionsSignature = signature;
    puppetBoneSelectEl.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select bone";
    puppetBoneSelectEl.appendChild(placeholder);
    for (let i = 0; i < boneIds.length; i += 1) {
      const option = document.createElement("option");
      option.value = boneIds[i];
      option.textContent = boneIds[i];
      puppetBoneSelectEl.appendChild(option);
    }
  }

  function sync() {
    ensureBoneOptions();
    const selectedBoneId = puppetRuntime.getSelectedBoneId();
    const boneState = selectedBoneId ? puppetRuntime.getBoneState(selectedBoneId) : null;
    syncing = true;
    puppetPanelEl.style.display = boneState ? "" : "none";
    puppetBoneSelectEl.value = selectedBoneId || "";
    if (boneState) {
      setInputValue(puppetTargetXEl, boneState.worldTail.x, 3);
      setInputValue(puppetTargetYEl, boneState.worldTail.y, 3);
      setInputValue(puppetTargetZEl, boneState.worldTail.z, 3);
      puppetRotXEl.value = String(Math.round(toDegrees(boneState.poseEuler.x)));
      puppetRotYEl.value = String(Math.round(toDegrees(boneState.poseEuler.y)));
      puppetRotZEl.value = String(Math.round(toDegrees(boneState.poseEuler.z)));
      updateRotationLabels();
      const rotationDisabled = !!boneState.lockRotation;
      const translationDisabled = !!boneState.lockTranslation;
      [puppetRotXEl, puppetRotYEl, puppetRotZEl].forEach((input) => {
        input.disabled = rotationDisabled;
      });
      [puppetTargetXEl, puppetTargetYEl, puppetTargetZEl].forEach((input) => {
        input.disabled = translationDisabled;
      });
      puppetResetBoneButtonEl.disabled = false;
    } else {
      [puppetRotXEl, puppetRotYEl, puppetRotZEl, puppetTargetXEl, puppetTargetYEl, puppetTargetZEl].forEach((input) => {
        input.disabled = true;
      });
      puppetResetBoneButtonEl.disabled = true;
    }
    syncing = false;
  }

  function getSelectedBoneId() {
    return puppetBoneSelectEl.value || puppetRuntime.getSelectedBoneId();
  }

  function applyTargetFromInputs() {
    if (syncing) {
      return;
    }
    const boneId = getSelectedBoneId();
    if (!boneId) {
      return;
    }
    puppetRuntime.solveIkTargetWorld(boneId, {
      x: Number(puppetTargetXEl.value),
      y: Number(puppetTargetYEl.value),
      z: Number(puppetTargetZEl.value),
    });
  }

  function applyRotationFromInputs() {
    if (syncing) {
      return;
    }
    const boneId = getSelectedBoneId();
    if (!boneId) {
      return;
    }
    puppetRuntime.setBonePose(boneId, {
      x: toRadians(Number(puppetRotXEl.value)),
      y: toRadians(Number(puppetRotYEl.value)),
      z: toRadians(Number(puppetRotZEl.value)),
    });
  }

  puppetBoneSelectEl.addEventListener("change", () => {
    if (!puppetBoneSelectEl.value) {
      return;
    }
    puppetRuntime.setSelectedBone(puppetBoneSelectEl.value);
  });
  puppetResetBoneButtonEl.addEventListener("click", () => {
    const boneId = getSelectedBoneId();
    if (!boneId) {
      return;
    }
    puppetRuntime.setBonePose(boneId, { x: 0, y: 0, z: 0 });
    puppetRuntime.setBoneTranslation(boneId, { x: 0, y: 0, z: 0 });
  });
  [puppetTargetXEl, puppetTargetYEl, puppetTargetZEl].forEach((input) => {
    input.addEventListener("change", applyTargetFromInputs);
  });
  [puppetRotXEl, puppetRotYEl, puppetRotZEl].forEach((input) => {
    input.addEventListener("input", () => {
      updateRotationLabels();
      applyRotationFromInputs();
    });
  });

  sync();

  return {
    sync,
  };
}
