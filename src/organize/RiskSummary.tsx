import { For, Show } from 'solid-js';

export type RiskSummaryItem = {
  label: string;
  value: number;
  tone?: 'neutral' | 'warning' | 'danger';
};

export function RiskSummary(props: {
  title: string;
  items: RiskSummaryItem[];
  note?: string;
}) {
  return (
    <div class="space-y-3">
      <div class="text-xs font-medium uppercase tracking-[0.14em] text-neutral-400">
        {props.title}
      </div>
      <div class="grid gap-2 sm:grid-cols-2">
        <For each={props.items.filter((item) => item.value > 0)}>
          {(item) => (
            <div class="rounded-lg border border-neutral-200 bg-white px-3 py-2">
              <div
                class={[
                  'text-lg font-semibold',
                  item.tone === 'danger'
                    ? 'text-red-600'
                    : item.tone === 'warning'
                      ? 'text-amber-600'
                      : 'text-neutral-900',
                ].join(' ')}
              >
                {item.value}
              </div>
              <div class="mt-0.5 text-xs leading-5 text-neutral-500">
                {item.label}
              </div>
            </div>
          )}
        </For>
      </div>
      <Show when={props.note}>
        {(note) => (
          <p class="text-xs leading-5 text-neutral-500">
            {note()}
          </p>
        )}
      </Show>
    </div>
  );
}
