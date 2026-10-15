import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('./',import.meta.url)),build:{outDir:'../dist/dashboard/public',emptyOutDir:true},server:{host:'127.0.0.1'}});
