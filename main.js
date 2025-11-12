import * as itowns from 'itowns';

import * as THREE from 'three';

function makeRippleMaterialLinear(baseMat) {
    const mat = baseMat.clone();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.renderOrder = 10;

    mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0.0 };
        shader.fragmentShader =
            'uniform float uTime;\n' + shader.fragmentShader;

        shader.vertexShader =
            'uniform float uTime;\n' + shader.vertexShader;

        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `
        #include <begin_vertex>
        // exaggerated vertical ripple for testing
        float h = sin(uTime * 4.0 + position.x * 0.01 + position.y * 0.01) * 50.0;
        transformed.z += h;
        `
        );

        mat.userData.shader = shader;
    };

    return mat;
}

function enableRippleShaderLiveLinear(view, layer, makeRippleMaterial) {
    let time = 0;
    view.addFrameRequester(itowns.MAIN_LOOP_EVENTS.BEFORE_RENDER, (dt = 16.7) => {
        time += dt * 0.001;

        let changed = false;
        let patched = false;

        layer.object3d.traverse((obj) => {
            const isRenderable = obj.isMesh || obj.isLine;
            if (!isRenderable || !obj.material) return;

            const mat = obj.material;

            // already patched?
            if (mat.userData && mat.userData.ripplePatched) return;

            // if this is an array (multi-material), patch each
            if (Array.isArray(mat)) {
                for (let i = 0; i < mat.length; i++) {
                    if (!mat[i].userData?.ripplePatched) {
                        mat[i] = makeRippleMaterial(mat[i]);
                        mat[i].userData.ripplePatched = true;
                        changed = true;
                    }
                }
            } else {
                const newMat = makeRippleMaterial(mat);
                newMat.userData.ripplePatched = true;
                obj.material = newMat;
                changed = true;
            }
        });

        // only update when anything changes, including camera movement
        // if (changed) {
        //     view.notifyChange(layer);
        // }

        // change the time uniform
        layer.object3d.traverse((obj) => {
            const shader = obj.material?.userData?.shader;
            if (shader) {
                shader.uniforms.uTime.value = time;
            }
        });
        // update every frame (for continuous animations)
        view.notifyChange(layer);
    });
}

const viewerDiv = document.getElementById('viewerDiv');
const placement = {
    coord: new itowns.Coordinates('EPSG:4326', 4.768, 45.537),
    range: 5000,
};
const view = new itowns.GlobeView(viewerDiv, placement);

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
view.addLayer(elevationLayer).then(() => {
    console.log('Elevation layer added');
    view.notifyChange(true);
});

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

view.addLayer(orthoLayer).then(() => {
    console.log('Ortho layer added');
    view.notifyChange(true);
});

// Add geometry layer with WFS source
const batiSource = new itowns.WFSSource({
    url: 'https://data.geopf.fr/wfs/ows?',
    version: '2.0.0',
    typeName: 'BDTOPO_V3:batiment',        // <- updated namespace
    crs: 'EPSG:4326',
    format: 'application/json',
    // extent: {
    //     west: 4.1,
    //     east: 4.9,
    //     south: 45.6,
    //     north: 45.8,
    // },
    zoom: { min: 13, max: 18 },            // request when fairly zoomed in
});

let read_once = false;

// simple extruded buildings
const batiLayer = new itowns.FeatureGeometryLayer('BDTOPO_Buildings', {
    source: batiSource,
    zoom: { min: 14 },
    style: {
        fill: {
            color: (p) => {
                // if (!read_once) {
                //     console.log('Building properties example:', p);
                //     read_once = true;
                // }
                // console.log('Building props:', p);
                return 0xffa500;
            },
            base_altitude: (p) => p.altitude_minimale_sol,
            extrusion_height: (p) => (p.hauteur || p.z_max || 0) - (p.z_min || 0),
        },
    },
});

// view.addLayer(batiLayer).then(() => {
//     console.log('BDTOPO_Buildings layer added');
//     // timeout
//     setTimeout(() => {
//         enableRippleShaderLive(view, batiLayer, makeRippleMaterial);
//     }, 1000);
// });

const roadsSource = new itowns.WFSSource({
    url: 'https://data.geopf.fr/wfs/ows?',
    version: '2.0.0',
    typeName: 'BDTOPO_V3:troncon_de_route',   // <- from capabilities
    crs: 'EPSG:4326',
    format: 'application/json',
    // extent: {
    //     west: 4.1,
    //     east: 4.9,
    //     south: 45.6,
    //     north: 45.8,
    // },
    zoom: { min: 6, max: 15 },
});

