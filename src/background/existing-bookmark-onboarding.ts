import { getBookmarkSuggestion } from '@/src/shared/bookmark-ai';
import { getBookmarkSummary, normalizeBookmarkUrl, setBookmarkSummary } from '@/src/shared/bookmark-summary';
import { createTranslator, getCurrentLocale } from '@/src/shared/i18n';
import { messaging } from '@/src/shared/messaging';
import { appendOperationHistoryEntry } from '@/src/shared/operation-history';
import { getResolvedSettings } from '@/src/shared/settings';
import type {
  BookmarkSummaryRecord,
  BookmarkTreeNodeSnapshot,
  ExistingBookmarkApplyActions,
  ExistingBookmarkPlanAction,
  ExistingBookmarkSuggestionReason,
  ExistingBookmarkSuggestionItem,
  ExistingBookmarkSuggestionPreview,
  OperationHistoryChange,
  PageContent,
  SmartOrganizeJobSnapshot,
} from '@/src/shared/types';

import {
  collectFolderPaths,
  getBookmarksBarId,
  getRelativeFolderPath,
  selectFolderCandidateNodes,
} from './engine/helpers';

const SMART_ORGANIZE_BATCH_THRESHOLD = 30;
const PAGE_TEXT_LIMIT = 5000;

type SmartOrganizeJob = SmartOrganizeJobSnapshot & {
  bookmarkIds: string[];
  cursor: number;
};

let activeSmartOrganizeJob: SmartOrganizeJob | null = null;

export function initExistingBookmarkOnboarding(): void {
  // Register the organize page API for existing-bookmark scans. Small libraries
  // can return a preview immediately; large libraries use the job endpoints.
  messaging.onMessage('generateExistingBookmarkPreview', async () => {
    return await generateExistingBookmarkPreview();
  });

  messaging.onMessage('applyExistingBookmarkPreview', async ({ data }) => {
    return await applyExistingBookmarkPreview(data);
  });

  messaging.onMessage('startSmartOrganizeJob', async ({ data }) => {
    return await startSmartOrganizeJob(data?.batchSize);
  });

  messaging.onMessage('runSmartOrganizeJobBatch', async ({ data }) => {
    return await runSmartOrganizeJobBatch(data.jobId);
  });

  messaging.onMessage('cancelSmartOrganizeJob', async ({ data }) => {
    return cancelSmartOrganizeJob(data.jobId);
  });
}

async function generateExistingBookmarkPreview(): Promise<ExistingBookmarkSuggestionPreview> {
  // Synchronous path for small bookmark sets. It reuses the same per-bookmark
  // planner as the batch job so both flows produce identical suggestion items.
  const settings = await getResolvedSettings();
  const locale = await getCurrentLocale(settings.raw);
  const { t } = createTranslator(locale);
  const configError = !settings.raw.aiBaseURL || !settings.raw.aiModel;
  if (configError) {
    return {
      totalBookmarksScanned: 0,
      suggestionCount: 0,
      suggestions: [],
    };
  }

  const tree = await browser.bookmarks.getTree();
  const bookmarksBarId = getBookmarksBarId(tree);
  const bookmarksBarLabel = t('common.bookmarksBar');
  const bookmarkNodes = flattenBookmarkNodes(tree).filter(isOrganizableBookmarkNode);
  const suggestions: ExistingBookmarkSuggestionItem[] = [];

  for (const node of bookmarkNodes) {
    const item = await generateSuggestionForNode({
      node,
      tree,
      bookmarksBarId,
      bookmarksBarLabel,
      settings,
      locale,
      untitledFallback: t('common.untitled'),
    });
    if (item) suggestions.push(item);
  }

  return {
    totalBookmarksScanned: bookmarkNodes.length,
    suggestionCount: suggestions.length,
    suggestions,
  };
}

