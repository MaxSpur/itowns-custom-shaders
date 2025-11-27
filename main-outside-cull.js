import * as itowns from 'itowns';
import * as THREE from 'three';

// Import Fat Lines modules
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

// ----------------------------------------------------------------------------
// 1. SETUP VIEW
// ----------------------------------------------------------------------------

const viewerDiv = document.getElementById('viewerDiv');
const placement = {
    coord: new itowns.Coordinates('EPSG:4326', 4.768, 45.537),
    range: 5000,
    tilt: 80,
    heading: 0
};
const view = new itowns.GlobeView(viewerDiv, placement);
const RoadFatLineRoot = new THREE.Group();
RoadFatLineRoot.name = 'RoadFatLines';
RoadFatLineRoot.frustumCulled = false;
view.scene.add(RoadFatLineRoot);

// Elevation
const elevationSource = new itowns.WMTSSource({
    url: 'https://data.geopf.fr/wmts?',
    crs: 'EPSG:4326',
    name: 'ELEVATION.ELEVATIONGRIDCOVERAGE.SRTM3',
    tileMatrixSet: 'WGS84G',
    format: 'image/x-bil;bits=32',
    zoom: { min: 2, max: 10 }
});
const elevationLayer = new itowns.ElevationLayer('MNT_WORLD', {
    source: elevationSource,
});
view.addLayer(elevationLayer);

// Orthophoto
const orthoSource = new itowns.WMTSSource({
    url: 'https://data.geopf.fr/wmts?',
    crs: 'EPSG:3857',
    name: 'ORTHOIMAGERY.ORTHOPHOTOS',
    tileMatrixSet: 'PM',
    format: 'image/jpeg',
});
const orthoLayer = new itowns.ColorLayer('Ortho', {
    source: orthoSource,
});
view.addLayer(orthoLayer);

// ----------------------------------------------------------------------------
// 2. ROADS CONFIGURATION
// ----------------------------------------------------------------------------

const ROAD_COLOR = {
    'Type autoroutier': '#2E86FF',
    'Route à 2 chaussées': '#FF4D4D',
    'Route à 1 chaussée': '#FFC400',
    'Bretelle': '#00C8FF',
    'Rond-point': '#BBBBBB',
    'Chemin': '#f6ff75',
    'Route empierrée': '#FF9100',
    'Sentier': '#00E676',
    'Escalier': '#FFFFFF',
};

// Base widths (relative importance)
const ROAD_WIDTH_BASE = {
    'Type autoroutier': 10,
    'Route à 2 chaussées': 8,
    'Route à 1 chaussée': 5,
    'Bretelle': 4,
    'Rond-point': 6,
    'Chemin': 2,
    'Route empierrée': 2,
    'Sentier': 1.5,
    'Escalier': 1,
};

const RoadFeatureRegistry = {
    keyToBatchId: new Map(),
    widthByBatchId: new Map(),
    nextBatchId: 0,
};

function getFeatureKey(props = {}) {
    return props.id || props.ID || props.pk || props.pkuid || props.id_troncon || props.numero || props.gid || props.IDENT || props.CODE || null;
}

function registerRoadFeature(props = {}) {
    const key = getFeatureKey(props);
    let batchId;
    if (key) {
        if (RoadFeatureRegistry.keyToBatchId.has(key)) {
            batchId = RoadFeatureRegistry.keyToBatchId.get(key);
        } else {
            batchId = RoadFeatureRegistry.nextBatchId++;
            RoadFeatureRegistry.keyToBatchId.set(key, batchId);
        }
    } else {
        batchId = RoadFeatureRegistry.nextBatchId++;
    }
    const width = ROAD_WIDTH_BASE[props.nature] || 2;
    RoadFeatureRegistry.widthByBatchId.set(batchId, width);
    return batchId;
}

function getWidthForBatch(batchId) {
    return RoadFeatureRegistry.widthByBatchId.get(batchId);
}

// Global State
const RoadGlobalState = {
    visible: true,
    widthMultiplier: 2.0, // Default to 2.0x for initial visibility
    useWorldUnits: false,
    depthTest: true,      // If true: Default Mode (Z-fighting fix). If false: Always On Top (Ghost Mode).
    altitudeOffset: 5.0,
    resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
    useProjection: true,
    cullBackfaces: false,
    disableFrustumCulling: false,
    useIndividualWidths: true,
};

// ----------------------------------------------------------------------------
// 2b. SPHERE / STEREOGRAPHIC PROJECTION STATE
// ----------------------------------------------------------------------------

const SphereProjectionState = {
    controller: null,
};
const StereoUniforms = {
    uSphereCenter: { value: new THREE.Vector3() },
    uSphereR: { value: 1.0 },
    uProjectionStrength: { value: 0.0 },
    uCameraPos: { value: new THREE.Vector3() },
    uCullBackfaces: { value: 0.0 },
    uSphereBasis: { value: new THREE.Matrix3() },
    // New precomputed uniforms:
    uTwoR: { value: 0.0 },                // 2 * R
    uInv2R: { value: 0.0 },               // 1 / (2 * R)
    uCameraDirFromCenter: { value: new THREE.Vector3(0, 0, 1) }, // normalized
};

const RoadFatLines = new Set();

function makeSphereController(view, {
    radius = 1000,
    offset01 = 1.0,
    opacity = 0.5,
    color = 0xff0000,
} = {}) {
    const geom = new THREE.SphereGeometry(1, 32, 16);
    const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = 20;
    view.scene.add(mesh);

    const state = {
        groundECEF: new THREE.Vector3(),
        hasGround: false,
        radius,
        offset01,
    };

    function updateTransform() {
        if (!state.hasGround) return;

        const normal = state.groundECEF.clone().normalize();
        const lift = state.radius * (1.0 - state.offset01);
        const center = state.groundECEF.clone().addScaledVector(normal, lift);

        mesh.position.copy(center);
        mesh.scale.setScalar(state.radius);

        mesh.lookAt(new THREE.Vector3(0, 0, 0));
        mesh.rotateX(Math.PI / 2);
        updateSphereBasisUniform();
        view.notifyChange(true);
    }

    return {
        mesh,
        hasGround() {
            return state.hasGround;
        },
        setGroundFromWorld(vec3) {
            state.groundECEF.copy(vec3);
            state.hasGround = true;
            updateTransform();
        },
        setRadius(meters) {
            state.radius = Math.max(1, +meters);
            updateTransform();
        },
        setOffset01(t) {
            state.offset01 = Math.min(1, Math.max(0, +t));
            updateTransform();
        },
        setOpacity(a) {
            mat.opacity = Math.min(1, Math.max(0, +a));
            view.notifyChange(true);
        },
        setColor(hex) {
            mat.color.set(hex);
            view.notifyChange(true);
        },
    };
}

