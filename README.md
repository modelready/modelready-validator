# ModelReady checker

The source of the free checker at **[modelready.click](https://modelready.click)**: drop a `.glb` file and see
whether it meets Amazon's and Shopify's published 3D model requirements.

It runs entirely in your browser. Your model is read locally and never uploaded anywhere. This repository
exists so you don't have to take that on trust: every piece of code that sees your model is here, including
the Khronos validator (vendored, see below). Read it, or run it yourself.

## Verify that nothing is uploaded

1. Open [modelready.click](https://modelready.click), then your browser's DevTools → **Network** tab.
2. Drop a `.glb` file in.
3. You'll see the page load the two rule files (`/profiles/*.json`) and the Khronos glTF-Validator
   (`/vendor/gltf-validator/gltf-validator.js`), all from the same site. The only thing sent back is a small
   usage count: `{"profileIds": ["amazon", "shopify"]}`, plus `"demo": true` for the built-in sample. It
   carries no file bytes, names or stats. See `pingValidation` in [`web/js/validator.js`](web/js/validator.js).
   As with any website, the server sees standard request details such as your IP address.

The waitlist form, if you choose to fill it in, sends what you type into it: email, marketplace, batch size
and, optionally, an amount you'd pay.

## What it checks

**Amazon**, from Amazon's own [3D model technical requirements](https://sellercentral.amazon.com/help/hub/reference/external/G7RGSNQFZ2BAG7K3)
page:

| Check | Rule |
|---|---|
| File format | GLB or glTF |
| glTF-Validator | No errors from the official Khronos glTF-Validator |
| Triangles | At most 200,000 |
| Texture size | Every texture between 2048 and 4096 px |
| Texture shape | Square, power-of-two sides |
| Texture format | PNG or JPG, not embedded as data URIs |
| PBR maps | Every material has BaseColor and Metallic/Roughness textures |
| Scene contents | No animations, cameras or lights |
| Extensions | Only the glTF extensions Amazon lists |
| Floor alignment | Y-up, resting on Y=0, centred at the origin. A **warning**, since wall and ceiling products align differently |
| Double-sided materials | A **warning**: Amazon says double-sided textures aren't supported |
| File size | 5 MB is cited by third-party guides (linked in [`profiles/amazon.json`](profiles/amazon.json)) but not on Amazon's page, so it's **advisory** only |

**Shopify**, from Shopify's [product media types](https://help.shopify.com/en/manual/products/product-media/product-media-types)
page: GLB or USDZ, at most 500 MB, with a warning above the 15 MB auto-optimization threshold.

Every rule and its source quote lives in [`profiles/`](profiles). If a marketplace changes its requirements,
that's the file to fix. Issues and corrections are welcome.

## Run it locally

Requires Node.js 20+. No dependencies to install.

```bash
npm start      # http://localhost:3000
npm test       # unit tests for the rule engine, triangle counting and scene bounds
```

The waitlist form and usage ping talk to the hosted backend, which isn't part of this repository. Locally
they fail quietly, and the checker works the same.

## Layout

- `web/`: the page. `js/validator.js` orchestrates, `js/glb-stats.js` reads the GLB's JSON chunk,
  `js/glb-bounds.js` computes world-space bounds, `js/profiles.js` turns stats into pass/fail/warn verdicts.
- `web/vendor/gltf-validator/`: the official Khronos glTF-Validator, unmodified, served same-origin
  (Apache-2.0, see its own README and LICENSE there).
- `profiles/`: marketplace rules as data, each with its source.
- `scripts/make-demo-glb.js`: generates the "Try a sample model" file.

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md). You're free to read, run, modify and share this code for any
noncommercial purpose. Commercial use needs permission: write to modelready@proton.me.

The vendored Khronos glTF-Validator in `web/vendor/gltf-validator/` keeps its own Apache-2.0 license.

Required Notice: Copyright 2026 ModelReady (https://modelready.click)
