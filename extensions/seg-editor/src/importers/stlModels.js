// 3D models for import: STL files from the user's computer, or the STL models of an M3D series in
// the study. Either way, one closed surface per model in patient coordinates (an STL made from a
// series is in that series' patient coordinates, which is what places it on another series' grid).

import { segmentation as c3dSegmentations } from '@cornerstonejs/tools';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';

import OHIF from '@ohif/core';
import {
  acquireGeometry,
  getM3DGeometryId,
  getM3DInstanceColor,
  getM3DInstanceLabel,
  getM3DInstanceMetadata,
  getM3DSegmentationId,
  listM3DInstanceSources,
  releaseGeometry,
} from '@ohif/extension-viewerm3d';

import { surfaceFromGeometry } from '../threeDTools/modelsToLabelmap.js';


// Holder id for the geometry the import reads (the M3D cache counts references per viewport)
const GEOMETRY_HOLDER = 'seg-editor-import';

/** 'femur.stl' -> 'femur' */
export function modelLabelFromFileName(fileName) {
  return String(fileName || '').replace(/\.stl$/i, '') || 'Model';
}

/**
 * Parse STL files into import models, named after their files.
 *
 * @param {File[]} files
 * @param {Object} [deps]
 * @returns {Promise<{ models: Array<{ label: string, surface: { points, polys } }> }>} a file that
 *   is not an STL (or has no triangles) is refused by name
 */
export async function modelsFromStlFiles(files, deps = {}) {
  const { parse = buffer => new STLLoader().parse(buffer) } = deps;

  const models = [];
  for (const file of files) {
    let surface = null;
    try {
      surface = surfaceFromGeometry(parse(await file.arrayBuffer()));
    } catch (error) {
      throw new Error(`${file.name} is not an STL file (${error.message})`);
    }
    if (!surface?.polys?.length) {
      throw new Error(`${file.name} has no triangles`);
    }
    models.push({ label: modelLabelFromFileName(file.name), surface });
  }
  return { models };
}

/**
 * The models of an STL series in the study as import models, with the labels and colours the
 * models panel shows (the series' presentation state when the series is open, else the instance
 * metadata). The geometry is read through the M3D cache, so a series already open in the M3D
 * viewer is not fetched again, and one that is not open is fetched and released afterwards.
 *
 * @param {Object} params
 * @param {Object} params.displaySet - the M3D display set
 * @param {Object[]} params.studies - the viewer's studies
 * @param {Object} [params.deps] - injectable (tests)
 * @returns {Promise<{ models: Array<{ label: string, color?: number[], surface }> }>}
 */
export async function modelsFromM3DSeries({ displaySet, studies, deps = {} }) {
  const {
    listSources = listM3DInstanceSources,
    acquire = acquireGeometry,
    release = releaseGeometry,
    getSegmentation = id => c3dSegmentations.state.getSegmentation(id),
    hexToRgb = hex => OHIF.utils.color.hex2rgb(hex),
  } = deps;

  const sources = listSources(displaySet, studies);
  if (!sources.length) {
    throw new Error('The series has no models');
  }

  // The panel's names and colours, when the series is open
  const panelSegments = Object.values(getSegmentation(getM3DSegmentationId(displaySet.SeriesInstanceUID))?.segments || {});
  const panelSegment = geometryId => panelSegments.find(segment => segment?.geometryId === geometryId);

  const models = [];
  for (let i = 0; i < sources.length; i++) {
    const { sopInstanceUID, fetchRawData } = sources[i];
    const geometryId = getM3DGeometryId(sopInstanceUID);
    const payload = await acquire(geometryId, GEOMETRY_HOLDER, {
      fetchRawData,
      sopInstanceUID,
      mimeType: displaySet.m3dModelType,
    });
    try {
      const fromPanel = panelSegment(geometryId);
      const metadata = getM3DInstanceMetadata(displaySet.series, sopInstanceUID);
      const color = fromPanel?.color || getM3DInstanceColor(displaySet.series, sopInstanceUID);
      models.push({
        label: fromPanel?.label || getM3DInstanceLabel(metadata, i + 1),
        ...(color ? { color: hexToRgb(color) } : {}),
        // A copy: the geometry can be released once read
        surface: surfaceFromGeometry(payload?.parsed),
      });
    } finally {
      release(geometryId, GEOMETRY_HOLDER);
    }
  }
  return { models };
}
