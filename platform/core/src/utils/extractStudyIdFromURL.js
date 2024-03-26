export const extractStudyIdFromURL = () => {
  const url = window.location.pathname;
  const params = url.split('/');

  // Generally there should be 6 params
  if (params.length > 5 && params[params.length - 2] === 'study' && params[params.length - 3] === 'viewer') {
    return params[params.length - 1];
  }

  return null;
};
