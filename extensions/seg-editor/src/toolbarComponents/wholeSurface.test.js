/**
 * @jest-environment jsdom
 */
// The whole-surface side of the 3D Tools palette: the status lines and the "⋯" menu model
// (wholeSurface.js), and the rendered menu and status block (WholeSurface.jsx) against the
// en-US locale, so a key the locale lacks fails here.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { TooltipProvider } from '@ohif/ui-next';

import locale from '../../../../platform/i18n/src/locales/en-US/SegmentationEditor.json';
import { adjustPendingWrites, get3DToolState, handle3DToolRequest, reset3DToolState, set3DLastEdit, set3DPreview, set3DSurfaceHealth, set3DToolOption, set3DToolTarget, set3DUnsynchronizedEdits, setActive3DTool, THREE_D_TOOLS } from '../threeDTools/threeDToolState';

import { WholeSurfaceMenu, WholeSurfaceStatus } from './WholeSurface';
import { healthSummary, surfaceStatus, syncStatus, wholeSurfaceMenu } from './wholeSurface';

jest.mock('../utils/previewColor', () => ({ usePreviewColor: () => '#ff00ff', setPreviewColor: jest.fn() }));

// The command context constant pulls the vtk extension in through the editor's enums
jest.mock('../toolbox/constants', () => ({ SEG_EDITOR_COMMAND_CONTEXT: 'SEG_EDITOR_TEST' }));

const mockRunCommand = jest.fn();
const mockDialogService = { show: jest.fn(), dismiss: jest.fn() };
jest.mock('@ohif/core', () => ({
  useSystem: () => ({ servicesManager: { services: { UIDialogService: mockDialogService } }, commandsManager: { runCommand: mockRunCommand } }),
}), { virtual: true });

const mockMeshColor = { value: 'auto', set: jest.fn() };
jest.mock('../utils/meshColor', () => ({
  MESH_COLOR_AUTO: 'auto',
  getMeshColor: () => mockMeshColor.value,
  isMeshColorAuto: color => !color || color === 'auto',
  setMeshColor: (...args) => mockMeshColor.set(...args),
  subscribeMeshColor: () => () => {},
  useMeshColor: () => mockMeshColor.value,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: global.__t }),
}));

