/* SFP 专属 host 环境；不改变现有共享 mock。 */
#ifndef SFP_HOST_ENV_H
#define SFP_HOST_ENV_H
#include <stdint.h>
#include <stdbool.h>

extern volatile uint32_t ticks;
extern uint8_t sfp_wake_at[2], sfp_wake_pending[2];
extern bool module_present[2], module_los[2];
extern uint8_t eeprom[2][256], sds_mode[3];
extern unsigned reads[2], sds_enables[3], sds_offs[3], bad_sds_calls, gpio_outputs;
extern unsigned phy_speed_calls, phy_duplex_calls, phy_show_calls, media_show_calls;
extern int fail_slot, fail_reg, fail_reads;
extern int remove_slot, remove_reg;
extern char console[8192];
extern uint8_t cmd_buffer[], err_status;
extern uint8_t outbuf[];
extern uint16_t slen;
extern int tests_run, tests_failed;

void sfp_env_reset(void);
void sfp_test_cli(const char *line);
void poll_after(uint32_t elapsed);
void set_module(uint8_t slot, uint8_t rate, const char *vendor, const char *model);
void parse_sfp(void);
void parse_port(void);

#define CHECK(cond, msg) do { \
    tests_run++; \
    if (!(cond)) { tests_failed++; \
        printf("  FAIL: %s (%s:%d)\n", (msg), __FILE__, __LINE__); \
    } \
} while (0)
#endif
