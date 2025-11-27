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
const ROAD_UI_STORAGE_KEY = 'itowns-road-ui-v1';
const RoadUIStorage = (() => {
    let cache = {};
    if (typeof window !== 'undefined' && window.localStorage) {
        try {
            const raw = window.localStorage.getItem(ROAD_UI_STORAGE_KEY);
            if (raw) {
                cache = JSON.parse(raw) || {};
            }
        } catch (err) {
            console.warn('Failed to parse stored road UI state', err);
            cache = {};
        }
    }
    return {
        get() {
            return cache;
        },
        save(patch = {}) {
            cache = { ...cache, ...patch };
            if (typeof window !== 'undefined' && window.localStorage) {
                try {
                    window.localStorage.setItem(ROAD_UI_STORAGE_KEY, JSON.stringify(cache));
                } catch (err) {
                    console.warn('Failed to persist road UI state', err);
                }
            }
        }
    };
})();

function applyPersistedRoadGlobalState() {
    const saved = RoadUIStorage.get();
    if (!saved) return;
    if ('visible' in saved) RoadGlobalState.visible = !!saved.visible;
    if ('widthMultiplier' in saved && Number.isFinite(saved.widthMultiplier)) RoadGlobalState.widthMultiplier = saved.widthMultiplier;
    if ('useWorldUnits' in saved) RoadGlobalState.useWorldUnits = !!saved.useWorldUnits;
    if ('depthTest' in saved) RoadGlobalState.depthTest = !!saved.depthTest;
    if ('altitudeOffset' in saved && Number.isFinite(saved.altitudeOffset)) RoadGlobalState.altitudeOffset = saved.altitudeOffset;
    if ('useProjection' in saved) RoadGlobalState.useProjection = !!saved.useProjection;
    if ('cullBackfaces' in saved) RoadGlobalState.cullBackfaces = !!saved.cullBackfaces;
    if ('disableFrustumCulling' in saved) RoadGlobalState.disableFrustumCulling = !!saved.disableFrustumCulling;
    if ('useIndividualWidths' in saved) RoadGlobalState.useIndividualWidths = !!saved.useIndividualWidths;
}

function getPersistedSphereSettings() {
    const saved = RoadUIStorage.get() || {};
    const defaults = { radius: 1000, offset01: 1.0, opacity: 0.54 };
    return {
        radius: Number.isFinite(saved.sphereRadius) ? saved.sphereRadius : defaults.radius,
        offset01: Number.isFinite(saved.sphereOffset) ? saved.sphereOffset : defaults.offset01,
        opacity: Number.isFinite(saved.sphereOpacity) ? saved.sphereOpacity : defaults.opacity,
    };
}

const PANEL_BASE_STYLE = {
    position: 'absolute',
    zIndex: 100,
    background: '#171b2833',
    border: '1px solid #2e344a',
    borderRadius: '12px',
    padding: '14px 16px',
    color: '#fff',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '13px',
    minWidth: '240px',
    maxWidth: '270px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    boxShadow: '0 14px 40px rgba(0,0,0,0.35)',
    backdropFilter: 'blur(12px)',
};
const UI_BUTTON_STYLE = 'padding:7px 12px;border-radius:6px;background:transparent;color:inherit;font-size:12px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;cursor:pointer;';
const TOGGLE_LABEL_STYLE = 'display:flex;align-items:center;gap:10px;font-size:13px;';
const TOGGLE_TEXT_STYLE = 'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
const UI_STYLE_TAG_ID = 'itowns-road-ui-styles';

function applyPanelStyle(element, overrides = {}) {
    Object.assign(element.style, PANEL_BASE_STYLE, overrides);
}

