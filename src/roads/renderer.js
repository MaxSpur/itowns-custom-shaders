import { createRoadLayer } from './layer.js';
import { attachRoadFrameSync } from './frameSync.js';
import { createRoadsUI } from './ui.js';
import { createRoadPipeline } from './fatLinePipeline.js';

export function initRoadRenderer(view, roadFatLineRoot) {
    const roadsLayer = createRoadLayer(view);
    const roadLayers = [roadsLayer];
    const pipeline = createRoadPipeline(view, roadFatLineRoot, roadLayers);

    roadsLayer.onMeshCreated = (root) => pipeline.scheduleRoadProcessing(root);

    Promise.all(roadLayers.map((layer) => view.addLayer(layer))).then(() => {
        console.log('Roads layer added');
        createRoadsUI({
            roadLayers,
            notifyRoadLayers: pipeline.notifyRoadLayers,
            triggerUpdate: pipeline.triggerUpdate,
            applyFrustumCullingState: pipeline.applyFrustumCullingState,
            rebuildAllRoadTiles: pipeline.rebuildAllRoadTiles,
            applyGlobalStateToMaterials: pipeline.applyGlobalStateToMaterials,
        });
        pipeline.applyFrustumCullingState();
        pipeline.triggerUpdate();
    });

    attachRoadFrameSync(view, {
        RoadTileAnchors: pipeline.RoadTileAnchors,
        RoadFatLines: pipeline.RoadFatLines,
        syncMaterialResolutions: pipeline.syncMaterialResolutions,
    });

    return {
        roadsLayer,
        roadLayers,
        pipeline,
    };
}
