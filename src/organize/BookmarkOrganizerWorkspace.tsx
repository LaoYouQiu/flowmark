import { createMemo, createSignal, For, Show } from 'solid-js';

import { Button } from '@/src/components/Button';
import { ControlField } from '@/src/organize/ControlField';
import { DisclosurePanel } from '@/src/organize/DisclosurePanel';
import { RiskSummary, type RiskSummaryItem } from '@/src/organize/RiskSummary';
import type { WorkspaceBaseProps } from '@/src/organize/types';
import { StatusBadge } from '@/src/components/StatusBadge';
import { useI18n } from '@/src/shared/i18n';
import { messaging } from '@/src/shared/messaging';
import type {
  ExistingBookmarkApplyActions,
  ExistingBookmarkPlanAction,
  ExistingBookmarkSuggestionReason,
  ExistingBookmarkSuggestionItem,
  ExistingBookmarkSuggestionPreview,
  SmartOrganizeJobSnapshot,
} from '@/src/shared/types';

type BatchState =
  | 'idle'
  | 'loading'
  | 'batching'
  | 'cancelling'
  | 'cancelled'
  | 'ready'
  | 'applying'
  | 'applied'
  | 'error';

export function BookmarkOrganizerWorkspace(props: WorkspaceBaseProps) {
  const { t } = useI18n(props.locale);
  // This workspace has two phases: generate a preview/job of suggested actions,
  // then apply the selected subset with user-chosen action categories.
  const [batchPreview, setBatchPreview] = createSignal<ExistingBookmarkSuggestionPreview | null>(null);
  const [batchState, setBatchState] = createSignal<BatchState>('idle');
  const [batchMessage, setBatchMessage] = createSignal<string | null>(null);
  const [jobSnapshot, setJobSnapshot] = createSignal<SmartOrganizeJobSnapshot | null>(null);
  const [selectedIds, setSelectedIds] = createSignal<string[]>([]);
  const [query, setQuery] = createSignal(props.initialQuery ?? '');
  const [stopRequested, setStopRequested] = createSignal(false);
  const [applyActions, setApplyActions] = createSignal<ExistingBookmarkApplyActions>({
    moveToFolder: true,
    renameTitle: true,
    updateSummary: true,
  });

  const selectedCount = createMemo(() => selectedIds().length);
  const filteredSuggestions = createMemo(() => {
    const keyword = query().trim().toLowerCase();
    const suggestions = batchPreview()?.suggestions ?? [];
    if (!keyword) return suggestions;
    return suggestions.filter((item) =>
      [item.originalTitle, item.url, item.currentFolderPath, item.suggestedFolder, item.suggestedTitle]
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    );
  });

  const loadPreview = async () => {
    // The background decides whether the scan is synchronous or a batch job
    // based on bookmark count; the UI consumes both through the same snapshot.
    setBatchState('loading');
    setBatchMessage(null);
    setJobSnapshot(null);
    setStopRequested(false);
    try {
      // Batch size is controlled by settings; an empty payload lets background
      // apply the latest saved budget preference.
      const job = await messaging.sendMessage('startSmartOrganizeJob', {});
      await consumeSmartOrganizeJob(job);
    } catch {
      setBatchState('error');
      setBatchMessage(t('organize.previewFailed'));
    }
  };

  const consumeSmartOrganizeJob = async (initialJob: SmartOrganizeJobSnapshot) => {
    // Poll one bounded batch at a time so suggestions can appear progressively
    // and the UI remains responsive for large bookmark libraries.
    let current = initialJob;
    setJobSnapshot(current);
    setBatchPreview(toPreview(current));
    setSelectedIds(current.suggestions.map((item) => item.bookmarkId));

    if (current.status === 'completed') {
      finishJobPreview(current);
      return;
    }

    setBatchState('batching');
    while (current.status === 'running' && !stopRequested()) {
      setBatchMessage(t('organize.batchProgress', {
        scanned: current.scanned,
        total: current.total,
        count: current.suggestionCount,
      }));
      current = await messaging.sendMessage('runSmartOrganizeJobBatch', { jobId: current.id });
      setJobSnapshot(current);
      setBatchPreview(toPreview(current));
      setSelectedIds((selected) => [
        ...selected,
        ...current.suggestions
          .map((item) => item.bookmarkId)
          .filter((id) => !selected.includes(id)),
      ]);
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }

    if (current.status === 'cancelled' || stopRequested()) {
      finishCancelledPreview(current);
      return;
    }

    if (current.status === 'completed') {
      finishJobPreview(current);
      return;
    }

    setBatchState('error');
    setBatchMessage(current.error ?? t('organize.previewFailed'));
  };

  const finishJobPreview = (job: SmartOrganizeJobSnapshot) => {
    const preview = toPreview(job);
    setBatchPreview(preview);
    setBatchState('ready');
    setBatchMessage(
      preview.suggestionCount > 0
        ? t('organize.previewReady', {
            count: preview.suggestionCount,
            total: preview.totalBookmarksScanned,
          })
        : t('organize.previewEmpty'),
    );
  };

  const finishCancelledPreview = (job: SmartOrganizeJobSnapshot) => {
    const preview = toPreview(job);
    setBatchPreview(preview);
    setBatchState('cancelled');
    setBatchMessage(t('organize.scanCancelled', {
      scanned: job.scanned,
      total: job.total,
      count: preview.suggestionCount,
    }));
  };

  const stopScan = async () => {
    const job = jobSnapshot();
    if (!job || (job.status !== 'running' && batchState() !== 'batching')) return;

    setStopRequested(true);
    setBatchState('cancelling');
    setBatchMessage(t('organize.cancellingScan'));
    try {
      const cancelled = await messaging.sendMessage('cancelSmartOrganizeJob', { jobId: job.id });
      setJobSnapshot(cancelled);
      finishCancelledPreview(cancelled);
    } catch {
      setBatchState('error');
      setBatchMessage(t('organize.cancelFailed'));
    }
  };

  const toPreview = (job: SmartOrganizeJobSnapshot): ExistingBookmarkSuggestionPreview => ({
    totalBookmarksScanned: job.total,
    suggestionCount: job.suggestions.length,
    suggestions: job.suggestions,
  });

  const applySelected = async (applyAll: boolean) => {
    const preview = batchPreview();
    if (!preview) return;

    // Send only the selected suggestions back to the background. The preview
    // shape stays the same, which keeps the apply API simple.
    const allowedIds = new Set(applyAll ? preview.suggestions.map((item) => item.bookmarkId) : selectedIds());
    const payload: ExistingBookmarkSuggestionPreview = {
      ...preview,
      suggestionCount: preview.suggestions.filter((item) => allowedIds.has(item.bookmarkId)).length,
      suggestions: preview.suggestions.filter((item) => allowedIds.has(item.bookmarkId)),
    };

    if (payload.suggestions.length === 0) {
      setBatchState('ready');
      setBatchMessage(t('organize.noSelection'));
      return;
    }

    setApplyActions({
      moveToFolder: true,
      renameTitle: true,
      updateSummary: true,
    });

    const confirmed = await props.confirmAction?.({
      title: t('confirm.organizeTitle'),
      body: t(
        applyAll ? 'confirm.applyAllRecommendations' : 'confirm.applySelectedRecommendations',
        { count: payload.suggestions.length },
      ),
      confirmLabel: t('confirm.applyButton'),
      cancelLabel: t('confirm.cancelButton'),
      tone: 'primary',
      content: () => (
        <div class="space-y-3">
          <RiskSummary
            title={t('risk.summaryTitle')}
            items={buildOrganizeRiskItems(payload.suggestions, applyActions(), t)}
            note={t('risk.organizeNote')}
          />
          <div class="text-xs font-medium uppercase tracking-[0.14em] text-neutral-400">
            {t('confirm.organizeStepsTitle')}
          </div>
          <label class="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm text-neutral-700">
            <input
              type="checkbox"
              class="mt-0.5 h-4 w-4 rounded border-neutral-300 accent-neutral-900"
              checked={applyActions().moveToFolder}
              onInput={(event) =>
                setApplyActions((current) => ({
                  ...current,
                  moveToFolder: event.currentTarget.checked,
                }))
              }
            />
            <span>{t('confirm.organizeStepMove')}</span>
          </label>
          <label class="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm text-neutral-700">
            <input
              type="checkbox"
              class="mt-0.5 h-4 w-4 rounded border-neutral-300 accent-neutral-900"
              checked={applyActions().renameTitle}
              onInput={(event) =>
                setApplyActions((current) => ({
                  ...current,
                  renameTitle: event.currentTarget.checked,
                }))
              }
            />
            <span>{t('confirm.organizeStepRename')}</span>
          </label>
          <label class="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm text-neutral-700">
            <input
              type="checkbox"
              class="mt-0.5 h-4 w-4 rounded border-neutral-300 accent-neutral-900"
              checked={applyActions().updateSummary}
              onInput={(event) =>
                setApplyActions((current) => ({
                  ...current,
                  updateSummary: event.currentTarget.checked,
                }))
              }
            />
            <span>{t('confirm.organizeStepSummary')}</span>
          </label>
        </div>
      ),
    });
    if (!confirmed) return;

    const actions = applyActions();
    if (!actions.moveToFolder && !actions.renameTitle && !actions.updateSummary) {
      setBatchState('ready');
      setBatchMessage(t('organize.noActionSelected'));
      return;
    }

    setBatchState('applying');
    setBatchMessage(null);

    try {
      const result = await messaging.sendMessage('applyExistingBookmarkPreview', {
        preview: payload,
        actions,
      });
      setBatchState('applied');
      setBatchMessage(t('organize.applySuccess', { count: result.appliedCount }));
      await loadPreview();
    } catch {
      setBatchState('error');
      setBatchMessage(t('organize.applyFailed'));
    }
  };

  const toggleSelection = (bookmarkId: string, checked: boolean) => {
    setSelectedIds((current) => {
      if (checked) {
        return current.includes(bookmarkId) ? current : [...current, bookmarkId];
      }
      return current.filter((id) => id !== bookmarkId);
    });
  };

  const setAllSelected = (checked: boolean) => {
    const preview = batchPreview();
    if (!preview) return;
    setSelectedIds(checked ? preview.suggestions.map((item) => item.bookmarkId) : []);
  };

  const isAllSelected = createMemo(() => {
    const preview = batchPreview();
    if (!preview || preview.suggestions.length === 0) return false;
    return selectedIds().length === preview.suggestions.length;
  });

  return (
    <div class="space-y-6">
      <section class="rounded-lg border border-neutral-200 bg-white px-5 py-5 shadow-sm sm:px-6 sm:py-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
              {t('organize.sectionTitle')}
            </div>
            <h2 class="mt-2 text-2xl font-medium tracking-tight text-neutral-900">
              {t('organize.heading')}
            </h2>
            <p class="mt-3 max-w-2xl text-sm leading-6 text-neutral-500">
              {t('organize.description')}
            </p>
          </div>
          <StatusBadge
            tone={
              batchState() === 'error'
                ? 'warning'
                : batchState() === 'applied'
                  ? 'ready'
                  : 'neutral'
            }
          >
            {batchState() === 'loading'
              ? t('common.loading')
              : batchState() === 'batching'
                ? t('organize.batching')
              : batchState() === 'cancelling'
                ? t('organize.cancelling')
              : batchState() === 'cancelled'
                ? t('organize.cancelled')
              : batchState() === 'applying'
                ? t('organize.applying')
                : batchState() === 'applied'
                  ? t('organize.applied')
                  : t('organize.pending')}
          </StatusBadge>
        </div>

        <div class="mt-5 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-4">
          <p class="text-sm leading-6 text-neutral-600">
            {batchMessage() ?? t('organize.hint')}
          </p>
          <Show when={batchState() === 'batching' || batchState() === 'cancelling' ? jobSnapshot() : null}>
            {(job) => (
              <div class="mt-3 h-2 overflow-hidden rounded-full bg-neutral-200">
                <div
                  class="h-full rounded-full bg-neutral-900 transition-all"
                  style={{ width: `${job().total > 0 ? Math.round((job().scanned / job().total) * 100) : 0}%` }}
                />
              </div>
            )}
          </Show>
        </div>

        <div class="mt-5 flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={loadPreview}
            disabled={batchState() === 'loading' || batchState() === 'batching' || batchState() === 'applying'}
          >
            {t('organize.scanButton')}
          </Button>
          <Show when={batchState() === 'batching' || batchState() === 'cancelling'}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void stopScan()}
              disabled={batchState() === 'cancelling'}
            >
              {batchState() === 'cancelling'
                ? t('organize.stoppingScanButton')
                : t('organize.stopScanButton')}
            </Button>
          </Show>
          <Show when={batchPreview()?.suggestions.length}>
            <Button
              type="button"
              onClick={() => void applySelected(false)}
              disabled={
                batchState() === 'loading' ||
                batchState() === 'batching' ||
                batchState() === 'cancelling' ||
                batchState() === 'applying'
              }
            >
              {t('organize.applySelectedButton', { count: selectedCount() })}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void applySelected(true)}
              disabled={
                batchState() === 'loading' ||
                batchState() === 'batching' ||
                batchState() === 'cancelling' ||
                batchState() === 'applying'
              }
            >
              {t('organize.applyAllButton')}
            </Button>
          </Show>
        </div>

        <Show when={batchPreview()?.suggestions.length}>
          <div class="mt-5">
            <ControlField
              label={t('organize.searchLabel')}
              description={t('organize.searchHelp')}
            >
              <input
                type="search"
                value={query()}
                placeholder={t('organize.searchPlaceholder')}
                class="w-full rounded-md border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition-colors focus:border-neutral-400"
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </ControlField>
          </div>
        </Show>
      </section>

      <Show when={batchPreview()?.suggestions.length}>
        <section class="rounded-lg border border-neutral-200 bg-white px-5 py-5 shadow-sm sm:px-6 sm:py-6">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
                {t('organize.reviewTitle')}
              </div>
              <div class="mt-2 text-lg font-medium tracking-tight text-neutral-900">
                {t('organize.reviewSubtitle', { count: batchPreview()?.suggestions.length ?? 0 })}
              </div>
            </div>

            <label class="inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                class="h-4 w-4 rounded border-neutral-300 accent-neutral-900"
                checked={isAllSelected()}
                onInput={(event) => setAllSelected(event.currentTarget.checked)}
              />
              <span>{t('organize.selectAll')}</span>
            </label>
          </div>

          <div class="mt-5 space-y-3">
            <For each={filteredSuggestions()}>
              {(item) => (
                <SuggestionCard
                  item={item}
                  checked={selectedIds().includes(item.bookmarkId)}
                  locale={props.locale}
                  onToggle={(checked) => toggleSelection(item.bookmarkId, checked)}
                />
              )}
            </For>
          </div>
        </section>
      </Show>
    </div>
  );
}

