/**
 * @jest-environment ../../platform/viewer/src/__tests__/jsdomEnvironment.js
 */
// The drawing of landmark markers: primitives in CSS pixels drawn on a canvas at its pixel scale (the
// casing's opacity, the shape's strokes, a filled dot, a rounded plate and its text) and as SVG nodes
// in a Cornerstone3D annotation layer, updated in place on the next render and kept in drawing order
// across renders; the layers a view draws, in order: every marker, the chosen landmark's brackets,
// then the hovered name plate; and the hovered marker chosen again when the markers move under a
// still pointer.

jest.mock('../../../../platform/core/src/DICOMSR/landmarks/landmarkSetStore', () => ({
  getCurrentLandmark: () => null, getLandmarkSets: () => [], isLandmarkSetVisible: () => true, subscribe: () => ({ unsubscribe: () => {} }),
  EVENTS: { SELECTION_CHANGED: 'selection' },
}));
jest.mock('../../../../platform/core/src/DICOMSR/landmarks/landmarkPlacement', () => ({ placementOf: () => ({ placed: true }) }));

import {
  drawAsSvg, drawLayersAsSvg, drawOnCanvas, hoveredLandmarkMarker, landmarkLayers, setLandmarkMarkers,
} from './landmarkMarkerOverlay';

const markers = jest.requireActual('../../../../platform/core/src/DICOMSR/landmarks/landmarkMarkers');

function recordingContext() {
  const calls = [];
  const state = {};
  const context = new Proxy(state, {
    get: (target, name) => (name in target ? target[name] : (...args) => calls.push([name, ...args])),
    set: (target, name, value) => {
      target[name] = value;
      calls.push([`set:${name}`, value]);
      return true;
    },
  });
  return { context, calls };
}

describe('on a canvas', () => {
  it('draws a Point marker at the canvas scale: the casing at 85 %, then the colour', () => {
    const { context, calls } = recordingContext();
    drawOnCanvas(context, markers.markerPrimitives({ x: 10, y: 20, shape: 'Point', line: '#00C0FF' }), 2);
    const strokes = calls.filter(([name]) => name === 'set:strokeStyle').map(([, value]) => value);
    expect(strokes).toEqual(['#000000', '#00C0FF']);
    expect(calls.filter(([name]) => name === 'set:lineWidth').map(([, value]) => value)).toEqual([7, 3]);
    expect(calls.filter(([name]) => name === 'set:globalAlpha').map(([, value]) => value)).toEqual([0.85, 1]);
    expect(calls.find(([name]) => name === 'moveTo')).toEqual(['moveTo', 7, 40]);
  });

  it('fills the Anatomic dot, and draws a plate with its text in a scaled font', () => {
    const { context, calls } = recordingContext();
    drawOnCanvas(context, [
      ...markers.markerPrimitives({ x: 10, y: 20, shape: 'Anatomic', line: '#FF0000' }),
      ...markers.platePrimitives({ x: 10, y: 20 }, 'Tear drop', '#FFFFFF', () => 50),
    ], 2);
    expect(calls.filter(([name]) => name === 'set:fillStyle').map(([, value]) => value)).toEqual(['#FF0000', '#000000', '#FFFFFF']);
    expect(calls.find(([name]) => name === 'set:font')[1]).toMatch(/^600 24px /);
    expect(calls.find(([name]) => name === 'fillText')).toEqual(['fillText', 'Tear drop', (10 + 10.5 + 6) * 2, (20 - 22 + 11) * 2]);
  });
});


