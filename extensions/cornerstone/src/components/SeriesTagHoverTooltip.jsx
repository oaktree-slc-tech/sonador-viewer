// Tooltip for the Series Tags drawn on a classic Cornerstone viewport. The tags are painted onto
// the canvas, so the tool records where each one was drawn and this component hit-tests the
// pointer against those regions.

import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import cornerstone from 'cornerstone-core';
import csTools from 'cornerstone-tools';
import PropTypes from 'prop-types';

import { DicomMetadataStore, displayAttributes, utils } from '@ohif/core';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@ohif/ui-next';

import { getEnabledElement } from '../state';
import TOOL_NAMES from '../tools/constants/toolNames';


export const seriesTagDetails = data => {
  if (!data) {
    return null;
  }

  const description = data.description || data.metadata?.description;
  if (!description) {
    return null;
  }

  return {
    value: data.value,
    meaning: data.text || data.metadata?.text,
    description,
    location: data.location || data.metadata?.location,
    color: displayAttributes.resolveFindingColor(TOOL_NAMES.DICOM_SR_SERIES_TAG, data),
  };
};


// Series number and modality of a tag: it is drawn on the viewport showing its series, so the
// displayed image identifies the series; the tag's own UIDs are the fallback
export const seriesIdentifiers = (element, data) => {
  let reference = {};
  try {
    const imageId = cornerstone.getEnabledElement(element)?.image?.imageId;
    const instance = imageId && DicomMetadataStore.getInstanceByImageId(imageId);
    if (instance) {
      reference = { StudyInstanceUID: instance.StudyInstanceUID, SeriesInstanceUID: instance.SeriesInstanceUID,
        SOPInstanceUID: instance.SOPInstanceUID };
    }
  } catch (err) {
    reference = {};
  }

  if (!reference.SeriesInstanceUID && data) {
    const meta = data.metadata || {};
    reference = { StudyInstanceUID: meta.StudyInstanceUID || data.StudyInstanceUID,
      SeriesInstanceUID: meta.SeriesInstanceUID || data.SeriesInstanceUID };
  }

  const identifiers = utils.referenceIdentifiers(DicomMetadataStore, reference);
  return identifiers ? { seriesNumber: identifiers.SeriesNumber, modality: identifiers.Modality } : null;
};


/**
 * Tooltip content and anchor for the tag under a client point, computed from the tool's current
 * regions and the tag's current data; null when no tag with a description is under the point.
 */
export const tooltipState = (element, point) => {
  const canvas = element && element.querySelector('canvas');
  const tool = canvas && csTools.getToolForElement(element, TOOL_NAMES.DICOM_SR_SERIES_TAG);
  if (!point || !tool || typeof tool.getTagAtCanvasPoint !== 'function') {
    return null;
  }

  // Tag regions are in canvas pixels, which differ from CSS pixels on high-density displays
  const bounds = canvas.getBoundingClientRect();
  const sx = canvas.width / (bounds.width || 1);
  const sy = canvas.height / (bounds.height || 1);
  const region = tool.getTagAtCanvasPoint(element, (point.clientX - bounds.left) * sx, (point.clientY - bounds.top) * sy);
  const details = region && seriesTagDetails(region.data);
  if (!details) {
    return null;
  }

  return {
    details,
    series: seriesIdentifiers(element, region.data),
    rect: {
      left: bounds.left + region.left / sx,
      top: bounds.top + region.top / sy,
      width: (region.right - region.left) / sx,
      height: (region.bottom - region.top) / sy,
    },
  };
};


// Cornerstone redraws (tool state, image or series changes) can change or remove the hovered tag
const REDRAW_EVENTS = [cornerstone.EVENTS.IMAGE_RENDERED, cornerstone.EVENTS.NEW_IMAGE];


function SeriesTagHoverTooltip({ viewportIndex }) {
  const [hover, setHover] = useState(null);
  const pointer = useRef(null);
  const signature = useRef(null);

  useEffect(() => {
    const element = getEnabledElement(viewportIndex);
    if (!element) {
      return undefined;
    }

    // Recomputed on every pointer move and redraw; React state changes only when the content does
    const update = () => {
      const next = tooltipState(element, pointer.current);
      const nextSignature = next ? JSON.stringify(next) : null;
      if (nextSignature !== signature.current) {
        signature.current = nextSignature;
        setHover(next);
      }
    };

    const onMouseMove = evt => {
      pointer.current = { clientX: evt.clientX, clientY: evt.clientY };
      update();
    };
    const clear = () => {
      pointer.current = null;
      update();
    };

    element.addEventListener('mousemove', onMouseMove);
    element.addEventListener('mouseleave', clear);
    element.addEventListener('wheel', clear);
    REDRAW_EVENTS.forEach(name => element.addEventListener(name, update));
    return () => {
      element.removeEventListener('mousemove', onMouseMove);
      element.removeEventListener('mouseleave', clear);
      element.removeEventListener('wheel', clear);
      REDRAW_EVENTS.forEach(name => element.removeEventListener(name, update));
    };
  }, [viewportIndex]);

  if (!hover || typeof document === 'undefined') {
    return null;
  }

  const { details, rect, series } = hover;
  const anchorStyle = { position: 'fixed', pointerEvents: 'none', ...rect };

  return ReactDOM.createPortal(
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger asChild>
          <div style={anchorStyle} aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs whitespace-normal" data-cy="series-tag-tooltip">
          <div className="flex flex-wrap gap-x-3 font-semibold">
            <span style={{ color: details.color.Value }}>{details.value}</span>
            {details.meaning && <span style={{ color: details.color.Meaning }}>{details.meaning}</span>}
          </div>
          {series && (
            <div className="mt-0.5 flex gap-x-3 text-xs opacity-80">
              {series.seriesNumber != null && <span><span className="font-black">S:</span> {series.seriesNumber}</span>}
              {series.modality && <span><span className="font-black">Modality:</span> {series.modality}</span>}
            </div>
          )}
          <div className="mt-1">{details.description}</div>
          {details.location && <div className="mt-1 opacity-80">{details.location}</div>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>,
    document.body
  );
}


SeriesTagHoverTooltip.propTypes = {
  viewportIndex: PropTypes.number.isRequired,
};


export default SeriesTagHoverTooltip;
