import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { useSystem } from '@ohif/core';
import { Button, Icons, Label, Switch } from '@ohif/ui-next';

import { editSummary } from '../threeDTools/editSummary';
import { repairAvailability } from '../threeDTools/repairAvailability';
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
  WELD_FRACTION,
} from '../threeDTools/threeDToolState';
import { SEG_EDITOR_COMMAND_CONTEXT } from '../toolbox/constants';
import { setPreviewColor, usePreviewColor } from '../utils/previewColor';
import { isDeveloperToolsEnabled } from '../utils/segEditorDeveloper';
import { GENERIC_UNIT_HINT, LENGTH_UNITS, useSegEditorUnits } from '../utils/segEditorUnits';

import { AdvancedField, Card, ColorSwatch, SegmentedRow, SliderRow, Tip, ToggleRow } from './panelControls';


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

// Advanced removal settings, as counts. The weld is a developer setting (ohif-viewers#149 FR-1,
// #151 FR-4): a fraction of the surface's first-percentile edge length, shown with the developer
// tools only, exact otherwise.
const ADVANCED = [
  { key: 'maxConstraints', label: 'Patch constraints', unit: 'pts', unitHint: 'Boundary points; at most 8, two fits per hole', step: 1 },
  { key: 'islandMaxTriangles', label: 'Drop islands under', unit: 'tris', unitHint: 'Triangles', step: 1 },
];
const WELD_FIELD = {
  key: 'weldFraction', label: 'Weld', unit: '× p1', step: WELD_FRACTION.step,
  unitHint: 'A fraction of the surface\'s first-percentile edge length, at most 0.1; 0 welds exact duplicates only. A weld that would drop or turn over sound triangles is not applied.',
};

