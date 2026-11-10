import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

import { Icon } from '@ohif/ui';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@ohif/ui-next';

import { viewName } from '../utils/inspectionCamera';

// The pane's Inspector control: a button with a help tag naming the view it opens and what the
// Inspector shows. The help tag opens on hover and on keyboard focus.
function InspectButton({ orientation, onOpen }) {
  const { t } = useTranslation('Common');
  const label = t('Open {{view}} Inspector', { view: t(viewName(orientation)) });
  // As a native button: Enter on key down, Space on key up, once per press
  const onKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (event.key === 'Enter' && !event.repeat) {
        onOpen();
      }
    }
  };
  const onKeyUp = (event) => {
    if (event.key === ' ') {
      event.preventDefault();
      onOpen();
    }
  };

  return (
    <TooltipProvider delayDuration={500}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="zoomButton" role="button" tabIndex={0} aria-label={label} data-cy="mpr-inspect-button"
            onClick={onOpen} onKeyDown={onKeyDown} onKeyUp={onKeyUp}>
            <Icon name="search-plus" width="18px" height="18px" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-xs whitespace-normal" data-cy="mpr-inspect-tooltip">
          <div className="font-semibold">{label}</div>
          <div className="mt-0.5">{t('Shows this slice full screen for measuring and annotating.')}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

InspectButton.propTypes = {
  orientation: PropTypes.string,
  onOpen: PropTypes.func.isRequired,
};


export default InspectButton;
