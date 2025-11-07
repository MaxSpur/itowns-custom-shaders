import * as itowns from 'itowns';
import * as THREE from 'three';

// pull internals directly
import Fetcher from '/node_modules/itowns/lib/Provider/Fetcher.js';
import GeoJSONParser from '/node_modules/itowns/lib/Parser/GeoJSONParser.js';
import Feature2Mesh from '/node_modules/itowns/lib/Converter/Feature2Mesh.js';

const viewerDiv = document.getElementById('viewerDiv');
// Define the camera initial placement
const placement = {
    coord: new itowns.Coordinates('EPSG:4326', 3.1, 48.95),
    range: 5000,
};

const view = new itowns.GlobeView(viewerDiv, placement);
// const placement = { coord: new itowns.Coordinates('EPSG:4326', 2.35, 48.8), range: 25e6 };


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


const floodSource = new itowns.FileSource({
    url: 'https://raw.githubusercontent.com/iTowns/iTowns2-sample-data/master/multipolygon.geojson',
    crs: 'EPSG:4326',
    format: 'application/json',
});

const floodStyle = {
    fill: {
        color: 'cyan',
        opacity: 0.5,
    },
    stroke: {
        color: 'blue',
    },
};

const floodLayer = new itowns.ColorLayer('flood', {
    source: floodSource,
    style: floodStyle,
});

// view.addLayer(floodLayer);

// Now, we create a custom GeometryLayer to apply our ripple shader


// Vector polygons as real geometry
const floodGeomLayer = new itowns.FeatureGeometryLayer('floodGeom', {
    source: floodSource,
    transparent: true,
    opacity: 0.7,
    style: {
        fill: {
            color: 'cyan',
            opacity: 0.5,
            // base_altitude: 55.0,   // small offset above ground
        },
        stroke: {
            color: 'magenta',
            width: 1.0,
        },
    },
});

let draped = false;

// Add layer, then patch its materials
// view.addLayer(floodGeomLayer)

let minR = Infinity;
let maxR = -Infinity;




function attachHeightDebugShader(view, layer) {

    let done = false;
    // 1) Scan geometry to find min/max world radius
    // let minR = Infinity;
    // let maxR = -Infinity;

    view.addFrameRequester(itowns.MAIN_LOOP_EVENTS.BEFORE_RENDER, () => {
        if (done) return;

        let updatedAny = false;
        let missingAny = false;


        layer.object3d.traverse((obj) => {

            if (done) return;
            if (!obj.isMesh || !obj.geometry || !obj.geometry.attributes?.position) return;
            console.log('Scanning obj for height debug:', obj);

            obj.updateWorldMatrix(true, false);
            const pos = obj.geometry.attributes.position;
            const world = new THREE.Vector3();

            for (let i = 0; i < pos.count; i++) {
                world
                    .set(pos.getX(i), pos.getY(i), pos.getZ(i))
                    .applyMatrix4(obj.matrixWorld);
                const r = world.length();
                if (!Number.isNaN(r)) {
                    if (r < minR) minR = r;
                    if (r > maxR) maxR = r;
                    updatedAny = true;
                } else {
                    missingAny = true;
                }
            }
            if (!Number.isFinite(minR) || !Number.isFinite(maxR) || maxR - minR < 1e-3) {
                console.warn('Height debug: invalid min/max radius', minR, maxR);
                missingAny = true;
                updatedAny = false;
                // return;
            }

        });


        // updatedAny = true;

        if (updatedAny) {
            view.notifyChange(layer);
        }

        // Only stop when we’ve *not* seen any missing elevation anymore
        if (draped && !missingAny && updatedAny) {
            // if (draped) {
            done = true;

            if (!Number.isFinite(minR) || !Number.isFinite(maxR) || maxR - minR < 1e-3) {
                console.warn('Height debug: invalid min/max radius', minR, maxR);
                return;
            } else {
                console.log('Height debug: min/max radius', minR, maxR);
                console.log('Height debug: range', maxR - minR);
            }

            // 2) Patch materials to color by normalized radius
            layer.object3d.traverse((obj) => {
                if (!obj.isMesh || !obj.material) return;

                const baseMat = obj.material;
                const mat = baseMat.clone();
                mat.depthWrite = false;
                mat.transparent = true;
                mat.userData._heightDebug = true;

                mat.onBeforeCompile = (shader) => {
                    shader.uniforms.uMinR = { value: minR };
                    shader.uniforms.uMaxR = { value: maxR };

                    // pass radius to fragment
                    shader.vertexShader =
                        'varying float vR;\n' +
                        shader.vertexShader.replace(
                            '#include <begin_vertex>',
                            `
                    #include <begin_vertex>
                    vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
                    vR = length(wp);
                    `
                        );

                    shader.fragmentShader =
                        'varying float vR;\n' +
                        'uniform float uMinR;\n' +
                        'uniform float uMaxR;\n' +
                        shader.fragmentShader.replace(
                            '#include <dithering_fragment>',
                            `
                    float t = clamp((vR - uMinR) / max(uMaxR - uMinR, 1e-3), 0.0, 1.0);
                    // blue -> cyan -> green -> yellow -> red
                    vec3 c0 = vec3(0.0, 0.0, 1.0);
                    vec3 c1 = vec3(0.0, 1.0, 1.0);
                    vec3 c2 = vec3(0.0, 1.0, 0.0);
                    vec3 c3 = vec3(1.0, 1.0, 0.0);
                    vec3 c4 = vec3(1.0, 0.0, 0.0);
                    vec3 c;
                    if (t < 0.25)      c = mix(c0, c1, t / 0.25);
                    else if (t < 0.5)  c = mix(c1, c2, (t - 0.25) / 0.25);
                    else if (t < 0.75) c = mix(c2, c3, (t - 0.5) / 0.25);
                    else               c = mix(c3, c4, (t - 0.75) / 0.25);
                    gl_FragColor.rgb = c;
                    #include <dithering_fragment>
                    `
                        );

                    mat.userData.shader = shader;
                };

                obj.material = mat;
            });

            view.notifyChange(layer);
        }
    });
}