function buildOrganizeRiskItems(
  suggestions: ExistingBookmarkSuggestionItem[],
  actions: ExistingBookmarkApplyActions,
  t: ReturnType<typeof useI18n>['t'],
): RiskSummaryItem[] {
  // Count the concrete plan actions that will still be enabled after the user
  // toggles apply categories in the confirmation dialog.
  const actionCounts = suggestions.reduce(
    (counts, item) => {
      if (actions.moveToFolder && hasPlanAction(item.actions, 'create_folder')) {
        counts.createFolders += 1;
      }
      if (actions.moveToFolder && hasPlanAction(item.actions, 'move')) {
        counts.moveBookmarks += 1;
      }
      if (actions.renameTitle && hasPlanAction(item.actions, 'rename')) {
        counts.renameBookmarks += 1;
      }
      if (actions.updateSummary && hasPlanAction(item.actions, 'summary')) {
        counts.updateSummaries += 1;
      }
      return counts;
    },
    {
      createFolders: 0,
      moveBookmarks: 0,
      renameBookmarks: 0,
      updateSummaries: 0,
    },
  );

  return [
    {
      label: t('risk.createFolders'),
      value: actionCounts.createFolders,
      tone: 'warning',
    },
    {
      label: t('risk.moveBookmarks'),
      value: actionCounts.moveBookmarks,
    },
    {
      label: t('risk.renameBookmarks'),
      value: actionCounts.renameBookmarks,
    },
    {
      label: t('risk.updateSummaries'),
      value: actionCounts.updateSummaries,
    },
  ];
}

