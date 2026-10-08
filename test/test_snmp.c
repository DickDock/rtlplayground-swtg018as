/*
 * test_snmp.c - black-box tests for snmp.c (compiled unmodified).
 *
 * The environment below stands in for the uIP edge the agent sees: a packet
 * lands in uip_buf, snmp_callback() runs, and the response is what the
 * uip_send() stub captured. Hardware reads go through hw_mock's register
 * file, so counters, link bits and MTU are injectable per test.
 *
 * The machine description is writable here so the row-order logic can be
 * driven against a non-monotonic log_to_phys_port mapping, which env_tables'
 * shared (const, identity) machine cannot do.
 */
#include <stdio.h>
#include <string.h>

#include "support.h"
#include "hw_mock.h"
#include "rtl837x_common.h"
#include "rtl837x_regs.h"
#include "uip/uip.h"
#include "machine.h"
#include "snmp.h"

/* BER tags, mirrored from snmp.c (they are file-local there). */
#define TAG_INT        0x02
#define TAG_OCTS       0x04
#define TAG_OID        0x06
#define TAG_SEQ        0x30
#define PDU_GET_REQ    0xA0
#define PDU_GETNEXT_REQ 0xA1
#define PDU_SET_REQ    0xA3
#define PDU_BULK_REQ   0xA5
#define SNMP_MAX_VB    16

/* ---- test-owned environment ---- */
struct machine machine = {
	.machine_name = "SNMPTEST",
	.min_port = 0,
	.max_port = 8,
	.log_to_phys_port = { 1, 2, 3, 4, 5, 6, 7, 8, 9 },
	.phys_to_log_port = { 0, 1, 2, 3, 4, 5, 6, 7, 8 },
	.is_sfp = { [8] = 1 },
};
char hostname[24] = "snmptest";
char port_names[9][PORT_NAME_SIZE];
struct uip_eth_addr uip_ethaddr = { .addr = { 0x02, 0x11, 0x22, 0x33, 0x44, 0x55 } };
uint8_t uip_buf[UIP_CONF_BUFFER_SIZE + 2];
void *uip_appdata;
u16_t uip_len;
u8_t uip_flags;
struct uip_udp_conn *uip_udp_conn;
volatile uint32_t ticks;

static struct uip_udp_conn snmp_conn;   /* handed out by uip_udp_new() */
static uint16_t sent_len;               /* bytes of the last uip_send() */
static int send_calls;

void print_string_no_syslog(const char *p) { (void)p; }
void print_string_newline_no_syslog(const char *p) { (void)p; }
void memcpyc(uint8_t *dst, const uint8_t *src, uint16_t len)
{
	while (len--)
		*dst++ = *src++;
}
uint16_t strlen_x(const char *s)
{
	uint16_t n = 0;
	while (s[n]) n++;
	return n;
}
struct uip_udp_conn *uip_udp_new(uip_ipaddr_t *ripaddr, u16_t rport)
{
	(void)ripaddr;
	/* uip_udp_new() assigns a fresh ephemeral port; snmp_start() then
	 * binds 161 over it. Without this, stop/start would leave lport=0
	 * and the callback would never match again. */
	snmp_conn.lport = HTONS(4096);
	snmp_conn.rport = rport;
	return &snmp_conn;
}
void uip_send(const void *data, uint16_t len)
{
	(void)data;
	sent_len = len;
	send_calls++;
}

/* ---- BER request builder ---- */
static uint8_t req[600];
static uint16_t rlen;

static void b_u8(uint8_t v) { req[rlen++] = v; }
static void b_bytes(const uint8_t *s, uint16_t n)
{
	while (n--) b_u8(*s++);
}
static void b_len(uint16_t len)
{
	if (len < 0x80) {
		b_u8(len);
	} else if (len < 0x100) {
		b_u8(0x81); b_u8(len);
	} else {
		b_u8(0x82); b_u8(len >> 8); b_u8(len & 0xff);
	}
}
static void b_hdr(uint8_t tag, uint16_t len)
{
	b_u8(tag);
	b_len(len);
}
/* Backpatch a 1-byte length placeholder; `at` points at the tag, the length
 * byte follows it. Only for short (<128) payloads. */
static void b_fix(uint16_t at)
{
	req[at + 1] = rlen - at - 2;
}

