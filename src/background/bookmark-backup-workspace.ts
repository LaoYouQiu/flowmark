import { getBookmarkSummary } from '@/src/shared/bookmark-summary';
import { messaging } from '@/src/shared/messaging';
import type {
  BookmarkBackupDownload,
  BookmarkBackupExport,
  BookmarkBackupFormat,
  BookmarkBackupNode,
  BookmarkTreeNodeSnapshot,
} from '@/src/shared/types';

export function initBookmarkBackupWorkspace(): void {
  // Read-only export endpoint used before risky bulk operations. It does not
  // mutate bookmarks or storage; the organizer page handles the actual download.
  messaging.onMessage('exportBookmarkBackup', async (message) => {
    const backup = await exportBookmarkBackup();
    return toDownloadPayload(backup, message.data?.format ?? 'json');
  });
}

async function exportBookmarkBackup(): Promise<BookmarkBackupExport> {
  const tree = await browser.bookmarks.getTree();
  const counters = {
    bookmarkCount: 0,
    folderCount: 0,
    summaryCount: 0,
  };

  const roots = await Promise.all(tree.map((node) => toBackupNode(node, counters)));

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    source: 'flowmark',
    bookmarkCount: counters.bookmarkCount,
    folderCount: counters.folderCount,
    summaryCount: counters.summaryCount,
    roots,
  };
}

function toDownloadPayload(
  backup: BookmarkBackupExport,
  format: BookmarkBackupFormat,
): BookmarkBackupDownload {
  const stamp = toFileStamp(new Date(backup.exportedAt));
  if (format === 'html') {
    return {
      fileName: `flowmark-bookmarks-${stamp}.html`,
      mimeType: 'text/html;charset=utf-8',
      content: toNetscapeBookmarkHtml(backup),
      format,
      bookmarkCount: backup.bookmarkCount,
      folderCount: backup.folderCount,
    };
  }

  return {
    fileName: `flowmark-bookmarks-${stamp}.json`,
    mimeType: 'application/json;charset=utf-8',
    content: JSON.stringify(backup, null, 2),
    format,
    bookmarkCount: backup.bookmarkCount,
    folderCount: backup.folderCount,
  };
}

function toNetscapeBookmarkHtml(backup: BookmarkBackupExport): string {
  // Browser importers expect the legacy Netscape bookmark HTML shape. We keep
  // summaries in the JSON backup and export only standard folders/bookmarks here.
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ];

  for (const root of backup.roots) {
    appendHtmlBookmarkNode(lines, root, 1);
  }

  lines.push('</DL><p>');
  return `${lines.join('\n')}\n`;
}

function appendHtmlBookmarkNode(
  lines: string[],
  node: BookmarkBackupNode,
  depth: number,
): void {
  const indent = '    '.repeat(depth);
  if (node.type === 'bookmark') {
    const addDate = toBookmarkTimestamp(node.dateAdded);
    lines.push(
      `${indent}<DT><A HREF="${escapeHtmlAttribute(node.url ?? '')}" ADD_DATE="${addDate}">${escapeHtmlText(node.title)}</A>`,
    );
    return;
  }

  const addDate = toBookmarkTimestamp(node.dateAdded);
  const modified = toBookmarkTimestamp(node.dateGroupModified);
  lines.push(
    `${indent}<DT><H3 ADD_DATE="${addDate}" LAST_MODIFIED="${modified}">${escapeHtmlText(node.title)}</H3>`,
  );
  lines.push(`${indent}<DL><p>`);
  for (const child of node.children ?? []) {
    appendHtmlBookmarkNode(lines, child, depth + 1);
  }
  lines.push(`${indent}</DL><p>`);
}

async function toBackupNode(
  node: BookmarkTreeNodeSnapshot,
  counters: { bookmarkCount: number; folderCount: number; summaryCount: number },
): Promise<BookmarkBackupNode> {
  if (node.url) {
    counters.bookmarkCount += 1;
    const summary = await getBookmarkSummary(node.id);
    if (summary) counters.summaryCount += 1;
    return {
      id: node.id,
      title: node.title ?? '',
      type: 'bookmark',
      url: node.url,
      dateAdded: node.dateAdded,
      summary: summary ?? undefined,
    };
  }

  counters.folderCount += 1;
  return {
    id: node.id,
    title: node.title ?? '',
    type: 'folder',
    dateAdded: node.dateAdded,
    dateGroupModified: node.dateGroupModified,
    children: await Promise.all((node.children ?? []).map((child) => toBackupNode(child, counters))),
  };
}

function toFileStamp(date: Date): string {
  // Keep filenames stable across locales and safe for Windows/macOS/Linux.
  return date.toISOString().replace(/[:.]/g, '-');
}

function toBookmarkTimestamp(value: number | undefined): string {
  return String(value ? Math.floor(value / 1000) : 0);
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replace(/"/g, '&quot;');
}
