import type { Locale } from '@/src/shared/types';

export type OrganizerModuleId =
  | 'smart-organize'
  | 'duplicate-cleanup'
  | 'folder-audit'
  | 'bookmark-health'
  | 'summary-tools'
  | 'summary-search';

export type ConfirmActionOptions = {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  content?: () => import('solid-js').JSX.Element;
};

export type WorkspaceBaseProps = {
  locale: () => Locale;
  initialQuery?: string;
  confirmAction?: (options: ConfirmActionOptions) => Promise<boolean>;
};
