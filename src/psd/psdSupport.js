export function initializePsdSupport(agPsd = globalThis.agPsd) {
  if (typeof agPsd === "undefined" || typeof agPsd.initializeCanvas !== "function") {
    return;
  }

  agPsd.initializeCanvas((width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  });
}
