/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// The labelling flows stay open until the user confirms or dismisses them (close button or
// Escape), Escape steps back before it closes, and the Series Tag card offers a Location picker.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

jest.mock('../../elements/Icon/Icon.js', () => ({ __esModule: true, default: () => null }));
jest.mock('../../elements/Icon', () => ({ Icon: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key }) }));
jest.mock('@ohif/core', () => ({
  displayAttributes: {
    SERIES_TAG_TOOL: 'DICOMSRSeriesTagTool',
    getDisplayColor: meta => (meta && meta.DisplayAttributes && meta.DisplayAttributes.Color) || {},
    // Stands in for the site/built-in defaults: a Meaning color that no tag sets itself
    resolveDisplayColor: (tool, color) => ({ Background: null, Meaning: '#C0C7F8', ...color }),
  },
  sonador: { fetchGroupTags: jest.fn() },
}), { virtual: true });

import { sonador } from '@ohif/core';
import applyLabellingAttrs from '../../../../core/src/measurements/lib/applyLabellingAttrs';
import LabellingFlow from './LabellingFlow';
import SeriesTagLabellingFlow from './SeriesLabellingFlow';

global.IS_REACT_ACT_ENVIRONMENT = true;

const ANATOMY = [{ label: 'Bone', value: 'Bone' }, { label: 'Liver', value: 'Liver' }];
const TAGS = [
  { label: 'Image Rejected', value: 'img-qc.reject', scheme: 'Sonador-SEG', schemeVersion: '0.2' },
  { label: 'Metal Artifact', value: 'img-qc.metal-artifact', scheme: 'Visionaire-QC', schemeVersion: '0.2' },
  {
    label: 'Image Blur', value: 'img-qc.motion-blur', scheme: 'Visionaire-QC', schemeVersion: '0.2',
    meta: { DisplayAttributes: { Color: { Background: '#1E3A8A', Meaning: '#FDF1F0' } } },
  },
];

let container;
let root;

beforeEach(() => {
  jest.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.useRealTimers();
});

const render = element => act(() => root.render(element));
const remount = () => {
  act(() => root.unmount());
  root = createRoot(container);
};
const press = key => act(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
});
const wait = ms => act(() => jest.advanceTimersByTime(ms));
const pick = label => act(() => {
  const option = [...container.querySelectorAll('.radioLabel')].find(l => l.textContent === label);
  option.querySelector('input').click();
});
const button = text => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === text);
const click = element => act(() => element.click());
const closeButton = () => container.querySelector('.labellingCloseButton');
const pickerShown = () => Boolean(container.querySelector('.selectTreeRoot'));
const cardShown = () => Boolean(container.querySelector('.locationDescriptionWrapper'));
const descriptionInput = () => container.querySelector('#descriptionInput');
const typeDescription = text => {
  descriptionInput().value = text;
};
const keyDown = (element, key) => act(() => {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
});


