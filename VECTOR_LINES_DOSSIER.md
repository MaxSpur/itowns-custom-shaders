# Standalone Guide: Efficient Vector Fat Lines in iTowns

## Purpose
Use this guide to build a reusable vector-line pipeline for iTowns that supports:
- terrain-draped vectors,
- high-quality thick lines (`LineSegments2`),
- variable/fixed/perspective thickness,
- many distinct colors (including per-path GPX colors),
- GPX-first workflows (drag-drop import + persisted path controls),
- optional custom shader deformation,
- stable long-session behavior (bounded processing retries + cleanup disposal).

This document is self-contained and can be ported to another project directly.

## Target Architecture
Use five logical modules (file names are up to you):
1. `state`: global toggles and width rules.
2. `layer`: source + `FeatureGeometryLayer` setup.
3. `geometry`: extract/group line segments and ensure color attributes exist.
4. `materials`: material cache and shared material state updates.
5. `lifecycle`: tile/feature queueing, creation, cleanup, rebuild, frustum state.

Optional:
- `frameSync`: per-frame resolution/uniform/anchor sync.
- `projectionShader`: custom `onBeforeCompile` hook.

## Dependencies

```bash
npm install itowns three
```

```js
import * as itowns from 'itowns';
import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
```

## 1) State Model

```js
const LineState = {
  visible: true,
  widthMultiplier: 1.0,
  pathsWidthMultiplier: 1.0,       // GPX-only extra multiplier
  useIndividualWidths: true, // true: per-feature/per-class widths
  useWorldUnits: false,      // false: screen-like width, true: meters/perspective
  worldUnitsUseSourceDistance: true, // projected lines keep original-distance thickness
  depthTest: true,           // false: ghost/always-on-top style
  useProjection: true,
  pathsUseProjection: true,  // GPX can be toggled independently from roads
  altitudeOffset: 0.0,
  disableFrustumCulling: false,
  resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
};
```

Recommended width formulas:

```js
const roadWidth = baseRoadWidth * LineState.widthMultiplier;
const gpxWidth = gpxBaseWidth * LineState.widthMultiplier * LineState.pathsWidthMultiplier;
```

Example width defaults:

```js
const BASE_WIDTH = {
  motorway: 10,
  trunk: 8,
  primary: 6,
  secondary: 5,
  residential: 3,
  path: 1.5,
};

function classFromProps(props = {}) {
  return props.highway || props.class || 'residential';
}
```

## 2) Globe + Data Layer

```js
const viewerDiv = document.getElementById('viewerDiv');
const view = new itowns.GlobeView(viewerDiv, {
  coord: new itowns.Coordinates('EPSG:4326', 2.35, 48.85),
  range: 15000,
  tilt: 60,
  heading: 0,
});
```

Vector source example (WFS):

```js
const source = new itowns.WFSSource({
  url: 'https://data.geopf.fr/wfs/ows?',
  version: '2.0.0',
  typeName: 'BDTOPO_V3:troncon_de_route',
  crs: 'EPSG:4326',
  format: 'application/json',
  zoom: { min: 12, max: 16 },
});
```

Alternative source: vector tiles (MVT)

```js
const vtSource = new itowns.VectorTilesSource({
  style: 'https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/standard.json',
  filter: (layer) => !layer['source-layer'].includes('oro_'),
});

const vtFeatureLayer = new itowns.FeatureGeometryLayer('RoadsFromMVT', {
  source: vtSource,
  mergeFeatures: true,
  accurate: false, // always false with VectorTilesSource
  filter: ({ properties = {} }) => !!(properties.highway || properties.class),
  batchId: (props) => registerFeature(props),
});
```

Notes:
- `VectorTilesSource` can also be used directly in a `ColorLayer` for map styling/labels.
- For fat-line reconstruction, keep the `FeatureGeometryLayer` path and run the same geometry/material pipeline shown in this guide.
- If your GPX source is local files, parse GPX to segments in app code and feed those segments into the same `LineSegmentsGeometry` builder used for roads.

### Stable `batchId` registry (needed for robust per-feature widths)

