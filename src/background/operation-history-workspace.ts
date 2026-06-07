import { removeBookmarkSummary, setBookmarkSummary } from '@/src/shared/bookmark-summary';
import { messaging } from '@/src/shared/messaging';
import {
  listOperationHistoryEntries,
  removeOperationHistoryEntry,
} from '@/src/shared/operation-history';
import type {
  OperationHistoryChange,
  OperationHistoryEntry,
  UndoOperationHistoryResult,
} from '@/src/shared/types';

export function initOperationHistoryWorkspace(): void {
  // Expose operation history to the organize page. History entries are created
  // by mutating workspaces such as duplicate cleanup and folder merge.
  messaging.onMessage('listOperationHistory', async () => ({
    entries: await listOperationHistoryEntries(),
  }));

  messaging.onMessage('undoOperationHistoryEntry', async ({ data }) => {
    return await undoOperationHistoryEntry(data.entryId);
  });
}

async function undoOperationHistoryEntry(entryId: string): Promise<UndoOperationHistoryResult> {
  // Undo in reverse order so folder deletes are restored after any later child
  // changes have been considered. Missing parents/bookmarks are skipped.
  const history = await listOperationHistoryEntries();
  const entry = history.find((item) => item.id === entryId);
  if (!entry) return { restoredCount: 0, skippedCount: 0 };

  let restoredCount = 0;
  let skippedCount = 0;

  for (const change of [...entry.changes].reverse()) {
    try {
      const restored = await undoChange(change);
      if (restored) restoredCount += 1;
      else skippedCount += 1;
    } catch {
      skippedCount += 1;
    }
  }

  if (restoredCount > 0) {
    await removeOperationHistoryEntry(entry.id);
  }

  return { restoredCount, skippedCount };
}

async function undoChange(change: OperationHistoryChange): Promise<boolean> {
  // Each change type stores just enough original state to restore the user's
  // bookmark structure without replaying the whole operation.
  switch (change.type) {
    case 'move_bookmark':
      if (!(await bookmarkExists(change.bookmarkId)) || !(await folderExists(change.fromParentId))) {
        return false;
      }
      await browser.bookmarks.move(change.bookmarkId, { parentId: change.fromParentId });
      return true;

    case 'rename_bookmark':
      if (!(await bookmarkExists(change.bookmarkId))) return false;
      await browser.bookmarks.update(change.bookmarkId, { title: change.fromTitle });
      return true;

    case 'delete_bookmark': {
      if (!(await folderExists(change.parentId))) return false;
      const created = await browser.bookmarks.create({
        parentId: change.parentId,
        title: change.title,
        url: change.url,
      });
      if (change.summary) {
        await setBookmarkSummary({
          ...change.summary,
          bookmarkId: created.id,
        });
      }
      return true;
    }

    case 'update_summary':
      if (!(await bookmarkExists(change.bookmarkId))) return false;
      if (change.fromSummary) {
        await setBookmarkSummary(change.fromSummary);
      } else {
        await removeBookmarkSummary(change.bookmarkId);
      }
      return true;

    case 'delete_empty_folder':
      if (!(await folderExists(change.parentId))) return false;
      await browser.bookmarks.create({
        parentId: change.parentId,
        title: change.title,
      });
      return true;
  }
}

async function bookmarkExists(bookmarkId: string): Promise<boolean> {
  try {
    const [bookmark] = await browser.bookmarks.get(bookmarkId);
    return Boolean(bookmark?.url);
  } catch {
    return false;
  }
}

async function folderExists(folderId: string): Promise<boolean> {
  try {
    const [folder] = await browser.bookmarks.get(folderId);
    return Boolean(folder && !folder.url);
  } catch {
    return false;
  }
}
