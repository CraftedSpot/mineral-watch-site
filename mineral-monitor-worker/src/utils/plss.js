/**
 * PLSS Utilities - Public Land Survey System calculations
 * 
 * Oklahoma uses the PLSS grid system with 36 sections per township.
 * Sections are numbered in a serpentine pattern:
 * 
 *  6  5  4  3  2  1
 *  7  8  9 10 11 12
 * 18 17 16 15 14 13
 * 19 20 21 22 23 24
 * 30 29 28 27 26 25
 * 31 32 33 34 35 36
 */

import { parseTownship, parseRange } from './normalize.js';

/**
 * Get the 8 adjacent sections to a given section
 * Handles township/range boundary crossings
 * 
 * @param {number} section - Section number (1-36)
 * @param {string} township - Township string (e.g., "28N")
 * @param {string} range - Range string (e.g., "19W")
 * @returns {Array} - Array of { section, township, range } objects
 */
export function getAdjacentSections(section, township, range) {
  const adjacent = [];
  
  // Get row and column position in the township grid
  const { row, col } = getSectionPosition(section);
  
  // All 8 directions: N, NE, E, SE, S, SW, W, NW
  const directions = [
    { dr: -1, dc: 0, name: 'N' },   // North
    { dr: -1, dc: 1, name: 'NE' },  // Northeast
    { dr: 0, dc: 1, name: 'E' },    // East
    { dr: 1, dc: 1, name: 'SE' },   // Southeast
    { dr: 1, dc: 0, name: 'S' },    // South
    { dr: 1, dc: -1, name: 'SW' }, // Southwest
    { dr: 0, dc: -1, name: 'W' },  // West
    { dr: -1, dc: -1, name: 'NW' } // Northwest
  ];
  
  for (const { dr, dc, name } of directions) {
    const newRow = row + dr;
    const newCol = col + dc;
    
    let adjSection, adjTownship, adjRange;
    
    // Check if we're crossing township/range boundaries
    if (newRow < 0) {
      // Crossing north - go to township + 1 North (or - 1 South)
      adjTownship = adjustTownship(township, 1);
      adjSection = getSectionFromPosition(5, newCol); // Bottom row of new township
    } else if (newRow > 5) {
      // Crossing south - go to township - 1 North (or + 1 South)
      adjTownship = adjustTownship(township, -1);
      adjSection = getSectionFromPosition(0, newCol); // Top row of new township
    } else {
      adjTownship = township;
    }
    
    if (newCol < 0) {
      // Crossing west - go to range + 1 West (or - 1 East)
      adjRange = adjustRange(range, 1);
      if (newRow >= 0 && newRow <= 5) {
        adjSection = getSectionFromPosition(newRow, 5); // Right column of new range
      }
    } else if (newCol > 5) {
      // Crossing east - go to range - 1 West (or + 1 East)
      adjRange = adjustRange(range, -1);
      if (newRow >= 0 && newRow <= 5) {
        adjSection = getSectionFromPosition(newRow, 0); // Left column of new range
      }
    } else {
      adjRange = range;
    }
    
    // If we haven't set adjSection yet (within same township)
    if (adjSection === undefined && newRow >= 0 && newRow <= 5 && newCol >= 0 && newCol <= 5) {
      adjSection = getSectionFromPosition(newRow, newCol);
      adjTownship = adjTownship || township;
      adjRange = adjRange || range;
    }
    
    // Handle corners (crossing both township and range)
    if (newRow < 0 && newCol < 0) {
      adjTownship = adjustTownship(township, 1);
      adjRange = adjustRange(range, 1);
      adjSection = 36; // SE corner of NW township
    } else if (newRow < 0 && newCol > 5) {
      adjTownship = adjustTownship(township, 1);
      adjRange = adjustRange(range, -1);
      adjSection = 31; // SW corner of NE township
    } else if (newRow > 5 && newCol < 0) {
      adjTownship = adjustTownship(township, -1);
      adjRange = adjustRange(range, 1);
      adjSection = 6; // NE corner of SW township
    } else if (newRow > 5 && newCol > 5) {
      adjTownship = adjustTownship(township, -1);
      adjRange = adjustRange(range, -1);
      adjSection = 1; // NW corner of SE township
    }
    
    if (adjSection !== undefined && adjTownship && adjRange) {
      adjacent.push({
        section: adjSection,
        township: adjTownship,
        range: adjRange,
        direction: name
      });
    }
  }
  
  return adjacent;
}

/**
 * Get the row and column position of a section in the township grid
 * @param {number} section - Section number (1-36)
 * @returns {Object} - { row: 0-5, col: 0-5 }
 */
function getSectionPosition(section) {
  // Section layout (serpentine):
  //  6  5  4  3  2  1    row 0
  //  7  8  9 10 11 12    row 1
  // 18 17 16 15 14 13    row 2
  // 19 20 21 22 23 24    row 3
  // 30 29 28 27 26 25    row 4
  // 31 32 33 34 35 36    row 5
  
  const sectionGrid = [
    [6, 5, 4, 3, 2, 1],
    [7, 8, 9, 10, 11, 12],
    [18, 17, 16, 15, 14, 13],
    [19, 20, 21, 22, 23, 24],
    [30, 29, 28, 27, 26, 25],
    [31, 32, 33, 34, 35, 36]
  ];
  
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      if (sectionGrid[row][col] === section) {
        return { row, col };
      }
    }
  }
  
  console.warn(`[PLSS] Invalid section number: ${section}`);
  return { row: 0, col: 0 };
}

