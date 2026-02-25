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
// 2. EXTENTS FOR VINCENNES AND MARNE-LA-VALLÉE
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
const vincennes = {
    id: 'vincennes',
    lon: 2.439166666666667,   // 2°26′21″E
    lat: 48.84777777777778,   // 48°50′52″N
};

const marne = {
    id: 'marne',
    lon: 2.587765595893772,
    lat: 48.84103338960687,
};

const extentVincennes = makeExtent3857(vincennes.lon, vincennes.lat);
const extentMarne = makeExtent3857(marne.lon, marne.lat);
const totalExtent = unionExtents(extentVincennes, extentMarne);

// Use Vincennes extent just to normalize the desk scale
const baseExtent = extentVincennes;
const baseDim = baseExtent.planarDimensions().x;
const scale = new THREE.Vector3(1, 1, 1).divideScalar(baseDim);
desk.scale.copy(scale);
desk.updateMatrixWorld(true);

// -----------------------------------------------------------------------------
// 3. ORTHO WMTS SOURCE (GLOBAL, NO ELEVATION)
// -----------------------------------------------------------------------------

// One global orthophoto source in EPSG:3857 (PM tiling)
const orthoSource = new itowns.WMTSSource({
    url: 'https://data.geopf.fr/wmts?',
    crs: 'EPSG:3857',
    name: 'ORTHOIMAGERY.ORTHOPHOTOS',
    tileMatrixSet: 'PM',
    format: 'image/jpeg',
});

const demSource = new itowns.WMSSource({
    url: 'https://data.geopf.fr/wms-r/wms?',
    name: 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES',
    format: 'image/x-bil;bits=32',
    crs: 'EPSG:3857',
    extent: totalExtent,
});


// -----------------------------------------------------------------------------
// 4. TWO COPLANAR PANELS, SIDE BY SIDE
// -----------------------------------------------------------------------------

const panels = [
    {
        id: 'vincennes',
        title: 'Vincennes',
        extent: extentVincennes,
        position: new THREE.Vector3(-0.6, 0, 0), // left on desk
    },
    {
        id: 'marne',
        title: 'Marne-la-Vallée',
        extent: extentMarne,
        position: new THREE.Vector3(0.6, 0, 0),  // right on desk
    },
];
const panelLayers = [];

panels.forEach(panel => {
    // Local root for this panel
    const obj = new THREE.Object3D();

    // Recenter the extent at the origin, then offset left/right on the desk
    const offset = panel.extent.center().toVector3().negate();
    offset.add(panel.position.clone().divide(scale));

    obj.position.copy(offset);
    desk.add(obj);
    obj.updateMatrixWorld(true);

    // Geometry layer (PlanarLayer) for this panel
    const planarLayer = new itowns.PlanarLayer(
        `planar_${panel.id}`,
        panel.extent,
        obj,
        { disableSkirt: true },
    );
    view.addLayer(planarLayer);

    // Color layer (orthophoto) for this panel
    const colorLayer = new itowns.ColorLayer(`ortho_${panel.id}`, {
        source: orthoSource,
    });
    view.addLayer(colorLayer, planarLayer);

    const elevationLayer = new itowns.ElevationLayer(`dem_${panel.id}`, {
        source: demSource,
    });
    view.addLayer(elevationLayer, planarLayer);
    // Remember base extent + planar layer for map-mode extents manipulation
    panelLayers.push({
        id: panel.id,
        baseExtent: panel.extent,
        planarLayer,
    });
});

// -----------------------------------------------------------------------------
// 4b. MAP MODE STATE: PAN/ZOOM BY CHANGING PANEL EXTENTS
// -----------------------------------------------------------------------------

let currentMode = 'map';      // 'orbit' or 'map'
let mapZoom = 1.0;            // >1 zooms in, <1 zooms out
let mapOffsetX = 0.0;         // EPSG:3857 units
let mapOffsetY = 0.0;