/* One OID content byte string; every subid we use is < 128. */
#define OID(...) ((const uint8_t[]){ __VA_ARGS__ })
static const uint8_t oid_sysdescr[]  = { 0x2b,0x06,0x01,0x02,0x01,0x01,0x01,0x00 };
static const uint8_t oid_sysobjid[]  = { 0x2b,0x06,0x01,0x02,0x01,0x01,0x02,0x00 };
static const uint8_t oid_uptime[]    = { 0x2b,0x06,0x01,0x02,0x01,0x01,0x03,0x00 };
static const uint8_t oid_sysname[]   = { 0x2b,0x06,0x01,0x02,0x01,0x01,0x05,0x00 };
static const uint8_t oid_services[]  = { 0x2b,0x06,0x01,0x02,0x01,0x01,0x07,0x00 };
static const uint8_t oid_ifnumber[]  = { 0x2b,0x06,0x01,0x02,0x01,0x02,0x01,0x00 };
static const uint8_t oid_ifindex[]   = { 0x2b,0x06,0x01,0x02,0x01,0x02,0x02,0x01,0x01,0x01 };
static const uint8_t oid_ifdescr[]   = { 0x2b,0x06,0x01,0x02,0x01,0x02,0x02,0x01,0x02,0x01 };
static const uint8_t oid_iftype[]    = { 0x2b,0x06,0x01,0x02,0x01,0x02,0x02,0x01,0x03,0x01 };
static const uint8_t oid_ifmtu[]     = { 0x2b,0x06,0x01,0x02,0x01,0x02,0x02,0x01,0x04,0x01 };
static const uint8_t oid_ifspeed[]   = { 0x2b,0x06,0x01,0x02,0x01,0x02,0x02,0x01,0x05,0x01 };
static const uint8_t oid_ifphys[]    = { 0x2b,0x06,0x01,0x02,0x01,0x02,0x02,0x01,0x06,0x01 };
static const uint8_t oid_ifoper[]    = { 0x2b,0x06,0x01,0x02,0x01,0x02,0x02,0x01,0x08,0x01 };
static const uint8_t oid_ifinoct[]   = { 0x2b,0x06,0x01,0x02,0x01,0x02,0x02,0x01,0x0a,0x01 };
static const uint8_t oid_hcin[]      = { 0x2b,0x06,0x01,0x02,0x01,0x1f,0x01,0x01,0x01,0x06,0x01 };
static const uint8_t oid_hcout[]     = { 0x2b,0x06,0x01,0x02,0x01,0x1f,0x01,0x01,0x01,0x0a,0x01 };
static const uint8_t oid_hispd[]     = { 0x2b,0x06,0x01,0x02,0x01,0x1f,0x01,0x01,0x01,0x0f,0x01 };
static const uint8_t oid_bogus[]     = { 0x2b,0x06,0x01,0x02,0x01,0x63,0x00 };

static void b_oid(const uint8_t *o, uint16_t n)
{
	b_hdr(TAG_OID, n);
	b_bytes(o, n);
}

/* varbind = SEQ { OID, NULL } */
static void b_varbind(const uint8_t *o, uint16_t n)
{
	uint16_t at = rlen;
	b_u8(TAG_SEQ); b_u8(0);            /* placeholder */
	b_oid(o, n);
	b_u8(0x05); b_u8(0x00);            /* NULL value */
	b_fix(at);
}

static uint16_t mark_msg, mark_pdu, mark_vbl;   /* first length byte */

static void build_start_rid(uint8_t pdu, uint8_t version, const char *community,
			    uint8_t a1, uint8_t a2, const uint8_t *rid, uint8_t ridlen)
{
	rlen = 0;
	b_u8(TAG_SEQ); b_u8(0x82); mark_msg = rlen; b_u8(0); b_u8(0);
	b_u8(TAG_INT); b_u8(1); b_u8(version);
	b_u8(TAG_OCTS); b_u8(strlen_x(community));
	b_bytes((const uint8_t *)community, strlen_x(community));
	b_u8(pdu); b_u8(0x82); mark_pdu = rlen; b_u8(0); b_u8(0);
	b_u8(TAG_INT); b_u8(ridlen); b_bytes(rid, ridlen);   /* request-id */
	b_u8(TAG_INT); b_u8(1); b_u8(a1);                 /* error-status / non-rep */
	b_u8(TAG_INT); b_u8(1); b_u8(a2);                 /* error-index / max-rep */
	b_u8(TAG_SEQ); b_u8(0x82); mark_vbl = rlen; b_u8(0); b_u8(0);
}

static void build_start(uint8_t pdu, uint8_t version, const char *community,
			uint8_t a1, uint8_t a2)
{
	build_start_rid(pdu, version, community, a1, a2,
			(const uint8_t[]){0x12, 0x34}, 2);
}

static void build_finish(void)
{
	uint16_t n;

	n = rlen - mark_vbl - 2;
	req[mark_vbl] = n >> 8; req[mark_vbl + 1] = n;
	n = rlen - mark_pdu - 2;
	req[mark_pdu] = n >> 8; req[mark_pdu + 1] = n;
	n = rlen - mark_msg - 2;
	req[mark_msg] = n >> 8; req[mark_msg + 1] = n;
}

static void build_get(uint8_t version, const char *community, const uint8_t *oid, uint16_t n)
{
	build_start(PDU_GET_REQ, version, community, 0, 0);
	b_varbind(oid, n);
	build_finish();
}

static void build_getnext(uint8_t version, const char *community, const uint8_t *oid, uint16_t n)
{
	build_start(PDU_GETNEXT_REQ, version, community, 0, 0);
	b_varbind(oid, n);
	build_finish();
}

