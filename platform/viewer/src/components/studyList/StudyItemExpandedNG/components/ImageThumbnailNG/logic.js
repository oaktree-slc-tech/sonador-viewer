import { useQuery } from '@tanstack/react-query';
import cornerstone from 'cornerstone-core';

/**
 * @param {string} imageId
 * @param {string} imageSrc
 * @returns {UseQueryResult<unknown, unknown>}
 */

export const useImageThumbnail = ({ imageId, imageSrc }) => {
  return useQuery({
    queryFn: () => cornerstone.loadAndCacheImage(imageId),
    queryKey: [imageId, 'image-thumbnail'],
    enabled: !!imageId && !imageSrc,
  });
};
