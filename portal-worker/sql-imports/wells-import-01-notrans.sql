-- Oklahoma Wells Import
-- File 1 of 1
-- Records: 2


INSERT INTO wells (
  api_number, well_name, well_number,
  section, township, range, meridian,
  county, latitude, longitude,
  operator, well_type, well_status,
  spud_date, completion_date, source
) VALUES
('3501122334', 'SMITH 1-15', '1-15', 15, '9N', '5W', 'IM', 'Cleveland', 35.123, -97.456, 'XTO Energy', 'Oil', 'Active', '2023-01-15', '2023-03-20', 'OCC'),
('3502344556', 'JONES 2-10', '2-10', 10, '10N', '4W', 'IM', 'Oklahoma', 35.234, -97.567, 'Continental', 'Gas', 'Producing', '2023-02-01', '2023-04-15', 'OCC');