describe('LabellingFlow (Location)', () => {
  const renderFlow = (props = {}) => {
    const callbacks = { updateLabelling: jest.fn(), labellingDoneCallback: jest.fn() };
    render(
      <LabellingFlow
        measurementData={{ description: 'Old' }}
        editLocation
        skipAddLabelButton
        labelData={ANATOMY}
        {...callbacks}
        {...props}
      />
    );
    return callbacks;
  };

  it('no longer closes when the pointer leaves', () => {
    const { labellingDoneCallback } = renderFlow();
    act(() => {
      container.querySelector('.labellingComponent')
        .dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    });
    // The old flow faded out 1 s after the pointer left, then ran a 0.5 s exit transition
    wait(1500);
    wait(1500);
    expect(labellingDoneCallback).not.toHaveBeenCalled();
    expect(pickerShown()).toBe(true);
  });

  it('closes on Escape from the picker it opened with, without changing the measurement', () => {
    const { updateLabelling, labellingDoneCallback } = renderFlow();
    press('Escape');
    wait(600);
    expect(labellingDoneCallback).toHaveBeenCalledTimes(1);
    expect(updateLabelling).not.toHaveBeenCalled();
  });

  it('closes at once from the close button, Escape and the check, with no exit fade', () => {
    const closed = renderFlow();
    click(closeButton());
    expect(closed.labellingDoneCallback).toHaveBeenCalledTimes(1);

    remount();
    const escaped = renderFlow();
    press('Escape');
    expect(escaped.labellingDoneCallback).toHaveBeenCalledTimes(1);

    remount();
    const checked = renderFlow();
    pick('Bone');
    click(container.querySelector('.checkIconWrapper'));
    expect(checked.labellingDoneCallback).toHaveBeenCalledTimes(1);
  });

  it('steps back with Escape: description edit, then a picker reopened from the card, then closes', () => {
    const { updateLabelling, labellingDoneCallback } = renderFlow();
    pick('Liver');
    expect(updateLabelling).toHaveBeenCalledWith({ location: 'Liver', locationLabel: 'Liver' });
    expect(cardShown()).toBe(true);
    expect(closeButton().className).toContain('onCard');

    click(button('Edit Description'));
    expect(container.querySelector('.labellingComponent').className).toContain('editDescription');
    press('Escape');
    expect(container.querySelector('.labellingComponent').className).not.toContain('editDescription');
    expect(labellingDoneCallback).not.toHaveBeenCalled();

    click(button('Change Location'));
    expect(pickerShown()).toBe(true);
    press('Escape');
    expect(cardShown()).toBe(true);
    expect(labellingDoneCallback).not.toHaveBeenCalled();

    press('Escape');
    wait(600);
    expect(labellingDoneCallback).toHaveBeenCalledTimes(1);
  });

  it('keeps one committed description: Escape restores it, Save replaces it, a picker round trip keeps it', () => {
    const { updateLabelling } = renderFlow();
    pick('Liver');
    expect(descriptionInput().value).toBe('Old');

    // Cancelling an edit of the initial description restores it
    click(button('Edit Description'));
    typeDescription('Draft');
    press('Escape');
    expect(descriptionInput().value).toBe('Old');

    // A saved replacement survives a picker round trip, by selection or by Escape
    click(button('Edit Description'));
    typeDescription('Saved replacement');
    click(button('Save'));
    expect(updateLabelling).toHaveBeenLastCalledWith({ description: 'Saved replacement' });

    click(button('Change Location'));
    pick('Bone');
    expect(descriptionInput().value).toBe('Saved replacement');

    click(button('Change Location'));
    press('Escape');
    expect(descriptionInput().value).toBe('Saved replacement');

    click(button('Edit Description'));
    click(button('Save'));
    expect(updateLabelling).toHaveBeenLastCalledWith({ description: 'Saved replacement' });
  });

  it('Edit Description → Change Location → Escape returns to the card with the committed description', () => {
    const { updateLabelling, labellingDoneCallback } = renderFlow();
    pick('Liver');
    click(button('Edit Description'));
    typeDescription('Unsaved');
    click(button('Change Location'));
    expect(pickerShown()).toBe(true);

    expect(() => press('Escape')).not.toThrow();
    expect(cardShown()).toBe(true);
    expect(container.querySelector('.labellingComponent').className).not.toContain('editDescription');
    expect(descriptionInput().value).toBe('Old');
    expect(labellingDoneCallback).not.toHaveBeenCalled();
    expect(updateLabelling).not.toHaveBeenCalledWith({ description: 'Unsaved' });
  });

  it('is keyboard-operable: Enter picks a focused option, Done is a native button, keys stay in the flow', () => {
    const { updateLabelling, labellingDoneCallback } = renderFlow();
    const viewerHotkeys = jest.fn();
    document.addEventListener('keydown', viewerHotkeys);

    const option = [...container.querySelectorAll('.radioLabel')].find(l => l.textContent === 'Bone');
    keyDown(option.querySelector('input'), 'Enter');
    expect(updateLabelling).toHaveBeenCalledTimes(1);
    expect(updateLabelling).toHaveBeenCalledWith({ location: 'Bone', locationLabel: 'Bone' });

    const done = container.querySelector('.checkIconWrapper');
    expect(done.tagName).toBe('BUTTON');
    expect(done.getAttribute('type')).toBe('button');
    keyDown(done, 'Enter');
    keyDown(done, ' ');
    expect(viewerHotkeys).not.toHaveBeenCalled();

    click(done);
    expect(labellingDoneCallback).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', viewerHotkeys);
  });

  describe('through the labellingDialog command callback', () => {
    // The callback body of the cornerstone `labellingDialog` command: apply the edit to the
    // measurement, then hand the measurement to the table update
    const renderWired = () => {
      const measurement = { location: 'Bone', description: 'Original description' };
      const tableUpdates = [];
      render(
        <LabellingFlow
          measurementData={{ ...measurement }}
          editLocation
          skipAddLabelButton
          labelData={ANATOMY}
          labellingDoneCallback={jest.fn()}
          updateLabelling={labellingData => {
            applyLabellingAttrs(measurement, labellingData);
            tableUpdates.push({ ...measurement });
          }}
        />
      );
      return tableUpdates;
    };

    it('location, then description: the table update keeps the new location', () => {
      const tableUpdates = renderWired();
      pick('Liver');
      click(button('Edit Description'));
      typeDescription('Saved replacement');
      click(button('Save'));

      expect(tableUpdates[tableUpdates.length - 1]).toEqual({ location: 'Liver', description: 'Saved replacement' });
      expect(container.querySelector('.location').textContent).toBe('Liver');
    });

    it('description, then location: the table update keeps the saved description', () => {
      const tableUpdates = renderWired();
      pick('Bone');
      click(button('Edit Description'));
      typeDescription('Saved replacement');
      click(button('Save'));
      click(button('Change Location'));
      pick('Liver');

      expect(tableUpdates[tableUpdates.length - 1]).toEqual({ location: 'Liver', description: 'Saved replacement' });
      expect(descriptionInput().value).toBe('Saved replacement');
    });
  });

  it('has no Location button on the card when the label is itself the location', () => {
    renderFlow();
    pick('Bone');
    expect(button('Add Location')).toBeUndefined();
  });
});


