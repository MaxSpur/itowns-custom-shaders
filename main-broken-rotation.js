import * as itowns from 'itowns';
import * as THREE from 'three';


import { VRButton } from 'three/addons/webxr/VRButton.js';

const EARTH_RADIUS = 6378137;
const GLOBE_SPACING = EARTH_RADIUS * 2.2;
const MIN_CAMERA_DISTANCE = 0;
const MAX_CAMERA_DISTANCE = EARTH_RADIUS * 60;
const MIN_SURFACE_OFFSET = 2; // meters above the surface
const MIN_ZOOM_RATIO = 0.02;
const MAX_ZOOM_RATIO = 0.65;
const MAX_LATITUDE_DEG = 85;
const ROTATION_SPEED_DEG_PER_PX = 0.15;
const ROTATION_BUTTON_BASE_STEP = 5;

const AXIS_Z = new THREE.Vector3(0, 0, 1);
const AXIS_X = new THREE.Vector3(1, 0, 0);

const cameraTarget = new THREE.Vector3();
const scratchVecA = new THREE.Vector3();
const scratchVecB = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchEuler = new THREE.Euler();
const scratchCenter = new THREE.Vector3();
const pointerNDC = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const sphereCenterWorld = new THREE.Vector3();
const pickSurfaceCache = {
    worldPoint: new THREE.Vector3(),
};
const storedSurfaceHit = {
    worldPoint: new THREE.Vector3(),
};
const lonLatPrev = { lon: 0, lat: 0 };
const lonLatCurr = { lon: 0, lat: 0 };
const scratchForward = new THREE.Vector3();
const scratchRight = new THREE.Vector3();
const scratchUp = new THREE.Vector3();

// -----------------------------------------------------------------------------
// 1. Base GlobeView with one globe layer
// -----------------------------------------------------------------------------

const viewerDiv = document.getElementById('viewerDiv');

// Initial placement: near Paris
const placement = {
    coord: new itowns.Coordinates('EPSG:4326', 2.351323, 48.856712, 0),
    range: 3.5e7,
};

const globe1Root = new THREE.Object3D();
const view = new itowns.GlobeView(viewerDiv, placement, {
    noControls: true, // we will not use built-in controls
    object3d: globe1Root,
});

// camera reference
const camera = view.camera3D || view.camera.camera3D;
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);

// First globe: the default one created by GlobeView
const globe1Layer = view.tileLayer;
disableHorizonCulling(globe1Layer);
const atmosphereLayer = view.getLayerById('atmosphere');
if (atmosphereLayer && atmosphereLayer.object3d) {
    atmosphereLayer.visible = false;
    atmosphereLayer.object3d.visible = false;
}

globe1Root.position.set(-GLOBE_SPACING * 0.5, 0, 0);
globe1Root.updateMatrixWorld(true);

// Collect roots and their orientation state (index 0: main globe, index 1: second globe)
function createGlobeState() {
    return {
        lon: 0,
        lat: 0,
    };
}

const globeRoots = [];
const globeStates = [];
globeRoots[0] = globe1Root;
globeStates[0] = createGlobeState();
let activeGlobeIndex = 0;
const axesHelpers = [];
const wireframeHelpers = [];
let debugReadout = null;

function disableHorizonCulling(layer) {
    const baseCulling = itowns.TiledGeometryLayer.prototype.culling;
    layer.culling = function cullingWithoutHorizon(node, camera) {
        if (baseCulling.call(this, node, camera)) {
            return true;
        }
        if (node.level < this.minSubdivisionLevel) {
            return false;
        }
        return false;
    };
}

// -----------------------------------------------------------------------------
// 2. Imagery source (IGN orthophotos) and layer for globe 1
// -----------------------------------------------------------------------------

const orthoSource = new itowns.WMTSSource({
    url: 'https://data.geopf.fr/wmts?',
    crs: 'EPSG:3857',
    name: 'ORTHOIMAGERY.ORTHOPHOTOS',
    tileMatrixSet: 'PM',
    format: 'image/jpeg',
    zoom: { min: 0, max: 13 },
});

const orthoLayer1 = new itowns.ColorLayer('Ortho_globe1', {
    source: orthoSource,
});
view.addLayer(orthoLayer1);

// -----------------------------------------------------------------------------
// 3. Second globe: same placement as in view_multiglobe
// -----------------------------------------------------------------------------

