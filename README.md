# iTowns Stereographic Shader Experiments

This repository is an experimentation lab for rendering roads over iTowns globes with custom projection shaders and controllable line-thickness behavior.

It includes:
- multi-globe interaction prototypes,
- stereographic and cone projection experiments,
- vector road rendering with `LineSegments2` fat lines,
- per-road width mapping and runtime thickness controls.

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
- [main.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/main.js): current default runtime script (multi-globe camera/interaction work).
- [main-latest.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/main-latest.js): most complete roads + custom projection + width controls pipeline.
- [VECTOR_LINES_DOSSIER.md](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/VECTOR_LINES_DOSSIER.md): reproducible implementation guide for vector rendering and thickness modes.

## Data Sources Used

- IGN WMTS orthophotos (`ORTHOIMAGERY.ORTHOPHOTOS`)
- IGN WMTS elevation (`ELEVATION.ELEVATIONGRIDCOVERAGE.SRTM3`)
- IGN WFS roads (`BDTOPO_V3:troncon_de_route`)

## Line Thickness Modes (Summary)

In the roads pipeline (`main-latest.js`):
- Per-road variable width: `RoadGlobalState.useIndividualWidths = true` and `batchId`-based width lookup from road properties (`nature`).
- Uniform width: `RoadGlobalState.useIndividualWidths = false`.
- Global scaling: `RoadGlobalState.widthMultiplier`.
- Screen-space fixed thickness: `LineMaterial.worldUnits = false`.
- World-space/perspective thickness: `LineMaterial.worldUnits = true`.

See the full walkthrough in [VECTOR_LINES_DOSSIER.md](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/VECTOR_LINES_DOSSIER.md).

## Known Issues / TO DO

- Multiple `main-*.js` variants duplicate large sections of logic; shared modules would reduce maintenance risk.
- `index.html` currently points to `main.js` while the advanced roads/shader implementation lives in `main-latest.js`.
- `package.json` declares `"type": "commonjs"` although project source is ESM-style (`import` syntax).
