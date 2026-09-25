import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { get3DToolState, subscribe3DToolState } from '../threeDTools/threeDToolState';


/**
 * Description block of the 3D Selection tool's options (ohif-viewers#142, FR-17/FR-18): how to
 * select, and how many points of which segment are selected. The removal depth and the Remove /
 * Clear actions are ordinary tool options rendered by ToolSettings.
 */
export default function SelectionToolOptions() {
  const { t } = useTranslation('SegmentationEditor');
  const [state, setState] = useState(get3DToolState);

  useEffect(() => subscribe3DToolState(setState), []);

  const { target, selectionCount } = state;
  const segmentName = target?.label
    || (target?.segmentIndex ? t('Segment {{index}}', { index: target.segmentIndex }) : '');

  return (
    <div className="text-muted-foreground px-2 pt-1 text-xs" data-cy="seg-editor-selection-options">
      <p>
        {t('Drag to select points of the selected segment. Shift adds to the selection, Ctrl removes from it. Right-drag rotates, middle-drag pans.')}
      </p>
      {segmentName && (
        <p className="text-foreground mt-4">
          {t('{{points}} points selected on "{{segment}}"', { points: selectionCount, segment: segmentName })}
        </p>
      )}
    </div>
  );
}
