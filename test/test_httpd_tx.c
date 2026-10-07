/*
 * Host-side bench for the httpd transmit path.
 *
 * Compiles the UNMODIFIED httpd/httpd.c and uip/uip.c and drives them through a
 * real handshake and a real GET from a client that moves its receive window.
 * Everything below the two modules - flash, console, JSON pages - is mocked
 * here, so what the bench observes is the byte stream the firmware would put on
 * the wire.
 *
 * The file served out of the simulated flash carries a position-dependent
 * pattern, so a duplicated or skipped range shows up as a mismatch at a known
 * offset instead of an anonymous "content differs".
 *
 * Run: make -C test    (exit code 0 = all scenarios pass)
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Some hosts ship these in <sys/_endian.h>, and they assign to their argument;
 * uip.h refuses to be included next to them. The firmware definitions are the
 * ones this bench needs, so the host macros go first. */
#undef HTONS
#undef NTOHS

#include "httpd.h"
#include "uip.h"
#include "rtl837x_common.h"
#include "rtl837x_regs.h"
#include "rtl837x_flash.h"
#include "page_impl.h"
#include "html_data.h"

/* Private to uip.c, and the client needs them to build segments. */
#define TCP_FIN 0x01
#define TCP_SYN 0x02
#define TCP_RST 0x04
#define TCP_PSH 0x08
#define TCP_ACK 0x10

/* Private HTTP states; the bench observes the real application's transitions. */
#define TSTATE_NONE 0
#define TSTATE_TX 1
#define TSTATE_ACKED 2
#define TSTATE_CLOSED 3
#define TSTATE_POSTBODY 6

#define TCPH		((struct uip_tcpip_hdr *)&uip_buf[UIP_LLH_LEN])

#define MSS_FULL	1460
#define SMALL_WINDOW	600

/* httpd.c serves this one file without a session, which keeps the bench clear
 * of the login machinery: what is under test is the transmit path. */
#define FILE_START	FDATA_START_login_html
#define FILE_NAME	"/login.html"
#define FILE_LEN	6000
#define STREAM_MAX	16384

static int failures;
static int verbose;

#define CHECK(cond, name) do { \
	if (cond) printf("PASS  %s\n", name); \
	else { printf("FAIL  %s\n", name); failures++; } \
} while (0)

static uint8_t pattern(uint32_t addr)
{
	return (uint8_t)((addr * 7u) + (addr >> 8));
}

/* ---- firmware environment below httpd.c --------------------------------- */

volatile uint8_t sfr_data[4];
volatile uint32_t ticks;
uint8_t cmd_capture;
uint8_t err_status;
const uint8_t * const hex = (const uint8_t *)"0123456789abcdef";
uint16_t crc_value;
const uint8_t * const HTTP_RESPONCE_TXT = (const uint8_t *)"HTTP/1.1 200 OK\r\n\r\n";
uint32_t flash_size = 0x200000; /* 2 MB part: Web upload needs staging + image */
uint8_t flash_buf[FLASH_BUF_SIZE];
uint8_t rx_headers[16];
struct flash_region_t flash_region;

const char * const mime_strings[] = { "text/html", "image/svg+xml", "image/x-icon",
			 "image/png", "text/javascript", "text/css", "text/plain" };

const struct f_data f_data[] = {
	{ FILE_NAME, FILE_START, FILE_LEN, mime_HTML, 0 },
	{ 0, 0, 0, mime_HTML, 0 },
};

void flash_read_bulk(uint8_t *dst)
{
	for (uint16_t i = 0; i < flash_region.len; i++)
		dst[i] = pattern(flash_region.addr + i);
}

