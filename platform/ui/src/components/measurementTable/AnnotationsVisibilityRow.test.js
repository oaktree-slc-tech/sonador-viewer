/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The Annotations drawer's search and visibility row. The toggle behaves as the Segmentations
// panel's all-segments toggle: Hide while every listed annotation is shown, Show while any is
// hidden; a click hides them unless all are hidden, then shows them all. Its help tag (a ui-next
// tooltip) names the action, the state while only some are hidden, and the matching count while a
// search is active. The search box is always there; the toggle only with annotations listed.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, values) => key.replace(/{{(\w+)}}/g, (_, name) => values[name]) }),
}));
jest.mock('@ohif/ui-next', () => {
  const InputFilter = ({ children, value, debounceTime }) => (
    <div data-filter data-controlled={value !== undefined ? 'yes' : 'no'} data-debounce={debounceTime}>{children}</div>
  );
  InputFilter.SearchIcon = () => <span data-icon="search" />;
  InputFilter.Input = props => <input {...props} />;
  InputFilter.ClearButton = () => <button type="button" data-clear />;
  return {
    Button: ({ children, size, variant, ...props }) => <button type="button" {...props}>{children}</button>,
    Icons: { Hide: () => <span data-icon="hide" />, Show: () => <span data-icon="show" /> },
    InputFilter,
    TooltipProvider: ({ children }) => children,
    Tooltip: ({ children }) => children,
    TooltipTrigger: ({ children }) => children,
    TooltipContent: ({ children, ...props }) => <div role="tooltip" {...props}>{children}</div>,
  };
}, { virtual: true });

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
const render = (collection, props = {}) => {
  const onToggleAllVisibility = jest.fn();
  act(() => root.render(
    <AnnotationsVisibilityRow measurementCollection={collection} onToggleAllVisibility={onToggleAllVisibility} {...props} />));
  return onToggleAllVisibility;
};
const toggle = () => container.querySelector('[data-cy="all-annotations-visibility-toggle"]');
const tip = () => container.querySelector('[data-cy="all-annotations-visibility-tooltip"]');

it('offers Hide while every annotation is shown, and hides them all on click', () => {
  const onToggle = render(groups(true, true, undefined));
  expect(toggle().querySelector('[data-icon="hide"]')).not.toBeNull();
  expect(toggle().getAttribute('aria-label')).toBe('Hide All Annotations');
  expect(toggle().hasAttribute('title')).toBe(false);
  expect(tip().textContent).toBe('Hide All Annotations');
  act(() => toggle().click());
  expect(onToggle).toHaveBeenCalledWith(false);
});

it('marks some annotations hidden with the Show icon, says so in its help tag, and hides the rest on click', () => {
  const onToggle = render(groups(true, false, true));
  expect(toggle().querySelector('[data-icon="show"]')).not.toBeNull();
  expect(toggle().getAttribute('aria-label')).toBe('Some annotations are hidden. Hide All Annotations');
  expect(tip().textContent).toBe('Hide All AnnotationsSome annotations are hidden.');
  act(() => toggle().click());
  expect(onToggle).toHaveBeenCalledWith(false);
});

it('offers Show while every annotation is hidden, and shows them all on click', () => {
  const onToggle = render(groups(false, false));
  expect(toggle().querySelector('[data-icon="show"]')).not.toBeNull();
  expect(toggle().getAttribute('aria-label')).toBe('Show All Annotations');
  act(() => toggle().click());
  expect(onToggle).toHaveBeenCalledWith(true);
});

it('names the matching annotations it acts on while a search is active', () => {
  render(groups(true, true), { searching: true });
  expect(toggle().getAttribute('aria-label')).toBe('Hide 2 Matching Annotations');
  render(groups(false, true), { searching: true });
  expect(tip().textContent).toBe('Hide 2 Matching AnnotationsSome matching annotations are hidden.');
});

it('keeps the search box without annotations, and has no toggle then', () => {
  render([{ groupName: 'Measurements', measurements: [] }], { searching: true });
  expect(toggle()).toBeNull();
  const input = container.querySelector('[data-cy="annotations-search"]');
  expect(input.getAttribute('placeholder')).toBe('Search annotations');
  expect(input.getAttribute('aria-label')).toBe('Search annotations');
  // The box keeps its own text, and the search is debounced
  expect(container.querySelector('[data-filter]').getAttribute('data-controlled')).toBe('no');
  expect(container.querySelector('[data-filter]').getAttribute('data-debounce')).toBe('300');
  render(undefined);
  expect(toggle()).toBeNull();
});
