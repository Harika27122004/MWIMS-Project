# MWIMS-Project
🏥 Medical Warehouse Inventory System

📋 Overview

This project implements a Medical Warehouse Inventory System that monitors environmental conditions using an Arduino/ESP32 with a DHT11 temperature 🌡️ and humidity 💧 sensor. The sensor data is streamed to a backend server for processing, storage, and visualization. The system helps maintain safe storage conditions by tracking temperature and humidity continuously.

🧩 Components

Arduino/ESP32 Code: Reads temperature and humidity from the DHT11 sensor and sends data serially to the backend.

Backend (backend.js): Node.js application that receives sensor data, processes it, stores it, and interfaces with the frontend.

Frontend (index.html): User interface to visualize inventory data and environmental sensor readings 📊.

Database Schema (schema.sql): SQL schema to create tables and store inventory and sensor data 🗄️.

🔧 Hardware Requirements

Arduino or ESP32 microcontroller

DHT11 temperature and humidity sensor

Connecting wires 🔌

USB cable for communication with backend

💻 Software Requirements

Arduino IDE with libraries:

Adafruit DHT sensor library

Adafruit Unified Sensor library

Node.js for running backend.js

Database system compatible with schema.sql (e.g., MySQL, PostgreSQL) 🛢️

⚙️ Installation and Setup

Arduino Sensor Setup Connect DHT11 data pin to GPIO 2 on Arduino/ESP32.

Install required Arduino IDE libraries.

Upload the Arduino sensor code to your microcontroller.

Ensure serial baud rate is set to 9600 to match backend.

Backend Setup Install Node.js dependencies for backend.js.

Configure database connection.

Run backend.js to start processing Arduino serial data.

Frontend Setup Open index.html in a browser 🌐.

View real-time sensor data and manage inventory.

🚀 Usage Arduino sends temperature and humidity data every 2 seconds.

Backend parses and stores data alongside inventory info.

Frontend provides a dashboard for warehouse environment monitoring.

🛠 Troubleshooting

Match baud rates of Arduino and backend serial communication.

Check wiring and sensor connections.

Look for parsing errors in backend logs.

Verify the database is running and accessible.

📄 License

This project is provided as-is for educational and development use.
