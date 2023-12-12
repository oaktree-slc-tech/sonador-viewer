import React from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from './../../elements/Icon';

function StudyListLoadingText() {
  const { t } = useTranslation('StudyListLoadingText');

  return (
    <div className="loading-text">
      {t('Loading')}... <Icon name="circle-notch" animation="pulse" />
    </div>
  );
}

export { StudyListLoadingText };