// Root for the second globe
const globe2Root = new THREE.Object3D();
globe2Root.position.set(GLOBE_SPACING * 0.5, 0, 0);
globe2Root.updateMatrixWorld(true);

// Add it to the scene
view.scene.add(globe2Root);

// Second globe layer
const globe2Layer = new itowns.GlobeLayer('globe2', globe2Root);
itowns.View.prototype.addLayer.call(view, globe2Layer);
disableHorizonCulling(globe2Layer);

// Slightly different base color
// globe2Layer.diffuse = new THREE.Color(0xd0d5d8);

// Imagery for globe 2 (reuse same source)
const orthoLayer2 = new itowns.ColorLayer('Ortho_globe2', {
    source: orthoSource,
});
itowns.View.prototype.addLayer.call(view, orthoLayer2, globe2Layer);

// Register its root for independent rotation
globeRoots[1] = globe2Root;
globeStates[1] = createGlobeState();
applyGlobeOrientation(0);
applyGlobeOrientation(1);
frameAllGlobes();

// -----------------------------------------------------------------------------
// 4. Camera helpers + debugging utilities
// -----------------------------------------------------------------------------

function frameGlobes(indexList = []) {
    const indices = (indexList.length ? indexList : globeRoots.map((root, idx) => (root ? idx : null)))
        .filter(index => index !== null && globeRoots[index]);
    if (!indices.length) {
        return;
    }

    const center = new THREE.Vector3();
    const radii = [];
    indices.forEach(index => {
        const root = globeRoots[index];
        root.updateMatrixWorld(true);
        root.getWorldPosition(scratchVecA);
        center.add(scratchVecA);
        root.getWorldScale(scratchScale);
        radii.push(EARTH_RADIUS * Math.max(scratchScale.x, scratchScale.y, scratchScale.z));
    });
    center.multiplyScalar(1 / indices.length);

    let maxExtent = 0;
    indices.forEach((index, idx) => {
        const root = globeRoots[index];
        root.getWorldPosition(scratchVecA);
        const extent = scratchVecA.distanceTo(center) + (radii[idx] || 0);
        if (extent > maxExtent) {
            maxExtent = extent;
        }
    });

    const distance = Math.max(maxExtent * 2.2, EARTH_RADIUS * 5);
    cameraTarget.copy(center);
    camera.position.set(center.x, center.y - distance, center.z + distance * 0.45);
    camera.lookAt(cameraTarget);
    camera.updateMatrixWorld(true);
    view.notifyChange(camera);
    updateDebugReadout();
}

function frameGlobe(index) {
    if (!globeRoots[index]) {
        return;
    }
    frameGlobes([index]);
}

function frameAllGlobes() {
    frameGlobes();
}

function ensureAxesHelper(index) {
    if (axesHelpers[index]) {
        return axesHelpers[index];
    }
    const helper = new THREE.AxesHelper(EARTH_RADIUS * 0.5);
    helper.visible = false;
    globeRoots[index].add(helper);
    axesHelpers[index] = helper;
    return helper;
}

function ensureWireframeHelper(index) {
    if (wireframeHelpers[index]) {
        return wireframeHelpers[index];
    }
    const geometry = new THREE.SphereGeometry(EARTH_RADIUS, 16, 12);
    const helper = new THREE.LineSegments(
        new THREE.WireframeGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0xffff00 })
    );
    helper.visible = false;
    globeRoots[index].add(helper);
    wireframeHelpers[index] = helper;
    return helper;
}

function setAxesVisible(visible) {
    globeRoots.forEach((root, idx) => {
        if (!root) return;
        const helper = ensureAxesHelper(idx);
        helper.visible = visible;
    });
    view.notifyChange(camera);
}

function setWireframeVisible(visible) {
    globeRoots.forEach((root, idx) => {
        if (!root) return;
        const helper = ensureWireframeHelper(idx);
        helper.visible = visible;
    });
    view.notifyChange(camera);
}

function toFixed(value, digits = 2) {
    return Number(value.toFixed(digits));
}

