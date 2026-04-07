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

## How To Use It

When the app starts, it opens near Vincennes, east of Paris. Orthophotos and elevation load first, then the IGN road vectors are converted into fat lines automatically. The UI has three main controls:

- the search field at the top: jumps quickly to a place or address using the built-in iTowns search widget,
- `Projection Controls` on the left: defines the helper sphere/cone surface and where the custom projection is centered,
- `Road Settings` on the right: controls how the roads and imported GPX paths are rendered.

The road-panel settings and the imported GPX path list are stored locally in the browser, so they survive a page reload.

### Basic interaction flow

1. Use the search field to jump to an area quickly. The current geocoding endpoint starts returning suggestions from 3 characters onward.
2. Start with the left panel and place the projection center:
   click `Place @ center` to move the sphere/cone to the point currently under the camera target, or click `Pick (S)` and then click directly on the globe. You can also hold the `S` key and click on the globe without toggling the button manually.
3. Switch between `Sphere` and `Cone` to choose the projection surface.
4. Adjust `View Radius (m)` to control how large the affected area is around the picked center.
5. Adjust `Intersection` to control how the helper surface intersects the globe.
6. In cone mode, adjust `Cone height` to stretch or compress the cone. Double-clicking that slider resets it to `1.0x`.
7. Use `Opacity` to change the visibility of the red helper surface itself. This affects the sphere/cone visualization, not the road line opacity.
8. Use the right panel to decide whether roads and GPX paths should actually be projected, how thick they should appear, and when to flush already loaded road data.

### Road Settings panel

- `Visibility`: shows or hides all road vectors. This affects the rendered fat-line roads, not the helper sphere/cone and not GPX paths.
- `Always On Top (Ghost)`: draws roads without normal depth testing so they remain visible above terrain and imagery. Useful for inspection, less realistic for presentation.
- `Stereographic Projection`: enables or disables the custom projection for roads globally. If this is off, the roads stay on the globe even if the helper sphere/cone is visible.
- `Cull Backfaces (Sphere)`: hides the outward-facing side of the projected surface so you can look “into” the sphere/cone instead of seeing the far shell.
- `Disable Frustum Culling`: prevents projected lines from being discarded by normal view-frustum checks. This is useful if projected geometry disappears unexpectedly, but it is more expensive.
- `Per-Road Widths`: switches between width-by-road-type and a more uniform baseline width.
- `Width Multiplier`: multiplies all road widths globally.
- `Elevation Offset`: lifts or lowers the road lines relative to the terrain.
- `Clear Loaded Roads Cache`: flushes the currently loaded road tiles and the custom fat-line geometry, then reloads road data only for the current area. This is useful after exploring one dense zone and then moving far away.
- `World Units (Meters)`: changes thickness from screen-like width to world-space/perspective width.
- `Projected Width Uses Source Distance`: when `World Units` is enabled and projection is active, this keeps projected lines looking as if their thickness were based on their original map distance instead of the projected sphere/cone surface distance. This avoids distant projected lines becoming visually clumped and too thick.

### GPX paths

You can drag `.gpx` files directly onto the page. Each imported path:

- gets its own color,
- is listed in the `GPX Paths` section,
- persists across page reloads,
- can be toggled individually,
- can be deleted individually.

The GPX-specific controls are:

- `Paths Width Multiplier`: extra width multiplier applied on top of the main road `Width Multiplier`.
- `Apply Projection To Paths`: lets GPX paths follow or ignore the custom projection independently from the roads.

GPX paths also inherit the main rendering behavior from the road panel where applicable:

- `Always On Top (Ghost)`
- `Elevation Offset`
- `World Units (Meters)`
- `Projected Width Uses Source Distance`
- `Disable Frustum Culling`
- `Cull Backfaces (Sphere)`

### What to try first

1. Search for a place or address near the area you want to inspect.
2. Click `Place @ center`.
3. Turn on `Stereographic Projection`.
4. Switch between `Sphere` and `Cone`.
5. Increase `View Radius (m)` and adjust `Intersection`.
6. Turn `World Units (Meters)` on and off to compare line thickness behavior.
7. With `World Units` enabled, toggle `Projected Width Uses Source Distance` to compare projected-distance thickness versus original-distance thickness.
8. Move far away, click `Clear Loaded Roads Cache`, and let the roads reload around the new area.
9. Drop in one or two GPX files and compare `Apply Projection To Paths` on and off.

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
- IGN GeoPF geocoding completion service: `https://data.geopf.fr/geocodage/completion`

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
