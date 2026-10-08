/* SNMPv2c read-only agent: MIB-II system group + interfaces group (with the
 * IF-MIB 64-bit octet counters and ifHighSpeed). One UDP listener on port
 * 161, community-string auth, off until `snmp on`.
 *
 * Everything happens inside the uIP appcall: the request is parsed where it
 * landed in uip_buf, the response is built further up in the same buffer and
 * handed back with uip_udp_send(). No reassembly (UIP_REASSEMBLY is off), so
 * a response that would not fit in one frame is refused with tooBig instead
 * of being truncated.
 *
 * Replying needs care: udp_send() fills the destination from uip_udp_conn,
 * which the appcall can only influence before returning. Rewriting the
 * listener would pin it to the last client until it is reset, so the reply
 * goes out through a scratch conn instead - see snmp_callback().
 *
 * Internal RAM note: the overlay segment is full, so helpers take no
 * parameters - they read them from the XDATA statics below - and every
 * local is static __xdata. Results come back in registers or dedicated
 * result statics, mirroring how the rest of the firmware passes ip[],
 * atoi_results_short & co around.
 */
#include "machine.h"
#include "snmp.h"
#include "uip/uip.h"
#include "rtl837x_common.h"
#include "rtl837x_regs.h"
#include "rtl837x_sfr.h"
#include "rtl837x_port.h"
#include "version.h"

#ifndef BRIDGE_LAYOUT
#pragma codeseg BANK7
#pragma constseg BANK7

extern __code const struct machine machine;
extern volatile __xdata uint8_t sfr_data[4];
extern volatile __xdata uint32_t ticks;

#define state snmp_state

__xdata struct snmp_state snmp_state;
__xdata char snmp_sysdescr[64];
static __xdata uint8_t sysdescr_len;

/* sysObjectID sits under enterprises with an unregistered placeholder PEN;
 * doc/snmp.md explains. The encoder takes any value, so registering costs
 * one define. */
#ifndef SNMP_SYSOBJID_PEN
#define SNMP_SYSOBJID_PEN 32473
#endif

/* BER tags. */
#define TAG_INT      0x02
#define TAG_OCTS     0x04
#define TAG_OID      0x06
#define TAG_SEQ      0x30
#define PDU_GET      0xA0
#define PDU_GETNEXT  0xA1
#define PDU_BULK     0xA5
#define TAG_C32      0x41
#define TAG_G32      0x42
#define TAG_TICKS    0x43
#define TAG_C64      0x46

#define SNMP_ERR_TOOBIG     1
#define SNMP_ERR_NOSUCHNAME 2

#define EXC_NOSUCHINST   1   /* context tag 0x81 */
#define EXC_ENDOFMIBVIEW 2   /* context tag 0x82 */

/* Every leaf shares the encoded prefix 1.3.6.1.2.1 = { 0x2b,06,01,02,01 },
 * and every remaining subid (columns, scalars, ifIndex) is below 128, so a
 * full instance OID is the prefix plus one byte per subid. That makes OID
 * lexicographic order byte order: the tree is compared and walked directly
 * on the encoded bytes, with no dotted decimals in sight. */
#define OID_PREFIX_LEN 5
static __code const uint8_t oid_prefix[OID_PREFIX_LEN] = { 0x2b, 0x06, 0x01, 0x02, 0x01 };

/* Longest instance we can name: an ifHC column under 31.1.1.1 plus the row
 * byte. Requests carrying more content than that are outside anything we
 * model; the stored prefix gets bit 7 of its length set so it sorts past
 * the whole tree. */
#define SNMP_OID_MAX 20
#define OID_LEN_PAST 0x80

/* Varbinds answered per request. 16 covers every real NMS poll; more than
 * that could not be answered within one 1502-byte frame anyway. */
#define SNMP_MAX_VB 16

/* The appcall owns uip_appdata through uip_appdata + UIP_BUFSIZE - the
 * response body starts after the worst-case header chain and is shifted down
 * to its final position once its length is known. The chain reaches ~46
 * bytes with a maximum community string and long-form lengths. */
#define SNMP_MAX_MSG (UIP_BUFSIZE - UIP_LLH_LEN - UIP_IPUDPH_LEN)
#define SNMP_HDR_RESERVE 48
#define SNMP_MAX_BODY (SNMP_MAX_MSG - SNMP_HDR_RESERVE)

/* One varbind: seq hdr + full OID TLV (5 prefix + 9 suffix + row + 2 hdr)
 * + value (sysDescr is the largest at ~61 bytes). */
#define SNMP_VB_MAX 96

/* Value kinds. */
enum { SNT_INT, SNT_OCTS, SNT_OID, SNT_TICKS, SNT_C32, SNT_G32, SNT_C64 };

/* Where a value comes from. */
enum {
	SNV_SYSDSCR, SNV_SYSOBJID, SNV_UPTIME, SNV_CONTACT, SNV_NAME, SNV_LOCATION,
	SNV_SERVICES, SNV_IFNUMBER,
	SNV_IFINDEX, SNV_IFDESCR, SNV_IFTYPE, SNV_IFMTU, SNV_IFSPEED, SNV_IFPHYS,
	SNV_IFADMIN, SNV_IFOPER, SNV_IFLASTCH,
	SNV_IFINOCT, SNV_IFINUCAST, SNV_IFINDISC, SNV_IFINERR,
	SNV_IFOUTOCT, SNV_IFOUTUCAST, SNV_IFOUTDISC, SNV_IFOUTERR,
	SNV_HCIINOCT, SNV_HCIOUTOCT, SNV_IFHISPD
};

struct snmp_leaf {
	__code const uint8_t *suffix;   /* encoded subids after 1.3.6.1.2.1 */
	uint8_t suffix_len;
	uint8_t type;                   /* SNT_* */
	uint8_t src;                    /* SNV_* */
	uint8_t port_col;               /* 0 = scalar (.0), 1 = one row per port */
};