function initSphereAtLookAt(view, sphereCtl) {
    const c = view.controls.getLookAtCoordinate();
    const groundECEF = c.as(view.referenceCrs);
    sphereCtl.setGroundFromWorld(new THREE.Vector3(groundECEF.x, groundECEF.y, groundECEF.z));
}

function bindSpherePicking(viewerDiv, view, sphereCtl, toggleKey = 's') {
    let pickMode = false;
    viewerDiv.addEventListener('keydown', (event) => {
        if (event.key === toggleKey) pickMode = true;
    });
    viewerDiv.addEventListener('keyup', (event) => {
        if (event.key === toggleKey) pickMode = false;
    });
    viewerDiv.addEventListener('click', (event) => {
        if (!pickMode) return;
        const picked = view.getPickingPositionFromDepth(view.eventToViewCoords(event));
        if (picked) sphereCtl.setGroundFromWorld(picked);
    });
}

function createSphereWidget(view, sphereCtl, init = { radius: 1000, offset01: 1.0, opacity: 0.5 }) {
    const box = document.createElement('div');
    Object.assign(box.style, {
        position: 'absolute',
        left: '10px',
        top: '10px',
        zIndex: 20,
        background: '#313336bb',
        border: '1px solid #222',
        borderRadius: '7px',
        padding: '8px 10px',
        color: '#fff',
        font: '13px/1.2 Arial, sans-serif',
        minWidth: '220px',
    });
    box.innerHTML = `
    <div style="font-weight:700;margin-bottom:6px;">Projection sphere</div>
    <label>Radius (m)
      <input id="sp-r" type="range" min="10" max="20000" step="10" value="${init.radius}"/>
    </label>
    <div id="sp-rv" style="opacity:.8;margin-bottom:6px;">${init.radius}</div>

    <label>Offset (0..1)
      <input id="sp-o" type="range" min="0" max="1" step="0.01" value="${init.offset01}"/>
    </label>
    <div id="sp-ov" style="opacity:.8;margin-bottom:6px;">${init.offset01}</div>

    <label>Opacity
      <input id="sp-a" type="range" min="0" max="1" step="0.01" value="${init.opacity}"/>
    </label>
    <div id="sp-av" style="opacity:.8;margin-bottom:6px;">${init.opacity}</div>

    <div style="display:flex;gap:6px;margin-top:8px;">
      <button id="sp-center" style="flex:1;background:#313336bb;border:1px solid #222;border-radius:6px;color:#fff;height:28px;">Place @ center</button>
      <button id="sp-pick"   style="flex:1;background:#313336bb;border:1px solid #222;border-radius:6px;color:#fff;height:28px;">Pick (S)</button>
    </div>
  `;
    document.body.appendChild(box);

    const r = box.querySelector('#sp-r');
    const o = box.querySelector('#sp-o');
    const a = box.querySelector('#sp-a');
    const rv = box.querySelector('#sp-rv');
    const ov = box.querySelector('#sp-ov');
    const av = box.querySelector('#sp-av');
    const bCenter = box.querySelector('#sp-center');
    const bPick = box.querySelector('#sp-pick');

    sphereCtl.setRadius(+r.value);
    sphereCtl.setOffset01(+o.value);
    sphereCtl.setOpacity(+a.value);

    r.oninput = () => { rv.textContent = r.value; sphereCtl.setRadius(+r.value); };
    o.oninput = () => { ov.textContent = o.value; sphereCtl.setOffset01(+o.value); };
    a.oninput = () => { av.textContent = a.value; sphereCtl.setOpacity(+a.value); };

    bCenter.onclick = () => {
        const c = view.controls.getLookAtCoordinate();
        const g = c.as(view.referenceCrs);
        sphereCtl.setGroundFromWorld(new THREE.Vector3(g.x, g.y, g.z));
    };

    let picking = false;
    const setButton = (active) => {
        bPick.style.background = active ? '#222' : '#313336bb';
    };
    viewerDiv.addEventListener('keydown', (event) => {
        if (event.key === 's') {
            picking = true;
            setButton(true);
        }
    });
    viewerDiv.addEventListener('keyup', (event) => {
        if (event.key === 's') {
            picking = false;
            setButton(false);
        }
    });

    return box;
}

function createPerformancePanel() {
    if (PerformancePanel.element) return PerformancePanel.element;
    const panel = document.createElement('div');
    Object.assign(panel.style, {
        position: 'absolute', left: '10px', bottom: '10px', zIndex: 50,
        background: '#111a', border: '1px solid #333', borderRadius: '6px',
        padding: '8px 12px', color: '#fff', fontFamily: 'monospace',
        fontSize: '12px', minWidth: '140px', pointerEvents: 'none',
    });
    panel.innerHTML = `
        <div style="font-weight:bold;font-size:13px;margin-bottom:4px;">Perf Monitor</div>
        <div>FPS: <span id="perf-fps">0</span></div>
        <div>Frame: <span id="perf-frame">0</span> ms</div>
        <div>Lines: <span id="perf-lines">0</span></div>
    `;
    document.body.appendChild(panel);
    PerformancePanel.element = panel;
    PerformancePanel.fpsLabel = panel.querySelector('#perf-fps');
    PerformancePanel.frameLabel = panel.querySelector('#perf-frame');
    PerformancePanel.linesLabel = panel.querySelector('#perf-lines');
    PerformancePanel.lastUpdate = performance.now();
    PerformancePanel.frameCount = 0;
    PerformancePanel.accumTime = 0;
    return panel;
}

const sphereCtl = makeSphereController(view, {
    radius: 1000,
    offset01: 1.0,
    opacity: 0.54,
    color: 0xff0000,
});
SphereProjectionState.controller = sphereCtl;

view.addEventListener(itowns.GLOBE_VIEW_EVENTS.GLOBE_INITIALIZED, () => {
    initSphereAtLookAt(view, sphereCtl);
    bindSpherePicking(viewerDiv, view, sphereCtl, 's');
    createSphereWidget(view, sphereCtl, { radius: 1000, offset01: 1.0, opacity: 0.54 });
    createPerformancePanel();
});

