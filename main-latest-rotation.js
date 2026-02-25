import * as itowns from 'itowns';
import * as THREE from 'three';


import { VRButton } from 'three/addons/webxr/VRButton.js';

const EARTH_RADIUS = 6378137;
const GLOBE_SPACING = EARTH_RADIUS * 2.2;
const MIN_CAMERA_DISTANCE = EARTH_RADIUS * 0.99;
const MAX_CAMERA_DISTANCE = EARTH_RADIUS * 60;
const MIN_SURFACE_OFFSET = EARTH_RADIUS * 0.0001;
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
const scratchVecC = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchCenter = new THREE.Vector3();
const scratchRadii = new THREE.Vector3();
const scratchEuler = new THREE.Euler();
const quatTilt = new THREE.Quaternion();
const quatSpin = new THREE.Quaternion();
const scratchQuat = new THREE.Quaternion();
const pointerNDC = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const sphereCenterWorld = new THREE.Vector3();
const pickSurfaceCache = {
    worldPoint: new THREE.Vector3(),
    localDir: new THREE.Vector3(),
};
const storedSurfaceHit = {
    worldPoint: new THREE.Vector3(),
    localDir: new THREE.Vector3(),
};
const lonLatPrev = { lon: 0, lat: 0 };
const lonLatCurr = { lon: 0, lat: 0 };
const scratchForward = new THREE.Vector3();
const scratchRight = new THREE.Vector3();
const scratchUp = new THREE.Vector3();
const scratchVecD = new THREE.Vector3();
const scratchVecE = new THREE.Vector3();
const scratchVecF = new THREE.Vector3();

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
const globeRoots = [];
const globeStates = [];
globeRoots[0] = globe1Root;
globeStates[0] = { lon: 0, lat: 0 };
let activeGlobeIndex = 0;
const axesHelpers = [];
const wireframeHelpers = [];
let debugReadout = null;
const rayDebugState = {
    enabled: false,
    rayHelper: null,
    hitHelper: null,
    normalHelper: null,
};
const pickingSettings = {
    useSphere: false,
};

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
    zoom: { min: 0, max: 18 },
});

const orthoLayer1 = new itowns.ColorLayer('Ortho_globe1', {
    source: orthoSource,
});
view.addLayer(orthoLayer1);

// Elevation
const elevationSource = new itowns.WMTSSource({
    url: 'https://data.geopf.fr/wmts?',
    crs: 'EPSG:4326',
    name: 'ELEVATION.ELEVATIONGRIDCOVERAGE.SRTM3',
    tileMatrixSet: 'WGS84G',
    format: 'image/x-bil;bits=32',
    zoom: { min: 0, max: 18 }
});
const elevationLayer1 = new itowns.ElevationLayer('MNT_WORLD', {
    source: elevationSource,
});
view.addLayer(elevationLayer1);

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
globeStates[1] = { lon: 0, lat: 0 };
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

function ensureRayDebugHelpers() {
    if (rayDebugState.rayHelper) {
        return;
    }
    const rayHelper = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), EARTH_RADIUS, 0xff00ff);
    rayHelper.line.material.depthTest = false;
    rayHelper.cone.material.depthTest = false;
    rayHelper.line.renderOrder = 999;
    rayHelper.cone.renderOrder = 999;
    rayHelper.visible = false;
    const hitHelper = new THREE.Mesh(
        new THREE.SphereGeometry(EARTH_RADIUS * 0.01, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false })
    );
    hitHelper.visible = false;
    const normalHelper = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), EARTH_RADIUS * 0.4, 0x00ff00);
    normalHelper.line.material.depthTest = false;
    normalHelper.cone.material.depthTest = false;
    normalHelper.line.renderOrder = 999;
    normalHelper.cone.renderOrder = 999;
    normalHelper.visible = false;
    view.scene.add(rayHelper);
    view.scene.add(hitHelper);
    view.scene.add(normalHelper);
    rayDebugState.rayHelper = rayHelper;
    rayDebugState.hitHelper = hitHelper;
    rayDebugState.normalHelper = normalHelper;
}

function setRayDebugVisible(visible) {
    rayDebugState.enabled = visible;
    if (!rayDebugState.rayHelper) {
        ensureRayDebugHelpers();
    }
    const helpers = [rayDebugState.rayHelper, rayDebugState.hitHelper, rayDebugState.normalHelper];
    helpers.forEach(helper => {
        if (!helper) return;
        helper.visible = visible && !!helper.userData.active;
    });
    view.notifyChange(true);
}

