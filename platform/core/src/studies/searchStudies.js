import Studies from './services/qido/studies';

const studySearchPromises = new Map();

/**
 * Search for studies information by the given filter
 *
 * @param server
 * @param {Object} filter Filter that will be used on search
 * @param isForce
 * @param shouldReturnRow
 * @returns {Promise} resolved with an array of studies information or rejected with an error
 */
export default function searchStudies(server, filter, isForce, shouldReturnRow) {
  const promiseKeyObj = {
    qidoRoot: server.qidoRoot,
    filter,
  };
  const promiseKey = JSON.stringify(promiseKeyObj);
  if (studySearchPromises.has(promiseKey) && !isForce) {
    return studySearchPromises.get(promiseKey);
  } else {
    const promise = Studies(server, filter, shouldReturnRow);

    studySearchPromises.set(promiseKey, promise);

    return promise;
  }
}
