import _ from 'lodash';

import vtkBoundingBox from 'vtk.js/Sources/Common/DataModel/BoundingBox';

import applyVtkColorPreset from './applyVtkColorPreset.js';
import vtkVolumeColorPresets, {
  VTK_VOLUME_CPROFILE_CT_BONE,
  VTK_VOLUME_CPROFILEC_CT_BONES,
  VTK_VOLUME_CPROFILE_CT_CARDIAC,
} from './vtkVolumePresets.js';

function applyVtkVolumeRenderOptions(
  vtkImage,
  volumeActor,
  volumeMapper,
  options
) {
  // Apply volume transformations and properties to volume actor and mapper
  options = options || {};
  _.defaults(options, {
    maxSamplesPerRay: 4000,
    applyVtkColorPreset: true,
    vtkColorPreset: VTK_VOLUME_CPROFILE_CT_BONE,
    sampleDistanceMultiplier: 0.7,
  });

  // Apply volume rendering options
  try {
    // Source data array and range
    const dataArray =
      vtkImage.getPointData().getScalars() ||
      vtkImage.getPointData().getArrays()[0];
    const dataRange = dataArray.getRange();

    // Set the sample distance
    let sampleDistance = options.sampleDistance;
    if (!options.sampleDistance) {
      sampleDistance =
        options.sampleDistanceMultiplier *
        Math.sqrt(
          vtkImage
            .getSpacing()
            .map((v) => v * v)
            .reduce((a, b) => a + b),
          0
        );
    }

    volumeMapper.setSampleDistance(sampleDistance);
    volumeMapper.setMaximumSamplesPerRay(options.maxSamplesPerRay);

    // Apply color transform function
    const cpreset = vtkVolumeColorPresets.find(
      (preset) => preset.id == options.vtkColorPreset
    );
    if (options.applyVtkColorPreset && cpreset) {
      applyVtkColorPreset(volumeActor, cpreset);
    }

    // Improve appearance of volume rendering: https://kitware.github.io/vtk-js/examples/VolumeViewer.html.
    // Distance in world coordinates apply a scalar opacity of 1.0
    volumeActor
      .getProperty()
      .setScalarOpacityUnitDistance(
        0,
        vtkBoundingBox.getDiagonalLength(vtkImage.getBounds()) /
          Math.max(...vtkImage.getDimensions())
      );
  } catch (err) {
    console.error('Unable to apply rendering options to volume.', err);
  }
}

export default applyVtkVolumeRenderOptions;
