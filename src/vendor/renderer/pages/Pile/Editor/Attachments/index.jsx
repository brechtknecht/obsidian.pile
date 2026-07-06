import styles from './Attachments.module.scss';
import { useCallback, useState, useEffect } from 'react';
import { DiscIcon, PhotoIcon, TrashIcon, TagIcon } from 'renderer/icons';
import { motion } from 'framer-motion';
import { usePilesContext } from 'renderer/context/PilesContext';

const Attachments = ({
  post,
  onRemoveAttachment = () => {},
  editable = false,
}) => {
  const { getCurrentPilePath } = usePilesContext();

  if (!post) return;

  return post.data.attachments.map((attachment) => {
    const image_exts = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'];
    const video_exts = ['mp4', 'mov', 'webm', 'm4v'];
    const extension = attachment.split('.').pop().toLowerCase();
    const sep = window.electron.pathSeparator;
    // Obsidian port: Pile's local:// protocol only exists in its own Electron
    // main process; use Obsidian's app:// resource URLs instead.
    const absPath = getCurrentPilePath() + sep + attachment;
    const imgPath = window.__PILE_RESOURCE__
      ? window.__PILE_RESOURCE__(absPath)
      : 'local:' + sep + sep + absPath;

    const isImage = image_exts.includes(extension);
    const isVideo = video_exts.includes(extension);

    if (!isImage && !isVideo) return null;

    return (
      <motion.div
        key={attachment}
        initial={{ opacity: 0, y: -30, scale: 0.8 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 0, scale: 0.9 }}
        transition={{ delay: 0.1 }}
      >
        <div className={styles.image}>
          {editable && (
            <div
              className={styles.remove}
              onClick={() => onRemoveAttachment(attachment)}
            >
              <TrashIcon className={styles.icon} />
            </div>
          )}
          <div className={styles.holder}>
            {isVideo ? (
              <video
                src={imgPath}
                controls
                preload="metadata"
                draggable="false"
              />
            ) : (
              <img src={imgPath} draggable="false" />
            )}
          </div>
        </div>
      </motion.div>
    );
  });
};

export default Attachments;
