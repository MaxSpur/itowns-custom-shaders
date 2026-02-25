# Standalone Guide: Vector Rendering in iTowns

## Purpose
This document is a standalone recipe for loading and rendering vector lines in iTowns with:
- reliable terrain draping,
- high-quality "fat lines" (thick lines),
- variable vs fixed line thickness,
- perspective-aware thickness,
- optional custom shader deformation.

You can copy these patterns into another iTowns project without needing any other file.

## What You Build
1. A `GlobeView`.
2. A vector layer (`FeatureGeometryLayer`) sourced from WFS (or file).
3. A conversion pipeline from iTowns default line geometry to `LineSegments2` fat lines.
4. A render state model supporting:
   - variable widths by feature class,
   - fixed uniform width,
   - screen-space thickness,
   - world-space/perspective thickness.
5. A shader hook (`onBeforeCompile`) for custom projection or warping.

## Dependencies

```bash
npm install itowns three
```

Import these in your app:

```js
import * as itowns from 'itowns';
import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
```

## 1) Core State Model

This state is enough to control most line rendering behavior:

```js
const LineRenderState = {
  visible: true,
  widthMultiplier: 1.0,
  useIndividualWidths: true, // variable widths by feature class
  useWorldUnits: false,      // false=pixel-like, true=meters/perspective
  depthTest: true,           // true=normal depth, false=always-on-top style
  altitudeOffset: 0.0,       // meters above terrain
  resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
};
```

Feature-class width mapping example:

```js
const BASE_WIDTH_BY_CLASS = {
  motorway: 10,
  trunk: 8,
  primary: 6,
  secondary: 5,
  tertiary: 4,
  residential: 2.5,
  path: 1.5,
};

function getFeatureClass(props) {
  return props.highway || props.class || 'residential';
}
```

## 2) View Setup (Minimal)

```js
const viewerDiv = document.getElementById('viewerDiv');
const placement = {
  coord: new itowns.Coordinates('EPSG:4326', 2.35, 48.85, 0),
  range: 15000,
  tilt: 60,
  heading: 0,
};
const view = new itowns.GlobeView(viewerDiv, placement);
```

Optional imagery/elevation:

```js
const ortho = new itowns.ColorLayer('Ortho', {
  source: new itowns.WMTSSource({
    url: 'https://data.geopf.fr/wmts?',
    crs: 'EPSG:3857',
    name: 'ORTHOIMAGERY.ORTHOPHOTOS',
    tileMatrixSet: 'PM',
    format: 'image/jpeg',
  }),
});
view.addLayer(ortho);

const dem = new itowns.ElevationLayer('DEM', {
  source: new itowns.WMTSSource({
    url: 'https://data.geopf.fr/wmts?',
    crs: 'EPSG:4326',
    name: 'ELEVATION.ELEVATIONGRIDCOVERAGE.SRTM3',
    tileMatrixSet: 'WGS84G',
    format: 'image/x-bil;bits=32',
    zoom: { min: 2, max: 14 },
  }),
});
view.addLayer(dem);
```

## 3) Vector Source + Feature Layer

WFS example:

```js
const roadsSource = new itowns.WFSSource({
  url: 'https://data.geopf.fr/wfs/ows?',
  version: '2.0.0',
  typeName: 'BDTOPO_V3:troncon_de_route',
  crs: 'EPSG:4326',
  format: 'application/json',
  zoom: { min: 12, max: 16 },
});
```

Local GeoJSON alternative:

```js
const roadsSource = new itowns.FileSource({
  url: '/data/roads.geojson',
  crs: 'EPSG:4326',
  fetcher: itowns.Fetcher.json,
  parser: itowns.GeoJsonParser.parse,
});
```

Batch IDs are important for per-feature width recovery:

