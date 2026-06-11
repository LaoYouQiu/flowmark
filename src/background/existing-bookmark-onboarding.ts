import { getBookmarkSuggestion } from '@/src/shared/bookmark-ai';
import { getBookmarkSummary, normalizeBookmarkUrl, setBookmarkSummary } from '@/src/shared/bookmark-summary';
import { createTranslator, getCurrentLocale } from '@/src/shared/i18n';
import { messaging } from '@/src/shared/messaging';
import { appendOperationHistoryEntry } from '@/src/shared/operation-history';
import { getResolvedSettings } from '@/src/shared/settings';
import type {
  BookmarkFolderCandidate,
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
const SMART_ORGANIZE_CONCURRENCY = 8;

type SmartOrganizeJob = SmartOrganizeJobSnapshot & {
  bookmarkIds: string[];
  cursor: number;
  duplicateSkipIds: string[];
  canonicalFolderByPath: Record<string, string>;
};

type SmartOrganizePreflight = {
  duplicateSkipIds: Set<string>;
  canonicalFolderByPath: Map<string, string>;
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
  const preflight = await buildSmartOrganizePreflight(tree, bookmarksBarId, bookmarksBarLabel);
  const bookmarkNodes = flattenBookmarkNodes(tree)
    .filter(isOrganizableBookmarkNode)
    .filter((node) => !preflight.duplicateSkipIds.has(node.id));
  const suggestions = await generateSuggestionsForNodes({
    nodes: bookmarkNodes,
    tree,
    bookmarksBarId,
    bookmarksBarLabel,
    settings,
    locale,
    untitledFallback: t('common.untitled'),
    concurrency: SMART_ORGANIZE_CONCURRENCY,
    preflight,
  });

  return {
    totalBookmarksScanned: bookmarkNodes.length,
    suggestionCount: suggestions.length,
    suggestions,
  };
}

async function startSmartOrganizeJob(batchSize?: number): Promise<SmartOrganizeJobSnapshot> {
  const settings = await getResolvedSettings();
  const tree = await browser.bookmarks.getTree();
  const locale = await getCurrentLocale(settings.raw);
  const { t } = createTranslator(locale);
  const bookmarksBarId = getBookmarksBarId(tree);
  const bookmarksBarLabel = t('common.bookmarksBar');
  const preflight = await buildSmartOrganizePreflight(tree, bookmarksBarId, bookmarksBarLabel);
  const bookmarkNodes = flattenBookmarkNodes(tree)
    .filter(isOrganizableBookmarkNode)
    .filter((node) => !preflight.duplicateSkipIds.has(node.id));

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

  const normalizedBatchSize = Math.max(1, Math.min(40, Math.trunc(batchSize ?? settings.raw.smartOrganizeBatchSize)));
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
    duplicateSkipIds: [...preflight.duplicateSkipIds],
    canonicalFolderByPath: Object.fromEntries(preflight.canonicalFolderByPath),
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
    const preflight: SmartOrganizePreflight = {
      duplicateSkipIds: new Set(job.duplicateSkipIds),
      canonicalFolderByPath: new Map(Object.entries(job.canonicalFolderByPath)),
    };
    const end = Math.min(job.cursor + job.batchSize, job.bookmarkIds.length);
    const sliceIds = job.bookmarkIds.slice(job.cursor, end);
    const nodes = sliceIds
      .map((id) => nodesById.get(id))
      .filter((node): node is BookmarkTreeNodeSnapshot & { url: string } =>
        Boolean(node && isOrganizableBookmarkNode(node)),
      );

    // Process each bounded slice with limited concurrency. This keeps the UI
    // progress model unchanged while avoiding one AI request blocking the next.
    const suggestions = await generateSuggestionsForNodes({
      nodes,
      tree,
      bookmarksBarId,
      bookmarksBarLabel,
      settings,
      locale,
      untitledFallback: t('common.untitled'),
      concurrency: Math.min(SMART_ORGANIZE_CONCURRENCY, job.batchSize),
      preflight,
    });
    job.suggestions.push(...suggestions);
    job.scanned += sliceIds.length;
    job.cursor = end;

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

async function generateSuggestionsForNodes(input: {
  nodes: Array<BookmarkTreeNodeSnapshot & { url: string }>;
  tree: BookmarkTreeNodeSnapshot[];
  bookmarksBarId: string | null;
  bookmarksBarLabel: string;
  settings: Awaited<ReturnType<typeof getResolvedSettings>>;
  locale: Awaited<ReturnType<typeof getCurrentLocale>>;
  untitledFallback: string;
  concurrency: number;
  preflight: SmartOrganizePreflight;
}): Promise<ExistingBookmarkSuggestionItem[]> {
  const suggestions: ExistingBookmarkSuggestionItem[] = [];
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(input.concurrency, input.nodes.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < input.nodes.length) {
        const node = input.nodes[cursor];
        cursor += 1;
        if (!node) continue;

        try {
          const item = await generateSuggestionForNode({
            node,
            tree: input.tree,
            bookmarksBarId: input.bookmarksBarId,
            bookmarksBarLabel: input.bookmarksBarLabel,
            settings: input.settings,
            locale: input.locale,
            untitledFallback: input.untitledFallback,
            preflight: input.preflight,
          });
          if (item) suggestions.push(item);
        } catch {
          // Skip individual failures so one slow or rejected AI request does
          // not stop the whole organize scan.
        }
      }
    }),
  );

  return suggestions;
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
  preflight: SmartOrganizePreflight;
}): Promise<ExistingBookmarkSuggestionItem | null> {
  // Build one structured plan for an existing bookmark. The AI chooses a target
  // from local candidates; local code then translates the result into actions.
  const { node, tree, bookmarksBarId, bookmarksBarLabel, settings, locale, untitledFallback } = input;
  if (!node.url) return null;

  const existingFolderPaths = new Set([
    bookmarksBarLabel,
    ...collectFolderPaths(tree, bookmarksBarId)
      .map((path) => canonicalizeFolderPath(path, input.preflight.canonicalFolderByPath)),
  ]);
  const rawCurrentFolderPath = getRelativeFolderPath(
    tree,
    bookmarksBarId,
    node.parentId ?? null,
    bookmarksBarLabel,
  );
  const currentFolderPath = canonicalizeFolderPath(
    rawCurrentFolderPath,
    input.preflight.canonicalFolderByPath,
  );
  const pageContent = toPreviewPageContent(node);
  const folderCandidates = canonicalizeFolderCandidates(
    selectFolderCandidateNodes({
      tree,
      bookmarksBarId,
      bookmarksBarLabel,
      url: node.url,
      title: node.title ?? '',
      pageContent,
      currentFolderPath: rawCurrentFolderPath,
      maxCandidates: settings.raw.folderCandidateLimit,
    }),
    input.preflight.canonicalFolderByPath,
    bookmarksBarLabel,
  );
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
    suggestedFolder: canonicalizeFolderPath(
      suggestion.suggestedFolder,
      input.preflight.canonicalFolderByPath,
    ),
    suggestedTitle: suggestion.title,
    summary: suggestion.summary,
  });
  if (actions.length === 1 && actions[0]?.type === 'keep') return null;
  // Keep the displayed folder aligned with the actual plan. If intensity rules
  // suppress movement, the card should present this as metadata-only cleanup.
  const effectiveSuggestedFolder = actions.some((action) => action.type === 'move')
    ? canonicalizeFolderPath(suggestion.suggestedFolder, input.preflight.canonicalFolderByPath)
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