function computeSurfaceIntersection(event, root, target) {
    if (!root) {
        return null;
    }
    const rect = viewerDiv.getBoundingClientRect();
    pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);

    root.getWorldPosition(sphereCenterWorld);
    root.getWorldScale(scratchScale);
    const radius = EARTH_RADIUS * (scratchScale.x + scratchScale.y + scratchScale.z) / 3;
    const rayOrigin = raycaster.ray.origin;
    const rayDir = raycaster.ray.direction;

    scratchVecA.copy(rayOrigin).sub(sphereCenterWorld);
    const b = 2 * scratchVecA.dot(rayDir);
    const c = scratchVecA.lengthSq() - radius * radius;
    const discriminant = b * b - 4 * c;
    if (discriminant < 0) {
        return null;
    }
    const sqrtDisc = Math.sqrt(discriminant);
    let t = (-b - sqrtDisc) / 2;
    if (t < 0) {
        t = (-b + sqrtDisc) / 2;
    }
    if (t < 0) {
        return null;
    }

    const hit = target || { worldPoint: new THREE.Vector3() };
    hit.worldPoint.copy(rayDir).multiplyScalar(t).add(rayOrigin);
    return hit;
}

function refreshSurfaceReference(event, root) {
    const hit = computeSurfaceIntersection(event, root, storedSurfaceHit);
    dragState.hasSurface = !!hit;
    if (hit) {
        dragState.lastSurfaceWorld.copy(hit.worldPoint);
        const rootCenter = root.getWorldPosition(scratchCenter);
        scratchVecA.copy(hit.worldPoint).sub(rootCenter);
        worldToLonLat(rootCenter.clone().add(scratchVecA), dragState.lastSurfaceLonLat);
    }
    return hit;
}

function logGlobeTransforms() {
    const rows = [];
    globeRoots.forEach((root, idx) => {
        if (!root) return;
        root.updateMatrixWorld(true);
        root.getWorldPosition(scratchVecA);
        root.getWorldScale(scratchScale);
        scratchEuler.setFromQuaternion(root.quaternion, 'XYZ');
        rows.push({
            Globe: idx + 1,
            PosX_m: toFixed(scratchVecA.x, 0),
            PosY_m: toFixed(scratchVecA.y, 0),
            PosZ_m: toFixed(scratchVecA.z, 0),
            RotX_deg: toFixed(THREE.MathUtils.radToDeg(scratchEuler.x), 2),
            RotY_deg: toFixed(THREE.MathUtils.radToDeg(scratchEuler.y), 2),
            RotZ_deg: toFixed(THREE.MathUtils.radToDeg(scratchEuler.z), 2),
            Scale: toFixed((scratchScale.x + scratchScale.y + scratchScale.z) / 3, 2),
        });
    });

    if (rows.length) {
        console.table(rows);
    } else {
        console.warn('No globes registered in globeRoots.');
    }
}

function updateDebugReadout() {
    if (!debugReadout) {
        return;
    }
    const lines = [];
    globeRoots.forEach((root, idx) => {
        if (!root) return;
        root.updateMatrixWorld(true);
        root.getWorldPosition(scratchVecA);
        scratchEuler.setFromQuaternion(root.quaternion, 'XYZ');
        lines.push(
            `Globe ${idx + 1} | pos (${scratchVecA.x.toFixed(0)}, ${scratchVecA.y.toFixed(0)}, ${scratchVecA.z.toFixed(0)}) | rot (${THREE.MathUtils.radToDeg(scratchEuler.x).toFixed(1)}, ${THREE.MathUtils.radToDeg(scratchEuler.y).toFixed(1)}, ${THREE.MathUtils.radToDeg(scratchEuler.z).toFixed(1)}) | scale ${root.scale.x.toFixed(2)}`
        );
    });
    debugReadout.textContent = lines.length ? lines.join('\n') : 'No globes registered';
}

function getActiveGlobeCenter(target = scratchCenter) {
    const root = globeRoots[activeGlobeIndex];
    if (!root) {
        return target.set(0, 0, 0);
    }
    return root.getWorldPosition(target);
}

function getCameraDistance() {
    const center = getActiveGlobeCenter(scratchCenter);
    const dist = camera.position.distanceTo(center);
    return Math.max(dist || 0, MIN_CAMERA_DISTANCE);
}

function getActiveGlobeRadius() {
    const root = globeRoots[activeGlobeIndex];
    if (!root) {
        return EARTH_RADIUS;
    }
    root.getWorldScale(scratchScale);
    return EARTH_RADIUS * (scratchScale.x + scratchScale.y + scratchScale.z) / 3;
}

