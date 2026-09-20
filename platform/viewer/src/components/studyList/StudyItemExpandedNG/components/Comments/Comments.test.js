/**
 * @jest-environment ./src/__tests__/jsdomEnvironment.js
 */
// Rendered workflow tests for the comment panel's editor: which comments get a menu, save and
// cancel, failure keeping the draft, a comment removed meanwhile, an older save not closing a
// newer editor, and a resource switch discarding the draft.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockShow = jest.fn();
const mockInvalidate = jest.fn(() => Promise.resolve());
const mockMutations = {};
const mockAcl = { aclCommentEdit: true, aclRemove: false, resolveSeriesAcl: jest.fn(), refresh: jest.fn() };
let mockSeriesComments = [];

jest.mock('react-redux', () => ({ useSelector: () => ({ wadoRoot: 'https://orthanc.test/dicom-web' }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
jest.mock('react-markdown', () => {
  const ReactLib = require('react');
  return { __esModule: true, default: ({ children }) => ReactLib.createElement('p', { 'data-testid': 'markdown' }, children) };
});
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));
jest.mock('@ohif/core', () => ({ uiNotificationService: { show: (...args) => mockShow(...args) } }));
jest.mock('@ohif/ui/src/components/Loader/Loader', () => () => null);
jest.mock('@ohif/ui/src/elements/Icon/icons/inline-edit.svg', () => ({ ReactComponent: () => null }));
jest.mock('@ohif/ui/src/elements/Svg/svgs/trash-bin.svg', () => ({ ReactComponent: () => null }));
jest.mock('@ohif/ui/src/elements/Svg/svgs/close.svg', () => ({ ReactComponent: () => null }));
jest.mock('../../../../../hooks/useServerSystemInfo', () => () => ({ sysInfo: { User: { id: 36 } } }));
jest.mock('../../../../../hooks/useResourceAclPermissions', () => () => mockAcl);
jest.mock('./NoCommentsPlaceholder/NoCommentsPlaceholder', () => () => null);

const mockMutation = (name) => {
  if (!mockMutations[name]) {
    mockMutations[name] = { mutateAsync: jest.fn(), isLoading: false, mutate: jest.fn() };
  }
  return mockMutations[name];
};

jest.mock('./logic', () => ({
  ALL_SERIES_COMMENTS_QUERY_KEY: 'all',
  SERIES_COMMENTS_QUERY_KEY: 'series',
  STUDY_COMMENTS_QUERY_KEY: 'study',
  useSeriesComments: () => ({ data: mockSeriesComments, isLoading: false }),
  useStudyComments: () => ({ data: [], isLoading: false }),
  useCreateSeriesComment: () => mockMutation('createSeries'),
  useCreateStudyComment: () => mockMutation('createStudy'),
  useUpdateSeriesComment: () => mockMutation('updateSeries'),
  useUpdateStudyComment: () => mockMutation('updateStudy'),
  useRemoveSeriesComment: () => mockMutation('removeSeries'),
  useRemoveStudyComment: () => mockMutation('removeStudy'),
}));

import Comments from './Comments';

global.IS_REACT_ACT_ENVIRONMENT = true;
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const MINE = { ID: 'c-mine', Text: 'my text', LastUpdate: '2026-09-19T14:03:27.1', User: { id: 36, username: 'me' } };
const MINE_2 = { ID: 'c-mine-2', Text: 'my second', LastUpdate: '2026-09-19T14:04:27.1', User: { id: 36, username: 'me' } };
const THEIRS = { ID: 'c-theirs', Text: 'their text', LastUpdate: '2026-09-19T14:05:27.1', User: { id: 13, username: 'other' } };
const SERIES_A = { SeriesInstanceUID: '1.2.3.4.5', StudyInstanceUID: '1.2.3.4' };
const SERIES_B = { SeriesInstanceUID: '1.2.3.4.6', StudyInstanceUID: '1.2.3.4' };

let container;
let root;

const render = (props) => {
  act(() => {
    root.render(<Comments {...props} />);
  });
};

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
const menusFor = () => Array.from(document.querySelectorAll('[aria-label="Comment Actions"]'));

const openEditorFor = async (index) => {
  const trigger = menusFor()[index];
  act(() => { trigger.focus(); });
  act(() => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
  await settle();
  const edit = Array.from(document.querySelectorAll('[role="menuitem"]')).find((el) => el.textContent === 'Edit Comment');
  act(() => { edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
  await settle();
  return container.querySelector('textarea[aria-label="Edit Comment"]');
};

const setValue = (textarea, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  act(() => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const saveButton = () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Save' || b.textContent === 'Saving...');
const editor = () => container.querySelector('textarea[aria-label="Edit Comment"]');

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockMutations).forEach((k) => delete mockMutations[k]);
  mockAcl.aclCommentEdit = true;
  mockAcl.aclRemove = false;
  mockSeriesComments = [MINE, THEIRS, MINE_2];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});


describe('which comments get a menu', () => {
  it('own comments under comment_edit; others only with remove', () => {
    render({ series: SERIES_A, studyInstanceUID: SERIES_A.StudyInstanceUID });
    expect(menusFor()).toHaveLength(2);

    mockAcl.aclRemove = true;
    render({ series: SERIES_A, studyInstanceUID: SERIES_A.StudyInstanceUID });
    expect(menusFor()).toHaveLength(3);

    mockAcl.aclCommentEdit = false;
    mockAcl.aclRemove = false;
    render({ series: SERIES_A, studyInstanceUID: SERIES_A.StudyInstanceUID });
    expect(menusFor()).toHaveLength(0);
    // and the compose box follows comment_edit
    expect(container.querySelector('textarea')).toBeNull();
  });
});


describe('editing', () => {
  it('saves through the series mutation and closes the editor', async () => {
        render({ series: SERIES_A, studyInstanceUID: SERIES_A.StudyInstanceUID });
    mockMutations.updateSeries.mutateAsync.mockResolvedValue({ ID: 'c-mine' });

    const textarea = await openEditorFor(0);
    expect(textarea.value).toBe('my text');
    expect(saveButton().disabled).toBe(true);   // unchanged

    setValue(textarea, 'revised');
    expect(saveButton().disabled).toBe(false);
    await act(async () => { saveButton().click(); });
    await settle();

    expect(mockMutations.updateSeries.mutateAsync).toHaveBeenCalledWith({ commentId: 'c-mine', text: 'revised' });
    expect(editor()).toBeNull();
    expect(mockShow).not.toHaveBeenCalled();
  });

  it('Cancel and Escape close the editor without saving', async () => {
    render({ series: SERIES_A, studyInstanceUID: SERIES_A.StudyInstanceUID });
    let textarea = await openEditorFor(0);
    act(() => { Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Cancel').click(); });
    expect(editor()).toBeNull();

    textarea = await openEditorFor(0);
    act(() => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(editor()).toBeNull();
    expect(mockMutations.updateSeries.mutateAsync).not.toHaveBeenCalled();
  });

  it('a refused or failed save keeps the draft and raises a sticky error', async () => {
    render({ series: SERIES_A, studyInstanceUID: SERIES_A.StudyInstanceUID });
    const err = Object.assign(new Error('refused'), { status: 400, url: 'u', body: '{"errors":{"User":[]}}' });
    mockMutations.updateSeries.mutateAsync.mockRejectedValue(err);

    const textarea = await openEditorFor(0);
    setValue(textarea, 'revised');
    await act(async () => { saveButton().click(); });
    await settle();

    expect(editor()).not.toBeNull();
    expect(editor().value).toBe('revised');
    expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({ title: 'Comment not updated', type: 'error', autoClose: false }));
    // a refusal means the grants may have changed
    expect(mockAcl.refresh).toHaveBeenCalled();
  });

  it('a comment removed meanwhile (404) closes the editor with a warning and refreshes', async () => {
    render({ series: SERIES_A, studyInstanceUID: SERIES_A.StudyInstanceUID });
    mockMutations.updateSeries.mutateAsync.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));

    const textarea = await openEditorFor(0);
    setValue(textarea, 'revised');
    await act(async () => { saveButton().click(); });
    await settle();

    expect(editor()).toBeNull();
    expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({ title: 'Comment no longer exists', type: 'warning' }));
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it('an older save completing does not close a newer editor on another comment', async () => {
    render({ series: SERIES_A, studyInstanceUID: SERIES_A.StudyInstanceUID });
    let resolveSave;
    mockMutations.updateSeries.mutateAsync.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));

    // Start saving the first comment...
    const first = await openEditorFor(0);
    setValue(first, 'first revised');
    await act(async () => { saveButton().click(); });

    // ...then open the second comment's editor and type a draft.
    const second = await openEditorFor(1);
    setValue(second, 'second draft');

    // The first save now completes.
    await act(async () => { resolveSave({ ID: 'c-mine' }); });
    await settle();

    expect(editor()).not.toBeNull();
    expect(editor().value).toBe('second draft');
  });

  it('switching to another series discards an edit in progress', async () => {
    render({ series: SERIES_A, studyInstanceUID: SERIES_A.StudyInstanceUID });
    const textarea = await openEditorFor(0);
    setValue(textarea, 'draft');

    render({ series: SERIES_B, studyInstanceUID: SERIES_B.StudyInstanceUID });
    expect(editor()).toBeNull();
  });
});