```js
const Registry = {
  keyToBatchId: new Map(),
  widthByBatchId: new Map(),
  nextBatchId: 0,
};

function getFeatureKey(props = {}) {
  return props.id || props.ID || props.gid || props.pk || null;
}

function registerFeature(props = {}) {
  const key = getFeatureKey(props);
  let batchId = Registry.nextBatchId++;
  if (key && Registry.keyToBatchId.has(key)) {
    batchId = Registry.keyToBatchId.get(key);
  } else if (key) {
    Registry.keyToBatchId.set(key, batchId);
  }

  const klass = getFeatureClass(props);
  Registry.widthByBatchId.set(batchId, BASE_WIDTH_BY_CLASS[klass] ?? 2);
  return batchId;
}
```

Terrain draping helper:

```js
const tempCoord = new itowns.Coordinates('EPSG:4326', 0, 0, 0);
const demReadMode =
  (itowns.DEMUtils && (itowns.DEMUtils.PRECISE_READ_Z || itowns.DEMUtils.FAST_READ_Z)) || 0;

function baseAltitudeFromDEM(props, ctx, view) {
  const c = Array.isArray(ctx?.coordinates) ? ctx.coordinates[0] : ctx?.coordinates;
  if (!c) return 0;
  const coord = c.isCoordinates
    ? c
    : new itowns.Coordinates(c.crs || 'EPSG:4326', c.x, c.y, c.z || 0);

  if (!itowns.DEMUtils || !view.tileLayer) return coord.z || 0;
  tempCoord.copy(coord);
  const z = itowns.DEMUtils.getElevationValueAt(view.tileLayer, tempCoord, demReadMode);
  return Number.isFinite(z) ? z : (coord.z || 0);
}
```

Layer creation:

```js
const roadsLayer = new itowns.FeatureGeometryLayer('Roads', {
  source: roadsSource,
  mergeFeatures: true,
  batchId: (props) => registerFeature(props),
  style: {
    stroke: {
      color: (props) => (getFeatureClass(props) === 'motorway' ? '#2e86ff' : '#f7c948'),
      base_altitude: (props, ctx) => baseAltitudeFromDEM(props, ctx, view),
    },
  },
});
```

## 4) Fat-Line Conversion Pipeline

### Why convert?
iTowns default line rendering is usually not enough for robust thick-line cartography.  
`LineSegments2` + `LineMaterial` gives controllable thick lines.

### Runtime containers

```js
const fatLineRoot = new THREE.Group();
fatLineRoot.name = 'FatLineRoot';
view.scene.add(fatLineRoot);

const FatLines = new Set();
const MaterialCache = new Map();
```

### Geometry sanitation helpers

```js
function finite3(x, y, z) {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}

function nearOrigin(x, y, z) {
  return Math.abs(x) < 1 && Math.abs(y) < 1 && Math.abs(z) < 1;
}
```

### Group source geometry by batchId

```js
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();

function segmentsByBatch(sourceGeom, transformMatrix) {
  const pos = sourceGeom?.attributes?.position;
  const col = sourceGeom?.attributes?.color;
  const batch = sourceGeom?.attributes?.batchId;
  const index = sourceGeom?.index;
  if (!pos) return [];

  const groups = new Map();
  const hasBatch = !!batch;
  const hasColor = !!col;

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

    const g = getGroup(hasBatch ? batch.getX(a) : 0);
    if (transformMatrix) {
      vA.set(ax, ay, az).applyMatrix4(transformMatrix);
      vB.set(bx, by, bz).applyMatrix4(transformMatrix);
      g.positions.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z);
    } else {
      g.positions.push(ax, ay, az, bx, by, bz);
    }

    if (hasColor) {
      g.colors.push(
        col.getX(a), col.getY(a), col.getZ(a),
        col.getX(b), col.getY(b), col.getZ(b),
      );
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
      colors: hasColor && g.colors.length === g.positions.length ? g.colors : null,
      hasColors: hasColor && g.colors.length === g.positions.length,
    });
  }
  return out;
}
```

### Create/reuse material

