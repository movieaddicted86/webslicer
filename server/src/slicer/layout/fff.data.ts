/**
 * PrusaSlicer's FFF settings tabs as a pure data table: preset type, tab, page and group titles
 * with the option keys they show. `schema.ts` filters it down to the keys the installed slicer
 * really knows. Pure data – this file may exceed the 600-line review limit of CONVENTIONS §4.
 */
import type { Tab } from './types.js';

export const LAYOUT_FFF: Tab[] = [
  {
    presetType: 'print',
    title: 'Print Settings',
    pages: [
      {
        title: 'Layers and perimeters',
        groups: [
          { title: 'Layer height', keys: ['layer_height', 'first_layer_height'] },
          { title: 'Vertical shells', keys: ['perimeters', 'spiral_vase'] },
          {
            title: 'Horizontal shells',
            keys: [
              'top_solid_layers',
              'top_solid_min_thickness',
              'bottom_solid_layers',
              'bottom_solid_min_thickness',
              'ensure_vertical_shell_thickness',
            ],
          },
          {
            title: 'Quality (slower slicing)',
            keys: [
              'extra_perimeters',
              'extra_perimeters_on_overhangs',
              'avoid_crossing_curled_overhangs',
              'avoid_crossing_perimeters',
              'avoid_crossing_perimeters_max_detour',
              'thin_walls',
              'thick_bridges',
              'overhangs',
            ],
          },
          {
            title: 'Advanced',
            keys: [
              'seam_position',
              'staggered_inner_seams',
              'seam_gap_distance',
              'external_perimeters_first',
              'gap_fill_enabled',
              'perimeter_generator',
            ],
          },
          {
            title: 'Scarf seam',
            keys: [
              'scarf_seam_placement',
              'scarf_seam_only_on_smooth',
              'scarf_seam_start_height',
              'scarf_seam_entire_loop',
              'scarf_seam_length',
              'scarf_seam_max_segment_length',
              'scarf_seam_on_inner_perimeters',
            ],
          },
          { title: 'Fuzzy skin (experimental)', keys: ['fuzzy_skin', 'fuzzy_skin_thickness', 'fuzzy_skin_point_dist'] },
          { title: 'Only one perimeter', keys: ['top_one_perimeter_type', 'only_one_perimeter_first_layer'] },
        ],
      },
      {
        title: 'Infill',
        groups: [
          {
            title: 'Infill',
            keys: ['fill_density', 'fill_pattern', 'infill_anchor', 'infill_anchor_max', 'top_fill_pattern', 'bottom_fill_pattern'],
          },
          { title: 'Ironing', keys: ['ironing', 'ironing_type', 'ironing_flowrate', 'ironing_spacing'] },
          {
            title: 'Reducing printing time',
            keys: [
              'infill_every_layers',
              'automatic_infill_combination',
              'automatic_infill_combination_max_layer_height',
              'infill_only_where_needed',
            ],
          },
          {
            title: 'Advanced',
            keys: [
              'solid_infill_every_layers',
              'fill_angle',
              'solid_infill_below_area',
              'bridge_angle',
              'only_retract_when_crossing_perimeters',
              'infill_first',
            ],
          },
        ],
      },
      {
        title: 'Skirt and brim',
        groups: [
          { title: 'Skirt', keys: ['skirts', 'skirt_distance', 'skirt_height', 'draft_shield', 'min_skirt_length'] },
          { title: 'Brim', keys: ['brim_type', 'brim_width', 'brim_separation'] },
        ],
      },
      {
        title: 'Support material',
        groups: [
          {
            title: 'Support material',
            keys: ['support_material', 'support_material_auto', 'support_material_threshold', 'support_material_enforce_layers'],
          },
          {
            title: 'Raft',
            keys: ['raft_layers', 'raft_contact_distance', 'raft_expansion', 'raft_first_layer_density', 'raft_first_layer_expansion'],
          },
          {
            title: 'Options for support material and raft',
            keys: [
              'support_material_style',
              'support_material_contact_distance',
              'support_material_bottom_contact_distance',
              'support_material_pattern',
              'support_material_with_sheath',
              'support_material_spacing',
              'support_material_angle',
              'support_material_closing_radius',
              'support_material_interface_layers',
              'support_material_bottom_interface_layers',
              'support_material_interface_pattern',
              'support_material_interface_spacing',
              'support_material_interface_contact_loops',
              'support_material_buildplate_only',
              'support_material_xy_spacing',
              'dont_support_bridges',
              'support_material_synchronize_layers',
            ],
          },
          {
            title: 'Organic supports',
            keys: [
              'support_tree_angle',
              'support_tree_angle_slow',
              'support_tree_branch_diameter',
              'support_tree_branch_diameter_angle',
              'support_tree_branch_diameter_double_wall',
              'support_tree_tip_diameter',
              'support_tree_branch_distance',
              'support_tree_top_rate',
            ],
          },
        ],
      },
      {
        title: 'Speed',
        groups: [
          {
            title: 'Speed for print moves',
            keys: [
              'perimeter_speed',
              'small_perimeter_speed',
              'external_perimeter_speed',
              'infill_speed',
              'solid_infill_speed',
              'top_solid_infill_speed',
              'support_material_speed',
              'support_material_interface_speed',
              'bridge_speed',
              'over_bridge_speed',
              'gap_fill_speed',
              'ironing_speed',
            ],
          },
          {
            title: 'Dynamic overhang speed',
            keys: ['enable_dynamic_overhang_speeds', 'overhang_speed_0', 'overhang_speed_1', 'overhang_speed_2', 'overhang_speed_3'],
          },
          { title: 'Speed for non-print moves', keys: ['travel_speed', 'travel_speed_z'] },
          { title: 'Modifiers', keys: ['first_layer_speed', 'first_layer_infill_speed', 'first_layer_speed_over_raft'] },
          {
            title: 'Acceleration control (advanced)',
            keys: [
              'external_perimeter_acceleration',
              'perimeter_acceleration',
              'top_solid_infill_acceleration',
              'solid_infill_acceleration',
              'infill_acceleration',
              'bridge_acceleration',
              'first_layer_acceleration',
              'first_layer_acceleration_over_raft',
              'wipe_tower_acceleration',
              'travel_acceleration',
              'travel_short_distance_acceleration',
              'default_acceleration',
            ],
          },
          { title: 'Autospeed (advanced)', keys: ['max_print_speed', 'max_volumetric_speed'] },
          {
            title: 'Pressure equalizer (experimental)',
            keys: ['max_volumetric_extrusion_rate_slope_positive', 'max_volumetric_extrusion_rate_slope_negative'],
          },
        ],
      },
      {
        title: 'Multiple extruders',
        groups: [
          {
            title: 'Extruders',
            keys: [
              'perimeter_extruder',
              'infill_extruder',
              'solid_infill_extruder',
              'support_material_extruder',
              'support_material_interface_extruder',
              'wipe_tower_extruder',
            ],
          },
          { title: 'Ooze prevention', keys: ['ooze_prevention', 'standby_temperature_delta'] },
          {
            title: 'Wipe tower',
            keys: [
              'wipe_tower',
              'wipe_tower_x',
              'wipe_tower_y',
              'wipe_tower_width',
              'wipe_tower_rotation_angle',
              'wipe_tower_brim_width',
              'wipe_tower_bridging',
              'wipe_tower_cone_angle',
              'wipe_tower_extra_spacing',
              'wipe_tower_extra_flow',
              'wipe_tower_no_sparse_layers',
              'single_extruder_multi_material_priming',
            ],
          },
          { title: 'Wipe into', keys: ['wipe_into_infill', 'wipe_into_objects'] },
          {
            title: 'Interlocking',
            keys: [
              'interlocking_beam',
              'interlocking_beam_width',
              'interlocking_orientation',
              'interlocking_beam_layer_count',
              'interlocking_depth',
              'interlocking_boundary_avoidance',
            ],
          },
          {
            title: 'Advanced',
            keys: ['interface_shells', 'mmu_segmented_region_max_width', 'mmu_segmented_region_interlocking_depth', 'toolchange_ordering'],
          },
        ],
      },
      {
        title: 'Advanced',
        groups: [
          {
            title: 'Extrusion width',
            keys: [
              'automatic_extrusion_widths',
              'extrusion_width',
              'first_layer_extrusion_width',
              'perimeter_extrusion_width',
              'external_perimeter_extrusion_width',
              'infill_extrusion_width',
              'solid_infill_extrusion_width',
              'top_infill_extrusion_width',
              'support_material_extrusion_width',
            ],
          },
          { title: 'Overlap', keys: ['infill_overlap'] },
          { title: 'Flow', keys: ['bridge_flow_ratio'] },
          {
            title: 'Slicing',
            keys: [
              'slice_closing_radius',
              'slicing_mode',
              'resolution',
              'gcode_resolution',
              'arc_fitting',
              'xy_size_compensation',
              'elefant_foot_compensation',
            ],
          },
          {
            title: 'Arachne perimeter generator',
            keys: [
              'wall_transition_angle',
              'wall_transition_filter_deviation',
              'wall_transition_length',
              'wall_distribution_count',
              'min_feature_size',
              'min_bead_width',
            ],
          },
        ],
      },
      {
        title: 'Output options',
        groups: [
          { title: 'Sequential printing', keys: ['complete_objects', 'extruder_clearance_radius', 'extruder_clearance_height'] },
          { title: 'Output file', keys: ['gcode_comments', 'gcode_label_objects', 'output_filename_format', 'extrusion_axis'] },
          { title: 'Post-processing scripts', keys: ['post_process'] },
        ],
      },
      { title: 'Notes', groups: [{ title: 'Notes', keys: ['notes'] }] },
      {
        title: 'Dependencies',
        groups: [{ title: 'Profile dependencies', keys: ['compatible_printers', 'compatible_printers_condition'] }],
      },
    ],
  },
  {
    presetType: 'filament',
    title: 'Filament Settings',
    pages: [
      {
        title: 'Filament',
        groups: [
          {
            title: 'Filament',
            keys: [
              'filament_colour',
              'filament_diameter',
              'extrusion_multiplier',
              'filament_density',
              'filament_cost',
              'filament_spool_weight',
              'filament_type',
              'filament_soluble',
              'filament_abrasive',
            ],
          },
          {
            title: 'Temperature',
            keys: [
              'first_layer_temperature',
              'temperature',
              'first_layer_bed_temperature',
              'bed_temperature',
              'bed_temperature_extruder',
              'idle_temperature',
              'chamber_temperature',
              'chamber_minimal_temperature',
            ],
          },
          { title: 'Shrinkage compensation', keys: ['filament_shrinkage_compensation_xy', 'filament_shrinkage_compensation_z'] },
        ],
      },
      {
        title: 'Cooling',
        groups: [
          { title: 'Enable', keys: ['fan_always_on', 'cooling'] },
          {
            title: 'Fan settings',
            keys: ['min_fan_speed', 'max_fan_speed', 'bridge_fan_speed', 'disable_fan_first_layers', 'full_fan_speed_layer'],
          },
          {
            title: 'Cooling thresholds',
            keys: [
              'fan_below_layer_time',
              'slowdown_below_layer_time',
              'cooling_slowdown_logic',
              'cooling_perimeter_transition_distance',
              'min_print_speed',
            ],
          },
          {
            title: 'Dynamic fan speeds',
            keys: [
              'enable_dynamic_fan_speeds',
              'overhang_fan_speed_0',
              'overhang_fan_speed_1',
              'overhang_fan_speed_2',
              'overhang_fan_speed_3',
            ],
          },
        ],
      },
      {
        title: 'Advanced',
        groups: [
          {
            title: 'Filament properties',
            keys: ['filament_max_volumetric_speed', 'filament_infill_max_speed', 'filament_infill_max_crossing_speed'],
          },
          {
            title: 'Wipe tower parameters',
            keys: ['filament_minimal_purge_on_wipe_tower', 'filament_purge_multiplier', 'filament_flush_volume', 'filament_flush_speed'],
          },
          {
            title: 'Toolchange parameters with single extruder MM printers',
            keys: [
              'filament_loading_speed_start',
              'filament_loading_speed',
              'filament_unloading_speed_start',
              'filament_unloading_speed',
              'filament_toolchange_delay',
              'filament_cooling_moves',
              'filament_cooling_initial_speed',
              'filament_cooling_final_speed',
              'filament_load_time',
              'filament_unload_time',
            ],
          },
          {
            title: 'Toolchange parameters with multi extruder MM printers',
            keys: [
              'filament_multitool_ramming',
              'filament_multitool_ramming_volume',
              'filament_multitool_ramming_flow',
              'filament_stamping_distance',
              'filament_stamping_loading_speed',
            ],
          },
        ],
      },
      {
        title: 'Filament overrides',
        groups: [
          {
            title: 'Retraction',
            keys: [
              'filament_retract_length',
              'filament_retract_lift',
              'filament_retract_lift_above',
              'filament_retract_lift_below',
              'filament_retract_speed',
              'filament_deretract_speed',
              'filament_retract_restart_extra',
              'filament_retract_before_travel',
              'filament_retract_layer_change',
              'filament_wipe',
              'filament_retract_before_wipe',
              'filament_retract_length_toolchange',
              'filament_retract_restart_extra_toolchange',
              'filament_travel_ramping_lift',
              'filament_travel_slope',
              'filament_travel_max_lift',
              'filament_travel_lift_before_obstacle',
              'filament_seam_gap_distance',
            ],
          },
        ],
      },
      {
        title: 'Custom G-code',
        groups: [
          { title: 'Start G-code', keys: ['start_filament_gcode'] },
          { title: 'End G-code', keys: ['end_filament_gcode'] },
        ],
      },
      { title: 'Notes', groups: [{ title: 'Notes', keys: ['filament_notes'] }] },
      {
        title: 'Dependencies',
        groups: [
          {
            title: 'Profile dependencies',
            keys: ['compatible_printers', 'compatible_printers_condition', 'compatible_prints', 'compatible_prints_condition'],
          },
        ],
      },
    ],
  },
  {
    presetType: 'printer',
    title: 'Printer Settings',
    pages: [
      {
        title: 'General',
        groups: [
          { title: 'Size and coordinates', keys: ['bed_shape', 'max_print_height', 'z_offset'] },
          { title: 'Capabilities', keys: ['single_extruder_multi_material'] },
          {
            title: 'Firmware',
            keys: [
              'gcode_flavor',
              'binary_gcode',
              'silent_mode',
              'remaining_times',
              'autoemit_temperature_commands',
              'prefer_clockwise_movements',
            ],
          },
          {
            title: 'Advanced',
            keys: [
              'use_relative_e_distances',
              'use_firmware_retraction',
              'use_volumetric_e',
              'variable_layer_height',
              'cooling_tube_retraction',
              'cooling_tube_length',
              'high_current_on_filament_swap',
              'parking_pos_retraction',
              'extra_loading_move',
              'multimaterial_purging',
            ],
          },
        ],
      },
      {
        title: 'Custom G-code',
        groups: [
          { title: 'Start G-code', keys: ['start_gcode'] },
          { title: 'End G-code', keys: ['end_gcode'] },
          { title: 'Before layer change G-code', keys: ['before_layer_gcode'] },
          { title: 'After layer change G-code', keys: ['layer_gcode'] },
          { title: 'Tool change G-code', keys: ['toolchange_gcode'] },
          { title: 'Between objects G-code (for sequential printing)', keys: ['between_objects_gcode'] },
          { title: 'Color Change G-code', keys: ['color_change_gcode'] },
          { title: 'Pause Print G-code', keys: ['pause_print_gcode'] },
          { title: 'Template Custom G-code', keys: ['template_custom_gcode'] },
        ],
      },
      {
        title: 'Machine limits',
        groups: [
          { title: 'General', keys: ['machine_limits_usage'] },
          {
            title: 'Maximum feedrates (mm/s)',
            keys: ['machine_max_feedrate_x', 'machine_max_feedrate_y', 'machine_max_feedrate_z', 'machine_max_feedrate_e'],
          },
          {
            title: 'Maximum accelerations (mm/s²)',
            keys: [
              'machine_max_acceleration_x',
              'machine_max_acceleration_y',
              'machine_max_acceleration_z',
              'machine_max_acceleration_e',
              'machine_max_acceleration_extruding',
              'machine_max_acceleration_retracting',
              'machine_max_acceleration_travel',
            ],
          },
          {
            title: 'Jerk limits (mm/s)',
            keys: [
              'machine_max_jerk_x',
              'machine_max_jerk_y',
              'machine_max_jerk_z',
              'machine_max_jerk_e',
              'machine_max_junction_deviation',
            ],
          },
          { title: 'Minimum feedrates (mm/s)', keys: ['machine_min_extruding_rate', 'machine_min_travel_rate'] },
        ],
      },
      {
        title: 'Extruder',
        groups: [
          {
            title: 'Size',
            keys: ['nozzle_diameter', 'nozzle_high_flow'],
          },
          { title: 'Layer height limits', keys: ['min_layer_height', 'max_layer_height'] },
          { title: 'Position (for multi-extruder printers)', keys: ['extruder_offset'] },
          {
            title: 'Retraction',
            keys: [
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
            ],
          },
          {
            title: 'Retraction when tool is disabled (advanced settings for multi-extruder setups)',
            keys: ['retract_length_toolchange', 'retract_restart_extra_toolchange'],
          },
          { title: 'Preview', keys: ['extruder_colour'] },
        ],
      },
      { title: 'Notes', groups: [{ title: 'Notes', keys: ['printer_notes'] }] },
    ],
  },
];