/* The tree in strict encoded-OID order - GETNEXT correctness depends on it.
 * ifIndex is the 1-based physical port number, same as the web UI. */
static __code const uint8_t suf_sysdescr[]  = { 0x01, 0x01, 0x00 };
static __code const uint8_t suf_sysobjid[]  = { 0x01, 0x02, 0x00 };
static __code const uint8_t suf_uptime[]    = { 0x01, 0x03, 0x00 };
static __code const uint8_t suf_contact[]   = { 0x01, 0x04, 0x00 };
static __code const uint8_t suf_name[]      = { 0x01, 0x05, 0x00 };
static __code const uint8_t suf_location[]  = { 0x01, 0x06, 0x00 };
static __code const uint8_t suf_services[]  = { 0x01, 0x07, 0x00 };
static __code const uint8_t suf_ifnumber[]  = { 0x02, 0x01, 0x00 };
static __code const uint8_t suf_ifindex[]   = { 0x02, 0x02, 0x01, 0x01 };
static __code const uint8_t suf_ifdescr[]   = { 0x02, 0x02, 0x01, 0x02 };
static __code const uint8_t suf_iftype[]    = { 0x02, 0x02, 0x01, 0x03 };
static __code const uint8_t suf_ifmtu[]     = { 0x02, 0x02, 0x01, 0x04 };
static __code const uint8_t suf_ifspeed[]   = { 0x02, 0x02, 0x01, 0x05 };
static __code const uint8_t suf_ifphys[]    = { 0x02, 0x02, 0x01, 0x06 };
static __code const uint8_t suf_ifadmin[]   = { 0x02, 0x02, 0x01, 0x07 };
static __code const uint8_t suf_ifoper[]    = { 0x02, 0x02, 0x01, 0x08 };
static __code const uint8_t suf_iflastch[]  = { 0x02, 0x02, 0x01, 0x09 };
static __code const uint8_t suf_ifinoct[]   = { 0x02, 0x02, 0x01, 0x0a };
static __code const uint8_t suf_ifinucast[] = { 0x02, 0x02, 0x01, 0x0b };
static __code const uint8_t suf_ifindisc[]  = { 0x02, 0x02, 0x01, 0x0d };
static __code const uint8_t suf_ifinerr[]   = { 0x02, 0x02, 0x01, 0x0e };
static __code const uint8_t suf_ifoutoct[]  = { 0x02, 0x02, 0x01, 0x10 };
static __code const uint8_t suf_ifoutucast[] = { 0x02, 0x02, 0x01, 0x11 };
static __code const uint8_t suf_ifoutdisc[]  = { 0x02, 0x02, 0x01, 0x13 };
static __code const uint8_t suf_ifouterr[]   = { 0x02, 0x02, 0x01, 0x14 };
/* The ifXTable lives under ifMIBObjects 1.3.6.1.2.1.31.1.1.1.<col>, not
 * inside the ifTable. */
static __code const uint8_t suf_hcin[]  = { 0x1f, 0x01, 0x01, 0x01, 0x06 };
static __code const uint8_t suf_hcout[] = { 0x1f, 0x01, 0x01, 0x01, 0x0a };
static __code const uint8_t suf_hispd[] = { 0x1f, 0x01, 0x01, 0x01, 0x0f };

#define LEAF(suf, t, s, pc) { suf, sizeof(suf), (t), (s), (pc) }
static __code const struct snmp_leaf leaves[] = {
	LEAF(suf_sysdescr,  SNT_OCTS,  SNV_SYSDSCR,   0),
	LEAF(suf_sysobjid,  SNT_OID,   SNV_SYSOBJID,  0),
	LEAF(suf_uptime,    SNT_TICKS, SNV_UPTIME,    0),
	LEAF(suf_contact,   SNT_OCTS,  SNV_CONTACT,   0),
	LEAF(suf_name,      SNT_OCTS,  SNV_NAME,      0),
	LEAF(suf_location,  SNT_OCTS,  SNV_LOCATION,  0),
	LEAF(suf_services,  SNT_INT,   SNV_SERVICES,  0),
	LEAF(suf_ifnumber,  SNT_INT,   SNV_IFNUMBER,  0),
	LEAF(suf_ifindex,   SNT_INT,   SNV_IFINDEX,   1),
	LEAF(suf_ifdescr,   SNT_OCTS,  SNV_IFDESCR,   1),
	LEAF(suf_iftype,    SNT_INT,   SNV_IFTYPE,    1),
	LEAF(suf_ifmtu,     SNT_INT,   SNV_IFMTU,     1),
	LEAF(suf_ifspeed,   SNT_G32,   SNV_IFSPEED,   1),
	LEAF(suf_ifphys,    SNT_OCTS,  SNV_IFPHYS,    1),
	LEAF(suf_ifadmin,   SNT_INT,   SNV_IFADMIN,   1),
	LEAF(suf_ifoper,    SNT_INT,   SNV_IFOPER,    1),
	LEAF(suf_iflastch,  SNT_TICKS, SNV_IFLASTCH,  1),
	LEAF(suf_ifinoct,   SNT_C32,   SNV_IFINOCT,   1),
	LEAF(suf_ifinucast, SNT_C32,   SNV_IFINUCAST, 1),
	LEAF(suf_ifindisc,  SNT_C32,   SNV_IFINDISC,  1),
	LEAF(suf_ifinerr,   SNT_C32,   SNV_IFINERR,   1),
	LEAF(suf_ifoutoct,  SNT_C32,   SNV_IFOUTOCT,  1),
	LEAF(suf_ifoutucast, SNT_C32,  SNV_IFOUTUCAST, 1),
	LEAF(suf_ifoutdisc, SNT_C32,   SNV_IFOUTDISC, 1),
	LEAF(suf_ifouterr,  SNT_C32,   SNV_IFOUTERR,  1),
	LEAF(suf_hcin,      SNT_C64,   SNV_HCIINOCT,  1),
	LEAF(suf_hcout,     SNT_C64,   SNV_HCIOUTOCT, 1),
	LEAF(suf_hispd,     SNT_G32,   SNV_IFHISPD,   1),
};
#define N_LEAVES ((uint8_t)(sizeof(leaves) / sizeof(leaves[0])))

