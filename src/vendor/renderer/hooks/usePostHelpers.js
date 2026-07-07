import {
  generateMarkdown,
  createDirectory,
  saveFile,
  deleteFile,
  getFilePathForNewPost,
  getDirectoryPath,
  inferDateFromFilename,
} from '../utils/fileOperations';

export const getPost = async (postPath) => {
  try {
    if (!postPath) return;
    const fileContent = await window.electron.ipc.invoke('get-file', postPath);
    const parsed = await window.electron.ipc.invoke(
      'matter-parse',
      fileContent
    );
    const post = { content: parsed.content, data: parsed.data };
    return post;
  } catch (error) {
    // TODO: check and cleanup after these files
  }
};

export const attachToPostCreator =
  (setPost, getCurrentPilePath) => async (fileData, fileExtension) => {
    const storePath = getCurrentPilePath();

    // Each stored file is tracked with the ORIGINAL filename it came from (when
    // known), so we can infer a capture date from it — regardless of whether it
    // was dropped, pasted, or picked from the native file dialog.
    let stored = []; // Array<{ path, name }>
    if (fileData && typeof fileData === 'object' && fileData.filePath) {
      // media that already exists on disk (pasted/dropped file) — copy it
      // into the pile instead of round-tripping through base64
      const newFilePath = await window.electron.ipc.invoke(
        'save-file-from-path',
        {
          sourcePath: fileData.filePath,
          fileExtension: fileExtension,
          storePath: storePath,
        }
      );

      if (newFilePath) {
        stored.push({ path: newFilePath, name: fileData.filePath });
      } else {
        console.error('Failed to copy the pasted file.');
      }
    } else if (fileData) {
      // save data URL contents (e.g. pasted screenshot) to a file — clipboard
      // bitmaps carry no filename, so there's no date to infer
      const newFilePath = await window.electron.ipc.invoke('save-file', {
        fileData: fileData,
        fileExtension: fileExtension,
        storePath: storePath,
      });

      if (newFilePath) {
        stored.push({ path: newFilePath, name: null });
      } else {
        console.error('Failed to save the pasted image.');
      }
    } else {
      // native file picker — the handler returns the original filename too
      const picked = await window.electron.ipc.invoke('open-file', {
        storePath: storePath,
      });
      for (const item of picked || []) {
        if (typeof item === 'string') {
          stored.push({ path: item, name: null });
        } else if (item && item.path) {
          stored.push({ path: item.path, name: item.name || null });
        }
      }
    }

    // Attachments are stored relative to the base path from the
    // base directory of the pile
    const correctedPaths = stored.map(({ path }) => {
      const pathArr = path.split(/[/\\]/).slice(-4);
      return window.electron.joinPath(...pathArr);
    });

    // Dates inferred from the original filenames, keyed by the stored path.
    const dates = correctedPaths
      .map((path, i) => {
        const iso = inferDateFromFilename(stored[i].name);
        return iso ? { path, iso } : null;
      })
      .filter(Boolean);

    setPost((post) => {
      const attachments = [...correctedPaths, ...post.data.attachments];
      const newPost = {
        ...post,
        data: { ...post.data, attachments },
      };

      return newPost;
    });

    // Returned so callers can offer to date the entry from its images.
    return { paths: correctedPaths, dates };
  };

export const detachFromPostCreator =
  (setPost, getCurrentPilePath) => (attachmentPath) => {
    setPost((post) => {
      let newPost = JSON.parse(JSON.stringify(post));
      const newAtt = newPost.data.attachments.filter(
        (a) => a !== attachmentPath
      );

      newPost.data.attachments = newAtt;

      const fullPath = window.electron.joinPath(
        getCurrentPilePath(),
        attachmentPath
      );

      window.electron.deleteFile(fullPath, (err) => {
        if (err) {
          console.error('There was an error:', err);
        } else {
          console.log('File was deleted successfully');
        }
      });

      console.log('Attachment removed', attachmentPath);

      return newPost;
    });
  };

export const tagActionsCreator = (setPost, action) => {
  return (tag) => {
    setPost((post) => {
      if (action === 'add' && !post.data.tags.includes(tag)) {
        return {
          ...post,
          data: {
            ...post.data,
            tags: [...post.data.tags, tag],
          },
        };
      }
      if (action === 'remove' && post.data.tags.includes(tag)) {
        return {
          ...post,
          data: {
            ...post.data,
            tags: post.data.tags.filter((t) => t !== tag),
          },
        };
      }
      return post;
    });
  };
};

export const setHighlightCreator = (post, setPost, savePost) => {
  return (highlight) => {
    setPost((post) => ({
      ...post,
      data: { ...post.data, highlight: highlight },
    }));
    savePost({ highlight: highlight });
  };
};

export const cycleColorCreator = (post, setPost, savePost, highlightColors) => {
  return () => {
    if (!post.data.highlightColor) {
      const newColor = highlightColors[1];
      setPost((post) => ({
        ...post,
        data: { ...post.data, highlightColor: newColor },
      }));
      savePost({ highlightColor: newColor });
      return;
    }
    const currentColor = post.data.highlightColor;
    const currentIndex = highlightColors.findIndex(
      (color) => color === currentColor
    );
    const nextIndex = (currentIndex + 1) % highlightColors.length;
    const nextColor = highlightColors[nextIndex];

    setPost((post) => ({
      ...post,
      data: { ...post.data, highlightColor: nextColor },
    }));
    savePost({ highlightColor: nextColor });
  };
};