function makeStereoProjectMaterial(mat) {
    if (!mat || mat.userData?.stereoPatched) return mat;

    mat.onBeforeCompile = (shader) => {
        shader.uniforms.uSphereCenter = StereoUniforms.uSphereCenter;
        shader.uniforms.uSphereR = StereoUniforms.uSphereR;
        shader.uniforms.uProjectionStrength = StereoUniforms.uProjectionStrength;
        shader.uniforms.uCameraPos = StereoUniforms.uCameraPos;
        shader.uniforms.uCullBackfaces = StereoUniforms.uCullBackfaces;
        shader.uniforms.uSphereBasis = StereoUniforms.uSphereBasis;


        // NEW: bind the precomputed uniforms too
        shader.uniforms.uTwoR = StereoUniforms.uTwoR;
        shader.uniforms.uInv2R = StereoUniforms.uInv2R;
        shader.uniforms.uCameraDirFromCenter = StereoUniforms.uCameraDirFromCenter;

        let vs = shader.vertexShader;
        const inject = /* glsl */`
uniform vec3  uSphereCenter;
uniform float uSphereR;
uniform float uProjectionStrength;
uniform vec3  uCameraPos;
uniform float uCullBackfaces;
uniform mat3  uSphereBasis;

// New precomputed uniforms:
uniform float uTwoR;              // 2 * uSphereR
uniform float uInv2R;             // 1 / (2 * uSphereR)
uniform vec3  uCameraDirFromCenter; // normalized (camera - center)

// Helper: is stereographic projection actually active?
bool isProjectionEnabled() {
  return (uProjectionStrength > 0.0 && uSphereR > 0.0);
}

vec3 terrainToSphere(vec3 s) {
  // h = 0.5 - s.y
  float h = 0.5 - s.y;

  // squared radius in xz-plane
  float r2 = s.x * s.x + s.z * s.z;

  // denominator: h^2 - 2h + r2 + 1
  float h2   = h * h;
  float denom = h2 - 2.0 * h + r2 + 1.0;

  // common scale factor for x and z
  float k = (1.0 - h) / denom;

  // y uses the same denom but different formula
  float y = 0.5 - r2 / denom;

  return vec3(k * s.x, y, k * s.z);
}

vec3 inverseStereoProject(vec3 wp) {
  if (!isProjectionEnabled()) {
    return wp;
  }

  float R = uSphereR;
  vec3  C = uSphereCenter;

  // Vector from center to world point
  vec3 v  = wp - C;
  float d2 = dot(v, v);
  float R2 = R * R;

  // Inside or on the sphere: no reprojection
  if (d2 <= R2) {
    return wp;
  }

  // (C - wp) / (2R) = -v / (2R) = -v * uInv2R
  vec3 s = transpose(uSphereBasis) * (-v * uInv2R);
  vec3 q = terrainToSphere(s);
  return C - (uSphereBasis * (q * uTwoR));
}

    // bool shouldCullHemisphere(vec3 originalWp){
    //   if (uCullBackfaces <= 0.5 || uProjectionStrength <= 0.0) return false;
    //   float R = uSphereR;
    //   if (R <= 0.0) return false;
    //   float d = distance(originalWp, uSphereCenter);
    //   if (d <= R + 1e-3) return false;
    //   vec3 normal = normalize(originalWp - uSphereCenter);
    //   vec3 camDirFromCenter = normalize(uCameraPos - uSphereCenter);
    //   return dot(normal, camDirFromCenter) > 0.0;
    // }

bool shouldCullHemisphere(vec3 originalWp, vec3 projectedP) {
  if (uCullBackfaces <= 0.5 || !isProjectionEnabled()) {
    return false;
  }

  float R = uSphereR;
  if (R <= 0.0) {
    return false;
  }

  vec3 C = uSphereCenter;

  // 1) Use ORIGINAL position to decide if the point is inside the sphere.
  //    Anything inside (or on) should NEVER be culled: these are your
  //    "unprojected" roads on the terrain, which must remain visible.
  vec3 v  = originalWp - C;
  float d2 = dot(v, v);
  float R2 = R * R;
  float eps = 1e-3;
  if (d2 <= R2 + eps) {
    return false;
  }

  // 2) For points outside the sphere (i.e., actually projected onto it),
  //    use the projected point to test which hemisphere we are on.
  
  vec3 n = projectedP - C; // outward normal; magnitude doesn't matter for sign

  //   vec3 camDirFromCenter = normalize(uCameraPos - C);

  // Pre-normalized on CPU:
  vec3 camDirFromCenter = uCameraDirFromCenter;


  // outward normal faces the camera → outside hemisphere → HIDE it
  // (so we see the inside).
  return dot(n, camDirFromCenter) > 0.0;
}
  `;

        if (mat.isLineMaterial === true) {
            vs = inject + vs;
            vs = vs.replace(
                /vec4\s+start\s*=\s*modelViewMatrix\s*\*\s*vec4\s*\(\s*instanceStart\s*,\s*1\.0\s*\)\s*;/,
                `
    vec3 wpStart = (modelMatrix * vec4( instanceStart, 1.0 )).xyz;
    vec3 pStart  = inverseStereoProject(wpStart);
    vec4 start;
  `
            );
            vs = vs.replace(
                /vec4\s+end\s*=\s*modelViewMatrix\s*\*\s*vec4\s*\(\s*instanceEnd\s*,\s*1\.0\s*\)\s*;/,
                `
    vec3 wpEnd = (modelMatrix * vec4( instanceEnd, 1.0 )).xyz;
    vec3 pEnd  = inverseStereoProject(wpEnd);
    vec4 end;
    bool cullSegment = shouldCullHemisphere(wpStart, pStart) || shouldCullHemisphere(wpEnd, pEnd);
    if (cullSegment) {
      start = vec4(1e9, 1e9, 1e9, 1.0);
      end   = vec4(1e9, 1e9, 1e9, 1.0);
    } else {
      start = viewMatrix * vec4( pStart, 1.0 );
      end   = viewMatrix * vec4( pEnd, 1.0 );
    }
  `
            );
            shader.vertexShader = vs;
        } else if (mat.isLineBasicMaterial === true) {
            shader.vertexShader =
                inject +
                shader.vertexShader.replace(
                    '#include <project_vertex>',
                    `
      vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vec3 p  = inverseStereoProject(wp);
      if (shouldCullHemisphere(wp, p)) {
        gl_Position = vec4(1e9, 1e9, 1e9, 1.0);
      } else {
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `
                );
        } else if (mat.isMeshBasicMaterial || mat.isMeshPhongMaterial || mat.isMeshStandardMaterial) {
            shader.vertexShader =
                inject +
                shader.vertexShader.replace(
                    '#include <project_vertex>',
                    `
      vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vec3 p  = inverseStereoProject(wp);
      if (shouldCullHemisphere(wp, p)) {
        gl_Position = vec4(1e9, 1e9, 1e9, 1.0);
      } else {
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `
                );
        } else {
            console.warn('Stereo projection: unsupported material type', mat?.type);
        }

        mat.userData = mat.userData || {};
        mat.userData.shader = shader;
    };

    mat.userData = mat.userData || {};
    mat.userData.stereoPatched = true;
    return mat;
}

