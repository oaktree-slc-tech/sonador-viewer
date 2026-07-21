// Unit tests for the useStudiesTableFiltersAndColumnsStore persist migrations (sonador#42
// FR-16): v1 -> v2 seeds each interface's column order from the legacy shared `columnOrder`
// localStorage key, chained AFTER the existing v0 -> v1 ReasonForReview migration.
//
// Jest runs in a node environment, so localStorage is shimmed BEFORE the store module loads
// (zustand persist touches storage at create()); hence require() instead of import.

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

const {
  migrateStudiesFiltersAndColumns,
  useStudiesTableFiltersAndColumnsStore,
} = require('./useStudiesTableFiltersAndColumnsStore');

const LEGACY_ORDER = ['selector-settings-expander', 'StudyDate', 'PatientName', 'PatientID'];

beforeEach(() => {
  global.localStorage.clear();
});

describe('v1 -> v2 migration (per-interface column order, FR-16)', () => {
  it('seeds every interface order from the legacy columnOrder key', () => {
    global.localStorage.setItem('columnOrder', JSON.stringify(LEGACY_ORDER));

    const migrated = migrateStudiesFiltersAndColumns({}, 1);

    expect(migrated.workListColumnOrder).toEqual(LEGACY_ORDER);
    expect(migrated.allStudiesColumnOrder).toEqual(LEGACY_ORDER);
    expect(migrated.sharedColumnOrder).toEqual(LEGACY_ORDER);
    expect(migrated.uploadColumnOrder).toEqual(LEGACY_ORDER);
  });

  it('leaves orders unset when no legacy key exists (store defaults apply)', () => {
    const migrated = migrateStudiesFiltersAndColumns({}, 1);

    expect(migrated.workListColumnOrder).toBeUndefined();
    expect(migrated.allStudiesColumnOrder).toBeUndefined();
  });

  it('ignores a malformed legacy key', () => {
    global.localStorage.setItem('columnOrder', 'not-json{');
    expect(migrateStudiesFiltersAndColumns({}, 1).workListColumnOrder).toBeUndefined();

    global.localStorage.setItem('columnOrder', JSON.stringify({ nope: true }));
    expect(migrateStudiesFiltersAndColumns({}, 1).workListColumnOrder).toBeUndefined();
  });

  it('does not disturb the persisted filter/column selections', () => {
    global.localStorage.setItem('columnOrder', JSON.stringify(LEGACY_ORDER));
    const persisted = {
      workListStudiesSelectedColumns: ['AssignedUser', 'Status', 'ReasonForReview'],
      sharedStudiesSelectedFilters: ['PatientID'],
    };

    const migrated = migrateStudiesFiltersAndColumns(persisted, 1);

    expect(migrated.workListStudiesSelectedColumns).toEqual(['AssignedUser', 'Status', 'ReasonForReview']);
    expect(migrated.sharedStudiesSelectedFilters).toEqual(['PatientID']);
  });
});

describe('migration chaining (v0 -> v1 -> v2)', () => {
  it('still applies the ReasonForReview splice for v0 state, then seeds order', () => {
    global.localStorage.setItem('columnOrder', JSON.stringify(LEGACY_ORDER));
    const persisted = {
      workListStudiesSelectedColumns: ['AssignedUser', 'PatientName', 'Status', 'mrn'],
    };

    const migrated = migrateStudiesFiltersAndColumns(persisted, 0);

    // v0 -> v1: ReasonForReview spliced directly after Status.
    expect(migrated.workListStudiesSelectedColumns).toEqual([
      'AssignedUser',
      'PatientName',
      'Status',
      'ReasonForReview',
      'mrn',
    ]);
    // v1 -> v2: legacy order seeded.
    expect(migrated.workListColumnOrder).toEqual(LEGACY_ORDER);
  });

  it('does not re-run the v0 -> v1 splice for v1 state', () => {
    const persisted = {
      workListStudiesSelectedColumns: ['AssignedUser', 'Status'],
    };

    const migrated = migrateStudiesFiltersAndColumns(persisted, 1);

    // Untouched: the splice belongs to the v0 -> v1 step only.
    expect(migrated.workListStudiesSelectedColumns).toEqual(['AssignedUser', 'Status']);
  });
});

describe('store shape', () => {
  it('exposes per-interface column order state and setters', () => {
    const state = useStudiesTableFiltersAndColumnsStore.getState();

    expect(Array.isArray(state.workListColumnOrder)).toBe(true);
    expect(state.workListColumnOrder[0]).toBe('selector-settings-expander');
    expect(Array.isArray(state.allStudiesColumnOrder)).toBe(true);
    expect(Array.isArray(state.sharedColumnOrder)).toBe(true);
    expect(Array.isArray(state.uploadColumnOrder)).toBe(true);

    state.setWorkListColumnOrder(['selector-settings-expander', 'Status']);
    expect(useStudiesTableFiltersAndColumnsStore.getState().workListColumnOrder).toEqual([
      'selector-settings-expander',
      'Status',
    ]);
  });
});
