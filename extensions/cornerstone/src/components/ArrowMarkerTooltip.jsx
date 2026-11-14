// The label of the arrow marker under the pointer (utils/arrowMarkers), in any classic or
// Cornerstone3D view. One tooltip serves every view: it is mounted once, on the page's body.

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@ohif/ui-next';

import { subscribeArrowMarkerHover } from '../utils/arrowMarkers';


function ArrowMarkerTooltip() {
  const [hover, setHover] = useState(null);
  useEffect(() => subscribeArrowMarkerHover(setHover), []);

  if (!hover) {
    return null;
  }

  return (
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger asChild>
          <div style={{ position: 'fixed', pointerEvents: 'none', ...hover.rect }} aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs whitespace-normal" data-cy="arrow-marker-tooltip">
          {hover.label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

let mounted = false;

/** Mount the arrow marker tooltip on the page, once */
function ensureArrowMarkerTooltip() {
  if (mounted || typeof document === 'undefined') {
    return;
  }
  mounted = true;
  const host = document.createElement('div');
  host.setAttribute('data-arrow-marker-tooltip', '');
  document.body.appendChild(host);
  createRoot(host).render(<ArrowMarkerTooltip />);
}


export default ArrowMarkerTooltip;
export { ArrowMarkerTooltip, ensureArrowMarkerTooltip };
