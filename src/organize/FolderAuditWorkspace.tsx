import { createMemo, createSignal, For, Show } from 'solid-js';

import { Button } from '@/src/components/Button';
import { ControlField } from '@/src/organize/ControlField';
import { DisclosurePanel } from '@/src/organize/DisclosurePanel';
import { ProgressBar } from '@/src/organize/ProgressBar';
import { RiskSummary } from '@/src/organize/RiskSummary';
import type { OrganizerModuleId, WorkspaceBaseProps } from '@/src/organize/types';
import { StatusBadge } from '@/src/components/StatusBadge';
import { useI18n } from '@/src/shared/i18n';
import { messaging } from '@/src/shared/messaging';
import type { FolderAuditIssue, FolderAuditPreview } from '@/src/shared/types';

type AuditState = 'idle' | 'loading' | 'cancelling' | 'cancelled' | 'ready' | 'error';

export function FolderAuditWorkspace(
  props: WorkspaceBaseProps & {
    onNavigate?: (moduleId: OrganizerModuleId, seed?: string) => void;
  },
) {
  const { t } = useI18n(props.locale);
  // Folder Audit is mostly read-only, except for similar-folder issues where
  // users can confirm a conservative merge into the suggested target folder.
  const [preview, setPreview] = createSignal<FolderAuditPreview | null>(null);
  const [state, setState] = createSignal<AuditState>('idle');
  const [message, setMessage] = createSignal<string | null>(null);
  const [scanToken, setScanToken] = createSignal(0);
  const [query, setQuery] = createSignal(props.initialQuery ?? '');
  const [typeFilter, setTypeFilter] = createSignal<'all' | FolderAuditIssue['type']>('all');
  const [applyingIssueId, setApplyingIssueId] = createSignal<string | null>(null);
  const [bulkApplying, setBulkApplying] = createSignal(false);
  const [selectedIssueIds, setSelectedIssueIds] = createSignal<Set<string>>(new Set());

  const filteredIssues = createMemo(() => {
    const keyword = query().trim().toLowerCase();
    const issues = preview()?.issues ?? [];
    return issues.filter((issue) => {
      const matchType = typeFilter() === 'all' || issue.type === typeFilter();
      const matchKeyword =
        keyword.length === 0 ||
        issue.path.toLowerCase().includes(keyword);
      return matchType && matchKeyword;
    });
  });

  const actionableMergeIssues = createMemo(() =>
    (preview()?.issues ?? []).filter(isActionableMergeIssue),
  );

  const selectedMergeIssues = createMemo(() => {
    const selected = selectedIssueIds();
    return actionableMergeIssues().filter((issue) => selected.has(issue.id));
  });

  const allActionableSelected = createMemo(() => {
    const issues = actionableMergeIssues();
    return issues.length > 0 && issues.every((issue) => selectedIssueIds().has(issue.id));
  });

  const loadPreview = async () => {
    // Ask the background to scan the current bookmark tree; filtering/searching
    // are kept local so the user can explore results without another scan.
    const token = scanToken() + 1;
    setScanToken(token);
    setState('loading');
    setMessage(t('audit.scanProgress'));
    try {
      const next = await messaging.sendMessage('generateFolderAuditPreview');
      if (scanToken() !== token) return;
      setPreview(next);
      setSelectedIssueIds(new Set(next.issues.filter(isActionableMergeIssue).map((issue) => issue.id)));
      setState('ready');
      setMessage(
        next.issues.length > 0
          ? t('audit.previewReady', {
              issues: next.issues.length,
              total: next.totalFoldersScanned,
            })
          : t('audit.previewEmpty'),
      );
    } catch {
      if (scanToken() !== token) return;
      setState('error');
      setMessage(t('audit.previewFailed'));
    }
  };

  const stopScan = () => {
    setScanToken((token) => token + 1);
    setState('cancelled');
    setMessage(t('audit.scanCancelled'));
  };

  const confirmNavigateToOrganizer = async () => {
    // For issues that need manual review rather than direct mutation, seed the
    // Smart Organize workspace with the current search query.
    const confirmed = await props.confirmAction?.({
      title: t('confirm.auditTitle'),
      body: t('confirm.openOrganizer'),
      confirmLabel: t('confirm.openButton'),
      cancelLabel: t('confirm.cancelButton'),
      tone: 'primary',
    });
    if (!confirmed) return;
    props.onNavigate?.('smart-organize', query());
  };

  const applyFolderMerge = async (issue: FolderAuditIssue) => {
    if (issue.type !== 'similar_folder' || !issue.suggestedTargetFolderId) return;

    // Similar-folder merge moves unique bookmarks, removes source duplicates,
    // and deletes only empty folders. The confirmation text names both paths.
    const confirmed = await props.confirmAction?.({
      title: t('confirm.folderMergeTitle'),
      body: t('confirm.folderMergeBody', {
        source: issue.path,
        target: issue.suggestedTargetFolderPath ?? '',
      }),
      confirmLabel: t('confirm.applyButton'),
      cancelLabel: t('confirm.cancelButton'),
      tone: 'primary',
      content: () => (
        <RiskSummary
          title={t('risk.summaryTitle')}
          items={[
            {
              label: t('risk.moveBookmarks'),
              value: issue.mergeBookmarkCount ?? issue.bookmarkCount,
            },
            {
              label: t('risk.removeDuplicateBookmarks'),
              value: Math.max(0, issue.bookmarkCount - (issue.mergeBookmarkCount ?? issue.bookmarkCount)),
              tone: 'danger',
            },
            {
              label: t('risk.deleteEmptyFolders'),
              value: 1,
              tone: 'warning',
            },
          ]}
          note={t('risk.folderMergeNote')}
        />
      ),
    });
    if (!confirmed) return;

    setApplyingIssueId(issue.id);
    setMessage(null);
    try {
      const result = await messaging.sendMessage('applyFolderMergeIssue', {
        sourceFolderId: issue.id,
        targetFolderId: issue.suggestedTargetFolderId,
      });
      setMessage(t('audit.mergeApplied', {
        moved: result.movedCount,
        duplicates: result.removedDuplicateCount,
        folders: result.deletedFolderCount,
      }));
      await loadPreview();
    } catch {
      setMessage(t('audit.mergeFailed'));
    } finally {
      setApplyingIssueId(null);
    }
  };

  const toggleMergeIssue = (issueId: string) => {
    setSelectedIssueIds((selected) => {
      const next = new Set(selected);
      if (next.has(issueId)) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      return next;
    });
  };

  const toggleAllMergeIssues = () => {
    if (allActionableSelected()) {
      setSelectedIssueIds(new Set<string>());
      return;
    }
    setSelectedIssueIds(new Set(actionableMergeIssues().map((issue) => issue.id)));
  };

  const applySelectedFolderMerges = async () => {
    const issues = selectedMergeIssues();
    if (issues.length === 0) {
      setMessage(t('audit.noMergeSelection'));
      return;
    }

    const totalBookmarks = issues.reduce(
      (sum, issue) => sum + (issue.mergeBookmarkCount ?? issue.bookmarkCount),
      0,
    );
    const totalDuplicates = issues.reduce(
      (sum, issue) => sum + Math.max(0, issue.bookmarkCount - (issue.mergeBookmarkCount ?? issue.bookmarkCount)),
      0,
    );

    const confirmed = await props.confirmAction?.({
      title: t('confirm.folderMergeManyTitle'),
      body: t('confirm.folderMergeManyBody', { count: issues.length }),
      confirmLabel: t('confirm.applyButton'),
      cancelLabel: t('confirm.cancelButton'),
      tone: 'primary',
      content: () => (
        <RiskSummary
          title={t('risk.summaryTitle')}
          items={[
            {
              label: t('risk.moveBookmarks'),
              value: totalBookmarks,
            },
            {
              label: t('risk.removeDuplicateBookmarks'),
              value: totalDuplicates,
              tone: 'danger',
            },
            {
              label: t('risk.deleteEmptyFolders'),
              value: issues.length,
              tone: 'warning',
            },
          ]}
          note={t('risk.folderMergeNote')}
        />
      ),
    });
    if (!confirmed) return;

    setBulkApplying(true);
    setMessage(null);
    let moved = 0;
    let duplicates = 0;
    let folders = 0;
    let applied = 0;
    try {
      for (const issue of issues) {
        setApplyingIssueId(issue.id);
        try {
          const result = await messaging.sendMessage('applyFolderMergeIssue', {
            sourceFolderId: issue.id,
            targetFolderId: issue.suggestedTargetFolderId,
          });
          moved += result.movedCount;
          duplicates += result.removedDuplicateCount;
          folders += result.deletedFolderCount;
          applied += 1;
        } catch {
          // Keep applying the rest of the selected merge suggestions even if
          // one folder changed or disappeared after the preview was generated.
        }
      }
      setMessage(t('audit.bulkMergeApplied', { applied, moved, duplicates, folders }));
      await loadPreview();
    } catch {
      setMessage(t('audit.mergeFailed'));
    } finally {
      setApplyingIssueId(null);
      setBulkApplying(false);
    }
  };

  return (
    <div class="space-y-6">
      <section class="rounded-lg border border-neutral-200 bg-white px-5 py-5 shadow-sm sm:px-6 sm:py-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
              {t('audit.sectionTitle')}
            </div>
            <h2 class="mt-2 text-2xl font-medium tracking-tight text-neutral-900">
              {t('audit.heading')}
            </h2>
            <p class="mt-3 max-w-2xl text-sm leading-6 text-neutral-500">
              {t('audit.description')}
            </p>
          </div>
          <StatusBadge tone={state() === 'error' ? 'warning' : state() === 'cancelled' ? 'warning' : 'neutral'}>
            {state() === 'loading'
              ? t('common.loading')
              : state() === 'cancelled'
                ? t('audit.cancelled')
                : t('audit.pending')}
          </StatusBadge>
        </div>

        <div class="mt-5 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-4">
          <p class="text-sm leading-6 text-neutral-600">
            {message() ?? t('audit.hint')}
          </p>
          <Show when={state() === 'loading' || state() === 'cancelling'}>
            <ProgressBar active />
          </Show>
        </div>

        <div class="mt-5 flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={loadPreview}
            disabled={state() === 'loading'}
          >
            {t('audit.scanButton')}
          </Button>
          <Show when={state() === 'loading' || state() === 'cancelling'}>
            <Button
              type="button"
              variant="secondary"
              onClick={stopScan}
            >
              {t('audit.stopScanButton')}
            </Button>
          </Show>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void confirmNavigateToOrganizer()}
          >
            {t('audit.openOrganizer')}
          </Button>
        </div>

        <Show when={preview()}>
          <div class="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_240px]">
            <ControlField
              label={t('audit.searchLabel')}
              description={t('audit.searchHelp')}
            >
              <input
                type="search"
                value={query()}
                placeholder={t('audit.searchPlaceholder')}
                class="w-full rounded-md border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition-colors focus:border-neutral-400"
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </ControlField>
            <ControlField
              label={t('audit.typeFilterLabel')}
              description={t('audit.typeFilterHelp')}
            >
              <select
                value={typeFilter()}
                class="w-full rounded-md border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition-colors focus:border-neutral-400"
                onInput={(event) => setTypeFilter(event.currentTarget.value as 'all' | FolderAuditIssue['type'])}
              >
                <option value="all">{t('audit.filterAll')}</option>
                <option value="empty_folder">{t('audit.typeEmpty')}</option>
                <option value="similar_folder">{t('audit.typeSimilar')}</option>
                <option value="deep_folder">{t('audit.typeDeep')}</option>
                <option value="sparse_folder">{t('audit.typeSparse')}</option>
              </select>
            </ControlField>
          </div>
        </Show>
      </section>

      <Show when={preview()}>
        {(currentPreview) => (
          <section class="rounded-lg border border-neutral-200 bg-white px-5 py-5 shadow-sm sm:px-6 sm:py-6">
            <div class="grid gap-3 sm:grid-cols-4">
              <StatCard label={t('audit.emptyFolders')} value={currentPreview().emptyFolderCount} />
              <StatCard label={t('audit.similarFolders')} value={currentPreview().similarFolderCount} />
              <StatCard label={t('audit.deepFolders')} value={currentPreview().deepFolderCount} />
              <StatCard label={t('audit.sparseFolders')} value={currentPreview().sparseFolderCount} />
            </div>

            <div class="mt-6 text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
              {t('audit.issueListTitle')}
            </div>
            <Show when={actionableMergeIssues().length > 0}>
              <div class="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
                <label class="inline-flex items-center gap-2 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    class="h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
                    checked={allActionableSelected()}
                    disabled={bulkApplying()}
                    onChange={toggleAllMergeIssues}
                  />
                  <span>{t('audit.selectAllMerges')}</span>
                </label>
                <div class="flex flex-wrap items-center gap-3">
                  <span class="text-xs text-neutral-500">
                    {t('audit.selectedMergeCount', { count: selectedMergeIssues().length })}
                  </span>
                  <Button
                    type="button"
                    onClick={() => void applySelectedFolderMerges()}
                    disabled={bulkApplying() || selectedMergeIssues().length === 0}
                  >
                    {bulkApplying()
                      ? t('audit.applyingMerge')
                      : t('audit.applySelectedMergeButton', { count: selectedMergeIssues().length })}
                  </Button>
                </div>
              </div>
            </Show>
            <div class="mt-4 space-y-3">
              <For each={filteredIssues()}>
                {(issue) => (
                  <IssueCard
                    issue={issue}
                    locale={props.locale}
                    applying={applyingIssueId() === issue.id}
                    disabled={bulkApplying()}
                    selectable={isActionableMergeIssue(issue)}
                    selected={selectedIssueIds().has(issue.id)}
                    onToggle={toggleMergeIssue}
                    onApplyMerge={applyFolderMerge}
                  />
                )}
              </For>
            </div>
          </section>
        )}
      </Show>
    </div>
  );
}

