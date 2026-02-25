import * as itowns from 'itowns';
import * as THREE from 'three';

import { RoadUIStorage, getPersistedSphereSettings } from '../roads/state.js';
import { applyPanelStyle, ensureUIPanelStyles, UI_BUTTON_STYLE } from '../ui/panelStyles.js';

// --- Sphere/cone UI mapping helpers ----------------------------------------
const VIEW_RADIUS_MIN = 100;
const VIEW_RADIUS_MAX = 20000;

// --- Cone height multiplier mapping (for cone mode) ------------------------
const CONE_HEIGHT_MIN = 0.1;
const CONE_HEIGHT_MAX = 10.0;

function coneHeightMulFromSlider01(u) {
    const clamped = THREE.MathUtils.clamp(+u || 0, 0, 1);
    const k = CONE_HEIGHT_MAX / CONE_HEIGHT_MIN;
    return CONE_HEIGHT_MIN * Math.pow(k, clamped);
}

function slider01FromConeHeightMul(mul) {
    const clamped = THREE.MathUtils.clamp(
        +mul || 1.0,
        CONE_HEIGHT_MIN,
        CONE_HEIGHT_MAX,
    );
    const k = CONE_HEIGHT_MAX / CONE_HEIGHT_MIN;
    return Math.log(clamped / CONE_HEIGHT_MIN) / Math.log(k);
}

// Slider u in [0,1]  →  radius in meters (log / exponential mapping)
function radiusFromSlider01(u) {
    const clamped = THREE.MathUtils.clamp(+u || 0, 0, 1);
    const k = VIEW_RADIUS_MAX / VIEW_RADIUS_MIN;
    return VIEW_RADIUS_MIN * Math.pow(k, clamped);
}

// Radius in meters  →  slider u in [0,1]
function slider01FromRadius(rMeters) {
    const clamped = THREE.MathUtils.clamp(+rMeters || VIEW_RADIUS_MIN,
        VIEW_RADIUS_MIN, VIEW_RADIUS_MAX);
    const k = VIEW_RADIUS_MAX / VIEW_RADIUS_MIN;
    return Math.log(clamped / VIEW_RADIUS_MIN) / Math.log(k);
}
export const SphereProjectionState = {
    controller: null,
};
export const StereoUniforms = {
    uSphereCenter: { value: new THREE.Vector3() },
    uSphereR: { value: 1.0 },
    uProjectionStrength: { value: 0.0 },
    uCameraPos: { value: new THREE.Vector3() },
    uCullBackfaces: { value: 0.0 },
    uSphereBasis: { value: new THREE.Matrix3() },

    // precomputed uniforms:
    uTwoR: { value: 0.0 },                // 2 * R
    uInv2R: { value: 0.0 },               // 1 / (2 * R)
    uCameraDirFromCenter: { value: new THREE.Vector3(0, 0, 1) }, // normalized

    // cone + mode
    uProjectionSurface: { value: 0.0 },             // 0 = sphere, 1 = cone
    uConeApex: { value: new THREE.Vector3() },      // apex in world
    uConeAxis: { value: new THREE.Vector3(0, 1, 0) }, // unit axis (upwards)
    uConeSlope: { value: 1.0 },                     // k = r_ground / hc
    uConeTopZ: { value: 1.0 },                      // distance apex → cone top (along axis)

    // NEW: view radius / ground center for cone
    uViewRadius: { value: 1000.0 },
    uGroundCenter: { value: new THREE.Vector3() },
    uUseSourceDistanceForWorldUnits: { value: 1.0 },
};

// Cone visualization mode:
//  - true  → truncated from sphere zenith down to GROUND (bottom radius = viewRadius)
//  - false → truncated from sphere zenith down to SPHERE BOTTOM (your current behaviour)
const CONE_TRUNCATE_AT_GROUND = true;