static void build_bulk(const char *community, uint8_t non_rep, uint8_t max_rep,
		       const uint8_t *oid, uint16_t n)
{
	build_start(PDU_BULK_REQ, 1, community, non_rep, max_rep);
	b_varbind(oid, n);
	build_finish();
}

/* Hand the assembled request to the agent as a fresh UDP payload. */
static void deliver(void)
{
	struct uip_udpip_hdr *h = (struct uip_udpip_hdr *)(uip_buf + UIP_LLH_LEN);

	memcpy(uip_buf + UIP_LLH_LEN + UIP_IPUDPH_LEN, req, rlen);
	memset(h, 0, UIP_IPUDPH_LEN);
	h->srcport = HTONS(5000);
	h->srcipaddr[0] = HTONS(0xc0a8);   /* 192.168.x.y */
	h->srcipaddr[1] = HTONS(0x0132);
	uip_appdata = uip_buf + UIP_LLH_LEN + UIP_IPUDPH_LEN;
	uip_len = rlen;
	uip_flags = UIP_NEWDATA;
	uip_udp_conn = &snmp_conn;   /* the stack points at the matched conn */
	sent_len = 0xffff;
	send_calls = 0;
snmp_callback();
}

/* ---- minimal response decoder ---- */
struct vb {
	const uint8_t *oid;
	uint8_t oid_len;
	uint8_t val_tag;
	const uint8_t *val;
	uint8_t val_len;
};

struct resp {
	uint8_t ok;
	uint8_t pdu;
	uint8_t version;
	char community[24];
	const uint8_t *reqid;
	uint8_t reqid_len;
	uint8_t errstat, erridx;
	uint8_t n_vb;
	struct vb vbs[100];   /* a capped GetBulk reply carries far more */
};

static uint16_t d_len(const uint8_t *m, uint16_t n, uint16_t *pos)
{
	uint8_t b = m[(*pos)++];
	if (b < 0x80)
		return b;
	if (b == 0x81)
		return m[(*pos)++];
	if (b == 0x82)
		return ((uint16_t)m[(*pos)++] << 8) | m[(*pos)++];
	(void)n;
	return 0xffff;   /* caller treats as error */
}

static uint8_t decode(const uint8_t *m, uint16_t n, struct resp *r)
{
	uint16_t pos = 0, len, end;

	memset(r, 0, sizeof(*r));
	if (pos >= n || m[pos++] != TAG_SEQ) return 0;
	len = d_len(m, n, &pos);
	if (len == 0xffff || pos + len > n) return 0;
	end = pos + len;

	if (m[pos++] != TAG_INT) return 0;
	if (m[pos++] != 1) return 0;
	r->version = m[pos++];
	if (m[pos++] != TAG_OCTS) return 0;
	len = m[pos++];
	if (pos + len > n || len >= sizeof(r->community)) return 0;
	memcpy(r->community, m + pos, len);
	r->community[len] = 0;
	pos += len;

	if (pos >= n) return 0;
	r->pdu = m[pos++];
	len = d_len(m, n, &pos);
	if (len == 0xffff || pos + len > n) return 0;

	if (m[pos++] != TAG_INT) return 0;
	r->reqid_len = m[pos++];
	r->reqid = m + pos;
	pos += r->reqid_len;
	if (m[pos++] != TAG_INT || m[pos++] != 1) return 0;
	r->errstat = m[pos++];
	if (m[pos++] != TAG_INT || m[pos++] != 1) return 0;
	r->erridx = m[pos++];

	if (m[pos++] != TAG_SEQ) return 0;
	len = d_len(m, n, &pos);
	if (len == 0xffff || pos + len > n) return 0;

	while (pos < end) {
		struct vb *v;
		uint16_t vlen, vend, x;

		if (r->n_vb >= 100)
			return 0;
		v = &r->vbs[r->n_vb++];
		if (m[pos++] != TAG_SEQ) return 0;
		vlen = d_len(m, n, &pos);
		if (vlen == 0xffff) return 0;
		vend = pos + vlen;
		if (m[pos++] != TAG_OID) return 0;
		x = d_len(m, n, &pos);
		if (x == 0xffff || x > 255) return 0;
		v->oid_len = x;
		v->oid = m + pos;
		pos += v->oid_len;
		if (pos >= vend) return 0;
		v->val_tag = m[pos++];
		x = d_len(m, n, &pos);
		if (x == 0xffff || x > 255)
			return 0;
		v->val_len = x;
		v->val = m + pos;
		pos += v->val_len;
		if (pos != vend)
			return 0;
	}
	r->ok = 1;
	return 1;
}

static const uint8_t *resp_bytes(void)
{
	return uip_appdata;
}


/* shortcut: run a single-varbind GET and decode */
static struct resp R;

static uint8_t run_get(const uint8_t *oid, uint16_t n)
{
	build_get(1, "public", oid, n);
	deliver();
	return decode(resp_bytes(), sent_len, &R);
}