function getDynamicMinDistance() {
    const radius = getActiveGlobeRadius();
    return Math.max(radius + MIN_SURFACE_OFFSET, MIN_CAMERA_DISTANCE);
}

function getSurfaceDistanceToCamera(distanceOverride) {
    const radius = getActiveGlobeRadius();
    const dist = distanceOverride !== undefined ? distanceOverride : getCameraDistance();
    return Math.max(dist - radius, MIN_SURFACE_OFFSET);
}

function getZoomRatio() {
    const minDistance = getDynamicMinDistance();
    const dist = Math.max(getCameraDistance(), minDistance);
    const range = Math.max(MAX_CAMERA_DISTANCE - minDistance, 1);
    return THREE.MathUtils.clamp((dist - minDistance) / range, 0, 1);
}

function getRotationScale() {
    const ratio = getZoomRatio();
    return THREE.MathUtils.lerp(0.35, 1, Math.pow(ratio, 0.6));
}

function getRotationDegreesPerPixel() {
    return ROTATION_SPEED_DEG_PER_PX * getRotationScale();
}

function getRotationButtonStep() {
    return ROTATION_BUTTON_BASE_STEP * getRotationScale();
}

function getMoveFactor() {
    const ratio = getZoomRatio();
    const adaptiveScale = 0.15 + 0.85 * Math.pow(ratio, 0.7);
    const dist = getCameraDistance();
    return (dist / 4000) * adaptiveScale;
}

function wrapLongitude(deg) {
    let value = deg % 360;
    if (value < 0) {
        value += 360;
    }
    return value;
}

function worldToLonLat(worldPoint, target = { lon: 0, lat: 0 }) {
    const coords = new itowns.Coordinates('EPSG:4978', worldPoint.x, worldPoint.y, worldPoint.z).as('EPSG:4326');
    target.lon = coords.longitude;
    target.lat = coords.latitude;
    return target;
}

function normalizeDeltaDeg(delta) {
    let d = delta % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
}

function applyGlobeOrientation(index) {
    const root = globeRoots[index];
    const state = globeStates[index];
    if (!root || !state) {
        return;
    }
    root.quaternion.identity();
    root.rotateOnAxis(AXIS_Z, THREE.MathUtils.degToRad(state.lon));
    root.rotateOnAxis(AXIS_X, THREE.MathUtils.degToRad(state.lat));
    root.updateMatrixWorld(true);
}

// -----------------------------------------------------------------------------
// 5. Independent rotation per globe (tile loading follows orientation)
// -----------------------------------------------------------------------------

// Rotate a globe in degrees around its local axes
function rotateGlobe(index, dLonDeg, dLatDeg) {
    const state = globeStates[index];
    if (!state) return;

    state.lon = wrapLongitude(state.lon + dLonDeg);
    state.lat = THREE.MathUtils.clamp(state.lat + dLatDeg, -MAX_LATITUDE_DEG, MAX_LATITUDE_DEG);
    applyGlobeOrientation(index);
    view.notifyChange(camera);
    view.notifyChange(globeRoots[index]);
    updateDebugReadout();
}

function moveGlobe(index, deltaX, deltaY) {
    const root = globeRoots[index];
    if (!root) return;

    const moveFactor = getMoveFactor();
    camera.getWorldDirection(scratchForward);
    scratchRight.crossVectors(scratchForward, camera.up).normalize();
    scratchUp.copy(camera.up).normalize();

    root.position.addScaledVector(scratchRight, -deltaX * moveFactor);
    root.position.addScaledVector(scratchUp, deltaY * moveFactor);
    root.updateMatrixWorld(true);
    view.notifyChange(camera);
    view.notifyChange(root);
    updateDebugReadout();
}

