// The Series Tag tool draws each tag with its resolved display colors and records where it was
// drawn so hover lookups can find it.

const mockDrawing = {
  drawRect: jest.fn(),
  drawTextBox: jest.fn(),
};

jest.mock('cornerstone-tools', () => {
  class BaseTool {
    constructor(props) {
      this.name = props.name;
      this.initialConfiguration = props;
    }
  }
  const internals = {
    'base/BaseTool': BaseTool,
    'drawing/draw': (context, fn) => fn(context),
    'drawing/drawRect': (...args) => mockDrawing.drawRect(...args),
    'drawing/drawTextBox': (...args) => mockDrawing.drawTextBox(...args),
    'drawing/textBoxWidth': (context, text, padding) => text.length * 7 + 2 * padding,
    'drawing/getNewContext': canvas => canvas.context,
  };
  const toolState = { current: null };
  return {
    __esModule: true,
    default: { textStyle: { getFontSize: () => 14 } },
    importInternal: name => internals[name] || jest.fn(),
    getToolState: () => toolState.current,
    toolColors: {},
    __toolState: toolState,
  };
}, { virtual: true });
jest.mock('cornerstone-core', () => ({}), { virtual: true });
jest.mock('@ohif/core', () => ({
  displayAttributes: jest.requireActual('../../../../platform/core/src/displayAttributes'),
}));

const csTools = require('cornerstone-tools');
const { default: DICOMSRSeriesTagTool } = require('./DICOMSRSeriesTag');
const { displayAttributes } = require('@ohif/core');

const render = (tool, data, element = {}) => {
  csTools.__toolState.current = { data };
  const canvas = { width: 800, height: 600, context: {} };
  tool.renderToolData({ detail: { element, image: { rows: 512, columns: 512 }, canvasContext: { canvas } } });
  return element;
};

beforeEach(() => {
  mockDrawing.drawRect.mockClear();
  mockDrawing.drawTextBox.mockClear();
  displayAttributes.setSiteDisplayAttributes(null);
});

describe('DICOMSRSeriesTagTool', () => {
  it('draws stored colors and records the drawn region', () => {
    const tool = new DICOMSRSeriesTagTool();
    const data = { value: 'RID1301', text: 'Lung', description: 'Upper lobe',
      displayAttributes: { Color: { Background: '#112233', Border: '#ABCDEF', Value: '#FF0000', Meaning: '#00FF00' } } };
    const element = render(tool, [data]);

    const [, , corner1, corner2, options] = mockDrawing.drawRect.mock.calls[0];
    expect(options).toMatchObject({ color: '#ABCDEF', fillStyle: '#112233' });
    expect(mockDrawing.drawTextBox.mock.calls.map(call => [call[1], call[4]])).toEqual([['RID1301', '#FF0000'], ['Lung', '#00FF00']]);

    const centre = { x: (corner1.x + corner2.x) / 2, y: (corner1.y + corner2.y) / 2 };
    expect(tool.getTagAtCanvasPoint(element, centre.x, centre.y).data).toBe(data);
    expect(tool.getTagAtCanvasPoint(element, 0, 0)).toBeNull();
  });

  it('draws a tag without colors with the defaults and no fill', () => {
    const tool = new DICOMSRSeriesTagTool();
    render(tool, [{ value: 'RID1301', text: 'Lung' }]);

    expect(mockDrawing.drawRect.mock.calls[0][4]).toMatchObject({ color: '#FFFFFF', fillStyle: undefined });
    expect(mockDrawing.drawTextBox.mock.calls.map(call => call[4])).toEqual(['#8AD0A8', '#C0C7F8']);
  });

  it('follows the site defaults for a tag without colors', () => {
    displayAttributes.setSiteDisplayAttributes({ DICOMSRSeriesTagTool: { Color: { Background: '#000000', Value: '#FFFFFF' } } });
    const tool = new DICOMSRSeriesTagTool();
    render(tool, [{ value: 'RID1301', text: 'Lung' }]);

    expect(mockDrawing.drawRect.mock.calls[0][4].fillStyle).toBe('#000000');
    expect(mockDrawing.drawTextBox.mock.calls.map(call => call[4])).toEqual(['#FFFFFF', '#C0C7F8']);
  });

  it('keeps a saved finding without a background unfilled when the site sets one', () => {
    displayAttributes.setSiteDisplayAttributes({ DICOMSRSeriesTagTool: { Color: { Background: '#000000' } } });
    const tool = new DICOMSRSeriesTagTool();
    render(tool, [{ value: 'RID1301', text: 'Lung', displayAttributes: { Color: { Value: '#8AD0A8', Meaning: '#C0C7F8' } } }]);

    expect(mockDrawing.drawRect.mock.calls[0][4].fillStyle).toBeUndefined();
  });

  it('keeps independent colors for two tags and clears regions when the state empties', () => {
    const tool = new DICOMSRSeriesTagTool();
    const red = { value: 'A', text: 'Red', displayAttributes: { Color: { Value: '#FF0000' } } };
    const blue = { value: 'B', text: 'Blue', displayAttributes: { Color: { Value: '#0000FF' } } };
    const element = render(tool, [red, blue]);

    expect(mockDrawing.drawTextBox.mock.calls.map(call => [call[1], call[4]])).toEqual(
      [['A', '#FF0000'], ['Red', '#FF0000'], ['B', '#0000FF'], ['Blue', '#0000FF']]);

    const regions = mockDrawing.drawRect.mock.calls.map(([, , c1, c2]) => ({ x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 }));
    expect(regions.map(p => tool.getTagAtCanvasPoint(element, p.x, p.y).data)).toEqual([red, blue]);

    render(tool, [], element);
    expect(tool.getTagAtCanvasPoint(element, regions[0].x, regions[0].y)).toBeNull();
  });
});
