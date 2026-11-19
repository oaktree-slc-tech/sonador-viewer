// The tools that create annotations, which the toolbars and commands withhold while a defined
// timepoint is active; navigation, window and level, the probe and the ROI window are not among them.

jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: {} } } },
}), { virtual: true });

import { isAnnotationTool } from './annotationTools';

it('names the measurement tools of the configuration, the Cornerstone3D drawing tools and the Series Tag', () => {
  ['Length', 'Angle', 'CobbAngle', 'ArrowAnnotate', 'CircleRoi', 'Bidirectional', 'EllipticalRoi', 'RectangleRoi',
    'CircleROI', 'EllipticalROI', 'RectangleROI', 'PlanarFreehandROI', 'Probe', 'DICOMSRSeriesTagTool']
    .forEach(tool => expect(`${tool}: ${isAnnotationTool(tool)}`).toBe(`${tool}: true`));
});

it('leaves navigation, window and level, the probe and the ROI window available', () => {
  ['Wwwc', 'WwwcRegion', 'DragProbe', 'Pan', 'Zoom', 'StackScroll', 'Magnify', undefined, '']
    .forEach(tool => expect(`${tool}: ${isAnnotationTool(tool)}`).toBe(`${tool}: false`));
});
