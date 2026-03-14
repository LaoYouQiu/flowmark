import { createMemo, createSignal, For, Show } from 'solid-js';

import { Button } from '@/src/components/Button';
import type { WorkspaceBaseProps } from '@/src/organize/types';
import { StatusBadge } from '@/src/components/StatusBadge';
import { useI18n } from '@/src/shared/i18n';
import { messaging } from '@/src/shared/messaging';
import type {
  DuplicateBookmarkCandidate,
  DuplicateBookmarkGroup,
  DuplicateBookmarkMergeSelection,
  DuplicateBookmarkPreview,
} from '@/src/shared/types';

type CleanupState = 'idle' | 'loading' | 'ready' | 'applying' | 'applied' | 'error';

export function DuplicateCleanupWorkspace(props: WorkspaceBaseProps) {
  const { t } = useI18n(props.locale);
  const [preview, setPreview] = createSignal<DuplicateBookmarkPreview | null>(null);
  const [state, setState] = createSignal<CleanupState>('idle');
  const [message, setMessage] = createSignal<string | null>(null);
  const [selectedIds, setSelectedIds] = createSignal<string[]>([]);
  const [keepSelections, setKeepSelections] = createSignal<Record<string, string>>({});
  const [query, setQuery] = createSignal(props.initialQuery ?? '');

  const selectedCount = createMemo(() => selectedIds().length);
  const filteredGroups = createMemo(() => {
    const keyword = query().trim().toLowerCase();
    const groups = preview()?.groups ?? [];
    if (!keyword) return groups;
    return groups.filter((group) =>
      [group.url, ...group.items.map((item) => `${item.title} ${item.folderPath}`)]
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    );
  });

  const loadPreview = async () => {
    setState('loading');
    setMessage(null);
    try {
      const next = await messaging.sendMessage('generateDuplicateBookmarkPreview');
      setPreview(next);
      setKeepSelections(Object.fromEntries(next.groups.map((group) => [group.normalizedUrl, group.keepBookmarkId])));
      setSelectedIds(
        next.groups.flatMap((group) => group.removeBookmarkIds),
      );
      setState('ready');
      setMessage(
        next.duplicateGroupCount > 0
          ? t('duplicates.previewReady', {
              groups: next.duplicateGroupCount,
              total: next.totalBookmarksScanned,
            })
          : t('duplicates.previewEmpty'),
      );
    } catch {
      setState('error');
      setMessage(t('duplicates.previewFailed'));
    }
  };

  const applyRemoval = async () => {
    if (selectedIds().length === 0) {
      setState('ready');
      setMessage(t('duplicates.noSelection'));
      return;
    }

    const confirmed = await props.confirmAction?.({
      title: t('confirm.duplicatesTitle'),
      body: t('confirm.removeDuplicateBookmarks', { count: selectedIds().length }),
      confirmLabel: t('confirm.removeButton'),
      cancelLabel: t('confirm.cancelButton'),
      tone: 'danger',
    });
    if (!confirmed) return;

    setState('applying');
    setMessage(null);
    try {
      const result = await messaging.sendMessage('removeDuplicateBookmarks', {
        bookmarkIds: selectedIds(),
        mergeSelections: buildMergeSelections(),
      });
      setState('applied');
      setMessage(t('duplicates.removeSuccess', { count: result.removedCount }));
      await loadPreview();
    } catch {
      setState('error');
      setMessage(t('duplicates.removeFailed'));
    }
  };

  const toggleSelection = (bookmarkId: string, checked: boolean) => {
    setSelectedIds((current) => {
      if (checked) return current.includes(bookmarkId) ? current : [...current, bookmarkId];
      return current.filter((id) => id !== bookmarkId);
    });
  };

  const toggleGroup = (group: DuplicateBookmarkGroup, checked: boolean) => {
    const keepId = keepSelections()[group.normalizedUrl] ?? group.keepBookmarkId;
    const ids = group.items.filter((item) => item.id !== keepId).map((item) => item.id);
    setSelectedIds((current) => {
      if (checked) {
        return [...new Set([...current, ...ids])];
      }
      return current.filter((id) => !ids.includes(id));
    });
  };

  const setKeepBookmark = (group: DuplicateBookmarkGroup, bookmarkId: string) => {
    setKeepSelections((current) => ({
      ...current,
      [group.normalizedUrl]: bookmarkId,
    }));

    const groupItemIds = new Set(group.items.map((item) => item.id));
    const removeIds = group.items.filter((item) => item.id !== bookmarkId).map((item) => item.id);
    setSelectedIds((current) => [
      ...current.filter((id) => !groupItemIds.has(id)),
      ...removeIds,
    ]);
  };

  const buildMergeSelections = (): DuplicateBookmarkMergeSelection[] => {
    return (preview()?.groups ?? []).map((group) => {
      const keepBookmarkId = keepSelections()[group.normalizedUrl] ?? group.keepBookmarkId;
      return {
        normalizedUrl: group.normalizedUrl,
        keepBookmarkId,
        removeBookmarkIds: group.items
          .filter((item) => item.id !== keepBookmarkId && selectedIds().includes(item.id))
          .map((item) => item.id),
      };
    });
  };

  return (
    <div class="space-y-6">
      <section class="rounded-lg border border-neutral-200 bg-white px-5 py-5 shadow-sm sm:px-6 sm:py-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
              {t('duplicates.sectionTitle')}
            </div>
            <h2 class="mt-2 text-2xl font-medium tracking-tight text-neutral-900">
              {t('duplicates.heading')}
            </h2>
            <p class="mt-3 max-w-2xl text-sm leading-6 text-neutral-500">
              {t('duplicates.description')}
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
                ? t('duplicates.applying')
                : state() === 'applied'
                  ? t('duplicates.applied')
                  : t('duplicates.pending')}
          </StatusBadge>
        </div>

        <div class="mt-5 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-4">
          <p class="text-sm leading-6 text-neutral-600">
            {message() ?? t('duplicates.hint')}
          </p>
        </div>

        <div class="mt-5 flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={loadPreview}
            disabled={state() === 'loading' || state() === 'applying'}
          >
            {t('duplicates.scanButton')}
          </Button>
          <Show when={preview()?.duplicateGroupCount}>
            <Button
              type="button"
              onClick={() => void applyRemoval()}
              disabled={state() === 'loading' || state() === 'applying'}
            >
              {t('duplicates.removeSelectedButton', { count: selectedCount() })}
            </Button>
          </Show>
        </div>

        <Show when={preview()?.duplicateGroupCount}>
          <div class="mt-5">
            <input
              type="search"
              value={query()}
              placeholder={t('duplicates.searchPlaceholder')}
              class="w-full rounded-md border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition-colors focus:border-neutral-400"
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </div>
        </Show>
      </section>

      <Show when={preview()?.groups.length}>
        <section class="rounded-lg border border-neutral-200 bg-white px-5 py-5 shadow-sm sm:px-6 sm:py-6">
          <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
            {t('duplicates.reviewTitle')}
          </div>
          <div class="mt-2 text-lg font-medium tracking-tight text-neutral-900">
            {t('duplicates.reviewSubtitle', { count: preview()?.groups.length ?? 0 })}
          </div>

          <div class="mt-5 space-y-4">
            <For each={filteredGroups()}>
              {(group) => (
                <DuplicateGroupCard
                  group={group}
                  locale={props.locale}
                  selectedIds={selectedIds()}
                  keepBookmarkId={keepSelections()[group.normalizedUrl] ?? group.keepBookmarkId}
                  onToggleItem={toggleSelection}
                  onToggleGroup={toggleGroup}
                  onSetKeep={setKeepBookmark}
                />
              )}
            </For>
          </div>
        </section>
      </Show>
    </div>
  );
}

