import React from 'react';
import { Label } from '../Label';
import { Tabs, TabsList, TabsTrigger } from '../Tabs';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '../Tooltip';

interface RadioValue {
  value: string;
  label: string;
}

interface RadioOption {
  id: string;
  name: string;
  value: string;
  values: RadioValue[];
  onChange?: (val: string) => void;
  tooltip?: string;
}

interface RowSegmentedControlProps {
  option: RadioOption;
  className?: string;
  onChange?: (val: string) => void;
}

export const RowSegmentedControl: React.FC<RowSegmentedControlProps> = ({
  option,
  className,
  onChange,
}) => {
  const handleValueChange = (newVal: string) => {
    if (onChange) {
      onChange(newVal);
    }
  };

  return (
    <div
      className={cn('flex items-center justify-between text-[13px]', className)}
      key={option.id}
    >
      {/* Sonador: label styled as the segmentation panel's display settings */}
      <Label className="text-muted-foreground mr-2 whitespace-nowrap text-xs">
        {option.tooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help">{option.name}</span>
            </TooltipTrigger>
            <TooltipContent side="top">{option.tooltip}</TooltipContent>
          </Tooltip>
        ) : (
          option.name
        )}
      </Label>
      <div className="max-w-1/2">
        <Tabs
          value={option.value}
          onValueChange={handleValueChange}
        >
          <TabsList className="inline-flex space-x-1">
            {option.values.map(({ label, value: itemValue }, index) => (
              <TabsTrigger
                value={itemValue}
                key={`button-${option.id}-${index}`}
                className="text-xs" /* Sonador: the segmentation panel's type size */
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
};

export default RowSegmentedControl;
