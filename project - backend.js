const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const port = 3000;

console.log('backend.js: Script execution started!');

// --- IMPORTANT: Serve static files from the 'public' directory ---
app.use(express.static('public'));

// Middleware
app.use(cors());
app.use(express.json());

// MySQL Connection Pool
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root', // IMPORTANT: Your MySQL username
    password: 'Password@123', // IMPORTANT: Your MySQL root password. Change this! Use '' if no password.
    database: 'my_project',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

console.log('backend.js: MySQL pool created.');

// Test DB connection immediately on startup
pool.getConnection()
    .then(connection => {
        console.log('backend.js: Successfully connected to MySQL!');
        connection.release();
    })
    .catch(err => {
        console.error('backend.js: Error connecting to MySQL:', err);
        process.exit(1);
    });

// Create an HTTP server from your express app for Socket.IO
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "http://localhost:3000", // Ensure this matches your frontend URL
        methods: ["GET", "POST"]
    }
});

// --- Helper Function: Smart Allocation Logic ---
async function findSuitableLocation(connection, productId, quantityNeeded) {
    try {
        // Fetch product category
        const [productRows] = await connection.query('SELECT category FROM products WHERE product_id = ?', [productId]);
        if (productRows.length === 0) {
            throw new Error('Product not found for smart allocation.');
        }
        const productCategory = productRows[0].category;

        console.log(`Attempting smart allocation for product category: ${productCategory}, quantity: ${quantityNeeded}`);

        // Find locations that match product category and have enough capacity
        // Order by available capacity (most free space first)
        const [candidateLocations] = await connection.query(
            `SELECT location_id, capacity, current_occupancy, location_type, min_temp, max_temp, latest_temperature
             FROM storage_locations
             WHERE location_type = ? AND current_occupancy + ? <= capacity
             ORDER BY (capacity - current_occupancy) DESC`,
            [productCategory, quantityNeeded]
        );

        let suitableLocation = null;

        if (productCategory === 'Cold Storage') {
            for (const loc of candidateLocations) {
                if (loc.latest_temperature === null || (loc.latest_temperature >= loc.min_temp && loc.latest_temperature <= loc.max_temp)) {
                    suitableLocation = loc;
                    console.log(`Smart Allocation: Found Cold Storage location ${loc.location_id} with suitable temperature (or no data yet).`);
                    break;
                } else {
                    console.warn(`Smart Allocation Warning: Temperature out of range (${loc.latest_temperature}°C) for cold storage location ${loc.location_id}. Skipping.`);
                }
            }
        } else {
            if (candidateLocations.length > 0) {
                suitableLocation = candidateLocations[0];
                console.log(`Smart Allocation: Found Ambient location ${suitableLocation.location_id}.`);
            }
        }

        if (!suitableLocation) {
            console.error(`Smart Allocation Failed: No suitable storage location found for category '${productCategory}', quantity ${quantityNeeded}.`);
            return null;
        }

        return suitableLocation;
    } catch (error) {
        console.error('Error in findSuitableLocation helper:', error);
        throw new Error('Internal error during smart allocation.');
    }
}


// --- API Endpoints ---

// Products: Get all
app.get('/products', async (req, res, next) => {
    try {
        const [rows] = await pool.query('SELECT * FROM products');
        res.json(rows);
    }
    catch (err) {
        next(err);
    }
});

// Products: Add new
app.post('/products', async (req, res, next) => {
    const { name, description, manufacturer, category, price } = req.body;
    if (!name || !category) {
        return res.status(400).json({ error: 'Product name and category are required.' });
    }
    if (!['Ambient', 'Cold Storage'].includes(category)) {
        return res.status(400).json({ error: 'Invalid category. Only "Ambient" or "Cold Storage" are allowed.' });
    }
    try {
        const [result] = await pool.query(
            'INSERT INTO products (name, description, manufacturer, category, price) VALUES (?, ?, ?, ?, ?)',
            [name, description || null, manufacturer || null, category, price || null]
        );
        const [newProduct] = await pool.query('SELECT * FROM products WHERE product_id = ?', [result.insertId]);
        res.status(201).json(newProduct[0]);
    }
    catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
             res.status(409).json({ error: `Product with name '${name}' already exists.` });
        } else {
            next(err);
        }
    }
});


