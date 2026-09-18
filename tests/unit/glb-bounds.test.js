import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSceneBounds } from '../../web/js/glb-bounds.js';

const EPSILON = 1e-6;

function createGltf(nodes, min = [-1, -2, -3], max = [4, 5, 6]) {
  return {
    accessors: [{ min, max }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes,
    scenes: [{ nodes: [0] }],
  };
}

function assertBoundsApproximately(actual, expected) {
  assert.notEqual(actual, null);
  for (const bound of ['min', 'max']) {
    for (let axis = 0; axis < 3; axis += 1) {
      assert.ok(
        Math.abs(actual[bound][axis] - expected[bound][axis]) <= EPSILON,
        `${bound}[${axis}] expected ${expected[bound][axis]}, got ${actual[bound][axis]}`,
      );
    }
  }
}

test('uses POSITION accessor bounds for an untransformed mesh node', () => {
  const gltfJson = createGltf([{ mesh: 0 }]);

  assert.deepEqual(computeSceneBounds(gltfJson), {
    min: [-1, -2, -3],
    max: [4, 5, 6],
  });
});

test('applies node translation', () => {
  const gltfJson = createGltf([{ mesh: 0, translation: [10, 20, 30] }]);

  assert.deepEqual(computeSceneBounds(gltfJson), {
    min: [9, 18, 27],
    max: [14, 25, 36],
  });
});

test('applies non-uniform node scale', () => {
  const gltfJson = createGltf([{ mesh: 0, scale: [2, 3, 4] }], [1, 2, 3], [4, 5, 6]);

  assert.deepEqual(computeSceneBounds(gltfJson), {
    min: [2, 6, 12],
    max: [8, 15, 24],
  });
});

test('rotates bounds 90 degrees around Y', () => {
  const halfSqrtTwo = Math.sqrt(0.5);
  const gltfJson = createGltf(
    [{ mesh: 0, rotation: [0, halfSqrtTwo, 0, halfSqrtTwo] }],
    [-1, -2, -3],
    [1, 2, 3],
  );

  assertBoundsApproximately(computeSceneBounds(gltfJson), {
    min: [-3, -2, -1],
    max: [3, 2, 1],
  });
});

test('uses node.matrix instead of TRS', () => {
  const gltfJson = createGltf([{
    mesh: 0,
    matrix: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      7, 8, 9, 1,
    ],
    translation: [100, 100, 100],
  }]);

  assert.deepEqual(computeSceneBounds(gltfJson), {
    min: [6, 6, 6],
    max: [11, 13, 15],
  });
});

test('composes parent and child translations', () => {
  const gltfJson = createGltf([
    { translation: [10, 20, 30], children: [1] },
    { mesh: 0, translation: [1, 2, 3] },
  ]);

  assert.deepEqual(computeSceneBounds(gltfJson), {
    min: [10, 20, 30],
    max: [15, 27, 39],
  });
});

test('includes every instance of a mesh', () => {
  const gltfJson = createGltf([
    { mesh: 0, translation: [-10, 0, 0] },
    { mesh: 0, translation: [10, 0, 0] },
  ], [-1, 0, -1], [1, 2, 1]);
  gltfJson.scenes[0].nodes = [0, 1];

  assert.deepEqual(computeSceneBounds(gltfJson), {
    min: [-11, 0, -1],
    max: [11, 2, 1],
  });
});

test('ignores POSITION accessors without both min and max', () => {
  const gltfJson = createGltf([{ mesh: 0 }]);
  gltfJson.accessors = [
    { min: [-100, -100, -100] },
    { min: [1, 2, 3], max: [4, 5, 6] },
  ];
  gltfJson.meshes[0].primitives.push({ attributes: { POSITION: 1 } });

  assert.deepEqual(computeSceneBounds(gltfJson), {
    min: [1, 2, 3],
    max: [4, 5, 6],
  });
});

test('returns null when the scene has no meshes', () => {
  assert.equal(computeSceneBounds({ nodes: [{}], scenes: [{ nodes: [0] }] }), null);
});

test('uses unreferenced nodes as roots when scenes are absent', () => {
  const gltfJson = createGltf([
    { translation: [10, 0, 0], children: [1] },
    { mesh: 0, translation: [2, 0, 0] },
  ], [0, 0, 0], [1, 1, 1]);
  delete gltfJson.scenes;

  assert.deepEqual(computeSceneBounds(gltfJson), {
    min: [12, 0, 0],
    max: [13, 1, 1],
  });
});

test('stops walking a cycle without throwing', () => {
  const gltfJson = createGltf([
    { mesh: 0, translation: [1, 0, 0], children: [1] },
    { mesh: 0, translation: [2, 0, 0], children: [0] },
  ], [0, 0, 0], [1, 1, 1]);

  assert.doesNotThrow(() => computeSceneBounds(gltfJson));
  assert.deepEqual(computeSceneBounds(gltfJson), {
    min: [1, 0, 0],
    max: [4, 1, 1],
  });
});
