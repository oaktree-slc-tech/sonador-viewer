import { useQuery } from '@tanstack/react-query';

import DICOMWeb from '@ohif/core/src/DICOMWeb';

import { normalizeTagCache } from '../lib/utils/dicomTagCache';


export default function useTags({ server }) {
  // Retrieve DICOM tags from the server instance
  
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
    select: normalizeTagCache,
    enabled: !!server?.token && !!url,
  });
}
