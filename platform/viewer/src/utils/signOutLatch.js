/**
 * Sign-out latch.
 *
 * Set from the moment logout is requested until the browser navigates away. While it is set the
 * sign-in routes do not start a sign-in, which would otherwise race the logout navigation, and a
 * pending token renewal stores nothing.
 *
 * Module scope rather than sessionStorage: the logout navigation replaces the document and so
 * clears it, whereas sessionStorage would outlive the logout on the viewer's origin.
 */
let signingOut = false;

export function isSigningOut() {
  return signingOut;
}

export function beginSignOut() {
  signingOut = true;
}

export function endSignOut() {
  signingOut = false;
}
