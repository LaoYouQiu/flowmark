export function ProgressBar(props: {
  current?: number;
  total?: number;
  active?: boolean;
}) {
  const percent = () => {
    if (!props.total || props.total <= 0 || props.current === undefined) return 35;
    return Math.max(4, Math.min(100, Math.round((props.current / props.total) * 100)));
  };

  return (
    <div class="mt-3 h-2 overflow-hidden rounded-full bg-neutral-200">
      <div
        class={[
          'h-full rounded-full bg-neutral-900 transition-all',
          props.active && (!props.total || props.current === undefined)
            ? 'animate-pulse'
            : '',
        ].join(' ')}
        style={{ width: `${percent()}%` }}
      />
    </div>
  );
}