/* Parsed request. The request buffer is about to be overwritten by the
 * response, so the OIDs are copied out while it is still intact. */
static __xdata struct {
	uint8_t pdu_tag;
	uint8_t version;
	uint8_t reqid[7];      /* tag + len + content, echoed verbatim */
	uint8_t reqid_len;
	uint8_t non_rep;
	uint8_t max_rep;
	uint8_t n_vb;
	uint16_t vbl_off;      /* varbind-list TLV inside the request */
	uint8_t vbl_hl;        /* its header length */
	uint16_t vbl_len;      /* its content length */
	uint8_t oid_len[SNMP_MAX_VB];
	uint8_t oid[SNMP_MAX_VB][SNMP_OID_MAX];
	uint32_t c_hi, c_lo;   /* last STAT_GET result */
} req;

/* Table rows in ascending ifIndex order. log_to_phys_port is not monotonic
 * on every machine, so the order is sorted once per request. */
static __xdata uint8_t rows[9];
static __xdata uint8_t n_rows;

static __xdata uint8_t vb_buf[SNMP_VB_MAX];
static __xdata uint16_t body_len;
static __xdata uint8_t overflow;

/* Reply conn: udp_send() reads the destination from whatever uip_udp_conn
 * points at when the appcall returns. */
static __xdata struct uip_udp_conn snmp_reply_conn;

/* Helper arguments and results, in place of parameters: SDCC places
 * parameters in the overlay segment and internal RAM has nothing left.
 * Convention per call site: p/p2 pointers, a-d bytes, w 16-bit, v/v2
 * 32-bit; lookup() reports through res_leaf/res_row. */
static __xdata uint8_t * __xdata p, * __xdata p2;
static __xdata uint8_t a, b, c, d;
static __xdata uint16_t w;
static __xdata uint32_t v, v2;
static __xdata uint8_t res_leaf, res_row;

/* lookup() query: OID pointer, length, want-next flag; cmp_inst() verdict. */
static __xdata uint8_t * __xdata qptr;
static __xdata uint8_t qlen, qnext;
static __xdata int16_t cv;

static void read_stat(void);   /* read_stat_row() runs it forward */

/* ---- BER encoding (arguments via p/a/w/v, see the block above) ---- */

/* Length of the BER length field for w octets. */
static uint8_t ber_len_len(void)
{
	if (w < 0x80)
		return 1;
	if (w < 0x100)
		return 2;
	return 3;
}

/* Write the BER length field for w at p; returns its size, p untouched. */
static uint8_t ber_put_len(void)
{
	if (w < 0x80) {
		p[0] = w;
		return 1;
	}
	if (w < 0x100) {
		p[0] = 0x81;
		p[1] = w;
		return 2;
	}
	p[0] = 0x82;
	p[1] = w >> 8;
	p[2] = w & 0xff;
	return 3;
}

/* Minimal signed integer from v at p. Everything the tree holds is small
 * and non-negative, but the encoder stays general so tests can pin bytes. */
static uint8_t put_int(void)
{
	static __xdata uint8_t buf[4];
	static __xdata uint8_t s, n, i;

	buf[0] = v >> 24; buf[1] = v >> 16; buf[2] = v >> 8; buf[3] = v;
	s = 0;
	n = 4;
	while (n > 1 && ((buf[s] == 0x00 && buf[s + 1] < 0x80) ||
			 (buf[s] == 0xff && buf[s + 1] >= 0x80))) {
		s++;
		n--;
	}
	p[0] = TAG_INT;
	p[1] = n;
	for (i = 0; i < n; i++)
		p[2 + i] = buf[s + i];
	return n + 2;
}

/* Minimal unsigned integer from v with the application tag in a
 * (Counter32 / Gauge32 / TimeTicks). */
static uint8_t put_u32(void)
{
	static __xdata uint8_t buf[4];
	static __xdata uint8_t n, i;

	n = 0;
	do {
		buf[n++] = v & 0xff;
		v >>= 8;
	} while (v);
	p[0] = a;
	p[1] = n;
	for (i = 0; i < n; i++)
		p[2 + i] = buf[n - 1 - i];
	return n + 2;
}

/* Counter64 from the two words v (high) and v2 (low). */
static uint8_t put_c64(void)
{
	static __xdata uint8_t s, n, i;

	p[2] = v >> 24; p[3] = v >> 16; p[4] = v >> 8; p[5] = v;
	p[6] = v2 >> 24; p[7] = v2 >> 16; p[8] = v2 >> 8; p[9] = v2;
	s = 2;
	n = 8;
	while (n > 1 && p[s] == 0) {
		s++;
		n--;
	}
	p[0] = TAG_C64;
	p[1] = n;
	for (i = 0; i < n; i++)
		p[2 + i] = p[s + i];
	return n + 2;
}

/* One base-128 subidentifier from v (the PEN is the only subid anywhere in
 * the tree that can exceed 127). */
static uint8_t put_subid(void)
{
	static __xdata uint8_t tmp[5];
	static __xdata uint8_t n, k;

	n = 0;
	do {
		tmp[n++] = v & 0x7f;
		v >>= 7;
	} while (v);
	k = 0;
	while (n) {
		uint8_t cont;
		n--;
		cont = n ? 0x80 : 0;
		p[k++] = tmp[n] | cont;
	}
	return k;
}

