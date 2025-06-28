export default function (measurement) {
  if (!measurement) {
    return;
  }

  switch (measurement.toolType) {
    case 'Bidirectional':
    case 'TargetCR':
    case 'TargetNE':
    case 'TargetUN':
      return `Target ${measurement.measurementNumber}`;
    case 'NonTarget':
      return `Non-Target ${measurement.measurementNumber}`;
  }
}