void flash_init(uint8_t enable_dio) { (void)enable_dio; }
void flash_sector_erase(void) { }
void flash_write_bytes(uint8_t *ptr) { (void)ptr; }
const char *get_flash_size_str(void) { return "512 kB"; }
void crc16_bank1(uint8_t *v) { (void)v; }
void reset_chip(void) { }
void delay(uint16_t t) { (void)t; }
void write_char(char c) { (void)c; }
void write_char_no_syslog(char c) { (void)c; }
void print_string(const char *p) { (void)p; }
void print_string_newline_no_syslog(const char *p) { (void)p; }
void set_sys_led_state(uint8_t state) { (void)state; }
void cmd_parser(void) { }
void execute_config(void) { }
void execute_commands(uint8_t *p) { (void)p; }
void clear_command_history(void) { }
void udp_callbacks(void) { }
void tcpip_output(void) { }
void get_random_32(void) { }
void read_reg_timer(uint32_t *tmr) { *tmr = 0; }

/* uip-conf.h asks uIP not to define the packet buffer: on the switch it lives
 * at a fixed XDATA address, so the bench provides the storage itself. */
u8_t uip_buf[UIP_BUFSIZE + 2];

uint16_t strlen_x(const char *s) { return (uint16_t)strlen(s); }

uint16_t strtox(uint8_t *dst, const char *s)
{
	uint16_t n = 0;

	while (s[n]) { dst[n] = (uint8_t)s[n]; n++; }
	return n;
}

void memcpyc(uint8_t *dst, const uint8_t *src, uint16_t len) { memcpy(dst, src, len); }

bool strstart(const uint8_t *a, const uint8_t *b)
{
	while (*b) { if (*a++ != *b++) return false; }
	return true;
}

bool strstart_x(const uint8_t *a, const uint8_t *b) { return strstart(a, b); }

bool send_counters(uint8_t phys_port) { (void)phys_port; return false; }
void send_status(void) { }
void send_vlan(uint16_t vlan) { (void)vlan; }
void send_basic_info(void) { }
void send_bandwidth(void) { }
void send_storm(void) { }
void send_eee(void) { }
void send_l2(uint16_t idx) { (void)idx; }
void l2_delete(uint16_t idx) { (void)idx; }
void send_mirror(void) { }
void send_mtu(void) { }
void send_config(void) { }
void send_cmd_log(void) { }
void send_lacp(void) { }
void send_lag(void) { }
void send_stp(void) { }
void send_stp_counters(void) { }
void send_vlanlist(void) { }

extern uint8_t authenticated;

/* uip.c defines the listen table but no header declares it; the bench reads it
 * to confirm the port httpd_init() asked for is the one uIP is watching. */
extern u16_t uip_listenports[UIP_LISTENPORTS];
extern u16_t uip_slen;

/* ---- the simulated client ----------------------------------------------- */

static uint32_t cli_seq;	/* next sequence number we send */
static uint32_t cli_rcv_nxt;	/* next sequence number we expect */
static uint16_t cli_window;	/* what we advertise */
static uint16_t cli_port;
static unsigned tx_packets, tx_fins;
static uint8_t tx_flags;
static uint32_t tx_seq;

static uint8_t stream[STREAM_MAX];	/* bytes accepted from the server */
static int stream_len;

static uint8_t last_tx[MSS_FULL + 64];	/* payload of the last server segment */
static int last_tx_len;

static uint16_t hton16(uint16_t v)
{
	return (uint16_t)((v << 8) | (v >> 8));
}

static void wr32(uint8_t *p, uint32_t v)
{
	p[0] = v >> 24; p[1] = v >> 16; p[2] = v >> 8; p[3] = v;
}

static uint32_t rd32(const uint8_t *p)
{
	return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) |
	       ((uint32_t)p[2] << 8) | p[3];
}

static void trace(const char *tag)
{
	if (!verbose)
		return;
	printf("      [%-8s] uip_len=%-5u flags=0x%02x seq=%-6u ack=%-6u | conn: state=0x%02x len=%-5u mss=%-5u tstate=%u\n",
	       tag, uip_len,
	       uip_len ? TCPH->flags : 0,
	       uip_len ? rd32(TCPH->seqno) : 0,
	       uip_len ? rd32(TCPH->ackno) : 0,
	       uip_conns[0].tcpstateflags, uip_conns[0].len, uip_conns[0].mss,
	       uip_conns[0].appstate.tstate);
}

