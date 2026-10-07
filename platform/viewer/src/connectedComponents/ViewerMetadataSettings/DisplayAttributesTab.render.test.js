/**
 * @jest-environment ./src/__tests__/jsdomEnvironment.js
 */
// Rendered test for the add control's pending state: while a create is in flight, repeated
// activation issues no second request and the button stays disabled; after the request settles,
// successfully or not, the control is usable again.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const mockPendingCreate = { current: null };
const mockCreateDisplayAttribute = jest.fn(() => {
  mockPendingCreate.current = deferred();
  return mockPendingCreate.current.promise;
});

jest.mock('../../api/displayAttributes', () => ({
  createDisplayAttribute: (...args) => mockCreateDisplayAttribute(...args),
  updateDisplayAttribute: jest.fn(),
  removeDisplayAttribute: jest.fn(),
}));
jest.mock('../../hooks/useDisplayAttributes', () => ({
  ENABLED_GROUPS_FILTER: { display_attr: true },
  displayAttributesQueryKey: () => ['displayAttributes', 'srv'],
  useDisplayAttributeCollection: () => ({
    data: { tags: [], permissions: { display_attr: true, display_attr_modify: true } },
    isLoading: false,
    error: null,
  }),
}));
jest.mock('../../hooks/useTags', () => () => ({
  data: { Series: { '0008,0080': { code: '0008,0080', tag: 'InstitutionName', label: 'Institution Name' } } },
}));
jest.mock('../../components/GroupSearch/GroupSearch', () => ({ onChange }) => (
  <button type="button" data-testid="pick-group" onClick={() => onChange({ id: 5, name: 'alpha' })}>
    pick group
  </button>
));
jest.mock('@ohif/core', () => ({ uiNotificationService: { show: jest.fn() } }));
jest.mock('@ohif/ui/src/components/ModalNG/ModalNG', () => () => null);
jest.mock('@ohif/ui/src/elements/Icon/icons/times.svg', () => ({ ReactComponent: () => null }));
jest.mock('@ohif/ui/src/elements/Svg/svgs/add-circle.svg', () => ({ ReactComponent: () => null }));
jest.mock('@ohif/ui/src/elements/Svg/svgs/edit.svg', () => ({ ReactComponent: () => null }));
jest.mock('@ohif/ui/src/elements/Svg/svgs/trash-bin.svg', () => ({ ReactComponent: () => null }));

import DisplayAttributesTab from './DisplayAttributesTab';

global.IS_REACT_ACT_ENVIRONMENT = true;

const SERVER = { token: 'srv', rootUrl: 'https://orthanc.test' };

let container;
let root;

const render = () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    // The failed create is expected; keep its report out of the test output.
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <DisplayAttributesTab server={SERVER} />
      </QueryClientProvider>
    );
  });
};

const click = el => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const type = (input, value) =>
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

const addButton = () => Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Add Attribute'));

const pickAnAttribute = () => {
  click(container.querySelector('[data-testid="pick-group"]'));
  const search = container.querySelector('#display-attribute-catalogue-search');
  type(search, 'inst');
  const match = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Institution Name'));
  click(match);
};

// query-core batches observer notifications on a timeout, so settling means draining the macrotask queue.
const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 0)));

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  mockCreateDisplayAttribute.mockClear();
  mockPendingCreate.current = null;
});

describe('DisplayAttributesTab add control while a create is pending', () => {
  it('issues one request for repeated activation and re-enables after success', async () => {
    render();
    pickAnAttribute();
    expect(addButton().disabled).toBe(false);

    click(addButton());
    await settle();
    expect(mockCreateDisplayAttribute).toHaveBeenCalledTimes(1);
    expect(mockCreateDisplayAttribute).toHaveBeenCalledWith(SERVER, 5, { Code: '00080080', Label: '' });
    expect(addButton().disabled).toBe(true);

    click(addButton());
    click(addButton());
    await settle();
    expect(mockCreateDisplayAttribute).toHaveBeenCalledTimes(1);

    await act(async () => { mockPendingCreate.current.resolve({ ID: 'new' }); });
    await settle();

    // The selection is cleared after success, so the button is enabled again once a new pick is made.
    expect(addButton().disabled).toBe(true);
    pickAnAttribute();
    expect(addButton().disabled).toBe(false);
    click(addButton());
    await settle();
    expect(mockCreateDisplayAttribute).toHaveBeenCalledTimes(2);
  });

  it('re-enables after a failed create without clearing the selection', async () => {
    render();
    pickAnAttribute();
    click(addButton());
    await settle();
    expect(addButton().disabled).toBe(true);

    await act(async () => { mockPendingCreate.current.reject(new Error('Tag "0008,0080" is not indexed')); });
    await settle();

    expect(addButton().disabled).toBe(false);
    click(addButton());
    await settle();
    expect(mockCreateDisplayAttribute).toHaveBeenCalledTimes(2);
  });
});
