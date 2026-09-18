// Generates web/samples/sample-vase.glb — the "Try a sample model" file on the
// landing page. It deliberately breaks two of Amazon's published rules — the
// material has a BaseColor map but no Metallic/Roughness map, and it is
// double-sided — so the demo report shows what real findings look like.
//
// Usage: node scripts/make-demo-glb.js

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, '..', 'web', 'samples', 'sample-vase.glb');

const SEGMENTS = 128; // around the vase
const RINGS = 98; // bottom to top → SEGMENTS * RINGS * 2 ≈ 25k triangles
const TEXTURE_SIZE = 4096;

// Vase silhouette: radius as a function of height t ∈ [0, 1].
function radiusAt(t) {
  return 0.28 + 0.16 * Math.sin(Math.PI * t * 1.15) - 0.1 * Math.sin(Math.PI * t * 2.4) * t;
}

function buildGeometry() {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const height = 1;
  const dt = 1e-3;

  for (let ring = 0; ring <= RINGS; ring++) {
    const t = ring / RINGS;
    const r = radiusAt(t);
    const slope = (radiusAt(Math.min(1, t + dt)) - radiusAt(Math.max(0, t - dt))) / (2 * dt);
    for (let seg = 0; seg <= SEGMENTS; seg++) {
      const angle = (seg / SEGMENTS) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      positions.push(r * cos, t * height, r * sin);
      // Surface normal of a lathe: radial component, tilted by the profile slope.
      const nx = cos;
      const ny = -slope / height;
      const nz = sin;
      const len = Math.hypot(nx, ny, nz);
      normals.push(nx / len, ny / len, nz / len);
      uvs.push(seg / SEGMENTS, 1 - t);
    }
  }

  const row = SEGMENTS + 1;
  for (let ring = 0; ring < RINGS; ring++) {
    for (let seg = 0; seg < SEGMENTS; seg++) {
      const a = ring * row + seg;
      const b = a + row;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  return { positions, normals, uvs, indices };
}

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

// Horizontal glaze bands: identical rows within a band keep the PNG tiny even at 4096².
function buildTexturePng(size) {
  const rowBytes = 1 + size * 3;
  const raw = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) {
    const band = Math.floor((y / size) * 12);
    const [r, g, b] = band % 3 === 0 ? [38, 70, 83] : band % 3 === 1 ? [42, 157, 143] : [233, 196, 106];
    const offset = y * rowBytes;
    raw[offset] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      raw[offset + 1 + x * 3] = r;
      raw[offset + 2 + x * 3] = g;
      raw[offset + 3 + x * 3] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pad4(buf, fill = 0) {
  const padding = (4 - (buf.length % 4)) % 4;
  return padding ? Buffer.concat([buf, Buffer.alloc(padding, fill)]) : buf;
}

function minMax(values, stride) {
  const min = Array(stride).fill(Infinity);
  const max = Array(stride).fill(-Infinity);
  for (let i = 0; i < values.length; i += stride) {
    for (let c = 0; c < stride; c++) {
      min[c] = Math.min(min[c], values[i + c]);
      max[c] = Math.max(max[c], values[i + c]);
    }
  }
  return { min, max };
}

function buildGlb() {
  const { positions, normals, uvs, indices } = buildGeometry();
  const vertexCount = positions.length / 3;
  const png = buildTexturePng(TEXTURE_SIZE);

  const parts = [
    pad4(Buffer.from(new Float32Array(positions).buffer)),
    pad4(Buffer.from(new Float32Array(normals).buffer)),
    pad4(Buffer.from(new Float32Array(uvs).buffer)),
    pad4(Buffer.from(new Uint16Array(indices).buffer)),
    pad4(png),
  ];
  const bufferViews = [];
  let offset = 0;
  for (const [i, part] of parts.entries()) {
    const view = { buffer: 0, byteOffset: offset, byteLength: part.length };
    if (i < 3) view.target = 34962; // ARRAY_BUFFER
    if (i === 3) view.target = 34963; // ELEMENT_ARRAY_BUFFER
    bufferViews.push(view);
    offset += part.length;
  }
  // byteLength must be the exact (unpadded) size of the PNG and index data.
  bufferViews[3].byteLength = indices.length * 2;
  bufferViews[4].byteLength = png.length;

  const bin = Buffer.concat(parts);
  const posBounds = minMax(positions, 3);

  const gltf = {
    asset: { version: '2.0', generator: 'ModelReady demo generator' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'SampleVase' }],
    meshes: [
      {
        name: 'SampleVase',
        primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }],
      },
    ],
    materials: [
      {
        name: 'Glaze',
        pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.35 },
        doubleSided: true,
      },
    ],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    images: [{ bufferView: 4, mimeType: 'image/png' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vertexCount, type: 'VEC3', ...posBounds },
      { bufferView: 1, componentType: 5126, count: vertexCount, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: vertexCount, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };

  const json = pad4(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // "BIN\0"

  return { glb: Buffer.concat([header, jsonHeader, json, binHeader, bin]), triangles: indices.length / 3 };
}

const { glb, triangles } = buildGlb();
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, glb);
console.log(`Wrote ${path.relative(process.cwd(), OUT_FILE)} — ${(glb.length / 1024).toFixed(0)} KB, ${triangles} triangles`);
