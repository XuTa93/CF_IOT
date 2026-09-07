/**
 * @file ModbusSlave.h
 * Lightweight, rock-solid Modbus RTU & ASCII Slave (Server) for ESP32-S3 HardwareSerial
 * Supports:
 *   - Auto-detect Modbus RTU & Modbus ASCII
 *   - FC03 (Read Holding Registers)
 *   - FC04 (Read Input Registers)
 *   - FC06 (Write Single Register)
 *   - FC16 (Write Multiple Registers)
 *   - Zero-latency immediate frame response (< 1ms)
 *   - Detailed serial diagnostic logging on COM9
 */

#pragma once
#include <Arduino.h>

// Định nghĩa chỉ số các thanh ghi (Offsets)
#define MB_REG_TEMP_CURRENT  0 // 40001: Nhiệt độ hiện tại x10 (ví dụ 85.4°C -> 854)
#define MB_REG_TEMP_MIN      1 // 40002: Ngưỡng Min (20 ~ 120°C)
#define MB_REG_TEMP_MAX      2 // 40003: Ngưỡng Max (40 ~ 140°C)
#define MB_REG_ALARM_STATUS  3 // 40004: Trạng thái (0: Bình thường, 1: Dưới Min, 2: Quá nhiệt)
#define MB_REG_ENC1_PULSES   4 // 40005: Xung Encoder 1 (P2 - Min)
#define MB_REG_ENC2_PULSES   5 // 40006: Xung Encoder 2 (P3 - Max)

class ModbusSlave {
public:
    typedef void (*OnWriteCallback)(uint16_t reg_addr, int16_t val);

    ModbusSlave(uint8_t slave_id = 1) 
        : _slave_id(slave_id), _serial(nullptr), _on_write_cb(nullptr), _rx_index(0), _last_rx_time(0) {
        memset(_registers, 0, sizeof(_registers));
    }

    void begin(HardwareSerial *serial, uint8_t slave_id = 1, OnWriteCallback on_write = nullptr) {
        _serial = serial;
        _slave_id = slave_id;
        _on_write_cb = on_write;
        _rx_index = 0;
        _last_rx_time = 0;
    }

    void setRegister(uint16_t addr, int16_t val) {
        if (addr < NUM_REGISTERS) {
            _registers[addr] = val;
        }
    }

    int16_t getRegister(uint16_t addr) const {
        if (addr < NUM_REGISTERS) {
            return _registers[addr];
        }
        return 0;
    }

    void task() {
        if (!_serial) return;

        while (_serial->available()) {
            uint8_t b = _serial->read();
            if (_rx_index < sizeof(_rx_buf)) {
                _rx_buf[_rx_index++] = b;
            }
            _last_rx_time = micros();

            // 1. Kiểm tra nếu là gói Modbus ASCII (bắt đầu bằng ':')
            if (_rx_buf[0] == ':') {
                if (b == '\n' || b == '\r') {
                    if (_rx_index >= 9) { // Tối thiểu : + ID(2) + FC(2) + LRC(2) + \r
                        processAsciiFrame();
                    }
                    _rx_index = 0;
                    return;
                }
            } else {
                // 2. Kiểm tra gói Modbus RTU ngay khi đủ độ dài chuẩn (Phản hồi tức thì < 1ms)
                if (_rx_index == 8 && (_rx_buf[1] == 0x03 || _rx_buf[1] == 0x04 || _rx_buf[1] == 0x06)) {
                    uint16_t recv_crc = _rx_buf[6] | (_rx_buf[7] << 8);
                    if (recv_crc == calculateCRC(_rx_buf, 6)) {
                        processRtuFrame();
                        _rx_index = 0;
                        return;
                    }
                } else if (_rx_buf[1] == 0x10 && _rx_index >= 9) {
                    uint16_t expected_len = 7 + _rx_buf[6] + 2;
                    if (_rx_index == expected_len) {
                        uint16_t recv_crc = _rx_buf[_rx_index - 2] | (_rx_buf[_rx_index - 1] << 8);
                        if (recv_crc == calculateCRC(_rx_buf, _rx_index - 2)) {
                            processRtuFrame();
                            _rx_index = 0;
                            return;
                        }
                    }
                }
            }
        }

        // Khoảng lặng Modbus RTU t3.5 (1.75ms tại 115200) -> 2.0ms dự phòng
        if (_rx_index > 0 && (micros() - _last_rx_time > 2000)) {
            if (_rx_buf[0] != ':') {
                if (_rx_index >= 4) {
                    processRtuFrame();
                }
            }
            _rx_index = 0;
        }
    }

    static uint16_t calculateCRC(const uint8_t *buf, uint16_t len) {
        uint16_t crc = 0xFFFF;
        for (uint16_t pos = 0; pos < len; pos++) {
            crc ^= (uint16_t)buf[pos];
            for (int i = 8; i != 0; i--) {
                if ((crc & 0x0001) != 0) {
                    crc >>= 1;
                    crc ^= 0xA001;
                } else {
                    crc >>= 1;
                }
            }
        }
        return crc;
    }

