import { createMemo, createSignal, For, Show } from 'solid-js';

import { Button } from '@/src/components/Button';
import type { OrganizerModuleId, WorkspaceBaseProps } from '@/src/organize/types';
import { StatusBadge } from '@/src/components/StatusBadge';
import { useI18n } from '@/src/shared/i18n';
import { messaging } from '@/src/shared/messaging';
import type { FolderAuditIssue, FolderAuditPreview } from '@/src/shared/types';

type AuditState = 'idle' | 'loading' | 'ready' | 'error';

export function FolderAuditWorkspace(
  props: WorkspaceBaseProps & {
    onNavigate?: (moduleId: OrganizerModuleId, seed?: string) => void;
  },
) {
  const { t } = useI18n(props.locale);
  const [preview, setPreview] = createSignal<FolderAuditPreview | null>(null);
  const [state, setState] = createSignal<AuditState>('idle');
  const [message, setMessage] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal(props.initialQuery ?? '');
  const [typeFilter, setTypeFilter] = createSignal<'all' | FolderAuditIssue['type']>('all');

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

  const loadPreview = async () => {
    setState('loading');
    setMessage(null);
    try {
      const next = await messaging.sendMessage('generateFolderAuditPreview');
      setPreview(next);
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
      setState('error');
      setMessage(t('audit.previewFailed'));
    }
  };

  const confirmNavigateToOrganizer = async () => {
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

  return (
    <div class="space-y-6">
      <section class="rounded-2xl border border-neutral-200 bg-white px-5 py-5 shadow-[0_10px_30px_rgba(0,0,0,0.04)] sm:px-6 sm:py-6">
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
          <StatusBadge tone={state() === 'error' ? 'warning' : 'neutral'}>
            {state() === 'loading' ? t('common.loading') : t('audit.pending')}
          </StatusBadge>
        </div>

        <div class="mt-5 rounded-xl border border-neutral-200 bg-[#fafafa] px-4 py-4">
          <p class="text-sm leading-6 text-neutral-600">
            {message() ?? t('audit.hint')}
          </p>
        </div>

        <div class="mt-5 flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={loadPreview}
            disabled={state() === 'loading'}
          >
            {t('audit.scanButton')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void confirmNavigateToOrganizer()}
          >
            {t('audit.openOrganizer')}
          </Button>
        </div>

        <Show when={preview()}>
          <div class="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
            <input
              type="search"
              value={query()}
              placeholder={t('audit.searchPlaceholder')}
              class="w-full rounded-xl border border-neutral-200 bg-[#fafafa] px-4 py-3 text-sm text-neutral-900 outline-none transition-colors focus:border-neutral-400"
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
            <select
              value={typeFilter()}
              class="w-full rounded-xl border border-neutral-200 bg-[#fafafa] px-4 py-3 text-sm text-neutral-900 outline-none transition-colors focus:border-neutral-400"
              onInput={(event) => setTypeFilter(event.currentTarget.value as 'all' | FolderAuditIssue['type'])}
            >
              <option value="all">{t('audit.filterAll')}</option>
              <option value="empty_folder">{t('audit.typeEmpty')}</option>
              <option value="deep_folder">{t('audit.typeDeep')}</option>
              <option value="sparse_folder">{t('audit.typeSparse')}</option>
            </select>
          </div>
        </Show>
      </section>

      <Show when={preview()}>
        {(currentPreview) => (
          <section class="rounded-2xl border border-neutral-200 bg-white px-5 py-5 shadow-[0_10px_30px_rgba(0,0,0,0.04)] sm:px-6 sm:py-6">
            <div class="grid gap-3 sm:grid-cols-3">
              <StatCard label={t('audit.emptyFolders')} value={currentPreview().emptyFolderCount} />
              <StatCard label={t('audit.deepFolders')} value={currentPreview().deepFolderCount} />
              <StatCard label={t('audit.sparseFolders')} value={currentPreview().sparseFolderCount} />
            </div>

            <div class="mt-6 text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
              {t('audit.issueListTitle')}
            </div>
            <div class="mt-4 space-y-3">
              <For each={filteredIssues()}>
                {(issue) => <IssueCard issue={issue} locale={props.locale} />}
              </For>
            </div>
          </section>
        )}
      </Show>
    </div>
  );
}

function StatCard(props: { label: string; value: number }) {
  return (
    <div class="rounded-xl border border-neutral-200 bg-[#fafafa] px-4 py-4">
      <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
        {props.label}
      </div>
      <div class="mt-2 text-2xl font-medium tracking-tight text-neutral-900">
        {props.value}
      </div>
    </div>
  );
}

function IssueCard(props: { issue: FolderAuditIssue; locale: WorkspaceBaseProps['locale'] }) {
  const { t } = useI18n(props.locale);

  return (
    <article class="rounded-xl border border-neutral-200 bg-[#fafafa] px-4 py-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
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
        <StatusBadge tone={props.issue.type === 'empty_folder' ? 'warning' : 'neutral'}>
          {props.issue.type === 'empty_folder'
            ? t('audit.typeEmpty')
            : props.issue.type === 'deep_folder'
              ? t('audit.typeDeep')
              : t('audit.typeSparse')}
        </StatusBadge>
      </div>
    </article>
  );
}