static uint8_t put_octets(void)
{
	p[0] = TAG_OCTS;
	p[1] = a;
	memcpy(p + 2, p2, a);
	return a + 2;
}

/* Full instance OID at p for leaf a, row b: 1.3.6.1.2.1 + suffix + row. */
static uint8_t put_oid_inst(void)
{
	static __code const struct snmp_leaf * __xdata L;
	static __xdata uint8_t k, i;

	L = &leaves[a];
	k = OID_PREFIX_LEN + 2;
	p[2] = oid_prefix[0];
	p[3] = oid_prefix[1];
	p[4] = oid_prefix[2];
	p[5] = oid_prefix[3];
	p[6] = oid_prefix[4];
	for (i = 0; i < L->suffix_len; i++)
		p[k++] = L->suffix[i];
	if (L->port_col)
		p[k++] = b;
	p[0] = TAG_OID;
	p[1] = k - 2;
	return k;
}

/* ---- BER parsing: read-only cursor over the request ---- */

/* Parse a BER length at p against the bound p2 into w. Rejects indefinite
 * form and anything that would run past the bound. */
static uint8_t parse_len(void)
{
	static __xdata uint8_t k;

	if (p >= p2)
		return 1;
	k = *p++;
	if (k < 0x80) {
		w = k;
	} else if (k == 0x80) {
		return 1;
	} else {
		k &= 0x7f;
		if (k > 2)
			return 1;
		w = 0;
		while (k--) {
			if (p >= p2)
				return 1;
			w = (w << 8) | *p++;
		}
	}
	if (p + w > p2)
		return 1;
	return 0;
}

/* Parse tag + length at p; the expected tag is in a, 0 = any tag. */
static uint8_t parse_tlv(void)
{
	if (p >= p2)
		return 1;
	if (a && *p != a)
		return 1;
	p++;
	return parse_len();
}

/* Parse the request at uip_appdata (uip_len bytes) into req.
 * Returns 0 = ok, 1 = malformed or wrong community (drop silently),
 * 2 = more varbinds than we answer (reply tooBig). */
static uint8_t parse_request(void)
{
	static __xdata uint8_t * __xdata cur, * __xdata end, * __xdata pdu_end, * __xdata vbl_end, * __xdata vb_end, * __xdata vbl_tlv;
	static __xdata uint16_t len;
	static __xdata uint8_t rl;

	cur = (__xdata uint8_t *)uip_appdata;
	end = cur + uip_len;

	p = cur;
	p2 = end;
	a = TAG_SEQ;
	if (parse_tlv())
		return 1;
	end = p + w;   /* message content */

	p2 = end;
	a = TAG_INT;
	if (parse_tlv() || !w || w > 4)
		return 1;
	req.version = p[w - 1];
	if (req.version > 1)   /* 0 = v1, 1 = v2c */
		return 1;
	p += w;

	a = TAG_OCTS;
	if (parse_tlv())
		return 1;
	{
		static __xdata uint8_t cl;
		cl = strlen_x(state.community);
		if (w != cl || memcmp(p, state.community, cl))
			return 1;
	}
	p += w;

	if (p >= end)
		return 1;
	req.pdu_tag = *p++;
	if (req.pdu_tag != PDU_GET && req.pdu_tag != PDU_GETNEXT && req.pdu_tag != PDU_BULK)
		return 1;   /* SET and everything else: read-only, drop */
	if (parse_len())
		return 1;
	pdu_end = p + w;

	/* request-id, echoed verbatim: short-form length only, up to 5 bytes */
	if (p + 2 > pdu_end || p[0] != TAG_INT)
		return 1;
	rl = p[1];
	if (rl >= 0x80 || rl > 5)
		return 1;
	req.reqid_len = rl + 2;
	memcpy(req.reqid, p, req.reqid_len);
	p += req.reqid_len;

	/* error-status / error-index carry non-repeaters / max-repetitions
	 * in a bulk request and are zero otherwise. */
	p2 = pdu_end;
	a = TAG_INT;
	if (parse_tlv() || !w || w > 4)
		return 1;
	req.non_rep = (req.pdu_tag == PDU_BULK) ? p[w - 1] : 0;
	p += w;
	if (parse_tlv() || !w || w > 4)
		return 1;
	req.max_rep = (req.pdu_tag == PDU_BULK) ? p[w - 1] : 0;
	p += w;

	vbl_tlv = p;
	a = TAG_SEQ;
	if (parse_tlv())
		return 1;
	req.vbl_off = vbl_tlv - (__xdata uint8_t *)uip_appdata;
	req.vbl_hl = p - vbl_tlv;
	req.vbl_len = w;
	vbl_end = p + w;

	req.n_vb = 0;
	while (p < vbl_end) {
		if (req.n_vb >= SNMP_MAX_VB)
			return 2;
		p2 = vbl_end;   /* back to the list scope for the next SEQ */
		a = TAG_SEQ;
		if (parse_tlv())
			return 1;
		vb_end = p + w;
		p2 = vb_end;
		a = TAG_OID;
		if (parse_tlv())
			return 1;
		if (w > SNMP_OID_MAX) {
			/* Nothing in our tree comes close; store the truncated
			 * prefix with bit 7 set: it sorts past every instance
			 * we have. */
			memcpy(req.oid[req.n_vb], p, SNMP_OID_MAX);
			req.oid_len[req.n_vb] = OID_LEN_PAST | SNMP_OID_MAX;
		} else {
			memcpy(req.oid[req.n_vb], p, w);
			req.oid_len[req.n_vb] = w;
		}
		p += w;
		req.n_vb++;
		/* skip the value TLV, any tag: tag byte consumed by hand,
		 * so parse the length only */
		if (p >= vb_end)
			return 1;
		p++;
		if (parse_len())
			return 1;
	}
	(void)len;
	return 0;
}

/* ---- values ---- */