jest.mock('@ohif/ui-next', () => {
  const React = require('react');
  const passthrough = ({ children }) => React.createElement(React.Fragment, null, children);
  const TooltipProviderContext = React.createContext(false);
  const MenuContext = React.createContext({ open: false, setOpen: () => {} });
  const RadioContext = React.createContext({ value: undefined, onValueChange: () => {} });
  const Button = React.forwardRef(({ children, variant, ...props }, ref) => React.createElement('button', { ref, 'data-variant': variant, ...props }, children));
  Button.displayName = 'Button';
  const item = (role) => ({ children, disabled, onSelect, checked, onCheckedChange, ...props }) => React.createElement(
    'button', {
      role, disabled, 'aria-checked': checked, 'data-cy': props['data-cy'],
      // Radix passes a cancelable select event; a handler that prevents it keeps the menu open
      onClick: () => { if (disabled) { return; } if (onCheckedChange) { onCheckedChange(!checked); } else { onSelect?.(new Event('select', { cancelable: true })); } },
    }, children,
  );
  return {
    Button,
    Icons: {
      ChevronDown: props => React.createElement('span', { ...props, 'data-icon': 'chevron' }),
      ChevronRight: props => React.createElement('span', { ...props, 'data-icon': 'chevron-right' }),
      Close: props => React.createElement('span', { ...props, 'data-icon': 'close' }),
      More: props => React.createElement('span', { ...props, 'data-icon': 'more' }),
      StatusSuccess: props => React.createElement('span', { ...props, 'data-icon': 'status-success' }),
      StatusWarning: props => React.createElement('span', { ...props, 'data-icon': 'status-warning' }),
      LoadingSpinner: props => React.createElement('span', { ...props, 'data-icon': 'spinner' }),
      Undo: props => React.createElement('span', { ...props, 'data-icon': 'undo' }),
    },
    Label: ({ children, ...props }) => React.createElement('label', props, children),
    Switch: ({ checked, onCheckedChange, ...props }) => React.createElement('input', { type: 'checkbox', checked: !!checked, onChange: e => onCheckedChange(e.target.checked), 'data-cy': props['data-cy'], readOnly: false }),
    // As Radix: a Tooltip outside a TooltipProvider is an error
    TooltipProvider: ({ children }) => React.createElement(TooltipProviderContext.Provider, { value: true }, children),
    Tooltip: ({ children }) => {
      if (!React.useContext(TooltipProviderContext)) {
        throw new Error('`Tooltip` must be used within `TooltipProvider`');
      }
      return React.createElement(React.Fragment, null, children);
    },
    TooltipTrigger: passthrough,
    TooltipContent: ({ children }) => React.createElement('span', { hidden: true, 'data-tooltip': true }, children),
    // Controlled or uncontrolled, as Radix
    DropdownMenu: ({ open, onOpenChange, children }) => {
      const [internal, setInternal] = React.useState(false);
      const isOpen = open === undefined ? internal : open;
      const setOpen = value => { setInternal(value); onOpenChange?.(value); };
      return React.createElement(MenuContext.Provider, { value: { open: isOpen, setOpen } }, children);
    },
    DropdownMenuTrigger: ({ children }) => {
      const { open, setOpen } = React.useContext(MenuContext);
      return React.cloneElement(children, { onClick: () => setOpen(!open), 'aria-expanded': open });
    },
    DropdownMenuContent: ({ children, ...props }) => {
      const { open } = React.useContext(MenuContext);
      return open ? React.createElement('div', { role: 'menu', 'data-cy': props['data-cy'] }, children) : null;
    },
    DropdownMenuItem: item('menuitem'),
    DropdownMenuCheckboxItem: item('menuitemcheckbox'),
    DropdownMenuLabel: ({ children }) => React.createElement('div', { role: 'presentation' }, children),
    DropdownMenuSeparator: () => React.createElement('hr'),
    DropdownMenuShortcut: ({ children }) => React.createElement('span', { 'data-shortcut': true }, children),
    // A sub-menu renders its content inline; radio items report their value through the group
    DropdownMenuSub: passthrough,
    DropdownMenuSubTrigger: ({ children, ...props }) => React.createElement('button', { 'aria-haspopup': 'menu', 'aria-label': props['aria-label'], 'data-cy': props['data-cy'] }, children),
    DropdownMenuSubContent: ({ children, ...props }) => React.createElement('div', { role: 'menu', 'data-cy': props['data-cy'] }, children),
    DropdownMenuRadioGroup: ({ value, onValueChange, children }) => React.createElement(RadioContext.Provider, { value: { value, onValueChange } }, children),
    DropdownMenuRadioItem: ({ children, value, ...props }) => {
      const group = React.useContext(RadioContext);
      return React.createElement('button', {
        role: 'menuitemradio', 'aria-checked': group.value === value, 'aria-label': props['aria-label'], 'data-cy': props['data-cy'],
        onClick: () => group.onValueChange?.(value),
      }, children);
    },
    HoverCard: passthrough,
    HoverCardTrigger: passthrough,
    HoverCardPortal: passthrough,
    HoverCardContent: ({ children, ...props }) => React.createElement('div', { 'data-cy': props['data-cy'], 'data-hovercard': true }, children),
  };
}, { virtual: true });

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

const liver = { segmentIndex: 1, label: 'Liver', color: [255, 0, 0] };
const closed = { boundaryEdgeCount: 0, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0, degenerate: 0, duplicate: 0, closed: true, triangles: 12480 };
const damaged = { ...closed, boundaryEdgeCount: 38, nonManifoldEdgeCount: 2, closed: false };

beforeEach(() => {
  reset3DToolState();
  mockRunCommand.mockClear();
  mockMeshColor.value = 'auto';
  mockMeshColor.set.mockClear();
});

