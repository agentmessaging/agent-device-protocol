#include "nets.h"

#include <string.h>

static adp_net_t *find(adp_nets_t *l, const char *ssid) {
  for (int i = 0; i < l->n; i++)
    if (!strcmp(l->e[i].ssid, ssid)) return &l->e[i];
  return NULL;
}

const adp_net_t *adp_nets_find(const adp_nets_t *l, const char *ssid) { return find((adp_nets_t *)l, ssid); }

int adp_nets_add(adp_nets_t *l, const char *ssid, const char *pass) {
  adp_net_t *e = find(l, ssid);
  if (!e && l->n < ADP_NETWORKS) e = &l->e[l->n++];
  if (!e) {
    e = &l->e[0];
    for (int i = 1; i < l->n; i++)
      if (l->e[i].used < e->used) e = &l->e[i];
  }
  memset(e, 0, sizeof *e);
  strncpy(e->ssid, ssid, sizeof e->ssid - 1);
  strncpy(e->pass, pass, sizeof e->pass - 1);
  e->used = ++l->clock;
  return l->n;
}

bool adp_nets_remove(adp_nets_t *l, const char *ssid) {
  adp_net_t *e = find(l, ssid);
  if (!e) return false;
  *e = l->e[--l->n];
  memset(&l->e[l->n], 0, sizeof l->e[l->n]);  // no password left behind in the unused slot
  return true;
}

void adp_nets_joined(adp_nets_t *l, const char *ssid) {
  adp_net_t *e = find(l, ssid);
  if (e) e->used = ++l->clock;
}
