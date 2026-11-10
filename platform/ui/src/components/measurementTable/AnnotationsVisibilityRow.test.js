/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The Annotations drawer's all-annotations toggle behaves as the Segmentations panel's
// all-segments toggle: Hide while every annotation is shown, Show while any is hidden; a click hides
// them all unless all are hidden, then shows them all; and no toggle without annotations.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key }) }));
jest.mock('@ohif/ui-next', () => ({
  Button: ({ children, ...props }) => <button type="button" {...props}>{children}</button>,
  Icons: { Hide: () => <span data-icon="hide" />, Show: () => <span data-icon="show" /> },
}), { virtual: true });

import { AnnotationsVisibilityRow } from './AnnotationsVisibilityRow';

global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const groups = (...visibility) => [
  { groupName: 'Measurements', measurements: visibility.slice(0, 1).map(isVisible => ({ isVisible })) },
  { groupName: 'Pending Measurements', measurements: visibility.slice(1).map(isVisible => ({ isVisible })) },
];
const render = (collection, onToggleAllVisibility = jest.fn()) => {
  act(() => root.render(<AnnotationsVisibilityRow measurementCollection={collection} onToggleAllVisibility={onToggleAllVisibility} />));
  return onToggleAllVisibility;
};
const toggle = () => container.querySelector('[data-cy="all-annotations-visibility-toggle"]');

it('offers Hide while every annotation is shown, and hides them all on click', () => {
  const onToggle = render(groups(true, true, undefined));
  expect(toggle().querySelector('[data-icon="hide"]')).not.toBeNull();
  expect(toggle().getAttribute('aria-label')).toBe('Hide all annotations');
  act(() => toggle().click());
  expect(onToggle).toHaveBeenCalledWith(false);
});

it('marks some annotations hidden with the Show icon, says so in its label, and hides the rest on click', () => {
  const onToggle = render(groups(true, false, true));
  expect(toggle().querySelector('[data-icon="show"]')).not.toBeNull();
  expect(toggle().getAttribute('aria-label')).toBe('Some annotations are hidden. Hide all annotations');
  expect(toggle().getAttribute('title')).toBe('Some annotations are hidden. Hide all annotations');
  act(() => toggle().click());
  expect(onToggle).toHaveBeenCalledWith(false);
});

it('offers Show while every annotation is hidden, and shows them all on click', () => {
  const onToggle = render(groups(false, false));
  expect(toggle().querySelector('[data-icon="show"]')).not.toBeNull();
  expect(toggle().getAttribute('aria-label')).toBe('Show all annotations');
  act(() => toggle().click());
  expect(onToggle).toHaveBeenCalledWith(true);
});

it('is absent without annotations', () => {
  render([{ groupName: 'Measurements', measurements: [] }]);
  expect(toggle()).toBeNull();
  render(undefined);
  expect(toggle()).toBeNull();
});
