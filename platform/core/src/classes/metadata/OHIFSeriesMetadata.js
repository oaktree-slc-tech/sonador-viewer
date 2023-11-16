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
      this.addInstance(new OHIFInstanceMetadata(instance, series, study));
    });
  }
}
