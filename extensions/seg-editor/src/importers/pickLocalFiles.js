// The platform's file window, as a promise of the files the user picked.

/**
 * @param {Object} [options]
 * @param {string} [options.accept] - the file input's accept list (extensions and MIME types)
 * @param {boolean} [options.multiple]
 * @param {Document} [options.document]
 * @returns {Promise<File[]>} empty when the window is cancelled
 */
export function pickLocalFiles({ accept, multiple = false, document = window.document } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) {
      input.accept = accept;
    }
    input.multiple = !!multiple;
    input.style.display = 'none';

    const finish = files => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish(Array.from(input.files || [])));
    input.addEventListener('cancel', () => finish([]));

    // In the document while open: some browsers drop the change event of a detached input
    document.body.appendChild(input);
    input.click();
  });
}
