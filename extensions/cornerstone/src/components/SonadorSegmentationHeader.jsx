import React, { useState, useEffect, useRef } from 'react';
import {
  Button,
  Icons,
  TooltipProvider,
  DropdownMenu, DropdownMenuTrigger,
  Tooltip, TooltipTrigger, TooltipContent,
  SegmentationTable, useSegmentationExpanded, useSegmentationTableContext, 
} from '@ohif/ui-next';


export default function SegmentationEditorHeader({ dropdownMenuContent=null, tooltipContent=null, portalContainer=null }) {
  // Header component which can be used with the Sonador Segmentation Editor

  // Retrieve segmentation contexts for use in table
  const expandedContext = useSegmentationExpanded('SegmentationHeader');

  // Use expandedContext preferentially and fall back to the tableContext if one is not selected.
  const segmentation = expandedContext?.segmentation;

  if (!segmentation) {
    return null;
  }

  return (<div className="text-foreground flex w-full items-center justify-between seg-header-container">
    
    {dropdownMenuContent && (<div className="flex items-center space-x-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon"
              className="ml-1 seg-action" onClick={e => e.stopPropagation()} >
            <Icons.More />
          </Button>
        </DropdownMenuTrigger>
        {dropdownMenuContent}
      </DropdownMenu>
    </div>)}
    
    <div className="flex items-center min-w-0">
      <div className="pl-1.5 pr-1.5 ml-2 truncate seg-label">{segmentation.label}</div>
    </div>
    
    <div className="flex items-center mr-1 ml-1">
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="seg-action">
          <Icons.Info className="h-6 w-6" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="seg-tooltip-content" container={portalContainer}>
        <p>{segmentation.label}</p>
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
    </div>
  
  </div>);
}