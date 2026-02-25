# CODEX_MEMO

## CURRENT_TASK
Stabilize and continue modularizing roads rendering; remove hardcoded Vite base path for local dev portability.

## CURRENT_SUBTASK
Recovered broken `src/roads/renderer.js`, split heavy logic into `fatLinePipeline.js`, switched Vite base-path handling to dynamic env-driven behavior, and synced README module map.

## SESSION INSIGHTS
- `main.js` is now a thin orchestrator that wires modules.
- New module structure added:
  - [setupView.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/view/setupView.js): view + base layers + fat-line root.
  - [state.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/roads/state.js): road config, feature registry, global render state, localStorage persistence.
  - [panelStyles.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/ui/panelStyles.js): shared UI style helpers/constants.
  - [index.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/projection/index.js): sphere/cone projection controller, widget, shader patching, projection uniforms.
  - [renderer.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/roads/renderer.js): thin orchestration layer for roads setup (layer + pipeline + UI + frame sync).
  - [fatLinePipeline.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/roads/fatLinePipeline.js): road geometry grouping, fat-line generation, material cache, tile anchor lifecycle, rebuild/frustum/update controls.
  - [layer.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/roads/layer.js): WFS source + DEM altitude style resolver.
  - [frameSync.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/roads/frameSync.js): BEFORE_RENDER uniform/resolution/tile-anchor sync.
  - [ui.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/src/roads/ui.js): roads control panel wiring.
- `npm run build` succeeds after the split.
- Root entry file now points to vector/fat-line implementation (`main.js` content from former `Experimental/main-latest.js`).
- Former root multi-globe script moved to `Experimental/main-multi-globe.js`.
- `VECTOR_LINES_DOSSIER.md` was fully rewritten as a standalone guide with no dependency on local project files/functions.
- New dossier now includes reusable snippets for:
  - `WFSSource` and `FileSource` vector ingestion,
  - `FeatureGeometryLayer` setup with `batchId` and DEM altitude draping,
  - conversion to `LineSegments2` fat lines,
  - material caching/sync,
  - variable/fixed/perspective thickness modes,
  - generic shader patching via `onBeforeCompile`.
- GitHub Pages deployment now uses a dedicated workflow at [deploy-pages.yml](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/.github/workflows/deploy-pages.yml) (build artifact from `dist/` + `actions/deploy-pages`).
- Added repository-level [.gitignore](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/.gitignore) for `node_modules/`, build outputs, local certs, logs, and macOS artifacts.
- `vite.config.js` is now CI-safe: local certs are loaded only for `vite serve` and only if files exist.
- `vite.config.js` base path is now dynamic:
  - `vite serve` always uses `/` (no repo-name subpath in localhost URLs).
  - `vite build` uses `VITE_BASE_PATH` when provided.
  - Otherwise in CI it derives from `GITHUB_REPOSITORY` (e.g. `/repo-name/`).
  - Fallback is `/`.
- Build output moved to `dist/` (instead of `docs/`) for Actions artifact deployment.
- Legacy `gh-pages` dependency removed; deployment is action-driven.
- `README.md` now documents setup, key files, data sources, thickness-mode summary, and known issues.
- `VECTOR_LINES_DOSSIER.md` now captures a direct porting recipe for:
  - WFS vector loading on iTowns globe,
  - fat-line conversion (`LineSegments2`),
  - shader injection (`onBeforeCompile`) for sphere/cone projection,
  - variable/fixed/perspective thickness behaviors.
- Primary runtime entry is [index.html](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/index.html), which currently loads [main.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/main.js) (multi-globe interaction focus, no roads pipeline wired there).
- The full vector + custom shader pipeline is implemented in [main-latest.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/main-latest.js).
- Line-thickness behavior in the roads pipeline is controlled by:
  - `RoadGlobalState.useIndividualWidths` (variable per road class vs uniform base width),
  - `RoadGlobalState.widthMultiplier` (global scalar),
  - `RoadGlobalState.useWorldUnits` (screen-space/fixed px thickness vs world-space/perspective thickness).
- Vector data source is IGN BDTOPO WFS (`BDTOPO_V3:troncon_de_route`) through `itowns.WFSSource` + `FeatureGeometryLayer`.
- The project has many experimental `main-*.js` variants with overlapping logic; this is useful history but high maintenance overhead.
- `npm run build` currently passes with the modularized pipeline and dynamic base-path config.

## Problems / TO DO
- Consolidate duplicated road/shader code across many `main-*.js` files into shared modules (source setup, fat-line conversion, shader patching, UI state).
- Clarify which file is the official demo entry for roads projection; currently `index.html` points to `main.js`, while the target implementation sits in `main-latest.js`.
- `package.json` uses `"type": "commonjs"` while source files are ESM (`import` syntax); this can confuse tooling/readers.
- Complete the cleanup commit that removes tracked generated/local artifacts (`node_modules`, build folders, local certs, `.DS_Store`) so `.gitignore` fully takes effect in history.
- Production bundle is large (~1.25 MB minified JS); consider code-splitting/manual chunks to reduce load and keep deployment lighter.
