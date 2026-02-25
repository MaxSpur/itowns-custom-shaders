import { makeStereoProjectMaterial } from '../projection/index.js';
import {
    ROAD_COLOR,
    ROAD_WIDTH_BASE,
    RoadGlobalState,
    getWidthForBatch,
} from './state.js';
import { createRoadGeometryProcessor } from './pipeline/geometry.js';
import { createRoadMaterialManager } from './pipeline/materials.js';
import { createRoadTileLifecycle } from './pipeline/tileLifecycle.js';

export function createRoadPipeline(view, roadFatLineRoot, roadLayers) {
    const roadFatLines = new Set();
    const roadTileAnchors = new Map();

    function notifyRoadLayers() {
        for (const layer of roadLayers) {
            view.notifyChange(layer);
        }
    }

    const geometryProcessor = createRoadGeometryProcessor({
        ROAD_COLOR,
        ROAD_WIDTH_BASE,
        RoadGlobalState,
        getWidthForBatch,
    });

    const materialManager = createRoadMaterialManager({
        RoadGlobalState,
        makeStereoProjectMaterial,
    });

    const tileLifecycle = createRoadTileLifecycle({
        view,
        roadFatLineRoot,
        roadLayers,
        RoadGlobalState,
        geometryProcessor,
        materialManager,
        roadFatLines,
        roadTileAnchors,
        notifyRoadLayers,
    });

    function applyGlobalStateToMaterials() {
        materialManager.applyGlobalStateToMaterials({
            roadFatLines,
            notifyRoadLayers,
            view,
        });
    }

    function triggerUpdate() {
        applyGlobalStateToMaterials();
    }

    return {
        RoadFatLines: roadFatLines,
        RoadTileAnchors: roadTileAnchors,
        scheduleRoadProcessing: tileLifecycle.scheduleRoadProcessing,
        rebuildAllRoadTiles: tileLifecycle.rebuildAllRoadTiles,
        applyFrustumCullingState: tileLifecycle.applyFrustumCullingState,
        triggerUpdate,
        applyGlobalStateToMaterials,
        syncMaterialResolutions: materialManager.syncMaterialResolutions,
        notifyRoadLayers,
    };
}