function updateRayDebug(origin, direction, hitPoint, center) {
    if (!rayDebugState.enabled) {
        return;
    }
    ensureRayDebugHelpers();
    const rayHelper = rayDebugState.rayHelper;
    const hitHelper = rayDebugState.hitHelper;
    const normalHelper = rayDebugState.normalHelper;
    const length = hitPoint ? origin.distanceTo(hitPoint) : EARTH_RADIUS * 2;
    rayHelper.position.copy(origin);
    rayHelper.setDirection(direction);
    rayHelper.setLength(length, EARTH_RADIUS * 0.05, EARTH_RADIUS * 0.02);
    rayHelper.visible = true;
    rayHelper.userData.active = true;

    if (hitPoint) {
        hitHelper.position.copy(hitPoint);
        hitHelper.visible = true;
        hitHelper.userData.active = true;
        if (center) {
            scratchVecE.copy(hitPoint).sub(center).normalize();
            normalHelper.position.copy(hitPoint);
            normalHelper.setDirection(scratchVecE);
            normalHelper.setLength(EARTH_RADIUS * 0.4, EARTH_RADIUS * 0.05, EARTH_RADIUS * 0.02);
            normalHelper.visible = true;
            normalHelper.userData.active = true;
        }
    } else {
        hitHelper.visible = false;
        hitHelper.userData.active = false;
        normalHelper.visible = false;
        normalHelper.userData.active = false;
    }
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

function setSpherePickingEnabled(enabled) {
    pickingSettings.useSphere = !!enabled;
}

function computeSphereIntersection(rayOrigin, rayDir, center, radius, root, target) {
    scratchVecD.copy(rayOrigin).sub(center);
    const b = 2 * scratchVecD.dot(rayDir);
    const c = scratchVecD.lengthSq() - radius * radius;
    const discriminant = b * b - 4 * c;
    if (discriminant < 0) {
        updateRayDebug(rayOrigin, rayDir, null, center);
        return null;
    }
    const sqrtDisc = Math.sqrt(discriminant);
    const candidates = [];
    const t0 = (-b - sqrtDisc) / 2;
    const t1 = (-b + sqrtDisc) / 2;
    [t0, t1].forEach(t => {
        if (Number.isFinite(t) && Math.abs(t) > 1e-6) {
            candidates.push(t);
        }
    });
    if (!candidates.length) {
        updateRayDebug(rayOrigin, rayDir, null, center);
        return null;
    }
    let bestT = null;
    let bestDist = Infinity;
    let bestFacing = false;
    const worldPoint = scratchVecE;
    const normal = scratchVecF;
    candidates.forEach(t => {
        worldPoint.copy(rayDir).multiplyScalar(t).add(rayOrigin);
        const dist = Math.abs(t);
        normal.copy(worldPoint).sub(center);
        const facing = normal.lengthSq() > 0 && rayDir.dot(normal) < 0;
        let pick = false;
        if (!Number.isFinite(bestDist) || dist < bestDist) {
            pick = true;
        } else if (Math.abs(dist - bestDist) < 1e-6) {
            if (facing && !bestFacing) {
                pick = true;
            } else if (facing === bestFacing && t > (bestT || -Infinity)) {
                pick = true;
            }
        } else if (facing && !bestFacing) {
            pick = true;
        }
        if (pick) {
            bestDist = dist;
            bestFacing = facing;
            bestT = t;
        }
    });
    if (bestT === null) {
        updateRayDebug(rayOrigin, rayDir, null, center);
        return null;
    }
    const hitPoint = scratchVecE.copy(rayDir).multiplyScalar(bestT).add(rayOrigin);
    const hit = target || { worldPoint: new THREE.Vector3(), localDir: new THREE.Vector3() };
    hit.worldPoint.copy(hitPoint);
    root.worldToLocal(hit.localDir.copy(hit.worldPoint));
    hit.localDir.normalize();
    updateRayDebug(rayOrigin, rayDir, hit.worldPoint, center);
    return hit;
}

function computeEllipsoidIntersection(rayOrigin, rayDir, root, target) {
    if (!root) {
        return null;
    }
    root.updateMatrixWorld(true);
    const center = root.getWorldPosition(scratchVecD);
    const radii = getEllipsoidRadiiForRoot(root, scratchRadii);
    if (!radii) {
        return null;
    }

    scratchVecA.copy(rayOrigin);
    root.worldToLocal(scratchVecA);
    scratchVecB.copy(rayOrigin).add(rayDir);
    root.worldToLocal(scratchVecB);
    scratchVecB.sub(scratchVecA);
    const dirLength = scratchVecB.length();
    if (!dirLength) {
        return null;
    }
    scratchVecB.multiplyScalar(1 / dirLength);

    const localOrigin = scratchVecA;
    const localDir = scratchVecB;
    const invA2 = 1 / (radii.x * radii.x);
    const invB2 = 1 / (radii.y * radii.y);
    const invC2 = 1 / (radii.z * radii.z);
    const A =
        localDir.x * localDir.x * invA2 +
        localDir.y * localDir.y * invB2 +
        localDir.z * localDir.z * invC2;
    const B = 2 * (
        localOrigin.x * localDir.x * invA2 +
        localOrigin.y * localDir.y * invB2 +
        localOrigin.z * localDir.z * invC2
    );
    const C =
        localOrigin.x * localOrigin.x * invA2 +
        localOrigin.y * localOrigin.y * invB2 +
        localOrigin.z * localOrigin.z * invC2 - 1;
    const discriminant = B * B - 4 * A * C;
    if (discriminant < 0 || Math.abs(A) < 1e-12) {
        return null;
    }
    const sqrtDisc = Math.sqrt(discriminant);
    const inv2A = 1 / (2 * A);
    const candidates = [];
    const t0 = (-B - sqrtDisc) * inv2A;
    const t1 = (-B + sqrtDisc) * inv2A;
    [t0, t1].forEach(t => {
        if (Number.isFinite(t) && Math.abs(t) > 1e-6) {
            candidates.push(t);
        }
    });
    if (!candidates.length) {
        return null;
    }

    let bestT = null;
    let bestDist = Infinity;
    let bestFacing = false;
    candidates.forEach(t => {
        const localHit = scratchVecC.copy(localDir).multiplyScalar(t).add(localOrigin);
        const worldPoint = scratchVecE.copy(localHit);
        root.localToWorld(worldPoint);
        const dist = worldPoint.distanceTo(rayOrigin);
        scratchVecF.copy(worldPoint).sub(center);
        const facing = scratchVecF.lengthSq() > 0 && rayDir.dot(scratchVecF) < 0;
        let pick = false;
        if (!Number.isFinite(bestDist) || dist < bestDist) {
            pick = true;
        } else if (Math.abs(dist - bestDist) < 1e-6) {
            if (facing && !bestFacing) {
                pick = true;
            } else if (facing === bestFacing && t > (bestT || -Infinity)) {
                pick = true;
            }
        } else if (facing && !bestFacing) {
            pick = true;
        }
        if (pick) {
            bestDist = dist;
            bestFacing = facing;
            bestT = t;
        }
    });
    if (bestT === null) {
        return null;
    }

    const hit = target || { worldPoint: new THREE.Vector3(), localDir: new THREE.Vector3() };
    const localHit = scratchVecC.copy(localDir).multiplyScalar(bestT).add(localOrigin);
    root.localToWorld(hit.worldPoint.copy(localHit));
    root.worldToLocal(hit.localDir.copy(hit.worldPoint));
    hit.localDir.normalize();
    updateRayDebug(rayOrigin, rayDir, hit.worldPoint, center);
    return hit;
}

function computeSurfaceIntersection(event, root, target) {
    if (!root) {
        return null;
    }
    const rect = viewerDiv.getBoundingClientRect();
    pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);

    root.updateMatrixWorld(true);
    root.getWorldPosition(sphereCenterWorld);
    const sphereRadius = getGlobeRadiusForRoot(root);
    const rayOrigin = raycaster.ray.origin;
    const rayDir = raycaster.ray.direction;
    const runSphereFallback = () => computeSphereIntersection(rayOrigin, rayDir, sphereCenterWorld, sphereRadius, root, target);

    if (pickingSettings.useSphere) {
        return runSphereFallback();
    }

    const hitEllipsoid = computeEllipsoidIntersection(rayOrigin, rayDir, root, target);
    if (hitEllipsoid) {
        return hitEllipsoid;
    }
    return runSphereFallback();
}