async function buildSmartOrganizePreflight(
  tree: BookmarkTreeNodeSnapshot[],
  bookmarksBarId: string | null,
  bookmarksBarLabel: string,
): Promise<SmartOrganizePreflight> {
  // Keep smart organize focused on items worth asking AI about. Duplicate URL
  // copies are better handled by Duplicate Cleanup, and similar folders should
  // resolve toward one stable target before AI sees the candidate list.
  const bookmarkNodes = flattenBookmarkNodes(tree).filter(isOrganizableBookmarkNode);
  const duplicateSkipIds = await collectDuplicateSkipIds(tree, bookmarksBarId, bookmarksBarLabel, bookmarkNodes);
  const canonicalFolderByPath = buildCanonicalFolderMap(tree, bookmarksBarId, bookmarksBarLabel);
  return {
    duplicateSkipIds,
    canonicalFolderByPath,
  };
}

async function collectDuplicateSkipIds(
  tree: BookmarkTreeNodeSnapshot[],
  bookmarksBarId: string | null,
  bookmarksBarLabel: string,
  bookmarkNodes: Array<BookmarkTreeNodeSnapshot & { url: string }>,
): Promise<Set<string>> {
  const groupsByUrl = new Map<string, Array<{
    id: string;
    title: string;
    folderPath: string;
    hasSummary: boolean;
  }>>();

  for (const node of bookmarkNodes) {
    const normalizedUrl = normalizeBookmarkUrl(node.url);
    if (!normalizedUrl) continue;
    const group = groupsByUrl.get(normalizedUrl) ?? [];
    const summary = await getBookmarkSummary(node.id);
    group.push({
      id: node.id,
      title: node.title ?? '',
      folderPath: getRelativeFolderPath(tree, bookmarksBarId, node.parentId ?? null, bookmarksBarLabel),
      hasSummary: Boolean(summary?.summary?.trim()),
    });
    groupsByUrl.set(normalizedUrl, group);
  }

  const skipIds = new Set<string>();
  for (const group of groupsByUrl.values()) {
    if (group.length <= 1) continue;
    const keepId = chooseSmartOrganizeDuplicateKeepId(group);
    for (const item of group) {
      if (item.id !== keepId) skipIds.add(item.id);
    }
  }
  return skipIds;
}