function zoomCamera(multiplier) {
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
        return;
    }
    const center = getActiveGlobeCenter(scratchCenter);
    scratchVecB.copy(camera.position).sub(center);
    let length = scratchVecB.length();
    if (!length) {
        length = getDynamicMinDistance();
        scratchVecB.set(0, -1, 0);
    }
    const minDistance = getDynamicMinDistance();
    if (length < minDistance) {
        length = minDistance;
        scratchVecB.setLength(length);
    }
    const zoomDir = multiplier > 1 ? 1 : -1;
    const zoomAmount = Math.abs(multiplier - 1);
    const surfaceDist = getSurfaceDistanceToCamera(length);
    const normalizedSurfaceRatio = THREE.MathUtils.clamp(surfaceDist / length, 0, 1);
    const zoomRatio = MIN_ZOOM_RATIO + (MAX_ZOOM_RATIO - MIN_ZOOM_RATIO) * Math.pow(zoomAmount, 0.85);
    let step = surfaceDist * zoomRatio * (0.4 + 0.6 * normalizedSurfaceRatio);
    step = Math.max(step, surfaceDist * 0.01);
    const remaining = zoomDir < 0 ? Math.max(length - minDistance, 0) : MAX_CAMERA_DISTANCE - length;
    if (remaining <= 0) {
        return;
    }
    step = Math.min(step, Math.max(remaining * 0.8, MIN_SURFACE_OFFSET * 0.25));
    if (step <= 0) {
        return;
    }
    length = THREE.MathUtils.clamp(length + zoomDir * step, minDistance, MAX_CAMERA_DISTANCE);
    scratchVecB.setLength(length);
    camera.position.copy(center).add(scratchVecB);
    cameraTarget.copy(center);
    camera.lookAt(center);
    camera.updateMatrixWorld(true);
    view.notifyChange(camera);
}
// -----------------------------------------------------------------------------
// 6. Minimal UI + active state indicator
// -----------------------------------------------------------------------------

const controlPanels = [];
const statusPanel = document.createElement('div');
statusPanel.style.position = 'absolute';
statusPanel.style.top = '10px';
statusPanel.style.right = '10px';
statusPanel.style.padding = '8px 12px';
statusPanel.style.background = 'rgba(0,0,0,0.55)';
statusPanel.style.color = 'white';
statusPanel.style.fontFamily = 'sans-serif';
statusPanel.style.fontSize = '11px';
statusPanel.style.borderRadius = '4px';
statusPanel.style.zIndex = '1000';

const statusTitle = document.createElement('div');
statusTitle.textContent = 'Interaction';
statusTitle.style.fontWeight = 'bold';
statusTitle.style.marginBottom = '4px';
statusPanel.appendChild(statusTitle);

const activeRow = document.createElement('div');
activeRow.style.marginBottom = '4px';
activeRow.append('Active globe: ');
const activeGlobeLabel = document.createElement('strong');
activeGlobeLabel.textContent = '1';
activeRow.appendChild(activeGlobeLabel);
statusPanel.appendChild(activeRow);

['Left drag: move globe', 'Right drag: rotate globe', 'Press Space to switch'].forEach(text => {
    const tip = document.createElement('div');
    tip.textContent = text;
    tip.style.fontSize = '10px';
    statusPanel.appendChild(tip);
});

const statusButtons = document.createElement('div');
statusButtons.style.marginTop = '6px';

const frameActiveBtn = document.createElement('button');
frameActiveBtn.textContent = 'Frame active';
frameActiveBtn.style.marginRight = '4px';
frameActiveBtn.onclick = () => frameGlobe(activeGlobeIndex);
statusButtons.appendChild(frameActiveBtn);

const frameBothBtn = document.createElement('button');
frameBothBtn.textContent = 'Frame both';
frameBothBtn.onclick = frameAllGlobes;
statusButtons.appendChild(frameBothBtn);

statusPanel.appendChild(statusButtons);
document.body.appendChild(statusPanel);

function createCheckboxRow(label, onToggle) {
    const wrapper = document.createElement('label');
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '4px';
    wrapper.style.fontSize = '10px';
    wrapper.style.marginTop = '4px';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.style.margin = '0';
    input.onchange = () => onToggle(input.checked);
    const span = document.createElement('span');
    span.textContent = label;
    wrapper.appendChild(input);
    wrapper.appendChild(span);
    return wrapper;
}

// const debugPanel = document.createElement('div');
// debugPanel.style.position = 'absolute';
// debugPanel.style.top = '150px';
// debugPanel.style.right = '10px';
// debugPanel.style.padding = '8px 12px';
// debugPanel.style.background = 'rgba(0,0,0,0.55)';
// debugPanel.style.color = 'white';
// debugPanel.style.fontFamily = 'sans-serif';
// debugPanel.style.fontSize = '11px';
// debugPanel.style.borderRadius = '4px';
// debugPanel.style.zIndex = '1000';

