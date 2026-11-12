// How the Annotations drawer organizes its rows: the search filter, and the optional grouping of
// each group's rows by series.
//
// A row matches a search when every word typed appears, case-insensitively, in one of its fields:
// the measurement type, its label and location, its description, the view of an out-of-plane
// measurement, and its series' modality and series description. Grouped by series, each group's rows are split into one sub-group per
// series, ordered by series number and headed by the series description; rows whose series cannot
// be resolved (its metadata not loaded, not part of this study, or not recorded) form a last
// sub-group, "Series Unavailable". A sub-group's hover card lists the series' annotation types
// and counts across every group, the pending ones on their own lines, from the measurement API's
// by-series query (MeasurementApi.getMeasurementsBySeries), which other components share.

import OHIF from '@ohif/core';

const { DicomMetadataStore } = OHIF;

const UNAVAILABLE_KEY = 'series-unavailable';
const UNAVAILABLE_LABEL = 'Series Unavailable';
const UNAVAILABLE_HELP = "Shows measurements whose series isn't loaded, isn't part of this study, or isn't recorded, "
  + "so they can't be grouped by series.";

// Names a reader would type for tools whose configured name is internal
const TOOL_NAME_ALIASES = {
  ArrowAnnotate: 'Arrow Annotation',
  DICOMSRSeriesTagTool: 'Series Tag',
  DICOMSRDisplayTool: 'Report Measurement',
  // The circle's Cornerstone3D name (out-of-plane records)
  CircleROI: 'Circle',
};

/** "CobbAngle" -> "Cobb Angle" */
const humanize = name => String(name || '').replace(/([a-z])([A-Z])/g, '$1 $2');

/** The configured display name of a tool type */
function configuredToolName(toolType) {
  const { MeasurementApi } = OHIF.measurements || {};
  const config = MeasurementApi && typeof MeasurementApi.getConfiguration === 'function'
    ? MeasurementApi.getConfiguration() : {};
  for (const group of (config && config.measurementTools) || []) {
    const tool = (group.childTools || []).find(childTool => childTool.id === toolType);
    if (tool) {
      return tool.name;
    }
  }
  return undefined;
}

/** The names a measurement type is known by: its configured name, its readable id, an alias */
function toolTypeNames(toolType) {
  return [configuredToolName(toolType), humanize(toolType), TOOL_NAME_ALIASES[toolType]].filter(Boolean);
}

/** The tool a tracking identifier names ("cornerstoneTools@^4.0.0:Length" -> "Length") */
const trackedToolType = trackingIdentifier => (typeof trackingIdentifier === 'string' && trackingIdentifier.includes(':')
  ? trackingIdentifier.slice(trackingIdentifier.lastIndexOf(':') + 1) : undefined);

/**
 * The measurement type of a row: the tool it was drawn with. A measurement read from a report is
 * listed with the display tool's type; its tracking identifier names the tool.
 */
function rowToolType(row) {
  return trackedToolType(row && row.trackingIdentifier) || (row && row.toolType);
}

/** A row's series: { SeriesNumber, SeriesDescription, Modality } from the metadata store, or null */
function seriesOf(row) {
  if (!row || !row.refSeriesInstanceUID) {
    return null;
  }
  const { utils } = OHIF;
  if (!utils || typeof utils.referenceIdentifiers !== 'function') {
    return null;
  }
  try {
    return utils.referenceIdentifiers(DicomMetadataStore, {
      StudyInstanceUID: row.refStudyInstanceUID,
      SeriesInstanceUID: row.refSeriesInstanceUID,
      SOPInstanceUID: row.refSOPInstanceUID,
    }) || null;
  } catch (error) {
    return null;
  }
}

/** The text a row is searched in */
function rowSearchText(row, series = seriesOf(row)) {
  const tag = row.seriesTagDisplay || {};
  return [
    ...toolTypeNames(rowToolType(row)),
    ...(rowToolType(row) !== row.toolType ? toolTypeNames(row.toolType) : []),
    row.label, row.location, row.description,
    tag.value, tag.meaning,
    row.outOfPlane && row.outOfPlane.view,
    series && series.Modality, series && series.SeriesDescription,
  ].filter(value => value !== undefined && value !== null && value !== '')
    .join(' ').toLowerCase();
}

/** The words of a search; none for an empty search */
const queryWords = query => String(query || '').toLowerCase().split(/\s+/).filter(Boolean);

/** Whether a row matches a search: every word appears in its fields */
function matchesQuery(row, query, series) {
  const words = queryWords(query);
  if (!words.length) {
    return true;
  }
  const text = rowSearchText(row, series);
  return words.every(word => text.includes(word));
}

/**
 * The groups with only their matching rows, each with its total; groups without a match are left
 * out while a search is active.
 *
 * @returns {object[]} groups as given, with `measurements` filtered and `totalCount` added
 */
function filterGroups(groups, query, seriesFor = seriesOf) {
  const searching = queryWords(query).length > 0;
  return (groups || [])
    .map(group => ({
      ...group,
      totalCount: (group.measurements || []).length,
      measurements: (group.measurements || []).filter(row => !searching || matchesQuery(row, query, seriesFor(row))),
    }))
    .filter(group => !searching || group.measurements.length > 0);
}

const present = value => value !== undefined && value !== null && String(value).trim() !== '';

