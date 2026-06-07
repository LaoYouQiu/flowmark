import { createMemo, createSignal, For, Show } from 'solid-js';

import { Button } from '@/src/components/Button';
import { StatusBadge } from '@/src/components/StatusBadge';
import type { WorkspaceBaseProps } from '@/src/organize/types';
import { useI18n } from '@/src/shared/i18n';
import { messaging } from '@/src/shared/messaging';
import type { SummarySearchResult, SummarySearchResultItem } from '@/src/shared/types';

type SearchState = 'idle' | 'loading' | 'ready' | 'error';

export function SummarySearchWorkspace(props: WorkspaceBaseProps) {
  const { t } = useI18n(props.locale);
  // Summary search is read-only. It searches saved FlowMark summaries and
  // bookmark metadata locally, then lets users open matching bookmarks.
  const [result, setResult] = createSignal<SummarySearchResult | null>(null);
  const [state, setState] = createSignal<SearchState>('idle');
  const [message, setMessage] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal(props.initialQuery ?? '');

  const hasQuery = createMemo(() => query().trim().length > 0);

  const runSearch = async () => {
    if (!hasQuery()) {
      setState('idle');
      setResult(null);
      setMessage(t('summarySearch.emptyQuery'));
      return;
    }

    setState('loading');
    setMessage(null);
    try {
      const next = await messaging.sendMessage('searchBookmarkSummaries', {
        query: query().trim(),
      });
      setResult(next);
      setState('ready');
      setMessage(
        next.matchCount > 0
          ? t('summarySearch.resultReady', {
              count: next.matchCount,
              total: next.totalBookmarksScanned,
            })
          : t('summarySearch.noResults'),
      );
    } catch {
      setState('error');
      setMessage(t('summarySearch.failed'));
    }
  };

  return (
    <div class="space-y-6">
      <section class="rounded-lg border border-neutral-200 bg-white px-5 py-5 shadow-sm sm:px-6 sm:py-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
              {t('summarySearch.sectionTitle')}
            </div>
            <h2 class="mt-2 text-2xl font-medium tracking-tight text-neutral-900">
              {t('summarySearch.heading')}
            </h2>
            <p class="mt-3 max-w-2xl text-sm leading-6 text-neutral-500">
              {t('summarySearch.description')}
            </p>
          </div>
          <StatusBadge tone={state() === 'error' ? 'warning' : state() === 'ready' ? 'ready' : 'neutral'}>
            {state() === 'loading'
              ? t('common.loading')
              : state() === 'ready'
                ? t('summarySearch.ready')
                : t('summarySearch.pending')}
          </StatusBadge>
        </div>

        <div class="mt-5 flex flex-col gap-3 sm:flex-row">
          <input
            type="search"
            value={query()}
            placeholder={t('summarySearch.searchPlaceholder')}
            class="min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-400"
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void runSearch();
            }}
          />
          <Button
            type="button"
            onClick={() => void runSearch()}
            disabled={state() === 'loading'}
          >
            {t('summarySearch.searchButton')}
          </Button>
        </div>

        <Show when={message()}>
          {(text) => (
            <div class="mt-4 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm leading-6 text-neutral-600">
              {text()}
            </div>
          )}
        </Show>
      </section>

      <Show when={result()?.items.length}>
        <section class="space-y-3">
          <For each={result()?.items ?? []}>
            {(item) => <SummarySearchResultCard item={item} locale={props.locale} />}
          </For>
        </section>
      </Show>
    </div>
  );
}

function SummarySearchResultCard(props: {
  item: SummarySearchResultItem;
  locale: WorkspaceBaseProps['locale'];
}) {
  const { t } = useI18n(props.locale);
  // Result cards use normal links instead of background tab APIs so opening a
  // bookmark remains a browser-native action from the organizer page.
  return (
    <article class="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium text-neutral-900" title={props.item.title}>
            {props.item.title}
          </div>
          <div class="mt-1 truncate text-xs text-neutral-500" title={props.item.url}>
            {props.item.url}
          </div>
        </div>
        <a
          href={props.item.url}
          target="_blank"
          rel="noreferrer"
          class="rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
        >
          {t('summarySearch.openBookmark')}
        </a>
      </div>

      <div class="mt-4 rounded-md border border-neutral-200 bg-white px-3 py-3">
        <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
          {t('summary.folderPath')}
        </div>
        <div class="mt-2 text-sm text-neutral-900">{props.item.folderPath}</div>
        <p class="mt-3 border-t border-neutral-200 pt-3 text-sm leading-6 text-neutral-600">
          {props.item.summary}
        </p>
      </div>
    </article>
  );
}
