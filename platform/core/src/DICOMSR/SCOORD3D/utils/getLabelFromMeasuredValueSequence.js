import { codeValueOf, firstItem } from '../../utils/codedConcept';

const getLabelFromMeasuredValueSequence = (ConceptNameCodeSequence, MeasuredValueSequence) => {
  const { CodeMeaning } = firstItem(ConceptNameCodeSequence) || {};
  const { NumericValue, MeasurementUnitsCodeSequence } = firstItem(MeasuredValueSequence) || {};
  const CodeValue = codeValueOf(firstItem(MeasurementUnitsCodeSequence));

  const formatedNumericValue = NumericValue ? Number(NumericValue).toFixed(1) : '';

  return {
    label: CodeMeaning,
    value: `${formatedNumericValue} ${CodeValue}`,
  }; // E.g. Long Axis: 31.0 mm
};

export default getLabelFromMeasuredValueSequence;
