/**
 * Registry of mounted editable Pile editors plus clipboard media helpers.
 *
 * Paste routing rules:
 * - A focused TipTap editor handles its own paste (per-editor handlePaste).
 * - Pastes that land outside any editor (scroll area, whitespace, no focus)
 *   are routed here: the most recently focused editor that is still mounted
 *   wins, otherwise the default new-post editor at the top of the pile.
 */

const editors = new Map(); // id -> { attachFile, focus, isDefault }
let focusOrder = []; // least recent first

let nextId = 0;
export const createEditorId = () => `pile-editor-${++nextId}`;

export function registerEditor(id, api) {
  editors.set(id, api);
  return () => {
    editors.delete(id);
    focusOrder = focusOrder.filter((f) => f !== id);
  };
}

export function notifyEditorFocus(id) {
  focusOrder = focusOrder.filter((f) => f !== id);
  focusOrder.push(id);
}

export function routeMediaFiles(files) {
  if (!files.length || editors.size === 0) return false;
  const lastFocusedId = [...focusOrder]
    .reverse()
    .find((id) => editors.has(id));
  const target = lastFocusedId
    ? editors.get(lastFocusedId)
    : [...editors.values()].find((api) => api.isDefault);
  if (!target) return false;

  files.forEach((file) => target.attachFile(file));
  target.focus();
  return true;
}

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'];
const VIDEO_EXTS = ['mp4', 'mov', 'webm', 'm4v'];

export function mediaKind(file) {
  const type = file?.type || '';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  // Files copied from Finder / Screen Studio sometimes arrive without a
  // mime type — fall back to the filename extension.
  const ext = (file?.name || '').split('.').pop()?.toLowerCase();
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (VIDEO_EXTS.includes(ext)) return 'video';
  return null;
}

export function extensionForFile(file) {
  const name = file?.name || '';
  const nameExt = name.includes('.') ? name.split('.').pop() : '';
  if (nameExt) return nameExt.toLowerCase();
  const subtype = (file?.type?.split('/')[1] || '').toLowerCase();
  return { quicktime: 'mov', jpeg: 'jpg', 'x-m4v': 'm4v' }[subtype] || subtype;
}

export function extractMediaFiles(dataTransfer) {
  if (!dataTransfer) return [];
  let files = Array.from(dataTransfer.files || []);
  if (files.length === 0) {
    files = Array.from(dataTransfer.items || [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter(Boolean);
  }
  return files.filter((file) => mediaKind(file) !== null);
}
