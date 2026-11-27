#ifndef CVD_H
#define CVD_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/// True when the private CoreGraphics virtual display classes exist on this macOS.
bool cvd_available(void);
/// Creates a virtual display; returns its CGDirectDisplayID, or 0 and a message in `err`.
uint32_t cvd_create(const char *name, uint32_t width, uint32_t height, char *err, size_t err_len);
/// Removes a display created by cvd_create. False for any other id.
bool cvd_remove(uint32_t display_id);

#endif