async function startSmartOrganizeJob(batchSize?: number): Promise<SmartOrganizeJobSnapshot> {
  const settings = await getResolvedSettings();
  const tree = await browser.bookmarks.getTree();
  const bookmarkNodes = flattenBookmarkNodes(tree).filter(isOrganizableBookmarkNode);

  // Keep the UI simple for small libraries: no progress bar or polling when
  // the full preview can finish in one request.
  if (bookmarkNodes.length <= SMART_ORGANIZE_BATCH_THRESHOLD) {
    const preview = await generateExistingBookmarkPreview();
    return {
      id: `sync:${Date.now()}`,
      status: 'completed',
      total: preview.totalBookmarksScanned,
      scanned: preview.totalBookmarksScanned,
      suggestionCount: preview.suggestionCount,
      batchSize: preview.totalBookmarksScanned,
      suggestions: preview.suggestions,
    };
  }

  const normalizedBatchSize = Math.max(1, Math.min(20, Math.trunc(batchSize ?? settings.raw.smartOrganizeBatchSize)));
  activeSmartOrganizeJob = {
    id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
    status: 'running',
    total: bookmarkNodes.length,
    scanned: 0,
    suggestionCount: 0,
    batchSize: normalizedBatchSize,
    suggestions: [],
    bookmarkIds: bookmarkNodes.map((node) => node.id),
    cursor: 0,
  };

  return toSmartOrganizeJobSnapshot(activeSmartOrganizeJob);
}

async function runSmartOrganizeJobBatch(jobId: string): Promise<SmartOrganizeJobSnapshot> {
  const job = activeSmartOrganizeJob;
  if (!job || job.id !== jobId) {
    return {
      id: jobId,
      status: 'failed',
      total: 0,
      scanned: 0,
      suggestionCount: 0,
      batchSize: 0,
      suggestions: [],
      error: 'Job not found',
    };
  }
  if (job.status !== 'running') return toSmartOrganizeJobSnapshot(job);

  try {
    const settings = await getResolvedSettings();
    const locale = await getCurrentLocale(settings.raw);
    const { t } = createTranslator(locale);
    const tree = await browser.bookmarks.getTree();
    const bookmarksBarId = getBookmarksBarId(tree);
    const bookmarksBarLabel = t('common.bookmarksBar');
    const nodesById = new Map(flattenBookmarkNodes(tree).map((node) => [node.id, node]));
    const end = Math.min(job.cursor + job.batchSize, job.bookmarkIds.length);

    // Process a bounded slice per call so the organize UI can show progress and
    // resume after a failed batch without losing previous suggestions.
    for (; job.cursor < end; job.cursor += 1) {
      const node = nodesById.get(job.bookmarkIds[job.cursor] ?? '');
      job.scanned += 1;
      if (!node || !isOrganizableBookmarkNode(node)) continue;
      const item = await generateSuggestionForNode({
        node,
        tree,
        bookmarksBarId,
        bookmarksBarLabel,
        settings,
        locale,
        untitledFallback: t('common.untitled'),
      });
      if (item) job.suggestions.push(item);
    }

    job.suggestionCount = job.suggestions.length;
    if (job.cursor >= job.bookmarkIds.length) {
      job.status = 'completed';
    }
    return toSmartOrganizeJobSnapshot(job);
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Unknown error';
    return toSmartOrganizeJobSnapshot(job);
  }
}

function cancelSmartOrganizeJob(jobId: string): SmartOrganizeJobSnapshot {
  const job = activeSmartOrganizeJob;
  if (!job || job.id !== jobId) {
    return {
      id: jobId,
      status: 'cancelled',
      total: 0,
      scanned: 0,
      suggestionCount: 0,
      batchSize: 0,
      suggestions: [],
    };
  }

  job.status = 'cancelled';
  return toSmartOrganizeJobSnapshot(job);
}

