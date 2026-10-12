// The one-line account of a surface edit the Selection panel shows (ohif-viewers#142, §12).

/**
 * One line on an edit's outcome: points removed (or smoothed), holes closed and how, whether the
 * result is closed.
 */
export function editSummary(t, edit) {
  const { holes = 0, methods = {}, closed, openEdges = 0, repair, points = 0, kind } = edit;
  if (kind === 'smooth') {
    return t('{{count}} point(s) smoothed', { count: points });
  }
  const parts = [];
  if (methods.fitted) {
    parts.push(t('{{count}} smooth', { count: methods.fitted }));
  }
  if (methods.flat) {
    parts.push(t('{{count}} flat', { count: methods.flat }));
  }
  if (methods.cap) {
    parts.push(t('{{count}} fan', { count: methods.cap }));
  }
  const how = parts.length ? ` (${parts.join(', ')})` : '';
  const what = repair
    ? t('{{count}} open rim(s) closed', { count: holes }) + how
    : `${t('{{count}} point(s) removed', { count: points })}, ${t('{{count}} hole(s) closed', { count: holes })}${how}`;
  const open = openEdges ? `; ${t('{{count}} edge(s) could not be closed', { count: openEdges })}` : '';
  const result = closed === undefined ? '' : `; ${closed ? t('result closed') : t('result still open')}`;
  return `${what}${open}${result}`;
}