    static uint8_t calculateLRC(const uint8_t *buf, uint16_t len) {
        uint8_t sum = 0;
        for (uint16_t i = 0; i < len; i++) {
            sum += buf[i];
        }
        return (uint8_t)(-((int8_t)sum));
    }

private:
    static const uint16_t NUM_REGISTERS = 32;
    int16_t _registers[NUM_REGISTERS];
    uint8_t _slave_id;
    HardwareSerial *_serial;
    OnWriteCallback _on_write_cb;

    uint8_t _rx_buf[256];
    uint16_t _rx_index;
    uint32_t _last_rx_time;

    // --- XỬ LÝ KHUNG MODBUS RTU (BINARY) ---
    void processRtuFrame() {
        uint8_t id = _rx_buf[0];
        if (id != _slave_id && id != 0) {
            return;
        }

        uint16_t received_crc = _rx_buf[_rx_index - 2] | (_rx_buf[_rx_index - 1] << 8);
        uint16_t computed_crc = calculateCRC(_rx_buf, _rx_index - 2);
        if (received_crc != computed_crc) {
            Serial.printf("[Modbus RTU] Lỗi CRC (Nhận 0x%04X != Tính 0x%04X)\n", received_crc, computed_crc);
            return;
        }

        uint8_t fc = _rx_buf[1];
        switch (fc) {
            case 0x03:
            case 0x04:
                handleReadRtu(fc);
                break;
            case 0x06:
                handleWriteSingleRtu();
                break;
            case 0x10:
                handleWriteMultipleRtu();
                break;
            default:
                sendExceptionRtu(fc, 0x01);
                break;
        }
    }

    void handleReadRtu(uint8_t fc) {
        if (_rx_index < 8) return;
        uint16_t start_addr = (_rx_buf[2] << 8) | _rx_buf[3];
        uint16_t quantity = (_rx_buf[4] << 8) | _rx_buf[5];

        if (quantity < 1 || quantity > 125 || (start_addr + quantity) > NUM_REGISTERS) {
            sendExceptionRtu(fc, 0x02);
            return;
        }

        uint8_t byte_count = quantity * 2;
        uint8_t resp[256];
        resp[0] = _slave_id;
        resp[1] = fc;
        resp[2] = byte_count;

        for (uint16_t i = 0; i < quantity; i++) {
            int16_t reg_val = _registers[start_addr + i];
            resp[3 + i * 2]     = (reg_val >> 8) & 0xFF;
            resp[3 + i * 2 + 1] = reg_val & 0xFF;
        }

        uint16_t crc = calculateCRC(resp, 3 + byte_count);
        resp[3 + byte_count]     = crc & 0xFF;
        resp[3 + byte_count + 1] = (crc >> 8) & 0xFF;

        _serial->write(resp, 5 + byte_count);
        _serial->flush();

        Serial.printf("[Modbus RTU] Master đọc FC%02d: %d thanh ghi từ 4%04d\n", fc, quantity, start_addr + 1);
    }

    void handleWriteSingleRtu() {
        if (_rx_index < 8) return;
        uint16_t reg_addr = (_rx_buf[2] << 8) | _rx_buf[3];
        int16_t reg_val   = (_rx_buf[4] << 8) | _rx_buf[5];

        if (reg_addr >= NUM_REGISTERS) {
            sendExceptionRtu(0x06, 0x02);
            return;
        }

        _registers[reg_addr] = reg_val;
        _serial->write(_rx_buf, 8);
        _serial->flush();

        Serial.printf("[Modbus RTU] Master GHI FC06: Thanh ghi 4%04d = %d\n", reg_addr + 1, reg_val);

        if (_on_write_cb) {
            _on_write_cb(reg_addr, reg_val);
        }
    }

    void handleWriteMultipleRtu() {
        if (_rx_index < 9) return;
        uint16_t start_addr = (_rx_buf[2] << 8) | _rx_buf[3];
        uint16_t quantity   = (_rx_buf[4] << 8) | _rx_buf[5];
        uint8_t byte_count  = _rx_buf[6];

        if (quantity < 1 || (start_addr + quantity) > NUM_REGISTERS || byte_count != quantity * 2) {
            sendExceptionRtu(0x10, 0x02);
            return;
        }

        for (uint16_t i = 0; i < quantity; i++) {
            int16_t val = (_rx_buf[7 + i * 2] << 8) | _rx_buf[7 + i * 2 + 1];
            _registers[start_addr + i] = val;
            if (_on_write_cb) {
                _on_write_cb(start_addr + i, val);
            }
        }

        uint8_t resp[8];
        resp[0] = _slave_id;
        resp[1] = 0x10;
        resp[2] = _rx_buf[2];
        resp[3] = _rx_buf[3];
        resp[4] = _rx_buf[4];
        resp[5] = _rx_buf[5];
        uint16_t crc = calculateCRC(resp, 6);
        resp[6] = crc & 0xFF;
        resp[7] = (crc >> 8) & 0xFF;

        _serial->write(resp, 8);
        _serial->flush();

        Serial.printf("[Modbus RTU] Master GHI FC16: %d thanh ghi từ 4%04d\n", quantity, start_addr + 1);
    }

