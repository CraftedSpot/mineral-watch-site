/**
 * Calculate sections along a horizontal well path
 * This generates a list of sections between surface and bottom hole locations
 */

/**
 * Parse township string to get numeric value and direction
 * @param {string} township - e.g., "18N" or "5S"
 * @returns {Object} - { value: 18, direction: 'N' }
 */
function parseTownship(township) {
  const match = township.match(/(\d+)([NS])/i);
  if (!match) throw new Error(`Invalid township format: ${township}`);
  return { value: parseInt(match[1]), direction: match[2].toUpperCase() };
}

/**
 * Parse range string to get numeric value and direction
 * @param {string} range - e.g., "16W" or "2E"
 * @returns {Object} - { value: 16, direction: 'W' }
 */
function parseRange(range) {
  const match = range.match(/(\d+)([EW])/i);
  if (!match) throw new Error(`Invalid range format: ${range}`);
  return { value: parseInt(match[1]), direction: match[2].toUpperCase() };
}

/**
 * Convert section-township-range to grid coordinates
 * Townships are 6x6 miles, sections are 1x1 mile
 * Section numbering: 6-5-4-3-2-1 (top row, right to left)
 *                    7-8-9-10-11-12 (second row, left to right)
 *                    18-17-16-15-14-13 (third row, right to left)
 *                    etc...
 */
function sectionToGrid(section, township, range) {
  const sec = parseInt(section);
  const twp = parseTownship(township);
  const rng = parseRange(range);
  
  // Calculate section position within township (0-5 for x and y)
  const row = Math.floor((sec - 1) / 6);
  let col;
  
  if (row % 2 === 0) {
    // Even rows (0, 2, 4) go right to left (6-1, 18-13, 30-25)
    col = 5 - ((sec - 1) % 6);
  } else {
    // Odd rows (1, 3, 5) go left to right (7-12, 19-24, 31-36)
    col = (sec - 1) % 6;
  }
  
  // Calculate absolute grid position
  // Base everything on Township 1N, Range 1W as origin (0, 0)
  let x = 0;
  let y = 0;
  
  // Township position (6 miles per township)
  if (twp.direction === 'N') {
    y = (twp.value - 1) * 6;
  } else { // 'S'
    y = -twp.value * 6;
  }
  
  // Range position (6 miles per range)
  if (rng.direction === 'W') {
    x = -(rng.value - 1) * 6;
  } else { // 'E'
    x = rng.value * 6;
  }
  
  // Add section offset within township
  x += col;
  y += row;
  
  return { x, y };
}

/**
 * Convert grid coordinates back to section-township-range
 */
function gridToSection(x, y) {
  // Determine township
  const twpValue = Math.floor(y / 6) + 1;
  const twpDirection = y >= 0 ? 'N' : 'S';
  const township = `${Math.abs(twpValue)}${twpDirection}`;
  
  // Determine range
  const rngValue = Math.floor(Math.abs(x) / 6) + 1;
  const rngDirection = x < 0 ? 'W' : 'E';
  const range = `${rngValue}${rngDirection}`;
  
  // Determine section within township
  const sectionRow = Math.abs(y) % 6;
  const sectionCol = Math.abs(x) % 6;
  
  let section;
  if (sectionRow % 2 === 0) {
    // Even rows go right to left
    section = sectionRow * 6 + (6 - sectionCol);
  } else {
    // Odd rows go left to right
    section = sectionRow * 6 + sectionCol + 1;
  }
  
  return { section, township, range };
}

/**
 * Calculate all sections along a horizontal well path
 * Uses Bresenham's line algorithm to find all grid cells the line passes through
 */
export function calculateHorizontalPath(surfaceLocation, bottomHoleLocation) {
  // Parse locations
  const start = sectionToGrid(
    surfaceLocation.section,
    surfaceLocation.township,
    surfaceLocation.range
  );
  
  const end = sectionToGrid(
    bottomHoleLocation.section,
    bottomHoleLocation.township,
    bottomHoleLocation.range
  );
  
  // Use Bresenham's algorithm to find all sections the line passes through
  const sections = new Set();
  
  // Always include start and end sections
  sections.add(`${surfaceLocation.section}|${surfaceLocation.township}|${surfaceLocation.range}`);
  sections.add(`${bottomHoleLocation.section}|${bottomHoleLocation.township}|${bottomHoleLocation.range}`);
  
  // Calculate the line
  let x0 = start.x;
  let y0 = start.y;
  const x1 = end.x;
  const y1 = end.y;
  
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  
  while (x0 !== x1 || y0 !== y1) {
    const location = gridToSection(x0, y0);
    sections.add(`${location.section}|${location.township}|${location.range}`);
    
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
  
  // Convert set to array of location objects
  return Array.from(sections).map(key => {
    const [section, township, range] = key.split('|');
    return { section, township, range };
  });
}

/**
 * Calculate the approximate length of a horizontal well in feet
 */
export function calculateWellLength(surfaceLocation, bottomHoleLocation) {
  const start = sectionToGrid(
    surfaceLocation.section,
    surfaceLocation.township,
    surfaceLocation.range
  );
  
  const end = sectionToGrid(
    bottomHoleLocation.section,
    bottomHoleLocation.township,
    bottomHoleLocation.range
  );
  
  // Each grid unit is 1 mile = 5280 feet
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distanceMiles = Math.sqrt(dx * dx + dy * dy);
  
  return Math.round(distanceMiles * 5280);
}

/**
 * Get compass direction of well path
 */
export function getWellDirection(surfaceLocation, bottomHoleLocation) {
  const start = sectionToGrid(
    surfaceLocation.section,
    surfaceLocation.township,
    surfaceLocation.range
  );
  
  const end = sectionToGrid(
    bottomHoleLocation.section,
    bottomHoleLocation.township,
    bottomHoleLocation.range
  );
  
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  
  // Calculate angle in degrees
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  
  // Convert to compass direction
  const normalizedAngle = (angle + 360) % 360;
  
  const directions = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
  const index = Math.round(normalizedAngle / 45) % 8;
  
  return directions[index];
}