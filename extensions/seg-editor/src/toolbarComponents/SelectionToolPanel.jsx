import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { useSystem } from '@ohif/core';
import {
  Button,
  Icons,
  Input,
  Label,
  Slider,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@ohif/ui-next';

import { editSummary } from '../threeDTools/editSummary';
import {
  EDIT_SETTINGS,
  get3DToolState,
  is3DTargetEditable,
  LASSO_SHAPES,
  PAINT_MODES,
  PAINT_RADIUS,
  REMOVAL_DEPTH,
  request3DToolAction,
  SELECTION_ACTIONS,
  set3DToolOption,
  SMOOTH_PASSES,
  SMOOTH_STRENGTH,
  subscribe3DToolState,
  THREE_D_TOOLS,
} from '../threeDTools/threeDToolState';
import { SEG_EDITOR_COMMAND_CONTEXT } from '../toolbox/constants';


// The 3D Selection tool's panel (ohif-viewers#142, §12), as three grouped cards: what is selected,
// how the selected points are removed, and the health of the segment's surface. Every card shares
// one left edge and one row grammar (label leading, control trailing); an operation's parameters
// sit in its card and are shown only while it applies; the card's own action row is its primary,
// and while an edit is shown for Apply / Cancel that row is the only primary offered. Settings
// live in the 3D tool state; actions reach the canvas through its request channel.

const number = value => Number(value || 0).toLocaleString();

const SEGMENTS = {
  lassoShape: [LASSO_SHAPES.lasso, LASSO_SHAPES.box],
  paintMode: [PAINT_MODES.paint, PAINT_MODES.erase],
  closure: ['auto', 'smooth', 'flat'],
  rimCleanup: ['off', 'light', 'full'],
};

const SEGMENT_LABELS = {
  lasso: 'Freehand', box: 'Box', paint: 'Paint', erase: 'Erase',
  auto: 'Auto', smooth: 'Smooth', flat: 'Flat', off: 'Off', light: 'Light', full: 'Full',
};

/** The number of decimals a step is given to, so stepped values do not drift (0.1 + 0.1 ...). */
function decimalsOf(step) {
  const text = String(step);
  const index = text.indexOf('.');
  return index < 0 ? 0 : text.length - index - 1;
}

/**
 * Step a setting with the mouse wheel while the pointer is over an element: up raises it by one
 * step, down lowers it. The listener is bound natively and non-passive, so the wheel adjusts the
 * value instead of scrolling the panel (React's own wheel handler is passive).
 */
function useWheelStep(ref, { value, step, onChange, disabled }) {
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

/** A gentle wave: Smooth. */
function SmoothIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" {...props}>
      <path d="M3 15c3-5 6-5 9 0s6 5 9 0" />
    </svg>
  );
}

/** A wrench: Repair. */
function RepairIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M14.5 5.5a4 4 0 0 0 5 5L10 20a2.1 2.1 0 0 1-3-3l9.5-9.5zM14.5 5.5l4-1 1 4" />
    </svg>
  );
}

// The action cards, one shown at a time: the row's button, its icon, and the help shown on hover
const ACTIONS = [
  {
    id: 'remove',
    label: 'Remove',
    Icon: props => <Icons.Trash {...props} />,
    hint: 'Removes the selected faces and closes the hole they leave.',
  },
  {
    id: 'smooth',
    label: 'Smooth',
    Icon: SmoothIcon,
    hint: 'Evens out the selected faces. Their edge stays in place, or eases with Soft edge.',
  },
  {
    id: 'repair',
    label: 'Repair',
    Icon: RepairIcon,
    hint: 'Closes the open edges of the whole surface. Changes the 3D surface only.',
  },
];

const ADVANCED = [
  { key: 'maxConstraints', label: 'Patch constraints', unit: '', step: 1 },
  { key: 'weldTolerance', label: 'Weld tolerance', unit: '', step: 0.001 },
  { key: 'islandMaxTriangles', label: 'Drop islands under', unit: 'tri', step: 1 },
];

/**
 * A setting as a number field: typed or stepped values apply as they are entered (the state
 * clamps them to the slider's range), and an unfinished entry is put back on blur.
 */
