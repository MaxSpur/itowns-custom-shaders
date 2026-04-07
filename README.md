# iTowns Custom Shaders

This repository is a focused iTowns showcase for applying custom shader logic to vector data, especially thick line rendering built on `LineSegments2` and `LineMaterial`.

The current demo uses stereographic and cone-style projection variants as one concrete example of that shader pipeline. Those projection ideas are related to earlier work documented in:

- Spur, M. et al., *Virtual Data Sphere: Inverse Stereographic Projection for Immersive Multi-Perspective Geovisualization*, ISPRS Annals, 2022: [https://isprs-annals.copernicus.org/articles/V-4-2022/235/2022/](https://isprs-annals.copernicus.org/articles/V-4-2022/235/2022/)

The broader point of this repository is not the stereographic effect itself, but how to:

- load vector features into iTowns,
- convert them into fat-line renderables,
- inject custom shader behavior into the resulting materials,
- control line width behavior at runtime,
- reuse the same architecture for roads, vector tiles, and GPX paths.

## What It Demonstrates

- WFS road loading through `FeatureGeometryLayer`
- vector-tile-friendly fat-line reconstruction patterns
- drag-and-drop GPX import with persistence and per-path controls
- screen-space and world-space thickness modes
- optional projected geometry with source-distance-based width behavior
- custom shader deformation on vector lines without rewriting the full iTowns pipeline

## Quick Start

### Prerequisites

- Node.js 18+
- npm

### Install

```bash
npm install
```

### Run locally

```bash
npm run dev
```

Local dev uses `/` as the base path, so the app runs at:

```text
https://localhost:<port>/
```

If `localhost.pem` and `localhost-key.pem` exist, Vite serves over HTTPS with those local certs.

### Build

```bash
npm run build
```

Build output goes to `dist/`.

## GitHub Pages

Deployment is handled by [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml).

The workflow:

1. installs dependencies,
2. runs `npm run build`,
3. uploads `dist/` as the Pages artifact,
4. deploys with `actions/deploy-pages`.

`vite.config.js` derives the production base path from `GITHUB_REPOSITORY`, so repository renames are handled automatically in CI.

## Project Structure

- [`index.html`](./index.html): app entry page
- [`main.js`](./main.js): thin runtime entrypoint
- [`src/view/setupView.js`](./src/view/setupView.js): globe setup and base layers
- [`src/projection/index.js`](./src/projection/index.js): projection controller, shader injection, uniforms, widget
- [`src/roads/renderer.js`](./src/roads/renderer.js): orchestration for roads, GPX, UI, and frame sync
- [`src/roads/state.js`](./src/roads/state.js): shared render state and persistence
- [`src/roads/layer.js`](./src/roads/layer.js): WFS roads source and DEM draping
- [`src/roads/gpxPaths.js`](./src/roads/gpxPaths.js): GPX import, persistence, path controls, fat-line rendering
- [`src/roads/pipeline/geometry.js`](./src/roads/pipeline/geometry.js): segment extraction and grouping
- [`src/roads/pipeline/materials.js`](./src/roads/pipeline/materials.js): material cache and state propagation
- [`src/roads/pipeline/tileLifecycle.js`](./src/roads/pipeline/tileLifecycle.js): anchor creation, cleanup, rebuild flow
- [`src/roads/frameSync.js`](./src/roads/frameSync.js): per-frame resolution and shader uniform sync
- [`src/roads/ui.js`](./src/roads/ui.js): runtime controls
- [`VECTOR_LINES_DOSSIER.md`](./VECTOR_LINES_DOSSIER.md): standalone porting guide for reproducing the vector-line pipeline in another iTowns project

## Data Sources In The Demo

- IGN WMTS orthophotos: `ORTHOIMAGERY.ORTHOPHOTOS`
- IGN WMTS elevation: `ELEVATION.ELEVATIONGRIDCOVERAGE.SRTM3`
- IGN WFS roads: `BDTOPO_V3:troncon_de_route`

The architecture is not tied to those sources. The same pipeline can be used with WFS, vector tiles, or locally imported GPX data.

## Line Thickness Modes

- Variable width per road/path class
- Uniform width mode
- Global width multiplier
- GPX-specific extra width multiplier
- Screen-space thickness with `worldUnits = false`
- Perspective/metric thickness with `worldUnits = true`
- Projected geometry with original-distance thickness preservation via source-distance scaling

The full implementation recipe is documented in [`VECTOR_LINES_DOSSIER.md`](./VECTOR_LINES_DOSSIER.md).

## Current Focus

This repository should be read as a compact reference implementation for:

- custom shader injection into vector line materials in iTowns,
- reusable fat-line handling for globe data,
- runtime experimentation with projection and line-thickness behavior.

## Known Limitations

- Parts of the road pipeline are still coupled to the current road schema and could be further generalized.
- The production bundle is fairly large and could benefit from code-splitting.

## License

Licensed under the Apache License, Version 2.0. See [`LICENSE`](./LICENSE).
