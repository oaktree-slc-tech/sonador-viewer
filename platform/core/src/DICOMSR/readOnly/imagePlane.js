// Image plane geometry for read-only DICOM-SR measurements: the plane of an image from the
// Cornerstone3D metadata, and the conversions and plane matching of planeGeometry.js.

import { metaData as c3dMetaData } from '@cornerstonejs/core';

import {
  DEFAULT_PLANE_TOLERANCE,
  distanceFromPlane,
  findImageForPoints,
  imageToWorld,
  planeFromInstance,
  planeFromModule,
  worldToImage,
} from './planeGeometry';


/**
 * Image plane of an image: the Cornerstone3D `imagePlaneModule` when the id is registered with
 * its metadata providers, otherwise the naturalized instance metadata.
 */
export function getImagePlane(imageId, instance) {
  let module;
  try {
    module = imageId ? c3dMetaData.get('imagePlaneModule', imageId) : undefined;
  } catch (error) {
    module = undefined;
  }

  return planeFromModule(module) || planeFromInstance(instance);
}


export {
  DEFAULT_PLANE_TOLERANCE,
  distanceFromPlane,
  findImageForPoints,
  imageToWorld,
  planeFromInstance,
  planeFromModule,
  worldToImage,
};

export default {
  DEFAULT_PLANE_TOLERANCE,
  planeFromInstance,
  planeFromModule,
  getImagePlane,
  imageToWorld,
  worldToImage,
  distanceFromPlane,
  findImageForPoints,
};
