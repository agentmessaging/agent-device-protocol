// The board's Wi-Fi networks (S005), with no I/O: networks.c keeps them in NVS and joins them, and the host
// test runs the same rules.
#pragma once
#include <stdbool.h>
#include <stdint.h>

#include "adp.h"

typedef struct {
  char ssid[33];
  char pass[64];
  uint32_t used;  // when it was last added or joined, on the list's own clock
} adp_net_t;

typedef struct {
  uint32_t clock;
  int n;
  adp_net_t e[ADP_NETWORKS];
} adp_nets_t;

// Adds or replaces (same name: new password). When full, the network used least recently goes. Returns the count.
int adp_nets_add(adp_nets_t *l, const char *ssid, const char *pass);
bool adp_nets_remove(adp_nets_t *l, const char *ssid);
const adp_net_t *adp_nets_find(const adp_nets_t *l, const char *ssid);
void adp_nets_joined(adp_nets_t *l, const char *ssid);
