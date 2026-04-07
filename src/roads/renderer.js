import { createRoadLayer } from './layer.js';
import { attachRoadFrameSync } from './frameSync.js';
import { createRoadsUI } from './ui.js';
import { createRoadPipeline } from './fatLinePipeline.js';
import { createGpxPathsManager } from './gpxPaths.js';

export function initRoadRenderer(view, roadFatLineRoot) {
    let roadsLayer = createRoadLayer(view);
    const roadLayers = [roadsLayer];
    const pipeline = createRoadPipeline(view, roadFatLineRoot, roadLayers);
    const gpxPaths = createGpxPathsManager(view, { roadFatLineRoot });

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

    const bindRoadLayer = (layer) => {
        layer.onMeshCreated = (root) => pipeline.scheduleRoadProcessing(root);
    };

    const walkTileNodes = (nodes, visitor) => {
        for (const node of nodes || []) {
            if (!node) continue;
            visitor(node);
            if (node.children?.length) {
                walkTileNodes(node.children, visitor);
            }
        }
    };

    const resetRoadLayerNodeState = (layerId) => {
        const tileRoots = view.tileLayer?.level0Nodes;
        if (!tileRoots?.length) {
            return;
        }

        walkTileNodes(tileRoots, (node) => {
            if (node.layerUpdateState?.[layerId]) {
                delete node.layerUpdateState[layerId];
            }

            if (node.link?.[layerId]) {
                delete node.link[layerId];
            }
        });
    };

    const initializeRoadLayer = async (layer) => {
        bindRoadLayer(layer);
        await view.addLayer(layer);
    };

    let clearLoadedRoadDataPromise = null;

    const clearLoadedRoadData = async () => {
        if (clearLoadedRoadDataPromise) {
            return clearLoadedRoadDataPromise;
        }

        clearLoadedRoadDataPromise = (async () => {
            const layerId = roadsLayer.id;
            pipeline.clearLoadedRoadData();

            if (view.getLayerById(layerId)) {
                view.removeLayer(layerId, true);
            }
            resetRoadLayerNodeState(layerId);

            roadsLayer = createRoadLayer(view);
            roadLayers.splice(0, roadLayers.length, roadsLayer);
            await initializeRoadLayer(roadsLayer);

            pipeline.applyRoadVisibilityState();
            applyFrustumCullingState();
            triggerUpdate();
            view.notifyChange(true);
        })().finally(() => {
            clearLoadedRoadDataPromise = null;
        });

        return clearLoadedRoadDataPromise;
    };

    initializeRoadLayer(roadsLayer).then(() => {
        createRoadsUI({
            roadLayers,
            notifyRoadLayers: pipeline.notifyRoadLayers,
            setRoadVisibility: pipeline.applyRoadVisibilityState,
            triggerUpdate,
            applyFrustumCullingState,
            rebuildAllRoadTiles,
            applyGlobalStateToMaterials: pipeline.applyGlobalStateToMaterials,
            gpxPathsManager: gpxPaths,
            clearLoadedRoadData,
        });
        pipeline.applyRoadVisibilityState();
        applyFrustumCullingState();
        triggerUpdate();
    }).catch((error) => {
        console.error('[RoadRenderer] Failed to initialize roads layer', error);
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
        clearLoadedRoadData,
    };
}
