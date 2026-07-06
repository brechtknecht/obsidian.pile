/**
 * Virtual `electron` module. Pile's vendored main + renderer code imports
 * from 'electron'; esbuild aliases those imports here so the whole app runs
 * in-process inside Obsidian. ipcMain handlers register into a registry;
 * ipcRenderer.invoke dispatches to them; BrowserWindow.send + ipcRenderer.on
 * share one event bus.
 */
import { EventEmitter } from "events";

type Handler = (event: any, ...args: any[]) => any;

const handlers = new Map<string, Handler>();
const bus = new EventEmitter();
bus.setMaxListeners(0);

const senderEvent = {
  sender: { send: (ch: string, ...a: any[]) => bus.emit(ch, ...a) },
};

export const ipcMain = {
  handle(channel: string, fn: Handler) {
    handlers.set(channel, fn);
  },
  handleOnce(channel: string, fn: Handler) {
    handlers.set(channel, fn);
  },
  on(channel: string, fn: Handler) {
    handlers.set(channel, fn);
  },
  removeHandler(channel: string) {
    handlers.delete(channel);
  },
};

export const ipcRenderer = {
  async invoke(channel: string, ...args: any[]) {
    const fn = handlers.get(channel);
    if (!fn) {
      console.warn(`[pile] no ipc handler for "${channel}"`);
      return undefined;
    }
    return await fn(senderEvent, ...args);
  },
  on(channel: string, listener: (event: any, ...args: any[]) => void) {
    const wrapped = (...a: any[]) => listener({}, ...a);
    (listener as any).__pileWrapped = wrapped;
    bus.on(channel, wrapped);
    return ipcRenderer;
  },
  once(channel: string, listener: (event: any, ...args: any[]) => void) {
    bus.once(channel, (...a: any[]) => listener({}, ...a));
    return ipcRenderer;
  },
  removeListener(channel: string, listener: any) {
    if (listener?.__pileWrapped) bus.off(channel, listener.__pileWrapped);
    return ipcRenderer;
  },
  removeAllListeners(channel?: string) {
    if (channel) bus.removeAllListeners(channel);
    else bus.removeAllListeners();
    return ipcRenderer;
  },
  send(channel: string, ...args: any[]) {
    bus.emit(channel, ...args);
  },
  sendSync(_channel: string) {
    return null;
  },
};

export const contextBridge = {
  // We assign window.electron ourselves; exposing is a no-op here.
  exposeInMainWorld(_key: string, _api: any) {},
};

const fakeWindow = {
  webContents: { send: (ch: string, ...a: any[]) => bus.emit(ch, ...a) },
  isDestroyed: () => false,
};

export const BrowserWindow = {
  getAllWindows() {
    return [fakeWindow];
  },
  getFocusedWindow() {
    return fakeWindow;
  },
};

export const safeStorage = {
  isEncryptionAvailable() {
    return true;
  },
  encryptString(plain: string) {
    return Buffer.from(plain, "utf8");
  },
  decryptString(buf: Buffer) {
    return Buffer.from(buf).toString("utf8");
  },
};

// Delegate shell to the real Electron shell when available (desktop).
let realShell: any = {};
try {
  realShell = (window as any).require?.("electron")?.shell ?? {};
} catch {
  /* no node integration — leave stubbed */
}
export const shell = {
  openPath: (p: string) =>
    realShell.openPath ? realShell.openPath(p) : Promise.resolve(""),
  openExternal: (u: string) =>
    realShell.openExternal ? realShell.openExternal(u) : Promise.resolve(),
  showItemInFolder: (p: string) => realShell.showItemInFolder?.(p),
};

export const app = {
  getPath(_name: string) {
    return (globalThis as any).__PILE_HOME__ || "";
  },
  getName() {
    return "Pile";
  },
  getVersion() {
    return "0.0.0";
  },
};

/** Obsidian ships @electron/remote (its own window.electron.remote, which we
 *  preserve when merging our bridge in). Resolve lazily at call time. */
function realRemote(): any {
  try {
    const viaRequire = (window as any).require?.("@electron/remote");
    if (viaRequire) return viaRequire;
  } catch {
    /* fall through */
  }
  return (window as any).electron?.remote;
}

/** Fallback picker via <input type=file>, shaped like showOpenDialog. */
function htmlFilePicker(opts: any): Promise<{ canceled: boolean; filePaths: string[] }> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (opts?.properties?.includes("multiSelections")) input.multiple = true;
    const exts = (opts?.filters ?? [])
      .flatMap((f: any) => f.extensions ?? [])
      .filter((e: string) => e && e !== "*")
      .map((e: string) => `.${e}`);
    if (exts.length) input.accept = exts.join(",");

    input.onchange = () => {
      let webUtils: any;
      try {
        webUtils = (window as any).require?.("electron")?.webUtils;
      } catch {
        /* ignore */
      }
      const filePaths = Array.from(input.files ?? [])
        .map(
          (f: any) => f.path || (webUtils?.getPathForFile?.(f) ?? "")
        )
        .filter(Boolean);
      resolve({ canceled: filePaths.length === 0, filePaths });
    };
    input.oncancel = () => resolve({ canceled: true, filePaths: [] });
    input.click();
  });
}

export const dialog = {
  async showOpenDialog(opts: any) {
    const remote = realRemote();
    if (remote?.dialog?.showOpenDialog) {
      return remote.dialog.showOpenDialog(opts);
    }
    return htmlFilePicker(opts);
  },
  async showSaveDialog(opts: any) {
    const remote = realRemote();
    if (remote?.dialog?.showSaveDialog) {
      return remote.dialog.showSaveDialog(opts);
    }
    return { canceled: true, filePath: "" };
  },
};

export default {
  ipcMain,
  ipcRenderer,
  contextBridge,
  BrowserWindow,
  safeStorage,
  shell,
  app,
  dialog,
};
