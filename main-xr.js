// main.js
import * as itowns from 'itowns';
import { VRButton } from 'three/addons/webxr/VRButton.js';

const placement = { coord: new itowns.Coordinates('EPSG:4326', 6.227, 45.167), range: 15000, tilt: 5, heading: 62 };
const view = new itowns.GlobeView(document.getElementById('viewerDiv'), placement, { webXR: { scale: 0.005 } });
document.body.appendChild(VRButton.createButton(view.renderer));