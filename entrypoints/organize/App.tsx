import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';

import { Button } from '@/src/components/Button';
import { ConfirmDialog, type ConfirmDialogOptions } from '@/src/components/ConfirmDialog';
import { ControlField } from '@/src/organize/ControlField';
import { BookmarkHealthWorkspace } from '@/src/organize/BookmarkHealthWorkspace';
import { BookmarkOrganizerWorkspace } from '@/src/organize/BookmarkOrganizerWorkspace';
import { DuplicateCleanupWorkspace } from '@/src/organize/DuplicateCleanupWorkspace';
import { FolderAuditWorkspace } from '@/src/organize/FolderAuditWorkspace';
import { SummarySearchWorkspace } from '@/src/organize/SummarySearchWorkspace';
import { SummaryToolWorkspace } from '@/src/organize/SummaryToolWorkspace';
import type { ConfirmActionOptions, OrganizerModuleId } from '@/src/organize/types';
import { getBrowserUiLanguage, resolveLocale, useI18n } from '@/src/shared/i18n';
import { messaging } from '@/src/shared/messaging';
import { openSettingsPage } from '@/src/shared/open-settings-page';
import { getSettings } from '@/src/shared/settings';
import type {
  BookmarkBackupFormat,
  FlowmarkSettings,
  OperationHistoryEntry,
} from '@/src/shared/types';

type OrganizerModule = {
  id: OrganizerModuleId;
  titleKey:
    | 'organize.navSmartOrganize'
    | 'organize.navDuplicateCleanup'
    | 'organize.navFolderAudit'
    | 'organize.navBookmarkHealth'
    | 'organize.navSummaryTools'
    | 'organize.navSummarySearch';
  descriptionKey:
    | 'organize.navSmartOrganizeDesc'
    | 'organize.navDuplicateCleanupDesc'
    | 'organize.navFolderAuditDesc'
    | 'organize.navBookmarkHealthDesc'
    | 'organize.navSummaryToolsDesc'
    | 'organize.navSummarySearchDesc';
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
    id: 'bookmark-health',
    titleKey: 'organize.navBookmarkHealth',
    descriptionKey: 'organize.navBookmarkHealthDesc',
    status: 'active',
  },
  {
    id: 'summary-tools',
    titleKey: 'organize.navSummaryTools',
    descriptionKey: 'organize.navSummaryToolsDesc',
    status: 'active',
  },
  {
    id: 'summary-search',
    titleKey: 'organize.navSummarySearch',
    descriptionKey: 'organize.navSummarySearchDesc',
    status: 'active',
  },
];

