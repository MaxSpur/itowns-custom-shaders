# CODEX_MEMO

## CURRENT_TASK
Promote vector-rendering implementation as root entry point and archive multi-globe script under `Experimental/`.

## CURRENT_SUBTASK
Swap root `main.js` with `Experimental/main-latest.js` while preserving intent/history.

## SESSION INSIGHTS
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

## Problems / TO DO
- Consolidate duplicated road/shader code across many `main-*.js` files into shared modules (source setup, fat-line conversion, shader patching, UI state).
- Clarify which file is the official demo entry for roads projection; currently `index.html` points to `main.js`, while the target implementation sits in `main-latest.js`.
- `package.json` uses `"type": "commonjs"` while source files are ESM (`import` syntax); this can confuse tooling/readers.
- Complete the cleanup commit that removes tracked generated/local artifacts (`node_modules`, build folders, local certs, `.DS_Store`) so `.gitignore` fully takes effect in history.
