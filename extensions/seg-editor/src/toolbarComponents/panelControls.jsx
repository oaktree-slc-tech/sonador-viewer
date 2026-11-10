import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

import { Icons, Input, Label, Slider, Switch, Tabs, TabsList, TabsTrigger, Tooltip, TooltipContent, TooltipTrigger } from '@ohif/ui-next';


// The Segmentation Editor palettes' panel controls (ohif-viewers#142, §12), shared by the 3D tools'
// panel and the Labelmap tools' options: grouped cards whose rows share one left edge and one row
// grammar (label leading, control trailing). A length setting names its unit after its value.

/** The number of decimals a step is given to, so stepped values do not drift (0.1 + 0.1 ...). */
export function decimalsOf(step) {
  const text = String(step);
  const index = text.indexOf('.');
  return index < 0 ? 0 : text.length - index - 1;
}

/**
 * Step a setting with the mouse wheel while the pointer is over an element: up raises it by one
 * step, down lowers it. The listener is bound natively and non-passive, so the wheel adjusts the
 * value instead of scrolling the panel (React's own wheel handler is passive).
 */
export function useWheelStep(ref, { value, step, onChange, disabled }) {
  const latest = useRef({ value, step, onChange, disabled });
  latest.current = { value, step, onChange, disabled };
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }
    const onWheel = event => {
      const current = latest.current;
      if (current.disabled || !event.deltaY) {
        return;
      }
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      const next = Number((current.value + direction * current.step).toFixed(decimalsOf(current.step)));
      current.onChange(next);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [ref]);
}

/**
 * A hover tip in the kit's own idiom (ui-next ToolButton): the kit's TooltipContent, wrapping to
 * its width, with the text in the kit's size and an optional muted detail line beneath. A
 * disabled control takes no pointer events, so wrap it in a span to keep its tip.
 */