describe('surfaceStatus and syncStatus', () => {
  it('words the surface health per state and says whether the line opens Repair surface', () => {
    expect(surfaceStatus(t, { target: null, surfaceHealth: null })).toEqual({ tone: 'muted', text: 'Select a segment to check its surface', interactive: false });
    expect(surfaceStatus(t, { target: { segmentIndex: 1, disabledReason: 'Locked' }, surfaceHealth: null })).toMatchObject({ tone: 'muted', text: 'Locked', interactive: false });
    expect(surfaceStatus(t, { target: liver, surfaceHealth: null })).toEqual({ tone: 'muted', text: 'Checking the surface...', interactive: true });
    expect(surfaceStatus(t, { target: liver, surfaceHealth: closed })).toEqual({ tone: 'ok', text: 'Surface is closed · 12,480 triangles', interactive: true });
    expect(surfaceStatus(t, { target: liver, surfaceHealth: { ...closed, triangles: 0 } }).text).toBe('Surface is closed');
    expect(surfaceStatus(t, { target: liver, surfaceHealth: damaged })).toEqual({ tone: 'warning', text: '38 open edges, 2 non-manifold', interactive: true });
    expect(healthSummary(t, { ...damaged, boundaryEdgeCount: 1, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 3 })).toBe('1 open edge, 3 inverted');
  });

  it('gives the pending, ahead and failed lines, and when Synchronize... may run', () => {
    expect(syncStatus(t, { pendingWrites: 0, unsynchronizedEdits: 0 })).toEqual({ pending: null, ahead: null, failed: null, canSynchronize: false });
    expect(syncStatus(t, { pendingWrites: 1, unsynchronizedEdits: 2, failedWrites: 1 })).toEqual({
      pending: 'Updating the 2D slices (1 pending)...',
      ahead: '3D surface ahead of the 2D slices: 2 edits not written.',
      failed: '1 of them because the write was refused or failed.',
      canSynchronize: false,
    });
    expect(syncStatus(t, { unsynchronizedEdits: 1 })).toMatchObject({ ahead: '3D surface ahead of the 2D slices: 1 edit not written.', failed: null, canSynchronize: true });
    expect(syncStatus(t, { unsynchronizedEdits: 1, preview: {} }).canSynchronize).toBe(false);
    expect(syncStatus(t, { unsynchronizedEdits: 1, busy: true }).canSynchronize).toBe(false);
  });

});

describe('wholeSurfaceMenu', () => {
  it('offers Repair surface... with the health beside it, disabled without a segment', () => {
    const menu = wholeSurfaceMenu(t, { target: liver, surfaceHealth: damaged, unsynchronizedEdits: 0, showMesh: true, showIssues: false });
    expect(menu.repair).toEqual({
      enabled: true, title: 'Repair surface...', trailing: '38 open edges, 2 non-manifold',
      description: 'Closes open edges across the whole 3D surface. Ignores the selection.',
    });
    expect(wholeSurfaceMenu(t, { target: liver, surfaceHealth: closed }).repair.trailing).toBe('Closed');
    expect(wholeSurfaceMenu(t, { target: null, surfaceHealth: null }).repair).toMatchObject({ enabled: false, description: 'Select a segment to repair', trailing: '' });
    expect(wholeSurfaceMenu(t, { target: { segmentIndex: 2, disabledReason: 'Locked' } }).repair).toMatchObject({ enabled: false, description: 'Locked' });
    expect(menu.showMesh).toEqual({ checked: true, title: 'Show mesh', description: 'Draws every edge and vertex of the segment in the mesh colour.' });
    // The mesh colour follows the segment (a much lighter shade of a dark red) unless picked
    expect(menu.meshColor).toEqual({ auto: true, preference: 'auto', effective: '#ff9999', palette: ['#ffd9d9', '#ff9999', '#ff5959', '#a60000', '#660000', '#260000'] });
    expect(wholeSurfaceMenu(t, { target: liver, surfaceHealth: closed }, { meshColor: '#123456' }).meshColor).toMatchObject({ auto: false, preference: '#123456', effective: '#123456' });
    expect(wholeSurfaceMenu(t, { target: null }).meshColor).toMatchObject({ auto: true, effective: '#8f8f8f' });
    expect(menu.showIssues).toMatchObject({ checked: false, title: 'Show issues' });
  });

  it('offers Synchronize 2D slices... with the count, and explains why not otherwise', () => {
    const sync = state => wholeSurfaceMenu(t, { target: liver, surfaceHealth: closed, ...state }).synchronize;
    expect(sync({ unsynchronizedEdits: 2 })).toEqual({
      enabled: true, title: 'Synchronize 2D slices...', trailing: '2 edits',
      description: 'Writes the surface\'s unwritten edits to the 2D slices. Opens a choice of how.',
    });
    expect(sync({ unsynchronizedEdits: 0 })).toMatchObject({ enabled: false, trailing: '', description: 'The 2D slices match the 3D surface.' });
    expect(sync({ unsynchronizedEdits: 1, preview: { kind: 'smooth' } })).toMatchObject({ enabled: false, trailing: '1 edit', description: 'Finish or cancel the edit shown first.' });
    expect(sync({ unsynchronizedEdits: 1, pendingWrites: 1 })).toMatchObject({ enabled: false, description: 'Updating the 2D slices...' });
    expect(sync({ unsynchronizedEdits: 1, busy: true })).toMatchObject({ enabled: false, description: 'Updating the 2D slices...' });
  });
});