    void sendExceptionRtu(uint8_t fc, uint8_t exc_code) {
        uint8_t resp[5];
        resp[0] = _slave_id;
        resp[1] = fc | 0x80;
        resp[2] = exc_code;
        uint16_t crc = calculateCRC(resp, 3);
        resp[3] = crc & 0xFF;
        resp[4] = (crc >> 8) & 0xFF;

        _serial->write(resp, 5);
        _serial->flush();
        Serial.printf("[Modbus RTU] Lỗi Exception: FC 0x%02X, Mã: 0x%02X\n", fc, exc_code);
    }

    // --- XỬ LÝ KHUNG MODBUS ASCII (TEXT) ---
    static int8_t hexCharToNibble(char c) {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        return -1;
    }

    void processAsciiFrame() {
        // Khung bắt đầu bằng ':', theo sau là các cặp ký tự Hex
        uint8_t bin_buf[128];
        uint16_t bin_len = 0;

        for (uint16_t i = 1; i + 1 < _rx_index; i += 2) {
            char c1 = (char)_rx_buf[i];
            char c2 = (char)_rx_buf[i + 1];
            if (c1 == '\r' || c1 == '\n') break;
            int8_t n1 = hexCharToNibble(c1);
            int8_t n2 = hexCharToNibble(c2);
            if (n1 < 0 || n2 < 0) break;
            if (bin_len < sizeof(bin_buf)) {
                bin_buf[bin_len++] = (uint8_t)((n1 << 4) | n2);
            }
        }

        if (bin_len < 3) return; // ID, FC, LRC

        // Kiểm tra LRC (Tổng tất cả byte bao gồm LRC phải bằng 0)
        uint8_t sum = 0;
        for (uint16_t i = 0; i < bin_len; i++) sum += bin_buf[i];
        if (sum != 0) {
            Serial.println("[Modbus ASCII] Lỗi LRC Checksum!");
            return;
        }

        uint8_t id = bin_buf[0];
        if (id != _slave_id && id != 0) return;

        uint8_t fc = bin_buf[1];
        if (fc == 0x03 || fc == 0x04) {
            uint16_t start_addr = (bin_buf[2] << 8) | bin_buf[3];
            uint16_t quantity   = (bin_buf[4] << 8) | bin_buf[5];
            if (quantity < 1 || (start_addr + quantity) > NUM_REGISTERS) return;

            uint8_t resp_bin[128];
            resp_bin[0] = _slave_id;
            resp_bin[1] = fc;
            resp_bin[2] = quantity * 2;
            for (uint16_t i = 0; i < quantity; i++) {
                int16_t reg_val = _registers[start_addr + i];
                resp_bin[3 + i * 2]     = (reg_val >> 8) & 0xFF;
                resp_bin[3 + i * 2 + 1] = reg_val & 0xFF;
            }
            uint8_t resp_bin_len = 3 + quantity * 2;
            resp_bin[resp_bin_len] = calculateLRC(resp_bin, resp_bin_len);
            resp_bin_len++;

            // Gửi chuỗi ASCII
            _serial->print(':');
            for (uint16_t i = 0; i < resp_bin_len; i++) {
                if (resp_bin[i] < 16) _serial->print('0');
                _serial->print(resp_bin[i], HEX);
            }
            _serial->print("\r\n");
            _serial->flush();
            Serial.printf("[Modbus ASCII] Đã phản hồi FC%02d: %d thanh ghi\n", fc, quantity);
        } else if (fc == 0x06) {
            uint16_t reg_addr = (bin_buf[2] << 8) | bin_buf[3];
            int16_t reg_val   = (bin_buf[4] << 8) | bin_buf[5];
            if (reg_addr < NUM_REGISTERS) {
                _registers[reg_addr] = reg_val;
                // Echo lại khung ASCII
                uint8_t resp_bin[6] = {_slave_id, 0x06, bin_buf[2], bin_buf[3], bin_buf[4], bin_buf[5]};
                uint8_t lrc = calculateLRC(resp_bin, 6);
                _serial->print(':');
                for (int i = 0; i < 6; i++) {
                    if (resp_bin[i] < 16) _serial->print('0');
                    _serial->print(resp_bin[i], HEX);
                }
                if (lrc < 16) _serial->print('0');
                _serial->print(lrc, HEX);
                _serial->print("\r\n");
                _serial->flush();

                Serial.printf("[Modbus ASCII] Master GHI FC06: Thanh ghi 4%04d = %d\n", reg_addr + 1, reg_val);
                if (_on_write_cb) _on_write_cb(reg_addr, reg_val);
            }
        }
    }
};
