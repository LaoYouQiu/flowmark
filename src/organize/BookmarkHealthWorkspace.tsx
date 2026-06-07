import { createMemo, createSignal, For, Show } from 'solid-js';

import { Button } from '@/src/components/Button';
import { StatusBadge } from '@/src/components/StatusBadge';
import type { WorkspaceBaseProps } from '@/src/organize/types';
import { useI18n } from '@/src/shared/i18n';
import { messaging } from '@/src/shared/messaging';
import type {
  BookmarkHealthIssue,
  BookmarkHealthIssueType,
  BookmarkHealthPreview,
} from '@/src/shared/types';

type HealthState = 'idle' | 'loading' | 'ready' | 'error';
type HealthFilter = 'all' | BookmarkHealthIssueType;

const NETWORK_PERMISSION_ORIGINS = ['http://*/*', 'https://*/*'];

export function BookmarkHealthWorkspace(props: WorkspaceBaseProps) {
  const { t } = useI18n(props.locale);
  // Health checks are read-only: the first version helps users inspect risky
  // bookmarks before any future repair/delete workflow is added.
  const [preview, setPreview] = createSignal<BookmarkHealthPreview | null>(null);
  const [state, setState] = createSignal<HealthState>('idle');
  const [message, setMessage] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal(props.initialQuery ?? '');
  const [typeFilter, setTypeFilter] = createSignal<HealthFilter>('all');
  const [checkLimit, setCheckLimit] = createSignal(80);
  const [requestingPermission, setRequestingPermission] = createSignal(false);

  const filteredIssues = createMemo(() => {
    const keyword = query().trim().toLowerCase();
    return (preview()?.issues ?? []).filter((issue) => {
      const matchType = typeFilter() === 'all' || issue.type === typeFilter();
      const matchKeyword =
        keyword.length === 0 ||
        [issue.title, issue.url, issue.folderPath, issue.finalUrl ?? '']
          .join(' ')
          .toLowerCase()
          .includes(keyword);
      return matchType && matchKeyword;
    });
  });

  const loadPreview = async () => {
    setState('loading');
    setMessage(null);
    try {
      const next = await messaging.sendMessage('generateBookmarkHealthPreview', {
        limit: checkLimit(),
      });
      setPreview(next);
      setState('ready');
      setMessage(
        next.networkPermissionGranted
          ? t('health.previewReady', {
              issues: next.issueCount,
              checked: next.checkedCount,
              total: next.totalBookmarksScanned,
            })
          : t('health.permissionNeeded', {
              checked: next.checkedCount,
              total: next.totalBookmarksScanned,
            }),
      );
    } catch {
      setState('error');
      setMessage(t('health.previewFailed'));
    }
  };

  const requestNetworkPermission = async () => {
    setRequestingPermission(true);
    setMessage(null);
    try {
      const granted = await browser.permissions.request({
        origins: NETWORK_PERMISSION_ORIGINS,
      });
      setMessage(granted ? t('health.permissionGranted') : t('health.permissionDenied'));
      if (granted) await loadPreview();
    } catch {
      setMessage(t('health.permissionDenied'));
    } finally {
      setRequestingPermission(false);
    }
  };

  const openBookmark = async (bookmarkId: string) => {
    await browser.bookmarks.get(bookmarkId);
    const issue = preview()?.issues.find((item) => item.bookmarkId === bookmarkId);
    if (issue?.url) {
      await browser.tabs.create({ url: issue.url });
    }
  };

  return (
    <div class="space-y-6">
      <section class="rounded-lg border border-neutral-200 bg-white px-5 py-5 shadow-sm sm:px-6 sm:py-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
              {t('health.sectionTitle')}
            </div>
            <h2 class="mt-2 text-2xl font-medium tracking-tight text-neutral-900">
              {t('health.heading')}
            </h2>
            <p class="mt-3 max-w-2xl text-sm leading-6 text-neutral-500">
              {t('health.description')}
            </p>
          </div>
          <StatusBadge tone={state() === 'error' ? 'warning' : 'neutral'}>
            {state() === 'loading'
              ? t('common.loading')
              : state() === 'ready'
                ? t('health.ready')
                : t('health.pending')}
          </StatusBadge>
        </div>

        <div class="mt-5 grid gap-3 sm:grid-cols-[1fr_180px_180px]">
          <input
            class="w-full rounded-md border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition-colors focus:border-neutral-400"
            value={query()}
            placeholder={t('health.searchPlaceholder')}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          <select
            class="w-full rounded-md border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition-colors focus:border-neutral-400"
            value={typeFilter()}
            onInput={(event) => setTypeFilter(event.currentTarget.value as HealthFilter)}
          >
            <option value="all">{t('health.filterAll')}</option>
            <option value="invalid_url">{t('health.issueInvalidUrl')}</option>
            <option value="unsupported_protocol">{t('health.issueUnsupportedProtocol')}</option>
            <option value="permission_missing">{t('health.issuePermissionMissing')}</option>
            <option value="timeout">{t('health.issueTimeout')}</option>
            <option value="network_error">{t('health.issueNetworkError')}</option>
            <option value="http_error">{t('health.issueHttpError')}</option>
            <option value="login_required">{t('health.issueLoginRequired')}</option>
            <option value="redirect">{t('health.issueRedirect')}</option>
          </select>
          <input
            type="number"
            min="1"
            max="200"
            class="w-full rounded-md border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition-colors focus:border-neutral-400"
            value={checkLimit()}
            aria-label={t('health.limitLabel')}
            onInput={(event) => setCheckLimit(clampLimit(Number(event.currentTarget.value)))}
          />
        </div>

        <div class="mt-4 flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={() => void loadPreview()}
            disabled={state() === 'loading'}
          >
            {t('health.scanButton')}
          </Button>
          <Show when={preview() && !preview()?.networkPermissionGranted}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void requestNetworkPermission()}
              disabled={requestingPermission()}
            >
              {requestingPermission()
                ? t('health.requestingPermission')
                : t('health.requestPermissionButton')}
            </Button>
          </Show>
        </div>

        <Show when={message()}>
          {(text) => (
            <div class="mt-4 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm leading-6 text-neutral-600">
              {text()}
            </div>
          )}
        </Show>

        <Show when={preview()}>
          {(result) => (
            <div class="mt-5 grid gap-3 sm:grid-cols-4">
              <Metric label={t('health.checkedCount')} value={result().checkedCount} />
              <Metric label={t('health.issueCount')} value={result().issueCount} tone="warning" />
              <Metric label={t('health.healthyCount')} value={result().healthyCount} tone="success" />
              <Metric label={t('health.totalCount')} value={result().totalBookmarksScanned} />
            </div>
          )}
        </Show>
      </section>

      <section class="space-y-3">
        <Show when={filteredIssues().length > 0} fallback={
          <div class="rounded-lg border border-dashed border-neutral-200 bg-white px-5 py-8 text-center text-sm text-neutral-400">
            {state() === 'ready' && preview()?.networkPermissionGranted
              ? t('health.noIssues')
              : state() === 'ready'
                ? t('health.networkPermissionEmpty')
                : t('health.emptyState')}
          </div>
        }>
          <For each={filteredIssues()}>
            {(issue) => (
              <HealthIssueCard
                issue={issue}
                locale={props.locale}
                onOpen={() => void openBookmark(issue.bookmarkId)}
              />
            )}
          </For>
        </Show>
      </section>
    </div>
  );
}

