import { RoadGlobalState, RoadUIStorage } from './state.js';
import {
    applyPanelStyle,
    ensureUIPanelStyles,
    TOGGLE_LABEL_STYLE,
    TOGGLE_TEXT_STYLE,
    UI_BUTTON_STYLE,
} from '../ui/panelStyles.js';

function createPathListRow(path, gpxPathsManager) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.padding = '4px 0';
    row.style.borderBottom = '1px solid rgba(90, 98, 123, 0.35)';

    const swatch = document.createElement('span');
    swatch.style.width = '10px';
    swatch.style.height = '10px';
    swatch.style.borderRadius = '999px';
    swatch.style.border = '1px solid rgba(255,255,255,0.45)';
    swatch.style.background = path.color || '#ffffff';

    const name = document.createElement('span');
    name.textContent = path.name || path.id;
    name.style.flex = '1';
    name.style.minWidth = '0';
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    name.style.whiteSpace = 'nowrap';
    name.style.fontSize = '12px';

    const visibleToggle = document.createElement('input');
    visibleToggle.type = 'checkbox';
    visibleToggle.checked = path.visible !== false;
    visibleToggle.title = 'Toggle visibility';
    visibleToggle.addEventListener('change', (event) => {
        gpxPathsManager.setPathVisible(path.id, event.target.checked);
    });

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = 'Delete';
    removeButton.style.cssText = `${UI_BUTTON_STYLE}width:auto;padding:2px 8px;font-size:11px;line-height:1.3;`;
    removeButton.addEventListener('click', () => {
        gpxPathsManager.deletePath(path.id);
    });

    row.appendChild(swatch);
    row.appendChild(name);
    row.appendChild(visibleToggle);
    row.appendChild(removeButton);
    return row;
}

