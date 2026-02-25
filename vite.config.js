import { defineConfig } from 'vite';
import fs from 'fs';

export default defineConfig(({ command }) => {
    const hasLocalCerts = fs.existsSync('localhost-key.pem') && fs.existsSync('localhost.pem');

    return {
        base: '/itowns-stereographic-shader/',
        build: {
            outDir: 'dist',
        },
        server: {
            host: '0.0.0.0',
            ...(command === 'serve' && hasLocalCerts
                ? {
                    https: {
                        key: fs.readFileSync('localhost-key.pem'),
                        cert: fs.readFileSync('localhost.pem'),
                    },
                }
                : {}),
        },
        resolve: { dedupe: ['three'] },
        optimizeDeps: {
            include: [
                'three',
                'three/addons/lines/Line2.js',
                'three/addons/lines/LineMaterial.js',
                'three/addons/lines/LineGeometry.js',
                'three/addons/lines/LineSegments2.js',
                'three/addons/lines/LineSegmentsGeometry.js',
            ],
        },
    };
});
