import { setupView } from './src/view/setupView.js';
import { applyPersistedRoadGlobalState } from './src/roads/state.js';
import { initProjection } from './src/projection/index.js';
import { initRoadRenderer } from './src/roads/renderer.js';

const { view, viewerDiv, roadFatLineRoot } = setupView();

applyPersistedRoadGlobalState();
initProjection(view, viewerDiv);
initRoadRenderer(view, roadFatLineRoot);
