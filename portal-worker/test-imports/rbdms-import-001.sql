-- RBDMS Wells Import from OCC
-- File 1 of 1
-- Records: 1
-- Generated: 2025-12-23T15:02:45.790Z

BEGIN TRANSACTION;

-- Use INSERT OR REPLACE to handle duplicates
INSERT OR REPLACE INTO wells (
  api_number, well_name, well_number,
  section, township, range, meridian,
  county, latitude, longitude,
  operator, well_type, well_status,
  spud_date, completion_date, source
) VALUES
('3500100002', 'PENN MUTUAL LIFE', '#1', 5, '16N', '24E', 'IM', 'ADAIR', 35.894723, -94.78241, 'OTC/OCC NOT ASSIGNED', 'DRY', 'PA', NULL, NULL, 'RBDMS');

COMMIT;
