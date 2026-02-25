import * as itowns from 'itowns';
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

// --- CONSTANTS ---
const EARTH_RADIUS = 6378137;
const GLOBE_SPACING = EARTH_RADIUS * 2.2;
const MIN_CAMERA_DISTANCE = EARTH_RADIUS + 50; // Closer limit
const MAX_CAMERA_DISTANCE = EARTH_RADIUS * 100;
const MIN_SURFACE_OFFSET = 10;
const MAX_LATITUDE_DEG = 89; // Allow getting closer to poles

const AXIS_Z = new THREE.Vector3(0, 0, 1);
const AXIS_X = new THREE.Vector3(1, 0, 0);

// --- SCRATCH VARIABLES ---
const scratchVecA = new THREE.Vector3();
const scratchVecB = new THREE.Vector3();
const scratchVecC = new THREE.Vector3();
const scratchCenter = new THREE.Vector3();
const quatTilt = new THREE.Quaternion();
const quatSpin = new THREE.Quaternion();
const pointerNDC = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const scratchMatrixInv = new THREE.Matrix4();
const scratchRayOrigin = new THREE.Vector3();
const scratchRayDir = new THREE.Vector3();

// --- STATE MANAGEMENT ---
const globeRoots = [];
const globeStates = []; // { lon: 0, lat: 0 }
let activeGlobeIndex = 0;

const interactionState = {
    isDragging: false,
    mode: null,
    lastX: 0,
    lastY: 0,
    // For Translation
    grabbedWorldPoint: new THREE.Vector3(),
    hasWorldGrab: false
};



let debugReadout = null;
const rayDebugState = {
    enabled: false,
    hitHelper: null
};

// -----------------------------------------------------------------------------
// 1. Setup Viewer & Globes
// -----------------------------------------------------------------------------

const viewerDiv = document.getElementById('viewerDiv');

const placement = {
    coord: new itowns.Coordinates('EPSG:4326', 2.351323, 48.856712, 0),
    range: 3.5e7,
};

const globe1Root = new THREE.Object3D();
const view = new itowns.GlobeView(viewerDiv, placement, {
    noControls: true,
    object3d: globe1Root,
});

const camera = view.camera3D || view.camera.camera3D;
camera.near = 100; // Better depth precision for large scale
camera.far = EARTH_RADIUS * 1000;
camera.updateProjectionMatrix();

// -- Globe 1 --
const globe1Layer = view.tileLayer;
disableHorizonCulling(globe1Layer);
const atmosphereLayer = view.getLayerById('atmosphere');
if (atmosphereLayer && atmosphereLayer.object3d) {
    atmosphereLayer.visible = false;
    atmosphereLayer.object3d.visible = false;
}
globe1Root.position.set(-GLOBE_SPACING * 0.5, 0, 0);
globe1Root.updateMatrixWorld(true);

globeRoots[0] = globe1Root;
globeStates[0] = { lon: 0, lat: 0 };

// -- Imagery & Elevation --
const orthoSource = new itowns.WMTSSource({
    url: 'https://data.geopf.fr/wmts?',
    crs: 'EPSG:3857',
    name: 'ORTHOIMAGERY.ORTHOPHOTOS',
    tileMatrixSet: 'PM',
    format: 'image/jpeg',
    zoom: { min: 0, max: 18 },
});
const orthoLayer1 = new itowns.ColorLayer('Ortho_globe1', { source: orthoSource });
view.addLayer(orthoLayer1);

const elevationSource = new itowns.WMTSSource({
    url: 'https://data.geopf.fr/wmts?',
    crs: 'EPSG:4326',
    name: 'ELEVATION.ELEVATIONGRIDCOVERAGE.SRTM3',
    tileMatrixSet: 'WGS84G',
    format: 'image/x-bil;bits=32',
    zoom: { min: 0, max: 18 }
});
const elevationLayer1 = new itowns.ElevationLayer('MNT_WORLD', { source: elevationSource });
view.addLayer(elevationLayer1);

