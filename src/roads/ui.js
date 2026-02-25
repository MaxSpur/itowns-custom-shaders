import { RoadGlobalState, RoadUIStorage } from './state.js';
import {
    applyPanelStyle,
    ensureUIPanelStyles,
    TOGGLE_LABEL_STYLE,
    TOGGLE_TEXT_STYLE,
    UI_BUTTON_STYLE,
} from '../ui/panelStyles.js';

export function createRoadsUI({
    roadLayers,
    notifyRoadLayers,
    triggerUpdate,
    applyFrustumCullingState,
    rebuildAllRoadTiles,
    applyGlobalStateToMaterials,
}) {
    ensureUIPanelStyles();
    const panel = document.createElement('div');
    applyPanelStyle(panel, { right: '10px', top: '10px' });
    panel.classList.add('itowns-ui-panel');

    const checkboxStyle = '';
    panel.innerHTML = `
        <div style="font-weight:bold; font-size:14px; border-bottom:1px solid #4b5066; padding-bottom:5px;">
            Road Settings
        </div>
        
        <label style="${TOGGLE_LABEL_STYLE}">
            <input type="checkbox" id="ui-visible" ${RoadGlobalState.visible ? 'checked' : ''} style="${checkboxStyle}">
            <span style="${TOGGLE_TEXT_STYLE}">Visibility</span>
        </label>

        <label style="${TOGGLE_LABEL_STYLE}">
            <input type="checkbox" id="ui-ontop" ${RoadGlobalState.depthTest ? '' : 'checked'} style="${checkboxStyle}">
            <span style="${TOGGLE_TEXT_STYLE}">Always On Top (Ghost)</span>
        </label>

        <label style="${TOGGLE_LABEL_STYLE}">
            <input type="checkbox" id="ui-projection" ${RoadGlobalState.useProjection ? 'checked' : ''} style="${checkboxStyle}">
            <span style="${TOGGLE_TEXT_STYLE}">Stereographic Projection</span>
        </label>

        <label style="${TOGGLE_LABEL_STYLE}">
            <input type="checkbox" id="ui-cull" ${RoadGlobalState.cullBackfaces ? 'checked' : ''} style="${checkboxStyle}">
            <span style="${TOGGLE_TEXT_STYLE}">Cull Backfaces (Sphere)</span>
        </label>
        <label style="${TOGGLE_LABEL_STYLE}">
            <input type="checkbox" id="ui-nocull" ${RoadGlobalState.disableFrustumCulling ? 'checked' : ''} style="${checkboxStyle}">
            <span style="${TOGGLE_TEXT_STYLE}">Disable Frustum Culling</span>
        </label>
        <label style="${TOGGLE_LABEL_STYLE}">
            <input type="checkbox" id="ui-widths" ${RoadGlobalState.useIndividualWidths ? 'checked' : ''} style="${checkboxStyle}">
            <span style="${TOGGLE_TEXT_STYLE}">Per-Road Widths</span>
        </label>


        <div style="display:flex; flex-direction:column; gap:4px;">
            <div style="display:flex; justify-content:space-between;">
                <span>Width Multiplier</span>
                <span id="ui-width-val">${RoadGlobalState.widthMultiplier.toFixed(1)}x</span>
            </div>
            <input type="range" id="ui-width" min="0.1" max="5" step="0.1" value="${RoadGlobalState.widthMultiplier}">
        </div>

        <div style="display:flex; flex-direction:column; gap:4px;">
            <div style="display:flex; justify-content:space-between;">
                <span>Elevation Offset</span>
                <span id="ui-alt-val">${RoadGlobalState.altitudeOffset.toFixed(1)} m</span>
            </div>
            <input type="range" id="ui-alt" min="-50" max="50" step="0.5" value="${RoadGlobalState.altitudeOffset}">
        </div>

        <label style="${TOGGLE_LABEL_STYLE}">
            <input type="checkbox" id="ui-worldunits" ${RoadGlobalState.useWorldUnits ? 'checked' : ''} style="${checkboxStyle}">
            <span style="${TOGGLE_TEXT_STYLE}">World Units (Meters)</span>
        </label>
        
        <!--
        <button id="ui-debug" style="${UI_BUTTON_STYLE}width:100%;text-align:center;margin-top:6px;">Debug Console</button>
        -->
    `;
    document.body.appendChild(panel);

    const visibleInput = document.getElementById('ui-visible');
    const ghostInput = document.getElementById('ui-ontop');
    const projectionInput = document.getElementById('ui-projection');
    const cullInput = document.getElementById('ui-cull');
    const noCullInput = document.getElementById('ui-nocull');
    const widthsInput = document.getElementById('ui-widths');
    const widthSlider = document.getElementById('ui-width');
    const widthLabel = document.getElementById('ui-width-val');
    const altSlider = document.getElementById('ui-alt');
    const altLabel = document.getElementById('ui-alt-val');
    const worldUnitsInput = document.getElementById('ui-worldunits');

    visibleInput.checked = RoadGlobalState.visible;
    ghostInput.checked = !RoadGlobalState.depthTest;
    projectionInput.checked = RoadGlobalState.useProjection;
    cullInput.checked = RoadGlobalState.cullBackfaces;
    noCullInput.checked = RoadGlobalState.disableFrustumCulling;
    widthsInput.checked = RoadGlobalState.useIndividualWidths;
    widthSlider.value = RoadGlobalState.widthMultiplier;
    widthLabel.innerText = RoadGlobalState.widthMultiplier.toFixed(1) + 'x';
    altSlider.value = RoadGlobalState.altitudeOffset;
    altLabel.innerText = RoadGlobalState.altitudeOffset.toFixed(1) + ' m';
    worldUnitsInput.checked = RoadGlobalState.useWorldUnits;

    for (const layer of roadLayers) {
        layer.object3d.visible = RoadGlobalState.visible;
    }

    visibleInput.addEventListener('change', (e) => {
        RoadGlobalState.visible = e.target.checked;
        for (const layer of roadLayers) {
            layer.object3d.visible = RoadGlobalState.visible;
        }
        RoadUIStorage.save({ visible: RoadGlobalState.visible });
        notifyRoadLayers();
    });

    ghostInput.addEventListener('change', (e) => {
        RoadGlobalState.depthTest = !e.target.checked;
        RoadUIStorage.save({ depthTest: RoadGlobalState.depthTest });
        triggerUpdate();
    });

    projectionInput.addEventListener('change', (e) => {
        RoadGlobalState.useProjection = e.target.checked;
        RoadUIStorage.save({ useProjection: RoadGlobalState.useProjection });
        triggerUpdate();
    });

    cullInput.addEventListener('change', (e) => {
        RoadGlobalState.cullBackfaces = e.target.checked;
        RoadUIStorage.save({ cullBackfaces: RoadGlobalState.cullBackfaces });
        notifyRoadLayers();
    });

    noCullInput.addEventListener('change', (e) => {
        RoadGlobalState.disableFrustumCulling = e.target.checked;
        RoadUIStorage.save({ disableFrustumCulling: RoadGlobalState.disableFrustumCulling });
        applyFrustumCullingState();
    });

    widthsInput.addEventListener('change', (e) => {
        RoadGlobalState.useIndividualWidths = e.target.checked;
        RoadUIStorage.save({ useIndividualWidths: RoadGlobalState.useIndividualWidths });
        rebuildAllRoadTiles();
        applyGlobalStateToMaterials();
    });

    widthSlider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        widthLabel.innerText = v.toFixed(1) + 'x';
        RoadGlobalState.widthMultiplier = v;
        RoadUIStorage.save({ widthMultiplier: RoadGlobalState.widthMultiplier });
        triggerUpdate();
    });

    altSlider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        altLabel.innerText = v.toFixed(1) + ' m';
        RoadGlobalState.altitudeOffset = v;
        RoadUIStorage.save({ altitudeOffset: RoadGlobalState.altitudeOffset });
        rebuildAllRoadTiles();
    });

    worldUnitsInput.addEventListener('change', (e) => {
        RoadGlobalState.useWorldUnits = e.target.checked;
        RoadUIStorage.save({ useWorldUnits: RoadGlobalState.useWorldUnits });
        triggerUpdate();
    });
}
