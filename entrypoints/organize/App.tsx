import { createEffect, createMemo, createSignal, onMount } from 'solid-js';

import { Button } from '@/src/components/Button';
import { ConfirmDialog, type ConfirmDialogOptions } from '@/src/components/ConfirmDialog';
import { BookmarkOrganizerWorkspace } from '@/src/organize/BookmarkOrganizerWorkspace';
import { DuplicateCleanupWorkspace } from '@/src/organize/DuplicateCleanupWorkspace';
import { FolderAuditWorkspace } from '@/src/organize/FolderAuditWorkspace';
import { SummaryToolWorkspace } from '@/src/organize/SummaryToolWorkspace';
import type { ConfirmActionOptions, OrganizerModuleId } from '@/src/organize/types';
import { getBrowserUiLanguage, resolveLocale, useI18n } from '@/src/shared/i18n';
import { openSettingsPage } from '@/src/shared/open-settings-page';
import { getSettings } from '@/src/shared/settings';
import type { FlowmarkSettings } from '@/src/shared/types';

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
    })();
  });

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

  return (
    <div class="min-h-screen bg-[radial-gradient(circle_at_top,#f6f6f6,transparent_45%),linear-gradient(180deg,#fcfcfc,#f7f7f7)] px-4 py-5 text-neutral-900 sm:px-6 sm:py-8">
      <div class="mx-auto max-w-7xl">
        <header class="rounded-3xl border border-neutral-200 bg-[linear-gradient(135deg,#ffffff,rgba(245,245,245,0.92))] px-5 py-6 shadow-[0_14px_40px_rgba(0,0,0,0.04)] sm:px-8 sm:py-8">
          <div class="flex flex-wrap items-start justify-between gap-5">
            <div>
              <div class="text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-400">
                {t('organize.pageEyebrow')}
              </div>
              <h1 class="mt-3 text-3xl font-medium tracking-tight text-neutral-900 sm:text-5xl">
                {t('organize.pageHeading')}
              </h1>
              <p class="mt-4 max-w-3xl text-sm leading-7 text-neutral-500 sm:text-base">
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

        <main class="mt-6 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside class="rounded-3xl border border-neutral-200 bg-white px-4 py-4 shadow-[0_10px_30px_rgba(0,0,0,0.04)] sm:px-5 sm:py-5">
            <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
              {t('organize.navTitle')}
            </div>
            <div class="mt-4 space-y-2">
              {modules.map((module) => {
                const isActive = activeModule() === module.id;
                const isPlanned = module.status === 'planned';
                return (
                  <button
                    type="button"
                    class={[
                      'w-full rounded-2xl border px-4 py-4 text-left transition-colors',
                      isActive
                        ? 'border-neutral-900 bg-neutral-900 text-white'
                        : 'border-neutral-200 bg-[#fafafa] text-neutral-900 hover:border-neutral-300 hover:bg-white',
                    ].join(' ')}
                    onClick={() => navigateModule(module.id)}
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <div class={['text-sm font-medium tracking-tight', isActive ? 'text-white' : 'text-neutral-900'].join(' ')}>
                          {t(module.titleKey)}
                        </div>
                        <div class={['mt-2 text-xs leading-5', isActive ? 'text-neutral-200' : 'text-neutral-500'].join(' ')}>
                          {t(module.descriptionKey)}
                        </div>
                      </div>
                      <span
                        class={[
                          'rounded-full px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em]',
                          isActive
                            ? 'bg-white/12 text-white'
                            : isPlanned
                              ? 'bg-neutral-200 text-neutral-600'
                              : 'bg-neutral-900 text-white',
                        ].join(' ')}
                      >
                        {isPlanned ? t('organize.navPlanned') : t('organize.navReady')}
                      </span>
                    </div>
                  </button>
                );
              })}
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
