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

const color = {
  val2hex,
  rgb2hex,
};

export default color;
export { color };
