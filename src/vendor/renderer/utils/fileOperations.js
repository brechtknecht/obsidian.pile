const postFormat = {
  title: '',
  content: null,
  createdAt: null,
  updatedAt: null,
  attachments: [],
  color: null,
  area: null,
  tags: [],
  replies: [],
  isReply: false,
  isAI: false,
};

const getDirectoryPath = (filePath) => {
  const isAbsolute = filePath.startsWith('/');
  const pathArr = filePath.split(/[/\\]/);
  pathArr.pop();
  let directoryPath = window.electron.joinPath(...pathArr);

  if (isAbsolute && !directoryPath.startsWith('/')) {
    directoryPath = '/' + directoryPath;
  }

  return directoryPath;
};

const getFormattedTimestamp = () => {
  const currentDate = new Date();

  const year = String(currentDate.getFullYear()).slice(-2);
  const month = String(currentDate.getMonth() + 1).padStart(2, '0');
  const day = String(currentDate.getDate()).padStart(2, '0');
  const hours = String(currentDate.getHours()).padStart(2, '0');
  const minutes = String(currentDate.getMinutes()).padStart(2, '0');
  const seconds = String(currentDate.getSeconds()).padStart(2, '0');

  const fileName = `${year}${month}${day}-${hours}${minutes}${seconds}.md`;

  return fileName;
};

const getFilePathForNewPost = (basePath, timestamp = new Date()) => {
  const date = new Date();
  const month = date.toLocaleString('default', { month: 'short' });
  const year = date.getFullYear().toString();
  const fileName = getFormattedTimestamp();
  const path = window.electron.joinPath(basePath, year, month, fileName);

  return path;
};

const createDirectory = (directoryPath) => {
  return window.electron.mkdir(directoryPath);
};

const getFiles = async (dir) => {
  const files = await window.electron.getFiles(dir);

  return files;
};

const saveFile = (path, file) => {
  return new Promise((resolve, reject) => {
    window.electron.writeFile(path, file, (err) => {
      if (err) {
        console.error('Error writing to file.', err);
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

const deleteFile = (path) => {
  return new Promise((resolve, reject) => {
    window.electron.deleteFile(path, (err) => {
      if (err) {
        console.error('Error deleting file.', err);
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

const generateMarkdown = (content, data) => {
  return window.electron.ipc.invoke('matter-stringify', { content, data });
};

// Obsidian port: many screenshots/photos carry their capture time in the
// filename (macOS "Bildschirmfoto 2026-03-18 um 12.22.47", "Screenshot
// 2026-03-18 at 2.22.47 PM", phone "Screenshot_20260318-122247", "IMG_..."),
// so we can infer an entry's date when such a file is attached. The times are
// local (that's how the OS names them); we return a UTC ISO string, which is
// the same format entries store createdAt in. Returns null if no date is found.
const buildLocalISO = (y, mo, d, h = '0', mi = '0', s = '0', ampm) => {
  const year = parseInt(y, 10);
  const month = parseInt(mo, 10);
  const day = parseInt(d, 10);
  let hour = parseInt(h, 10) || 0;
  const minute = parseInt(mi, 10) || 0;
  const second = parseInt(s, 10) || 0;

  const meridiem = ampm ? ampm.toLowerCase() : null;
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  if (year < 1990 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const date = new Date(year, month - 1, day, hour, minute, second);
  if (isNaN(date.getTime())) return null;
  return date.toISOString();
};

const inferDateFromFilename = (filename) => {
  if (!filename) return null;
  const base = String(filename)
    .split(/[/\\]/)
    .pop()
    .replace(/\.[^.]+$/, '');

  // YYYY-MM-DD, optionally followed by a separator + HH:MM[:SS] and AM/PM
  let m = base.match(
    /(\d{4})-(\d{2})-(\d{2})(?:\D+(\d{1,2})[.:_-](\d{2})(?:[.:_-](\d{2}))?\s*(am|pm)?)?/i
  );
  if (m) return buildLocalISO(m[1], m[2], m[3], m[4], m[5], m[6], m[7]);

  // Compact YYYYMMDD with optional separator + HHMMSS (phone screenshots)
  m = base.match(/(\d{4})(\d{2})(\d{2})[-_ ]?(?:(\d{2})(\d{2})(\d{2})?)?/);
  if (m) return buildLocalISO(m[1], m[2], m[3], m[4], m[5], m[6]);

  return null;
};

export {
  postFormat,
  createDirectory,
  saveFile,
  deleteFile,
  getFiles,
  getDirectoryPath,
  getFilePathForNewPost,
  generateMarkdown,
  inferDateFromFilename,
};