/* expect carries the whole TLV: tag byte, length byte, content. */
static uint8_t vb_val_is(const struct vb *v, const uint8_t *expect, uint8_t n)
{
	return n >= 2 && v->val_tag == expect[0] && v->val_len == n - 2 &&
	       (n == 2 || memcmp(v->val, expect + 2, n - 2) == 0);
}

static uint8_t vb_oid_is(const struct vb *v, const uint8_t *expect, uint8_t n)
{
	return v->oid_len == n && memcmp(v->oid, expect, n) == 0;
}

/* ---- value encodings ---- */
static void t_values(void)
{
	hw_reset();
	hw_reg_set(RTL837X_REG_LINKS_STS, 1u << 16);   /* port 0 carrier up */
	snmp_init();
	snmp_start();
	CHECK(snmp_state.enabled, "snmp_start enables the agent");

	ticks = 1000;
	CHECK(run_get(oid_uptime, sizeof(oid_uptime)) && R.n_vb == 1 &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x43,0x02,0x01,0xF4}, 4),
	      "ticks=1000 -> sysUpTime 500 (minimal TimeTicks)");
	ticks = 0;
	CHECK(run_get(oid_uptime, sizeof(oid_uptime)) && R.n_vb == 1 &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x43,0x01,0x00}, 3),
	      "ticks=0 -> sysUpTime encodes as one zero octet");
	ticks = 1000;

	CHECK(run_get(oid_ifindex, sizeof(oid_ifindex)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x02,0x01,0x01}, 3),
	      "ifIndex.1 -> INTEGER 1");
	CHECK(run_get(oid_iftype, sizeof(oid_iftype)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x02,0x01,0x06}, 3),
	      "ifType -> ethernetCsmacd(6)");
	CHECK(run_get(oid_ifnumber, sizeof(oid_ifnumber)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x02,0x01,0x09}, 3),
	      "ifNumber -> 9 ports");
	CHECK(run_get(oid_services, sizeof(oid_services)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x02,0x01,0x02}, 3),
	      "sysServices -> L2 (2)");

	/* 64-bit counter split: Counter32 takes the low word, Counter64 all. */
	hw_counter_set(0, 0, 0x100000001ULL);
	CHECK(run_get(oid_ifinoct, sizeof(oid_ifinoct)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x41,0x01,0x01}, 3),
	      "ifInOctets.1 -> Counter32 low word 1");
	CHECK(run_get(oid_hcin, sizeof(oid_hcin)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x46,0x05,0x01,0x00,0x00,0x00,0x01}, 7),
	      "ifHCInOctets.1 -> Counter64 0x100000001");
	hw_counter_set(0, 1, 0xFFFFFFFFULL);
	CHECK(run_get(oid_hcout, sizeof(oid_hcout)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x46,0x04,0xFF,0xFF,0xFF,0xFF}, 6),
	      "ifHCOutOctets.1 -> Counter64 strips leading zero");
	hw_counter_set(0, 0, 0);
	CHECK(run_get(oid_ifinoct, sizeof(oid_ifinoct)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x41,0x01,0x00}, 3),
	      "zero counter -> one zero octet");

	/* sysObjectID: 1.3.6.1.4.1.32473, PEN in base-128 */
	CHECK(run_get(oid_sysobjid, sizeof(oid_sysobjid)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x06,0x08,0x2b,0x06,0x01,0x04,0x01,0x81,0xFD,0x59}, 10),
	      "sysObjectID -> 1.3.6.1.4.1.32473");

	/* MAC, sysName, description */
	CHECK(run_get(oid_ifphys, sizeof(oid_ifphys)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x04,0x06,0x02,0x11,0x22,0x33,0x44,0x55}, 8),
	      "ifPhysAddress -> uip_ethaddr");
	CHECK(run_get(oid_sysname, sizeof(oid_sysname)) &&
	      R.vbs[0].val_len == 8 && memcmp(R.vbs[0].val, "snmptest", 8) == 0,
	      "sysName mirrors the hostname");
	CHECK(run_get(oid_sysdescr, sizeof(oid_sysdescr)) &&
	      R.vbs[0].val_len > 14 && memcmp(R.vbs[0].val, "RTLPlayground ", 14) == 0 &&
	      memcmp(R.vbs[0].val + R.vbs[0].val_len - 8, "SNMPTEST", 8) == 0,
	      "sysDescr = RTLPlayground <version> <machine>");

	/* ifDescr: empty name falls back to "Port N" */
	CHECK(run_get(oid_ifdescr, sizeof(oid_ifdescr)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x04,0x06,'P','o','r','t',' ','1'}, 8),
	      "ifDescr falls back to Port N when no name is set");
	memcpy(port_names[0], "uplink", 6);
	CHECK(run_get(oid_ifdescr, sizeof(oid_ifdescr)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x04,0x06,'u','p','l','i','n','k'}, 8),
	      "ifDescr uses the configured port name");
	port_names[0][0] = 0;
}