function autoDrapeLayerOnElevation(view, layer, offset = 0, newMethod = false) {
    const tileLayer = view.tileLayer;
    const DEMUtils = itowns.DEMUtils;

    if (!tileLayer || !DEMUtils || !DEMUtils.getTerrainObjectAt) {
        console.warn('DEMUtils.getTerrainObjectAt not available; skipping precise drape.');
        return;
    }

    let done = false;

    view.addFrameRequester(itowns.MAIN_LOOP_EVENTS.BEFORE_RENDER, () => {
        if (done) return;

        let updatedAny = false;
        let missingAny = false;

        layer.object3d.traverse((obj) => {
            if (!obj.isMesh || !obj.geometry) return;
            const pos = obj.geometry.attributes?.position;
            if (!pos || pos.count === 0) return;

            obj.updateWorldMatrix(true, false);

            const worldToLocal = new THREE.Matrix4().copy(obj.matrixWorld).invert();
            const world = new THREE.Vector3();

            // a list of vertices with their new elevation
            let newElevations = [];

            for (let i = 0; i < pos.count; i++) {
                // local -> world
                world
                    .set(pos.getX(i), pos.getY(i), pos.getZ(i))
                    .applyMatrix4(obj.matrixWorld);

                // world (EPSG:4978) -> geographic
                const coordGeo = new itowns.Coordinates(
                    view.referenceCrs,
                    world.x,
                    world.y,
                    world.z
                ).as(tileLayer.extent.crs);

                const elev = itowns.DEMUtils.getElevationValueAt(
                    tileLayer,
                    coordGeo,
                    itowns.DEMUtils.FAST_READ_Z || 1
                );

                if (newMethod) {
                    // ask DEMUtils for the actual terrain point at this lat/lon
                    const terrain = DEMUtils.getTerrainObjectAt(tileLayer, coordGeo);
                    if (!terrain || !terrain.coord) {
                        missingAny = true;
                        continue;
                    }

                    // terrain.coord is on the ground; push slightly above along the radial direction
                    const terrainWorld = terrain.coord.as(view.referenceCrs);
                    const dir = new THREE.Vector3(
                        terrainWorld.x,
                        terrainWorld.y,
                        terrainWorld.z
                    ).normalize();

                    world.set(
                        terrainWorld.x + dir.x * offset,
                        terrainWorld.y + dir.y * offset,
                        terrainWorld.z + dir.z * offset
                    );

                    // world -> local
                    world.applyMatrix4(worldToLocal);
                    pos.setXYZ(i, world.x, world.y, world.z);
                } else {

                    if (elev === undefined || Number.isNaN(elev)) {
                        // DEM tile not ready yet, we’ll try again next frame
                        missingAny = true;
                        // console.log('Missing elevation at', coordGeo);
                        continue;
                    }
                    newElevations.push({ i, elev });

                    // add a random offset between -10 and +10
                    // offset += (Math.random() - 0.5) * 2;

                    coordGeo.z = elev + offset;

                    const cWorld = coordGeo.as(view.referenceCrs);
                    world.set(cWorld.x, cWorld.y, cWorld.z).applyMatrix4(worldToLocal);
                    pos.setXYZ(i, world.x, world.y, world.z);
                }

                updatedAny = true;


                world
                    .set(pos.getX(i), pos.getY(i), pos.getZ(i))
                    .applyMatrix4(obj.matrixWorld);

                const r = world.length();
                if (!Number.isNaN(r)) {
                    if (r < minR) minR = r;
                    if (r > maxR) maxR = r;
                }

                updatedAny = true;
            }

            if (updatedAny) {
                console.log('New elevations:', newElevations);
                pos.needsUpdate = true;
                obj.geometry.computeVertexNormals?.();
            }
        });

        if (updatedAny) {
            view.notifyChange(layer);
        }

        // Only stop when we’ve *not* seen any missing elevation anymore
        if (!missingAny && updatedAny) {
            draped = true;
            done = true;
        }
    });
}

