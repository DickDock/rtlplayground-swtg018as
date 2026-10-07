/*
 * QoS, 802.3x flow control and priority flow control (802.1Qbb) for the
 * RTL8372/RTL8373.
 *
 * Console commands:
 *   qos show | trust dscp|1p|port | dscp <0-63> <pri> | 1p <pcp> <pri>
 *   qos port <port> <pri> | queue <pri> <queue> | sched <port> <queue> strict|<1-127>
 *   fc show | <port> auto|on|off | <port> set <0-3>
 *   fc thr glb|<0-3> <on> <off> | guar <0-3> <pages>
 *   pfc show | <port> on <prio,..> | <port> off | <port> map | <port> force <prio,..>|off
 *
 * PFC exists only on the two 10G MACs (chip ports 3 and 8). Which of the two
 * register copies belongs to which MAC is an assumption, see PFC_IDX().
 *
 * The parsing lives here and not in cmd_parser.c to keep the nearly full
 * BANK2 free; this module uses its own small argument helpers.
 */

// #define REGDBG

#include "rtl837x_common.h"
#include "rtl837x_sfr.h"
#include "rtl837x_regs.h"
#include "rtl837x_qos.h"
#include "cmd_parser.h"
#include "machine.h"

#ifdef BRIDGE_LAYOUT
#pragma codeseg BANK3
#pragma constseg BANK3
#else
#pragma codeseg BANK5
#pragma constseg BANK5
#endif

extern __xdata uint8_t sfr_data[4];
extern __xdata uint8_t cmd_words_len;
extern __xdata uint8_t cmd_words_b[];
extern __code const struct machine machine;

// Register copy used for PFC: chip port 8 uses the second one
#define PFC_IDX(port) ((port) == 8 ? 1 : 0)

// Result of the argument helpers
__xdata uint16_t qos_arg;
// Register value being read, modified and written
__xdata uint32_t qos_rv;
__xdata uint32_t qos_mask;
__xdata uint32_t qos_val;


/*
 * Returns 1 if the command word w is the string s
 */
static uint8_t arg_is(__xdata uint8_t w, __code const char * __xdata s)
{
	__xdata uint8_t * __xdata p;

	if (w >= cmd_words_len)
		return 0;
	p = &cmd_buffer[cmd_words_b[w]];
	while (*s) {
		if (*p++ != *s++)
			return 0;
	}
	if (*p == ' ' || *p == NUL)
		return 1;
	return 0;
}


/*
 * Parses command word w as a decimal or 0x-prefixed hex number into qos_arg
 * Returns 1 if it is a number not larger than max
 * At most 4 decimal or 3 hex digits, which covers all values used here and
 * keeps the arithmetic simple enough for SDCC not to spill to internal RAM.
 */
static uint8_t arg_num(__xdata uint8_t w, __xdata uint16_t max)
{
	__xdata uint8_t * __xdata p;
	__xdata uint8_t hex = 0;
	__xdata uint8_t digits = 4;
	__xdata uint8_t d;

	if (w >= cmd_words_len)
		return 0;
	p = &cmd_buffer[cmd_words_b[w]];
	if (p[0] == '0' && p[1] == 'x') {
		hex = 1;
		digits = 3;
		p += 2;
	}
	qos_arg = 0;
	if (*p == ' ' || *p == NUL)
		return 0;
	while (*p != ' ' && *p != NUL) {
		if (!digits--)
			return 0;
		d = *p++ - '0';
		if (hex) {
			if (d > 9) {
				d = (d | 0x20) - ('a' - '0');	// 'a'-'f' in either case
				if (d > 5)
					return 0;
				d += 10;
			}
			qos_arg <<= 4;
		} else {
			if (d > 9)
				return 0;
			qos_arg *= 10;
		}
		qos_arg += d;
	}
	if (qos_arg > max)
		return 0;
	return 1;
}


/*
 * Parses command word w as a physical port number into the chip port in qos_arg
 */
static uint8_t arg_port(__xdata uint8_t w)
{
	if (!arg_num(w, 9) || !qos_arg)
		return 0;
	qos_arg = machine.phys_to_log_port[qos_arg - 1];
	if (qos_arg < machine.min_port)
		return 0;
	if (qos_arg > machine.max_port)
		return 0;
	return 1;
}


/*
 * Parses command word w as a comma separated list of priorities 0-7 into a bit mask in qos_arg
 */
