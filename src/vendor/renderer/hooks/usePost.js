import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { usePilesContext } from 'renderer/context/PilesContext';
import * as fileOperations from '../utils/fileOperations';
import { useIndexContext } from 'renderer/context/IndexContext';
import {
  getPost,
  cycleColorCreator,
  tagActionsCreator,
  attachToPostCreator,
  detachFromPostCreator,
  setHighlightCreator,
} from './usePostHelpers';

const highlightColors = [
  'var(--border)',
  'var(--base-yellow)',
  'var(--base-green)',
];

const defaultPost = {
  content: '',
  data: {
    title: '',
    createdAt: null,
    updatedAt: null,
    highlight: null,
    highlightColor: null,
    tags: [],
    replies: [],
    attachments: [],
    isReply: false,
    isAI: false,
  },
};

function usePost(
  postPath = null, // relative path
  {
    isReply = false,
    isAI = false,
    parentPostPath = null, // relative path
    reloadParentPost = () => {},
  } = {}
) {
  const { currentPile, getCurrentPilePath } = usePilesContext();
  const {
    addIndex,
    removeIndex,
    refreshIndex,
    updateIndex,
    prependIndex,
    sortedUpsertIndex,
  } = useIndexContext();
  const [updates, setUpdates] = useState(0);
  const [path, setPath] = useState(); // absolute path
  const [post, setPost] = useState({ ...defaultPost });

  useEffect(() => {
    if (!postPath) return;
    const fullPath = window.electron.joinPath(getCurrentPilePath(), postPath);
    setPath(fullPath);
  }, [postPath, currentPile]);

  useEffect(() => {
    if (!path) return;
    refreshPost();
  }, [path]);

  const refreshPost = useCallback(async () => {
    if (!path) return;
    const freshPost = await getPost(path);
    setPost(freshPost);
  }, [path]);

  const savePost = useCallback(
    async (dataOverrides) => {
      console.time('post-time');

      const saveToPath = path
        ? path
        : fileOperations.getFilePathForNewPost(currentPile.path);
      const directoryPath = fileOperations.getDirectoryPath(saveToPath);
      const now = new Date().toISOString();
      const content = post.content;
      const data = {
        ...post.data,
        isAI: post.data.isAI === true ? post.data.isAI : isAI,
        isReply: post.data.createdAt ? post.data.isReply : isReply,
        createdAt: post.data.createdAt ?? now,
        updatedAt: now,
        ...dataOverrides,
      };

      try {
        const fileContents = await fileOperations.generateMarkdown(
          content,
          data
        );

        await fileOperations.createDirectory(directoryPath);
        await fileOperations.saveFile(saveToPath, fileContents);

        if (isReply) {
          await addReplyToParent(parentPostPath, saveToPath);
        }

        const postRelativePath = saveToPath.replace(
          getCurrentPilePath() + window.electron.pathSeparator,
          ''
        );
        // Sorted insert so a back-dated entry lands in its chronological spot
        // (in the past) instead of being pinned to the top.
        sortedUpsertIndex(postRelativePath, data);
        addIndex(postRelativePath, parentPostPath); // persist to disk index

        window.electron.ipc.invoke('tags-sync', saveToPath); // Sync tags
        console.timeEnd('post-time');
      } catch (error) {
        console.error(`Error writing file: ${saveToPath}`);
        console.error(error);
      }
    },
    [path, post, reloadParentPost]
  );

  const addReplyToParent = async (parentPostPath, replyPostPath) => {
    const relativeReplyPath = window.electron.joinPath(
      ...replyPostPath.split(/[/\\]/).slice(-3)
    );
    const fullParentPostPath = getCurrentPilePath(parentPostPath);
    const parentPost = await getPost(fullParentPostPath);
    const content = parentPost.content;
    const data = {
      ...parentPost.data,
      replies: [...parentPost.data.replies, relativeReplyPath],
    };
    const fileContents = await fileOperations.generateMarkdown(content, data);
    await fileOperations.saveFile(fullParentPostPath, fileContents);
    updateIndex(parentPostPath, data);
    reloadParentPost(parentPostPath);
  };

  // Obsidian port: re-date an existing entry to `targetDate` (a JS Date; only
  // the calendar day is used, the original time-of-day is preserved). We only
  // rewrite the `createdAt`/`updatedAt` frontmatter and re-sort the index —
  // the file is intentionally NOT moved to a new year/month folder, so its
  // index key, reply references and attachment paths stay valid. The filename
  // timestamp becomes a cosmetic id; ordering everywhere is driven by
  // `createdAt` (see pileIndex.sortMap). To also relocate the file on disk,
  // this is where you'd rename it and migrate the index key + parent replies.
  const moveToDate = useCallback(
    async (targetDate) => {
      if (!path || !postPath) return;

      // Read fresh from disk so we never clobber content that was edited in a
      // separate usePost instance (the Editor holds its own copy).
      const fresh = await getPost(path);
      if (!fresh) return;

      const base = fresh.data.createdAt
        ? DateTime.fromISO(fresh.data.createdAt)
        : DateTime.now();
      const moved = base.set({
        year: targetDate.getFullYear(),
        month: targetDate.getMonth() + 1,
        day: targetDate.getDate(),
      });

      const data = {
        ...fresh.data,
        createdAt: moved.toISO(),
        updatedAt: new Date().toISOString(),
      };

      const fileContents = await fileOperations.generateMarkdown(
        fresh.content,
        data
      );
      await fileOperations.saveFile(path, fileContents);
      setPost({ ...fresh, data });
      await updateIndex(postPath, data); // re-sorts index → list + timeline
    },
    [path, postPath, updateIndex]
  );

  const deletePost = useCallback(async () => {
    if (!postPath) return null;
    const fullPostPath = getCurrentPilePath(postPath);

    // if reply, remove from parent
    if (post.data.isReply && parentPostPath) {
      const fullParentPostPath = getCurrentPilePath(parentPostPath);
      const parentPost = await getPost(fullParentPostPath);
      const content = parentPost.content;
      const newReplies = parentPost.data.replies.filter((p) => {
        return p !== postPath;
      });
      const data = {
        ...parentPost.data,
        replies: newReplies,
      };
      const fileContents = await fileOperations.generateMarkdown(content, data);
      await fileOperations.saveFile(fullParentPostPath, fileContents);
      await reloadParentPost();
    }

    // delete file and remove from index
    await fileOperations.deleteFile(fullPostPath);
    removeIndex(postPath);
  }, [postPath, reloadParentPost, parentPostPath, post]);

  const postActions = useMemo(
    () => ({
      setContent: (content) => setPost((post) => ({ ...post, content })),
      updateData: (data) =>
        setPost((post) => ({ ...post, data: { ...post.data, ...data } })),
      cycleColor: cycleColorCreator(post, setPost, savePost, highlightColors),
      setHighlight: setHighlightCreator(post, setPost, savePost),
      addTag: tagActionsCreator(setPost, 'add'),
      removeTag: tagActionsCreator(setPost, 'remove'),
      attachToPost: attachToPostCreator(setPost, getCurrentPilePath),
      detachFromPost: detachFromPostCreator(setPost, getCurrentPilePath),
      resetPost: () => setPost(defaultPost),
    }),
    [post]
  );

  return {
    defaultPost,
    post,
    savePost,
    refreshPost,
    deletePost,
    moveToDate,
    ...postActions,
  };
}

export default usePost;
