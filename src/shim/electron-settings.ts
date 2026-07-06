/**
 * Virtual `electron-settings` module. Persists a flat key/value JSON file on
 * disk (under the plugin folder). Exposes methods BOTH as a default export
 * (`import settings from 'electron-settings'`) and as named exports, so CJS
 * `require('electron-settings').get(...)` (used by pileEmbeddings.js) also
 * resolves the methods off the module namespace.
 */
import fs from "fs";

let filePath = "";
let cache: Record<string, any> = {};

export function __init(path: string) {
  filePath = path;
  try {
    cache = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    cache = {};
  }
}

function persist() {
  if (!filePath) return;
  try {
    fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), "utf8");
  } catch (e) {
    console.error("[pile] failed to persist settings", e);
  }
}

export async function get(key: string) {
  return cache[key];
}
export async function set(key: string, value: any) {
  cache[key] = value;
  persist();
}
export async function unset(key: string) {
  delete cache[key];
  persist();
}
export async function has(key: string) {
  return Object.prototype.hasOwnProperty.call(cache, key);
}
export function getSync(key: string) {
  return cache[key];
}
export function setSync(key: string, value: any) {
  cache[key] = value;
  persist();
}

const settings = { get, set, unset, has, getSync, setSync };
export default settings;