static uint8_t arg_prios(__xdata uint8_t w)
{
	__xdata uint8_t * __xdata p;

	if (w >= cmd_words_len)
		return 0;
	p = &cmd_buffer[cmd_words_b[w]];
	qos_arg = 0;
	while (1) {
		__xdata uint8_t d = *p++ - '0';
		if (d > 7)
			return 0;
		qos_arg |= 1 << d;
		if (*p == ' ' || *p == NUL)
			return 1;
		if (*p++ != ',')
			return 0;
	}
}


static void reg_rd(__xdata uint16_t a)
{
	reg_read_m(a);
	qos_rv = ((uint32_t)sfr_data[0] << 24) | ((uint32_t)sfr_data[1] << 16)
		| ((uint16_t)sfr_data[2] << 8) | sfr_data[3];
}


static void reg_wr(__xdata uint16_t a)
{
	sfr_data[0] = qos_rv >> 24;
	sfr_data[1] = qos_rv >> 16;
	sfr_data[2] = qos_rv >> 8;
	sfr_data[3] = qos_rv;
	reg_write_m(a);
}


static void field_wr(__xdata uint16_t a, __xdata uint8_t off, __xdata uint16_t mask, __xdata uint16_t v)
{
	reg_rd(a);
	// One step at a time: a variable 32 bit shift makes SDCC spill to internal RAM
	qos_mask = mask;
	qos_val = v & mask;
	while (off--) {
		qos_mask <<= 1;
		qos_val <<= 1;
	}
	qos_mask = ~qos_mask;
	qos_rv &= qos_mask;
	qos_rv |= qos_val;
	reg_wr(a);
}


static uint16_t field_rd(__xdata uint16_t a, __xdata uint8_t off, __xdata uint16_t mask)
{
	reg_rd(a);
	// One step at a time, see field_wr()
	while (off--)
		qos_rv >>= 1;
	return qos_rv & mask;
}


static void print_reg_value(__code const char * __xdata name, __xdata uint16_t a)
{
	print_string(name);
	reg_rd(a);
	print_long(qos_rv);
}


/*
 * Prints the ON/OFF page thresholds of a flow control threshold register
 */
static void print_thr(__xdata uint16_t a)
{
	reg_rd(a);
	print_string(" on "); itoa_short((qos_rv >> FC_THR_ON) & FC_THR_MASK);
	print_string(" off "); itoa_short(qos_rv & FC_THR_MASK);
}


static void usage(__code const char * __xdata msg)
{
	err_status = ERR_INVALID_ARGUMENT;
	print_string("Error: ");
	print_string(msg);
}


/*
 * QoS
 */
static void qos_show(void)
{
	__xdata uint8_t i;

	print_reg_value("Priority weights: ", RTL837X_PRI_WEIGHT);
	print_reg_value(" ", RTL837X_PRI_WEIGHT + 4);
	print_string("\nDSCP -> priority:");
	for (i = 0; i < 64; i++) {
		if (!(i & 7)) {
			write_char('\n');
			itoa(i); print_string(":\t");
		}
		itoa(field_rd(RTL837X_PRI_SEL_REMAP_DSCP + (i / 10) * 4, (i % 10) * 3, 0x7));
		write_char(' ');
	}
	print_string("\n802.1p -> priority: ");
	for (i = 0; i < 8; i++) {
		itoa(field_rd(RTL837X_DOT1Q_PRI_REMAP, i * 4, 0x7));
		write_char(' ');
	}
	print_string("\nPort\tPrio\tQueue of priority 0-7\tStrict queues\n");
	for (i = machine.min_port; i <= machine.max_port; i++) {
		print_phys_port(i); write_char('\t');
		itoa(field_rd(RTL837X_PORT_PRI, i * 3, 0x7)); write_char('\t');
		for (__xdata uint8_t p = 0; p < 8; p++) {
			itoa(field_rd(RTL837X_QID_TO_PRI + i * 4, p * 4, 0x7));
			write_char(' ');
		}
		write_char('\t');
		for (__xdata uint8_t q = 0; q < 8; q++) {
			if (field_rd(RTL837X_SCHED_PORT_Q_CTRL + i * 0x400 + q * 4, 0, SCHED_Q_STRICT)) {
				itoa(q); write_char(' ');
			}
		}
		write_char('\n');
	}
}


/*
 * Makes the given source the most important one for the priority decision
 * in both weight tables, the other sources keep a fixed lower order.
 */
static void qos_trust(__xdata uint32_t weights)
{
	qos_rv = weights;
	reg_wr(RTL837X_PRI_WEIGHT);
	reg_wr(RTL837X_PRI_WEIGHT + 4);
}