/* 200 Hz tick, TimeTicks wants centiseconds. The ISR bumps ticks between
 * our byte reads now and then; re-read until both reads agree. Ticks
 * advance every 5 ms and a read is far quicker, so this settles at once. */
static uint32_t uptime_cs(void)
{
	static __xdata uint32_t t1, t2;

	do {
		t1 = ticks;
		t2 = ticks;
	} while (t1 != t2);
	return t1 >> 1;
}

/* The chip talks to logical ports; ifIndex counts physical ones. Row in b. */
static uint8_t row_to_lp(void)
{
	return machine.phys_to_log_port[b - 1];
}

/* Link state and speed nibble for logical port a, same read sequence as
 * send_status(): 0=10M 1=100M 2=1G 3=500M 4=10G 5=2.5G 6=5G, 0xff = down. */
static uint8_t link_nibble(void)
{
	static __xdata uint8_t nb;

	reg_read_m(RTL837X_REG_LINKS_STS);
	if (!((sfr_data[(a / 8) + 1] >> (a % 8)) & 1))
		return 0xff;
	if (a < 8)
		reg_read_m(RTL837X_REG_LINKS);
	else
		reg_read_m(RTL837X_REG_LINKS_89);
	nb = sfr_data[3 - ((a & 7) >> 1)];
	return (a & 1) ? (nb >> 4) : (nb & 0xf);
}

/* One STAT_GET: counter index in a, ifIndex row in b; the 64-bit result
 * lands in req.c_hi/c_lo. sfr_data is big-endian: sfr_data[0] is the MSB. */
static void read_stat_row(void)
{
	static __xdata uint8_t lp;

	lp = row_to_lp();
	b = lp;
	read_stat();
}

/* read_stat for counter a on logical port b. */
static void read_stat(void)
{
	STAT_GET(a, b);
	reg_read_m(RTL837X_STAT_V_HIGH);
	req.c_hi = ((uint32_t)sfr_data[0] << 24) | ((uint32_t)sfr_data[1] << 16) |
		   ((uint32_t)sfr_data[2] << 8) | sfr_data[3];
	reg_read_m(RTL837X_STAT_V_LOW);
	req.c_lo = ((uint32_t)sfr_data[0] << 24) | ((uint32_t)sfr_data[1] << 16) |
		   ((uint32_t)sfr_data[2] << 8) | sfr_data[3];
}

/* bps for ifSpeed; rates past 4.29 Gbps saturate the Gauge32 (RFC 3635),
 * ifHighSpeed carries the true value. Speed nibble in a. */
static uint32_t nibble_bps(void)
{
	switch (a) {
	case 0: return 10000000UL;
	case 1: return 100000000UL;
	case 2: return 1000000000UL;
	case 3: return 500000000UL;
	case 4: return 4294967295UL;   /* 10G */
	case 5: return 2500000000UL;   /* 2.5G */
	case 6: return 4294967295UL;   /* 5G */
	default: return 0;
	}
}

/* Mbps for ifHighSpeed. Speed nibble in a. */
static uint16_t nibble_mbps(void)
{
	switch (a) {
	case 0: return 10;
	case 1: return 100;
	case 2: return 1000;
	case 3: return 500;
	case 4: return 10000;
	case 5: return 2500;
	case 6: return 5000;
	default: return 0;
	}
}

/* Encode the value TLV of leaf instance (a, b) at p. c selects a v2c
 * exception instead of a real value: 1 = noSuchInstance,
 * 2 = endOfMibView. */
