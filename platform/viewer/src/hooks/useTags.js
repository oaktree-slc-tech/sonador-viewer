import { useQuery } from '@tanstack/react-query';
import { uniqBy } from 'lodash';

import DICOMWeb from '@ohif/core/src/DICOMWeb';

export default function useTags({ server }) {
  const [domain] = server?.qidoRoot
    ? server?.qidoRoot?.match(/^(?:https?:\/\/)?(?:[^@\/\n]+@)?(?:www\.)?([^:\/?\n]+)/gim) || ['']
    : [''];
  const [port] = server?.qidoRoot ? server?.qidoRoot?.match(/:\d+/) || [''] : [''];
  const url = `${domain}${port}`;

  return useQuery({
    queryKey: ['tags', server?.token],
    queryFn: () =>
      fetch(`${url}/cache/dcm-tags`, {
        headers: DICOMWeb.getAuthorizationHeader(server),
      }).then((res) => res.json()),
    select: (data) => {
      const allTagsList = Object.entries(data).reduce((acc, [tagType, tags]) => {
        const mappedTags = Object.values(tags).map((tag) => ({ ...tag, tagType }));

        return [...acc, ...mappedTags];
      }, []);

      const uniqueTagList = uniqBy(allTagsList, (tag) => tag.code);

      return uniqueTagList.reduce((acc, tag) => {
        const prevValues = acc[tag.tagType] || {};
        const { tagType, ...values } = tag;

        acc[tagType] = { ...prevValues, [tag.code]: values };

        return acc;
      }, {});
    },
    enabled: !!server?.token && !!url,
  });
}
