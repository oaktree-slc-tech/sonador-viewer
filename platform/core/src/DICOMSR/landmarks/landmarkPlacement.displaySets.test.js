/**
 * @jest-environment ../viewer/src/__tests__/jsdomEnvironment.js
 */
// Placement follows the display set service: a series is loaded while a display set shows it, and a
// set is held again when the last display set of its frame is removed, although the series metadata
// stays cached.

import DisplaySetService from '../../services/DisplaySetService/DisplaySetService';
import { placementOf } from './landmarkPlacement';

const STUDY = '2.25.1001';
const FRAME = '2.25.45100';
const MR = '1.2.840.10008.5.1.4.1.1.4';
const image = (series, sop) => ({ SeriesInstanceUID: series, Modality: 'MR', instances: [{ SOPInstanceUID: sop, SOPClassUID: MR, FrameOfReferenceUID: FRAME }] });
const cached = [image('2.25.1002', '2.25.1003'), image('2.25.1009', '2.25.1010'), { ...image('2.25.45201', '2.25.45202'),
  instances: [{ SOPInstanceUID: '2.25.45202', SOPClassUID: MR, FrameOfReferenceUID: '2.25.45200' }] }];
const store = {
  getStudyInstanceUIDs: () => [STUDY],
  getStudy: () => ({ StudyInstanceUID: STUDY, series: cached }),
  getSeries: (study, uid) => cached.find(series => series.SeriesInstanceUID === uid),
};
const set = { domain: 'patient', frameOfReferenceUID: FRAME };

it('is placed while a display set of its frame remains, and held once the last one is removed', () => {
  const service = new DisplaySetService();
  service.addDisplaySets([
    { displaySetInstanceUID: 'ds-p', SeriesInstanceUID: '2.25.1002' },
    { displaySetInstanceUID: 'ds-twin', SeriesInstanceUID: '2.25.1009' },
    { displaySetInstanceUID: 'ds-s', SeriesInstanceUID: '2.25.45201' },
  ]);
  const placed = () => placementOf(set, store, service.activeDisplaySets);
  expect(placed().series.map(series => series.SeriesInstanceUID)).toEqual(['2.25.1002', '2.25.1009']);

  // A second display set of the frame remains
  service.deleteDisplaySet('ds-p');
  expect(placed().placed).toBe(true);
  expect(placed().series.map(series => series.SeriesInstanceUID)).toEqual(['2.25.1009']);

  // The last one goes: held, with every series still in the metadata cache
  service.deleteDisplaySet('ds-twin');
  expect(placed()).toMatchObject({ placed: false, reason: 'frame-not-loaded' });
  expect(cached).toHaveLength(3);
});
