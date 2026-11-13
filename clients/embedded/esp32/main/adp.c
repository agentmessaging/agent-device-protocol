#include "adp.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "sodium.h"

#define B64 sodium_base64_VARIANT_URLSAFE_NO_PADDING
// protocol/v1.md, Encoding: the signed bytes are this domain, one NUL, then the body.
static const char DOMAIN[] = "ai-maestro-device/1";
#define DOMAIN_LEN (sizeof(DOMAIN))  // includes the NUL

static void nonce(char out[ADP_HEX]) {
  unsigned char b[24];
  randombytes_buf(b, sizeof b);
  sodium_bin2hex(out, ADP_HEX, b, sizeof b);
}

static bool hex48(const cJSON *v) {
  if (!cJSON_IsString(v) || strlen(v->valuestring) != 48) return false;
  for (const char *c = v->valuestring; *c; c++)
    if (!((*c >= '0' && *c <= '9') || (*c >= 'a' && *c <= 'f'))) return false;
  return true;
}

static bool is(const cJSON *v, const char *s) { return cJSON_IsString(v) && !strcmp(v->valuestring, s); }

static const cJSON *field(const cJSON *o, const char *k) { return cJSON_GetObjectItemCaseSensitive(o, k); }

static bool alnum(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'); }

// Same shape as agentAddress() in packages/sdk/index.mjs.
static bool agent_address(const char *a) {
  size_t n = strlen(a);
  const char *at = strchr(a, '@');
  if (!n || n > 254 || !at || !alnum(a[0]) || !alnum(at[1])) return false;
  for (const char *c = a; *c; c++) {
    if (c == at) continue;
    if (!alnum(*c) && *c != '.' && *c != '-' && !(c < at && (*c == '_' || *c == '+'))) return false;
  }
  return true;
}

static int decode_key(const char *key, unsigned char pk[32]) {
  size_t n = 0;
  if (strlen(key) != 43 || sodium_base642bin(pk, 32, key, 43, NULL, &n, NULL, B64) || n != 32) return -1;
  return 0;
}

void adp_public_key(const unsigned char sk[64], char out[ADP_KEY]) {
  sodium_bin2base64(out, ADP_KEY, sk + 32, 32, B64);
}

char *adp_seal(const unsigned char sk[64], const char *body, size_t len) {
  unsigned char sig[crypto_sign_BYTES];
  unsigned char *msg = malloc(DOMAIN_LEN + len);
  size_t blen = sodium_base64_ENCODED_LEN(len, B64), slen = sodium_base64_ENCODED_LEN(sizeof sig, B64);
  char *out = malloc(blen + slen + 32);
  if (!msg || !out) {
    free(msg);
    free(out);
    return NULL;
  }
  memcpy(msg, DOMAIN, DOMAIN_LEN);
  memcpy(msg + DOMAIN_LEN, body, len);
  crypto_sign_detached(sig, NULL, msg, DOMAIN_LEN + len, sk);
  free(msg);
  // base64url needs no JSON escaping
  strcpy(out, "{\"body\":\"");
  char *p = out + strlen(out);
  sodium_bin2base64(p, blen, (const unsigned char *)body, len, B64);
  strcat(p, "\",\"signature\":\"");
  p += strlen(p);
  sodium_bin2base64(p, slen, sig, sizeof sig, B64);
  strcat(p, "\"}");
  return out;
}

static cJSON *seal_obj(adp_t *adp, cJSON *data) {
  char *body = cJSON_PrintUnformatted(data);
  cJSON_Delete(data);
  if (!body) return NULL;
  char *packet = adp_seal(adp->sk, body, strlen(body));
  free(body);
  cJSON *o = packet ? cJSON_Parse(packet) : NULL;
  free(packet);
  return o;
}

// Verifies the body bytes before parsing them. Returns NULL on any failure.
static cJSON *open_packet(const cJSON *packet, const unsigned char pk[32]) {
  const cJSON *b = field(packet, "body"), *s = field(packet, "signature");
  if (!cJSON_IsString(b) || !cJSON_IsString(s)) return NULL;
  size_t blen = strlen(b->valuestring), n = 0, slen = 0;
  unsigned char sig[crypto_sign_BYTES + 1];
  if (sodium_base642bin(sig, sizeof sig, s->valuestring, strlen(s->valuestring), NULL, &slen, NULL, B64) ||
      slen != crypto_sign_BYTES)
    return NULL;
  unsigned char *msg = malloc(DOMAIN_LEN + blen + 1);
  if (!msg) return NULL;
  memcpy(msg, DOMAIN, DOMAIN_LEN);
  cJSON *out = NULL;
  if (!sodium_base642bin(msg + DOMAIN_LEN, blen, b->valuestring, blen, NULL, &n, NULL, B64) &&
      !crypto_sign_verify_detached(sig, msg, DOMAIN_LEN + n, pk))
    out = cJSON_ParseWithLength((const char *)msg + DOMAIN_LEN, n);
  free(msg);
  return out;
}

int adp_init(adp_t *adp, const unsigned char sk[64], const char *owner_key, const char *agent,
             const char *platform) {
  memset(adp, 0, sizeof *adp);
  if (decode_key(owner_key, adp->owner_pk) || !agent_address(agent)) return -1;
  memcpy(adp->sk, sk, 64);
  adp_public_key(sk, adp->key);
  strcpy(adp->owner_key, owner_key);
  strcpy(adp->agent, agent);
  adp->platform = platform;
  nonce(adp->boot_id);
  // shortcut: ownership comes from build config, so the revision changes only per boot; derive it from
  // stored config if this client ever supports locally approved transfers.
  nonce(adp->revision);
  return 0;
}

void adp_new_session(adp_t *adp) { adp->state = 0; }

static cJSON *error_body(const char *e) {
  cJSON *o = cJSON_CreateObject();
  cJSON_AddStringToObject(o, "error", e);
  return o;
}

static cJSON *schema(const char *text_key) {
  cJSON *s = cJSON_CreateObject(), *props = cJSON_CreateObject(), *req = cJSON_CreateArray();
  cJSON_AddStringToObject(s, "type", "object");
  if (text_key) {
    cJSON *p = cJSON_AddObjectToObject(props, text_key);
    cJSON_AddStringToObject(p, "type", "string");
    cJSON_AddNumberToObject(p, "maxLength", 4096);
    cJSON_AddItemToArray(req, cJSON_CreateString(text_key));
  }
  cJSON_AddItemToObject(s, "properties", props);
  cJSON_AddItemToObject(s, "required", req);
  cJSON_AddFalseToObject(s, "additionalProperties");
  return s;
}

static cJSON *definition(const char *activation, const char *text_key) {
  cJSON *d = cJSON_CreateObject();
  cJSON_AddStringToObject(d, "activation", activation);
  cJSON_AddItemToObject(d, "args", schema(text_key));
  return d;
}

static cJSON *registration(adp_t *adp, cJSON *r) {
  cJSON *caps = cJSON_CreateArray(), *defs = cJSON_CreateObject(), *perm = cJSON_CreateObject();
  cJSON_AddStringToObject(r, "type", "register");
  cJSON_AddNumberToObject(r, "version", 1);
  cJSON_AddStringToObject(r, "bootId", adp->boot_id);
  cJSON_AddStringToObject(r, "revision", adp->revision);
  cJSON_AddStringToObject(r, "assignedAgent", adp->agent);
  cJSON_AddItemToArray(caps, cJSON_CreateString("device.health"));
  cJSON_AddItemToObject(defs, "device.health", definition("any", NULL));
  if (adp->show_text) {
    cJSON_AddItemToArray(caps, cJSON_CreateString("display.text"));
    cJSON_AddItemToObject(defs, "display.text", definition("active", "text"));
    cJSON_AddTrueToObject(perm, "display.text");
  }
  cJSON_AddItemToObject(r, "capabilities", caps);
  cJSON_AddItemToObject(r, "capabilityDefinitions", defs);
  cJSON_AddItemToObject(r, "streams", cJSON_CreateArray());
  cJSON_AddItemToObject(r, "mediaFormats", cJSON_CreateObject());
  cJSON_AddItemToObject(r, "permissions", perm);
  return r;
}

// The argument checks of validateArguments() for the two capabilities this client has.
static bool valid_args(const char *capability, const cJSON *args) {
  if (!args) return !strcmp(capability, "device.health");
  if (!cJSON_IsObject(args)) return false;
  int n = cJSON_GetArraySize(args);
  if (!strcmp(capability, "device.health")) return n == 0;
  const cJSON *text = field(args, "text");
  return n == 1 && cJSON_IsString(text) && strlen(text->valuestring) <= 4096;
}

static cJSON *invoke(adp_t *adp, const cJSON *msg, cJSON *r) {
  static const char *allowed[] = {"to", "id", "challenge", "type", "capability", "args"};
  const cJSON *cap = field(msg, "capability"), *args = field(msg, "args"), *k;
  bool ok = cJSON_IsString(cap) &&
            (!strcmp(cap->valuestring, "device.health") || (adp->show_text && !strcmp(cap->valuestring, "display.text")));
  cJSON_ArrayForEach(k, msg) {
    bool known = false;
    for (size_t i = 0; i < sizeof allowed / sizeof *allowed; i++) known |= !strcmp(k->string, allowed[i]);
    ok &= known;
  }
  cJSON_AddStringToObject(r, "type", "result");
  if (!ok) {
    cJSON_AddFalseToObject(r, "ok");
    cJSON_AddStringToObject(r, "error", "denied");
  } else if (!valid_args(cap->valuestring, args)) {
    cJSON_AddFalseToObject(r, "ok");
    cJSON_AddStringToObject(r, "error", "invalid_arguments");
  } else if (!strcmp(cap->valuestring, "device.health")) {
    cJSON_AddTrueToObject(r, "ok");
    cJSON *v = cJSON_AddObjectToObject(r, "value");
    cJSON_AddStringToObject(v, "status", "ok");
    cJSON_AddStringToObject(v, "platform", adp->platform);
  } else if (adp->show_text(field(args, "text")->valuestring, adp->user)) {
    cJSON_AddFalseToObject(r, "ok");
    cJSON_AddStringToObject(r, "error", "hardware_unavailable");
  } else {
    cJSON_AddTrueToObject(r, "ok");
    cJSON_AddTrueToObject(cJSON_AddObjectToObject(r, "value"), "shown");
  }
  return r;
}

// One signed v1 request, as clients/linux/server.mjs answers it on POST /v1/request.
static cJSON *request(adp_t *adp, const cJSON *packet, int64_t now, int *status) {
  cJSON *msg = packet ? open_packet(packet, adp->owner_pk) : NULL;
  const cJSON *id = field(msg, "id"), *ch = field(msg, "challenge"), *type = field(msg, "type");
  int slot = -1;
  for (int i = 0; msg && hex48(ch) && i < ADP_CHALLENGES; i++)
    if (adp->challenges[i].until > now && !strcmp(adp->challenges[i].value, ch->valuestring)) slot = i;
  if (!is(field(msg, "to"), adp->key) || !hex48(id) || slot < 0) {
    cJSON_Delete(msg);
    *status = 403;
    return error_body("invalid_request");
  }
  adp->challenges[slot].until = 0;  // one use, consumed before dispatch
  cJSON *r = cJSON_CreateObject();
  cJSON_AddStringToObject(r, "to", adp->owner_key);
  cJSON_AddStringToObject(r, "id", id->valuestring);
  cJSON_AddStringToObject(r, "challenge", ch->valuestring);
  if (is(type, "discover"))
    registration(adp, r);
  else if (is(type, "invoke"))
    invoke(adp, msg, r);
  else {  // activity, proposal, media and speaker are not offered by this client
    cJSON_AddStringToObject(r, "type", "result");
    cJSON_AddFalseToObject(r, "ok");
    cJSON_AddStringToObject(r, "error", "denied");
  }
  cJSON_Delete(msg);
  *status = 200;
  return seal_obj(adp, r);
}

static cJSON *challenge(adp_t *adp, int64_t now, int *status) {
  for (int i = 0; i < ADP_CHALLENGES; i++) {
    if (adp->challenges[i].until > now) continue;
    nonce(adp->challenges[i].value);
    adp->challenges[i].until = now + 30000;
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "challenge", adp->challenges[i].value);
    *status = 200;
    return o;
  }
  *status = 429;
  return error_body("busy");
}

