// Describing a failed write in a bulk run, for both the ACL and the worklist paths.
//
// The two runners had near-identical copies of this. They are unified here rather than left to drift
// because the distinction the function draws is a safety property, not a wording preference: a
// failure with NO status never reached the gateway as far as JavaScript can tell, so the write may
// well have been applied, and saying otherwise tells the user something about their data that is not
// known to be true.

/**
 * True when the failure is a transport/CORS failure rather than a response from the gateway.
 *
 * `fetch` reports a dropped connection -- or a response the browser refused to expose because it
 * carried no CORS headers -- as a bare TypeError with no status at all.
 */
export const isTransportFailure = (err) => Boolean(err) && err.status === undefined;


/**
 * A one-line reason for a failed write, drawn from whatever the gateway sent back.
 *
 * Three response shapes are handled because the endpoints produce all three:
 *
 *   - a field-level validation payload, `{ errors: { <Field>: [{ code, message }] } }`. The field and
 *     code are the useful part -- "User: unique" says the policy already exists, "User: required"
 *     says the payload was wrong;
 *   - a flat `detail`/`message`/`error`, which is what a permission rejection tends to carry;
 *   - nothing readable, leaving only the status.
 *
 * @param {Error}  err
 * @param {string} hedge What may still be true when there was no response at all. Phrased per caller
 *                       because the consequence differs: an unapplied policy is re-checked by
 *                       reopening a dialog, while a review request that may exist must not simply be
 *                       retried, or the reviewer gets it twice.
 */
export const describeOperationFailure = (err, { hedge } = {}) => {
  const entries = Object.entries(err?.json?.errors || {});

  if (entries.length) {
    const [field, messages] = entries[0];
    const first = (messages || [])[0];
    const detail = first?.code || first?.message || first;

    return `${field}: ${detail} (HTTP ${err.status})`;
  }

  const flat = err?.json?.detail || err?.json?.message || err?.json?.error;

  if (flat) {
    return `${flat} (HTTP ${err.status})`;
  }

  if (err?.status) {
    return `Request failed (HTTP ${err.status}).`;
  }

  return err?.message
    ? `No response from the server (${err.message}).${hedge ? ` ${hedge}` : ''}`
    : 'Request failed.';
};


/**
 * Invoke a reporting callback without letting it affect the run.
 *
 * A run's job is to write and to say truthfully what happened. A notification service that throws
 * must not abort the remaining writes, and must not be mistaken for a write that failed -- it goes to
 * the console instead, where it is a bug in the caller rather than in the data.
 */
export const reportSafely = (callback, payload, context = 'Bulk action') => {
  try {
    callback(payload);
  } catch (err) {
    console.error(`${context}: a progress callback threw; the write itself was unaffected.`, err);
  }
};
