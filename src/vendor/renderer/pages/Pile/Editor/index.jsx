import './ProseMirror.scss';
import styles from './Editor.module.scss';
import { useCallback, useState, useEffect, useRef, useMemo, memo } from 'react';
import { DateTime } from 'luxon';
import { Extension } from '@tiptap/core';
import { useEditor, EditorContent } from '@tiptap/react';
import Link from '@tiptap/extension-link';
import StarterKit from '@tiptap/starter-kit';
import Typography from '@tiptap/extension-typography';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { DiscIcon, PhotoIcon, TrashIcon, TagIcon } from 'renderer/icons';
import { motion, AnimatePresence } from 'framer-motion';
import { postFormat } from 'renderer/utils/fileOperations';
import { useParams } from 'react-router-dom';
import TagButton from './TagButton';
import TagList from './TagList';
import Attachments from './Attachments';
import usePost from 'renderer/hooks/usePost';
import ProseMirrorStyles from './ProseMirror.scss';
import { useAIContext } from 'renderer/context/AIContext';
import useThread from 'renderer/hooks/useThread';
import LinkPreviews from './LinkPreviews';
import { useToastsContext } from 'renderer/context/ToastsContext';
import {
  createEditorId,
  registerEditor,
  notifyEditorFocus,
  extractMediaFiles,
  extensionForFile,
  mediaKind,
} from 'renderer/utils/editorRegistry';

// Escape special characters
const escapeRegExp = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const highlightTerms = (text, term) => {
  if (!term.trim()) return text;
  const regex = new RegExp(`(${escapeRegExp(term)})`, 'gi');
  return text.replace(
    regex,
    '<span class="' + styles.highlight + '">$1</span>'
  );
};

