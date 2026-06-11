import { createMemo, createSignal, For, Show } from 'solid-js';

import { Button } from '@/src/components/Button';
import { ControlField } from '@/src/organize/ControlField';
import { ProgressBar } from '@/src/organize/ProgressBar';
import { RiskSummary } from '@/src/organize/RiskSummary';
import type { WorkspaceBaseProps } from '@/src/organize/types';
import { StatusBadge } from '@/src/components/StatusBadge';
import { useI18n } from '@/src/shared/i18n';
import { messaging } from '@/src/shared/messaging';
import type { SummaryToolItem, SummaryToolPreview } from '@/src/shared/types';

type SummaryState = 'idle' | 'loading' | 'cancelled' | 'ready' | 'applying' | 'applied' | 'error';

export function SummaryToolWorkspace(props: WorkspaceBaseProps) {
  const { t } = useI18n(props.locale);
  // Summary Tools is intentionally narrow: scan for bookmarks without stored
  // summaries, let users select a subset, then request generation in background.
  const [preview, setPreview] = createSignal<SummaryToolPreview | null>(null);
  const [state, setState] = createSignal<SummaryState>('idle');
  const [message, setMessage] = createSignal<string | null>(null);
  const [taskToken, setTaskToken] = createSignal(0);
  const [selectedIds, setSelectedIds] = createSignal<string[]>([]);
  const [query, setQuery] = createSignal(props.initialQuery ?? '');

  const selectedCount = createMemo(() => selectedIds().length);
  const filteredItems = createMemo(() => {
    const keyword = query().trim().toLowerCase();
    const items = preview()?.items ?? [];
    if (!keyword) return items;
    return items.filter((item) =>
      [item.title, item.url, item.folderPath, item.summary ?? '']
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    );
  });

  const loadPreview = async () => {
    // Select missing-summary items by default because they are the primary work
    // this tool is designed to perform.
    const token = taskToken() + 1;
    setTaskToken(token);
    setState('loading');
    setMessage(t('summary.scanProgress'));
    try {
      const next = await messaging.sendMessage('generateSummaryToolPreview');
      if (taskToken() !== token) return;
      setPreview(next);
      setSelectedIds(
        next.items.filter((item) => !item.hasSummary).map((item) => item.bookmarkId),
      );
      setState('ready');
      setMessage(
        t('summary.previewReady', {
          missing: next.missingSummaryCount,
          total: next.totalBookmarksScanned,
        }),
      );
    } catch {
      if (taskToken() !== token) return;
      setState('error');
      setMessage(t('summary.previewFailed'));
    }
  };

  const generateSummaries = async () => {
    if (selectedIds().length === 0) {
      setState('ready');
      setMessage(t('summary.noSelection'));
      return;
    }

    const confirmed = await props.confirmAction?.({
      title: t('confirm.summaryTitle'),
      body: t('confirm.generateSummaries', { count: selectedIds().length }),
      confirmLabel: t('confirm.generateButton'),
      cancelLabel: t('confirm.cancelButton'),
      tone: 'primary',
      content: () => (
        <RiskSummary
          title={t('risk.summaryTitle')}
          items={[
            {
              label: t('risk.aiSummaryRequests'),
              value: selectedIds().length,
              tone: 'warning',
            },
            {
              label: t('risk.updateSummaries'),
              value: selectedIds().length,
            },
          ]}
          note={t('risk.summaryGenerationNote')}
        />
      ),
    });
    if (!confirmed) return;

    const token = taskToken() + 1;
    setTaskToken(token);
    setState('applying');
    setMessage(null);
    try {
      // Generation happens in the background so provider settings, URL
      // normalization, and summary storage remain centralized.
      const result = await messaging.sendMessage('generateBookmarkSummaries', {
        bookmarkIds: selectedIds(),
      });
      if (taskToken() !== token) return;
      setState('applied');
      setMessage(t('summary.generateSuccess', { count: result.updatedCount }));
      await loadPreview();
    } catch {
      if (taskToken() !== token) return;
      setState('error');
      setMessage(t('summary.generateFailed'));
    }
  };

  const stopTask = () => {
    setTaskToken((token) => token + 1);
    setState('cancelled');
    setMessage(t('summary.taskCancelled'));
  };

  const toggleSelection = (bookmarkId: string, checked: boolean) => {
    setSelectedIds((current) => {
      if (checked) return current.includes(bookmarkId) ? current : [...current, bookmarkId];
      return current.filter((id) => id !== bookmarkId);
    });
  };

  return (
    <div class="space-y-6">
      <section class="rounded-lg border border-neutral-200 bg-white px-5 py-5 shadow-sm sm:px-6 sm:py-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
              {t('summary.sectionTitle')}
            </div>
            <h2 class="mt-2 text-2xl font-medium tracking-tight text-neutral-900">
              {t('summary.heading')}
            </h2>
            <p class="mt-3 max-w-2xl text-sm leading-6 text-neutral-500">
              {t('summary.description')}
            </p>
          </div>
          <StatusBadge
            tone={
              state() === 'error'
                ? 'warning'
                : state() === 'applied'
                  ? 'ready'
                  : 'neutral'
            }
          >
            {state() === 'loading'
              ? t('common.loading')
              : state() === 'cancelled'
                ? t('summary.cancelled')
              : state() === 'applying'
                ? t('summary.generating')
                : state() === 'applied'
                  ? t('summary.generated')
                  : t('summary.pending')}
          </StatusBadge>
        </div>

        <div class="mt-5 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-4">
          <p class="text-sm leading-6 text-neutral-600">
            {message() ?? t('summary.hint')}
          </p>
        </div>

        <div class="mt-5 flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={loadPreview}
            disabled={state() === 'loading' || state() === 'applying'}
          >
            {t('summary.scanButton')}
          </Button>
          <Show when={state() === 'loading' || state() === 'applying'}>
            <Button type="button" variant="secondary" onClick={stopTask}>
              {t('summary.stopButton')}
            </Button>
          </Show>
          <Show when={preview()?.items.length}>
            <Button
              type="button"
              onClick={() => void generateSummaries()}
              disabled={state() === 'loading' || state() === 'applying'}
            >
              {t('summary.generateSelectedButton', { count: selectedCount() })}
            </Button>
          </Show>
        </div>

        <Show when={preview()?.items.length}>
          <div class="mt-5">
            <ControlField
              label={t('summary.searchLabel')}
              description={t('summary.searchHelp')}
            >
              <input
                type="search"
                value={query()}
                placeholder={t('summary.searchPlaceholder')}
                class="w-full rounded-md border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition-colors focus:border-neutral-400"
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </ControlField>
          </div>
        </Show>
        <Show when={state() === 'loading' || state() === 'applying'}>
          <div class="mt-4 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
            <div class="text-sm leading-6 text-neutral-600">
              {message() ?? t('summary.scanProgress')}
            </div>
            <ProgressBar active />
          </div>
        </Show>
      </section>

      <Show when={preview()?.items.length}>
        <section class="rounded-lg border border-neutral-200 bg-white px-5 py-5 shadow-sm sm:px-6 sm:py-6">
          <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
            {t('summary.reviewTitle')}
          </div>
          <div class="mt-2 text-lg font-medium tracking-tight text-neutral-900">
            {t('summary.reviewSubtitle', { count: preview()?.missingSummaryCount ?? 0 })}
          </div>

          <div class="mt-5 space-y-3">
            <For each={filteredItems()}>
              {(item) => (
                <SummaryItemCard
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

function SummaryItemCard(props: {
  item: SummaryToolItem;
  checked: boolean;
  locale: WorkspaceBaseProps['locale'];
  onToggle: (checked: boolean) => void;
}) {
  const { t } = useI18n(props.locale);
  // A compact row for selection and review; existing summaries stay visible so
  // users can decide whether they really need regeneration.

  return (
    <article class="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <label class="flex min-w-0 flex-1 items-start gap-3">
          <input
            type="checkbox"
            class="mt-1 h-4 w-4 rounded border-neutral-300 accent-neutral-900"
            checked={props.checked}
            onInput={(event) => props.onToggle(event.currentTarget.checked)}
          />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium text-neutral-900" title={props.item.title}>
              {props.item.title}
            </div>
            <div class="mt-1 truncate text-xs text-neutral-500" title={props.item.url}>
              {props.item.url}
            </div>
          </div>
        </label>
        <StatusBadge tone={props.item.hasSummary ? 'ready' : 'warning'}>
          {props.item.hasSummary ? t('summary.hasSummary') : t('summary.missingSummary')}
        </StatusBadge>
      </div>

      <div class="mt-4 rounded-md border border-neutral-200 bg-white px-3 py-3">
        <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
          {t('summary.folderPath')}
        </div>
        <div class="mt-2 text-sm text-neutral-900">{props.item.folderPath}</div>
        <div class="mt-3 border-t border-neutral-200 pt-3 text-sm leading-6 text-neutral-500">
          {props.item.summary ?? t('summary.noSummaryText')}
        </div>
      </div>
    </article>
  );
}
