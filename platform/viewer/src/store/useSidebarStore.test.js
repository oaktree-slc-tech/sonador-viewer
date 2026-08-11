// Unit tests for the sidebar mode store (ohif-viewers#128, FR-4): default, toggle, and the
// localStorage round-trip that makes the mode survive a reload and reach a second tab.
//
// Jest runs in a node environment, so localStorage is shimmed BEFORE the store module loads
// (zustand persist touches storage at create()); hence require() instead of import. Same pattern
// as useStudiesTableFiltersAndColumnsStore.test.js.

const storageShim = () => {
  let data = {};
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
    clear: () => {
      data = {};
    },
  };
};

global.localStorage = storageShim();

const STORAGE_KEY = 'sidebar-mode';

const loadStore = () => {
  let store;

  jest.isolateModules(() => {
    store = require('./useSidebarStore');
  });

  return store;
};

const storedMode = () => {
  const raw = global.localStorage.getItem(STORAGE_KEY);

  return raw ? JSON.parse(raw).state.mode : null;
};

beforeEach(() => {
  global.localStorage.clear();
});

describe('useSidebarStore', () => {
  it('defaults to full when nothing is stored', () => {
    const { useSidebarStore, SIDEBAR_MODE_FULL } = loadStore();

    expect(useSidebarStore.getState().mode).toBe(SIDEBAR_MODE_FULL);
  });

  it('toggles between full and narrow, and back', () => {
    const { useSidebarStore, SIDEBAR_MODE_FULL, SIDEBAR_MODE_NARROW } = loadStore();

    useSidebarStore.getState().toggleMode();
    expect(useSidebarStore.getState().mode).toBe(SIDEBAR_MODE_NARROW);

    useSidebarStore.getState().toggleMode();
    expect(useSidebarStore.getState().mode).toBe(SIDEBAR_MODE_FULL);
  });

  it('persists the mode under the sidebar-mode key', () => {
    const { useSidebarStore, SIDEBAR_MODE_NARROW } = loadStore();

    useSidebarStore.getState().setMode(SIDEBAR_MODE_NARROW);

    expect(storedMode()).toBe(SIDEBAR_MODE_NARROW);
  });

  it('restores a persisted mode on reload', () => {
    const first = loadStore();
    first.useSidebarStore.getState().setMode(first.SIDEBAR_MODE_NARROW);

    // A fresh module instance stands in for a reload or a second tab: same storage, new store.
    const second = loadStore();

    expect(second.useSidebarStore.getState().mode).toBe(second.SIDEBAR_MODE_NARROW);
  });

  it('maps each mode to the rail width the layout applies', () => {
    const { SIDEBAR_WIDTHS, SIDEBAR_MODE_FULL, SIDEBAR_MODE_NARROW } = loadStore();

    expect(SIDEBAR_WIDTHS[SIDEBAR_MODE_FULL]).toBe('315px');

    // 40px icon button + 12px of gutter either side. This pins the contract Layout writes into
    // --sonador-sidebar-width; it cannot see the SCSS, so it does not speak to $sidebarNarrowGutter.
    expect(SIDEBAR_WIDTHS[SIDEBAR_MODE_NARROW]).toBe('64px');
  });
});
