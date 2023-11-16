export function pascalCaseToWordsWithCases(inputString) {
  if (!inputString) return inputString;
  // Split the input string into words based on uppercase letters
  const words = inputString.split(/(?=[A-Z])/);

  // Initialize an array to store the converted words
  const convertedWords = [];

  // Iterate through the words
  for (let i = 0; i < words.length; i++) {
    let word = words[i];

    // If it's the first word, convert to title case
    if (i === 0) {
      word = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    } else {
      // If it's not the first word, convert to lowercase
      word = word.toLowerCase();
    }

    // Add the converted word to the array
    convertedWords.push(word);
  }

  // Join the words with spaces to form the final sentence
  return convertedWords.join(' ');
}
