const PANEL_BASE_STYLE = {
    position: 'absolute',
    zIndex: 100,
    background: '#171b2833',
    border: '1px solid #2e344a',
    borderRadius: '12px',
    padding: '14px 16px',
    color: '#fff',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '13px',
    minWidth: '240px',
    maxWidth: '270px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    boxShadow: '0 14px 40px rgba(0,0,0,0.35)',
    backdropFilter: 'blur(12px)',
};

export const UI_BUTTON_STYLE = 'padding:7px 12px;border-radius:6px;background:transparent;color:inherit;font-size:12px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;cursor:pointer;';
export const TOGGLE_LABEL_STYLE = 'display:flex;align-items:center;gap:10px;font-size:13px;';
export const TOGGLE_TEXT_STYLE = 'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

const UI_STYLE_TAG_ID = 'itowns-road-ui-styles';

export function applyPanelStyle(element, overrides = {}) {
    Object.assign(element.style, PANEL_BASE_STYLE, overrides);
}

export function ensureUIPanelStyles() {
    if (document.getElementById(UI_STYLE_TAG_ID)) return;
    const style = document.createElement('style');
    style.id = UI_STYLE_TAG_ID;
    style.textContent = `
    .itowns-ui-panel button {
        border: 1px solid #2e344a;
        background: rgba(58,61,79,0.45);
        color: #f4f7ff;
        transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .itowns-ui-panel button:hover {
        background: rgba(85, 101, 138, 0.7);
        border-color: #55618c;
    }
    .itowns-ui-panel button:active {
        background: #6573b5;
        border-color: #8797d5;
    }
    .itowns-ui-panel button.is-active {
        background: #5e6dd0;
        border-color: #8ea0ff;
        box-shadow: 0 0 12px rgba(102, 141, 255, 0.4);
        color: #fff;
    }
    .itowns-ui-panel input[type="checkbox"] {
        appearance: none;
        width: 17px;
        height: 17px;
        border-radius: 4px;
        border: 1px solid #4d5063;
        background: rgba(255,255,255,0.08);
        transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.25s ease;
        cursor: pointer;
    }
    .itowns-ui-panel input[type="checkbox"]:hover {
        border-color: #8aa4ff;
        box-shadow: 0 0 6px rgba(122, 149, 255, 0.35);
    }
    .itowns-ui-panel input[type="checkbox"]:checked {
        background: linear-gradient(135deg,#65c1ff,#5b7cff);
        border-color: #86b8ff;
        box-shadow: 0 0 8px rgba(87, 143, 255, 0.5);
    }
    .itowns-ui-panel input[type="range"] {
        -webkit-appearance: none;
        width: 100%;
        height: 6px;
        border-radius: 999px;
        background: rgba(255,255,255,0.22);
        outline: none;
        cursor: pointer;
    }
    .itowns-ui-panel input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 2px solid #8fb4ff;
        background: #fff;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
        transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
    }
    .itowns-ui-panel input[type="range"]:hover::-webkit-slider-thumb {
        transform: scale(1.08);
        border-color: #a7c6ff;
    }
    .itowns-ui-panel input[type="range"]::-moz-range-thumb {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 2px solid #8fb4ff;
        background: #fff;
        box-shadow: 0 2px 6px rgba(0,0,0,0.35);
        transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
    }
    .itowns-ui-panel input[type="range"]:hover::-moz-range-thumb {
        transform: scale(1.08);
        border-color: #a7c6ff;
    }
    `;
    document.head.appendChild(style);
}
