// Global variables
let selectedCustomerId = null;
let videoElement = null;
let faceCanvas = null;
let faceCanvasCtx = null;
let isDetecting = false;
let lastDetectionTime = 0;
let lastCustomerId = null;
let lastCustomerName = null;
let lastCustomerVisitTime = null;
let lastCustomerVisitCount = null;
let isProcessing = false;
let stream = null;
let customerUpdateEvent = new Event('customerUpdate');
let customerTableUpdateTimeout = null;
let customerTablePollingInterval = null;
let lastCustomerData = null;

// Initialize UI when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
});

// Initialize UI elements and event listeners
async function initializeUI() {
    console.log('Initializing UI...');
    
    // Initialize video and canvas elements
    videoElement = document.getElementById('videoElement');
    faceCanvas = document.getElementById('faceCanvas');
    
    if (faceCanvas) {
        faceCanvasCtx = faceCanvas.getContext('2d');
        // Set initial canvas size to match video container
        const container = document.querySelector('.camera-feed');
        if (container) {
            faceCanvas.width = container.clientWidth;
            faceCanvas.height = container.clientHeight;
        }
    }
    
    // Set up table selection
    const customerTable = document.getElementById('customerTable');
    if (customerTable) {
        customerTable.addEventListener('click', (e) => {
            const row = e.target.closest('tr');
            if (row) {
                const rows = customerTable.getElementsByTagName('tr');
                for (let r of rows) {
                    r.classList.remove('selected');
                }
                row.classList.add('selected');
                selectedCustomerId = row.dataset.customerId;
            }
        });
    }

    // Set up navigation buttons
    const customersBtn = document.getElementById('customersBtn');
    const inventoryBtn = document.getElementById('inventoryBtn');
    const pastRecordsBtn = document.getElementById('pastRecordsBtn');
    
    if (customersBtn && inventoryBtn && pastRecordsBtn) {
        console.log('Setting up navigation buttons');
        customersBtn.addEventListener('click', () => showView('customers'));
        inventoryBtn.addEventListener('click', () => showView('inventory'));
        pastRecordsBtn.addEventListener('click', () => showView('past-records'));
    } else {
        console.error('Navigation buttons not found:', { customersBtn, inventoryBtn, pastRecordsBtn });
    }
    
    // Set up Add New Item button
    const addNewItemBtn = document.getElementById('addNewItemBtn');
    if (addNewItemBtn) {
        console.log('Setting up Add New Item button');
        addNewItemBtn.addEventListener('click', () => {
            addInventoryItem();
        });
    } else {
        console.error('Add New Item button not found');
    }

    // Add event listener for customer updates
    document.addEventListener('customerUpdate', loadCustomerTable);
    
    // Start polling for customer data
    startCustomerTablePolling();
    
    // Initial load of customer data
    await loadCustomerTable();

    // Load initial inventory data if we're on the inventory view
    if (document.querySelector('.inventory-section').style.display !== 'none') {
        await loadInventoryTable();
    }
}

// Load customer table data
async function loadCustomerTable() {
    try {
        console.log('Loading customer table...');
        const customers = await window.electronAPI.getCustomers();
        console.log('Received customers:', customers);
        
        // Always update the table with new data
        updateCustomerTable(customers);
        
    } catch (err) {
        console.error('Error loading customers:', err);
        console.error('Error stack:', err.stack);
        showError('Failed to load customers: ' + err.message);
    }
}

// Helper function to format date and time
function formatDateTime(dateTimeStr) {
    if (!dateTimeStr) return 'N/A';
    try {
        const date = new Date(dateTimeStr);
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } catch (err) {
        console.error('Error formatting date:', err);
        return dateTimeStr;
    }
}