export function createRoadsUI({
    roadLayers,
    notifyRoadLayers,
    setRoadVisibility,
    triggerUpdate,
    applyFrustumCullingState,
    rebuildAllRoadTiles,
    applyGlobalStateToMaterials,
    gpxPathsManager,
    clearLoadedRoadData,
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

        <div style="display:flex; flex-direction:column; gap:6px; padding-top:6px; border-top:1px solid #4b5066;">
            <button id="ui-clear-roads-cache" type="button" style="${UI_BUTTON_STYLE}width:100%;text-align:center;">Clear Loaded Roads Cache</button>
            <div style="font-size:11px; color:#b9bfd6; opacity:0.9;">
                Flushes loaded road tiles and fat-line geometry, then reloads only the current area.
            </div>
        </div>

        <label style="${TOGGLE_LABEL_STYLE}">
            <input type="checkbox" id="ui-worldunits" ${RoadGlobalState.useWorldUnits ? 'checked' : ''} style="${checkboxStyle}">
            <span style="${TOGGLE_TEXT_STYLE}">World Units (Meters)</span>
        </label>
        <label style="${TOGGLE_LABEL_STYLE}">
            <input type="checkbox" id="ui-worldunits-source-distance" ${RoadGlobalState.worldUnitsUseSourceDistance ? 'checked' : ''} style="${checkboxStyle}">
            <span style="${TOGGLE_TEXT_STYLE}">Projected Width Uses Source Distance</span>
        </label>

        <div style="margin-top:8px; padding-top:8px; border-top:1px solid #4b5066; display:flex; flex-direction:column; gap:6px;">
            <div style="font-weight:bold; font-size:13px;">GPX Paths</div>
            <div style="display:flex; flex-direction:column; gap:4px;">
                <div style="display:flex; justify-content:space-between;">
                    <span>Paths Width Multiplier</span>
                    <span id="ui-path-width-val">${RoadGlobalState.pathsWidthMultiplier.toFixed(1)}x</span>
                </div>
                <input type="range" id="ui-path-width" min="0.1" max="5" step="0.1" value="${RoadGlobalState.pathsWidthMultiplier}">
            </div>
            <label style="${TOGGLE_LABEL_STYLE}">
                <input type="checkbox" id="ui-path-projection" ${RoadGlobalState.pathsUseProjection ? 'checked' : ''} style="${checkboxStyle}">
                <span style="${TOGGLE_TEXT_STYLE}">Apply Projection To Paths</span>
            </label>
            <div style="font-size:11px; color:#b9bfd6; opacity:0.9;">
                Drag & drop .gpx files onto the page to import paths.
            </div>
            <div id="ui-paths-list" style="max-height:170px; overflow-y:auto; border:1px solid rgba(95, 104, 130, 0.5); border-radius:6px; padding:6px;"></div>
        </div>
        
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
    const clearRoadsCacheButton = document.getElementById('ui-clear-roads-cache');
    const worldUnitsInput = document.getElementById('ui-worldunits');
    const worldUnitsSourceDistanceInput = document.getElementById('ui-worldunits-source-distance');
    const pathWidthSlider = document.getElementById('ui-path-width');
    const pathWidthLabel = document.getElementById('ui-path-width-val');
    const pathProjectionInput = document.getElementById('ui-path-projection');
    const pathsList = document.getElementById('ui-paths-list');

    const renderPathsList = (paths = []) => {
        if (!pathsList) return;
        pathsList.innerHTML = '';

        if (!gpxPathsManager) {
            const empty = document.createElement('div');
            empty.textContent = 'GPX path manager unavailable.';
            empty.style.fontSize = '12px';
            empty.style.opacity = '0.8';
            pathsList.appendChild(empty);
            return;
        }

        if (!paths.length) {
            const empty = document.createElement('div');
            empty.textContent = 'No imported paths yet.';
            empty.style.fontSize = '12px';
            empty.style.opacity = '0.8';
            pathsList.appendChild(empty);
            return;
        }

        for (const path of paths) {
            pathsList.appendChild(createPathListRow(path, gpxPathsManager));
        }
    };

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
    worldUnitsSourceDistanceInput.checked = RoadGlobalState.worldUnitsUseSourceDistance;
    pathWidthSlider.value = RoadGlobalState.pathsWidthMultiplier;
    pathWidthLabel.innerText = RoadGlobalState.pathsWidthMultiplier.toFixed(1) + 'x';
    pathProjectionInput.checked = RoadGlobalState.pathsUseProjection;

    const setAsyncButtonState = (button, busy, idleText, busyText) => {
        if (!button) return;
        button.disabled = busy;
        button.textContent = busy ? busyText : idleText;
        button.style.opacity = busy ? '0.7' : '1';
        button.style.cursor = busy ? 'progress' : 'pointer';
    };

    const syncRoadVisibility = () => {
        if (typeof setRoadVisibility === 'function') {
            setRoadVisibility(RoadGlobalState.visible);
            return;
        }

        for (const layer of roadLayers) {
            layer.object3d.visible = RoadGlobalState.visible;
        }
        if (typeof notifyRoadLayers === 'function') {
            notifyRoadLayers();
        }
    };

    syncRoadVisibility();

    if (gpxPathsManager?.subscribe) {
        gpxPathsManager.subscribe((paths) => {
            renderPathsList(paths);
        });
    } else {
        renderPathsList([]);
    }

    visibleInput.addEventListener('change', (e) => {
        RoadGlobalState.visible = e.target.checked;
        RoadUIStorage.save({ visible: RoadGlobalState.visible });
        syncRoadVisibility();
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
        triggerUpdate();
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
        triggerUpdate();
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

    clearRoadsCacheButton?.addEventListener('click', async () => {
        if (typeof clearLoadedRoadData !== 'function' || clearRoadsCacheButton.disabled) {
            return;
        }

        setAsyncButtonState(
            clearRoadsCacheButton,
            true,
            'Clear Loaded Roads Cache',
            'Clearing Roads Cache...',
        );

        try {
            await clearLoadedRoadData();
        } catch (error) {
            console.error('[RoadUI] Failed to clear loaded roads cache', error);
        } finally {
            setAsyncButtonState(
                clearRoadsCacheButton,
                false,
                'Clear Loaded Roads Cache',
                'Clearing Roads Cache...',
            );
        }
    });

    worldUnitsInput.addEventListener('change', (e) => {
        RoadGlobalState.useWorldUnits = e.target.checked;
        RoadUIStorage.save({ useWorldUnits: RoadGlobalState.useWorldUnits });
        triggerUpdate();
    });

    worldUnitsSourceDistanceInput.addEventListener('change', (e) => {
        RoadGlobalState.worldUnitsUseSourceDistance = e.target.checked;
        RoadUIStorage.save({ worldUnitsUseSourceDistance: RoadGlobalState.worldUnitsUseSourceDistance });
        triggerUpdate();
    });

    pathWidthSlider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        pathWidthLabel.innerText = `${v.toFixed(1)}x`;
        RoadGlobalState.pathsWidthMultiplier = v;
        RoadUIStorage.save({ pathsWidthMultiplier: RoadGlobalState.pathsWidthMultiplier });
        triggerUpdate();
    });

    pathProjectionInput.addEventListener('change', (e) => {
        RoadGlobalState.pathsUseProjection = e.target.checked;
        RoadUIStorage.save({ pathsUseProjection: RoadGlobalState.pathsUseProjection });
        triggerUpdate();
    });
}
