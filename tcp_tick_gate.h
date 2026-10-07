#ifndef TCP_TICK_GATE_H
#define TCP_TICK_GATE_H

#include <stdint.h>
#include <stdbool.h>

#define TCP_TICK_STEP (SYS_TICK_HZ / 2)

/* 正常延迟保留半秒相位；长停顿只触发一次，跳过漏掉的脉冲，避免提前重传。 */
static inline bool tcp_tick_due(uint16_t now, __xdata uint16_t *last)
{
	uint16_t elapsed = (uint16_t)(now - *last);

	if (elapsed < TCP_TICK_STEP)
		return false;
	if (elapsed < 2 * TCP_TICK_STEP)
		*last += TCP_TICK_STEP;
	else
		*last = now;
	return true;
}

#endif
