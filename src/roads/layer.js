import * as itowns from 'itowns';

import { ROAD_COLOR, registerRoadFeature } from './state.js';

export function createRoadLayer(view) {
    const roadsSource = new itowns.WFSSource({
        url: 'https://data.geopf.fr/wfs/ows?',
        version: '2.0.0',
        typeName: 'BDTOPO_V3:troncon_de_route',
        crs: 'EPSG:4326',
        format: 'application/json',
        zoom: { min: 12, max: 15 },
    });

    const altitudeDebug = {
        logged: 0,
        max: 20,
    };

    function logAltitudeIssue(reason, props) {
        if (altitudeDebug.logged >= altitudeDebug.max) return;
        altitudeDebug.logged++;
        console.warn(`[RoadAltitude] ${reason}`, {
            id: props?.id || props?.ID || props?.nature,
            nature: props?.nature,
        });
    }

    function resolveBaseCoordinate(ctx) {
        if (!ctx) return null;
        const coord = Array.isArray(ctx.coordinates) ? ctx.coordinates[0] : ctx.coordinates;
        if (!coord) return null;
        if (coord.isCoordinates) return coord;
        if (coord.crs) return new itowns.Coordinates(coord.crs, coord.x, coord.y, coord.z || 0);
        return new itowns.Coordinates('EPSG:4326', coord.x, coord.y, coord.z || 0);
    }

    const reusableCoord = new itowns.Coordinates('EPSG:4326', 0, 0, 0);
    const demReadMode = (itowns.DEMUtils && (itowns.DEMUtils.PRECISE_READ_Z || itowns.DEMUtils.FAST_READ_Z)) || 0;

    function getRoadBaseAltitude(props, ctx) {
        const coord = resolveBaseCoordinate(ctx);
        if (!coord) return 0;
        const z = Number.isFinite(coord.z) ? coord.z : 0;

        const tileLayer = view.tileLayer;
        if (!tileLayer || !itowns.DEMUtils || !coord.isCoordinates) {
            if (z === 0) logAltitudeIssue('No DEM available, falling back to z=0', props);
            return z;
        }

        reusableCoord.copy(coord);
        const demElevation = itowns.DEMUtils.getElevationValueAt(
            tileLayer,
            reusableCoord,
            demReadMode,
        );
        if (Number.isFinite(demElevation)) {
            return demElevation;
        }

        if (z === 0) logAltitudeIssue('DEM not ready, using fallback altitude', props);
        return z;
    }

    const roadsLayer = new itowns.FeatureGeometryLayer('BDTOPO_Roads', {
        source: roadsSource,
        zoom: { min: 12 },
        mergeFeatures: true,
        batchId: (properties) => registerRoadFeature(properties),
        style: {
            stroke: {
                color: (props) => ROAD_COLOR[props.nature] || '#FF00FF',
                base_altitude: (props, ctx) => getRoadBaseAltitude(props, ctx),
            },
        },
    });

    return roadsLayer;
}