function isActionableMergeIssue(
  issue: FolderAuditIssue,
): issue is FolderAuditIssue & { suggestedTargetFolderId: string } {
  return issue.type === 'similar_folder' && Boolean(issue.suggestedTargetFolderId);
}

function StatCard(props: { label: string; value: number }) {
  return (
    <div class="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-4">
      <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
        {props.label}
      </div>
      <div class="mt-2 text-2xl font-medium tracking-tight text-neutral-900">
        {props.value}
      </div>
    </div>
  );
}

function IssueCard(props: {
  issue: FolderAuditIssue;
  locale: WorkspaceBaseProps['locale'];
  applying: boolean;
  disabled: boolean;
  selectable: boolean;
  selected: boolean;
  onToggle: (issueId: string) => void;
  onApplyMerge: (issue: FolderAuditIssue) => void;
}) {
  const { t } = useI18n(props.locale);
  // One issue card handles all audit issue kinds; optional merge fields are
  // present only for similar-folder suggestions.

  return (
    <article class="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex min-w-0 flex-1 gap-3">
          <Show when={props.selectable}>
            <input
              type="checkbox"
              class="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
              checked={props.selected}
              disabled={props.disabled}
              onChange={() => props.onToggle(props.issue.id)}
              aria-label={t('audit.selectMerge')}
            />
          </Show>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium text-neutral-900" title={props.issue.path}>
              {props.issue.path}
            </div>
            <div class="mt-2 flex flex-wrap gap-3 text-xs text-neutral-500">
              <span>{t('audit.bookmarkCount', { count: props.issue.bookmarkCount })}</span>
              <span>{t('audit.subfolderCount', { count: props.issue.subfolderCount })}</span>
              <span>{t('audit.depthValue', { count: props.issue.depth })}</span>
            </div>
          </div>
        </div>
        <StatusBadge tone={props.issue.type === 'empty_folder' || props.issue.type === 'similar_folder' ? 'warning' : 'neutral'}>
          {props.issue.type === 'empty_folder'
            ? t('audit.typeEmpty')
            : props.issue.type === 'similar_folder'
              ? t('audit.typeSimilar')
              : props.issue.type === 'deep_folder'
                ? t('audit.typeDeep')
                : t('audit.typeSparse')}
        </StatusBadge>
      </div>
      <Show when={props.issue.type === 'similar_folder'}>
        <div class="mt-4">
          <DisclosurePanel
            title={t('audit.mergeSuggestion')}
            summary={t('audit.mergeInto', {
              path: props.issue.suggestedTargetFolderPath ?? props.issue.path,
            })}
            showLabel={t('common.showDetails')}
            hideLabel={t('common.hideDetails')}
          >
            <Show when={props.issue.similarFolderPaths?.length}>
              <div class="flex flex-wrap gap-2">
                {props.issue.similarFolderPaths?.map((path) => (
                  <span class="rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-600">
                    {path}
                  </span>
                ))}
              </div>
            </Show>
            <div class="mt-3 text-xs text-neutral-500">
              {t('audit.mergeBookmarkCount', { count: props.issue.mergeBookmarkCount ?? 0 })}
            </div>
          </DisclosurePanel>
          <div class="mt-3">
            <Button
              type="button"
              onClick={() => props.onApplyMerge(props.issue)}
              disabled={props.disabled || props.applying || !props.issue.suggestedTargetFolderId}
            >
              {props.applying ? t('audit.applyingMerge') : t('audit.applyMerge')}
            </Button>
          </div>
        </div>
      </Show>
    </article>
  );
}
