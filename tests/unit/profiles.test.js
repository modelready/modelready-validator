import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateProfile } from '../../web/js/profiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const profilesDir = path.join(__dirname, '..', '..', 'profiles');

function loadProfile(name) {
  return JSON.parse(fs.readFileSync(path.join(profilesDir, `${name}.json`), 'utf8'));
}

const amazon = loadProfile('amazon');
const shopify = loadProfile('shopify');

function resultOf(report, ruleId) {
  const result = report.results.find((r) => r.ruleId === ruleId);
  assert.ok(result, `expected a result for rule "${ruleId}"`);
  return result;
}

function statusOf(report, ruleId) {
  return resultOf(report, ruleId).status;
}

// A GLB that satisfies every rule on Amazon's official requirements page.
function compliantStats(overrides = {}) {
  return {
    format: 'glb',
    byteSize: 2_000_000, // 2 MB
    triangleCount: 50_000,
    validatorErrorCount: 0,
    textures: [
      { width: 2048, height: 2048, mimeType: 'image/png', storage: 'buffer-view' },
      { width: 2048, height: 2048, mimeType: 'image/jpeg', storage: 'buffer-view' },
    ],
    materialsMissingMaps: [],
    sceneExtras: [],
    extensionsUsed: ['KHR_materials_clearcoat'],
    bounds: { min: [-0.2, 0, -0.1], max: [0.2, 0.8, 0.1] },
    doubleSidedMaterials: [],
    ...overrides,
  };
}

test('a fully compliant GLB passes every verified Amazon rule and every Shopify rule', () => {
  const amazonReport = evaluateProfile(amazon, compliantStats());
  for (const result of amazonReport.results) {
    const expected = result.ruleId === 'file_size' ? 'advisory' : 'pass';
    assert.equal(result.status, expected, `amazon.${result.ruleId}: ${result.message}`);
  }

  const shopifyReport = evaluateProfile(shopify, compliantStats());
  assert.equal(statusOf(shopifyReport, 'format'), 'pass');
  assert.equal(statusOf(shopifyReport, 'file_size'), 'pass');
  assert.equal(statusOf(shopifyReport, 'auto_optimize_threshold'), 'pass');
});

test('Amazon fails over 200K triangles and passes at exactly 200K', () => {
  assert.equal(statusOf(evaluateProfile(amazon, compliantStats({ triangleCount: 200_001 })), 'triangle_count'), 'fail');
  assert.equal(statusOf(evaluateProfile(amazon, compliantStats({ triangleCount: 200_000 })), 'triangle_count'), 'pass');
});

test('Amazon fails any Khronos glTF-Validator error', () => {
  const report = evaluateProfile(amazon, compliantStats({ validatorErrorCount: 3 }));
  assert.equal(statusOf(report, 'gltf_validator'), 'fail');
  assert.match(resultOf(report, 'gltf_validator').message, /3 errors/);
});

test('Amazon texture rules: under 2K, over 4K, non-square/non-power-of-two, wrong format, data URI', () => {
  const small = evaluateProfile(amazon, compliantStats({
    textures: [{ width: 1024, height: 1024, mimeType: 'image/png', storage: 'buffer-view' }],
  }));
  assert.equal(statusOf(small, 'texture_min_size'), 'fail');
  assert.equal(statusOf(small, 'texture_max_size'), 'pass');
  assert.equal(statusOf(small, 'texture_shape'), 'pass');

  const large = evaluateProfile(amazon, compliantStats({
    textures: [{ width: 8192, height: 8192, mimeType: 'image/png', storage: 'buffer-view' }],
  }));
  assert.equal(statusOf(large, 'texture_max_size'), 'fail');

  const oddShape = evaluateProfile(amazon, compliantStats({
    textures: [
      { width: 2048, height: 4096, mimeType: 'image/png', storage: 'buffer-view' },
      { width: 3000, height: 3000, mimeType: 'image/png', storage: 'buffer-view' },
    ],
  }));
  assert.equal(statusOf(oddShape, 'texture_shape'), 'fail');
  assert.match(resultOf(oddShape, 'texture_shape').message, /2048×4096, 3000×3000/);

  const wrongFormat = evaluateProfile(amazon, compliantStats({
    textures: [
      { width: null, height: null, mimeType: 'image/webp', storage: 'buffer-view' },
      { width: 2048, height: 2048, mimeType: 'image/png', storage: 'data-uri' },
    ],
  }));
  assert.equal(statusOf(wrongFormat, 'texture_format'), 'fail');
  assert.match(resultOf(wrongFormat, 'texture_format').message, /image\/webp.*data URI/);
  // An image without decodable dimensions is left to the format rule, not the size rules.
  assert.equal(statusOf(wrongFormat, 'texture_min_size'), 'pass');
});