static char *print(cJSON *o) {
  char *s = o ? cJSON_PrintUnformatted(o) : NULL;
  cJSON_Delete(o);
  return s;
}

int adp_handle(adp_t *adp, const char *frame, size_t len, int64_t now, char **out) {
  *out = NULL;
  if (len > ADP_MAX_FRAME) return -1;
  cJSON *m = cJSON_ParseWithLength(frame, len);
  if (!cJSON_IsObject(m)) {
    cJSON_Delete(m);
    return -1;
  }
  const cJSON *type = field(m, "type");
  int rc = -1;
  if (adp->state == 0) {
    if (is(type, "hello") && hex48(field(m, "challenge"))) {
      nonce(adp->hs_id);
      nonce(adp->hs_device_challenge);
      strcpy(adp->hs_challenge, field(m, "challenge")->valuestring);
      cJSON *p = cJSON_CreateObject();
      cJSON_AddStringToObject(p, "type", "connect");
      cJSON_AddStringToObject(p, "id", adp->hs_id);
      cJSON_AddStringToObject(p, "challenge", adp->hs_challenge);
      cJSON_AddStringToObject(p, "to", adp->owner_key);
      cJSON_AddStringToObject(p, "deviceChallenge", adp->hs_device_challenge);
      cJSON_AddStringToObject(p, "assignedAgent", adp->agent);
      *out = print(seal_obj(adp, p));
      adp->state = 1;
      rc = *out ? 0 : -1;
    }
  } else if (adp->state == 1) {
    cJSON *a = open_packet(m, adp->owner_pk);
    if (is(field(a, "type"), "connected") && is(field(a, "id"), adp->hs_id) &&
        is(field(a, "challenge"), adp->hs_challenge) && is(field(a, "deviceChallenge"), adp->hs_device_challenge) &&
        is(field(a, "to"), adp->key)) {
      adp->state = 2;
      rc = 0;
    }
    cJSON_Delete(a);
  } else if (field(m, "body") && field(m, "signature")) {
    // An event.ack. This client sends no events yet, but a forged packet still ends the connection.
    cJSON *a = open_packet(m, adp->owner_pk);
    rc = a ? 0 : -1;
    cJSON_Delete(a);
  } else if (is(type, "event.challenge") || is(type, "cancel")) {
    rc = 0;  // no events to send; calls are answered before the next frame, so nothing is left to cancel
  } else if (is(type, "rpc") && hex48(field(m, "id"))) {
    const cJSON *method = field(m, "method");
    int status = 0;
    cJSON *body = is(method, "challenge") ? challenge(adp, now, &status)
                  : is(method, "request") ? request(adp, field(m, "body"), now, &status)
                                          : NULL;
    if (status && !body) status = 503;
    if (status) {
      cJSON *r = cJSON_CreateObject();
      cJSON_AddStringToObject(r, "type", "rpc.result");
      cJSON_AddStringToObject(r, "id", field(m, "id")->valuestring);
      cJSON_AddNumberToObject(r, "status", status);
      cJSON_AddItemToObject(r, "body", body ? body : error_body("adapter_failed"));
      *out = print(r);
      rc = *out ? 0 : -1;
    }
  }
  cJSON_Delete(m);
  return rc;
}