// ----------------------------------------------------------------------------
// 3. GEOMETRY SANITIZATION
// ----------------------------------------------------------------------------

function isFinite3(x, y, z) {
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}

function isNearOrigin(x, y, z) {
    return Math.abs(x) < 1.0 && Math.abs(y) < 1.0 && Math.abs(z) < 1.0;
}

const _scratchVecA = new THREE.Vector3();
const _scratchVecB = new THREE.Vector3();
const _scratchMatrix = new THREE.Matrix4();
const _scratchRootInverse = new THREE.Matrix4();
const _scratchRoadRootInverse = new THREE.Matrix4();

const _rendererSize = new THREE.Vector2();
let _lastRendererWidth = -1;
let _lastRendererHeight = -1;
const _tmpCamDir = new THREE.Vector3(); // scratch

const RoadTileAnchors = new Map();
const tempColor = new THREE.Color();
const RoadMaterialCache = new Map();
const _basisUp = new THREE.Vector3();
const _basisRef = new THREE.Vector3();
const _basisX = new THREE.Vector3();
const _basisZ = new THREE.Vector3();
const PerformancePanel = {
    element: null,
    fpsLabel: null,
    frameLabel: null,
    linesLabel: null,
    frameCount: 0,
    accumTime: 0,
    lastUpdate: performance.now(),
};

function resetProcessedFlag(root) {
    root.traverse((node) => {
        if (node.userData) {
            delete node.userData.hasProcessedFatLine;
            if (node.userData.isFatLine && node.parent) {
                node.parent.remove(node);
                RoadFatLines.delete(node);
            }
        }
    });
}

function appendGeometryToGroup(sourceGeom, group, transformMatrix) {
    if (!sourceGeom) return;
    const posAttr = sourceGeom.attributes?.position;
    if (!posAttr) return;

    const colAttr = sourceGeom.attributes?.color;
    const indexAttr = sourceGeom.index;

    if (!colAttr && group.hasColors) {
        group.hasColors = false;
        group.colors.length = 0;
    }

    const useColors = group.hasColors && !!colAttr;
    const useTransform = !!transformMatrix;

    const pushSegment = (aIdx, bIdx) => {
        const ax = posAttr.getX(aIdx);
        const ay = posAttr.getY(aIdx);
        const az = posAttr.getZ(aIdx);

        const bx = posAttr.getX(bIdx);
        const by = posAttr.getY(bIdx);
        const bz = posAttr.getZ(bIdx);

        if (!isFinite3(ax, ay, az) || !isFinite3(bx, by, bz)) return;
        if (isNearOrigin(ax, ay, az) && isNearOrigin(bx, by, bz)) return;

        if (useTransform) {
            _scratchVecA.set(ax, ay, az).applyMatrix4(transformMatrix);
            _scratchVecB.set(bx, by, bz).applyMatrix4(transformMatrix);
            group.positions.push(
                _scratchVecA.x, _scratchVecA.y, _scratchVecA.z,
                _scratchVecB.x, _scratchVecB.y, _scratchVecB.z
            );
        } else {
            group.positions.push(ax, ay, az, bx, by, bz);
        }

        if (useColors) {
            group.colors.push(
                colAttr.getX(aIdx), colAttr.getY(aIdx), colAttr.getZ(aIdx),
                colAttr.getX(bIdx), colAttr.getY(bIdx), colAttr.getZ(bIdx)
            );
        }
    };

    if (indexAttr) {
        for (let i = 0; i < indexAttr.count; i += 2) {
            pushSegment(indexAttr.getX(i), indexAttr.getX(i + 1));
        }
    } else {
        for (let i = 0; i < posAttr.count; i += 2) {
            pushSegment(i, i + 1);
        }
    }
}

let rebuildPending = false;
function rebuildAllRoadTiles() {
    if (rebuildPending) return;
    rebuildPending = true;
    const entries = Array.from(RoadTileAnchors.entries());
    RoadTileAnchors.clear();
    for (const [, entry] of entries) {
        cleanupAnchorEntry(entry);
        const featureRoot = entry.featureRoot;
        if (featureRoot) {
            if (featureRoot.userData) {
                delete featureRoot.userData.roadTileKey;
                delete featureRoot.userData.roadAnchor;
                delete featureRoot.userData.fatLines;
            }
            resetProcessedFlag(featureRoot);
            processRoadTileRoot(featureRoot);
        }
    }
    rebuildPending = false;
}

function createFatLineGeometriesByBatch(sourceGeom, transformMatrix) {
    const posAttr = sourceGeom?.attributes?.position;
    const colAttr = sourceGeom?.attributes?.color;
    const batchAttr = sourceGeom?.attributes?.batchId;
    const indexAttr = sourceGeom?.index;
    if (!posAttr) return [];

    const hasColorsAttr = !!colAttr;
    const hasBatchAttr = !!batchAttr;
    const groups = new Map();

    function getGroup(batchId) {
        const key = hasBatchAttr ? batchId : 0;
        if (!groups.has(key)) {
            groups.set(key, { positions: [], colors: [] });
        }
        return groups.get(key);
    }

    function addSegment(aIdx, bIdx) {
        const ax = posAttr.getX(aIdx);
        const ay = posAttr.getY(aIdx);
        const az = posAttr.getZ(aIdx);

        const bx = posAttr.getX(bIdx);
        const by = posAttr.getY(bIdx);
        const bz = posAttr.getZ(bIdx);

        if (!isFinite3(ax, ay, az) || !isFinite3(bx, by, bz)) return;
        if (isNearOrigin(ax, ay, az) && isNearOrigin(bx, by, bz)) return;

        const batchId = hasBatchAttr ? batchAttr.getX(aIdx) : 0;
        const group = getGroup(batchId);

        if (transformMatrix) {
            _scratchVecA.set(ax, ay, az).applyMatrix4(transformMatrix);
            _scratchVecB.set(bx, by, bz).applyMatrix4(transformMatrix);
            group.positions.push(
                _scratchVecA.x, _scratchVecA.y, _scratchVecA.z,
                _scratchVecB.x, _scratchVecB.y, _scratchVecB.z
            );
        } else {
            group.positions.push(ax, ay, az, bx, by, bz);
        }

        if (hasColorsAttr) {
            group.colors.push(
                colAttr.getX(aIdx), colAttr.getY(aIdx), colAttr.getZ(aIdx),
                colAttr.getX(bIdx), colAttr.getY(bIdx), colAttr.getZ(bIdx)
            );
        }
    }

    if (indexAttr) {
        for (let i = 0; i < indexAttr.count; i += 2) {
            addSegment(indexAttr.getX(i), indexAttr.getX(i + 1));
        }
    } else {
        for (let i = 0; i < posAttr.count; i += 2) {
            addSegment(i, i + 1);
        }
    }

    const results = [];
    for (const [batchId, data] of groups.entries()) {
        if (!data.positions.length) continue;
        const hasValidColors = hasColorsAttr && data.colors.length === data.positions.length;
        results.push({
            positions: data.positions.slice(),
            colors: hasValidColors ? data.colors.slice() : null,
            hasColors: hasValidColors,
            batchId: hasBatchAttr ? batchId : null,
        });
    }
    return results;
}