/* ---- link state, speed, MTU ---- */
static void t_link(void)
{
	hw_reset();
	snmp_init();
	snmp_start();

	/* down: no carrier bit, no speed nibble */
	CHECK(run_get(oid_ifoper, sizeof(oid_ifoper)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x02,0x01,0x02}, 3),
	      "carrier clear -> ifOperStatus down(2)");
	CHECK(run_get(oid_ifspeed, sizeof(oid_ifspeed)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x42,0x01,0x00}, 3),
	      "link down -> ifSpeed 0");

	/* carrier for port 0 lives in sfr byte 1, bit 0: value 1<<16 */
	hw_reg_set(RTL837X_REG_LINKS_STS, 1u << 16);
	CHECK(run_get(oid_ifoper, sizeof(oid_ifoper)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x02,0x01,0x01}, 3),
	      "carrier set -> ifOperStatus up(1)");

	/* speed nibble for port 0 sits in the low nibble of LINKS */
	hw_reg_set(RTL837X_REG_LINKS, 0x05);   /* 2.5G */
	CHECK(run_get(oid_ifspeed, sizeof(oid_ifspeed)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x42,0x05,0x95,0x02,0xF9,0x00}, 6),
	      "2.5G -> ifSpeed 2500000000");
	CHECK(run_get(oid_hispd, sizeof(oid_hispd)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x42,0x02,0x09,0xC4}, 4),
	      "2.5G -> ifHighSpeed 2500");
	hw_reg_set(RTL837X_REG_LINKS, 0x04);   /* 10G */
	CHECK(run_get(oid_ifspeed, sizeof(oid_ifspeed)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x42,0x04,0xFF,0xFF,0xFF,0xFF}, 6),
	      "10G saturates ifSpeed (RFC 3635)");
	CHECK(run_get(oid_hispd, sizeof(oid_hispd)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x42,0x02,0x27,0x10}, 4),
	      "10G -> ifHighSpeed 10000");
	hw_reg_set(RTL837X_REG_LINKS, 0x02);   /* 1G */
	CHECK(run_get(oid_ifspeed, sizeof(oid_ifspeed)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x42,0x04,0x3B,0x9A,0xCA,0x00}, 6),
	      "1G -> ifSpeed 1000000000");

	hw_reg_set(RTL8373_REG_MAC_L2_PORT_MAX_LEN, 1518);
	CHECK(run_get(oid_ifmtu, sizeof(oid_ifmtu)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x02,0x02,0x05,0xEE}, 4),
	      "ifMtu reads the live max-frame register");
}

/* ---- request validation and negative paths ---- */
static void t_negative(void)
{
	hw_reset();
	snmp_init();
	snmp_start();

	/* wrong community */
	build_get(1, "publicX", oid_sysdescr, sizeof(oid_sysdescr));
	deliver();
	CHECK(send_calls == 0, "wrong community stays silent");

	/* agent off */
	snmp_stop();
	build_get(1, "public", oid_sysdescr, sizeof(oid_sysdescr));
	deliver();
	CHECK(send_calls == 0, "disabled agent stays silent");
	snmp_start();

	/* SET is refused, read-only */
	build_start(PDU_SET_REQ, 1, "public", 0, 0);
	b_varbind(oid_sysname, sizeof(oid_sysname));
	build_finish();
	deliver();
	CHECK(send_calls == 0, "SET request stays silent");

	/* truncated message */
	build_get(1, "public", oid_sysdescr, sizeof(oid_sysdescr));
	rlen -= 2;
	deliver();
	CHECK(send_calls == 0, "truncated request stays silent");

	/* indefinite length */
	rlen = 0;
	b_u8(TAG_SEQ); b_u8(0x80);
	deliver();
	CHECK(send_calls == 0, "indefinite length stays silent");

	/* bad version */
	build_get(2, "public", oid_sysdescr, sizeof(oid_sysdescr));
	deliver();
	CHECK(send_calls == 0, "unknown version stays silent");

	/* wrong lport: the callback must filter */
	build_get(1, "public", oid_sysdescr, sizeof(oid_sysdescr));
	deliver();
		{
			int calls = send_calls;
			static struct uip_udp_conn other;

			other.lport = HTONS(162);
			uip_udp_conn = &other;
			uip_flags = UIP_NEWDATA;
			sent_len = 0xffff;
			snmp_callback();
			CHECK(send_calls == calls, "foreign lport ignored");
			/* periodic poll: nothing to send */
			uip_flags = 8 /* UIP_POLL */;
			uip_udp_conn = &snmp_conn;
			snmp_callback();
			CHECK(send_calls == calls, "poll without newdata ignored");
			uip_flags = UIP_NEWDATA;
		}
}

