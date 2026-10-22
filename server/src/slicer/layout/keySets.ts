/**
 * Option keys whose value is a vector (one entry per extruder or per list element). The schema
 * builder derives `perExtruder` and the vector option type from them.
 */

/** Printer options whose value is one entry per extruder */
export const PRINTER_VECTOR_KEYS = new Set([
  'nozzle_diameter',
  'nozzle_high_flow',
  'min_layer_height',
  'max_layer_height',
  'extruder_offset',
  'retract_length',
  'retract_lift',
  'retract_lift_above',
  'retract_lift_below',
  'travel_ramping_lift',
  'travel_slope',
  'travel_max_lift',
  'travel_lift_before_obstacle',
  'retract_speed',
  'deretract_speed',
  'retract_restart_extra',
  'retract_before_travel',
  'retract_layer_change',
  'wipe',
  'retract_before_wipe',
  'retract_length_toolchange',
  'retract_restart_extra_toolchange',
  'extruder_colour',
  'machine_max_feedrate_x',
  'machine_max_feedrate_y',
  'machine_max_feedrate_z',
  'machine_max_feedrate_e',
  'machine_max_acceleration_x',
  'machine_max_acceleration_y',
  'machine_max_acceleration_z',
  'machine_max_acceleration_e',
  'machine_max_acceleration_extruding',
  'machine_max_acceleration_retracting',
  'machine_max_acceleration_travel',
  'machine_max_jerk_x',
  'machine_max_jerk_y',
  'machine_max_jerk_z',
  'machine_max_jerk_e',
  'machine_min_extruding_rate',
  'machine_min_travel_rate',
  'machine_max_junction_deviation',
]);

export const PRINTER_STRING_VECTOR_KEYS = new Set(['extruder_colour']);

export const PRINT_VECTOR_KEYS = new Set([
  'post_process',
  'compatible_printers',
  'compatible_prints',
  'wiping_volumes_matrix',
  'wiping_volumes_extruders',
]);
