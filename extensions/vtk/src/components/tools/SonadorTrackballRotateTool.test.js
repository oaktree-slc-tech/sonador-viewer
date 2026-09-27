// SonadorTrackballRotateTool: a mouse-down on an empty 3D viewport is reported, not thrown

import SonadorTrackballRotateTool from './SonadorTrackballRotateTool';

const mockCore = { enabledElements: new Map() };
// virtual: jest's resolver does not follow the Cornerstone3D packages' `exports` maps
jest.mock('@cornerstonejs/core', () => ({
  getEnabledElement: element => mockCore.enabledElements.get(element),
}), { virtual: true });

const mockBasePreMouseDown = jest.fn(() => 'base');
jest.mock('@cornerstonejs/tools', () => ({
  TrackballRotateTool: class {
    static toolName = 'TrackballRotate';
    constructor({ toolGroupId, configuration } = {}) {
      this.toolGroupId = toolGroupId;
      this.configuration = configuration || {};
      // The library assigns its handler as an instance property
      this.preMouseDownCallback = mockBasePreMouseDown;
    }
  },
}), { virtual: true });

const element = {};
const eventFor = el => ({ detail: { element: el } });

function setViewport(viewport) {
  mockCore.enabledElements.set(element, { viewport });
}

beforeEach(() => {
  mockBasePreMouseDown.mockClear();
  mockCore.enabledElements.clear();
});

describe('SonadorTrackballRotateTool', () => {
  it('defers to the library handler when the viewport has an actor', () => {
    setViewport({ id: 'v3d', getDefaultActor: () => ({ actor: {} }) });
    const tool = new SonadorTrackballRotateTool({ toolGroupId: 'g' });

    expect(tool.preMouseDownCallback(eventFor(element))).toBe('base');
    expect(mockBasePreMouseDown).toHaveBeenCalledTimes(1);
  });

  it('reports an empty viewport once instead of throwing', () => {
    setViewport({ id: 'v3d', getDefaultActor: () => undefined });
    const onEmptyViewport = jest.fn();
    const tool = new SonadorTrackballRotateTool({ toolGroupId: 'g', configuration: { onEmptyViewport } });

    expect(tool.preMouseDownCallback(eventFor(element))).toBe(true);
    expect(tool.preMouseDownCallback(eventFor(element))).toBe(true);

    expect(mockBasePreMouseDown).not.toHaveBeenCalled();
    expect(onEmptyViewport).toHaveBeenCalledTimes(1);
    expect(onEmptyViewport).toHaveBeenCalledWith({ viewportId: 'v3d', toolGroupId: 'g' });
  });

  it('reports again after the viewport had an actor in between', () => {
    const viewport = { id: 'v3d', getDefaultActor: () => undefined };
    setViewport(viewport);
    const onEmptyViewport = jest.fn();
    const tool = new SonadorTrackballRotateTool({ configuration: { onEmptyViewport } });

    tool.preMouseDownCallback(eventFor(element));
    viewport.getDefaultActor = () => ({ actor: {} });
    tool.preMouseDownCallback(eventFor(element));
    viewport.getDefaultActor = () => undefined;
    tool.preMouseDownCallback(eventFor(element));

    expect(onEmptyViewport).toHaveBeenCalledTimes(2);
    expect(mockBasePreMouseDown).toHaveBeenCalledTimes(1);
  });

  it('warns on the console without a handler, and copes with an unknown element', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const tool = new SonadorTrackballRotateTool({});

    expect(tool.preMouseDownCallback(eventFor({}))).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('registers under its own tool name', () => {
    expect(SonadorTrackballRotateTool.toolName).toBe('SonadorTrackballRotateTool');
  });
});
