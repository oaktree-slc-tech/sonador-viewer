import { addCustomAttribute } from './customAttributes';
import { addCustomViewportSetting } from './customViewportSettings';
import ProtocolEngine from './ProtocolEngine.js';
import { ProtocolStore, ProtocolStrategy } from './protocolStore';

const hangingProtocols = {
  ProtocolEngine,
  ProtocolStore,
  ProtocolStrategy,
  addCustomAttribute,
  addCustomViewportSetting,
};

export default hangingProtocols;
