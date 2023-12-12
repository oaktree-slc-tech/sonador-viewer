import { useQuery } from '@tanstack/react-query';
import { flatten, isUndefined } from 'lodash';
import moment from 'moment';

import OHIF from '@ohif/core';
import DICOMWeb from '@ohif/core/src/DICOMWeb';

const DISPLAY_TYPES = {
  'Code String': 'string',
  Date: 'date',
  Time: 'time',
  'Unique Identifier (UID)': 'string',
  'Integer String': 'string',
  'Decimal String': 'string',
  'Long Text': 'string',
  'Unsigned Short': 'string',
  'Person Name': 'string',
  'Long String': 'string',
  'Short String': 'string',
  'Sequence of Items': 'string',
  'Short Text': 'string',
  'Floating Point Double': 'string',
};

const convertValueToString = (value) => {
  if (Array.isArray(value)) {
    return value.join('\\\\');
  }

  if (moment.isMoment(value)) {
    return moment(value).format('YYYYMMDD');
  }

  return value;
};

/**
 *
 * @param {{
 *   isForce?: boolean,
 *   allFields?: string,
 *   studyDateFrom?: Date | string,
 *   studyDateTo?: Date | string,
 *   rowsPerPage: number,
 *   pageNumber: number,
 *   server: {},
 *   sort: { fieldName: string, direction: string },
 *   filters: object
 * }} params
 * @returns
 */
async function getStudyList({
  server,
  allFields = '',
  studyDateFrom = '',
  studyDateTo = '',
  sort,
  rowsPerPage,
  pageNumber,
  isForce = false,
  filters = {},
}) {
  const sortField = sort.fieldName ? { OrderBy: `${sort.direction === 'desc' ? '-' : ''}${sort.fieldName}` } : {};
  const modifiedFilters = Object.entries(filters).reduce(
    (acc, [key, value]) => ({
      ...acc,
      [key]: convertValueToString(value),
    }),
    {}
  );

  const mappedFilters = {
    allFields,
    studyDateFrom,
    studyDateTo,
    limit: rowsPerPage,
    offset: pageNumber * rowsPerPage,
    fuzzymatching: server.supportsFuzzyMatching === true,
    ...modifiedFilters,
    ...sortField,
  };

  return await OHIF.studies.searchStudies(server, mappedFilters, isForce, true);
}

/**
 * We're forced to do this because DICOMWeb does not support "AND|OR" searches
 * across multiple fields. This allows us to make multiple requests, remove
 * duplicates, and return the result set as if it were supported
 *
 * @param {{
 *   isForce?: boolean,
 *   allFields?: string,
 *   studyDateFrom?: Date,
 *   studyDateTo?: Date,
 *   rowsPerPage: number,
 *   pageNumber: number,
 *   server?: object,
 *   sort: { fieldName: string, direction: string },
 *   filters: object
 *   tags: object
 * }} params
 */

export default function useStudies(params) {
  return useQuery({
    queryKey: [
      params.isForce,
      params.server?.perms?.query,
      params.server?.token,
      params.allFields,
      params.studyDateFrom?.toLocaleString(),
      params.studyDateTo?.toLocaleString(),
      JSON.stringify(params.sort),
      params.rowsPerPage,
      params.pageNumber,
      JSON.stringify(params.filters || {}),
      JSON.stringify(params.tags || {}),
    ],
    queryFn: () => getStudyList(params),
    enabled: !!params.server?.perms?.query && !!Object.keys(params.tags || {}).length,
    select: (response) => {
      const mapped = Object.entries(params.tags || {})
        .filter(([key]) => key !== 'Instance')
        .map(([_, value]) => Object.values(value));

      const requiredTags = flatten(mapped)
        .filter((filter) => filter.vr?.name !== 'Time') // TODO remove once time data is actual to display
        .reduce((acc, { code, tag, vr, options }) => {
          const type = options ? 'string' : DISPLAY_TYPES[vr?.name];

          return {
            ...acc,
            [code?.replace(',', '').toLowerCase()]: { type, value: tag },
          };
        }, {});

      return response.map((study) => {
        const result = Object.entries(study).reduce((acc, [key, value]) => {
          const res = requiredTags[key.toLowerCase()];

          if (key === '00080061') {
            return {
              ...acc,
              modalities: {
                value: DICOMWeb.getString(DICOMWeb.getModalities(study['00080060'], study['00080061'])),
                type: 'string',
              },
            };
          }

          if (isUndefined(res?.value)) {
            return acc;
          }

          let property = Array.isArray(value.Value) ? value.Value[0] : value.Value;

          if (typeof property === 'object' && 'Alphabetic' in property) {
            property = property.Alphabetic;
          }

          return {
            ...acc,
            [res.value]: { type: res.type, value: property },
          };
        }, {});

        return result;
      });
    },
  });
}