function hasPlanAction(
  actions: ExistingBookmarkPlanAction[],
  type: ExistingBookmarkPlanAction['type'],
): boolean {
  return actions.some((action) => action.type === type);
}

function SuggestionCard(props: {
  item: ExistingBookmarkSuggestionItem;
  checked: boolean;
  locale: WorkspaceBaseProps['locale'];
  onToggle: (checked: boolean) => void;
}) {
  const { t } = useI18n(props.locale);
  const suggestedFolder = createMemo(() => props.item.suggestedFolder || t('common.bookmarksBar'));
  // A suggestion can be useful even when the folder stays the same: it may only
  // rename the bookmark or write a summary, so the card labels that case clearly.
  const folderUnchanged = createMemo(() => suggestedFolder() === props.item.currentFolderPath);

  return (
    <article class="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-4 transition-colors hover:border-neutral-300">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <label class="flex min-w-0 flex-1 items-start gap-3">
          <input
            type="checkbox"
            class="mt-1 h-4 w-4 rounded border-neutral-300 accent-neutral-900"
            checked={props.checked}
            onInput={(event) => props.onToggle(event.currentTarget.checked)}
          />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium text-neutral-900" title={props.item.originalTitle}>
              {props.item.originalTitle || props.item.url}
            </div>
            <div class="mt-1 truncate text-xs text-neutral-500" title={props.item.url}>
              {props.item.url}
            </div>
          </div>
        </label>
        <StatusBadge tone="neutral">{Math.round(props.item.confidence * 100)}%</StatusBadge>
      </div>

      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <div class="rounded-md border border-neutral-200 bg-white px-3 py-3">
          <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
            {t('organize.currentFolder')}
          </div>
          <div class="mt-2 text-sm text-neutral-900">{props.item.currentFolderPath}</div>
        </div>
        <div class="rounded-md border border-neutral-200 bg-white px-3 py-3">
          <div class="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
            <span>
              {folderUnchanged() ? t('organize.folderUnchanged') : t('organize.suggestedFolder')}
            </span>
            <Show when={folderUnchanged()}>
              <span class="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[10px] normal-case tracking-normal text-neutral-500">
                {t('organize.titleSummaryOnly')}
              </span>
            </Show>
          </div>
          <div class="mt-2 text-sm text-neutral-900">
            {suggestedFolder()}
          </div>
        </div>
      </div>

      <div class="mt-3 rounded-md border border-neutral-200 bg-white px-3 py-3">
        <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
          {t('organize.suggestedTitle')}
        </div>
        <div class="mt-2 text-sm text-neutral-900">{props.item.suggestedTitle}</div>
      </div>

      <div class="mt-3">
        <DisclosurePanel
          title={t('organize.detailTitle')}
          summary={reasonText(props.item.reason, props.locale)}
          showLabel={t('common.showDetails')}
          hideLabel={t('common.hideDetails')}
        >
          <div class="space-y-3">
            <Show when={props.item.summary}>
              <p class="text-sm leading-6 text-neutral-600">{props.item.summary}</p>
            </Show>
            <div>
              <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
                {t('organize.reasonTitle')}
              </div>
              <p class="mt-2 text-sm leading-6 text-neutral-600">
                {reasonText(props.item.reason, props.locale)}
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              {props.item.actions.map((action) => (
                <ActionBadge action={action} locale={props.locale} />
              ))}
            </div>
          </div>
        </DisclosurePanel>
      </div>
    </article>
  );
}

