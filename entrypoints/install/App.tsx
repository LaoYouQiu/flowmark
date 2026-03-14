import { createMemo, createSignal, onMount } from 'solid-js';

import { AiProviderFields } from '@/src/components/AiProviderFields';
import { Button } from '@/src/components/Button';
import { ReleasePage } from '@/src/release-pages/ReleasePage';
import { StatusBadge } from '@/src/components/StatusBadge';
import {
  getBrowserUiLanguage,
  resolveLocale,
  useI18n,
} from '@/src/shared/i18n';
import { openOrganizePage } from '@/src/shared/open-organize-page';
import {
  getAiPermissionGranted,
  getProviderStatus,
  saveFlowmarkSettings,
  type SettingsSaveStatus,
} from '@/src/shared/provider-settings';
import { getSettings } from '@/src/shared/settings';
import type { FlowmarkSettings } from '@/src/shared/types';

export default function App() {
  const [settings, setSettings] = createSignal<FlowmarkSettings | null>(null);
  const [permissionGranted, setPermissionGranted] = createSignal<boolean | null>(null);
  const [saveStatus, setSaveStatus] = createSignal<SettingsSaveStatus>({ kind: 'idle' });

  const currentLocale = createMemo(() =>
    resolveLocale(settings()?.localeOverride ?? 'auto', getBrowserUiLanguage()),
  );
  const { t } = useI18n(currentLocale);

  const providerStatus = createMemo(() =>
    getProviderStatus(settings(), permissionGranted(), {
      loading: t('common.loading'),
      setupNeeded: t('options.statusSetupNeeded'),
      permissionMissing: t('options.statusPermissionMissing'),
      ready: t('options.statusReady'),
    }),
  );

  const saveErrorMessage = createMemo(() => {
    const status = saveStatus();
    return status.kind === 'error' ? status.message : null;
  });

  onMount(() => {
    void (async () => {
      const current = await getSettings();
      setSettings(current);
      const granted = await getAiPermissionGranted(current);
      setPermissionGranted(granted);
    })();
  });

  const update = <K extends keyof FlowmarkSettings>(key: K, value: FlowmarkSettings[K]) => {
    const current = settings();
    if (!current) return;
    setSettings({ ...current, [key]: value });
  };

  const handleSave = async () => {
    const current = settings();
    if (!current) return;

    setSaveStatus({ kind: 'idle' });

    try {
      const result = await saveFlowmarkSettings(current);
      setSettings(result.next);
      setPermissionGranted(result.permissionGranted);

      if (result.recommendationDisabledByPermission) {
        setSaveStatus({
          kind: 'error',
          message: t('options.permissionDeniedDisabled'),
        });
        return;
      }

      setSaveStatus({ kind: 'saved' });
      setTimeout(() => setSaveStatus({ kind: 'idle' }), 2000);
    } catch {
      setSaveStatus({
        kind: 'error',
        message: t('options.saveFailed'),
      });
    }
  };

  const handleOpenOrganizer = () => {
    void openOrganizePage();
  };

  return (
    <ReleasePage
      pageKind="install"
      installAddon={
        <div class="space-y-6">
          <section class="rounded-xl border border-neutral-200 bg-white px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] sm:px-6 sm:py-6">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
                  {t('install.inlineSetupTitle')}
                </div>
                <p class="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
                  {t('install.inlineSetupDescription')}
                </p>
              </div>
              <StatusBadge tone={providerStatus().tone}>{providerStatus().label}</StatusBadge>
            </div>

            <div class="mt-5">
              {settings() && (
                <AiProviderFields
                  settings={settings()!}
                  permissionGranted={permissionGranted()}
                  baseUrlLabel={t('options.baseUrlLabel')}
                  baseUrlPlaceholder={t('options.baseUrlPlaceholder')}
                  permissionLabel={t('options.permissionLabel')}
                  modelLabel={t('options.modelLabel')}
                  modelPlaceholder={t('options.modelPlaceholder')}
                  apiKeyLabel={t('options.apiKeyLabel')}
                  apiKeyPlaceholder={t('options.apiKeyPlaceholder')}
                  unknownLabel={t('common.unknown')}
                  grantedLabel={t('common.granted')}
                  notGrantedLabel={t('common.notGranted')}
                  onBaseUrlInput={(value) => update('aiBaseURL', value)}
                  onModelInput={(value) => update('aiModel', value)}
                  onApiKeyInput={(value) => update('aiApiKey', value)}
                  footer={
                    <div class="flex flex-col items-start justify-between gap-3 border-t border-neutral-200 pt-5 sm:flex-row sm:items-center">
                      <div class="min-h-5 text-sm text-neutral-500">
                        {saveStatus().kind === 'saved' && (
                          <span class="text-neutral-900">{t('common.saved')}</span>
                        )}
                        {saveErrorMessage() && (
                          <span class="text-red-700">{saveErrorMessage()}</span>
                        )}
                      </div>
                      <Button type="button" onClick={handleSave}>
                        {t('install.inlineSaveLabel')}
                      </Button>
                    </div>
                  }
                />
              )}
            </div>
          </section>

          <section class="rounded-xl border border-neutral-200 bg-[linear-gradient(135deg,#ffffff,#f6f6f6)] px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] sm:px-6 sm:py-6">
            <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
              {t('install.organizerTitle')}
            </div>
            <div class="mt-2 text-xl font-medium tracking-tight text-neutral-900">
              {t('install.organizerHeading')}
            </div>
            <p class="mt-3 max-w-2xl text-sm leading-6 text-neutral-500">
              {t('install.organizerDescription')}
            </p>
            <div class="mt-5">
              <Button type="button" variant="secondary" onClick={handleOpenOrganizer}>
                {t('install.organizerOpenButton')}
              </Button>
            </div>
          </section>
        </div>
      }
    />
  );
}