describe('in an SVG layer', () => {
  function helper() {
    const nodes = new Map();
    const touched = new Set();
    return {
      nodes, touched,
      getSvgNode: hash => nodes.get(hash),
      appendNode: (node, hash) => nodes.set(hash, node),
      setNodeTouched: hash => touched.add(hash),
    };
  }

  it('draws a Registration marker as paths and circles, and updates the same nodes on the next render', () => {
    const svg = helper();
    drawAsSvg(svg, 'vp::a', markers.markerPrimitives({ x: 10, y: 20, shape: 'Registration', line: '#00C0FF' }));
    expect([...svg.nodes.values()].map(node => node.tagName)).toEqual(['circle', 'path', 'circle', 'path']);
    const ring = [...svg.nodes.values()][2];
    expect(ring.getAttribute('r')).toBe('4.5');
    expect(ring.getAttribute('stroke')).toBe('#00C0FF');
    expect([...svg.nodes.values()][0].getAttribute('stroke-opacity')).toBe('0.85');

    const before = [...svg.nodes.values()];
    drawAsSvg(svg, 'vp::a', markers.markerPrimitives({ x: 30, y: 20, shape: 'Registration', line: '#00C0FF' }));
    expect([...svg.nodes.values()]).toEqual(before);
    expect(ring.getAttribute('cx')).toBe('30');
    expect(svg.touched.size).toBe(4);
  });

  // The Cornerstone Tools helper's behaviour on a real SVG layer: a new node is appended, a cached one
  // is returned by its hash, and an untouched one is removed after the render
  function layerHelper() {
    const layer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const cache = {};
    const begin = () => Object.values(cache).forEach((entry) => { entry.touched = false; });
    const helper = {
      getSvgNode: hash => cache[hash] && cache[hash].node,
      appendNode: (node, hash) => {
        cache[hash] = { node, touched: true };
        layer.appendChild(node);
      },
      setNodeTouched: (hash) => { cache[hash].touched = true; },
      clearUntouched: () => Object.keys(cache).forEach((hash) => {
        if (!cache[hash].touched) {
          layer.removeChild(cache[hash].node);
          delete cache[hash];
        }
      }),
    };
    const render = (layers) => {
      begin();
      drawLayersAsSvg(helper, 'vp', layers);
      helper.clearUntouched();
    };
    return { layer, render };
  }
  const owners = layer => [...layer.childNodes].map(node => node.tagName === 'text' ? `text:${node.textContent}` : node.getAttribute('stroke'));

  it('keeps the drawing order on later renders: a marker that appears stays below the hovered name plate', () => {
    const { layer, render } = layerHelper();
    const a = markers.markerPrimitives({ x: 10, y: 10, shape: 'Point', line: '#AA0000' }, { hovered: true });
    const b = markers.markerPrimitives({ x: 30, y: 0, shape: 'Point', line: '#00BB00' });
    const plate = markers.platePrimitives({ x: 10, y: 10 }, 'Tear drop', '#FFFFFF', () => 50);
    render([['a', a], ['a::plate', plate]]);
    render([['a', a], ['b', b], ['a::plate', plate]]);
    expect(owners(layer)).toEqual(['#000000', '#AA0000', '#000000', '#00BB00', 'none', 'text:Tear drop']);
    // Brackets that appear go above the markers and below the plate
    render([['a', a], ['b', b], ['a::brackets', markers.bracketPrimitives({ x: 10, y: 10 })], ['a::plate', plate]]);
    const nodes = owners(layer);
    expect(nodes.slice(0, 4)).toEqual(['#000000', '#AA0000', '#000000', '#00BB00']);
    expect(nodes.slice(-2)).toEqual(['none', 'text:Tear drop']);
    expect(nodes.slice(4, -2)).toEqual([...Array(4).fill('#000000'), ...Array(4).fill('#FFFFFF')]);
    // A marker no longer drawn goes
    render([['b', b]]);
    expect(owners(layer)).toEqual(['#000000', '#00BB00']);
  });

  it("keeps the 3D view's edge mark below the hovered name plate, also when it appears on a later render", () => {
    const { layer, render } = layerHelper();
    const hoveredMarker = { landmark: { key: 'a', shape: 'Point', line: '#AA0000', text: '#FFFFFF', name: 'Tear drop', current: false }, x: 330, y: 200, slice: { kind: 'full' } };
    const options = { markers, hovered: 'a', bracketSize: 26 };
    render(landmarkLayers([hoveredMarker], options).layers);
    // The chosen landmark leaves the view: its edge mark is drawn from now on
    const edge = [['b::edge', [{ type: 'polyline', points: [[376, 175], [382, 180], [376, 185]], stroke: '#00BB00', width: 2 }]]];
    const { layers } = landmarkLayers([hoveredMarker], { ...options, marks: edge });
    expect(layers.map(([owner]) => owner)).toEqual(['a', 'b::edge', 'a::plate']);
    render(layers);
    expect(owners(layer)).toEqual(['#000000', '#AA0000', '#00BB00', 'none', 'text:Tear drop']);
    render(layers);
    expect(owners(layer).slice(-1)).toEqual(['text:Tear drop']);
  });

  it('draws a plate as a rect and a text node', () => {
    const svg = helper();
    drawAsSvg(svg, 'vp::a::plate', markers.platePrimitives({ x: 0, y: 0 }, 'Tear drop', '#FFFFFF', () => 50));
    const [rect, text] = [...svg.nodes.values()];
    expect(rect.getAttribute('fill-opacity')).toBe('0.78');
    expect(text.textContent).toBe('Tear drop');
  });
});


