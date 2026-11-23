// Accessible controls built on Radix primitives (keyboard and ARIA behaviour come from Radix).
import { memo, type ReactNode } from 'react';
import * as RSlider from '@radix-ui/react-slider';
import * as RSelect from '@radix-ui/react-select';
import * as RSwitch from '@radix-ui/react-switch';
import * as RToggle from '@radix-ui/react-toggle-group';
import * as RTooltip from '@radix-ui/react-tooltip';

export const Field = memo(function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
});

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <RSlider.Root
      className="slider"
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => onChange(v[0])}
      aria-label={label}
    >
      <RSlider.Track className="slider-track">
        <RSlider.Range className="slider-range" />
      </RSlider.Track>
      <RSlider.Thumb className="slider-thumb" aria-label={label} />
    </RSlider.Root>
  );
}

const EMPTY = '__none__';
export function Select({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const v = value === '' ? EMPTY : value;
  return (
    <RSelect.Root value={v} onValueChange={(x) => onChange(x === EMPTY ? '' : x)} disabled={disabled}>
      <RSelect.Trigger className="select-trigger" aria-label={label}>
        <RSelect.Value />
        <RSelect.Icon className="select-icon">v</RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content className="select-content" position="popper" sideOffset={4}>
          <RSelect.Viewport>
            {options.map((o) => (
              <RSelect.Item
                key={o.value || EMPTY}
                value={o.value === '' ? EMPTY : o.value}
                className="select-item"
              >
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <span className="switch-row">
      <RSwitch.Root
        className="switch"
        checked={checked}
        onCheckedChange={onChange}
        aria-label={label}
        disabled={disabled}
      >
        <RSwitch.Thumb className="switch-thumb" />
      </RSwitch.Root>
      <span className="switch-label">{label}</span>
    </span>
  );
}

export function Toggle({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <RToggle.Root
      className="toggle"
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v)}
      aria-label={label}
    >
      {options.map((o) => (
        <RToggle.Item key={o.value} value={o.value} className="toggle-item" disabled={o.disabled}>
          {o.label}
        </RToggle.Item>
      ))}
    </RToggle.Root>
  );
}

export function MultiToggle({
  values,
  options,
  onChange,
  label,
}: {
  values: string[];
  options: { value: string; label: string; color?: string }[];
  onChange: (v: string[]) => void;
  label: string;
}) {
  return (
    <RToggle.Root
      className="toggle chips"
      type="multiple"
      value={values}
      onValueChange={onChange}
      aria-label={label}
    >
      {options.map((o) => (
        <RToggle.Item
          key={o.value}
          value={o.value}
          className="toggle-item chip"
          style={o.color ? ({ '--chip': o.color } as never) : undefined}
        >
          {o.label}
        </RToggle.Item>
      ))}
    </RToggle.Root>
  );
}

export function Info({ text, children }: { text: string; children: ReactNode }) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content className="tip" sideOffset={6}>
          {text}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export function NumberInput({
  value,
  onCommit,
  step,
  min,
  max,
  label,
}: {
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  label: string;
}) {
  return (
    <input
      className="num"
      type="number"
      aria-label={label}
      key={value}
      defaultValue={Number.isFinite(value) ? +value.toFixed(4) : ''}
      step={step}
      min={min}
      max={max}
      onBlur={(e) => {
        const v = parseFloat(e.currentTarget.value);
        if (Number.isFinite(v) && v !== value) onCommit(v);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
      }}
    />
  );
}

export function Msg({ kind = 'info', children }: { kind?: 'info' | 'error' | 'warn'; children: ReactNode }) {
  return (
    <p className={`msg msg-${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      {children}
    </p>
  );
}
