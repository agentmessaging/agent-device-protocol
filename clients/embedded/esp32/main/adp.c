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

// JSON.parse keeps the last of two equal keys and cJSON the first, so a body with one would mean
// different things to this device and to a JS verifier of the same bytes: refuse it.
static bool unique_keys(const cJSON *o) {
  for (const cJSON *a = o ? o->child : NULL; a; a = a->next) {
    if (cJSON_IsObject(o))
      for (const cJSON *b = a->next; b; b = b->next)
        if (!strcmp(a->string, b->string)) return false;
    if ((cJSON_IsObject(a) || cJSON_IsArray(a)) && !unique_keys(a)) return false;
  }
  return true;
}

// The whole body is one JSON value: anything after it but whitespace is a malformed packet.
static cJSON *parse_exact(const char *text, size_t n) {
  const char *end = NULL;
  cJSON *o = cJSON_ParseWithLengthOpts(text, n, &end, false);
  if (o && end)
    while (end < text + n && (*end == ' ' || *end == '\t' || *end == '\n' || *end == '\r')) end++;
  if (!o || end != text + n || !unique_keys(o)) {
    cJSON_Delete(o);
    return NULL;
  }
  return o;
}

// Verifies the body bytes before parsing them. Returns NULL on any failure. With raw, also a malloc'd
// copy of the verified body bytes (the S003 transcript needs them exactly).
static cJSON *open_packet_raw(const cJSON *packet, const unsigned char pk[32], unsigned char **raw, size_t *raw_len) {
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
    out = parse_exact((const char *)msg + DOMAIN_LEN, n);
  if (out && raw) {
    *raw = malloc(n ? n : 1);
    *raw_len = n;
    if (*raw) memcpy(*raw, msg + DOMAIN_LEN, n);
    else {
      cJSON_Delete(out);
      out = NULL;
    }
  }
  free(msg);
  return out;
}

static cJSON *open_packet(const cJSON *packet, const unsigned char pk[32]) { return open_packet_raw(packet, pk, NULL, NULL); }

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

void adp_new_session(adp_t *adp) {
  adp->state = 0;
  adp->sec_state = 0;
  adp->sec_tx_n = adp->sec_rx_n = 0;
  sodium_memzero(adp->sec_tx, sizeof adp->sec_tx);
  sodium_memzero(adp->sec_rx, sizeof adp->sec_rx);
}

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
    // An event.ack. This client sends no events yet, but a forged or replayed packet still ends the connection.
    cJSON *a = open_packet(m, adp->owner_pk);
    rc = is(field(a, "type"), "event.ack") && is(field(a, "to"), adp->key) ? 0 : -1;
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

// ---- S003, encrypted home network connection (docs/wiki/specs/S003-encrypted-home-network-connection.md)

static const char SECURE_LABEL[] = "adp-secure/1";  // the transcript hashes it with its NUL
#define SECURE_TAG crypto_aead_chacha20poly1305_ietf_ABYTES
#define SECURE_MAX_COUNTER (1ULL << 32)

static void hmac(unsigned char out[32], const unsigned char *key, size_t key_len, const unsigned char *a, size_t a_len,
                 const unsigned char *b, size_t b_len) {
  crypto_auth_hmacsha256_state st;
  crypto_auth_hmacsha256_init(&st, key, key_len);
  crypto_auth_hmacsha256_update(&st, a, a_len);
  if (b_len) crypto_auth_hmacsha256_update(&st, b, b_len);
  crypto_auth_hmacsha256_final(&st, out);
  sodium_memzero(&st, sizeof st);
}

void adp_secure_keys(const unsigned char shared[32], const unsigned char *hello, size_t hello_len,
                     const unsigned char *accept, size_t accept_len, unsigned char c2d[32], unsigned char d2c[32]) {
  unsigned char transcript[32], prk[32];
  crypto_hash_sha256_state h;
  crypto_hash_sha256_init(&h);
  crypto_hash_sha256_update(&h, (const unsigned char *)SECURE_LABEL, sizeof SECURE_LABEL);
  crypto_hash_sha256_update(&h, hello, hello_len);
  crypto_hash_sha256_update(&h, accept, accept_len);
  crypto_hash_sha256_final(&h, transcript);
  // HKDF-SHA256 (RFC 5869): extract with the transcript as salt, then one 32-byte expand block per direction
  hmac(prk, transcript, 32, shared, 32, NULL, 0);
  static const unsigned char one = 1;
  static const char c2d_info[] = "adp-secure/1 controller-to-device", d2c_info[] = "adp-secure/1 device-to-controller";
  hmac(c2d, prk, 32, (const unsigned char *)c2d_info, sizeof c2d_info - 1, &one, 1);
  hmac(d2c, prk, 32, (const unsigned char *)d2c_info, sizeof d2c_info - 1, &one, 1);
  sodium_memzero(prk, sizeof prk);
}

static void secure_nonce(unsigned char n[crypto_aead_chacha20poly1305_ietf_NPUBBYTES], uint64_t counter) {
  memset(n, 0, 4);
  for (int i = 0; i < 8; i++) n[4 + i] = (unsigned char)(counter >> (56 - 8 * i));
}

int adp_secure_seal(adp_t *adp, const unsigned char *in, size_t len, unsigned char **out, size_t *out_len) {
  unsigned char n[crypto_aead_chacha20poly1305_ietf_NPUBBYTES];
  unsigned long long clen = 0;
  *out = NULL;
  // After 2^32 messages the sender closes; the device reconnects with a new key exchange
  if (adp->sec_tx_n >= SECURE_MAX_COUNTER || !(*out = malloc(len + SECURE_TAG))) return -1;
  secure_nonce(n, adp->sec_tx_n++);
  crypto_aead_chacha20poly1305_ietf_encrypt(*out, &clen, in, len, NULL, 0, NULL, n, adp->sec_tx);
  *out_len = (size_t)clen;
  return 0;
}

