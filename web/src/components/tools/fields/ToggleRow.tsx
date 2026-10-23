/** A checkbox with its label inside a tool panel (T-046), styled like the arrange options. */
export function ToggleRow({
  label,
  checked,
  title,
  onChange,
}: {
  label: string;
  checked: boolean;
  title?: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="tool-toggle" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
