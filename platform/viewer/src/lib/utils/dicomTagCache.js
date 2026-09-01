// Shape the imaging server's DICOM tag cache (`/cache/dcm-tags`) into the map the study list reads.
//
// Extracted from useTags so it can be tested without react-query: it is the single point at which
// every attribute label on the study list is decided, and the only place labels are normalised.

import { uniqBy } from 'lodash';

import { dicomTagLabel } from './dicomTagLabel';

/**
 * @param {object} data raw response: `{ [resourceLevel]: { [code]: tagDefinition } }`
 * @returns {object} the same grouping, de-duplicated on tag code, with normalised labels
 */
export function normalizeTagCache(data) {
  const allTagsList = Object.entries(data || {}).reduce((acc, [tagType, tags]) => {
    const mappedTags = Object.values(tags || {}).map(tag => ({ ...tag, tagType }));

    return [...acc, ...mappedTags];
  }, []);

  // One definition per tag code, even when the same attribute appears at several resource levels.
  const uniqueTagList = uniqBy(allTagsList, tag => tag.code);

  return uniqueTagList.reduce((acc, tag) => {
    const prevValues = acc[tag.tagType] || {};
    const { tagType, ...values } = tag;

    acc[tagType] = {
      ...prevValues,
      [tag.code]: { ...values, label: dicomTagLabel(values.tag, values.label) },
    };

    return acc;
  }, {});
}

export default normalizeTagCache;
