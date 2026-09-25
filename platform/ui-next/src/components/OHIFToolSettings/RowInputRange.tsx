import React from 'react';
import Numeric from '../Numeric';
import { cn } from '../../lib/utils';

interface RowInputRangeProps {
  value: number;
  onChange: (newValue: number) => void;
  minValue?: number;
  maxValue?: number;
  step?: number;
  label?: string;
  showLabel?: boolean;
  labelPosition?: 'left' | 'right';
  allowNumberEdit?: boolean;
  showNumberInput?: boolean;
  className?: string;
  containerClassName?: string;
  inputClassName?: string; // Sonador: forwarded to the number input (see below)
}

const RowInputRange: React.FC<RowInputRangeProps> = ({
  value,
  onChange,
  minValue = 0,
  maxValue = 100,
  step = 1,
  label = '',
  showLabel = false,
  labelPosition = 'right',
  allowNumberEdit = false,
  showNumberInput = true,
  className,
  containerClassName,
  inputClassName,
}) => {
  const handleChange = (newValue: number | [number, number]) => {
    if (typeof newValue === 'number') {
      onChange(newValue);
    } else {
      onChange(newValue[0]);
    }
  };

  const content = (
    <Numeric.Container
      mode="singleRange"
      value={value}
      onChange={handleChange}
      min={minValue}
      max={maxValue}
      step={step}
      className={cn('flex flex-row items-center space-x-2', className)}
    >
      {showLabel && label && labelPosition === 'left' && (
        <Numeric.Label showValue={showNumberInput}>{label}</Numeric.Label>
      )}
      {/* Sonador: forward inputClassName (v3's ToolSettings passes it, but v3's RowInputRange drops it) */}
      <Numeric.SingleRange
        showNumberInput={allowNumberEdit && showNumberInput}
        numberInputClassName={inputClassName}
      />
      {showLabel && label && labelPosition === 'right' && (
        <Numeric.Label showValue={showNumberInput}>{label}</Numeric.Label>
      )}
    </Numeric.Container>
  );

  return containerClassName ? <div className={containerClassName}>{content}</div> : content;
};

export default RowInputRange;
