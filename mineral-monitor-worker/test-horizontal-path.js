// Test the horizontal path calculation
import { calculateHorizontalPath, calculateWellLength, getWellDirection } from './src/utils/horizontalPath.js';

// Test with the Dusty well
const surfaceLocation = {
  section: '31',
  township: '18N',
  range: '16W'
};

const bottomHoleLocation = {
  section: '7',
  township: '17N',
  range: '16W'
};

console.log("Testing horizontal well path calculation");
console.log("=" + "=".repeat(50));
console.log(`Surface: Section ${surfaceLocation.section}, T${surfaceLocation.township} R${surfaceLocation.range}`);
console.log(`Bottom Hole: Section ${bottomHoleLocation.section}, T${bottomHoleLocation.township} R${bottomHoleLocation.range}`);

// Calculate path
const path = calculateHorizontalPath(surfaceLocation, bottomHoleLocation);
console.log(`\nWell passes through ${path.length} sections:`);
path.forEach((loc, i) => {
  console.log(`  ${i + 1}. Section ${loc.section}, T${loc.township} R${loc.range}`);
});

// Calculate length and direction
const length = calculateWellLength(surfaceLocation, bottomHoleLocation);
const direction = getWellDirection(surfaceLocation, bottomHoleLocation);

console.log(`\nWell characteristics:`);
console.log(`- Length: ${length.toLocaleString()} feet (${(length/5280).toFixed(1)} miles)`);
console.log(`- Direction: ${direction}`);