/**
 * Get the section number from row and column position
 * @param {number} row - Row (0-5)
 * @param {number} col - Column (0-5)
 * @returns {number} - Section number (1-36)
 */
function getSectionFromPosition(row, col) {
  const sectionGrid = [
    [6, 5, 4, 3, 2, 1],
    [7, 8, 9, 10, 11, 12],
    [18, 17, 16, 15, 14, 13],
    [19, 20, 21, 22, 23, 24],
    [30, 29, 28, 27, 26, 25],
    [31, 32, 33, 34, 35, 36]
  ];
  
  if (row >= 0 && row <= 5 && col >= 0 && col <= 5) {
    return sectionGrid[row][col];
  }
  
  return undefined;
}

/**
 * Adjust township by a delta (positive = further north, negative = further south)
 * @param {string} township - e.g., "28N" or "10S"
 * @param {number} delta - Amount to adjust (+1 or -1)
 * @returns {string} - Adjusted township string
 */
function adjustTownship(township, delta) {
  const { number, direction } = parseTownship(township);
  
  let newNumber;
  let newDirection = direction;
  
  if (direction === 'N') {
    newNumber = number + delta;
    if (newNumber <= 0) {
      // Crossing into South townships
      newNumber = Math.abs(newNumber) + 1;
      newDirection = 'S';
    }
  } else {
    // South townships
    newNumber = number - delta;
    if (newNumber <= 0) {
      // Crossing into North townships
      newNumber = Math.abs(newNumber) + 1;
      newDirection = 'N';
    }
  }
  
  return `${newNumber}${newDirection}`;
}

/**
 * Adjust range by a delta (positive = further west, negative = further east)
 * @param {string} range - e.g., "19W" or "5E"
 * @param {number} delta - Amount to adjust (+1 or -1)
 * @returns {string} - Adjusted range string
 */
function adjustRange(range, delta) {
  const { number, direction } = parseRange(range);
  
  let newNumber;
  let newDirection = direction;
  
  if (direction === 'W') {
    newNumber = number + delta;
    if (newNumber <= 0) {
      // Crossing into East ranges
      newNumber = Math.abs(newNumber) + 1;
      newDirection = 'E';
    }
  } else {
    // East ranges
    newNumber = number - delta;
    if (newNumber <= 0) {
      // Crossing into West ranges
      newNumber = Math.abs(newNumber) + 1;
      newDirection = 'W';
    }
  }
  
  return `${newNumber}${newDirection}`;
}

/**
 * Get the extended 5x5 grid of sections (24 adjacent sections, 2 sections out in each direction)
 * Used for horizontal permits without BH data
 * 
 * @param {number} section - Section number (1-36)
 * @param {string} township - Township string (e.g., "28N")
 * @param {string} range - Range string (e.g., "19W")
 * @returns {Array} - Array of { section, township, range } objects
 */
export function getExtendedAdjacentSections(section, township, range) {
  const extended = [];
  
  // Get row and column position in the township grid
  const { row, col } = getSectionPosition(section);
  
  // For a 5x5 grid, we go 2 sections out in each direction
  // This includes the 8 immediate adjacent plus 16 more in the outer ring
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      // Skip the center section (0,0)
      if (dr === 0 && dc === 0) continue;
      
      const newRow = row + dr;
      const newCol = col + dc;
      
      let adjSection, adjTownship = township, adjRange = range;
      
      // Handle township/range boundary crossings
      let townshipDelta = 0;
      let rangeDelta = 0;
      
      // Check row boundaries
      if (newRow < 0) {
        townshipDelta = Math.ceil(Math.abs(newRow) / 6);
        adjTownship = adjustTownship(township, townshipDelta);
      } else if (newRow > 5) {
        townshipDelta = -Math.ceil((newRow - 5) / 6);
        adjTownship = adjustTownship(township, townshipDelta);
      }
      
      // Check column boundaries
      if (newCol < 0) {
        rangeDelta = Math.ceil(Math.abs(newCol) / 6);
        adjRange = adjustRange(range, rangeDelta);
      } else if (newCol > 5) {
        rangeDelta = -Math.ceil((newCol - 5) / 6);
        adjRange = adjustRange(range, rangeDelta);
      }
      
      // Calculate the section position within the adjusted township/range
      let finalRow = ((newRow % 6) + 6) % 6;
      let finalCol = ((newCol % 6) + 6) % 6;
      
      // Handle negative modulo correctly
      if (newRow < 0 && newRow % 6 !== 0) {
        finalRow = 6 + (newRow % 6);
      }
      if (newCol < 0 && newCol % 6 !== 0) {
        finalCol = 6 + (newCol % 6);
      }
      
      adjSection = getSectionFromPosition(finalRow, finalCol);
      
      if (adjSection !== undefined) {
        extended.push({
          section: adjSection,
          township: adjTownship,
          range: adjRange,
          distance: Math.max(Math.abs(dr), Math.abs(dc)) // Manhattan distance
        });
      }
    }
  }
  
  return extended;
}

/**
 * Check if two S-T-R locations are adjacent
 * @param {Object} loc1 - { section, township, range }
 * @param {Object} loc2 - { section, township, range }
 * @returns {boolean} - Whether the locations are adjacent
 */
export function areAdjacent(loc1, loc2) {
  const adjacent = getAdjacentSections(loc1.section, loc1.township, loc1.range);
  
  return adjacent.some(adj => 
    adj.section === loc2.section &&
    adj.township.toUpperCase() === loc2.township.toUpperCase() &&
    adj.range.toUpperCase() === loc2.range.toUpperCase()
  );
}
