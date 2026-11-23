set(srcs "main.c" "adp.c")
# Kconfig values are not set while IDF scans requirements, so optional parts list theirs here
set(requires nvs_flash esp_wifi esp_netif esp_event esp_timer esp_driver_i2s esp_driver_gpio esp_driver_ledc esp_driver_usb_serial_jtag esp_psram spi_flash lwip)
if(CONFIG_ADP_CAMERA OR CONFIG_ADP_MICROPHONE OR CONFIG_ADP_DOCTOR)
  list(APPEND srcs "board_sign.c")
endif()
if(CONFIG_ADP_MICROPHONE OR CONFIG_ADP_SPEAKER)
  list(APPEND srcs "board_audio.c")
endif()
if(CONFIG_ADP_CAMERA)
  list(APPEND srcs "board_camera.c")
  list(APPEND requires esp32-camera esp_driver_gpio)
endif()
if(CONFIG_ADP_DOCTOR)
  list(APPEND srcs "board_doctor.c" "board_debug.c")
endif()
idf_component_register(SRCS ${srcs}
                       INCLUDE_DIRS "."
                       PRIV_REQUIRES ${requires})
if(CONFIG_ADP_SPEAKER)
  # speaker.play carries up to 384 KiB of WAV: about 1 MiB as a signed frame
  target_compile_definitions(${COMPONENT_LIB} PRIVATE ADP_MAX_FRAME=1100000)
endif()
