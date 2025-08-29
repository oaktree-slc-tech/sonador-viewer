// DICOM-SR Series Tag. Attaches a qualitative description, encoded as a finding,
// to the series.
import _ from 'lodash';

import csTools, {
  importInternal,
  getToolState,
  toolColors
} from 'cornerstone-tools';

import cornerstone from 'cornerstone-core';

import TOOL_NAMES from './constants/toolNames';


/** Cornerstone 3rd party dev kit imports */
const draw = importInternal('drawing/draw');
const drawJoinedLines = importInternal('drawing/drawJoinedLines');
const drawCircle = importInternal('drawing/drawCircle');
const drawEllipse = importInternal('drawing/drawEllipse');
const drawHandles = importInternal('drawing/drawHandles');
const drawArrow = importInternal('drawing/drawArrow');
const getNewContext = importInternal('drawing/getNewContext');
const BaseTool = importInternal('base/BaseTool');
const drawLinkedTextBox = importInternal('drawing/drawLinkedTextBox');
const textBoxWidth = importInternal('drawing/textBoxWidth');
const drawTextBox = importInternal('drawing/drawTextBox');
const drawRect = importInternal('drawing/drawRect');


export default class DICOMSRSeriesTagTool extends BaseTool {
  // DICOMSRSeriesTagTool: Attaches a qualitative description encoded as a finding to a series.
  // @extends cornerstoneTools.BaseTool

  constructor(props={}) {
    const defaultProps = {
      mixins: [],
      name: TOOL_NAMES.DICOM_SR_SERIES_TAG,
      padding: 6, windowPadding: 20, maxTextChars: 64, valHexColor: '#8AD0A8', textHexColor: '#C0C7F8',
    }

    const initialProps = Object.assign(defaultProps, props);
    super(initialProps);
  }

  renderToolData(evt) {
    // Render series tag data as a set of tags at the bottom of the canvas

    const eventData = evt.detail;
    const { element, image } = eventData;
    const { rows, columns } = image;
    
    // Retrieve tool state for the current element
    const toolState = getToolState(element, this.name);
    if (!toolState || !toolState.data || toolState.data.length == 0) {
      console.debug('[cornerstone:DICOMSRSeriesTagTool:renderToolData] unable to retrieve tool data');
      return;
    }

    // Retrieve reference to canvas and context to begin drawing
    const canvas = evt.detail.canvasContext.canvas;
    const context = getNewContext(canvas);
    if (!canvas || !context ) {
      console.debug('[cornerstone:DICOMSRSeriesTagTool:renderToolData] unable to render series tag data, invalid canvas or context');
      return;
    }

    // Canvas dimensions
    const canvasHeight = canvas.height;
    const canvasWidth = canvas.width;

    // Calculate height/width of the tags to draw
    const _tags = [];    
    const { padding, windowPadding, maxTextChars, valHexColor, textHexColor } = this.initialConfiguration;
    
    for (let i = 0; i < toolState.data.length; i++) {
      const data = toolState.data[toolState.data.length-(i+1)];
      const _visible = !_.isNil(data.visible) ? data.visible : true;

      // Do not render tags which are not visible
      if (!_visible) {
        continue;
      }

      // Calculate padding and text widths for tag value and text
      const _val = _.truncate(data.value || '', maxTextChars);
      const _text = _.truncate(data.text || '', maxTextChars);
      const valWidth = textBoxWidth(context, _val, padding);
      const textWidth = textBoxWidth(context, _text, padding);
      const width = valWidth+padding+textWidth;

      // Combine value/text into a single textbox
      _tags.push({
        value: _val, text: _text, valWidth, textWidth,
        width, height: csTools.textStyle.getFontSize()+2*padding,
      });
    }

    // Add tags to rows
    const _rows = [];
    let currentRow = [];
    let currentRowWidth = 0;
    const maxRowWidth = canvasWidth - windowPadding;

    _.each(_tags.reverse(), (_t) => {

      // Create a new row
      if (currentRowWidth + _t.width > maxRowWidth) {
        _rows.push(currentRow)
        currentRow = [];
        currentRowWidth = 0;
      }

      // Add current tag to row
      currentRow.push(_t);
      currentRowWidth += _t.width + 2*padding;
    });

    // Add current row if it contains pending tags
    if (currentRow.length > 0) {
      _rows.push(currentRow)      ;
    }

    // Render rows from bottom up    
    let canvasOffsetY = canvasHeight - (padding+windowPadding);

    _.each(_rows.reverse(), (_r) => {
      const rowWidth = _r.reduce((acc, _t) => acc + _t.width, 0) + (_r.length - 1) * padding;
      let canvasOffsetX = (canvasWidth - rowWidth) / 2;

      // Render each row instance
      _.each(_r, (_t) => {

        // Draw value, text, and bounding box for tag
        draw(context, ctx => {

          // Draw bounding box for tag
          drawRect(ctx, element,
            { x: canvasOffsetX-padding, y: canvasOffsetY-_t.height-padding/2 },
            { x: canvasOffsetX+_t.width, y: canvasOffsetY+padding/2 }, {
              color: 'white', lineWidth: 1, fill: false, dashed: false,
            }, 'canvas');

          // Draw tag value and text
          drawTextBox(ctx, _t.value, canvasOffsetX, canvasOffsetY-_t.height, valHexColor);
          drawTextBox(ctx, _t.text, canvasOffsetX+_t.valWidth, canvasOffsetY-_t.height, textHexColor);
        });

        // Move x render position
        canvasOffsetX += _t.width + 3*padding;
      });

      // Move up for next row
      canvasOffsetY -= (csTools.textStyle.getFontSize() + 4*padding + 4);
    });
  }
}