// Error handling utility
function showError(message) {
    console.error(message);
    // Create error notification element
    const notification = document.createElement('div');
    notification.className = 'notification error';
    notification.textContent = message;
    
    // Add to document
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Success message utility
function showSuccess(message) {
    console.log(message);
    // Create success notification element
    const notification = document.createElement('div');
    notification.className = 'notification success';
    notification.textContent = message;
    
    // Add to document
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Camera handling
async function setupCamera() {
    try {
        // Stop any existing stream
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }

        // Request camera access with preferred settings
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            },
            audio: false
        });

        // Connect the stream to the video element
        videoElement.srcObject = stream;
        await videoElement.play();

        // Set canvas size to match video dimensions
        if (faceCanvas && videoElement.videoWidth && videoElement.videoHeight) {
            faceCanvas.width = videoElement.videoWidth;
            faceCanvas.height = videoElement.videoHeight;
        }

        console.log('Camera setup successful');
        showNotification('Camera started successfully', 'success');
    } catch (error) {
        console.error('Error accessing camera:', error);
        showNotification('Failed to access camera. Please check permissions.', 'error');
    }
}

async function startCamera() {
    const startButton = document.getElementById('startCamera');
    const stopButton = document.getElementById('stopCamera');

    try {
        await setupCamera();
        if (startButton) startButton.style.display = 'none';
        if (stopButton) stopButton.style.display = 'inline-flex';
        
        // Start face detection if available
        if (typeof startFaceDetection === 'function') {
            startFaceDetection();
        }
    } catch (error) {
        console.error('Error starting camera:', error);
        showNotification('Failed to start camera', 'error');
    }
}

function stopCamera() {
    const startButton = document.getElementById('startCamera');
    const stopButton = document.getElementById('stopCamera');

    try {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
            videoElement.srcObject = null;
        }
        if (startButton) startButton.style.display = 'inline-flex';
        if (stopButton) stopButton.style.display = 'none';
        console.log('Camera stopped');
        showNotification('Camera stopped', 'success');
    } catch (error) {
        console.error('Error stopping camera:', error);
        showNotification('Error stopping camera', 'error');
    }
}

// Face detection loop
async function startFaceDetection() {
    if (!videoElement || !videoElement.videoWidth) return;
    
    const now = Date.now();
    if (now - lastDetectionTime < 200) { // Process at 5 FPS
        requestAnimationFrame(startFaceDetection);
        return;
    }
    
    if (isProcessing) {
        requestAnimationFrame(startFaceDetection);
        return;
    }

    isProcessing = true;
    lastDetectionTime = now;

    try {
        // Create a temporary canvas to capture the video frame
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = videoElement.videoWidth;
        tempCanvas.height = videoElement.videoHeight;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(videoElement, 0, 0);

        // Convert canvas to base64 with lower quality for faster transmission
        const imageData = tempCanvas.toDataURL('image/jpeg', 0.8).split(',')[1];
        
        // Use detectFaces instead of detectFace
        const result = await window.electronAPI.detectFaces(imageData);
        
        if (result && result.success) {
            const ctx = faceCanvas.getContext('2d');
            ctx.clearRect(0, 0, faceCanvas.width, faceCanvas.height);
            ctx.drawImage(videoElement, 0, 0);

            // Process each detected face
            if (result.faces && result.faces.length > 0) {
                result.faces.forEach((face, index) => {
                    const { box, similarity_score, customer_name } = face;
                    
                    // Choose color based on recognition status
                    let color = '#FF0000'; // Red for unknown faces
                    let label = 'Unknown';
                    
                    if (customer_name) {
                        color = '#00FF00'; // Green for recognized faces
                        label = `Checked-in: ${customer_name}`;
                        
                        // Store last detected customer info
                        lastCustomerId = face.customer_id;
                        lastCustomerName = customer_name;
                    }

                    // Draw face box
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 3;
                    const [x, y, x2, y2] = box;
                    const width = x2 - x;
                    const height = y2 - y;
                    ctx.strokeRect(x, y, width, height);

                    // Draw label background
                    ctx.fillStyle = color;
                    const labelY = y - 10;
                    const labelX = x;
                    ctx.font = 'bold 16px Arial';
                    const textWidth = ctx.measureText(label).width;
                    ctx.fillRect(labelX - 2, labelY - 20, textWidth + 4, 25);

                    // Draw label text
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillText(label, labelX, labelY);

                    // Draw similarity score if available
                    if (similarity_score !== undefined) {
                        const scoreText = `Score: ${similarity_score.toFixed(3)}`;
                        ctx.font = 'bold 14px Arial';
                        ctx.fillStyle = '#FFFFFF';
                        ctx.strokeStyle = '#000000';
                        ctx.lineWidth = 2;
                        ctx.strokeText(scoreText, 10, 25 + (index * 25));
                        ctx.fillText(scoreText, 10, 25 + (index * 25));
                    }

                    // Add click handler for face box
                    faceCanvas.onclick = async (e) => {
                        const rect = faceCanvas.getBoundingClientRect();
                        const clickX = e.clientX - rect.left;
                        const clickY = e.clientY - rect.top;
                        
                        const canvasScale = faceCanvas.width / faceCanvas.clientWidth;
                        const scaledX = clickX * canvasScale;
                        const scaledY = clickY * canvasScale;
                        
                        if (isClickInBox(scaledX, scaledY, { x, y, width, height })) {
                            if (customer_name) {
                                if (face.exit_time) {
                                    await checkInCustomer(face.customer_id);
                                } else {
                                    showNotification(`${customer_name} is already checked in`, 'info');
                                }
                            } else {
                                showRegistrationDialog({ face_encoding: face.face_encoding });
                            }
                        }
                    };
                });
            }
        } else if (result && result.error) {
            console.error('Face detection error:', result.error);
            showNotification(`Face detection error: ${result.error}`, 'error');
        }
    } catch (err) {
        console.error('Face detection error:', err);
        showNotification(`Face detection error: ${err.message}`, 'error');
    }

    isProcessing = false;
    requestAnimationFrame(startFaceDetection);
}