/* ---- v1 vs v2c error semantics ---- */
static void t_errors(void)
{
	hw_reset();
	snmp_init();
	snmp_start();

	/* v2c GET miss: per-varbind noSuchInstance, no error status.
	 * The exception is a zero-content TLV: tag 0x81, length 0. */
	run_get(oid_bogus, sizeof(oid_bogus));
	{
		uint16_t ti;
		fprintf(stderr, "miss resp: calls=%d sent=%u\n", send_calls, sent_len);
		for (ti = 0; ti < sent_len && ti < 48; ti++)
			fprintf(stderr, "%02x%s", ((const uint8_t *)uip_appdata)[ti],
				(ti % 16 == 15) ? "\n" : " ");
		fprintf(stderr, "\n");
	}
	CHECK(decode(resp_bytes(), sent_len, &R) &&
	      R.errstat == 0 && R.n_vb == 1 &&
	      R.vbs[0].val_tag == 0x81 && R.vbs[0].val_len == 0,
	      "v2c GET miss -> noSuchInstance");

	/* v1 GET miss: noSuchName with the request varbind list echoed */
	build_get(0, "public", oid_bogus, sizeof(oid_bogus));
	deliver();
	CHECK(decode(resp_bytes(), sent_len, &R) &&
	      R.errstat == 2 && R.erridx == 1 && R.n_vb == 1 &&
	      vb_oid_is(&R.vbs[0], oid_bogus, sizeof(oid_bogus)) &&
	      R.vbs[0].val_tag == 0x05,
	      "v1 GET miss -> noSuchName(2) with echoed varbind");

	/* request-id echoed verbatim, incl. bytes >= 0x80 and 5 content bytes */
	{
		static const uint8_t rid[] = { 0x80, 0x7f, 0x01, 0xfe, 0xab };
		build_start_rid(PDU_GET_REQ, 1, "public", 0, 0, rid, sizeof(rid));
		b_varbind(oid_sysdescr, sizeof(oid_sysdescr));
		build_finish();
		deliver();
		CHECK(decode(resp_bytes(), sent_len, &R) && R.reqid_len == 5 &&
		      R.reqid[0] == 0x80 && R.reqid[1] == 0x7f && R.reqid[4] == 0xab,
		      "request-id echoed verbatim");
	}

	/* v2c GETNEXT past the end: endOfMibView */
	{
		static const uint8_t past[] =
			{ 0x2b,0x06,0x01,0x02,0x01,0x1f,0x01,0x01,0x01,0x0f,0x09 };
		build_getnext(1, "public", past, sizeof(past));
		deliver();
		CHECK(decode(resp_bytes(), sent_len, &R) &&
		      R.n_vb == 1 && R.vbs[0].val_tag == 0x82 && R.vbs[0].val_len == 0,
		      "v2c GETNEXT past end -> endOfMibView");

		/* v1: noSuchName instead */
		build_getnext(0, "public", past, sizeof(past));
		deliver();
		CHECK(decode(resp_bytes(), sent_len, &R) && R.errstat == 2,
		      "v1 GETNEXT past end -> noSuchName");
	}

	/* too many varbinds: tooBig with an empty list */
	{
		uint8_t i;
		build_start(PDU_GET_REQ, 1, "public", 0, 0);
		for (i = 0; i < SNMP_MAX_VB + 1; i++)
			b_varbind(oid_ifindex, sizeof(oid_ifindex));
		build_finish();
		deliver();
		CHECK(decode(resp_bytes(), sent_len, &R) &&
		      R.errstat == 1 && R.n_vb == 0,
		      "17 varbinds -> tooBig with empty list");
	}

	/* GETNEXT from an exact instance returns its lexicographic successor:
	 * within a column that is the next row (column-major order) */
	{
		static const uint8_t ifindex2[] =
			{ 0x2b,0x06,0x01,0x02,0x01,0x02,0x02,0x01,0x01,0x02 };
		static const uint8_t ifindex9[] =
			{ 0x2b,0x06,0x01,0x02,0x01,0x02,0x02,0x01,0x01,0x09 };
		build_getnext(1, "public", oid_ifindex, sizeof(oid_ifindex));
		deliver();
		CHECK(decode(resp_bytes(), sent_len, &R) && R.n_vb == 1 &&
		      vb_oid_is(&R.vbs[0], ifindex2, sizeof(ifindex2)),
		      "GETNEXT from ifIndex.1 lands on ifIndex.2");
		build_getnext(1, "public", ifindex9, sizeof(ifindex9));
		deliver();
		CHECK(decode(resp_bytes(), sent_len, &R) && R.n_vb == 1 &&
		      vb_oid_is(&R.vbs[0], oid_ifdescr, sizeof(oid_ifdescr)),
		      "GETNEXT from ifIndex.9 crosses into ifDescr.1");
	}
}

