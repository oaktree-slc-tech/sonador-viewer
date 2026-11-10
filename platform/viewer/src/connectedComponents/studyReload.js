// A study reload (STUDY_RELOAD, which removing a series also triggers): the measurement session
// is cleared, then the study data is reloaded. Each step runs whatever the one before it did:
// clearAnnotations returns nothing, and a failure in it must not leave the reload undone.

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