const roadsLayer = new itowns.FeatureGeometryLayer('BDTOPO_Roads', {
    source: roadsSource,
    zoom: { min: 12 },
    style: {
        stroke: {
            color: 0xff0000,
            width: 50,
            base_altitude: (props, ctx) => {
                if (!read_once) {
                    console.log('Building properties example:', props);
                    read_once = true;
                }
                // ctx.coordinates = current vertex coordinates (in layer CRS)
                // Use its own Z if present, then push up slightly.
                const c = Array.isArray(ctx.coordinates)
                    ? ctx.coordinates[0]
                    : ctx.coordinates;

                const z = (c && typeof c.z === 'number') ? c.z : 0;
                return z + 5; // 0.5 m above whatever BD TOPO says
            }
        },
    },
});


// ---- Ripple state (world coords in EPSG:4978) ----
const Ripple = {
    epicenter: new THREE.Vector3(0, 0, 0),
    hasEpicenter: false,
    color: new THREE.Color('#ff0000'),
};

// set epicenter from a world-space THREE.Vector3
function setRippleEpicenterWorld(vec3) {
    if (!vec3) return;
    Ripple.epicenter.copy(vec3);
    Ripple.hasEpicenter = true;
}

// get world point at screen center when depth is ready (no timeout)
function setEpicenterFromScreenCenter(view) {
    let done = false;
    view.addFrameRequester(itowns.MAIN_LOOP_EVENTS.BEFORE_RENDER, () => {
        if (done) return;
        const w = view.mainLoop.gfxEngine.width;
        const h = view.mainLoop.gfxEngine.height;
        const screen = new THREE.Vector2(w * 0.5, h * 0.5);
        const p = view.getPickingPositionFromDepth(screen);
        if (p) {
            setRippleEpicenterWorld(p);
            done = true;
        }
    });
}

// set epicenter from a click (no key modifier needed, change if you want)
function bindEpicenterPicking(viewerDiv, view) {
    viewerDiv.addEventListener('click', (event) => {
        const coords = view.eventToViewCoords(event);
        const p = view.getPickingPositionFromDepth(coords);
        console.log('Picked epicenter at:', p);
        if (p) setRippleEpicenterWorld(p);
    });
}
function makeRippleMaterial(baseMat) {
    const mat = baseMat.clone();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.renderOrder = 10;

    mat.onBeforeCompile = (shader) => {
        // uniforms shared by all variants
        shader.uniforms.uTime = shader.uniforms.uTime || { value: 0.0 };
        shader.uniforms.uEpicenter = shader.uniforms.uEpicenter || { value: new THREE.Vector3() };
        shader.uniforms.uAmp = shader.uniforms.uAmp || { value: 8.0 };
        shader.uniforms.uK = shader.uniforms.uK || { value: 0.02 };
        shader.uniforms.uSpeed = shader.uniforms.uSpeed || { value: 3.0 };

        const injectCommon = `
      uniform float uTime;
      uniform vec3  uEpicenter;
      uniform float uAmp;
      uniform float uK;
      uniform float uSpeed;
    `;

        let patched = false;

        // --- Mesh path: displace along normal ---
        if (baseMat.isMeshBasicMaterial || baseMat.isMeshPhongMaterial || baseMat.isMeshStandardMaterial) {
            shader.vertexShader =
                injectCommon +
                shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    `
          #include <begin_vertex>
          vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
          float d = length(wp - uEpicenter);
          float phase = d * uK - uTime * uSpeed;
          float h = uAmp * sin(phase);
          transformed += normalize(normal) * h;
          `
                );
            patched = true;
        }

        // --- LineBasicMaterial path: modify 'transformed' before projection ---
        if (!patched && baseMat.isLineBasicMaterial === true) {
            if (shader.vertexShader.includes('#include <begin_vertex>')) {
                shader.vertexShader =
                    injectCommon +
                    shader.vertexShader.replace(
                        '#include <begin_vertex>',
                        `
            #include <begin_vertex>
            vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
            float d = length(wp - uEpicenter);
            float phase = d * uK - uTime * uSpeed;
            transformed.z += uAmp * sin(phase);
            `
                    );
                patched = true;
            }
        }

        // --- LineMaterial (Line2) path: patch instance endpoints ---
        if (!patched && baseMat.isLineMaterial === true) {
            const needleStart = 'vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );';
            const needleEnd = 'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );';
            if (shader.vertexShader.includes(needleStart) && shader.vertexShader.includes(needleEnd)) {
                shader.vertexShader =
                    injectCommon +
                    shader.vertexShader
                        .replace(
                            needleStart,
                            `
              vec3 wpStart = (modelMatrix * vec4( instanceStart, 1.0 )).xyz;
              float dStart = length(wpStart - uEpicenter);
              float phaseStart = dStart * uK - uTime * uSpeed;
              float hStart = uAmp * sin(phaseStart);
              vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
              start.z += hStart;
              `
                        )
                        .replace(
                            needleEnd,
                            `
              vec3 wpEnd = (modelMatrix * vec4( instanceEnd, 1.0 )).xyz;
              float dEnd = length(wpEnd - uEpicenter);
              float phaseEnd = dEnd * uK - uTime * uSpeed;
              float hEnd = uAmp * sin(phaseEnd);
              vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );
              end.z += hEnd;
              `
                        );
                patched = true;
            }
        }

        if (!patched) {
            console.warn('Ripple: material not patched; type=', baseMat.type);
        }

        mat.userData.shader = shader;
    };

    return mat;
}