// Helper function to check if a point is inside a box
function isClickInBox(x, y, box) {
    const scale = faceCanvas.width / faceCanvas.clientWidth;
    const scaledX = x * scale;
    const scaledY = y * scale;
    return (
        scaledX >= box.x && 
        scaledX <= box.x + box.width && 
        scaledY >= box.y && 
        scaledY <= box.y + box.height
    );
}

// Helper function to draw face box with label
function drawFaceBox(ctx, box, color, label) {
    // Draw box
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    // Draw label background
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = color;
    ctx.fillRect(box.x - 2, box.y - 25, textWidth + 4, 20);

    // Draw label text
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '16px Arial';
    ctx.fillText(label, box.x, box.y - 10);
}

// Customer management functions
async function checkInCustomer() {
    if (!lastCustomerId) {
        showNotification('No customer detected', 'error');
        return;
    }

    try {
        await window.electronAPI.checkInCustomer(lastCustomerId);
        showNotification('Customer checked in successfully', 'success');
        // Force immediate update
        await loadCustomerTable();
    } catch (err) {
        console.error('Error checking in customer:', err);
        showNotification('Error checking in customer', 'error');
    }
}

async function checkOutCustomer() {
    if (!selectedCustomerId) {
        showNotification('Please select a customer to check out', 'error');
        return;
    }

    try {
        await window.electronAPI.checkOutCustomer(selectedCustomerId);
        showNotification('Customer checked out successfully', 'success');
        // Force immediate update
        await loadCustomerTable();
        selectedCustomerId = null; // Reset selected customer after checkout
    } catch (err) {
        console.error('Error checking out customer:', err);
        showNotification('Error checking out customer', 'error');
    }
}

async function showPastRecords() {
    if (!selectedCustomerId) {
        showNotification('Please select a customer to view past records', 'error');
        return;
    }

    try {
        const records = await window.electronAPI.getPastRecords(selectedCustomerId);
        showRecordsModal(records);
    } catch (err) {
        console.error('Error loading past records:', err);
        showNotification('Error loading past records', 'error');
    }
}