function Metric(props: {
  label: string;
  value: number;
  tone?: 'neutral' | 'warning' | 'success';
}) {
  return (
    <div class="rounded-lg border border-neutral-200 bg-white px-4 py-3">
      <div
        class={[
          'text-xl font-semibold',
          props.tone === 'warning'
            ? 'text-amber-600'
            : props.tone === 'success'
              ? 'text-emerald-600'
              : 'text-neutral-900',
        ].join(' ')}
      >
        {props.value}
      </div>
      <div class="mt-1 text-xs leading-5 text-neutral-500">{props.label}</div>
    </div>
  );
}

function HealthIssueCard(props: {
  issue: BookmarkHealthIssue;
  locale: WorkspaceBaseProps['locale'];
  onOpen: () => void;
}) {
  const { t } = useI18n(props.locale);
  const status = createMemo(() => issueLabel(props.issue, t));

  return (
    <article class="rounded-lg border border-neutral-200 bg-white px-4 py-4 shadow-sm">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="break-words text-sm font-medium text-neutral-900">
            {props.issue.title}
          </div>
          <div class="mt-1 break-all text-xs leading-5 text-neutral-500">
            {props.issue.url}
          </div>
          <div class="mt-2 text-xs text-neutral-400">{props.issue.folderPath}</div>
        </div>
        <StatusBadge tone={props.issue.type === 'redirect' ? 'neutral' : 'warning'}>
          {status()}
        </StatusBadge>
      </div>
      <Show when={props.issue.finalUrl}>
        {(url) => (
          <div class="mt-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs leading-5 text-neutral-500">
            {t('health.finalUrl')}: <span class="break-all">{url()}</span>
          </div>
        )}
      </Show>
      <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div class="text-[11px] text-neutral-400">
          {new Date(props.issue.checkedAt).toLocaleString()}
        </div>
        <Button type="button" variant="secondary" onClick={props.onOpen}>
          {t('health.openBookmark')}
        </Button>
      </div>
    </article>
  );
}

function issueLabel(
  issue: BookmarkHealthIssue,
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (issue.type) {
    case 'invalid_url':
      return t('health.issueInvalidUrl');
    case 'unsupported_protocol':
      return t('health.issueUnsupportedProtocol');
    case 'permission_missing':
      return t('health.issuePermissionMissing');
    case 'timeout':
      return t('health.issueTimeout');
    case 'network_error':
      return t('health.issueNetworkError');
    case 'http_error':
      return t('health.issueHttpErrorWithStatus', { status: issue.httpStatus ?? 0 });
    case 'login_required':
      return t('health.issueLoginRequiredWithStatus', { status: issue.httpStatus ?? 0 });
    case 'redirect':
      return t('health.issueRedirect');
  }
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 80;
  return Math.max(1, Math.min(200, Math.trunc(value)));
}
