import dcmjs from 'dcmjs';
import { adaptersSR as c3dAdaptersSR } from '@cornerstonejs/adapters';


const isToolSupported = (toolName) => {
  /**
  *  Checks if dcmjs has support to determined tool
  *
  * @param {string} toolName
  * @returns {boolean}
  */
  const adapter = c3dAdaptersSR.Cornerstone;
  return !!adapter[toolName];
};


export default isToolSupported;