function showRegistrationDialog(faceData) {
    const dialog = document.createElement('div');
    dialog.className = 'modal';
    dialog.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Register New Customer</h2>
                <button class="close-button">&times;</button>
            </div>
            <div class="modal-body">
                <label for="customerName">Customer Name:</label>
                <input type="text" id="customerName" class="form-input">
                <button id="registerButton" class="primary-button">Register</button>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);

    const closeButton = dialog.querySelector('.close-button');
    const registerButton = dialog.querySelector('#registerButton');
    const nameInput = dialog.querySelector('#customerName');

    closeButton.onclick = () => dialog.remove();

    registerButton.onclick = async () => {
        const name = nameInput.value.trim();
        if (!name) {
            showNotification('Please enter a name', 'error');
            return;
        }

        try {
            await window.electronAPI.registerCustomer(name, faceData.face_encoding);
            showNotification('Customer registered successfully', 'success');
            // Force immediate update
            await loadCustomerTable();
            dialog.remove();
        } catch (err) {
            console.error('Error registering customer:', err);
            showNotification('Error registering customer', 'error');
        }
    };
}

// Show inventory modal
async function showInventory() {
    console.log('showInventory function called');
    try {
        // Remove any existing inventory modal
        const existingModal = document.getElementById('inventoryModal');
        if (existingModal) {
            existingModal.remove();
        }

        console.log('Fetching inventory data...');
        await refreshInventoryDisplay();

    } catch (error) {
        console.error('Error in showInventory:', error);
        showNotification('Error loading inventory: ' + error.message, 'error');
    }
}

// Modify the refreshInventoryDisplay function
async function refreshInventoryDisplay() {
    try {
        const inventory = await window.electronAPI.getInventory();
        console.log('Inventory data received:', inventory);

        const existingModal = document.getElementById('inventoryModal');
        if (!existingModal) {
            return;
        }

        // Create or update modal content
        const modalContent = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Inventory Management</h2>
                    <span class="close" id="closeInventoryModal">&times;</span>
                </div>
                <div class="modal-body">
                    ${inventory.length === 0 ? `
                        <div class="empty-state">
                            <div class="empty-state-icon">📦</div>
                            <p>No inventory items found</p>
                        </div>
                    ` : `
                        <div class="inventory-table-container">
                            <table class="inventory-table">
                                <thead>
                                    <tr>
                                        <th>Image</th>
                                        <th>Product Name</th>
                                        <th>Price</th>
                                        <th>Quantity</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${inventory.map(item => `
                                        <tr>
                                            <td>
                                                ${item.image_path ? `
                                                    <img src="${item.image_path}" alt="${item.product_name || 'Product'}" class="product-image">
                                                ` : `
                                                    <div class="no-image">No Image</div>
                                                `}
                                            </td>
                                            <td>${item.product_name || 'N/A'}</td>
                                            <td>$${typeof item.price === 'number' ? item.price.toFixed(2) : '0.00'}</td>
                                            <td>${item.quantity || 0}</td>
                                            <td>
                                                <div class="action-buttons">
                                                    <button class="update-button" data-id="${item.product_id}">Update</button>
                                                    <button class="delete-button" data-id="${item.product_id}" data-name="${item.product_name}">Delete</button>
                                                </div>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    `}
                    <div class="button-group">
                        <button id="addNewItemBtn" class="add-inventory-button">
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M10 5V15M5 10H15M19 10C19 14.9706 14.9706 19 10 19C5.02944 19 1 14.9706 1 10C1 5.02944 5.02944 1 10 1C14.9706 1 19 5.02944 19 10Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                            Add New Item
                        </button>
                    </div>
                </div>
            </div>
        `;

        if (!existingModal) {
            // Create new modal if it doesn't exist
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'inventoryModal';
            modal.style.display = 'block';
            modal.innerHTML = modalContent;
            document.body.appendChild(modal);

            // Add event listeners
            setupInventoryModalEventListeners(modal);
        } else {
            // Update existing modal content
            existingModal.innerHTML = modalContent;
            setupInventoryModalEventListeners(existingModal);
        }

    } catch (error) {
        console.error('Error refreshing inventory display:', error);
        showNotification('Error refreshing inventory', 'error');
    }
}

// Modify the setupInventoryModalEventListeners function
function setupInventoryModalEventListeners(modal) {
    // Add close button functionality
    const closeBtn = modal.querySelector('#closeInventoryModal');
    closeBtn.onclick = function() {
        modal.remove();
    }

    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });

    // Add event listeners for update buttons
    const updateButtons = modal.querySelectorAll('.update-button');
    updateButtons.forEach(button => {
        button.addEventListener('click', () => {
            const itemId = parseInt(button.dataset.id);
            updateInventoryItem(itemId);
        });
    });

    // Add event listeners for delete buttons
    const deleteButtons = modal.querySelectorAll('.delete-button');
    deleteButtons.forEach(button => {
        button.addEventListener('click', async () => {
            const itemId = parseInt(button.dataset.id);
            const productName = button.dataset.name;
            
            const confirmDelete = confirm(`Are you sure you want to delete "${productName}"?`);
            if (confirmDelete) {
                try {
                    await window.electronAPI.deleteInventoryItem(itemId);
                    showNotification('Item deleted successfully', 'success');
                    await refreshInventoryDisplay();
                } catch (error) {
                    console.error('Error deleting item:', error);
                    showNotification('Failed to delete item: ' + error.message, 'error');
                }
            }
        });
    });

    // Add event listener for Add New Item button
    const addNewItemBtn = modal.querySelector('#addNewItemBtn');
    if (addNewItemBtn) {
        addNewItemBtn.addEventListener('click', () => {
            addInventoryItem();
        });
    }
}

