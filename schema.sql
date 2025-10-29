-- Drop database if it exists (for a clean start)
DROP DATABASE IF EXISTS my_project;

-- Create the database
CREATE DATABASE my_project;

-- Use the newly created database
USE my_project;

-- Table for Products
CREATE TABLE products (
    product_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    manufacturer VARCHAR(255),
    category ENUM('Ambient', 'Cold Storage') NOT NULL,
    price DECIMAL(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table for Storage Locations
CREATE TABLE storage_locations (
    location_id INT AUTO_INCREMENT PRIMARY KEY,
    zone VARCHAR(50) NOT NULL,
    rack VARCHAR(50) NOT NULL,
    slot VARCHAR(50) NOT NULL,
    location_type ENUM('Ambient', 'Cold Storage') NOT NULL,
    size_type VARCHAR(50), -- e.g., Small, Medium, Large
    capacity INT NOT NULL,
    current_occupancy INT DEFAULT 0,
    min_temp DECIMAL(5, 2), -- Required for Cold Storage
    max_temp DECIMAL(5, 2), -- Required for Cold Storage
    latest_temperature DECIMAL(5, 2), -- Stores the last recorded temperature
    last_temp_update TIMESTAMP, -- Stores when the latest_temperature was updated
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(zone, rack, slot) -- Ensure unique location identifier
);

-- Table for Batches (Inventory)
CREATE TABLE batches (
    batch_id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    batch_number VARCHAR(255) NOT NULL UNIQUE,
    manufacture_date DATE,
    expiry_date DATE NOT NULL,
    quantity INT NOT NULL,
    barcode VARCHAR(255) UNIQUE, -- Stores the barcode value, defaults to batch_number if not provided
    assigned_location_id INT, -- Foreign key to storage_locations
    status ENUM('Available', 'Picked', 'Dispatched', 'Expired', 'Damaged') DEFAULT 'Available',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT,
    FOREIGN KEY (assigned_location_id) REFERENCES storage_locations(location_id) ON DELETE RESTRICT
);

-- Table for Orders
CREATE TABLE orders (
    order_id INT AUTO_INCREMENT PRIMARY KEY,
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('Pending', 'Completed', 'Dispatched', 'Cancelled') DEFAULT 'Pending'
);

-- Table for Order Items (details of what was ordered)
CREATE TABLE order_items (
    order_item_id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT
);

-- Table for Order Batch Picks (linking order items to specific batches used)
CREATE TABLE order_batch_picks (
    pick_id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    batch_id INT NOT NULL,
    quantity_picked INT NOT NULL,
    status ENUM('Pending Pick', 'Picked', 'Dispatched') DEFAULT 'Pending Pick',
    picked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (batch_id) REFERENCES batches(batch_id) ON DELETE CASCADE,
    UNIQUE(order_id, batch_id) -- A batch can only be picked once per order
);

-- Table for Dispatches (records when orders physically leave the warehouse)
CREATE TABLE dispatches (
    dispatch_id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL UNIQUE,
    dispatched_by VARCHAR(255) NOT NULL,
    dispatch_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
);

-- Table for Temperature Logs (historical sensor data or manual logs)
CREATE TABLE temperature_logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    location_id INT NOT NULL,
    temperature_reading DECIMAL(5, 2) NOT NULL,
    humidity_reading DECIMAL(5, 2), -- Optional, useful for DHT sensors
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (location_id) REFERENCES storage_locations(location_id) ON DELETE CASCADE
);

-- Sample Data Inserts

-- Sample Products
INSERT INTO products (name, description, manufacturer, category, price) VALUES
('Flu Vaccine (Seasonal)', 'Influenza vaccine, 0.5ml single dose', 'Vaccine Inc.', 'Cold Storage', 25.50),
('Insulin Pens', 'Pre-filled insulin pens, various types', 'PharmaCo', 'Cold Storage', 40.00),
('Surgical Gloves (Latex Free)', 'Medium size, box of 100', 'MediSupplies', 'Ambient', 12.75),
('Bandages (Assorted)', 'Various sizes, waterproof', 'FirstAidPro', 'Ambient', 8.99),
('Pain Relievers (Tablets)', '500mg, bottle of 100', 'HealthMeds', 'Ambient', 7.20),
('Growth Hormone', 'Injectable solution, vial', 'BioCorp', 'Cold Storage', 150.00),
('Antibiotic Syrup (Pediatric)', 'Oral suspension, 100ml bottle', 'KidCare Pharma', 'Ambient', 15.00),
('Syringes (Disposable)', '3ml, sterile, box of 100', 'ClinicGear', 'Ambient', 9.50);

-- Sample Storage Locations (ensure these match your Arduino SENSOR_LOCATION_ID if you re-enable it later)
INSERT INTO storage_locations (zone, rack, slot, location_type, size_type, capacity, current_occupancy, min_temp, max_temp, latest_temperature, last_temp_update) VALUES
('Ambient_A', 'AR1', 'AS1', 'Ambient', 'Large', 200, 0, NULL, NULL, NULL, NULL),
('Ambient_A', 'AR1', 'AS2', 'Ambient', 'Medium', 150, 0, NULL, NULL, NULL, NULL),
('Ambient_B', 'AR2', 'BS1', 'Ambient', 'Large', 200, 0, NULL, NULL, NULL, NULL),
('Ambient_B', 'AR2', 'BS2', 'Ambient', 'Small', 100, 0, NULL, NULL, NULL, NULL),
('Cold_A', 'CR1', 'CS1', 'Cold Storage', 'Large', 80, 0, 2.0, 8.0, 5.5, NOW()),
(105, 'Cold_A', 'CR1', 'CS2', 'Cold Storage', 'Small', 50, 0, 2.0, 8.0, 4.2, NOW()), -- This location_id 105 corresponds to Arduino sketch
('Cold_B', 'CR2', 'CS1', 'Cold Storage', 'Medium', 70, 0, -2.0, 4.0, 1.8, NOW()),
('Cold_B', 'CR2', 'CS2', 'Cold Storage', 'Small', 40, 0, -2.0, 4.0, 0.5, NOW());


-- Sample Batches (some pre-assigned to locations, some with low stock/expiry issues)
INSERT INTO batches (product_id, batch_number, manufacture_date, expiry_date, quantity, barcode, assigned_location_id, status) VALUES
((SELECT product_id FROM products WHERE name = 'Surgical Gloves (Latex Free)'), 'GLOVE-001', '2024-01-01', '2025-12-31', 100, 'GLOVE-001', (SELECT location_id FROM storage_locations WHERE zone = 'Ambient_A' AND rack = 'AR1' AND slot = 'AS1'), 'Available'),
((SELECT product_id FROM products WHERE name = 'Bandages (Assorted)'), 'BAND-005', '2024-03-15', '2025-07-20', 5, 'BAND-005', (SELECT location_id FROM storage_locations WHERE zone = 'Ambient_B' AND rack = 'AR2' AND slot = 'BS2'), 'Available'), -- Low Stock
((SELECT product_id FROM products WHERE name = 'Pain Relievers (Tablets)'), 'PAIN-010', '2023-05-01', '2025-06-15', 20, 'PAIN-010', (SELECT location_id FROM storage_locations WHERE zone = 'Ambient_A' AND rack = 'AR1' AND slot = 'AS2'), 'Available'), -- Expiring Soon
((SELECT product_id FROM products WHERE name = 'Flu Vaccine (Seasonal)'), 'FLUVAX-003', '2024-02-10', '2025-05-01', 30, 'FLUVAX-003', (SELECT location_id FROM storage_locations WHERE zone = 'Cold_A' AND rack = 'CR1' AND slot = 'CS1'), 'Available'), -- Expired (for testing)
((SELECT product_id FROM products WHERE name = 'Insulin Pens'), 'INSULIN-007', '2024-04-20', '2026-03-30', 45, 'INSULIN-007', (SELECT location_id FROM storage_locations WHERE zone = 'Cold_A' AND rack = 'CR1' AND slot = 'CS2'), 'Available'),
((SELECT product_id FROM products WHERE name = 'Syringes (Disposable)'), 'SYRINGE-200', '2024-06-01', '2027-01-01', 80, 'SYRINGE-200', (SELECT location_id FROM storage_locations WHERE zone = 'Ambient_B' AND rack = 'AR2' AND slot = 'BS1'), 'Available');

-- Update current_occupancy for initial batches
UPDATE storage_locations SET current_occupancy = current_occupancy + 100 WHERE location_id = (SELECT location_id FROM storage_locations WHERE zone = 'Ambient_A' AND rack = 'AR1' AND slot = 'AS1');
UPDATE storage_locations SET current_occupancy = current_occupancy + 5 WHERE location_id = (SELECT location_id FROM storage_locations WHERE zone = 'Ambient_B' AND rack = 'AR2' AND slot = 'BS2');
UPDATE storage_locations SET current_occupancy = current_occupancy + 20 WHERE location_id = (SELECT location_id FROM storage_locations WHERE zone = 'Ambient_A' AND rack = 'AR1' AND slot = 'AS2');
UPDATE storage_locations SET current_occupancy = current_occupancy + 30 WHERE location_id = (SELECT location_id FROM storage_locations WHERE zone = 'Cold_A' AND rack = 'CR1' AND slot = 'CS1');
UPDATE storage_locations SET current_occupancy = current_occupancy + 45 WHERE location_id = (SELECT location_id FROM storage_locations WHERE zone = 'Cold_A' AND rack = 'CR1' AND slot = 'CS2');
UPDATE storage_locations SET current_occupancy = current_occupancy + 80 WHERE location_id = (SELECT location_id FROM storage_locations WHERE zone = 'Ambient_B' AND rack = 'AR2' AND slot = 'BS1');


-- Sample Orders
INSERT INTO orders (order_date, status) VALUES
('2025-06-05 10:00:00', 'Pending'),
('2025-06-06 14:30:00', 'Pending'),
('2025-06-07 09:15:00', 'Completed');

-- Sample Order Items
INSERT INTO order_items (order_id, product_id, quantity) VALUES
((SELECT order_id FROM orders WHERE order_date LIKE '2025-06-05%'), (SELECT product_id FROM products WHERE name = 'Surgical Gloves (Latex Free)'), 10),
((SELECT order_id FROM orders WHERE order_date LIKE '2025-06-05%'), (SELECT product_id FROM products WHERE name = 'Bandages (Assorted)'), 2),
((SELECT order_id FROM orders WHERE order_date LIKE '2025-06-06%'), (SELECT product_id FROM products WHERE name = 'Pain Relievers (Tablets)'), 5),
((SELECT order_id FROM orders WHERE order_date LIKE '2025-06-07%'), (SELECT product_id FROM products WHERE name = 'Flu Vaccine (Seasonal)'), 15);


-- Sample Order Batch Picks (reflecting FEFO allocation from previous step)
-- For Order 1 (2025-06-05): Surgical Gloves (10), Bandages (2)
INSERT INTO order_batch_picks (order_id, batch_id, quantity_picked, status) VALUES
((SELECT order_id FROM orders WHERE order_date LIKE '2025-06-05%'), (SELECT batch_id FROM batches WHERE batch_number = 'GLOVE-001'), 10, 'Pending Pick'),
((SELECT order_id FROM orders WHERE order_date LIKE '2025-06-05%'), (SELECT batch_id FROM batches WHERE batch_number = 'BAND-005'), 2, 'Pending Pick');

-- For Order 2 (2025-06-06): Pain Relievers (5)
INSERT INTO order_batch_picks (order_id, batch_id, quantity_picked, status) VALUES
((SELECT order_id FROM orders WHERE order_date LIKE '2025-06-06%'), (SELECT batch_id FROM batches WHERE batch_number = 'PAIN-010'), 5, 'Pending Pick');

-- For Order 3 (2025-06-07) - Already Completed in sample data: Flu Vaccine (15)
-- We'll mark these as picked/dispatched to reflect a completed order
INSERT INTO order_batch_picks (order_id, batch_id, quantity_picked, status) VALUES
((SELECT order_id FROM orders WHERE order_date LIKE '2025-06-07%'), (SELECT batch_id FROM batches WHERE batch_number = 'FLUVAX-003'), 15, 'Picked');

-- Manually update status for Order 3 to reflect completion
UPDATE orders SET status = 'Completed' WHERE order_date LIKE '2025-06-07%';

-- Sample Dispatch for the completed order
INSERT INTO dispatches (order_id, dispatched_by, dispatch_date) VALUES
((SELECT order_id FROM orders WHERE order_date LIKE '2025-06-07%'), 'John Doe', '2025-06-07');

-- Update batches quantities after sample orders/picks
UPDATE batches SET quantity = quantity - 10 WHERE batch_number = 'GLOVE-001';
UPDATE batches SET quantity = quantity - 2 WHERE batch_number = 'BAND-005';
UPDATE batches SET quantity = quantity - 5 WHERE batch_number = 'PAIN-010';
UPDATE batches SET quantity = quantity - 15 WHERE batch_number = 'FLUVAX-003';

-- Adjust current_occupancy for sample orders/picks
UPDATE storage_locations SET current_occupancy = current_occupancy - 10 WHERE location_id = (SELECT assigned_location_id FROM batches WHERE batch_number = 'GLOVE-001');
UPDATE storage_locations SET current_occupancy = current_occupancy - 2 WHERE location_id = (SELECT assigned_location_id FROM batches WHERE batch_number = 'BAND-005');
UPDATE storage_locations SET current_occupancy = current_occupancy - 5 WHERE location_id = (SELECT assigned_location_id FROM batches WHERE batch_number = 'PAIN-010');
UPDATE storage_locations SET current_occupancy = current_occupancy - 15 WHERE location_id = (SELECT assigned_location_id FROM batches WHERE batch_number = 'FLUVAX-003');

-- Example of a batch that will expire soon
INSERT INTO batches (product_id, batch_number, manufacture_date, expiry_date, quantity, barcode, assigned_location_id, status) VALUES
((SELECT product_id FROM products WHERE name = 'Insulin Pens'), 'INSULIN-EXP-TEST', '2024-10-01', '2025-06-25', 50, 'INSULIN-EXP-TEST', (SELECT location_id FROM storage_locations WHERE zone = 'Cold_A' AND rack = 'CR1' AND slot = 'CS1'), 'Available');

UPDATE storage_locations SET current_occupancy = current_occupancy + 50 WHERE location_id = (SELECT assigned_location_id FROM batches WHERE batch_number = 'INSULIN-EXP-TEST');
