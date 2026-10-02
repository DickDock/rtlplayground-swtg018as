#ifndef _RTL837X_QOS_H_
#define _RTL837X_QOS_H_

#include <stdint.h>

/* Console commands, called by the command parser with the line tokenized */
void qos_parse(void) __banked;
void fc_parse(void) __banked;
void pfc_parse(void) __banked;

#endif
