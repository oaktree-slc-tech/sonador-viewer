import { OHIFInstanceMetadata } from './OHIFInstanceMetadata';
import { SeriesMetadata } from './SeriesMetadata';

export class OHIFSeriesMetadata extends SeriesMetadata {
  /**
   * @param {Object} Series object.
   */
  constructor(data, study, uid) {
    super(data, uid);
    this.init(study);
  }

  init(study) {
    const series = this.getData();

    // define "_seriesInstanceUID" protected property...
    Object.defineProperty(this, '_seriesInstanceUID', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: series.SeriesInstanceUID,
    });

    // populate internal list of instances...
    series.instances.forEach((instance) => {

      // Check instance for required interface properties, create a wrapper OHIF v2 instance
      // with a metadata property and url if those properties are not defined.
      let _instance;
      if (!instance.metadata) {
        const { imageId } = instance;
        _instance = { metadata: instance, url: imageId, };
      } else { _instance = instance; }

      this.addInstance(new OHIFInstanceMetadata(_instance, series, study));
    });
  }
}
