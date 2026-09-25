import log from './../log.js';

export default class ServicesManager {
  constructor(commandsManager = null) {
    this._commandsManager = commandsManager;
    this._extensionManager = null;
    this.services = {};
    this.registeredServiceNames = [];
  }

  /**
   * The viewer creates the services manager before the commands and extension managers
   * exist, so both are attached once they are constructed. OHIF v3 services (e.g. the
   * ToolbarService) receive them in their `create` factory.
   */
  setCommandsManager(commandsManager) {
    this._commandsManager = commandsManager;
  }

  setExtensionManager(extensionManager) {
    this._extensionManager = extensionManager;
  }

  /**
   * Registers a new service.
   *
   * @param {Object} service
   * @param {Object} configuration
   */
  registerService(service, configuration = {}) {
    if (!service) {
      log.warn('Attempting to register a null/undefined service. Exiting early.');
      return;
    }

    if (!service.name) {
      log.warn(`Service name not set. Exiting early.`);
      return;
    }

    if (this.registeredServiceNames.includes(service.name)) {
      log.warn(`Service name ${service.name} has already been registered. Exiting before duplicating services.`);
      return;
    }

    if (service.create) {
      this.services[service.name] = service.create({
        configuration,
        extensionManager: this._extensionManager,
        commandsManager: this._commandsManager,
        servicesManager: this,
      });

      // OHIF v3 registers services under a camelCase key (`uiNotificationService`) while the
      // Sonador Viewer's existing call sites use the v2 PascalCase key (`UINotificationService`).
      // Aliasing both to the same instance lets ported v3 code and existing viewer code share a
      // service without a repo-wide rename. See OHIF v3 ServicesManager.registerService.
      if (service.altName) {
        this.services[service.altName] = this.services[service.name];
      }
    } else {
      log.warn(`Service create factory function not defined. Exiting early.`);
      return;
    }

    /* Track service registration */
    this.registeredServiceNames.push(service.name);
  }

  /**
   * An array of services, or an array of arrays that contains service
   * configuration pairs.
   *
   * @param {Object[]} services - Array of services
   */
  registerServices(services) {
    services.forEach((service) => {
      const hasConfiguration = Array.isArray(service);

      if (hasConfiguration) {
        const [ohifService, configuration] = service;
        this.registerService(ohifService, configuration);
      } else {
        this.registerService(service);
      }
    });
  }
}