function getFeatureTileKey(featureRoot) {
    const ext = featureRoot?.extent;
    if (ext && typeof ext === 'object') {
        if (ext.isExtent || ext.crs) {
            const west = Number.isFinite(ext.west) ? ext.west : 0;
            const east = Number.isFinite(ext.east) ? ext.east : 0;
            const south = Number.isFinite(ext.south) ? ext.south : 0;
            const north = Number.isFinite(ext.north) ? ext.north : 0;
            const zoom = Number.isFinite(ext.zoom) ? ext.zoom : 0;
            const crs = ext.crs || ext.projection || 'unknown';
            return `${crs}|${west}|${east}|${south}|${north}|${zoom}`;
        }
    }
    return featureRoot ? featureRoot.uuid : null;
}

function cleanupAnchorEntry(entry) {
    if (!entry) return;
    const { anchor, fatLines } = entry;
    if (Array.isArray(fatLines)) {
        for (const line of fatLines) {
            if (!line) continue;
            if (line.parent) {
                line.parent.remove(line);
            }
            RoadFatLines.delete(line);
        }
    }
    if (anchor && anchor.parent) {
        anchor.parent.remove(anchor);
    }
}

function cleanupFeatureFatLines(featureRoot) {
    if (!featureRoot) return;
    const key = featureRoot.userData?.roadTileKey;
    if (key && RoadTileAnchors.has(key)) {
        cleanupAnchorEntry(RoadTileAnchors.get(key));
        RoadTileAnchors.delete(key);
    }
    if (featureRoot.userData) {
        delete featureRoot.userData.roadAnchor;
        delete featureRoot.userData.fatLines;
        delete featureRoot.userData.roadTileKey;
    }
}

function syncMaterialResolutions() {
    for (const mat of RoadMaterialCache.values()) {
        if (!mat?.resolution) continue;
        mat.resolution.copy(RoadGlobalState.resolution);
    }
}

function applyGlobalStateToMaterials() {
    for (const mat of RoadMaterialCache.values()) {
        if (!mat) continue;
        const base = mat.userData?.baseWidth || 2;
        mat.linewidth = base * RoadGlobalState.widthMultiplier;
        mat.worldUnits = RoadGlobalState.useWorldUnits;

        const isDefaultMode = RoadGlobalState.depthTest;
        mat.depthTest = isDefaultMode;
        mat.depthWrite = isDefaultMode;
        mat.transparent = !isDefaultMode;
        mat.polygonOffset = isDefaultMode;
        mat.needsUpdate = true;

        mat.needsUpdate = true;
    }

    for (const obj of RoadFatLines) {
        if (!obj) continue;
        obj.renderOrder = RoadGlobalState.depthTest ? 0 : 999;
        obj.position.z = RoadGlobalState.altitudeOffset;
        obj.updateMatrix();
    }

    notifyRoadLayers();
    view.notifyChange(true);
}

function addMeshToGeometryGroups(mesh, groups, transformMatrix) {
    if (!mesh.geometry) return;
    const props = getFeatureProperties(mesh);
    const natureName = props?.nature || 'unknown';
    const baseWidthNature = ROAD_WIDTH_BASE[natureName] || 2;
    const color = ROAD_COLOR[natureName] || '#FF00FF';
    const hasColorAttr = !!mesh.geometry.attributes?.color;

    if (!RoadGlobalState.useIndividualWidths) {
        const baseWidth = 2;
        const key = `uniform|${color}|${hasColorAttr ? 1 : 0}`;
        if (!groups.has(key)) {
            groups.set(key, {
                color,
                positions: [],
                colors: [],
                hasColors: hasColorAttr,
                baseWidth,
            });
        }
        const group = groups.get(key);
        appendGeometryToGroup(mesh.geometry, group, transformMatrix);
    } else {
        const geometries = createFatLineGeometriesByBatch(mesh.geometry, transformMatrix);
        for (const { positions, colors, hasColors, batchId } of geometries) {
            const widthFromBatch = (batchId !== null && batchId !== undefined) ? getWidthForBatch(batchId) : undefined;
            const baseWidth = widthFromBatch || baseWidthNature;
            const key = `${baseWidth}|${color}|${hasColors ? 1 : 0}`;

            if (!groups.has(key)) {
                groups.set(key, {
                    color,
                    positions: [],
                    colors: [],
                    hasColors,
                    baseWidth,
                });
            }

            const group = groups.get(key);
            group.positions.push(...positions);
            if (hasColors && colors) {
                group.colors.push(...colors);
            } else {
                group.hasColors = false;
                group.colors.length = 0;
            }
        }
    }

    const mat = mesh.material;
    if (mat) {
        if (Array.isArray(mat)) {
            mat.forEach((m) => {
                if (m) m.visible = false;
            });
        } else {
            mat.visible = false;
        }
    }
    mesh.frustumCulled = !RoadGlobalState.disableFrustumCulling;
    mesh.userData.hasProcessedFatLine = true;
}

function getRoadMaterial(baseWidth, hasColors, colorHex, isDefaultMode) {
    const key = `${baseWidth}|${hasColors ? 1 : 0}|${colorHex}|${isDefaultMode ? 1 : 0}`;
    let material = RoadMaterialCache.get(key);
    if (!material) {
        material = new LineMaterial({
            color: hasColors ? 0xffffff : tempColor.set(colorHex).getHex(),
            linewidth: baseWidth * RoadGlobalState.widthMultiplier,
            vertexColors: hasColors,
            worldUnits: RoadGlobalState.useWorldUnits,
            dashed: false,
            alphaToCoverage: false,
            depthTest: isDefaultMode,
            depthWrite: isDefaultMode,
            transparent: !isDefaultMode,
            resolution: RoadGlobalState.resolution,
            polygonOffset: isDefaultMode,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4
        });
        material.userData = material.userData || {};
        material.userData.baseWidth = baseWidth;
        makeStereoProjectMaterial(material);
        RoadMaterialCache.set(key, material);
    }
    return material;
}

