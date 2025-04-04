const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Database = require('./database');
const { PythonShell } = require('python-shell');

// Initialize database
const db = new Database();

let mainWindow;
let faceDetector = null;

function createWindow() {
    console.log('Creating main window...');
    const preloadPath = path.join(__dirname, 'preload.js');
    console.log('Preload script path:', preloadPath);

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: preloadPath,
            webviewTag: true,
            plugins: true,
            sandbox: false
        }
    });

    // Log when the window is ready
    mainWindow.webContents.on('did-finish-load', () => {
        console.log('Window loaded successfully');
        // Open DevTools for debugging
        mainWindow.webContents.openDevTools();
    });

    // Log any preload script errors
    mainWindow.webContents.on('preload-error', (event, preloadPath, error) => {
        console.error('Preload script error:', error);
    });

    // Log when the preload script is loaded
    mainWindow.webContents.on('did-start-loading', () => {
        console.log('Window started loading');
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        if (faceDetector) {
            faceDetector.end();
        }
        app.quit();
    }
});

// Handle camera permissions
app.on('web-contents-created', (event, contents) => {
    contents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = ['media', 'display-capture'];
        if (allowedPermissions.includes(permission)) {
            callback(true);
        } else {
            callback(false);
        }
    });

    // Handle device permissions
    contents.session.setDevicePermissionHandler((webContents, device) => {
        if (device.type === 'camera') {
            return true;
        }
        return false;
    });
});

// IPC handlers for database operations
ipcMain.handle('get-customers', async () => {
    try {
        console.log('Getting customers from database...');
        const customers = await db.getCustomers();
        console.log('Retrieved customers:', customers);
        return customers;
    } catch (error) {
        console.error('Error getting customers:', error);
        throw error;
    }
});

ipcMain.handle('register-customer', async (event, data) => {
    try {
        return await db.registerCustomer(data.name, data.face_encoding);
    } catch (error) {
        console.error('Error registering customer:', error);
        throw error;
    }
});

ipcMain.handle('edit-customer', async (event, data) => {
    try {
        return await db.editCustomer(data.id, data.name);
    } catch (error) {
        console.error('Error editing customer:', error);
        throw error;
    }
});

ipcMain.handle('delete-customer', async (event, customerId) => {
    try {
        return await db.deleteCustomer(customerId);
    } catch (error) {
        console.error('Error deleting customer:', error);
        throw error;
    }
});

ipcMain.handle('check-in-customer', async (event, customerId) => {
    try {
        return await db.checkInCustomer(customerId);
    } catch (error) {
        console.error('Error checking in customer:', error);
        throw error;
    }
});

ipcMain.handle('check-out-customer', async (event, customerId) => {
    try {
        return await db.checkOutCustomer(customerId);
    } catch (error) {
        console.error('Error checking out customer:', error);
        throw error;
    }
});

ipcMain.handle('get-past-records', async (event, customerId) => {
    try {
        console.log('Main process: Getting past records...');
        const records = await db.getPastRecords(customerId);
        console.log('Main process: Past records retrieved:', records);
        return records;
    } catch (error) {
        console.error('Main process: Error getting past records:', error);
        console.error('Error stack:', error.stack);
        throw error;
    }
});

// Inventory operations
ipcMain.handle('get-inventory', async () => {
    try {
        console.log('Main process: Getting inventory...');
        const inventory = await db.getInventory();
        console.log('Main process: Inventory retrieved:', inventory);
        return inventory;
    } catch (error) {
        console.error('Main process: Error getting inventory:', error);
        console.error('Error stack:', error.stack);
        throw error;
    }
});

ipcMain.handle('add-inventory-item', async (event, data) => {
    try {
        console.log('Main process: Adding inventory item:', data);
        const result = await db.addInventoryItem(data);
        console.log('Main process: Inventory item added:', result);
        return result;
    } catch (error) {
        console.error('Main process: Error adding inventory item:', error);
        console.error('Error stack:', error.stack);
        throw error;
    }
});