function attachRippleShader(view, layer) {
    let patched = false;
    let time = 0;

    view.addFrameRequester(itowns.MAIN_LOOP_EVENTS.BEFORE_RENDER, (dt = 16.7) => {
        time += dt * 0.001;

        // One-time patch when meshes are ready
        if (!patched) {
            layer.object3d.traverse((obj) => {
                // console.log('Patching obj with material:', obj);
                if (!obj.isMesh || !obj.material) return;
                if (obj.material.userData && obj.material.userData._floodPatched) return;

                const mat = obj.material.clone();
                mat.userData._floodPatched = true;
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

                // mat.onBeforeCompile = (shader) => {
                //     // Declare our time uniform in the fragment shader
                //     shader.fragmentShader =
                //         'uniform float uTime;\n' + shader.fragmentShader;

                //     // After dithering, violently tint toward magenta with a pulse
                //     shader.fragmentShader = shader.fragmentShader.replace(
                //         '#include <dithering_fragment>',
                //         `
                //         #include <dithering_fragment>
                //         float pulse = 0.5 + 0.5 * sin(uTime * 5.0);
                //         gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.0, 1.0), pulse);
                //         `
                //     );

                //     // store ref so we can update uTime
                //     shader.uniforms.uTime = { value: 0.0 };
                //     mat.userData.shader = shader;
                // };

                obj.material = mat;
                patched = true;
            });
        }

        // Once patched, drive the uniform
        if (patched) {
            layer.object3d.traverse((obj) => {
                const shader = obj.material?.userData?.shader;
                if (shader) {
                    shader.uniforms.uTime.value = time;
                }
            });
            view.notifyChange(layer);
        }
    });
}