```js
function getFatLineMaterial({ baseWidth, colorHex, hasColors }) {
  const key = `${baseWidth}|${colorHex}|${hasColors ? 1 : 0}`;
  if (MaterialCache.has(key)) return MaterialCache.get(key);

  const mat = new LineMaterial({
    color: hasColors ? 0xffffff : colorHex,
    vertexColors: hasColors,
    linewidth: baseWidth * LineRenderState.widthMultiplier,
    worldUnits: LineRenderState.useWorldUnits,
    depthTest: LineRenderState.depthTest,
    depthWrite: LineRenderState.depthTest,
    transparent: !LineRenderState.depthTest,
    resolution: LineRenderState.resolution,
  });

  mat.userData = mat.userData || {};
  mat.userData.baseWidth = baseWidth;

  MaterialCache.set(key, mat);
  return mat;
}
```

### Process one created feature root

```js
const mTmp = new THREE.Matrix4();
const invTarget = new THREE.Matrix4();

function processFeatureRoot(featureRoot) {
  if (!featureRoot) return;
  const target = featureRoot.meshes || featureRoot;
  featureRoot.updateWorldMatrix(true, true);
  target.updateWorldMatrix(true, true);

  invTarget.copy(target.matrixWorld).invert();
  const grouped = [];

  target.traverse((node) => {
    if (!(node.isMesh || node.isLine || node.isLineSegments)) return;
    if (!node.geometry) return;

    mTmp.copy(node.matrixWorld).premultiply(invTarget);
    const chunks = segmentsByBatch(node.geometry, mTmp);
    for (const c of chunks) {
      const props = node.userData?.feature?.properties || {};
      const klass = getFeatureClass(props);
      const classColor = klass === 'motorway' ? 0x2e86ff : 0xf7c948;
      const baseWidth = LineRenderState.useIndividualWidths
        ? (Registry.widthByBatchId.get(c.batchId) ?? (BASE_WIDTH_BY_CLASS[klass] ?? 2))
        : 2;

      grouped.push({ ...c, baseWidth, color: classColor });
    }

    if (node.material) {
      if (Array.isArray(node.material)) node.material.forEach((m) => { if (m) m.visible = false; });
      else node.material.visible = false;
    }
  });

  for (const g of grouped) {
    const geom = new LineSegmentsGeometry();
    geom.setPositions(g.positions);
    if (g.hasColors && g.colors) geom.setColors(g.colors);

    const mat = getFatLineMaterial({
      baseWidth: g.baseWidth,
      colorHex: g.color,
      hasColors: g.hasColors,
    });

    const fat = new LineSegments2(geom, mat);
    fat.userData.baseWidth = g.baseWidth;
    fat.position.set(0, 0, LineRenderState.altitudeOffset);
    fatLineRoot.add(fat);
    FatLines.add(fat);
  }

  view.notifyChange(true);
}
```

Connect to iTowns:

```js
roadsLayer.onMeshCreated = (root) => requestAnimationFrame(() => processFeatureRoot(root));
view.addLayer(roadsLayer);
```

Production note: when tiles update, add cleanup/dedup logic so old fat lines are removed and not duplicated.

## 5) Width Modes You Need

### Variable width (by class/feature)
- `LineRenderState.useIndividualWidths = true`
- width is read from feature class mapping (or `batchId` registry)

### Fixed uniform width
- `LineRenderState.useIndividualWidths = false`
- one base width for all lines

### Perspective-aware thickness
- `LineRenderState.useWorldUnits = true`
- thickness is in meters, so apparent width changes with camera distance

### Fixed screen thickness
- `LineRenderState.useWorldUnits = false`
- thickness behaves like pixel width

## 6) Keep Materials in Sync

You must update line material `resolution` on resize, and optionally re-apply toggles:

```js
const rendererSize = new THREE.Vector2();

function syncLineMaterials() {
  const renderer = view.mainLoop.gfxEngine.renderer;
  renderer.getSize(rendererSize);
  LineRenderState.resolution.copy(rendererSize);

  for (const mat of MaterialCache.values()) {
    mat.resolution.copy(LineRenderState.resolution);
    const base = mat.userData?.baseWidth ?? 2;
    mat.linewidth = base * LineRenderState.widthMultiplier;
    mat.worldUnits = LineRenderState.useWorldUnits;
    mat.depthTest = LineRenderState.depthTest;
    mat.depthWrite = LineRenderState.depthTest;
    mat.transparent = !LineRenderState.depthTest;
    mat.needsUpdate = true;
  }
}

view.addFrameRequester(itowns.MAIN_LOOP_EVENTS.BEFORE_RENDER, syncLineMaterials);
```

