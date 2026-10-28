/**
 * @jest-environment jsdom
 */
// The Repair surface card: what it shows per surface state, its idle and preview actions,
// closing during a preview, following the target away, and the open / close helpers on the
// tool state. Strings come from the en-US locale.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import locale from '../../../../platform/i18n/src/locales/en-US/SegmentationEditor.json';

import { get3DToolState, reset3DToolState, set3DPreview, set3DRepairPanel } from '../threeDTools/threeDToolState';

import { closeRepairSurface, openRepairSurface, RepairSurfaceCard } from './RepairSurfaceCard';

jest.mock('@ohif/ui-next', () => {
  const React = require('react');
  const passthrough = ({ children }) => React.createElement(React.Fragment, null, children);
  const TooltipProviderContext = React.createContext(false);
  const Button = React.forwardRef(({ children, variant, ...props }, ref) => React.createElement('button', { ref, 'data-variant': variant, ...props }, children));
  Button.displayName = 'Button';
  return {
    Button,
    Icons: {
      Close: props => React.createElement('span', { ...props, 'data-icon': 'close' }),
      StatusSuccess: props => React.createElement('span', { ...props, 'data-icon': 'status-success' }),
      StatusWarning: props => React.createElement('span', { ...props, 'data-icon': 'status-warning' }),
      LoadingSpinner: props => React.createElement('span', { ...props, 'data-icon': 'spinner' }),
    },
    Label: ({ children, ...props }) => React.createElement('label', props, children),
    Switch: ({ checked, onCheckedChange, ...props }) => React.createElement('input', { type: 'checkbox', checked: !!checked, onChange: e => onCheckedChange(e.target.checked), 'data-cy': props['data-cy'] }),
    TooltipProvider: ({ children }) => React.createElement(TooltipProviderContext.Provider, { value: true }, children),
    Tooltip: ({ children }) => {
      if (!React.useContext(TooltipProviderContext)) {
        throw new Error('`Tooltip` must be used within `TooltipProvider`');
      }
      return React.createElement(React.Fragment, null, children);
    },
    TooltipTrigger: passthrough,
    TooltipContent: ({ children }) => React.createElement('span', { hidden: true }, children),
  };
}, { virtual: true });

jest.mock('../utils/previewColor', () => ({ usePreviewColor: () => '#ff00ff', setPreviewColor: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: global.__t }) }));

global.IS_REACT_ACT_ENVIRONMENT = true;

const t = (key, options = {}) => {
  const plural = options.count !== undefined ? `${key}_${Number(options.count) === 1 ? 'one' : 'other'}` : null;
  const text = (plural && locale[plural]) || locale[key];
  if (text === undefined) {
    throw new Error(`en-US SegmentationEditor lacks the key: ${key}`);
  }
  return text.replace(/{{(\w+)}}/g, (_m, name) => String(options[name]));
};
global.__t = t;

const liver = { segmentIndex: 1, label: 'Liver' };
const damaged = { boundaryEdgeCount: 38, nonManifoldEdgeCount: 2, inconsistentEdgeCount: 0, degenerate: 0, duplicate: 0, closed: false, triangles: 12480 };

// A tool state the card subscribes to
function store(initial) {
  let state = { target: liver, surfaceHealth: damaged, preview: null, busy: false, showIssues: false, repairPanel: true, ...initial };
  const listeners = new Set();
  return {
    getState: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    set: patch => act(() => { state = { ...state, ...patch }; listeners.forEach(listener => listener(state)); }),
    request: jest.fn(),
    setOption: jest.fn(),
  };
}

const { TooltipProvider } = jest.requireMock('@ohif/ui-next');
const mounted = [];
const render = s => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(React.createElement(TooltipProvider, null, React.createElement(RepairSurfaceCard, {
    getState: s.getState, subscribe: s.subscribe, request: s.request, setOption: s.setOption,
  }))));
  mounted.push(() => { act(() => root.unmount()); container.remove(); });
  return container;
};
afterEach(() => {
  while (mounted.length) {
    mounted.pop()();
  }
  reset3DToolState();
});
const click = element => act(() => { element.click(); });
const cy = (container, id) => container.querySelector(`[data-cy="${id}"]`);
const buttons = container => Array.from(container.querySelectorAll('button')).filter(b => !b.getAttribute('aria-label')).map(button => [button.textContent, button.disabled]);

