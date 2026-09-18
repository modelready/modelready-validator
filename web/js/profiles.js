// Maps an AssetStats object (built in web/js/validator.js) onto a
// MarketplaceProfile's rules, producing pass/fail/warn/advisory verdicts.
// Pure logic, no DOM — kept separate so tests/unit/profiles.test.js can exercise
// it with fixed fixtures instead of real files.

// Floor alignment tolerance never drops below this, so a tiny model exported at
// millimetre precision isn't flagged for floating-point noise.
const MIN_ALIGNMENT_TOLERANCE = 1e-4;
// Compressed (Draco/meshopt) geometry can't be read in the browser, and the
// bounding box is no stand-in for the base: a mug's handle shifts it. So for
// those files only the Y=0 part of the rule is checked.
const COMPRESSED_ALIGNMENT_NOTE = " The base centre in X and Z isn't checked: this file's geometry is compressed and can't be read in the browser.";

function alignmentOffsets(bounds, toleranceRatio) {
  const size = Math.max(...bounds.max.map((value, axis) => value - bounds.min[axis]));
  const tolerance = Math.max(size * toleranceRatio, MIN_ALIGNMENT_TOLERANCE);
  const floorContact = bounds.floorContact;
  const usesFloorContact = Number.isFinite(floorContact?.minY) &&
    Array.isArray(floorContact?.baseCentre) && floorContact.baseCentre.length >= 2 &&
    floorContact.baseCentre.slice(0, 2).every(Number.isFinite);
  return {
    tolerance,
    bottomY: usesFloorContact ? floorContact.minY : bounds.min[1],
    centreX: usesFloorContact ? floorContact.baseCentre[0] : (bounds.min[0] + bounds.max[0]) / 2,
    centreZ: usesFloorContact ? floorContact.baseCentre[1] : (bounds.min[2] + bounds.max[2]) / 2,
    usesFloorContact,
  };
}

const COMPARATORS = {
  max: (measured, limit) => measured > limit,
  min: (measured, limit) => measured < limit,
  oneOf: (measured, limit) => !limit.includes(measured),
  equals: (measured, limit) => measured !== limit,
  // Rules whose measured value is the list of offending items.
  empty: (measured) => measured.length > 0,
  aligned: (bounds, toleranceRatio) => {
    const { tolerance, bottomY, centreX, centreZ, usesFloorContact } = alignmentOffsets(bounds, toleranceRatio);
    const offsets = usesFloorContact ? [bottomY, centreX, centreZ] : [bottomY];
    return offsets.some((offset) => Math.abs(offset) > tolerance);
  },
};

export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

const isPowerOfTwo = (n) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;

function describeList(items, max = 3) {
  const shown = items.slice(0, max).join(', ');
  return items.length > max ? `${shown} and ${items.length - max} more` : shown;
}

function getMeasuredValue(rule, stats) {
  const textures = stats.textures || [];
  // Size rules can only judge images whose dimensions the validator could decode.
  const sized = textures.filter((t) => typeof t.width === 'number' && typeof t.height === 'number');
  switch (rule.id) {
    case 'format':
      return stats.format;
    case 'file_size':
    case 'auto_optimize_threshold':
      return stats.byteSize;
    case 'triangle_count':
      return stats.triangleCount;
    case 'gltf_validator':
      return stats.validatorErrorCount;
    case 'texture_max_size':
      return sized.length ? Math.max(...sized.map((t) => Math.max(t.width, t.height))) : null;
    case 'texture_min_size':
      return sized.length ? Math.min(...sized.map((t) => Math.min(t.width, t.height))) : null;
    case 'texture_shape':
      return sized
        .filter((t) => t.width !== t.height || !isPowerOfTwo(t.width))
        .map((t) => `${t.width}×${t.height}`);
    case 'texture_format':
      return [
        ...textures.filter((t) => !rule.limit.includes(t.mimeType)).map((t) => t.mimeType || 'unknown type'),
        ...textures.filter((t) => t.storage === 'data-uri').map(() => 'image embedded as a data URI in the JSON'),
      ];
    case 'required_maps':
      return stats.materialsMissingMaps || [];
    case 'scene_extras':
      return stats.sceneExtras || [];
    case 'extensions':
      return (stats.extensionsUsed || []).filter((name) => !rule.limit.includes(name));
    case 'floor_alignment':
      return stats.bounds && stats.floorContact
        ? { ...stats.bounds, floorContact: stats.floorContact }
        : stats.bounds ?? null;
    case 'double_sided':
      return stats.doubleSidedMaterials || [];
    default:
      return undefined;
  }
}

