/**
 * Well Enrichment Service
 *
 * Updates the D1 wells table with completion data from OCC files.
 * Called during daily monitor processing to keep wells enriched with
 * formation, depth, BH location, and IP data.
 */

/**
 * Enrich a single well with completion data
 * Only updates fields that are NULL in the existing record (additive)
 *
 * @param {Object} env - Worker environment with WELLS_DB binding
 * @param {string} apiNumber - API number (10 digits, no dashes)
 * @param {Object} completionData - Completion data from OCC file
 * @returns {Object} - { success: boolean, updated: boolean, fields: string[] }
 */
export async function enrichWellFromCompletion(env, apiNumber, completionData) {
  if (!env.WELLS_DB) {
    console.error('[WellEnrichment] D1 database binding (WELLS_DB) not found');
    return { success: false, error: 'Database not configured' };
  }

  if (!apiNumber) {
    return { success: false, error: 'No API number provided' };
  }

  // Clean API number
  const cleanApi = apiNumber.toString().replace(/-/g, '').replace(/\s/g, '');

  try {
    // Build SET clauses for non-null fields only (additive update)
    const updates = [];
    const values = [];
    const fieldsUpdated = [];

    // Formation data
    if (completionData.Formation_Name) {
      updates.push('formation_name = COALESCE(formation_name, ?)');
      values.push(completionData.Formation_Name);
      fieldsUpdated.push('formation_name');
    }

    if (completionData.Formation_Depth) {
      updates.push('formation_depth = COALESCE(formation_depth, ?)');
      values.push(parseInt(completionData.Formation_Depth, 10) || null);
      fieldsUpdated.push('formation_depth');
    }

    // Bottom hole coordinates
    if (completionData.Bottom_Hole_Lat_Y) {
      const lat = parseFloat(completionData.Bottom_Hole_Lat_Y);
      if (lat && lat !== 0) {
        updates.push('bh_latitude = COALESCE(bh_latitude, ?)');
        values.push(lat);
        fieldsUpdated.push('bh_latitude');
      }
    }

    if (completionData.Bottom_Hole_Long_X) {
      const lng = parseFloat(completionData.Bottom_Hole_Long_X);
      if (lng && lng !== 0) {
        updates.push('bh_longitude = COALESCE(bh_longitude, ?)');
        values.push(lng);
        fieldsUpdated.push('bh_longitude');
      }
    }

    // Bottom hole location (section/township/range)
    if (completionData.BH_Section) {
      updates.push('bh_section = COALESCE(bh_section, ?)');
      values.push(parseInt(completionData.BH_Section, 10) || null);
      fieldsUpdated.push('bh_section');
    }

    if (completionData.BH_Township) {
      updates.push('bh_township = COALESCE(bh_township, ?)');
      values.push(completionData.BH_Township);
      fieldsUpdated.push('bh_township');
    }

    if (completionData.BH_Range) {
      updates.push('bh_range = COALESCE(bh_range, ?)');
      values.push(completionData.BH_Range);
      fieldsUpdated.push('bh_range');
    }

    // Depth measurements
    if (completionData.Measured_Total_Depth) {
      updates.push('measured_total_depth = COALESCE(measured_total_depth, ?)');
      values.push(parseInt(completionData.Measured_Total_Depth, 10) || null);
      fieldsUpdated.push('measured_total_depth');
    }

    if (completionData.True_Vertical_Depth) {
      updates.push('true_vertical_depth = COALESCE(true_vertical_depth, ?)');
      values.push(parseInt(completionData.True_Vertical_Depth, 10) || null);
      fieldsUpdated.push('true_vertical_depth');
    }

    if (completionData.Length || completionData.Lateral_Length) {
      const lateralLength = completionData.Length || completionData.Lateral_Length;
      updates.push('lateral_length = COALESCE(lateral_length, ?)');
      values.push(parseInt(lateralLength, 10) || null);
      fieldsUpdated.push('lateral_length');
    }

    // Initial production data
    if (completionData.Oil_BBL_Per_Day) {
      const ipOil = parseFloat(completionData.Oil_BBL_Per_Day);
      if (ipOil) {
        updates.push('ip_oil_bbl = COALESCE(ip_oil_bbl, ?)');
        values.push(ipOil);
        fieldsUpdated.push('ip_oil_bbl');
      }
    }

    if (completionData.Gas_MCF_Per_Day) {
      const ipGas = parseFloat(completionData.Gas_MCF_Per_Day);
      if (ipGas) {
        updates.push('ip_gas_mcf = COALESCE(ip_gas_mcf, ?)');
        values.push(ipGas);
        fieldsUpdated.push('ip_gas_mcf');
      }
    }

    if (completionData.Water_BBL_Per_Day) {
      const ipWater = parseFloat(completionData.Water_BBL_Per_Day);
      if (ipWater) {
        updates.push('ip_water_bbl = COALESCE(ip_water_bbl, ?)');
        values.push(ipWater);
        fieldsUpdated.push('ip_water_bbl');
      }
    }

    // Completion date
    if (completionData.Well_Completion) {
      let completionDate = completionData.Well_Completion;
      // Handle various date formats
      if (completionDate instanceof Date) {
        completionDate = completionDate.toISOString().split('T')[0];
      } else if (typeof completionDate === 'string') {
        completionDate = completionDate.substring(0, 10); // YYYY-MM-DD
      }
      if (completionDate && completionDate !== 'null' && completionDate.length >= 10) {
        updates.push('completion_date = COALESCE(completion_date, ?)');
        values.push(completionDate);
        fieldsUpdated.push('completion_date');
      }
    }

    // Drill type and horizontal/directional flags
    if (completionData.Drill_Type) {
      updates.push('drill_type = COALESCE(drill_type, ?)');
      values.push(completionData.Drill_Type);
      fieldsUpdated.push('drill_type');

      // Only true horizontal wells (HH) get is_horizontal = 1
      if (completionData.Drill_Type === 'HORIZONTAL HOLE' ||
          completionData.Location_Type_Sub === 'HH') {
        updates.push('is_horizontal = 1');
        fieldsUpdated.push('is_horizontal');
      }

      // Directional wells get their own flag
      if (completionData.Drill_Type === 'DIRECTIONAL' ||
          completionData.Location_Type_Sub === 'DH') {
        updates.push('is_directional = 1');
        fieldsUpdated.push('is_directional');
      }
    }

    // lateral_length > 0 is a strong indicator of true horizontal
    if (completionData.Length || completionData.Lateral_Length) {
      const lateralLen = parseInt(completionData.Length || completionData.Lateral_Length, 10);
      if (lateralLen > 0) {
        updates.push('is_horizontal = 1');
        if (!fieldsUpdated.includes('is_horizontal')) {
          fieldsUpdated.push('is_horizontal');
        }
      }
    }

    // Skip if nothing to update
    if (updates.length === 0) {
      return { success: true, updated: false, fields: [] };
    }

    // Execute UPDATE
    values.push(cleanApi);
    const query = `
      UPDATE wells
      SET ${updates.join(', ')}
      WHERE api_number = ? OR api_number LIKE ?
    `;
    values.push(`${cleanApi}%`);

    const result = await env.WELLS_DB.prepare(query).bind(...values).run();

    const updated = (result.meta?.changes || 0) > 0;

    if (updated) {
      console.log(`[WellEnrichment] Updated ${cleanApi}: ${fieldsUpdated.join(', ')}`);
    }

    return {
      success: true,
      updated,
      fields: updated ? fieldsUpdated : []
    };

  } catch (error) {
    console.error(`[WellEnrichment] Error updating ${cleanApi}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Batch enrich wells from an array of completion records
 *
 * @param {Object} env - Worker environment with WELLS_DB binding
 * @param {Array} completions - Array of completion records from OCC
 * @returns {Object} - { total: number, updated: number, errors: number }
 */
export async function batchEnrichWellsFromCompletions(env, completions) {
  if (!env.WELLS_DB) {
    console.error('[WellEnrichment] D1 database binding (WELLS_DB) not found');
    return { total: 0, updated: 0, errors: 0, error: 'Database not configured' };
  }

  const stats = {
    total: completions.length,
    updated: 0,
    errors: 0,
    fieldsUpdated: {}
  };

  for (const completion of completions) {
    const apiNumber = completion.API_Number;
    if (!apiNumber) continue;

    const result = await enrichWellFromCompletion(env, apiNumber, completion);

    if (result.success && result.updated) {
      stats.updated++;
      for (const field of result.fields || []) {
        stats.fieldsUpdated[field] = (stats.fieldsUpdated[field] || 0) + 1;
      }
    } else if (!result.success) {
      stats.errors++;
    }
  }

  console.log(`[WellEnrichment] Batch complete: ${stats.updated}/${stats.total} wells enriched, ${stats.errors} errors`);

  return stats;
}
