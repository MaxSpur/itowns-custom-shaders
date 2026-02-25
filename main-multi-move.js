import * as itowns from 'itowns';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// -----------------------------------------------------------------------------
// 1. VIEW SETUP
// -----------------------------------------------------------------------------

const viewerDiv = document.getElementById('viewerDiv');

// Z-up for three.js
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

// One generic iTowns View in Web Mercator
const view = new itowns.View('EPSG:3857', viewerDiv);
view.mainLoop.gfxEngine.renderer.setClearColor(0x999999);

// Parent "desk" object that will hold our two map panels
const desk = new THREE.Object3D();
view.scene.add(desk);

// -----------------------------------------------------------------------------
// 2. EXTENT HELPERS AND BASE EXTENTS
// -----------------------------------------------------------------------------

// Helper: build a small EPSG:3857 extent around a lon/lat center
function makeExtent3857(lonDeg, latDeg, halfWidthDeg = 0.04, halfHeightDeg = 0.025) {
    const ext4326 = new itowns.Extent(
        'EPSG:4326',
        lonDeg - halfWidthDeg,
        lonDeg + halfWidthDeg,
        latDeg - halfHeightDeg,
        latDeg + halfHeightDeg,
    );
    return ext4326.as('EPSG:3857');
}

// helper: get the overall extent from two extents
function unionExtents(ext1, ext2) {
    const minX = Math.min(ext1.west, ext2.west);
    const maxX = Math.max(ext1.east, ext2.east);
    const minY = Math.min(ext1.south, ext2.south);
    const maxY = Math.max(ext1.north, ext2.north);
    return new itowns.Extent(ext1.crs, minX, maxX, minY, maxY);
}

// Approximate decimal coordinates from your inputs
const vincennesBase = {
    id: 'vincennes',
    label: 'Vincennes',
    lon: 2.439166666666667,   // 2°26′21″E
    lat: 48.84777777777778,   // 48°50′52″N
};

const marneBase = {
    id: 'marne',
    label: 'Marne-la-Vallée',
    lon: 2.587765595893772,
    lat: 48.84103338960687,
};

const extentVincennes0 = makeExtent3857(vincennesBase.lon, vincennesBase.lat);
const extentMarne0 = makeExtent3857(marneBase.lon, marneBase.lat);
const totalExtent = unionExtents(extentVincennes0, extentMarne0);

// Use Vincennes extent just to normalize the desk scale
const baseExtent = extentVincennes0;
const baseDim = baseExtent.planarDimensions().x;
const scale = new THREE.Vector3(1, 1, 1).divideScalar(baseDim);
desk.scale.copy(scale);
desk.updateMatrixWorld(true);

// -----------------------------------------------------------------------------
// 3. ORTHO WMTS SOURCE + DEM WMS SOURCE (GLOBAL)
// -----------------------------------------------------------------------------

// Global orthophoto in EPSG:3857 (PM tiling)
const orthoSource = new itowns.WMTSSource({
    url: 'https://data.geopf.fr/wmts?',
    crs: 'EPSG:3857',
    name: 'ORTHOIMAGERY.ORTHOPHOTOS',
    tileMatrixSet: 'PM',
    format: 'image/jpeg',
});

// DEM from WMS altimetry (coverage extent set once)
const demSource = new itowns.WMSSource({
    url: 'https://data.geopf.fr/wms-r/wms?',
    name: 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES',
    format: 'image/x-bil;bits=32',
    crs: 'EPSG:3857',
    extent: totalExtent,
});

// -----------------------------------------------------------------------------
// 4. PANEL STATE + REBUILD LOGIC
// -----------------------------------------------------------------------------

// Internal state per panel (lon/lat/zoom + layers)
const panelStates = {};

// Base “zoom” is defined by these angular spans; zoom in halves them
const BASE_HALF_WIDTH_DEG = 0.04;   // ~few km
const BASE_HALF_HEIGHT_DEG = 0.025;

// Create / update one panel state and (re)build the PlanarLayer + layers
function rebuildPanel(panelId) {
    const state = panelStates[panelId];
    if (!state) return;

    // 1) Properly remove previous tiled/color/elevation layers (if any)
    const removeLayerIfPresent = (layerRefKey) => {
        const layer = state[layerRefKey];
        if (!layer) return;
        if (view.getLayerById(layer.id)) {
            view.removeLayer(layer.id);
        }
        state[layerRefKey] = null;
    };
    // Remove children first so they don't get auto-removed with the planar layer
    removeLayerIfPresent('colorLayer');
    removeLayerIfPresent('elevationLayer');
    removeLayerIfPresent('planarLayer');

    // 2) Compute new geographic extent from center lon/lat + zoomLevel
    const zoomFactor = Math.pow(0.5, state.zoomLevel);       // each level halves the window
    const halfW = BASE_HALF_WIDTH_DEG * zoomFactor;
    const halfH = BASE_HALF_HEIGHT_DEG * zoomFactor;

    const extent4326 = new itowns.Extent(
        'EPSG:4326',
        state.centerLon - halfW,
        state.centerLon + halfW,
        state.centerLat - halfH,
        state.centerLat + halfH,
    );
    const extent3857 = extent4326.as('EPSG:3857');
    state.extent = extent3857;

    // 3) Recompute the root offset so the PANEL STAYS IN PLACE on the desk.
    //    Whatever the extent center is, we translate so that the center ends up at deskPosition.
    const offset = extent3857.center().toVector3().negate();
    offset.add(state.deskPosition.clone().divide(scale));
    state.root.position.copy(offset);
    state.root.updateMatrixWorld(true);

    // Ensure the root is a child of the desk (it may have been removed when the
    // previous PlanarLayer was deleted).
    if (state.root.parent !== desk) {
        desk.add(state.root);
        state.root.updateMatrixWorld(true);
    }

    // 4) Create new tiled geometry + color + elevation on this root
    const planarLayer = new itowns.PlanarLayer(
        `planar_${panelId}`,
        extent3857,
        state.root,
        { disableSkirt: true },
    );
    view.addLayer(planarLayer);

    const colorLayer = new itowns.ColorLayer(`ortho_${panelId}`, {
        source: orthoSource,
    });
    view.addLayer(colorLayer, planarLayer);

    const elevationLayer = new itowns.ElevationLayer(`dem_${panelId}`, {
        source: demSource,
    });
    view.addLayer(elevationLayer, planarLayer);

    // 5) Store references for next time
    state.planarLayer = planarLayer;
    state.colorLayer = colorLayer;
    state.elevationLayer = elevationLayer;

    view.notifyChange(view.camera3D);
}

