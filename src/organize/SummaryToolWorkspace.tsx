import { createMemo, createSignal, For, Show } from 'solid-js';

import { Button } from '@/src/components/Button';
import type { WorkspaceBaseProps } from '@/src/organize/types';
import { StatusBadge } from '@/src/components/StatusBadge';
import { useI18n } from '@/src/shared/i18n';
import { messaging } from '@/src/shared/messaging';
import type { SummaryToolItem, SummaryToolPreview } from '@/src/shared/types';

type SummaryState = 'idle' | 'loading' | 'ready' | 'applying' | 'applied' | 'error';

export function SummaryToolWorkspace(props: WorkspaceBaseProps) {
  const { t } = useI18n(props.locale);
  const [preview, setPreview] = createSignal<SummaryToolPreview | null>(null);
  const [state, setState] = createSignal<SummaryState>('idle');
  const [message, setMessage] = createSignal<string | null>(null);
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
    setState('loading');
    setMessage(null);
    try {
      const next = await messaging.sendMessage('generateSummaryToolPreview');
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
    });
    if (!confirmed) return;

    setState('applying');
    setMessage(null);
    try {
      const result = await messaging.sendMessage('generateBookmarkSummaries', {
        bookmarkIds: selectedIds(),
      });
      setState('applied');
      setMessage(t('summary.generateSuccess', { count: result.updatedCount }));
      await loadPreview();
    } catch {
      setState('error');
      setMessage(t('summary.generateFailed'));
    }
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
            <input
              type="search"
              value={query()}
              placeholder={t('summary.searchPlaceholder')}
              class="w-full rounded-md border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition-colors focus:border-neutral-400"
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
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
