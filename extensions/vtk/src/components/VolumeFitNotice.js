import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import './VolumeFitNotice.css';


export function getVolumeFitNoticeKey(fit) {
  // Translation key for a pre-flight outcome, or undefined when the
  // series fits the client and nothing needs to be said.

  if (!fit || fit.fits) {
    return undefined;
  }

  switch (fit.reason) {
    case 'depth':
      return 'ReducedResolutionDepth';
    case 'budget':
      return 'ReducedResolutionBudget';
    case 'no-webgl':
      return 'NoWebGL';
    default:
      return undefined;
  }
}


const VolumeFitNotice = ({ fit }) => {
  // Persistent, dismissable notice explaining that the view is showing a reduced-resolution
  // navigation volume, and why.
  //
  // It is separate from the loading indicator because it has to outlive it: the reason the series
  // was decimated is still true after loading finishes, and an over-size volume that rendered as a
  // uniform grey field with nothing in the console is the failure this replaces.

  const { t } = useTranslation('Common');
  const [dismissed, setDismissed] = useState(false);

  const key = getVolumeFitNoticeKey(fit);

  if (!key || dismissed) {
    return null;
  }

  const decimation = fit.suggestedDecimation
    ? fit.suggestedDecimation.join(' x ')
    : undefined;

  return (
    <div className="volumeFitNotice" role="status">
      <span className="volumeFitNoticeMessage">
        {t(key)}
        {decimation && ` (${t('ReducedResolutionFactor')}: ${decimation})`}
      </span>
      <button
        type="button"
        className="volumeFitNoticeDismiss"
        onClick={() => setDismissed(true)}
        aria-label={t('Dismiss')}
      >
        &times;
      </button>
    </div>
  );
};


VolumeFitNotice.propTypes = {
  // The `assessVolumeFit` result recorded by the view
  fit: PropTypes.object,
};


export default VolumeFitNotice;