void qos_parse(void) __banked
{
	if (arg_is(1, "show") && cmd_words_len == 2) {
		qos_show();
		return;
	}
	if (arg_is(1, "trust") && cmd_words_len == 3) {
		if (arg_is(2, "dscp")) {
			qos_trust((16UL << PRI_WEIGHT_DSCP) | (8UL << PRI_WEIGHT_ACL) | (4UL << PRI_WEIGHT_DOT1Q)
				| (2UL << PRI_WEIGHT_SVLAN) | (1UL << PRI_WEIGHT_PORT));
			return;
		}
		if (arg_is(2, "1p")) {
			qos_trust((16UL << PRI_WEIGHT_DOT1Q) | (8UL << PRI_WEIGHT_ACL) | (4UL << PRI_WEIGHT_DSCP)
				| (2UL << PRI_WEIGHT_SVLAN) | (1UL << PRI_WEIGHT_PORT));
			return;
		}
		if (arg_is(2, "port")) {
			qos_trust((16UL << PRI_WEIGHT_PORT) | (8UL << PRI_WEIGHT_ACL) | (4UL << PRI_WEIGHT_DSCP)
				| (2UL << PRI_WEIGHT_DOT1Q) | (1UL << PRI_WEIGHT_SVLAN));
			return;
		}
		goto err;
	}
	if (cmd_words_len == 4 && arg_is(1, "dscp") && arg_num(2, 63)) {
		__xdata uint8_t dscp = qos_arg;
		if (!arg_num(3, 7))
			goto err;
		field_wr(RTL837X_PRI_SEL_REMAP_DSCP + (dscp / 10) * 4, (dscp % 10) * 3, 0x7, qos_arg);
		return;
	}
	if (cmd_words_len == 4 && arg_is(1, "1p") && arg_num(2, 7)) {
		__xdata uint8_t pcp = qos_arg;
		if (!arg_num(3, 7))
			goto err;
		field_wr(RTL837X_DOT1Q_PRI_REMAP, pcp * 4, 0x7, qos_arg);
		return;
	}
	if (cmd_words_len == 4 && arg_is(1, "port") && arg_port(2)) {
		__xdata uint8_t port = qos_arg;
		if (!arg_num(3, 7))
			goto err;
		field_wr(RTL837X_PORT_PRI, port * 3, 0x7, qos_arg);
		field_wr(RTL837X_PORT_PRI_DUP, port * 3, 0x7, qos_arg);
		return;
	}
	if (cmd_words_len == 4 && arg_is(1, "queue") && arg_num(2, 7)) {
		__xdata uint8_t pri = qos_arg;
		if (!arg_num(3, 7))
			goto err;
		for (__xdata uint8_t p = 0; p <= CPU_PORT; p++)
			field_wr(RTL837X_QID_TO_PRI + p * 4, pri * 4, 0x7, qos_arg);
		return;
	}
	if (cmd_words_len == 5 && arg_is(1, "sched") && arg_port(2)) {
		__xdata uint16_t a = RTL837X_SCHED_PORT_Q_CTRL + qos_arg * 0x400;
		if (!arg_num(3, 7))
			goto err;
		a += qos_arg * 4;
		if (arg_is(4, "strict")) {
			field_wr(a, 0, SCHED_Q_STRICT, SCHED_Q_STRICT);
			return;
		}
		if (!arg_num(4, SCHED_Q_WEIGHT_MASK) || !qos_arg)
			goto err;
		field_wr(a, 0, SCHED_Q_STRICT | SCHED_Q_WEIGHT_MASK, qos_arg);
		return;
	}
err:
	usage("qos show | trust dscp|1p|port | dscp <0-63> <0-7> | 1p <0-7> <0-7> | port <port> <0-7>\n"
		"\t| queue <prio 0-7> <queue 0-7> | sched <port> <queue 0-7> strict|<weight 1-127>\n");
}


/*
 * 802.3x flow control
 */
