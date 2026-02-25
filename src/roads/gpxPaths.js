import * as itowns from 'itowns';
import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

import { makeStereoProjectMaterial } from '../projection/index.js';
import { ROAD_WIDTH_BASE, RoadGlobalState, RoadUIStorage } from './state.js';

const GPX_DEFAULT_BASE_WIDTH = ROAD_WIDTH_BASE.Chemin || 2;

function sanitizePoint(rawPoint) {
    let lat;
    let lon;
    let ele;
    if (Array.isArray(rawPoint)) {
        lat = Number(rawPoint[0]);
        lon = Number(rawPoint[1]);
        ele = Number(rawPoint[2]);
    } else {
        lat = Number(rawPoint?.lat);
        lon = Number(rawPoint?.lon);
        ele = Number(rawPoint?.ele);
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    return {
        lat,
        lon,
        ele: Number.isFinite(ele) ? ele : undefined,
        baseAltitude: undefined,
    };
}

function normalizeSegments(rawSegments) {
    if (!Array.isArray(rawSegments)) return [];
    const segments = [];
    for (const rawSegment of rawSegments) {
        if (!Array.isArray(rawSegment)) continue;
        const points = [];
        for (const rawPoint of rawSegment) {
            const point = sanitizePoint(rawPoint);
            if (point) points.push(point);
        }
        if (points.length >= 2) {
            segments.push(points);
        }
    }
    return segments;
}

function createPathId() {
    return `gpx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function colorForIndex(index) {
    const color = new THREE.Color();
    const golden = 0.618033988749895;
    color.setHSL((index * golden) % 1, 0.72, 0.56);
    return `#${color.getHexString()}`;
}

function getGpxFiles(fileList) {
    const files = Array.from(fileList || []);
    return files.filter((file) => {
        const name = file?.name?.toLowerCase?.() || '';
        const type = file?.type?.toLowerCase?.() || '';
        return name.endsWith('.gpx') || type.includes('gpx') || type.includes('xml');
    });
}

function parsePointNode(node) {
    const lat = Number(node.getAttribute('lat'));
    const lon = Number(node.getAttribute('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const eleNode = node.getElementsByTagName('ele')[0];
    const ele = eleNode ? Number(eleNode.textContent) : undefined;
    return {
        lat,
        lon,
        ele: Number.isFinite(ele) ? ele : undefined,
    };
}

function parseSegmentsFromNodeList(nodeList, pointTagName) {
    const segments = [];
    for (const segmentNode of Array.from(nodeList || [])) {
        const points = [];
        const pointNodes = segmentNode.getElementsByTagName(pointTagName);
        for (const pointNode of Array.from(pointNodes || [])) {
            const point = parsePointNode(pointNode);
            if (point) points.push(point);
        }
        if (points.length >= 2) segments.push(points);
    }
    return segments;
}

function parseGpxText(text, fileName) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, 'application/xml');
    if (xml.getElementsByTagName('parsererror').length > 0) {
        throw new Error(`Invalid GPX XML in ${fileName}`);
    }

    const nameNode = xml.getElementsByTagName('name')[0];
    const parsedName = (nameNode?.textContent || '').trim();
    const fallbackName = (fileName || 'Imported GPX').replace(/\.gpx$/i, '');
    const name = parsedName || fallbackName;

    let segments = parseSegmentsFromNodeList(xml.getElementsByTagName('trkseg'), 'trkpt');

    if (!segments.length) {
        const routeSegments = [];
        for (const routeNode of Array.from(xml.getElementsByTagName('rte') || [])) {
            const points = [];
            for (const pointNode of Array.from(routeNode.getElementsByTagName('rtept') || [])) {
                const point = parsePointNode(pointNode);
                if (point) points.push(point);
            }
            if (points.length >= 2) routeSegments.push(points);
        }
        segments = routeSegments;
    }

    if (!segments.length) {
        const waypointPoints = [];
        for (const waypoint of Array.from(xml.getElementsByTagName('wpt') || [])) {
            const point = parsePointNode(waypoint);
            if (point) waypointPoints.push(point);
        }
        if (waypointPoints.length >= 2) {
            segments = [waypointPoints];
        }
    }

    return {
        name,
        segments: normalizeSegments(segments),
    };
}

function serializePath(path) {
    return {
        id: path.id,
        name: path.name,
        color: path.color,
        visible: path.visible !== false,
        segments: path.segments.map((segment) => segment.map((point) => [
            point.lat,
            point.lon,
            Number.isFinite(point.ele) ? point.ele : null,
        ])),
    };
}

export function createGpxPathsManager(view, { roadFatLineRoot }) {
    const pathRoot = new THREE.Group();
    pathRoot.name = 'GPXPathRoot';
    pathRoot.userData.isGpxPathRoot = true;
    pathRoot.frustumCulled = !RoadGlobalState.disableFrustumCulling;
    roadFatLineRoot.add(pathRoot);

    const gpxPaths = new Map();
    const gpxPathLines = new Set();
    const materialCache = new Map();
    const listeners = new Set();
    const tempColor = new THREE.Color();
    const demReadMode = (itowns.DEMUtils && (itowns.DEMUtils.PRECISE_READ_Z || itowns.DEMUtils.FAST_READ_Z)) || 0;

    function notifyPathListChanged() {
        const summaries = getPathsSummary();
        for (const listener of listeners) {
            try {
                listener(summaries);
            } catch (err) {
                console.error('[GPXPaths] UI listener failed', err);
            }
        }
    }

    function persistPaths() {
        const serialized = Array.from(gpxPaths.values()).map((path) => serializePath(path));
        RoadUIStorage.save({ gpxPaths: serialized });
    }

    function getProjectionEnabledForPaths() {
        return !!(RoadGlobalState.useProjection && RoadGlobalState.pathsUseProjection);
    }

    function makeMaterialKey(baseWidth, projectionEnabled) {
        return `${baseWidth}|${projectionEnabled ? 1 : 0}`;
    }

    function getPathMaterial(baseWidth, projectionEnabled) {
        const key = makeMaterialKey(baseWidth, projectionEnabled);
        let material = materialCache.get(key);
        if (material) return material;

        material = new LineMaterial({
            color: 0xffffff,
            vertexColors: true,
            linewidth: baseWidth * RoadGlobalState.widthMultiplier * RoadGlobalState.pathsWidthMultiplier,
            worldUnits: RoadGlobalState.useWorldUnits,
            dashed: false,
            alphaToCoverage: false,
            depthTest: RoadGlobalState.depthTest,
            depthWrite: RoadGlobalState.depthTest,
            transparent: !RoadGlobalState.depthTest,
            resolution: RoadGlobalState.resolution,
            polygonOffset: RoadGlobalState.depthTest,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
        });

        material.userData = material.userData || {};
        material.userData.baseWidth = baseWidth;
        material.userData.projectionEnabled = projectionEnabled;

        if (projectionEnabled) {
            makeStereoProjectMaterial(material);
        }

        materialCache.set(key, material);
        return material;
    }

    function syncMaterialResolutions() {
        for (const material of materialCache.values()) {
            if (!material?.resolution) continue;
            material.resolution.copy(RoadGlobalState.resolution);
        }
    }

    function resolveBaseAltitude(point) {
        if (Number.isFinite(point.baseAltitude)) {
            return point.baseAltitude;
        }

        const fallback = Number.isFinite(point.ele) ? point.ele : 0;
        const tileLayer = view.tileLayer;
        if (!tileLayer || !itowns.DEMUtils) {
            if (Number.isFinite(point.ele)) {
                point.baseAltitude = fallback;
            }
            return fallback;
        }

        const coord = new itowns.Coordinates('EPSG:4326', point.lon, point.lat, fallback);
        const demAltitude = itowns.DEMUtils.getElevationValueAt(tileLayer, coord, demReadMode);
        if (Number.isFinite(demAltitude)) {
            point.baseAltitude = demAltitude;
            return demAltitude;
        }

        if (Number.isFinite(point.ele)) {
            point.baseAltitude = fallback;
        }
        return fallback;
    }

    function buildPathLine(path) {
        disposePathLines(path);

        const projectionEnabled = getProjectionEnabledForPaths();
        const baseWidth = GPX_DEFAULT_BASE_WIDTH;
        const material = getPathMaterial(baseWidth, projectionEnabled);

        const positions = [];
        const colors = [];
        tempColor.set(path.color || '#FFFFFF');
        const r = tempColor.r;
        const g = tempColor.g;
        const b = tempColor.b;

        for (const segment of path.segments) {
            const worldPoints = [];
            for (const point of segment) {
                const z = resolveBaseAltitude(point) + RoadGlobalState.altitudeOffset;
                const worldCoord = new itowns.Coordinates('EPSG:4326', point.lon, point.lat, z).as(view.referenceCrs);
                if (!Number.isFinite(worldCoord.x) || !Number.isFinite(worldCoord.y) || !Number.isFinite(worldCoord.z)) {
                    continue;
                }
                worldPoints.push(worldCoord);
            }

            for (let i = 1; i < worldPoints.length; i++) {
                const start = worldPoints[i - 1];
                const end = worldPoints[i];
                positions.push(
                    start.x, start.y, start.z,
                    end.x, end.y, end.z,
                );
                colors.push(
                    r, g, b,
                    r, g, b,
                );
            }
        }

        if (!positions.length) {
            path.lines = [];
            return;
        }

        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(positions);
        geometry.setColors(colors);

        const line = new LineSegments2(geometry, material);
        line.name = `GPXPathLine:${path.name}`;
        line.userData = line.userData || {};
        line.userData.isFatLine = true;
        line.userData.isGpxPathLine = true;
        line.userData.baseWidth = baseWidth;
        line.frustumCulled = !RoadGlobalState.disableFrustumCulling;
        line.renderOrder = RoadGlobalState.depthTest ? 0 : 999;

        path.group.add(line);
        path.lines = [line];
        gpxPathLines.add(line);
    }

    function disposePathLines(path) {
        if (!path || !Array.isArray(path.lines)) return;
        for (const line of path.lines) {
            if (!line) continue;
            if (line.parent) {
                line.parent.remove(line);
            }
            const geometry = line.geometry;
            if (geometry && typeof geometry.dispose === 'function') {
                geometry.dispose();
            }
            gpxPathLines.delete(line);
        }
        path.lines = [];
    }

    function createPathGroup(path) {
        const group = new THREE.Group();
        group.name = `GPXPath:${path.name}`;
        group.userData = group.userData || {};
        group.userData.pathId = path.id;
        group.frustumCulled = !RoadGlobalState.disableFrustumCulling;
        group.visible = path.visible !== false;
        pathRoot.add(group);
        path.group = group;
    }

    function addPath(pathData, { persist = true, emit = true } = {}) {
        const segments = normalizeSegments(pathData.segments);
        if (!segments.length) return null;

        const path = {
            id: pathData.id || createPathId(),
            name: pathData.name || `Path ${gpxPaths.size + 1}`,
            color: pathData.color || colorForIndex(gpxPaths.size),
            visible: pathData.visible !== false,
            segments,
            group: null,
            lines: [],
        };

        createPathGroup(path);
        buildPathLine(path);
        gpxPaths.set(path.id, path);

        if (persist) {
            persistPaths();
        }
        if (emit) {
            notifyPathListChanged();
        }

        return path;
    }

    function deletePath(pathId) {
        const path = gpxPaths.get(pathId);
        if (!path) return false;

        disposePathLines(path);
        if (path.group?.parent) {
            path.group.parent.remove(path.group);
        }
        gpxPaths.delete(pathId);

        persistPaths();
        notifyPathListChanged();
        view.notifyChange(true);
        return true;
    }

    function setPathVisible(pathId, visible) {
        const path = gpxPaths.get(pathId);
        if (!path) return false;
        path.visible = !!visible;
        if (path.group) {
            path.group.visible = path.visible;
        }
        persistPaths();
        notifyPathListChanged();
        view.notifyChange(true);
        return true;
    }

    function rebuildAllPaths() {
        for (const path of gpxPaths.values()) {
            buildPathLine(path);
            if (path.group) {
                path.group.visible = path.visible !== false;
            }
        }
        applyGlobalStateToPaths();
    }

    function applyGlobalStateToPaths() {
        const projectionEnabled = getProjectionEnabledForPaths();

        for (const material of materialCache.values()) {
            if (!material) continue;
            const base = material.userData?.baseWidth || GPX_DEFAULT_BASE_WIDTH;
            material.linewidth = base * RoadGlobalState.widthMultiplier * RoadGlobalState.pathsWidthMultiplier;
            material.worldUnits = RoadGlobalState.useWorldUnits;
            material.depthTest = RoadGlobalState.depthTest;
            material.depthWrite = RoadGlobalState.depthTest;
            material.transparent = !RoadGlobalState.depthTest;
            material.polygonOffset = RoadGlobalState.depthTest;
            material.needsUpdate = true;
        }

        for (const path of gpxPaths.values()) {
            if (!path.group) continue;
            path.group.visible = path.visible !== false;
            path.group.frustumCulled = !RoadGlobalState.disableFrustumCulling;

            for (const line of path.lines) {
                if (!line) continue;
                const base = line.userData?.baseWidth || GPX_DEFAULT_BASE_WIDTH;
                const desired = getPathMaterial(base, projectionEnabled);
                if (line.material !== desired) {
                    line.material = desired;
                }
                line.renderOrder = RoadGlobalState.depthTest ? 0 : 999;
                line.frustumCulled = !RoadGlobalState.disableFrustumCulling;
            }
        }

        view.notifyChange(true);
    }

    function applyFrustumCullingState() {
        const frustumCulled = !RoadGlobalState.disableFrustumCulling;
        pathRoot.frustumCulled = frustumCulled;
        for (const path of gpxPaths.values()) {
            if (path.group) {
                path.group.frustumCulled = frustumCulled;
            }
            for (const line of path.lines) {
                if (!line) continue;
                line.frustumCulled = frustumCulled;
            }
        }
        view.notifyChange(true);
    }

    function getPathsSummary() {
        return Array.from(gpxPaths.values()).map((path) => ({
            id: path.id,
            name: path.name,
            color: path.color,
            visible: path.visible !== false,
            segmentCount: path.segments.length,
        }));
    }

    function subscribe(callback) {
        if (typeof callback !== 'function') {
            return () => {};
        }
        listeners.add(callback);
        callback(getPathsSummary());
        return () => {
            listeners.delete(callback);
        };
    }

    async function importFiles(fileList) {
        const files = getGpxFiles(fileList);
        if (!files.length) return 0;

        let imported = 0;
        for (const file of files) {
            try {
                const text = await file.text();
                const parsed = parseGpxText(text, file.name || 'Dropped GPX');
                if (!parsed.segments.length) {
                    console.warn('[GPXPaths] No usable path segments found in file', file.name);
                    continue;
                }

                const path = addPath({
                    name: parsed.name,
                    color: colorForIndex(gpxPaths.size + imported),
                    visible: true,
                    segments: parsed.segments,
                }, { persist: false, emit: false });

                if (path) {
                    imported += 1;
                }
            } catch (err) {
                console.error(`[GPXPaths] Failed to import ${file.name}`, err);
            }
        }

        if (imported > 0) {
            persistPaths();
            notifyPathListChanged();
            applyGlobalStateToPaths();
        }

        return imported;
    }

    function handleDragOver(event) {
        if (!event?.dataTransfer) return;
        if (!Array.from(event.dataTransfer.types || []).includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    }

    async function handleDrop(event) {
        if (!event?.dataTransfer) return;
        const files = event.dataTransfer.files;
        if (!files || files.length === 0) return;
        event.preventDefault();
        await importFiles(files);
    }

    function loadPersistedPaths() {
        const saved = RoadUIStorage.get()?.gpxPaths;
        if (!Array.isArray(saved)) return;
        for (const raw of saved) {
            addPath({
                id: raw?.id,
                name: raw?.name,
                color: raw?.color,
                visible: raw?.visible,
                segments: raw?.segments,
            }, { persist: false, emit: false });
        }
        notifyPathListChanged();
    }

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    loadPersistedPaths();
    applyGlobalStateToPaths();

    return {
        pathRoot,
        pathLines: gpxPathLines,
        importFiles,
        getPathsSummary,
        subscribe,
        setPathVisible,
        deletePath,
        rebuildAllPaths,
        applyGlobalStateToPaths,
        applyFrustumCullingState,
        syncMaterialResolutions,
    };
}