function chooseSmartOrganizeDuplicateKeepId(items: Array<{
  id: string;
  title: string;
  folderPath: string;
  hasSummary: boolean;
}>): string {
  return [...items].sort((a, b) =>
    scoreSmartOrganizeDuplicateKeep(b) - scoreSmartOrganizeDuplicateKeep(a) ||
    a.folderPath.localeCompare(b.folderPath) ||
    a.title.localeCompare(b.title),
  )[0]?.id ?? items[0]?.id ?? '';
}

function scoreSmartOrganizeDuplicateKeep(item: {
  title: string;
  folderPath: string;
  hasSummary: boolean;
}): number {
  let score = 0;
  if (item.hasSummary) score += 40;
  const title = item.title.trim();
  if (title.length >= 8 && title.length <= 80) score += 20;
  if (/^https?:\/\//i.test(title) || /^www\./i.test(title)) score -= 30;
  if (title.length > 120) score -= 12;
  score += Math.max(0, 8 - folderDepth(item.folderPath));
  return score;
}

function buildCanonicalFolderMap(
  tree: BookmarkTreeNodeSnapshot[],
  bookmarksBarId: string | null,
  bookmarksBarLabel: string,
): Map<string, string> {
  if (!bookmarksBarId) return new Map();
  const folders = collectSmartOrganizeFolderProfiles(tree, bookmarksBarId, bookmarksBarLabel);
  const groups = new Map<string, typeof folders>();

  for (const folder of folders) {
    if (folder.semanticParts.length < 2) continue;
    const group = groups.get(folder.signature) ?? [];
    group.push(folder);
    groups.set(folder.signature, group);
  }

  const canonical = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const target = [...group].sort((a, b) =>
      b.totalBookmarkCount - a.totalBookmarkCount ||
      a.depth - b.depth ||
      a.path.localeCompare(b.path),
    )[0];
    if (!target) continue;
    for (const folder of group) {
      if (folder.path !== target.path) canonical.set(folder.path, target.path);
    }
  }
  return canonical;
}

