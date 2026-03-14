import type { OperationHistoryEntry } from './types';

const STORAGE_KEY = 'flowmark.operationHistory';
const MAX_HISTORY_ENTRIES = 30;

export async function appendOperationHistoryEntry(
  entry: Omit<OperationHistoryEntry, 'id' | 'createdAt'>,
): Promise<void> {
  if (entry.changes.length === 0) return;

  const history = await listOperationHistoryEntries();
  const next: OperationHistoryEntry = {
    ...entry,
    id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
    createdAt: Date.now(),
  };

  await browser.storage.local.set({
    [STORAGE_KEY]: [next, ...history].slice(0, MAX_HISTORY_ENTRIES),
  });
}

export async function listOperationHistoryEntries(): Promise<OperationHistoryEntry[]> {
  const raw = await browser.storage.local.get(STORAGE_KEY);
  const value = raw[STORAGE_KEY];
  if (!Array.isArray(value)) return [];

  return value.filter((entry): entry is OperationHistoryEntry =>
    Boolean(
      entry &&
      typeof entry === 'object' &&
      typeof entry.id === 'string' &&
      typeof entry.kind === 'string' &&
      typeof entry.label === 'string' &&
      typeof entry.createdAt === 'number' &&
      Array.isArray(entry.changes),
    ),
  );
}

export async function removeOperationHistoryEntry(entryId: string): Promise<void> {
  const history = await listOperationHistoryEntries();
  await browser.storage.local.set({
    [STORAGE_KEY]: history.filter((entry) => entry.id !== entryId),
  });
}
