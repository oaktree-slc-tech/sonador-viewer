import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';

import { cn } from '../../lib/utils';


// Sonador: one thumb per value, so a range (`value={[low, high]}`) can be dragged at both ends.
// Radix renders thumbs only as the children it is given; a single-value slider keeps its one.
// `thumbProps` reaches each thumb, the element that takes focus and carries the slider role, so a
// caller can name and describe it (aria-label, aria-describedby).
type SliderProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
  thumbProps?: React.ComponentPropsWithoutRef<typeof SliderPrimitive.Thumb>;
};

const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  ({ className, thumbProps, ...props }, ref) => {
  const thumbs = Math.max(1, (props.value ?? props.defaultValue ?? [0]).length);
  return (
    <SliderPrimitive.Root
      ref={ref}
      className={cn('relative flex w-full touch-none select-none items-center', className)}
      {...props}
    >
      <SliderPrimitive.Track className="bg-primary/30 relative h-1 w-full grow overflow-hidden rounded-full">
        <SliderPrimitive.Range className="bg-primary absolute h-full" />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbs }, (_, index) => (
        <SliderPrimitive.Thumb
          {...thumbProps}
          key={index}
          className="border-background bg-primary focus-visible:ring-ring block h-4 w-4 rounded-full border-2 shadow transition-colors focus-visible:outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  );
  }
);
Slider.displayName = SliderPrimitive.Root.displayName;


export { Slider };