function createFatLinesFromGroups(featureRoot, targetRoot, groups) {
    if (!groups || !groups.size) {
        return;
    }

    const tileKey = getFeatureTileKey(featureRoot);
    if (tileKey && RoadTileAnchors.has(tileKey)) {
        cleanupAnchorEntry(RoadTileAnchors.get(tileKey));
        RoadTileAnchors.delete(tileKey);
    } else {
        cleanupFeatureFatLines(featureRoot);
    }
    featureRoot.userData = featureRoot.userData || {};
    const anchor = new THREE.Group();
    anchor.name = 'RoadTileAnchor';
    anchor.matrixAutoUpdate = false;
    const parentInverse = _scratchRoadRootInverse.copy(RoadFatLineRoot.matrixWorld).invert();
    anchor.matrix.copy(parentInverse).multiply(targetRoot.matrixWorld);
    anchor.matrix.decompose(anchor.position, anchor.quaternion, anchor.scale);
    anchor.updateMatrix();
    anchor.frustumCulled = !RoadGlobalState.disableFrustumCulling;
    anchor.userData.isRoadAnchor = true;
    RoadFatLineRoot.add(anchor);
    anchor.updateMatrixWorld(true);
    featureRoot.userData.roadAnchor = anchor;
    featureRoot.userData.fatLines = [];

    const isDefaultMode = RoadGlobalState.depthTest;

    for (const group of groups.values()) {
        if (!group.positions.length) continue;
        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(group.positions);
        if (group.hasColors && group.colors.length === group.positions.length) {
            geometry.setColors(group.colors);
        }

        const renderBase = group.baseWidth || 2;
        const material = getRoadMaterial(renderBase, group.hasColors, group.color, isDefaultMode);
        const fatLine = new LineSegments2(geometry, material);

        fatLine.renderOrder = isDefaultMode ? 0 : 999;
        fatLine.userData.isFatLine = true;
        fatLine.userData.baseWidth = renderBase;
        fatLine.frustumCulled = !RoadGlobalState.disableFrustumCulling;

        fatLine.position.set(0, 0, RoadGlobalState.altitudeOffset);
        fatLine.updateMatrixWorld();

        anchor.add(fatLine);
        featureRoot.userData.fatLines.push(fatLine);
        RoadFatLines.add(fatLine);
    }

    if (tileKey) {
        RoadTileAnchors.set(tileKey, {
            anchor,
            fatLines: featureRoot.userData.fatLines,
            sourceRoot: targetRoot,
            needsSync: true,
            featureRoot,
        });
        featureRoot.userData.roadTileKey = tileKey;
    }

    view.notifyChange(true);
}

// ----------------------------------------------------------------------------
// 4. ROADS LAYER LOGIC
// ----------------------------------------------------------------------------

const roadsSource = new itowns.WFSSource({
    url: 'https://data.geopf.fr/wfs/ows?',
    version: '2.0.0',
    typeName: 'BDTOPO_V3:troncon_de_route',
    crs: 'EPSG:4326',
    format: 'application/json',
    zoom: { min: 12, max: 15 },
});

const altitudeDebug = {
    logged: 0,
    max: 20,
};

function logAltitudeIssue(reason, props) {
    if (altitudeDebug.logged >= altitudeDebug.max) return;
    altitudeDebug.logged++;
    console.warn(`[RoadAltitude] ${reason}`, {
        id: props?.id || props?.ID || props?.nature,
        nature: props?.nature,
    });
}

function resolveBaseCoordinate(ctx) {
    if (!ctx) return null;
    const coord = Array.isArray(ctx.coordinates) ? ctx.coordinates[0] : ctx.coordinates;
    if (!coord) return null;
    if (coord.isCoordinates) return coord;
    if (coord.crs) return new itowns.Coordinates(coord.crs, coord.x, coord.y, coord.z || 0);
    return new itowns.Coordinates('EPSG:4326', coord.x, coord.y, coord.z || 0);
}

const reusableCoord = new itowns.Coordinates('EPSG:4326', 0, 0, 0);
const demReadMode = (itowns.DEMUtils && (itowns.DEMUtils.PRECISE_READ_Z || itowns.DEMUtils.FAST_READ_Z)) || 0;
function getRoadBaseAltitude(props, ctx) {
    const coord = resolveBaseCoordinate(ctx);
    if (!coord) return 0;
    const z = Number.isFinite(coord.z) ? coord.z : 0;

    const tileLayer = view.tileLayer;
    if (!tileLayer || !itowns.DEMUtils || !coord.isCoordinates) {
        if (z === 0) logAltitudeIssue('No DEM available, falling back to z=0', props);
        return z;
    }

    reusableCoord.copy(coord);
    const demElevation = itowns.DEMUtils.getElevationValueAt(
        tileLayer,
        reusableCoord,
        demReadMode
    );
    if (Number.isFinite(demElevation)) {
        return demElevation;
    }

    if (z === 0) logAltitudeIssue('DEM not ready, using fallback altitude', props);
    return z;
}

const roadsLayer = new itowns.FeatureGeometryLayer('BDTOPO_Roads', {
    source: roadsSource,
    zoom: { min: 12 },
    mergeFeatures: true,
    batchId: (properties) => registerRoadFeature(properties),
    style: {
        stroke: {
            color: (props) => ROAD_COLOR[props.nature] || '#FF00FF',
            base_altitude: (props, ctx) => getRoadBaseAltitude(props, ctx),
        },
    },
});
roadsLayer.onMeshCreated = (root) => scheduleRoadProcessing(root);
const roadLayers = [roadsLayer];

function scheduleRoadProcessing(root) {
    if (!root) return;
    if (root.userData?.hasQueuedFatLine) return;
    root.userData = root.userData || {};
    root.userData.hasQueuedFatLine = true;

    const attemptProcess = () => {
        if (!root.parent) {
            requestAnimationFrame(attemptProcess);
            return;
        }
        processRoadTileRoot(root);
    };

    requestAnimationFrame(attemptProcess);
}

function getFeatureProperties(object) {
    // Traverse UP to find the feature properties attached by iTowns
    let obj = object;
    while (obj) {
        if (obj.userData?.feature?.properties) return obj.userData.feature.properties;
        if (obj.feature?.properties) return obj.feature.properties;
        obj = obj.parent;
    }
    return {};
}

