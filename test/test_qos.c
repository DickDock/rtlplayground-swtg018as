/*
 * test_qos.c - the qos, fc and pfc console commands of rtl837x_qos.c against
 * the register mock.
 *
 * Each command is checked for the register word it writes, stated here
 * independently from the field layout in rtl8373_reg_definition.h, and for
 * leaving the other bits of that word alone. Invalid arguments must write
 * nothing and set err_status. The module is compiled unmodified.
 */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "rtl837x_common.h"
#include "rtl837x_regs.h"
#include "rtl837x_qos.h"
#include "support.h"
#include "hw_mock.h"

/* support.c owns these buffers; the tokenizer state lives in cmd_parser.c,
 * which is not linked here */
extern uint8_t cmd_buffer[CMD_BUF_SIZE];
extern uint8_t err_status;
uint8_t cmd_words_len;
uint8_t cmd_words_b[15];

/* Tokenizes line like cmd_tokenize() and runs the command, returns err_status */
static uint8_t run(const char *line)
{
	uint8_t i = 0, white = 1;

	memset(cmd_buffer, 0, CMD_BUF_SIZE);
	strcpy((char *)cmd_buffer, line);
	cmd_words_len = 0;
	for (; cmd_buffer[i]; i++) {
		if (white && cmd_buffer[i] != ' ')
			cmd_words_b[cmd_words_len++] = i;
		white = cmd_buffer[i] == ' ';
	}
	err_status = ERR_OK;
	out_reset();
	if (!strncmp(line, "qos", 3))
		qos_parse();
	else if (!strncmp(line, "fc", 2))
		fc_parse();
	else
		pfc_parse();
	return err_status;
}

/* Sets a register to all ones so that clobbered neighbouring fields show */
static void ones(uint16_t a) { hw_reg_set(a, 0xffffffff); }

static uint32_t field(uint32_t v, int off, int bits) { return (v >> off) & ((1u << bits) - 1); }

static void t_qos(void)
{
	printf("[test] qos: priority sources, maps, queues and scheduling\n");
	hw_reset();

	ones(0x5180);
	CHECK(run("qos dscp 26 3") == ERR_OK, "qos dscp 26 3 is accepted");
	CHECK(hw_reg_get(0x5180) == ((0xffffffff & ~(7u << 18)) | (3u << 18)),
	      "DSCP 26 is the 7th 3-bit field of the third DSCP register, the rest untouched");
	CHECK(run("qos dscp 0x1a 5") == ERR_OK && field(hw_reg_get(0x5180), 18, 3) == 5, "hex argument 0x1a is DSCP 26");
	CHECK(run("qos dscp 63 7") == ERR_OK && field(hw_reg_get(0x5178 + 24), 9, 3) == 7, "DSCP 63 is field 3 of register 6");

	CHECK(run("qos trust dscp") == ERR_OK, "qos trust dscp is accepted");
	uint32_t w = hw_reg_get(0x5198);
	CHECK(w == hw_reg_get(0x519c), "both weight tables are written alike");
	CHECK(field(w, 10, 5) == 16, "DSCP has the highest one-hot weight");
	CHECK(field(w, 0, 5) < 16 && field(w, 5, 5) < 16 && field(w, 15, 5) < 16 && field(w, 20, 5) < 16,
	      "all other sources are lower");
	CHECK(run("qos trust port") == ERR_OK && field(hw_reg_get(0x5198), 5, 5) == 16, "trust port puts the port weight on top");

	ones(0x5174);
	CHECK(run("qos 1p 3 5") == ERR_OK && hw_reg_get(0x5174) == ((0xffffffff & ~(7u << 12)) | (5u << 12)),
	      "PCP 3 -> priority 5 in bits 14-12");

	hw_reg_set(0x5170, 0);
	hw_reg_set(0x674c, 0);
	CHECK(run("qos port 4 6") == ERR_OK && hw_reg_get(0x5170) == (6u << 9), "physical port 4 is chip port 3, bits 11-9");
	CHECK(hw_reg_get(0x674c) == (6u << 9), "the copy PORT_PRI_DUP is written too");

	CHECK(run("qos queue 3 3") == ERR_OK, "qos queue 3 3 is accepted");
	int all = 1;
	for (int p = 0; p <= 9; p++)
		all &= field(hw_reg_get(0x51a4 + p * 4), 12, 3) == 3;
	CHECK(all, "priority 3 goes to queue 3 on every port including the CPU port");

	CHECK(run("qos sched 4 3 strict") == ERR_OK && hw_reg_get(0x1d28 + 3 * 0x400 + 12) == 0x80,
	      "queue 3 of chip port 3 becomes strict");
	CHECK(run("qos sched 4 3 20") == ERR_OK && hw_reg_get(0x1d28 + 3 * 0x400 + 12) == 20,
	      "a weight clears strict and sets the weight");

	unsigned long wr = hw_writes;
	CHECK(run("qos dscp 64 1") != ERR_OK, "DSCP 64 is refused");
	CHECK(run("qos dscp 26 8") != ERR_OK, "priority 8 is refused");
	CHECK(run("qos port 0 1") != ERR_OK, "port 0 is refused");
	CHECK(run("qos sched 4 3 0") != ERR_OK, "weight 0 is refused");
	CHECK(run("qos sched 4 3 128") != ERR_OK, "weight 128 is refused");
	CHECK(run("qos dscp 0x 1") != ERR_OK, "a bare 0x is refused");
	CHECK(run("qos dscp 00026 1") != ERR_OK, "more than 4 decimal digits are refused");
	CHECK(run("qos dscp 2a 1") != ERR_OK, "a letter in a decimal number is refused");
	CHECK(run("qos trust acl") != ERR_OK, "an unknown trust source is refused");
	CHECK(run("qos dscp 26") != ERR_OK, "a missing argument is refused");
	CHECK(hw_writes == wr, "refused commands write nothing");

	CHECK(run("qos show") == ERR_OK && strstr(out_buf, "DSCP -> priority") != NULL, "qos show prints the maps");
}