static uint8_t put_value(void)
{
	static __xdata uint8_t lp, nb, n;

	if (c) {
		p[0] = 0x80 | c;
		p[1] = 0x00;
		return 2;
	}

	switch (leaves[a].src) {
	case SNV_SYSDSCR:
		p2 = snmp_sysdescr;
		a = sysdescr_len;
		return put_octets();
	case SNV_SYSOBJID:
		p[2] = oid_prefix[0]; p[3] = 0x06; p[4] = 0x01; p[5] = 0x04; p[6] = 0x01;
		p2 = p;
		p += 7;
		v = SNMP_SYSOBJID_PEN;
		n = put_subid();
		p = p2;
		p[0] = TAG_OID;
		p[1] = 5 + n;
		return 7 + n;
	case SNV_UPTIME:
		v = uptime_cs();
		a = TAG_TICKS;
		return put_u32();
	case SNV_CONTACT:
		p2 = state.contact;
		a = strlen_x(state.contact);
		return put_octets();
	case SNV_NAME:
		p2 = hostname;
		a = strlen_x(hostname);
		return put_octets();
	case SNV_LOCATION:
		p2 = state.location;
		a = strlen_x(state.location);
		return put_octets();
	case SNV_SERVICES:
		v = 2;   /* L2 */
		return put_int();
	case SNV_IFNUMBER:
		v = machine.max_port - machine.min_port + 1;
		return put_int();
	case SNV_IFINDEX:
		v = b;
		return put_int();
	case SNV_IFDESCR:
		lp = row_to_lp();
		n = strlen_x(port_names[lp]);
		if (!n) {
			/* No name configured: still return something useful. */
			memcpyc(p + 2, "Port ", 5);
			p[7] = '0' + b;
			p[0] = TAG_OCTS;
			p[1] = 6;
			return 8;
		}
		p2 = port_names[lp];
		a = n;
		return put_octets();
	case SNV_IFTYPE:
		v = 6;   /* ethernetCsmacd */
		return put_int();
	case SNV_IFMTU:
		lp = row_to_lp();
		reg_read_m(RTL8373_REG_MAC_L2_PORT_MAX_LEN + ((uint16_t)lp << 8));
		v = SFR_DATA_U16 & 0x3fff;
		return put_int();
	case SNV_IFSPEED:
		lp = row_to_lp();
		a = lp;
		nb = link_nibble();
		if (nb == 0xff)
			v = 0;
		else {
			a = nb;
			v = nibble_bps();
		}
		a = TAG_G32;
		return put_u32();
	case SNV_IFPHYS:
		p[0] = TAG_OCTS;
		p[1] = 6;
		memcpy(p + 2, uip_ethaddr.addr, 6);
		return 8;
	case SNV_IFADMIN:
		v = 1;   /* up; no admin state is modelled */
		return put_int();
	case SNV_IFOPER:
		lp = row_to_lp();
		a = lp;
		v = link_nibble() == 0xff ? 2 : 1;
		return put_int();
	case SNV_IFLASTCH:
		v = 0;   /* not tracked */
		a = TAG_TICKS;
		return put_u32();
	case SNV_IFINOCT:
		a = 0;
		read_stat_row();
		v = req.c_lo;
		a = TAG_C32;
		return put_u32();
	case SNV_IFINUCAST:
		a = 2;
		read_stat_row();
		v = req.c_lo;
		a = TAG_C32;
		return put_u32();
	case SNV_IFINDISC:
		/* TODO: the in/out halves of counter 8 are not hardware-verified;
		 * swap if a controlled drop test shows them reversed. */
		a = 8;
		read_stat_row();
		v = req.c_lo;
		a = TAG_C32;
		return put_u32();
	case SNV_IFINERR:
		a = STAT_COUNTER_ERR_PKTS;
		read_stat_row();
		v = req.c_hi;
		a = TAG_C32;
		return put_u32();
	case SNV_IFOUTOCT:
		a = 1;
		read_stat_row();
		v = req.c_lo;
		a = TAG_C32;
		return put_u32();
	case SNV_IFOUTUCAST:
		a = 5;
		read_stat_row();
		v = req.c_lo;
		a = TAG_C32;
		return put_u32();
	case SNV_IFOUTDISC:
		a = 8;
		read_stat_row();
		v = req.c_hi;
		a = TAG_C32;
		return put_u32();
	case SNV_IFOUTERR:
		a = STAT_COUNTER_ERR_PKTS;
		read_stat_row();
		v = req.c_lo;
		a = TAG_C32;
		return put_u32();
	case SNV_HCIINOCT:
		a = 0;
		read_stat_row();
		v = req.c_hi;
		v2 = req.c_lo;
		return put_c64();
	case SNV_IFHISPD:
		lp = row_to_lp();
		a = lp;
		nb = link_nibble();
		if (nb == 0xff)
			v = 0;
		else {
			a = nb;
			v = nibble_mbps();
		}
		a = TAG_G32;
		return put_u32();
	default: /* SNV_HCIOUTOCT */
		a = 1;
		read_stat_row();
		v = req.c_hi;
		v2 = req.c_lo;
		return put_c64();
	}
}

/* ---- tree walking ---- */

/* Lexicographic compare of the instance named by (leaf in a, row in b)
 * against the request OID at p2 (content length in c). Returns
 * instance-byte minus request-byte on the first difference: <0 instance
 * first, 0 equal, >0 request first. */
static int16_t cmp_inst(void)
{
	static __code const struct snmp_leaf * __xdata L;
	static __xdata uint8_t total, oi, i, byte;

	L = &leaves[a];
	total = OID_PREFIX_LEN + L->suffix_len + (L->port_col ? 1 : 0);
	oi = 0;
	for (i = 0; i < total; i++) {
		if (i < OID_PREFIX_LEN)
			byte = oid_prefix[i];
		else if (i < OID_PREFIX_LEN + L->suffix_len)
			byte = L->suffix[i - OID_PREFIX_LEN];
		else
			byte = b;
		if (oi >= c)
			return 1;   /* request ended first */
		if (byte != p2[oi])
			return (int16_t)byte - (int16_t)p2[oi];
		oi++;
	}
	return (oi < c) ? -1 : 0;
}

/* Collect the table rows sorted by ifIndex. */
static void build_rows(void)
{
	static __xdata uint8_t lp, idx, k;

	n_rows = 0;
	for (lp = machine.min_port; lp <= machine.max_port; lp++) {
		idx = machine.log_to_phys_port[lp];
		k = n_rows++;
		while (k && rows[k - 1] > idx) {
			rows[k] = rows[k - 1];
			k--;
		}
		rows[k] = idx;
	}
}

/* Exact match (qnext = 0) or first instance sorting strictly after it
 * (qnext = 1, a query that names an instance yields its successor), for
 * the OID at qptr (length qlen). Instances are visited in ascending OID
 * order because the leaf table is sorted and rows[] ascends.
 * Reports through res_leaf/res_row; returns 0 past the end. */
static uint8_t lookup(void)
{
	static __xdata uint8_t li, ri;

	if (qlen & 0x80)
		return 0;   /* past-the-tree marker */

	for (li = 0; li < N_LEAVES; li++) {
		if (!leaves[li].port_col) {
			p2 = qptr;
			c = qlen;
			a = li;
			b = 0;
			cv = cmp_inst();
			if (cv == 0 && !qnext) {
				res_leaf = li;
				res_row = 0;
				return 1;
			}
			if (cv > 0) {
				if (!qnext)
					return 0;   /* sorted: no exact match can follow */
				res_leaf = li;
				res_row = 0;
				return 1;
			}
			continue;
		}
		for (ri = 0; ri < n_rows; ri++) {
			p2 = qptr;
			c = qlen;
			a = li;
			b = rows[ri];
			cv = cmp_inst();
			if (cv == 0 && !qnext) {
				res_leaf = li;
				res_row = rows[ri];
				return 1;
			}
			if (cv > 0) {
				if (!qnext)
					return 0;
				res_leaf = li;
				res_row = rows[ri];
				return 1;
			}
		}
	}
	return 0;
}

/* ---- response assembly ---- */

