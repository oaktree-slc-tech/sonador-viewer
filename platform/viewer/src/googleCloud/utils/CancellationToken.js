export default class CancellationToken {
  // Class used to indicate the state of an operation. When set to True,
  // the operation associated with the token will be terminated early.

  constructor() {
    this.cancelled = false;
  }

  get() {
    // Return current value

    return this.cancelled;
  }

  set(value) {
    // Set current value

    this.cancelled = value;
  }
}
