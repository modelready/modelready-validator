// Computes stats the Khronos glTF-Validator does not report. Reads the GLB
// binary container ourselves just far enough to reach the JSON chunk and sum
// triangle counts from mesh primitive accessors — no mesh/geometry engine here,
// just reading fields the parser already resolved.

const GLB_MAGIC = 0x46546c67; // ASCII "glTF" read as a little-endian uint32
const CHUNK_TYPE_JSON = 0x4e4f534a; // ASCII "JSON"

const MODE_TRIANGLES = 4;
const MODE_TRIANGLE_STRIP = 5;
const MODE_TRIANGLE_FAN = 6;

/**
 * @param {ArrayBuffer} arrayBuffer
 * @returns {object|null} the parsed glTF JSON chunk, or null if this isn't a valid GLB
 */
export function extractGlbJsonChunk(arrayBuffer) {
  if (arrayBuffer.byteLength < 20) return null;
  const view = new DataView(arrayBuffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) return null;

  // First chunk always starts at byte 12, per the GLB spec.
  const chunkLength = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  if (chunkType !== CHUNK_TYPE_JSON) return null;

  const jsonBytes = new Uint8Array(arrayBuffer, 20, chunkLength);
  const jsonText = new TextDecoder('utf-8').decode(jsonBytes);
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

/**
 * @param {object} gltfJson parsed glTF JSON (as returned by extractGlbJsonChunk)
 * @returns {number} total triangle count across all mesh primitives
 */
export function countTriangles(gltfJson) {
  const accessors = gltfJson.accessors || [];
  let triangleCount = 0;

  for (const mesh of gltfJson.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      const mode = primitive.mode === undefined ? MODE_TRIANGLES : primitive.mode;

      let vertexCount;
      if (primitive.indices !== undefined && accessors[primitive.indices]) {
        vertexCount = accessors[primitive.indices].count;
      } else if (primitive.attributes?.POSITION !== undefined && accessors[primitive.attributes.POSITION]) {
        vertexCount = accessors[primitive.attributes.POSITION].count;
      } else {
        continue;
      }

      if (mode === MODE_TRIANGLES) {
        triangleCount += Math.floor(vertexCount / 3);
      } else if (mode === MODE_TRIANGLE_STRIP || mode === MODE_TRIANGLE_FAN) {
        triangleCount += Math.max(0, vertexCount - 2);
      }
      // POINTS/LINES/LINE_LOOP/LINE_STRIP primitives contribute 0 triangles.
    }
  }

  return triangleCount;
}

function materialName(material, index) {
  return material?.name ? `"${material.name}"` : `material #${index}`;
}

/**
 * Materials lacking a BaseColor or metallicRoughness texture. A mesh primitive
 * with no material at all renders with glTF's untextured default material, so
 * that counts as missing too.
 * @param {object} gltfJson
 * @returns {string[]} human-readable material names
 */
export function findMaterialsMissingPbrMaps(gltfJson) {
  const materials = gltfJson.materials || [];
  const missing = materials
    .map((material, index) => ({ material, index }))
    .filter(({ material }) => {
      const pbr = material.pbrMetallicRoughness || {};
      return !pbr.baseColorTexture || !pbr.metallicRoughnessTexture;
    })
    .map(({ material, index }) => materialName(material, index));

  const usesDefaultMaterial = (gltfJson.meshes || []).some((mesh) =>
    (mesh.primitives || []).some((primitive) => primitive.material === undefined),
  );
  if (usesDefaultMaterial) missing.push('default material (no material assigned)');
  return missing;
}

/**
 * @param {object} gltfJson
 * @returns {string[]} descriptions of animations, cameras and punctual lights present
 */
export function findSceneExtras(gltfJson) {
  const extras = [];
  const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  const animations = gltfJson.animations?.length || 0;
  const cameras = gltfJson.cameras?.length || 0;
  const lights = gltfJson.extensions?.KHR_lights_punctual?.lights?.length || 0;
  if (animations) extras.push(plural(animations, 'animation'));
  if (cameras) extras.push(plural(cameras, 'camera'));
  if (lights) extras.push(plural(lights, 'light'));
  return extras;
}

/**
 * @param {object} gltfJson
 * @returns {string[]} names of materials with doubleSided: true
 */
export function findDoubleSidedMaterials(gltfJson) {
  return (gltfJson.materials || [])
    .map((material, index) => ({ material, index }))
    .filter(({ material }) => material.doubleSided === true)
    .map(({ material, index }) => materialName(material, index));
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @returns {{ triangleCount: number } | null} null if this isn't a valid GLB
 */
export function computeGlbStats(arrayBuffer) {
  const json = extractGlbJsonChunk(arrayBuffer);
  if (!json) return null;
  return { triangleCount: countTriangles(json) };
}