describe('the layers a view draws', () => {
  const landmark = (key, extra = {}) => ({ key, shape: 'Point', line: '#00C0FF', text: '#FFFFFF', name: null, current: false, ...extra });

  it('draws every marker, then the brackets of the chosen landmark, then the hovered name plate', () => {
    const placed = [
      { landmark: landmark('a', { name: 'Tear drop' }), x: 10, y: 10, slice: { kind: 'full' } },
      { landmark: landmark('b', { current: true }), x: 40, y: 10, slice: { kind: 'full' } },
    ];
    const { layers, records } = landmarkLayers(placed, { markers, hovered: 'a', bracketSize: 26 });
    expect(layers.map(([owner]) => owner)).toEqual(['a', 'b', 'b::brackets', 'a::plate']);
    expect(records).toEqual([{ key: 'a', x: 10, y: 10 }, { key: 'b', x: 40, y: 10 }]);
  });

  it('names a hovered ghost with its offset, and brackets no ghost', () => {
    const placed = [{ landmark: landmark('g', { name: 'Label only', current: true }), x: 10, y: 10, slice: { kind: 'ghost', steps: 1, direction: 'earlier' } }];
    const { layers } = landmarkLayers(placed, { markers, hovered: 'g', bracketSize: 26 });
    expect(layers.map(([owner]) => owner)).toEqual(['g', 'g::plate']);
    expect(layers[1][1].find(p => p.type === 'text').text).toBe('Label only · 1 slice earlier');
  });
});


describe('hover', () => {
  const at = (element, clientX, clientY) => element.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }));
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const options = refresh => ({ markerAt: markers.markerAt, refresh });

  it('chooses the hovered marker again when the markers move under a still pointer', () => {
    const element = document.createElement('div');
    const refresh = jest.fn();
    setLandmarkMarkers(element, canvas, [{ key: 'a', x: 10, y: 10 }, { key: 'b', x: 100, y: 100 }], options(refresh));
    at(element, 10, 10);
    expect(hoveredLandmarkMarker(element)).toBe('a');
    expect(refresh).toHaveBeenCalledTimes(1);

    // The view pans: B is now under the pointer, A elsewhere
    expect(setLandmarkMarkers(element, canvas, [{ key: 'a', x: 100, y: 100 }, { key: 'b', x: 10, y: 10 }], options(refresh))).toBe('b');
    expect(hoveredLandmarkMarker(element)).toBe('b');
    // Nothing under the pointer any more
    expect(setLandmarkMarkers(element, canvas, [{ key: 'a', x: 100, y: 100 }, { key: 'b', x: 40, y: 10 }], options(refresh))).toBe(null);
    // Recording the markers asks for no further render
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('forgets the pointer when it leaves or the wheel turns', () => {
    const element = document.createElement('div');
    const records = [{ key: 'a', x: 10, y: 10 }];
    setLandmarkMarkers(element, canvas, records, options(() => {}));
    at(element, 10, 10);
    element.dispatchEvent(new MouseEvent('mouseleave'));
    expect(setLandmarkMarkers(element, canvas, records, options(() => {}))).toBe(null);
    at(element, 10, 10);
    element.dispatchEvent(new WheelEvent('wheel'));
    expect(setLandmarkMarkers(element, canvas, records, options(() => {}))).toBe(null);
  });
});
