// node --import ./dev/node-hook.mjs script.mjs  — resolves 'three' like the browser import map
import { register } from 'node:module';
register('./node-resolve.mjs', import.meta.url);