function refreshSurfaceReference(event, root) {
    const hit = computeSurfaceIntersection(event, root, storedSurfaceHit);
    dragState.hasSurface = !!hit;
    if (hit) {
        dragState.lastSurfaceWorld.copy(hit.worldPoint);
        dragState.lastSurfaceLocalDir.copy(hit.localDir);
    }
    return hit;
}

function dirToLonLat(dir, target = { lon: 0, lat: 0 }) {
    const lon = Math.atan2(dir.y, dir.x);
    const hypot = Math.sqrt(dir.x * dir.x + dir.y * dir.y);
    const lat = Math.atan2(dir.z, hypot);
    target.lon = THREE.MathUtils.radToDeg(lon);
    target.lat = THREE.MathUtils.radToDeg(lat);
    return target;
}

function normalizeDeltaDeg(delta) {
    let d = delta % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
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

function getActiveGlobeCenter(target = scratchCenter) {
    const root = globeRoots[activeGlobeIndex];
    if (!root) {
        return null;
    }
    root.updateMatrixWorld(true);
    root.getWorldPosition(target);
    return target;
}

function getEllipsoidRadiiForRoot(root, target = scratchRadii) {
    if (!root) {
        return null;
    }
    root.updateMatrixWorld(true);
    target.set(
        itowns.ellipsoidSizes.x,
        itowns.ellipsoidSizes.y,
        itowns.ellipsoidSizes.z
    );
    root.getWorldScale(scratchScale);
    target.multiply(scratchScale);
    return target;
}

function getActiveEllipsoidRadii(target = scratchRadii) {
    return getEllipsoidRadiiForRoot(globeRoots[activeGlobeIndex], target);
}

function getEllipsoidRadiusAlong(direction, root = globeRoots[activeGlobeIndex]) {
    const radii = getEllipsoidRadiiForRoot(root, scratchRadii);
    if (!radii) {
        return EARTH_RADIUS;
    }
    scratchVecC.copy(direction);
    const lengthSq = scratchVecC.lengthSq();
    if (!lengthSq) {
        return (radii.x + radii.y + radii.z) / 3;
    }
    scratchVecC.multiplyScalar(1 / Math.sqrt(lengthSq));
    if (root) {
        root.getWorldQuaternion(scratchQuat);
        scratchQuat.invert();
        scratchVecC.applyQuaternion(scratchQuat);
    }
    const invA2 = 1 / (radii.x * radii.x);
    const invB2 = 1 / (radii.y * radii.y);
    const invC2 = 1 / (radii.z * radii.z);
    const denom = Math.sqrt(
        scratchVecC.x * scratchVecC.x * invA2 +
        scratchVecC.y * scratchVecC.y * invB2 +
        scratchVecC.z * scratchVecC.z * invC2
    );
    if (!Number.isFinite(denom) || denom <= 0) {
        return (radii.x + radii.y + radii.z) / 3;
    }
    return 1 / denom;
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

function getCameraDistance() {
    const center = getActiveGlobeCenter(scratchCenter);
    if (!center) {
        return MIN_CAMERA_DISTANCE;
    }
    const dist = camera.position.distanceTo(center);
    return Math.max(dist || 0, MIN_CAMERA_DISTANCE);
}

function getGlobeRadiusForRoot(root) {
    if (!root) {
        return EARTH_RADIUS;
    }
    root.updateMatrixWorld(true);
    root.getWorldScale(scratchScale);
    return EARTH_RADIUS * (scratchScale.x + scratchScale.y + scratchScale.z) / 3;
}

function getActiveGlobeRadius() {
    return getGlobeRadiusForRoot(globeRoots[activeGlobeIndex]);
}

function getDynamicMinDistance() {
    const center = getActiveGlobeCenter(scratchCenter);
    if (!center) {
        return MIN_CAMERA_DISTANCE;
    }
    scratchVecC.copy(camera.position).sub(center);
    const dirLen = scratchVecC.length();
    if (!dirLen) {
        return Math.max(getActiveGlobeRadius() + MIN_SURFACE_OFFSET, MIN_CAMERA_DISTANCE);
    }
    scratchVecC.multiplyScalar(1 / dirLen);
    const radius = getEllipsoidRadiusAlong(scratchVecC);
    return Math.max(radius + MIN_SURFACE_OFFSET, MIN_CAMERA_DISTANCE);
}

function getSurfaceDistanceToCamera(distanceOverride, directionVector) {
    let dirSource = directionVector ? scratchVecC.copy(directionVector) : null;
    if (!dirSource) {
        const center = getActiveGlobeCenter(scratchCenter);
        if (!center) {
            return MIN_SURFACE_OFFSET;
        }
        dirSource = scratchVecC.copy(camera.position).sub(center);
    }
    let dirLen = dirSource.length();
    if (!dirLen) {
        dirSource.set(0, 1, 0);
        dirLen = 1;
    }
    dirSource.multiplyScalar(1 / dirLen);
    const radius = getEllipsoidRadiusAlong(dirSource);
    const dist = distanceOverride !== undefined ? distanceOverride : dirLen;
    return Math.max(dist - radius, MIN_SURFACE_OFFSET);
}

function getZoomRatio() {
    const dist = getCameraDistance();
    if (MAX_CAMERA_DISTANCE === MIN_CAMERA_DISTANCE) {
        return 0;
    }
    return THREE.MathUtils.clamp(
        (dist - MIN_CAMERA_DISTANCE) / (MAX_CAMERA_DISTANCE - MIN_CAMERA_DISTANCE),
        0,
        1
    );
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

function clampRotationDelta(deltaLon, deltaLat) {
    const zoomRatio = getZoomRatio();
    const maxAngle = THREE.MathUtils.lerp(0.25, 3.0, zoomRatio);
    return {
        lon: THREE.MathUtils.clamp(deltaLon, -maxAngle, maxAngle),
        lat: THREE.MathUtils.clamp(deltaLat, -maxAngle, maxAngle),
    };
}

function smoothRotationDelta(deltaLon, deltaLat) {
    const factor = THREE.MathUtils.lerp(0.25, 0.75, getZoomRatio());
    dragState.smoothedLon = THREE.MathUtils.lerp(dragState.smoothedLon, deltaLon, factor);
    dragState.smoothedLat = THREE.MathUtils.lerp(dragState.smoothedLat, deltaLat, factor);
    return { lon: dragState.smoothedLon, lat: dragState.smoothedLat };
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

function applyGlobeOrientation(index) {
    const root = globeRoots[index];
    const state = globeStates[index];
    if (!root || !state) {
        return;
    }
    const yawRad = THREE.MathUtils.degToRad(state.lon);
    const pitchRad = THREE.MathUtils.degToRad(state.lat);
    quatTilt.setFromAxisAngle(AXIS_X, pitchRad);
    quatSpin.setFromAxisAngle(AXIS_Z, yawRad);
    root.quaternion.copy(quatTilt).multiply(quatSpin);
    root.updateMatrixWorld(true);
}

// -----------------------------------------------------------------------------
// 5. Independent rotation per globe (tile loading follows orientation)
// -----------------------------------------------------------------------------

// Rotate a globe in degrees around its local axes
function rotateGlobe(index, dLonDeg, dLatDeg) {
    const state = globeStates[index];
    if (!state) return;

    state.lon = wrapLongitude(state.lon - dLonDeg);
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
    const globeCenter = getActiveGlobeCenter(scratchCenter);
    if (!globeCenter) {
        return;
    }
    scratchVecB.copy(camera.position).sub(globeCenter);
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
    const surfaceDist = getSurfaceDistanceToCamera(length, scratchVecB);
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
    camera.position.copy(globeCenter).add(scratchVecB);
    cameraTarget.copy(globeCenter);
    camera.lookAt(globeCenter);
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

statusPanel.appendChild(createCheckboxRow('Show ray debug', checked => setRayDebugVisible(checked)));

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
statusPanel.appendChild(createCheckboxRow('Use sphere picking', checked => setSpherePickingEnabled(checked)));
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
    lastSurfaceLocalDir: new THREE.Vector3(),
    smoothedLon: 0,
    smoothedLat: 0,
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
    dragState.smoothedLon = 0;
    dragState.smoothedLat = 0;
    event.preventDefault();
}

function onMouseUp() {
    dragState.active = false;
    dragState.mode = null;
    dragState.hasSurface = false;
    dragState.smoothedLon = 0;
    dragState.smoothedLat = 0;
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
            const prevLL = dirToLonLat(dragState.lastSurfaceLocalDir, lonLatPrev);
            const currLL = dirToLonLat(surfaceHit.localDir, lonLatCurr);
            const deltaLon = normalizeDeltaDeg(prevLL.lon - currLL.lon);
            const deltaLat = prevLL.lat - currLL.lat;
            if (Math.abs(deltaLon) > 0.001 || Math.abs(deltaLat) > 0.001) {
                const clamped = clampRotationDelta(deltaLon, deltaLat);
                const smooth = smoothRotationDelta(clamped.lon, clamped.lat);
                rotateGlobe(activeGlobeIndex, smooth.lon, smooth.lat);
                refreshSurfaceReference(event, activeRoot);
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
        const fallback = clampRotationDelta(dx * degPerPixel, dy * degPerPixel);
        const smooth = smoothRotationDelta(fallback.lon, fallback.lat);
        rotateGlobe(activeGlobeIndex, smooth.lon, smooth.lat);
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