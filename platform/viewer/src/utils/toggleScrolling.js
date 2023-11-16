export default function toggleScrolling(enabled) {
  const body = document.getElementById('body');

  if (enabled) {
    body.classList.remove('disabledScroll');
  } else {
    body.classList.add('disabledScroll');
  }
}
