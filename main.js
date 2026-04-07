import { setupView } from './src/view/setupView.js';
import { applyPersistedRoadGlobalState } from './src/roads/state.js';
import { initProjection } from './src/projection/index.js';
import { initRoadRenderer } from './src/roads/renderer.js';
import { initPlaceSearch } from './src/ui/search.js';

const { view, viewerDiv, roadFatLineRoot } = setupView();

applyPersistedRoadGlobalState();
initProjection(view, viewerDiv);
initPlaceSearch(view);
initRoadRenderer(view, roadFatLineRoot);
