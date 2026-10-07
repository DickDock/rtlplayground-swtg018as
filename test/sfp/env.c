/* SFP 专属 GPIO、EEPROM、SerDes 和输出 mock；生产状态来自真实 sfp.c。 */
#include <stdio.h>
#include <string.h>
#include "rtl837x_common.h"
#include "rtl837x_regs.h"
#include "rtl837x_pins.h"
#include "rtl837x_phy.h"
#include "cmd_parser.h"
#include "machine.h"
#include "sfp.h"
#include "env.h"
#include "hw_mock.h"

const struct machine machine = {
    .machine_name = "SFP-HOST",
    .isRTL8373 = 1,
    .min_port = 0, .max_port = 8,
#ifdef SFP_HOST_SINGLE
    .n_sfp = 1,
    .is_sfp = { 0, 0, 0, 0, 0, 0, 0, 0, 1 },
#else
    .n_sfp = 2,
    .is_sfp = { 0, 0, 0, 0, 0, 0, 0, 2, 1 },
#endif
    .log_to_phys_port = { 1, 2, 3, 4, 5, 6, 7, 8, 9 },
    .phys_to_log_port = { 0, 1, 2, 3, 4, 5, 6, 7, 8 },
    .sfp_port = {
        { .pin_detect = 38, .pin_los = 37, .pin_tx_disable = GPIO_NA, .sds = 1 },
        { .pin_detect = 30, .pin_los = 36, .pin_tx_disable = GPIO_NA, .sds = 0 },
    },
};

volatile uint32_t ticks;
bool module_present[2], module_los[2];
uint8_t eeprom[2][256], sds_mode[3];
unsigned reads[2], sds_enables[3], sds_offs[3], bad_sds_calls, gpio_outputs;
unsigned phy_speed_calls, phy_duplex_calls, phy_show_calls, media_show_calls;
struct phy_settings phy_settings;
int fail_slot, fail_reg, fail_reads;
int remove_slot, remove_reg;
char console[8192];
static size_t console_len;
uint8_t cmd_buffer[CMD_BUF_SIZE], err_status, cmd_words_len, cmd_words_b[15], atoi_results_u8;
uint8_t outbuf[TCP_OUTBUF_SIZE];
uint16_t slen;
// HTTP response headers: HOME-resident in the firmware (rtlplayground.c).
const uint8_t * const HTTP_RESPONCE_JSON =
	"HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n";
const uint8_t * const HTTP_RESPONCE_TXT =
	"HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n";
char port_names[9][PORT_NAME_SIZE];
const uint8_t * const hex = (const uint8_t *)"0123456789abcdef";
int tests_run, tests_failed;

void write_char(char c)
{
    if (console_len < sizeof(console) - 1) {
        console[console_len++] = c;
        console[console_len] = 0;
    }
}
void print_string(const char *p) { while (*p) write_char(*p++); }
void print_string_x(char *p) { print_string(p); }
void print_byte(uint8_t v) { write_char(hex[v >> 4]); write_char(hex[v & 15]); }
void print_short(uint16_t v) { print_byte(v >> 8); print_byte(v); }
void itoa(uint8_t v) { char b[4]; snprintf(b, sizeof(b), "%u", v); print_string(b); }
void itoa_short(uint16_t v) { char b[6]; snprintf(b, sizeof(b), "%u", v); print_string(b); }
uint16_t strtox(uint8_t *dst, const char *s)
{
    uint8_t *start = dst;
    while (*s) *dst++ = *s++;
    *dst = 0;
    return dst - start;
}

bool gpio_pin_test(uint8_t pin)
{
    for (uint8_t slot = 0; slot < 2; slot++) {
        if (pin == machine.sfp_port[slot].pin_detect) return !module_present[slot];
        if (pin == machine.sfp_port[slot].pin_los) return module_los[slot];
    }
    return true;
}
void gpio_input_setup(uint8_t pin) { (void)pin; }
void gpio_output_setup(uint8_t pin, uint8_t value)
{
    (void)value;
    if (pin != GPIO_NA) gpio_outputs++;
}