function ensureUIPanelStyles() {
    if (document.getElementById(UI_STYLE_TAG_ID)) return;
    const style = document.createElement('style');
    style.id = UI_STYLE_TAG_ID;
    style.textContent = `
    .itowns-ui-panel button {
        border: 1px solid #2e344a;
        background: rgba(58,61,79,0.45);
        color: #f4f7ff;
        transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .itowns-ui-panel button:hover {
        background: rgba(85, 101, 138, 0.7);
        border-color: #55618c;
    }
    .itowns-ui-panel button:active {
        background: #6573b5;
        border-color: #8797d5;
    }
    .itowns-ui-panel button.is-active {
        background: #5e6dd0;
        border-color: #8ea0ff;
        box-shadow: 0 0 12px rgba(102, 141, 255, 0.4);
        color: #fff;
    }
    .itowns-ui-panel input[type="checkbox"] {
        appearance: none;
        width: 17px;
        height: 17px;
        border-radius: 4px;
        border: 1px solid #4d5063;
        background: rgba(255,255,255,0.08);
        transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.25s ease;
        cursor: pointer;
    }
    .itowns-ui-panel input[type="checkbox"]:hover {
        border-color: #8aa4ff;
        box-shadow: 0 0 6px rgba(122, 149, 255, 0.35);
    }
    .itowns-ui-panel input[type="checkbox"]:checked {
        background: linear-gradient(135deg,#65c1ff,#5b7cff);
        border-color: #86b8ff;
        box-shadow: 0 0 8px rgba(87, 143, 255, 0.5);
    }
    .itowns-ui-panel input[type="range"] {
        -webkit-appearance: none;
        width: 100%;
        height: 6px;
        border-radius: 999px;
        background: rgba(255,255,255,0.22);
        outline: none;
        cursor: pointer;
    }
    .itowns-ui-panel input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 2px solid #8fb4ff;
        background: #fff;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
        transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
    }
    .itowns-ui-panel input[type="range"]:hover::-webkit-slider-thumb {
        transform: scale(1.08);
        border-color: #a7c6ff;
    }
    .itowns-ui-panel input[type="range"]::-moz-range-thumb {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 2px solid #8fb4ff;
        background: #fff;
        box-shadow: 0 2px 6px rgba(0,0,0,0.35);
        transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
    }
    .itowns-ui-panel input[type="range"]:hover::-moz-range-thumb {
        transform: scale(1.08);
        border-color: #a7c6ff;
    }
    `;
    document.head.appendChild(style);
}