export default function App() {
  let workspaceRef: HTMLElement | undefined;
  const [settings, setSettings] = createSignal<FlowmarkSettings | null>(null);
  const [activeModule, setActiveModule] = createSignal<OrganizerModuleId>(readModuleFromUrl());
  const [filterSeed, setFilterSeed] = createSignal(readQueryParam('q') ?? '');
  const [historyEntries, setHistoryEntries] = createSignal<OperationHistoryEntry[]>([]);
  const [historyMessage, setHistoryMessage] = createSignal<string | null>(null);
  const [undoingEntryId, setUndoingEntryId] = createSignal<string | null>(null);
  const [backupState, setBackupState] = createSignal<'idle' | 'exporting' | 'done' | 'error'>('idle');
  const [backupMessage, setBackupMessage] = createSignal<string | null>(null);
  const [debugCount, setDebugCount] = createSignal(100);
  const [debugState, setDebugState] = createSignal<'idle' | 'creating' | 'done' | 'error'>('idle');
  const [debugMessage, setDebugMessage] = createSignal<string | null>(null);
  const [workspaceMinHeight, setWorkspaceMinHeight] = createSignal(0);
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

  createEffect(() => {
    activeModule();
    filterSeed();
    requestAnimationFrame(measureWorkspaceHeight);
  });

  onMount(() => {
    void (async () => {
      setSettings(await getSettings());
      await loadHistory();
    })();

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => measureWorkspaceHeight());
    if (workspaceRef) {
      resizeObserver?.observe(workspaceRef);
    }

    window.addEventListener('resize', measureWorkspaceHeight);
    onCleanup(() => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measureWorkspaceHeight);
    });
  });

  const loadHistory = async () => {
    const result = await messaging.sendMessage('listOperationHistory');
    setHistoryEntries(result.entries);
  };

  const openOptions = () => {
    void openSettingsPage();
  };

  const exportBackup = async (format: BookmarkBackupFormat) => {
    // The backup is generated in background from the current browser bookmark
    // tree, then downloaded locally from the organizer page in the chosen format.
    setBackupState('exporting');
    setBackupMessage(null);
    try {
      const result = await messaging.sendMessage('exportBookmarkBackup', { format });
      const blob = new Blob([result.content], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setBackupState('done');
      const successKey =
        format === 'html' ? 'backup.exportHtmlSuccess' : 'backup.exportJsonSuccess';
      setBackupMessage(t(successKey, {
        bookmarks: result.bookmarkCount,
        folders: result.folderCount,
      }));
    } catch {
      setBackupState('error');
      setBackupMessage(t('backup.exportFailed'));
    }
  };

  const createDebugBookmarks = async () => {
    const confirmed = await confirmAction({
      title: t('debugBookmarks.confirmTitle'),
      body: t('debugBookmarks.confirmBody'),
      confirmLabel: t('debugBookmarks.confirmButton'),
      cancelLabel: t('confirm.cancelButton'),
      tone: 'primary',
      content: () => (
        <ControlField
          label={t('debugBookmarks.countLabel')}
          description={t('debugBookmarks.countHint')}
        >
          <input
            type="number"
            min="1"
            max="4000"
            class="w-full rounded-md border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition-colors focus:border-neutral-400"
            value={debugCount()}
            onInput={(event) => setDebugCount(clampDebugCount(Number(event.currentTarget.value)))}
          />
        </ControlField>
      ),
    });
    if (!confirmed) return;

    setDebugState('creating');
    setDebugMessage(null);
    try {
      const result = await messaging.sendMessage('createDebugBookmarks', { count: debugCount() });
      setDebugState('done');
      setDebugMessage(t('debugBookmarks.success', {
        count: result.createdCount,
        folder: result.rootFolderTitle,
      }));
    } catch {
      setDebugState('error');
      setDebugMessage(t('debugBookmarks.failed'));
    }
  };

  const navigateModule = (moduleId: OrganizerModuleId, seed = '') => {
    const scrollTop = window.scrollY;
    lockCurrentScrollRange(scrollTop);
    setActiveModule(moduleId);
    setFilterSeed(seed);
    keepScrollPosition(scrollTop);
  };

  const measureWorkspaceHeight = () => {
    const viewportMinimum = Math.max(0, window.innerHeight - 144);
    const activePanelHeight = getActivePanelHeight();
    setWorkspaceMinHeight(Math.max(viewportMinimum, activePanelHeight));
  };

  const lockCurrentScrollRange = (scrollTop: number) => {
    const workspace = workspaceRef;
    if (!workspace) return;
    const sectionTop = workspace.getBoundingClientRect().top + window.scrollY;
    const visibleBottomInsideSection = scrollTop + window.innerHeight - sectionTop;
    const lockedHeight = Math.max(
      workspaceMinHeight(),
      getActivePanelHeight(),
      Math.ceil(visibleBottomInsideSection),
    );
    setWorkspaceMinHeight(lockedHeight);
  };

  const getActivePanelHeight = () => {
    const workspace = workspaceRef;
    if (!workspace) return 0;
    const activePanel = workspace.querySelector<HTMLElement>(
      `[data-module-panel="${activeModule()}"]`,
    );
    return Math.ceil(activePanel?.scrollHeight ?? workspace.scrollHeight);
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
              <Button
                type="button"
                variant="secondary"
                onClick={() => void exportBackup('json')}
                disabled={backupState() === 'exporting'}
              >
                {backupState() === 'exporting'
                  ? t('backup.exporting')
                  : t('backup.exportJsonButton')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void exportBackup('html')}
                disabled={backupState() === 'exporting'}
              >
                {backupState() === 'exporting'
                  ? t('backup.exporting')
                  : t('backup.exportHtmlButton')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void createDebugBookmarks()}
                disabled={debugState() === 'creating'}
              >
                {debugState() === 'creating'
                  ? t('debugBookmarks.creating')
                  : t('debugBookmarks.button')}
              </Button>
              <Button type="button" variant="secondary" onClick={openOptions}>
                {t('organize.openSettings')}
              </Button>
            </div>
          </div>
          <Show when={backupMessage()}>
            {(message) => (
              <div
                class={[
                  'mt-4 rounded-md border px-3 py-2 text-sm leading-6',
                  backupState() === 'error'
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-neutral-200 bg-white text-neutral-600',
                ].join(' ')}
              >
                {message()}
              </div>
            )}
          </Show>
          <Show when={debugMessage()}>
            {(message) => (
              <div
                class={[
                  'mt-3 rounded-md border px-3 py-2 text-sm leading-6',
                  debugState() === 'error'
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-neutral-200 bg-white text-neutral-600',
                ].join(' ')}
              >
                {message()}
              </div>
            )}
          </Show>
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
                    onMouseDown={(event) => event.preventDefault()}
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

          <section
            ref={(element) => {
              workspaceRef = element;
            }}
            class="min-w-0 min-h-[calc(100vh-9rem)]"
            style={{ 'min-height': `${workspaceMinHeight()}px` }}
          >
            <div
              data-module-panel="smart-organize"
              class={activeModule() === 'smart-organize' ? '' : 'hidden'}
            >
              <BookmarkOrganizerWorkspace
                locale={locale}
                initialQuery={filterSeed()}
                confirmAction={confirmAction}
              />
            </div>
            <div
              data-module-panel="duplicate-cleanup"
              class={activeModule() === 'duplicate-cleanup' ? '' : 'hidden'}
            >
              <DuplicateCleanupWorkspace
                locale={locale}
                initialQuery={filterSeed()}
                confirmAction={confirmAction}
              />
            </div>
            <div
              data-module-panel="folder-audit"
              class={activeModule() === 'folder-audit' ? '' : 'hidden'}
            >
              <FolderAuditWorkspace
                locale={locale}
                initialQuery={filterSeed()}
                onNavigate={navigateModule}
                confirmAction={confirmAction}
              />
            </div>
            <div
              data-module-panel="bookmark-health"
              class={activeModule() === 'bookmark-health' ? '' : 'hidden'}
            >
              <BookmarkHealthWorkspace
                locale={locale}
                initialQuery={filterSeed()}
              />
            </div>
            <div
              data-module-panel="summary-tools"
              class={activeModule() === 'summary-tools' ? '' : 'hidden'}
            >
              <SummaryToolWorkspace
                locale={locale}
                initialQuery={filterSeed()}
                confirmAction={confirmAction}
              />
            </div>
            <div
              data-module-panel="summary-search"
              class={activeModule() === 'summary-search' ? '' : 'hidden'}
            >
              <SummarySearchWorkspace
                locale={locale}
                initialQuery={filterSeed()}
              />
            </div>
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
    value === 'bookmark-health' ||
    value === 'summary-tools' ||
    value === 'summary-search'
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

function keepScrollPosition(scrollTop: number): void {
  queueMicrotask(() => {
    window.scrollTo({ top: scrollTop, left: window.scrollX, behavior: 'auto' });
    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollTop, left: window.scrollX, behavior: 'auto' });
    });
  });
}

function clampDebugCount(count: number): number {
  if (!Number.isFinite(count)) return 100;
  return Math.min(4000, Math.max(1, Math.floor(count)));
}