function DuplicateGroupCard(props: {
  group: DuplicateBookmarkGroup;
  locale: WorkspaceBaseProps['locale'];
  selectedIds: string[];
  keepBookmarkId: string;
  onToggleItem: (bookmarkId: string, checked: boolean) => void;
  onToggleGroup: (group: DuplicateBookmarkGroup, checked: boolean) => void;
  onSetKeep: (group: DuplicateBookmarkGroup, bookmarkId: string) => void;
}) {
  const { t } = useI18n(props.locale);
  const removableItems = () => props.group.items.filter((item) => item.id !== props.keepBookmarkId);
  const selectedInGroup = () => removableItems().filter((item) => props.selectedIds.includes(item.id)).length;
  const keepItem = createMemo(() => props.group.items.find((item) => item.id === props.keepBookmarkId) ?? props.group.items[0]);
  const suggestedTitle = createMemo(() => chooseBestTitle(props.group.items));

  return (
    <article class="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium text-neutral-900" title={props.group.url}>
            {props.group.url}
          </div>
          <div class="mt-1 text-xs text-neutral-500">
            {t('duplicates.groupSize', { count: props.group.items.length })}
          </div>
        </div>
        <label class="inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            class="h-4 w-4 rounded border-neutral-300 accent-neutral-900"
            checked={selectedInGroup() === removableItems().length && removableItems().length > 0}
            onInput={(event) => props.onToggleGroup(props.group, event.currentTarget.checked)}
          />
          <span>{t('duplicates.selectGroup')}</span>
        </label>
      </div>

      <div class="mt-4 rounded-md border border-neutral-200 bg-white px-3 py-3">
        <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
          {t('duplicates.mergePlan')}
        </div>
        <div class="mt-2 grid gap-3 sm:grid-cols-2">
          <div>
            <div class="text-xs text-neutral-400">{t('duplicates.keepBookmark')}</div>
            <div class="mt-1 truncate text-sm font-medium text-neutral-900" title={keepItem()?.folderPath}>
              {keepItem()?.folderPath}
            </div>
          </div>
          <div>
            <div class="text-xs text-neutral-400">{t('duplicates.suggestedTitle')}</div>
            <div class="mt-1 truncate text-sm font-medium text-neutral-900" title={suggestedTitle()}>
              {suggestedTitle()}
            </div>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          {props.group.actions.map((action) => (
            <span class="rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-600">
              {action.type === 'rename'
                ? t('duplicates.actionRename')
                : action.type === 'merge_summary'
                  ? t('duplicates.actionMergeSummary')
                  : t('duplicates.actionDelete')}
            </span>
          ))}
        </div>
      </div>

      <div class="mt-4 space-y-3">
        <For each={props.group.items}>
          {(item) => {
            const isPrimary = item.id === props.keepBookmarkId;
            return (
              <div class="rounded-md border border-neutral-200 bg-white px-3 py-3">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium text-neutral-900" title={item.title}>
                      {item.title}
                    </div>
                    <div class="mt-1 truncate text-xs text-neutral-500" title={item.folderPath}>
                      {item.folderPath}
                    </div>
                    <Show when={item.hasSummary}>
                      <div class="mt-2 text-xs text-neutral-400">{t('duplicates.hasSummary')}</div>
                    </Show>
                  </div>

                  {isPrimary ? (
                    <StatusBadge tone="ready">{t('duplicates.keepOne')}</StatusBadge>
                  ) : (
                    <div class="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        class="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50"
                        onClick={() => props.onSetKeep(props.group, item.id)}
                      >
                        {t('duplicates.setAsKeep')}
                      </button>
                      <label class="inline-flex items-center gap-2 text-sm text-neutral-700">
                        <input
                          type="checkbox"
                          class="h-4 w-4 rounded border-neutral-300 accent-neutral-900"
                          checked={props.selectedIds.includes(item.id)}
                          onInput={(event) => props.onToggleItem(item.id, event.currentTarget.checked)}
                        />
                        <span>{t('duplicates.markForRemoval')}</span>
                      </label>
                    </div>
                  )}
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </article>
  );
}

function chooseBestTitle(items: DuplicateBookmarkCandidate[]): string {
  return [...items].sort((a, b) => scoreTitle(b.title) - scoreTitle(a.title) || a.title.length - b.title.length)[0]?.title ?? items[0]?.title ?? '';
}

function scoreTitle(title: string): number {
  const normalized = title.trim();
  if (!normalized) return 0;
  let score = 20;
  if (/^https?:\/\//i.test(normalized)) score -= 30;
  if (/^www\./i.test(normalized)) score -= 20;
  if (normalized.length >= 8 && normalized.length <= 64) score += 12;
  if (normalized.length > 100) score -= 15;
  if (/[\u4e00-\u9fff]/u.test(normalized)) score += 4;
  if (/[-_|]/.test(normalized)) score -= 2;
  return score;
}
