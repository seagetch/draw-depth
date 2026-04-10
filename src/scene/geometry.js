export function createGeometryHelpers(deps) {
  const {
    THREE,
    invalidDepthThreshold,
    relativeDepthFactor,
    relativeDepthFloor,
    elements,
    renderState,
    createDepthTextureResources,
  } = deps
  const { depthDiscontinuityEl, contourRepairEl } = elements

  function buildMaskedPlaneGeometry(width, height, depthPixels, segmentMap, segmentDepthMeans, gapMask, step, options = {}) {
    const cols = Math.floor((width - 1) / step) + 1;
    const rows = Math.floor((height - 1) / step) + 1;
    const positions = new Float32Array(cols * rows * 3);
    const uvs = new Float32Array(cols * rows * 2);
    const vertexValid = new Uint8Array(cols * rows);
    const vertexGroup = new Int32Array(cols * rows);
    vertexGroup.fill(-1);
    const aspect = width / height;
    const halfWidth = aspect * 0.5;
    const halfHeight = 0.5;
  
    let p = 0;
    let t = 0;
  
    for (let y = 0; y < rows; y += 1) {
      const py = Math.min(y * step, height - 1);
      const v = py / (height - 1);
      const sy = THREE.MathUtils.lerp(halfHeight, -halfHeight, v);
  
      for (let x = 0; x < cols; x += 1) {
        const px = Math.min(x * step, width - 1);
        const u = px / (width - 1);
        const sx = THREE.MathUtils.lerp(-halfWidth, halfWidth, u);
        const index = y * cols + x;
  
        positions[p++] = sx;
        positions[p++] = sy;
        positions[p++] = options.bakeDepth
          ? getDepthDisplacementFromByte(depthPixels[py * width + px], options.depthScale, options.invertDepth)
          : 0;
  
        uvs[t++] = u;
        uvs[t++] = 1 - v;
  
        vertexValid[index] = isValidDepth(depthPixels, width, px, py) && !gapMask[py * width + px] ? 1 : 0;
        if (vertexValid[index]) {
          vertexGroup[index] = getSegmentIndex(segmentMap, width, px, py);
        }
      }
    }
  
    if (options.bakeDepth && options.surfaceSmooth) {
      smoothGridVertexPositions(
        positions,
        vertexValid,
        vertexGroup,
        cols,
        rows,
        3,
        Number(depthDiscontinuityEl.value),
        options.depthScale,
      );
    }
  
    const indices = [];
  
    for (let y = 0; y < rows - 1; y += 1) {
      for (let x = 0; x < cols - 1; x += 1) {
        const x0 = Math.min(x * step, width - 1);
        const x1 = Math.min((x + 1) * step, width - 1);
        const y0 = Math.min(y * step, height - 1);
        const y1 = Math.min((y + 1) * step, height - 1);
  
        const a = y * cols + x;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
  
        if (!vertexValid[a] || !vertexValid[b] || !vertexValid[c] || !vertexValid[d]) {
          continue;
        }
  
        const segmentA = getSegmentIndex(segmentMap, width, x0, y0);
        const segmentB = getSegmentIndex(segmentMap, width, x1, y0);
        const segmentC = getSegmentIndex(segmentMap, width, x0, y1);
        const segmentD = getSegmentIndex(segmentMap, width, x1, y1);
        const depthA = depthPixels[y0 * width + x0];
        const depthB = depthPixels[y0 * width + x1];
        const depthC = depthPixels[y1 * width + x0];
        const depthD = depthPixels[y1 * width + x1];
  
        if (
          segmentA < 0 ||
          segmentB < 0 ||
          segmentC < 0 ||
          segmentD < 0 ||
          segmentA !== segmentB ||
          segmentA !== segmentC ||
          segmentA !== segmentD
        ) {
          continue;
        }
  
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }
  
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
  
    return geometry;
  }
  
  function buildRenderedBoundaryPointGeometry(width, height, depthPixels, segmentMap, gapMask, step) {
    const cols = Math.floor((width - 1) / step) + 1;
    const rows = Math.floor((height - 1) / step) + 1;
    const aspect = width / height;
    const halfWidth = aspect * 0.5;
    const halfHeight = 0.5;
    const vertexValid = new Uint8Array(cols * rows);
    let pointCount = 0;
  
    for (let gy = 0; gy < rows; gy += 1) {
      const py = Math.min(gy * step, height - 1);
      for (let gx = 0; gx < cols; gx += 1) {
        const px = Math.min(gx * step, width - 1);
        const index = gy * cols + gx;
        vertexValid[index] = isValidDepth(depthPixels, width, px, py) && !gapMask[py * width + px] ? 1 : 0;
      }
    }
  
    for (let gy = 0; gy < rows; gy += 1) {
      for (let gx = 0; gx < cols; gx += 1) {
        if (!isRenderedBoundaryVertex(gx, gy, cols, rows, width, height, step, segmentMap, vertexValid)) {
          continue;
        }
        pointCount += 1;
      }
    }
  
    const positions = new Float32Array(pointCount * 3);
    const uvs = new Float32Array(pointCount * 2);
    let p = 0;
    let t = 0;
  
    for (let gy = 0; gy < rows; gy += 1) {
      const py = Math.min(gy * step, height - 1);
      const v = py / (height - 1);
      const sy = THREE.MathUtils.lerp(halfHeight, -halfHeight, v);
  
      for (let gx = 0; gx < cols; gx += 1) {
        if (!isRenderedBoundaryVertex(gx, gy, cols, rows, width, height, step, segmentMap, vertexValid)) {
          continue;
        }
  
        const px = Math.min(gx * step, width - 1);
        const u = px / (width - 1);
        const sx = THREE.MathUtils.lerp(-halfWidth, halfWidth, u);
  
        positions[p++] = sx;
        positions[p++] = sy;
        positions[p++] = 0;
  
        uvs[t++] = u;
        uvs[t++] = 1 - v;
      }
    }
  
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    return geometry;
  }
  
  function isRenderedBoundaryVertex(gridX, gridY, cols, rows, width, height, step, segmentMap, vertexValid) {
    const vertexIndex = gridY * cols + gridX;
    if (!vertexValid[vertexIndex]) {
      return false;
    }
  
    const px = Math.min(gridX * step, width - 1);
    const py = Math.min(gridY * step, height - 1);
    const segmentIndex = segmentMap[py * width + px];
    if (segmentIndex < 0) {
      return false;
    }
  
    const offsets = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
  
    for (let i = 0; i < offsets.length; i += 1) {
      const [dx, dy] = offsets[i];
      const ngx = gridX + dx;
      const ngy = gridY + dy;
      if (ngx < 0 || ngx >= cols || ngy < 0 || ngy >= rows) {
        return true;
      }
  
      const neighborVertexIndex = ngy * cols + ngx;
      if (!vertexValid[neighborVertexIndex]) {
        return true;
      }
  
      const npx = Math.min(ngx * step, width - 1);
      const npy = Math.min(ngy * step, height - 1);
      if (segmentMap[npy * width + npx] !== segmentIndex) {
        return true;
      }
    }
  
    return false;
  }
  
  function buildPsdLayerGeometry(imageWidth, imageHeight, layer, step, options = {}) {
    const cols = Math.floor((layer.width - 1) / step) + 1;
    const rows = Math.floor((layer.height - 1) / step) + 1;
    const positions = new Float32Array(cols * rows * 3);
    const uvs = new Float32Array(cols * rows * 2);
    const vertexValid = new Uint8Array(cols * rows);
    const vertexGroup = new Int32Array(cols * rows);
    vertexGroup.fill(-1);
    const indices = [];
    const aspect = imageWidth / imageHeight;
    const halfWidth = aspect * 0.5;
    const halfHeight = 0.5;
    let p = 0;
    let t = 0;
  
    for (let y = 0; y < rows; y += 1) {
      const py = Math.min(y * step, layer.height - 1);
      const imageY = layer.top + py;
      const v = (py + 0.5) / Math.max(1, layer.height);
      const globalV = imageY / Math.max(1, imageHeight - 1);
      const sy = THREE.MathUtils.lerp(halfHeight, -halfHeight, globalV);
  
      for (let x = 0; x < cols; x += 1) {
        const px = Math.min(x * step, layer.width - 1);
        const imageX = layer.left + px;
        const u = (px + 0.5) / Math.max(1, layer.width);
        const globalU = imageX / Math.max(1, imageWidth - 1);
        const sx = THREE.MathUtils.lerp(-halfWidth, halfWidth, globalU);
        const localIndex = py * layer.width + px;
  
        positions[p++] = sx;
        positions[p++] = sy;
        positions[p++] = options.bakeDepth
          ? getDepthDisplacementFromByte(layer.depthPixels[localIndex], options.depthScale, options.invertDepth)
          : 0;
        uvs[t++] = u;
        uvs[t++] = 1 - v;
        vertexValid[y * cols + x] = layer.renderDepthMask
          ? layer.renderDepthMask[localIndex]
          : (layer.maskPixels && layer.depthPixels
            ? (layer.maskPixels[localIndex] && layer.depthPixels[localIndex] > 0 ? 1 : 0)
            : 1)
        ;
        if (vertexValid[y * cols + x]) {
          vertexGroup[y * cols + x] = 0;
        }
      }
    }
  
    if (options.bakeDepth && options.surfaceSmooth) {
      smoothGridVertexPositions(
        positions,
        vertexValid,
        vertexGroup,
        cols,
        rows,
        3,
        Number(depthDiscontinuityEl.value),
        options.depthScale,
      );
    }
  
    for (let y = 0; y < rows - 1; y += 1) {
      for (let x = 0; x < cols - 1; x += 1) {
        const a = y * cols + x;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        if (!vertexValid[a] || !vertexValid[b] || !vertexValid[c] || !vertexValid[d]) {
          continue;
        }
        if (!psdCellHasOnlyValidDepth(layer, x, y, step)) {
          continue;
        }
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }
  
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.userData.restPositions = positions.slice();
    return geometry;
  }
  
  function psdCellHasOnlyValidDepth(layer, gridX, gridY, step) {
    if (layer.renderDepthMask) {
      const minX = Math.min(gridX * step, layer.width - 1);
      const minY = Math.min(gridY * step, layer.height - 1);
      const maxX = Math.min((gridX + 1) * step, layer.width - 1);
      const maxY = Math.min((gridY + 1) * step, layer.height - 1);
  
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const index = y * layer.width + x;
          if (!layer.renderDepthMask[index]) {
            return false;
          }
        }
      }
  
      return true;
    }
  
    if (!layer.maskPixels || !layer.depthPixels) {
      return true;
    }
  
    const minX = Math.min(gridX * step, layer.width - 1);
    const minY = Math.min(gridY * step, layer.height - 1);
    const maxX = Math.min((gridX + 1) * step, layer.width - 1);
    const maxY = Math.min((gridY + 1) * step, layer.height - 1);
  
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const index = y * layer.width + x;
        if (!layer.maskPixels[index] || layer.depthPixels[index] <= 0) {
          return false;
        }
      }
    }
  
    return true;
  }
  
  function isSegmentContourPixel(segmentMap, width, height, index) {
    const segmentIndex = segmentMap[index];
    if (segmentIndex < 0) {
      return false;
    }
  
    const x = index % width;
    const y = Math.floor(index / width);
    const offsets = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
  
    for (let i = 0; i < offsets.length; i += 1) {
      const [dx, dy] = offsets[i];
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
        return true;
      }
  
      if (segmentMap[sy * width + sx] !== segmentIndex) {
        return true;
      }
    }
  
    return false;
  }
  
  function isValidDepth(depthPixels, width, x, y) {
    return depthPixels[y * width + x] > 0;
  }
  
  function getDepthDisplacementFromByte(depthByte, depthScale, invertDepth) {
    if (depthByte <= 0) {
      return 0;
    }
    const rawDepth = depthByte / 255;
    const depthValue = invertDepth ? 1 - rawDepth : rawDepth;
    return depthValue * depthScale;
  }
  
  function smoothGridVertexPositions(positions, vertexValid, vertexGroup, cols, rows, passes, depthThreshold, depthScale) {
    let input = new Float32Array(positions);
    const smoothFlags = new Uint8Array(cols * rows);
    const edgeThresholdZ = Math.max(0.0001, (depthThreshold / 255) * Math.max(depthScale || 1, 0.0001));
    for (let gy = 0; gy < rows; gy += 1) {
      for (let gx = 0; gx < cols; gx += 1) {
        const vertexIndex = gy * cols + gx;
        if (vertexValid[vertexIndex]) {
          smoothFlags[vertexIndex] = isGridSmoothEdgeVertex(
            positions,
            gx,
            gy,
            cols,
            rows,
            vertexValid,
            vertexGroup,
            edgeThresholdZ,
          ) ? 1 : 0;
        }
      }
    }
  
    expandGridSmoothFlags(smoothFlags, cols, rows, vertexValid, vertexGroup, 2);
  
    input = taubinSmoothGridDepths(input, smoothFlags, vertexValid, vertexGroup, cols, rows, passes * 2, 0.62, -0.64);
  
    positions.set(input);
  }
  
  function isGridSmoothEdgeVertex(positions, gridX, gridY, cols, rows, vertexValid, vertexGroup, edgeThresholdZ) {
    if (isGridSmoothBoundaryVertex(gridX, gridY, cols, rows, vertexValid, vertexGroup)) {
      return true;
    }
  
    return hasGridLocalDepthEdge(
      positions,
      gridX,
      gridY,
      cols,
      rows,
      vertexValid,
      vertexGroup,
      edgeThresholdZ,
    );
  }
  
  function isGridSmoothBoundaryVertex(gridX, gridY, cols, rows, vertexValid, vertexGroup) {
    const vertexIndex = gridY * cols + gridX;
    const group = vertexGroup[vertexIndex];
    const offsets = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
  
    for (let i = 0; i < offsets.length; i += 1) {
      const [dx, dy] = offsets[i];
      const sx = gridX + dx;
      const sy = gridY + dy;
      if (sx < 0 || sx >= cols || sy < 0 || sy >= rows) {
        return true;
      }
      const sampleVertex = sy * cols + sx;
      if (!vertexValid[sampleVertex] || vertexGroup[sampleVertex] !== group) {
        return true;
      }
    }
  
    return false;
  }
  
  function hasGridLocalDepthEdge(positions, gridX, gridY, cols, rows, vertexValid, vertexGroup, edgeThresholdZ) {
    const vertexIndex = gridY * cols + gridX;
    const group = vertexGroup[vertexIndex];
    let minZ = positions[vertexIndex * 3 + 2];
    let maxZ = minZ;
    let count = 0;
  
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const sx = gridX + dx;
        const sy = gridY + dy;
        if (sx < 0 || sx >= cols || sy < 0 || sy >= rows) {
          continue;
        }
        const sampleVertex = sy * cols + sx;
        if (!vertexValid[sampleVertex] || vertexGroup[sampleVertex] !== group) {
          continue;
        }
        const z = positions[sampleVertex * 3 + 2];
        if (z < minZ) {
          minZ = z;
        }
        if (z > maxZ) {
          maxZ = z;
        }
        count += 1;
      }
    }
  
    return count >= 3 && (maxZ - minZ) >= edgeThresholdZ;
  }
  
  function expandGridSmoothFlags(smoothFlags, cols, rows, vertexValid, vertexGroup, passes) {
    for (let pass = 0; pass < passes; pass += 1) {
      const expanded = new Uint8Array(smoothFlags);
      for (let gy = 0; gy < rows; gy += 1) {
        for (let gx = 0; gx < cols; gx += 1) {
          const vertexIndex = gy * cols + gx;
          if (!vertexValid[vertexIndex] || smoothFlags[vertexIndex]) {
            continue;
          }
          const group = vertexGroup[vertexIndex];
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (dx === 0 && dy === 0) {
                continue;
              }
              const sx = gx + dx;
              const sy = gy + dy;
              if (sx < 0 || sx >= cols || sy < 0 || sy >= rows) {
                continue;
              }
              const sampleVertex = sy * cols + sx;
              if (vertexValid[sampleVertex] && vertexGroup[sampleVertex] === group && smoothFlags[sampleVertex]) {
                expanded[vertexIndex] = 1;
                dx = 2;
                dy = 2;
              }
            }
          }
        }
      }
      smoothFlags.set(expanded);
    }
  }
  
  function taubinSmoothGridDepths(positions, smoothFlags, vertexValid, vertexGroup, cols, rows, passes, lambda, mu) {
    let input = new Float32Array(positions);
    for (let pass = 0; pass < passes; pass += 1) {
      input = applyGridLaplacianPass(
        input,
        smoothFlags,
        vertexValid,
        vertexGroup,
        cols,
        rows,
        pass % 2 === 0 ? lambda : mu,
      );
    }
    return input;
  }
  
  function applyGridLaplacianPass(positions, smoothFlags, vertexValid, vertexGroup, cols, rows, factor) {
    const output = new Float32Array(positions);
    for (let gy = 0; gy < rows; gy += 1) {
      for (let gx = 0; gx < cols; gx += 1) {
        const vertexIndex = gy * cols + gx;
        if (!vertexValid[vertexIndex] || !smoothFlags[vertexIndex]) {
          continue;
        }
  
        const group = vertexGroup[vertexIndex];
        let weightedSum = 0;
        let weightTotal = 0;
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }
            const sx = gx + dx;
            const sy = gy + dy;
            if (sx < 0 || sx >= cols || sy < 0 || sy >= rows) {
              continue;
            }
            const sampleVertex = sy * cols + sx;
            if (!vertexValid[sampleVertex] || vertexGroup[sampleVertex] !== group) {
              continue;
            }
            const distance = Math.hypot(dx, dy);
            if (distance <= 0 || distance > 2.5) {
              continue;
            }
            const weight = 1 / distance;
            weightedSum += positions[sampleVertex * 3 + 2] * weight;
            weightTotal += weight;
          }
        }
  
        if (weightTotal <= 0) {
          continue;
        }
  
        const averageZ = weightedSum / weightTotal;
        const currentZ = positions[vertexIndex * 3 + 2];
        output[vertexIndex * 3 + 2] = currentZ + factor * (averageZ - currentZ);
      }
    }
  
    return output;
  }
  
  function getSegmentIndex(segmentMap, width, x, y) {
    return segmentMap[y * width + x];
  }
  
  function computeSegmentDepthMeans(depthPixels, segmentMap, segmentCount) {
    const sums = new Float32Array(segmentCount);
    const counts = new Uint32Array(segmentCount);
  
    for (let index = 0; index < depthPixels.length; index += 1) {
      const segmentIndex = segmentMap[index];
      const depth = depthPixels[index];
      if (segmentIndex < 0 || depth <= 0) {
        continue;
      }
      sums[segmentIndex] += depth;
      counts[segmentIndex] += 1;
    }
  
    const means = new Float32Array(segmentCount);
    for (let i = 0; i < segmentCount; i += 1) {
      means[i] = counts[i] > 0 ? sums[i] / counts[i] : 0;
    }
    return means;
  }
  
  function repairDepthDiscontinuities(sourcePixels, segmentMap, segmentDepthMeans, width, height, threshold) {
    let contourAligned = sourcePixels;
    if (contourRepairEl.checked) {
      const contourBandMask = buildSegmentContourBandMask(segmentMap, width, height, 2);
      const contourFilled = inpaintSegmentDepthGaps(
        sourcePixels,
        segmentMap,
        segmentDepthMeans,
        width,
        height,
        contourBandMask,
      );
      contourAligned = alignContourDepthsToInterior(
        contourFilled,
        segmentMap,
        width,
        height,
        threshold,
      );
    }
    const repairedMeans = computeSegmentDepthMeans(
      contourAligned,
      segmentMap,
      segmentDepthMeans.length,
    );
    const edgeMask = detectSegmentDepthEdges(
      contourAligned,
      segmentMap,
      repairedMeans,
      width,
      height,
      threshold,
    );
    const gapMask = detectSegmentDiscontinuityGaps(
      contourAligned,
      segmentMap,
      repairedMeans,
      width,
      height,
      threshold,
    );
    const inpainted = inpaintSegmentDepthGaps(
      contourAligned,
      segmentMap,
      repairedMeans,
      width,
      height,
      gapMask,
    );
  
    const resources = createDepthTextureResources(width, height, inpainted);
    return {
      ...resources,
      edgeMask,
      gapMask,
    };
  }
  
  function buildSegmentContourBandMask(segmentMap, width, height, passes) {
    const contourMask = new Uint8Array(segmentMap.length);
    const mask = new Uint8Array(segmentMap.length);
  
    for (let index = 0; index < segmentMap.length; index += 1) {
      if (isSegmentContourPixel(segmentMap, width, height, index)) {
        contourMask[index] = 1;
      }
    }
  
    mask.set(contourMask);
    expandGapMaskWithinSegment(mask, segmentMap, width, height, passes);
  
    for (let index = 0; index < mask.length; index += 1) {
      if (contourMask[index]) {
        mask[index] = 0;
      }
    }
  
    return mask;
  }
  
  function alignContourDepthsToInterior(sourcePixels, segmentMap, width, height, threshold) {
    const aligned = sourcePixels.slice();
  
    for (let index = 0; index < aligned.length; index += 1) {
      if (!isSegmentContourPixel(segmentMap, width, height, index) || aligned[index] <= 0) {
        continue;
      }
  
      const segmentIndex = segmentMap[index];
      if (segmentIndex < 0) {
        continue;
      }
  
      const interiorDepths = collectSegmentInteriorRayDepths(
        aligned,
        segmentMap,
        width,
        height,
        index,
        segmentIndex,
        6,
      );
      if (interiorDepths.length < 3) {
        continue;
      }
  
      interiorDepths.sort((a, b) => a - b);
      const median = interiorDepths[(interiorDepths.length - 1) >> 1];
      const deviations = interiorDepths.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
      const mad = deviations[(deviations.length - 1) >> 1];
      const localThreshold = Math.max(2, threshold * 0.28, mad * 1.35 + 1);
      const depthDelta = aligned[index] - median;
  
      if (Math.abs(depthDelta) > localThreshold) {
        aligned[index] = median;
      }
    }
  
    return aligned;
  }
  
  function detectSegmentDepthEdges(sourcePixels, segmentMap, segmentDepthMeans, width, height, threshold) {
    const edgeMask = new Uint8Array(sourcePixels.length);
    const offsets = [
      [1, 0],
      [0, 1],
      [1, 1],
      [-1, 1],
      [2, 0],
      [0, 2],
    ];
    const edgeThreshold = Math.max(2, threshold * 0.55);
  
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const depth = sourcePixels[index];
        const segmentIndex = segmentMap[index];
        if (depth <= 0 || segmentIndex < 0) {
          continue;
        }
  
        const mean = segmentDepthMeans[segmentIndex];
        for (let i = 0; i < offsets.length; i += 1) {
          const [dx, dy] = offsets[i];
          const sx = x + dx;
          const sy = y + dy;
          if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
            continue;
          }
  
          const sampleIndex = sy * width + sx;
          if (segmentMap[sampleIndex] !== segmentIndex) {
            continue;
          }
  
          const sampleDepth = sourcePixels[sampleIndex];
          if (sampleDepth <= 0) {
            continue;
          }
  
          if (!depthDifferenceWithinThreshold(depth, sampleDepth, edgeThreshold, mean, mean)) {
            edgeMask[index] = 1;
            edgeMask[sampleIndex] = 1;
          }
        }
      }
    }
  
    return edgeMask;
  }
  
  function detectSegmentDiscontinuityGaps(sourcePixels, segmentMap, segmentDepthMeans, width, height, threshold) {
    const gapMask = new Uint8Array(sourcePixels.length);
    const visited = new Uint8Array(sourcePixels.length);
    const linkThreshold = Math.max(2, threshold * 0.55);
  
    for (let segmentIndex = 0; segmentIndex < renderState.segmentPixels.length; segmentIndex += 1) {
      const segmentPixels = renderState.segmentPixels[segmentIndex];
      if (!segmentPixels || segmentPixels.length === 0) {
        continue;
      }
  
      markContourDepthOutliers(
        gapMask,
        sourcePixels,
        segmentMap,
        width,
        height,
        segmentIndex,
        segmentPixels,
        threshold,
      );
  
      const components = collectSegmentDepthComponents(
        sourcePixels,
        segmentMap,
        segmentDepthMeans,
        width,
        height,
        segmentIndex,
        segmentPixels,
        visited,
        linkThreshold,
      );
  
      if (components.length <= 1) {
        continue;
      }
  
      const stats = computeSegmentAdjustedDepthStats(
        sourcePixels,
        segmentDepthMeans[segmentIndex],
        segmentPixels,
      );
      const targetAdjustedDepth = stats.median;
      const targetThreshold = Math.max(4, threshold * 0.65, stats.mad * 2 + 2);
  
      let dominant = components[0];
      let dominantScore = Number.POSITIVE_INFINITY;
      for (let i = 0; i < components.length; i += 1) {
        const component = components[i];
        const distance = Math.abs(component.adjustedMean - targetAdjustedDepth);
        const score = distance - component.size * 0.002;
        if (score < dominantScore) {
          dominantScore = score;
          dominant = component;
        }
      }
  
      for (let i = 0; i < components.length; i += 1) {
        const component = components[i];
        if (component === dominant) {
          continue;
        }
  
        const adjustedDistance = Math.abs(component.adjustedMean - targetAdjustedDepth);
        const isSmall = component.size <= Math.max(8, dominant.size * 0.35);
        const isFar = adjustedDistance > targetThreshold;
  
        if (!isSmall && !isFar) {
          continue;
        }
  
        for (let j = 0; j < component.indices.length; j += 1) {
          gapMask[component.indices[j]] = 1;
        }
      }
    }
  
    expandGapMaskWithinSegment(gapMask, segmentMap, width, height, 1);
    return gapMask;
  }
  
  function markContourDepthOutliers(gapMask, sourcePixels, segmentMap, width, height, segmentIndex, segmentPixels, threshold) {
    for (let i = 0; i < segmentPixels.length; i += 1) {
      const index = segmentPixels[i];
      const depth = sourcePixels[index];
      if (depth <= 0 || !isSegmentContourPixel(segmentMap, width, height, index)) {
        continue;
      }
  
      const interiorDepths = collectSegmentInteriorRayDepths(
        sourcePixels,
        segmentMap,
        width,
        height,
        index,
        segmentIndex,
        6,
      );
  
      if (interiorDepths.length < 3) {
        continue;
      }
  
      interiorDepths.sort((a, b) => a - b);
      const median = interiorDepths[(interiorDepths.length - 1) >> 1];
      const deviations = interiorDepths.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
      const mad = deviations[(deviations.length - 1) >> 1];
      const localThreshold = Math.max(3, threshold * 0.45, mad * 1.75 + 1.5);
  
      if (depth - median > localThreshold) {
        gapMask[index] = 1;
      }
    }
  }
  
  function collectSegmentInteriorRayDepths(sourcePixels, segmentMap, width, height, centerIndex, segmentIndex, radius) {
    const x = centerIndex % width;
    const y = Math.floor(centerIndex / width);
    const values = [];
    const inwardDirections = [];
    const cardinalOffsets = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
  
    for (let i = 0; i < cardinalOffsets.length; i += 1) {
      const [dx, dy] = cardinalOffsets[i];
      const outsideX = x + dx;
      const outsideY = y + dy;
      if (
        outsideX >= 0 &&
        outsideX < width &&
        outsideY >= 0 &&
        outsideY < height &&
        segmentMap[outsideY * width + outsideX] === segmentIndex
      ) {
        continue;
      }
  
      const insideX = x - dx;
      const insideY = y - dy;
      if (
        insideX < 0 ||
        insideX >= width ||
        insideY < 0 ||
        insideY >= height
      ) {
        continue;
      }
  
      if (segmentMap[insideY * width + insideX] === segmentIndex) {
        inwardDirections.push([-dx, -dy]);
      }
    }
  
    if (inwardDirections.length === 0) {
      for (let i = 0; i < cardinalOffsets.length; i += 1) {
        const [dx, dy] = cardinalOffsets[i];
        const sx = x + dx;
        const sy = y + dy;
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
          continue;
        }
        if (segmentMap[sy * width + sx] === segmentIndex) {
          inwardDirections.push([dx, dy]);
        }
      }
    }
  
    if (inwardDirections.length === 0) {
      return values;
    }
  
    for (let i = 0; i < inwardDirections.length; i += 1) {
      const [dx, dy] = inwardDirections[i];
      let collectedOnRay = 0;
      for (let step = 1; step <= radius; step += 1) {
        const sx = x + dx * step;
        const sy = y + dy * step;
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
          break;
        }
  
        const sampleIndex = sy * width + sx;
        if (segmentMap[sampleIndex] !== segmentIndex) {
          break;
        }
        if (isSegmentContourPixel(segmentMap, width, height, sampleIndex)) {
          continue;
        }
  
        const sampleDepth = sourcePixels[sampleIndex];
        if (sampleDepth <= 0) {
          continue;
        }
  
        values.push(sampleDepth);
        collectedOnRay += 1;
        if (collectedOnRay >= 3) {
          break;
        }
      }
    }
  
    return values;
  }
  
  function computeSegmentAdjustedDepthStats(sourcePixels, segmentMean, segmentPixels) {
    const adjusted = [];
  
    for (let i = 0; i < segmentPixels.length; i += 1) {
      const depth = sourcePixels[segmentPixels[i]];
      if (depth <= 0) {
        continue;
      }
      adjusted.push(depth - segmentMean);
    }
  
    if (adjusted.length === 0) {
      return { median: 0, mad: 0 };
    }
  
    adjusted.sort((a, b) => a - b);
    const median = adjusted[(adjusted.length - 1) >> 1];
    const deviations = adjusted.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
    const mad = deviations[(deviations.length - 1) >> 1];
    return { median, mad };
  }
  
  function collectSegmentDepthComponents(sourcePixels, segmentMap, segmentDepthMeans, width, height, segmentIndex, segmentPixels, visited, linkThreshold) {
    const components = [];
    const queue = new Int32Array(segmentPixels.length);
    const segmentMean = segmentDepthMeans[segmentIndex];
  
    for (let i = 0; i < segmentPixels.length; i += 1) {
      const startIndex = segmentPixels[i];
      if (visited[startIndex] || sourcePixels[startIndex] <= 0) {
        continue;
      }
  
      visited[startIndex] = 1;
      queue[0] = startIndex;
      let head = 0;
      let tail = 1;
      const indices = [];
      let adjustedSum = 0;
  
      while (head < tail) {
        const index = queue[head++];
        indices.push(index);
        adjustedSum += sourcePixels[index] - segmentMean;
  
        const x = index % width;
        const y = Math.floor(index / width);
        const neighbors = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ];
  
        for (let n = 0; n < neighbors.length; n += 1) {
          const [nx, ny] = neighbors[n];
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            continue;
          }
  
          const neighborIndex = ny * width + nx;
          if (segmentMap[neighborIndex] !== segmentIndex || visited[neighborIndex]) {
            continue;
          }
  
          const neighborDepth = sourcePixels[neighborIndex];
          if (neighborDepth <= 0) {
            continue;
          }
  
          const currentBoundary = isSegmentBoundaryPixel(segmentMap, width, height, index, segmentIndex);
          const neighborBoundary = isSegmentBoundaryPixel(segmentMap, width, height, neighborIndex, segmentIndex);
          const localLinkThreshold = currentBoundary || neighborBoundary
            ? Math.max(1.5, linkThreshold * 0.35)
            : linkThreshold;
  
          if (!depthDifferenceWithinThreshold(sourcePixels[index], neighborDepth, localLinkThreshold, segmentMean, segmentMean)) {
            continue;
          }
  
          if ((currentBoundary || neighborBoundary) && !hasSharedSegmentDepthSupport(
            sourcePixels,
            segmentMap,
            width,
            height,
            index,
            neighborIndex,
            segmentIndex,
            segmentMean,
            localLinkThreshold,
          )) {
            continue;
          }
  
          visited[neighborIndex] = 1;
          queue[tail++] = neighborIndex;
        }
      }
  
      components.push({
        indices,
        size: indices.length,
        adjustedMean: adjustedSum / Math.max(1, indices.length),
      });
    }
  
    return components;
  }
  
  function isSegmentBoundaryPixel(segmentMap, width, height, index, segmentIndex) {
    const x = index % width;
    const y = Math.floor(index / width);
    const offsets = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
  
    for (let i = 0; i < offsets.length; i += 1) {
      const [dx, dy] = offsets[i];
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
        continue;
      }
  
      if (segmentMap[sy * width + sx] !== segmentIndex) {
        return true;
      }
    }
  
    return false;
  }
  
  function hasSharedSegmentDepthSupport(sourcePixels, segmentMap, width, height, indexA, indexB, segmentIndex, segmentMean, threshold) {
    const ax = indexA % width;
    const ay = Math.floor(indexA / width);
    const bx = indexB % width;
    const by = Math.floor(indexB / width);
    const centerDepth = 0.5 * (sourcePixels[indexA] + sourcePixels[indexB]);
    let support = 0;
  
    for (let sy = Math.max(0, Math.min(ay, by) - 1); sy <= Math.min(height - 1, Math.max(ay, by) + 1); sy += 1) {
      for (let sx = Math.max(0, Math.min(ax, bx) - 1); sx <= Math.min(width - 1, Math.max(ax, bx) + 1); sx += 1) {
        const sampleIndex = sy * width + sx;
        if (sampleIndex === indexA || sampleIndex === indexB || segmentMap[sampleIndex] !== segmentIndex) {
          continue;
        }
  
        const sampleDepth = sourcePixels[sampleIndex];
        if (sampleDepth <= 0) {
          continue;
        }
  
        if (depthDifferenceWithinThreshold(sampleDepth, centerDepth, threshold, segmentMean, segmentMean)) {
          support += 1;
          if (support >= 2) {
            return true;
          }
        }
      }
    }
  
    return false;
  }
  
  function expandGapMaskWithinSegment(gapMask, segmentMap, width, height, passes) {
    const offsets = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
  
    for (let pass = 0; pass < passes; pass += 1) {
      const next = gapMask.slice();
  
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = y * width + x;
          if (gapMask[index]) {
            continue;
          }
  
          const segmentIndex = segmentMap[index];
          if (segmentIndex < 0) {
            continue;
          }
  
          for (const [dx, dy] of offsets) {
            const sx = x + dx;
            const sy = y + dy;
            if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
              continue;
            }
  
            const sampleIndex = sy * width + sx;
            if (gapMask[sampleIndex] && segmentMap[sampleIndex] === segmentIndex) {
              next[index] = 1;
              break;
            }
          }
        }
      }
  
      gapMask.set(next);
    }
  }
  
  function inpaintSegmentDepthGaps(sourcePixels, segmentMap, segmentDepthMeans, width, height, gapMask) {
    const filled = sourcePixels.slice();
    for (let index = 0; index < filled.length; index += 1) {
      if (gapMask[index]) {
        filled[index] = 0;
      }
    }
    return filled;
  }
  
  function enqueueGapNeighbors(queue, queued, gapMask, segmentMap, width, height, x, y, segmentIndex, tail) {
    const offsets = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
  
    let nextTail = tail;
  
    for (const [dx, dy] of offsets) {
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
        continue;
      }
  
      const sampleIndex = sy * width + sx;
      if (!gapMask[sampleIndex] || queued[sampleIndex] || segmentMap[sampleIndex] !== segmentIndex) {
        continue;
      }
  
      queue[nextTail++] = sampleIndex;
      queued[sampleIndex] = 1;
    }
  
    return nextTail;
  }
  
  function hasFilledSegmentNeighbor(sourcePixels, segmentMap, width, height, x, y, segmentIndex) {
    const offsets = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
  
    for (const [dx, dy] of offsets) {
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
        continue;
      }
  
      const sampleIndex = sy * width + sx;
      if (segmentMap[sampleIndex] === segmentIndex && sourcePixels[sampleIndex] > 0) {
        return true;
      }
    }
  
    return false;
  }
  
  function pixelHasDepthJump(depthPixels, segmentMap, segmentDepthMeans, width, height, px, py, threshold) {
    const center = depthPixels[py * width + px];
    if (center <= 0) {
      return true;
    }
  
    const centerSegmentIndex = segmentMap[py * width + px];
    if (centerSegmentIndex < 0) {
      return true;
    }
  
    const centerMean = segmentDepthMeans[centerSegmentIndex];
    const offsets = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
      [-2, 0],
      [2, 0],
      [0, -2],
      [0, 2],
    ];
  
    let minDepth = center;
    let maxDepth = center;
    let minMean = centerMean;
    let maxMean = centerMean;
    let comparableNeighbors = 0;
  
    for (const [dx, dy] of offsets) {
      const x = px + dx;
      const y = py + dy;
      if (x < 0 || x >= width || y < 0 || y >= height) {
        continue;
      }
  
      const sampleIndex = y * width + x;
      if (segmentMap[sampleIndex] !== centerSegmentIndex) {
        continue;
      }
  
      const depth = depthPixels[sampleIndex];
      if (depth <= 0) {
        continue;
      }
  
      const sampleMean = segmentDepthMeans[centerSegmentIndex];
      comparableNeighbors += 1;
  
      if (depth - sampleMean < minDepth - minMean) {
        minDepth = depth;
        minMean = sampleMean;
      }
      if (depth - sampleMean > maxDepth - maxMean) {
        maxDepth = depth;
        maxMean = sampleMean;
      }
  
      if (!depthDifferenceWithinThreshold(depth, center, threshold, sampleMean, centerMean)) {
        return true;
      }
    }
  
    if (comparableNeighbors < 2) {
      return false;
    }
  
    return !depthDifferenceWithinThreshold(maxDepth, minDepth, threshold, maxMean, minMean);
  }
  
  function sampleSegmentNeighborDepth(sourcePixels, segmentMap, segmentDepthMeans, width, height, x, y, segmentIndex) {
    const centerMean = segmentDepthMeans[segmentIndex];
    let weightSum = 0;
    let adjustedDepthSum = 0;
    let sampleCount = 0;
    const offsets = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
  
    for (const [ox, oy] of offsets) {
      const sx = x + ox;
      const sy = y + oy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
        continue;
      }
  
      const sampleIndex = sy * width + sx;
      if (segmentMap[sampleIndex] !== segmentIndex) {
        continue;
      }
  
      const sampleDepth = sourcePixels[sampleIndex];
      if (sampleDepth <= 0) {
        continue;
      }
  
      const distanceSq = ox * ox + oy * oy;
      const weight = 1 / Math.max(1, distanceSq);
      adjustedDepthSum += (sampleDepth - centerMean) * weight;
      weightSum += weight;
      sampleCount += 1;
    }
  
    if (sampleCount < 1 || weightSum <= 0) {
      return 0;
    }
  
    const depth = Math.round(centerMean + adjustedDepthSum / weightSum);
    return THREE.MathUtils.clamp(depth, 1, 255);
  }
  
  function sampleSegmentMeanDepth(sourcePixels, segmentMap, segmentDepthMeans, width, height, x, y, segmentIndex) {
    const centerMean = segmentDepthMeans[segmentIndex];
    const segmentPixels = renderState.segmentPixels[segmentIndex] || [];
    const maxSamples = 192;
    const stride = Math.max(1, Math.ceil(segmentPixels.length / maxSamples));
    let weightSum = 0;
    let adjustedDepthSum = 0;
    let sampleCount = 0;
  
    for (let i = 0; i < segmentPixels.length; i += stride) {
      const sampleIndex = segmentPixels[i];
      const sampleDepth = sourcePixels[sampleIndex];
      if (sampleDepth <= 0) {
        continue;
      }
  
      const sx = sampleIndex % width;
      const sy = Math.floor(sampleIndex / width);
      const dx = sx - x;
      const dy = sy - y;
      const distanceSq = dx * dx + dy * dy;
      const weight = 1 / Math.max(1, distanceSq);
      adjustedDepthSum += (sampleDepth - centerMean) * weight;
      weightSum += weight;
      sampleCount += 1;
    }
  
    if (sampleCount > 0 && weightSum > 0) {
      return THREE.MathUtils.clamp(Math.round(centerMean + adjustedDepthSum / weightSum), 1, 255);
    }
  
    return centerMean > 0 ? THREE.MathUtils.clamp(Math.round(centerMean), 1, 255) : 0;
  }
  
  function findSegmentDepthReplacement(sourcePixels, segmentMap, segmentDepthMeans, width, height, x, y, segmentIndex, centerDepth, threshold, closeTolerance) {
    const similar = [];
    const different = [];
  
    for (let oy = -2; oy <= 2; oy += 1) {
      for (let ox = -2; ox <= 2; ox += 1) {
        if (ox === 0 && oy === 0) {
          continue;
        }
  
        const sx = x + ox;
        const sy = y + oy;
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
          continue;
        }
  
        const sampleIndex = sy * width + sx;
        if (segmentMap[sampleIndex] !== segmentIndex) {
          continue;
        }
  
        const sampleDepth = sourcePixels[sampleIndex];
        if (sampleDepth <= 0) {
          continue;
        }
  
        if (
          depthDifferenceWithinThreshold(
            sampleDepth,
            centerDepth,
            closeTolerance,
            segmentDepthMeans[segmentIndex],
            segmentDepthMeans[segmentIndex],
          )
        ) {
          similar.push(sampleDepth);
        } else if (
          !depthDifferenceWithinThreshold(
            sampleDepth,
            centerDepth,
            threshold,
            segmentDepthMeans[segmentIndex],
            segmentDepthMeans[segmentIndex],
          )
        ) {
          different.push(sampleDepth);
        }
      }
    }
  
    if (similar.length >= 3 || different.length < 3) {
      return 0;
    }
  
    different.sort((a, b) => a - b);
    return different[(different.length - 1) >> 1];
  }
  
  function depthDifferenceWithinThreshold(a, b, absThreshold, meanA = 0, meanB = 0) {
    const adjustedA = a - meanA;
    const adjustedB = b - meanB;
    const scale = Math.max(relativeDepthFloor, Math.abs(adjustedA), Math.abs(adjustedB));
    return Math.abs(adjustedA - adjustedB) <= absThreshold + scale * relativeDepthFactor;
  }
  
  function isDepthContinuous(a, b, threshold, meanA = 0, meanB = 0) {
    return depthDifferenceWithinThreshold(a, b, threshold, meanA, meanB);
  }
  
  function invalidateDiscontinuousVertices(depthPixels, segmentMap, segmentDepthMeans, gapMask, width, height, cols, rows, step, threshold, vertexValid) {
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const px = Math.min(x * step, width - 1);
        const py = Math.min(y * step, height - 1);
        const index = y * cols + x;
  
        if (!vertexValid[index]) {
          continue;
        }
  
        if (gapMask[py * width + px]) {
          continue;
        }
  
        if (vertexHasDepthJump(depthPixels, segmentMap, segmentDepthMeans, width, height, px, py, threshold)) {
          vertexValid[index] = 0;
        }
      }
    }
  }
  
  function vertexHasDepthJump(depthPixels, segmentMap, segmentDepthMeans, width, height, px, py, threshold) {
    return pixelHasDepthJump(depthPixels, segmentMap, segmentDepthMeans, width, height, px, py, threshold);
  }
  
  function isTriangleDepthContinuous(depthPixels, segmentMap, segmentDepthMeans, gapMask, width, ax, ay, bx, by, cx, cy, edgeThreshold, centerThreshold) {
    if (
      gapMask[ay * width + ax] ||
      gapMask[by * width + bx] ||
      gapMask[cy * width + cx]
    ) {
      return true;
    }
  
    const depthA = depthPixels[ay * width + ax];
    const depthB = depthPixels[by * width + bx];
    const depthC = depthPixels[cy * width + cx];
    const meanA = getSegmentDepthMean(segmentMap, segmentDepthMeans, width, ax, ay);
    const meanB = getSegmentDepthMean(segmentMap, segmentDepthMeans, width, bx, by);
    const meanC = getSegmentDepthMean(segmentMap, segmentDepthMeans, width, cx, cy);
  
    if (
      !isDepthContinuous(depthA, depthB, edgeThreshold, meanA, meanB) ||
      !isDepthContinuous(depthB, depthC, edgeThreshold, meanB, meanC) ||
      !isDepthContinuous(depthC, depthA, edgeThreshold, meanC, meanA)
    ) {
      return false;
    }
  
    if (
      depthLineHasDiscontinuity(depthPixels, segmentMap, segmentDepthMeans, width, ax, ay, bx, by, edgeThreshold) ||
      depthLineHasDiscontinuity(depthPixels, segmentMap, segmentDepthMeans, width, bx, by, cx, cy, edgeThreshold) ||
      depthLineHasDiscontinuity(depthPixels, segmentMap, segmentDepthMeans, width, cx, cy, ax, ay, edgeThreshold)
    ) {
      return false;
    }
  
    const centerX = Math.round((ax + bx + cx) / 3);
    const centerY = Math.round((ay + by + cy) / 3);
    if (gapMask[centerY * width + centerX]) {
      return true;
    }
    const centerDepth = depthPixels[centerY * width + centerX];
    const centerMean = getSegmentDepthMean(segmentMap, segmentDepthMeans, width, centerX, centerY);
    if (
      centerDepth <= 0 ||
      !isDepthContinuous(centerDepth, depthA, centerThreshold, centerMean, meanA) ||
      !isDepthContinuous(centerDepth, depthB, centerThreshold, centerMean, meanB) ||
      !isDepthContinuous(centerDepth, depthC, centerThreshold, centerMean, meanC)
    ) {
      return false;
    }
  
    return true;
  }
  
  function getSegmentDepthMean(segmentMap, segmentDepthMeans, width, x, y) {
    const segmentIndex = segmentMap[y * width + x];
    return segmentIndex >= 0 ? segmentDepthMeans[segmentIndex] : 0;
  }
  
  function depthLineHasDiscontinuity(depthPixels, segmentMap, segmentDepthMeans, width, x0, y0, x1, y1, threshold) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    let prevDepth = depthPixels[y0 * width + x0];
    let prevMean = getSegmentDepthMean(segmentMap, segmentDepthMeans, width, x0, y0);
    let minDepth = prevDepth;
    let maxDepth = prevDepth;
    let minMean = prevMean;
    let maxMean = prevMean;
  
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const x = Math.round(x0 + dx * t);
      const y = Math.round(y0 + dy * t);
      const depth = depthPixels[y * width + x];
      if (depth <= 0) {
        return true;
      }
  
      minDepth = Math.min(minDepth, depth);
      maxDepth = Math.max(maxDepth, depth);
      const currentMean = getSegmentDepthMean(segmentMap, segmentDepthMeans, width, x, y);
      if (depth - currentMean < minDepth - minMean) {
        minDepth = depth;
        minMean = currentMean;
      }
      if (depth - currentMean > maxDepth - maxMean) {
        maxDepth = depth;
        maxMean = currentMean;
      }
  
      if (
        !depthDifferenceWithinThreshold(depth, prevDepth, threshold, currentMean, prevMean) ||
        !depthDifferenceWithinThreshold(maxDepth, minDepth, threshold, maxMean, minMean)
      ) {
        return true;
      }
  
      prevDepth = depth;
      prevMean = currentMean;
    }
  
    return false;
  }
  

  return {
    buildMaskedPlaneGeometry,
    buildRenderedBoundaryPointGeometry,
    buildPsdLayerGeometry,
    psdCellHasOnlyValidDepth,
    computeSegmentDepthMeans,
    repairDepthDiscontinuities,
  };
}