const Editor = memo(
  ({
    postPath = null,
    editable = false,
    parentPostPath = null,
    isAI = false,
    isReply = false,
    closeReply = () => {},
    setEditable = () => {},
    reloadParentPost,
    searchTerm = null,
  }) => {
    const {
      post,
      savePost,
      addTag,
      removeTag,
      attachToPost,
      detachFromPost,
      setContent,
      resetPost,
      deletePost,
    } = usePost(postPath, { isReply, parentPostPath, reloadParentPost, isAI });
    const { getThread } = useThread();
    const { ai, prompt, model, generateCompletion, prepareCompletionContext } =
      useAIContext();
    const { addNotification, removeNotification } = useToastsContext();

    const isNew = !postPath;

    // Obsidian port: date-from-attachment. Each dated attachment contributes
    // { path, iso }; a single toggle lets the user date this (not-yet-saved)
    // entry to the images' capture date instead of "now". Keyed by stored path
    // so add/remove stays in sync when there are multiple images. Only used for
    // brand-new top-level entries — replies and existing posts are untouched.
    const supportsDateFromImage = isNew && !isReply;
    const [extractedDates, setExtractedDates] = useState([]);
    const [useExtractedDate, setUseExtractedDate] = useState(false);
    const hadExtractedRef = useRef(false);

    // The whole post gets one date: the earliest capture across its images.
    const extractedDate = useMemo(() => {
      if (extractedDates.length === 0) return null;
      return extractedDates.reduce(
        (min, e) => (e.iso < min ? e.iso : min),
        extractedDates[0].iso
      );
    }, [extractedDates]);

    const extractedDateLabel = useMemo(
      () =>
        extractedDate
          ? DateTime.fromISO(extractedDate).toLocaleString(DateTime.DATE_MED)
          : null,
      [extractedDate]
    );

    // Default the toggle on the first time a dated image appears; reset it once
    // every dated image has been removed.
    useEffect(() => {
      if (extractedDate && !hadExtractedRef.current) {
        hadExtractedRef.current = true;
        setUseExtractedDate(true);
      } else if (!extractedDate && hadExtractedRef.current) {
        hadExtractedRef.current = false;
        setUseExtractedDate(false);
      }
    }, [extractedDate]);

    const recordExtractedDates = useCallback((entries) => {
      setExtractedDates((cur) => {
        const seen = new Set(cur.map((e) => e.path));
        const additions = entries.filter((e) => e.iso && !seen.has(e.path));
        return additions.length ? [...cur, ...additions] : cur;
      });
    }, []);

    const EnterSubmitExtension = Extension.create({
      name: 'EnterSubmitExtension',
      addCommands() {
        return {
          triggerSubmit:
            () =>
            ({ state, dispatch }) => {
              const event = new CustomEvent('submit');
              document.dispatchEvent(event);
              return true;
            },
        };
      },

      addKeyboardShortcuts() {
        return {
          Enter: ({ editor }) => {
            editor.commands.triggerSubmit();
            return true;
          },
        };
      },
    });

    // attachToPost returns { paths, dates }; feed any inferred dates to the
    // date-toggle (only for new top-level posts).
    const recordDates = (res) => {
      if (!supportsDateFromImage) return;
      if (res && res.dates && res.dates.length) recordExtractedDates(res.dates);
    };

    const handleFile = (file) => {
      if (!file || !mediaKind(file)) return false;
      const fileExtension = extensionForFile(file);
      if (!fileExtension) return false;

      // Files copied from disk (Finder, Screen Studio exports) carry a real
      // path — copy them directly instead of round-tripping large videos
      // through base64.
      const filePath = window.electron.getPathForFile?.(file);
      if (filePath) {
        Promise.resolve(attachToPost({ filePath }, fileExtension)).then(
          recordDates
        );
        return true;
      }

      // Bitmap-only clipboards (macOS screenshots) have no path/filename.
      const reader = new FileReader();
      reader.onload = async () => {
        const res = await attachToPost(reader.result, fileExtension);
        recordDates(res);
      };
      reader.readAsDataURL(file);
      return true;
    };

    // Latest handleFile for closures created once (TipTap editorProps,
    // registry registration) so they never act on a stale attachToPost.
    const handleFileRef = useRef(handleFile);
    handleFileRef.current = handleFile;

    const editorIdRef = useRef(null);
    if (!editorIdRef.current) editorIdRef.current = createEditorId();

    const editor = useEditor({
      extensions: [
        StarterKit,
        Typography,
        Link,
        Placeholder.configure({
          placeholder: isAI ? 'AI is thinking...' : 'What are you thinking?',
        }),
        CharacterCount.configure({
          limit: 10000,
        }),
        EnterSubmitExtension,
      ],
      editorProps: {
        handlePaste: function (view, event, slice) {
          const files = extractMediaFiles(event.clipboardData);
          if (files.length === 0) return false; // default paste behaviour
          files.forEach((file) => handleFileRef.current(file));
          return true;
        },
        handleDrop: function (view, event, slice, moved) {
          if (moved) return false;
          const files = extractMediaFiles(event.dataTransfer);
          if (files.length === 0) return false; // default drop behaviour
          files.forEach((file) => handleFileRef.current(file));
          return true;
        },
      },
      autofocus: true,
      editable: editable,
      content: post?.content || '',
      onFocus: () => {
        notifyEditorFocus(editorIdRef.current);
      },
      onUpdate: ({ editor }) => {
        setContent(editor.getHTML());
      },
    });

    const elRef = useRef();
    const [deleteStep, setDeleteStep] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [isAIResponding, setIsAiResponding] = useState(false);
    const [prevDragPos, setPrevDragPos] = useState(0);

    const handleMouseDown = (e) => {
      setIsDragging(true);
      setPrevDragPos(e.clientX);
    };

    const handleMouseMove = (e) => {
      if (isDragging && elRef.current) {
        const delta = e.clientX - prevDragPos;
        elRef.current.scrollLeft -= delta;
        setPrevDragPos(e.clientX);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    useEffect(() => {
      if (!editor) return;
      generateAiResponse();
    }, [editor, isAI]);

    // Editable editors register themselves so pastes landing outside any
    // editor (see PileLayout) can be routed to the right one.
    useEffect(() => {
      if (!editor || !editable || isAI) return;
      return registerEditor(editorIdRef.current, {
        attachFile: (file) => handleFileRef.current(file),
        focus: () => {
          editor.commands.focus('end');
          editor.view?.dom?.scrollIntoView?.({ block: 'nearest' });
        },
        isDefault: isNew && !isReply,
      });
    }, [editor, editable, isAI]);

    const handleSubmit = useCallback(async () => {
      const overrides =
        supportsDateFromImage && useExtractedDate && extractedDate
          ? { createdAt: extractedDate }
          : undefined;
      await savePost(overrides);
      if (isNew) {
        resetPost();
        setExtractedDates([]);
        setUseExtractedDate(false);
        hadExtractedRef.current = false;
        closeReply();
        return;
      }

      closeReply();
      setEditable(false);
    }, [editor, isNew, post, supportsDateFromImage, useExtractedDate, extractedDate]);

    // Removing an attachment drops its contribution to the extracted date.
    const handleRemoveAttachment = useCallback(
      (attachmentPath) => {
        detachFromPost(attachmentPath);
        setExtractedDates((cur) => cur.filter((e) => e.path !== attachmentPath));
      },
      [detachFromPost]
    );

    // Listen for the 'submit' event and call handleSubmit when it's triggered
    useEffect(() => {
      const handleEvent = () => {
        if (editor?.isFocused) {
          handleSubmit();
        }
      };

      document.addEventListener('submit', handleEvent);

      return () => {
        document.removeEventListener('submit', handleEvent);
      };
    }, [handleSubmit, editor]);

    // This has to ensure that it only calls the AI generate function
    // on entries added for the AI that are empty.
    const generateAiResponse = useCallback(async () => {
      if (
        !editor ||
        isAIResponding ||
        !isAI ||
        !editor.state.doc.textContent.length === 0
      )
        return;

      addNotification({
        id: 'reflecting',
        type: 'thinking',
        message: 'talking to AI',
        dismissTime: 10000,
      });
      setEditable(false);
      setIsAiResponding(true);

      try {
        const thread = await getThread(parentPostPath);
        const context = prepareCompletionContext(thread);

        if (context.length === 0) return;

        await generateCompletion(context, (token) => {
          editor.commands.insertContent(token);
        });
      } catch (error) {
        addNotification({
          id: 'reflecting',
          type: 'failed',
          message: 'AI request failed',
          dismissTime: 12000,
          onEnter: closeReply,
        });
      } finally {
        removeNotification('reflecting');
        setIsAiResponding(false);
      }
    }, [
      editor,
      isAI,
      generateCompletion,
      prepareCompletionContext,
      getThread,
      parentPostPath,
    ]);

    useEffect(() => {
      if (editor) {
        if (!post) return;
        if (post?.content != editor.getHTML()) {
          editor.commands.setContent(post.content);
        }
      }
    }, [post, editor]);

    const triggerAttachment = async () => {
      const res = await attachToPost();
      recordDates(res);
    };

    useEffect(() => {
      if (editor) {
        editor.setEditable(editable);
      }
      setDeleteStep(0);
    }, [editable]);

    const handleOnDelete = useCallback(async () => {
      if (deleteStep == 0) {
        setDeleteStep(1);
        return;
      }

      await deletePost();
    }, [deleteStep]);

    const isBig = useCallback(() => {
      return editor?.storage.characterCount.characters() < 280;
    }, [editor]);

    const renderPostButton = () => {
      if (isAI) return 'Save AI response';
      if (isReply) return 'Reply';
      if (isNew) return 'Post';

      return 'Update';
    };

    if (!post) return;

    let previewContent = post.content;
    if (searchTerm && !editable) {
      previewContent = highlightTerms(post.content, searchTerm);
    }

    return (
      <div className={`${styles.frame} ${isNew && styles.isNew}`}>
        {editable ? (
          <EditorContent
            key={'new'}
            className={`${styles.editor} ${isBig() && styles.editorBig} ${
              isAIResponding && styles.responding
            }`}
            editor={editor}
          />
        ) : (
          <div className={styles.uneditable}>
            <div
              key="uneditable"
              className={`${styles.editor} ${isBig() && styles.editorBig}`}
              dangerouslySetInnerHTML={{ __html: previewContent }}
            />
          </div>
        )}

        <LinkPreviews post={post} />

        <div
          className={`${styles.media} ${
            post?.data?.attachments.length > 0 ? styles.open : ''
          }`}
        >
          <div
            className={`${styles.scroll} ${isNew && styles.new}`}
            ref={elRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <div className={styles.container}>
              <Attachments
                post={post}
                editable={editable}
                onRemoveAttachment={handleRemoveAttachment}
              />
            </div>
          </div>
        </div>

        {editable && (
          <div className={styles.footer}>
            <div className={styles.left}>
              <button className={styles.button} onClick={triggerAttachment}>
                <PhotoIcon className={styles.icon} />
              </button>
            </div>
            <div className={styles.right}>
              {supportsDateFromImage && extractedDate && (
                <div
                  className={styles.dateToggle}
                  title={`Date this entry — "Now" or the image's date (${extractedDateLabel})`}
                >
                  <button
                    type="button"
                    className={`${styles.dateOption} ${
                      !useExtractedDate ? styles.dateActive : ''
                    }`}
                    onClick={() => setUseExtractedDate(false)}
                  >
                    Now
                  </button>
                  <button
                    type="button"
                    className={`${styles.dateOption} ${
                      useExtractedDate ? styles.dateActive : ''
                    }`}
                    onClick={() => setUseExtractedDate(true)}
                  >
                    {extractedDateLabel}
                  </button>
                </div>
              )}
              {isReply && (
                <button className={styles.deleteButton} onClick={closeReply}>
                  Close
                </button>
              )}

              {!isNew && (
                <button
                  className={styles.deleteButton}
                  onClick={handleOnDelete}
                >
                  {deleteStep == 0 ? 'Delete' : 'Click again to confirm'}
                </button>
              )}
              <button
                tabIndex="0"
                className={styles.button}
                onClick={handleSubmit}
              >
                {renderPostButton()}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
);

export default Editor;