// const debugTitle = document.createElement('div');
// debugTitle.textContent = 'Debug helpers';
// debugTitle.style.fontWeight = 'bold';
// debugTitle.style.marginBottom = '4px';
// debugPanel.appendChild(debugTitle);

// debugPanel.appendChild(createCheckboxRow('Show axes helpers', checked => setAxesVisible(checked)));
// debugPanel.appendChild(createCheckboxRow('Show wire spheres', checked => setWireframeVisible(checked)));

// const debugButtons = document.createElement('div');
// debugButtons.style.marginTop = '6px';

// const logButton = document.createElement('button');
// logButton.textContent = 'Log transforms';
// logButton.style.marginRight = '4px';
// logButton.onclick = logGlobeTransforms;
// debugButtons.appendChild(logButton);

// const refreshButton = document.createElement('button');
// refreshButton.textContent = 'Refresh readout';
// refreshButton.onclick = updateDebugReadout;
// debugButtons.appendChild(refreshButton);

// debugPanel.appendChild(debugButtons);

// debugReadout = document.createElement('pre');
// debugReadout.style.marginTop = '6px';
// debugReadout.style.fontSize = '10px';
// debugReadout.style.whiteSpace = 'pre-wrap';
// debugReadout.style.userSelect = 'text';
// debugReadout.textContent = 'Waiting for globe data...';
// debugPanel.appendChild(debugReadout);

// document.body.appendChild(debugPanel);
// updateDebugReadout();

function updateActiveGlobeUI() {
    controlPanels.forEach((panel, idx) => {
        if (!panel) return;
        panel.style.outline = idx === activeGlobeIndex ? '2px solid #00ffd1' : '1px solid rgba(255,255,255,0.2)';
    });
    if (activeGlobeLabel) {
        activeGlobeLabel.textContent = `${activeGlobeIndex + 1}`;
    }
}

function setActiveGlobe(index) {
    if (globeRoots[index]) {
        activeGlobeIndex = index;
        updateActiveGlobeUI();
        getActiveGlobeCenter(cameraTarget);
        camera.lookAt(cameraTarget);
    }
}

function createControlsForGlobe(index, label, xPx) {
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.top = '10px';
    container.style.left = `${xPx}px`;
    container.style.padding = '6px';
    container.style.background = 'rgba(0,0,0,0.55)';
    container.style.color = 'white';
    container.style.fontFamily = 'sans-serif';
    container.style.fontSize = '11px';
    container.style.borderRadius = '4px';
    container.style.zIndex = '1000';
    container.style.outline = '1px solid rgba(255,255,255,0.2)';

    const title = document.createElement('div');
    title.textContent = label;
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '4px';
    container.appendChild(title);

    function makeButton(text, onClick) {
        const b = document.createElement('button');
        b.textContent = text;
        b.style.margin = '2px';
        b.style.fontSize = '10px';
        b.onclick = onClick;
        return b;
    }

    // N
    const rowN = document.createElement('div');
    rowN.appendChild(makeButton('N', () => rotateGlobe(index, 0, +getRotationButtonStep())));
    container.appendChild(rowN);

    // W / E
    const rowWE = document.createElement('div');
    rowWE.appendChild(makeButton('W', () => rotateGlobe(index, -getRotationButtonStep(), 0)));
    rowWE.appendChild(makeButton('E', () => rotateGlobe(index, +getRotationButtonStep(), 0)));
    container.appendChild(rowWE);

    // S
    const rowS = document.createElement('div');
    rowS.appendChild(makeButton('S', () => rotateGlobe(index, 0, -getRotationButtonStep())));
    container.appendChild(rowS);

    document.body.appendChild(container);
    controlPanels[index] = container;
    updateActiveGlobeUI();
}

// Controls for each globe
createControlsForGlobe(0, 'Globe 1', 10);
createControlsForGlobe(1, 'Globe 2', 140);

// -----------------------------------------------------------------------------
// 7. Keyboard toggle between active globes
// -----------------------------------------------------------------------------

function handleKeyDown(event) {
    if (event.code === 'Space') {
        event.preventDefault();
        setActiveGlobe(activeGlobeIndex === 0 ? 1 : 0);
    }
}
window.addEventListener('keydown', handleKeyDown);

viewerDiv.tabIndex = 0;
viewerDiv.style.outline = 'none';
viewerDiv.focus({ preventScroll: true });

