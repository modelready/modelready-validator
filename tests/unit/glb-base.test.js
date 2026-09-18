import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFloorContact } from '../../web/js/glb-base.js';
import { computeSceneBounds } from '../../web/js/glb-bounds.js';
import { extractGlbBinChunk, extractGlbJsonChunk } from '../../web/js/glb-stats.js';

const GLB_MAGIC = 0x46546c67;
const CHUNK_TYPE_JSON = 0x4e4f534a;
const CHUNK_TYPE_BIN = 0x004e4942;

function createGlb(json, bin) {
  const encodedJson = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(encodedJson.byteLength / 4) * 4;
  const binLength = Math.ceil(bin.byteLength / 4) * 4;
  const arrayBuffer = new ArrayBuffer(12 + 8 + jsonLength + 8 + binLength);
  const view = new DataView(arrayBuffer);

  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, arrayBuffer.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, CHUNK_TYPE_JSON, true);
  new Uint8Array(arrayBuffer, 20, jsonLength).fill(0x20);
  new Uint8Array(arrayBuffer, 20, encodedJson.byteLength).set(encodedJson);

  const binHeader = 20 + jsonLength;
  view.setUint32(binHeader, binLength, true);
  view.setUint32(binHeader + 4, CHUNK_TYPE_BIN, true);
  new Uint8Array(arrayBuffer, binHeader + 8, bin.byteLength).set(bin);
  return arrayBuffer;
}

function positionBounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const position of positions) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], position[axis]);
      max[axis] = Math.max(max[axis], position[axis]);
    }
  }
  return { min, max };
}

function createFloatGlb(positions, {
  byteStride = 12,
  viewOffset = 0,
  accessorOffset = 0,
  translation,
  extensions,
} = {}) {
  const viewLength = accessorOffset + byteStride * positions.length;
  const bin = new Uint8Array(viewOffset + viewLength);
  const view = new DataView(bin.buffer);
  for (let index = 0; index < positions.length; index += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      view.setFloat32(
        viewOffset + accessorOffset + index * byteStride + axis * 4,
        positions[index][axis],
        true,
      );
    }
  }

  const bounds = positionBounds(positions);
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: viewOffset, byteLength: viewLength, byteStride }],
    accessors: [{
      bufferView: 0,
      byteOffset: accessorOffset,
      componentType: 5126,
      count: positions.length,
      type: 'VEC3',
      min: bounds.min,
      max: bounds.max,
    }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, extensions }] }],
    nodes: [{ mesh: 0, translation }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  return createGlb(json, bin);
}

function readFloorContact(glb) {
  return computeFloorContact(extractGlbJsonChunk(glb), extractGlbBinChunk(glb));
}

function assertClose(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${expected}, got ${actual}`);
}

test('reads float positions and applies node translation', () => {
  const glb = createFloatGlb([
    [-1, 0, -1],
    [1, 0, 1],
    [0, 2, 0],
  ], { translation: [2, 3, 4] });

  assert.deepEqual(readFloorContact(glb), {
    minY: 3,
    baseCentre: [2, 4],
    contactPoints: 2,
    source: 'vertices',
  });
});

test('honours byteStride for interleaved positions', () => {
  const glb = createFloatGlb([
    [-1, 0, -1],
    [1, 0, 1],
    [10, 2, 0],
  ], { byteStride: 16, viewOffset: 8, accessorOffset: 4 });

  const result = readFloorContact(glb);
  assert.equal(result.contactPoints, 2);
  assert.deepEqual(result.baseCentre, [0, 0]);
});

test('dequantizes normalized UNSIGNED_SHORT positions', () => {
  const rawPositions = [
    [0, 0, 0],
    [65535, 0, 65535],
    [32768, 65535, 32768],
  ];
  const bin = new Uint8Array(rawPositions.length * 6);
  const view = new DataView(bin.buffer);
  for (let index = 0; index < rawPositions.length; index += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      view.setUint16(index * 6 + axis * 2, rawPositions[index][axis], true);
    }
  }
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [{ buffer: 0, byteLength: bin.byteLength }],
    accessors: [{
      bufferView: 0,
      componentType: 5123,
      normalized: true,
      count: rawPositions.length,
      type: 'VEC3',
      min: [0, 0, 0],
      max: [1, 1, 1],
    }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0, translation: [-0.5, 2, -0.5] }],
    scenes: [{ nodes: [0] }],
  };

  const result = readFloorContact(createGlb(json, bin));
  assert.equal(result.minY, 2);
  assertClose(result.baseCentre[0], 0);
  assertClose(result.baseCentre[1], 0);
  assert.equal(result.contactPoints, 2);
});

test('centres a mug-like model on its base instead of its handle-shifted bounds', () => {
  const glb = createFloatGlb([
    [-1, 0, 0],
    [1, 0, 0],
    [0, 0, -1],
    [0, 0, 1],
    [-1, 2, 0],
    [1, 2, 0],
    [2, 1, 0],
  ]);
  const json = extractGlbJsonChunk(glb);
  const bounds = computeSceneBounds(json);
  const result = computeFloorContact(json, extractGlbBinChunk(glb));

  assertClose(result.baseCentre[0], 0);
  assertClose(result.baseCentre[1], 0);
  assert.equal(result.contactPoints, 4);
  assertClose((bounds.min[0] + bounds.max[0]) / 2, 0.5);
});

test('returns null for a Draco-compressed primitive', () => {
  const glb = createFloatGlb([
    [-1, 0, -1],
    [1, 0, 1],
    [0, 2, 0],
  ], {
    extensions: { KHR_draco_mesh_compression: { bufferView: 1, attributes: { POSITION: 0 } } },
  });

  assert.equal(readFloorContact(glb), null);
});
