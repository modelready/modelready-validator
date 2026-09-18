import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeGlbStats,
  countTriangles,
  extractGlbJsonChunk,
} from '../../web/js/glb-stats.js';

const GLB_MAGIC = 0x46546c67;
const CHUNK_TYPE_JSON = 0x4e4f534a;

function createGlb(json, { chunkType = CHUNK_TYPE_JSON, jsonText } = {}) {
  const encodedJson = new TextEncoder().encode(jsonText ?? JSON.stringify(json));
  const paddedLength = Math.ceil(encodedJson.byteLength / 4) * 4;
  const arrayBuffer = new ArrayBuffer(20 + paddedLength);
  const view = new DataView(arrayBuffer);

  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, arrayBuffer.byteLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, chunkType, true);

  const chunk = new Uint8Array(arrayBuffer, 20, paddedLength);
  chunk.fill(0x20);
  chunk.set(encodedJson);

  return arrayBuffer;
}

function assertTriangleCount(gltfJson, expected) {
  const glb = createGlb(gltfJson);
  const extractedJson = extractGlbJsonChunk(glb);

  assert.deepEqual(extractedJson, gltfJson);
  assert.equal(countTriangles(extractedJson), expected);
  assert.deepEqual(computeGlbStats(glb), { triangleCount: expected });
}

test('counts indexed TRIANGLES primitives from the indices accessor', () => {
  assertTriangleCount({
    accessors: [{ count: 12, bufferView: 0, componentType: 5123 }],
    meshes: [{ primitives: [{ mode: 4, indices: 0 }] }],
  }, 4);
});

test('counts unindexed TRIANGLES primitives from the POSITION accessor', () => {
  assertTriangleCount({
    accessors: [{ count: 9, bufferView: 0, componentType: 5126 }],
    meshes: [{ primitives: [{ mode: 4, attributes: { POSITION: 0 } }] }],
  }, 3);
});

test('counts TRIANGLE_STRIP primitives as accessor count minus two', () => {
  assertTriangleCount({
    accessors: [{ count: 6, bufferView: 0, componentType: 5123 }],
    meshes: [{ primitives: [{ mode: 5, indices: 0 }] }],
  }, 4);
});

test('counts TRIANGLE_FAN primitives as accessor count minus two', () => {
  assertTriangleCount({
    accessors: [{ count: 5, bufferView: 0, componentType: 5126 }],
    meshes: [{ primitives: [{ mode: 6, attributes: { POSITION: 0 } }] }],
  }, 3);
});

test('sums triangle counts across multiple primitives and meshes', () => {
  assertTriangleCount({
    accessors: [
      { count: 6 },
      { count: 9 },
      { count: 5 },
      { count: 4 },
    ],
    meshes: [
      {
        primitives: [
          { mode: 4, indices: 0 },
          { mode: 4, attributes: { POSITION: 1 } },
        ],
      },
      {
        primitives: [
          { mode: 5, indices: 2 },
          { mode: 6, attributes: { POSITION: 3 } },
        ],
      },
    ],
  }, 10);
});

test('ignores non-triangle primitives without affecting other primitives', () => {
  assertTriangleCount({
    accessors: [{ count: 100 }, { count: 6 }],
    meshes: [{
      primitives: [
        { mode: 0, attributes: { POSITION: 0 } },
        { mode: 4, indices: 1 },
      ],
    }],
  }, 2);
});

test('returns null for a GLB with an invalid magic value', () => {
  const glb = createGlb({ meshes: [] });
  new DataView(glb).setUint32(0, 0x12345678, true);

  assert.doesNotThrow(() => extractGlbJsonChunk(glb));
  assert.equal(extractGlbJsonChunk(glb), null);
  assert.equal(computeGlbStats(glb), null);
});

test('returns null for a buffer shorter than the GLB header and chunk header', () => {
  const shortBuffer = new ArrayBuffer(19);

  assert.doesNotThrow(() => extractGlbJsonChunk(shortBuffer));
  assert.equal(extractGlbJsonChunk(shortBuffer), null);
  assert.equal(computeGlbStats(shortBuffer), null);
});

test('returns null when the first chunk is not JSON or contains invalid JSON', () => {
  const wrongChunkType = createGlb({ meshes: [] }, { chunkType: 0x004e4942 });
  const invalidJson = createGlb(null, { jsonText: '{not valid JSON' });

  for (const glb of [wrongChunkType, invalidJson]) {
    assert.doesNotThrow(() => extractGlbJsonChunk(glb));
    assert.equal(extractGlbJsonChunk(glb), null);
    assert.equal(computeGlbStats(glb), null);
  }
});
