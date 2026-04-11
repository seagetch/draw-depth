function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function cloneMeshEditHandlesByTarget(handlesByTarget) {
  const clone = {};
  const entries = Object.entries(handlesByTarget || {});
  for (let i = 0; i < entries.length; i += 1) {
    const [key, handles] = entries[i];
    clone[key] = (handles || []).map((handle) => ({
      id: handle.id,
      u: handle.u,
      v: handle.v,
      radius: handle.radius,
      offset: {
        x: handle.offset?.x || 0,
        y: handle.offset?.y || 0,
        z: handle.offset?.z || 0,
      },
    }));
  }
  return clone;
}

export function ensureEditableRestGeometry(geometry) {
  const positionAttribute = geometry.getAttribute("position");
  if (!positionAttribute) {
    return false;
  }
  if (!geometry.userData.baseRestPositions) {
    geometry.userData.baseRestPositions = positionAttribute.array.slice();
  }
  if (!geometry.userData.restPositions) {
    geometry.userData.restPositions = positionAttribute.array.slice();
  }
  return true;
}

export function applyHandleDeformToGeometry(geometry, handles) {
  const positionAttribute = geometry.getAttribute("position");
  const uvAttribute = geometry.getAttribute("uv");
  if (!positionAttribute || !uvAttribute) {
    return false;
  }

  ensureEditableRestGeometry(geometry);
  const baseRestPositions = geometry.userData.baseRestPositions;
  const restPositions = geometry.userData.restPositions;
  const positions = positionAttribute.array;
  restPositions.set(baseRestPositions);

  if (handles?.length) {
    for (let vertexIndex = 0; vertexIndex < positionAttribute.count; vertexIndex += 1) {
      const u = uvAttribute.array[vertexIndex * 2];
      const v = uvAttribute.array[vertexIndex * 2 + 1];
      let dx = 0;
      let dy = 0;
      let dz = 0;

      for (let handleIndex = 0; handleIndex < handles.length; handleIndex += 1) {
        const handle = handles[handleIndex];
        const du = u - handle.u;
        const dv = v - handle.v;
        const distance = Math.sqrt(du * du + dv * dv);
        if (distance > handle.radius) {
          continue;
        }
        const weight = 1 - smoothstep(0, handle.radius, distance);
        dx += (handle.offset?.x || 0) * weight;
        dy += (handle.offset?.y || 0) * weight;
        dz += (handle.offset?.z || 0) * weight;
      }

      const positionOffset = vertexIndex * 3;
      restPositions[positionOffset] += dx;
      restPositions[positionOffset + 1] += dy;
      restPositions[positionOffset + 2] += dz;
    }
  }

  positions.set(restPositions);
  positionAttribute.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return true;
}

export function findClosestVertexForUv(geometry, u, v, out = { x: 0, y: 0, z: 0 }, useBaseRest = false) {
  const positionAttribute = geometry.getAttribute("position");
  const uvAttribute = geometry.getAttribute("uv");
  if (!positionAttribute || !uvAttribute || !positionAttribute.count) {
    return null;
  }

  const restPositions = useBaseRest
    ? (geometry.userData.baseRestPositions || positionAttribute.array)
    : (geometry.userData.restPositions || positionAttribute.array);
  let bestIndex = 0;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (let vertexIndex = 0; vertexIndex < positionAttribute.count; vertexIndex += 1) {
    const du = uvAttribute.array[vertexIndex * 2] - u;
    const dv = uvAttribute.array[vertexIndex * 2 + 1] - v;
    const distanceSq = du * du + dv * dv;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestIndex = vertexIndex;
    }
  }

  out.x = restPositions[bestIndex * 3];
  out.y = restPositions[bestIndex * 3 + 1];
  out.z = restPositions[bestIndex * 3 + 2];
  return out;
}
