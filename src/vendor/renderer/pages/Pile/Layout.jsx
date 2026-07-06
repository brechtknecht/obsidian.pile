import { useParams, Link } from 'react-router-dom';
import styles from './PileLayout.module.scss';
import { HomeIcon } from 'renderer/icons';
import Sidebar from './Sidebar/Timeline/index';
import { useIndexContext } from 'renderer/context/IndexContext';
import { useEffect, useState, useMemo, useRef } from 'react';
import { DateTime } from 'luxon';
import Settings from './Settings';
import HighlightsDialog from './Highlights';
import { usePilesContext } from 'renderer/context/PilesContext';
import Toasts from './Toasts';
import Search from './Search';
import { useTimelineContext } from 'renderer/context/TimelineContext';
import { AnimatePresence, motion } from 'framer-motion';
import InstallUpdate from './InstallUpdate';
import Chat from './Chat';
import {
  extractMediaFiles,
  routeMediaFiles,
} from 'renderer/utils/editorRegistry';

export default function PileLayout({ children }) {
  const frameRef = useRef(null);
  const { pileName } = useParams();
  const { index, refreshIndex } = useIndexContext();
  const { visibleIndex, closestDate } = useTimelineContext();
  const { currentTheme } = usePilesContext();

  const [now, setNow] = useState(DateTime.now().toFormat('cccc, LLL dd, yyyy'));

  useEffect(() => {
    try {
      if (visibleIndex < 5) {
        setNow(DateTime.now().toFormat('cccc, LLL dd, yyyy'));
      } else {
        setNow(DateTime.fromISO(closestDate).toFormat('cccc, LLL dd, yyyy'));
      }
    } catch (error) {
      console.log('Failed to render header date');
    }
  }, [visibleIndex, closestDate]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Catch media pastes that land outside any editor (whitespace, scroll
  // area, or nothing focused at all) and route them to the last-focused
  // editor — or the new-post box as the default. Editors and other text
  // inputs keep handling their own pastes.
  useEffect(() => {
    const onPaste = (event) => {
      const frame = frameRef.current;
      if (!frame || !frame.isConnected || frame.offsetParent === null) return; // Pile view hidden

      // The Pile app lives in a shadow root; window-level listeners see the
      // retargeted host as event.target, so resolve the real inner target.
      const target = event.composedPath ? event.composedPath()[0] : event.target;
      if (target instanceof Element) {
        if (target.closest('.ProseMirror')) return; // editor handles its own paste
        if (target.closest('input, textarea, [contenteditable="true"]')) return;
        // Only claim pastes aimed at the pile view or at nothing in particular.
        if (!frame.contains(target) && target !== document.body) return;
      }

      const files = extractMediaFiles(event.clipboardData);
      if (files.length === 0) return;

      event.preventDefault();
      routeMediaFiles(files);
    };

    window.addEventListener('paste', onPaste, true);
    return () => window.removeEventListener('paste', onPaste, true);
  }, []);

  const themeStyles = useMemo(() => {
    return currentTheme ? currentTheme + 'Theme' : '';
  }, [currentTheme]);

  const osStyles = useMemo(
    () => (window.electron.isMac ? styles.mac : styles.win),
    []
  );

  return (
    <div ref={frameRef} className={`${styles.frame} ${themeStyles} ${osStyles}`}>
      <div className={styles.bg}></div>
      <div className={styles.main}>
        <div className={styles.sidebar}>
          <div className={styles.top}>
            <div className={styles.part}>
              <div className={styles.count}>
                <span>{index.size}</span> entries
              </div>
            </div>
          </div>
          <Sidebar />
        </div>
        <div className={styles.content}>
          <div className={styles.nav}>
            <div className={styles.left}>
              {pileName} <span style={{ padding: '6px' }}>·</span>
              <motion.span
                key={now}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
              >
                {now}
              </motion.span>
            </div>
            <div className={styles.right}>
              <Toasts />
              <InstallUpdate />
              <Chat />
              <Search />
              <Settings />
              <Link to="/" className={`${styles.iconHolder}`}>
                <HomeIcon className={styles.homeIcon} />
              </Link>
              {/* <HighlightsDialog /> */}
            </div>
          </div>
          {children}
        </div>
      </div>
      <div id="reflections"></div>
      <div id="dialog"></div>
    </div>
  );
}
