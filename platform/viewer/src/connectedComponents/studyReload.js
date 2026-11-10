// A study reload (STUDY_RELOAD, which removing a series also triggers): the measurement session
// is cleared, then the study data is reloaded. A failure of clearAnnotations (which returns
// nothing) is logged, and the session clear and the reload still run.

/**
 * @param {object} params
 * @param {object} params.commandsManager - runs clearAnnotations
 * @param {object} params.measurementApi - its session is cleared
 * @param {Function} params.reloadStudyData - reloads the study
 * @param {object} [params.log]
 */
export default function reloadStudyAndMeasurements({ commandsManager, measurementApi, reloadStudyData, log }) {
  try {
    commandsManager.runCommand('clearAnnotations');
  } catch (error) {
    if (log) {
      log.error('[viewer:fetch-data] unable to clear annotations before the study reload', error);
    }
  }
  measurementApi.clearMeasurements();
  reloadStudyData();
}