test('Amazon fails missing PBR maps, animations/cameras/lights and unlisted extensions', () => {
  const report = evaluateProfile(amazon, compliantStats({
    materialsMissingMaps: ['"Body"'],
    sceneExtras: ['1 animation', '2 cameras'],
    extensionsUsed: ['KHR_materials_clearcoat', 'KHR_texture_transform'],
  }));
  assert.equal(statusOf(report, 'required_maps'), 'fail');
  assert.equal(statusOf(report, 'scene_extras'), 'fail');
  assert.equal(statusOf(report, 'extensions'), 'fail');
  assert.match(resultOf(report, 'extensions').message, /KHR_texture_transform/);
  assert.doesNotMatch(resultOf(report, 'extensions').message, /clearcoat/);
});

test('floor alignment and double-sided materials only warn, since they depend on the product', () => {
  const floating = evaluateProfile(amazon, compliantStats({
    bounds: { min: [-0.2, 0.5, -0.1], max: [0.2, 1.3, 0.1] },
    doubleSidedMaterials: ['"Leaf"'],
  }));
  assert.equal(statusOf(floating, 'floor_alignment'), 'warn');
  assert.match(resultOf(floating, 'floor_alignment').message, /Y=0\.500/);
  assert.equal(statusOf(floating, 'double_sided'), 'warn');

  const offCentre = evaluateProfile(amazon, compliantStats({ bounds: { min: [1, 0, 1], max: [2, 1, 2] } }));
  assert.equal(statusOf(offCentre, 'floor_alignment'), 'warn');

  // Sub-tolerance floating-point noise is not flagged.
  const nearlyAligned = evaluateProfile(amazon, compliantStats({ bounds: { min: [-0.5, 0.001, -0.5], max: [0.5, 1, 0.5] } }));
  assert.equal(statusOf(nearlyAligned, 'floor_alignment'), 'pass');
});

test('a file over Shopify\'s 15 MB auto-optimize threshold but under its 500 MB hard cap warns, does not fail', () => {
  const shopifyReport = evaluateProfile(shopify, compliantStats({ byteSize: 20_000_000 })); // 20 MB
  assert.equal(statusOf(shopifyReport, 'auto_optimize_threshold'), 'warn');
  assert.equal(statusOf(shopifyReport, 'file_size'), 'pass');
});

test('a file over Shopify\'s 500 MB hard cap fails', () => {
  const shopifyReport = evaluateProfile(shopify, compliantStats({ byteSize: 600_000_000 })); // 600 MB
  assert.equal(statusOf(shopifyReport, 'file_size'), 'fail');
  assert.equal(statusOf(shopifyReport, 'auto_optimize_threshold'), 'warn');
});

test('an unrecognized format fails both marketplaces\' verified format rules', () => {
  const stats = compliantStats({ format: 'unsupported', triangleCount: null, textures: [], bounds: null });
  assert.equal(statusOf(evaluateProfile(shopify, stats), 'format'), 'fail');
  assert.equal(statusOf(evaluateProfile(amazon, stats), 'format'), 'fail');
});
