// Line and text colors of a measurement drawn by a cornerstone-tools tool. cornerstone-tools draws
// a measurement's line, handles and text in one color (the data's `color`, else the tool color);
// its text goes through the canvas context's `fillText`, so the text color is applied there.

import { getLineTextColor } from '@ohif/core/src/displayAttributes';


/** Stored line and text colors of cornerstone-tools tool data: { line, text }, null where none */
function lineTextColorOf(data) {
  const carrier = data && (data.displayAttributes || (data.measurementData && data.measurementData.displayAttributes)
    || (data.metadata && data.metadata.displayAttributes));
  return getLineTextColor({ displayAttributes: carrier }, data && data.toolType);
}


/** Run `draw` with the text the context fills drawn in `color` (no change without one) */
function fillingTextIn(context, color, draw) {
  if (!color) {
    return draw();
  }
  const { fillText } = context;
  context.fillText = function fillTextInColor(...args) {
    const fillStyle = this.fillStyle;
    this.fillStyle = color;
    fillText.apply(this, args);
    this.fillStyle = fillStyle;
  };
  try {
    return draw();
  } finally {
    context.fillText = fillText;
  }
}


/**
 * Draw tool data with its line color as its `color` and its text in its text color. The active
 * measurement keeps the active color. The data's own `color` is restored after.
 */
function withLineTextColor(data, context, draw) {
  if (data.active) {
    return draw();
  }
  const { line, text } = lineTextColorOf(data);
  const hadColor = Object.prototype.hasOwnProperty.call(data, 'color');
  const color = data.color;
  if (line) {
    data.color = line;
  }
  try {
    return fillingTextIn(context, text, draw);
  } finally {
    if (hadColor) {
      data.color = color;
    } else {
      delete data.color;
    }
  }
}


export { fillingTextIn, lineTextColorOf, withLineTextColor };
