/**
 * @jest-environment ./src/__tests__/jsdomEnvironment.js
 */
// Rendered keyboard-interaction tests for the removal confirmation: focus lands on Cancel, Tab and
// Shift+Tab stay inside the dialog, Escape cancels (but not mid-removal), and focus returns to the
// control that opened the dialog, or to the caller's fallback when that control is gone.

import React, { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PropTypes from 'prop-types';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
jest.mock('@ohif/ui/src/elements/Svg/svgs/trash-bin.svg', () => ({ ReactComponent: () => null }));
jest.mock('@ohif/ui/src/elements/Svg/svgs/close.svg', () => ({ ReactComponent: () => null }));

import RemoveResourceConfirm from './RemoveResourceConfirm';

global.IS_REACT_ACT_ENVIRONMENT = true;

const COMMENT = {
  ID: '0f3c5c2e-1d7a-4b9c-9a1e-5d2f6b8c4a10',
  User: { first_name: 'Ada', last_name: 'Lovelace' },
  LastUpdate: '2026-09-19T14:03:27.123456',
  Text: 'Looks fine.',
};


function Harness({ isRemoving = false, withFallback = false, onCancel, onConfirm }) {
  // The comment panel's shape: a Remove control per comment, a compose box that survives a
  // removal, and the confirmation mounted while a removal is pending.
  const [open, setOpen] = useState(false);
  const [triggerGone, setTriggerGone] = useState(false);
  const composeRef = useRef(null);

  return (
    <div>
      {!triggerGone && (
        <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
          Remove Comment
        </button>
      )}
      <textarea data-testid="compose" ref={composeRef} />
      {open && (
        <RemoveResourceConfirm
          kind="comment"
          descriptor={COMMENT}
          isRemoving={isRemoving}
          fallbackFocusRef={withFallback ? composeRef : null}
          onConfirm={() => {
            onConfirm();
            // The removed comment takes its Remove control with it.
            setTriggerGone(true);
            setOpen(false);
          }}
          onCancel={() => {
            onCancel();
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}


Harness.propTypes = {
  isRemoving: PropTypes.bool,
  withFallback: PropTypes.bool,
  onCancel: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
};


const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);
const dialog = () => document.querySelector('[role="dialog"]');
const buttonNamed = (text) => Array.from(dialog().querySelectorAll('button')).find((b) => b.textContent.includes(text));

const keydown = (target, key, init = {}) => {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
};

// Focus restoration on close runs on a timer inside the dialog's focus scope.
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

let container;
let root;

const mount = (props) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<Harness {...props} />);
  });
};

const open = () => {
  const trigger = byTestId('trigger');
  act(() => {
    trigger.focus();
    trigger.click();
  });
  return trigger;
};

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});


describe('RemoveResourceConfirm keyboard behaviour', () => {
  it('opens as a named modal dialog with focus on Cancel', () => {
    mount({ onCancel: jest.fn(), onConfirm: jest.fn() });
    open();

    const el = dialog();
    expect(el).not.toBeNull();
    expect(el.getAttribute('aria-modal')).toBe('true');

    const title = document.getElementById(el.getAttribute('aria-labelledby'));
    expect(title.textContent).toBe('Remove this comment?');
    const description = document.getElementById(el.getAttribute('aria-describedby'));
    expect(description.textContent).toContain('cannot be recovered');

    expect(document.activeElement).toBe(buttonNamed('Cancel'));
  });

  it('keeps Tab and Shift+Tab inside the dialog', () => {
    mount({ onCancel: jest.fn(), onConfirm: jest.fn() });
    open();

    // Cancel is the last control: Tab wraps to the first, Remove.
    keydown(document.activeElement, 'Tab');
    expect(document.activeElement).toBe(buttonNamed('Remove'));

    // Remove is the first control: Shift+Tab wraps back to the last, Cancel.
    keydown(document.activeElement, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(buttonNamed('Cancel'));

    // Focus never left the dialog.
    expect(dialog().contains(document.activeElement)).toBe(true);
  });

  it('Escape cancels and returns focus to the control that opened it', async () => {
    const onCancel = jest.fn();
    mount({ onCancel, onConfirm: jest.fn() });
    const trigger = open();

    keydown(document.activeElement, 'Escape');
    await settle();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not dismiss while a removal is in flight', async () => {
    const onCancel = jest.fn();
    mount({ isRemoving: true, onCancel, onConfirm: jest.fn() });
    open();

    expect(buttonNamed('Removing...').disabled).toBe(true);
    expect(buttonNamed('Cancel').disabled).toBe(true);

    keydown(document.activeElement, 'Escape');
    await settle();

    expect(onCancel).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it('after a removal takes the opening control away, focus lands on the caller fallback', async () => {
    const onConfirm = jest.fn();
    mount({ withFallback: true, onCancel: jest.fn(), onConfirm });
    open();

    act(() => {
      buttonNamed('Remove').click();
    });
    await settle();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    expect(byTestId('trigger')).toBeNull();
    expect(document.activeElement).toBe(byTestId('compose'));
  });

  it('cancelling leaves the fallback alone when the opening control survives', async () => {
    mount({ withFallback: true, onCancel: jest.fn(), onConfirm: jest.fn() });
    const trigger = open();

    act(() => {
      buttonNamed('Cancel').click();
    });
    await settle();

    expect(document.activeElement).toBe(trigger);
  });
});