/* ---- full tree walk in strict order ---- */
static void t_walk(void)
{
	static const uint8_t first[] = { 0x2b,0x06,0x01,0x02,0x01,0x01,0x01,0x00 };
	static const uint8_t ifindex_col[] = { 0x2b,0x06,0x01,0x02,0x01,0x02,0x02,0x01,0x01 };
	static const uint8_t last[] =
		{ 0x2b,0x06,0x01,0x02,0x01,0x1f,0x01,0x01,0x01,0x0f,0x09 };
	uint8_t cur[24];
	uint8_t cur_len = 2;
	uint16_t count = 0;
	uint16_t ifindex_seen = 0;
	uint8_t prev_ifindex = 0;
	uint8_t ok = 1;

	hw_reset();
	snmp_init();
	snmp_start();
	cur[0] = 0x00;
	cur[1] = 0x00;

	while (count < 400) {
		build_getnext(1, "public", cur, cur_len);
		deliver();
		if (!decode(resp_bytes(), sent_len, &R) || R.n_vb != 1) {
			ok = 0;
			break;
		}
		if (R.vbs[0].val_tag == 0x82)
			break;   /* endOfMibView */
		if (R.vbs[0].oid_len >= sizeof(cur) || R.vbs[0].oid_len <= cur_len) {
			/* not strictly ascending by byte order */
			if (R.vbs[0].oid_len < cur_len ||
			    memcmp(R.vbs[0].oid, cur, cur_len) == 0) {
				ok = 0;
				break;
			}
		}
		memcpy(cur, R.vbs[0].oid, R.vbs[0].oid_len);
		cur_len = R.vbs[0].oid_len;
		count++;
		/* track the ifIndex column: rows must ascend 1..9 */
		if (cur_len == 10 && memcmp(cur, ifindex_col, 9) == 0) {
			if (prev_ifindex && cur[9] != prev_ifindex + 1)
				ok = 0;
			prev_ifindex = cur[9];
			ifindex_seen++;
		}
	}

	CHECK(ok, "walk stays strictly ascending");
	CHECK(count == 188, "188 instances: 8 scalars + 20 columns x 9 ports");
	CHECK(ifindex_seen == 9 && prev_ifindex == 9, "ifIndex rows ascend 1..9");

	/* spot checks: first and last instance */
	build_getnext(1, "public", (const uint8_t[]){0x00,0x00}, 2);
	deliver();
	CHECK(decode(resp_bytes(), sent_len, &R) &&
	      vb_oid_is(&R.vbs[0], first, sizeof(first)),
	      "walk starts at sysDescr.0");
	{
		static const uint8_t before_last[] =
			{ 0x2b,0x06,0x01,0x02,0x01,0x1f,0x01,0x01,0x01,0x0f,0x08 };
		build_getnext(1, "public", before_last, sizeof(before_last));
		deliver();
		CHECK(decode(resp_bytes(), sent_len, &R) &&
		      vb_oid_is(&R.vbs[0], last, sizeof(last)),
		      "walk ends at ifHighSpeed.9");
	}
}

/* ---- row order on a machine with a non-monotonic port map ---- */
static void t_disorder(void)
{
	static const uint8_t ifindex_col[] = { 0x2b,0x06,0x01,0x02,0x01,0x02,0x02,0x01,0x01 };
	uint8_t cur[24];
	uint8_t cur_len = 2;
	uint8_t prev = 0;
	uint8_t seen = 0;
	uint8_t ok = 1;

	hw_reset();
	snmp_init();
	snmp_start();

	/* the 6-port RTL8372 layout: logical 3..8 map to physical 5,1,2,3,4,6 */
	machine.min_port = 3;
	machine.max_port = 8;
	{
		uint8_t map[9] = { 0, 0, 0, 5, 1, 2, 3, 4, 6 };
		uint8_t p;
		memcpy(machine.log_to_phys_port, map, 9);
		memset(machine.phys_to_log_port, 0, 9);
		for (p = 3; p <= 8; p++)
			machine.phys_to_log_port[map[p] - 1] = p;
	}

	/* ifNumber follows the machine */
	CHECK(run_get(oid_ifnumber, sizeof(oid_ifnumber)) &&
	      vb_val_is(&R.vbs[0], (const uint8_t[]){0x02,0x01,0x06}, 3),
	      "disorder machine reports ifNumber 6");

	/* counters follow the mapping: logical port 3 = physical port 5 */
	hw_counter_set(3, 0, 77);
	{
		static const uint8_t ifinoct5[] =
			{ 0x2b,0x06,0x01,0x02,0x01,0x02,0x02,0x01,0x0a,0x05 };
		CHECK(run_get(ifinoct5, sizeof(ifinoct5)) &&
		      vb_val_is(&R.vbs[0], (const uint8_t[]){0x41,0x01,77}, 3),
		      "ifInOctets.5 reads logical port 3");
	}

	/* walking the ifIndex column visits physical ports in order 1..6 */
	cur[0] = 0x00;
	cur[1] = 0x00;
	while (seen < 200) {
		build_getnext(1, "public", cur, cur_len);
		deliver();
		if (!decode(resp_bytes(), sent_len, &R) || R.n_vb != 1)
			break;
		if (R.vbs[0].val_tag == 0x82)
			break;
		memcpy(cur, R.vbs[0].oid, R.vbs[0].oid_len);
		cur_len = R.vbs[0].oid_len;
		if (cur_len == 10 && memcmp(cur, ifindex_col, 9) == 0) {
			if (prev && cur[9] != prev + 1)
				ok = 0;
			prev = cur[9];
			seen++;
		}
	}
	CHECK(ok && seen == 6 && prev == 6, "disorder rows ascend 1..6");

	/* restore the identity machine */
	machine.min_port = 0;
	machine.max_port = 8;
	{
		uint8_t i;
		for (i = 0; i < 9; i++) {
			machine.log_to_phys_port[i] = i + 1;
			machine.phys_to_log_port[i] = i;
		}
	}
}

