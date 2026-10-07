#include "machine.h"
#include "syslog.h"
#include "cmd_parser.h"
#include "uip/uip.h"
#include "rtl837x_common.h"

#ifdef BRIDGE_LAYOUT
#pragma codeseg BANK2
#pragma constseg BANK2
#else
#pragma codeseg BANK6
#pragma constseg BANK6
#endif

#define SYSLOG_P ((__xdata uint8_t *)uip_appdata)

__xdata char logbuf[LOGBUF_SIZE];
__xdata struct syslog_state syslog_state;
__xdata uip_ipaddr_t server_ip;

#define state syslog_state

/* Append v as plain decimal digits at p, return the byte count. A local
 * counterpart of itoa(): that one streams to the console through
 * write_char(), while the packet builder needs the bytes in SYSLOG_P.
 * Subtraction ladder instead of a divide - the 8051 has no divider and
 * the divide library would cost code space for five calls. */
static uint8_t syslog_put_u16(__xdata uint8_t *p, uint16_t v)
{
	uint16_t mag = 10000;
	uint8_t n = 0;
	uint8_t started = 0;

	while (mag) {
		uint8_t d = '0';
		while (v >= mag) {
			v -= mag;
			d++;
		}
		if (d > '0' || started || mag == 1) {
			p[n++] = d;
			started = 1;
		}
		if (mag == 10000) mag = 1000;
		else if (mag == 1000) mag = 100;
		else if (mag == 100) mag = 10;
		else if (mag == 10) mag = 1;
		else mag = 0;
	}
	return n;
}

/* Two-digit zero-padded form for the hh:mm:ss fields. */
static uint8_t syslog_put_2d(__xdata uint8_t *p, uint8_t v)
{
	if (v >= 10)
		return syslog_put_u16(p, v);
	p[0] = '0';
	p[1] = '0' + v;
	return 2;
}

void syslog_init(void) __banked
{
	state.enabled = 0;
	state.syslog_conn = 0;
	state.writeptr = 0;
	state.readptr = 0;
	state.line_available = 0;
	state.server_ip[0] = 0; state.server_ip[1] = 0; state.server_ip[2] = 0; state.server_ip[3] = 0;// Default to 0.0.0.0
	state.server_port = SYSLOG_PORT_DEFAULT;
}

void syslog_start(void) __banked
{
	if (state.syslog_conn == 0) {
		uip_ipaddr(server_ip, state.server_ip[0], state.server_ip[1], state.server_ip[2], state.server_ip[3]);
		state.syslog_conn = uip_udp_new(&server_ip, HTONS(state.server_port));
		if (state.syslog_conn == 0) {
			print_string_newline_no_syslog("Failed to create a new UDP client");
			return;
		}
		print_string_newline_no_syslog("Started syslog to IP ");
		print_ip(state.server_ip);
		write_char(':'); itoa_short(state.server_port); write_char('\n');
		state.enabled = 1;
	}
	else {
		print_string_newline_no_syslog("Syslog is already running");
	}
}

void syslog_stop(void) __banked
{
	state.enabled = 0;
	if (state.syslog_conn != 0) {
		uip_udp_remove(state.syslog_conn);
		state.syslog_conn = 0;
		print_string_newline_no_syslog("Stopped syslog");
	} else {
		print_string_newline_no_syslog("Syslog is not running");
	}
}

void syslog_callback(uint16_t lport) __banked
{
	uint16_t syslog_hdr;
	if (!state.syslog_conn || lport != state.syslog_conn->lport)
		return;

	if ((state.readptr != state.writeptr) && state.line_available)
	{
		__xdata int16_t log_size = state.writeptr - state.readptr;
		if (log_size < 0)
			log_size += LOGBUF_SIZE;
		
		// Skipping linefeeds at the start of the log line
		__xdata uint16_t log_start = state.readptr;
		while (log_size > 0 && logbuf[log_start] == '\n') {
			log_start = (log_start + 1) & (LOGBUF_SIZE - 1);
			log_size--;
		}

		// Skipping linefeeds and whitespaces at the end of the log line
		__xdata uint16_t log_end = state.writeptr;
		while ( (log_size > 0) && 
				((logbuf[(log_end-1) & (LOGBUF_SIZE - 1)] == '\n') ||
				 (logbuf[(log_end-1) & (LOGBUF_SIZE - 1)] == ' ')))
		{
			log_end = (log_end - 1) & (LOGBUF_SIZE - 1);
			log_size--;
		}

		if (log_size == 0) {
			state.readptr = state.writeptr;
			state.line_available = 0;
			return;
		}

		memcpyc(SYSLOG_P, "<14>", 4); // Syslog priority prefix
		syslog_hdr = 4;

		/* Uptime stamp. The device has no RTC, so there is no honest
		 * wall-clock time to put in the RFC 3164 header slot; instead the
		 * message carries the time since boot where the timestamp would
		 * go, and receivers sort by arrival time plus this. The counters
		 * are bumped once a second by handle_tick(), so reading them is
		 * torn only across a second boundary - harmless for a log. */
		SYSLOG_P[syslog_hdr++] = '[';
		memcpyc(SYSLOG_P + syslog_hdr, "up ", 3);
		syslog_hdr += 3;
		syslog_hdr += syslog_put_u16(SYSLOG_P + syslog_hdr, uptime_days);
		SYSLOG_P[syslog_hdr++] = 'd';
		SYSLOG_P[syslog_hdr++] = ' ';
		syslog_hdr += syslog_put_2d(SYSLOG_P + syslog_hdr, uptime_hours);
		SYSLOG_P[syslog_hdr++] = ':';
		syslog_hdr += syslog_put_2d(SYSLOG_P + syslog_hdr, uptime_mins);
		SYSLOG_P[syslog_hdr++] = ':';
		syslog_hdr += syslog_put_2d(SYSLOG_P + syslog_hdr, uptime_secs);
		SYSLOG_P[syslog_hdr++] = ']';
		SYSLOG_P[syslog_hdr++] = ' ';

		/* RFC 3164 puts a hostname between the priority and the text, and
		 * we were leaving that slot empty. A receiver still has to fill
		 * the field, so it takes the first word of the message instead:
		 * every line arrives attributed to "STP:" or "REGGET:" or
		 * whatever the log happens to start with, and the sender cannot
		 * be selected on at all. Send our own name and the field means
		 * something. Skipped when the name is empty, so we never emit a
		 * lone separator. */
		{
			uint8_t hl = strlen_x(hostname);
			if (hl) {
				memcpy(SYSLOG_P + syslog_hdr, hostname, hl);
				syslog_hdr += hl;
				SYSLOG_P[syslog_hdr++] = ' ';
			}
		}

		if (log_end < log_start) {
			memcpy(SYSLOG_P + syslog_hdr, logbuf + log_start, LOGBUF_SIZE - log_start);
			memcpy(SYSLOG_P + syslog_hdr + LOGBUF_SIZE - log_start, logbuf, log_end);
		} else {
			 memcpy(SYSLOG_P + syslog_hdr, logbuf + log_start, log_end - log_start);
		}

		uip_udp_send(log_size + syslog_hdr);
		state.readptr = state.writeptr;
		state.line_available = 0;
	}
}