/* Takes in one outgoing segment, if uIP produced one. */
static int harvest(void)
{
	uint8_t *payload;
	uint32_t seq;
	int plen, hlen;

	if (uip_len == 0)
		return -1;

	seq = rd32(TCPH->seqno);
	tx_packets++;
	tx_flags = TCPH->flags;
	tx_seq = seq;
	if (tx_flags & TCP_FIN)
		tx_fins++;
	/* The SYNACK carries the MSS option, so the header is not always 20 B. */
	hlen = (TCPH->tcpoffset >> 4) * 4;
	payload = &uip_buf[UIP_LLH_LEN + 20 + hlen];
	plen = (int)uip_len - 20 - hlen;
	if (plen < 0)
		plen = 0;

	if (plen > 0) {
		last_tx_len = plen > (int)sizeof(last_tx) ? (int)sizeof(last_tx) : plen;
		memcpy(last_tx, payload, last_tx_len);

		/* A real client keeps what continues the stream and drops the
		 * rest, so bytes sent twice under new sequence numbers land in
		 * the file just as they would in a browser. */
		if (seq == cli_rcv_nxt) {
			if (stream_len + plen <= STREAM_MAX) {
				memcpy(stream + stream_len, payload, plen);
				stream_len += plen;
			}
			cli_rcv_nxt += plen;
		}
		if (verbose)
			printf("      server -> %d B, seq %u\n", plen, seq);
	}
	if (TCPH->flags & TCP_SYN)
		cli_rcv_nxt = seq + 1;

	uip_len = 0;
	return plen;
}

static void client_send(uint8_t flags, const char *payload, int plen)
{
	int hlen = 20;

	/* A SYN carries the MSS option, as every real client does: uIP takes the
	 * connection MSS from it, and without one the server has nothing to send
	 * with. */
	if (flags & TCP_SYN)
		hlen = 24;

	memset(uip_buf, 0, UIP_LLH_LEN + 20 + hlen + (plen > 0 ? plen : 0));
	TCPH->vhl = 0x45;
	TCPH->tos = 0;
	TCPH->len[0] = (uint8_t)((20 + hlen + plen) >> 8);
	TCPH->len[1] = (uint8_t)((20 + hlen + plen) & 0xff);
	TCPH->ttl = 64;
	TCPH->proto = UIP_PROTO_TCP;
	TCPH->ipchksum = 0;
	TCPH->srcipaddr[0] = hton16(0x0a00); TCPH->srcipaddr[1] = hton16(0x0002);
	TCPH->destipaddr[0] = hton16(0x0a00); TCPH->destipaddr[1] = hton16(0x0001);
	TCPH->srcport = hton16(cli_port);
	TCPH->destport = hton16(80);
	wr32(TCPH->seqno, cli_seq);
	wr32(TCPH->ackno, cli_rcv_nxt);
	TCPH->tcpoffset = (uint8_t)((hlen / 4) << 4);
	TCPH->flags = flags;
	TCPH->wnd[0] = (uint8_t)(cli_window >> 8);
	TCPH->wnd[1] = (uint8_t)(cli_window & 0xff);
	TCPH->tcpchksum = 0;

	if (hlen == 24) {
		uint8_t *opt = &uip_buf[UIP_LLH_LEN + 40];

		opt[0] = 2; opt[1] = 4;			/* kind = MSS, length 4 */
		opt[2] = MSS_FULL >> 8; opt[3] = MSS_FULL & 0xff;
	}
	if (plen > 0)
		memcpy(&uip_buf[UIP_LLH_LEN + 20 + hlen], payload, plen);

	uip_len = 20 + hlen + plen;
	uip_input();
	trace("input");
	cli_seq += plen;
	if (flags & (TCP_SYN | TCP_FIN))
		cli_seq++;
	harvest();
}

static void client_ack(uint16_t window)
{
	cli_window = window;
	client_send(TCP_ACK, NULL, 0);
}

static void run_periodic(int rounds)
{
	for (int i = 0; i < rounds; i++) {
		uip_periodic(0);
		trace("timer");
		harvest();
	}
}