describe('WholeSurfaceMenu and WholeSurfaceStatus', () => {
  const mounted = [];
  // Rendered as the palette renders them: inside the editor panel's TooltipProvider
  const render = element => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(React.createElement(TooltipProvider, null, element)));
    mounted.push(() => { act(() => root.unmount()); container.remove(); });
    return container;
  };
  afterEach(() => {
    while (mounted.length) {
      mounted.pop()();
    }
  });
  const click = element => act(() => { element.click(); });
  const cy = (container, id) => container.querySelector(`[data-cy="${id}"]`);

  it('opens Repair surface and Synchronize from the menu, and toggles the display options', () => {
    act(() => {
      set3DToolTarget(liver);
      set3DSurfaceHealth(damaged);
      set3DUnsynchronizedEdits(2, 0);
    });
    const synchronize = jest.fn();
    const off = handle3DToolRequest('synchronizeSurface', synchronize);
    const container = render(React.createElement(WholeSurfaceMenu));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    click(cy(container, 'seg-editor-whole-surface-menu'));
    expect(cy(container, 'seg-editor-menu-repair').textContent).toBe('Repair surface...38 open edges, 2 non-manifoldCloses open edges across the whole 3D surface. Ignores the selection.');
    expect(cy(container, 'seg-editor-menu-synchronize').textContent).toMatch(/^Synchronize 2D slices\.\.\.2 edits/);
    click(cy(container, 'seg-editor-menu-repair'));
    expect(get3DToolState().repairPanel).toBe(true);
    click(cy(container, 'seg-editor-menu-synchronize'));
    expect(synchronize).toHaveBeenCalled();
    expect(cy(container, 'seg-editor-menu-show-mesh').getAttribute('aria-checked')).toBe('true');
    click(cy(container, 'seg-editor-menu-show-mesh'));
    expect(cy(container, 'seg-editor-menu-show-mesh').getAttribute('aria-checked')).toBe('false');
    click(cy(container, 'seg-editor-menu-show-issues'));
    expect(cy(container, 'seg-editor-menu-show-issues').getAttribute('aria-checked')).toBe('true');
    off?.();
  });

  it('offers the mesh colour beside Show mesh: the segment\'s shades, Auto and Custom...', () => {
    act(() => { set3DToolTarget(liver); set3DSurfaceHealth(closed); });
    const container = render(React.createElement(WholeSurfaceMenu));
    click(cy(container, 'seg-editor-whole-surface-menu'));
    // The swatch shows the colour in effect: a much lighter red while the mesh follows the segment
    expect(cy(container, 'seg-editor-menu-mesh-color').querySelector('i').style.backgroundColor).toBe('rgb(255, 153, 153)');
    const palette = cy(container, 'seg-editor-mesh-color-palette');
    expect(Array.from(palette.querySelectorAll('[role="menuitemradio"]')).map(item => item.getAttribute('aria-label') || item.textContent)).toEqual([
      '#ffd9d9', '#ff9999', '#ff5959', '#a60000', '#660000', '#260000', 'AutoA much lighter or darker shade of the segment\'s own colour.',
    ]);
    expect(cy(container, 'seg-editor-mesh-color-auto').getAttribute('aria-checked')).toBe('true');
    click(cy(container, 'seg-editor-mesh-color-660000'));
    expect(mockMeshColor.set).toHaveBeenCalledWith('#660000');
    click(cy(container, 'seg-editor-mesh-color-auto'));
    expect(mockMeshColor.set).toHaveBeenLastCalledWith('auto');
    // Custom... opens the native picker; a pick sets the colour
    const input = cy(container, 'seg-editor-mesh-color-input');
    const open = jest.spyOn(input, 'click');
    click(cy(container, 'seg-editor-mesh-color-custom'));
    expect(open).toHaveBeenCalled();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '#123456');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(mockMeshColor.set).toHaveBeenLastCalledWith('#123456');
  });

  it('disables the menu items with their reasons', () => {
    const container = render(React.createElement(WholeSurfaceMenu));
    click(cy(container, 'seg-editor-whole-surface-menu'));
    expect(cy(container, 'seg-editor-menu-repair').disabled).toBe(true);
    expect(cy(container, 'seg-editor-menu-repair').textContent).toMatch(/Select a segment to repair$/);
    expect(cy(container, 'seg-editor-menu-synchronize').disabled).toBe(true);
    expect(cy(container, 'seg-editor-menu-synchronize').textContent).toMatch(/The 2D slices match the 3D surface\.$/);
    click(cy(container, 'seg-editor-menu-repair'));
    expect(get3DToolState().repairPanel).toBe(false);
  });

  it('shows the health line (opening Repair surface), the slices behind the surface, the last edit and the Pointer hint', () => {
    const container = render(React.createElement(WholeSurfaceStatus));
    expect(cy(container, 'seg-editor-surface-health').textContent).toBe('Select a segment to check its surface');
    expect(cy(container, 'seg-editor-surface-health').tagName).toBe('P');
    expect(cy(container, 'seg-editor-unsynchronized')).toBeNull();

    act(() => {
      set3DToolTarget(liver);
      set3DSurfaceHealth(damaged);
      setActive3DTool(THREE_D_TOOLS.Lasso);
      set3DUnsynchronizedEdits(2, 1);
      set3DLastEdit({ kind: 'smooth', points: 12, write: 'surfaceOnly' });
    });
    expect(cy(container, 'seg-editor-surface-health').tagName).toBe('BUTTON');
    expect(cy(container, 'seg-editor-surface-health').textContent).toBe('38 open edges, 2 non-manifold');
    expect(cy(container, 'seg-editor-surface-health').querySelector('[data-icon="status-warning"]')).not.toBeNull();
    // The hover card carries the counts and what a click does
    expect(cy(container, 'seg-editor-surface-health-card').textContent)
      .toBe('Surface healthOpen edges38Non-manifold edges212,480 trianglesOpen Repair surface: edge counts, Show issues and Repair. Acts on the whole 3D surface.');
    expect(cy(container, 'seg-editor-repair-card')).toBeNull();
    click(cy(container, 'seg-editor-surface-health'));
    expect(get3DToolState().repairPanel).toBe(true);
    // The card opens in the status block, under the health line
    expect(cy(container, 'seg-editor-repair-card')).not.toBeNull();
    expect(cy(container, 'seg-editor-repair-status').textContent).toBe('38 open edges, 2 non-manifold');
    click(cy(container, 'seg-editor-repair-close'));
    expect(cy(container, 'seg-editor-repair-card')).toBeNull();
    expect(cy(container, 'seg-editor-unsynchronized').textContent).toMatch(/^3D surface ahead of the 2D slices: 2 edits not written\.1 of them because the write was refused or failed\./);
    expect(cy(container, 'seg-editor-synchronize').disabled).toBe(false);
    expect(cy(container, 'seg-editor-last-edit').textContent).toMatch(/^Last edit: 12 point\(s\) smoothed/);
    click(cy(container, 'seg-editor-undo-last-edit'));
    expect(mockRunCommand).toHaveBeenCalledWith('undoSegEditor', {}, expect.anything());

    act(() => { adjustPendingWrites(1); });
    expect(cy(container, 'seg-editor-pending-writes').textContent).toBe('Updating the 2D slices (1 pending)...');
    expect(cy(container, 'seg-editor-synchronize').disabled).toBe(true);
  });

  it('brings the Repair surface card up when a repair preview starts, with its Apply / Cancel', () => {
    act(() => {
      set3DToolTarget(liver);
      set3DSurfaceHealth(damaged);
    });
    const container = render(React.createElement(WholeSurfaceStatus));
    expect(cy(container, 'seg-editor-repair-card')).toBeNull();
    act(() => { set3DPreview({ kind: 'remove', repair: false }); });
    expect(cy(container, 'seg-editor-repair-card')).toBeNull();
    act(() => { set3DPreview({ kind: 'remove', repair: true, holes: 2 }); });
    expect(cy(container, 'seg-editor-repair-card')).not.toBeNull();
    expect(cy(container, 'seg-editor-apply-repair')).not.toBeNull();
    // The card stays once the preview is applied or cancelled; the user closes it
    act(() => { set3DPreview(null); });
    expect(cy(container, 'seg-editor-repair-card')).not.toBeNull();
    expect(cy(container, 'seg-editor-repair-surface')).not.toBeNull();
  });

  it('keeps Show mesh in step between the menu and the tool state', () => {
    set3DToolOption('showMesh', false);
    const container = render(React.createElement(WholeSurfaceMenu));
    click(cy(container, 'seg-editor-whole-surface-menu'));
    expect(cy(container, 'seg-editor-menu-show-mesh').getAttribute('aria-checked')).toBe('false');
  });
});