describe('RepairSurfaceCard', () => {
  it('shows the lead line, the health with its counts, Show issues, and Repair surface', () => {
    const s = store();
    const container = render(s);
    expect(cy(container, 'seg-editor-repair-card').textContent).toMatch(/^Repair surface(Close)?Acts on the whole 3D surface of the selected segment\. The selection is not used\./);
    expect(cy(container, 'seg-editor-repair-status').textContent).toBe('38 open edges, 2 non-manifold');
    expect(cy(container, 'seg-editor-repair-counts').textContent).toBe('Open edges38Non-manifold edges2');
    expect(cy(container, 'seg-editor-repair-reason')).toBeNull();
    expect(buttons(container)).toEqual([['Repair surface', false]]);
    click(cy(container, 'seg-editor-repair-surface'));
    expect(s.request).toHaveBeenCalledWith('repairSurface');
    click(cy(container, 'seg-editor-show-issues'));
    expect(s.setOption).toHaveBeenCalledWith('showIssues', true);
  });

  it('disables Repair surface with the reason as a line when the surface has nothing to repair or is busy', () => {
    const s = store({ surfaceHealth: { ...damaged, boundaryEdgeCount: 0, nonManifoldEdgeCount: 0, closed: true } });
    const container = render(s);
    expect(cy(container, 'seg-editor-repair-status').textContent).toBe('Surface is closed · 12,480 triangles');
    expect(cy(container, 'seg-editor-repair-counts')).toBeNull();
    expect(cy(container, 'seg-editor-repair-reason').textContent).toMatch(/^No open, non-manifold or inverted edge to repair/);
    expect(cy(container, 'seg-editor-repair-surface').disabled).toBe(true);
    s.set({ surfaceHealth: damaged, busy: true });
    expect(cy(container, 'seg-editor-repair-reason').textContent).toBe('Another edit is still running');
    expect(cy(container, 'seg-editor-repair-surface').disabled).toBe(true);
  });

  it('shows Cancel / Apply repair while a repair is previewed, and cancels the preview when closed meanwhile', () => {
    const s = store();
    const container = render(s);
    s.set({ preview: { kind: 'remove', repair: true, holes: 2 } });
    expect(buttons(container)).toEqual([['Cancel', false], ['Apply repair', false]]);
    expect(container.textContent).toMatch(/Preview: the patches closing the rims are highlighted\. Enter applies, Esc cancels\./);
    click(cy(container, 'seg-editor-apply-repair'));
    expect(s.request).toHaveBeenLastCalledWith('applyPreview');
    click(cy(container, 'seg-editor-cancel-repair'));
    expect(s.request).toHaveBeenLastCalledWith('cancelPreview');
    s.request.mockClear();
    set3DRepairPanel(true);
    click(cy(container, 'seg-editor-repair-close'));
    expect(s.request).toHaveBeenCalledWith('cancelPreview');
    expect(get3DToolState().repairPanel).toBe(false);

    // Idle, Close just closes
    s.set({ preview: null });
    s.request.mockClear();
    set3DRepairPanel(true);
    click(cy(container, 'seg-editor-repair-close'));
    expect(s.request).not.toHaveBeenCalled();
    expect(get3DToolState().repairPanel).toBe(false);
  });

  it('closes itself when the target changes or goes away', () => {
    const s = store();
    render(s);
    set3DRepairPanel(true);
    s.set({ surfaceHealth: { ...damaged, boundaryEdgeCount: 3 } });
    expect(get3DToolState().repairPanel).toBe(true);
    s.set({ target: { segmentIndex: 2, label: 'Spleen' } });
    expect(get3DToolState().repairPanel).toBe(false);
    set3DRepairPanel(true);
    s.set({ target: null });
    expect(get3DToolState().repairPanel).toBe(false);
  });

  it('opens and closes through the tool state; closing cancels a repair preview', () => {
    openRepairSurface();
    expect(get3DToolState().repairPanel).toBe(true);
    const request = jest.fn();
    act(() => { set3DPreview({ kind: 'remove', repair: true }); });
    closeRepairSurface({ request });
    expect(request).toHaveBeenCalledWith('cancelPreview');
    expect(get3DToolState().repairPanel).toBe(false);
    // Nothing to cancel when it is not open, or not a repair
    act(() => { set3DPreview({ kind: 'smooth' }); });
    openRepairSurface();
    request.mockClear();
    closeRepairSurface({ request });
    expect(request).not.toHaveBeenCalled();
  });
});
