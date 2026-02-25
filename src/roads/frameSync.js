import * as itowns from 'itowns';
import * as THREE from 'three';

import { RoadGlobalState } from './state.js';
import {
    SphereProjectionState,
    StereoUniforms,
    updateSphereBasisUniform,
} from '../projection/index.js';

const rendererSize = new THREE.Vector2();
let lastRendererWidth = -1;
let lastRendererHeight = -1;
let lastDevicePixelRatio = -1;
const tmpCamDir = new THREE.Vector3();

export function attachRoadFrameSync(view, {
    RoadTileAnchors,
    RoadFatLines,
    syncMaterialResolutions,
}) {
    view.addFrameRequester(itowns.MAIN_LOOP_EVENTS.BEFORE_RENDER, () => {
        const renderer = view.mainLoop.gfxEngine.renderer;
        const devicePixelRatio = (typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio))
            ? window.devicePixelRatio
            : 1;

        if (devicePixelRatio !== lastDevicePixelRatio) {
            renderer.setPixelRatio(devicePixelRatio);
            lastDevicePixelRatio = devicePixelRatio;
        }

        renderer.getSize(rendererSize);

        if (rendererSize.x !== lastRendererWidth || rendererSize.y !== lastRendererHeight) {
            lastRendererWidth = rendererSize.x;
            lastRendererHeight = rendererSize.y;
            RoadGlobalState.resolution.set(rendererSize.x, rendererSize.y);
            syncMaterialResolutions();
        }

        StereoUniforms.uCameraPos.value.copy(view.camera.camera3D.position);

        const sphereCtl = SphereProjectionState.controller;
        const active = sphereCtl && sphereCtl.hasGround && sphereCtl.hasGround();
        const useProjection = RoadGlobalState.useProjection && !!active;
        const useCull = RoadGlobalState.cullBackfaces && !!active;

        if (active) {
            const C = sphereCtl.mesh.position;
            const rawR = sphereCtl.mesh.scale.x;
            const R = Math.max(rawR, 1e-3);

            updateSphereBasisUniform();

            StereoUniforms.uSphereCenter.value.copy(C);
            StereoUniforms.uSphereR.value = R;
            StereoUniforms.uTwoR.value = 2 * R;
            StereoUniforms.uInv2R.value = 1.0 / (2 * R);

            tmpCamDir.copy(view.camera.camera3D.position).sub(C).normalize();
            StereoUniforms.uCameraDirFromCenter.value.copy(tmpCamDir);
        } else {
            StereoUniforms.uSphereCenter.value.set(0, 0, 0);
            StereoUniforms.uSphereR.value = -1.0;
            StereoUniforms.uTwoR.value = 0.0;
            StereoUniforms.uInv2R.value = 0.0;
            StereoUniforms.uCameraDirFromCenter.value.set(0, 0, 1);
            StereoUniforms.uSphereBasis.value.identity();
        }

        StereoUniforms.uProjectionStrength.value = useProjection ? 1.0 : 0.0;
        StereoUniforms.uCullBackfaces.value = useCull ? 1.0 : 0.0;

        for (const entry of RoadTileAnchors.values()) {
            const source = entry.sourceRoot;
            const anchor = entry.anchor;
            if (!source || !anchor) continue;
            if (source.parent) {
                if (source.matrixWorldNeedsUpdate || entry.needsSync) {
                    source.updateWorldMatrix(true, false);
                    anchor.matrix.copy(source.matrixWorld);
                    anchor.matrix.decompose(anchor.position, anchor.quaternion, anchor.scale);
                    anchor.updateMatrix();
                    anchor.updateMatrixWorld(true);
                    entry.needsSync = false;
                }
            } else {
                entry.sourceRoot = null;
                entry.needsSync = false;
            }
        }

        for (const obj of RoadFatLines) {
            if (!obj || !obj.material) continue;
            if (!obj.parent) {
                RoadFatLines.delete(obj);
            }
        }
    });
}