// Recompute each panel's extent from its base extent + shared zoom/offset
function recomputeExtents() {
    // console.log(`Recomputing extents: zoom=${mapZoom.toFixed(2)}, offset=(${mapOffsetX.toFixed(1)}, ${mapOffsetY.toFixed(1)})`);
    panelLayers.forEach((p) => {
        const base = p.baseExtent;

        const center = base.center();               // Coordinates in EPSG:3857
        const dims = base.planarDimensions();       // { x, y }

        const width = dims.x / mapZoom;
        const height = dims.y / mapZoom;

        const centerX = center.x + mapOffsetX;
        const centerY = center.y + mapOffsetY;

        const west = centerX - width * 0.5;
        const east = centerX + width * 0.5;
        const south = centerY - height * 0.5;
        const north = centerY + height * 0.5;

        const newExtent = new itowns.Extent(base.crs, west, east, south, north);

        // p.planarLayer.extent = newExtent;

        p.planarLayer.extent.setFromExtent(newExtent);
        // console.log(`  Panel ${p.id}: ${newExtent.toString()}`);
    });

    view.notifyChange(view.camera3D);
}

// Initial extents (no offset, zoom=1)
recomputeExtents();

// -----------------------------------------------------------------------------
// 5. CAMERA + ORBIT CONTROLS WITH MODE TOGGLE
// -----------------------------------------------------------------------------

// Place camera above the desk looking at the origin
view.camera3D.position.set(0, -2.5, 2.0);
view.camera3D.lookAt(new THREE.Vector3(0, 0, 0));
view.camera3D.updateMatrixWorld(true);

const controls = new OrbitControls(view.camera3D, viewerDiv);
controls.enableDamping = true;
controls.dampingFactor = 0.15;
controls.target.set(0, 0, 0);

// Mode 1: "orbit mode" – rotate + pan + zoom the whole desk
function setOrbitMode() {
    currentMode = 'orbit';
    controls.enabled = true;

    controls.enableRotate = true;
    controls.enablePan = true;

    // Typical OrbitControls mapping
    controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
    };

    console.log('Controls mode: ORBIT (press O)');
}

// Mode 2: "map mode" – freeze camera, pan/zoom by changing panel extents
function setMapMode() {
    currentMode = 'map';
    // Freeze the camera; only extents will move
    controls.enabled = false;

    console.log('Controls mode: MAP (press M)');
}

// Default mode: map-ish
setMapMode();

// Redraw on camera changes
controls.addEventListener('change', () => {
    view.notifyChange(view.camera3D);
});

// Keyboard toggle between modes
document.addEventListener('keydown', (event) => {
    if (event.key === 'o' || event.key === 'O') {
        setOrbitMode();
    } else if (event.key === 'm' || event.key === 'M') {
        setMapMode();
    }
});

// -----------------------------------------------------------------------------
// 5b. Mouse controls in MAP mode (camera frozen)
// -----------------------------------------------------------------------------

let isPanningMap = false;
let lastX = 0;
let lastY = 0;

viewerDiv.addEventListener('mousedown', (event) => {
    if (currentMode !== 'map') return;
    if (event.button !== 0) return; // left button only

    isPanningMap = true;
    lastX = event.clientX;
    lastY = event.clientY;
});

window.addEventListener('mouseup', () => {
    isPanningMap = false;
});

viewerDiv.addEventListener('mousemove', (event) => {
    if (currentMode !== 'map' || !isPanningMap) return;

    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;

    // Use Vincennes base extent dimensions for pixel -> map units
    const dims = baseExtent.planarDimensions();
    const width = dims.x / mapZoom;
    const height = dims.y / mapZoom;

    const unitsPerPixelX = width / viewerDiv.clientWidth;
    const unitsPerPixelY = height / viewerDiv.clientHeight;

    // Drag left -> move map right (hence -= dx)
    mapOffsetX -= dx * unitsPerPixelX;
    // Screen Y grows downwards, so invert sign
    mapOffsetY += dy * unitsPerPixelY;

    recomputeExtents();
});

viewerDiv.addEventListener('wheel', (event) => {
    if (currentMode !== 'map') return;

    event.preventDefault();

    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    mapZoom *= factor;
    mapZoom = Math.min(Math.max(mapZoom, 0.25), 20.0);

    recomputeExtents();
}, { passive: false });

// Initial render
view.notifyChange(view.camera3D);

// Debug hooks if you want them in the console
window.view = view;
window.itowns = itowns;
window.THREE = THREE;