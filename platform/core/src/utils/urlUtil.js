const _ = require('lodash');
import lib from 'query-string';

const PARAM_SEPARATOR = ';';
const PARAM_PATTERN_IDENTIFIER = ':';

function toLowerCaseFirstLetter(word) {
  return word[0].toLowerCase() + word.slice(1);
}


const getQueryFilters = (location={}, skipCaseTransform=[]) => {
  const { search } = location;

  if (!search) {
    return;
  }

  const searchParameters = parse(search);
  const filters = {};

  Object.entries(searchParameters).forEach(([key, value]) => {

    // Normalize casing, unless inidcated otherwise
    if (_.indexOf(skipCaseTransform, key) > -1) filters[key] = value
    else filters[toLowerCaseFirstLetter(key)] = value;
  });

  return filters;
};

const decode = (strToDecode = '') => {
  try {
    const decoded = window.atob(strToDecode);
    return decoded;
  } catch (e) {
    return strToDecode;
  }
};

const parse = toParse => {
  if (toParse) {
    return lib.parse(toParse);
  }

  return {};
};
const parseParam = paramStr => {
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

const isValidPath = path => {
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

export { parse, queryString, paramString };
