// The image ids a report's measurements are hydrated against. The Cornerstone3D adapters look an
// image up as `SOPInstanceUID:frame`; the viewer keeps the first frame's id by SOP instance and every
// frame's id by frame number. A frame without an id stays unresolved.

export default function frameImageIds(sopInstanceUIDToImageIdMap, imageIdsForToolState) {
  return new Proxy(sopInstanceUIDToImageIdMap || {}, {
    get: (target, key) => {
      if (typeof key !== 'string' || key in target || !key.includes(':')) {
        return target[key];
      }
      const [SOPInstanceUID, frame] = key.split(':');
      const frames = imageIdsForToolState && imageIdsForToolState[SOPInstanceUID];
      if (frames) {
        return frames[Number(frame)];
      }
      return Number(frame) === 1 ? target[SOPInstanceUID] : undefined;
    },
  });
}