function processRoadTileRoot(featureRoot) {
    if (!featureRoot) return;
    const targetRoot = featureRoot.meshes || featureRoot;
    const tileKey = getFeatureTileKey(featureRoot);
    if (tileKey && RoadTileAnchors.has(tileKey)) {
        featureRoot.userData = featureRoot.userData || {};
        featureRoot.userData.hasQueuedFatLine = false;
        return;
    }
    featureRoot.userData = featureRoot.userData || {};
    featureRoot.userData.isRoadFeature = true;

    // Ensure matrices are updated relative to current hierarchy before we bake vertices.
    featureRoot.updateWorldMatrix(true, true);
    targetRoot.updateWorldMatrix(true, true);
    const frustumState = !RoadGlobalState.disableFrustumCulling;
    targetRoot.frustumCulled = frustumState;
    featureRoot.frustumCulled = frustumState;

    const geometryGroups = new Map();
    const targetInverse = _scratchRootInverse.copy(targetRoot.matrixWorld).invert();

    const traverse = (node) => {
        if (!node) return;
        if (node.userData?.isFatLine) return;

        const isLineLike = node.isMesh || node.isLine || node.isLineSegments;
        if (isLineLike && node.geometry && !node.userData?.hasProcessedFatLine) {
            const toTargetMatrix = _scratchMatrix.copy(node.matrixWorld).premultiply(targetInverse);
            addMeshToGeometryGroups(node, geometryGroups, toTargetMatrix);
        }

        if (node.children) {
            for (const child of node.children) {
                traverse(child);
            }
        }
    };

    traverse(targetRoot);
    createFatLinesFromGroups(featureRoot, targetRoot, geometryGroups);
    featureRoot.userData.hasQueuedFatLine = false;
}

Promise.all(roadLayers.map((layer) => view.addLayer(layer))).then(() => {
    console.log('Roads layer added');
    createRoadsUI();
    // Set initial width value in the UI to match the default in RoadGlobalState
    document.getElementById('ui-width-val').innerText = RoadGlobalState.widthMultiplier.toFixed(1) + 'x';
    document.getElementById('ui-width').value = RoadGlobalState.widthMultiplier;
});

// ----------------------------------------------------------------------------
// 5. ROBUST SYNC LOOP
// ----------------------------------------------------------------------------


view.addFrameRequester(itowns.MAIN_LOOP_EVENTS.BEFORE_RENDER, () => {
    const frameStart = performance.now();
    const renderer = view.mainLoop.gfxEngine.renderer;
    renderer.getSize(_rendererSize);

    if (_rendererSize.x !== _lastRendererWidth || _rendererSize.y !== _lastRendererHeight) {
        _lastRendererWidth = _rendererSize.x;
        _lastRendererHeight = _rendererSize.y;
        RoadGlobalState.resolution.set(_rendererSize.x, _rendererSize.y);
        syncMaterialResolutions();
    }

    // Only needed if some shaders still use it:
    StereoUniforms.uCameraPos.value.copy(view.camera.camera3D.position);

    const sphereCtl = SphereProjectionState.controller;
    const active = sphereCtl && sphereCtl.hasGround && sphereCtl.hasGround();
    const useProjection = RoadGlobalState.useProjection && !!active;
    const useCull = RoadGlobalState.cullBackfaces && !!active;

    if (active) {
        const C = sphereCtl.mesh.position;
        const rawR = sphereCtl.mesh.scale.x;
        const R = Math.max(rawR, 1e-3); // clamp radius here, once

        updateSphereBasisUniform();

        StereoUniforms.uSphereCenter.value.copy(C);
        StereoUniforms.uSphereR.value = R;
        StereoUniforms.uTwoR.value = 2 * R;
        StereoUniforms.uInv2R.value = 1.0 / (2 * R);

        _tmpCamDir.copy(view.camera.camera3D.position).sub(C).normalize();
        StereoUniforms.uCameraDirFromCenter.value.copy(_tmpCamDir);
    } else {
        StereoUniforms.uSphereCenter.value.set(0, 0, 0);
        StereoUniforms.uSphereR.value = -1.0;
        StereoUniforms.uTwoR.value = 0.0;
        StereoUniforms.uInv2R.value = 0.0;
        StereoUniforms.uCameraDirFromCenter.value.set(0, 0, 1);
        StereoUniforms.uSphereBasis.value.identity();
    }

    StereoUniforms.uProjectionStrength.value = useProjection ? 1.0 : 0.0;
    StereoUniforms.uCullBackfaces.value = useCull ? 1.0 : 0.0;

    for (const entry of RoadTileAnchors.values()) {
        const source = entry.sourceRoot;
        const anchor = entry.anchor;
        if (!source || !anchor) continue;
        if (source.parent) {
            if (source.matrixWorldNeedsUpdate || entry.needsSync) {
                source.updateWorldMatrix(true, false);
                anchor.matrix.copy(source.matrixWorld);
                anchor.matrix.decompose(anchor.position, anchor.quaternion, anchor.scale);
                anchor.updateMatrix();
                anchor.updateMatrixWorld(true);
                entry.needsSync = false;
            }
        } else {
            entry.sourceRoot = null;
            entry.needsSync = false;
        }
    }

    for (const obj of RoadFatLines) {
        if (!obj || !obj.material) continue;
        if (!obj.parent) {
            RoadFatLines.delete(obj);
        }
    }

    if (PerformancePanel.element) {
        const frameDuration = performance.now() - frameStart;
        PerformancePanel.accumTime += frameDuration;
        PerformancePanel.frameCount++;
        if (PerformancePanel.frameLabel) {
            PerformancePanel.frameLabel.textContent = frameDuration.toFixed(1);
        }
        if (PerformancePanel.linesLabel) {
            PerformancePanel.linesLabel.textContent = RoadFatLines.size.toString();
        }
        const now = performance.now();
        const elapsed = now - PerformancePanel.lastUpdate;
        if (elapsed >= 500) {
            const avgFrame = PerformancePanel.accumTime / Math.max(PerformancePanel.frameCount, 1);
            const fps = 1000 / Math.max(avgFrame, 1e-6);
            if (PerformancePanel.fpsLabel) {
                PerformancePanel.fpsLabel.textContent = fps.toFixed(1);
            }
            PerformancePanel.lastUpdate = now;
            PerformancePanel.frameCount = 0;
            PerformancePanel.accumTime = 0;
        }
    }
});

// ----------------------------------------------------------------------------
// 6. UI & STATE CONTROL
// ----------------------------------------------------------------------------

function notifyRoadLayers() {
    for (const layer of roadLayers) {
        view.notifyChange(layer);
    }
}

function applyFrustumCullingState() {
    const frustumCulled = !RoadGlobalState.disableFrustumCulling;
    for (const layer of roadLayers) {
        layer.object3d.traverse((obj) => {
            if (!obj) return;
            if (obj.userData?.isFatLine || obj.userData?.isRoadFeature || obj.isLine || obj.isLineSegments || obj.isMesh || obj.isGroup) {
                obj.frustumCulled = frustumCulled;
            }
        });
    }
    RoadFatLineRoot.frustumCulled = false;
    RoadFatLineRoot.traverse((obj) => {
        if (!obj) return;
        if (obj.userData?.isFatLine || obj.userData?.isRoadFeature || obj.userData?.isRoadAnchor || obj.isLine || obj.isLineSegments || obj.isMesh || obj.isGroup) {
            obj.frustumCulled = frustumCulled;
        }
    });
    notifyRoadLayers();
}

