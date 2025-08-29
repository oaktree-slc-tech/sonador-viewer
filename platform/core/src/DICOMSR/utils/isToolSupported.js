import dcmjs from 'dcmjs';
import { Cornerstone3DSrAdapters } from '../Cornerstone3d';


const isToolSupported = (toolName) => {
  /**
  *  Checks if dcmjs has support to determined tool
  *
  * @param {string} toolName
  * @returns {boolean}
  */
  const adapter = Cornerstone3DSrAdapters;
  return !!adapter[toolName];
};


export default isToolSupported;
