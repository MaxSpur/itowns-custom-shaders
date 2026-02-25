import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

import { makeStereoProjectMaterial } from '../projection/index.js';
import {
    ROAD_COLOR,
    ROAD_WIDTH_BASE,
    RoadGlobalState,
    getWidthForBatch,
} from './state.js';

function isFinite3(x, y, z) {
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}

function isNearOrigin(x, y, z) {
    return Math.abs(x) < 1.0 && Math.abs(y) < 1.0 && Math.abs(z) < 1.0;
}

function getFeatureProperties(object) {
    let obj = object;
    while (obj) {
        if (obj.userData?.feature?.properties) return obj.userData.feature.properties;
        if (obj.feature?.properties) return obj.feature.properties;
        obj = obj.parent;
    }
    return {};
}

function getFeatureTileKey(featureRoot) {
    const ext = featureRoot?.extent;
    if (ext && typeof ext === 'object' && (ext.isExtent || ext.crs)) {
        const west = Number.isFinite(ext.west) ? ext.west : 0;
        const east = Number.isFinite(ext.east) ? ext.east : 0;
        const south = Number.isFinite(ext.south) ? ext.south : 0;
        const north = Number.isFinite(ext.north) ? ext.north : 0;
        const zoom = Number.isFinite(ext.zoom) ? ext.zoom : 0;
        const crs = ext.crs || ext.projection || 'unknown';
        return `${crs}|${west}|${east}|${south}|${north}|${zoom}`;
    }
    return featureRoot ? featureRoot.uuid : null;
}