function enableRippleShaderLive(view, layer, makeRippleMaterial) {
    let time = 0;
    view.addFrameRequester(itowns.MAIN_LOOP_EVENTS.BEFORE_RENDER, (dt = 16.7) => {
        time += dt * 0.001;

        let changed = false;
        let patched = false;

        layer.object3d.traverse((obj) => {
            if (!obj.isMesh || !obj.material) return;

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

function makeRippleMaterial(baseMat) {
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




function setHeightDebugRange(layer, newMin, newMax) {
    layer.object3d.traverse((obj) => {
        const s = obj.material?.userData?.shader;
        if (!s) return;
        if (s.uniforms.uMinR) s.uniforms.uMinR.value = newMin;
        if (s.uniforms.uMaxR) s.uniforms.uMaxR.value = newMax;
    });
    layer.view?.notifyChange(layer);
}

// oscillate min max range
// let debugTime = 0;
// view.addFrameRequester(itowns.MAIN_LOOP_EVENTS.BEFORE_RENDER, (dt = 16.7) => {
//     debugTime += dt * 0.001;
//     const rangeSize = 500;
//     const mid = (minR + maxR) * 0.5 + Math.sin(debugTime) * 200;
//     const newMin = mid - rangeSize * 0.5;
//     const newMax = mid + rangeSize * 0.5;
//     setHeightDebugRange(floodGeomLayer, newMin, newMax);
// });

// minR = Infinity;
// maxR = -Infinity;

let featureOffset = 5;

const floodFillLayer = new itowns.FeatureGeometryLayer('floodFill', {
    source: floodSource,
    transparent: true,
    style: {
        fill: {
            color: 'cyan',
            opacity: 0.5,
            // base_altitude run per vertex/feature by iTowns
            base_altitude: (props, ctx) => {
                // ctx.coordinates: last vertex position in view CRS
                // Convert to the same CRS as tileLayer expects (usually EPSG:4326)
                const coord = ctx.coordinates.as(view.tileLayer.extent.crs);

                const elev = itowns.DEMUtils.getElevationValueAt(view.tileLayer, coord);
                if (elev === undefined || Number.isNaN(elev)) {
                    // console.warn('DEM not ready, using fallback elevation');
                    return 0; // fallback: sea level if DEM not ready
                }
                // access and change minR/maxR for debug shader from here using the transformed coordin view CRS if needed
                // const world = ctx.coordinates.as(view.referenceCrs);
                // const r = Math.sqrt(world.x * world.x + world.y * world.y + world.z * world.z);
                // if (r < minR) minR = r;
                // if (r > maxR) maxR = r;


                // Tiny offset above terrain to avoid z-fighting
                return elev + featureOffset;
            },
        },
        stroke: {
            color: 'blue',
            width: 1.0,
        },
    },
});


const floodTestCoord = new itowns.Coordinates('EPSG:4326', 3.05, 48.97);

function waitForDemAt(view, coord, onReady) {
    const tileLayer = view.tileLayer;
    const DEMUtils = itowns.DEMUtils;
    if (!tileLayer || !DEMUtils) {
        console.warn('No tileLayer/DEMUtils.');
        // onReady();
        return;
    }

    let done = false;
    view.addFrameRequester(itowns.MAIN_LOOP_EVENTS.BEFORE_RENDER, () => {
        // console.log('waitForDemAt checking DEM at', coord);
        if (done) return;

        // DEMUtils expects coord in tileLayer.extent.crs
        const c = coord.as(tileLayer.extent.crs);
        const elev = DEMUtils.getElevationValueAt(tileLayer, c, itowns.DEMUtils.PRECISE_READ_Z);

        if (elev !== undefined && !Number.isNaN(elev)) {
            console.log('DEM elevation is', elev);
            done = true;
            onReady();
        } else {
            console.log('DEM elevation not ready yet.');
        }
        // else: keep trying next frame
    });
}

// ---------- DISPLAY VECTOR TILED BUILDING DATA AS 3D MESHES : ----------

// Define the source of the building data : those are vector tiled data from the geoportail.
const buildingsSource = new itowns.VectorTilesSource({
    style: "https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/standard.json",
    // We only want to display buildings related data.
    filter: (layer) => {
        return layer['source-layer'].includes('bati_surf')
            // return layer['source-layer'].includes('routier_chemin')
            && layer.paint["fill-color"];
    },
});

// log to console all the available data types in https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/standard.json
// console.log('Available data types in vector tile:', itowns.VectorTilesSource.getAvailableSourceLayers(buildingsSource));
// Create a FeatureGeometryLayer to support building data.
var buildingsLayer = new itowns.FeatureGeometryLayer('VTBuilding', {
    source: buildingsSource,
    zoom: { min: 15 },
    accurate: false,
    style: {
        fill: {
            base_altitude: (p) => p.alti_sol || 0,
            extrusion_height: (p) => p.hauteur || 0,
        }
    },
});

// // Add the FeatureGeometryLayer to the scene and to the debug menu.
// view.addLayer(buildingsLayer)
//     .then((layer) => {
//         // add the eleveation shader
//         // attachHeightDebugShader(view, layer);
//         attachFloodDebugShader(view, layer);
//         // const gui = debug.GeometryDebug.createGeometryDebugUI(debugMenu.gui, view, layer);
//         // debug.GeometryDebug.addWireFrameCheckbox(gui, view, layer);

//     })



view.addLayer(elevationLayer).then(() => {
    view.addLayer(orthoLayer);
    waitForDemAt(view, floodTestCoord, () => {
        setTimeout(() => {
            view.addLayer(floodFillLayer).then((layer) => {
                draped = true;
                setTimeout(() => {
                    attachHeightDebugShader(view, layer);
                    // request an update
                    view.notifyChange(layer);
                }, 1000);
            });

        }, 1000);
    });
});

view.addLayer(buildingsLayer)
    .then((layer) => {
        setTimeout(() => {
            // attachRippleShader(view, layer);

            enableRippleShaderLive(view, layer, makeRippleMaterial);
        }, 1000);
    });