describe('SeriesTagLabellingFlow', () => {
  const renderSeries = (groups) => {
    const callbacks = {
      updateLabelling: jest.fn(),
      labellingDoneCallback: jest.fn(),
      labellingCanceledCallback: jest.fn(),
    };
    render(
      <SeriesTagLabellingFlow
        server={{}}
        groups={groups}
        measurementData={{}}
        skipAddLabelButton
        anatomyData={ANATOMY}
        {...callbacks}
      />
    );
    return callbacks;
  };

  beforeEach(() => {
    sonador.fetchGroupTags.mockReset();
    sonador.fetchGroupTags.mockReturnValue(Promise.resolve({
      json: () => Promise.resolve(TAGS.map(t => ({
        Meaning: t.label, Value: t.value, SchemeDesignator: t.scheme, SchemeVersion: t.schemeVersion, Meta: t.meta,
      }))),
    }));
  });

  const flush = () => act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  it('closes the group step on Escape or the close button, without tagging', () => {
    const escaped = renderSeries([{ id: 1, name: 'A' }, { id: 2, name: 'B' }]);
    expect(pickerShown()).toBe(true);
    press('Escape');
    expect(escaped.labellingDoneCallback).toHaveBeenCalledTimes(1);

    remount();
    const closed = renderSeries([{ id: 1, name: 'A' }, { id: 2, name: 'B' }]);
    click(closeButton());
    expect(closed.labellingDoneCallback).toHaveBeenCalledTimes(1);
    expect(closed.updateLabelling).not.toHaveBeenCalled();
  });

  it('tags, then sets the anatomic location from the card', async () => {
    const { updateLabelling, labellingDoneCallback } = renderSeries([{ id: 1, name: 'QC' }]);
    await flush();
    await flush();
    pick('Metal Artifact');
    expect(updateLabelling).toHaveBeenLastCalledWith(expect.objectContaining({
      value: 'img-qc.metal-artifact', scheme: 'Visionaire-QC', schemeVersion: '0.2',
    }));

    click(button('Add Location'));
    expect(container.querySelector('.wrapperText').textContent).toBe('Set Location');
    pick('Bone');
    expect(updateLabelling).toHaveBeenLastCalledWith({ location: 'Bone' });
    expect(container.querySelector('.location .anatomy').textContent).toBe('Bone');
    expect(button('Change Location')).toBeDefined();

    // Escape from the Location picker returns to the card; the tag stays
    click(button('Change Location'));
    press('Escape');
    expect(cardShown()).toBe(true);
    expect(labellingDoneCallback).not.toHaveBeenCalled();
  });

  it("uses the tag's display colors: Background fills the check, Meaning colors the lifted label", async () => {
    renderSeries([{ id: 1, name: 'QC' }]);
    await flush();
    await flush();
    pick('Image Blur');

    const check = container.querySelector('.checkIconWrapper');
    const label = () => container.querySelector('.locationDescriptionWrapper .location');
    expect(check.style.backgroundColor).toBe('rgb(30, 58, 138)');
    expect(label().style.color).toBe('');

    click(button('Add Description'));
    expect(label().style.color).toBe('rgb(253, 241, 240)');
    expect(container.querySelector('#descriptionInput').style.color).toBe('');

    press('Escape');
    expect(label().style.color).toBe('');
  });

  it('Edit Description → Add Location → Escape returns to the card safely', async () => {
    const { labellingDoneCallback } = renderSeries([{ id: 1, name: 'QC' }]);
    await flush();
    await flush();
    pick('Metal Artifact');
    click(button('Add Description'));
    typeDescription('Unsaved');
    click(button('Add Location'));
    expect(pickerShown()).toBe(true);

    expect(() => press('Escape')).not.toThrow();
    expect(cardShown()).toBe(true);
    expect(descriptionInput().value).toBe('');
    expect(labellingDoneCallback).not.toHaveBeenCalled();
  });

  it('keeps the default check fill and label color for a tag that sets neither', async () => {
    renderSeries([{ id: 1, name: 'QC' }]);
    await flush();
    await flush();
    pick('Metal Artifact');
    expect(container.querySelector('.checkIconWrapper').style.backgroundColor).toBe('');

    click(button('Add Description'));
    expect(container.querySelector('.locationDescriptionWrapper .location').style.color).toBe('');
  });
});