/* The 5 ms path must exercise UIP_POLL_REQUEST, not masquerade as a timer. */
static void run_poll(int rounds)
{
	for (int i = 0; i < rounds; i++) {
		uip_poll_conn(&uip_conns[0]);
		trace("poll");
		harvest();
	}
}

static void session_start(uint16_t window)
{
	uip_init();
	httpd_init();
	authenticated = 1;

	cli_seq = 1000;
	cli_rcv_nxt = 0;
	cli_window = window;
	cli_port = 40000;
	stream_len = 0;
	last_tx_len = 0;
	tx_packets = tx_fins = 0;
	tx_flags = 0;
	ticks = 0;

	client_send(TCP_SYN, NULL, 0);
	client_ack(window);
}

static void request_file(uint16_t window)
{
	static const char get[] = "GET " FILE_NAME " HTTP/1.1\r\nHost: sw\r\n\r\n";

	cli_window = window;
	client_send(TCP_ACK | TCP_PSH, get, (int)strlen(get));
}

/* Drains the response, acknowledging every segment with the given window. */
static void drain(uint16_t window)
{
	for (int i = 0; i < 20 && stream_len < STREAM_MAX; i++) {
		client_ack(window);
		run_poll(1);
	}
}

static int body_offset(void)
{
	for (int i = 0; i + 4 <= stream_len; i++)
		if (!memcmp(stream + i, "\r\n\r\n", 4))
			return i + 4;
	return -1;
}

/* Offset of the first body byte that is not the one the file holds there, or
 * -1 when the body matches, or -2 when no header ever arrived. */
static int first_body_mismatch(void)
{
	int off = body_offset();

	if (off < 0)
		return -2;
	for (int i = 0; i < FILE_LEN && off + i < stream_len; i++)
		if (stream[off + i] != pattern(FILE_START + i))
			return i;
	return -1;
}

static void report(const char *tag)
{
	if (verbose)
		printf("      %s: header %d B, stream %d B, first mismatch %d\n",
		       tag, body_offset(), stream_len, first_body_mismatch());
}

/* ---- scenarios ---------------------------------------------------------- */

/* Instrument check: with a window that never moves, the MSS at ACK time and the
 * length sent earlier are the same number, so the file must arrive intact. If
 * this one fails, the bench is wrong - not the firmware. */
static void scenario_steady_window(void)
{
	session_start(MSS_FULL);
	if (verbose)
		printf("      listen port=0x%04x, initial mss=%u\n",
		       uip_listenports[0], uip_conns[0].initialmss);
	request_file(MSS_FULL);
	drain(MSS_FULL);
	report("steady");

	CHECK(body_offset() >= 0, "control: response carries an HTTP header");
	CHECK(stream_len >= body_offset() + FILE_LEN,
	      "control: the whole file arrives");
	CHECK(first_body_mismatch() == -1,
	      "control: file content without duplicates or gaps");
}

/* The client stops draining, so the window in the ACK is smaller than the
 * segment that ACK covers. */
static void scenario_shrinking_window(void)
{
	session_start(MSS_FULL);
	request_file(MSS_FULL);
	drain(SMALL_WINDOW);
	report("shrinking");

	CHECK(body_offset() >= 0,
	      "shrinking window: response carries an HTTP header");
	CHECK(stream_len >= body_offset() + FILE_LEN,
	      "shrinking window: the whole file arrives");
	CHECK(first_body_mismatch() == -1,
	      "shrinking window: file content without duplicates or gaps");
}

/* The client catches up, so the window in the ACK is larger than the segment
 * that ACK covers. */
static void scenario_growing_window(void)
{
	session_start(SMALL_WINDOW);
	request_file(SMALL_WINDOW);
	drain(MSS_FULL);
	report("growing");

	CHECK(stream_len >= body_offset() + FILE_LEN,
	      "growing window: the whole file arrives");
	CHECK(first_body_mismatch() == -1,
	      "growing window: file content without duplicates or gaps");
}

/* A segment is lost, a window update shrinks the window while it is still
 * unacknowledged, and the retransmission timer fires. */
