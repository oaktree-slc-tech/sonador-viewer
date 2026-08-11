/**
 * Build the "Sonador Platform" rows of the About table.
 *
 * Kept pure and separate from the component so the row content -- which values share a row, and
 * what each says when a value is missing -- can be tested without a renderer.
 *
 * @param {Object} versions Resolved values from `usePlatformVersions`.
 * @param {Function} [t] Translation function; defaults to identity.
 * @returns {Array<Object>} Rows in `AboutContent`'s `items` shape.
 */
export default function buildPlatformRows(versions = {}, t = (text) => text) {
  const {
    sonadorUrl,
    sonadorVersion,
    imagingServerUrl,
    imagingServerVersion,
    cloudPluginVersion,
    hasActiveServer,
    isLoading,
    error,
  } = versions;

  const notReported = t('Not reported');
  const noServer = t('No active imaging server');

  // Lower case: appears mid-sentence, inside the combined imaging server value.
  const missing = t('not reported');

  const imagingServerValue = () => {
    if (!hasActiveServer) {
      return noServer;
    }

    if (isLoading) {
      return t('Loading…');
    }

    if (error) {
      return t('Unavailable');
    }

    // Both named, always: a stock Orthanc with no Sonador plugin has to stay distinguishable from
    // one whose plugin did not answer. Separate segments so the renderer can space them apart.
    return [
      `Orthanc ${imagingServerVersion || missing}`,
      `Sonador Cloud Plugin ${cloudPluginVersion || missing}`,
    ];
  };

  return [
    {
      name: t('Sonador Web Application'),
      value: sonadorVersion || notReported,
      detail: sonadorUrl || notReported,
      detailLink: sonadorUrl,
    },
    {
      name: t('Imaging Server'),
      value: imagingServerValue(),
      // From the server list rather than the system report, so it survives a server that could not
      // be reached. With no server there is no address to give.
      detail: hasActiveServer ? imagingServerUrl || notReported : undefined,
      detailLink: imagingServerUrl,
    },
  ];
}

export { buildPlatformRows };
