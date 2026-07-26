# KitLuy Hardware Compatibility Matrix — Phase 1 Laundry

**Filename:** `kitluy-hardware-compatibility-matrix-phase1-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Certification baseline and test contract; not proof that HET certification tests have passed  
**Primary environment:** Raspberry Pi OS 64-bit / Linux ARM64

> **Integrity rule:** A named model is not `KITLUY-CERTIFIED` until a KitLuy hardware evidence record contains the tested hardware revision, firmware, driver, OS image, test results and approver. This document names the exact Phase 1 baseline models that must be certified and prevents generic substitutes from being silently treated as equivalent.

## 1. Certification labels

| Label                    | Meaning                                                                        |
| ------------------------ | ------------------------------------------------------------------------------ |
| `OWNER-LOCKED REFERENCE` | Product family/form factor is already approved by owner direction              |
| `TARGET-CERTIFICATION`   | Exact model selected for the Phase 1 certification campaign                    |
| `KITLUY-CERTIFIED`       | Passed HET bench, integration, soak, recovery and pilot tests with evidence ID |
| `CONDITIONAL`            | Works only with listed interface/firmware/profile restrictions                 |
| `REJECTED`               | Must not be deployed                                                           |

At publication, the models below are `TARGET-CERTIFICATION` unless a later evidence register upgrades the status.

## 2. Baseline model matrix

| Class                        | Exact baseline model                                            | Intended use                                        | Interface/profile                                             | Vendor evidence baseline                                                                                                                 | KitLuy status                                 |
| ---------------------------- | --------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Store Hub compute            | **Raspberry Pi 5, 8 GB RAM**                                    | Store Hub                                           | ARM64, Gigabit Ethernet, active cooling                       | Raspberry Pi specifies 2.4 GHz quad-core Arm Cortex-A76 and recommends a high-quality 5V/5A supply; production through at least Jan 2036 | OWNER-LOCKED REFERENCE / TARGET-CERTIFICATION |
| Terminal compute             | **Raspberry Pi 5, 4 GB RAM**                                    | T1/T2 and T3/T4 terminal                            | ARM64, HDMI, USB, Ethernet                                    | Same Pi 5 platform and compliance family                                                                                                 | OWNER-LOCKED REFERENCE / TARGET-CERTIFICATION |
| Hub NVMe and HAT             | **Raspberry Pi SSD Kit 256 GB**                                 | Hub boot/data storage                               | Raspberry Pi M.2 HAT+ plus 256 GB M.2 2230 NVMe               | Official kit; 40k read/70k write random IOPS rating; production through at least Jan 2032                                                | TARGET-CERTIFICATION                          |
| Hub cooling                  | **Raspberry Pi Active Cooler**                                  | Hub thermal control                                 | Official Pi 5 cooler beneath standard M.2 HAT+                | Official Pi 5 accessory                                                                                                                  | TARGET-CERTIFICATION                          |
| Pi power supply              | **Raspberry Pi 27W USB-C Power Supply, regional approved plug** | Hub and terminal Pi power                           | 5.1V/5A USB-C                                                 | Official 27W PSU, 100–240VAC, production through at least Jan 2035                                                                       | TARGET-CERTIFICATION                          |
| UPS                          | **APC Back-UPS BX750MI-MS**                                     | Hub, router/switch and critical terminal continuity | 230V, 750VA, 2 universal + 1 IEC C13, AVR                     | Official APC product family; regional availability and plug/cable set must be verified                                                   | TARGET-CERTIFICATION                          |
| T1 touchscreen               | **Waveshare 15.6inch HDMI LCD (H) with case**                   | T1 operator display                                 | 1920×1080 IPS, HDMI, USB 10-point capacitive touch, 12V       | Manufacturer documents Raspberry Pi OS support and driver-free touch                                                                     | TARGET-CERTIFICATION                          |
| T2 optional customer display | **Waveshare 10.1inch HDMI LCD (B) with case**                   | Customer Display Screen                             | 1280×800 IPS, HDMI, USB capacitive touch                      | Manufacturer documents Raspberry Pi OS support and driver-free touch                                                                     | TARGET-CERTIFICATION                          |
| Receipt printer              | **Epson TM-T20III Ethernet/USB model**                          | 80 mm receipts and drawer kick                      | ESC/POS, Ethernet preferred, USB fallback                     | Epson provides Linux thermal-printer/JavaPOS support; model supports up to 250 mm/s and Ethernet/USB variants                            | TARGET-CERTIFICATION                          |
| Tag printer                  | **TSC TE210 desktop printer**                                   | Laundry bag/garment tags                            | 203 dpi, thermal transfer/direct thermal, Ethernet/USB/RS-232 | TSC documents 203 dpi, up to 6 ips, Ethernet/USB/serial and 4-inch media                                                                 | TARGET-CERTIFICATION                          |
| Scanner                      | **Zebra DS2208-SR corded scanner**                              | Booking, QR and tag scanning                        | USB HID/keyboard wedge; 1D/2D                                 | Zebra documents corded DS2208, 1D/2D and USB connection                                                                                  | TARGET-CERTIFICATION                          |
| Scale                        | **Adam Equipment GBK-S 32**                                     | Per-weight Laundry intake                           | 32 kg × 1 g, RS-232; optional USB                             | Manufacturer documents 32 kg capacity, 1 g readability, RS-232 and optional USB                                                          | TARGET-CERTIFICATION                          |
| Cash drawer                  | **APG Vasario VB320-1-BL1616-B5**                               | T1 cash storage                                     | 24V MultiPRO 320 printer interface                            | APG documents electronic release, 4 bill/8 coin, standard duty and 1M-operation test claim                                               | TARGET-CERTIFICATION                          |
| Network fallback adapter     | **TP-Link UE300 V5 USB 3.0 to Gigabit Ethernet**                | Terminal fallback/diagnostic adapter                | USB-A, RTL8153, 10/100/1000                                   | TP-Link provides Linux support/downloads and plug-and-play guidance                                                                      | TARGET-CERTIFICATION                          |

## 3. Important deployment restrictions

### 3.1 Pi and NVMe

- Use PCIe Gen 2 mode for the certified baseline. Raspberry Pi documentation warns Pi 5 is not certified for PCIe Gen 3 speed.
- Hub requires active cooling and a tamper-evident enclosure.
- NVMe serial/model/capacity are part of installation identity.
- Store staff may not substitute or replace NVMe.
- A different SSD/HAT combination requires a separate profile and full storage/recovery test.

### 3.2 Power

- Do not power Pi 5 from display USB ports.
- Use official 27W PSU or separately certified equivalent.
- Screen and printer power adapters must be included in total UPS load calculation.
- UPS outlet/cable variant must match Cambodia installation practice and HET electrical safety review.
- UPS USB telemetry is optional unless the selected regional revision exposes a certified data interface; audible/manual status alone must not be presented as managed telemetry.

### 3.3 Displays

- T1 baseline is landscape 1920×1080.
- T2 baseline is landscape or approved portrait layout based on the physical mount.
- Touch USB device path must remain stable after reboot.
- Multi-display mapping must bind EDID/USB touch identity so T1 touches cannot control T2 incorrectly.
- Consumer portable screens with built-in batteries are not approved by default for fixed terminals.

### 3.4 Printers

- Receipt printer uses Ethernet as preferred production interface; USB is approved fallback after soak tests.
- Tag printer media/ribbon combination is part of certification.
- Printer firmware and configured command language are pinned in hardware profile.
- Cash drawer pulse voltage/timing must match printer and drawer; no direct GPIO drawer drive.
- Generic “ESC/POS compatible” or “ZPL compatible” claims are insufficient.

### 3.5 Scanner

- Scanner must be configured to a known USB HID profile with suffix/terminator defined by the KitLuy adapter.
- Disable scanner features that emit control sequences or unexpected keyboard shortcuts.
- Test Code 128, QR, damaged tags, screen-presented QR and rapid duplicate scans.

### 3.6 Scale

- RS-232 is the primary baseline for deterministic readings.
- Exact serial settings and stable-reading protocol must be captured in the hardware profile.
- Legal-for-trade/calibration obligations in Cambodia remain `[REQUIRED: legal and metrology determination]`.
- Manual fallback is permissioned and audited.
- The built-in scale display remains the customer/operator physical reference; KitLuy records raw, tare, stable value, unit and timestamp.

## 4. Hardware profile record

Every certified model requires:

```text
profile_id
class
manufacturer
exact_model
hardware_revision
serial/identifier method
firmware version
interface and cable
power requirements
driver/adapter ID and version
OS image and kernel
capabilities
known limitations
required configuration
certification evidence ID
certified_at / certified_by
pilot locations
retirement date
```

A change in hardware revision, USB chipset or firmware may require recertification even if the retail model name is unchanged.

## 5. Certification test suites

### 5.1 Common

- Cold boot, warm reboot and 100-cycle reboot.
- 72-hour soak under expected load.
- Power interruption and UPS transfer.
- USB/Ethernet disconnect/reconnect.
- Device identity stability.
- Kernel/driver logging and memory leak review.
- A/B application update and rollback.
- Khmer/English UI or printed content where applicable.
- Electromagnetic/power behavior reviewed against vendor compliance evidence.

### 5.2 Hub compute/storage

- PostgreSQL write/read and WAL stress.
- Filesystem integrity after 100 abrupt-power simulations using safe test rig.
- NVMe SMART/health collection.
- Thermal throttling test at Cambodia ambient target.
- Sustained sync/file/print workload.
- Secure boot, clone resistance and encrypted restore.

### 5.3 Receipt/tag printers

- 10,000-job reliability test.
- Network/USB reconnect.
- Paper-out, cover-open, cutter/media error.
- Duplicate-suppression/reprint workflow.
- Khmer glyph/image rendering.
- Tag adhesive, heat, moisture and Laundry-process durability.

### 5.4 Scanner

- 10,000 scans, rapid scans and duplicate scans.
- 1D/2D symbologies used by KitLuy.
- Low-contrast/damaged/curved tags.
- Screen QR and printed QR.
- USB reconnect and wrong-device detection.

### 5.5 Scale

- Zero/tare, repeatability and stability.
- 0%, 10%, 50%, 100% capacity test weights.
- Serial disconnect and malformed frames.
- Battery/AC behavior.
- Manual fallback and audit.
- Calibration seal/process review.

## 6. Certification evidence status table

| Evidence ID  | Model                        | HW revision  | Firmware     | OS image     | Result  | Approved by  |
| ------------ | ---------------------------- | ------------ | ------------ | ------------ | ------- | ------------ |
| `[REQUIRED]` | Raspberry Pi 5 8GB + SSD Kit | `[REQUIRED]` | `[REQUIRED]` | `[REQUIRED]` | Pending | `[REQUIRED]` |
| `[REQUIRED]` | Waveshare 15.6 HDMI LCD (H)  | `[REQUIRED]` | `[REQUIRED]` | `[REQUIRED]` | Pending | `[REQUIRED]` |
| `[REQUIRED]` | Epson TM-T20III              | `[REQUIRED]` | `[REQUIRED]` | `[REQUIRED]` | Pending | `[REQUIRED]` |
| `[REQUIRED]` | TSC TE210                    | `[REQUIRED]` | `[REQUIRED]` | `[REQUIRED]` | Pending | `[REQUIRED]` |
| `[REQUIRED]` | Zebra DS2208                 | `[REQUIRED]` | `[REQUIRED]` | `[REQUIRED]` | Pending | `[REQUIRED]` |
| `[REQUIRED]` | Adam GBK-S 32                | `[REQUIRED]` | `[REQUIRED]` | `[REQUIRED]` | Pending | `[REQUIRED]` |

## 7. Substitution policy

- No substitute is accepted by brand family alone.
- Fleet/Admin must select a registered hardware profile.
- Emergency substitution requires HET engineering approval, limited Location scope, expiration date and visible `CONDITIONAL` state.
- A substitution affecting money, weight, custody, printing or device trust requires full applicable certification tests.
- Generic marketplace hardware is rejected until profiled.

## 8. External verification baseline

Product selection was checked on 2026-07-26 against official manufacturer product/support material for Raspberry Pi 5, Raspberry Pi SSD Kit/M.2 HAT+/27W PSU, APC BX750MI family, Waveshare HDMI touch displays, Epson TM-T20III Linux support, TSC TE210, Zebra DS2208, Adam Equipment GBK-S 32, APG Vasario and TP-Link UE300. External vendor statements do not replace KitLuy certification evidence.