function NumberField({ id, label, value, range, disabled, onChange }) {
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
  range: PropTypes.shape({ min: PropTypes.number, max: PropTypes.number, step: PropTypes.number }).isRequired,
  disabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
};

/**
 * A numeric setting: its label and number field on one line, the slider beneath. The wheel steps
 * it while the pointer is over the row.
 */
function SliderRow({ id, label, hint, value, range, disabled, onChange }) {
  const row = useRef(null);
  useWheelStep(row, { value, step: range.step, onChange, disabled });
  return (
    <div ref={row} className="flex flex-col gap-3 pb-1 pt-0.5">
      <div className="flex items-center justify-between">
        <Tip text={hint}>
          <label htmlFor={`${id}-value`} className="text-[13px]">{label}</label>
        </Tip>
        <NumberField id={`${id}-value`} label={label} value={value} range={range} disabled={disabled} onChange={onChange} />
      </div>
      <Slider
        min={range.min}
        max={range.max}
        step={range.step}
        value={[value]}
        disabled={disabled}
        aria-label={label}
        onValueChange={([next]) => onChange(next)}
        data-cy={id}
      />
    </div>
  );
}

SliderRow.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  hint: PropTypes.string,
  value: PropTypes.number.isRequired,
  range: PropTypes.shape({ min: PropTypes.number, max: PropTypes.number, step: PropTypes.number }).isRequired,
  disabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
};

function Tip({ text, content, children }) {
  if (!text && !content) {
    return children;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] text-xs">{content || text}</TooltipContent>
    </Tooltip>
  );
}

Tip.propTypes = { text: PropTypes.string, content: PropTypes.node, children: PropTypes.node };

/** An inset grouped section: a small uppercase label, an optional trailing action, then rows. */
function Card({ title, action, warning, dataCy, children }) {
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

/** Label leading, switch trailing, with an optional one-line description under the label. */
function ToggleRow({ id, label, description, hint, checked, disabled, onChange }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3 py-0.5">
      <Tip text={hint}>
        <Label htmlFor={id} className="min-w-0 cursor-pointer text-[13px] font-normal leading-snug">
          {label}
          {description && <span className="text-muted-foreground mt-1.5 block text-xs leading-snug">{description}</span>}
        </Label>
      </Tip>
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
};

/** An Advanced number field: label leading, input trailing, the wheel stepping it over the row. */
function AdvancedField({ id, label, unit, step, value, range, disabled, onChange, t }) {
  const row = useRef(null);
  useWheelStep(row, { value, step, onChange, disabled });
  return (
    <label ref={row} htmlFor={id} className="flex items-center justify-between gap-2 text-xs">
      <span>{t(label)}</span>
      <span className="flex items-center gap-1">
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
        <span className="text-muted-foreground w-6">{unit ? t(unit) : ''}</span>
      </span>
    </label>
  );
}

AdvancedField.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  unit: PropTypes.string,
  step: PropTypes.number.isRequired,
  value: PropTypes.number.isRequired,
  range: PropTypes.shape({ min: PropTypes.number, max: PropTypes.number }).isRequired,
  disabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  t: PropTypes.func.isRequired,
};

