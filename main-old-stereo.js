import * as itowns from 'itowns';

import * as THREE from 'three';

import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

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

// a list of "nature" codes for motorways, primary roads, etc.
let roadNatures = [];

// BDTopo-ish palette for 'nature'
const ROAD_COLOR = {
    'Type autoroutier': '#2E86FF', // motorway blue
    'Route à 2 chaussées': '#FF4D4D', // dual carriage red
    'Route à 1 chaussée': '#FFC400', // primary yellow
    'Bretelle': '#00C8FF', // ramp cyan
    'Rond-point': '#BBBBBB', // roundabout grey
    'Chemin': '#f6ff75', // track purple
    'Route empierrée': '#FF9100', // gravel orange
    'Sentier': '#00E676', // path green
    'Escalier': '#FFFFFF', // stairs white
};

// Optional per-type widths (tweak to taste)
const ROAD_WIDTH = {
    'Type autoroutier': 70,
    'Route à 2 chaussées': 60,
    'Route à 1 chaussée': 50,
    'Bretelle': 45,
    'Rond-point': 50,
    'Chemin': 30,
    'Route empierrée': 30,
    'Sentier': 20,
    'Escalier': 12,
};

const ROAD_WIDTH_M = {
    'Type autoroutier': 20,
    'Route à 2 chaussées': 14,
    'Route à 1 chaussée': 10,
    'Bretelle': 8,
    'Rond-point': 12,
    'Chemin': 5,
    'Route empierrée': 5,
    'Sentier': 3,
    'Escalier': 2,
};

