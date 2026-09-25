import React from 'react';
import PropTypes from 'prop-types';

import { useToolbar } from '@ohif/core';
import { ToolbarButton } from '@ohif/ui';

import { SECTIONS } from '../toolbox/constants';


// Icons of the viewer's top toolbar (@ohif/ui), matching the Cornerstone toolbar's buttons
const TOP_TOOLBAR_ICONS = {
  WindowLevel: 'level',
  Zoom: 'search-plus',
  Pan: 'arrows',
  SegEditorUndo: 'undo',
  SegEditorRedo: 'redo',
};


function SegEditorImagingToolButtons({ button }) {
  // Window/Level, Zoom and Pan for the editor's 2D views, then Undo / Redo (ohif-viewers#142).
  // State and clicks go through the ToolbarService, so the imaging tools share one primary
  // binding with the Labelmap palette: choosing one releases any labelmap tool, and choosing a
  // labelmap tool clears them.

  const { toolbarButtons, onInteraction } = useToolbar({ buttonSection: SECTIONS.imagingTools });

  return (
    <>
      {toolbarButtons.map(({ id, componentProps }) => (
        <ToolbarButton
          key={`${button.id}-${id}`}
          id={id}
          label={componentProps.label}
          icon={TOP_TOOLBAR_ICONS[id] ?? componentProps.icon}
          isActive={!!componentProps.isActive}
          onClick={evt => {
            if (!componentProps.disabled) {
              onInteraction({ itemId: id, event: evt });
            }
          }}
        />
      ))}
    </>
  );
}


SegEditorImagingToolButtons.propTypes = {
  button: PropTypes.object.isRequired,
};

export default SegEditorImagingToolButtons;