static void scenario_rexmit_after_shrink(void)
{
	uint8_t original[MSS_FULL + 64];
	int original_len, same = 1;

	session_start(MSS_FULL);
	request_file(MSS_FULL);

	original_len = last_tx_len;
	memcpy(original, last_tx, original_len);

	/* The segment never arrived: take it back out of the client's stream and
	 * send a pure window update, which acknowledges nothing. */
	if (original_len > 0 && stream_len >= original_len) {
		stream_len -= original_len;
		cli_rcv_nxt -= original_len;
	}
	cli_window = SMALL_WINDOW;
	client_send(TCP_ACK, NULL, 0);

	memset(&uip_buf[UIP_LLH_LEN + 40], 0xaa, MSS_FULL);

	last_tx_len = 0;
	run_periodic(UIP_RTO + 2);

	if (last_tx_len != original_len || memcmp(last_tx, original, original_len))
		same = 0;

	if (verbose)
		printf("      first %d B, retransmitted %d B\n",
		       original_len, last_tx_len);

	CHECK(original_len > 0, "retransmission: the first segment went out");
	CHECK(same, "retransmission: the repeat carries the same bytes");
}

static void scenario_poll_outstanding(void)
{
	uint8_t timer, nrtx;
	unsigned packets;
	int len;

	session_start(MSS_FULL);
	request_file(MSS_FULL);
	timer = uip_conns[0].timer;
	nrtx = uip_conns[0].nrtx;
	len = uip_conns[0].len;
	packets = tx_packets;
	/* Leave both lengths dirty as they can be after RX or UDP processing. */
	uip_len = 80;
	uip_slen = 40;
	run_poll(400);
	CHECK(len > 0 && uip_conns[0].len == len,
	      "fast poll: outstanding payload remains outstanding");
	CHECK(uip_conns[0].timer == timer && uip_conns[0].nrtx == nrtx,
	      "fast poll: 400 polls do not consume the retransmission timer");
	CHECK(tx_packets == packets,
	      "fast poll: outstanding data is not retransmitted");
	CHECK(uip_len == 0 && uip_slen == 0,
	      "fast poll: outstanding branch clears both stale lengths");
}

static void scenario_poll_no_output(void)
{
	unsigned packets;

	session_start(MSS_FULL);
	client_ack(MSS_FULL); /* establish a zero idle-age baseline */
	packets = tx_packets;
	uip_len = 90;
	uip_slen = 24;
	memset(&uip_buf[UIP_LLH_LEN + 40], 0xaa, 24);
	run_poll(1);
	CHECK(tx_packets == packets && uip_conns[0].len == 0,
	      "fast poll: silent httpd cannot send stale payload");
	CHECK(uip_len == 0 && uip_slen == 0,
	      "fast poll: no-output appcall clears both lengths");
}

static void scenario_rexmit_fourth_pulse(void)
{
	uip_stats_t rexmit;
	unsigned packets;

	/* Do not ACK the SYNACK: its original RTO is exactly UIP_RTO. HTTP data
	 * has an RTT-derived RTO after the handshake, tested separately below. */
	session_start(MSS_FULL);
	client_send(TCP_RST, NULL, 0);
	cli_seq = 2000;
	cli_rcv_nxt = 0;
	client_send(TCP_SYN, NULL, 0);
	rexmit = uip_stat.tcp.rexmit;
	packets = tx_packets;
	CHECK(UIP_RTO == 3 && uip_conns[0].timer == 3,
	      "RTO: classic initial timer remains three slow pulses");
	for (int i = 0; i < 3; i++) {
		run_poll(99);
		run_periodic(1);
	}
	CHECK(tx_packets == packets && uip_stat.tcp.rexmit == rexmit,
	      "RTO: no retransmission on the first three 0.5 s pulses");
	CHECK(uip_conns[0].timer == 0,
	      "RTO: the third slow pulse reaches zero");
	run_poll(99);
	run_periodic(1);
	CHECK(tx_packets == packets + 1 && uip_stat.tcp.rexmit == rexmit + 1 &&
	      tx_flags == (TCP_SYN | TCP_ACK) && uip_conns[0].nrtx == 1,
	      "RTO: first SYNACK retransmission is the fourth slow pulse");
}

