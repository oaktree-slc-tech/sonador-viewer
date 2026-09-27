import React, { useState } from 'react';
import PropTypes from 'prop-types';

import { Button, Icons, Popover, PopoverContent, PopoverPortal, PopoverTrigger } from '@ohif/ui-next';

import { VIEW_ORIENTATIONS } from '../utils/viewOrientations';


function ViewOrientationMenu({ orientations = VIEW_ORIENTATIONS, onSelect, t = key => key, align = 'start', side = 'bottom' }) {
  // Quick-orientation menu for a 3D view, after OHIF v3's viewport orientation menu: a popover
  // listing preset directions. Choosing one turns the view's camera to that direction and fits
  // the contents to the view (the caller's `onSelect(orientationId)` does the turning).

  const [open, setOpen] = useState(false);

  // The viewer loads no Tailwind preflight, so a bare <button> keeps the browser's light chrome;
  // both buttons reset it explicitly (the ui-next ghost variant sets neither background nor border)
  const resetButton = 'appearance-none border-0 bg-transparent cursor-pointer';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={resetButton + ' hover:bg-accent text-primary h-8 w-8 rounded p-0'}
          aria-label={t('Orientation')}
          title={t('Orientation')}
        >
          <Icons.OrientationSwitch className="h-6 w-6" />
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent className="w-[130px] flex-col rounded p-1" align={align} side={side}>
          {orientations.map(orientation => (
            <Button
              key={orientation.id}
              variant="ghost"
              className={resetButton + ' text-foreground hover:bg-accent flex h-7 w-full flex-shrink-0 items-center justify-start self-stretch px-2 py-0'}
              onClick={() => {
                setOpen(false);
                onSelect(orientation.id);
              }}
            >
              <div className="flex-1 text-left">{t(orientation.label)}</div>
            </Button>
          ))}
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}


ViewOrientationMenu.propTypes = {
  orientations: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
  })),
  // (orientationId) => void
  onSelect: PropTypes.func.isRequired,
  // i18n (Common namespace: Orientation, Top, Bottom, Front, Back)
  t: PropTypes.func,
  align: PropTypes.string,
  side: PropTypes.string,
};

export default ViewOrientationMenu;
