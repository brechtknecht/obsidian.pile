import { useParams } from 'react-router-dom';
import styles from '../Post.module.scss';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { postFormat } from 'renderer/utils/fileOperations';
import Editor from '../../../Editor';
import * as fileOperations from 'renderer/utils/fileOperations';
import { usePilesContext } from 'renderer/context/PilesContext';
import usePost from 'renderer/hooks/usePost';
import { AnimatePresence, motion } from 'framer-motion';
import { AIIcon, CheckIcon, CopyIcon } from 'renderer/icons';

export default function Reply({
  postPath,
  isLast = false,
  isFirst = false,
  replying = false,
  highlightColor,
  parentPostPath = null,
  reloadParentPost = () => {},
  searchTerm = { searchTerm },
}) {
  const { currentPile } = usePilesContext();
  const { post, cycleColor } = usePost(postPath);
  const [editable, setEditable] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef(null);

  useEffect(() => () => clearTimeout(copiedTimeoutRef.current), []);

  const toggleEditable = () => setEditable(!editable);

  const handleCopy = () => {
    const div = document.createElement('div');
    div.innerHTML = (post?.content || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n');
    navigator.clipboard.writeText(div.textContent.trim());
    setCopied(true);
    clearTimeout(copiedTimeoutRef.current);
    copiedTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
  };

  if (!post) return;

  const created = DateTime.fromISO(post.data.createdAt);
  const replies = post?.data?.replies || [];
  const isReply = post?.data?.isReply || false;
  const isAI = post?.data?.isAI || false;

  return (
    <div>
      <div className={styles.post}>
        <div className={styles.left}>
          <div
            className={`${styles.connector} ${isFirst && styles.first}`}
          ></div>

          <div
            className={`${styles.ball} ${isAI && styles.ai}`}
            onDoubleClick={cycleColor}
            style={{
              backgroundColor: highlightColor ?? 'var(--border)',
            }}
          >
            {isAI && <AIIcon className={styles.iconAI} />}
          </div>
          <div
            className={`${styles.line} ${isAI && styles.ai} ${
              (!isLast || replying) && styles.show
            } `}
            style={{
              borderColor: highlightColor ?? 'var(--border)',
            }}
          ></div>
        </div>
        <div className={styles.right}>
          <div className={styles.header}>
            <div className={styles.title}>{post.name}</div>
            <div className={styles.meta}>
              <button
                className={`${styles.copy} ${copied ? styles.copied : ''}`}
                onClick={handleCopy}
                title="Copy message"
                aria-label={copied ? 'Copied' : 'Copy message'}
              >
                {copied ? (
                  <CheckIcon className={styles.icon} />
                ) : (
                  <CopyIcon className={styles.icon} />
                )}
              </button>
              <div className={styles.time} onClick={toggleEditable}>
                {created.toRelative()}
              </div>
            </div>
          </div>
          <div className={`${styles.editor} ${isAI && styles.ai}`}>
            <Editor
              postPath={postPath}
              editable={editable}
              setEditable={setEditable}
              parentPostPath={parentPostPath}
              reloadParentPost={reloadParentPost}
              searchTerm={searchTerm}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
