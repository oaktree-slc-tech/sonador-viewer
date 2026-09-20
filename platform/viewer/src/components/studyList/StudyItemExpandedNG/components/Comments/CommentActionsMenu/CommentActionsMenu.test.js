/**
 * @jest-environment ./src/__tests__/jsdomEnvironment.js
 */
// Rendered tests for the per-comment actions menu: which items each kind of user gets, and that
// the menu works from the keyboard.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { commentActions } from '../commentPermissions';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
jest.mock('@ohif/ui/src/elements/Icon/icons/inline-edit.svg', () => ({ ReactComponent: () => null }));
jest.mock('@ohif/ui/src/elements/Svg/svgs/trash-bin.svg', () => ({ ReactComponent: () => null }));

import CommentActionsMenu from './CommentActionsMenu';

global.IS_REACT_ACT_ENVIRONMENT = true;

// Radix positions the menu with a ResizeObserver, which jsdom does not provide.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const MINE = { ID: 'c1', User: { id: 36 } };
const THEIRS = { ID: 'c2', User: { id: 13 } };
const ANONYMOUS = { ID: 'c3' };

let container;
let root;

const mount = (props) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<CommentActionsMenu {...props} />);
  });
};

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

const trigger = () => document.querySelector('[aria-label="Comment Actions"]');
const menuItems = () => Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent);

const keydown = (target, key) => {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
};

const openWithKeyboard = () => {
  act(() => {
    trigger().focus();
  });
  keydown(trigger(), 'Enter');
};

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));


describe('which actions each user gets', () => {
  const cases = [
    ['comment manager, own comment', { comment: MINE, currentUserId: 36, commentsEdit: true }, ['Edit Comment', 'Remove Comment']],
    ["comment manager, someone else's comment", { comment: THEIRS, currentUserId: 36, commentsEdit: true }, []],
    ["remove-only user, someone else's comment", { comment: THEIRS, currentUserId: 36, commentsRemove: true }, ['Remove Comment']],
    ['remove-only user, own comment', { comment: MINE, currentUserId: 36, commentsRemove: true }, ['Remove Comment']],
    ['modify-only user (no comment grants)', { comment: MINE, currentUserId: 36 }, []],
    ['comment manager, unknown identity', { comment: MINE, currentUserId: undefined, commentsEdit: true }, []],
    ['comment manager, comment without author', { comment: ANONYMOUS, currentUserId: 36, commentsEdit: true }, []],
    ['manager with remove, comment without author', { comment: ANONYMOUS, currentUserId: 36, commentsEdit: true, commentsRemove: true }, ['Remove Comment']],
  ];

  it.each(cases)('%s', async (_label, input, expected) => {
    mount({ ...commentActions(input), onEdit: jest.fn(), onRemove: jest.fn() });

    if (expected.length === 0) {
      // No permitted action: no trigger at all, not an empty menu.
      expect(trigger()).toBeNull();
      return;
    }

    expect(trigger()).not.toBeNull();
    openWithKeyboard();
    await settle();
    expect(menuItems()).toEqual(expected);
  });
});


describe('keyboard interaction', () => {
  it('opens with Enter, moves with the arrow keys, and selects with Enter', async () => {
    const onEdit = jest.fn();
    const onRemove = jest.fn();
    mount({ canEdit: true, canRemove: true, onEdit, onRemove });

    openWithKeyboard();
    await settle();

    expect(menuItems()).toEqual(['Edit Comment', 'Remove Comment']);

    // Opened from the keyboard, the first item takes focus; ArrowDown moves to the next.
    const focusedItem = () => document.activeElement?.closest('[role="menuitem"]')?.textContent;
    expect(focusedItem()).toBe('Edit Comment');

    keydown(document.activeElement, 'ArrowDown');
    // Roving focus moves on a timer.
    await settle();
    expect(focusedItem()).toBe('Remove Comment');

    keydown(document.activeElement, 'Enter');
    await settle();
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('Escape closes the menu and returns focus to the trigger', async () => {
    mount({ canEdit: true, canRemove: true, onEdit: jest.fn(), onRemove: jest.fn() });

    openWithKeyboard();
    await settle();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    keydown(document.activeElement, 'Escape');
    await settle();

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('reports when it opens, so a caller can resolve lazily-fetched grants', async () => {
    const onOpen = jest.fn();
    mount({ canRemove: true, onRemove: jest.fn(), onOpen });

    openWithKeyboard();
    await settle();

    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
