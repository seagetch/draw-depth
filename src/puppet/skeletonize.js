function countNeighbors(mask, width, index) {
  const x = index % width;
  const y = Math.floor(index / width);
  let count = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sy < 0) {
        continue;
      }
      const neighborIndex = sy * width + sx;
      if (sx >= width || neighborIndex >= mask.length) {
        continue;
      }
      if (mask[neighborIndex]) {
        count += 1;
      }
    }
  }
  return count;
}

function transitionCount(mask, width, index) {
  const x = index % width;
  const y = Math.floor(index / width);
  const p2 = y > 0 ? mask[(y - 1) * width + x] : 0;
  const p3 = y > 0 && x < width - 1 ? mask[(y - 1) * width + x + 1] : 0;
  const p4 = x < width - 1 ? mask[y * width + x + 1] : 0;
  const p5 = y < Math.floor(mask.length / width) - 1 && x < width - 1 ? mask[(y + 1) * width + x + 1] : 0;
  const p6 = y < Math.floor(mask.length / width) - 1 ? mask[(y + 1) * width + x] : 0;
  const p7 = y < Math.floor(mask.length / width) - 1 && x > 0 ? mask[(y + 1) * width + x - 1] : 0;
  const p8 = x > 0 ? mask[y * width + x - 1] : 0;
  const p9 = y > 0 && x > 0 ? mask[(y - 1) * width + x - 1] : 0;
  const values = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
  let transitions = 0;
  for (let i = 0; i < 8; i += 1) {
    if (!values[i] && values[i + 1]) {
      transitions += 1;
    }
  }
  return transitions;
}

export function skeletonizeMask(sourceMask, width, height) {
  const mask = sourceMask.slice();
  const toDelete = [];
  let changed = true;

  while (changed) {
    changed = false;
    toDelete.length = 0;
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        if (!mask[index]) {
          continue;
        }
        const p2 = mask[(y - 1) * width + x];
        const p4 = mask[y * width + x + 1];
        const p6 = mask[(y + 1) * width + x];
        const p8 = mask[y * width + x - 1];
        const neighbors = countNeighbors(mask, width, index);
        const transitions = transitionCount(mask, width, index);
        if (
          neighbors >= 2 &&
          neighbors <= 6 &&
          transitions === 1 &&
          !(p2 && p4 && p6) &&
          !(p4 && p6 && p8)
        ) {
          toDelete.push(index);
        }
      }
    }
    if (toDelete.length) {
      changed = true;
      for (let i = 0; i < toDelete.length; i += 1) {
        mask[toDelete[i]] = 0;
      }
    }

    toDelete.length = 0;
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        if (!mask[index]) {
          continue;
        }
        const p2 = mask[(y - 1) * width + x];
        const p4 = mask[y * width + x + 1];
        const p6 = mask[(y + 1) * width + x];
        const p8 = mask[y * width + x - 1];
        const neighbors = countNeighbors(mask, width, index);
        const transitions = transitionCount(mask, width, index);
        if (
          neighbors >= 2 &&
          neighbors <= 6 &&
          transitions === 1 &&
          !(p2 && p4 && p8) &&
          !(p2 && p6 && p8)
        ) {
          toDelete.push(index);
        }
      }
    }
    if (toDelete.length) {
      changed = true;
      for (let i = 0; i < toDelete.length; i += 1) {
        mask[toDelete[i]] = 0;
      }
    }
  }

  return mask;
}