function makeSphereController(view, {
    radius = 1000,
    offset01 = 1.0,
    opacity = 0.5,
    color = 0xff0000,
    coneHeightMul = 1.0,
} = {}) {
    const DEBUG_SPHERE_CTL = false;
    const logSphere = (...args) => {
        if (!DEBUG_SPHERE_CTL) return;
        console.log('[SphereCtl]', ...args);
    };


    // external clamp/diagnostic cylinder (the green one from addClampDebugCylinder)
    let externalClampCylinder = null;

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

    let displayMode = 'sphere'; // 'sphere' | 'cone'

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
        coneHeightMul: 1.0,
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

        const normal = state.groundECEF.clone().normalize();
        const G = state.groundECEF; // ground intersection center

        // Slider value u in [0,1]
        const u = THREE.MathUtils.clamp(state.intersection01, 0, 1);

        // Non-linear mapping for finer control near 0
        const epsT = 1e-4;
        const tUnit = u * u; // [0,1]
        const t = epsT + (1.0 - 2.0 * epsT) * tUnit; // t in (0,1)

        // View radius (meters)
        const rView = Math.max(1e-3, state.viewRadius);

        // f(t) = sqrt(2t - t^2) → relation between sphere radius and intersection radius
        const f = Math.sqrt(Math.max(1e-6, 2.0 * t - t * t));

        // Sphere radius such that intersection radius is exactly rView
        const R = rView / f;
        state.sphereRadius = R;

        // Sphere center height above ground: h = R * (1 - t)
        const h = R * (1.0 - t);
        const C = G.clone().addScaledVector(normal, h);

        // Sphere zenith
        const Z = C.clone().addScaledVector(normal, R);

        // --- Sphere placement ------------------------------------------------
        sphereMesh.position.copy(C);
        sphereMesh.scale.setScalar(R);
        sphereMesh.lookAt(new THREE.Vector3(0, 0, 0));
        sphereMesh.rotateX(Math.PI / 2);

        // --- Shared cone/infinite-cone quantities ----------------------------
        // Distance from sphere top to ground: P = R(2 - t)
        const P = R * (2.0 - t);

        // Apex depth below ground so that the ground intersection circle
        // has radius rView: d^2 = h_c * R * (1 - t)  =>  h_c = d^2 / (R(1 - t))
        const eps = 1e-6;
        const denom = Math.max(eps, R * (1.0 - t));
        const hc = (rView * rView) / denom;  // distance ground → apex

        // Total distance from zenith Z down to apex
        const totalHeight = P + hc;

        // Radius at zenith in the infinite cone
        const minRadius = 1e-3;
        let rTopInfinite = rView * (totalHeight / hc);
        rTopInfinite = Math.max(minRadius, rTopInfinite);

        // --- Choose cone truncation mode -------------------------------------
        let cylTopRadius;
        let cylBottomRadius;
        let cylHeight;
        let cylCenter;
        let cylAxisDir;

        const up = new THREE.Vector3(0, 1, 0);

        // Cone defined by apex below ground and radius rView at ground.
        // r(h) = rView * (1 + h / hc), where h is height above ground.
        const k = state.coneHeightMul || 1.0;

        const hTopDefault = P;                      // sphere zenith height
        const hTop = THREE.MathUtils.clamp(
            k * hTopDefault,
            CONE_HEIGHT_MIN * hTopDefault,
            CONE_HEIGHT_MAX * hTopDefault,
        );

        const rTop = rView * (1.0 + hTop / hc);     // radius at new top height

        cylBottomRadius = Math.max(minRadius, rView);
        cylTopRadius = Math.max(minRadius, rTop);
        cylHeight = hTop;
        cylCenter = G.clone().addScaledVector(normal, 0.5 * hTop);
        cylAxisDir = normal;

        const q = new THREE.Quaternion().setFromUnitVectors(up, cylAxisDir);

        // --- External green cone / truncated cone ----------------------------
        if (externalClampCylinder) {
            if (externalClampCylinder.geometry) {
                externalClampCylinder.geometry.dispose();
            }
            externalClampCylinder.geometry = new THREE.CylinderGeometry(
                cylTopRadius,
                cylBottomRadius,
                cylHeight,
                48,
                1,
                true // openEnded
            );

            externalClampCylinder.quaternion.copy(q);
            externalClampCylinder.position.copy(cylCenter);
            externalClampCylinder.visible = (displayMode === 'cone');
            externalClampCylinder.updateMatrixWorld(true);
        }

        // Infinite cone definition for the shader
        // apex: below ground along -normal
        const apex = G.clone().addScaledVector(normal, -hc);

        // slope: radius at ground / height of ground above apex
        const kSlope = rView / hc;

        // z coordinate of cone top in apex-frame
        const zTop = hc + hTop;

        StereoUniforms.uConeApex.value.copy(apex);
        StereoUniforms.uConeAxis.value.copy(normal);
        StereoUniforms.uConeSlope.value = kSlope;
        StereoUniforms.uConeTopZ.value = zTop;

        StereoUniforms.uViewRadius.value = rView;
        StereoUniforms.uGroundCenter.value.copy(G);



        view.notifyChange(true);
    }

    return {
        mesh: sphereMesh,
        // coneMesh,
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
            // coneMat.opacity = clamped;
            // change the opactity of the external cylinder too
            if (externalClampCylinder && externalClampCylinder.material) {
                externalClampCylinder.material.opacity = clamped;
            }
            logSphere('setOpacity', clamped);
            view.notifyChange(true);
        },
        setColor(hex) {
            sphereMat.color.set(hex);
            // coneMat.color.set(hex);
            logSphere('setColor', hex);
            view.notifyChange(true);
        },
        setConeHeightMul(mul) {
            const k = THREE.MathUtils.clamp(+mul || 1.0, CONE_HEIGHT_MIN, CONE_HEIGHT_MAX);
            state.coneHeightMul = k;
            logSphere('setConeHeightMul', k);
            updateTransform();
        },
        // setDisplayMode(mode) {
        //     displayMode = mode === 'cone' ? 'cone' : 'sphere';
        //     sphereMesh.visible = displayMode === 'sphere';
        //     coneMesh.visible = displayMode === 'cone';
        //     logSphere('setDisplayMode', displayMode);
        //     view.notifyChange(true);
        // },
        setDisplayMode(mode) {
            displayMode = mode === 'cone' ? 'cone' : 'sphere';
            const showCone = (displayMode === 'cone');
            sphereMesh.visible = !showCone;
            // We stop using the internal red cone for now.
            // coneMesh.visible = false;
            if (externalClampCylinder) {
                externalClampCylinder.visible = showCone;
            }

            // Tell the shader which surface to use
            StereoUniforms.uProjectionSurface.value = (displayMode === 'cone') ? 1.0 : 0.0;

            logSphere('setDisplayMode', displayMode);
            view.notifyChange(true);
        },
        // NEW: allow attaching the green debug cylinder from outside
        attachClampCylinder(mesh) {
            externalClampCylinder = mesh;
            if (externalClampCylinder) {
                externalClampCylinder.frustumCulled = false;
                externalClampCylinder.visible = (displayMode === 'cone');
            }
            // Re-apply transform so it jumps to the current ground point
            updateTransform();
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

function addClampDebugCylinder(view) {

    const geometry = new THREE.CylinderGeometry(0, 1, 1, 24, 1, true);
    // const geometry = new THREE.CylinderGeometry(1000, 0, 8000, 24, 1, true);
    const material = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.8,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        // wireframe: true,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'ClampDebugCone';
    mesh.frustumCulled = false;
    mesh.renderOrder = 40;

    view.scene.add(mesh);
    view.notifyChange(true);

    if (typeof window !== 'undefined') {
        window.DebugClampCylinder = mesh;
    }

    // Attach to sphere controller so it follows all updates
    if (SphereProjectionState.controller &&
        typeof SphereProjectionState.controller.attachClampCylinder === 'function') {
        SphereProjectionState.controller.attachClampCylinder(mesh);
    }

    console.log('[Debug] Clamp cone added');
}

function createSphereWidget(view, viewerDiv, sphereCtl, init = { radius: 1000, offset01: 1.0, opacity: 0.5, coneHeightMul: 1.0 }) {
    ensureUIPanelStyles();
    const panel = document.createElement('div');
    applyPanelStyle(panel, { left: '10px', top: '10px', minWidth: '280px' });
    panel.classList.add('itowns-ui-panel');
    const state = {
        radius: Number.isFinite(init.radius) ? init.radius : 1000,
        offset01: Number.isFinite(init.offset01) ? init.offset01 : 1.0,
        opacity: Number.isFinite(init.opacity) ? init.opacity : 0.5,
        coneHeightMul: Number.isFinite(init.coneHeightMul) ? init.coneHeightMul : 1.0,
    };

    const radiusSlider01 = slider01FromRadius(state.radius);
    const offsetSlider01 = THREE.MathUtils.clamp(state.offset01, 0, 1);

    const coneHeightSlider01 = slider01FromConeHeightMul(state.coneHeightMul);

    panel.innerHTML = `
        <div style="font-weight:bold; font-size:14px; border-bottom:1px solid #555; padding-bottom:5px;">
            Projection Controls
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
            <!-- radius slider is now 0..1, mapped logarithmically to meters -->
            <input id="sp-r" type="range" min="0" max="1" step="0.001" value="${radiusSlider01}">
        </div>
        <div style="display:flex; flex-direction:column; gap:5px;">
            <div style="display:flex; justify-content:space-between;">
                <span>Intersection</span>
                <span id="sp-ov">${state.offset01.toFixed(3)}</span>
            </div>
            <!-- intersection slider also 0..1 with finer steps -->
            <input id="sp-o" type="range" min="0" max="1" step="0.001" value="${offsetSlider01}">
        </div>
                <div id="sp-cone-height-wrapper" style="display:none; margin-top:6px;">
            <div style="display:flex; justify-content:space-between;">
                <span>Cone height</span>
                <span id="sp-chv">${state.coneHeightMul.toFixed(2)}×</span>
            </div>
            <input id="sp-ch" type="range" min="0" max="1" step="0.001" value="${coneHeightSlider01}">
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

    const coneHeightWrapper = panel.querySelector('#sp-cone-height-wrapper');
    const coneHeightInput = panel.querySelector('#sp-ch');
    const coneHeightLabel = panel.querySelector('#sp-chv');

    const persistSphereState = () => {
        RoadUIStorage.save({
            sphereRadius: state.radius,
            sphereOffset: state.offset01,
            sphereOpacity: state.opacity,
            coneHeightMul: state.coneHeightMul, // NEW
        });
    };


    sphereCtl.setRadius(state.radius);
    sphereCtl.setOffset01(state.offset01);
    sphereCtl.setOpacity(state.opacity);

    const updateModeButtons = () => {
        const mode = sphereCtl.getDisplayMode ? sphereCtl.getDisplayMode() : 'sphere';
        btnModeSphere.classList.toggle('is-active', mode === 'sphere');
        btnModeCone.classList.toggle('is-active', mode === 'cone');
        coneHeightWrapper.style.display = (mode === 'cone') ? 'block' : 'none';
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
        const u = parseFloat(e.target.value);        // 0..1
        state.radius = radiusFromSlider01(u);        // meters
        radiusLabel.textContent = `${state.radius.toFixed(0)} m`;
        sphereCtl.setRadius(state.radius);
        persistSphereState();
    });

    offsetInput.addEventListener('input', (e) => {
        state.offset01 = parseFloat(e.target.value); // 0..1 slider value
        offsetLabel.textContent = state.offset01.toFixed(3);
        sphereCtl.setOffset01(state.offset01);
        persistSphereState();
    });

    coneHeightInput.addEventListener('input', (e) => {
        const uHeight = parseFloat(e.target.value);
        state.coneHeightMul = coneHeightMulFromSlider01(uHeight);
        coneHeightLabel.textContent = `${state.coneHeightMul.toFixed(2)}×`;
        sphereCtl.setConeHeightMul(state.coneHeightMul);
        persistSphereState();
    });

    // Double-click to reset multiplier back to 1×
    coneHeightInput.addEventListener('dblclick', () => {
        state.coneHeightMul = 1.0;
        const uReset = slider01FromConeHeightMul(state.coneHeightMul);
        coneHeightInput.value = uReset.toString();
        coneHeightLabel.textContent = `${state.coneHeightMul.toFixed(2)}×`;
        sphereCtl.setConeHeightMul(state.coneHeightMul);
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

export function makeStereoProjectMaterial(mat) {
    if (!mat || mat.userData?.stereoPatched) return mat;

    mat.onBeforeCompile = (shader) => {
        shader.uniforms.uSphereCenter = StereoUniforms.uSphereCenter;
        shader.uniforms.uSphereR = StereoUniforms.uSphereR;
        shader.uniforms.uProjectionStrength = StereoUniforms.uProjectionStrength;
        shader.uniforms.uCameraPos = StereoUniforms.uCameraPos;
        shader.uniforms.uCullBackfaces = StereoUniforms.uCullBackfaces;
        shader.uniforms.uSphereBasis = StereoUniforms.uSphereBasis;


        // precomputed uniforms
        shader.uniforms.uTwoR = StereoUniforms.uTwoR;
        shader.uniforms.uInv2R = StereoUniforms.uInv2R;
        shader.uniforms.uCameraDirFromCenter = StereoUniforms.uCameraDirFromCenter;

        // cone + mode uniforms
        shader.uniforms.uProjectionSurface = StereoUniforms.uProjectionSurface;
        shader.uniforms.uConeApex = StereoUniforms.uConeApex;
        shader.uniforms.uConeAxis = StereoUniforms.uConeAxis;
        shader.uniforms.uConeSlope = StereoUniforms.uConeSlope;
        shader.uniforms.uConeTopZ = StereoUniforms.uConeTopZ;

        shader.uniforms.uViewRadius = StereoUniforms.uViewRadius;     // NEW
        shader.uniforms.uGroundCenter = StereoUniforms.uGroundCenter;   // NEW
        shader.uniforms.uUseSourceDistanceForWorldUnits = StereoUniforms.uUseSourceDistanceForWorldUnits;


        let vs = shader.vertexShader;
        let fs = shader.fragmentShader;
        const inject = /* glsl */`
uniform vec3  uSphereCenter;
uniform float uSphereR;
uniform float uProjectionStrength;
uniform vec3  uCameraPos;
uniform float uCullBackfaces;
uniform mat3  uSphereBasis;

// Precomputed uniforms:
uniform float uTwoR;              // 2 * uSphereR
uniform float uInv2R;             // 1 / (2 * uSphereR)
uniform vec3  uCameraDirFromCenter; // normalized (camera - center)

// NEW: cone + surface mode
uniform float uProjectionSurface;   // 0 = sphere, 1 = cone
uniform vec3  uConeApex;
uniform vec3  uConeAxis;           // unit vector
uniform float uConeSlope;          // k = r_ground / hc
uniform float uConeTopZ;           // z_t (apex → top center along axis)

uniform float uViewRadius;      // NEW
uniform vec3  uGroundCenter;    // NEW
uniform float uUseSourceDistanceForWorldUnits;

#ifdef WORLD_UNITS
varying float vLinewidthScale;
#endif

// Helper: is stereographic projection actually active?
bool isProjectionEnabled() {
  return (uProjectionStrength > 0.0 && uSphereR > 0.0);
}


// ----------------- Sphere mapping -----------------


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


// ----------------- Cone mapping -----------------
// Cone:
//  apex at uConeApex
//  axis uConeAxis (unit, apex→up)
//  slope k = uConeSlope, with r = k * z in apex-frame
//  top center at z = uConeTopZ in apex-frame
//
// For a world point wp, we parametrize the line from top center
// to wp, and intersect it with the infinite cone surface.

vec3 inverseConeProject(vec3 wp) {
  if (!isProjectionEnabled()) {
    return wp;
  }

  // --- Do NOT project inside the view radius on the ground plane ----
  // Project wp onto the ground plane through the local vertical (uConeAxis)
  vec3 axis = normalize(uConeAxis);
  vec3 vGC = wp - uGroundCenter;
  float hAlong = dot(vGC, axis);
  vec3 radialGC = vGC - hAlong * axis;  // component in the ground plane
  float r2Ground = dot(radialGC, radialGC);
  float vr2 = uViewRadius * uViewRadius;

  // Small epsilon so points exactly on the circle are treated as "inside"
  if (r2Ground <= vr2 + 1e-6) {
    return wp;
  }


  vec3 apex = uConeApex;
  float k   = uConeSlope;
  float zTop = uConeTopZ;

  // Position relative to apex
  vec3 relP = wp - apex;
  float zP  = dot(relP, axis);
  vec3 radialP = relP - zP * axis;
  float rP2 = dot(radialP, radialP);

  float dz = zP - zTop;
  float k2 = k * k;

  // Quadratic in lambda:  λ^2 rP^2 = k^2 (zTop + λ dz)^2
  float A = rP2 - k2 * dz * dz;
  float B = -2.0 * k2 * zTop * dz;
  float C = -k2 * zTop * zTop;

  float eps = 1e-6;
  float D = B * B - 4.0 * A * C;
  if (D < eps) {
    return wp;
  }

  float sqrtD = sqrt(max(D, 0.0));
  float lambda;

  if (abs(A) < eps) {
    if (abs(B) < eps) {
      return wp;
    }
    lambda = -C / B;
  } else {
    float l1 = (-B + sqrtD) / (2.0 * A);
    float l2 = (-B - sqrtD) / (2.0 * A);
    bool l1Pos = (l1 > 0.0);
    bool l2Pos = (l2 > 0.0);
    if (l1Pos && l2Pos) {
      lambda = min(l1, l2);
    } else if (l1Pos) {
      lambda = l1;
    } else if (l2Pos) {
      lambda = l2;
    } else {
      lambda = max(l1, l2);
    }
  }

  // Intersection in apex-frame
  vec3 radialI = lambda * radialP;
  float zI = zTop + lambda * dz;
  vec3 relI = radialI + zI * axis;

  return apex + relI;
}

// ----------------- Surface selection wrapper -----------------

vec3 applyProjection(vec3 wp) {
  if (!isProjectionEnabled()) {
    return wp;
  }

  if (uProjectionSurface > 0.5) {
    // Cone mode
    return inverseConeProject(wp);
  } else {
    // Sphere mode
    return inverseStereoProject(wp);
  }
}


// ----------------- Hemisphere culling (sphere only) ----------

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

   // ---------------- SPHERE MODE ----------------
 if (uProjectionSurface < 0.5) {
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

  // Pre-normalized on CPU:
  vec3 camDirFromCenter = uCameraDirFromCenter;


  // outward normal faces the camera → outside hemisphere → HIDE it
  // (so we see the inside).
  return dot(n, camDirFromCenter) > 0.0;
}

  // ---------------- CONE MODE ----------------
  // Keep the same spirit:
  //  - never cull anything inside the view radius
  //  - for projected points, use the cone top center as reference and
  //    cull the side facing the camera.

  // 1) Inside view radius on ground? Never cull  (we do not project there).
  vec3 axis = normalize(uConeAxis);
  vec3 vGC = originalWp - uGroundCenter;
  float hAlong = dot(vGC, axis);
  vec3 radialGC = vGC - hAlong * axis; // in local "ground" plane
  float r2Ground = dot(radialGC, radialGC);
  float vr2 = uViewRadius * uViewRadius;

  if (r2Ground <= vr2 + 1e-6) {
    return false;
  }

  // 2) Estimate cone surface normal at the *projected* point
  //    using the gradient of r - k z = 0:
  //      n ∝ radialDir - k * axis
  vec3 apex = uConeApex;
  float kCone = uConeSlope;

  vec3 ap = projectedP - apex;
  float zC  = dot(ap, axis);
  vec3 radialC = ap - zC * axis;
  float rLen2 = dot(radialC, radialC);
  if (rLen2 < 1e-8) {
    // very close to the axis → normal ill-defined, don't cull
    return false;
  }

  float rLen = sqrt(rLen2);
  vec3 radialDir = radialC / rLen;
  vec3 nSurf = normalize(radialDir - kCone * axis);  // outward normal

  // 3) Compare normal to camera direction from the point
  vec3 camDir = normalize(uCameraPos - projectedP);

  // As for the sphere: if the outward normal faces the camera,
  // we hide that fragment/vertex to only see the "inside" of the cone.
  return dot(nSurf, camDir) > 0.0;
}
  `;

        if (mat.isLineMaterial === true) {
            vs = inject + vs;
            vs = vs.replace(
                /vec4\s+start\s*=\s*modelViewMatrix\s*\*\s*vec4\s*\(\s*instanceStart\s*,\s*1\.0\s*\)\s*;/,
                `
    vec4 startOriginal = modelViewMatrix * vec4( instanceStart, 1.0 );
    vec3 wpStart = (modelMatrix * vec4( instanceStart, 1.0 )).xyz;
    vec3 pStart  = applyProjection(wpStart);
    vec4 start;
  `
            );
            vs = vs.replace(
                /vec4\s+end\s*=\s*modelViewMatrix\s*\*\s*vec4\s*\(\s*instanceEnd\s*,\s*1\.0\s*\)\s*;/,
                `
    vec4 endOriginal = modelViewMatrix * vec4( instanceEnd, 1.0 );
    vec3 wpEnd = (modelMatrix * vec4( instanceEnd, 1.0 )).xyz;
    vec3 pEnd  = applyProjection(wpEnd);
    vec4 end;
    bool cullSegment = shouldCullHemisphere(wpStart, pStart) || shouldCullHemisphere(wpEnd, pEnd);
    if (cullSegment) {
      start = vec4(1e9, 1e9, 1e9, 1.0);
      end   = vec4(1e9, 1e9, 1e9, 1.0);
    } else {
      start = viewMatrix * vec4( pStart, 1.0 );
      end   = viewMatrix * vec4( pEnd, 1.0 );
    }

    float linewidthScaleStart = 1.0;
    float linewidthScaleEnd = 1.0;
    if (!cullSegment && uUseSourceDistanceForWorldUnits > 0.5) {
      float depthOrigStart = max(abs(startOriginal.z), 1e-4);
      float depthProjStart = max(abs(start.z), 1e-4);
      float depthOrigEnd = max(abs(endOriginal.z), 1e-4);
      float depthProjEnd = max(abs(end.z), 1e-4);
      linewidthScaleStart = clamp(depthProjStart / depthOrigStart, 0.02, 50.0);
      linewidthScaleEnd = clamp(depthProjEnd / depthOrigEnd, 0.02, 50.0);
    }

    #ifdef WORLD_UNITS
      vLinewidthScale = ( position.y < 0.5 ) ? linewidthScaleStart : linewidthScaleEnd;
    #endif
  `
            );
            vs = vs.replace(
                /float\s+hw\s*=\s*linewidth\s*\*\s*0\.5\s*;/,
                'float hw = linewidth * max(vLinewidthScale, 1e-4) * 0.5;'
            );
            fs = `
#ifdef WORLD_UNITS
varying float vLinewidthScale;
#endif
` + fs;
            fs = fs.replace(
                /float\s+norm\s*=\s*len\s*\/\s*linewidth\s*;/,
                `
                float effectiveLinewidth = max(linewidth * vLinewidthScale, 1e-4);
                float norm = len / effectiveLinewidth;
`
            );
            shader.vertexShader = vs;
            shader.fragmentShader = fs;
        } else if (mat.isLineBasicMaterial === true) {
            shader.vertexShader =
                inject +
                shader.vertexShader.replace(
                    '#include <project_vertex>',
                    `
      vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vec3 p  = applyProjection(wp);
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
      vec3 p  = applyProjection(wp);
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

const _basisUp = new THREE.Vector3();
const _basisRef = new THREE.Vector3();
const _basisX = new THREE.Vector3();
const _basisZ = new THREE.Vector3();

export function updateSphereBasisUniform() {
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
        _basisX.z, _basisUp.z, _basisZ.z,
    );
}

export function initProjection(view, viewerDiv) {
    const sphereCtl = makeSphereController(view, {
        radius: 1000,
        offset01: 1.0,
        opacity: 0.54,
        color: 0xff0000,
        coneHeightMul: 1.0,
    });

    SphereProjectionState.controller = sphereCtl;

    view.addEventListener(itowns.GLOBE_VIEW_EVENTS.GLOBE_INITIALIZED, () => {
        initSphereAtLookAt(view, sphereCtl);
        createSphereWidget(view, viewerDiv, sphereCtl, getPersistedSphereSettings());
        addClampDebugCylinder(view);
    });

    return sphereCtl;
}
