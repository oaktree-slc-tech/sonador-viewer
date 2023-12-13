const sonadorUrl = (resource) => {
  // Create a fully qualified domain resource (FQDN) URL for the provided path. If the URL
  // is a relative URL, it will be combined with the Sonador connection host (taken from the)
  // global window variable to transform it to a complete URL.

  // @returns URL

  // Ensure that window.sonador.host is defined
  if (!window || !window.sonador || !window.sonador.host) {
    throw new Error('Unable to retrieve Sonador host, window.sonador.host is not defined.');
  }

  return new URL(resource, window.sonador.host);
};

export { sonadorUrl };
