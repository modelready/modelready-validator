# Vendored: Khronos glTF-Validator

`gltf-validator.js` is the official [Khronos glTF-Validator](https://github.com/KhronosGroup/glTF-Validator),
npm package `gltf-validator@2.0.0-dev.3.10`, as bundled into a single ES module by jsDelivr:
<https://cdn.jsdelivr.net/npm/gltf-validator@2.0.0-dev.3.10/+esm>. The file is unmodified.

It is served from this site instead of the CDN so that every piece of code that sees your model is in
this repository. It makes no network requests of its own: `validateBytes` is called without an
external-resource loader, so it only reads the bytes it is given.

Licensed under the Apache License 2.0. See [`LICENSE`](LICENSE).
