set(srcs "main.c" "adp.c")
# Kconfig values are not set while IDF scans requirements, so optional parts list theirs here
set(requires nvs_flash esp_wifi esp_netif esp_event esp_timer esp_driver_i2s esp_driver_gpio esp_psram spi_flash lwip)
if(CONFIG_ADP_CAMERA)
  list(APPEND srcs "board_camera.c")
  list(APPEND requires esp32-camera esp_driver_gpio)
endif()
if(CONFIG_ADP_DOCTOR)
  list(APPEND srcs "board_doctor.c")
endif()
idf_component_register(SRCS ${srcs}
                       INCLUDE_DIRS "."
                       PRIV_REQUIRES ${requires})
