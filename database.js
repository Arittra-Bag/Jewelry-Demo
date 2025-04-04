const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
    constructor() {
        // Initialize customer database
        this.customerDb = new sqlite3.Database(path.join(__dirname, 'jewelry_shop.db'));
        // Initialize inventory database
        this.inventoryDb = new sqlite3.Database(path.join(__dirname, 'jewelry_inventory.db'));
        // Initialize past records database
        this.pastRecordsDb = new sqlite3.Database(path.join(__dirname, 'past_records.db'));
        this.init();
    }

    init() {
        // Create products directory if it doesn't exist
        const productsDir = path.join(__dirname, 'products');
        if (!fs.existsSync(productsDir)) {
            fs.mkdirSync(productsDir);
        }

        // Create tables in customer database
        this.customerDb.serialize(() => {
            // Customers table
            this.customerDb.run(`CREATE TABLE IF NOT EXISTS customers (
                customer_id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                face_encoding TEXT NOT NULL,
                entry_time DATETIME,
                exit_time DATETIME,
                visit_count INTEGER DEFAULT 0
            )`);

            // Visit history table
            this.customerDb.run(`CREATE TABLE IF NOT EXISTS visit_history (
                visit_id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER,
                entry_time DATETIME NOT NULL,
                exit_time DATETIME,
                duration INTEGER,
                FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
            )`);
        });

        // Create tables in inventory database
        this.inventoryDb.serialize(() => {
            // Inventory table with image support
            this.inventoryDb.run(`CREATE TABLE IF NOT EXISTS inventory (
                product_id TEXT PRIMARY KEY,
                product_name TEXT NOT NULL,
                price REAL NOT NULL,
                quantity INTEGER NOT NULL,
                product_image BLOB,
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
        });

        // Create tables in past records database
        this.pastRecordsDb.serialize(() => {
            // Past records table
            this.pastRecordsDb.run(`CREATE TABLE IF NOT EXISTS past_records (
                visit_number INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_time DATETIME,
                exit_time DATETIME,
                duration TEXT,
                product_id TEXT,
                product_name TEXT,
                price REAL,
                product_image BLOB,
                generated_image BLOB,
                customer_name TEXT
            )`);
        });

        console.log('Databases initialized successfully');
    }

    // Customer operations
    getCustomers() {
        return new Promise((resolve, reject) => {
            this.customerDb.all(`
                SELECT customer_id, name, entry_time, exit_time, visit_count 
                FROM customers 
                ORDER BY entry_time DESC
            `, [], (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            });
        });
    }

    registerCustomer(name, faceEncoding) {
        return new Promise((resolve, reject) => {
            this.customerDb.run(`
                INSERT INTO customers (name, face_encoding, entry_time) 
                VALUES (?, ?, datetime('now'))
            `, [name, faceEncoding], function(err) {
                if (err) reject(err);
                resolve({ id: this.lastID });
            });
        });
    }

    editCustomer(id, name) {
        return new Promise((resolve, reject) => {
            this.customerDb.run(`
                UPDATE customers 
                SET name = ? 
                WHERE customer_id = ?
            `, [name, id], function(err) {
                if (err) reject(err);
                resolve({ success: true });
            });
        });
    }

    deleteCustomer(customerId) {
        return new Promise((resolve, reject) => {
            this.customerDb.run(`
                DELETE FROM customers 
                WHERE customer_id = ?
            `, [customerId], function(err) {
                if (err) reject(err);
                resolve({ success: true });
            });
        });
    }

    checkInCustomer(customerId) {
        return new Promise((resolve, reject) => {
            this.customerDb.run(`
                UPDATE customers 
                SET entry_time = datetime('now'),
                    exit_time = NULL,
                    visit_count = visit_count + 1
                WHERE customer_id = ?
            `, [customerId], function(err) {
                if (err) reject(err);
                resolve({ success: true });
            });
        });
    }

    checkOutCustomer(customerId) {
        return new Promise((resolve, reject) => {
            // First get customer details and their latest purchase
            this.customerDb.get(`
                SELECT 
                    c.name, 
                    c.entry_time,
                    i.product_id,
                    i.product_name,
                    i.price,
                    i.product_image
                FROM customers c
                LEFT JOIN inventory i ON i.last_updated >= c.entry_time
                WHERE c.customer_id = ?
                ORDER BY i.last_updated DESC
                LIMIT 1
            `, [customerId], (err, data) => {
                if (err) {
                    reject(err);
                    return;
                }

                const now = new Date();
                const entryTime = new Date(data.entry_time);
                const duration = Math.floor((now - entryTime) / 1000 / 60) + ' minutes'; // Duration in minutes

                // Update customer status
                this.customerDb.run(`
                    UPDATE customers 
                    SET exit_time = datetime('now') 
                    WHERE customer_id = ? AND exit_time IS NULL
                `, [customerId], (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Record in past_records.db
                    this.pastRecordsDb.run(`
                        INSERT INTO past_records (
                            customer_name,
                            entry_time,
                            exit_time,
                            duration,
                            product_id,
                            product_name,
                            price,
                            product_image
                        ) VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?)
                    `, [
                        data.name,
                        data.entry_time,
                        duration,
                        data.product_id || null,
                        data.product_name || null,
                        data.price || null,
                        data.product_image || null
                    ], (err) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve({ success: true });
                        }
                    });
                });
            });
        });
    }

    getPastRecords(customerId = null) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    visit_number,
                    customer_name,
                    entry_time,
                    exit_time,
                    duration,
                    product_id,
                    product_name,
                    price,
                    product_image,
                    generated_image
                FROM past_records 
                ORDER BY entry_time DESC
            `;
            
            this.pastRecordsDb.all(query, [], (err, rows) => {
                if (err) {
                    console.error('Error getting past records:', err);
                    reject(err);
                } else {
                    resolve(rows.map(row => ({
                        ...row,
                        duration: row.duration || 'N/A',
                        product_name: row.product_name || 'N/A',
                        price: row.price ? parseFloat(row.price).toFixed(2) : 'N/A'
                    })));
                }
            });
        });
    }

    // Inventory operations
    async getInventory() {
        return new Promise((resolve, reject) => {
            this.inventoryDb.all('SELECT * FROM inventory ORDER BY product_name', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async addInventoryItem(data) {
        const { product_id, product_name, price, quantity, product_image } = data;

        return new Promise((resolve, reject) => {
            this.inventoryDb.run(
                'INSERT INTO inventory (product_id, product_name, price, quantity, product_image) VALUES (?, ?, ?, ?, ?)',
                [product_id, product_name, price, quantity, product_image],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    async updateInventoryItem(data) {
        const { product_id, product_name, price, quantity, product_image } = data;

        return new Promise((resolve, reject) => {
            if (product_image) {
                this.inventoryDb.run(
                    'UPDATE inventory SET product_name = ?, price = ?, quantity = ?, product_image = ? WHERE product_id = ?',
                    [product_name, price, quantity, product_image, product_id],
                    (err) => {
                        if (err) reject(err);
                        else resolve(product_id);
                    }
                );
            } else {
                this.inventoryDb.run(
                    'UPDATE inventory SET product_name = ?, price = ?, quantity = ? WHERE product_id = ?',
                    [product_name, price, quantity, product_id],
                    (err) => {
                        if (err) reject(err);
                        else resolve(product_id);
                    }
                );
            }
        });
    }

    async deleteInventoryItem(itemId) {
        return new Promise((resolve, reject) => {
            // Delete the item from the database
            this.inventoryDb.run(
                'DELETE FROM inventory WHERE product_id = ?',
                [itemId],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ success: true, changes: this.changes });
                    }
                }
            );
        });
    }
}

module.exports = Database; 