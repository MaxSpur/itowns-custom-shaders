import * as itowns from 'itowns';

import * as THREE from 'three';

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

function enableRippleShaderLive(view, layer, makeRippleMaterial) {
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
    extent: {
        west: 4.1,
        east: 4.9,
        south: 45.6,
        north: 45.8,
    },
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

view.addLayer(batiLayer).then(() => {
    console.log('BDTOPO_Buildings layer added');
    // timeout
    setTimeout(() => {
        enableRippleShaderLive(view, batiLayer, makeRippleMaterial);
    }, 1000);
});

const roadsSource = new itowns.WFSSource({
    url: 'https://data.geopf.fr/wfs/ows?',
    version: '2.0.0',
    typeName: 'BDTOPO_V3:troncon_de_route',   // <- from capabilities
    crs: 'EPSG:4326',
    format: 'application/json',
    extent: {
        west: 4.1,
        east: 4.9,
        south: 45.6,
        north: 45.8,
    },
    zoom: { min: 10, max: 15 },
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

view.addLayer(roadsLayer).then(() => {
    console.log('BDTOPO_Roads layer added');

    // timeout
    setTimeout(() => {
        enableRippleShaderLive(view, roadsLayer, makeRippleMaterial);
    }, 1000);

    // enable ripple effect on roads layer
});