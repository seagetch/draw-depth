const GENERATED_MESH_DEBUG_VERSION = "20260412_9";
const GENERATED_MESH_MANIFEST_URL = `./generated/midori-full-meshes/manifest.json?v=${GENERATED_MESH_DEBUG_VERSION}`;

function encodeRelativeUrlPath(path) {
  return String(path || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export async function loadGeneratedMeshDebugData(fetchImpl = fetch) {
  const manifestResponse = await fetchImpl(GENERATED_MESH_MANIFEST_URL);
  if (!manifestResponse.ok) {
    throw new Error(`Failed to load generated mesh manifest: ${manifestResponse.status}`);
  }

  const manifest = await manifestResponse.json();
  const layersByIndex = [];
  const layerResponses = await Promise.all(
    (manifest.layers || []).map(async (entry) => {
      const response = await fetchImpl(
        `./generated/midori-full-meshes/${encodeRelativeUrlPath(entry.path)}?v=${GENERATED_MESH_DEBUG_VERSION}`,
      );
      if (!response.ok) {
        throw new Error(`Failed to load generated mesh layer: ${entry.path}`);
      }
      const layer = await response.json();
      layersByIndex[entry.index] = layer;
      return [entry.name, layer];
    }),
  );

  return {
    manifest,
    layersByIndex,
    layersByName: new Map(layerResponses),
  };
}