## 7) Shader Extension Pattern (General)

You do not need stereographic projection specifically.  
The reusable idea is: patch line vertex positions in `onBeforeCompile`.

Example: simple world-space warp by distance to a center.

```js
function patchLineShader(material, uniforms) {
  if (material.userData?.shaderPatched) return material;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWarpCenter = uniforms.uWarpCenter;   // THREE.Vector3
    shader.uniforms.uWarpRadius = uniforms.uWarpRadius;   // float
    shader.uniforms.uWarpAmount = uniforms.uWarpAmount;   // float

    const inject = `
uniform vec3 uWarpCenter;
uniform float uWarpRadius;
uniform float uWarpAmount;

vec3 applyWarp(vec3 wp) {
  float d = distance(wp, uWarpCenter);
  if (d >= uWarpRadius) return wp;
  float t = 1.0 - (d / max(uWarpRadius, 1e-6));
  return wp + vec3(0.0, 0.0, uWarpAmount * t);
}
`;

    let vs = shader.vertexShader;
    vs = inject + vs;
    vs = vs.replace(
      /vec4\\s+start\\s*=\\s*modelViewMatrix\\s*\\*\\s*vec4\\s*\\(\\s*instanceStart\\s*,\\s*1\\.0\\s*\\)\\s*;/,
      `
vec3 wpStart = (modelMatrix * vec4(instanceStart, 1.0)).xyz;
vec3 pStart = applyWarp(wpStart);
vec4 start = viewMatrix * vec4(pStart, 1.0);
`
    );
    vs = vs.replace(
      /vec4\\s+end\\s*=\\s*modelViewMatrix\\s*\\*\\s*vec4\\s*\\(\\s*instanceEnd\\s*,\\s*1\\.0\\s*\\)\\s*;/,
      `
vec3 wpEnd = (modelMatrix * vec4(instanceEnd, 1.0)).xyz;
vec3 pEnd = applyWarp(wpEnd);
vec4 end = viewMatrix * vec4(pEnd, 1.0);
`
    );

    shader.vertexShader = vs;
  };

  material.userData.shaderPatched = true;
  return material;
}
```

In your frame loop, just update uniform values:

```js
const ShaderUniforms = {
  uWarpCenter: { value: new THREE.Vector3() },
  uWarpRadius: { value: 1000.0 },
  uWarpAmount: { value: 200.0 },
};
```

## 8) Practical Checklist for New Projects

1. Create `GlobeView`.
2. Add imagery/elevation (optional but recommended for roads).
3. Add vector `FeatureGeometryLayer` with:
   - `batchId` callback,
   - `style.stroke.base_altitude`.
4. Convert created meshes to `LineSegments2`.
5. Keep material cache and `resolution` sync.
6. Add width mode state:
   - `useIndividualWidths`,
   - `widthMultiplier`,
   - `useWorldUnits`.
7. If needed, patch shaders with `onBeforeCompile`.
8. Rebuild or restyle fat lines when class mapping logic changes.

## 9) Common Failure Modes

- Lines disappear after resize:
  - `LineMaterial.resolution` is not updated.
- Width toggles do nothing:
  - materials are cached but state not reapplied to cached instances.
- Wrong per-feature widths:
  - missing or unstable `batchId` mapping.
- Lines not draped to terrain:
  - `base_altitude` not set or DEM not available at current zoom.
- Shader patch breaks after dependency upgrade:
  - string replacement target in shader changed; re-check patched chunks.

## 10) Performance Notes

- Cache materials; avoid creating one material per feature.
- Group segments by style/width before creating `LineSegments2`.
- Avoid full rebuild on every small slider change if possible.
- Use frustum culling carefully; disabling globally can be costly.