function collectSmartOrganizeFolderProfiles(
  tree: BookmarkTreeNodeSnapshot[],
  bookmarksBarId: string,
  bookmarksBarLabel: string,
): Array<{
  path: string;
  depth: number;
  totalBookmarkCount: number;
  semanticParts: string[];
  signature: string;
}> {
  const root = findTreeNodeById(tree, bookmarksBarId);
  if (!root) return [];
  const profiles: Array<{
    path: string;
    depth: number;
    totalBookmarkCount: number;
    semanticParts: string[];
    signature: string;
  }> = [];
  const stack: Array<{ node: BookmarkTreeNodeSnapshot; path: string; depth: number }> = [];

  for (const child of root.children ?? []) {
    if (!child.url) {
      const title = child.title?.trim();
      if (title) stack.push({ node: child, path: title, depth: 1 });
    }
  }

  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) break;
    const semanticParts = semanticFolderParts(item.path);
    profiles.push({
      path: item.path || bookmarksBarLabel,
      depth: item.depth,
      totalBookmarkCount: countBookmarkDescendants(item.node),
      semanticParts,
      signature: [...semanticParts].sort().join('|'),
    });

    for (const child of item.node.children ?? []) {
      if (child.url) continue;
      const title = child.title?.trim();
      if (!title) continue;
      stack.push({
        node: child,
        path: `${item.path}-${title}`,
        depth: item.depth + 1,
      });
    }
  }

  return profiles;
}

function canonicalizeFolderCandidates(
  candidates: BookmarkFolderCandidate[],
  canonicalFolderByPath: Map<string, string>,
  bookmarksBarLabel: string,
): BookmarkFolderCandidate[] {
  const byPath = new Map<string, BookmarkFolderCandidate>();
  for (const candidate of candidates) {
    const path = canonicalizeFolderPath(candidate.path, canonicalFolderByPath);
    const existing = byPath.get(path);
    const bookmarkCount = Math.max(existing?.bookmarkCount ?? 0, candidate.bookmarkCount ?? 0);
    byPath.set(path, toBookmarkFolderCandidate(path, bookmarksBarLabel, bookmarkCount));
  }
  return [...byPath.values()];
}

function canonicalizeFolderPath(path: string, canonicalFolderByPath: Map<string, string>): string {
  return canonicalFolderByPath.get(path) ?? path;
}

function toBookmarkFolderCandidate(
  path: string,
  bookmarksBarLabel: string,
  bookmarkCount?: number,
): BookmarkFolderCandidate {
  if (!path || path === bookmarksBarLabel) {
    return {
      path: bookmarksBarLabel,
      name: bookmarksBarLabel,
      parentPath: null,
      depth: 0,
      bookmarkCount,
    };
  }
  const parts = path.split('-').map((part) => part.trim()).filter(Boolean);
  return {
    path,
    name: parts.at(-1) ?? path,
    parentPath: parts.length > 1 ? parts.slice(0, -1).join('-') : bookmarksBarLabel,
    depth: parts.length,
    bookmarkCount,
  };
}

function findTreeNodeById(
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

function countBookmarkDescendants(node: BookmarkTreeNodeSnapshot): number {
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

function folderDepth(path: string): number {
  return path.split('-').map((part) => part.trim()).filter(Boolean).length;
}

function semanticFolderParts(path: string): string[] {
  const normalized = path
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\b(?:ai|aigc)\b|人工智能|智能/giu, ' ai ')
    .replace(/\btools?\b|工具|效率/giu, ' tool ');

  return normalized
    .split(/[^\p{L}\p{N}]+/gu)
    .map((part) => normalizeSemanticFolderPart(part))
    .filter((part) => part.length > 0 && !SMART_ORGANIZE_FOLDER_STOP_WORDS.has(part));
}

function normalizeSemanticFolderPart(part: string): string {
  const normalized = part.trim().toLowerCase();
  if (['ai', 'aigc', '人工智能', '智能'].includes(normalized)) return 'ai';
  if (['tool', 'tools', '工具', '效率'].includes(normalized)) return 'tool';
  if (['dev', 'develop', 'development', 'code', 'coding', '编程', '开发'].includes(normalized)) return 'dev';
  if (['doc', 'docs', 'document', 'documentation', '文档'].includes(normalized)) return 'docs';
  return normalized;
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

const SMART_ORGANIZE_FOLDER_STOP_WORDS = new Set([
  'www',
  'com',
  'org',
  'net',
  'app',
  'site',
  'web',
  'page',
  'pages',
  '网站',
  '网页',
  '页面',
  '资源',
  '收藏',
]);