/**
 * A series heading: its description, else "Series <number>", else its modality, else "Unnamed
 * Series". A generated heading also gives its translation key and values.
 *
 * @returns {{ label: string, labelKey?: string, labelValues?: object }}
 */
function seriesHeading(series) {
  if (present(series.SeriesDescription)) {
    return { label: String(series.SeriesDescription).trim() };
  }
  if (present(series.SeriesNumber)) {
    return { label: `Series ${series.SeriesNumber}`, labelKey: 'Series {{number}}', labelValues: { number: series.SeriesNumber } };
  }
  return present(series.Modality)
    ? { label: String(series.Modality) }
    : { label: 'Unnamed Series', labelKey: 'Unnamed Series' };
}

/** A series heading's text */
const seriesTitle = series => seriesHeading(series).label;

/** The number of instances of a row's series in the metadata store, or undefined */
function seriesInstanceCount(row) {
  try {
    const series = DicomMetadataStore && typeof DicomMetadataStore.getSeries === 'function'
      ? DicomMetadataStore.getSeries(row.refStudyInstanceUID, row.refSeriesInstanceUID) : undefined;
    const count = series && Array.isArray(series.instances) ? series.instances.length : undefined;
    return count || undefined;
  } catch (error) {
    return undefined;
  }
}

/** The display name of a row's measurement type */
const rowToolName = row => toolTypeName(rowToolType(row));

/** The display name of a measurement type */
function toolTypeName(toolType) {
  // The alias first: some configured names are internal ids ("ArrowAnnotate")
  return TOOL_NAME_ALIASES[toolType] || configuredToolName(toolType) || humanize(toolType);
}

/** Whether the metadata store knows a series, so its measurements can be grouped under it */
function seriesAvailable(SeriesInstanceUID, StudyInstanceUID) {
  return Boolean(SeriesInstanceUID) && Boolean(seriesOf({ refSeriesInstanceUID: SeriesInstanceUID, refStudyInstanceUID: StudyInstanceUID }));
}

/**
 * The measurements of a series sub-group from MeasurementApi.getMeasurementsBySeries: those of
 * its series, or, for the Series Unavailable group, those whose series is missing or unknown.
 */
function seriesEntries(bySeries, key) {
  if (!bySeries) {
    return [];
  }
  if (key !== UNAVAILABLE_KEY) {
    return bySeries.get(key) || [];
  }
  return [...bySeries.entries()]
    .filter(([uid, entries]) => !uid || !seriesAvailable(uid, entries[0] && entries[0].studyInstanceUID))
    .flatMap(([, entries]) => entries);
}

/**
 * A series' annotation types for its hover card, from its MeasurementApi entries (every group:
 * Measurements, Findings and their Pending groups): one line per type and count, the saved ones
 * first, then the pending ones, each most frequent first. Out-of-plane measurements are a type of
 * their own ("3D Length").
 *
 * @returns {object[]} { name, pending, count }
 */
function seriesAnnotationTypes(entries) {
  const counts = new Map();
  (entries || []).forEach(({ toolType, pending, outOfPlane }) => {
    const name = `${outOfPlane ? '3D ' : ''}${toolTypeName(toolType)}`;
    const id = `${pending ? 1 : 0}:${name}`;
    const line = counts.get(id) || { name, pending: Boolean(pending), count: 0 };
    line.count += 1;
    counts.set(id, line);
  });
  return [...counts.values()].sort((a, b) => (a.pending - b.pending) || (b.count - a.count) || a.name.localeCompare(b.name));
}

/**
 * A group's rows split by series, ordered by series number; the rows whose series cannot be
 * resolved last.
 *
 * @returns {object[]} { key, label, labelKey?, labelValues?, help?, seriesNumber?, modality?, instanceCount?, measurements }
 */
function groupRowsBySeries(rows, seriesFor = seriesOf) {
  const bySeries = new Map();
  const unavailable = [];
  (rows || []).forEach((row) => {
    const series = row && row.refSeriesInstanceUID ? seriesFor(row) : null;
    if (!series) {
      unavailable.push(row);
      return;
    }
    const key = row.refSeriesInstanceUID;
    if (!bySeries.has(key)) {
      bySeries.set(key, {
        key,
        ...seriesHeading(series),
        seriesNumber: present(series.SeriesNumber) ? Number(series.SeriesNumber) : undefined,
        modality: series.Modality,
        instanceCount: seriesInstanceCount(row),
        measurements: [],
      });
    }
    bySeries.get(key).measurements.push(row);
  });

  const ordered = [...bySeries.values()].sort((a, b) => {
    const [na, nb] = [a.seriesNumber, b.seriesNumber].map(n => (Number.isFinite(n) ? n : Infinity));
    return na !== nb ? na - nb : a.label.localeCompare(b.label);
  });
  if (unavailable.length) {
    ordered.push({
      key: UNAVAILABLE_KEY, label: UNAVAILABLE_LABEL, labelKey: UNAVAILABLE_LABEL, help: UNAVAILABLE_HELP, measurements: unavailable,
    });
  }
  return ordered;
}

export {
  filterGroups, groupRowsBySeries, matchesQuery, queryWords, rowSearchText, rowToolName, rowToolType,
  seriesAnnotationTypes, seriesAvailable, seriesEntries, seriesHeading, seriesInstanceCount, seriesOf, seriesTitle, toolTypeName, toolTypeNames,
  trackedToolType,
  UNAVAILABLE_HELP, UNAVAILABLE_KEY, UNAVAILABLE_LABEL,
};