// Initialize both panels (root objects + initial state)
function initPanels() {
    const definitions = [
        {
            base: vincennesBase,
            deskPosition: new THREE.Vector3(-0.6, 0, 0), // left
        },
        {
            base: marneBase,
            deskPosition: new THREE.Vector3(0.6, 0, 0),  // right
        },
    ];

    definitions.forEach((def) => {
        const root = new THREE.Object3D();
        desk.add(root);

        panelStates[def.base.id] = {
            id: def.base.id,
            label: def.base.label,
            root,
            deskPosition: def.deskPosition,   // where the panel should live on the desk
            centerLon: def.base.lon,
            centerLat: def.base.lat,
            zoomLevel: 0,                     // 0 = base window, +1 zoom in, -1 zoom out
            extent: null,
            planarLayer: null,
            colorLayer: null,
            elevationLayer: null,
        };

        // This will compute the extent, position the root correctly,
        // and create Planar/Color/Elevation layers.
        rebuildPanel(def.base.id);
    });
}
// Call once
initPanels();

// -----------------------------------------------------------------------------
// 5. CAMERA + ORBIT CONTROLS (TABLE POSITIONING)
// -----------------------------------------------------------------------------

// Place camera above the desk looking at the origin
view.camera3D.position.set(0, -2.5, 2.0);
view.camera3D.lookAt(new THREE.Vector3(0, 0, 0));
view.camera3D.updateMatrixWorld(true);

const controls = new OrbitControls(view.camera3D, viewerDiv);
controls.enableDamping = true;
controls.dampingFactor = 0.15;
controls.target.set(0, 0, 0);

// Default mode is "orbit" (same as your last version)
controls.enableRotate = true;
controls.enablePan = true;

controls.addEventListener('change', () => {
    view.notifyChange(view.camera3D);
});

// -----------------------------------------------------------------------------
// 6. SIMPLE UI: BUTTONS PER PANEL (N/S/E/W/Zoom+/Zoom-)
// -----------------------------------------------------------------------------

function movePanel(panelId, dLonDeg, dLatDeg) {
    const state = panelStates[panelId];
    if (!state) return;
    state.centerLon += dLonDeg;
    state.centerLat += dLatDeg;
    rebuildPanel(panelId);
}

function zoomPanel(panelId, deltaLevel) {
    const state = panelStates[panelId];
    if (!state) return;
    state.zoomLevel = Math.max(-3, Math.min(5, state.zoomLevel + deltaLevel));
    rebuildPanel(panelId);
}

// Create a small overlay with buttons; no change to index.html needed
function createPanelControls(panelId, label, xPx) {
    const state = panelStates[panelId];
    if (!state) return;

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '10px';
    container.style.left = `${xPx}px`;
    container.style.padding = '6px';
    container.style.background = 'rgba(0,0,0,0.5)';
    container.style.color = 'white';
    container.style.fontFamily = 'sans-serif';
    container.style.fontSize = '11px';
    container.style.zIndex = '1000';
    container.style.borderRadius = '4px';

    const title = document.createElement('div');
    title.textContent = label;
    title.style.marginBottom = '4px';
    title.style.fontWeight = 'bold';
    container.appendChild(title);

    function makeButton(text, onClick) {
        const b = document.createElement('button');
        b.textContent = text;
        b.style.margin = '2px';
        b.style.fontSize = '10px';
        b.onclick = onClick;
        return b;
    }

    // Row: N
    const rowN = document.createElement('div');
    rowN.appendChild(makeButton('N', () => movePanel(panelId, 0.0, 0.001)));
    container.appendChild(rowN);

    // Row: W / E
    const rowWE = document.createElement('div');
    rowWE.appendChild(makeButton('W', () => movePanel(panelId, -0.0015, 0.0)));
    rowWE.appendChild(makeButton('E', () => movePanel(panelId, 0.0015, 0.0)));
    container.appendChild(rowWE);

    // Row: S
    const rowS = document.createElement('div');
    rowS.appendChild(makeButton('S', () => movePanel(panelId, 0.0, -0.001)));
    container.appendChild(rowS);

    // Row: zoom
    const rowZ = document.createElement('div');
    rowZ.appendChild(makeButton('Zoom +', () => zoomPanel(panelId, +1)));
    rowZ.appendChild(makeButton('Zoom -', () => zoomPanel(panelId, -1)));
    container.appendChild(rowZ);

    document.body.appendChild(container);
}

// Controls for left (Vincennes) and right (Marne) panels
createPanelControls('vincennes', 'Vincennes', 10);
createPanelControls('marne', 'Marne-la-Vallée', 140);

// -----------------------------------------------------------------------------
// 7. INITIAL RENDER + DEBUG
// -----------------------------------------------------------------------------

view.notifyChange(view.camera3D);

window.view = view;
window.itowns = itowns;
window.THREE = THREE;
window.panelStates = panelStates;
