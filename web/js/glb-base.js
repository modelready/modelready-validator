import { forEachSceneMesh } from './glb-bounds.js';

const MAX_VERTICES = 200_000;
// Match scripts/lib/upright.mjs: a shallow slice represents the whole base
// better than only the lowest vertices on unevenly tessellated models.
const BASE_SLICE_RATIO = 0.03;

const COMPONENTS = {
  5120: {
    bytes: 1,
    read: (view, offset) => Math.max(view.getInt8(offset) / 127, -1),
  },
  5121: {
    bytes: 1,
    read: (view, offset) => view.getUint8(offset) / 255,
  },
  5122: {
    bytes: 2,
    read: (view, offset) => Math.max(view.getInt16(offset, true) / 32767, -1),
  },
  5123: {
    bytes: 2,
    read: (view, offset) => view.getUint16(offset, true) / 65535,
  },
  5126: {
    bytes: 4,
    read: (view, offset) => view.getFloat32(offset, true),
  },
};

function createPositionReader(gltfJson, bin, primitive, dataView) {
  if (primitive?.extensions?.KHR_draco_mesh_compression ||
      primitive?.extensions?.EXT_meshopt_compression) {
    return null;
  }

  const accessors = Array.isArray(gltfJson.accessors) ? gltfJson.accessors : [];
  const bufferViews = Array.isArray(gltfJson.bufferViews) ? gltfJson.bufferViews : [];
  const buffers = Array.isArray(gltfJson.buffers) ? gltfJson.buffers : [];
  const accessorIndex = primitive?.attributes?.POSITION;
  if (!Number.isInteger(accessorIndex) || accessorIndex < 0 || accessorIndex >= accessors.length) {
    return null;
  }

  const accessor = accessors[accessorIndex];
  if (!accessor || accessor.type !== 'VEC3' || accessor.sparse !== undefined ||
      !Number.isInteger(accessor.count) || accessor.count <= 0) {
    return null;
  }

  const component = COMPONENTS[accessor.componentType];
  if (!component || (accessor.componentType !== 5126 && accessor.normalized !== true)) return null;

  const bufferViewIndex = accessor.bufferView;
  if (!Number.isInteger(bufferViewIndex) || bufferViewIndex < 0 ||
      bufferViewIndex >= bufferViews.length) {
    return null;
  }

  const bufferView = bufferViews[bufferViewIndex];
  const buffer = buffers[0];
  if (!bufferView || bufferView.buffer !== 0 ||
      !buffer || buffer.uri !== undefined ||
      bufferView.extensions?.EXT_meshopt_compression) {
    return null;
  }

  const viewOffset = bufferView.byteOffset ?? 0;
  const accessorOffset = accessor.byteOffset ?? 0;
  const viewLength = bufferView.byteLength;
  const elementSize = component.bytes * 3;
  const stride = bufferView.byteStride ?? elementSize;
  if (![viewOffset, accessorOffset, viewLength, stride].every(Number.isInteger) ||
      viewOffset < 0 || accessorOffset < 0 || viewLength < 0 || stride < elementSize ||
      !Number.isInteger(buffer.byteLength) || buffer.byteLength < 0 ||
      viewOffset + viewLength > buffer.byteLength || viewOffset + viewLength > bin.byteLength) {
    return null;
  }

  const finalByte = accessorOffset + (accessor.count - 1) * stride + elementSize;
  if (!Number.isSafeInteger(finalByte) || finalByte > viewLength) return null;

  return {
    count: accessor.count,
    offset: viewOffset + accessorOffset,
    stride,
    component,
    dataView,
  };
}

function readWorldPoint(reader, worldMatrix, index) {
  const offset = reader.offset + index * reader.stride;
  const x = reader.component.read(reader.dataView, offset);
  const y = reader.component.read(reader.dataView, offset + reader.component.bytes);
  const z = reader.component.read(reader.dataView, offset + reader.component.bytes * 2);

  return [
    worldMatrix[0] * x + worldMatrix[4] * y + worldMatrix[8] * z + worldMatrix[12],
    worldMatrix[1] * x + worldMatrix[5] * y + worldMatrix[9] * z + worldMatrix[13],
    worldMatrix[2] * x + worldMatrix[6] * y + worldMatrix[10] * z + worldMatrix[14],
  ];
}

/**
 * Finds the lowest world-space vertices and the centre of their base slice.
 * @returns {{ minY: number, baseCentre: [number, number], contactPoints: number, source: 'vertices' } | null}
 */
export function computeFloorContact(gltfJson, bin, { contactRatio = 0.005 } = {}) {
  if (!gltfJson || typeof gltfJson !== 'object' || !(bin instanceof Uint8Array)) return null;

  const meshes = Array.isArray(gltfJson.meshes) ? gltfJson.meshes : [];
  const dataView = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const readers = [];
  let totalVertices = 0;

  forEachSceneMesh(gltfJson, (meshIndex, worldMatrix) => {
    const primitives = Array.isArray(meshes[meshIndex]?.primitives)
      ? meshes[meshIndex].primitives
      : [];
    for (const primitive of primitives) {
      const reader = createPositionReader(gltfJson, bin, primitive, dataView);
      if (!reader || totalVertices > Number.MAX_SAFE_INTEGER - reader.count) continue;
      readers.push({ ...reader, worldMatrix, start: totalVertices });
      totalVertices += reader.count;
    }
  });

  if (totalVertices === 0) return null;

  const sampleCount = Math.min(totalVertices, MAX_VERTICES);
  const points = new Float64Array(sampleCount * 3);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let readerIndex = 0;
  let pointCount = 0;

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const vertexIndex = totalVertices > sampleCount
      ? Math.floor(sampleIndex * totalVertices / sampleCount)
      : sampleIndex;
    while (vertexIndex >= readers[readerIndex].start + readers[readerIndex].count) {
      readerIndex += 1;
    }

    const reader = readers[readerIndex];
    const point = readWorldPoint(reader, reader.worldMatrix, vertexIndex - reader.start);
    if (!point.every(Number.isFinite)) continue;

    const pointOffset = pointCount * 3;
    for (let axis = 0; axis < 3; axis += 1) {
      points[pointOffset + axis] = point[axis];
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
    pointCount += 1;
  }

  if (pointCount === 0) return null;

  const ratio = Number.isFinite(contactRatio) && contactRatio >= 0 ? contactRatio : 0.005;
  const extent = Math.max(...max.map((value, axis) => value - min[axis]));
  const eps = ratio * extent;
  const band = Math.max(eps, (max[1] - min[1]) * BASE_SLICE_RATIO);
  const baseMin = [Infinity, Infinity];
  const baseMax = [-Infinity, -Infinity];
  let contactPoints = 0;

  for (let index = 0; index < pointCount; index += 1) {
    const offset = index * 3;
    if (points[offset + 1] - min[1] > band) continue;
    baseMin[0] = Math.min(baseMin[0], points[offset]);
    baseMax[0] = Math.max(baseMax[0], points[offset]);
    baseMin[1] = Math.min(baseMin[1], points[offset + 2]);
    baseMax[1] = Math.max(baseMax[1], points[offset + 2]);
    contactPoints += 1;
  }

  return {
    minY: min[1],
    baseCentre: [
      (baseMin[0] + baseMax[0]) / 2,
      (baseMin[1] + baseMax[1]) / 2,
    ],
    contactPoints,
    source: 'vertices',
  };
}