// Modify the closeModal function
function closeModal() {
    const modal = document.querySelector('.modal');
    if (modal) {
        modal.remove();
    }
}

// Show different views based on navigation
async function showView(viewName) {
    console.log('Showing view:', viewName);
    
    // Hide all sections first
    document.querySelector('.customer-section').style.display = 'none';
    document.querySelector('.inventory-section').style.display = 'none';
    document.querySelector('.past-records-section').style.display = 'none';
    
    // Remove active class from all buttons
    document.querySelectorAll('.nav-button').forEach(btn => btn.classList.remove('active'));
    
    // Show selected section and activate corresponding button
    switch (viewName) {
        case 'customers':
            document.querySelector('.customer-section').style.display = 'block';
            document.getElementById('customersBtn').classList.add('active');
            await loadCustomerTable();
            break;
        case 'inventory':
            document.querySelector('.inventory-section').style.display = 'block';
            document.getElementById('inventoryBtn').classList.add('active');
            await loadInventoryTable();
            break;
        case 'past-records':
            console.log('Loading past records view...');
            const pastRecordsSection = document.querySelector('.past-records-section');
            pastRecordsSection.style.display = 'block';
            document.getElementById('pastRecordsBtn').classList.add('active');
            try {
                await loadPastRecordsTable();
                console.log('Past records loaded successfully');
            } catch (error) {
                console.error('Error loading past records:', error);
                showError('Failed to load past records: ' + error.message);
            }
            break;
    }
}

// UI Helpers
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);

    // Remove notification after 3 seconds
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

