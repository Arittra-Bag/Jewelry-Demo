const { contextBridge, ipcRenderer, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');

console.log('Preload script starting...');

// API endpoint
const API_URL = 'http://127.0.0.1:5001';

// Define the API object
const api = {
    // Camera access
    getVideoSources: async () => {
        try {
            console.log('Getting video sources...');
            const sources = await desktopCapturer.getSources({
                types: ['camera'],
                thumbnailSize: { width: 640, height: 480 }
            });
            console.log('Found video sources:', sources);
            return sources;
        } catch (error) {
            console.error('Error getting video sources:', error);
            throw error;
        }
    },

    // Test server connection
    testServer: async () => {
        try {
            console.log('Testing server connection to:', API_URL);
            const response = await fetch(`${API_URL}/test`);
            console.log('Server response status:', response.status);
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Server error response:', errorText);
                throw new Error(`Server test failed: ${response.status} ${errorText}`);
            }
            const data = await response.json();
            console.log('Server test successful:', data);
            return data;
        } catch (error) {
            console.error('Error testing server:', error);
            console.error('Error details:', {
                message: error.message,
                stack: error.stack,
                cause: error.cause
            });
            throw error;
        }
    },

    // Database operations
    getCustomers: () => ipcRenderer.invoke('get-customers'),
    registerCustomer: (name, faceEncoding) => ipcRenderer.invoke('register-customer', { name, face_encoding: faceEncoding }),
    editCustomer: (id, name) => ipcRenderer.invoke('edit-customer', { id, name }),
    deleteCustomer: (customerId) => ipcRenderer.invoke('delete-customer', customerId),
    checkInCustomer: (customerId) => ipcRenderer.invoke('check-in-customer', customerId),
    checkOutCustomer: (customerId) => ipcRenderer.invoke('check-out-customer', customerId),
    getPastRecords: (customerId) => ipcRenderer.invoke('get-past-records', customerId),

    // Inventory operations
    getInventory: () => ipcRenderer.invoke('get-inventory'),
    addInventoryItem: (data) => ipcRenderer.invoke('add-inventory-item', data),
    updateInventoryItem: (data) => ipcRenderer.invoke('update-inventory-item', data),
    deleteInventoryItem: (itemId) => ipcRenderer.invoke('delete-inventory-item', itemId),

    // Face detection methods
    detectFaces: (imageData) => ipcRenderer.invoke('detect-faces', imageData),

    verifyFace: async (faceData) => {
        try {
            const response = await fetch(`${API_URL}/verify_face`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ face_data: faceData })
            });
            
            if (!response.ok) {
                throw new Error('Face verification failed');
            }
            
            return await response.json();
        } catch (error) {
            console.error('Error in verifyFace:', error);
            throw error;
        }
    },

    findExistingCustomer: async (faceEncoding) => {
        try {
            const response = await fetch(`${API_URL}/find_customer`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ face_encoding: faceEncoding })
            });
            
            if (!response.ok) {
                throw new Error('Customer search failed');
            }
            
            return await response.json();
        } catch (error) {
            console.error('Error in findExistingCustomer:', error);
            throw error;
        }
    },

    // Image handling
    saveImage: async (file) => {
        try {
            console.log('Saving image file...');
            const buffer = await file.arrayBuffer();
            const fileName = `${Date.now()}-${file.name}`;
            const productsDir = path.join(__dirname, 'products');
            
            // Create products directory if it doesn't exist
            if (!fs.existsSync(productsDir)) {
                fs.mkdirSync(productsDir, { recursive: true });
            }
            
            const filePath = path.join(productsDir, fileName);
            fs.writeFileSync(filePath, Buffer.from(buffer));
            
            console.log('Image saved successfully:', filePath);
            return filePath;
        } catch (error) {
            console.error('Error saving image:', error);
            throw error;
        }
    }
};

console.log('Exposing API to renderer process...');
console.log('Available API methods:', Object.keys(api));

// Helper functions for image handling
const imageHelpers = {
    arrayBufferToBase64: (buffer) => {
        const binary = Buffer.from(buffer).toString('base64');
        return binary;
    },
    
    getMimeType: (base64String) => {
        const signatures = {
            '/9j/': 'image/jpeg',
            'iVBORw0KGgo': 'image/png',
            'R0lGOD': 'image/gif',
            'UklGR': 'image/webp'
        };
        
        for (let signature in signatures) {
            if (base64String.startsWith(signature)) {
                return signatures[signature];
            }
        }
        return 'image/jpeg'; // default mime type
    }
};

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
    'electronAPI', {
        // Database operations
        getCustomers: () => ipcRenderer.invoke('get-customers'),
        registerCustomer: (name, faceEncoding) => ipcRenderer.invoke('register-customer', { name, face_encoding: faceEncoding }),
        editCustomer: (id, name) => ipcRenderer.invoke('edit-customer', { id, name }),
        deleteCustomer: (customerId) => ipcRenderer.invoke('delete-customer', customerId),
        checkInCustomer: (customerId) => ipcRenderer.invoke('check-in-customer', customerId),
        checkOutCustomer: (customerId) => ipcRenderer.invoke('check-out-customer', customerId),
        getPastRecords: (customerId) => ipcRenderer.invoke('get-past-records', customerId),
        
        // Inventory operations
        getInventory: () => ipcRenderer.invoke('get-inventory'),
        addInventoryItem: (data) => ipcRenderer.invoke('add-inventory-item', data),
        updateInventoryItem: (data) => ipcRenderer.invoke('update-inventory-item', data),
        deleteInventoryItem: (itemId) => ipcRenderer.invoke('delete-inventory-item', itemId),
        
        // Face detection
        detectFaces: (imageData) => ipcRenderer.invoke('detect-faces', imageData),
        
        // Image handling helpers
        arrayBufferToBase64: imageHelpers.arrayBufferToBase64,
        getMimeType: imageHelpers.getMimeType
    }
);

console.log('Preload script completed successfully'); 