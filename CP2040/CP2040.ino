#include <Adafruit_NeoPixel.h>

#define LED_PIN      16
#define NUM_LEDS     1
Adafruit_NeoPixel strip(NUM_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);

// --- CẤU HÌNH CHÂN ENCODER ---
const int ENC1_A  = 0; 
const int ENC1_SW = 1; 
const int ENC1_B  = 2; 

const int ENC2_A  = 3; 
const int ENC2_SW = 4; 
const int ENC2_B  = 5; 

// --- CẤU HÌNH CHÂN UART TRUYỀN SANG ESP32 ---
const int UART_TX = 12; // GP12 nối vào RX2 (GPIO16) của ESP32
const int UART_RX = 13; // GP13 nối vào TX2 (GPIO17) của ESP32

volatile int enc1_value = 0;
volatile int enc2_value = 0;
const int THRESHOLD     = 10;

unsigned long lastActivityTime = 0;
const unsigned long ACTION_TIMEOUT = 1000; 
const unsigned long LIGHT_TIMEOUT  = 3000; 

enum LedActionState { IDLE, ENC1_INC, ENC1_DEC, ENC2_INC, ENC2_DEC };
volatile LedActionState currentAction = IDLE;

unsigned long lastDebounce1 = 0, lastDebounce2 = 0;
const unsigned long debounceDelay = 50;
bool btn1_pressed = false, btn2_pressed = false;

volatile uint8_t enc1_prevState = 0;
volatile uint8_t enc2_prevState = 0;

void setup() {
  Serial.begin(115200); // Serial USB debug với PC

  // Khởi tạo UART1 để truyền dữ liệu sang ESP32 với tốc độ 115200 baud
  Serial1.setTX(UART_TX);
  Serial1.setRX(UART_RX);
  Serial1.begin(115200);

  strip.begin();
  strip.setBrightness(40);
  
  pinMode(ENC1_A, INPUT_PULLUP);
  pinMode(ENC1_B, INPUT_PULLUP);
  pinMode(ENC1_SW, INPUT_PULLUP);

  pinMode(ENC2_A, INPUT_PULLUP);
  pinMode(ENC2_B, INPUT_PULLUP);
  pinMode(ENC2_SW, INPUT_PULLUP);

  enc1_prevState = (digitalRead(ENC1_A) << 1) | digitalRead(ENC1_B);
  enc2_prevState = (digitalRead(ENC2_A) << 1) | digitalRead(ENC2_B);

  attachInterrupt(digitalPinToInterrupt(ENC1_A), handleEncoder1, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENC1_B), handleEncoder1, CHANGE);

  attachInterrupt(digitalPinToInterrupt(ENC2_A), handleEncoder2, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENC2_B), handleEncoder2, CHANGE);

  lastActivityTime = millis();
  updateLED();
}

void loop() {
  // --- NÚT BẤM ---
  if (digitalRead(ENC1_SW) == LOW) {
    if (!btn1_pressed && (millis() - lastDebounce1) > debounceDelay) {
      enc1_value = 0;
      sendDataToESP32(); // Gửi dữ liệu ngay khi reset
      btn1_pressed = true;
      lastDebounce1 = millis();
    }
  } else {
    btn1_pressed = false;
  }

  if (digitalRead(ENC2_SW) == LOW) {
    if (!btn2_pressed && (millis() - lastDebounce2) > debounceDelay) {
      enc2_value = 0;
      sendDataToESP32(); // Gửi dữ liệu ngay khi reset
      btn2_pressed = true;
      lastDebounce2 = millis();
    }
  } else {
    btn2_pressed = false;
  }

  // --- QUẢN LÝ XOAY & TRUYỀN DỮ LIỆU ---
  static int lastVal1 = -999, lastVal2 = -999;
  
  if (enc1_value != lastVal1 || enc2_value != lastVal2) {
    lastActivityTime = millis();
    updateLED();

    // GỬI DỮ LIỆU SANG ESP32
    sendDataToESP32();

    lastVal1 = enc1_value;
    lastVal2 = enc2_value;
  } 
  else if (currentAction != IDLE && (millis() - lastActivityTime > ACTION_TIMEOUT)) {
    currentAction = IDLE;
    updateLED();
  }
  else if (millis() - lastActivityTime > LIGHT_TIMEOUT) {
    strip.setPixelColor(0, strip.Color(0, 0, 0));
    strip.show();
  }
}

// Hàm đóng gói và gửi dữ liệu dạng định dạng text rõ ràng sang ESP32
void sendDataToESP32() {
  // Chuỗi định dạng: "E1:10,E2:-5\n"
  Serial1.print("E1:");
  Serial1.print(enc1_value);
  Serial1.print(",E2:");
  Serial1.println(enc2_value);

  // In ra máy tính để kiểm tra
  Serial.print("-> Da gui sang ESP32: ");
  Serial.print("E1:"); Serial.print(enc1_value);
  Serial.print(",E2:"); Serial.println(enc2_value);
}

void updateLED() {
  switch (currentAction) {
    case ENC1_INC: strip.setPixelColor(0, strip.Color(0, 0, 255)); break;
    case ENC1_DEC: strip.setPixelColor(0, strip.Color(0, 255, 255)); break;
    case ENC2_INC: strip.setPixelColor(0, strip.Color(255, 0, 255)); break;
    case ENC2_DEC: strip.setPixelColor(0, strip.Color(255, 100, 0)); break;
    case IDLE:
    default:
      bool act1 = (enc1_value >= THRESHOLD);
      bool act2 = (enc2_value >= THRESHOLD);
      if (act1 && act2) strip.setPixelColor(0, strip.Color(255, 255, 0));
      else if (act1) strip.setPixelColor(0, strip.Color(0, 255, 0));
      else if (act2) strip.setPixelColor(0, strip.Color(255, 0, 0));
      else strip.setPixelColor(0, strip.Color(0, 0, 0));
      break;
  }
  strip.show();
}

void handleEncoder1() {
  uint8_t currState = (digitalRead(ENC1_A) << 1) | digitalRead(ENC1_B);
  if (currState != enc1_prevState) {
    if ((enc1_prevState == 0b00 && currState == 0b01) || (enc1_prevState == 0b01 && currState == 0b11) ||
        (enc1_prevState == 0b11 && currState == 0b10) || (enc1_prevState == 0b10 && currState == 0b00)) {
      enc1_value++; currentAction = ENC1_INC;
    } else if ((enc1_prevState == 0b00 && currState == 0b10) || (enc1_prevState == 0b10 && currState == 0b11) ||
               (enc1_prevState == 0b11 && currState == 0b01) || (enc1_prevState == 0b01 && currState == 0b00)) {
      enc1_value--; currentAction = ENC1_DEC;
    }
    enc1_prevState = currState;
  }
}

void handleEncoder2() {
  uint8_t currState = (digitalRead(ENC2_A) << 1) | digitalRead(ENC2_B);
  if (currState != enc2_prevState) {
    if ((enc2_prevState == 0b00 && currState == 0b01) || (enc2_prevState == 0b01 && currState == 0b11) ||
        (enc2_prevState == 0b11 && currState == 0b10) || (enc2_prevState == 0b10 && currState == 0b00)) {
      enc2_value++; currentAction = ENC2_INC;
    } else if ((enc2_prevState == 0b00 && currState == 0b10) || (enc2_prevState == 0b10 && currState == 0b11) ||
               (enc2_prevState == 0b11 && currState == 0b01) || (enc2_prevState == 0b01 && currState == 0b00)) {
      enc2_value--; currentAction = ENC2_DEC;
    }
    enc2_prevState = currState;
  }
}