```js
const Registry = {
  keyToBatchId: new Map(),
  widthByBatchId: new Map(),
  nextBatchId: 0,
};

function featureKey(props = {}) {
  return props.id || props.ID || props.gid || props.pk || null;
}

function registerFeature(props = {}) {
  const key = featureKey(props);
  let batchId;

  if (key && Registry.keyToBatchId.has(key)) {
    batchId = Registry.keyToBatchId.get(key);
  } else {
    batchId = Registry.nextBatchId++;
    if (key) Registry.keyToBatchId.set(key, batchId);
  }

  const klass = classFromProps(props);
  Registry.widthByBatchId.set(batchId, BASE_WIDTH[klass] ?? 2);
  return batchId;
}
```

### DEM draping helper

```js
const tmpCoord = new itowns.Coordinates('EPSG:4326', 0, 0, 0);
const demMode = (itowns.DEMUtils && (itowns.DEMUtils.PRECISE_READ_Z || itowns.DEMUtils.FAST_READ_Z)) || 0;

function baseAltitudeFromDEM(ctx, view) {
  const c = Array.isArray(ctx?.coordinates) ? ctx.coordinates[0] : ctx?.coordinates;
  if (!c) return 0;

  const coord = c.isCoordinates
    ? c
    : new itowns.Coordinates(c.crs || 'EPSG:4326', c.x, c.y, c.z || 0);

  if (!itowns.DEMUtils || !view.tileLayer) return coord.z || 0;

  tmpCoord.copy(coord);
  const z = itowns.DEMUtils.getElevationValueAt(view.tileLayer, tmpCoord, demMode);
  return Number.isFinite(z) ? z : (coord.z || 0);
}
```

Layer:

```js
const roadsLayer = new itowns.FeatureGeometryLayer('Roads', {
  source,
  mergeFeatures: true,
  batchId: (props) => registerFeature(props),
  style: {
    stroke: {
      color: (props) => {
        const klass = classFromProps(props);
        return klass === 'motorway' ? '#2e86ff' : '#f7c948';
      },
      base_altitude: (props, ctx) => baseAltitudeFromDEM(ctx, view),
    },
  },
});
```

## 3) Core Improvement: Vertex-Color-First Pipeline

### Why this matters
If you plan GPX visualization with one color per path, one material per color does not scale.

Best practice:
- keep `vertexColors: true` on line materials,
- put actual colors in geometry attributes,
- reuse materials by render state (width/depth/worldUnits), not by color.

This keeps visible output identical while drastically reducing material growth.

## 4) Fat-Line Containers

```js
const fatRoot = new THREE.Group();
fatRoot.name = 'FatLineRoot';
fatRoot.frustumCulled = false;
view.scene.add(fatRoot);

const FatLines = new Set();
const TileAnchors = new Map();
const MaterialCache = new Map();
```

## 5) Geometry Extraction and Grouping

### Segment extraction (always produce positions + colors)

```js
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const fallbackColor = new THREE.Color();

function finite3(x, y, z) {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}

function nearOrigin(x, y, z) {
  return Math.abs(x) < 1 && Math.abs(y) < 1 && Math.abs(z) < 1;
}

function segmentsByBatch(sourceGeom, transformMatrix, fallbackHex) {
  const pos = sourceGeom?.attributes?.position;
  const col = sourceGeom?.attributes?.color;
  const batch = sourceGeom?.attributes?.batchId;
  const index = sourceGeom?.index;
  if (!pos) return [];

  fallbackColor.set(fallbackHex || '#ffffff');
  const fr = fallbackColor.r;
  const fg = fallbackColor.g;
  const fb = fallbackColor.b;

  const hasBatch = !!batch;
  const hasColorAttr = !!col;
  const groups = new Map();

  const getGroup = (batchId) => {
    const key = hasBatch ? batchId : 0;
    if (!groups.has(key)) groups.set(key, { positions: [], colors: [] });
    return groups.get(key);
  };

  const pushSegment = (a, b) => {
    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
    const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
    if (!finite3(ax, ay, az) || !finite3(bx, by, bz)) return;
    if (nearOrigin(ax, ay, az) && nearOrigin(bx, by, bz)) return;

    const group = getGroup(hasBatch ? batch.getX(a) : 0);

    if (transformMatrix) {
      vA.set(ax, ay, az).applyMatrix4(transformMatrix);
      vB.set(bx, by, bz).applyMatrix4(transformMatrix);
      group.positions.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z);
    } else {
      group.positions.push(ax, ay, az, bx, by, bz);
    }

    if (hasColorAttr) {
      group.colors.push(
        col.getX(a), col.getY(a), col.getZ(a),
        col.getX(b), col.getY(b), col.getZ(b),
      );
    } else {
      // Fallback color injection keeps vertex-color path consistent.
      group.colors.push(fr, fg, fb, fr, fg, fb);
    }
  };

  if (index) {
    for (let i = 0; i < index.count; i += 2) pushSegment(index.getX(i), index.getX(i + 1));
  } else {
    for (let i = 0; i < pos.count; i += 2) pushSegment(i, i + 1);
  }

  const out = [];
  for (const [batchId, g] of groups.entries()) {
    if (!g.positions.length) continue;
    out.push({
      batchId: hasBatch ? batchId : null,
      positions: g.positions,
      colors: g.colors,
      hasColors: g.colors.length === g.positions.length,
    });
  }
  return out;
}
```