// -----------------------------------------------------------------------------
// 8. Mouse interactions for move (left drag) and rotate (right drag)
// -----------------------------------------------------------------------------

const dragState = {
    active: false,
    mode: null,
    lastX: 0,
    lastY: 0,
    hasSurface: false,
    lastSurfaceWorld: new THREE.Vector3(),
    lastSurfaceLonLat: { lon: 0, lat: 0 },
};

function onMouseDown(event) {
    if (event.button !== 0 && event.button !== 2) {
        return;
    }

    dragState.active = true;
    dragState.mode = event.button === 2 ? 'rotate' : 'translate';
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    refreshSurfaceReference(event, globeRoots[activeGlobeIndex]);
    event.preventDefault();
}

function onMouseUp() {
    dragState.active = false;
    dragState.mode = null;
    dragState.hasSurface = false;
}

function onMouseMove(event) {
    if (!dragState.active) return;
    const dx = event.clientX - dragState.lastX;
    const dy = event.clientY - dragState.lastY;
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;

    const activeRoot = globeRoots[activeGlobeIndex];
    if (activeRoot) {
        const surfaceHit = computeSurfaceIntersection(event, activeRoot, pickSurfaceCache);
        if (!surfaceHit) {
            dragState.hasSurface = false;
        }
        if (dragState.mode === 'rotate' && dragState.hasSurface && surfaceHit) {
            const prevLL = dragState.lastSurfaceLonLat;
            const currLL = worldToLonLat(surfaceHit.worldPoint, lonLatCurr);
            const deltaLon = normalizeDeltaDeg(currLL.lon - prevLL.lon);
            const deltaLat = currLL.lat - prevLL.lat;
            if (Math.abs(deltaLon) > 0.0005 || Math.abs(deltaLat) > 0.0005) {
                rotateGlobe(activeGlobeIndex, deltaLon, deltaLat);
                dragState.lastSurfaceLonLat.lon = currLL.lon;
                dragState.lastSurfaceLonLat.lat = currLL.lat;
                dragState.lastSurfaceWorld.copy(surfaceHit.worldPoint);
                return;
            }
        } else if (dragState.mode === 'translate' && dragState.hasSurface && surfaceHit) {
            scratchVecA.copy(surfaceHit.worldPoint).sub(dragState.lastSurfaceWorld);
            activeRoot.position.add(scratchVecA);
            activeRoot.updateMatrixWorld(true);
            view.notifyChange(camera);
            view.notifyChange(activeRoot);
            updateDebugReadout();
            refreshSurfaceReference(event, activeRoot);
            return;
        }
    }

    if (dragState.mode === 'rotate') {
        const degPerPixel = getRotationDegreesPerPixel();
        rotateGlobe(activeGlobeIndex, dx * degPerPixel, dy * degPerPixel);
    } else if (dragState.mode === 'translate') {
        moveGlobe(activeGlobeIndex, dx, dy);
    }
}

viewerDiv.addEventListener('contextmenu', event => event.preventDefault());
viewerDiv.addEventListener('mousedown', onMouseDown);
window.addEventListener('mouseup', onMouseUp);
window.addEventListener('mousemove', onMouseMove);

function onMouseWheel(event) {
    event.preventDefault();
    const delta = event.deltaY !== undefined ? event.deltaY : -event.wheelDelta;
    const multiplier = delta > 0 ? 1.12 : 0.88;
    zoomCamera(multiplier);
}

viewerDiv.addEventListener('wheel', onMouseWheel, { passive: false });
viewerDiv.addEventListener('DOMMouseScroll', onMouseWheel, { passive: false });

// -----------------------------------------------------------------------------
// 9. Initial render + debug hooks
// -----------------------------------------------------------------------------

view.notifyChange(camera);


// Instantiate three's VR Button
const vrButton = VRButton.createButton(view.renderer);
viewerDiv.appendChild(vrButton);

window.view = view;
window.itowns = itowns;
window.THREE = THREE;
window.globeRoots = globeRoots;
window.setActiveGlobe = setActiveGlobe;
window.frameGlobe = frameGlobe;
window.frameAllGlobes = frameAllGlobes;
window.logGlobeTransforms = logGlobeTransforms;
window.setAxesVisible = setAxesVisible;
window.setWireframeVisible = setWireframeVisible;
