import { createMemo, createSignal, For, Show } from 'solid-js';

import { Button } from '@/src/components/Button';
import type { WorkspaceBaseProps } from '@/src/organize/types';
import { StatusBadge } from '@/src/components/StatusBadge';
import { useI18n } from '@/src/shared/i18n';
import { messaging } from '@/src/shared/messaging';
import type {
  ExistingBookmarkApplyActions,
  ExistingBookmarkSuggestionItem,
  ExistingBookmarkSuggestionPreview,
} from '@/src/shared/types';

type BatchState = 'idle' | 'loading' | 'ready' | 'applying' | 'applied' | 'error';

export function BookmarkOrganizerWorkspace(props: WorkspaceBaseProps) {
  const { t } = useI18n(props.locale);
  const [batchPreview, setBatchPreview] = createSignal<ExistingBookmarkSuggestionPreview | null>(null);
  const [batchState, setBatchState] = createSignal<BatchState>('idle');
  const [batchMessage, setBatchMessage] = createSignal<string | null>(null);
  const [selectedIds, setSelectedIds] = createSignal<string[]>([]);
  const [query, setQuery] = createSignal(props.initialQuery ?? '');
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
    setBatchState('loading');
    setBatchMessage(null);
    try {
      const preview = await messaging.sendMessage('generateExistingBookmarkPreview');
      setBatchPreview(preview);
      setSelectedIds(preview.suggestions.map((item) => item.bookmarkId));
      setBatchState('ready');
      setBatchMessage(
        preview.suggestionCount > 0
          ? t('organize.previewReady', {
              count: preview.suggestionCount,
              total: preview.totalBookmarksScanned,
            })
          : t('organize.previewEmpty'),
      );
    } catch {
      setBatchState('error');
      setBatchMessage(t('organize.previewFailed'));
    }
  };

  const applySelected = async (applyAll: boolean) => {
    const preview = batchPreview();
    if (!preview) return;

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
      <section class="rounded-2xl border border-neutral-200 bg-white px-5 py-5 shadow-[0_10px_30px_rgba(0,0,0,0.04)] sm:px-6 sm:py-6">
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
              : batchState() === 'applying'
                ? t('organize.applying')
                : batchState() === 'applied'
                  ? t('organize.applied')
                  : t('organize.pending')}
          </StatusBadge>
        </div>

        <div class="mt-5 rounded-xl border border-neutral-200 bg-[#fafafa] px-4 py-4">
          <p class="text-sm leading-6 text-neutral-600">
            {batchMessage() ?? t('organize.hint')}
          </p>
        </div>

        <div class="mt-5 flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={loadPreview}
            disabled={batchState() === 'loading' || batchState() === 'applying'}
          >
            {t('organize.scanButton')}
          </Button>
          <Show when={batchPreview()?.suggestions.length}>
            <Button
              type="button"
              onClick={() => void applySelected(false)}
              disabled={batchState() === 'applying'}
            >
              {t('organize.applySelectedButton', { count: selectedCount() })}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void applySelected(true)}
              disabled={batchState() === 'applying'}
            >
              {t('organize.applyAllButton')}
            </Button>
          </Show>
        </div>

        <Show when={batchPreview()?.suggestions.length}>
          <div class="mt-5">
            <input
              type="search"
              value={query()}
              placeholder={t('organize.searchPlaceholder')}
              class="w-full rounded-xl border border-neutral-200 bg-[#fafafa] px-4 py-3 text-sm text-neutral-900 outline-none transition-colors focus:border-neutral-400"
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </div>
        </Show>
      </section>

      <Show when={batchPreview()?.suggestions.length}>
        <section class="rounded-2xl border border-neutral-200 bg-white px-5 py-5 shadow-[0_10px_30px_rgba(0,0,0,0.04)] sm:px-6 sm:py-6">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
                {t('organize.reviewTitle')}
              </div>
              <div class="mt-2 text-lg font-medium tracking-tight text-neutral-900">
                {t('organize.reviewSubtitle', { count: batchPreview()?.suggestions.length ?? 0 })}
              </div>
            </div>

            <label class="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-[#fafafa] px-3 py-2 text-sm text-neutral-700">
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

      <section class="rounded-2xl border border-dashed border-neutral-300 bg-[linear-gradient(135deg,#ffffff,rgba(245,245,245,0.9))] px-5 py-5 sm:px-6 sm:py-6">
        <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
          {t('organize.futureSectionTitle')}
        </div>
        <h3 class="mt-2 text-lg font-medium tracking-tight text-neutral-900">
          {t('organize.futureHeading')}
        </h3>
        <p class="mt-3 max-w-2xl text-sm leading-6 text-neutral-500">
          {t('organize.futureDescription')}
        </p>
      </section>
    </div>
  );
}

function SuggestionCard(props: {
  item: ExistingBookmarkSuggestionItem;
  checked: boolean;
  locale: WorkspaceBaseProps['locale'];
  onToggle: (checked: boolean) => void;
}) {
  const { t } = useI18n(props.locale);

  return (
    <article class="rounded-xl border border-neutral-200 bg-[#fafafa] px-4 py-4 transition-colors hover:border-neutral-300">
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
          <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
            {t('organize.suggestedFolder')}
          </div>
          <div class="mt-2 text-sm text-neutral-900">
            {props.item.suggestedFolder || t('common.bookmarksBar')}
          </div>
        </div>
      </div>

      <div class="mt-3 rounded-md border border-neutral-200 bg-white px-3 py-3">
        <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
          {t('organize.suggestedTitle')}
        </div>
        <div class="mt-2 text-sm text-neutral-900">{props.item.suggestedTitle}</div>
        <Show when={props.item.summary}>
          <p class="mt-3 text-sm leading-6 text-neutral-500">{props.item.summary}</p>
        </Show>
      </div>
    </article>
  );
}
