# iTowns Stereographic Shader Experiments

This repository is an experimentation lab for rendering roads over iTowns globes with custom projection shaders and controllable line-thickness behavior.

It includes:
- multi-globe interaction prototypes,
- stereographic and cone projection experiments,
- vector road rendering with `LineSegments2` fat lines,
- per-road width mapping and runtime thickness controls,
- drag-and-drop GPX path import with persistent path list controls.

## Quick Start

### Prerequisites
- Node.js 18+ (recommended)
- npm

### Install
```bash
npm install
```

### Run locally
```bash
npm run dev
```

Vite is configured for HTTPS using local cert files (`localhost.pem` / `localhost-key.pem`).  
If your browser warns about the certificate, trust/accept it for local development.
Local dev base path is `/`, so URLs are `https://localhost:<port>/` without a repository-name subpath.

### Build
```bash
npm run build
```

Build output is written to `dist/`.

## GitHub Pages Deployment (GitHub Actions)

Deployment is handled automatically by:
- [deploy-pages.yml](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/.github/workflows/deploy-pages.yml)

Trigger conditions:
- push to `main`
- manual run (`workflow_dispatch`)

What the workflow does:
1. `npm ci`
2. `npm run build`
3. uploads `dist/` as a Pages artifact
4. deploys with `actions/deploy-pages`

Repository setting required once:
- GitHub repository `Settings -> Pages -> Build and deployment -> Source = GitHub Actions`

## Project Map

- [index.html](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/index.html): current default entry page.
- [main.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/main.js): runtime orchestrator (thin entrypoint).
- [setupView.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/view/setupView.js): globe view + base layers bootstrap.
- [state.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/roads/state.js): roads config/registry + persisted render state.
- [index.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/projection/index.js): projection controller, uniforms, shader patch logic.
- [renderer.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/roads/renderer.js): roads orchestration (layer + pipeline + UI + frame sync wiring).
- [fatLinePipeline.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/roads/fatLinePipeline.js): pipeline orchestrator composing geometry/materials/tile-lifecycle modules.
- [geometry.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/roads/pipeline/geometry.js): segment sanitization, grouping, and source mesh traversal.
- [materials.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/roads/pipeline/materials.js): line material cache + global thickness/depth state application.
- [tileLifecycle.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/roads/pipeline/tileLifecycle.js): per-tile anchor lifecycle, rebuild queue, frustum propagation.
- [layer.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/roads/layer.js): WFS roads source + DEM altitude draping.
- [frameSync.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/roads/frameSync.js): per-frame uniforms and anchor sync.
- [ui.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/roads/ui.js): roads settings UI and events.
- [gpxPaths.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/roads/gpxPaths.js): GPX drag-drop import, persistence, per-path controls, and fat-line rendering.
- [VECTOR_LINES_DOSSIER.md](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/VECTOR_LINES_DOSSIER.md): reproducible implementation guide for vector rendering and thickness modes.

## Data Sources Used

- IGN WMTS orthophotos (`ORTHOIMAGERY.ORTHOPHOTOS`)
- IGN WMTS elevation (`ELEVATION.ELEVATIONGRIDCOVERAGE.SRTM3`)
- IGN WFS roads (`BDTOPO_V3:troncon_de_route`)

## Line Thickness Modes (Summary)

In the roads pipeline (`src/roads/fatLinePipeline.js` + `src/roads/state.js`):
- Per-road variable width: `RoadGlobalState.useIndividualWidths = true` and `batchId`-based width lookup from road properties (`nature`).
- Uniform width: `RoadGlobalState.useIndividualWidths = false`.
- Global scaling: `RoadGlobalState.widthMultiplier`.
- GPX path scaling: `defaultRoadWidth * RoadGlobalState.widthMultiplier * RoadGlobalState.pathsWidthMultiplier`.
- Screen-space fixed thickness: `LineMaterial.worldUnits = false`.
- World-space/perspective thickness: `LineMaterial.worldUnits = true`.

See the full walkthrough in [VECTOR_LINES_DOSSIER.md](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/VECTOR_LINES_DOSSIER.md).

## Known Issues / TO DO

- Multiple `main-*.js` variants duplicate large sections of logic; shared modules would reduce maintenance risk.
- Road rendering modules are now split, but they are still tightly coupled to current road schema (`nature`) and should be parameterized for generic reuse.
