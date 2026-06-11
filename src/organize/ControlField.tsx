import type { JSX } from 'solid-js';

export function ControlField(props: {
  label: string;
  description: string;
  children: JSX.Element;
}) {
  return (
    <label class="block">
      <span class="text-xs font-medium text-neutral-700">{props.label}</span>
      <div class="mt-2">{props.children}</div>
      <span class="mt-1.5 block text-xs leading-5 text-neutral-500">
        {props.description}
      </span>
    </label>
  );
}
