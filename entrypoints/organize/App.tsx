import { createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js';

import { Button } from '@/src/components/Button';
import { ConfirmDialog, type ConfirmDialogOptions } from '@/src/components/ConfirmDialog';
import { BookmarkOrganizerWorkspace } from '@/src/organize/BookmarkOrganizerWorkspace';
import { DuplicateCleanupWorkspace } from '@/src/organize/DuplicateCleanupWorkspace';
import { FolderAuditWorkspace } from '@/src/organize/FolderAuditWorkspace';
import { SummaryToolWorkspace } from '@/src/organize/SummaryToolWorkspace';
import type { ConfirmActionOptions, OrganizerModuleId } from '@/src/organize/types';
import { getBrowserUiLanguage, resolveLocale, useI18n } from '@/src/shared/i18n';
import { messaging } from '@/src/shared/messaging';
import { openSettingsPage } from '@/src/shared/open-settings-page';
import { getSettings } from '@/src/shared/settings';
import type { FlowmarkSettings, OperationHistoryEntry } from '@/src/shared/types';

type OrganizerModule = {
  id: OrganizerModuleId;
  titleKey:
    | 'organize.navSmartOrganize'
    | 'organize.navDuplicateCleanup'
    | 'organize.navFolderAudit'
    | 'organize.navSummaryTools';
  descriptionKey:
    | 'organize.navSmartOrganizeDesc'
    | 'organize.navDuplicateCleanupDesc'
    | 'organize.navFolderAuditDesc'
    | 'organize.navSummaryToolsDesc';
  status: 'active' | 'planned';
};

const modules: OrganizerModule[] = [
  {
    id: 'smart-organize',
    titleKey: 'organize.navSmartOrganize',
    descriptionKey: 'organize.navSmartOrganizeDesc',
    status: 'active',
  },
  {
    id: 'duplicate-cleanup',
    titleKey: 'organize.navDuplicateCleanup',
    descriptionKey: 'organize.navDuplicateCleanupDesc',
    status: 'active',
  },
  {
    id: 'folder-audit',
    titleKey: 'organize.navFolderAudit',
    descriptionKey: 'organize.navFolderAuditDesc',
    status: 'active',
  },
  {
    id: 'summary-tools',
    titleKey: 'organize.navSummaryTools',
    descriptionKey: 'organize.navSummaryToolsDesc',
    status: 'active',
  },
];

export default function App() {
  const [settings, setSettings] = createSignal<FlowmarkSettings | null>(null);
  const [activeModule, setActiveModule] = createSignal<OrganizerModuleId>(readModuleFromUrl());
  const [filterSeed, setFilterSeed] = createSignal(readQueryParam('q') ?? '');
  const [historyEntries, setHistoryEntries] = createSignal<OperationHistoryEntry[]>([]);
  const [historyMessage, setHistoryMessage] = createSignal<string | null>(null);
  const [undoingEntryId, setUndoingEntryId] = createSignal<string | null>(null);
  const [confirmState, setConfirmState] = createSignal<{
    options: ConfirmDialogOptions;
    resolve: (confirmed: boolean) => void;
  } | null>(null);

  const locale = createMemo(() =>
    resolveLocale(settings()?.localeOverride ?? 'auto', getBrowserUiLanguage()),
  );
  const { t } = useI18n(locale);

  createEffect(() => {
    document.title = t('organize.documentTitle');
  });

  createEffect(() => {
    writeUrlState(activeModule(), filterSeed());
  });

  onMount(() => {
    void (async () => {
      setSettings(await getSettings());
      await loadHistory();
    })();
  });

  const loadHistory = async () => {
    const result = await messaging.sendMessage('listOperationHistory');
    setHistoryEntries(result.entries);
  };

  const openOptions = () => {
    void openSettingsPage();
  };

  const navigateModule = (moduleId: OrganizerModuleId, seed = '') => {
    setActiveModule(moduleId);
    setFilterSeed(seed);
  };

  const confirmAction = (options: ConfirmActionOptions) =>
    new Promise<boolean>((resolve) => {
      setConfirmState({
        options: {
          title: options.title,
          body: options.body,
          confirmLabel: options.confirmLabel ?? t('confirm.confirmButton'),
          cancelLabel: options.cancelLabel ?? t('confirm.cancelButton'),
          tone: options.tone,
          content: options.content,
        },
        resolve,
      });
    });

  const closeConfirm = (confirmed: boolean) => {
    const current = confirmState();
    if (!current) return;
    setConfirmState(null);
    current.resolve(confirmed);
  };

  const undoHistoryEntry = async (entry: OperationHistoryEntry) => {
    const confirmed = await confirmAction({
      title: t('confirm.undoHistoryTitle'),
      body: t('confirm.undoHistoryBody', { label: entry.label }),
      confirmLabel: t('confirm.undoButton'),
      cancelLabel: t('confirm.cancelButton'),
      tone: 'primary',
    });
    if (!confirmed) return;

    setUndoingEntryId(entry.id);
    setHistoryMessage(null);
    try {
      const result = await messaging.sendMessage('undoOperationHistoryEntry', { entryId: entry.id });
      setHistoryMessage(t('history.undoResult', {
        restored: result.restoredCount,
        skipped: result.skippedCount,
      }));
      await loadHistory();
    } catch {
      setHistoryMessage(t('history.undoFailed'));
    } finally {
      setUndoingEntryId(null);
    }
  };

  return (
    <div class="min-h-screen bg-[#f6f7f8] px-4 py-5 text-neutral-900 sm:px-6 sm:py-7">
      <div class="mx-auto max-w-7xl">
        <header class="border-b border-neutral-200 px-1 pb-5">
          <div class="flex flex-wrap items-start justify-between gap-5">
            <div>
              <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-400">
                {t('organize.pageEyebrow')}
              </div>
              <h1 class="mt-2 text-2xl font-semibold text-neutral-950 sm:text-3xl">
                {t('organize.pageHeading')}
              </h1>
              <p class="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
                {t('organize.pageDescription')}
              </p>
            </div>

            <div class="flex flex-wrap gap-3">
              <Button type="button" variant="secondary" onClick={openOptions}>
                {t('organize.openSettings')}
              </Button>
            </div>
          </div>
        </header>

        <main class="mt-5 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside class="rounded-lg border border-neutral-200 bg-white px-3 py-3 shadow-sm sm:px-4 sm:py-4">
            <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
              {t('organize.navTitle')}
            </div>
            <div class="mt-3 space-y-1.5">
              {modules.map((module) => {
                const isActive = activeModule() === module.id;
                const isPlanned = module.status === 'planned';
                return (
                  <button
                    type="button"
                    class={[
                      'w-full rounded-lg border px-3 py-3 text-left transition-colors',
                      isActive
                        ? 'border-neutral-900 bg-neutral-950 text-white'
                        : 'border-transparent bg-white text-neutral-900 hover:border-neutral-200 hover:bg-neutral-50',
                    ].join(' ')}
                    onClick={() => navigateModule(module.id)}
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <div class={['text-sm font-medium tracking-tight', isActive ? 'text-white' : 'text-neutral-900'].join(' ')}>
                          {t(module.titleKey)}
                        </div>
                        <div class={['mt-1.5 text-xs leading-5', isActive ? 'text-neutral-200' : 'text-neutral-500'].join(' ')}>
                          {t(module.descriptionKey)}
                        </div>
                      </div>
                      <span
                        class={[
                          'rounded-md px-1.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em]',
                          isActive
                            ? 'bg-white/10 text-white'
                            : isPlanned
                              ? 'bg-neutral-200 text-neutral-600'
                              : 'bg-neutral-100 text-neutral-600',
                        ].join(' ')}
                      >
                        {isPlanned ? t('organize.navPlanned') : t('organize.navReady')}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            <div class="mt-5 border-t border-neutral-200 pt-4">
              <div class="flex items-center justify-between gap-3">
                <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
                  {t('history.title')}
                </div>
                <button
                  type="button"
                  class="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50"
                  onClick={() => void loadHistory()}
                >
                  {t('history.refresh')}
                </button>
              </div>
              <Show when={historyMessage()}>
                {(message) => (
                  <div class="mt-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs leading-5 text-neutral-600">
                    {message()}
                  </div>
                )}
              </Show>
              <div class="mt-3 space-y-2">
                <Show when={historyEntries().length > 0} fallback={
                  <div class="rounded-lg border border-dashed border-neutral-200 px-3 py-3 text-xs leading-5 text-neutral-400">
                    {t('history.empty')}
                  </div>
                }>
                  <For each={historyEntries().slice(0, 5)}>
                    {(entry) => (
                      <div class="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3">
                        <div class="text-xs font-medium text-neutral-900">{entry.label}</div>
                        <div class="mt-1 text-[11px] text-neutral-400">
                          {new Date(entry.createdAt).toLocaleString()}
                        </div>
                        <div class="mt-2 flex items-center justify-between gap-3">
                          <span class="text-[11px] text-neutral-500">
                            {t('history.changeCount', { count: entry.changes.length })}
                          </span>
                          <button
                            type="button"
                            class="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:text-neutral-300"
                            disabled={undoingEntryId() === entry.id}
                            onClick={() => void undoHistoryEntry(entry)}
                          >
                            {undoingEntryId() === entry.id ? t('history.undoing') : t('history.undo')}
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </div>
          </aside>

          <section class="min-w-0">
            {activeModule() === 'smart-organize' ? (
              <BookmarkOrganizerWorkspace
                locale={locale}
                initialQuery={filterSeed()}
                confirmAction={confirmAction}
              />
            ) : activeModule() === 'duplicate-cleanup' ? (
              <DuplicateCleanupWorkspace
                locale={locale}
                initialQuery={filterSeed()}
                confirmAction={confirmAction}
              />
            ) : activeModule() === 'folder-audit' ? (
              <FolderAuditWorkspace
                locale={locale}
                initialQuery={filterSeed()}
                onNavigate={navigateModule}
                confirmAction={confirmAction}
              />
            ) : (
              <SummaryToolWorkspace
                locale={locale}
                initialQuery={filterSeed()}
                confirmAction={confirmAction}
              />
            )}
          </section>
        </main>
      </div>
      <ConfirmDialog
        open={confirmState() !== null}
        options={confirmState()?.options ?? null}
        onCancel={() => closeConfirm(false)}
        onConfirm={() => closeConfirm(true)}
      />
    </div>
  );
}

function readModuleFromUrl(): OrganizerModuleId {
  const value = readQueryParam('module');
  if (
    value === 'smart-organize' ||
    value === 'duplicate-cleanup' ||
    value === 'folder-audit' ||
    value === 'summary-tools'
  ) {
    return value;
  }
  return 'smart-organize';
}

function readQueryParam(name: string): string | null {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

function writeUrlState(moduleId: OrganizerModuleId, query: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('module', moduleId);
  if (query.trim()) {
    url.searchParams.set('q', query.trim());
  } else {
    url.searchParams.delete('q');
  }
  window.history.replaceState({}, '', url);
}
