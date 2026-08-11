import React from 'react';
import { useTranslation } from 'react-i18next';

import { AboutContent } from '@ohif/ui';

import usePlatformVersions from '../../hooks/usePlatformVersions';
import buildPlatformRows from './platformRows';

/**
 * About panel for the Sonador platform. Adds the Sonador web application and imaging server rows
 * to `AboutContent`, which supplies the viewer and device rows itself.
 *
 * Used as both a settings tab and the account menu's About modal, so it takes no props.
 */
const AboutSonador = () => {
  const { t } = useTranslation('AboutContent');

  const {
    sonadorUrl,
    sonadorVersion,
    imagingServerUrl,
    imagingServerVersion,
    cloudPluginVersion,
    activeServer,
    isLoading,
    error,
  } = usePlatformVersions();

  const items = buildPlatformRows(
    {
      sonadorUrl,
      sonadorVersion,
      imagingServerUrl,
      imagingServerVersion,
      cloudPluginVersion,
      hasActiveServer: Boolean(activeServer),
      isLoading,
      error,
    },
    t
  );

  return <AboutContent items={items} />;
};

export { AboutSonador };
export default AboutSonador;
