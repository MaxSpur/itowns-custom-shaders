import * as itowns from 'itowns';
import * as THREE from 'three';

export function setupView() {
    const viewerDiv = document.getElementById('viewerDiv');
    const placement = {
        coord: new itowns.Coordinates('EPSG:4326', 2.437, 48.846),
        range: 5000,
        tilt: 80,
        heading: 0,
    };

    const view = new itowns.GlobeView(viewerDiv, placement);

    const roadFatLineRoot = new THREE.Group();
    roadFatLineRoot.name = 'RoadFatLines';
    roadFatLineRoot.frustumCulled = false;
    view.scene.add(roadFatLineRoot);

    const elevationSource = new itowns.WMTSSource({
        url: 'https://data.geopf.fr/wmts?',
        crs: 'EPSG:4326',
        name: 'ELEVATION.ELEVATIONGRIDCOVERAGE.SRTM3',
        tileMatrixSet: 'WGS84G',
        format: 'image/x-bil;bits=32',
        zoom: { min: 2, max: 10 },
    });

    const elevationLayer = new itowns.ElevationLayer('MNT_WORLD', {
        source: elevationSource,
    });
    view.addLayer(elevationLayer);

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
    view.addLayer(orthoLayer);

    return {
        view,
        viewerDiv,
        roadFatLineRoot,
    };
}
