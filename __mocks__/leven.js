// Mock implementation of leven for Jest tests
function levenshteinDistance(a, b) {
  if (a === b) return 0;
  
  // Simple mock implementation for testing
  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  
  let matches = 0;
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) matches++;
  }
  
  return maxLen - matches;
}

module.exports = levenshteinDistance;
module.exports.default = levenshteinDistance;