import * as THREE from 'three';

export const ROAD_COLOR = {
    'Type autoroutier': '#2E86FF',
    'Route à 2 chaussées': '#FF4D4D',
    'Route à 1 chaussée': '#FFC400',
    'Bretelle': '#00C8FF',
    'Rond-point': '#BBBBBB',
    'Chemin': '#f6ff75',
    'Route empierrée': '#FF9100',
    'Sentier': '#00E676',
    'Escalier': '#FFFFFF',
};

export const ROAD_WIDTH_BASE = {
    'Type autoroutier': 10,
    'Route à 2 chaussées': 8,
    'Route à 1 chaussée': 5,
    'Bretelle': 4,
    'Rond-point': 6,
    'Chemin': 2,
    'Route empierrée': 2,
    'Sentier': 1.5,
    'Escalier': 1,
};

const RoadFeatureRegistry = {
    keyToBatchId: new Map(),
    widthByBatchId: new Map(),
    nextBatchId: 0,
};

export function getFeatureKey(props = {}) {
    return props.id || props.ID || props.pk || props.pkuid || props.id_troncon || props.numero || props.gid || props.IDENT || props.CODE || null;
}

export function registerRoadFeature(props = {}) {
    const key = getFeatureKey(props);
    let batchId;
    if (key) {
        if (RoadFeatureRegistry.keyToBatchId.has(key)) {
            batchId = RoadFeatureRegistry.keyToBatchId.get(key);
        } else {
            batchId = RoadFeatureRegistry.nextBatchId++;
            RoadFeatureRegistry.keyToBatchId.set(key, batchId);
        }
    } else {
        batchId = RoadFeatureRegistry.nextBatchId++;
    }
    const width = ROAD_WIDTH_BASE[props.nature] || 2;
    RoadFeatureRegistry.widthByBatchId.set(batchId, width);
    return batchId;
}

export function getWidthForBatch(batchId) {
    return RoadFeatureRegistry.widthByBatchId.get(batchId);
}

export const RoadGlobalState = {
    visible: true,
    widthMultiplier: 2.0,
    pathsWidthMultiplier: 1.0,
    useWorldUnits: false,
    depthTest: true,
    altitudeOffset: 5.0,
    resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
    useProjection: true,
    pathsUseProjection: true,
    cullBackfaces: false,
    disableFrustumCulling: false,
    useIndividualWidths: true,
};

const ROAD_UI_STORAGE_KEY = 'itowns-road-ui-v1';

export const RoadUIStorage = (() => {
    let cache = {};
    if (typeof window !== 'undefined' && window.localStorage) {
        try {
            const raw = window.localStorage.getItem(ROAD_UI_STORAGE_KEY);
            if (raw) {
                cache = JSON.parse(raw) || {};
            }
        } catch (err) {
            console.warn('Failed to parse stored road UI state', err);
            cache = {};
        }
    }

    return {
        get() {
            return cache;
        },
        save(patch = {}) {
            cache = { ...cache, ...patch };
            if (typeof window !== 'undefined' && window.localStorage) {
                try {
                    window.localStorage.setItem(ROAD_UI_STORAGE_KEY, JSON.stringify(cache));
                } catch (err) {
                    console.warn('Failed to persist road UI state', err);
                }
            }
        },
    };
})();

export function applyPersistedRoadGlobalState() {
    const saved = RoadUIStorage.get();
    if (!saved) return;
    if ('visible' in saved) RoadGlobalState.visible = !!saved.visible;
    if ('widthMultiplier' in saved && Number.isFinite(saved.widthMultiplier)) RoadGlobalState.widthMultiplier = saved.widthMultiplier;
    if ('pathsWidthMultiplier' in saved && Number.isFinite(saved.pathsWidthMultiplier)) RoadGlobalState.pathsWidthMultiplier = saved.pathsWidthMultiplier;
    if ('useWorldUnits' in saved) RoadGlobalState.useWorldUnits = !!saved.useWorldUnits;
    if ('depthTest' in saved) RoadGlobalState.depthTest = !!saved.depthTest;
    if ('altitudeOffset' in saved && Number.isFinite(saved.altitudeOffset)) RoadGlobalState.altitudeOffset = saved.altitudeOffset;
    if ('useProjection' in saved) RoadGlobalState.useProjection = !!saved.useProjection;
    if ('pathsUseProjection' in saved) RoadGlobalState.pathsUseProjection = !!saved.pathsUseProjection;
    if ('cullBackfaces' in saved) RoadGlobalState.cullBackfaces = !!saved.cullBackfaces;
    if ('disableFrustumCulling' in saved) RoadGlobalState.disableFrustumCulling = !!saved.disableFrustumCulling;
    if ('useIndividualWidths' in saved) RoadGlobalState.useIndividualWidths = !!saved.useIndividualWidths;
}

export function getPersistedSphereSettings() {
    const saved = RoadUIStorage.get() || {};
    const defaults = { radius: 1000, offset01: 1.0, opacity: 0.54, coneHeightMul: 1.0 };
    return {
        radius: Number.isFinite(saved.sphereRadius) ? saved.sphereRadius : defaults.radius,
        offset01: Number.isFinite(saved.sphereOffset) ? saved.sphereOffset : defaults.offset01,
        opacity: Number.isFinite(saved.sphereOpacity) ? saved.sphereOpacity : defaults.opacity,
        coneHeightMul: Number.isFinite(saved.sphereConeHeightMul) ? saved.sphereConeHeightMul : defaults.coneHeightMul,
    };
}