async function generateSuggestionForNode(input: {
  node: BookmarkTreeNodeSnapshot;
  tree: BookmarkTreeNodeSnapshot[];
  bookmarksBarId: string | null;
  bookmarksBarLabel: string;
  settings: Awaited<ReturnType<typeof getResolvedSettings>>;
  locale: Awaited<ReturnType<typeof getCurrentLocale>>;
  untitledFallback: string;
}): Promise<ExistingBookmarkSuggestionItem | null> {
  // Build one structured plan for an existing bookmark. The AI chooses a target
  // from local candidates; local code then translates the result into actions.
  const { node, tree, bookmarksBarId, bookmarksBarLabel, settings, locale, untitledFallback } = input;
  if (!node.url) return null;

  const existingFolderPaths = new Set([
    bookmarksBarLabel,
    ...collectFolderPaths(tree, bookmarksBarId),
  ]);
  const currentFolderPath = getRelativeFolderPath(
    tree,
    bookmarksBarId,
    node.parentId ?? null,
    bookmarksBarLabel,
  );
  const pageContent = toPreviewPageContent(node);
  const folderCandidates = selectFolderCandidateNodes({
    tree,
    bookmarksBarId,
    bookmarksBarLabel,
    url: node.url,
    title: node.title ?? '',
    pageContent,
    currentFolderPath,
    maxCandidates: settings.raw.folderCandidateLimit,
  });
  const suggestion = await getBookmarkSuggestion({
    settings: settings.raw,
    locale,
    url: node.url,
    originalTitle: node.title ?? '',
    pageContent,
    folderCandidates,
    bookmarksBarLabel,
    summaryEnabled: settings.features.summary.enabled,
    untitledFallback,
  });
  if (!suggestion) return null;

  const actions = buildPlanActions({
    currentFolderPath,
    existingFolderPaths,
    bookmarksBarLabel,
    organizeIntensity: settings.raw.organizeIntensity,
    originalTitle: node.title ?? '',
    suggestedFolder: suggestion.suggestedFolder,
    suggestedTitle: suggestion.title,
    summary: suggestion.summary,
  });
  if (actions.length === 1 && actions[0]?.type === 'keep') return null;
  // Keep the displayed folder aligned with the actual plan. If intensity rules
  // suppress movement, the card should present this as metadata-only cleanup.
  const effectiveSuggestedFolder = actions.some((action) => action.type === 'move')
    ? suggestion.suggestedFolder
    : currentFolderPath;

  return {
    bookmarkId: node.id,
    url: node.url,
    originalTitle: node.title ?? '',
    currentFolderPath,
    suggestedFolder: effectiveSuggestedFolder,
    suggestedTitle: suggestion.title,
    confidence: suggestion.confidence,
    summary: suggestion.summary,
    reason: buildPlanReason(actions),
    actions,
  };
}

function toSmartOrganizeJobSnapshot(job: SmartOrganizeJob): SmartOrganizeJobSnapshot {
  return {
    id: job.id,
    status: job.status,
    total: job.total,
    scanned: job.scanned,
    suggestionCount: job.suggestionCount,
    batchSize: job.batchSize,
    suggestions: job.suggestions,
    error: job.error,
  };
}