static void emit_varbind(void)
{
	static __xdata uint8_t oid_len, val_len, total;

	p = vb_buf + 2;
	if (c) {
		/* An exception carries the REQUESTED OID, not the (absent)
		 * instance's: callers pass the varbind index in b and the
		 * request OID is echoed unchanged. The TLV header is written
		 * by hand here, so oid_len counts content bytes. */
		oid_len = req.oid_len[b] & 0x7f;
		vb_buf[2] = TAG_OID;
		vb_buf[3] = oid_len;
		memcpy(vb_buf + 4, req.oid[b], oid_len);
		p = vb_buf + 4 + oid_len;
		val_len = put_value();
		total = 4 + oid_len + val_len;
	} else {
		oid_len = put_oid_inst();   /* returns the full OID TLV size */
		p = vb_buf + 2 + oid_len;
		val_len = put_value();
		total = 2 + oid_len + val_len;
	}
	vb_buf[0] = TAG_SEQ;
	vb_buf[1] = total - 2;
	if (body_len + total > SNMP_MAX_BODY) {
		overflow = 1;
		return;
	}
	memcpy((__xdata uint8_t *)uip_appdata + SNMP_HDR_RESERVE + body_len, vb_buf, total);
	body_len += total;
}

/* One GETNEXT step for request varbind a: emits the successor and stores
 * it as the cursor so the next repetition continues from it. Returns 1
 * when endOfMibView was emitted. */
static uint8_t do_getnext(void)
{
	static __xdata uint8_t i;

	i = a;
	qptr = req.oid[i];
	qlen = req.oid_len[i];
	qnext = 1;
	if (!lookup()) {
		a = 0;
		b = i;   /* exception echoes the requested OID */
		c = EXC_ENDOFMIBVIEW;
		emit_varbind();
		req.oid_len[i] = OID_LEN_PAST | (req.oid_len[i] & 0x7f);
		return 1;
	}
	a = res_leaf;
	b = res_row;
	c = 0;
	emit_varbind();
	req.oid_len[i] = vb_buf[3];
	memcpy(req.oid[i], vb_buf + 4, vb_buf[3]);
	return 0;
}

/* Compose and send the response. vbl header length in a, content length in
 * w, error fields in b/c; d = 0 moves the body built above the header
 * reserve into place, d = 1 echoes the request's own varbind list (the
 * RFC 1157 error replies). */
static void finish(void)
{
	static __xdata uint8_t * __xdata q, * __xdata src;
	static __xdata uint8_t cl, hl, pdu_hl;
	static __xdata uint16_t n, vl, pdu_content, msg_content;

	vl = w;
	cl = strlen_x(state.community);
	/* PDU content: request-id + error-status + error-index TLVs and the
	 * varbind-list TLV (its tag byte included). */
	w = (uint16_t)req.reqid_len + 7 + a + vl;
	pdu_content = w;
	pdu_hl = ber_len_len();
	/* message content: version + community TLVs and the whole PDU TLV. */
	w = 6 + cl + pdu_hl + pdu_content;
	msg_content = w;
	/* Everything the header writer puts in front of the varbind-list
	 * content: msg tag+len, version, community, PDU tag+len, reqid,
	 * error-status, error-index, vbl tag+len. `a` counts the vbl
	 * length-field bytes only, in every caller. */
	hl = ber_len_len() + pdu_hl + req.reqid_len + a + cl + 14;

	if (d) {
		/* the request's own varbind list, content only: the header
		 * writer replaces its tag and length */
		src = (__xdata uint8_t *)uip_appdata + req.vbl_off + req.vbl_hl;
		n = vl;
	} else if (vl) {
		src = (__xdata uint8_t *)uip_appdata + SNMP_HDR_RESERVE;
		n = vl;
	} else {
		n = 0;
	}
	q = (__xdata uint8_t *)uip_appdata + hl;
	/* The shift only ever moves bytes toward the front, so a plain
	 * forward copy is overlap-safe. */
	while (n--)
		*q++ = *src++;

	q = (__xdata uint8_t *)uip_appdata;
	q[0] = TAG_SEQ;
	p = q + 1;
	w = msg_content;
	n = ber_put_len();
	q += 1 + n;
	q[0] = TAG_INT; q[1] = 0x01; q[2] = req.version;
	q += 3;
	q[0] = TAG_OCTS; q[1] = cl;
	memcpy(q + 2, state.community, cl);
	q += 2 + cl;
	q[0] = 0xA2;   /* GetResponse */
	p = q + 1;
	w = pdu_content;
	n = ber_put_len();
	q += 1 + n;
	memcpy(q, req.reqid, req.reqid_len);
	q += req.reqid_len;
	q[0] = TAG_INT; q[1] = 0x01; q[2] = b;
	q += 3;
	q[0] = TAG_INT; q[1] = 0x01; q[2] = c;
	q += 3;
	q[0] = TAG_SEQ;
	p = q + 1;
	w = vl;
	ber_put_len();

	uip_udp_send(hl + vl);
}