static void fc_show(void)
{
	__xdata uint8_t i;

	print_string("Global pages used "); itoa_short(field_rd(RTL837X_FC_GLB_PAGE_CNT, 0, FC_THR_MASK));
	print_string(" peak "); itoa_short(field_rd(RTL837X_FC_GLB_PAGE_PEAKCNT, 0, FC_THR_MASK));
	print_string(", threshold"); print_thr(RTL837X_FC_GLB_HI_THR);
	for (i = 0; i < 4; i++) {
		print_string("\nSet "); itoa(i); write_char(':');
		print_thr(RTL837X_FC_PORT_HI_THR + i * 4);
		print_string(" guarantee "); itoa_short(field_rd(RTL837X_FC_PORT_GUAR_THR + i * 4, 0, FC_THR_MASK));
	}
	print_string("\nPort\tPause\tForced\tSet\tPages\tPeak\n");
	for (i = machine.min_port; i <= machine.max_port; i++) {
		print_phys_port(i); write_char('\t');
		write_char(field_rd(RTL837X_MAC_TX_PAUSE_STS, i, 1) ? 'T' : '-');
		write_char(field_rd(RTL837X_MAC_RX_PAUSE_STS, i, 1) ? 'R' : '-');
		write_char('\t');
		reg_rd(RTL837X_MAC_FORCE_MODE_CTRL + i * 4);
		if (qos_rv & (1 << MAC_FORCE_FC_EN))
			print_string((qos_rv & (1 << MAC_FORCE_TX_PAUSE)) ? "on" : "off");
		else
			print_string("auto");
		write_char('\t');
		itoa(field_rd(RTL837X_FC_PORT_THR_SET_SEL, i * 2, 0x3)); write_char('\t');
		itoa_short(field_rd(RTL837X_FC_PORT_PAGE_CNT + i * 4, 0, FC_THR_MASK)); write_char('\t');
		itoa_short(field_rd(RTL837X_FC_PORT_PEAK_PAGE_CNT + i * 4, 0, FC_THR_MASK)); write_char('\n');
	}
}


/*
 * Writes the ON/OFF page thresholds from command words 3 and 4 to register a
 */
static uint8_t fc_thr_set(__xdata uint16_t a)
{
	__xdata uint16_t on;

	if (!arg_num(3, FC_THR_MASK))
		return 0;
	on = qos_arg;
	if (!arg_num(4, FC_THR_MASK))
		return 0;
	qos_rv = ((uint32_t)on << FC_THR_ON) | qos_arg;
	reg_wr(a);
	return 1;
}


void fc_parse(void) __banked
{
	if (arg_is(1, "show") && cmd_words_len == 2) {
		fc_show();
		return;
	}
	if (arg_is(1, "thr") && cmd_words_len == 5) {
		if (arg_is(2, "glb")) {
			if (fc_thr_set(RTL837X_FC_GLB_HI_THR))
				return;
		} else if (arg_num(2, 3) && fc_thr_set(RTL837X_FC_PORT_HI_THR + qos_arg * 4)) {
			return;
		}
		goto err;
	}
	if (arg_is(1, "guar") && cmd_words_len == 4 && arg_num(2, 3)) {
		__xdata uint16_t a = RTL837X_FC_PORT_GUAR_THR + qos_arg * 4;
		if (!arg_num(3, FC_THR_MASK))
			goto err;
		field_wr(a, 0, FC_THR_MASK, qos_arg);
		return;
	}
	if (cmd_words_len >= 3 && arg_port(1)) {
		__xdata uint8_t port = qos_arg;
		__xdata uint16_t a = RTL837X_MAC_FORCE_MODE_CTRL + port * 4;
		__xdata uint8_t v = 0;

		if (cmd_words_len == 4 && arg_is(2, "set") && arg_num(3, 3)) {
			field_wr(RTL837X_FC_PORT_THR_SET_SEL, port * 2, 0x3, qos_arg);
			return;
		}
		if (cmd_words_len != 3)
			goto err;
		// Bits 9-7: force enable, RX pause, TX pause
		if (arg_is(2, "on"))
			v = 0x7;
		else if (arg_is(2, "off"))
			v = 0x4;
		else if (!arg_is(2, "auto"))
			goto err;
		field_wr(a, MAC_FORCE_TX_PAUSE, 0x7, v);
		return;
	}
err:
	usage("fc show | <port> auto|on|off | <port> set <0-3> | thr glb|<0-3> <on> <off> | guar <0-3> <pages>\n");
}


/*
 * Priority flow control
 */