### Group by width (not by color)

```js
function widthForChunk(chunk, props) {
  if (!LineState.useIndividualWidths) return 2;
  if (chunk.batchId != null) return Registry.widthByBatchId.get(chunk.batchId) ?? 2;
  return BASE_WIDTH[classFromProps(props)] ?? 2;
}

function addChunksToGroups(groups, chunks, props) {
  for (const c of chunks) {
    const baseWidth = widthForChunk(c, props);
    const key = `width|${baseWidth}`;
    if (!groups.has(key)) {
      groups.set(key, {
        baseWidth,
        positions: [],
        colors: [],
        hasColors: true,
      });
    }

    const g = groups.get(key);
    g.positions.push(...c.positions);
    if (g.hasColors && c.hasColors && c.colors) {
      g.colors.push(...c.colors);
    } else {
      g.hasColors = false;
      g.colors.length = 0;
    }
  }
}
```

## 6) Material Manager (Render-State-Keyed)

```js
function materialKey({ baseWidth, hasColors, depthTest, worldUnits }) {
  // No color in key when vertex colors are used.
  return `${baseWidth}|${hasColors ? 1 : 0}|${depthTest ? 1 : 0}|${worldUnits ? 1 : 0}`;
}

function getLineMaterial({ baseWidth, hasColors, fallbackColorHex = 0xffffff }) {
  const key = materialKey({
    baseWidth,
    hasColors,
    depthTest: LineState.depthTest,
    worldUnits: LineState.useWorldUnits,
  });
  if (MaterialCache.has(key)) return MaterialCache.get(key);

  const mat = new LineMaterial({
    color: hasColors ? 0xffffff : fallbackColorHex,
    vertexColors: hasColors,
    linewidth: baseWidth * LineState.widthMultiplier,
    worldUnits: LineState.useWorldUnits,
    depthTest: LineState.depthTest,
    depthWrite: LineState.depthTest,
    transparent: !LineState.depthTest,
    resolution: LineState.resolution,
    dashed: false,
    alphaToCoverage: false,
    polygonOffset: LineState.depthTest,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });

  mat.userData.baseWidth = baseWidth;
  MaterialCache.set(key, mat);
  return mat;
}
```

## 7) Build Fat Lines for One Feature Root