// -- Globe 2 --
const globe2Root = new THREE.Object3D();
globe2Root.position.set(GLOBE_SPACING * 0.5, 0, 0);
globe2Root.updateMatrixWorld(true);
view.scene.add(globe2Root);

const globe2Layer = new itowns.GlobeLayer('globe2', globe2Root);
itowns.View.prototype.addLayer.call(view, globe2Layer);
disableHorizonCulling(globe2Layer);

const orthoLayer2 = new itowns.ColorLayer('Ortho_globe2', { source: orthoSource });
itowns.View.prototype.addLayer.call(view, orthoLayer2, globe2Layer);

globeRoots[1] = globe2Root;
globeStates[1] = { lon: 0, lat: 0 };

applyGlobeOrientation(0);
applyGlobeOrientation(1);
frameAllGlobes();

// -----------------------------------------------------------------------------
// 2. Core Math & Intersection Logic
// -----------------------------------------------------------------------------

function disableHorizonCulling(layer) {
    const baseCulling = itowns.TiledGeometryLayer.prototype.culling;
    layer.culling = function (node, camera) {
        if (baseCulling.call(this, node, camera)) return true;
        return node.level < this.minSubdivisionLevel ? false : false;
    };
}

// Robust Ray-Ellipsoid Intersection in Local Space
function intersectEllipsoid(mouseX, mouseY, root) {
    if (!root) return null;

    // 1. Setup Raycaster
    const rect = viewerDiv.getBoundingClientRect();
    pointerNDC.x = ((mouseX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((mouseY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);

    // 2. Transform Ray to Local Space
    // This removes the object's position, rotation, and scale from the equation
    root.updateMatrixWorld(true);
    scratchMatrixInv.copy(root.matrixWorld).invert();
    scratchRayOrigin.copy(raycaster.ray.origin).applyMatrix4(scratchMatrixInv);

    // Direction: Transform (Origin+Dir) then sub transformed Origin
    scratchVecA.copy(raycaster.ray.origin).add(raycaster.ray.direction);
    scratchVecA.applyMatrix4(scratchMatrixInv);
    scratchRayDir.copy(scratchVecA).sub(scratchRayOrigin);
    // We do NOT normalize scratchRayDir to preserve the scale factor of 't' relative to world units if scale is uniform.

    // 3. Solve Ellipsoid Quadratic: (x/Rx)^2 + (y/Ry)^2 + (z/Rz)^2 = 1
    const radii = itowns.ellipsoidSizes || { x: 6378137, y: 6378137, z: 6356752.314 };
    const invRx2 = 1.0 / (radii.x * radii.x);
    const invRy2 = 1.0 / (radii.y * radii.y);
    const invRz2 = 1.0 / (radii.z * radii.z);

    const ox = scratchRayOrigin.x, oy = scratchRayOrigin.y, oz = scratchRayOrigin.z;
    const dx = scratchRayDir.x, dy = scratchRayDir.y, dz = scratchRayDir.z;

    const A = dx * dx * invRx2 + dy * dy * invRy2 + dz * dz * invRz2;
    const B = 2 * (ox * dx * invRx2 + oy * dy * invRy2 + oz * dz * invRz2);
    const C = (ox * ox * invRx2 + oy * oy * invRy2 + oz * oz * invRz2) - 1.0;

    const discriminant = B * B - 4 * A * C;
    if (discriminant < 0) return null;

    const sqrtDisc = Math.sqrt(discriminant);
    const t1 = (-B - sqrtDisc) / (2 * A);
    const t2 = (-B + sqrtDisc) / (2 * A);

    // 4. Filter Results: We only want hits IN FRONT of the camera (t > 0)
    let bestT = Infinity;
    let hitFound = false;

    // Standard check
    if (t1 > 0.0001 && t1 < bestT) { bestT = t1; hitFound = true; }
    if (t2 > 0.0001 && t2 < bestT) { bestT = t2; hitFound = true; }

    if (!hitFound) return null;

    // 5. Compute Point
    scratchVecC.copy(scratchRayDir).multiplyScalar(bestT).add(scratchRayOrigin);

    // 6. World Point
    const hitWorld = scratchVecC.clone().applyMatrix4(root.matrixWorld);

    return {
        worldPoint: hitWorld,
        distance: camera.position.distanceTo(hitWorld)
    };
}

function updateRayDebug(hitPoint) {
    if (!rayDebugState.enabled) {
        if (rayDebugState.hitHelper) rayDebugState.hitHelper.visible = false;
        return;
    }

    if (!rayDebugState.hitHelper) {
        rayDebugState.hitHelper = new THREE.Mesh(
            new THREE.SphereGeometry(EARTH_RADIUS * 0.015, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false, transparent: true, opacity: 0.8 })
        );
        rayDebugState.hitHelper.renderOrder = 9999;
        view.scene.add(rayDebugState.hitHelper);
    }

    if (hitPoint) {
        rayDebugState.hitHelper.position.copy(hitPoint);
        rayDebugState.hitHelper.visible = true;
        // Scale helper to remain visible but not huge
        const dist = camera.position.distanceTo(hitPoint);
        const s = dist * 0.01;
        rayDebugState.hitHelper.scale.set(s, s, s);
    } else {
        rayDebugState.hitHelper.visible = false;
    }
    view.notifyChange(true);
}

// -----------------------------------------------------------------------------
// 3. Navigation
// -----------------------------------------------------------------------------

function applyGlobeOrientation(index) {
    const root = globeRoots[index];
    const state = globeStates[index];
    if (!root || !state) return;

    // North Up Logic:
    // 1. Tilt (Around X) - brings pole towards/away
    // 2. Spin (Around Z) - rotates around pole
    const yawRad = THREE.MathUtils.degToRad(state.lon);
    const pitchRad = THREE.MathUtils.degToRad(state.lat);

    quatTilt.setFromAxisAngle(AXIS_X, pitchRad);
    quatSpin.setFromAxisAngle(AXIS_Z, yawRad);

    root.quaternion.multiplyQuaternions(quatTilt, quatSpin);
    root.updateMatrixWorld(true);
}

function normalizeLon(lon) {
    return ((lon + 180) % 360 + 360) % 360 - 180;
}

function clampLat(lat) {
    return THREE.MathUtils.clamp(lat, -MAX_LATITUDE_DEG, MAX_LATITUDE_DEG);
}

function onMouseDown(event) {
    if (event.button !== 0 && event.button !== 2) return;

    const root = globeRoots[activeGlobeIndex];
    if (!root) return;

    const hit = intersectEllipsoid(event.clientX, event.clientY, root);

    interactionState.isDragging = true;
    interactionState.mode = event.button === 2 ? 'rotate' : 'translate';
    interactionState.lastX = event.clientX;
    interactionState.lastY = event.clientY;

    if (interactionState.mode === 'translate' && hit) {
        interactionState.hasWorldGrab = true;
        interactionState.grabbedWorldPoint.copy(hit.worldPoint);
    } else {
        interactionState.hasWorldGrab = false;
    }

    event.preventDefault();
}

function onMouseMove(event) {
    // Always update debug, even if not dragging
    const root = globeRoots[activeGlobeIndex];
    if (root) {
        const hoverHit = intersectEllipsoid(event.clientX, event.clientY, root);
        updateRayDebug(hoverHit ? hoverHit.worldPoint : null);
    }

    if (!interactionState.isDragging || !root) return;

    const dx = event.clientX - interactionState.lastX;
    const dy = event.clientY - interactionState.lastY;

    // --- ROTATION ---
    if (interactionState.mode === 'rotate') {
        // Calculate dynamic sensitivity based on distance to surface
        // This ensures 1:1 "Sticky" feel.
        // If we pick the globe, use the hit distance. If sky, use center distance.
        const hit = intersectEllipsoid(event.clientX, event.clientY, root);
        const dist = hit ? hit.distance : camera.position.distanceTo(root.position);

        // Math: visible_height = 2 * dist * tan(fov/2)
        // degrees_per_pixel = (visible_height / screen_height) / circumference * 360
        const fovRad = THREE.MathUtils.degToRad(camera.fov);
        const visibleHeightAtDist = 2 * dist * Math.tan(fovRad / 2);
        const globeCircumference = 2 * Math.PI * EARTH_RADIUS;

        // Ratio of world meters per screen pixel
        const metersPerPixel = visibleHeightAtDist / viewerDiv.clientHeight;

        // Convert to degrees
        const degPerPixel = (metersPerPixel / globeCircumference) * 360;

        // Apply rotation
        // dx (Right) -> Rotates Globe West (Lon decreases)
        // dy (Down) -> Rotates Globe North (Lat increases)
        const state = globeStates[activeGlobeIndex];

        state.lon = normalizeLon(state.lon - dx * degPerPixel);
        state.lat = clampLat(state.lat + dy * degPerPixel);

        applyGlobeOrientation(activeGlobeIndex);
    }
    // --- TRANSLATION ---
    else if (interactionState.mode === 'translate') {
        const hit = intersectEllipsoid(event.clientX, event.clientY, root);
        const dist = (interactionState.hasWorldGrab && hit) ? hit.distance : getCameraDistance();

        // Simple Pan
        const fovRad = THREE.MathUtils.degToRad(camera.fov);
        const visibleHeightAtDist = 2 * dist * Math.tan(fovRad / 2);
        const factor = visibleHeightAtDist / viewerDiv.clientHeight;

        camera.getWorldDirection(scratchVecA);
        scratchVecB.crossVectors(scratchVecA, camera.up).normalize(); // Right
        scratchVecC.crossVectors(scratchVecB, scratchVecA).normalize(); // Up

        // Move Globe opposite to drag
        root.position.addScaledVector(scratchVecB, dx * factor);
        root.position.addScaledVector(scratchVecC, -dy * factor);
        root.updateMatrixWorld(true);
    }

    interactionState.lastX = event.clientX;
    interactionState.lastY = event.clientY;

    view.notifyChange(camera);
    view.notifyChange(root);
    updateDebugReadout();
}

function onMouseUp() {
    interactionState.isDragging = false;
    interactionState.hasWorldGrab = false;
}

function onMouseWheel(event) {
    event.preventDefault();
    const delta = event.deltaY !== undefined ? event.deltaY : -event.wheelDelta;
    const zoomOut = delta > 0;

    const currentDist = getCameraDistance();
    // Progressive zoom step
    const step = Math.max(currentDist * 0.1, 50.0);

    let targetDist = zoomOut ? currentDist + step : currentDist - step;
    targetDist = THREE.MathUtils.clamp(targetDist, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE);

    const center = new THREE.Vector3();
    globeRoots[activeGlobeIndex].getWorldPosition(center);

    scratchVecA.copy(camera.position).sub(center).normalize();
    camera.position.copy(center).addScaledVector(scratchVecA, targetDist);
    camera.updateMatrixWorld(true);

    view.notifyChange(camera);
    updateDebugReadout();
}

// -----------------------------------------------------------------------------
// 4. UI & Helpers
// -----------------------------------------------------------------------------

function getCameraDistance() {
    const root = globeRoots[activeGlobeIndex];
    if (!root) return MIN_CAMERA_DISTANCE;
    root.getWorldPosition(scratchCenter);
    return camera.position.distanceTo(scratchCenter);
}

function updateDebugReadout() {
    if (!debugReadout) return;

    const root = globeRoots[activeGlobeIndex];
    const state = globeStates[activeGlobeIndex];
    const camDist = getCameraDistance();

    let text = `Active Globe: ${activeGlobeIndex + 1}\n`;
    text += `Lat: ${state.lat.toFixed(2)}°, Lon: ${state.lon.toFixed(2)}°\n`;
    text += `Cam Dist: ${(camDist / 1000).toFixed(2)} km\n`;

    debugReadout.textContent = text;
}

function frameGlobes() {
    camera.position.set(0, -EARTH_RADIUS * 3, EARTH_RADIUS * 3);
    camera.lookAt(0, 0, 0);
    view.notifyChange(camera);
}

function frameGlobe(index) {
    const root = globeRoots[index];
    if (!root) return;
    root.getWorldPosition(scratchCenter);
    camera.position.copy(scratchCenter).add(new THREE.Vector3(0, -EARTH_RADIUS * 2.5, EARTH_RADIUS * 2.5));
    camera.lookAt(scratchCenter);
    view.notifyChange(camera);
}

function setActiveGlobe(index) {
    if (globeRoots[index]) {
        activeGlobeIndex = index;
        updateActiveGlobeUI();
    }
}

// -- Status Panel --
const statusPanel = document.createElement('div');
Object.assign(statusPanel.style, {
    position: 'absolute', top: '10px', right: '10px',
    padding: '10px', background: 'rgba(0,0,0,0.7)',
    color: '#fff', fontFamily: 'monospace', fontSize: '12px',
    borderRadius: '4px', pointerEvents: 'none', userSelect: 'none'
});
document.body.appendChild(statusPanel);

debugReadout = document.createElement('pre');
debugReadout.style.margin = '0';
statusPanel.appendChild(debugReadout);

const controlsInfo = document.createElement('div');
controlsInfo.innerHTML = '<br><b>Controls:</b><br>L-Click: Pan<br>R-Click: Rotate<br>Scroll: Zoom<br>Space: Switch Globe';
statusPanel.appendChild(controlsInfo);

// -- Interactive Buttons Container --
const btnContainer = document.createElement('div');
Object.assign(btnContainer.style, {
    marginTop: '10px', pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: '5px'
});
statusPanel.appendChild(btnContainer);

const debugLabel = document.createElement('label');
debugLabel.innerHTML = '<input type="checkbox" id="debugCheck"> Show Ray Debug';
debugLabel.style.cursor = 'pointer';
btnContainer.appendChild(debugLabel);
debugLabel.querySelector('input').addEventListener('change', (e) => {
    rayDebugState.enabled = e.target.checked;
    updateRayDebug(null);
    view.notifyChange(true);
});

const frameBtn = document.createElement('button');
frameBtn.textContent = 'Frame Active';
frameBtn.onclick = () => frameGlobe(activeGlobeIndex);
btnContainer.appendChild(frameBtn);

const frameBothBtn = document.createElement('button');
frameBothBtn.textContent = 'Frame Both';
frameBothBtn.onclick = frameGlobes;
btnContainer.appendChild(frameBothBtn);


// -- Event Listeners --
viewerDiv.addEventListener('contextmenu', e => e.preventDefault());
viewerDiv.addEventListener('mousedown', onMouseDown);
window.addEventListener('mouseup', onMouseUp);
window.addEventListener('mousemove', onMouseMove);
viewerDiv.addEventListener('wheel', onMouseWheel, { passive: false });
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') setActiveGlobe(activeGlobeIndex === 0 ? 1 : 0);
});

// -- Active Globe Highlighting --
const globeLabels = [];
function createLabel(idx, x) {
    const d = document.createElement('div');
    Object.assign(d.style, {
        position: 'absolute', top: '10px', left: x + 'px',
        padding: '5px 10px', background: 'rgba(0,0,0,0.5)',
        color: 'white', fontFamily: 'sans-serif', fontSize: '12px',
        border: '1px solid transparent', borderRadius: '4px'
    });
    d.textContent = `Globe ${idx + 1}`;
    document.body.appendChild(d);
    globeLabels[idx] = d;
}
createLabel(0, 10);
createLabel(1, 100);

function updateActiveGlobeUI() {
    globeLabels.forEach((l, i) => {
        l.style.borderColor = i === activeGlobeIndex ? '#00ff00' : 'transparent';
        l.style.color = i === activeGlobeIndex ? '#00ff00' : 'white';
    });
}
updateActiveGlobeUI();

window.view = view;
window.globeRoots = globeRoots;

function frameAllGlobes() {
    frameGlobes();
}