function enableRippleShaderLive(view, layer, makeRippleMaterial, params = {}) {
    let time = 0;
    let logged = false;
    const uniforms = {
        amp: params.amp ?? 25.0, // big to see motion
        k: params.k ?? 0.02,
        speed: params.speed ?? 3.0,
    };

    view.addFrameRequester(itowns.MAIN_LOOP_EVENTS.BEFORE_RENDER, (dt = 16.7) => {
        time += dt * 0.001;

        let patchedCount = 0;

        layer.object3d.traverse((obj) => {
            const isRenderable = obj.isMesh || obj.isLine;
            if (!isRenderable || !obj.material) return;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (let i = 0; i < mats.length; i++) {
                const m = mats[i];
                if (!m.userData?.ripplePatched) {
                    const nm = makeRippleMaterial(m);
                    // ---- ensure color REPLACEMENT for new tiles ----
                    if (nm.isLineBasicMaterial || nm.isLineMaterial || nm.isMeshBasicMaterial || nm.isMeshStandardMaterial || nm.isMeshPhongMaterial) {
                        nm.vertexColors = false;                    // stop vertex color multiply
                        nm.color.copy(Ripple.color);           // start with current selected color
                        nm.needsUpdate = true;                      // drop USE_COLOR define if any
                    }
                    // ------------------------------------------------

                    nm.userData = nm.userData || {};
                    nm.userData.ripplePatched = true;
                    mats[i] = nm;
                    patchedCount++;
                }
            }
            obj.material = Array.isArray(obj.material) ? mats : mats[0];
        });

        if (patchedCount && !logged) {
            console.log('Ripple: patched materials this frame =', patchedCount);
            logged = true;
        }

        layer.object3d.traverse((obj) => {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const m of mats) {
                const s = m?.userData?.shader;
                if (!s?.uniforms) continue;
                if (s.uniforms.uTime) s.uniforms.uTime.value = time;
                if (s.uniforms.uEpicenter) s.uniforms.uEpicenter.value.copy(Ripple.epicenter);
                if (s.uniforms.uAmp) s.uniforms.uAmp.value = uniforms.amp;
                if (s.uniforms.uK) s.uniforms.uK.value = uniforms.k;
                if (s.uniforms.uSpeed) s.uniforms.uSpeed.value = uniforms.speed;
            }
        });

        view.notifyChange(layer);
    });

    return {
        setParams(next) { Object.assign(uniforms, next); },
    };
}

function recenterEpicenterToScreen(view) {
    const w = view.mainLoop.gfxEngine.width;
    const h = view.mainLoop.gfxEngine.height;
    const screen = new THREE.Vector2(w * 0.5, h * 0.5);
    const p = view.getPickingPositionFromDepth(screen);
    if (p) setRippleEpicenterWorld(p);
}

function applyRippleColor(layer, hex) {
    const col = new THREE.Color(hex);
    Ripple.color.copy(col);
    let changed = false;
    layer.object3d.traverse(o => {
        if (!o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
            if (m.color) { m.color.copy(col); changed = true; }
        }
    });
    if (changed) layer.viewer?.notifyChange(layer); // or view.notifyChange(layer);
}

