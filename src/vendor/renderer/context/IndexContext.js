import {
  useState,
  createContext,
  useContext,
  useEffect,
  useCallback,
} from 'react';
import { useLocation } from 'react-router-dom';
import { usePilesContext } from './PilesContext';

export const IndexContext = createContext();

export const IndexContextProvider = ({ children }) => {
  const { currentPile, getCurrentPilePath } = usePilesContext();
  const [filters, setFilters] = useState();
  const [searchOpen, setSearchOpen] = useState(false);
  const [index, setIndex] = useState(new Map());
  const [latestThreads, setLatestThreads] = useState([]);

  useEffect(() => {
    if (currentPile) {
      loadIndex(getCurrentPilePath());
      loadLatestThreads();
    }
  }, [currentPile]);

  const loadIndex = useCallback(async (pilePath) => {
    const newIndex = await window.electron.ipc.invoke('index-load', pilePath);
    const newMap = new Map(newIndex);
    setIndex(newMap);
  }, []);

  const refreshIndex = useCallback(async () => {
    const newIndex = await window.electron.ipc.invoke('index-get');
    const newMap = new Map(newIndex);
    setIndex(newMap);
  }, []);

  const prependIndex = useCallback((key, value) => {
    console.log('prepend index', key, value)
    setIndex((prevIndex) => {
      const newIndex = new Map([[key, value], ...prevIndex]);
      return newIndex;
    });
  }, []);

  // Insert/replace an entry and keep the map sorted by createdAt (newest first),
  // mirroring pileIndex.sortMap on the main side. Used when saving so a
  // back-dated entry lands in its correct chronological spot instead of the top.
  const sortedUpsertIndex = useCallback((key, value) => {
    setIndex((prevIndex) => {
      const merged = new Map(prevIndex);
      merged.set(key, value);
      return new Map(
        [...merged.entries()].sort(
          (a, b) => new Date(b[1].createdAt) - new Date(a[1].createdAt)
        )
      );
    });
  }, []);

  const addIndex = useCallback(
    async (newEntryPath, parentPath = null) => {
      console.time('index-add-time');
      const pilePath = getCurrentPilePath();

      await window.electron.ipc
      .invoke('index-add', newEntryPath)
      .then((index) => {
        // setIndex(index);
        loadLatestThreads();
      });
      console.timeEnd('index-add-time');
    },
    [currentPile]
  );

  const regenerateEmbeddings = () => {
    window.electron.ipc.invoke('index-regenerate-embeddings');
  };

  const getThreadsAsText = useCallback(async (filePaths) => {
    return window.electron.ipc.invoke('index-get-threads-as-text', filePaths);
  }, []);

  const updateIndex = useCallback(async (filePath, data) => {
    window.electron.ipc.invoke('index-update', filePath, data).then((index) => {
      setIndex(index);
      loadLatestThreads();
    });
  }, []);

  const removeIndex = useCallback(async (filePath) => {
    window.electron.ipc.invoke('index-remove', filePath).then((index) => {
      setIndex(index);
    });
  }, []);

  const search = useCallback(async (query) => {
    return window.electron.ipc.invoke('index-search', query);
  }, []);

  const vectorSearch = useCallback(async (query, topN = 50) => {
    return window.electron.ipc.invoke('index-vector-search', query, topN);
  }, []);

  const loadLatestThreads = useCallback(async (count = 25) => {
    const items = await search('');
    const latest = items.slice(0, count);

    const entryFilePaths = latest.map((entry) => entry.ref);
    const latestThreadsAsText = await getThreadsAsText(entryFilePaths);

    setLatestThreads(latestThreadsAsText);
  }, []);

  const indexContextValue = {
    index,
    refreshIndex,
    addIndex,
    removeIndex,
    updateIndex,
    search,
    searchOpen,
    setSearchOpen,
    vectorSearch,
    getThreadsAsText,
    latestThreads,
    regenerateEmbeddings,
    prependIndex,
    sortedUpsertIndex,
  };

  return (
    <IndexContext.Provider value={indexContextValue}>
      {children}
    </IndexContext.Provider>
  );
};

export const useIndexContext = () => useContext(IndexContext);
