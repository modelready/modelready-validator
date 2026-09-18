// Computes world-space scene bounds from POSITION accessor metadata so the
// validator can check Amazon's Y=0 placement rules without reading mesh data.

const IDENTITY_MATRIX = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function isValidIndex(index, array) {
  return Number.isInteger(index) && index >= 0 && index < array.length;
}

function readTuple(value, length, fallback) {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.length !== length || !value.every(Number.isFinite)) {
    return null;
  }
  return value;
}

function createLocalMatrix(node) {
  if (!node || typeof node !== 'object') return null;

  if (node.matrix !== undefined) {
    return readTuple(node.matrix, 16, null)?.slice() || null;
  }

  const translation = readTuple(node.translation, 3, [0, 0, 0]);
  const rotation = readTuple(node.rotation, 4, [0, 0, 0, 1]);
  const scale = readTuple(node.scale, 3, [1, 1, 1]);
  if (!translation || !rotation || !scale) return null;

  const [x, y, z, w] = rotation;
  const quaternionLength = Math.hypot(x, y, z, w);
  if (!Number.isFinite(quaternionLength) || quaternionLength === 0) return null;

  const qx = x / quaternionLength;
  const qy = y / quaternionLength;
  const qz = z / quaternionLength;
  const qw = w / quaternionLength;
  const xx = qx * qx;
  const xy = qx * qy;
  const xz = qx * qz;
  const xw = qx * qw;
  const yy = qy * qy;
  const yz = qy * qz;
  const yw = qy * qw;
  const zz = qz * qz;
  const zw = qz * qw;
  const [sx, sy, sz] = scale;

  return [
    (1 - 2 * (yy + zz)) * sx,
    2 * (xy + zw) * sx,
    2 * (xz - yw) * sx,
    0,
    2 * (xy - zw) * sy,
    (1 - 2 * (xx + zz)) * sy,
    2 * (yz + xw) * sy,
    0,
    2 * (xz + yw) * sz,
    2 * (yz - xw) * sz,
    (1 - 2 * (xx + yy)) * sz,
    0,
    translation[0],
    translation[1],
    translation[2],
    1,
  ];
}

function multiplyMatrices(left, right) {
  const result = new Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      result[column * 4 + row] =
        left[row] * right[column * 4] +
        left[4 + row] * right[column * 4 + 1] +
        left[8 + row] * right[column * 4 + 2] +
        left[12 + row] * right[column * 4 + 3];
    }
  }
  return result;
}

function transformPoint(matrix, x, y, z) {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function getSceneRoots(gltfJson, nodes) {
  const scenes = Array.isArray(gltfJson.scenes) ? gltfJson.scenes : [];
  if (scenes.length > 0) {
    const sceneIndex = gltfJson.scene === undefined ? 0 : gltfJson.scene;
    if (!isValidIndex(sceneIndex, scenes)) return [];
    return Array.isArray(scenes[sceneIndex]?.nodes) ? scenes[sceneIndex].nodes : [];
  }

  const childIndices = new Set();
  for (const node of nodes) {
    if (!Array.isArray(node?.children)) continue;
    for (const childIndex of node.children) {
      if (isValidIndex(childIndex, nodes)) childIndices.add(childIndex);
    }
  }

  return nodes.map((_, index) => index).filter((index) => !childIndices.has(index));
}

/**
 * @param {object} gltfJson parsed glTF JSON (as returned by extractGlbJsonChunk)
 * @returns {{ min: [number, number, number], max: [number, number, number] } | null}
 * world-space axis-aligned bounds, or null when no usable POSITION bounds exist
 */
export function computeSceneBounds(gltfJson) {
  if (!gltfJson || typeof gltfJson !== 'object') return null;

  const nodes = Array.isArray(gltfJson.nodes) ? gltfJson.nodes : [];
  const meshes = Array.isArray(gltfJson.meshes) ? gltfJson.meshes : [];
  const accessors = Array.isArray(gltfJson.accessors) ? gltfJson.accessors : [];
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  let hasBounds = false;

  function includeMesh(meshIndex, worldMatrix) {
    if (!isValidIndex(meshIndex, meshes)) return;
    const primitives = Array.isArray(meshes[meshIndex]?.primitives)
      ? meshes[meshIndex].primitives
      : [];

    for (const primitive of primitives) {
      const accessorIndex = primitive?.attributes?.POSITION;
      if (!isValidIndex(accessorIndex, accessors)) continue;

      const accessor = accessors[accessorIndex];
      const localMin = accessor?.min;
      const localMax = accessor?.max;
      if (!Array.isArray(localMin) || !Array.isArray(localMax) ||
          localMin.length < 3 || localMax.length < 3 ||
          !localMin.slice(0, 3).every(Number.isFinite) ||
          !localMax.slice(0, 3).every(Number.isFinite) ||
          localMin.some((value, axis) => axis < 3 && value > localMax[axis])) {
        continue;
      }

      for (const x of [localMin[0], localMax[0]]) {
        for (const y of [localMin[1], localMax[1]]) {
          for (const z of [localMin[2], localMax[2]]) {
            const point = transformPoint(worldMatrix, x, y, z);
            if (!point.every(Number.isFinite)) continue;
            for (let axis = 0; axis < 3; axis += 1) {
              bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
              bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
            }
            hasBounds = true;
          }
        }
      }
    }
  }

  function visitNode(nodeIndex, parentMatrix, ancestors) {
    if (!isValidIndex(nodeIndex, nodes) || ancestors.has(nodeIndex)) return;

    const node = nodes[nodeIndex];
    const localMatrix = createLocalMatrix(node);
    if (!localMatrix) return;

    const worldMatrix = multiplyMatrices(parentMatrix, localMatrix);
    if (!worldMatrix.every(Number.isFinite)) return;

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(nodeIndex);
    includeMesh(node.mesh, worldMatrix);

    if (!Array.isArray(node.children)) return;
    for (const childIndex of node.children) {
      visitNode(childIndex, worldMatrix, nextAncestors);
    }
  }

  for (const rootIndex of getSceneRoots(gltfJson, nodes)) {
    visitNode(rootIndex, IDENTITY_MATRIX, new Set());
  }

  return hasBounds ? bounds : null;
}