describe('while a labelling flow is open', () => {
  // A viewport beside the dialog, listening as cornerstone-tools does (bubbling, on the element)
  let viewport;
  let received;
  beforeEach(() => {
    received = [];
    viewport = document.createElement('div');
    viewport.className = 'viewport-element';
    ['mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'wheel', 'touchstart', 'contextmenu']
      .forEach(type => viewport.addEventListener(type, () => received.push(type)));
    document.body.appendChild(viewport);
    container.className = 'DraggableItem';
  });
  afterEach(() => {
    viewport.remove();
    container.className = '';
  });

  const send = (target, type) => act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  });
  const flow = () => render(
    <LabellingFlow measurementData={{}} labelData={ANATOMY} labellingDoneCallback={() => {}} updateLabelling={() => {}} />
  );

  it('keeps pointer input from the viewport, letting a release through', () => {
    flow();
    ['mousedown', 'mousemove', 'click', 'dblclick', 'wheel', 'touchstart', 'contextmenu'].forEach(type => send(viewport, type));
    send(viewport, 'mouseup');
    expect(received).toEqual(['mouseup']);
  });

  it('leaves input inside the flow to the flow', () => {
    flow();
    const inside = [];
    container.addEventListener('mousedown', () => inside.push('mousedown'));
    send(container.querySelector('.labellingComponent'), 'mousedown');
    expect(inside).toEqual(['mousedown']);
  });

  it('gives the viewport its input back once the flow closes', () => {
    flow();
    remount();
    send(viewport, 'mousedown');
    expect(received).toEqual(['mousedown']);
  });
});