export function Tip({ text, detail, content, children }) {
  if (!text && !content) {
    return children;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" className="text-wrap w-auto max-w-sm whitespace-normal break-words">
        {content || (
          <div className="space-y-1">
            <div className="text-sm">{text}</div>
            {detail && <div className="text-muted-foreground text-xs">{detail}</div>}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

Tip.propTypes = { text: PropTypes.string, detail: PropTypes.string, content: PropTypes.node, children: PropTypes.node };

/** The kit's status icon for a surface state: closed (ok), has issues (warning), or being checked. */
export function StatusIcon({ tone, className = 'h-4 w-4 flex-none' }) {
  if (tone === 'ok') {
    return <Icons.StatusSuccess className={`${className} text-customgreen-100`} aria-hidden="true" />;
  }
  if (tone === 'warning') {
    return <Icons.StatusWarning className={className} aria-hidden="true" />;
  }
  return <Icons.LoadingSpinner className={className} aria-hidden="true" />;
}

StatusIcon.propTypes = { tone: PropTypes.oneOf(['ok', 'warning', 'muted']).isRequired, className: PropTypes.string };

/** A unit after a value: muted, in a fixed column so the values above and below it line up. */
export function Unit({ unit, hint }) {
  if (!unit) {
    return null;
  }
  return (
    <Tip text={hint}>
      <span className="text-muted-foreground w-7 flex-none text-xs" data-cy="seg-editor-unit">{unit}</span>
    </Tip>
  );
}

Unit.propTypes = { unit: PropTypes.string, hint: PropTypes.string };

const RANGE_SHAPE = PropTypes.shape({ min: PropTypes.number, max: PropTypes.number, step: PropTypes.number });

/**
 * A setting as a number field: typed or stepped values apply as they are entered (the state
 * clamps them to the slider's range), and an unfinished entry is put back on blur.
 */
export function NumberField({ id, label, value, range, disabled, onChange, describedBy }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const change = event => {
    const text = event.target.value;
    setDraft(text);
    const next = Number(text);
    if (text !== '' && Number.isFinite(next)) {
      onChange(next);
    }
  };

  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      min={range.min}
      max={range.max}
      step={range.step}
      value={draft}
      disabled={disabled}
      className="h-6 w-16 px-1.5 text-right text-xs tabular-nums"
      aria-label={label}
      aria-describedby={describedBy}
      onChange={change}
      onBlur={() => setDraft(String(value))}
      data-cy={id}
    />
  );
}

NumberField.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  value: PropTypes.number.isRequired,
  range: RANGE_SHAPE.isRequired,
  disabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  /** The ids of the elements that describe the field */
  describedBy: PropTypes.string,
};

/**
 * A numeric setting: its label, number field and unit on one line, the slider beneath. The wheel
 * steps it while the pointer is over the row.
 *
 * The unit's hover text is for the pointer; from the keyboard, the number field and the slider's
 * thumb are described by the unit with that text (a visually hidden line) and by the note, so a
 * unit such as voxel units is defined wherever the setting takes focus. The row is positioned so
 * that line (absolutely positioned, as sr-only is) is laid out inside it: otherwise its containing
 * block is the page, since the side panel scrolls without being positioned, and a row below the
 * fold stretches the page and gives it a second scrollbar beside the panel's.
 */
export function SliderRow({ id, label, hint, unit, unitHint, value, range, disabled, onChange, note }) {
  const row = useRef(null);
  useWheelStep(row, { value, step: range.step, onChange, disabled });
  const unitDescription = unit ? [unit, unitHint].filter(Boolean).join('. ') : '';
  const describedBy = [unitDescription && `${id}-unit-description`, note && `${id}-note`].filter(Boolean).join(' ') || undefined;
  return (
    <div ref={row} className="relative flex flex-col gap-3 pb-1 pt-0.5">
      <div className="flex items-center justify-between gap-2">
        <Tip text={hint}>
          <label htmlFor={`${id}-value`} className="text-[13px]">{label}</label>
        </Tip>
        <span className="flex items-center gap-1.5">
          <NumberField id={`${id}-value`} label={label} value={value} range={range} disabled={disabled} onChange={onChange} describedBy={describedBy} />
          <Unit unit={unit} hint={unitHint} />
        </span>
      </div>
      <Slider
        min={range.min}
        max={range.max}
        step={range.step}
        value={[value]}
        disabled={disabled}
        aria-label={label}
        thumbProps={{ 'aria-label': label, 'aria-describedby': describedBy }}
        onValueChange={([next]) => onChange(next)}
        data-cy={id}
      />
      {unitDescription && (
        <span id={`${id}-unit-description`} className="sr-only">{unitDescription}</span>
      )}
      {note && (
        <p id={`${id}-note`} className="text-muted-foreground -mt-1.5 text-xs" data-cy={`${id}-note`}>{note}</p>
      )}
    </div>
  );
}

SliderRow.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  hint: PropTypes.string,
  unit: PropTypes.string,
  unitHint: PropTypes.string,
  value: PropTypes.number.isRequired,
  range: RANGE_SHAPE.isRequired,
  disabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  /** A line under the slider: the same length read in the other basis */
  note: PropTypes.string,
};

/**
 * A setting that is a range: its label and unit on one line, a two-thumbed slider beneath, and
 * the low and high number fields under the slider's ends.
 */
export function RangeSliderRow({ id, label, hint, unit, unitHint, value, range, disabled, onChange }) {
  const [low, high] = value;
  const setLow = next => onChange([Math.min(next, high), high]);
  const setHigh = next => onChange([low, Math.max(next, low)]);
  return (
    <div className="flex flex-col gap-3 pb-1 pt-0.5">
      <div className="flex items-center justify-between gap-2">
        <Tip text={hint}><span className="text-[13px]">{label}</span></Tip>
        <Unit unit={unit} hint={unitHint} />
      </div>
      <Slider
        min={range.min}
        max={range.max}
        step={range.step}
        value={[low, high]}
        disabled={disabled}
        aria-label={label}
        onValueChange={next => onChange(next)}
        data-cy={id}
      />
      <div className="flex items-center justify-between gap-2">
        <NumberField id={`${id}-low`} label={`${label} (low)`} value={low} range={range} disabled={disabled} onChange={setLow} />
        <NumberField id={`${id}-high`} label={`${label} (high)`} value={high} range={range} disabled={disabled} onChange={setHigh} />
      </div>
    </div>
  );
}

RangeSliderRow.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  hint: PropTypes.string,
  unit: PropTypes.string,
  unitHint: PropTypes.string,
  value: PropTypes.arrayOf(PropTypes.number).isRequired,
  range: RANGE_SHAPE.isRequired,
  disabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
};

/** An inset grouped section: a small uppercase label, an optional trailing action, then rows. */
export function Card({ title, action, warning, dataCy, children }) {
  return (
    <section
      className={`flex flex-col gap-2.5 rounded-md border bg-popover/40 px-3 py-2.5 ${warning ? 'border-[#e8b04c]/60' : 'border-input/60'}`}
      aria-label={title}
      data-cy={dataCy}
    >
      <header className="flex min-h-5 items-center justify-between gap-2">
        <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">{title}</span>
        {action}
      </header>
      {children}
    </section>
  );
}

Card.propTypes = {
  title: PropTypes.string.isRequired,
  action: PropTypes.node,
  warning: PropTypes.bool,
  dataCy: PropTypes.string,
  children: PropTypes.node,
};

