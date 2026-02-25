import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export function createRoadMaterialManager({
    RoadGlobalState,
    makeStereoProjectMaterial,
}) {
    const tempColor = new THREE.Color();
    const roadMaterialCache = new Map();

    function getRoadMaterial(baseWidth, hasColors, colorHex, isDefaultMode) {
        const key = `${baseWidth}|${hasColors ? 1 : 0}|${colorHex}|${isDefaultMode ? 1 : 0}`;
        let material = roadMaterialCache.get(key);
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
        roadMaterialCache.set(key, material);
        return material;
    }

    function syncMaterialResolutions() {
        for (const mat of roadMaterialCache.values()) {
            if (!mat?.resolution) continue;
            mat.resolution.copy(RoadGlobalState.resolution);
        }
    }

    function applyGlobalStateToMaterials({
        roadFatLines,
        notifyRoadLayers,
        view,
    }) {
        for (const mat of roadMaterialCache.values()) {
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

        for (const obj of roadFatLines) {
            if (!obj) continue;
            obj.renderOrder = RoadGlobalState.depthTest ? 0 : 999;
            obj.position.z = RoadGlobalState.altitudeOffset;
            obj.updateMatrix();
        }

        notifyRoadLayers();
        view.notifyChange(true);
    }

    return {
        getRoadMaterial,
        syncMaterialResolutions,
        applyGlobalStateToMaterials,
    };
}