/** Label leading, segmented control trailing. */
function SegmentedRow({ id, label, hint, value, values, disabled, onChange, t }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Tip text={hint}><span className="text-[13px]">{label}</span></Tip>
      <Tabs value={value} onValueChange={onChange}>
        <TabsList className="bg-muted inline-flex h-7 gap-0.5 rounded p-0.5">
          {values.map(item => (
            <TabsTrigger
              key={item}
              value={item}
              disabled={disabled}
              className="h-6 min-w-[44px] rounded px-2 text-xs"
              data-cy={`${id}-${item}`}
            >
              {t(SEGMENT_LABELS[item])}
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
  values: PropTypes.arrayOf(PropTypes.string).isRequired,
  disabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  t: PropTypes.func.isRequired,
};

export default function SelectionToolPanel({ tool = THREE_D_TOOLS.Lasso }) {
  const { t } = useTranslation('SegmentationEditor');
  const { commandsManager } = useSystem();
  const [state, setState] = useState(get3DToolState);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => subscribe3DToolState(setState), []);

  const {
    target, selectionCount, selectionPoints, selectionRegions, preview, surfaceHealth, lastEdit,
    pendingWrites, busy,
  } = state;
  const hasSelection = selectionCount > 0;
  const editable = is3DTargetEditable(state);
  const hasTarget = !!target && !target.disabledReason;
  const previewingSmooth = preview?.kind === 'smooth';
  const previewingRemoval = !!preview && !preview.repair && !previewingSmooth;
  const previewingRepair = !!preview && !!preview.repair;
  const painting = tool === THREE_D_TOOLS.Paint;
  const { action } = state;
  const request = name => request3DToolAction(name);
  const set = (key, value) => set3DToolOption(key, value);

  // An edit shown for Apply / Cancel brings its own action card up, wherever it was started
  useEffect(() => {
    if (preview) {
      set3DToolOption('action', preview.kind === 'smooth' ? SELECTION_ACTIONS.smooth
        : preview.repair ? SELECTION_ACTIONS.repair : SELECTION_ACTIONS.remove);
    }
  }, [preview]);
  const undo = () => commandsManager?.runCommand('undoSegEditor', {}, SEG_EDITOR_COMMAND_CONTEXT);

  // The action row of a card while its edit is shown for Apply / Cancel
  const previewRow = (note, applyLabel, cancelCy, applyCy) => (
    <div className="flex flex-col gap-2 pt-2">
      <p className="text-muted-foreground text-xs" role="status">{note}</p>
      <div className="flex gap-2 pt-1">
        <Button variant="secondary" size="lg" className="flex-1" onClick={() => request('cancelPreview')} data-cy={cancelCy}>
          {t('Cancel')}
        </Button>
        <Button size="lg" className="flex-1" onClick={() => request('applyPreview')} data-cy={applyCy}>
          {applyLabel}
        </Button>
      </div>
    </div>
  );

  const health = surfaceHealth;
  const healthTone = !health ? 'muted' : health.closed ? 'ok' : 'warning';
  const healthCounts = health ? [
    ['Open edges', health.boundaryEdgeCount],
    ['Non-manifold edges', health.nonManifoldEdgeCount],
    ['Degenerate triangles', health.degenerate],
    ['Duplicate triangles', health.duplicate],
  ].filter(([, count]) => count > 0) : [];
  const healthText = !hasTarget && !health
    ? t('Select a segment to check its surface')
    : healthTone === 'muted' ? t('Checking the surface...')
      : healthTone === 'ok' ? t('Surface is closed') : t('Surface has issues');
  const healthDot = healthTone === 'ok' ? 'bg-customgreen-100' : healthTone === 'warning' ? 'bg-[#e8b04c]' : 'bg-muted-foreground/50';

  return (
    <div className="text-foreground flex flex-col gap-2.5 px-1 py-1 text-[13px]" data-cy="seg-editor-selection-panel">

      <Card
        title={painting ? t('Paint') : t('Lasso')}
        dataCy="seg-editor-selection-card"
        action={hasSelection && !preview && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => request('clearSelection')} data-cy="seg-editor-clear-selection">
            {t('Clear')}
          </Button>
        )}
      >
        {hasSelection ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 leading-tight">
              <span className="text-xl font-semibold tabular-nums" data-cy="seg-editor-selection-count">
                {number(painting ? selectionCount : selectionPoints)}
              </span>
              <span className="text-muted-foreground"> {painting ? t('faces') : t('points')}</span>
              <div className="text-muted-foreground text-xs">
                {painting
                  ? t('{{count}} points, {{regions}} region(s)', { count: number(selectionPoints), regions: selectionRegions })
                  : t('{{count}} faces, {{regions}} region(s)', { count: number(selectionCount), regions: selectionRegions })}
              </div>
            </div>
            {!preview && (
            <div className="border-input/60 flex flex-none overflow-hidden rounded-md border" role="group" aria-label={t('Grow or shrink the selection')}>
              <Tip text={t('Shrink the selection by one ring of faces')}>
                <Button variant="ghost" className="h-8 w-10 rounded-none px-0" disabled={!editable} aria-label={t('Shrink')} onClick={() => request('shrinkSelection')} data-cy="seg-editor-shrink-selection">
                  <Icons.Minus className="h-4 w-4" />
                </Button>
              </Tip>
              <span className="bg-input/60 w-px" aria-hidden="true" />
              <Tip text={t('Grow the selection by one ring of faces')}>
                <Button variant="ghost" className="h-8 w-10 rounded-none px-0" disabled={!editable} aria-label={t('Grow')} onClick={() => request('growSelection')} data-cy="seg-editor-grow-selection">
                  <Icons.Add className="h-4 w-4" />
                </Button>
              </Tip>
            </div>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs leading-snug">
            {target?.disabledReason || (painting
              ? t('Drag over the model to paint faces. Ctrl erases.')
              : t('Lasso-drag on the model to select faces, shown by their points. Shift adds, Ctrl removes.'))}
          </p>
        )}
        {!preview && (painting ? (
          <>
            <SegmentedRow
              id="seg-editor-paint-mode"
              label={t('Brush')}
              hint={t('Paint adds faces to the selection, Erase takes them out. Ctrl erases while held.')}
              value={state.paintMode}
              values={SEGMENTS.paintMode}
              disabled={!!preview}
              onChange={value => set('paintMode', value)}
              t={t}
            />
            <SliderRow
              id="seg-editor-paint-radius"
              label={t('Brush size')}
              hint={t("Radius of the brush, in the surface's units")}
              value={state.paintRadius}
              range={PAINT_RADIUS}
              disabled={!!preview}
              onChange={value => set('paintRadius', value)}
            />
          </>
        ) : (
          <>
            <SegmentedRow
              id="seg-editor-lasso-shape"
              label={t('Shape')}
              hint={t('Freehand draws an outline; Box drags out a rectangle')}
              value={state.lassoShape}
              values={SEGMENTS.lassoShape}
              disabled={!!preview}
              onChange={value => set('lassoShape', value)}
              t={t}
            />
            <ToggleRow
              id="seg-editor-connected-only"
              label={t('Keep largest piece only')}
              description={t('A lasso keeps only the largest connected part of what it selects')}
              checked={state.connectedOnly}
              onChange={value => set('connectedOnly', value)}
            />
          </>
        ))}
      </Card>

      <div className="flex gap-1 px-0.5" role="tablist" aria-label={t('Action')} data-cy="seg-editor-action-row">
        {ACTIONS.map(({ id, label, Icon: ActionIcon, hint }) => (
          <Tip
            key={id}
            content={(
              <div className="flex flex-col gap-1">
                <span>{t(hint)}</span>
                {id === 'repair' && (
                  <span className="flex items-center gap-1.5" data-cy="seg-editor-repair-hover-status">
                    <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${healthDot}`} />
                    <span>
                      {healthText}
                      {health?.triangles > 0 && `, ${t('{{count}} triangles', { count: number(health.triangles) })}`}
                    </span>
                  </span>
                )}
              </div>
            )}
          >
            <Button
              role="tab"
              aria-selected={action === id}
              variant={action === id ? 'secondary' : 'ghost'}
              size="sm"
              className={`h-7 flex-1 gap-1.5 text-xs ${action === id ? '' : 'text-muted-foreground'}`}
              disabled={!!preview && action !== id}
              onClick={() => set('action', id)}
              data-cy={`seg-editor-action-${id}`}
            >
              <ActionIcon className="h-3.5 w-3.5 flex-none" />
              {t(label)}
            </Button>
          </Tip>
        ))}
      </div>

      {action === SELECTION_ACTIONS.remove && (
        <Card title={t('Remove')} dataCy="seg-editor-remove-card">
          <p className="text-muted-foreground -mt-1 text-xs">{t('Removes the selected faces and closes the hole they leave.')}</p>
          <SegmentedRow
            id="seg-editor-closure"
            label={t('Closure')}
            hint={t('How the hole is filled: flat for small holes and smooth for larger ones, or always one of them')}
            value={state.closure}
            values={SEGMENTS.closure}
            disabled={!!preview}
            onChange={value => set('closure', value)}
            t={t}
          />
          <SegmentedRow
            id="seg-editor-rim-cleanup"
            label={t('Rim cleanup')}
            hint={t('Loose triangles and small islands are removed along the cut before the hole is filled')}
            value={state.rimCleanup}
            values={SEGMENTS.rimCleanup}
            disabled={!!preview}
            onChange={value => set('rimCleanup', value)}
            t={t}
          />
          <SliderRow
            id="seg-editor-depth"
            label={t('Depth')}
            hint={t("Also removes the segment's voxels within this distance of the removed points in the 2D views")}
            value={state.removalDepth}
            range={REMOVAL_DEPTH}
            disabled={!!preview}
            onChange={value => set('removalDepth', value)}
          />
          <button
            type="button"
            className="text-muted-foreground mt-1.5 flex w-full items-center gap-1.5 text-left text-xs"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen(open => !open)}
            data-cy="seg-editor-advanced-toggle"
          >
            <span className={`inline-block transition-transform ${advancedOpen ? 'rotate-90' : ''}`} aria-hidden="true">▸</span>
            <span className="truncate">
              {advancedOpen ? t('Advanced') : t('Advanced: {{constraints}} patch constraints, weld {{weld}}, islands under {{island}}', {
                constraints: state.maxConstraints, weld: state.weldTolerance, island: state.islandMaxTriangles,
              })}
            </span>
          </button>
          {advancedOpen && (
            <div className="border-input/60 flex flex-col gap-2 border-l-2 pl-3">
              {ADVANCED.map(({ key, label, unit, step }) => (
                <AdvancedField
                  key={key}
                  id={`seg-editor-advanced-${key}`}
                  label={label}
                  unit={unit}
                  step={step}
                  value={state[key]}
                  range={EDIT_SETTINGS[key]}
                  disabled={!!preview}
                  onChange={value => set(key, value)}
                  t={t}
                />
              ))}
            </div>
          )}
          {previewingRemoval
            ? previewRow(t('Preview: the new patches are shown in blue. Enter applies, Esc cancels.'), t('Apply'),
              'seg-editor-cancel-preview', 'seg-editor-apply-preview')
            : (
              <div className="flex items-center gap-3 pt-0.5">
                <ToggleRow
                  id="seg-editor-preview-enabled"
                  label={t('Preview')}
                  hint={t('Show the result before it is applied')}
                  checked={state.previewEnabled}
                  onChange={value => set('previewEnabled', value)}
                />
                <Button
                  variant="destructive"
                  size="lg"
                  className="flex-1"
                  disabled={!editable || !hasSelection}
                  onClick={() => request('deleteSelection')}
                  data-cy="seg-editor-remove-selection"
                >
                  {hasSelection ? t('Remove {{count}} faces', { count: number(selectionCount) }) : t('Remove faces')}
                </Button>
              </div>
            )}
        </Card>
      )}

      {action === SELECTION_ACTIONS.smooth && (
        <Card title={t('Smooth')} dataCy="seg-editor-smooth-card">
          <p className="text-muted-foreground -mt-1 text-xs">{t('Evens out the selected faces. Their edge stays in place, or eases with Soft edge.')}</p>
          <SliderRow
            id="seg-editor-smooth-strength"
            label={t('Strength')}
            hint={t('How far each pass moves a point towards its neighbours')}
            value={state.smoothStrength}
            range={SMOOTH_STRENGTH}
            disabled={!!preview && !previewingSmooth}
            onChange={value => set('smoothStrength', value)}
          />
          <SliderRow
            id="seg-editor-smooth-passes"
            label={t('Passes')}
            hint={t('How many times the pass is repeated')}
            value={state.smoothPasses}
            range={SMOOTH_PASSES}
            disabled={!!preview && !previewingSmooth}
            onChange={value => set('smoothPasses', value)}
          />
          <ToggleRow
            id="seg-editor-smooth-feather"
            label={t('Soft edge')}
            description={t('The edge of the selection eases at half strength instead of staying pinned, so the transition is not creased')}
            checked={state.smoothFeather}
            disabled={!!preview && !previewingSmooth}
            onChange={value => set('smoothFeather', value)}
          />
          {previewingSmooth
            ? previewRow(t('Preview: the smoothed surface is shown. Changing the settings updates it. Enter applies, Esc cancels.'), t('Apply'),
              'seg-editor-cancel-smooth', 'seg-editor-apply-smooth')
            : (
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                disabled={!editable || !hasSelection || busy}
                onClick={() => request('smoothSelection')}
                data-cy="seg-editor-smooth-selection"
              >
                {t('Smooth {{count}} faces', { count: number(selectionCount) })}
              </Button>
            )}
        </Card>
      )}

      {action === SELECTION_ACTIONS.repair && (
      <Card
        title={t('Repair')}
        warning={healthTone === 'warning'}
        dataCy="seg-editor-surface-card"
        action={(
          <div className="flex items-center gap-2">
            <Tip text={t('Draw the open and non-manifold edges on the model')}>
              <Label htmlFor="seg-editor-show-issues" className="text-muted-foreground cursor-pointer text-xs font-normal">{t('Show issues')}</Label>
            </Tip>
            <Switch id="seg-editor-show-issues" checked={!!state.showIssues} onCheckedChange={value => set('showIssues', value)} data-cy="seg-editor-show-issues" />
          </div>
        )}
      >
        <div className="flex items-center gap-2" data-cy="seg-editor-surface-status">
          <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${healthDot}`} />
          <span className={`min-w-0 ${healthTone === 'muted' ? 'text-muted-foreground' : ''}`}>{healthText}</span>
        </div>
        {healthCounts.length > 0 && (
          <dl className="text-muted-foreground grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
            {healthCounts.map(([label, count]) => (
              <React.Fragment key={label}>
                <dt>{t(label)}</dt>
                <dd className="text-foreground tabular-nums">{number(count)}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}
        {health?.triangles > 0 && (
          <p className="text-muted-foreground text-xs">{t('{{count}} triangles', { count: number(health.triangles) })}</p>
        )}
        {previewingRepair
          ? previewRow(t('Preview: the closed rims are shown in blue. Enter applies, Esc cancels.'), t('Apply repair'),
            'seg-editor-cancel-repair', 'seg-editor-apply-repair')
          : (
            <Tip text={t('Closes every open edge with the Closure and Advanced settings. Changes the 3D surface only.')}>
              <Button
                variant="secondary"
                className="h-8 self-start"
                disabled={!editable || !health || health.closed || busy}
                onClick={() => request('repairSurface')}
                data-cy="seg-editor-repair-surface"
              >
                {t('Repair surface')}
              </Button>
            </Tip>
          )}
      </Card>
      )}

      {(pendingWrites > 0 || (lastEdit && !preview)) && (
        <footer className="flex flex-col gap-1" data-cy="seg-editor-footer">
          {pendingWrites > 0 && (
            <p className="text-muted-foreground px-1 text-xs" role="status" data-cy="seg-editor-pending-writes">
              {t('Updating the 2D views ({{count}} pending)...', { count: pendingWrites })}
            </p>
          )}
          {lastEdit && !preview && (
            <div className="text-muted-foreground flex items-center justify-between gap-2 px-1 text-xs" data-cy="seg-editor-last-edit">
              <span className="min-w-0 flex-1 leading-snug">{t('Last edit: {{summary}}', { summary: editSummary(t, lastEdit) })}</span>
              <Tip text={t('Undo the last edit (Ctrl+Z)')}>
                <Button variant="ghost" size="icon" className="flex-none" aria-label={t('Undo')} onClick={undo} data-cy="seg-editor-undo-last-edit">
                  <Icons.Undo className="h-4 w-4" />
                </Button>
              </Tip>
            </div>
          )}
        </footer>
      )}
    </div>
  );
}

SelectionToolPanel.propTypes = {
  // THREE_D_TOOLS: which tool's card leads the panel
  tool: PropTypes.string,
};