```js
const mTmp = new THREE.Matrix4();
const invTarget = new THREE.Matrix4();

function classColorHex(props) {
  const klass = classFromProps(props);
  return klass === 'motorway' ? '#2e86ff' : '#f7c948';
}

function featureProps(node) {
  return node.userData?.feature?.properties || node.feature?.properties || {};
}

function processFeatureRoot(featureRoot) {
  const target = featureRoot.meshes || featureRoot;
  featureRoot.updateWorldMatrix(true, true);
  target.updateWorldMatrix(true, true);

  const groups = new Map();
  invTarget.copy(target.matrixWorld).invert();

  target.traverse((node) => {
    const isLineLike = node.isMesh || node.isLine || node.isLineSegments;
    if (!isLineLike || !node.geometry || node.userData?.isFatLine || node.userData?.hasProcessedFatLine) return;

    const props = featureProps(node);
    mTmp.copy(node.matrixWorld).premultiply(invTarget);
    const chunks = segmentsByBatch(node.geometry, mTmp, classColorHex(props));
    addChunksToGroups(groups, chunks, props);

    if (node.material) {
      if (Array.isArray(node.material)) node.material.forEach((m) => { if (m) m.visible = false; });
      else node.material.visible = false;
    }

    node.userData.hasProcessedFatLine = true;
  });

  const anchor = new THREE.Group();
  anchor.matrixAutoUpdate = false;
  anchor.userData.isRoadAnchor = true;
  fatRoot.add(anchor);

  for (const g of groups.values()) {
    if (!g.positions.length) continue;

    const geom = new LineSegmentsGeometry();
    geom.setPositions(g.positions);
    if (g.hasColors && g.colors.length === g.positions.length) {
      geom.setColors(g.colors);
    }

    const mat = getLineMaterial({
      baseWidth: g.baseWidth,
      hasColors: g.hasColors,
    });

    const fat = new LineSegments2(geom, mat);
    fat.userData.isFatLine = true;
    fat.userData.baseWidth = g.baseWidth;
    fat.frustumCulled = !LineState.disableFrustumCulling;
    fat.position.set(0, 0, LineState.altitudeOffset);

    anchor.add(fat);
    FatLines.add(fat);
  }

  view.notifyChange(true);
}
```

## 8) Lifecycle Stability (Critical in Production)

### Bounded queue retries (avoid infinite RAF loops)

```js
const ATTACH_RETRY_MAX_ATTEMPTS = 300;
const ATTACH_RETRY_MAX_WAIT_MS = 10000;

function scheduleProcessing(root) {
  if (!root) return;
  root.userData = root.userData || {};
  if (root.userData.hasQueuedFatLine) return;

  root.userData.hasQueuedFatLine = true;
  let attempts = 0;
  const startedAt = performance.now();

  const tick = () => {
    if (!root?.userData?.hasQueuedFatLine) return;

    if (root.parent) {
      try {
        processFeatureRoot(root);
      } catch (err) {
        root.userData.hasQueuedFatLine = false;
        console.error('Failed to process feature root', err);
      }
      return;
    }

    attempts += 1;
    if (attempts >= ATTACH_RETRY_MAX_ATTEMPTS || (performance.now() - startedAt) >= ATTACH_RETRY_MAX_WAIT_MS) {
      root.userData.hasQueuedFatLine = false;
      return;
    }

    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}
```

### Cleanup with geometry disposal

```js
function cleanupFatLine(line) {
  if (!line) return;
  if (line.parent) line.parent.remove(line);
  if (line.geometry && typeof line.geometry.dispose === 'function') {
    line.geometry.dispose();
  }
  FatLines.delete(line);
}
```

Call this in all removal/rebuild paths.

## 9) Frame Sync: Resolution + DPR Without Per-Frame Overhead

```js
const rendererSize = new THREE.Vector2();
let lastW = -1;
let lastH = -1;
let lastDPR = -1;

function syncPerFrame() {
  const renderer = view.mainLoop.gfxEngine.renderer;
  const dpr = Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1;

  if (dpr !== lastDPR) {
    renderer.setPixelRatio(dpr);
    lastDPR = dpr;
  }

  renderer.getSize(rendererSize);
  if (rendererSize.x !== lastW || rendererSize.y !== lastH) {
    lastW = rendererSize.x;
    lastH = rendererSize.y;
    LineState.resolution.set(rendererSize.x, rendererSize.y);

    for (const mat of MaterialCache.values()) {
      mat.resolution.copy(LineState.resolution);
    }
  }
}

view.addFrameRequester(itowns.MAIN_LOOP_EVENTS.BEFORE_RENDER, syncPerFrame);
```

## 10) Optional Shader Hook Pattern

Use `onBeforeCompile` to warp/project line vertices while keeping the fat-line pipeline unchanged.

```js
function patchLineMaterial(material, uniforms) {
  if (material.userData?.patched) return material;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWarpCenter = uniforms.uWarpCenter;
    shader.uniforms.uWarpRadius = uniforms.uWarpRadius;

    const inject = `