export default function SelectionToolPanel({ tool = THREE_D_TOOLS.Lasso }) {
  const { t } = useTranslation('SegmentationEditor');
  const { commandsManager } = useSystem();
  const [state, setState] = useState(get3DToolState);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const developer = isDeveloperToolsEnabled();

  useEffect(() => subscribe3DToolState(setState), []);

  // Lengths are in the reference series' patient units: mm, or the grid's steps without spacing
  const units = useSegEditorUnits();
  const lengthUnit = t(units.length);
  const lengthHint = units.length === LENGTH_UNITS.generic ? t(GENERIC_UNIT_HINT) : undefined;
  const segments = key => SEGMENTS[key].map(value => ({ value, label: t(SEGMENT_LABELS[value]) }));

  // The colour a pending edit's changed faces are drawn in (a user preference, also on the
  // Settings page's Seg Editor section)
  const previewColor = usePreviewColor();
  const previewSwatch = id => (
    <ColorSwatch
      id={id}
      label={t('Preview colour')}
      hint={t('The colour an edit awaiting Apply is drawn in. Also in Settings > General > Seg Editor.')}
      value={previewColor}
      onChange={setPreviewColor}
    />
  );

  const {
    target, selectionCount, selectionPoints, selectionRegions, preview, surfaceHealth, lastEdit,
    pendingWrites, unsynchronizedEdits = 0, busy,
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
      <div className="flex items-start justify-between gap-2">
        <p className="text-muted-foreground text-xs" role="status">{note}</p>
        {previewSwatch(`${applyCy}-color`)}
      </div>
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
    ['Inverted edges', health.inconsistentEdgeCount],
    ['Degenerate triangles', health.degenerate],
    ['Duplicate triangles', health.duplicate],
  ].filter(([, count]) => count > 0) : [];
  const healthText = !hasTarget && !health
    ? t('Select a segment to check its surface')
    : healthTone === 'muted' ? t('Checking the surface...')
      : healthTone === 'ok' ? t('Surface is closed') : t('Surface has issues');
  const healthDot = healthTone === 'ok' ? 'bg-customgreen-100' : healthTone === 'warning' ? 'bg-[#e8b04c]' : 'bg-muted-foreground/50';
  // Repair is offered for any diagnosed edge issue; the reason it is not is shown on hover
  const repair = repairAvailability(state);
  const repairTip = t(repair.message, repair.values);
  const weldFellBack = !!health?.conditioning?.fellBack;
  const advancedFields = developer ? [ADVANCED[0], WELD_FIELD, ADVANCED[1]] : ADVANCED;
  const advancedSummary = developer
    ? t('Advanced: {{constraints}} patch constraints, weld {{weld}} × p1, islands under {{island}} tris', {
      constraints: state.maxConstraints, weld: state.weldFraction, island: state.islandMaxTriangles,
    })
    : t('Advanced: {{constraints}} patch constraints, islands under {{island}} tris', {
      constraints: state.maxConstraints, island: state.islandMaxTriangles,
    });

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
              items={segments('paintMode')}
              disabled={!!preview}
              onChange={value => set('paintMode', value)}
            />
            <SliderRow
              id="seg-editor-paint-radius"
              label={t('Brush size')}
              hint={t('Radius of the brush')}
              unit={lengthUnit}
              unitHint={lengthHint}
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
              items={segments('lassoShape')}
              disabled={!!preview}
              onChange={value => set('lassoShape', value)}
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
                  <>
                    <span className="flex items-center gap-1.5" data-cy="seg-editor-repair-hover-status">
                      <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${healthDot}`} />
                      <span>
                        {healthText}
                        {health?.triangles > 0 && `, ${t('{{count}} triangles', { count: number(health.triangles) })}`}
                      </span>
                    </span>
                    <span data-cy="seg-editor-repair-hover-reason">{repairTip}</span>
                  </>
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
            items={segments('closure')}
            disabled={!!preview}
            onChange={value => set('closure', value)}
          />
          <SegmentedRow
            id="seg-editor-rim-cleanup"
            label={t('Rim cleanup')}
            hint={t('Loose triangles and small islands are removed along the cut before the hole is filled')}
            value={state.rimCleanup}
            items={segments('rimCleanup')}
            disabled={!!preview}
            onChange={value => set('rimCleanup', value)}
          />
          <SliderRow
            id="seg-editor-depth"
            label={t('Depth')}
            hint={t("Also removes the segment's voxels within this distance of the removed points in the 2D views")}
            unit={lengthUnit}
            unitHint={lengthHint}
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
              {advancedOpen ? t('Advanced') : advancedSummary}
            </span>
          </button>
          {advancedOpen && (
            <div className="border-input/60 flex flex-col gap-2 border-l-2 pl-3">
              {advancedFields.map(({ key, label, unit, unitHint, step }) => (
                <AdvancedField
                  key={key}
                  id={`seg-editor-advanced-${key}`}
                  label={t(label)}
                  unit={t(unit)}
                  unitHint={t(unitHint)}
                  step={step}
                  value={state[key]}
                  range={EDIT_SETTINGS[key]}
                  disabled={!!preview}
                  onChange={value => set(key, value)}
                />
              ))}
              {developer && health?.edges?.p1 > 0 && (
                <p className="text-muted-foreground text-xs" data-cy="seg-editor-edge-statistics">
                  {t('Edge lengths: p1 {{p1}}, median {{p50}} {{unit}}{{sampled}}', {
                    p1: health.edges.p1.toPrecision(3), p50: health.edges.p50.toPrecision(3), unit: lengthUnit,
                    sampled: health.edges.sampled ? ` (${t('sample of {{count}}', { count: number(health.edges.sampleSize) })})` : '',
                  })}
                  {state.weldFraction > 0 && ` · ${t('weld {{tolerance}} {{unit}}', { tolerance: (health.weldTolerance || 0).toPrecision(3), unit: lengthUnit })}`}
                </p>
              )}
            </div>
          )}
          {previewingRemoval
            ? previewRow(t('Preview: the new patches are highlighted. Enter applies, Esc cancels.'), t('Apply'),
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
                {previewSwatch('seg-editor-preview-color')}
                {/* The counts are in the tip so the label fits beside the toggle and the swatch.
                    The tip hangs on a wrapper: a disabled button takes no pointer events. */}
                <Tip
                  text={hasSelection
                    ? t('Removes {{faces}} faces, {{points}} points, in {{regions}} region(s)', {
                      faces: number(selectionCount), points: number(selectionPoints), regions: selectionRegions,
                    })
                    : t('Select faces to remove')}
                >
                  <span className="flex min-w-0 flex-1" data-cy="seg-editor-remove-selection-tip">
                    <Button
                      variant="destructive"
                      size="lg"
                      className="w-full"
                      disabled={!editable || !hasSelection}
                      onClick={() => request('deleteSelection')}
                      data-cy="seg-editor-remove-selection"
                    >
                      {t('Remove')}
                    </Button>
                  </span>
                </Tip>
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
            ? previewRow(t('Preview: the smoothed faces are highlighted. Changing the settings updates them. Enter applies, Esc cancels.'), t('Apply'),
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
        <Tip text={t('Open, non-manifold and inverted edge counts of the 3D surface. Zero counts mean the edges are sound; they do not prove a valid solid.')}>
          <div className="flex items-center gap-2" data-cy="seg-editor-surface-status">
            <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${healthDot}`} />
            <span className={`min-w-0 ${healthTone === 'muted' ? 'text-muted-foreground' : ''}`}>{healthText}</span>
          </div>
        </Tip>
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
        {state.showIssues && (
          <p className="text-muted-foreground text-xs" data-cy="seg-editor-issues-legend">
            {t('On the model: open edges red, non-manifold edges amber, inverted edges purple.')}
          </p>
        )}
        {weldFellBack && (
          <p className="text-xs text-[#e8b04c]" role="status" data-cy="seg-editor-weld-fallback">
            {t('The requested weld would drop or turn over sound triangles, so the exact weld was used.')}
          </p>
        )}
        {previewingRepair
          ? previewRow(t('Preview: the patches closing the rims are highlighted. Enter applies, Esc cancels.'), t('Apply repair'),
            'seg-editor-cancel-repair', 'seg-editor-apply-repair')
          : (
            <Tip text={repairTip}>
              <span className="self-start" data-cy="seg-editor-repair-surface-tip" data-repair-reason={repair.reason}>
                <Button
                  variant="secondary"
                  className="h-8"
                  disabled={!repair.enabled}
                  onClick={() => request('repairSurface')}
                  data-cy="seg-editor-repair-surface"
                >
                  {t('Repair surface')}
                </Button>
              </span>
            </Tip>
          )}
      </Card>
      )}

      {(pendingWrites > 0 || unsynchronizedEdits > 0 || (lastEdit && !preview)) && (
        <footer className="flex flex-col gap-1" data-cy="seg-editor-footer">
          {pendingWrites > 0 && (
            <p className="text-muted-foreground px-1 text-xs" role="status" data-cy="seg-editor-pending-writes">
              {t('Updating the 2D views ({{count}} pending)...', { count: pendingWrites })}
            </p>
          )}
          {unsynchronizedEdits > 0 && (
            <p className="px-1 text-xs text-[#e8b04c]" role="status" data-cy="seg-editor-unsynchronized">
              {t('3D surface ahead of the 2D views: {{count}} edit(s) not written. Further edits stay on the surface; Undo brings the views back together.', { count: unsynchronizedEdits })}
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
