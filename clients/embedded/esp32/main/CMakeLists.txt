set(srcs "main.c" "adp.c")
set(requires nvs_flash esp_wifi esp_netif esp_event esp_timer)
if(CONFIG_ADP_CAMERA)
  list(APPEND srcs "board_camera.c")
  list(APPEND requires esp32-camera esp_driver_gpio)
endif()
idf_component_register(SRCS ${srcs}
                       INCLUDE_DIRS "."
                       PRIV_REQUIRES ${requires})