static void scenario_ack_pipeline_and_fin(void)
{
	int off, previous;
	uint8_t rto;

	session_start(MSS_FULL);
	request_file(MSS_FULL);
	off = body_offset();
	previous = stream_len;
	client_ack(MSS_FULL);
	CHECK(stream_len > previous && uip_conns[0].len > 0,
	      "ACK pipeline: the ACK itself sends the next HTTP segment");
	for (int i = 0; i < 20 && stream_len < off + FILE_LEN; i++)
		client_ack(MSS_FULL);
	CHECK(off >= 0 && stream_len == off + FILE_LEN && first_body_mismatch() == -1,
	      "ACK pipeline: whole file arrives without any timer or poll");
	client_ack(MSS_FULL);
	CHECK(uip_conns[0].appstate.tstate == TSTATE_ACKED && uip_conns[0].len == 0 &&
	      tx_fins == 0,
	      "FIN: final payload ACK leaves HTTP ready to close");
	rto = uip_conns[0].rto;
	run_poll(1);
	CHECK(tx_fins == 1 && tx_flags == (TCP_FIN | TCP_ACK) &&
	      uip_conns[0].tcpstateflags == UIP_FIN_WAIT_1,
	      "FIN: the next fast poll sends FIN, not a slow-timer delay");
	CHECK(uip_conns[0].len == 1 && uip_conns[0].timer == rto,
	      "FIN: legitimate appsend loads RTO on the fast poll");
}

static void scenario_idle_timeout(void)
{
	unsigned packets;

	session_start(MSS_FULL);
	CHECK(uip_conns[0].timer == 0,
	      "idle: a completed handshake starts idle age at zero");
	/* A valid packet starts a fresh idle interval. Polling must not reset it. */
	client_ack(MSS_FULL);
	packets = tx_packets;
	for (int i = 0; i < 59; i++) {
		run_poll(99);
		run_periodic(1);
	}
	CHECK(uip_conns[0].tcpstateflags == UIP_ESTABLISHED &&
	      uip_conns[0].timer == 29 && tx_packets == packets,
	      "idle: 59 slow pulses / 29.5 s keep the connection open");
	run_poll(99);
	run_periodic(1);
	CHECK(uip_conns[0].tcpstateflags == UIP_CLOSED && tx_packets == packets + 1 &&
	      tx_flags == (TCP_RST | TCP_ACK) &&
	      uip_conns[0].appstate.tstate == TSTATE_CLOSED,
	      "idle: the 60th slow pulse / 30 s aborts the silent peer");
}

static void scenario_init_idle_prescaler(void)
{
	/* End on an odd pulse, then re-init: XDATA startup does not zero these
	 * static counters on the target, and previous sessions must not leak in. */
	uip_init();
	run_periodic(1);
	session_start(MSS_FULL);
	client_ack(MSS_FULL);
	run_periodic(1);
	CHECK(uip_conns[0].timer == 0,
	      "init: first slow pulse after uip_init does not age idle state");
	run_periodic(1);
	CHECK(uip_conns[0].timer == 1,
	      "init: idle prescaler restarts with two slow pulses per second");
}

static void enter_time_wait(void)
{
	session_start(MSS_FULL);
	request_file(MSS_FULL);
	drain(MSS_FULL);
	/* The simulated client has now received FIN; acknowledge it and close. */
	cli_rcv_nxt = tx_seq + 1;
	client_send(TCP_ACK | TCP_FIN, NULL, 0);
}