static void dispatch(void)
{
	static __xdata uint8_t i, nr, round;

	if (req.pdu_tag == PDU_BULK) {
		/* non-repeaters get one GETNEXT each, the repeaters walk until
		 * the frame is full or max-repetitions is reached; answering
		 * fewer than asked is what every real agent does. */
		nr = req.non_rep;
		if (nr > req.n_vb)
			nr = req.n_vb;
		for (i = 0; i < nr && !overflow; i++) {
			a = i;
			do_getnext();
		}
		for (round = 0; round < req.max_rep && !overflow; round++) {
			for (i = nr; i < req.n_vb && !overflow; i++) {
				a = i;
				do_getnext();
			}
		}
		w = body_len;
		a = ber_len_len();
		b = 0;
		c = 0;
		d = 0;
		finish();
		return;
	}

	if (req.version == 0) {
		/* v1 reports misses as noSuchName with the request's own
		 * varbind list echoed back - so the verdict must be known
		 * before the first varbind is written into the frame,
		 * because emitted bytes land on top of the request buffer
		 * the echo would copy from. */
		for (i = 0; i < req.n_vb; i++) {
			qptr = req.oid[i];
			qlen = req.oid_len[i];
			qnext = (req.pdu_tag == PDU_GETNEXT);
			if (!lookup()) {
				w = req.vbl_len;
				a = ber_len_len();
				b = SNMP_ERR_NOSUCHNAME;
				c = i + 1;
				d = 1;
				finish();
				return;
			}
		}
	}

	if (req.pdu_tag == PDU_GET) {
		for (i = 0; i < req.n_vb; i++) {
			qptr = req.oid[i];
			qlen = req.oid_len[i];
			qnext = 0;
			if (!lookup()) {
				a = 0;
				b = i;   /* exception echoes the requested OID */
				c = EXC_NOSUCHINST;
				emit_varbind();
			} else {
				a = res_leaf;
				b = res_row;
				c = 0;
				emit_varbind();
			}
		}
	} else {   /* PDU_GETNEXT */
		for (i = 0; i < req.n_vb; i++) {
			a = i;
			do_getnext();
		}
	}

	if (overflow) {
		/* The answer cannot fit into one frame and there is no IP
		 * fragmentation; RFC-wise the answer is tooBig with an empty
		 * varbind list. */
		overflow = 0;
		body_len = 0;
		a = 1;
		w = 0;
		b = SNMP_ERR_TOOBIG;
		c = 0;
		d = 0;
		finish();
		return;
	}
	w = body_len;
	a = ber_len_len();
	b = 0;
	c = 0;
	d = 0;
	finish();
}

/* ---- uIP glue ---- */

void snmp_callback(void) __banked
{
	static __xdata struct uip_udpip_hdr * __xdata hdr;

	if (!state.enabled || state.conn == 0 || uip_udp_conn == 0 ||
	    uip_udp_conn->lport != state.conn->lport)
		return;
	/* Only fresh packets; the periodic poll has nothing to send. */
	if (!(uip_flags & UIP_NEWDATA))
		return;

	build_rows();

	switch (parse_request()) {
	case 1:
		return;   /* malformed or foreign community: stay silent */
	case 2:
		a = 1;
		w = 0;
		b = SNMP_ERR_TOOBIG;
		c = 0;
		d = 0;
		finish();
		break;
	default:
		body_len = 0;
		overflow = 0;
		dispatch();
		break;
	}

	/* udp_send() takes the destination from uip_udp_conn, which cannot be
	 * changed after the appcall returns - and rewriting the listener would
	 * pin it to this client until reset. So point the stack at a scratch
	 * conn describing the requester and leave the wildcard listener
	 * untouched; the next request matches from anyone. */
	hdr = (struct uip_udpip_hdr *)&uip_buf[UIP_LLH_LEN];
	snmp_reply_conn.lport = state.conn->lport;
	snmp_reply_conn.ttl = state.conn->ttl;
	snmp_reply_conn.rport = hdr->srcport;
	uip_ipaddr_copy(snmp_reply_conn.ripaddr, hdr->srcipaddr);
	uip_udp_conn = &snmp_reply_conn;
}

/* ---- lifecycle ---- */

void snmp_init(void) __banked
{
	static __code const char * __xdata v;
	static __xdata uint8_t k;

	state.enabled = 0;
	state.conn = 0;
	memcpyc(state.community, SNMP_COMMUNITY_DEFAULT, sizeof(SNMP_COMMUNITY_DEFAULT));
	state.contact[0] = 0;
	state.location[0] = 0;

	/* sysDescr: "RTLPlayground <version> <machine>" */
	k = 0;
	memcpyc(snmp_sysdescr + k, "RTLPlayground ", 14);
	k += 14;
	v = VERSION_SW;
	while (*v)
		snmp_sysdescr[k++] = *v++;
	snmp_sysdescr[k++] = ' ';
	v = machine.machine_name;
	while (*v)
		snmp_sysdescr[k++] = *v++;
	snmp_sysdescr[k] = 0;
	sysdescr_len = k;
}

void snmp_start(void) __banked
{
	if (state.conn == 0) {
		/* ripaddr 0 / rport 0: match requests from any source. */
		state.conn = uip_udp_new((void __xdata *)0, 0);
		if (state.conn == 0) {
			print_string_newline_no_syslog("Failed to open UDP port 161");
			return;
		}
		uip_udp_bind(state.conn, HTONS(SNMP_UDP_PORT));
		state.enabled = 1;
		print_string_newline_no_syslog("Started SNMP agent on UDP port 161");
	} else {
		print_string_newline_no_syslog("SNMP agent is already running");
	}
}

void snmp_stop(void) __banked
{
	state.enabled = 0;
	if (state.conn != 0) {
		uip_udp_remove(state.conn);
		state.conn = 0;
		print_string_newline_no_syslog("Stopped SNMP agent");
	} else {
		print_string_newline_no_syslog("SNMP agent is not running");
	}
}

__xdata const char *snmp_arg;

/* One printable word, 1..SNMP_COMMUNITY_MAX bytes; candidate in snmp_arg. */
bool snmp_set_community(void) __banked
{
	static __xdata uint8_t n;
	static const __xdata char * __xdata q;

	q = snmp_arg;
	n = 0;
	while (*q) {
		if (*q < 0x21 || *q > 0x7e || n == SNMP_COMMUNITY_MAX)
			return false;
		q++;
		n++;
	}
	if (!n)
		return false;
	memcpy(state.community, snmp_arg, n);
	state.community[n] = 0;
	return true;
}

#else
/* The bridge image is a transitional installer; SNMP lives only in the
 * real 1MB firmware. */
typedef uint8_t snmp_bridge_empty_t;
#endif /* !BRIDGE_LAYOUT */
