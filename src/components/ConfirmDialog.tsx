import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

import { Button } from '@/src/components/Button';

export type ConfirmDialogOptions = {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  tone?: 'primary' | 'danger';
  content?: () => JSX.Element;
};

export function ConfirmDialog(props: {
  open: boolean;
  options: ConfirmDialogOptions | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Show when={props.open && props.options}>
      {(options) => (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6 backdrop-blur-sm">
          <div class="w-full max-w-lg rounded-3xl border border-neutral-200 bg-white p-6 shadow-[0_24px_80px_rgba(0,0,0,0.16)]">
            <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
              Confirm action
            </div>
            <h2 class="mt-3 text-2xl font-medium tracking-tight text-neutral-900">
              {options().title}
            </h2>
            <p class="mt-4 text-sm leading-7 text-neutral-500">
              {options().body}
            </p>
            <Show when={options().content}>
              <div class="mt-5 rounded-2xl border border-neutral-200 bg-[#fafafa] p-4">
                {options().content?.()}
              </div>
            </Show>

            <div class="mt-6 flex flex-wrap justify-end gap-3">
              <Button type="button" variant="secondary" onClick={props.onCancel}>
                {options().cancelLabel}
              </Button>
              <Button
                type="button"
                variant={options().tone === 'danger' ? 'secondary' : 'primary'}
                class={
                  options().tone === 'danger'
                    ? 'border border-red-200 bg-red-600 text-white hover:bg-red-500'
                    : undefined
                }
                onClick={props.onConfirm}
              >
                {options().confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
