// Unit tests for the study-list save-on-change sync module (sonador#42 FR-17, AR-9): a
// changed interface slice produces exactly one debounced POST for that interface, and the
// hydration guard suppresses echo writes while remote values are applied to the store.

jest.mock('./preferenceWriteQueue', () => ({
  submitPreferenceWrite: jest.fn(),
  notifyPreferenceWriteQueued: jest.fn(),
}));

jest.mock('react-hot-toast', () => {
  const toast = jest.fn();
  toast.error = jest.fn();
  return { toast };
});

// Node test environment: shim localStorage before the store module loads (zustand persist
// touches storage at create()); hence require() below instead of import.
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

const { notifyPreferenceWriteQueued, submitPreferenceWrite } = require('./preferenceWriteQueue');
const { useStudiesTableFiltersAndColumnsStore } = require('../store/useStudiesTableFiltersAndColumnsStore');
const {
  setStudylistSyncHydrating,
  startStudylistPreferenceSync,
  stopStudylistPreferenceSync,
} = require('./studylistPreferenceSync');

const initialState = { ...useStudiesTableFiltersAndColumnsStore.getState() };

beforeEach(() => {
  jest.useFakeTimers();
  useStudiesTableFiltersAndColumnsStore.setState(initialState);
  submitPreferenceWrite.mockReset();
  submitPreferenceWrite.mockResolvedValue({ outcome: 'saved' });
  notifyPreferenceWriteQueued.mockReset();
});

afterEach(() => {
  stopStudylistPreferenceSync();
  jest.useRealTimers();
});

describe('startStudylistPreferenceSync (FR-17)', () => {
  it('produces zero POSTs at startup when nothing changes (AR-9: no echo writes)', async () => {
    startStudylistPreferenceSync();

    await jest.advanceTimersByTimeAsync(5000);
    expect(submitPreferenceWrite).not.toHaveBeenCalled();
  });

  it('submits exactly one debounced POST carrying only the changed interface', async () => {
    startStudylistPreferenceSync();

    useStudiesTableFiltersAndColumnsStore.getState().setWorkListColumnOrder([
      'selector-settings-expander',
      'Status',
      'PatientName',
    ]);

    // Not yet -- debounce is >= 1 s.
    await jest.advanceTimersByTimeAsync(500);
    expect(submitPreferenceWrite).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(600);
    expect(submitPreferenceWrite).toHaveBeenCalledTimes(1);

    const submission = submitPreferenceWrite.mock.calls[0][0];
    expect(submission.key).toBe('studylist:worklist');
    expect(submission.section).toBe('studylist');
    expect(Object.keys(submission.payload.values)).toEqual(['worklist']);

    // The full slice for the interface (FR-14 replace semantics), not a diff.
    const slice = submission.payload.values.worklist;
    expect(slice.columnOrder).toEqual(['selector-settings-expander', 'Status', 'PatientName']);
    expect(Array.isArray(slice.selectedColumns)).toBe(true);
    expect(Array.isArray(slice.selectedFilters)).toBe(true);
  });

  it('coalesces rapid changes to one interface into a single POST with the latest values', async () => {
    startStudylistPreferenceSync();

    const { setSharedStudiesSelectedFilters } = useStudiesTableFiltersAndColumnsStore.getState();
    setSharedStudiesSelectedFilters(['PatientID']);
    await jest.advanceTimersByTimeAsync(400);
    setSharedStudiesSelectedFilters(['PatientID', 'Modality']);
    await jest.advanceTimersByTimeAsync(1100);

    expect(submitPreferenceWrite).toHaveBeenCalledTimes(1);
    expect(submitPreferenceWrite.mock.calls[0][0].payload.values.shared.selectedFilters).toEqual([
      'PatientID',
      'Modality',
    ]);
  });

  it('submits per interface when two interfaces change (separate queue keys)', async () => {
    startStudylistPreferenceSync();

    useStudiesTableFiltersAndColumnsStore.getState().setWorkListStudiesSelectedColumns([
      'AssignedUser',
      'Status',
    ]);
    useStudiesTableFiltersAndColumnsStore.getState().setSharedStudiesSelectedFilters(['PatientID']);

    await jest.advanceTimersByTimeAsync(1100);

    const keys = submitPreferenceWrite.mock.calls.map(([{ key }]) => key).sort();
    expect(keys).toEqual(['studylist:shared', 'studylist:worklist']);
  });

  it('never includes selectedFilters in the upload slice (§5.1)', async () => {
    startStudylistPreferenceSync();

    useStudiesTableFiltersAndColumnsStore.getState().setUploadStudiesSelectedColumns(['PatientName']);
    await jest.advanceTimersByTimeAsync(1100);

    expect(submitPreferenceWrite).toHaveBeenCalledTimes(1);
    const slice = submitPreferenceWrite.mock.calls[0][0].payload.values.upload;
    expect(slice.selectedFilters).toBeUndefined();
    expect(slice.selectedColumns).toEqual(['PatientName']);
  });

  it('shows the once-per-session toast when a write is queued offline (FR-17)', async () => {
    submitPreferenceWrite.mockResolvedValue({ outcome: 'queued' });
    startStudylistPreferenceSync();

    useStudiesTableFiltersAndColumnsStore.getState().setSharedStudiesSelectedFilters(['PatientID']);
    await jest.advanceTimersByTimeAsync(1100);

    expect(notifyPreferenceWriteQueued).toHaveBeenCalledTimes(1);
  });
});

describe('hydration guard (AR-9)', () => {
  it('suppresses echo POSTs while remote values are applied, then diffs from the new baseline', async () => {
    startStudylistPreferenceSync();

    setStudylistSyncHydrating(true);
    useStudiesTableFiltersAndColumnsStore.setState({
      workListColumnOrder: ['selector-settings-expander', 'PatientName'],
    });
    setStudylistSyncHydrating(false);

    await jest.advanceTimersByTimeAsync(5000);
    expect(submitPreferenceWrite).not.toHaveBeenCalled();

    // A real user change after hydration still syncs.
    useStudiesTableFiltersAndColumnsStore.getState().setWorkListColumnOrder([
      'selector-settings-expander',
      'Status',
    ]);
    await jest.advanceTimersByTimeAsync(1100);
    expect(submitPreferenceWrite).toHaveBeenCalledTimes(1);
  });
});
