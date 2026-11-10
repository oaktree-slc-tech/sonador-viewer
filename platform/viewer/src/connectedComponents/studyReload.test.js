// A study reload clears the measurement session and reloads the study, whether Clear annotations
// runs, fails, or finds no classic image.

import reloadStudyAndMeasurements from './studyReload';

const run = (runCommand) => {
  const order = [];
  const params = {
    commandsManager: { runCommand: jest.fn((name) => { order.push(name); return runCommand && runCommand(name); }) },
    measurementApi: { clearMeasurements: jest.fn(() => order.push('clearMeasurements')) },
    reloadStudyData: jest.fn(() => order.push('reloadStudyData')),
    log: { error: jest.fn() },
  };
  reloadStudyAndMeasurements(params);
  return { order, params };
};

it('clears annotations, then the session, then reloads the study', () => {
  expect(run().order).toEqual(['clearAnnotations', 'clearMeasurements', 'reloadStudyData']);
});

it('still clears the session and reloads when Clear annotations fails', () => {
  const { order, params } = run(() => { throw new TypeError("Cannot destructure property 'element'"); });
  expect(order).toEqual(['clearAnnotations', 'clearMeasurements', 'reloadStudyData']);
  expect(params.log.error).toHaveBeenCalledTimes(1);
});
