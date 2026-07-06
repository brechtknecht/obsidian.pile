/**
 * Boots the vendored Pile app inside an Obsidian container element.
 * - Builds window.electron backed by Node fs (Pile paths are real disk paths).
 * - Seeds piles.json so PilesContext resolves our vault folder as the pile.
 * - Registers Pile's real ipcMain handlers (import side-effects).
 * - Mounts the vendored <App/> under a MemoryRouter at /pile/<name>.
 */
import fs from "fs";
import path from "path";

import { __init as initSettings } from "./shim/electron-settings";
import { ipcRenderer } from "./shim/electron";

export interface MountOptions {
  container: HTMLElement;
  pluginDir: string; // absolute path to this plugin's folder
  vaultBase: string; // absolute path to the vault root
  pileFolder: string; // vault-relative folder that is the pile
  pileName: string; // display name / route param
}

function buildElectronBridge(configPath: string) {
  return {
    ipc: {
      invoke: (channel: string, ...args: any[]) =>
        ipcRenderer.invoke(channel, ...args),
      on: (channel: string, func: (...args: any[]) => void) => {
        const listener = (_e: any, ...args: any[]) => func(...args);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.removeListener(channel, listener);
      },
      once: (channel: string, func: (...args: any[]) => void) =>
        ipcRenderer.once(channel, (_e: any, ...args: any[]) => func(...args)),
      sendMessage: (channel: string, ...args: any[]) =>
        ipcRenderer.send(channel, ...args),
      removeListener: (channel: string, func: any) =>
        ipcRenderer.removeListener(channel, func),
      removeAllListeners: (channel: string) =>
        ipcRenderer.removeAllListeners(channel),
    },
    getConfigPath: () => configPath,
    openFolder: (folderPath: string) => {
      if (folderPath.startsWith("/")) {
        try {
          (window as any).require?.("electron")?.shell?.openPath(folderPath);
        } catch {
          /* ignore */
        }
      }
    },
    existsSync: (p: string) => fs.existsSync(p),
    readDir: (p: string, cb: any) => fs.readdir(p, cb),
    isDirEmpty: (p: string) => {
      try {
        return fs.readdirSync(p).length === 0;
      } catch {
        return true;
      }
    },
    readFile: (p: string, cb: any) => fs.readFile(p, "utf-8", cb),
    deleteFile: (p: string, cb: any) => fs.unlink(p, cb),
    writeFile: (p: string, data: any, cb: any) =>
      fs.writeFile(p, data, "utf-8", cb),
    mkdir: (p: string) => fs.promises.mkdir(p, { recursive: true }),
    getFiles: async (dir: string) => {
      // Pile expects a flat listing of entries for a directory.
      try {
        return fs.readdirSync(dir);
      } catch {
        return [];
      }
    },
    joinPath: (...args: string[]) => path.join(...args),
    // Real disk path of a pasted/dropped File, if it has one (empty string
    // for bitmap-only clipboard data like macOS screenshots).
    getPathForFile: (file: File): string => {
      try {
        const webUtils = (window as any).require?.("electron")?.webUtils;
        const viaUtils = webUtils?.getPathForFile?.(file);
        if (viaUtils) return viaUtils;
      } catch {
        /* fall through */
      }
      return (file as any).path || "";
    },
    isMac: process.platform === "darwin",
    isWindows: process.platform === "win32",
    pathSeparator: path.sep,
    settingsGet: (key: string) => ipcRenderer.invoke("electron-store-get", key),
    settingsSet: (key: string, value: any) =>
      ipcRenderer.invoke("electron-store-set", key, value),
  };
}

export async function mountPile(opts: MountOptions): Promise<() => void> {
  const { container, pluginDir, vaultBase, pileFolder, pileName } = opts;

  (globalThis as any).__PILE_HOME__ = vaultBase;

  // App settings + AI key store live under the plugin folder.
  initSettings(path.join(pluginDir, "pile-settings.json"));

  const pileAbsPath = path.join(vaultBase, pileFolder);
  fs.mkdirSync(pileAbsPath, { recursive: true });

  const configPath = path.join(pluginDir, "piles.json");
  seedConfig(configPath, pileName, pileAbsPath);

  // IMPORTANT: merge, do NOT replace. Obsidian itself reads
  // window.electron.remote.getCurrentWebContents() during startup; clobbering
  // the whole object crashes Obsidian. Preserve prior props, add Pile's.
  const prevElectron = (window as any).electron;
  (window as any).electron = {
    ...(prevElectron || {}),
    ...buildElectronBridge(configPath),
  };

  // Dynamic imports so a throw in the vendored tree is caught here (and
  // surfaced) rather than crashing Obsidian at plugin-load time.
  const { StrictMode, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { MemoryRouter } = await import("react-router-dom");

  // Register Pile's real ipcMain handlers (side-effect imports).
  await import("./vendor/main/handlers/file");
  await import("./vendor/main/handlers/index");
  await import("./vendor/main/handlers/tags");
  await import("./vendor/main/handlers/highlights");
  await import("./vendor/main/handlers/links");
  await import("./vendor/main/handlers/keys");
  await import("./vendor/main/handlers/store");

  const App = (await import("./vendor/renderer/App")).default;

  const root = createRoot(container);
  root.render(
    createElement(
      StrictMode,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: [`/pile/${encodeURIComponent(pileName)}`] },
        // .pile-host marks the page tree so layout containment CSS can
        // target it without also hitting Radix portals mounted on the root.
        createElement("div", { className: "pile-host" }, createElement(App))
      )
    )
  );

  return () => {
    root.unmount();
    (window as any).electron = prevElectron;
  };
}

function seedConfig(configPath: string, name: string, pilePath: string) {
  let piles: Array<{ name: string; path: string }> = [];
  try {
    piles = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    piles = [];
  }
  const existing = piles.find((p) => p.name === name);
  if (existing) {
    existing.path = pilePath; // keep path in sync if vault moved
  } else {
    piles.unshift({ name, path: pilePath });
  }
  fs.writeFileSync(configPath, JSON.stringify(piles), "utf8");
}
