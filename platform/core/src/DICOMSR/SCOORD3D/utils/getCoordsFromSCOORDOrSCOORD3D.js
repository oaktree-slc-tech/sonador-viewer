const getCoordsFromSCOORDOrSCOORD3D = (graphicItem) => {
  // Parse DICOM-SR data types from the provided graphic

  // @input graphicItem: item which should be parsed for coordinates (SCOORD) and (SCOORD3D)

  const { ValueType, GraphicType, GraphicData } = graphicItem;
  const coords = { ValueType, GraphicType, GraphicData };

  if (ValueType === 'SCOORD') {
    const { ReferencedSOPSequence } = graphicItem.ContentSequence;
    coords.ReferencedSOPSequence = ReferencedSOPSequence;
  } else if (ValueType === 'SCOORD3D') {
    if (graphicItem.ReferencedFrameOfReferenceUID) {
      coords.ReferencedFrameOfReferenceSequence = graphicItem.ReferencedFrameOfReferenceUID;
    } else if (graphicItem.ContentSequence) {
      const { ReferencedFrameOfReferenceSequence } = graphicItem.ContentSequence;
      coords.ReferencedFrameOfReferenceSequence = ReferencedFrameOfReferenceSequence;
    }
  }

  return coords;
};


export default getCoordsFromSCOORDOrSCOORD3D;
