import React from 'react';
import PropTypes from 'prop-types';

import OHIF from '@ohif/core';

import formatContentItemValue from '../utils/formatContentItem';

const { SREnums } = OHIF.DICOMSR.Enums;
const { CodeNameCodeSequenceValues } = SREnums;


const EMPTY_TAG_VALUE = '[empty]';


function OHIFCornerstoneSRContentItem(props) {
  // Render SR content item data

  // Unpack SR content from properties
  const { contentItem, nodeIndexesTree, continuityOfContent } = props;
  const { ConceptNameCodeSequence } = contentItem;

  // Unpack SR values from contentItem
  const { CodeValue, CodeMeaning } = (ConceptNameCodeSequence || {});

  // Determine place and position
  const isChildFirstNode = nodeIndexesTree[nodeIndexesTree.length - 1] === 0;
  const isContinuous = continuityOfContent === 'CONTINUOUS';
  const isFinding = CodeValue === CodeNameCodeSequenceValues.Finding;

  // Format text values and styling
  const formattedValue = formatContentItemValue(contentItem) ?? EMPTY_TAG_VALUE;
  const startWithAlphaNumCharRegEx = /^[a-zA-Z0-9]/;
  const addExtraSpace =
    isContinuous && !isChildFirstNode && startWithAlphaNumCharRegEx.test(formattedValue?.[0]);

  // Collapse sequences of white space preserving newline characters
  let className = 'whitespace-pre-line';

  if (CodeValue === CodeNameCodeSequenceValues.Finding) {
    // Preserve spaces because it is common to see tabular text in a
    // "Findings" ConceptNameCodeSequence
    className = 'whitespace-pre-wrap';
  }

  if (isContinuous) {
    return (
      <>
        <span
          className={className}
          title={CodeMeaning}
        >
          {addExtraSpace ? ' ' : ''}
          {formattedValue}
        </span>
      </>
    );
  }

  return (
    <>
      <div className="mb-2">
        <span className="font-bold">{CodeMeaning}: </span>
        {isFinding ? (
          <pre>{formattedValue}</pre>
        ) : (
          <span className={className}>{formattedValue}</span>
        )}
      </div>
    </>
  );
}

OHIFCornerstoneSRContentItem.propTypes = {
  contentItem: PropTypes.object,
  nodeIndexesTree: PropTypes.arrayOf(PropTypes.number),
  continuityOfContent: PropTypes.string,
};

export { OHIFCornerstoneSRContentItem };