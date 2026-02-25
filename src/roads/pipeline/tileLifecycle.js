import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

import { getFeatureTileKey } from './geometry.js';

export function createRoadTileLifecycle({
    view,
    roadFatLineRoot,
    roadLayers,
    RoadGlobalState,
    geometryProcessor,
    materialManager,
    roadFatLines,
    roadTileAnchors,
    notifyRoadLayers,
}) {
    const ATTACH_RETRY_MAX_ATTEMPTS = 300;
    const ATTACH_RETRY_MAX_WAIT_MS = 10000;

    const scratchRoadRootInverse = new THREE.Matrix4();
    let rebuildPending = false;

    function cleanupAnchorEntry(entry) {
        if (!entry) return;
        const { anchor, fatLines } = entry;

        if (Array.isArray(fatLines)) {
            for (const line of fatLines) {
                if (!line) continue;
                if (line.parent) line.parent.remove(line);
                const geometry = line.geometry;
                if (geometry && typeof geometry.dispose === 'function') {
                    geometry.dispose();
                }
                roadFatLines.delete(line);
            }
        }

        if (anchor && anchor.parent) {
            anchor.parent.remove(anchor);
        }
    }

    function cleanupFeatureFatLines(featureRoot) {
        if (!featureRoot) return;
        const key = featureRoot.userData?.roadTileKey;
        if (key && roadTileAnchors.has(key)) {
            cleanupAnchorEntry(roadTileAnchors.get(key));
            roadTileAnchors.delete(key);
        }
        if (featureRoot.userData) {
            delete featureRoot.userData.roadAnchor;
            delete featureRoot.userData.fatLines;
            delete featureRoot.userData.roadTileKey;
        }
    }

    function createFatLinesFromGroups(featureRoot, targetRoot, groups) {
        if (!groups || !groups.size) return;

        const tileKey = getFeatureTileKey(featureRoot);
        if (tileKey && roadTileAnchors.has(tileKey)) {
            cleanupAnchorEntry(roadTileAnchors.get(tileKey));
            roadTileAnchors.delete(tileKey);
        } else {
            cleanupFeatureFatLines(featureRoot);
        }

        featureRoot.userData = featureRoot.userData || {};

        const anchor = new THREE.Group();
        anchor.name = 'RoadTileAnchor';
        anchor.matrixAutoUpdate = false;

        roadFatLineRoot.updateWorldMatrix(true, false);
        targetRoot.updateWorldMatrix(true, false);

        const parentInverse = scratchRoadRootInverse.copy(roadFatLineRoot.matrixWorld).invert();
        anchor.matrix.copy(parentInverse).multiply(targetRoot.matrixWorld);
        anchor.matrix.decompose(anchor.position, anchor.quaternion, anchor.scale);
        anchor.updateMatrix();
        anchor.frustumCulled = !RoadGlobalState.disableFrustumCulling;
        anchor.userData.isRoadAnchor = true;

        roadFatLineRoot.add(anchor);
        anchor.updateMatrixWorld(true);

        featureRoot.userData.roadAnchor = anchor;
        featureRoot.userData.fatLines = [];

        const isDefaultMode = RoadGlobalState.depthTest;

        for (const group of groups.values()) {
            if (!group.positions.length) continue;

            const geometry = new LineSegmentsGeometry();
            geometry.setPositions(group.positions);
            if (group.hasColors && group.colors.length === group.positions.length) {
                geometry.setColors(group.colors);
            }

            const renderBase = group.baseWidth || 2;
            const material = materialManager.getRoadMaterial(
                renderBase,
                group.hasColors,
                group.color,
                isDefaultMode,
            );
            const fatLine = new LineSegments2(geometry, material);

            fatLine.renderOrder = isDefaultMode ? 0 : 999;
            fatLine.userData.isFatLine = true;
            fatLine.userData.baseWidth = renderBase;
            fatLine.frustumCulled = !RoadGlobalState.disableFrustumCulling;
            fatLine.position.set(0, 0, RoadGlobalState.altitudeOffset);
            fatLine.updateMatrixWorld();

            anchor.add(fatLine);
            featureRoot.userData.fatLines.push(fatLine);
            roadFatLines.add(fatLine);
        }

        if (tileKey) {
            roadTileAnchors.set(tileKey, {
                anchor,
                fatLines: featureRoot.userData.fatLines,
                sourceRoot: targetRoot,
                needsSync: true,
                featureRoot,
            });
            featureRoot.userData.roadTileKey = tileKey;
        }

        view.notifyChange(true);
    }

    function processRoadTileRoot(featureRoot) {
        if (!featureRoot) return;

        const tileKey = getFeatureTileKey(featureRoot);
        if (tileKey && roadTileAnchors.has(tileKey)) {
            featureRoot.userData = featureRoot.userData || {};
            featureRoot.userData.hasQueuedFatLine = false;
            return;
        }

        featureRoot.userData = featureRoot.userData || {};
        featureRoot.userData.isRoadFeature = true;

        const { targetRoot, groups } = geometryProcessor.collectGeometryGroupsForFeatureRoot(featureRoot);
        createFatLinesFromGroups(featureRoot, targetRoot, groups);
        featureRoot.userData.hasQueuedFatLine = false;
    }

    function scheduleRoadProcessing(root) {
        if (!root) return;
        if (root.userData?.hasQueuedFatLine) return;

        root.userData = root.userData || {};
        root.userData.hasQueuedFatLine = true;
        const startedAt = (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now();
        let attempts = 0;

        const attemptProcess = () => {
            if (!root?.userData?.hasQueuedFatLine) {
                return;
            }

            if (root.parent) {
                try {
                    processRoadTileRoot(root);
                } catch (err) {
                    root.userData.hasQueuedFatLine = false;
                    console.error('[RoadPipeline] Failed to process queued road root', err);
                }
                return;
            }

            attempts += 1;
            const now = (typeof performance !== 'undefined' && performance.now)
                ? performance.now()
                : Date.now();
            if (
                attempts >= ATTACH_RETRY_MAX_ATTEMPTS ||
                (now - startedAt) >= ATTACH_RETRY_MAX_WAIT_MS
            ) {
                root.userData.hasQueuedFatLine = false;
                return;
            }

            if (!root.parent) {
                requestAnimationFrame(attemptProcess);
            }
        };

        requestAnimationFrame(attemptProcess);
    }

    function rebuildAllRoadTiles() {
        if (rebuildPending) return;
        rebuildPending = true;

        const entries = Array.from(roadTileAnchors.entries());
        roadTileAnchors.clear();
        for (const [, entry] of entries) {
            cleanupAnchorEntry(entry);
            const featureRoot = entry.featureRoot;
            if (!featureRoot) continue;

            if (featureRoot.userData) {
                delete featureRoot.userData.roadTileKey;
                delete featureRoot.userData.roadAnchor;
                delete featureRoot.userData.fatLines;
            }

            geometryProcessor.resetProcessedFlag(featureRoot, roadFatLines);
            processRoadTileRoot(featureRoot);
        }

        rebuildPending = false;
    }

    function applyFrustumCullingState() {
        const frustumCulled = !RoadGlobalState.disableFrustumCulling;

        for (const layer of roadLayers) {
            layer.object3d.traverse((obj) => {
                if (!obj) return;
                if (
                    obj.userData?.isFatLine ||
                    obj.userData?.isRoadFeature ||
                    obj.isLine ||
                    obj.isLineSegments ||
                    obj.isMesh ||
                    obj.isGroup
                ) {
                    obj.frustumCulled = frustumCulled;
                }
            });
        }

        roadFatLineRoot.frustumCulled = false;
        roadFatLineRoot.traverse((obj) => {
            if (!obj || obj === roadFatLineRoot) return;
            if (
                obj.userData?.isFatLine ||
                obj.userData?.isRoadFeature ||
                obj.userData?.isRoadAnchor ||
                obj.isLine ||
                obj.isLineSegments ||
                obj.isMesh ||
                obj.isGroup
            ) {
                obj.frustumCulled = frustumCulled;
            }
        });

        notifyRoadLayers();
    }

    return {
        scheduleRoadProcessing,
        rebuildAllRoadTiles,
        applyFrustumCullingState,
    };
}