function showRecordsModal(records) {
    const content = `
        <table class="modal-table">
            <thead>
                <tr>
                    <th>Entry Time</th>
                    <th>Exit Time</th>
                    <th>Duration</th>
                </tr>
            </thead>
            <tbody>
                ${records.map(record => `
                    <tr>
                        <td>${formatDateTime(record.entry_time)}</td>
                        <td>${record.exit_time ? formatDateTime(record.exit_time) : '-'}</td>
                        <td>${calculateDuration(record.entry_time, record.exit_time)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `
}

// Modal creation helper function
function createModal(title, content) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>${title}</h2>
                <button class="close-button" onclick="this.closest('.modal').remove()">&times;</button>
            </div>
            <div class="modal-body">
                ${content}
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });

    return modal;
}

// Modify the updateCustomerTable function
function updateCustomerTable(customers) {
    const tbody = document.querySelector('#customerTable tbody');
    if (!tbody) {
        console.error('Customer table tbody not found');
        return;
    }

    // Store current scroll position
    const scrollPosition = tbody.scrollTop;
    
    // Create a temporary container for the new content
    const tempContainer = document.createElement('tbody');
    
    if (customers && customers.length > 0) {
        customers.forEach((customer, index) => {
            const tr = document.createElement('tr');
            tr.dataset.customerId = customer.customer_id;
            
            // Create status badge
            const status = customer.exit_time ? 'Checked Out' : (customer.entry_time ? 'Checked In' : 'Not Checked In');
            const statusClass = status === 'Checked In' ? 'checked-in' : 'checked-out';
            
            tr.innerHTML = `
                <td>${customer.name || 'N/A'}</td>
                <td>${formatDateTime(customer.entry_time)}</td>
                <td>${customer.exit_time ? formatDateTime(customer.exit_time) : '-'}</td>
                <td><span class="status-badge ${statusClass}">${status}</span></td>
                <td><span class="visit-count">${customer.visit_count || 0}</span></td>
            `;
            
            // Add click handler for row selection
            tr.addEventListener('click', () => {
                const rows = tbody.parentNode.getElementsByTagName('tr');
                for (let r of rows) {
                    r.classList.remove('selected');
                }
                tr.classList.add('selected');
                selectedCustomerId = customer.customer_id;
            });
            
            tempContainer.appendChild(tr);
        });
    } else {
        tempContainer.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 2rem;">
                    No customers found
                </td>
            </tr>
        `;
    }

    // Replace the old tbody with the new one
    tbody.parentNode.replaceChild(tempContainer, tbody);
    
    // Restore scroll position
    tempContainer.scrollTop = scrollPosition;
}

// Add new function to start polling
function startCustomerTablePolling() {
    // Clear any existing interval
    if (customerTablePollingInterval) {
        clearInterval(customerTablePollingInterval);
    }
    
    // Poll every 500ms
    customerTablePollingInterval = setInterval(loadCustomerTable, 500);
}

// Load and display inventory data
async function loadInventoryTable() {
    try {
        console.log('Loading inventory data...');
        const inventory = await window.electronAPI.getInventory();
        console.log('Received inventory:', inventory);
        updateInventoryTable(inventory);
    } catch (error) {
        console.error('Error loading inventory:', error);
        showError('Failed to load inventory: ' + error.message);
    }
}