function triggerUpdate() {
    applyGlobalStateToMaterials();
}

function createRoadsUI() {
    const panel = document.createElement('div');
    Object.assign(panel.style, {
        position: 'absolute', right: '10px', top: '10px', zIndex: 100,
        background: '#222222ee', border: '1px solid #444', borderRadius: '8px',
        padding: '15px', color: '#fff', fontFamily: 'sans-serif', fontSize: '13px',
        minWidth: '260px', display: 'flex', flexDirection: 'column', gap: '12px'
    });

    panel.innerHTML = `
        <div style="font-weight:bold; font-size:14px; border-bottom:1px solid #555; padding-bottom:5px;">
            Road Settings
        </div>
        
        <label style="display:flex; justify-content:space-between; align-items:center;">
            <span>Visibility</span>
            <input type="checkbox" id="ui-visible" checked>
        </label>

        <!-- Always On Top Toggle -->
        <label style="display:flex; justify-content:space-between; align-items:center; background:#333; padding:5px; border-radius:4px;">
            <span>Always On Top (Ghost)</span>
            <input type="checkbox" id="ui-ontop">
        </label>

        <label style="display:flex; justify-content:space-between; align-items:center;">
            <span>Stereographic Projection</span>
            <input type="checkbox" id="ui-projection" ${RoadGlobalState.useProjection ? 'checked' : ''}>
        </label>

        <label style="display:flex; justify-content:space-between; align-items:center;">
            <span>Cull Backfaces (Sphere)</span>
            <input type="checkbox" id="ui-cull" ${RoadGlobalState.cullBackfaces ? 'checked' : ''}>
        </label>
        <label style="display:flex; justify-content:space-between; align-items:center;">
            <span>Disable Frustum Culling</span>
            <input type="checkbox" id="ui-nocull" ${RoadGlobalState.disableFrustumCulling ? 'checked' : ''}>
        </label>
        <label style="display:flex; justify-content:space-between; align-items:center;">
            <span>Per-Road Widths</span>
            <input type="checkbox" id="ui-widths" ${RoadGlobalState.useIndividualWidths ? 'checked' : ''}>
        </label>

        <div style="display:flex; flex-direction:column; gap:5px;">
            <div style="display:flex; justify-content:space-between;">
                <span>Width Multiplier</span>
                <span id="ui-width-val">${RoadGlobalState.widthMultiplier.toFixed(1)}x</span>
            </div>
            <input type="range" id="ui-width" min="0.1" max="5" step="0.1" value="${RoadGlobalState.widthMultiplier}">
        </div>

        <div style="display:flex; flex-direction:column; gap:5px;">
            <div style="display:flex; justify-content:space-between;">
                <span>Elevation Offset</span>
                <span id="ui-alt-val">${RoadGlobalState.altitudeOffset.toFixed(1)} m</span>
            </div>
            <input type="range" id="ui-alt" min="-50" max="50" step="0.5" value="${RoadGlobalState.altitudeOffset}">
        </div>

        <label style="display:flex; justify-content:space-between; align-items:center;">
            <span>World Units (Meters)</span>
            <input type="checkbox" id="ui-worldunits">
        </label>
        
        <button id="ui-debug" style="margin-top:5px; padding:4px; background:#444; border:none; color:#ccc; cursor:pointer;">Debug Console</button>
    `;
    document.body.appendChild(panel);

    // Events
    document.getElementById('ui-visible').addEventListener('change', (e) => {
        for (const layer of roadLayers) {
            layer.object3d.visible = e.target.checked;
        }
        notifyRoadLayers();
    });

    document.getElementById('ui-ontop').addEventListener('change', (e) => {
        // Logic: Checked = Always On Top -> depthTest = false (Mode Switch)
        RoadGlobalState.depthTest = !e.target.checked;
        triggerUpdate();
    });

    document.getElementById('ui-projection').addEventListener('change', (e) => {
        RoadGlobalState.useProjection = e.target.checked;
        triggerUpdate();
    });

    document.getElementById('ui-cull').addEventListener('change', (e) => {
        RoadGlobalState.cullBackfaces = e.target.checked;
        notifyRoadLayers();
    });
    document.getElementById('ui-nocull').addEventListener('change', (e) => {
        RoadGlobalState.disableFrustumCulling = e.target.checked;
        applyFrustumCullingState();
    });
    document.getElementById('ui-widths').addEventListener('change', (e) => {
        RoadGlobalState.useIndividualWidths = e.target.checked;
        rebuildAllRoadTiles();
        applyGlobalStateToMaterials();
    });

    document.getElementById('ui-width').addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        document.getElementById('ui-width-val').innerText = v.toFixed(1) + 'x';
        RoadGlobalState.widthMultiplier = v;
        triggerUpdate();
    });

    document.getElementById('ui-alt').addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        document.getElementById('ui-alt-val').innerText = v.toFixed(1) + ' m';
        RoadGlobalState.altitudeOffset = v;
        triggerUpdate();
    });

    document.getElementById('ui-worldunits').addEventListener('change', (e) => {
        RoadGlobalState.useWorldUnits = e.target.checked;
        triggerUpdate();
    });

    document.getElementById('ui-debug').addEventListener('click', () => {
        let count = 0;
        for (const layer of roadLayers) {
            layer.object3d.traverse(o => { if (o.userData?.isFatLine) count++; });
        }
        RoadFatLineRoot.traverse(o => { if (o.userData?.isFatLine) count++; });
        console.log(`Visible Fat Lines: ${count}`);
    });
}
function updateSphereBasisUniform() {
    const sphereCtl = SphereProjectionState.controller;
    const basis = StereoUniforms.uSphereBasis.value;
    if (!sphereCtl || !sphereCtl.hasGround()) {
        basis.identity();
        return;
    }
    _basisUp.copy(sphereCtl.mesh.position).normalize();
    if (Math.abs(_basisUp.y) < 0.99) {
        _basisRef.set(0, 1, 0);
    } else {
        _basisRef.set(1, 0, 0);
    }
    _basisX.crossVectors(_basisRef, _basisUp).normalize();
    _basisZ.crossVectors(_basisUp, _basisX).normalize();
    basis.set(
        _basisX.x, _basisUp.x, _basisZ.x,
        _basisX.y, _basisUp.y, _basisZ.y,
        _basisX.z, _basisUp.z, _basisZ.z
    );
}
