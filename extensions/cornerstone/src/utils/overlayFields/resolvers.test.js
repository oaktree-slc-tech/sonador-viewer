import { STANDARD_FIELDS, tagFieldValue } from '@ohif/core/src/utils/overlayFields';

import { buildOverlayContext, resolveOverlayItem } from './resolvers';

const modules = {
  generalSeriesModule: {
    seriesNumber: 4,
    seriesDescription: 'AX T1',
    modality: 'MR',
    seriesInstanceUID: '1.2.3.4',
    studyInstanceUID: '1.2.3',
  },
  imagePlaneModule: { rows: 256, columns: 512, sliceThickness: 3, sliceLocation: -12.345 },
  generalStudyModule: { studyDate: '20240131', studyTime: '134512', studyDescription: 'Knee', accessionNumber: 'ACC1' },
  patientModule: { patientId: 'P001', patientName: 'Doe^Jane' },
  generalImageModule: { instanceNumber: 7, lossyImageCompression: '00' },
  cineModule: { frameTime: 40 },
  instance: {
    Rows: 256,
    Columns: 512,
    PixelSpacing: [0.9375, 0.46875],
    SliceThickness: 3,
    SpacingBetweenSlices: 4,
    ProtocolName: '',
    AcquisitionProtocolName: 'Knee 3D',
    ImageLaterality: 'R',
    '0043102D': 'W',
  },
};

const metaData = { get: (type, imageId) => (imageId === 'img-1' ? modules[type] : undefined) };

const props = { imageId: 'img-1', scale: 1.25, windowWidth: 400, windowCenter: 40, imageIndex: 7, stackSize: 20 };

function resolve(value, extra = {}) {
  const ctx = buildOverlayContext(props, { metaData, ...extra });
  return resolveOverlayItem({ title: 'Any', value }, ctx);
}

describe('buildOverlayContext', () => {
  it('reads every module once and exposes the instance', () => {
    const get = jest.fn(metaData.get);
    const ctx = buildOverlayContext(props, { metaData: { get } });

    expect(get).toHaveBeenCalledTimes(7);
    expect(ctx.instance.ProtocolName).toBe('');
    expect(ctx.modules.patientModule.patientId).toBe('P001');
  });

  it('tolerates a throwing provider and a missing instance', () => {
    const ctx = buildOverlayContext(props, {
      metaData: {
        get: () => {
          throw new Error('no provider');
        },
      },
    });

    expect(ctx.instance).toBeUndefined();
    expect(ctx.modules.patientModule).toEqual({});
    expect(ctx.getSeriesInstances()).toBeNull();
  });

  it('resolves series instances lazily, once', () => {
    const getSeriesInstances = jest.fn(() => [modules.instance]);
    const ctx = buildOverlayContext(props, { metaData, getSeriesInstances });

    expect(getSeriesInstances).not.toHaveBeenCalled();
    ctx.getSeriesInstances();
    ctx.getSeriesInstances();
    expect(getSeriesInstances).toHaveBeenCalledTimes(1);
    expect(getSeriesInstances).toHaveBeenCalledWith(modules.instance);
  });
});

