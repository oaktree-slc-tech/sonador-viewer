import { useQuery } from '@tanstack/react-query';

import loadThumbnailImage from '@ohif/core/src/utils/loadThumbnailImage.js';

/**
 * @param {string} imageId
 * @param {string} imageSrc
 * @returns {UseQueryResult<unknown, unknown>}
 */

export const useImageThumbnail = ({ imageId, imageSrc }) => {
  return useQuery({
    queryFn: () => loadThumbnailImage(imageId),
    queryKey: [imageId, 'image-thumbnail'],
    enabled: !!imageId && !imageSrc,
  });
};
