import { getBookmarkSummary, normalizeBookmarkUrl, removeBookmarkSummary } from '@/src/shared/bookmark-summary';
import { createTranslator, getCurrentLocale } from '@/src/shared/i18n';
import { messaging } from '@/src/shared/messaging';
import { appendOperationHistoryEntry } from '@/src/shared/operation-history';
import { getResolvedSettings } from '@/src/shared/settings';
import type {
  ApplyFolderMergeIssueResult,
  BookmarkTreeNodeSnapshot,
  FolderAuditIssue,
  FolderAuditPreview,
  OperationHistoryChange,
} from '@/src/shared/types';

import { getBookmarksBarId, getRelativeFolderPath } from './engine/helpers';

const MAX_FOLDER_AUDIT_ISSUES = 80;
const SPARSE_FOLDER_MAX_BOOKMARKS = 1;
const DEEP_FOLDER_MIN_DEPTH = 4;
const MIN_SIMILAR_FOLDER_PARTS = 2;

export function initFolderAuditWorkspace(): void {
  messaging.onMessage('generateFolderAuditPreview', async () => {
    return await generateFolderAuditPreview();
  });

  messaging.onMessage('applyFolderMergeIssue', async ({ data }) => {
    return await applyFolderMergeIssue(data.sourceFolderId, data.targetFolderId);
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

  issues.push(...detectSimilarFolderIssues(tree, bookmarksBarId, bookmarksBarLabel));

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
    similarFolderCount: issues.filter((issue) => issue.type === 'similar_folder').length,
    issues: trimmed,
  };
}

function detectSimilarFolderIssues(
  tree: BookmarkTreeNodeSnapshot[],
  bookmarksBarId: string | null,
  bookmarksBarLabel: string,
): FolderAuditIssue[] {
  if (!bookmarksBarId) return [];

  const folders = flattenFolderNodes(tree)
    .filter((folder) => folder.id !== bookmarksBarId)
    .map((folder) => {
      const displayPath = getDisplayFolderPath(tree, bookmarksBarId, folder.id, bookmarksBarLabel);
      const semanticParts = getSemanticPathParts(displayPath);
      return {
        folder,
        displayPath,
        semanticParts,
        signature: toSemanticSignature(semanticParts),
        directBookmarkCount: (folder.children ?? []).filter((child) => Boolean(child.url)).length,
        totalBookmarkCount: countBookmarks(folder),
        subfolderCount: (folder.children ?? []).filter((child) => !child.url).length,
      };
    })
    .filter((folder) => folder.semanticParts.length >= MIN_SIMILAR_FOLDER_PARTS);

  const groups = new Map<string, typeof folders>();
  for (const folder of folders) {
    const existing = groups.get(folder.signature) ?? [];
    existing.push(folder);
    groups.set(folder.signature, existing);
  }

  const issues: FolderAuditIssue[] = [];

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const sorted = [...group].sort((a, b) =>
      b.totalBookmarkCount - a.totalBookmarkCount ||
      a.semanticParts.length - b.semanticParts.length ||
      a.displayPath.localeCompare(b.displayPath),
    );
    const target = sorted[0];
    if (!target) continue;

    for (const source of sorted.slice(1)) {
      issues.push({
        id: source.folder.id,
        path: source.displayPath,
        type: 'similar_folder',
        bookmarkCount: source.directBookmarkCount,
        subfolderCount: source.subfolderCount,
        depth: source.semanticParts.length,
        similarFolderPaths: sorted.map((item) => item.displayPath),
        suggestedTargetFolderId: target.folder.id,
        suggestedTargetFolderPath: target.displayPath,
        mergeBookmarkCount: source.totalBookmarkCount,
      });
    }
  }

  return issues;
}

async function applyFolderMergeIssue(
  sourceFolderId: string,
  targetFolderId: string,
): Promise<ApplyFolderMergeIssueResult> {
  if (sourceFolderId === targetFolderId) {
    return { movedCount: 0, removedDuplicateCount: 0, deletedFolderCount: 0 };
  }

  const [sourceFolder] = await browser.bookmarks.get(sourceFolderId);
  const [targetFolder] = await browser.bookmarks.get(targetFolderId);
  if (!sourceFolder || !targetFolder || sourceFolder.url || targetFolder.url) {
    return { movedCount: 0, removedDuplicateCount: 0, deletedFolderCount: 0 };
  }

  const targetUrls = await collectNormalizedBookmarkUrls(targetFolderId);
  const sourceBookmarks = await collectBookmarkDescendants(sourceFolderId);
  const historyChanges: OperationHistoryChange[] = [];
  let movedCount = 0;
  let removedDuplicateCount = 0;

  for (const bookmark of sourceBookmarks) {
    if (!bookmark.url) continue;
    const normalizedUrl = normalizeBookmarkUrl(bookmark.url);
    if (normalizedUrl && targetUrls.has(normalizedUrl)) {
      const summary = await getBookmarkSummary(bookmark.id);
      await browser.bookmarks.remove(bookmark.id);
      await removeBookmarkSummary(bookmark.id);
      historyChanges.push({
        type: 'delete_bookmark',
        bookmarkId: bookmark.id,
        title: bookmark.title,
        url: bookmark.url,
        parentId: bookmark.parentId,
        summary: summary ?? undefined,
      });
      removedDuplicateCount += 1;
      continue;
    }

    await browser.bookmarks.move(bookmark.id, { parentId: targetFolderId });
    historyChanges.push({
      type: 'move_bookmark',
      bookmarkId: bookmark.id,
      title: bookmark.title,
      url: bookmark.url,
      fromParentId: bookmark.parentId,
      toParentId: targetFolderId,
    });
    if (normalizedUrl) targetUrls.add(normalizedUrl);
    movedCount += 1;
  }

  const deletedFolderCount = await removeEmptyFolderTree(sourceFolderId, historyChanges);
  await appendOperationHistoryEntry({
    kind: 'folder_merge',
    label: `Merged folder ${sourceFolder.title} into ${targetFolder.title}`,
    changes: historyChanges,
  });
  return {
    movedCount,
    removedDuplicateCount,
    deletedFolderCount,
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
    case 'similar_folder':
      return 0;
    case 'empty_folder':
      return 1;
    case 'deep_folder':
      return 2;
    case 'sparse_folder':
      return 3;
  }
}

