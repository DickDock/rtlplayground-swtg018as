#ifndef _SNMP_H_
#define _SNMP_H_

#include <stdbool.h>
#include <stdint.h>

/* This header sits in the uip-conf.h -> udp_apps.h include chain (see
 * syslog.h), so it must not pull in uip/uip.h: the conn is only a pointer
 * member, and an incomplete struct type is enough for that. Translation
 * units include uip/uip.h themselves. */

#define SNMP_UDP_PORT 161

/* Community strings are words (no spaces, the config replays CLI lines), the
 * free-text fields share the hostname[24] width. */
#define SNMP_COMMUNITY_MAX 16
#define SNMP_TEXT_MAX 23
#define SNMP_COMMUNITY_DEFAULT "public"

struct snmp_state {
	bool enabled;
	char community[SNMP_COMMUNITY_MAX + 1];
	char contact[SNMP_TEXT_MAX + 1];
	char location[SNMP_TEXT_MAX + 1];
	struct uip_udp_conn *conn;
};

extern __xdata struct snmp_state snmp_state;

/* Like the rest of the firmware (ip[], atoi_results_short), helpers take no
 * parameters - the overlay segment has nothing to hand them in. The caller
 * fills snmp_arg and calls snmp_set_community(). */
extern __xdata const char *snmp_arg;

void snmp_init(void) __banked;
void snmp_start(void) __banked;
void snmp_stop(void) __banked;
void snmp_callback(void) __banked;
bool snmp_set_community(void) __banked;

#endif
