import {
  countTriangles,
  extractGlbJsonChunk,
  findDoubleSidedMaterials,
  findMaterialsMissingPbrMaps,
  findSceneExtras,
} from './glb-stats.js';
import { computeSceneBounds } from './glb-bounds.js';
import { evaluateProfile } from './profiles.js';

// Khronos Group's official validator (gltf-validator 2.0.0-dev.3.10), served
// from this site rather than a CDN so all code that sees the model is in this
// repository — see web/vendor/gltf-validator/README.md. Loaded lazily, only
// once a file is dropped.
const GLTF_VALIDATOR_MODULE_URL = '/vendor/gltf-validator/gltf-validator.js';

const dropZone = document.getElementById('drop-zone');
const browseButton = document.getElementById('browse-button');
const fileInput = document.getElementById('file-input');
const reportContainer = document.getElementById('report-container');
const sampleButton = document.getElementById('sample-button');

const SAMPLE_MODEL_URL = '/samples/sample-vase.glb';

let profilesPromise = null;
let validatorPromise = null;

function loadProfiles() {
  profilesPromise ??= Promise.all([
    fetch('/profiles/amazon.json').then((r) => r.json()),
    fetch('/profiles/shopify.json').then((r) => r.json()),
  ]).then(([amazon, shopify]) => ({ amazon, shopify }));
  return profilesPromise;
}

function loadValidator() {
  validatorPromise ??= import(/* webpackIgnore: true */ GLTF_VALIDATOR_MODULE_URL);
  return validatorPromise;
}

function getSelectedProfileIds() {
  return Array.from(document.querySelectorAll('input[name="profile"]:checked')).map((el) => el.value);
}

async function detectFormatAndStats(arrayBuffer, fileName) {
  const gltfJson = extractGlbJsonChunk(arrayBuffer);
  if (gltfJson) return { format: 'glb', gltfJson };

  if (fileName.toLowerCase().endsWith('.gltf')) {
    try {
      const text = new TextDecoder('utf-8').decode(new Uint8Array(arrayBuffer));
      const parsed = JSON.parse(text);
      if (parsed && parsed.asset) return { format: 'gltf-separate', gltfJson: null };
    } catch {
      // falls through to "unsupported" below
    }
  }
  return { format: 'unsupported', gltfJson: null };
}

function createFileCard(fileName) {
  const card = document.createElement('article');
  card.className = 'file-report';
  const title = document.createElement('p');
  title.className = 'file-report__name';
  title.textContent = fileName;
  card.appendChild(title);
  reportContainer.appendChild(card);
  return card;
}

function renderError(card, message) {
  const p = document.createElement('p');
  p.className = 'file-report__error';
  p.textContent = message;
  card.appendChild(p);
}

function renderUnsupported(card, format) {
  const message =
    format === 'gltf-separate'
      ? "Standalone .gltf files (needing external .bin/texture files) aren't supported in this quick test yet — please export as a single .glb file."
      : "This doesn't look like a supported 3D file for this test. Please drop a .glb file.";
  renderError(card, message);
}

function renderProfileReport(card, profileLabel, report) {
  const section = document.createElement('section');
  section.className = 'profile-report';

  const title = document.createElement('p');
  title.className = 'profile-report__title';
  title.textContent = profileLabel;
  section.appendChild(title);

  for (const result of report.results) {
    const row = document.createElement('div');
    row.className = 'rule-row';

    const badge = document.createElement('span');
    badge.className = `rule-row__badge rule-row__badge--${result.status}`;
    badge.textContent = result.status;
    row.appendChild(badge);

    const body = document.createElement('div');
    body.className = 'rule-row__body';

    const label = document.createElement('p');
    label.className = 'rule-row__label';
    label.textContent = result.label;

    const message = document.createElement('p');
    message.className = 'rule-row__message';
    message.textContent = result.message;

    body.append(label, message);
    row.appendChild(body);
    section.appendChild(row);
  }

  card.appendChild(section);
}

async function pingValidation(profileIds, { demo = false } = {}) {
  if (!profileIds.length) return;
  try {
    await fetch('/api/validation-ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify(demo ? { profileIds, demo: true } : { profileIds }),
    });
  } catch {
    // Best-effort usage count only — must never affect the report shown.
  }
}

async function processFile(file, { demo = false } = {}) {
  const card = createFileCard(file.name);
  const selectedProfileIds = getSelectedProfileIds();

  try {
    const arrayBuffer = await file.arrayBuffer();
    const { format, gltfJson } = await detectFormatAndStats(arrayBuffer, file.name);

    if (format !== 'glb') {
      renderUnsupported(card, format);
      return;
    }

    const [{ validateBytes }, profiles] = await Promise.all([loadValidator(), loadProfiles()]);
    const khronosReport = await validateBytes(new Uint8Array(arrayBuffer));

    const resources = khronosReport.info?.resources ?? [];
    const textures = resources
      .filter((r) => r.pointer?.startsWith('/images/') || r.mimeType?.startsWith('image/'))
      .map((r) => ({
        width: r.image?.width ?? null,
        height: r.image?.height ?? null,
        mimeType: r.mimeType ?? null,
        storage: r.storage,
      }));

    const stats = {
      format: 'glb',
      byteSize: file.size,
      triangleCount: countTriangles(gltfJson),
      validatorErrorCount: khronosReport.issues?.numErrors ?? null,
      textures,
      materialsMissingMaps: findMaterialsMissingPbrMaps(gltfJson),
      sceneExtras: findSceneExtras(gltfJson),
      extensionsUsed: gltfJson.extensionsUsed || [],
      bounds: computeSceneBounds(gltfJson),
      doubleSidedMaterials: findDoubleSidedMaterials(gltfJson),
    };

    if (selectedProfileIds.length === 0) {
      renderError(card, 'Select at least one marketplace above to check this file against.');
      return;
    }

    for (const profileId of selectedProfileIds) {
      const profile = profiles[profileId];
      if (!profile) continue;
      renderProfileReport(card, profile.label, evaluateProfile(profile, stats));
    }
  } catch (err) {
    renderError(card, `Could not read this file: ${err?.message || 'unknown error'}.`);
  } finally {
    // A report (or a clear per-file error) was shown either way — this is the
    // moment the waitlist offer should appear.
    document.dispatchEvent(new CustomEvent('validator:report-rendered'));
    pingValidation(selectedProfileIds, { demo });
  }
}

async function runSampleModel() {
  sampleButton.disabled = true;
  try {
    const response = await fetch(SAMPLE_MODEL_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    await processFile(new File([blob], 'sample-vase.glb'), { demo: true });
  } catch (err) {
    renderError(createFileCard('sample-vase.glb'), `Could not load the sample model: ${err.message}.`);
  } finally {
    sampleButton.disabled = false;
  }
}

function handleFiles(fileList) {
  Array.from(fileList).forEach((file) => processFile(file));
}

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('drop-zone--active');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drop-zone--active');
});
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('drop-zone--active');
  if (event.dataTransfer?.files?.length) handleFiles(event.dataTransfer.files);
});
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});
browseButton.addEventListener('click', (event) => {
  event.stopPropagation();
  fileInput.click();
});
sampleButton.addEventListener('click', (event) => {
  event.stopPropagation();
  runSampleModel();
});
fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) handleFiles(fileInput.files);
  fileInput.value = '';
});
