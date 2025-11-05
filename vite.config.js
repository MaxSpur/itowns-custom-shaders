import { defineConfig } from 'vite';
import fs from 'fs';
export default defineConfig({
    base: '/itowns-stereographic-shader/',
    server: {
        host: '0.0.0.0',
        https: {
            key: fs.readFileSync('localhost-key.pem'),
            cert: fs.readFileSync('localhost.pem')
        }
    }
});
