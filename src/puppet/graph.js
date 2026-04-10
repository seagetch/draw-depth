function neighborOffsets() {
  return [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],           [1, 0],
    [-1, 1],  [0, 1],  [1, 1],
  ];
}

function gatherNeighbors(mask, width, height, x, y) {
  const neighbors = [];
  const offsets = neighborOffsets();
  for (let i = 0; i < offsets.length; i += 1) {
    const sx = x + offsets[i][0];
    const sy = y + offsets[i][1];
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
      continue;
    }
    if (mask[sy * width + sx]) {
      neighbors.push({ x: sx, y: sy, index: sy * width + sx });
    }
  }
  return neighbors;
}

function keyFor(x, y) {
  return `${x},${y}`;
}

export function buildSkeletonGraph(mask, width, height) {
  const important = new Map();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index]) {
        continue;
      }
      const neighbors = gatherNeighbors(mask, width, height, x, y);
      if (neighbors.length !== 2) {
        important.set(keyFor(x, y), {
          id: keyFor(x, y),
          x,
          y,
          index,
          neighbors: [],
          degree: neighbors.length,
        });
      }
    }
  }

  const edges = [];
  const visited = new Set();
  const nodes = Array.from(important.values());

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const directNeighbors = gatherNeighbors(mask, width, height, node.x, node.y);
    for (let n = 0; n < directNeighbors.length; n += 1) {
      const startNeighbor = directNeighbors[n];
      const edgeKey = `${node.id}->${startNeighbor.index}`;
      if (visited.has(edgeKey)) {
        continue;
      }
      let prevX = node.x;
      let prevY = node.y;
      let currentX = startNeighbor.x;
      let currentY = startNeighbor.y;
      const points = [{ x: node.x, y: node.y }, { x: currentX, y: currentY }];

      while (!important.has(keyFor(currentX, currentY))) {
        const neighbors = gatherNeighbors(mask, width, height, currentX, currentY);
        let next = null;
        for (let k = 0; k < neighbors.length; k += 1) {
          if (neighbors[k].x === prevX && neighbors[k].y === prevY) {
            continue;
          }
          next = neighbors[k];
          break;
        }
        if (!next) {
          break;
        }
        prevX = currentX;
        prevY = currentY;
        currentX = next.x;
        currentY = next.y;
        points.push({ x: currentX, y: currentY });
      }

      const targetKey = keyFor(currentX, currentY);
      if (!important.has(targetKey) || targetKey === node.id) {
        continue;
      }
      const pairKey = [node.id, targetKey].sort().join("|");
      if (visited.has(pairKey)) {
        continue;
      }
      visited.add(pairKey);
      const edge = {
        id: pairKey,
        from: node.id,
        to: targetKey,
        points,
        length: points.length,
      };
      edges.push(edge);
      important.get(node.id).neighbors.push({ nodeId: targetKey, edge });
      important.get(targetKey).neighbors.push({ nodeId: node.id, edge: { ...edge, points: points.slice().reverse() } });
    }
  }

  return {
    nodes: Array.from(important.values()),
    nodeMap: important,
    edges,
  };
}

export function findClosestNode(graph, x, y, predicate = null) {
  let best = null;
  let bestDistance = Infinity;
  for (let i = 0; i < graph.nodes.length; i += 1) {
    const node = graph.nodes[i];
    if (predicate && !predicate(node)) {
      continue;
    }
    const dx = node.x - x;
    const dy = node.y - y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = node;
    }
  }
  return best;
}

export function findGraphPath(graph, startId, endId) {
  const queue = [startId];
  const prev = new Map([[startId, null]]);
  while (queue.length) {
    const nodeId = queue.shift();
    if (nodeId === endId) {
      break;
    }
    const node = graph.nodeMap.get(nodeId);
    for (let i = 0; i < node.neighbors.length; i += 1) {
      const nextId = node.neighbors[i].nodeId;
      if (prev.has(nextId)) {
        continue;
      }
      prev.set(nextId, nodeId);
      queue.push(nextId);
    }
  }
  if (!prev.has(endId)) {
    return [];
  }
  const path = [];
  for (let current = endId; current != null; current = prev.get(current)) {
    path.push(current);
  }
  path.reverse();
  return path;
}

export function collectPathPoints(graph, nodePath) {
  if (!nodePath.length) {
    return [];
  }
  const points = [];
  for (let i = 0; i < nodePath.length - 1; i += 1) {
    const node = graph.nodeMap.get(nodePath[i]);
    const nextId = nodePath[i + 1];
    const edgeRef = node.neighbors.find((entry) => entry.nodeId === nextId);
    if (!edgeRef) {
      continue;
    }
    if (!points.length) {
      points.push(...edgeRef.edge.points);
    } else {
      points.push(...edgeRef.edge.points.slice(1));
    }
  }
  if (!points.length) {
    const node = graph.nodeMap.get(nodePath[0]);
    if (node) {
      points.push({ x: node.x, y: node.y });
    }
  }
  return points;
}