// Update inventory table with data
function updateInventoryTable(items) {
    const tableBody = document.getElementById('inventoryTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = '';
    items.forEach(item => {
        const row = document.createElement('tr');
        
        // Handle image display
        let imageHtml = '<td>No Image</td>';
        if (item.product_image) {
            try {
                // Convert Buffer to base64 in chunks to avoid call stack issues
                const chunks = [];
                let array = new Uint8Array(item.product_image);
                const chunkSize = 8192;
                for (let i = 0; i < array.length; i += chunkSize) {
                    chunks.push(String.fromCharCode.apply(null, array.slice(i, i + chunkSize)));
                }
                const base64String = btoa(chunks.join(''));
                
                // Determine MIME type from the first few bytes
                let mimeType = 'image/jpeg'; // default
                if (array[0] === 0x89 && array[1] === 0x50) {
                    mimeType = 'image/png';
                } else if (array[0] === 0x47 && array[1] === 0x49) {
                    mimeType = 'image/gif';
                }

                imageHtml = `<td><img src="data:${mimeType};base64,${base64String}" alt="${item.product_name}" style="max-width: 100px; max-height: 100px; object-fit: contain;"></td>`;
            } catch (error) {
                console.error('Error processing image:', error);
                imageHtml = '<td>Error loading image</td>';
            }
        }

        row.innerHTML = `
            ${imageHtml}
            <td>${item.product_name}</td>
            <td>$${item.price.toFixed(2)}</td>
            <td>${item.quantity}</td>
            <td class="action-buttons">
                <button onclick="updateItem('${item.product_id}')" class="action-button update">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                    Edit
                </button>
                <button onclick="deleteItem('${item.product_id}')" class="action-button delete">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18"></path>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                    Delete
                </button>
            </td>
        `;
        tableBody.appendChild(row);
    });
}

// Add new inventory item
async function addInventoryItem() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Add New Item</h2>
                <button class="close-button" onclick="this.closest('.modal').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <form id="addItemForm" class="inventory-form">
                    <div class="form-group">
                        <label for="productName">Product Name *</label>
                        <input type="text" id="productName" required class="form-input">
                    </div>
                    <div class="form-group">
                        <label for="price">Price *</label>
                        <input type="number" id="price" required min="0" step="0.01" class="form-input">
                    </div>
                    <div class="form-group">
                        <label for="quantity">Quantity *</label>
                        <input type="number" id="quantity" required min="0" class="form-input">
                    </div>
                    <div class="form-group">
                        <label for="productImage">Product Image</label>
                        <input type="file" id="productImage" accept="image/*" class="form-input">
                        <div id="imagePreview" class="image-preview"></div>
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="action-button update">Add Item</button>
                        <button type="button" class="action-button delete" onclick="this.closest('.modal').remove()">Cancel</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Image preview functionality
    const imageInput = modal.querySelector('#productImage');
    const imagePreview = modal.querySelector('#imagePreview');
    
    imageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                imagePreview.innerHTML = `<img src="${e.target.result}" alt="Preview" style="max-width: 200px; max-height: 200px;">`;
            };
            reader.readAsDataURL(file);
        }
    });

    // Form submission
    const form = modal.querySelector('#addItemForm');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        try {
            const formData = {
                product_id: `J${Date.now()}`, // Generate a unique ID
                product_name: form.querySelector('#productName').value,
                price: parseFloat(form.querySelector('#price').value),
                quantity: parseInt(form.querySelector('#quantity').value),
                product_image: null
            };

            // Handle image if selected
            const imageFile = form.querySelector('#productImage').files[0];
            if (imageFile) {
                const arrayBuffer = await imageFile.arrayBuffer();
                formData.product_image = new Uint8Array(arrayBuffer);
            }

            await window.electronAPI.addInventoryItem(formData);
            showSuccess('Item added successfully');
            modal.remove();
            
            // Refresh the inventory display
            await loadInventoryTable();
        } catch (error) {
            console.error('Error adding inventory item:', error);
            showError('Failed to add item: ' + error.message);
        }
    });
}