// Storage Locations: Get all (with contents and latest temperature)
app.get('/storage_locations', async (req, res, next) => {
    try {
        const [locations] = await pool.query('SELECT * FROM storage_locations');

        const [batchesWithProductInfo] = await pool.query(`
            SELECT
                b.batch_id,
                b.product_id,
                p.name AS product_name,
                p.category AS product_type,
                p.description AS product_description,
                b.batch_number,
                b.quantity AS assigned_quantity,
                b.expiry_date,
                b.manufacture_date,
                b.barcode,
                b.assigned_location_id,
                b.status
            FROM
                batches b
            JOIN
                products p ON b.product_id = p.product_id
            WHERE
                b.assigned_location_id IS NOT NULL;
        `);

        const locationsWithDetails = await Promise.all(locations.map(async (location) => {
            const contents = batchesWithProductInfo.filter(batch => batch.assigned_location_id === location.location_id);

            if (location.last_temp_update) {
                location.last_temp_update_formatted = new Date(location.last_temp_update).toLocaleString();
            } else {
                location.last_temp_update_formatted = 'N/A';
            }

            return {
                ...location,
                contents: contents
            };
        }));

        res.json(locationsWithDetails);
    }
    catch (err) {
        console.error('Error fetching storage locations:', err);
        next(err);
    }
});
// Storage Locations: Add new (from UI)
app.post('/storage_locations', async (req, res, next) => {
    let { zone, rack, slot, location_type, size_type, capacity, min_temp, max_temp } = req.body;

    if (!zone || !rack || !slot || capacity === undefined || isNaN(capacity) || capacity <= 0 || !location_type) {
        return res.status(400).json({ error: 'Zone, Rack, Slot, Location Type, and a valid positive Capacity are required.' });
    }
    if (!['Ambient', 'Cold Storage'].includes(location_type)) {
        return res.status(400).json({ error: 'Invalid location type. Must be "Ambient" or "Cold Storage".' });
    }

    if (location_type === 'Cold Storage') {
        if (min_temp === undefined || max_temp === undefined || isNaN(min_temp) || isNaN(max_temp)) {
            return res.status(400).json({ error: 'Min/Max Temperatures are required and must be numbers for Cold Storage locations.' });
        }
        min_temp = parseFloat(min_temp);
        max_temp = parseFloat(max_temp);
    } else {
        min_temp = null;
        max_temp = null;
    }

    try {
        const [result] = await pool.query(
            `INSERT INTO storage_locations (zone, rack, slot, location_type, size_type, capacity, current_occupancy, min_temp, max_temp)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            [zone, rack, slot, location_type, size_type || null, capacity, min_temp, max_temp]
        );
        const [newLocation] = await pool.query('SELECT * FROM storage_locations WHERE location_id = ?', [result.insertId]);
        res.status(201).json(newLocation[0]);
    }
    catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
             res.status(409).json({ error: 'A location with this Zone, Rack, and Slot already exists.' });
        } else {
             next(err);
        }
    }
});


// Batches: Get all (for Dashboard display)
app.get('/batches', async (req, res, next) => {
    try {
        const [rows] = await pool.query(`
            SELECT
                b.batch_id,
                b.product_id,
                p.name AS product_name,
                p.category AS product_type,
                p.description AS product_description,
                b.batch_number,
                b.manufacture_date,
                b.expiry_date,
                b.quantity,
                b.barcode,
                b.assigned_location_id,
                b.status,
                sl.zone, sl.rack, sl.slot
            FROM batches b
            JOIN products p ON b.product_id = p.product_id
            LEFT JOIN storage_locations sl ON b.assigned_location_id = sl.location_id
        `);
        res.json(rows);
    }
    catch (err) {
        console.error('Error fetching batches for dashboard:', err);
        next(err);
    }
});

// Batches: Add new (with integrated smart allocation)
app.post('/batches', async (req, res, next) => {
    const { product_id, batch_number, manufacture_date, expiry_date, quantity, barcode } = req.body;

    if (!product_id || !batch_number || !expiry_date || quantity === undefined || isNaN(quantity) || quantity <= 0) {
        return res.status(400).json({ error: 'Missing required batch fields (product, batch number, expiry date, or valid quantity).' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const suitableLocation = await findSuitableLocation(connection, product_id, quantity);
        if (!suitableLocation) {
            await connection.rollback();
            return res.status(400).json({ error: 'No suitable storage location found based on product criteria, capacity, and temperature.' });
        }
        const assignedLocationId = suitableLocation.location_id;
        console.log(`Batch ${batch_number} smart allocated to location ID: ${assignedLocationId}`);

        const [batchResult] = await connection.query(
            'INSERT INTO batches (product_id, batch_number, manufacture_date, expiry_date, quantity, barcode, assigned_location_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [product_id, batch_number, manufacture_date || null, expiry_date, quantity, barcode || batch_number, assignedLocationId, 'Available']
        );
        const newBatchId = batchResult.insertId;

        await connection.query(
            'UPDATE storage_locations SET current_occupancy = current_occupancy + ? WHERE location_id = ?',
            [quantity, assignedLocationId]
        );

        await connection.commit();
        res.status(201).json({
            message: 'Stock added successfully!',
            batch: { batch_id: newBatchId, barcode: barcode || batch_number },
            assigned_location_id: assignedLocationId
        });

    }
    catch (err) {
        await connection.rollback();
        if (err.code === 'ER_DUP_ENTRY' && err.message.includes('batches.batch_number')) {
            return res.status(409).json({ error: `Batch number '${batch_number}' already exists.` });
        }
        console.error('Error adding stock (backend):', err);
        next(err);
    } finally {
        connection.release();
    }
});

// Batches: Update
app.put('/batches/:id', async (req, res, next) => {
    const { id } = req.params;
    const { product_id, batch_number, manufacture_date, expiry_date, quantity, barcode, status } = req.body;

    if (!product_id || !batch_number || !expiry_date || quantity === undefined || isNaN(quantity) || quantity < 0 || !status) {
        return res.status(400).json({ error: 'Missing required batch fields for update, or invalid quantity.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [oldBatchRows] = await connection.query(
            'SELECT quantity, assigned_location_id FROM batches WHERE batch_id = ? FOR UPDATE',
            [id]
        );

        if (oldBatchRows.length === 0) {
            throw new Error('Batch not found.');
        }
        const oldQuantity = oldBatchRows[0].quantity;
        const assignedLocationId = oldBatchRows[0].assigned_location_id;

        await connection.query(
            `UPDATE batches SET product_id = ?, batch_number = ?, manufacture_date = ?, expiry_date = ?, quantity = ?, barcode = ?, status = ?
             WHERE batch_id = ?`,
            [product_id, batch_number, manufacture_date || null, expiry_date, quantity, barcode || batch_number, status, id]
        );

        if (assignedLocationId) {
            const quantityDifference = quantity - oldQuantity;
            await connection.query(
                'UPDATE storage_locations SET current_occupancy = current_occupancy + ? WHERE location_id = ?',
                [quantityDifference, assignedLocationId]
            );
        }

        await connection.commit();
        const [updatedBatch] = await pool.query('SELECT * FROM batches WHERE batch_id = ?', [id]);
        res.json(updatedBatch[0]);
    }
    catch (err) {
        await connection.rollback();
        if (err.code === 'ER_DUP_ENTRY' && err.message.includes('batches.batch_number')) {
            return res.status(409).json({ error: `Batch number '${batch_number}' already exists for another batch.` });
        }
        console.error('Error updating batch:', err);
        next(err);
    } finally {
        connection.release();
    }
});

// Batches: Delete
app.delete('/batches/:id', async (req, res, next) => {
    const { id } = req.params;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [batchRows] = await connection.query(
            'SELECT quantity, assigned_location_id FROM batches WHERE batch_id = ? FOR UPDATE',
            [id]
        );

        if (batchRows.length === 0) {
            throw new Error('Batch not found.');
        }

        const batchQuantity = batchRows[0].quantity;
        const assignedLocationId = batchRows[0].assigned_location_id;

        await connection.query('DELETE FROM order_batch_picks WHERE batch_id = ?', [id]);

        const [result] = await connection.query('DELETE FROM batches WHERE batch_id = ?', [id]);
        if (result.affectedRows === 0) {
            throw new Error('Batch not found or no changes made.');
        }

        if (assignedLocationId) {
            await connection.query(
                'UPDATE storage_locations SET current_occupancy = current_occupancy - ? WHERE location_id = ?',
                [batchQuantity, assignedLocationId]
            );
        }

        await connection.commit();
        res.json({ message: 'Batch deleted successfully', batchId: id });
    }
    catch (err) {
        await connection.rollback();
        console.error('Error deleting batch:', err);
        next(err);
    } finally {
        connection.release();
    }
});
// Orders: Get all (with nested items and picked batches)
app.get('/orders', async (req, res, next) => {
    try {
        const [orders] = await pool.query('SELECT * FROM orders');

        const ordersWithDetails = await Promise.all(orders.map(async (order) => {
            const [items] = await pool.query(
                `SELECT oi.product_id, oi.quantity, p.name AS product_name
                 FROM order_items oi
                 JOIN products p ON oi.product_id = p.product_id
                 WHERE oi.order_id = ?`,
                [order.order_id]
            );
            order.items = items;

            const [pickedBatches] = await pool.query(
                `SELECT obp.pick_id, obp.batch_id, obp.quantity_picked, obp.status,
                        b.batch_number, b.barcode, p.name AS product_name, b.assigned_location_id,
                        sl.zone, sl.rack, sl.slot, sl.size_type
                 FROM order_batch_picks obp
                 JOIN batches b ON obp.batch_id = b.batch_id
                 JOIN products p ON b.product_id = p.product_id
                 LEFT JOIN storage_locations sl ON b.assigned_location_id = sl.location_id
                 WHERE obp.order_id = ?`,
                [order.order_id]
            );
            order.picked_batches = pickedBatches;
            return order;
        }));

        res.json(ordersWithDetails);
    }
    catch (err) {
        console.error('Error fetching orders:', err);
        next(err);
    }
});

// Orders: Create new (handles stock reduction and pick assignment)
app.post('/orders', async (req, res, next) => {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Order must contain at least one item.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [orderResult] = await connection.query(
            'INSERT INTO orders (order_date, status) VALUES (NOW(), ?)',
            ['Pending']
        );
        const orderId = orderResult.insertId;

        for (const item of items) {
            const { product_id, quantity } = item;
            if (!product_id || quantity === undefined || isNaN(quantity) || quantity <= 0) {
                throw new Error('Invalid product or quantity in order item.');
            }

            await connection.query(
                'INSERT INTO order_items (order_id, product_id, quantity) VALUES (?, ?, ?)',
                [orderId, product_id, quantity]
            );

            const [availableBatches] = await connection.query(
                `SELECT batch_id, quantity, assigned_location_id, expiry_date
                 FROM batches
                 WHERE product_id = ? AND quantity > 0 AND status = 'Available'
                 ORDER BY expiry_date ASC
                 FOR UPDATE`,
                [product_id]
            );

            let remainingToPick = quantity;
            for (const batch of availableBatches) {
                if (remainingToPick <= 0) break;

                const quantityFromBatch = Math.min(remainingToPick, batch.quantity);

                await connection.query(
                    'INSERT INTO order_batch_picks (order_id, batch_id, quantity_picked, status) VALUES (?, ?, ?, ?)',
                    [orderId, batch.batch_id, quantityFromBatch, 'Pending Pick']
                );

                await connection.query(
                    'UPDATE batches SET quantity = quantity - ? WHERE batch_id = ?',
                    [quantityFromBatch, batch.batch_id]
                );

                if (batch.assigned_location_id) {
                    await connection.query(
                        'UPDATE storage_locations SET current_occupancy = current_occupancy - ? WHERE location_id = ?',
                        [quantityFromBatch, batch.assigned_location_id]
                    );
                }

                remainingToPick -= quantityFromBatch;
            }

            if (remainingToPick > 0) {
                throw new Error(`Insufficient stock for product ID ${product_id}. Needed ${quantity}, but only ${quantity - remainingToPick} available.`);
            }
        }

        await connection.commit();
        res.status(201).json({ message: 'Order placed successfully', order: { order_id: orderId } });

    }
    catch (err) {
        await connection.rollback();
        console.error('Error creating order (backend):', err);
        next(err);
    } finally {
        connection.release();
    }
});

// Orders: Update status
app.put('/orders/:orderId', async (req, res, next) => {
    const { orderId } = req.params;
    const { status } = req.body;

    if (!status || !['Pending', 'Completed', 'Dispatched', 'Cancelled'].includes(status)) {
        return res.status(400).json({ error: 'Invalid order status provided.' });
    }

    try {
        const [result] = await pool.query(
            'UPDATE orders SET status = ? WHERE order_id = ?',
            [status, orderId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Order not found.' });
        }
        const [updatedOrder] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [orderId]);
        res.json(updatedOrder[0]);
    }
    catch (err) {
        console.error('Error updating order status:', err);
        next(err);
    }
});

// Order Batch Picks: Update status
app.put('/order_batch_picks/:pickId', async (req, res, next) => {
    const { pickId } = req.params;
    const { status } = req.body;

    if (!status || !['Picked', 'Pending Pick', 'Dispatched'].includes(status)) {
        return res.status(400).json({ error: 'Invalid pick status provided. Must be Picked, Pending Pick, or Dispatched.' });
    }

    try {
        const [result] = await pool.query(
            'UPDATE order_batch_picks SET status = ? WHERE pick_id = ?',
            [status, pickId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Pick item not found or status already set.' });
        }
        const [updatedPick] = await pool.query('SELECT * FROM order_batch_picks WHERE pick_id = ?', [pickId]);
        res.json(updatedPick[0]);
    }
    catch (err) {
        console.error('Error updating pick status:', err);
        next(err);
    }
});

// Dispatches: Create record
app.post('/dispatches', async (req, res, next) => {
    const { order_id, dispatched_by, dispatch_date } = req.body;
    if (!order_id || !dispatched_by || !dispatch_date) {
        return res.status(400).json({ error: 'Order ID, dispatcher, and date are required for dispatch.' });
    }
    try {
        const [result] = await pool.query(
            'INSERT INTO dispatches (order_id, dispatched_by, dispatch_date) VALUES (?, ?, ?)',
            [order_id, dispatched_by, dispatch_date]
        );
        const [newDispatch] = await pool.query('SELECT * FROM dispatches WHERE dispatch_id = ?', [result.insertId]);
        res.status(201).json(newDispatch[0]);
    }
    catch (err) {
        console.error('Error recording dispatch:', err);
        next(err);
    }
});
// Barcode Verification Endpoint
app.get('/verify-barcode/:barcode', async (req, res, next) => {
    const { barcode } = req.params;
    try {
        const [batchRows] = await pool.query(
            `SELECT b.batch_id, b.batch_number, b.quantity, b.expiry_date, p.name AS product_name, p.category AS product_type
             FROM batches b
             JOIN products p ON b.product_id = p.product_id
             WHERE b.barcode = ?`,
            [barcode]
        );

        if (batchRows.length === 0) {
            return res.json({ isValid: false, messages: ['Barcode not found.'] });
        }

        const batch = batchRows[0];
        let verificationResult = {
            isValid: true,
            batch: batch,
            messages: []
        };

        if (batch.quantity <= 0) {
            verificationResult.isValid = false;
            verificationResult.messages.push(`Batch is out of stock (Quantity: ${batch.quantity}).`);
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expiryDate = batch.expiry_date ? new Date(batch.expiry_date) : null;

        if (expiryDate) {
            expiryDate.setHours(23, 59, 59, 999);
            if (expiryDate < today) {
                verificationResult.isValid = false;
                verificationResult.messages.push(`Expired: Batch expired on ${new Date(batch.expiry_date).toLocaleDateString()}.`);
            } else {
                const thirtyDaysFromNow = new Date();
                thirtyDaysFromNow.setDate(today.getDate() + 30);
                thirtyDaysFromNow.setHours(23, 59, 59, 999);
                if (expiryDate <= thirtyDaysFromNow) {
                     verificationResult.messages.push(`Expiring Soon: Batch expires on ${new Date(batch.expiry_date).toLocaleDateString()}.`);
                }
            }
        }

        const [pendingPicks] = await pool.query(`
            SELECT obp.pick_id, obp.order_id, obp.quantity_picked, o.status as order_status
            FROM order_batch_picks obp
            JOIN orders o ON obp.order_id = o.order_id
            WHERE obp.batch_id = ? AND obp.status = 'Pending Pick' AND o.status = 'Pending'
        `, [batch.batch_id]);

        if (pendingPicks.length > 0) {
            verificationResult.pendingPicks = pendingPicks;
            verificationResult.messages.push(`Part of pending order(s) for picking: ${pendingPicks.map(p => p.order_id).join(', ')}.`);
        } else {
            if (batch.quantity > 0 && (expiryDate === null || expiryDate >= today)) {
                 verificationResult.isValid = false;
                 verificationResult.messages.push('This batch is not part of any *active* pending pick list.');
            }
        }

        res.json(verificationResult);

    }
    catch (err) {
        console.error('Error verifying barcode:', err);
        next(err);
    }
});


// Temperature Logging Endpoint
app.post('/temperature_logs', async (req, res, next) => {
    const { location_id, temperature_reading } = req.body;
    if (location_id === undefined || temperature_reading === undefined || isNaN(temperature_reading)) {
        return res.status(400).json({ error: 'Location ID and a valid temperature reading are required.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        await connection.query(
            'INSERT INTO temperature_logs (location_id, temperature_reading, timestamp) VALUES (?, ?, NOW())',
            [location_id, temperature_reading]
        );

        await connection.query(
            'UPDATE storage_locations SET latest_temperature = ?, last_temp_update = NOW() WHERE location_id = ?',
            [temperature_reading, location_id]
        );

        await connection.commit();
        res.status(201).json({ message: 'Temperature log received and stored successfully' });

        io.emit('temperatureUpdate', {
            location_id: location_id,
            temperature: temperature_reading,
            timestamp: new Date().toISOString()
        });

    }
    catch (err) {
        await connection.rollback();
        console.error('Error logging temperature:', err);
        next(err);
    } finally {
        connection.release();
    }
});


// Alerts: Expiry
app.get('/alerts/expiry', async (req, res, next) => {
    try {
        const [expired] = await pool.query(`
            SELECT b.batch_id, b.batch_number, b.quantity, b.expiry_date, p.name AS product_name
            FROM batches b
            JOIN products p ON b.product_id = p.product_id
            WHERE b.expiry_date < CURDATE() AND b.quantity > 0 AND b.status = 'Available'
        `);
        const [expiringSoon] = await pool.query(`
            SELECT b.batch_id, b.batch_number, b.quantity, b.expiry_date, p.name AS product_name
            FROM batches b
            JOIN products p ON b.product_id = p.product_id
            WHERE b.expiry_date >= CURDATE() AND b.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND b.quantity > 0 AND b.status = 'Available'
            ORDER BY b.expiry_date ASC
        `);
        res.json({ expired, expiringSoon });
    }
    catch (err) {
        console.error('Error fetching expiry alerts:', err);
        next(err);
    }
});

// Alerts: Low Stock
app.get('/alerts/low_stock', async (req, res, next) => {
    const LOW_STOCK_THRESHOLD = 10;
    try {
        const [lowStock] = await pool.query(`
            SELECT b.batch_id, b.batch_number, b.quantity, p.name AS product_name
            FROM batches b
            JOIN products p ON b.product_id = p.product_id
            WHERE b.quantity > 0 AND b.quantity <= ? AND b.status = 'Available'
            ORDER BY b.quantity ASC
        `, [LOW_STOCK_THRESHOLD]);

        const [outOfStock] = await pool.query(`
            SELECT b.batch_id, b.batch_number, p.name AS product_name
            FROM batches b
            JOIN products p ON b.product_id = p.product_id
            WHERE b.quantity <= 0 AND b.status = 'Available'
        `);

        res.json({ lowStock, outOfStock });
    }
    catch (err) {
        console.error('Error fetching low stock alerts:', err);
        next(err);
    }
});

// Alerts: Temperature
app.get('/alerts/temperature', async (req, res, next) => {
    try {
        const [alerts] = await pool.query(`
            SELECT
                sl.location_id,
                CONCAT(sl.zone, '-', sl.rack, '-', sl.slot) AS location_name,
                sl.location_type,
                sl.min_temp,
                sl.max_temp,
                sl.latest_temperature,
                sl.last_temp_update
            FROM
                storage_locations sl
            WHERE
                sl.location_type = 'Cold Storage'
                AND (
                    sl.latest_temperature IS NULL
                    OR sl.latest_temperature < sl.min_temp
                    OR sl.latest_temperature > sl.max_temp
                    OR sl.last_temp_update IS NULL
                    OR sl.last_temp_update < DATE_SUB(NOW(), INTERVAL 1 HOUR)
                )
        `);

        const formattedAlerts = alerts.map(alert => {
            let message = '';
            let alert_type = '';
            if (alert.latest_temperature === null || alert.last_temp_update === null) {
                message = 'No recent temperature readings.';
                alert_type = 'No Readings';
            } else if (alert.latest_temperature < alert.min_temp) {
                message = `Temperature too low: ${alert.latest_temperature}°C (Min: ${alert.min_temp}°C)`;
                alert_type = 'Low Temperature';
            } else if (alert.latest_temperature > alert.max_temp) {
                message = `Temperature too high: ${alert.latest_temperature}°C (Max: ${alert.max_temp}°C)`;
                alert_type = 'High Temperature';
            } else if (alert.last_temp_update < new Date(Date.now() - 3600000)) {
                message = `No temperature update in the last hour. Last reading: ${alert.latest_temperature}°C at ${new Date(alert.last_temp_update).toLocaleString()}`;
                alert_type = 'Stale Reading';
            }
            return {
                location_id: alert.location_id,
                location_name: alert.location_name,
                alert_type: alert_type,
                message: message
            };
        });

        res.json(formattedAlerts);
    }
    catch (err) {
        console.error('Error fetching temperature alerts:', err);
        next(err);
    }
});

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log('A frontend client connected via Socket.IO:', socket.id);

    socket.on('disconnect', () => {
        console.log('A frontend client disconnected via Socket.IO:', socket.id);
    });
});

// --- Global Error Handling ---
app.use((req, res, next) => {
    console.warn(`404 Not Found: ${req.method} ${req.url}`);
    res.status(404).json({ error: 'Not Found', message: `The requested resource ${req.method} ${req.url} was not found on this server.` });
});

app.use((err, req, res, next) => {
    console.error('Unhandled Server Error:', err.stack || err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

console.log('backend.js: Error handlers applied.');

server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log(`Socket.IO listening on ws://localhost:${port}`);
});