function reasonText(reason: ExistingBookmarkSuggestionReason, locale: WorkspaceBaseProps['locale']): string {
  const { t } = useI18n(locale);
  switch (reason) {
    case 'new_folder':
      return t('organize.reasonNewFolder');
    case 'move_folder':
      return t('organize.reasonMoveFolder');
    case 'folder_and_metadata':
      return t('organize.reasonFolderAndMetadata');
    case 'metadata_only':
      return t('organize.reasonMetadataOnly');
    case 'rename_only':
      return t('organize.reasonRenameOnly');
    case 'summary_only':
      return t('organize.reasonSummaryOnly');
    case 'keep':
      return t('organize.reasonKeep');
  }
}

function ActionBadge(props: {
  action: ExistingBookmarkPlanAction;
  locale: WorkspaceBaseProps['locale'];
}) {
  const { t } = useI18n(props.locale);
  // Action badges mirror the background plan actions, giving users a compact
  // checklist of what applying this suggestion can change.
  const label = createMemo(() => {
    switch (props.action.type) {
      case 'create_folder':
        return t('organize.actionCreateFolder');
      case 'move':
        return t('organize.actionMove');
      case 'rename':
        return t('organize.actionRename');
      case 'summary':
        return t('organize.actionSummary');
      case 'delete':
        return t('organize.actionDelete');
      case 'merge':
        return t('organize.actionMerge');
      case 'keep':
        return t('organize.actionKeep');
    }
  });
  const destructive = createMemo(() => props.action.type === 'delete' || props.action.type === 'merge');

  return (
    <span
      class={[
        'rounded-full border px-2.5 py-1 text-xs font-medium',
        destructive()
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-neutral-200 bg-white text-neutral-600',
      ].join(' ')}
    >
      {label()}
    </span>
  );
}
