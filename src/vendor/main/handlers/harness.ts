import { ipcMain } from 'electron';
import { generateWithHarness, getHarnessStatus } from '../utils/harness';

ipcMain.handle('harness-status', async () => {
  return getHarnessStatus();
});

ipcMain.handle('harness-generate', async (event, payload) => {
  const { requestId, harness, model, messages } = payload || {};
  try {
    const text = await generateWithHarness(harness, messages, model, (chunk) => {
      // In-process shim: the fake sender has no isDestroyed
      if (!event.sender.isDestroyed?.()) {
        event.sender.send('harness-chunk', requestId, chunk);
      }
    });
    return { ok: true, text };
  } catch (error: any) {
    return { ok: false, error: error?.message || String(error) };
  }
});