// Decrypts with the next expected counter, so a changed, replayed, dropped or reordered message fails.
static int secure_open(adp_t *adp, const unsigned char *in, size_t len, char **out, size_t *out_len) {
  unsigned char n[crypto_aead_chacha20poly1305_ietf_NPUBBYTES];
  unsigned long long mlen = 0;
  *out = NULL;
  // The device's frame limit (ADP_MAX_FRAME) is below the profile's 2,200,000 bytes, so it also bounds this
  if (len < SECURE_TAG || len - SECURE_TAG > ADP_MAX_FRAME || adp->sec_rx_n >= SECURE_MAX_COUNTER) return -1;
  if (!(*out = malloc(len - SECURE_TAG + 1))) return -1;
  secure_nonce(n, adp->sec_rx_n);
  if (crypto_aead_chacha20poly1305_ietf_decrypt((unsigned char *)*out, &mlen, NULL, in, len, NULL, 0, n, adp->sec_rx)) {
    free(*out);
    *out = NULL;
    return -1;
  }
  adp->sec_rx_n++;
  (*out)[mlen] = 0;
  *out_len = (size_t)mlen;
  return 0;
}

// S003 step 2: verify the controller's signed secure.hello with the pinned key, answer with a signed
// secure.accept carrying a new X25519 key, and derive both direction keys.
static int secure_accept(adp_t *adp, const char *frame, size_t len, char **out) {
  *out = NULL;
  if (len > ADP_MAX_FRAME) return -1;
  int rc = -1;
  unsigned char *hello = NULL, peer[32], sk[32], pk[32], shared[32];
  size_t hello_len = 0;
  cJSON *packet = cJSON_ParseWithLength(frame, len);
  cJSON *m = cJSON_IsObject(packet) ? open_packet_raw(packet, adp->owner_pk, &hello, &hello_len) : NULL;
  const cJSON *v = field(m, "version"), *eph = field(m, "ephemeral");
  if (cJSON_IsObject(m) && cJSON_GetArraySize(m) == 6 && is(field(m, "type"), "secure.hello") && cJSON_IsNumber(v) &&
      v->valuedouble == 1 && is(field(m, "to"), adp->key) && hex48(field(m, "id")) && hex48(field(m, "challenge")) &&
      cJSON_IsString(eph) && !decode_key(eph->valuestring, peer)) {
    char mine[ADP_KEY];
    randombytes_buf(sk, sizeof sk);
    crypto_scalarmult_base(pk, sk);
    sodium_bin2base64(mine, ADP_KEY, pk, 32, B64);
    cJSON *a = cJSON_CreateObject();
    cJSON_AddStringToObject(a, "type", "secure.accept");
    cJSON_AddNumberToObject(a, "version", 1);
    cJSON_AddStringToObject(a, "id", field(m, "id")->valuestring);
    cJSON_AddStringToObject(a, "challenge", field(m, "challenge")->valuestring);
    cJSON_AddStringToObject(a, "to", adp->owner_key);
    cJSON_AddStringToObject(a, "assignedAgent", adp->agent);
    cJSON_AddStringToObject(a, "ephemeral", mine);
    cJSON_AddStringToObject(a, "peerEphemeral", eph->valuestring);
    char *body = cJSON_PrintUnformatted(a);
    cJSON_Delete(a);
    // crypto_scalarmult fails on an all-zero result, which closes the connection
    if (body && !crypto_scalarmult(shared, sk, peer) && (*out = adp_seal(adp->sk, body, strlen(body)))) {
      adp_secure_keys(shared, hello, hello_len, (const unsigned char *)body, strlen(body), adp->sec_rx, adp->sec_tx);
      adp->sec_tx_n = adp->sec_rx_n = 0;
      adp->sec_state = 1;
      rc = 0;
    }
    free(body);
    sodium_memzero(sk, sizeof sk);
    sodium_memzero(shared, sizeof shared);
  }
  free(hello);
  cJSON_Delete(m);
  cJSON_Delete(packet);
  return rc;
}

int adp_receive(adp_t *adp, const unsigned char *data, size_t len, bool binary, int64_t now, unsigned char **out,
                size_t *out_len, bool *out_binary) {
  char *text = NULL, *reply = NULL;
  size_t text_len = 0;
  *out = NULL;
  *out_len = 0;
  *out_binary = adp->secure;
  if (!adp->secure) {
    if (binary || adp_handle(adp, (const char *)data, len, now, &reply)) return -1;
    if (reply) *out_len = strlen(reply);
    *out = (unsigned char *)reply;
    return 0;
  }
  if (adp->sec_state == 0) {
    // The key exchange is the only plain message; the accept goes back as text
    if (binary || secure_accept(adp, (const char *)data, len, &reply)) return -1;
    *out_binary = false;
    *out_len = strlen(reply);
    *out = (unsigned char *)reply;
    return 0;
  }
  if (!binary || secure_open(adp, data, len, &text, &text_len)) return -1;
  int rc = adp_handle(adp, text, text_len, now, &reply);
  free(text);
  if (!rc && reply) rc = adp_secure_seal(adp, (const unsigned char *)reply, strlen(reply), out, out_len);
  free(reply);
  return rc;
}
