// Medical Warehouse Inventory System - Arduino/ESP32 DHT11 Sensor Code

// Include the necessary libraries for DHT sensor and Adafruit Unified Sensor
// You need to install these via Arduino IDE's Library Manager:
// 1. DHT sensor library by Adafruit
// 2. Adafruit Unified Sensor (DHT library depends on this)
#include <Adafruit_Sensor.h>
#include <DHT.h>
#include <DHT_U.h>

// Define the digital pin where the DHT11 data pin is connected
#define DHTPIN 2

// Define the type of DHT sensor you are using
// Uncomment the type you have:
#define DHTTYPE DHT11   // DHT 11
// #define DHTTYPE DHT22   // DHT 22  (AM2302)
// #define DHTTYPE DHT21   // DHT 21 (AM2301)

// Initialize DHT sensor object
DHT_Unified dht(DHTPIN, DHTTYPE);

// Define a delay between sensor readings (in milliseconds)
// This is important to prevent overwhelming the serial port and for sensor stability.
// 2000ms = 2 seconds. DHT11 needs at least 1 second between readings.
#define DELAY_MS 2000

void setup() {
  // Initialize serial communication at 9600 bits per second (baud rate)
  // This must match the baudRate set in your Node.js backend.
  Serial.begin(9600);
  Serial.println("DHT11 Sensor Reading Started...");

  // Initialize DHT sensor
  dht.begin();
  Serial.println("DHT Sensor initialized.");

  // Print sensor details (optional, for debugging)
  sensor_t sensor;
  dht.temperature().getSensor(&sensor);
  Serial.println("------------------------------------");
  Serial.print("Sensor:       "); Serial.println(sensor.name);
  Serial.print("Driver Ver:   "); Serial.println(sensor.version);
  Serial.print("Unique ID:    "); Serial.println(sensor.sensor_id);
  Serial.print("Max Value:    "); Serial.print(sensor.max_value); Serial.println(" C");
  Serial.print("Min Value:    "); Serial.print(sensor.min_value); Serial.println(" C");
  Serial.print("Resolution:   "); Serial.print(sensor.resolution); Serial.println(" C");
  Serial.println("------------------------------------");
  dht.humidity().getSensor(&sensor);
  Serial.print("Sensor:       "); Serial.println(sensor.name);
  Serial.print("Driver Ver:   "); Serial.println(sensor.version);
  Serial.print("Unique ID:    "); Serial.println(sensor.sensor_id);
  Serial.print("Max Value:    "); Serial.print(sensor.max_value); Serial.println(" %");
  Serial.print("Min Value:    "); Serial.print(sensor.min_value); Serial.println(" %");
  Serial.print("Resolution:   "); Serial.print(sensor.resolution); Serial.println(" %");
  Serial.println("------------------------------------");
}

void loop() {
  // Delay between measurements.
  delay(DELAY_MS);

  // Get temperature event and print its value.
  sensors_event_t event;
  dht.temperature().getEvent(&event);

  float temperature = 0.0;
  if (isnan(event.temperature)) {
    Serial.println("Error reading temperature!");
  } else {
    temperature = event.temperature;
    // Serial.print("Temperature: ");
    // Serial.print(temperature);
    // Serial.println(" *C");
  }

  // Get humidity event and print its value.
  dht.humidity().getEvent(&event);

  float humidity = 0.0;
  if (isnan(event.relative_humidity)) {
    Serial.println("Error reading humidity!");
  } else {
    humidity = event.relative_humidity;
    // Serial.print("Humidity: ");
    // Serial.print(humidity);
    // Serial.println(" %");
  }

  // Send data to serial port in "temperature,humidity" format, followed by a newline.
  // This format is expected by the Node.js backend parser.
  if (!isnan(temperature) && !isnan(humidity)) {
    Serial.print(temperature);
    Serial.print(",");
    Serial.println(humidity);
  }
}
