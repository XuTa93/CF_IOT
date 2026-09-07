/**
 * @file ModbusMaster.h
 * Lightweight, non-blocking Modbus RTU Master (Client/Poll) for ESP32-S3 HardwareSerial
 * Features:
 *   - Periodic FC03 polling of Holding Registers (Current Temp, Min, Max, etc.)
 *   - Instant FC06 writing on Rotary Encoder rotation or Button reset
 *   - Automatic CRC-16 generation and verification
 *   - Direct callback to sync with LVGL LCD UI
 */

#pragma once
#include <Arduino.h>

// Định nghĩa thanh ghi Modbus (Holding Registers)
#define MB_REG_TEMP_CURRENT  0 // 40001: Nhiệt độ hiện tại x10 (ví dụ 85.4°C -> 854)
#define MB_REG_TEMP_MIN      1 // 40002: Ngưỡng Min (20 ~ 120°C)
#define MB_REG_TEMP_MAX      2 // 40003: Ngưỡng Max (40 ~ 140°C)
#define MB_REG_ALARM_STATUS  3 // 40004: Trạng thái (0: Bình thường, 1: Dưới Min, 2: Quá nhiệt)
#define MB_REG_ENC1_PULSES   4 // 40005: Xung Encoder 1 (P2 - Min)
#define MB_REG_ENC2_PULSES   5 // 40006: Xung Encoder 2 (P3 - Max)

class ModbusMaster {
public:
    typedef void (*OnDataCallback)(uint16_t start_addr, const int16_t *data, uint16_t count);

    ModbusMaster(uint8_t target_slave_id = 1)
        : _target_slave_id(target_slave_id), _serial(nullptr), _on_data_cb(nullptr),
          _poll_interval_ms(500), _last_poll_time(0), _state(STATE_IDLE),
          _req_start_addr(0), _req_quantity(5), _rx_index(0), _req_time(0),
          _successful_polls(0), _failed_polls(0) {
    }

    void begin(HardwareSerial *serial, uint8_t target_slave_id = 1, uint32_t poll_interval_ms = 500, OnDataCallback on_data = nullptr) {
        _serial = serial;
        _target_slave_id = target_slave_id;
        _poll_interval_ms = poll_interval_ms;
        _on_data_cb = on_data;
        _state = STATE_IDLE;
        _rx_index = 0;
        _last_poll_time = millis();
    }

    void setTargetSlaveId(uint8_t id) {
        _target_slave_id = id;
    }

    void setPollInterval(uint32_t interval_ms) {
        _poll_interval_ms = interval_ms;
    }

    // Gửi lệnh FC06 ghi 1 thanh ghi xuống Modbus Slave (ModSim32 trên PC)
    bool writeSingleRegister(uint16_t reg_addr, int16_t val) {
        if (!_serial) return false;
        uint8_t frame[8];
        frame[0] = _target_slave_id;
        frame[1] = 0x06; // FC06: Write Single Register
        frame[2] = (reg_addr >> 8) & 0xFF;
        frame[3] = reg_addr & 0xFF;
        frame[4] = (val >> 8) & 0xFF;
        frame[5] = val & 0xFF;
        uint16_t crc = calculateCRC(frame, 6);
        frame[6] = crc & 0xFF;
        frame[7] = (crc >> 8) & 0xFF;

        _serial->write(frame, 8);
        _serial->flush();
        Serial.printf("[Modbus Master Poll] -> Gửi FC06 ghi thanh ghi 4%04d = %d\n", reg_addr + 1, val);
        return true;
    }

    void task() {
        if (!_serial) return;

        // Đọc toàn bộ byte đang có trong bộ đệm Serial
        while (_serial->available()) {
            uint8_t b = _serial->read();
            if (_rx_index < sizeof(_rx_buf)) {
                _rx_buf[_rx_index++] = b;
            }
        }

        uint32_t now = millis();

        switch (_state) {
            case STATE_IDLE:
                if (now - _last_poll_time >= _poll_interval_ms) {
                    sendReadRequest(_req_start_addr, _req_quantity);
                    _last_poll_time = now;
                    _req_time = now;
                    _state = STATE_WAITING_REPLY;
                }
                break;

            case STATE_WAITING_REPLY: {
                uint16_t expected_len = 3 + _req_quantity * 2 + 2; // ID + FC + ByteCount + Data + CRC
                if (_rx_index >= expected_len) {
                    // Kiểm tra phản hồi FC03 từ Slave
                    if (_rx_buf[0] == _target_slave_id && _rx_buf[1] == 0x03) {
                        uint16_t rx_crc = _rx_buf[expected_len - 2] | (_rx_buf[expected_len - 1] << 8);
                        if (rx_crc == calculateCRC(_rx_buf, expected_len - 2)) {
                            _successful_polls++;
                            int16_t vals[16];
                            for (uint16_t i = 0; i < _req_quantity && i < 16; i++) {
                                vals[i] = (_rx_buf[3 + i * 2] << 8) | _rx_buf[3 + i * 2 + 1];
                            }
                            if (_on_data_cb) {
                                _on_data_cb(_req_start_addr, vals, _req_quantity);
                            }
                        } else {
                            _failed_polls++;
                            Serial.printf("[Modbus Master] Lỗi CRC phản hồi từ Slave (0x%04X != 0x%04X)\n",
                                          rx_crc, calculateCRC(_rx_buf, expected_len - 2));
                        }
                    } else if (_rx_buf[0] == _target_slave_id && (_rx_buf[1] & 0x80)) {
                        // Modbus Exception từ Slave
                        Serial.printf("[Modbus Master] Slave phản hồi Exception FC 0x%02X, Mã 0x%02X\n", _rx_buf[1], _rx_buf[2]);
                        _failed_polls++;
                    }
                    _rx_index = 0;
                    _state = STATE_IDLE;
                } else if (now - _req_time > 300) { // Timeout 300ms không có phản hồi
                    _failed_polls++;
                    _rx_index = 0;
                    _state = STATE_IDLE;
                }
                break;
            }
        }
    }

    uint32_t getSuccessfulPolls() const { return _successful_polls; }
    uint32_t getFailedPolls() const { return _failed_polls; }

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

private:
    enum State { STATE_IDLE, STATE_WAITING_REPLY };

    uint8_t _target_slave_id;
    HardwareSerial *_serial;
    OnDataCallback _on_data_cb;
    uint32_t _poll_interval_ms;
    uint32_t _last_poll_time;
    State _state;
    uint16_t _req_start_addr;
    uint16_t _req_quantity;
    uint8_t _rx_buf[128];
    uint16_t _rx_index;
    uint32_t _req_time;
    uint32_t _successful_polls;
    uint32_t _failed_polls;

    void sendReadRequest(uint16_t start_addr, uint16_t quantity) {
        _rx_index = 0;
        uint8_t frame[8];
        frame[0] = _target_slave_id;
        frame[1] = 0x03; // Read Holding Registers
        frame[2] = (start_addr >> 8) & 0xFF;
        frame[3] = start_addr & 0xFF;
        frame[4] = (quantity >> 8) & 0xFF;
        frame[5] = quantity & 0xFF;
        uint16_t crc = calculateCRC(frame, 6);
        frame[6] = crc & 0xFF;
        frame[7] = (crc >> 8) & 0xFF;

        // Xóa byte rác trong bộ đệm nhận trước khi phát lệnh mới
        while (_serial->available()) _serial->read();

        _serial->write(frame, 8);
        _serial->flush();
    }
};
