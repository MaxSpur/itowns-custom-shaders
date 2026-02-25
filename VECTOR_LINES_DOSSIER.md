# iTowns Vector Lines Dossier

## Goal
Document exactly how this project loads vector road data on a globe, converts it to custom fat lines, applies stereographic/cone shader deformation, and supports variable/fixed/perspective thickness so the pattern can be reused in other iTowns projects.

Primary reference implementation: [main-latest.js](/Users/MadMax/Developer/Websites/iTowns/itowns-stereographic-shader/main-latest.js)

## Architecture Overview

1. Load vector roads with `WFSSource` + `FeatureGeometryLayer`.
2. Use `batchId` to keep feature identity for per-road width mapping.
3. On each created road mesh, rebuild geometry into `LineSegmentsGeometry`.
4. Render with `LineSegments2` + `LineMaterial` (fat lines).
5. Patch material shaders (`onBeforeCompile`) to project vertices to sphere/cone.
6. Update shader uniforms and material resolution every frame.
7. Expose UI toggles for visibility, projection, culling, and thickness modes.

## 1) Vector Loading and Altitude Binding

The project uses IGN BDTOPO roads:

```js
const roadsSource = new itowns.WFSSource({
  url: 'https://data.geopf.fr/wfs/ows?',
  version: '2.0.0',
  typeName: 'BDTOPO_V3:troncon_de_route',
  crs: 'EPSG:4326',
  format: 'application/json',
  zoom: { min: 12, max: 15 },
});
```

Layer setup:
- `mergeFeatures: true` so iTowns emits grouped geometry with usable attributes.
- `batchId: (properties) => registerRoadFeature(properties)` to attach per-feature ids.
- `style.stroke.base_altitude` reads DEM altitude (`itowns.DEMUtils.getElevationValueAt`) so roads sit on terrain.

## 2) Feature Identity and Width Registry

Road class (`properties.nature`) is mapped to base widths using `ROAD_WIDTH_BASE`.  
`registerRoadFeature` creates/stores a stable `batchId` and width:

- key lookup: `id`, `pk`, `gid`, etc.
- width store: `RoadFeatureRegistry.widthByBatchId`.

This makes per-feature widths recoverable after geometry batching.

## 3) Fat-Line Conversion Pipeline

When iTowns creates a road tile mesh:

1. `roadsLayer.onMeshCreated` schedules processing.
2. `processRoadTileRoot` traverses mesh/line objects.
3. Vertices are copied into custom groups with guards:
   - skip non-finite coordinates,
   - skip near-origin garbage segments,
   - bake transforms into target space.
4. Build `LineSegmentsGeometry` groups.
5. Instantiate `LineSegments2` with cached `LineMaterial`.
6. Hide original iTowns line/mesh materials (`visible = false`).

Anchoring detail:
- Fat lines are parented to `RoadFatLineRoot` via a tile anchor matrix to stay aligned with source tile transforms.

## 4) Custom Projection Shader Injection

`makeStereoProjectMaterial(material)` patches shader source in `onBeforeCompile` and injects uniforms:

- sphere uniforms: center/radius/basis,
- cone uniforms: apex/axis/slope/top,
- controls: projection enabled, cull enabled, view radius, ground center.

The patch rewrites line start/end world positions and applies:
- `inverseStereoProject(...)` in sphere mode,
- `inverseConeProject(...)` in cone mode,
- optional backface/hemisphere culling.

Key point: the projection is material-level and reusable for any geometry rendered through these materials.

## 5) Thickness Modes (Variable / Fixed / Perspective)

All modes are driven by:
- `RoadGlobalState.useIndividualWidths`
- `RoadGlobalState.widthMultiplier`
- `RoadGlobalState.useWorldUnits`

### A. Variable thickness (per road type)
- Set `useIndividualWidths = true`.
- Width comes from `ROAD_WIDTH_BASE[nature]` via `batchId` lookup.
- Final width = `baseWidth * widthMultiplier`.

### B. Fixed thickness (uniform across roads)
- Set `useIndividualWidths = false`.
- All groups use a common base width (`2` in this implementation).
- Final width still multiplied by `widthMultiplier`.

### C. Perspective thickness (distance-aware)
- Set `useWorldUnits = true`.
- `LineMaterial.linewidth` is interpreted in world units (meters), so apparent on-screen width changes with distance/FOV.

### D. Fixed-screen thickness (pixel-like)
- Set `useWorldUnits = false`.
- Thickness remains screen-space-like and mostly stable in pixels.
- Requires `material.resolution` sync when renderer size changes.

## 6) Frame Sync Requirements

In `BEFORE_RENDER`:
- update renderer size and copy to `RoadGlobalState.resolution`,
- call `syncMaterialResolutions()`,
- update projection uniforms from current camera and sphere/cone controller state,
- keep road tile anchors synced to source tile transforms.

Without this loop, thickness and projection will drift or break during camera movement/resizing.

## 7) Porting Recipe (Minimal)

1. Copy/import fat-line deps:
   - `LineMaterial`, `LineSegments2`, `LineSegmentsGeometry`.
2. Create a dedicated root group for generated fat lines.
3. Build `WFSSource` + `FeatureGeometryLayer` with:
   - `batchId`,
   - `style.stroke.base_altitude`.
4. Convert source geometry to `LineSegmentsGeometry` on mesh creation.
5. Render via cached `LineMaterial` + `LineSegments2`.
6. Patch material shader with your projection logic.
7. Add a per-frame sync for:
   - `material.resolution`,
   - projection uniforms,
   - transform anchors.
8. Add state toggles (`useIndividualWidths`, `widthMultiplier`, `useWorldUnits`) and reapply/rebuild as needed.

## 8) Practical Notes

- `LineMaterial` resolution sync is mandatory for correct widths.
- Rebuilding all tiles on each slider change is expensive; cache and selective rebuilds are preferable.
- The current codebase contains many experimental variants; extract shared modules before reusing in production.

## Problems / TO DO

- Extract reusable modules:
  - `road-source.ts/js`
  - `fatline-conversion.ts/js`
  - `stereo-shader-patch.ts/js`
  - `road-state-ui.ts/js`
- Reduce repeated shader code across multiple `main-*.js` files.
- Decide a single canonical runtime entry for the roads projection demo and wire it from `index.html`.
