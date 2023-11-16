/* Update the full path of the OHIF instance below */
window.sonador = {
  host: 'http://imaging99.oak-tree.us:8070/',
  api: {
    config: 'ohif/config?type=app',
    pacs: 'visionaire/api/pacs?output-type=ohif',
  },
  home: {
    message: 'Your user account is not registered for any imaging servers. Please contact your system administrator.',
  },
};
