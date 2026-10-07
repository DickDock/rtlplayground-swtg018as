/*
 * test_tick_gate.c - the timers of the main loop keep time by the system
 * tick, however often the loop passes. STP uses the existing TICKS_DUE macro;
 * TCP uses the same lightweight gate as handle_tx(). The loop scheduling is
 * restated here; test_httpd_tx.c separately exercises real uIP/httpd.
 */
#include <stdint.h>
#include <stdio.h>

#include "rtl837x_common.h"
#include "tcp_tick_gate.h"
#include "rtl837x_stp.h"
#include "support.h"

volatile uint32_t ticks;

#define STP_TICK_STEP (SYS_TICK_HZ / STP_HZ)
#define STP_CATCH_UP 8

static uint8_t stp_tick_last;
static uint16_t tx_tick_last, tcp_tick_last;
static unsigned stp_calls, tx_calls, tcp_calls, poll_calls;

/* One pass of the loop: the STP block of idle() and the gate of handle_tx() */
static void pass(void)
{
	uint8_t n = STP_CATCH_UP;
	while (n-- && TICKS_DUE(stp_tick_last, STP_TICK_STEP)) {
		stp_tick_last += STP_TICK_STEP;
		stp_calls++;
	}
	/* Firmware's tick_pending coalesces missed ticks into one TX/UDP sweep. */
	if ((uint16_t)ticks != tx_tick_last) {
		tx_tick_last = (uint16_t)ticks;
		tx_calls++;
		if (tcp_tick_due((uint16_t)ticks, &tcp_tick_last))
			tcp_calls++;
		else
			poll_calls++;
	}
}

/* Run `seconds` of wall clock with one pass every `pass_us` microseconds. */
static void run(double pass_us, unsigned seconds)
{
	double t = 0, next_tick = 0, tick_us = 1e6 / SYS_TICK_HZ, end = seconds * 1e6;
	ticks = 0;
	stp_tick_last = 0;
	tx_tick_last = tcp_tick_last = 0;
	stp_calls = tx_calls = tcp_calls = poll_calls = 0;
	while (t < end) {
		while (next_tick <= t) { ticks++; next_tick += tick_us; }
		pass();
		t += pass_us;
	}
}

static void t_rates(void)
{
	printf("[test] STP time follows the tick whatever the loop does\n");
	run(5000, 10);
	CHECK(stp_calls == 10 * STP_HZ, "one pass per tick: 500 STP steps in 10 s");
	CHECK(tx_calls == 10 * SYS_TICK_HZ, "and 2000 TX periodics");
	run(16000, 10);
	CHECK(stp_calls >= 10 * STP_HZ - 1 && stp_calls <= 10 * STP_HZ, "a 16 ms pass, as under an IPv4 stream: still 500 (was 156 when the clock counted passes)");
	CHECK(tx_calls == 625, "TX periodic once per pass when passes are slower than the tick");
	run(600, 10);
	CHECK(stp_calls == 10 * STP_HZ, "a 0.6 ms pass, the loop no longer sleeping: still 500 (was 4166)");
	CHECK(tx_calls == 10 * SYS_TICK_HZ, "TX periodic capped at the tick rate");
	run(1300000, 13);
	CHECK(stp_calls <= 10 * STP_CATCH_UP, "a 1.3 s pass loses time instead of firing 65 steps at once");
}

static void t_tcp_rates(void)
{
	printf("[test] TCP timers run at 2 Hz while TX/UDP stay tick-paced\n");
	run(5000, 10);
	CHECK(tcp_calls == 20 && poll_calls == 1980,
	      "5 ms loop: twenty slow TCP pulses replace twenty of 2000 polls");
	run(16000, 10);
	CHECK(tcp_calls == 19 && poll_calls == tx_calls - tcp_calls,
	      "16 ms loop: TCP keeps the half-second phase without catch-up bursts");
	run(600, 10);
	CHECK(tcp_calls == 20 && poll_calls == 1980,
	      "0.6 ms loop: RX wakeups cannot accelerate TCP timers");
	run(1300000, 13);
	CHECK(tcp_calls == 9 && poll_calls == 1 && tx_calls == 10,
	      "1.3 s stalls: one TCP pulse per late sweep, all missed pulses skipped");
}

static void t_wrap(void)
{
	printf("[test] the byte arithmetic survives the tick counter wrapping\n");
	ticks = 0xfffffffeUL;
	stp_tick_last = (uint8_t)ticks;
	stp_calls = 0;
	for (int i = 0; i < 8; i++) { ticks++; pass(); }
	CHECK(stp_calls == 2, "two STP steps across 0xffffffff -> 0x00000006");
}

static void t_tcp_phase_and_stall(void)
{
	uint16_t last = 0;

	printf("[test] shared TCP gate keeps phase but never bursts after a stall\n");
	CHECK(!tcp_tick_due(99, &last) && last == 0,
	      "no timer pulse before the hundredth system tick");
	CHECK(tcp_tick_due(100, &last) && last == 100,
	      "hundredth tick emits the first half-second timer pulse");
	CHECK(tcp_tick_due(203, &last) && last == 200,
	      "ordinary loop delay retains the original half-second phase");
	CHECK(!tcp_tick_due(299, &last) && tcp_tick_due(300, &last) && last == 300,
	      "next pulse still falls on the phase boundary");

	last = 0;
	CHECK(tcp_tick_due(260, &last) && last == 260,
	      "1.3 s stall emits one pulse and reanchors without byte truncation");
	CHECK(!tcp_tick_due(260, &last) && !tcp_tick_due(261, &last) &&
	      !tcp_tick_due(359, &last),
	      "missed pulses are not replayed in the same or following fast sweeps");
	CHECK(tcp_tick_due(360, &last) && last == 360,
	      "next pulse waits a full half-second after the stalled sweep");
	last = 0;
	CHECK(tcp_tick_due(200, &last) && last == 200 && !tcp_tick_due(200, &last),
	      "exactly two missed periods also reanchor, never an immediate catch-up");
}

static void t_tcp_wrap(void)
{
	uint16_t last = 0xfffe;

	printf("[test] shared TCP gate uses explicit unsigned 16-bit differences\n");
	CHECK(!tcp_tick_due(97, &last) && last == 0xfffe,
	      "16-bit wrap: 99 elapsed ticks are not due");
	CHECK(tcp_tick_due(98, &last) && last == 98,
	      "16-bit wrap: hundredth tick is due and preserves phase");
	last = 0xff80;
	CHECK(tcp_tick_due(132, &last) && last == 132 && !tcp_tick_due(133, &last),
	      "16-bit wrap: a 260-tick stall is one pulse, not a burst");

	ticks = 0xffffffcdUL;
	tcp_tick_last = tx_tick_last = (uint16_t)ticks;
	stp_tick_last = (uint8_t)ticks;
	tcp_calls = poll_calls = tx_calls = 0;
	for (int i = 0; i < 200; i++) { ticks++; pass(); }
	CHECK(tcp_calls == 2 && poll_calls == 198 && tx_calls == 200,
	      "system-counter wrap: 200 TX sweeps contain exactly two slow TCP pulses");
}

int main(void)
{
	printf("== tick gate tests ==\n");
	t_rates();
	t_tcp_rates();
	t_wrap();
	t_tcp_phase_and_stall();
	t_tcp_wrap();
	printf("\n%d checks, %d failed\n", tests_run, tests_failed);
	return tests_failed ? 1 : 0;
}