async function applyExistingBookmarkPreview(input: {
  preview: ExistingBookmarkSuggestionPreview;
  actions: ExistingBookmarkApplyActions;
},
): Promise<{ appliedCount: number }> {
  const { preview, actions } = input;
  const settings = await getResolvedSettings();
  const locale = await getCurrentLocale(settings.raw);
  const { t } = createTranslator(locale);
  const tree = await browser.bookmarks.getTree();
  const bookmarksBarId = getBookmarksBarId(tree);
  if (!bookmarksBarId) return { appliedCount: 0 };

  let appliedCount = 0;
  const historyChanges: OperationHistoryChange[] = [];

  for (const item of preview.suggestions) {
    try {
      const [bookmark] = await browser.bookmarks.get(item.bookmarkId);
      if (!bookmark?.url) continue;

      const planActions = item.actions?.length ? item.actions : buildLegacyPlanActions(item);
      const moveAction = planActions.find((action) => action.type === 'move');
      const renameAction = planActions.find((action) => action.type === 'rename');
      const summaryAction = planActions.find((action) => action.type === 'summary');

      if (actions.moveToFolder && moveAction?.type === 'move') {
        const parentId = await findOrCreateFolderPath(bookmarksBarId, moveAction.targetFolderPath);
        if (bookmark.parentId && bookmark.parentId !== parentId) {
          historyChanges.push({
            type: 'move_bookmark',
            bookmarkId: item.bookmarkId,
            title: bookmark.title ?? item.originalTitle,
            url: bookmark.url,
            fromParentId: bookmark.parentId,
            toParentId: parentId,
          });
        }
        await browser.bookmarks.move(item.bookmarkId, { parentId });
      }

      if (actions.renameTitle && renameAction?.type === 'rename') {
        if ((bookmark.title ?? '') !== renameAction.title) {
          historyChanges.push({
            type: 'rename_bookmark',
            bookmarkId: item.bookmarkId,
            fromTitle: bookmark.title ?? item.originalTitle,
            toTitle: renameAction.title,
          });
        }
        await browser.bookmarks.update(item.bookmarkId, { title: renameAction.title });
      }

      if (actions.updateSummary && settings.features.summary.enabled && summaryAction?.type === 'summary') {
        const normalizedUrl = normalizeBookmarkUrl(bookmark.url);
        if (normalizedUrl) {
          const existing = await getBookmarkSummary(item.bookmarkId);
          const now = Date.now();
          const folderPath = actions.moveToFolder && moveAction?.type === 'move'
            ? moveAction.targetFolderPath || t('common.bookmarksBar')
            : getRelativeFolderPath(
                tree,
                bookmarksBarId,
                bookmark.parentId ?? null,
                t('common.bookmarksBar'),
              );
          const record: BookmarkSummaryRecord = {
            bookmarkId: item.bookmarkId,
            url: bookmark.url,
            normalizedUrl,
            title: actions.renameTitle && renameAction?.type === 'rename'
              ? renameAction.title
              : bookmark.title ?? item.originalTitle,
            folderPath,
            summary: summaryAction.summary.trim(),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          };
          historyChanges.push({
            type: 'update_summary',
            bookmarkId: item.bookmarkId,
            fromSummary: existing,
            toSummary: record,
          });
          await setBookmarkSummary(record);
        }
      }

      appliedCount += 1;
    } catch {
      // Ignore individual bookmark failures to keep the batch flowing.
    }
  }

  await appendOperationHistoryEntry({
    kind: 'smart_organize',
    label: `Applied ${appliedCount} smart organize updates`,
    changes: historyChanges,
  });

  return { appliedCount };
}

function buildPlanActions(input: {
  currentFolderPath: string;
  existingFolderPaths: Set<string>;
  bookmarksBarLabel: string;
  organizeIntensity: Awaited<ReturnType<typeof getResolvedSettings>>['raw']['organizeIntensity'];
  originalTitle: string;
  suggestedFolder: string;
  suggestedTitle: string;
  summary: string;
}): ExistingBookmarkPlanAction[] {
  // Translate the normalized AI suggestion into explicit, user-reviewable
  // operations. Destructive actions are intentionally not generated here.
  const actions: ExistingBookmarkPlanAction[] = [];
  const targetFolderPath = input.suggestedFolder || input.bookmarksBarLabel;
  const folderChanged =
    input.organizeIntensity !== 'conservative' &&
    targetFolderPath !== input.currentFolderPath;

  if (folderChanged) {
    const allowNewFolder = input.organizeIntensity === 'aggressive';
    if (!input.existingFolderPaths.has(targetFolderPath) && allowNewFolder) {
      const parts = targetFolderPath.split('-').map((part) => part.trim()).filter(Boolean);
      const folderName = parts.at(-1) ?? targetFolderPath;
      const parentFolderPath = parts.length > 1
        ? parts.slice(0, -1).join('-')
        : input.bookmarksBarLabel;
      actions.push({
        type: 'create_folder',
        parentFolderPath,
        folderName,
        targetFolderPath,
      });
    }
    if (!input.existingFolderPaths.has(targetFolderPath) && !allowNewFolder) {
      // Balanced mode avoids creating new folders during bulk cleanup. The
      // title/summary actions below can still be applied safely.
    } else {
      actions.push({
        type: 'move',
        targetFolderPath,
      });
    }
  }

  const suggestedTitle = input.suggestedTitle.trim();
  if (suggestedTitle && suggestedTitle !== input.originalTitle.trim()) {
    actions.push({
      type: 'rename',
      title: suggestedTitle,
    });
  }

  const summary = input.summary.trim();
  if (summary) {
    actions.push({
      type: 'summary',
      summary,
    });
  }

  return actions.length > 0 ? actions : [{ type: 'keep' }];
}