const roadsLayer = new itowns.FeatureGeometryLayer('BDTOPO_Roads', {
    source: roadsSource,
    zoom: { min: 11 },
    style: {
        stroke: {
            // color per feature nature
            color: (props) => ROAD_COLOR[props.nature] ?? 0xff00ff,   // fallback magenta
            // width per feature nature (world meters)
            // width: (props) => ROAD_WIDTH[props.nature] ?? 40,
            // optional: per-type opacity (or return 1)
            opacity: () => 1.0,
            base_altitude: (props, ctx) => {
                if (!read_once) {
                    console.log('Roads properties example:', props);
                    read_once = true;
                }
                // add the nature property to the list if not present
                if (props.nature && !roadNatures.includes(props.nature)) {
                    roadNatures.push(props.nature);
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

// // ---------- 1) High-contrast defaults (road-map style) ----------
// const ROAD_DEFAULTS = {
//   colors: {
//     'Type autoroutier':    '#2E86FF', // motorway blue
//     'Route à 2 chaussées': '#FF4D4D', // dual carriage red
//     'Route à 1 chaussée':  '#FFC400', // primary yellow
//     'Bretelle':            '#00C8FF', // ramp cyan
//     'Rond-point':          '#BBBBBB', // roundabout grey
//     'Chemin':              '#8E44AD', // track purple
//     'Route empierrée':     '#FF9100', // gravel orange
//     'Sentier':             '#00E676', // path green
//     'Escalier':            '#FFFFFF', // stairs white
//   },
//   widths: {
//     'Type autoroutier':    70,
//     'Route à 2 chaussées': 60,
//     'Route à 1 chaussée':  50,
//     'Bretelle':            45,
//     'Rond-point':          50,
//     'Chemin':              28,
//     'Route empierrée':     30,
//     'Sentier':             20,
//     'Escalier':            12,
//   },
//   halo: {
//     enabled: true,
//     color:   '#000000',
//     extra:   10,      // meters wider than road
//     opacity: 0.85,
//     zOffset: -0.5,    // meters under the road to avoid z-fighting
//   },
// };

// // Live-editable state
// const RoadStyleState = JSON.parse(JSON.stringify(ROAD_DEFAULTS));
// const hexToInt = h => Number('0x' + h.replace('#',''));

// // ---------- 2) Build layers from state ----------
// let roadsLayer = null;
// let roadsHaloLayer = null;

// function buildRoadLayer({ halo = false } = {}) {
//   return new itowns.FeatureGeometryLayer(halo ? 'BDTOPO_RoadsHalo' : 'BDTOPO_Roads', {
//     source: roadsSource,
//     zoom: { min: 11 },
//     style: {
//       stroke: {
//         color: (p) => {
//           if (halo) return hexToInt(RoadStyleState.halo.color);
//           const c = RoadStyleState.colors[p.nature] ?? '#FF00FF';
//           return hexToInt(c);
//         },
//         width: (p) => {
//           const w = RoadStyleState.widths[p.nature] ?? 40;
//           return halo ? (w + RoadStyleState.halo.extra) : w;
//         },
//         opacity: (p) => halo ? RoadStyleState.halo.opacity : 1.0,
//         base_altitude: (props, ctx) => {
//           const c = Array.isArray(ctx.coordinates) ? ctx.coordinates[0] : ctx.coordinates;
//           const z = (c && typeof c.z === 'number') ? c.z : 0;
//           return z + (halo ? (5 + RoadStyleState.halo.zOffset) : 5);
//         },
//       },
//     },
//   });
// }

// async function replaceRoadLayers(view, sphereCtl) {
//   // remove existing if any
//   if (roadsLayer)     view.removeLayer(roadsLayer.id);
//   if (roadsHaloLayer) view.removeLayer(roadsHaloLayer.id);

//   // build fresh
//   if (RoadStyleState.halo.enabled) {
//     roadsHaloLayer = buildRoadLayer({ halo: true });
//     await view.addLayer(roadsHaloLayer);
//     enableStereoProjectLive(view, roadsHaloLayer, sphereCtl);
//   } else {
//     roadsHaloLayer = null;
//   }

//   roadsLayer = buildRoadLayer({ halo: false });
//   await view.addLayer(roadsLayer);
//   enableStereoProjectLive(view, roadsLayer, sphereCtl);

//   view.notifyChange(true);
// }

// // ---------- 3) UI panel to edit colors/widths + halo ----------
// function createRoadStyleWidget(view, sphereCtl) {
//   const box = document.createElement('div');
//   Object.assign(box.style, {
//     position:'absolute', right:'10px', top:'300px', zIndex:20,
//     background:'#313336bb', border:'1px solid #222', borderRadius:'7px',
//     padding:'8px 10px', color:'#fff', font:'13px/1.2 Arial, sans-serif', minWidth:'260px',
//     maxHeight:'50vh', overflow:'auto'
//   });
//   const cats = Object.keys(RoadStyleState.colors);

//   const rows = cats.map(nature => `
//     <div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
//       <div style="flex:1;">${nature}</div>
//       <input data-k="${nature}" class="rd-col" type="color" value="${RoadStyleState.colors[nature]}" style="width:36px;height:24px;border:none;background:transparent;padding:0;">
//       <input data-k="${nature}" class="rd-w" type="number" min="1" max="200" step="1" value="${RoadStyleState.widths[nature] ?? 40}" style="width:70px;">
//     </div>
//   `).join('');

//   box.innerHTML = `
//     <div style="font-weight:700;margin-bottom:6px;">Road style</div>
//     <div style="opacity:.9;margin-bottom:6px;">Colors + widths (meters)</div>
//     ${rows}
//     <hr style="border:none;border-top:1px solid #444;margin:8px 0;">
//     <div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
//       <label style="flex:1;">Halo</label>
//       <input id="rd-halo-enabled" type="checkbox" ${RoadStyleState.halo.enabled ? 'checked':''}>
//     </div>
//     <div style="display:grid;grid-template-columns:auto 1fr;gap:8px;align-items:center;">
//       <label>Halo color</label><input id="rd-halo-color" type="color" value="${RoadStyleState.halo.color}" style="width:36px;height:24px;border:none;background:transparent;padding:0;">
//       <label>Halo +width</label><input id="rd-halo-extra" type="number" min="0" max="100" step="1" value="${RoadStyleState.halo.extra}">
//       <label>Halo opacity</label><input id="rd-halo-op" type="number" min="0" max="1" step="0.05" value="${RoadStyleState.halo.opacity}">
//     </div>
//     <div style="display:flex;gap:8px;margin-top:10px;">
//       <button id="rd-apply"  style="flex:1;background:#2d6cdf;border:1px solid #222;border-radius:6px;color:#fff;height:30px;">Apply</button>
//       <button id="rd-reset"  style="flex:1;background:#313336bb;border:1px solid #222;border-radius:6px;color:#fff;height:30px;">Reset</button>
//     </div>
//   `;
//   document.body.appendChild(box);

//   // handlers
//   box.querySelectorAll('.rd-col').forEach(inp => {
//     inp.oninput = () => { RoadStyleState.colors[inp.dataset.k] = inp.value; };
//   });
//   box.querySelectorAll('.rd-w').forEach(inp => {
//     inp.oninput = () => { RoadStyleState.widths[inp.dataset.k] = +inp.value; };
//   });
//   const haloEnabled = box.querySelector('#rd-halo-enabled');
//   const haloColor   = box.querySelector('#rd-halo-color');
//   const haloExtra   = box.querySelector('#rd-halo-extra');
//   const haloOp      = box.querySelector('#rd-halo-op');

//   haloEnabled.onchange = () => { RoadStyleState.halo.enabled = haloEnabled.checked; };
//   haloColor.oninput    = () => { RoadStyleState.halo.color   = haloColor.value; };
//   haloExtra.oninput    = () => { RoadStyleState.halo.extra   = +haloExtra.value; };
//   haloOp.oninput       = () => { RoadStyleState.halo.opacity = Math.max(0, Math.min(1, +haloOp.value)); };

//   box.querySelector('#rd-apply').onclick = () => replaceRoadLayers(view, sphereCtl);
//   box.querySelector('#rd-reset').onclick = () => {
//     Object.assign(RoadStyleState, JSON.parse(JSON.stringify(ROAD_DEFAULTS)));
//     document.body.removeChild(box);
//     createRoadStyleWidget(view, sphereCtl);
//     replaceRoadLayers(view, sphereCtl);
//   };
// }

// // ---------- 4) Create UI and layers once your view/source/sphereCtl are ready ----------
// await replaceRoadLayers(view, sphereCtl);          // build with defaults
// createRoadStyleWidget(view, sphereCtl);            // show the panel


view.addLayer(elevationLayer).then(() => {
    console.log('Elevation layer added');
    view.notifyChange(true);
});

view.addLayer(orthoLayer).then(() => {
    console.log('Ortho layer added');
    view.notifyChange(true);
});


// --- Sphere controller built on your working pattern ---
function makeSphereController(view, {
    radius = 1000,      // meters
    offset01 = 0.0,     // 0=tangent, 1=half-cut
    opacity = 0.15,     // 0..1
    color = 0xff0000,   // red, same as your example
} = {}) {
    const T = THREE;

    const geom = new T.SphereGeometry(1, 32, 16); // unit sphere (scale -> meters)
    const mat = new T.MeshBasicMaterial({
        color, transparent: true, opacity,
        depthWrite: false,
        side: T.DoubleSide,
    });
    const mesh = new T.Mesh(geom, mat);
    mesh.renderOrder = 20;

    view.scene.add(mesh);

    const state = {
        groundECEF: new T.Vector3(),
        hasGround: false,
        radius, offset01,
    };

    function updateTransform() {
        if (!state.hasGround) return;

        // ECEF outward normal from ground point:
        const n = state.groundECEF.clone().normalize();

        // offset mapping: 0 -> tangent (center = ground + R*n), 1 -> half-cut (center = ground)
        const lift = state.radius * (1.0 - state.offset01);
        const center = state.groundECEF.clone().addScaledVector(n, lift);

        mesh.position.copy(center);
        mesh.scale.setScalar(state.radius);

        // keep your original orientation trick (not needed for sphere, but harmless)
        mesh.lookAt(new T.Vector3(0, 0, 0));
        mesh.rotateX(Math.PI / 2);

        view.notifyChange(true);
    }

    return {
        mesh,
        setGroundFromWorld(vec3) { state.groundECEF.copy(vec3); state.hasGround = true; updateTransform(); },
        setRadius(m) { state.radius = Math.max(0, +m); updateTransform(); },
        setOffset01(t) { state.offset01 = Math.min(1, Math.max(0, +t)); updateTransform(); },
        setOpacity(a) { mat.opacity = Math.min(1, Math.max(0, +a)); view.notifyChange(true); },
        setColor(hex) { mat.color.set(hex); view.notifyChange(true); },
    };
}

// --- Initial placement: use current look-at ground point (your pattern) ---
function initSphereAtLookAt(view, sphereCtl) {
    const c = view.controls.getLookAtCoordinate();     // lon/lat/(alt)
    // In your working code, you nudged altitude; here we use the ground itself.
    const groundECEF = c.as(view.referenceCrs);        // -> EPSG:4978
    sphereCtl.setGroundFromWorld(new THREE.Vector3(groundECEF.x, groundECEF.y, groundECEF.z));
}

// --- Click-to-place: hold 'S' while clicking the globe ---
function bindSpherePicking(viewerDiv, view, sphereCtl, toggleKey = 's') {
    let pick = false;
    viewerDiv.addEventListener('keydown', e => { if (e.key === toggleKey) pick = true; });
    viewerDiv.addEventListener('keyup', e => { if (e.key === toggleKey) pick = false; });
    viewerDiv.addEventListener('click', (e) => {
        if (!pick) return;

        // print the list of road "nature" codes
        console.log('Road nature codes in view:', roadNatures);
        const p = view.getPickingPositionFromDepth(view.eventToViewCoords(e)); // ECEF world vec3
        if (p) sphereCtl.setGroundFromWorld(p);
    });
}

// --- Tiny UI panel (radius, offset, opacity) ---
function createSphereWidget(view, sphereCtl, init = { radius: 1000, offset01: 0.0, opacity: 0.35 }) {
    const box = document.createElement('div');
    Object.assign(box.style, {
        position: 'absolute', left: '10px', top: '10px', zIndex: 20,
        background: '#313336bb', border: '1px solid #222', borderRadius: '7px',
        padding: '8px 10px', color: '#fff', font: '13px/1.2 Arial, sans-serif', minWidth: '220px'
    });
    box.innerHTML = `
    <div style="font-weight:700;margin-bottom:6px;">Sphere</div>
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

    const r = box.querySelector('#sp-r'), o = box.querySelector('#sp-o'), a = box.querySelector('#sp-a');
    const rv = box.querySelector('#sp-rv'), ov = box.querySelector('#sp-ov'), av = box.querySelector('#sp-av');
    const bCenter = box.querySelector('#sp-center'), bPick = box.querySelector('#sp-pick');

    // init sphere to current slider values
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

    // small visual for pick mode
    let picking = false;
    const setBtn = (on) => bPick.style.background = on ? '#222' : '#313336bb';
    viewerDiv.addEventListener('keydown', e => { if (e.key === 's') { picking = true; setBtn(true); } });
    viewerDiv.addEventListener('keyup', e => { if (e.key === 's') { picking = false; setBtn(false); } });

    return box;
}

const PATCH_FAT_LINES = true; // TEMP: prove fat lines render


// Use the same state object you already have for ripple if you want.
// Here we read the sphere parameters from your existing sphereCtl each frame.
function makeStereoProjectMaterial(baseMat) {
    const mat = baseMat.clone();
    mat.depthWrite = false;
    mat.transparent = true;

    mat.onBeforeCompile = (shader) => {

        if (baseMat.isLineMaterial && !PATCH_FAT_LINES) {
            // still store shader ref so uniforms loop doesn't crash
            mat.userData.shader = shader;
            return;
        }
        // uniforms
        shader.uniforms.uSphereCenter = shader.uniforms.uSphereCenter || { value: new THREE.Vector3() };
        shader.uniforms.uSphereR = shader.uniforms.uSphereR || { value: 1.0 };

        // helper GLSL: basis from "up", Unity TerrainToSphere port, project-if-outside
        const inject = /* glsl */`
      uniform vec3  uSphereCenter;
      uniform float uSphereR;

      // build an orthonormal basis where +Y is the sphere "top" (up = normalized center in ECEF)
      mat3 basisFromUp(vec3 up) {
        vec3 n = normalize(up);
        vec3 a = (abs(n.y) < 0.99) ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
        vec3 x = normalize(cross(a, n));
        vec3 z = cross(n, x);
        // columns: x,y,z; so M * local = world ; and transpose(M) * world = local
        return mat3(x, n, z);
      }

      // Unity's TerrainToSphere() port (expects radius=0.5 sphere in local Y-up space)
      vec3 terrainToSphere(vec3 s) {
        float h_inv = 0.5 - s.y;
        float hh    = h_inv * h_inv;
        float ss    = s.x * s.x;
        float tt    = s.z * s.z;
        float lower = hh - 2.0 * h_inv + ss + tt + 1.0;
        float x = ((1.0 - h_inv) * s.x) / lower;
        float y = 0.5 - (ss + tt) / lower;
        float z = ((1.0 - h_inv) * s.z) / lower;
        return vec3(x, y, z);
      }

      // project a world pos onto the sphere if it's outside; else return unchanged
      vec3 inverseStereoProject(vec3 worldPos) {
        float R = max(uSphereR, 1e-3);
        vec3  C = uSphereCenter;

        float d = distance(worldPos, C);
        if (d <= R) return worldPos; // inside: unchanged

        // local coords where +Y is pole direction
        mat3 B = basisFromUp(C);
        // sgBlockOne = (center - position) / (2R), in local space with Y-up
        vec3 s = transpose(B) * ((C - worldPos) / (2.0 * R));
        // map to unit sphere (radius 0.5)
        vec3 q = terrainToSphere(s);
        // back to world: center - q * (2R), undoing the earlier sign
        vec3 w = C - (B * (q * (2.0 * R)));
        return w;
      }
    `;

        let patched = false;

        // --- Mesh path (kept for completeness; mainly we target lines) ---
        if (baseMat.isMeshBasicMaterial || baseMat.isMeshPhongMaterial || baseMat.isMeshStandardMaterial) {
            shader.vertexShader =
                inject +
                shader.vertexShader.replace(
                    '#include <project_vertex>',
                    `
          // world pos from model
          vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vec3 p  = inverseStereoProject(wp);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          `
                );
            patched = true;
        }

        // --- LineBasicMaterial path: replace project stage with world-space override ---
        if (!patched && baseMat.isLineBasicMaterial === true) {
            shader.vertexShader =
                inject +
                shader.vertexShader.replace(
                    '#include <project_vertex>',
                    `
          // transformed is in model space; get world
          vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vec3 p  = inverseStereoProject(wp);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          `
                );
            patched = true;
        }

        // --- LineMaterial (Line2) path: patch instance endpoints in world space ---
        // if (!patched && baseMat.isLineMaterial === true) {
        //     const needleStart = 'vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );';
        //     const needleEnd = 'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );';
        //     if (shader.vertexShader.includes(needleStart) && shader.vertexShader.includes(needleEnd)) {
        //         shader.vertexShader =
        //             inject +
        //             shader.vertexShader
        //                 .replace(
        //                     needleStart,
        //                     `
        //       vec3 wpStart = (modelMatrix * vec4( instanceStart, 1.0 )).xyz;
        //       vec3 pStart  = inverseStereoProject(wpStart);
        //       vec4 start   = modelViewMatrix * vec4( pStart, 1.0 );
        //       `
        //                 )
        //                 .replace(
        //                     needleEnd,
        //                     `
        //       vec3 wpEnd = (modelMatrix * vec4( instanceEnd, 1.0 )).xyz;
        //       vec3 pEnd  = inverseStereoProject(wpEnd);
        //       vec4 end   = modelViewMatrix * vec4( pEnd, 1.0 );
        //       `
        //                 );
        //         patched = true;
        //     }
        // }

        if (!patched && baseMat.isLineMaterial === true) {
            const inject = /* glsl */`
    uniform vec3  uSphereCenter;
    uniform float uSphereR;
    mat3 basisFromUp(vec3 up){
      vec3 n = normalize(up);
      vec3 a = (abs(n.y) < 0.99) ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
      vec3 x = normalize(cross(a, n));
      vec3 z = cross(n, x);
      return mat3(x, n, z);
    }
    vec3 terrainToSphere(vec3 s){
      float h_inv = 0.5 - s.y;
      float hh=h_inv*h_inv, ss=s.x*s.x, tt=s.z*s.z;
      float lower = hh - 2.0*h_inv + ss + tt + 1.0;
      return vec3(((1.0-h_inv)*s.x)/lower, 0.5 - (ss+tt)/lower, ((1.0-h_inv)*s.z)/lower);
    }
    vec3 inverseStereoProject(vec3 wp){
      float R = max(uSphereR, 1e-3);
      vec3  C = uSphereCenter;
      float d = distance(wp, C);
      if (d <= R) return wp;
      mat3 B = basisFromUp(C);
      vec3 s = transpose(B) * ((C - wp) / (2.0*R));
      vec3 q = terrainToSphere(s);
      return C - (B * (q * (2.0*R)));
    }
  `;

            // patch BOTH start and end lines, regardless of minor shader wording changes
            const replStart = `
    vec3 wpStart = (modelMatrix * vec4( instanceStart, 1.0 )).xyz;
    vec3 pStart  = inverseStereoProject(wpStart);
    vec4 start   = modelViewMatrix * vec4( pStart, 1.0 );
  `;
            const replEnd = `
    vec3 wpEnd = (modelMatrix * vec4( instanceEnd, 1.0 )).xyz;
    vec3 pEnd  = inverseStereoProject(wpEnd);
    vec4 end   = modelViewMatrix * vec4( pEnd, 1.0 );
  `;

            let vs = shader.vertexShader;
            vs = inject + vs;
            // tolerant regex for both lines
            vs = vs.replace(
                /vec4\s+start\s*=\s*modelViewMatrix\s*\*\s*vec4\s*\(\s*instanceStart\s*,\s*1\.0\s*\)\s*;/,
                replStart
            );
            vs = vs.replace(
                /vec4\s+end\s*=\s*modelViewMatrix\s*\*\s*vec4\s*\(\s*instanceEnd\s*,\s*1\.0\s*\)\s*;/,
                replEnd
            );

            shader.vertexShader = vs;
            patched = true;
        }

        // mat.side = THREE.BackSide;
        // mat.depthTest = true;
        // mat.depthWrite = false;

        if (!patched) console.warn('StereoProj: material not patched', baseMat);
        mat.userData.shader = shader;
    };

    return mat;
}

function enableStereoProjectLiveThin(view, layer, sphereCtl) {
    // ensure later tiles start with your current color (optional)
    const startColor = new THREE.Color();
    // if you have a color UI state, copy it here; else we leave materials as-is.

    view.addFrameRequester(itowns.MAIN_LOOP_EVENTS.BEFORE_RENDER, () => {
        // 1) Patch any new materials
        layer.object3d.traverse((obj) => {
            const isRenderable = obj.isMesh || obj.isLine;
            if (!isRenderable || !obj.material) return;

            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (let i = 0; i < mats.length; i++) {
                const m = mats[i];
                if (m.userData?.stereoPatched) continue;

                const nm = makeStereoProjectMaterial(m);
                // optional: force color replacement for lines if you used vertex colors earlier
                if (nm.isLineBasicMaterial || nm.isLineMaterial) {
                    // nm.vertexColors = false; nm.color.copy(startColor); nm.needsUpdate = true;
                }
                nm.userData = nm.userData || {};
                nm.userData.stereoPatched = true;
                mats[i] = nm;
            }
            obj.material = Array.isArray(obj.material) ? mats : mats[0];
        });

        // 2) Push sphere uniforms to all patched materials
        const center = sphereCtl.mesh.position;        // ECEF center
        const R = sphereCtl.mesh.scale.x;         // our sphere scales uniformly: radius in meters

        layer.object3d.traverse((obj) => {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const m of mats) {
                const s = m?.userData?.shader;
                if (!s?.uniforms) continue;
                if (s.uniforms.uSphereCenter) s.uniforms.uSphereCenter.value.copy(center);
                if (s.uniforms.uSphereR) s.uniforms.uSphereR.value = R;
            }
        });

        view.notifyChange(layer);
    });
}

function getMaterials(obj) {
    const m = obj.material;
    if (!m) return [];                         // no material → nothing to do
    return Array.isArray(m) ? m : [m];
}

function patchStereoMaterial(m) {
    if (!m || !m.isMaterial) return null;      // guard
    if (m.userData && m.userData.stereoPatched) return m;

    const nm = makeStereoProjectMaterial(m);
    nm.userData = nm.userData || {};
    nm.userData.stereoPatched = true;
    return nm;
}


function eachMaterial(o, cb) {
    const m = o.material;
    if (!m) return;
    if (Array.isArray(m)) for (const x of m) if (x && x.isMaterial) cb(x);
    else if (m.isMaterial) cb(m);
}
function enableStereoProjectLive(view, layer, sphereCtl) {
    const renderer = view.mainLoop.gfxEngine.renderer;
    const size = new THREE.Vector2();

    view.addFrameRequester(itowns.MAIN_LOOP_EVENTS.BEFORE_RENDER, () => {
        layer.object3d.traverse(o => {
            const thin = (o.isLine || o.isLineSegments) && o.material?.isLineBasicMaterial;
            if (thin) upgradeToFatLine(o, renderer);
        });

        const center = sphereCtl.mesh.position;
        const R = sphereCtl.mesh.scale.x;
        const sz = new THREE.Vector2(); renderer.getSize(sz);

        layer.object3d.traverse(o => {
            const m = o.material;
            if (!m) return;
            const mats = Array.isArray(m) ? m : [m];
            for (const mm of mats) {
                const s = mm.userData?.shader;
                if (s?.uniforms?.uSphereCenter) s.uniforms.uSphereCenter.value.copy(center);
                if (s?.uniforms?.uSphereR) s.uniforms.uSphereR.value = R;
                if (mm.isLineMaterial && mm.resolution) mm.resolution.set(sz.x, sz.y);
            }
        });

        view.notifyChange(layer);
    });

    // also on resize
    window.addEventListener('resize', () => {
        renderer.getSize(size);
        layer.object3d.traverse(o => {
            eachMaterial(o, (m) => {
                if (m.isLineMaterial && m.resolution) m.resolution.set(size.x, size.y);
            });
        });
        view.notifyChange(layer);
    });
}

function finite3(a, b, c) { return Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c); }

function buildPairsFromIndexed(g) {
    const pos = g.attributes.position.array;
    const idx = g.index.array;
    const out = [];
    for (let i = 0; i + 1 < idx.length; i += 2) {
        const i0 = idx[i] * 3, i1 = idx[i + 1] * 3;
        const x0 = pos[i0], y0 = pos[i0 + 1], z0 = pos[i0 + 2];
        const x1 = pos[i1], y1 = pos[i1 + 1], z1 = pos[i1 + 2];
        if (finite3(x0, y0, z0) && finite3(x1, y1, z1)) out.push(x0, y0, z0, x1, y1, z1);
    }
    return out;
}

function buildPairsFromNonIndexedPositions(pos) {
    const out = [];
    for (let i = 0; i + 5 < pos.length; i += 3) {
        const x0 = pos[i], y0 = pos[i + 1], z0 = pos[i + 2];
        const x1 = pos[i + 3], y1 = pos[i + 4], z1 = pos[i + 5];
        if (finite3(x0, y0, z0) && finite3(x1, y1, z1)) out.push(x0, y0, z0, x1, y1, z1);
    }
    return out;
}


function buildPolylineFromIndexed(g) {
    const pos = g.attributes.position.array;
    const idx = g.index.array;
    const out = [];
    for (let i = 0; i < idx.length; i++) {
        const k = idx[i] * 3;
        const x = pos[k], y = pos[k + 1], z = pos[k + 2];
        if (finite3(x, y, z)) out.push(x, y, z);
    }
    return out;
}

function getFeatureProps(o) {
    let n = o;
    for (let i = 0; i < 5 && n; i++, n = n.parent) {
        const p = n.userData?.feature?.properties || n.userData?.properties;
        if (p) return p;
    }
    return undefined;
}

function upgradeToFatLine(obj, renderer) {
    if (obj.userData?.__fat) return obj;
    const g = obj.geometry, oldMat = obj.material;
    if (!g || !oldMat || !g.getAttribute) return null;
    const posAttr = g.getAttribute('position');
    if (!posAttr) return null;

    // make LineMaterial in meters
    const mat = new LineMaterial({
        worldUnits: true,
        transparent: oldMat.transparent ?? true,
        opacity: oldMat.opacity ?? 1,
        depthTest: oldMat.depthTest ?? true,
        depthWrite: false,
        color: 0xffffff, // will be overwritten by nature color below
    });
    const sz = new THREE.Vector2(); renderer.getSize(sz);
    mat.resolution.set(sz.x, sz.y);

    // geometry
    let fat, lg;
    if (obj.isLineSegments) {
        const pairs = g.index ? buildPairsFromIndexed(g) : buildPairsFromNonIndexedPositions(posAttr.array);
        if (pairs.length === 0 || (pairs.length % 6) !== 0) return null;
        lg = new LineSegmentsGeometry(); lg.setPositions(pairs);
        fat = new LineSegments2(lg, mat);
    } else if (obj.isLine) {
        const poly = g.index ? buildPolylineFromIndexed(g)
            : Array.from(posAttr.array).filter(Number.isFinite);
        if (poly.length < 6) return null;
        lg = new LineGeometry(); lg.setPositions(poly);
        fat = new Line2(lg, mat);
    } else {
        return null;
    }

    // per-feature width & color by BDTopo nature
    // per-feature width & color
    const props = getFeatureProps(obj);
    const nature = props?.nature;
    mat.linewidth = (typeof ROAD_WIDTH_M !== 'undefined') ? (ROAD_WIDTH_M[nature] ?? 6) : 6;
    const hex = (typeof ROAD_COLOR !== 'undefined') ? (ROAD_COLOR[nature] ?? 0xffffff)
        : (oldMat.color ? oldMat.color.getHex() : 0xffffff);

    mat.color.setHex(hex);

    // patch NOW for stereographic (so we don't depend on later pass)
    const patched = makeStereoProjectMaterial(mat);
    patched.userData = patched.userData || {};
    patched.userData.stereoPatched = true;

    fat.material = patched;

    // ----- PRESERVE TRANSFORM & METADATA -----
    // many iTowns nodes have matrixAutoUpdate=false and a baked matrix
    fat.matrixAutoUpdate = obj.matrixAutoUpdate;
    fat.matrix.copy(obj.matrix);
    fat.matrixWorld.copy(obj.matrixWorld);
    fat.matrixWorldNeedsUpdate = true;

    // also copy TRS in case upstream uses them
    fat.position.copy(obj.position);
    fat.quaternion.copy(obj.quaternion);
    fat.scale.copy(obj.scale);

    // preserve visibility, layers, names, event hooks, and iTowns pointers
    fat.visible = obj.visible;
    fat.layers.mask = obj.layers.mask;
    fat.name = obj.name;
    fat.onBeforeRender = obj.onBeforeRender;   // keep any per-tile hook
    fat.layer = obj.layer;                     // iTowns expects this
    // keep feature reference for later lookups
    if (obj.userData?.feature) fat.userData.feature = obj.userData.feature;
    fat.userData.__fat = true;

    fat.frustumCulled = false;                 // avoid accidental cull
    fat.renderOrder = (obj.renderOrder ?? 0) + 1;

    // replace in scene
    const parent = obj.parent;
    if (parent) {
        parent.add(fat);
        parent.remove(obj);
    }

    // force matrices to propagate
    fat.updateMatrix();
    fat.updateMatrixWorld(true);

    // cleanup
    g.dispose();
    if (oldMat.dispose) oldMat.dispose();

    // debug once
    // console.log('fat:', {nature, color: mat.color.getHexString(), lineWidth: mat.linewidth}, fat);

    console.log('fat:', { nature, lineWidth: mat.linewidth, color: mat.color.getHexString() }, fat);

    return fat;
}

// --- Wire it exactly like your working code: on GLOBE_INITIALIZED ---
view.addEventListener(itowns.GLOBE_VIEW_EVENTS.GLOBE_INITIALIZED, () => {
    console.info('Globe initialized');

    // create controller (matches your defaults closely)
    const sphereCtl = makeSphereController(view, {
        radius: 1000,
        offset01: 1.0,     // = half-cut by default (like your bisected sphere)
        opacity: 0.54,
        color: 0xff0000,
    });

    // initial placement at the current look-at point
    initSphereAtLookAt(view, sphereCtl);

    // S + click to re-place
    const viewerDiv = document.getElementById('viewerDiv');
    bindSpherePicking(viewerDiv, view, sphereCtl, 's');

    // UI
    createSphereWidget(view, sphereCtl, { radius: 1000, offset01: 1.0, opacity: 0.54 });

    // expose for debugging
    window.sphereCtl = sphereCtl;

    view.addLayer(roadsLayer).then(() => {
        console.log('BDTOPO_Roads layer added');

        // timeout
        setTimeout(() => {
            // const roadsCtl = enableRippleShaderLive(view, roadsLayer, makeRippleMaterial, {
            //     amp: 20.0, k: 0.02, speed: 3.0,
            // });

            enableStereoProjectLive(view, roadsLayer, sphereCtl);

            // setEpicenterFromScreenCenter(view);  // initial center = where you look
            // bindEpicenterPicking(viewerDiv, view); // clicks move epicenter
            // roadsLayer.object3d.traverse(o => {
            //     if (o.isLine && o.material?.userData?.shader) {
            //         console.log(o.material.userData.shader.uniforms);
            //         return true; // stop after first
            //     }
            // });
            // createRippleWidget(view, roadsLayer, roadsCtl, {
            //     amp: 8, speed: 3, k: 0.02, color: '#ff0000',
            // });


            // const bldgCtl = enableRippleShaderLive(view, buildingsLayer, makeRippleMaterial);
            // enableRippleShaderLive(view, roadsLayer, makeRippleMaterial);

        }, 1000);

        // enable ripple effect on roads layer
    });

});