uniform vec3 uWarpCenter;
uniform float uWarpRadius;
vec3 applyWarp(vec3 wp){
  float d = distance(wp, uWarpCenter);
  if (d >= uWarpRadius) return wp;
  float t = 1.0 - d / max(uWarpRadius, 1e-6);
  return wp + vec3(0.0, 0.0, 150.0 * t);
}
`;

    let vs = shader.vertexShader;
    vs = inject + vs;
    vs = vs.replace(
      /vec4\s+start\s*=\s*modelViewMatrix\s*\*\s*vec4\s*\(\s*instanceStart\s*,\s*1\.0\s*\)\s*;/,
      `
vec3 wpStart = (modelMatrix * vec4(instanceStart, 1.0)).xyz;
vec3 pStart = applyWarp(wpStart);
vec4 start = viewMatrix * vec4(pStart, 1.0);
`
    );
    vs = vs.replace(
      /vec4\s+end\s*=\s*modelViewMatrix\s*\*\s*vec4\s*\(\s*instanceEnd\s*,\s*1\.0\s*\)\s*;/,
      `
vec3 wpEnd = (modelMatrix * vec4(instanceEnd, 1.0)).xyz;
vec3 pEnd = applyWarp(wpEnd);
vec4 end = viewMatrix * vec4(pEnd, 1.0);
`
    );

    shader.vertexShader = vs;
  };

  material.userData.patched = true;
  return material;
}
```

### Projection + `worldUnits` thickness anchoring (important)

If lines are projected to sphere/cone and `worldUnits = true`, apparent width can become too thick because thickness is computed after projection.

Use a toggle such as `worldUnitsUseSourceDistance` and scale line width in shader using source vs projected depth:

```glsl
float depthOrig = max(abs(startOriginal.z), 1e-4);
float depthProj = max(abs(startProjected.z), 1e-4);
float widthScale = clamp(depthProj / depthOrig, 0.02, 50.0);
```

Then use `linewidth * widthScale` for world-unit expansion. This keeps projected geometry while preserving original map-distance thickness behavior.

## 11) GPX-Specific Notes (Per-Path Colors)

If each path needs a unique color:
1. Keep `vertexColors: true` materials shared.
2. Write each path color into segment color attributes.
3. Group primarily by width/depth/worldUnits.
4. Avoid one material per path color.

This preserves flexibility with much lower material churn.

Recommended GPX data model:

```js
{
  id: 'gpx-...',
  name: 'Morning Ride',
  color: '#43a5ff',
  visible: true,
  segments: [ [ { lat, lon, ele? }, ... ], ... ],
}
```

Recommended parsing fallback order:
1. `trkseg/trkpt`
2. `rte/rtept`
3. `wpt` chain (if there are at least 2 points)

Persist only compact path metadata + coordinates; rebuild `LineSegmentsGeometry` from persisted segments on startup.

## 12) Width/Thickness Modes Summary

- Variable width by class/path: `useIndividualWidths = true`
- Fixed uniform width: `useIndividualWidths = false`
- Global width scaling: `widthMultiplier`
- GPX extra scaling: `pathsWidthMultiplier`
- Screen-like thickness: `useWorldUnits = false`
- Perspective/metric thickness: `useWorldUnits = true`
- Projected geometry with source-distance thickness: `useWorldUnits = true` + `worldUnitsUseSourceDistance = true`

## 13) Common Failure Modes

- Lines disappear after resize:
  `LineMaterial.resolution` not updated.
- Width controls appear ignored:
  cached materials not re-applied after state change.
- Duplicate lines over time:
  stale anchors/old fat lines not cleaned before rebuild.
- Memory growth in long sessions:
  line geometries removed but not disposed.
- Infinite processing loop:
  retry queue has no time/attempt limit for unattached roots.
- Projected lines look too thick and clumped:
  world-units thickness is computed from projected positions; add source-distance width scaling toggle.

## 14) Performance Checklist

1. Prefer vertex colors + shared materials.
2. Group by width/render state, not by unique color when possible.
3. Rebuild only when needed (width schema changes, major toggles).
4. Dispose line geometries on cleanup.
5. Avoid per-frame renderer state calls unless values changed.
6. Keep frustum strategy explicit; disabling globally can be expensive.
7. For GPX-heavy use, persist path segments and rebuild transient Three.js objects on load.
