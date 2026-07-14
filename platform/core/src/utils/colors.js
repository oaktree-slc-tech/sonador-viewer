const val2hex = (c) => {
  // Convert a numerical value to hexadecimal
  let val = c.toString(16);

  // If c is less than 16, added an additional padded zero.
  return c < 16 ? '0' + val : val;
};

const rgb2hex = (r, g, b) => {
  // Convert an RGB encoded triad to a hexadecimal encoded string
  return '#' + [val2hex(r), val2hex(g), val2hex(b)].join('');
};

const hex2rgb = (hex) => {
  // Convert a hexadecimal encoded color string ('#rrggbb' or 'rrggbb') to an RGB triad
  const _hex = String(hex).replace('#', '');
  return [
    parseInt(_hex.substring(0, 2), 16),
    parseInt(_hex.substring(2, 4), 16),
    parseInt(_hex.substring(4, 6), 16),
  ];
};

const color = {
  val2hex,
  rgb2hex,
  hex2rgb,
};

export default color;
export { color };
