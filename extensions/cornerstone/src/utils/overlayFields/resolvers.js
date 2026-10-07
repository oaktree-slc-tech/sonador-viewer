// Resolve a stored corner item to the lines the viewport overlay draws.
//
// A resolver returns `{ lines: string[], className? }` or null. Lines map one-to-one to the
// `<div>`s the overlay renders, so a resolver that wants a blank line returns an empty string.
// Standard Fields that predate the catalogue keep the module reads and the output they had as
// inline JSX; tag fields and the computed fields read the naturalized instance.

import {
  findStandardField,
  isTagFieldValue,
  parseTagFieldValue,
  STANDARD_FIELDS,
} from '@ohif/core/src/utils/overlayFields';

import { formatDICOMDate, formatDICOMTime, formatNumberPrecision, formatPN, isValidNumber } from '../formatStudy';

import * as computed from './computed';
import { resolveTagText } from './resolveTag';

const MODULES = ['generalSeriesModule', 'imagePlaneModule', 'generalStudyModule', 'patientModule', 'generalImageModule', 'cineModule'];

function readModule(metaData, type, imageId) {
  try {
    return metaData.get(type, imageId) || {};
  } catch (err) {
    return {};
  }
}

/**
 * Everything the resolvers need for one render.
 *
 * @param {object} props overlay props: imageId, scale, windowWidth, windowCenter, imageIndex, stackSize
 * @param {object} deps
 * @param {object} deps.metaData provider with `get(type, imageId)`
 * @param {function} [deps.getSeriesInstances] `(instance) => object[]`, resolved lazily once
 */
export function buildOverlayContext(props, { metaData, getSeriesInstances }) {
  const { imageId } = props;
  const modules = {};
  MODULES.forEach(type => {
    modules[type] = readModule(metaData, type, imageId);
  });

  const instance = readModule(metaData, 'instance', imageId);
  let seriesInstances;

  return {
    ...props,
    modules,
    instance: Object.keys(instance).length ? instance : undefined,
    getSeriesInstances() {
      if (seriesInstances === undefined) {
        try {
          seriesInstances = (getSeriesInstances && getSeriesInstances(this.instance)) || null;
        } catch (err) {
          seriesInstances = null;
        }
      }

      return seriesInstances;
    },
  };
}

const lines = (...values) => ({ lines: values.map(value => (value === undefined || value === null ? '' : String(value))) });

function compression(ctx) {
  const { lossyImageCompression, lossyImageCompressionRatio, lossyImageCompressionMethod } = ctx.modules.generalImageModule;

  if (lossyImageCompression === '01' && lossyImageCompressionRatio !== '') {
    const method = lossyImageCompressionMethod || 'Lossy: ';
    return `${method}${formatNumberPrecision(lossyImageCompressionRatio, 2)} : 1`;
  }

  return 'Lossless / Uncompressed';
}

function fixed(value, digits) {
  return value && value.toFixed ? value.toFixed(digits) : value;
}

const labelled = (title, text) => (text ? lines(`${title}: ${text}`) : null);

const RESOLVERS = {
  patientName: ctx => lines(formatPN(ctx.modules.patientModule.patientName)),
  patientId: ctx => lines(ctx.modules.patientModule.patientId),
  studyDescription: ctx => lines(ctx.modules.generalStudyModule.studyDescription),
  'studyDate-studyTime': ctx => {
    const { studyDate, studyTime } = ctx.modules.generalStudyModule;
    return lines(`${formatDICOMDate(studyDate)} ${formatDICOMTime(studyTime)}`);
  },
  seriesNumber: ctx => {
    const { seriesNumber } = ctx.modules.generalSeriesModule;
    return lines(seriesNumber >= 0 ? `Ser: ${seriesNumber}` : '');
  },
  'Img-instance-number-index-stack-size': ctx => {
    const { instanceNumber } = ctx.modules.generalImageModule;
    return lines(ctx.stackSize > 1 ? `Img: ${instanceNumber} ${ctx.imageIndex}/${ctx.stackSize}` : '');
  },
  'frameRate-image-info': ctx => {
    const { frameTime } = ctx.modules.cineModule;
    const { rows, columns, sliceThickness, sliceLocation } = ctx.modules.imagePlaneModule;
    const { seriesDescription } = ctx.modules.generalSeriesModule;
    const frameRate = formatNumberPrecision(1000 / frameTime, 1);
    const location = isValidNumber(sliceLocation) ? `Loc: ${formatNumberPrecision(sliceLocation, 2)} mm ` : '';
    const thickness = sliceThickness ? `Thick: ${formatNumberPrecision(sliceThickness, 2)} mm` : '';

    return lines(frameRate >= 0 ? `${formatNumberPrecision(frameRate, 2)} FPS` : '', `${columns} x ${rows}`, `${location}${thickness}`, seriesDescription);
  },
  zoomPercentage: ctx => lines(`Zoom: ${formatNumberPrecision(ctx.scale * 100, 0)}%`),
  wwwc: ctx => lines(`W: ${fixed(ctx.windowWidth, 0)} L: ${fixed(ctx.windowCenter, 0)}`),
  compression: ctx => ({ ...lines(compression(ctx)), className: 'compressionIndicator' }),
  modality: ctx => lines(`Modality: ${ctx.modules.generalSeriesModule.modality}`),
  seriesInstanceUID: ctx => labelled('Series Instance UID', ctx.modules.generalSeriesModule.seriesInstanceUID),
  studyInstanceUID: ctx => labelled('Study Instance UID', ctx.modules.generalSeriesModule.studyInstanceUID),
  accessionNumber: ctx => labelled('Accession Number', ctx.modules.generalStudyModule.accessionNumber),

  fieldOfView: ctx => labelled('FOV', computed.fieldOfView(ctx.instance)),
  reconstructionMatrix: ctx => labelled('Matrix', computed.reconstructionMatrix(ctx.instance)),
  acquisitionMatrix: ctx => labelled('Acq Matrix', computed.acquisitionMatrix(ctx.instance)),
  pixelSpacing: ctx => labelled('Pixel Spacing', computed.pixelSpacing(ctx.instance)),
  sliceSpacing: ctx => (ctx.instance ? labelled('Spacing', computed.sliceSpacing(ctx.instance, ctx.getSeriesInstances())) : null),
  sliceGap: ctx => (ctx.instance ? labelled('Gap', computed.sliceGap(ctx.instance, ctx.getSeriesInstances())) : null),
};

// Standard Fields with a fallback chain and no dedicated resolver read the chain from the instance.
STANDARD_FIELDS.forEach(field => {
  if (!RESOLVERS[field.value] && field.tags) {
    RESOLVERS[field.value] = ctx => labelled(field.title, resolveTagText(ctx.instance, field.tags));
  }
});

/**
 * @param {{ title: string, value: string }} item stored corner item
 * @param {object} ctx from buildOverlayContext
 * @returns {{ lines: string[], className?: string }|null}
 */
export function resolveOverlayItem(item, ctx) {
  if (!item || typeof item.value !== 'string') {
    return null;
  }

  if (isTagFieldValue(item.value)) {
    if (!ctx.instance) {
      return null;
    }

    return labelled(item.title || parseTagFieldValue(item.value), resolveTagText(ctx.instance, [parseTagFieldValue(item.value)]));
  }

  const field = findStandardField(item.value);
  const resolver = field && RESOLVERS[field.value];
  return resolver ? resolver(ctx) : null;
}

export { RESOLVERS };