static void pfc_show_port(__xdata uint8_t port)
{
	__xdata uint8_t idx = PFC_IDX(port);

	print_string("Port "); print_phys_port(port);
	reg_rd(RTL837X_PFC_ENABLE_0 + idx * 4);
	print_string((qos_rv & (1UL << PFC_EN_PORT)) ? ": PFC on" : ": PFC off");
	print_string(", priorities 0x"); print_byte(qos_rv);
	print_string(" rx 0x"); print_byte(qos_rv >> PFC_EN_RX);
	print_string(" tx 0x"); print_byte(qos_rv >> PFC_EN_TX);
	print_string(", PG enable 0x"); print_byte(field_rd(RTL837X_PFC_ENABLE_1 + idx * 4, 0, 0xff));
	reg_rd(RTL837X_PFC_CTRL_1 + idx * 4);
	print_string("\n  PG congested 0x"); print_byte(qos_rv >> PFC_PG_ISCNG);
	print_string(", forced 0x"); print_byte(qos_rv >> PFC_FORCE_CNG_EN);
	print_string("/0x"); print_byte(qos_rv >> PFC_FORCE_CNG_VAL);
	print_reg_value("\n  ctrl0 ", RTL837X_PFC_CTRL_0 + idx * 4);
	print_reg_value(" ctrl2 ", RTL837X_PFC_CTRL_2 + idx * 4);
	print_reg_value("\n  prio->PG ", RTL837X_DPRI_2_PG_TABLE + idx * 4);
	print_reg_value(" pcp->PG ", RTL837X_PCP_2_PG_TABLE + idx * 4);
	print_reg_value(" PG->PEV ", RTL837X_PG_2_PEV_TABLE + idx * 8);
	print_reg_value(" ", RTL837X_PG_2_PEV_TABLE + idx * 8 + 4);
	print_string("\n  PG pages used/peak:");
	for (__xdata uint8_t pg = 0; pg < 8; pg++) {
		reg_rd(RTL837X_PFC_PORT_PG_RX_PAGE_CNT + idx * 0x20 + pg * 4);
		write_char(' ');
		itoa_short(qos_rv & FC_THR_MASK); write_char('/');
		itoa_short((qos_rv >> 16) & FC_THR_MASK);
	}
	write_char('\n');
}


/*
 * Maps priority n to PG n in the 8 x 3 bit table at a
 */
static void pfc_identity_map(__xdata uint16_t a)
{
	reg_rd(a);
	qos_rv = (qos_rv & 0xff000000UL) | PFC_IDENTITY_PG_MAP;
	reg_wr(a);
}


void pfc_parse(void) __banked
{
	if (arg_is(1, "show") && cmd_words_len == 2) {
		pfc_show_port(3);
		pfc_show_port(8);
		return;
	}
	if (cmd_words_len < 3 || !arg_port(1))
		goto err;
	if (qos_arg != 3 && qos_arg != 8) {
		usage("PFC is only available on the 10G ports\n");
		return;
	}
	__xdata uint8_t idx = PFC_IDX(qos_arg);

	if (cmd_words_len == 4 && arg_is(2, "on") && arg_prios(3)) {
		// Port enable, then the same priorities for RX, TX and PFC enable
		sfr_data[0] = 1 << (PFC_EN_PORT - 24);
		sfr_data[1] = qos_arg;
		sfr_data[2] = qos_arg;
		sfr_data[3] = qos_arg;
		reg_write_m(RTL837X_PFC_ENABLE_0 + idx * 4);
		// With the identity priority -> PG map from "pfc <port> map" the PG equals the priority
		field_wr(RTL837X_PFC_ENABLE_1 + idx * 4, 0, 0xff, qos_arg);
		return;
	}
	if (cmd_words_len == 3 && arg_is(2, "off")) {
		qos_rv = 0;
		reg_wr(RTL837X_PFC_ENABLE_0 + idx * 4);
		field_wr(RTL837X_PFC_ENABLE_1 + idx * 4, 0, 0xff, 0);
		return;
	}
	if (cmd_words_len == 3 && arg_is(2, "map")) {
		pfc_identity_map(RTL837X_DPRI_2_PG_TABLE + idx * 4);
		pfc_identity_map(RTL837X_PCP_2_PG_TABLE + idx * 4);
		return;
	}
	if (cmd_words_len == 4 && arg_is(2, "force")) {
		if (arg_is(3, "off"))
			qos_arg = 0;
		else if (!arg_prios(3))
			goto err;
		// Force the PGs in the mask congested, i.e. send PFC pause frames for them
		field_wr(RTL837X_PFC_CTRL_1 + idx * 4, PFC_FORCE_CNG_VAL, 0xff, qos_arg);
		field_wr(RTL837X_PFC_CTRL_1 + idx * 4, PFC_FORCE_CNG_EN, 0xff, qos_arg);
		return;
	}
err:
	usage("pfc show | <port> on <prio,..> | <port> off | <port> map | <port> force <prio,..>|off\n");
}
