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

export { parse, queryString, paramString, urlJoin };