bool sfp_read_block(uint8_t slot, uint8_t reg, uint8_t len)
{
    if (slot >= machine.n_sfp || len > 16 || (unsigned)reg + len > 256) return false;
    reads[slot]++;
    if (!module_present[slot]) return false;
    if (slot == fail_slot && (fail_reg < 0 || reg == fail_reg) && fail_reads) {
        if (fail_reads > 0) fail_reads--;
        /* 失败时保留 scratch，便于发现误发上一次数据。 */
        return false;
    }
    memcpy(sfp_buf, eeprom[slot] + reg, len);
    if (slot == remove_slot && reg == remove_reg) module_present[slot] = false;
    return true;
}
void sds_config_mac(uint8_t sds, uint8_t mode)
{
    if (sds > 2 || mode > SDS_OFF) { bad_sds_calls++; return; }
    sds_mode[sds] = mode;
    if (mode == SDS_OFF) sds_offs[sds]++;
}
void sds_config(uint8_t sds, uint8_t mode)
{
    if (sds > 2 || mode == SDS_OFF || mode > SDS_OFF) { bad_sds_calls++; return; }
    sds_enables[sds]++;
    sds_mode[sds] = mode;
}
void phy_read(uint8_t phy, uint8_t dev, uint16_t reg)
{
    (void)phy; (void)dev; (void)reg;
    memset(sfr_data, 0, 4);
}

/* parse_port 的非 SFP 分支只 mock 外部 PHY 行为，parser 本身来自真实源码。 */
void phy_set_speed(void) { phy_speed_calls++; }
void phy_set_duplex(void) { phy_duplex_calls++; }
void phy_show(uint8_t port) { (void)port; phy_show_calls++; }
void port_media_show(uint8_t port) { (void)port; media_show_calls++; }

void set_module(uint8_t slot, uint8_t rate, const char *vendor, const char *model)
{
    memset(eeprom[slot], 0, sizeof(eeprom[slot]));
    eeprom[slot][11] = 3;
    eeprom[slot][12] = rate;
    eeprom[slot][92] = 0x40;
    memset(eeprom[slot] + 20, ' ', 16);
    memcpy(eeprom[slot] + 20, vendor, strlen(vendor));
    memset(eeprom[slot] + 40, ' ', 16);
    memcpy(eeprom[slot] + 40, model, strlen(model));
    memcpy(eeprom[slot] + 68, "SERIAL-TEST", 11);
    eeprom[slot][226] = 0x33;
    module_present[slot] = true;
}
void sfp_env_reset(void)
{
    hw_reset();
    ticks = 0;
    sfp_init();
    memset(module_present, 0, sizeof(module_present));
    module_los[0] = module_los[1] = true;
    memset(reads, 0, sizeof(reads));
    memset(sds_enables, 0, sizeof(sds_enables));
    memset(sds_offs, 0, sizeof(sds_offs));
    sds_mode[0] = sds_mode[2] = SDS_QXGMII;
    sds_mode[1] = SDS_OFF;
    fail_slot = fail_reg = remove_slot = remove_reg = -1; fail_reads = 0;
    bad_sds_calls = gpio_outputs = 0;
    phy_speed_calls = phy_duplex_calls = phy_show_calls = media_show_calls = 0;
    memset(&phy_settings, 0, sizeof(phy_settings));
    console_len = 0; console[0] = 0;
    memset(outbuf, 0, sizeof(outbuf)); slen = 0;
}
void sfp_test_cli(const char *line)
{
    snprintf((char *)cmd_buffer, sizeof(cmd_buffer), "%s", line);
    cmd_tokenize();
    if (err_status == ERR_OK) {
        if (!strncmp(line, "port ", 5)) parse_port();
        else parse_sfp();
    }
}
void poll_after(uint32_t elapsed) { ticks += elapsed; handle_sfp(); }
