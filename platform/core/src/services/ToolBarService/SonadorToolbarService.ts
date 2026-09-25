import ToolbarService from './ToolbarService';
import { getToolbarUITypeEntries } from './toolbarModuleEntries';

/**
 * The OHIF v3 ToolbarService (kept verbatim in ToolbarService.ts) assumes every registered
 * toolbar module is a v3 array. Sonador extensions still register v2 toolbar modules for
 * ToolbarRow, so button UI types are resolved through getToolbarUITypeEntries instead.
 */
export default class SonadorToolbarService extends ToolbarService {
  public static REGISTRATION = {
    name: 'toolbarService',
    altName: 'ToolBarService',
    create: ({ commandsManager, extensionManager, servicesManager }) => {
      return new SonadorToolbarService(commandsManager, extensionManager, servicesManager);
    },
  };

  _getButtonUITypes() {
    const registeredToolbarModules = this._extensionManager?.modules?.['toolbarModule'];

    if (!Array.isArray(registeredToolbarModules)) {
      return {};
    }

    return registeredToolbarModules.reduce((buttonTypes, toolbarModule) => {
      getToolbarUITypeEntries(toolbarModule.module).forEach(def => {
        buttonTypes[def.name] = def;
      });

      return buttonTypes;
    }, {});
  }
}