static void scenario_time_wait(void)
{
	unsigned packets;

	CHECK(UIP_CONNS == 1 && UIP_TIME_WAIT_TIMEOUT == 120,
	      "TIME_WAIT: single slot and classic 120 slow-pulse limit stay unchanged");
	enter_time_wait();
	CHECK(uip_conns[0].tcpstateflags == UIP_TIME_WAIT,
	      "TIME_WAIT: real HTTP FIN exchange enters TIME_WAIT");
	packets = tx_packets;
	run_poll(1000);
	CHECK(uip_conns[0].timer == 0 && tx_packets == packets,
	      "TIME_WAIT: fast polling does not age or transmit");
	run_periodic(119);
	CHECK(uip_conns[0].tcpstateflags == UIP_TIME_WAIT && uip_conns[0].timer == 119,
	      "TIME_WAIT: 119 slow pulses / 59.5 s keep the state");
	run_periodic(1);
	CHECK(uip_conns[0].tcpstateflags == UIP_CLOSED,
	      "TIME_WAIT: 120 slow pulses / 60 s release the slot");

	enter_time_wait();
	run_periodic(1);
	packets = tx_packets;
	cli_port++; /* A browser opens a new four-tuple, not the old socket. */
	cli_seq = 9000;
	cli_rcv_nxt = 0;
	stream_len = last_tx_len = 0;
	client_send(TCP_SYN, NULL, 0);
	CHECK(tx_packets == packets + 1 && tx_flags == (TCP_SYN | TCP_ACK) &&
	      uip_conns[0].tcpstateflags == UIP_SYN_RCVD,
	      "TIME_WAIT: a new SYN immediately reuses the single occupied slot");
	client_ack(MSS_FULL);
	request_file(MSS_FULL);
	drain(MSS_FULL);
	CHECK(first_body_mismatch() == -1 && stream_len == body_offset() + FILE_LEN,
	      "TIME_WAIT: the reused slot serves a complete new HTTP response");
}

static void scenario_fin_wait_timeout(void)
{
	unsigned packets;

	session_start(MSS_FULL);
	request_file(MSS_FULL);
	drain(MSS_FULL);
	CHECK(tx_flags == (TCP_FIN | TCP_ACK) &&
	      uip_conns[0].tcpstateflags == UIP_FIN_WAIT_1,
	      "FIN_WAIT_2: real HTTP response ends in a fast-poll FIN");
	/* A half-closing peer ACKs our FIN but never sends its own FIN. */
	cli_rcv_nxt = tx_seq + 1;
	client_ack(MSS_FULL);
	CHECK(uip_conns[0].tcpstateflags == UIP_FIN_WAIT_2 && uip_conns[0].len == 0 &&
	      uip_conns[0].timer == 0,
	      "FIN_WAIT_2: ACK-only starts the half-close age at zero");
	packets = tx_packets;
	run_poll(6000);
	CHECK(uip_conns[0].timer == 0 && tx_packets == packets,
	      "FIN_WAIT_2: fast polls neither age nor retransmit the half-close");
	run_periodic(59);
	CHECK(uip_conns[0].tcpstateflags == UIP_FIN_WAIT_2 && uip_conns[0].timer == 59,
	      "FIN_WAIT_2: 59 slow pulses / 29.5 s still permit the peer's FIN");
	run_periodic(1);
	CHECK(uip_conns[0].tcpstateflags == UIP_CLOSED && tx_packets == packets,
	      "FIN_WAIT_2: the 60th slow pulse / 30 s releases the silent slot");
	cli_port++;
	cli_seq = 9500;
	cli_rcv_nxt = 0;
	stream_len = last_tx_len = 0;
	client_send(TCP_SYN, NULL, 0);
	CHECK(tx_packets == packets + 1 && tx_flags == (TCP_SYN | TCP_ACK) &&
	      uip_conns[0].tcpstateflags == UIP_SYN_RCVD,
	      "FIN_WAIT_2: the released slot accepts a new SYN");
	client_ack(MSS_FULL);
	request_file(MSS_FULL);
	drain(MSS_FULL);
	CHECK(first_body_mismatch() == -1 && stream_len == body_offset() + FILE_LEN,
	      "FIN_WAIT_2: a new connection serves the complete HTTP response");
}