static void t_fc(void)
{
	printf("[test] fc: 802.3x thresholds, threshold sets and forced pause\n");
	hw_reset();

	CHECK(run("fc thr glb 300 200") == ERR_OK && hw_reg_get(0x7154) == ((300u << 16) | 200),
	      "global threshold: ON in bits 27-16, OFF in 11-0");
	CHECK(run("fc thr 2 100 50") == ERR_OK && hw_reg_get(0x7180) == ((100u << 16) | 50), "threshold set 2");
	ones(0x71bc);
	CHECK(run("fc guar 1 30") == ERR_OK && hw_reg_get(0x71bc) == ((0xffffffff & ~0xfffu) | 30), "guarantee of set 1");

	ones(0x71c8);
	CHECK(run("fc 9 set 2") == ERR_OK && hw_reg_get(0x71c8) == ((0xffffffff & ~(3u << 16)) | (2u << 16)),
	      "physical port 9 is chip port 8, set select in bits 17-16");

	ones(0x6344 + 12);
	CHECK(run("fc 4 on") == ERR_OK && hw_reg_get(0x6344 + 12) == 0xffffffff, "fc on: force, RX and TX pause set");
	CHECK(run("fc 4 off") == ERR_OK && field(hw_reg_get(0x6344 + 12), 7, 3) == 4, "fc off: force set, pause bits clear");
	CHECK(run("fc 4 auto") == ERR_OK && hw_reg_get(0x6344 + 12) == (0xffffffff & ~(7u << 7)),
	      "fc auto: force clear, the other bits kept");

	unsigned long wr = hw_writes;
	CHECK(run("fc thr glb 4096 1") != ERR_OK, "a threshold above 4095 is refused");
	CHECK(run("fc thr 4 1 1") != ERR_OK, "threshold set 4 is refused");
	CHECK(run("fc 9 set 4") != ERR_OK, "set 4 is refused");
	CHECK(run("fc 4 maybe") != ERR_OK, "an unknown mode is refused");
	CHECK(hw_writes == wr, "refused commands write nothing");

	CHECK(run("fc show") == ERR_OK && strstr(out_buf, "Global pages used") != NULL, "fc show prints the counters");
}

static void t_pfc(void)
{
	printf("[test] pfc: enable, map and forced congestion on the 10G ports\n");
	hw_reset();

	CHECK(run("pfc 9 on 3,4") == ERR_OK, "pfc 9 on 3,4 is accepted");
	CHECK(hw_reg_get(0x1040) == 0x01181818, "second copy: port enable and priorities 3,4 for RX, TX and enable");
	CHECK(hw_reg_get(0x103c) == 0, "the first copy is untouched");
	CHECK(field(hw_reg_get(0x7250), 0, 8) == 0x18, "PG 3 and 4 enabled");
	CHECK(run("pfc 4 on 3") == ERR_OK && hw_reg_get(0x103c) == 0x01080808, "physical port 4 (chip port 3) uses the first copy");

	CHECK(run("pfc 9 off") == ERR_OK && hw_reg_get(0x1040) == 0 && field(hw_reg_get(0x7250), 0, 8) == 0,
	      "pfc off clears both enables");

	hw_reg_set(0x5568, 0xab000000);
	hw_reg_set(0x5570, 0xcd123456);
	CHECK(run("pfc 9 map") == ERR_OK, "pfc 9 map is accepted");
	CHECK(hw_reg_get(0x5568) == 0xabfac688, "priority n -> PG n, the top byte kept");
	CHECK(hw_reg_get(0x5570) == 0xcdfac688, "PCP n -> PG n, the top byte kept");
	int ident = 1;
	for (int n = 0; n < 8; n++)
		ident &= field(0x00fac688, n * 3, 3) == (uint32_t)n;
	CHECK(ident, "0x00fac688 is the identity map");

	CHECK(run("pfc 9 force 3") == ERR_OK && hw_reg_get(0x7450) == 0x08080000, "force PG 3: enable and value");
	CHECK(run("pfc 9 force off") == ERR_OK && hw_reg_get(0x7450) == 0, "force off clears both");

	unsigned long wr = hw_writes;
	CHECK(run("pfc 5 on 3") != ERR_OK, "a 2.5G port is refused");
	CHECK(run("pfc 9 on 8") != ERR_OK, "priority 8 is refused");
	CHECK(run("pfc 9 on 3,") != ERR_OK, "a trailing comma is refused");
	CHECK(run("pfc 9 on") != ERR_OK, "a missing priority list is refused");
	CHECK(hw_writes == wr, "refused commands write nothing");

	CHECK(run("pfc show") == ERR_OK && strstr(out_buf, "PG pages used/peak") != NULL, "pfc show prints both ports");
}

int main(void)
{
	printf("== rtl837x_qos.c command tests ==\n");
	t_qos();
	t_fc();
	t_pfc();
	printf("\n%d checks, %d failed\n", tests_run, tests_failed);
	return tests_failed ? 1 : 0;
}
