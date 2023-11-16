import React from 'react';

// TODO: useTranslation
import { withTranslation } from '../../contextProviders';

import { Icon } from './../../elements/Icon';

function StudyListLoadingText({ t: translate }) {
  return (
    <div className="loading-text">
      {translate('Loading')}... <Icon name="circle-notch" animation="pulse" />
    </div>
  );
}

const connectedComponent = withTranslation('StudyListLoadingText')(StudyListLoadingText);

export { connectedComponent as StudyListLoadingText };