applyPersistedRoadGlobalState();

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
    const DEBUG_SPHERE_CTL = true;
    const logSphere = (...args) => {
        if (!DEBUG_SPHERE_CTL) return;
        console.log('[SphereCtl]', ...args);
    };

    logSphere('init controller', { radius, offset01, opacity, color });

    // --- Sphere mesh ---------------------------------------------------------
    const sphereGeom = new THREE.SphereGeometry(1, 32, 16);
    const sphereMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const sphereMesh = new THREE.Mesh(sphereGeom, sphereMat);
    sphereMesh.renderOrder = 20;
    view.scene.add(sphereMesh);

    // --- Cone mesh (created as cylinder; we control radii) -------------------
    const coneMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        depthTest: false, // draw as overlay so it never disappears inside the globe
        side: THREE.DoubleSide,
        wireframe: true,
    });
    const coneMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 0, 1, 48, 1, true),
        coneMat,
    );
    coneMesh.renderOrder = 21;
    coneMesh.visible = false; // start in "sphere" mode
    coneMesh.frustumCulled = false;
    view.scene.add(coneMesh);

    let displayMode = 'sphere'; // 'sphere' | 'cone'
    const CYLINDER_EPS = 1e-3;

    // --- Parameter state: view radius + intersection ------------------------
    // Use the incoming radius/offset as the initial sphere configuration, then
    // derive an equivalent "view radius" so initial visuals stay unchanged.
    const baseF = Math.sqrt(Math.max(1e-6, 2.0 * offset01 - offset01 * offset01));
    const initialViewRadius = radius * baseF;

    const state = {
        groundECEF: new THREE.Vector3(),
        hasGround: false,

        // UI-level parameters
        viewRadius: initialViewRadius, // intersection circle radius on ground
        intersection01: offset01,      // controls intersection angle

        sphereRadius: radius,
    };

    function updateTransform() {
        if (!state.hasGround) {
            logSphere('updateTransform skipped, no ground yet');
            return;
        }
        logSphere('updateTransform begin', {
            viewRadius: state.viewRadius,
            intersection01: state.intersection01,
        });

        const normal = state.groundECEF.clone().normalize(); // local "up"
        const G = state.groundECEF; // ground intersection center

        // --- sphere placement (unchanged) --------------------------------------
        const tRaw = state.intersection01;
        const t = Math.min(0.999, Math.max(0.001, tRaw));
        const nearCylinder = tRaw >= 0.999;

        const rView = Math.max(1, state.viewRadius);
        const f = Math.sqrt(Math.max(1e-6, 2.0 * t - t * t));

        const R = rView / f;          // sphere radius so that its ground intersection has radius rView
        state.sphereRadius = R;

        const h = R * (1.0 - t);      // center height above ground
        const C = G.clone().addScaledVector(normal, h);
        const Z = C.clone().addScaledVector(normal, R); // sphere zenith (where the cone base is)

        sphereMesh.position.copy(C);
        sphereMesh.scale.setScalar(R);
        sphereMesh.lookAt(new THREE.Vector3(0, 0, 0));
        sphereMesh.rotateX(Math.PI / 2);

        // --- cone placement ----------------------------------------------------
        //
        // Axis is along local UP (normal); cone points "down" (towards planet).
        // Base: center Z, radius R_base (we use the sphere radius R).
        // --- Cone placement --------------------------------------------------
        //
        // Use the sketch relations:
        //   h_c   = rView^2 / (R * (1 - t))     (depth of apex below ground)
        //   R_top = rView * (h_c + h_z) / h_c   (base radius at the sphere zenith)
        //   h_z   = h + R                       (ground → zenith distance)
        //
        // As t → 1 we treat it as a cylinder to avoid infinite height.

        const h_z = h + R;
        const rawOneMinusT = Math.max(0, 1 - tRaw);
        const nearCylinderCase = nearCylinder || rawOneMinusT < CYLINDER_EPS;

        let topRadius = rView;
        let bottomRadius = 0;
        let height = 0;
        let coneCenter = G.clone();

        if (nearCylinderCase) {
            height = Math.max(1, 2 * rView);
            topRadius = rView;
            bottomRadius = rView;
            coneCenter.copy(G);
        } else {
            const denom = R - rView;
            const safeDenom = Math.abs(denom) < 1e-5 ? (denom >= 0 ? 1e-5 : -1e-5) : denom;
            const h_c = (rView * h_z) / safeDenom; // depth below ground
            const apex = G.clone().addScaledVector(normal, -h_c);
            const base = Z.clone();
            height = Math.max(1, apex.distanceTo(base));
            coneCenter.copy(apex).addScaledVector(normal, height * 0.5);

            topRadius = R;
            bottomRadius = 0;
        }

        coneMesh.geometry.dispose();
        coneMesh.geometry = new THREE.CylinderGeometry(
            topRadius,
            bottomRadius,
            height,
            64,
            1,
            true
        );

        coneMesh.position.copy(coneCenter);
        const up = new THREE.Vector3(0, 1, 0);
        coneMesh.quaternion.setFromUnitVectors(up, normal);

        const coneWorldCenter = coneCenter.clone();

        logSphere('updateTransform complete', {
            sphereCenter: sphereMesh.position.toArray(),
            sphereRadius: R,
            coneCenter: coneWorldCenter.toArray(),
            coneHeight: height,
            coneTopRadius: topRadius,
            coneBottomRadius: bottomRadius,
        });
        view.notifyChange(true);
    }

    return {
        mesh: sphereMesh,
        coneMesh,
        hasGround() {
            return state.hasGround;
        },
        setGroundFromWorld(vec3) {
            state.groundECEF.copy(vec3);
            state.hasGround = true;
            logSphere('setGroundFromWorld', vec3.toArray());
            updateTransform();
        },
        // "Radius" slider → view radius (intersection radius on ground)
        setRadius(meters) {
            state.viewRadius = Math.max(1, +meters);
            logSphere('setRadius', state.viewRadius);
            updateTransform();
        },
        // "Offset" slider → intersection parameter (angle)
        setOffset01(t) {
            state.intersection01 = Math.min(1, Math.max(0, +t));
            logSphere('setOffset01', state.intersection01);
            updateTransform();
        },
        setOpacity(a) {
            const clamped = Math.min(1, Math.max(0, +a));
            sphereMat.opacity = clamped;
            coneMat.opacity = clamped;
            logSphere('setOpacity', clamped);
            view.notifyChange(true);
        },
        setColor(hex) {
            sphereMat.color.set(hex);
            coneMat.color.set(hex);
            logSphere('setColor', hex);
            view.notifyChange(true);
        },
        setDisplayMode(mode) {
            displayMode = mode === 'cone' ? 'cone' : 'sphere';
            sphereMesh.visible = displayMode === 'sphere';
            coneMesh.visible = displayMode === 'cone';
            logSphere('setDisplayMode', displayMode);
            view.notifyChange(true);
        },
        getDisplayMode() {
            return displayMode;
        },
    };
}


