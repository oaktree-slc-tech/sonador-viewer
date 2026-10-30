// The Repair surface card of the 3D Tools palette (owner's reviews of 2026-10-26 and 27): Repair
// acts on the whole 3D surface of the selected segment, never on the selection, so it lives
// apart from the selection panel, as a card under the surface status block. It was a floating
// dialog first, which lagged the application; a card goes through the palette like every other
// card. Opened from the Model Actions menu, the surface status line, or by a repair preview
// starting (the handoff's Repair, whose Apply / Cancel live here); closed by its own control, a
// target change, or leaving the 3D palette. Closing it during a preview cancels the preview.
// Built from the kit (Button, Label and Switch through ToggleRow, Tooltip through Tip, the
// status Icons through StatusIcon).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { Button, Icons } from '@ohif/ui-next';

import { repairAvailability } from '../threeDTools/repairAvailability';
import {
  get3DToolState, request3DToolAction, set3DRepairPanel, set3DToolOption, subscribe3DToolState,
} from '../threeDTools/threeDToolState';
import { setPreviewColor, usePreviewColor } from '../utils/previewColor';

import { Card, ColorSwatch, StatusIcon, Tip, ToggleRow } from './panelControls';
import { surfaceStatus } from './wholeSurface';


const number = value => Number(value || 0).toLocaleString();

/** Open the Repair surface card (the Model Actions menu, the status line, a repair preview). */
export function openRepairSurface() {
  set3DRepairPanel(true);
}

/** Close the Repair surface card, cancelling a repair preview it was showing. */
export function closeRepairSurface({ getState = get3DToolState, request = request3DToolAction } = {}) {
  if (getState().repairPanel && getState().preview?.repair) {
    request('cancelPreview');
  }
  set3DRepairPanel(false);
}

export function RepairSurfaceCard({
  getState = get3DToolState, subscribe = subscribe3DToolState, request = request3DToolAction, setOption = set3DToolOption,
}) {
  const { t } = useTranslation('SegmentationEditor');
  const [state, setState] = useState(getState);
  useEffect(() => subscribe(setState), [subscribe]);
  const openedFor = useRef(state.target?.segmentIndex);
  const previewColor = usePreviewColor();

  const previewingRepair = !!state.preview?.repair;
  const repair = repairAvailability(state);
  const status = surfaceStatus(t, state);
  const { surfaceHealth: health } = state;
  const counts = health ? [
    ['Open edges', health.boundaryEdgeCount],
    ['Non-manifold edges', health.nonManifoldEdgeCount],
    ['Inverted edges', health.inconsistentEdgeCount],
    ['Degenerate triangles', health.degenerate],
    ['Duplicate triangles', health.duplicate],
  ].filter(([, count]) => count > 0) : [];

  const close = useCallback(() => closeRepairSurface({ getState, request }), [getState, request]);

  // The card is about one segment's surface: it goes when the target changes or goes away
  const segmentIndex = state.target?.segmentIndex;
  useEffect(() => {
    if (segmentIndex === undefined || segmentIndex !== openedFor.current) {
      close();
    }
  }, [segmentIndex, close]);

  return (
    <Card
      title={t('Repair surface')}
      warning={status.tone === 'warning'}
      dataCy="seg-editor-repair-card"
      action={(
        <Tip text={previewingRepair ? t('Close and discard the repair shown.') : t('Close')}>
          <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={t('Close')} onClick={close} data-cy="seg-editor-repair-close">
            <Icons.Close className="h-4 w-4" />
          </Button>
        </Tip>
      )}
    >
      <p className="text-muted-foreground -mt-1 text-xs">
        {t('Acts on the whole 3D surface of the selected segment. The selection is not used.')}
      </p>
      <Tip text={t('Open, non-manifold and inverted edge counts of the 3D surface. Zero counts mean the edges are sound; they do not prove a valid solid.')}>
        <div className="flex items-center gap-2" data-cy="seg-editor-repair-status">
          <StatusIcon tone={status.tone} />
          <span className={status.tone === 'muted' ? 'text-muted-foreground' : ''}>{status.text}</span>
        </div>
      </Tip>
      {counts.length > 0 && (
        <dl className="text-muted-foreground grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs" data-cy="seg-editor-repair-counts">
          {counts.map(([label, count]) => (
            <React.Fragment key={label}>
              <dt>{t(label)}</dt>
              <dd className="text-foreground m-0 tabular-nums">{number(count)}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      <ToggleRow
        id="seg-editor-show-issues"
        label={t('Show issues')}
        description={t('Marks open edges red, non-manifold amber and inverted edges purple on the model.')}
        checked={!!state.showIssues}
        onChange={value => setOption('showIssues', value)}
      />
      {health?.conditioning?.fellBack && (
        <p className="m-0 text-xs text-[#e8b04c]" role="status" data-cy="seg-editor-weld-fallback">
          {t('The requested weld would drop or turn over sound triangles, so the exact weld was used.')}
        </p>
      )}
      {previewingRepair ? (
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-muted-foreground m-0 text-xs" role="status">
              {t('Preview: the patches closing the rims are highlighted. Enter applies, Esc cancels.')}
            </p>
            <ColorSwatch
              id="seg-editor-apply-repair-color"
              label={t('Preview colour')}
              hint={t('The colour an edit awaiting Apply is drawn in. Also in Settings > General > Segmentation Editor.')}
              value={previewColor}
              onChange={setPreviewColor}
            />
          </div>
          <div className="flex gap-2">
            <Tip text={t('Cancel')} detail={t('Discard the repair shown. The surface is unchanged.')}>
              <Button variant="secondary" size="lg" className="flex-1" onClick={() => request('cancelPreview')} data-cy="seg-editor-cancel-repair">
                {t('Cancel')}
              </Button>
            </Tip>
            <Tip text={t('Apply repair')} detail={t('Apply the repair to the 3D surface. The 2D slices are updated when you synchronize.')}>
              <Button size="lg" className="flex-1" onClick={() => request('applyPreview')} data-cy="seg-editor-apply-repair">
                {t('Apply repair')}
              </Button>
            </Tip>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 pt-1">
          {!repair.enabled && (
            <p className="text-muted-foreground m-0 text-xs" role="status" data-cy="seg-editor-repair-reason" data-repair-reason={repair.reason}>
              {t(repair.message, repair.values)}
            </p>
          )}
          <Tip text={t('Repair surface')} detail={t(repair.message, repair.values)}>
            <span className="flex" data-cy="seg-editor-repair-surface-tip" data-repair-reason={repair.reason}>
              <Button size="lg" className="w-full" disabled={!repair.enabled} onClick={() => request('repairSurface')} data-cy="seg-editor-repair-surface">
                {t('Repair surface')}
              </Button>
            </span>
          </Tip>
        </div>
      )}
    </Card>
  );
}

RepairSurfaceCard.propTypes = {
  getState: PropTypes.func,
  subscribe: PropTypes.func,
  request: PropTypes.func,
  setOption: PropTypes.func,
};

export default RepairSurfaceCard;
