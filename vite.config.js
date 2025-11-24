import { defineConfig } from 'vite';
import fs from 'fs';
export default defineConfig({
    base: '/itowns-stereographic-shader/',
    build: {
        outDir: 'docs',
    },
    server: {
        host: '0.0.0.0',
        https: {
            key: fs.readFileSync('localhost-key.pem'),
            cert: fs.readFileSync('localhost.pem')
        }
    },
    resolve: { dedupe: ['three'] },
    optimizeDeps: { include: ['three', 'three/addons/lines/Line2.js', 'three/addons/lines/LineMaterial.js', 'three/addons/lines/LineGeometry.js', 'three/addons/lines/LineSegments2.js', 'three/addons/lines/LineSegmentsGeometry.js'] }
});