static void request_partial_post(void)
{
	static const char post[] = "POST /login HTTP/1.1\r\nHost: sw\r\n"
		"Content-Type: application/x-www-form-urlencoded\r\n"
		"Content-Length: 8\r\n\r\np";

	client_send(TCP_ACK | TCP_PSH, post, (int)strlen(post));
}

static void scenario_post_timeout(void)
{
	unsigned packets;

	session_start(MSS_FULL);
	ticks = 100;
	request_partial_post();
	CHECK(uip_conns[0].appstate.tstate == TSTATE_POSTBODY && uip_conns[0].len == 0,
	      "POST: a partial login body waits without outstanding payload");
	packets = tx_packets;
	run_poll(4000);
	CHECK(uip_conns[0].appstate.tstate == TSTATE_POSTBODY && tx_packets == packets,
	      "POST: repeated fast polls alone do not advance wall-clock timeout");
	ticks += 5 * SYS_TICK_HZ;
	run_poll(1);
	CHECK(uip_conns[0].tcpstateflags == UIP_ESTABLISHED && tx_packets == packets,
	      "POST: timeout keeps the existing strict greater-than-five-seconds boundary");
	ticks++;
	run_poll(1);
	CHECK(uip_conns[0].tcpstateflags == UIP_CLOSED && tx_flags == (TCP_RST | TCP_ACK),
	      "POST: first fast poll after five seconds aborts the incomplete body");

	session_start(MSS_FULL);
	ticks = 0xfffe;
	request_partial_post();
	packets = tx_packets;
	ticks += 2;
	run_poll(1);
	CHECK(uip_conns[0].appstate.tstate == TSTATE_POSTBODY && tx_packets == packets,
	      "POST: 16-bit tick wrap does not trigger an early timeout");
	ticks += 5 * SYS_TICK_HZ - 2;
	run_poll(1);
	CHECK(uip_conns[0].tcpstateflags == UIP_ESTABLISHED && tx_packets == packets,
	      "POST: five-second boundary also holds across tick wrap");
	ticks++;
	run_poll(1);
	CHECK(uip_conns[0].tcpstateflags == UIP_CLOSED && tx_flags == (TCP_RST | TCP_ACK),
	      "POST: wrapped timeout aborts on the first tick past five seconds");
}

static void scenario_bad_l4_checksum(void)
{
	uip_stats_t chkerr_before;
	uint32_t seq_before;
	int len_before;

	session_start(MSS_FULL);

	chkerr_before = uip_stat.tcp.chkerr;
	len_before = stream_len;
	seq_before = cli_seq;

	rx_headers[1] = RX_TAG_L4_CSUM_BAD;
	request_file(MSS_FULL);
	rx_headers[1] = 0;
	cli_seq = seq_before;

	CHECK(uip_stat.tcp.chkerr == chkerr_before + 1,
	      "bad checksum: the segment is counted as a checksum error");
	CHECK(stream_len == len_before,
	      "bad checksum: the request draws no reply");

	request_file(MSS_FULL);
	drain(MSS_FULL);
	report("bad checksum");

	CHECK(body_offset() >= 0,
	      "bad checksum control: the same request with a good flag is served");
	CHECK(first_body_mismatch() == -1,
	      "bad checksum control: the file that follows is intact");
}

int main(int argc, char **argv)
{
	if (argc > 1 && !strcmp(argv[1], "-v"))
		verbose = 1;

	printf("== httpd: accounting for the bytes actually sent ==\n");
	scenario_steady_window();
	scenario_shrinking_window();
	scenario_growing_window();
	scenario_rexmit_after_shrink();
	scenario_poll_outstanding();
	scenario_poll_no_output();
	scenario_rexmit_fourth_pulse();
	scenario_ack_pipeline_and_fin();
	scenario_idle_timeout();
	scenario_init_idle_prescaler();
	scenario_time_wait();
	scenario_fin_wait_timeout();
	scenario_post_timeout();
	scenario_bad_l4_checksum();

	printf("\n%s (%d failure%s)\n",
	       failures ? "BENCH: FAILURES" : "BENCH: ALL PASS",
	       failures, failures == 1 ? "" : "s");
	return failures ? 1 : 0;
}
