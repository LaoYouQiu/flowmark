import { createSignal, Show } from 'solid-js';
import type { JSX } from 'solid-js';

export function DisclosurePanel(props: {
  title: string;
  summary?: string;
  showLabel?: string;
  hideLabel?: string;
  defaultOpen?: boolean;
  children: JSX.Element;
}) {
  const [open, setOpen] = createSignal(Boolean(props.defaultOpen));

  return (
    <div class="rounded-md border border-neutral-200 bg-white">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <span class="min-w-0">
          <span class="block text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
            {props.title}
          </span>
          <Show when={props.summary}>
            <span class="mt-1 block truncate text-sm text-neutral-700">
              {props.summary}
            </span>
          </Show>
        </span>
        <span class="shrink-0 text-xs font-medium text-neutral-500">
          {open() ? props.hideLabel ?? 'Hide' : props.showLabel ?? 'Show'}
        </span>
      </button>
      <Show when={open()}>
        <div class="border-t border-neutral-200 px-3 py-3">
          {props.children}
        </div>
      </Show>
    </div>
  );
}
