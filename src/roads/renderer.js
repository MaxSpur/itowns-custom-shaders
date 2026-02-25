import { createRoadLayer } from './layer.js';
import { attachRoadFrameSync } from './frameSync.js';
import { createRoadsUI } from './ui.js';
import { createRoadPipeline } from './fatLinePipeline.js';
import { createGpxPathsManager } from './gpxPaths.js';

export function initRoadRenderer(view, roadFatLineRoot) {
    const roadsLayer = createRoadLayer(view);
    const roadLayers = [roadsLayer];
    const pipeline = createRoadPipeline(view, roadFatLineRoot, roadLayers);
    const gpxPaths = createGpxPathsManager(view, { roadFatLineRoot });

    roadsLayer.onMeshCreated = (root) => pipeline.scheduleRoadProcessing(root);

    const triggerUpdate = () => {
        pipeline.triggerUpdate();
        gpxPaths.applyGlobalStateToPaths();
    };

    const applyFrustumCullingState = () => {
        pipeline.applyFrustumCullingState();
        gpxPaths.applyFrustumCullingState();
    };

    const rebuildAllRoadTiles = () => {
        pipeline.rebuildAllRoadTiles();
        gpxPaths.rebuildAllPaths();
    };

    Promise.all(roadLayers.map((layer) => view.addLayer(layer))).then(() => {
        console.log('Roads layer added');
        createRoadsUI({
            roadLayers,
            notifyRoadLayers: pipeline.notifyRoadLayers,
            triggerUpdate,
            applyFrustumCullingState,
            rebuildAllRoadTiles,
            applyGlobalStateToMaterials: pipeline.applyGlobalStateToMaterials,
            gpxPathsManager: gpxPaths,
        });
        applyFrustumCullingState();
        triggerUpdate();
    });

    attachRoadFrameSync(view, {
        RoadTileAnchors: pipeline.RoadTileAnchors,
        RoadFatLines: pipeline.RoadFatLines,
        syncMaterialResolutions: () => {
            pipeline.syncMaterialResolutions();
            gpxPaths.syncMaterialResolutions();
        },
    });

    return {
        roadsLayer,
        roadLayers,
        pipeline,
        gpxPaths,
    };
}