function initSphereAtLookAt(view, sphereCtl) {
    const c = view.controls.getLookAtCoordinate();
    const groundECEF = c.as(view.referenceCrs);
    sphereCtl.setGroundFromWorld(new THREE.Vector3(groundECEF.x, groundECEF.y, groundECEF.z));
}

function createSphereWidget(view, sphereCtl, init = { radius: 1000, offset01: 1.0, opacity: 0.5 }) {
    ensureUIPanelStyles();
    const panel = document.createElement('div');
    applyPanelStyle(panel, { left: '10px', top: '10px', minWidth: '280px' });
    panel.classList.add('itowns-ui-panel');
    const state = {
        radius: Number.isFinite(init.radius) ? init.radius : 1000,
        offset01: Number.isFinite(init.offset01) ? init.offset01 : 1.0,
        opacity: Number.isFinite(init.opacity) ? init.opacity : 0.5,
    };
    panel.innerHTML = `
        <div style="font-weight:bold; font-size:14px; border-bottom:1px solid #555; padding-bottom:5px;">
            Projection Sphere
        </div>
                <div style="display:flex; gap:8px; margin:6px 0 4px 0;">
            <button id="sp-mode-sphere" style="${UI_BUTTON_STYLE}flex:1;" class="is-active">Sphere</button>
            <button id="sp-mode-cone" style="${UI_BUTTON_STYLE}flex:1;">Cone</button>
        </div>
        <div style="display:flex; flex-direction:column; gap:5px;">
            <div style="display:flex; justify-content:space-between;">
                <span>View Radius (m)</span>
                <span id="sp-rv">${state.radius.toFixed(0)} m</span>
            </div>
            <input id="sp-r" type="range" min="10" max="20000" step="10" value="${state.radius}">
        </div>
        <div style="display:flex; flex-direction:column; gap:5px;">
            <div style="display:flex; justify-content:space-between;">
                <span>Intersection</span>
                <span id="sp-ov">${state.offset01.toFixed(2)}</span>
            </div>
            <input id="sp-o" type="range" min="0" max="1" step="0.01" value="${state.offset01}">
        </div>
        <div style="display:flex; flex-direction:column; gap:5px;">
            <div style="display:flex; justify-content:space-between;">
                <span>Opacity</span>
                <span id="sp-av">${state.opacity.toFixed(2)}</span>
            </div>
            <input id="sp-a" type="range" min="0" max="1" step="0.01" value="${state.opacity}">
        </div>
        <div style="display:flex; gap:8px; margin-top:4px;">
            <button id="sp-center" style="${UI_BUTTON_STYLE}flex:1;">Place @ center</button>
            <button id="sp-pick" style="${UI_BUTTON_STYLE}flex:1;">Pick (S)</button>
        </div>
    `;
    document.body.appendChild(panel);

    const radiusInput = panel.querySelector('#sp-r');
    const offsetInput = panel.querySelector('#sp-o');
    const opacityInput = panel.querySelector('#sp-a');
    const radiusLabel = panel.querySelector('#sp-rv');
    const offsetLabel = panel.querySelector('#sp-ov');
    const opacityLabel = panel.querySelector('#sp-av');
    const btnCenter = panel.querySelector('#sp-center');
    const btnPick = panel.querySelector('#sp-pick');

    const btnModeSphere = panel.querySelector('#sp-mode-sphere');
    const btnModeCone = panel.querySelector('#sp-mode-cone');

    const persistSphereState = () => {
        RoadUIStorage.save({
            sphereRadius: state.radius,
            sphereOffset: state.offset01,
            sphereOpacity: state.opacity,
        });
    };

    sphereCtl.setRadius(state.radius);
    sphereCtl.setOffset01(state.offset01);
    sphereCtl.setOpacity(state.opacity);

    const updateModeButtons = () => {
        const mode = sphereCtl.getDisplayMode ? sphereCtl.getDisplayMode() : 'sphere';
        btnModeSphere.classList.toggle('is-active', mode === 'sphere');
        btnModeCone.classList.toggle('is-active', mode === 'cone');
    };

    btnModeSphere.addEventListener('click', () => {
        if (sphereCtl.setDisplayMode) {
            sphereCtl.setDisplayMode('sphere');
        }
        updateModeButtons();
    });

    btnModeCone.addEventListener('click', () => {
        if (sphereCtl.setDisplayMode) {
            sphereCtl.setDisplayMode('cone');
        }
        updateModeButtons();
    });

    // Initialize button state
    updateModeButtons();

    radiusInput.addEventListener('input', (e) => {
        state.radius = parseFloat(e.target.value);
        radiusLabel.textContent = `${state.radius.toFixed(0)} m`;
        sphereCtl.setRadius(state.radius);
        persistSphereState();
    });
    offsetInput.addEventListener('input', (e) => {
        state.offset01 = parseFloat(e.target.value);
        offsetLabel.textContent = state.offset01.toFixed(2);
        sphereCtl.setOffset01(state.offset01);
        persistSphereState();
    });
    opacityInput.addEventListener('input', (e) => {
        state.opacity = parseFloat(e.target.value);
        opacityLabel.textContent = state.opacity.toFixed(2);
        sphereCtl.setOpacity(state.opacity);
        persistSphereState();
    });

    btnCenter.addEventListener('click', () => {
        const c = view.controls.getLookAtCoordinate();
        const g = c.as(view.referenceCrs);
        sphereCtl.setGroundFromWorld(new THREE.Vector3(g.x, g.y, g.z));
    });

    let buttonPicking = false;
    let keyPicking = false;
    const updatePickVisual = () => {
        const active = buttonPicking || keyPicking;
        btnPick.classList.toggle('is-active', active);
    };

    btnPick.addEventListener('click', () => {
        buttonPicking = !buttonPicking;
        updatePickVisual();
    });

    viewerDiv.addEventListener('keydown', (event) => {
        if (event.key === 's') {
            keyPicking = true;
            updatePickVisual();
        }
    });
    viewerDiv.addEventListener('keyup', (event) => {
        if (event.key === 's') {
            keyPicking = false;
            updatePickVisual();
        }
    });

    viewerDiv.addEventListener('click', (event) => {
        if (!(buttonPicking || keyPicking)) return;
        const picked = view.getPickingPositionFromDepth(view.eventToViewCoords(event));
        if (picked) sphereCtl.setGroundFromWorld(picked);
        if (keyPicking) {
            keyPicking = false;
            updatePickVisual();
        }
    });

    updatePickVisual();
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
    createSphereWidget(view, sphereCtl, getPersistedSphereSettings());
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
    applyFrustumCullingState();
    triggerUpdate();
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
    ensureUIPanelStyles();
    const panel = document.createElement('div');
    applyPanelStyle(panel, { right: '10px', top: '10px' });
    panel.classList.add('itowns-ui-panel');

    const checkboxStyle = '';
    panel.innerHTML = `
        <div style="font-weight:bold; font-size:14px; border-bottom:1px solid #4b5066; padding-bottom:5px;">
            Road Settings
        </div>
        
        <label style="${TOGGLE_LABEL_STYLE}">
            <input type="checkbox" id="ui-visible" ${RoadGlobalState.visible ? 'checked' : ''} style="${checkboxStyle}">
            <span style="${TOGGLE_TEXT_STYLE}">Visibility</span>
        </label>

        <label style="${TOGGLE_LABEL_STYLE}">
            <input type="checkbox" id="ui-ontop" ${RoadGlobalState.depthTest ? '' : 'checked'} style="${checkboxStyle}">
            <span style="${TOGGLE_TEXT_STYLE}">Always On Top (Ghost)</span>
        </label>

        <label style="${TOGGLE_LABEL_STYLE}">
            <input type="checkbox" id="ui-projection" ${RoadGlobalState.useProjection ? 'checked' : ''} style="${checkboxStyle}">
            <span style="${TOGGLE_TEXT_STYLE}">Stereographic Projection</span>
        </label>

        <label style="${TOGGLE_LABEL_STYLE}">
            <input type="checkbox" id="ui-cull" ${RoadGlobalState.cullBackfaces ? 'checked' : ''} style="${checkboxStyle}">
            <span style="${TOGGLE_TEXT_STYLE}">Cull Backfaces (Sphere)</span>
        </label>
        <label style="${TOGGLE_LABEL_STYLE}">
            <input type="checkbox" id="ui-nocull" ${RoadGlobalState.disableFrustumCulling ? 'checked' : ''} style="${checkboxStyle}">
            <span style="${TOGGLE_TEXT_STYLE}">Disable Frustum Culling</span>
        </label>
        <label style="${TOGGLE_LABEL_STYLE}">
            <input type="checkbox" id="ui-widths" ${RoadGlobalState.useIndividualWidths ? 'checked' : ''} style="${checkboxStyle}">
            <span style="${TOGGLE_TEXT_STYLE}">Per-Road Widths</span>
        </label>


        <div style="display:flex; flex-direction:column; gap:4px;">
            <div style="display:flex; justify-content:space-between;">
                <span>Width Multiplier</span>
                <span id="ui-width-val">${RoadGlobalState.widthMultiplier.toFixed(1)}x</span>
            </div>
            <input type="range" id="ui-width" min="0.1" max="5" step="0.1" value="${RoadGlobalState.widthMultiplier}">
        </div>

        <div style="display:flex; flex-direction:column; gap:4px;">
            <div style="display:flex; justify-content:space-between;">
                <span>Elevation Offset</span>
                <span id="ui-alt-val">${RoadGlobalState.altitudeOffset.toFixed(1)} m</span>
            </div>
            <input type="range" id="ui-alt" min="-50" max="50" step="0.5" value="${RoadGlobalState.altitudeOffset}">
        </div>

        <label style="${TOGGLE_LABEL_STYLE}">
            <input type="checkbox" id="ui-worldunits" ${RoadGlobalState.useWorldUnits ? 'checked' : ''} style="${checkboxStyle}">
            <span style="${TOGGLE_TEXT_STYLE}">World Units (Meters)</span>
        </label>
        
        <!--
        <button id="ui-debug" style="${UI_BUTTON_STYLE}width:100%;text-align:center;margin-top:6px;">Debug Console</button>
        -->
    `;
    document.body.appendChild(panel);

    const visibleInput = document.getElementById('ui-visible');
    const ghostInput = document.getElementById('ui-ontop');
    const projectionInput = document.getElementById('ui-projection');
    const cullInput = document.getElementById('ui-cull');
    const noCullInput = document.getElementById('ui-nocull');
    const widthsInput = document.getElementById('ui-widths');
    const widthSlider = document.getElementById('ui-width');
    const widthLabel = document.getElementById('ui-width-val');
    const altSlider = document.getElementById('ui-alt');
    const altLabel = document.getElementById('ui-alt-val');
    const worldUnitsInput = document.getElementById('ui-worldunits');

    visibleInput.checked = RoadGlobalState.visible;
    ghostInput.checked = !RoadGlobalState.depthTest;
    projectionInput.checked = RoadGlobalState.useProjection;
    cullInput.checked = RoadGlobalState.cullBackfaces;
    noCullInput.checked = RoadGlobalState.disableFrustumCulling;
    widthsInput.checked = RoadGlobalState.useIndividualWidths;
    widthSlider.value = RoadGlobalState.widthMultiplier;
    widthLabel.innerText = RoadGlobalState.widthMultiplier.toFixed(1) + 'x';
    altSlider.value = RoadGlobalState.altitudeOffset;
    altLabel.innerText = RoadGlobalState.altitudeOffset.toFixed(1) + ' m';
    worldUnitsInput.checked = RoadGlobalState.useWorldUnits;

    for (const layer of roadLayers) {
        layer.object3d.visible = RoadGlobalState.visible;
    }

    // Events
    visibleInput.addEventListener('change', (e) => {
        RoadGlobalState.visible = e.target.checked;
        for (const layer of roadLayers) {
            layer.object3d.visible = RoadGlobalState.visible;
        }
        RoadUIStorage.save({ visible: RoadGlobalState.visible });
        notifyRoadLayers();
    });

    ghostInput.addEventListener('change', (e) => {
        RoadGlobalState.depthTest = !e.target.checked;
        RoadUIStorage.save({ depthTest: RoadGlobalState.depthTest });
        triggerUpdate();
    });

    projectionInput.addEventListener('change', (e) => {
        RoadGlobalState.useProjection = e.target.checked;
        RoadUIStorage.save({ useProjection: RoadGlobalState.useProjection });
        triggerUpdate();
    });

    cullInput.addEventListener('change', (e) => {
        RoadGlobalState.cullBackfaces = e.target.checked;
        RoadUIStorage.save({ cullBackfaces: RoadGlobalState.cullBackfaces });
        notifyRoadLayers();
    });

    noCullInput.addEventListener('change', (e) => {
        RoadGlobalState.disableFrustumCulling = e.target.checked;
        RoadUIStorage.save({ disableFrustumCulling: RoadGlobalState.disableFrustumCulling });
        applyFrustumCullingState();
    });

    widthsInput.addEventListener('change', (e) => {
        RoadGlobalState.useIndividualWidths = e.target.checked;
        RoadUIStorage.save({ useIndividualWidths: RoadGlobalState.useIndividualWidths });
        rebuildAllRoadTiles();
        applyGlobalStateToMaterials();
    });

    widthSlider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        widthLabel.innerText = v.toFixed(1) + 'x';
        RoadGlobalState.widthMultiplier = v;
        RoadUIStorage.save({ widthMultiplier: RoadGlobalState.widthMultiplier });
        triggerUpdate();
    });

    altSlider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        altLabel.innerText = v.toFixed(1) + ' m';
        RoadGlobalState.altitudeOffset = v;
        RoadUIStorage.save({ altitudeOffset: RoadGlobalState.altitudeOffset });
        rebuildAllRoadTiles();
    });

    worldUnitsInput.addEventListener('change', (e) => {
        RoadGlobalState.useWorldUnits = e.target.checked;
        RoadUIStorage.save({ useWorldUnits: RoadGlobalState.useWorldUnits });
        triggerUpdate();
    });

    // document.getElementById('ui-debug').addEventListener('click', () => {
    //     let count = 0;
    //     for (const layer of roadLayers) {
    //         layer.object3d.traverse(o => { if (o.userData?.isFatLine) count++; });
    //     }
    //     RoadFatLineRoot.traverse(o => { if (o.userData?.isFatLine) count++; });
    //     console.log(`Visible Fat Lines: ${count}`);
    // });
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
