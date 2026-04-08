export function revokeObjectUrl(renderState, kind) {
  if (kind === "color" && renderState.colorObjectUrl) {
    URL.revokeObjectURL(renderState.colorObjectUrl);
    renderState.colorObjectUrl = null;
  }

  if (kind === "depth" && renderState.depthObjectUrl) {
    URL.revokeObjectURL(renderState.depthObjectUrl);
    renderState.depthObjectUrl = null;
  }

  if (kind === "segment" && renderState.segmentObjectUrl) {
    URL.revokeObjectURL(renderState.segmentObjectUrl);
    renderState.segmentObjectUrl = null;
  }
}
