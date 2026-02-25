import * as THREE from 'three';

function isFinite3(x, y, z) {
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}

function isNearOrigin(x, y, z) {
    return Math.abs(x) < 1.0 && Math.abs(y) < 1.0 && Math.abs(z) < 1.0;
}

export function getFeatureProperties(object) {
    let obj = object;
    while (obj) {
        if (obj.userData?.feature?.properties) return obj.userData.feature.properties;
        if (obj.feature?.properties) return obj.feature.properties;
        obj = obj.parent;
    }
    return {};
}

export function getFeatureTileKey(featureRoot) {
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

export function createRoadGeometryProcessor({
    ROAD_COLOR,
    ROAD_WIDTH_BASE,
    RoadGlobalState,
    getWidthForBatch,
}) {
    const scratchVecA = new THREE.Vector3();
    const scratchVecB = new THREE.Vector3();
    const scratchMatrix = new THREE.Matrix4();
    const scratchRootInverse = new THREE.Matrix4();

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

    function collectGeometryGroupsForFeatureRoot(featureRoot) {
        if (!featureRoot) {
            return {
                targetRoot: null,
                groups: new Map(),
            };
        }

        const targetRoot = featureRoot.meshes || featureRoot;

        featureRoot.updateWorldMatrix(true, true);
        targetRoot.updateWorldMatrix(true, true);

        const frustumState = !RoadGlobalState.disableFrustumCulling;
        targetRoot.frustumCulled = frustumState;
        featureRoot.frustumCulled = frustumState;

        const groups = new Map();
        const targetInverse = scratchRootInverse.copy(targetRoot.matrixWorld).invert();

        const traverse = (node) => {
            if (!node || node.userData?.isFatLine) return;

            const isLineLike = node.isMesh || node.isLine || node.isLineSegments;
            if (isLineLike && node.geometry && !node.userData?.hasProcessedFatLine) {
                const toTargetMatrix = scratchMatrix.copy(node.matrixWorld).premultiply(targetInverse);
                addMeshToGeometryGroups(node, groups, toTargetMatrix);
            }

            if (!node.children) return;
            for (const child of node.children) {
                traverse(child);
            }
        };

        traverse(targetRoot);
        return { targetRoot, groups };
    }

    function resetProcessedFlag(root, roadFatLines) {
        root.traverse((node) => {
            if (!node.userData) return;
            delete node.userData.hasProcessedFatLine;
            if (node.userData.isFatLine && node.parent) {
                node.parent.remove(node);
                const geometry = node.geometry;
                if (geometry && typeof geometry.dispose === 'function') {
                    geometry.dispose();
                }
                roadFatLines.delete(node);
            }
        });
    }

    return {
        resetProcessedFlag,
        collectGeometryGroupsForFeatureRoot,
    };
}
