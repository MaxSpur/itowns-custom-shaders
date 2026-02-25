import { defineConfig } from 'vite';
import fs from 'fs';

function normalizeBasePath(input) {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    const cleaned = trimmed.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!cleaned) return '/';
    return `/${cleaned}/`;
}

function resolveBasePath(command) {
    if (command === 'serve') {
        return '/';
    }

    const explicitBase = normalizeBasePath(process.env.VITE_BASE_PATH);
    if (explicitBase) {
        return explicitBase;
    }

    const repo = process.env.GITHUB_REPOSITORY;
    if (repo) {
        const repoName = repo.split('/').pop();
        const derivedBase = normalizeBasePath(repoName);
        if (derivedBase) {
            return derivedBase;
        }
    }

    return '/';
}

export default defineConfig(({ command }) => {
    const hasLocalCerts = fs.existsSync('localhost-key.pem') && fs.existsSync('localhost.pem');

    return {
        base: resolveBasePath(command),
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
