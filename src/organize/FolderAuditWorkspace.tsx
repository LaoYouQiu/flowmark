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
  const [applyingIssueId, setApplyingIssueId] = createSignal<string | null>(null);

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

  const applyFolderMerge = async (issue: FolderAuditIssue) => {
    if (issue.type !== 'similar_folder' || !issue.suggestedTargetFolderId) return;

    const confirmed = await props.confirmAction?.({
      title: t('confirm.folderMergeTitle'),
      body: t('confirm.folderMergeBody', {
        source: issue.path,
        target: issue.suggestedTargetFolderPath ?? '',
      }),
      confirmLabel: t('confirm.applyButton'),
      cancelLabel: t('confirm.cancelButton'),
      tone: 'primary',
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
          <StatusBadge tone={state() === 'error' ? 'warning' : 'neutral'}>
            {state() === 'loading' ? t('common.loading') : t('audit.pending')}
          </StatusBadge>
        </div>

        <div class="mt-5 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-4">
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
              class="w-full rounded-md border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition-colors focus:border-neutral-400"
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
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
            <div class="mt-4 space-y-3">
              <For each={filteredIssues()}>
                {(issue) => (
                  <IssueCard
                    issue={issue}
                    locale={props.locale}
                    applying={applyingIssueId() === issue.id}
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
  onApplyMerge: (issue: FolderAuditIssue) => void;
}) {
  const { t } = useI18n(props.locale);

  return (
    <article class="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-4">
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
        <div class="mt-4 rounded-md border border-neutral-200 bg-white px-3 py-3">
          <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
            {t('audit.mergeSuggestion')}
          </div>
          <div class="mt-2 text-sm leading-6 text-neutral-700">
            {t('audit.mergeInto', {
              path: props.issue.suggestedTargetFolderPath ?? props.issue.path,
            })}
          </div>
          <Show when={props.issue.similarFolderPaths?.length}>
            <div class="mt-3 flex flex-wrap gap-2">
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
          <div class="mt-4">
            <Button
              type="button"
              onClick={() => props.onApplyMerge(props.issue)}
              disabled={props.applying || !props.issue.suggestedTargetFolderId}
            >
              {props.applying ? t('audit.applyingMerge') : t('audit.applyMerge')}
            </Button>
          </div>
        </div>
      </Show>
    </article>
  );
}