function getDisplayFolderPath(
  tree: BookmarkTreeNodeSnapshot[],
  bookmarksBarId: string | null,
  folderId: string,
  bookmarksBarLabel: string,
): string {
  if (!bookmarksBarId || folderId === bookmarksBarId) return bookmarksBarLabel;

  const parts: string[] = [];
  let currentId: string | null = folderId;

  while (currentId && currentId !== bookmarksBarId) {
    const node = findNodeById(tree, currentId);
    if (!node) break;
    if (node.title.trim()) parts.unshift(node.title.trim());
    currentId = node.parentId ?? null;
  }

  return parts.join(' / ') || bookmarksBarLabel;
}

function findNodeById(
  tree: BookmarkTreeNodeSnapshot[],
  id: string,
): BookmarkTreeNodeSnapshot | null {
  const stack = [...tree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    if (node.id === id) return node;
    for (const child of node.children ?? []) stack.push(child);
  }
  return null;
}

function countBookmarks(node: BookmarkTreeNodeSnapshot): number {
  let count = 0;
  const stack = [...(node.children ?? [])];

  while (stack.length > 0) {
    const child = stack.pop();
    if (!child) break;
    if (child.url) {
      count += 1;
      continue;
    }
    for (const grandchild of child.children ?? []) stack.push(grandchild);
  }

  return count;
}

async function collectNormalizedBookmarkUrls(folderId: string): Promise<Set<string>> {
  const bookmarks = await collectBookmarkDescendants(folderId);
  const urls = new Set<string>();

  for (const bookmark of bookmarks) {
    const normalizedUrl = normalizeBookmarkUrl(bookmark.url ?? '');
    if (normalizedUrl) urls.add(normalizedUrl);
  }

  return urls;
}

async function collectBookmarkDescendants(folderId: string): Promise<Array<{
  id: string;
  title: string;
  url?: string;
  parentId: string;
}>> {
  const result: Array<{ id: string; title: string; url?: string; parentId: string }> = [];
  const stack = await browser.bookmarks.getChildren(folderId);

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    if (node.url) {
      result.push({
        id: node.id,
        title: node.title,
        url: node.url,
        parentId: node.parentId ?? folderId,
      });
      continue;
    }
    const children = await browser.bookmarks.getChildren(node.id);
    for (const child of children) stack.push(child);
  }

  return result;
}

async function removeEmptyFolderTree(
  folderId: string,
  historyChanges: OperationHistoryChange[],
): Promise<number> {
  let deletedCount = 0;
  let changed = true;

  while (changed) {
    changed = false;
    const folders = await collectFolderDescendantsPostOrder(folderId);
    for (const folder of folders) {
      const children = await browser.bookmarks.getChildren(folder.id);
      if (children.length > 0) continue;
      const [folderNode] = await browser.bookmarks.get(folder.id);
      await browser.bookmarks.remove(folder.id);
      if (folderNode?.parentId) {
        historyChanges.push({
          type: 'delete_empty_folder',
          folderId: folder.id,
          title: folderNode.title,
          parentId: folderNode.parentId,
        });
      }
      deletedCount += 1;
      changed = true;
    }
  }

  return deletedCount;
}

async function collectFolderDescendantsPostOrder(folderId: string): Promise<Array<{ id: string }>> {
  const result: Array<{ id: string }> = [];
  const visit = async (id: string) => {
    const children = await browser.bookmarks.getChildren(id);
    for (const child of children) {
      if (!child.url) await visit(child.id);
    }
    result.push({ id });
  };

  await visit(folderId);
  return result;
}

function getSemanticPathParts(path: string): string[] {
  return path
    .replace(/人工智能/gi, ' ai ')
    .replace(/([a-z0-9])([\u4e00-\u9fff])/gi, '$1 $2')
    .replace(/([\u4e00-\u9fff])([a-z0-9])/gi, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/gu)
    .map((part) => normalizeSemanticPart(part))
    .filter((part) => part.length > 0 && !SIMILAR_FOLDER_STOP_WORDS.has(part));
}

function normalizeSemanticPart(part: string): string {
  const normalized = part.trim().toLowerCase();
  if (normalized === '人工智能') return 'ai';
  return normalized;
}

function toSemanticSignature(parts: string[]): string {
  return [...new Set(parts)].sort((a, b) => a.localeCompare(b)).join('|');
}

const SIMILAR_FOLDER_STOP_WORDS = new Set([
  'www',
  'com',
  'org',
  'net',
]);