// Update inventory item
async function updateItem(itemId) {
    try {
        // Get the current item data
        const inventory = await window.electronAPI.getInventory();
        const item = inventory.find(i => i.product_id === itemId);
        
        if (!item) {
            throw new Error('Item not found');
        }

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Update Item</h2>
                    <button class="close-button" onclick="this.closest('.modal').remove()">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="updateItemForm" class="inventory-form">
                        <div class="form-group">
                            <label for="productName">Product Name *</label>
                            <input type="text" id="productName" required class="form-input" value="${item.product_name}">
                        </div>
                        <div class="form-group">
                            <label for="price">Price *</label>
                            <input type="number" id="price" required min="0" step="0.01" class="form-input" value="${item.price}">
                        </div>
                        <div class="form-group">
                            <label for="quantity">Quantity *</label>
                            <input type="number" id="quantity" required min="0" class="form-input" value="${item.quantity}">
                        </div>
                        <div class="form-group">
                            <label for="productImage">Product Image</label>
                            <input type="file" id="productImage" accept="image/*" class="form-input">
                            <div id="imagePreview" class="image-preview">
                                ${item.product_image ? `<img src="data:${window.electronAPI.getMimeType(btoa(String.fromCharCode.apply(null, new Uint8Array(item.product_image.data || item.product_image))))};base64,${btoa(String.fromCharCode.apply(null, new Uint8Array(item.product_image.data || item.product_image)))}" alt="Current Image">` : ''}
                            </div>
                        </div>
                        <div class="form-actions">
                            <button type="submit" class="action-button update">Update Item</button>
                            <button type="button" class="action-button delete" onclick="this.closest('.modal').remove()">Cancel</button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Image preview functionality
        const imageInput = modal.querySelector('#productImage');
        const imagePreview = modal.querySelector('#imagePreview');
        
        imageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    imagePreview.innerHTML = `<img src="${e.target.result}" alt="Preview" style="max-width: 200px; max-height: 200px;">`;
                };
                reader.readAsDataURL(file);
            }
        });

        // Form submission
        const form = modal.querySelector('#updateItemForm');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            try {
                const formData = {
                    product_id: itemId,
                    product_name: form.querySelector('#productName').value,
                    price: parseFloat(form.querySelector('#price').value),
                    quantity: parseInt(form.querySelector('#quantity').value),
                    product_image: item.product_image // Keep existing image by default
                };

                // Handle new image if selected
                const imageFile = form.querySelector('#productImage').files[0];
                if (imageFile) {
                    const arrayBuffer = await imageFile.arrayBuffer();
                    formData.product_image = new Uint8Array(arrayBuffer);
                }

                await window.electronAPI.updateInventoryItem(formData);
                showSuccess('Item updated successfully');
                modal.remove();
                
                // Refresh the inventory display
                await loadInventoryTable();
            } catch (error) {
                console.error('Error updating inventory item:', error);
                showError('Failed to update item: ' + error.message);
            }
        });
    } catch (error) {
        console.error('Error preparing update form:', error);
        showError('Failed to prepare update form: ' + error.message);
    }
}

// Delete inventory item
async function deleteItem(itemId) {
    try {
        if (confirm('Are you sure you want to delete this item?')) {
            await window.electronAPI.deleteInventoryItem(itemId);
            showSuccess('Item deleted successfully');
            await loadInventoryTable(); // Refresh the table
        }
    } catch (error) {
        console.error('Error deleting inventory item:', error);
        showError('Failed to delete item: ' + error.message);
    }
}

// Load past records table data
async function loadPastRecordsTable() {
    try {
        console.log('Loading past records table...');
        const records = await window.electronAPI.getPastRecords();
        console.log('Received past records:', records);
        
        const tableBody = document.getElementById('pastRecordsTableBody');
        if (!tableBody) {
            console.error('Past records table body not found');
            throw new Error('Table body element not found');
        }
        
        // Clear existing rows
        tableBody.innerHTML = '';
        
        if (!records || records.length === 0) {
            console.log('No past records found');
            const row = document.createElement('tr');
            row.innerHTML = `
                <td colspan="6" class="no-records">No past records found</td>
            `;
            tableBody.appendChild(row);
            return;
        }
        
        // Add new rows
        records.forEach(record => {
            console.log('Processing record:', record);
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${record.customer_name || 'Unknown'}</td>
                <td>${formatDateTime(record.entry_time)}</td>
                <td>${formatDateTime(record.exit_time)}</td>
                <td class="duration">${record.duration || 'N/A'}</td>
                <td>${record.product_name || 'N/A'}</td>
                <td class="price">${record.price !== 'N/A' ? `$${record.price}` : 'N/A'}</td>
            `;
            tableBody.appendChild(row);
        });
        
        console.log('Past records table updated successfully');
        
    } catch (err) {
        console.error('Error loading past records:', err);
        console.error('Error stack:', err.stack);
        
        // Show error in table
        const tableBody = document.getElementById('pastRecordsTableBody');
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="error-message">
                        Error loading past records: ${err.message}
                    </td>
                </tr>
            `;
        }
        throw err;
    }
}