function createRippleWidget(view, layer, ctl, initial = { amp: 8, speed: 3, k: 0.02, color: '#ff0000' }) {
    // container
    const panel = document.createElement('div');
    panel.id = 'widgets-ripple';
    panel.className = 'top-widget right-widget';
    panel.style.position = 'absolute';
    panel.style.zIndex = 20;
    panel.style.right = '10px';
    panel.style.top = '10px';
    panel.style.background = '#313336bb';
    panel.style.border = '1px solid #222';
    panel.style.borderRadius = '7px';
    panel.style.padding = '8px 10px';
    panel.style.color = '#fff';
    panel.style.font = '13px/1.2 Arial, sans-serif';
    panel.style.minWidth = '220px';

    panel.innerHTML = `
    <div style="font-weight:700; margin-bottom:6px;">Ripple</div>
    <label>Amplitude (m)<input id="rip-amp" type="range" min="0" max="50" step="0.1" value="${initial.amp}" /></label>
    <div id="rip-amp-v" style="opacity:.8;margin-bottom:6px;">${initial.amp}</div>

    <label>Speed<input id="rip-speed" type="range" min="0" max="10" step="0.1" value="${initial.speed}" /></label>
    <div id="rip-speed-v" style="opacity:.8;margin-bottom:6px;">${initial.speed}</div>

    <label>k (2π/λ)<input id="rip-k" type="range" min="0.001" max="0.2" step="0.001" value="${initial.k}"/></label>
    <div id="rip-k-v" style="opacity:.8;margin-bottom:6px;">${initial.k}</div>

    <label>Color <input id="rip-color" type="color" value="${initial.color}" style="width:100%;height:28px;border:none;background:transparent;padding:0;"/></label>

    <div style="display:flex; gap:6px; margin-top:8px;">
      <button id="rip-center" style="flex:1;background:#313336bb;border:1px solid #222;border-radius:6px;color:#fff;height:28px;">Center here</button>
      <button id="rip-follow" style="flex:1;background:#313336bb;border:1px solid #222;border-radius:6px;color:#fff;height:28px;">Follow cam</button>
    </div>
  `;

    document.body.appendChild(panel);

    const amp = panel.querySelector('#rip-amp');
    const speed = panel.querySelector('#rip-speed');
    const k = panel.querySelector('#rip-k');
    const color = panel.querySelector('#rip-color');
    const ampV = panel.querySelector('#rip-amp-v');
    const speedV = panel.querySelector('#rip-speed-v');
    const kV = panel.querySelector('#rip-k-v');
    const btnCenter = panel.querySelector('#rip-center');
    const btnFollow = panel.querySelector('#rip-follow');

    // init
    ctl.setParams({ amp: +amp.value, speed: +speed.value, k: +k.value });
    applyRippleColor(layer, color.value);

    // handlers
    amp.oninput = () => { ampV.textContent = amp.value; ctl.setParams({ amp: +amp.value }); };
    speed.oninput = () => { speedV.textContent = speed.value; ctl.setParams({ speed: +speed.value }); };
    k.oninput = () => { kV.textContent = k.value; ctl.setParams({ k: +k.value }); };
    color.oninput = () => applyRippleColor(layer, color.value);

    btnCenter.onclick = () => { recenterEpicenterToScreen(view); };

    // follow camera = continuously recenters at screen center
    let follow = false;
    let followReq = null;
    btnFollow.onclick = () => {
        follow = !follow;
        btnFollow.style.background = follow ? '#222' : '#313336bb';
        if (follow && !followReq) {
            followReq = (dt) => { recenterEpicenterToScreen(view); };
            view.addFrameRequester(itowns.MAIN_LOOP_EVENTS.BEFORE_RENDER, followReq);
        } else if (!follow && followReq) {
            view.removeFrameRequester(itowns.MAIN_LOOP_EVENTS.BEFORE_RENDER, followReq);
            followReq = null;
        }
    };

    return panel;
}



view.addLayer(roadsLayer).then(() => {
    console.log('BDTOPO_Roads layer added');

    // timeout
    setTimeout(() => {
        const roadsCtl = enableRippleShaderLive(view, roadsLayer, makeRippleMaterial, {
            amp: 20.0, k: 0.02, speed: 3.0,
        });

        setEpicenterFromScreenCenter(view);  // initial center = where you look
        bindEpicenterPicking(viewerDiv, view); // clicks move epicenter
        roadsLayer.object3d.traverse(o => {
            if (o.isLine && o.material?.userData?.shader) {
                console.log(o.material.userData.shader.uniforms);
                return true; // stop after first
            }
        });
        createRippleWidget(view, roadsLayer, roadsCtl, {
            amp: 8, speed: 3, k: 0.02, color: '#ff0000',
        });
        // const bldgCtl = enableRippleShaderLive(view, buildingsLayer, makeRippleMaterial);
        // enableRippleShaderLive(view, roadsLayer, makeRippleMaterial);
    }, 1000);

    // enable ripple effect on roads layer
});