export function createRoadPipeline(view, roadFatLineRoot, roadLayers) {
    const scratchVecA = new THREE.Vector3();
    const scratchVecB = new THREE.Vector3();
    const scratchMatrix = new THREE.Matrix4();
    const scratchRootInverse = new THREE.Matrix4();
    const scratchRoadRootInverse = new THREE.Matrix4();

    const tempColor = new THREE.Color();
    const RoadFatLines = new Set();
    const RoadTileAnchors = new Map();
    const RoadMaterialCache = new Map();

    let rebuildPending = false;

    function resetProcessedFlag(root) {
        root.traverse((node) => {
            if (!node.userData) return;
            delete node.userData.hasProcessedFatLine;
            if (node.userData.isFatLine && node.parent) {
                node.parent.remove(node);
                RoadFatLines.delete(node);
            }
        });
    }

    function appendGeometryToGroup(sourceGeom, group, transformMatrix) {
        if (!sourceGeom) return;
        const posAttr = sourceGeom.attributes?.position;
        if (!posAttr) return;

        const colAttr = sourceGeom.attributes?.color;
        const indexAttr = sourceGeom.index;

        if (!colAttr && group.hasColors) {
            group.hasColors = false;
            group.colors.length = 0;
        }

        const useColors = group.hasColors && !!colAttr;
        const useTransform = !!transformMatrix;

        const pushSegment = (aIdx, bIdx) => {
            const ax = posAttr.getX(aIdx);
            const ay = posAttr.getY(aIdx);
            const az = posAttr.getZ(aIdx);
            const bx = posAttr.getX(bIdx);
            const by = posAttr.getY(bIdx);
            const bz = posAttr.getZ(bIdx);

            if (!isFinite3(ax, ay, az) || !isFinite3(bx, by, bz)) return;
            if (isNearOrigin(ax, ay, az) && isNearOrigin(bx, by, bz)) return;

            if (useTransform) {
                scratchVecA.set(ax, ay, az).applyMatrix4(transformMatrix);
                scratchVecB.set(bx, by, bz).applyMatrix4(transformMatrix);
                group.positions.push(
                    scratchVecA.x, scratchVecA.y, scratchVecA.z,
                    scratchVecB.x, scratchVecB.y, scratchVecB.z,
                );
            } else {
                group.positions.push(ax, ay, az, bx, by, bz);
            }

            if (useColors) {
                group.colors.push(
                    colAttr.getX(aIdx), colAttr.getY(aIdx), colAttr.getZ(aIdx),
                    colAttr.getX(bIdx), colAttr.getY(bIdx), colAttr.getZ(bIdx),
                );
            }
        };

        if (indexAttr) {
            for (let i = 0; i < indexAttr.count; i += 2) {
                pushSegment(indexAttr.getX(i), indexAttr.getX(i + 1));
            }
            return;
        }

        for (let i = 0; i < posAttr.count; i += 2) {
            pushSegment(i, i + 1);
        }
    }

    function createFatLineGeometriesByBatch(sourceGeom, transformMatrix) {
        const posAttr = sourceGeom?.attributes?.position;
        const colAttr = sourceGeom?.attributes?.color;
        const batchAttr = sourceGeom?.attributes?.batchId;
        const indexAttr = sourceGeom?.index;
        if (!posAttr) return [];

        const hasColorsAttr = !!colAttr;
        const hasBatchAttr = !!batchAttr;
        const groups = new Map();

        function getGroup(batchId) {
            const key = hasBatchAttr ? batchId : 0;
            if (!groups.has(key)) {
                groups.set(key, { positions: [], colors: [] });
            }
            return groups.get(key);
        }

        function addSegment(aIdx, bIdx) {
            const ax = posAttr.getX(aIdx);
            const ay = posAttr.getY(aIdx);
            const az = posAttr.getZ(aIdx);
            const bx = posAttr.getX(bIdx);
            const by = posAttr.getY(bIdx);
            const bz = posAttr.getZ(bIdx);

            if (!isFinite3(ax, ay, az) || !isFinite3(bx, by, bz)) return;
            if (isNearOrigin(ax, ay, az) && isNearOrigin(bx, by, bz)) return;

            const batchId = hasBatchAttr ? batchAttr.getX(aIdx) : 0;
            const group = getGroup(batchId);

            if (transformMatrix) {
                scratchVecA.set(ax, ay, az).applyMatrix4(transformMatrix);
                scratchVecB.set(bx, by, bz).applyMatrix4(transformMatrix);
                group.positions.push(
                    scratchVecA.x, scratchVecA.y, scratchVecA.z,
                    scratchVecB.x, scratchVecB.y, scratchVecB.z,
                );
            } else {
                group.positions.push(ax, ay, az, bx, by, bz);
            }

            if (hasColorsAttr) {
                group.colors.push(
                    colAttr.getX(aIdx), colAttr.getY(aIdx), colAttr.getZ(aIdx),
                    colAttr.getX(bIdx), colAttr.getY(bIdx), colAttr.getZ(bIdx),
                );
            }
        }

        if (indexAttr) {
            for (let i = 0; i < indexAttr.count; i += 2) {
                addSegment(indexAttr.getX(i), indexAttr.getX(i + 1));
            }
        } else {
            for (let i = 0; i < posAttr.count; i += 2) {
                addSegment(i, i + 1);
            }
        }

        const results = [];
        for (const [batchId, data] of groups.entries()) {
            if (!data.positions.length) continue;
            const hasValidColors = hasColorsAttr && data.colors.length === data.positions.length;
            results.push({
                positions: data.positions.slice(),
                colors: hasValidColors ? data.colors.slice() : null,
                hasColors: hasValidColors,
                batchId: hasBatchAttr ? batchId : null,
            });
        }
        return results;
    }

    function cleanupAnchorEntry(entry) {
        if (!entry) return;
        const { anchor, fatLines } = entry;

        if (Array.isArray(fatLines)) {
            for (const line of fatLines) {
                if (!line) continue;
                if (line.parent) line.parent.remove(line);
                RoadFatLines.delete(line);
            }
        }

        if (anchor && anchor.parent) {
            anchor.parent.remove(anchor);
        }
    }

    function cleanupFeatureFatLines(featureRoot) {
        if (!featureRoot) return;
        const key = featureRoot.userData?.roadTileKey;
        if (key && RoadTileAnchors.has(key)) {
            cleanupAnchorEntry(RoadTileAnchors.get(key));
            RoadTileAnchors.delete(key);
        }
        if (featureRoot.userData) {
            delete featureRoot.userData.roadAnchor;
            delete featureRoot.userData.fatLines;
            delete featureRoot.userData.roadTileKey;
        }
    }

    function syncMaterialResolutions() {
        for (const mat of RoadMaterialCache.values()) {
            if (!mat?.resolution) continue;
            mat.resolution.copy(RoadGlobalState.resolution);
        }
    }

    function notifyRoadLayers() {
        for (const layer of roadLayers) {
            view.notifyChange(layer);
        }
    }

    function applyGlobalStateToMaterials() {
        for (const mat of RoadMaterialCache.values()) {
            if (!mat) continue;
            const base = mat.userData?.baseWidth || 2;
            mat.linewidth = base * RoadGlobalState.widthMultiplier;
            mat.worldUnits = RoadGlobalState.useWorldUnits;

            const isDefaultMode = RoadGlobalState.depthTest;
            mat.depthTest = isDefaultMode;
            mat.depthWrite = isDefaultMode;
            mat.transparent = !isDefaultMode;
            mat.polygonOffset = isDefaultMode;
            mat.needsUpdate = true;
        }

        for (const obj of RoadFatLines) {
            if (!obj) continue;
            obj.renderOrder = RoadGlobalState.depthTest ? 0 : 999;
            obj.position.z = RoadGlobalState.altitudeOffset;
            obj.updateMatrix();
        }

        notifyRoadLayers();
        view.notifyChange(true);
    }

    function addMeshToGeometryGroups(mesh, groups, transformMatrix) {
        if (!mesh.geometry) return;

        const props = getFeatureProperties(mesh);
        const natureName = props?.nature || 'unknown';
        const baseWidthNature = ROAD_WIDTH_BASE[natureName] || 2;
        const color = ROAD_COLOR[natureName] || '#FF00FF';
        const hasColorAttr = !!mesh.geometry.attributes?.color;

        if (!RoadGlobalState.useIndividualWidths) {
            const baseWidth = 2;
            const key = `uniform|${color}|${hasColorAttr ? 1 : 0}`;
            if (!groups.has(key)) {
                groups.set(key, {
                    color,
                    positions: [],
                    colors: [],
                    hasColors: hasColorAttr,
                    baseWidth,
                });
            }
            appendGeometryToGroup(mesh.geometry, groups.get(key), transformMatrix);
        } else {
            const geometries = createFatLineGeometriesByBatch(mesh.geometry, transformMatrix);
            for (const { positions, colors, hasColors, batchId } of geometries) {
                const widthFromBatch = (batchId !== null && batchId !== undefined)
                    ? getWidthForBatch(batchId)
                    : undefined;
                const baseWidth = widthFromBatch || baseWidthNature;
                const key = `${baseWidth}|${color}|${hasColors ? 1 : 0}`;

                if (!groups.has(key)) {
                    groups.set(key, {
                        color,
                        positions: [],
                        colors: [],
                        hasColors,
                        baseWidth,
                    });
                }

                const group = groups.get(key);
                group.positions.push(...positions);
                if (hasColors && colors) {
                    group.colors.push(...colors);
                } else {
                    group.hasColors = false;
                    group.colors.length = 0;
                }
            }
        }

        const material = mesh.material;
        if (material) {
            if (Array.isArray(material)) {
                for (const item of material) {
                    if (item) item.visible = false;
                }
            } else {
                material.visible = false;
            }
        }

        mesh.frustumCulled = !RoadGlobalState.disableFrustumCulling;
        mesh.userData.hasProcessedFatLine = true;
    }

    function getRoadMaterial(baseWidth, hasColors, colorHex, isDefaultMode) {
        const key = `${baseWidth}|${hasColors ? 1 : 0}|${colorHex}|${isDefaultMode ? 1 : 0}`;
        let material = RoadMaterialCache.get(key);
        if (material) return material;

        material = new LineMaterial({
            color: hasColors ? 0xffffff : tempColor.set(colorHex).getHex(),
            linewidth: baseWidth * RoadGlobalState.widthMultiplier,
            vertexColors: hasColors,
            worldUnits: RoadGlobalState.useWorldUnits,
            dashed: false,
            alphaToCoverage: false,
            depthTest: isDefaultMode,
            depthWrite: isDefaultMode,
            transparent: !isDefaultMode,
            resolution: RoadGlobalState.resolution,
            polygonOffset: isDefaultMode,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
        });

        material.userData = material.userData || {};
        material.userData.baseWidth = baseWidth;
        makeStereoProjectMaterial(material);
        RoadMaterialCache.set(key, material);
        return material;
    }

    function createFatLinesFromGroups(featureRoot, targetRoot, groups) {
        if (!groups || !groups.size) return;

        const tileKey = getFeatureTileKey(featureRoot);
        if (tileKey && RoadTileAnchors.has(tileKey)) {
            cleanupAnchorEntry(RoadTileAnchors.get(tileKey));
            RoadTileAnchors.delete(tileKey);
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
            const material = getRoadMaterial(
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
            RoadFatLines.add(fatLine);
        }

        if (tileKey) {
            RoadTileAnchors.set(tileKey, {
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

        const targetRoot = featureRoot.meshes || featureRoot;
        const tileKey = getFeatureTileKey(featureRoot);
        if (tileKey && RoadTileAnchors.has(tileKey)) {
            featureRoot.userData = featureRoot.userData || {};
            featureRoot.userData.hasQueuedFatLine = false;
            return;
        }

        featureRoot.userData = featureRoot.userData || {};
        featureRoot.userData.isRoadFeature = true;

        featureRoot.updateWorldMatrix(true, true);
        targetRoot.updateWorldMatrix(true, true);

        const frustumState = !RoadGlobalState.disableFrustumCulling;
        targetRoot.frustumCulled = frustumState;
        featureRoot.frustumCulled = frustumState;

        const geometryGroups = new Map();
        const targetInverse = scratchRootInverse.copy(targetRoot.matrixWorld).invert();

        const traverse = (node) => {
            if (!node || node.userData?.isFatLine) return;

            const isLineLike = node.isMesh || node.isLine || node.isLineSegments;
            if (isLineLike && node.geometry && !node.userData?.hasProcessedFatLine) {
                const toTargetMatrix = scratchMatrix.copy(node.matrixWorld).premultiply(targetInverse);
                addMeshToGeometryGroups(node, geometryGroups, toTargetMatrix);
            }

            if (!node.children) return;
            for (const child of node.children) {
                traverse(child);
            }
        };

        traverse(targetRoot);
        createFatLinesFromGroups(featureRoot, targetRoot, geometryGroups);
        featureRoot.userData.hasQueuedFatLine = false;
    }

    function scheduleRoadProcessing(root) {
        if (!root) return;
        if (root.userData?.hasQueuedFatLine) return;

        root.userData = root.userData || {};
        root.userData.hasQueuedFatLine = true;

        const attemptProcess = () => {
            if (!root.parent) {
                requestAnimationFrame(attemptProcess);
                return;
            }
            processRoadTileRoot(root);
        };

        requestAnimationFrame(attemptProcess);
    }

    function rebuildAllRoadTiles() {
        if (rebuildPending) return;
        rebuildPending = true;

        const entries = Array.from(RoadTileAnchors.entries());
        RoadTileAnchors.clear();
        for (const [, entry] of entries) {
            cleanupAnchorEntry(entry);
            const featureRoot = entry.featureRoot;
            if (!featureRoot) continue;

            if (featureRoot.userData) {
                delete featureRoot.userData.roadTileKey;
                delete featureRoot.userData.roadAnchor;
                delete featureRoot.userData.fatLines;
            }

            resetProcessedFlag(featureRoot);
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

    function triggerUpdate() {
        applyGlobalStateToMaterials();
    }

    return {
        RoadFatLines,
        RoadTileAnchors,
        scheduleRoadProcessing,
        rebuildAllRoadTiles,
        applyFrustumCullingState,
        triggerUpdate,
        applyGlobalStateToMaterials,
        syncMaterialResolutions,
        notifyRoadLayers,
    };
}