function buildMessage(rule, measured, violates) {
  switch (rule.id) {
    case 'format': {
      const accepted = rule.limit.filter((f) => f !== 'gltf-separate').map((f) => f.toUpperCase()).join(' or ');
      return `File format detected as ${String(measured).toUpperCase()}. ${rule.label} for this marketplace: ${accepted}.`;
    }
    case 'gltf_validator':
      if (measured == null) return 'The Khronos glTF-Validator could not produce a report for this file.';
      return violates
        ? `The official Khronos glTF-Validator reports ${measured} error${measured === 1 ? '' : 's'} — Amazon requires a clean validator result.`
        : 'The official Khronos glTF-Validator reports no errors.';
    case 'file_size': {
      const altText = rule.alternateLimits?.length
        ? ` (other sources report ${rule.alternateLimits.map(formatBytes).join(' / ')})`
        : '';
      const advisoryText = rule.verification === 'advisory' ? ' Not confirmed by the marketplace itself — treat as advisory.' : '';
      return `File is ${formatBytes(measured)}. Limit is ${formatBytes(rule.limit)}${altText}.${advisoryText}`;
    }
    case 'auto_optimize_threshold':
      return violates
        ? `File is ${formatBytes(measured)}, over Shopify's ${formatBytes(rule.limit)} auto-optimize threshold — Shopify will automatically compress this on upload rather than reject it.`
        : `File is ${formatBytes(measured)}, under Shopify's ${formatBytes(rule.limit)} auto-optimize threshold — it will be stored as uploaded.`;
    case 'triangle_count': {
      const measuredText = measured == null ? 'an unknown number of' : `~${measured.toLocaleString('en-US')}`;
      return `This file has ${measuredText} triangles. Limit is ${rule.limit.toLocaleString('en-US')}.`;
    }
    case 'texture_max_size':
      if (measured == null) return 'No textures were detected to measure.';
      return `Largest texture side is ${measured}px. Limit is ${rule.limit}px.`;
    case 'texture_min_size':
      if (measured == null) return 'No textures were detected to measure.';
      return violates
        ? `Smallest texture side is ${measured}px — Amazon requires at least ${rule.limit}px.`
        : `Smallest texture side is ${measured}px (minimum ${rule.limit}px).`;
    case 'texture_shape':
      return violates
        ? `Not square and power-of-two: ${describeList(measured)}.`
        : 'All textures are square with power-of-two sides.';
    case 'texture_format':
      return violates
        ? `Not accepted: ${describeList(measured)}. Amazon accepts PNG and JPG textures only.`
        : 'All textures are PNG or JPG.';
    case 'required_maps':
      return violates
        ? `Missing BaseColor or Metallic/Roughness texture maps: ${describeList(measured)}.`
        : 'Every material has BaseColor and Metallic/Roughness texture maps.';
    case 'scene_extras':
      return violates
        ? `Found ${describeList(measured)} — Amazon doesn't accept animations, cameras or lights.`
        : 'No animations, cameras or lights found.';
    case 'extensions':
      return violates
        ? `Unsupported glTF extensions: ${describeList(measured)}.`
        : 'Only supported glTF extensions are used.';
    case 'floor_alignment': {
      if (measured == null) return 'Could not compute the model bounds to check alignment.';
      const { bottomY, centreX, centreZ, usesFloorContact } = alignmentOffsets(measured, rule.limit);
      const fmt = (n) => n.toFixed(3);
      if (!usesFloorContact) {
        return violates
          ? `Bottom is at Y=${fmt(bottomY)}. Floor and tabletop products must rest on Y=0 (wall and ceiling products align differently).${COMPRESSED_ALIGNMENT_NOTE}`
          : `Model rests on Y=0.${COMPRESSED_ALIGNMENT_NOTE}`;
      }
      if (!violates) return 'Model rests on Y=0 and its base is centred in X and Z.';
      return `Bottom is at Y=${fmt(bottomY)}, base centre at X=${fmt(centreX)}, Z=${fmt(centreZ)}. Floor and tabletop products must rest on Y=0 centred at the origin (wall and ceiling products align differently).`;
    }
    case 'double_sided':
      return violates
        ? `Materials marked double-sided: ${describeList(measured)}. Amazon states double-sided textures are not supported.`
        : 'No double-sided materials.';
    default:
      return '';
  }
}

/**
 * @param {object} profile a MarketplaceProfile (see profiles/*.json)
 * @param {object} stats an AssetStats object (built in web/js/validator.js)
 * @returns {{ profileId: string, results: Array }} a ValidationReport's results
 */
export function evaluateProfile(profile, stats) {
  const results = profile.rules.map((rule) => {
    const measured = getMeasuredValue(rule, stats);
    const comparator = COMPARATORS[rule.comparator];
    const violates = measured !== undefined && measured !== null ? comparator(measured, rule.limit) : false;

    let status;
    if (rule.verification === 'advisory') {
      status = 'advisory';
    } else if (violates && rule.warnOnly) {
      status = 'warn';
    } else if (violates) {
      status = 'fail';
    } else {
      status = 'pass';
    }

    return {
      ruleId: rule.id,
      label: rule.label,
      status,
      measuredValue: measured,
      message: buildMessage(rule, measured, violates),
    };
  });

  return { profileId: profile.id, results };
}
