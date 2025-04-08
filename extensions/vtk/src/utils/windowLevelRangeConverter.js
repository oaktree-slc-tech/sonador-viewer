import _ from 'lodash';


export function toWindowLevel(low, high) {
  // Convert the provided low and high range values to a window width and center

  const windowWidth = Math.abs(low - high);
  const windowCenter = low + windowWidth / 2;

  return { windowWidth, windowCenter };
}


export function toLowHighRange(windowWidth, windowCenter) {
  // Convert the provided window width and window center to the high/low rnge

  const lower = windowCenter - windowWidth / 2.0;
  const upper = windowCenter + windowWidth / 2.0;

  return { lower, upper };
}


export function getWindowLevel(volumeActor, options) {
  // Retrieve the window level for the provided volume
  options = options || {};
  _.defaults(options, { index: 0 });

  // Retrieve currently active range
  const range = volumeActor
    .getProperty()
    .getRGBTransferFunction(options.index)
    .getMappingRange()
    .slice();

  return toWindowLevel(...range);
}
