import {defineConfig} from 'vite';
// Relative URLs support both username.github.io/repository/ and localhost.
// Deliberately do not add COOP/COEP: GitHub Pages cannot set those headers,
// and this application uses single-threaded WASM (no SharedArrayBuffer).
export default defineConfig({
  base: './',
  server: {host:'0.0.0.0',port:5173},
  preview: {host:'0.0.0.0',port:4173},
  build: {target:'esnext'}
});
