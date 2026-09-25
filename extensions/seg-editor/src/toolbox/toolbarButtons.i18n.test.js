// Every palette label must resolve through the viewer's real i18next configuration and en-US
// locales. i18next 23 returns a namespace-prefixed key containing spaces ('Buttons:Radius (mm)')
// untranslated, prefix included; this guards against that and against missing locale keys.

import Buttons from '@ohif/i18n/src/locales/en-US/Buttons.json';
import SegmentationEditor from '@ohif/i18n/src/locales/en-US/SegmentationEditor.json';

import { getToolbarButtons } from './toolbarButtons';

jest.mock('@ohif/i18n', () => {
  const i18next = require('i18next');
  const instance = i18next.createInstance();
  instance.init({
    // As platform/i18n/src/index.js (local translation files)
    fallbackLng: 'en-US',
    lng: 'en-US',
    keySeparator: false,
    interpolation: { escapeValue: false },
    resources: {
      'en-US': {
        Buttons: require('@ohif/i18n/src/locales/en-US/Buttons.json'),
        SegmentationEditor: require('@ohif/i18n/src/locales/en-US/SegmentationEditor.json'),
      },
    },
    initImmediate: false,
  });
  return instance;
});
jest.mock('@ohif/extension-vtk', () => ({ Enums: { CORNERSTONE: {} } }));

function collectLabels(buttons) {
  const labels = [];
  buttons.forEach(({ id, props }) => {
    if (props.label) {
      labels.push([`${id}.label`, props.label]);
    }
    (props.options ?? []).forEach(option => {
      if (option.type !== 'double-range' && option.type !== 'custom') {
        labels.push([`${id}.${option.id}.name`, option.name]);
      }
      (option.values ?? []).forEach(value => labels.push([`${id}.${option.id}.${value.value}`, value.label]));
    });
  });
  return labels;
}

describe('palette labels', () => {
  const buttonValues = new Set(Object.values(Buttons));

  it.each(collectLabels(getToolbarButtons()))('%s is a translated Buttons label', (_where, label) => {
    expect(label).not.toMatch(/^[A-Za-z]+:/);
    expect(buttonValues.has(label)).toBe(true);
  });

  it('uses the OHIF v3 radius label', () => {
    const brush = getToolbarButtons().find(button => button.id === 'Brush');
    expect(brush.props.options.find(option => option.id === 'brush-radius').name).toBe('Radius (mm)');
  });

  it('resolves the evaluator messages', () => {
    const i18n = require('@ohif/i18n');
    ['The editor is not ready', 'Add a segment to enable this tool'].forEach(key => {
      expect(SegmentationEditor[key]).toBeDefined();
      expect(i18n.t(key, { ns: 'SegmentationEditor' })).toBe(SegmentationEditor[key]);
    });
  });

  it('documents the i18next behaviour the option form works around', () => {
    const i18n = require('@ohif/i18n');
    expect(i18n.t('Buttons:Radius (mm)')).toBe('Buttons:Radius (mm)');
    expect(i18n.t('Radius (mm)', { ns: 'Buttons' })).toBe('Radius (mm)');
  });
});
