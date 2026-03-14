import { createTranslator, getCurrentLocale } from '@/src/shared/i18n';
import { messaging } from '@/src/shared/messaging';
import { getResolvedSettings } from '@/src/shared/settings';
import type {
  BookmarkTreeNodeSnapshot,
  FolderAuditIssue,
  FolderAuditPreview,
} from '@/src/shared/types';

import { getBookmarksBarId, getRelativeFolderPath } from './engine/helpers';

const MAX_FOLDER_AUDIT_ISSUES = 80;
const SPARSE_FOLDER_MAX_BOOKMARKS = 1;
const DEEP_FOLDER_MIN_DEPTH = 4;

export function initFolderAuditWorkspace(): void {
  messaging.onMessage('generateFolderAuditPreview', async () => {
    return await generateFolderAuditPreview();
  });
}

async function generateFolderAuditPreview(): Promise<FolderAuditPreview> {
  const settings = await getResolvedSettings();
  const locale = await getCurrentLocale(settings.raw);
  const { t } = createTranslator(locale);
  const tree = await browser.bookmarks.getTree();
  const bookmarksBarId = getBookmarksBarId(tree);
  const bookmarksBarLabel = t('common.bookmarksBar');

  const folderNodes = flattenFolderNodes(tree);
  const issues: FolderAuditIssue[] = [];

  for (const folder of folderNodes) {
    if (folder.id === bookmarksBarId) continue;

    const children = folder.children ?? [];
    const bookmarkCount = children.filter((child) => Boolean(child.url)).length;
    const subfolderCount = children.filter((child) => !child.url).length;
    const path = getRelativeFolderPath(
      tree,
      bookmarksBarId,
      folder.id,
      bookmarksBarLabel,
    );
    const depth = path === bookmarksBarLabel ? 0 : path.split('-').filter(Boolean).length;

    const type = resolveIssueType(bookmarkCount, subfolderCount, depth);
    if (!type) continue;

    issues.push({
      id: folder.id,
      path,
      type,
      bookmarkCount,
      subfolderCount,
      depth,
    });
  }

  const trimmed = issues
    .sort((a, b) => {
      const priority = issuePriority(a.type) - issuePriority(b.type);
      if (priority !== 0) return priority;
      return b.depth - a.depth || a.path.localeCompare(b.path);
    })
    .slice(0, MAX_FOLDER_AUDIT_ISSUES);

  return {
    totalFoldersScanned: folderNodes.length,
    emptyFolderCount: issues.filter((issue) => issue.type === 'empty_folder').length,
    sparseFolderCount: issues.filter((issue) => issue.type === 'sparse_folder').length,
    deepFolderCount: issues.filter((issue) => issue.type === 'deep_folder').length,
    issues: trimmed,
  };
}

function flattenFolderNodes(tree: BookmarkTreeNodeSnapshot[]): BookmarkTreeNodeSnapshot[] {
  const result: BookmarkTreeNodeSnapshot[] = [];
  const stack = [...tree];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    if (!node.url) result.push(node);
    for (const child of node.children ?? []) {
      stack.push(child);
    }
  }

  return result;
}

function resolveIssueType(
  bookmarkCount: number,
  subfolderCount: number,
  depth: number,
): FolderAuditIssue['type'] | null {
  if (bookmarkCount === 0 && subfolderCount === 0) return 'empty_folder';
  if (depth >= DEEP_FOLDER_MIN_DEPTH) return 'deep_folder';
  if (bookmarkCount <= SPARSE_FOLDER_MAX_BOOKMARKS && subfolderCount === 0) return 'sparse_folder';
  return null;
}

function issuePriority(type: FolderAuditIssue['type']): number {
  switch (type) {
    case 'empty_folder':
      return 0;
    case 'deep_folder':
      return 1;
    case 'sparse_folder':
      return 2;
  }
}