/* ---- GetBulk ---- */
static void t_bulk(void)
{
	static const uint8_t sysobj[] = { 0x2b,0x06,0x01,0x02,0x01,0x01,0x02,0x00 };
	hw_reset();
	snmp_init();
	snmp_start();

	/* non-repeater: answered once, no repetition */
	build_bulk("public", 1, 10, oid_sysdescr, sizeof(oid_sysdescr));
	deliver();
	CHECK(decode(resp_bytes(), sent_len, &R) && R.n_vb == 1 &&
	      vb_oid_is(&R.vbs[0], sysobj, sizeof(sysobj)),
	      "non-repeater varbind answered once");

	/* repeater chain: 5 rounds from sysDescr.0 land on the next scalars */
	{
		static const uint8_t sysloc[] = { 0x2b,0x06,0x01,0x02,0x01,0x01,0x06,0x00 };
		build_bulk("public", 0, 5, oid_sysdescr, sizeof(oid_sysdescr));
		deliver();
		CHECK(decode(resp_bytes(), sent_len, &R) && R.n_vb == 5 &&
		      vb_oid_is(&R.vbs[0], sysobj, sizeof(sysobj)) &&
		      vb_oid_is(&R.vbs[1], oid_uptime, sizeof(oid_uptime)) &&
		      vb_oid_is(&R.vbs[4], sysloc, sizeof(sysloc)),
		      "bulk chain advances one instance per round");
	}

	/* space cap: a max-repetition walk over the whole table stays in one
	 * frame and parses cleanly */
	{
		uint8_t cur[24];
		uint8_t cur_len = 2;
		uint16_t total = 0;
		uint16_t count = 0;

		cur[0] = 0x2b; cur[1] = 0x06; cur[2] = 0x01; cur[3] = 0x02; cur[4] = 0x01;
		cur[5] = 0x02; cur[6] = 0x02; cur[7] = 0x01; cur[8] = 0x01; cur[9] = 0x01;
		cur_len = 10;   /* ifIndex.1: the whole ifTable follows */
		while (count < 300) {
			build_bulk("public", 0, 255, cur, cur_len);
			deliver();
			if (send_calls != 1 || sent_len > 1502)
				break;
			if (!decode(resp_bytes(), sent_len, &R))
				break;
			if (R.n_vb == 0)
				break;
			/* count real instances; endOfMibView filler is not one */
			for (uint8_t vi = 0; vi < R.n_vb; vi++)
				if (R.vbs[vi].val_tag != 0x82)
					total++;
			if (R.vbs[R.n_vb - 1].val_tag == 0x82)
				break;   /* reached endOfMibView */
			memcpy(cur, R.vbs[R.n_vb - 1].oid, R.vbs[R.n_vb - 1].oid_len);
			cur_len = R.vbs[R.n_vb - 1].oid_len;
			count++;
		}
		CHECK(sent_len <= 1502, "every bulk response fits one frame");
		CHECK(total >= 100, "bulk walk covers the whole ifTable");
		CHECK(total == 179, "179 instances follow ifIndex.1");
	}
}

/* ---- community handling ---- */
static void t_community(void)
{
	hw_reset();
	snmp_init();
	snmp_arg = "zbx#read";
	CHECK(snmp_set_community(), "valid community accepted");
	CHECK(t_strcmp(snmp_state.community, "zbx#read") == 0, "community stored");
	snmp_arg = "seventeenchars17x";
	CHECK(!snmp_set_community(), "17 characters rejected");
	snmp_arg = "has space";
	CHECK(!snmp_set_community(), "space rejected");
	snmp_arg = "";
	CHECK(!snmp_set_community(), "empty rejected");
	CHECK(t_strcmp(snmp_state.community, "zbx#read") == 0,
	      "rejected input leaves community unchanged");

	snmp_start();
	build_get(1, "zbx#read", oid_sysdescr, sizeof(oid_sysdescr));
	deliver();
	CHECK(send_calls == 1, "request with new community answered");
	build_get(1, "public", oid_sysdescr, sizeof(oid_sysdescr));
	deliver();
	CHECK(send_calls == 0, "old community rejected after change");
	snmp_arg = "public";
	snmp_set_community();
}

int main(void)
{
	t_values();
	t_link();
	t_negative();
	t_errors();
	t_walk();
	t_bulk();
	t_disorder();
	t_community();
	printf("\n%d checks, %d failed\n", tests_run, tests_failed);
	return tests_failed ? 1 : 0;
}