/**
 * Label leading, switch trailing, with an optional one-line description under the label and an
 * optional control (a colour swatch) between the label and the switch.
 */
export function ToggleRow({ id, label, description, hint, checked, disabled, onChange, control }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3 py-0.5">
      <Tip text={hint}>
        <Label htmlFor={id} className="min-w-0 flex-1 cursor-pointer text-[13px] font-normal leading-snug">
          {label}
          {description && <span className="text-muted-foreground mt-1.5 block text-xs leading-snug">{description}</span>}
        </Label>
      </Tip>
      {control}
      <Switch id={id} checked={!!checked} disabled={disabled} onCheckedChange={onChange} data-cy={id} />
    </div>
  );
}

ToggleRow.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  description: PropTypes.string,
  hint: PropTypes.string,
  checked: PropTypes.bool,
  disabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  control: PropTypes.node,
};

/**
 * A colour as a small round swatch that opens the browser's colour picker. The value is applied
 * as it is picked.
 */
export function ColorSwatch({ id, label, hint, value, disabled, onChange }) {
  return (
    <Tip text={hint}>
      <input
        id={id}
        type="color"
        value={value}
        disabled={disabled}
        aria-label={label}
        className="border-input/60 h-5 w-5 flex-none cursor-pointer appearance-none overflow-hidden rounded-full border p-0 disabled:cursor-default disabled:opacity-50 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0"
        onChange={event => onChange(event.target.value)}
        data-cy={id}
      />
    </Tip>
  );
}

ColorSwatch.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  hint: PropTypes.string,
  value: PropTypes.string.isRequired,
  disabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
};

/** An Advanced number field: label leading, input and unit trailing, the wheel stepping it. */
export function AdvancedField({ id, label, unit, unitHint, step, value, range, disabled, onChange }) {
  const row = useRef(null);
  useWheelStep(row, { value, step, onChange, disabled });
  return (
    <label ref={row} htmlFor={id} className="flex items-center justify-between gap-2 text-xs">
      <span>{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          id={id}
          type="number"
          className="bg-muted text-foreground w-16 rounded border-0 px-1 py-0.5 text-right text-xs"
          min={range.min}
          max={range.max}
          step={step}
          value={value}
          disabled={disabled}
          data-cy={id}
          onChange={event => onChange(event.target.value)}
        />
        <span className="w-7 flex-none">
          <Unit unit={unit} hint={unitHint} />
        </span>
      </span>
    </label>
  );
}

AdvancedField.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  unit: PropTypes.string,
  unitHint: PropTypes.string,
  step: PropTypes.number.isRequired,
  value: PropTypes.number.isRequired,
  range: PropTypes.shape({ min: PropTypes.number, max: PropTypes.number }).isRequired,
  disabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
};

// Above this many characters of segment labels, a segmented control takes its own full-width line
// under its label (Circle / Sphere / Rectangle does not fit beside its label in the side panel)
const INLINE_SEGMENT_CHARACTERS = 16;

/** Whether a segmented control's labels are too long to sit beside its row label. */
export function segmentsNeedOwnLine(items) {
  return items.reduce((total, item) => total + String(item.label).length, 0) > INLINE_SEGMENT_CHARACTERS;
}

/**
 * Label leading, segmented control trailing; or, when its labels are long, the control on its own
 * line under the label, its segments sharing the card's width.
 *
 * @param {Array<{ value: string, label: string }>} props.items - the segments, labels translated
 */
export function SegmentedRow({ id, label, hint, value, items, disabled, onChange, stacked }) {
  const ownLine = stacked ?? segmentsNeedOwnLine(items);
  return (
    <div className={ownLine ? 'flex flex-col gap-2' : 'flex items-center justify-between gap-3'} data-cy={`${id}-row`}>
      <Tip text={hint}><span className="text-[13px]">{label}</span></Tip>
      <Tabs value={value} onValueChange={onChange} className={ownLine ? 'w-full' : ''}>
        <TabsList className={`bg-muted h-7 gap-0.5 rounded p-0.5 ${ownLine ? 'flex w-full' : 'inline-flex'}`}>
          {items.map(item => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              disabled={disabled}
              className={`h-6 rounded px-2 text-xs ${ownLine ? 'min-w-0 flex-1' : 'min-w-[44px]'}`}
              data-cy={`${id}-${item.value}`}
            >
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}

SegmentedRow.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  hint: PropTypes.string,
  value: PropTypes.string,
  items: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, label: PropTypes.string })).isRequired,
  disabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  // Force the control onto its own line (true) or beside its label (false); by default it is
  // put on its own line when its labels are long
  stacked: PropTypes.bool,
};
