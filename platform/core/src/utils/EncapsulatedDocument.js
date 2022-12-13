import _ from 'lodash';

export default function createEncapsulatedDocumentFileUrl(
  dataSet,
  byteArray,
  options
) {
  // Unpack the encpasulated document data from the provided dataset and byteArray.
  options = options || {};
  let documentByteArray;

  if (dataSet) {
    const fileTag = dataSet.elements.x00420011;
    const offset = fileTag.dataOffset;
    const remainder = offset + fileTag.length;

    documentByteArray = dataSet.byteArray.slice(offset, remainder);
  }

  const blob = new Blob([documentByteArray], {
    // Mimetype of the file: prefer the mimetype specified in the options
    type:
      options.mimetype || (dataSet ? dataSet.string('x00420012') : undefined),
  });
  return URL.createObjectURL(blob);
}