function buildLegacyPlanActions(item: ExistingBookmarkSuggestionItem): ExistingBookmarkPlanAction[] {
  const actions: ExistingBookmarkPlanAction[] = [];
  if (item.suggestedFolder && item.suggestedFolder !== item.currentFolderPath) {
    actions.push({ type: 'move', targetFolderPath: item.suggestedFolder });
  }
  if (item.suggestedTitle.trim() && item.suggestedTitle.trim() !== item.originalTitle.trim()) {
    actions.push({ type: 'rename', title: item.suggestedTitle.trim() });
  }
  if (item.summary.trim()) actions.push({ type: 'summary', summary: item.summary.trim() });
  return actions.length > 0 ? actions : [{ type: 'keep' }];
}

function buildPlanReason(actions: ExistingBookmarkPlanAction[]): ExistingBookmarkSuggestionReason {
  // Keep reason labels derived from the actual actions. That makes the UI
  // explanation trustworthy even if the model phrased the raw suggestion oddly.
  const actionTypes = new Set(actions.map((action) => action.type));
  if (actionTypes.has('create_folder')) return 'new_folder';
  if (actionTypes.has('move') && (actionTypes.has('rename') || actionTypes.has('summary'))) {
    return 'folder_and_metadata';
  }
  if (actionTypes.has('move')) return 'move_folder';
  if (actionTypes.has('rename') && actionTypes.has('summary')) return 'metadata_only';
  if (actionTypes.has('rename')) return 'rename_only';
  if (actionTypes.has('summary')) return 'summary_only';
  return 'keep';
}

function flattenBookmarkNodes(tree: BookmarkTreeNodeSnapshot[]): BookmarkTreeNodeSnapshot[] {
  const result: BookmarkTreeNodeSnapshot[] = [];
  const stack = [...tree];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    if (node.url) result.push(node);
    for (const child of node.children ?? []) {
      stack.push(child);
    }
  }

  return result;
}

function isOrganizableBookmarkNode(
  node: BookmarkTreeNodeSnapshot,
): node is BookmarkTreeNodeSnapshot & { url: string } {
  return Boolean(node.url && /^https?:\/\//i.test(node.url));
}

function toPreviewPageContent(node: BookmarkTreeNodeSnapshot): PageContent {
  const title = node.title?.trim() ?? '';

  return {
    url: node.url ?? '',
    title,
    description: '',
    headings: title ? [title] : [],
    text: title.slice(0, PAGE_TEXT_LIMIT) || null,
    hasPasswordField: false,
    formFieldCount: 0,
    linkCount: 0,
  };
}

async function findOrCreateFolderPath(bookmarksBarId: string, folderPath: string): Promise<string> {
  const parts = folderPath
    .split('-')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) return bookmarksBarId;

  let currentParentId = bookmarksBarId;
  for (const part of parts) {
    const children = await browser.bookmarks.getChildren(currentParentId);
    const existing = children.find((child) => !child.url && child.title === part);
    if (existing) {
      currentParentId = existing.id;
      continue;
    }

    const created = await browser.bookmarks.create({ parentId: currentParentId, title: part });
    currentParentId = created.id;
  }

  return currentParentId;
}