describe('legacy Standard Fields', () => {
  it.each([
    ['patientName', ['Doe, Jane']],
    ['patientId', ['P001']],
    ['studyDescription', ['Knee']],
    ['studyDate-studyTime', ['Jan 31, 2024 13:45:12']],
    ['seriesNumber', ['Ser: 4']],
    ['Img-instance-number-index-stack-size', ['Img: 7 7/20']],
    ['frameRate-image-info', ['25.00 FPS', '512 x 256', 'Loc: -12.35 mm Thick: 3.00 mm', 'AX T1']],
    ['zoomPercentage', ['Zoom: 125%']],
    ['wwwc', ['W: 400 L: 40']],
    ['modality', ['Modality: MR']],
    ['seriesInstanceUID', ['Series Instance UID: 1.2.3.4']],
    ['studyInstanceUID', ['Study Instance UID: 1.2.3']],
    ['accessionNumber', ['Accession Number: ACC1']],
  ])('%s renders as before', (value, expected) => {
    expect(resolve(value).lines).toEqual(expected);
  });

  it('renders compression with its indicator class', () => {
    expect(resolve('compression')).toEqual({ lines: ['Lossless / Uncompressed'], className: 'compressionIndicator' });
  });

  it('keeps the empty-div behaviour of missing legacy values', () => {
    const ctx = buildOverlayContext(props, { metaData: { get: () => ({}) } });

    expect(resolveOverlayItem({ value: 'patientName' }, ctx)).toEqual({ lines: [''] });
    expect(resolveOverlayItem({ value: 'accessionNumber' }, ctx)).toBeNull();
    expect(resolveOverlayItem({ value: 'Img-instance-number-index-stack-size' }, { ...ctx, stackSize: 1 })).toEqual({ lines: [''] });
  });
});

describe('fallback-chain and computed Standard Fields', () => {
  it('falls through a chain', () => {
    expect(resolve('protocolName').lines).toEqual(['Protocol Name: Knee 3D']);
    expect(resolve('laterality').lines).toEqual(['Laterality: R']);
    expect(resolve('echoTrainLength')).toBeNull();
  });

  it('computes matrix, spacing and gap fields', () => {
    expect(resolve('fieldOfView').lines).toEqual(['FOV: 240 x 240 mm']);
    expect(resolve('reconstructionMatrix').lines).toEqual(['Matrix: 256 x 512']);
    expect(resolve('pixelSpacing').lines).toEqual(['Pixel Spacing: 0.94 x 0.47 mm']);
    expect(resolve('sliceSpacing').lines).toEqual(['Spacing: 4 mm']);
    expect(resolve('sliceGap').lines).toEqual(['Gap: 1 mm']);
    expect(resolve('acquisitionMatrix')).toBeNull();
  });

  it('every Standard Field has a resolver', () => {
    const ctx = buildOverlayContext(props, { metaData });

    STANDARD_FIELDS.forEach(field => {
      expect(() => resolveOverlayItem({ title: field.title, value: field.value }, ctx)).not.toThrow();
    });
  });
});

describe('tag fields', () => {
  it('renders a standard attribute with the stored title', () => {
    const ctx = buildOverlayContext(props, { metaData });

    expect(resolveOverlayItem({ title: 'Acq Protocol', value: tagFieldValue('(0018,9423)') }, ctx)).toEqual({
      lines: ['Acq Protocol: Knee 3D'],
    });
  });

  it('renders a private attribute by hex key', () => {
    expect(resolve('tag:0043102D').lines).toEqual(['Any: W']);
  });

  it('renders nothing for an absent attribute or a missing instance', () => {
    expect(resolve('tag:00181030')).toBeNull();
    expect(resolve('tag:00080080')).toBeNull();

    const ctx = buildOverlayContext(props, { metaData: { get: () => undefined } });
    expect(resolveOverlayItem({ title: 'X', value: 'tag:00080080' }, ctx)).toBeNull();
  });

  it('falls back to the hex code as the label', () => {
    const ctx = buildOverlayContext(props, { metaData });

    expect(resolveOverlayItem({ value: 'tag:0043102D' }, ctx)).toEqual({ lines: ['0043102D: W'] });
  });
});

describe('unknown items', () => {
  it('renders nothing for retired or malformed values', () => {
    expect(resolve('inconsistencyWarnings-warning')).toBeNull();
    expect(resolve('SRLabels-warning')).toBeNull();
    expect(resolve('nope')).toBeNull();

    const ctx = buildOverlayContext(props, { metaData });
    expect(resolveOverlayItem(null, ctx)).toBeNull();
    expect(resolveOverlayItem({ value: null }, ctx)).toBeNull();
  });
});
