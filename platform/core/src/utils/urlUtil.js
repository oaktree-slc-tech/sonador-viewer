import lib from 'query-string';
const _ = require('lodash');

const PARAM_SEPARATOR = ';';
const PARAM_PATTERN_IDENTIFIER = ':';


function toLowerCaseFirstLetter(word) {
  return word[0].toLowerCase() + word.slice(1);
}


const getQueryFilters = (location = {}, skipCaseTransform = []) => {
  // Retrieve the query filters from the location string
  const { search } = location;
  if (!search) {
    return;
  }

  const searchParameters = parse(search);
  const filters = {};

  Object.entries(searchParameters).forEach(([key, value]) => {
    // Normalize casing, unless inidcated otherwise
    if (_.indexOf(skipCaseTransform, key) > -1) filters[key] = value;
    else filters[toLowerCaseFirstLetter(key)] = value;
  });

  return filters;
};


const decode = (strToDecode = '') => {
  // Decode URL components
  try {
    const decoded = window.atob(strToDecode);
    return decoded;
  } catch (e) {
    return strToDecode;
  }
};


const parse = (toParse) => {
  // Parse URL to components

  if (toParse) {
    return lib.parse(toParse);
  }

  return {};
};


const parseParam = (paramStr) => {
  const _paramDecoded = decode(paramStr);
  if (_paramDecoded && typeof _paramDecoded === 'string') {
    return _paramDecoded.split(PARAM_SEPARATOR);
  }
};


const replaceParam = (path = '', paramKey, paramValue) => {
  const paramPattern = `${PARAM_PATTERN_IDENTIFIER}${paramKey}`;
  if (paramValue) {
    return path.replace(paramPattern, paramValue);
  }

  return path;
};


const isValidPath = (path) => {
  const paramPatternPiece = `/${PARAM_PATTERN_IDENTIFIER}`;
  return path.indexOf(paramPatternPiece) < 0;
};

const queryString = {
  getQueryFilters,
};


const paramString = {
  isValidPath,
  parseParam,
  replaceParam,
};


const urlJoin = (...args) =>
  args
    .join('/')
    .replace(/[\/]+/g, '/')
    .replace(/^(.+):\//, '$1://')
    .replace(/^file:/, 'file:/')
    .replace(/\/(\?|&|#[^!])/g, '$1')
    .replace(/\?/g, '&')
    .replace('&', '?');


function getRootUrl(url) {
  // Parse the provided URL to components and return the "root" URL including
  // scheme, hostname, and port.

  // @input url (str): URL to be parsed
  // @returns object
  //  - rootUrl (str): full root URL composed from components
  //  - parsedUrl (object): URL object

  const _url = new URL(url);
  const rootUrl = `${_url.protocol}//${_url.hostname}${_url.port ? `:${_url.port}` : ''}`;

  return { rootUrl, parsedUrl: _url }
}


function buildUrl(base, path, query) {
  // Create a FQDN from the provided base, path, and query parameters.

  // Create URL from base and path
  const url = new URL(path, base);
  if (query) {

    // Add query parameters
    Object.entries(query).forEach(([k, v]) => url.searchParams.append(k, v));  
  }
  
  return url.toString();
}


function buildInstanceWadoRsUri(server, StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID) {
  // Create a Wado-RS URI from a server instance and DICOM identifiers
  return `${server.wadoRoot}/studies/${StudyInstanceUID}/series/${SeriesInstanceUID}/instances/${SOPInstanceUID}`;
}


export { parse, queryString, paramString, buildUrl, urlJoin, getRootUrl, buildInstanceWadoRsUri };
