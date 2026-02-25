import * as itowns from 'itowns';
import * as THREE from 'three';


import { VRButton } from 'three/addons/webxr/VRButton.js';

const EARTH_RADIUS = 6378137;
const GLOBE_SPACING = EARTH_RADIUS * 2.2;
const MIN_SURFACE_OFFSET = 5; // Minimum 5m above surface
const MAX_CAMERA_DISTANCE = EARTH_RADIUS * 100;
const MIN_ZOOM_RATIO = 0.02;
const MAX_ZOOM_RATIO = 0.65;
const MAX_LATITUDE_DEG = 89;
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
const scratchForward = new THREE.Vector3();
const scratchRight = new THREE.Vector3();
const scratchUp = new THREE.Vector3();
const scratchVecD = new THREE.Vector3();
const scratchVecE = new THREE.Vector3();
const scratchVecF = new THREE.Vector3();
const scratchMatrixInv = new THREE.Matrix4();
const scratchRayOrigin = new THREE.Vector3();
const scratchRayDir = new THREE.Vector3();

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
camera.near = 100;
camera.far = EARTH_RADIUS * 1000;
camera.updateProjectionMatrix();
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
const interactionState = {
    isDragging: false,
    mode: null,
    lastX: 0,
    lastY: 0,
    hasWorldGrab: false,
    grabbedWorldPoint: new THREE.Vector3(),
    // For rotation: store initial grabbed local direction (unit vector on ellipsoid surface)
    grabbedLocalDir: new THREE.Vector3(),
    // Store initial globe quaternion at drag start for rotation
    initialQuaternion: new THREE.Quaternion(),
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

    // Notify view to re-render
    view.notifyChange(true);
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

/**
 * Raycast to an ellipsoid and return the closest hit point.
 * Handles cases where camera may be very close or even "behind" terrain.
 * Returns null if no intersection.
 */
function intersectEllipsoid(mouseX, mouseY, root) {
    if (!root) {
        return null;
    }

    const rect = viewerDiv.getBoundingClientRect();
    pointerNDC.x = ((mouseX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((mouseY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);

    root.updateMatrixWorld(true);
    root.getWorldPosition(sphereCenterWorld);

    if (pickingSettings.useSphere) {
        const radius = getGlobeRadiusForRoot(root);
        const sphereHit = computeSphereIntersectionBidirectional(
            raycaster.ray.origin,
            raycaster.ray.direction,
            sphereCenterWorld,
            radius,
            root,
        );
        return sphereHit;
    }

    // Ellipsoid intersection: work in world space relative to globe center
    // This avoids issues with matrix transformations
    const rayOriginRelative = scratchRayOrigin.copy(raycaster.ray.origin).sub(sphereCenterWorld);
    const rayDir = scratchRayDir.copy(raycaster.ray.direction);

    // Apply inverse rotation to work in globe's local orientation
    const invQuat = scratchQuat.copy(root.quaternion).invert();
    rayOriginRelative.applyQuaternion(invQuat);
    rayDir.applyQuaternion(invQuat);

    // Get ellipsoid radii
    const radii = scratchRadii.set(
        itowns.ellipsoidSizes.x,
        itowns.ellipsoidSizes.y,
        itowns.ellipsoidSizes.z
    );

    // Apply globe scale
    root.getWorldScale(scratchScale);
    radii.multiply(scratchScale);

    const invRx2 = 1 / (radii.x * radii.x);
    const invRy2 = 1 / (radii.y * radii.y);
    const invRz2 = 1 / (radii.z * radii.z);

    const ox = rayOriginRelative.x;
    const oy = rayOriginRelative.y;
    const oz = rayOriginRelative.z;
    const dx = rayDir.x;
    const dy = rayDir.y;
    const dz = rayDir.z;

    const A = dx * dx * invRx2 + dy * dy * invRy2 + dz * dz * invRz2;
    const B = 2 * (ox * dx * invRx2 + oy * dy * invRy2 + oz * dz * invRz2);
    const C = ox * ox * invRx2 + oy * oy * invRy2 + oz * oz * invRz2 - 1;
    const discriminant = B * B - 4 * A * C;

    if (discriminant < 0 || Math.abs(A) < 1e-12) {
        updateRayDebug(raycaster.ray.origin, raycaster.ray.direction, null, sphereCenterWorld);
        return null;
    }

    const sqrtDisc = Math.sqrt(discriminant);
    const t0 = (-B - sqrtDisc) / (2 * A);
    const t1 = (-B + sqrtDisc) / (2 * A);

    // Collect valid intersections (both directions for close-up camera)
    const candidates = [];
    [t0, t1].forEach(t => {
        if (Number.isFinite(t)) {
            // Compute local hit point (in rotated local space)
            const localHit = scratchVecC.copy(rayDir).multiplyScalar(t).add(rayOriginRelative);

            // Transform back to world space
            const worldHit = scratchVecD.copy(localHit).applyQuaternion(root.quaternion).add(sphereCenterWorld);
            const distToCamera = camera.position.distanceTo(worldHit);

            // Compute surface normal in world space for facing check
            scratchVecE.copy(worldHit).sub(sphereCenterWorld);
            const isFrontFacing = raycaster.ray.direction.dot(scratchVecE) < 0;

            candidates.push({
                t,
                localHit: localHit.clone(),
                worldHit: worldHit.clone(),
                distToCamera,
                isFrontFacing,
            });
        }
    });

    if (!candidates.length) {
        updateRayDebug(raycaster.ray.origin, raycaster.ray.direction, null, sphereCenterWorld);
        return null;
    }

    // Sort by distance to camera
    candidates.sort((a, b) => a.distToCamera - b.distToCamera);

    // Prefer front-facing hit if available
    let best = candidates[0];
    for (const c of candidates) {
        if (c.isFrontFacing) {
            best = c;
            break;
        }
    }

    // Compute local direction (normalized position on unit ellipsoid)
    const localDir = scratchVecF.copy(best.localHit);
    localDir.x /= radii.x;
    localDir.y /= radii.y;
    localDir.z /= radii.z;
    localDir.normalize();

    updateRayDebug(raycaster.ray.origin, raycaster.ray.direction, best.worldHit, sphereCenterWorld);

    return {
        worldPoint: best.worldHit.clone(),
        localPoint: best.localHit.clone(),
        localDir: localDir.clone(),
        distance: best.distToCamera,
    };
}

/**
 * Sphere intersection with bidirectional ray support for close-up camera.
 */
function computeSphereIntersectionBidirectional(rayOrigin, rayDir, center, radius, root) {
    scratchVecD.copy(rayOrigin).sub(center);
    const a = 1; // rayDir is normalized
    const b = 2 * scratchVecD.dot(rayDir);
    const c = scratchVecD.lengthSq() - radius * radius;
    const discriminant = b * b - 4 * a * c;

    if (discriminant < 0) {
        updateRayDebug(rayOrigin, rayDir, null, center);
        return null;
    }

    const sqrtDisc = Math.sqrt(discriminant);
    const t0 = (-b - sqrtDisc) / 2;
    const t1 = (-b + sqrtDisc) / 2;

    const candidates = [];
    [t0, t1].forEach(t => {
        if (Number.isFinite(t)) {
            const worldHit = scratchVecE.copy(rayDir).multiplyScalar(t).add(rayOrigin);
            const distToCamera = Math.abs(t);

            // Check if front-facing
            scratchVecF.copy(worldHit).sub(center);
            const isFrontFacing = rayDir.dot(scratchVecF) < 0;

            candidates.push({
                t,
                worldHit: worldHit.clone(),
                distToCamera,
                isFrontFacing,
            });
        }
    });

    if (!candidates.length) {
        updateRayDebug(rayOrigin, rayDir, null, center);
        return null;
    }

    // Sort by distance
    candidates.sort((a, b) => a.distToCamera - b.distToCamera);

    // Prefer front-facing
    let best = candidates[0];
    for (const c of candidates) {
        if (c.isFrontFacing) {
            best = c;
            break;
        }
    }

    // Compute local position (relative to globe center, in local space)
    // This is needed for translation - the actual point on the sphere surface
    const localPoint = scratchVecC.copy(best.worldHit);
    root.worldToLocal(localPoint);

    // For localDir, we normalize to get unit direction from center
    const localDir = localPoint.clone().normalize();

    updateRayDebug(rayOrigin, rayDir, best.worldHit, center);

    return {
        worldPoint: best.worldHit.clone(),
        localPoint: localPoint.clone(),
        localDir: localDir,
        distance: best.distToCamera,
        radius: radius, // Store radius for translation
    };
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
        return getActiveGlobeRadius() + MIN_SURFACE_OFFSET;
    }
    const dist = camera.position.distanceTo(center);
    return dist || getActiveGlobeRadius() + MIN_SURFACE_OFFSET;
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
        return getActiveGlobeRadius() + MIN_SURFACE_OFFSET;
    }
    scratchVecC.copy(camera.position).sub(center);
    const dirLen = scratchVecC.length();
    if (!dirLen) {
        return getActiveGlobeRadius() + MIN_SURFACE_OFFSET;
    }
    scratchVecC.multiplyScalar(1 / dirLen);
    const radius = getEllipsoidRadiusAlong(scratchVecC);
    return radius + MIN_SURFACE_OFFSET;
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
    const minDist = getDynamicMinDistance();
    if (MAX_CAMERA_DISTANCE === minDist) {
        return 0;
    }
    return THREE.MathUtils.clamp(
        (dist - minDist) / (MAX_CAMERA_DISTANCE - minDist),
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

function clampLat(lat) {
    return THREE.MathUtils.clamp(lat, -MAX_LATITUDE_DEG, MAX_LATITUDE_DEG);
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

// Rotate a globe in degrees using turntable style (camera axes)
function rotateGlobe(index, dLonDeg, dLatDeg) {
    const root = globeRoots[index];
    if (!root) return;

    root.updateMatrixWorld(true);

    // Use camera's view-space axes for turntable rotation
    const cameraUp = scratchVecA.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const cameraRight = scratchVecB.set(1, 0, 0).applyQuaternion(camera.quaternion);

    // Convert degrees to radians
    const yawRad = THREE.MathUtils.degToRad(dLonDeg);
    const pitchRad = THREE.MathUtils.degToRad(dLatDeg);

    // Horizontal rotation (longitude) around camera up axis
    quatSpin.setFromAxisAngle(cameraUp, -yawRad);

    // Vertical rotation (latitude) around camera right axis
    quatTilt.setFromAxisAngle(cameraRight, pitchRad);

    // Apply rotations using premultiply (world space)
    root.quaternion.premultiply(quatTilt);
    root.quaternion.premultiply(quatSpin);
    root.quaternion.normalize();

    root.updateMatrixWorld(true);
    view.notifyChange(camera);
    view.notifyChange(root);
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
Object.assign(statusPanel.style, {
    position: 'absolute',
    top: '12px',
    right: '12px',
    padding: '12px',
    background: 'rgba(0, 0, 0, 0.72)',
    color: '#fff',
    fontFamily: 'monospace',
    fontSize: '12px',
    borderRadius: '6px',
    zIndex: '1000',
    pointerEvents: 'none'
});

const statusTitle = document.createElement('div');
statusTitle.textContent = 'Interaction';
statusTitle.style.fontWeight = 'bold';
statusTitle.style.marginBottom = '6px';
statusPanel.appendChild(statusTitle);

const activeRow = document.createElement('div');
activeRow.style.marginBottom = '6px';
activeRow.innerHTML = 'Active globe: <span id="activeGlobeLabel">1</span>';
statusPanel.appendChild(activeRow);
const activeGlobeLabel = activeRow.querySelector('#activeGlobeLabel');

debugReadout = document.createElement('pre');
Object.assign(debugReadout.style, {
    margin: '0',
    fontSize: '11px',
    whiteSpace: 'pre-wrap',
});
statusPanel.appendChild(debugReadout);

const controlsInfo = document.createElement('div');
controlsInfo.style.marginTop = '8px';
controlsInfo.innerHTML = '<b>Controls</b><br>L-Drag: Move<br>R-Drag: Rotate<br>Wheel: Zoom<br>Space: Switch Globe';
statusPanel.appendChild(controlsInfo);

const statusButtons = document.createElement('div');
Object.assign(statusButtons.style, {
    marginTop: '10px',
    pointerEvents: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
});

const frameActiveBtn = document.createElement('button');
frameActiveBtn.textContent = 'Frame Active';
frameActiveBtn.onclick = () => frameGlobe(activeGlobeIndex);
statusButtons.appendChild(frameActiveBtn);

const frameBothBtn = document.createElement('button');
frameBothBtn.textContent = 'Frame Both';
frameBothBtn.onclick = frameAllGlobes;
statusButtons.appendChild(frameBothBtn);

const rayToggle = createCheckboxRow('Show ray debug', checked => setRayDebugVisible(checked));
rayToggle.style.pointerEvents = 'auto';
statusButtons.appendChild(rayToggle);

const sphereToggle = createCheckboxRow('Use sphere picking', checked => setSpherePickingEnabled(checked));
sphereToggle.style.pointerEvents = 'auto';
statusButtons.appendChild(sphereToggle);

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

/**
 * Get the camera's view-space "up" direction in world space.
 * For turntable rotation, this is the vertical axis of the view plane.
 */
function getCameraViewUp(target = scratchVecA) {
    // Camera's local Y axis in world space
    target.set(0, 1, 0).applyQuaternion(camera.quaternion);
    return target;
}

/**
 * Get the camera's view-space "right" direction in world space.
 */
function getCameraViewRight(target = scratchVecB) {
    target.set(1, 0, 0).applyQuaternion(camera.quaternion);
    return target;
}

/**
 * Turntable rotation: rotates globe while keeping its north-south axis
 * in the plane perpendicular to the camera's view direction.
 * 
 * - Horizontal mouse movement: rotates around camera's UP axis (Y in view space)
 * - Vertical mouse movement: rotates around camera's RIGHT axis (X in view space)
 * 
 * This ensures the globe's poles always appear vertically aligned in the view.
 */
function performTurntableRotation(root, dx, dy, anchorWorldPoint) {
    if (!root) return;

    root.updateMatrixWorld(true);
    const globeCenter = root.getWorldPosition(scratchCenter);

    // Calculate rotation sensitivity based on distance and globe size
    const dist = anchorWorldPoint
        ? camera.position.distanceTo(anchorWorldPoint)
        : camera.position.distanceTo(globeCenter);
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const visibleHeight = 2 * dist * Math.tan(fovRad / 2);
    const pixelSize = visibleHeight / Math.max(1, viewerDiv.clientHeight);

    // Get globe radius for angular conversion
    const radius = getActiveGlobeRadius();

    // Convert pixel movement to radians
    const radiansPerPixel = pixelSize / radius;

    // Get camera's view-space axes in world coordinates
    // These define the turntable rotation axes
    const cameraUp = getCameraViewUp(scratchVecA);      // Y in view space
    const cameraRight = getCameraViewRight(scratchVecB); // X in view space

    // Horizontal drag: rotate around camera's up axis
    // Dragging right moves the surface to the left (globe spins opposite to drag)
    const yawAngle = -dx * radiansPerPixel;
    quatSpin.setFromAxisAngle(cameraUp, yawAngle);

    // Vertical drag: rotate around camera's right axis  
    // Dragging down moves the surface down (globe tilts in same direction as drag)
    const pitchAngle = dy * radiansPerPixel;
    quatTilt.setFromAxisAngle(cameraRight, pitchAngle);

    // Apply rotations in world space using premultiply
    // Order: first pitch (tilt), then yaw (spin)
    root.quaternion.premultiply(quatTilt);
    root.quaternion.premultiply(quatSpin);
    root.quaternion.normalize();

    root.updateMatrixWorld(true);
}

/**
 * Translation: moves the globe so the grabbed surface point follows the cursor.
 * Uses a plane intersection approach for stable dragging.
 */
function performTranslation(root, mouseX, mouseY) {
    if (!root || !interactionState.hasWorldGrab) return;

    root.updateMatrixWorld(true);

    // Get the current world position of the grabbed point
    // We stored localPoint directly (actual position, not just direction)
    // For sphere mode, localDir is normalized so we need to scale by radius
    // For ellipsoid mode, localDir is normalized so we scale by ellipsoid radii
    const grabbedLocal = scratchVecD.copy(interactionState.grabbedLocalDir);

    if (pickingSettings.useSphere) {
        // For sphere, scale by the sphere radius
        const radius = getGlobeRadiusForRoot(root);
        // localDir is normalized, so multiply by radius to get surface point
        root.getWorldScale(scratchScale);
        // The radius already includes scale, but localDir is in local unscaled space
        grabbedLocal.multiplyScalar(EARTH_RADIUS);
    } else {
        // Scale by ellipsoid radii to get actual local position on surface
        const radii = scratchRadii.set(
            itowns.ellipsoidSizes.x,
            itowns.ellipsoidSizes.y,
            itowns.ellipsoidSizes.z
        );
        grabbedLocal.x *= radii.x;
        grabbedLocal.y *= radii.y;
        grabbedLocal.z *= radii.z;
    }

    // Transform to world space - this is where the grabbed point currently is
    const currentGrabbedWorld = scratchVecE.copy(grabbedLocal).applyMatrix4(root.matrixWorld);

    // Create a ray from camera through current mouse position
    const rect = viewerDiv.getBoundingClientRect();
    pointerNDC.x = ((mouseX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((mouseY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);

    // Intersect the ray with a plane that:
    // - passes through the current grabbed world position
    // - faces the camera (perpendicular to view direction)
    camera.getWorldDirection(scratchVecA);

    // Plane equation: normal · (point - planePoint) = 0
    // Ray: origin + t * direction
    // Solving for t: t = (normal · (planePoint - origin)) / (normal · direction)
    const planeNormal = scratchVecA; // camera look direction (pointing away from camera)
    const planePoint = currentGrabbedWorld;

    scratchVecB.copy(planePoint).sub(raycaster.ray.origin);
    const denom = planeNormal.dot(raycaster.ray.direction);

    if (Math.abs(denom) < 1e-10) {
        // Ray is parallel to plane, fallback to screen-space translation
        return performScreenSpaceTranslation(root, mouseX, mouseY);
    }

    const t = planeNormal.dot(scratchVecB) / denom;

    if (t < 0) {
        // Intersection is behind camera, fallback
        return performScreenSpaceTranslation(root, mouseX, mouseY);
    }

    // Calculate the intersection point - this is where we want the grabbed point to be
    const targetWorld = scratchVecC.copy(raycaster.ray.direction).multiplyScalar(t).add(raycaster.ray.origin);

    // Move the globe by the difference
    scratchVecF.copy(targetWorld).sub(currentGrabbedWorld);
    root.position.add(scratchVecF);
    root.updateMatrixWorld(true);
}

/**
 * Fallback screen-space translation when surface is lost.
 */
function performScreenSpaceTranslation(root, mouseX, mouseY) {
    if (!root) return;

    const dx = mouseX - interactionState.lastX;
    const dy = mouseY - interactionState.lastY;

    const dist = getCameraDistance();
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const visibleHeight = 2 * dist * Math.tan(fovRad / 2);
    const factor = visibleHeight / Math.max(1, viewerDiv.clientHeight);

    const viewRight = getCameraViewRight(scratchVecA);
    const viewUp = getCameraViewUp(scratchVecB);

    root.position.addScaledVector(viewRight, dx * factor);
    root.position.addScaledVector(viewUp, dy * factor);
    root.updateMatrixWorld(true);
}

function onMouseDown(event) {
    if (event.button !== 0 && event.button !== 2) {
        return;
    }

    const root = globeRoots[activeGlobeIndex];
    if (!root) {
        return;
    }

    // Check if we hit the globe surface
    const hit = intersectEllipsoid(event.clientX, event.clientY, root);

    // Only start dragging if we hit the surface
    if (!hit) {
        return;
    }

    interactionState.isDragging = true;
    interactionState.mode = event.button === 2 ? 'rotate' : 'translate';
    interactionState.lastX = event.clientX;
    interactionState.lastY = event.clientY;
    interactionState.hasWorldGrab = true;
    interactionState.grabbedWorldPoint.copy(hit.worldPoint);

    // Store the local direction for both rotation and translation
    // localDir is a normalized direction from globe center to surface point
    if (hit.localDir) {
        interactionState.grabbedLocalDir.copy(hit.localDir);
    } else if (hit.localPoint) {
        // Use localPoint if available, normalize it
        interactionState.grabbedLocalDir.copy(hit.localPoint).normalize();
    } else {
        // Fallback: compute local direction from world point
        root.worldToLocal(interactionState.grabbedLocalDir.copy(hit.worldPoint));
        interactionState.grabbedLocalDir.normalize();
    }

    // Store initial quaternion for rotation
    interactionState.initialQuaternion.copy(root.quaternion);

    event.preventDefault();
}

function onMouseUp() {
    interactionState.isDragging = false;
    interactionState.hasWorldGrab = false;
    interactionState.mode = null;
}

function onMouseMove(event) {
    const root = globeRoots[activeGlobeIndex];

    // Update debug visualization on hover
    if (root && rayDebugState.enabled) {
        const hoverHit = intersectEllipsoid(event.clientX, event.clientY, root);
        // Debug is already updated inside intersectEllipsoid
    }

    if (!interactionState.isDragging || !root) {
        return;
    }

    const dx = event.clientX - interactionState.lastX;
    const dy = event.clientY - interactionState.lastY;

    if (interactionState.mode === 'rotate') {
        performTurntableRotation(root, dx, dy, interactionState.grabbedWorldPoint);
    } else if (interactionState.mode === 'translate') {
        performTranslation(root, event.clientX, event.clientY);
    }

    interactionState.lastX = event.clientX;
    interactionState.lastY = event.clientY;

    view.notifyChange(camera);
    view.notifyChange(root);
    updateDebugReadout();
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