ipcMain.handle('update-inventory-item', async (event, data) => {
    try {
        console.log('Main process: Updating inventory item:', data);
        const result = await db.updateInventoryItem(data);
        console.log('Main process: Inventory item updated:', result);
        return result;
    } catch (error) {
        console.error('Main process: Error updating inventory item:', error);
        console.error('Error stack:', error.stack);
        throw error;
    }
});

ipcMain.handle('delete-inventory-item', async (event, itemId) => {
    try {
        console.log('Main process: Deleting inventory item:', itemId);
        const result = await db.deleteInventoryItem(itemId);
        console.log('Main process: Inventory item deleted:', result);
        return result;
    } catch (error) {
        console.error('Main process: Error deleting inventory item:', error);
        console.error('Error stack:', error.stack);
        throw error;
    }
});

// Handle face detection requests
ipcMain.handle('detect-faces', async (event, imageData) => {
    return new Promise((resolve, reject) => {
        let initializationTimeout;
        try {
            if (!faceDetector) {
                // Use direct path to the Python script
                const pythonScriptPath = "/Users/syedmohammadalijafri/Jewelry/python/face_detection.py";
                console.log('Initializing face detector with script:', pythonScriptPath);

                // Check if the script exists
                if (!require('fs').existsSync(pythonScriptPath)) {
                    throw new Error(`Python script not found at: ${pythonScriptPath}`);
                }

                // Initialize Python shell for face detection
                faceDetector = new PythonShell(pythonScriptPath, {
                    mode: 'json',
                    pythonPath: 'python',
                    pythonOptions: ['-u'],
                    scriptPath: "/Users/syedmohammadalijafri/Jewelry/python"  // Use direct path to python directory
                });

                let isInitialized = false;
                initializationTimeout = setTimeout(() => {
                    if (!isInitialized && faceDetector) {
                        console.error('Face detector initialization timeout');
                        faceDetector.end();
                        faceDetector = null;
                        reject(new Error('Face detector initialization timeout'));
                    }
                }, 5000); // 5 second timeout

                faceDetector.on('error', (err) => {
                    console.error('Face detector error:', err);
                    if (initializationTimeout) {
                        clearTimeout(initializationTimeout);
                    }
                    if (faceDetector) {
                        faceDetector.end();
                        faceDetector = null;
                    }
                    reject(err);
                });

                faceDetector.on('message', (result) => {
                    if (!isInitialized) {
                        isInitialized = true;
                        if (initializationTimeout) {
                            clearTimeout(initializationTimeout);
                        }
                        console.log('Face detector initialized:', result);
                        return;
                    }
                    
                    if (result.success) {
                        resolve(result);
                    } else {
                        reject(new Error(result.error));
                    }
                });

                faceDetector.on('stderr', (stderr) => {
                    console.error('Python stderr:', stderr);
                });

                faceDetector.on('close', (code) => {
                    console.log('Python process closed with code:', code);
                    if (initializationTimeout) {
                        clearTimeout(initializationTimeout);
                    }
                    faceDetector = null;
                });

                // Test the Python process
                try {
                    faceDetector.send({ image: '' });
                } catch (err) {
                    console.error('Error sending initialization message:', err);
                    if (initializationTimeout) {
                        clearTimeout(initializationTimeout);
                    }
                    if (faceDetector) {
                        faceDetector.end();
                        faceDetector = null;
                    }
                    reject(err);
                }
            }

            // Send image data to Python script
            try {
                faceDetector.send({ image: imageData });
            } catch (err) {
                console.error('Error sending image data:', err);
                if (faceDetector) {
                    faceDetector.end();
                    faceDetector = null;
                }
                reject(err);
            }

        } catch (error) {
            console.error('Face detection error:', error);
            if (initializationTimeout) {
                clearTimeout(initializationTimeout);
            }
            if (faceDetector) {
                faceDetector.end();
                faceDetector = null;
            }
            reject(error);
        }
    });
}); 