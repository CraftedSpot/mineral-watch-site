function escapeHtmlBulk(text) {
    if (!text) return '';
    const str = String(text);
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Open bulk upload modal
function openBulkUploadModal() {
    console.log('openBulkUploadModal called');
    const modal = document.getElementById('bulk-upload-modal');
    console.log('Bulk upload modal element:', modal);
    if (modal) {
        // Force the modal to be visible with inline styles
        modal.style.cssText = 'display: flex !important; position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; width: 100% !important; height: 100% !important; z-index: 99999 !important; background-color: rgba(0, 0, 0, 0.8) !important; align-items: center !important; justify-content: center !important;';
        
        // Force body overflow hidden to prevent scrolling
        document.body.style.overflow = 'hidden';
        
        resetBulkUpload();
        
        // Also check if the modal content is visible
        const modalContent = modal.querySelector('.modal.bulk-modal');
        console.log('Modal content element:', modalContent);
        if (modalContent) {
            modalContent.style.cssText = 'display: block !important; position: relative !important; z-index: 100000 !important; background: white !important; max-width: 900px !important; width: 90% !important; max-height: 90vh !important; overflow: auto !important;';
            console.log('Modal content styles applied');
        }
        
        // Debug: Check computed styles
        const computedStyle = window.getComputedStyle(modal);
        console.log('Modal computed display:', computedStyle.display);
        console.log('Modal computed z-index:', computedStyle.zIndex);
        console.log('Modal computed position:', computedStyle.position);
        
        // Check if modal is in viewport
        const rect = modal.getBoundingClientRect();
        console.log('Modal position:', rect);
    } else {
        console.error('Bulk upload modal not found!');
    }
}

// Make function available globally
window.openBulkUploadModal = openBulkUploadModal;

// Open bulk upload wells modal
function openBulkUploadWellsModal() {
    const modal = document.getElementById('bulk-upload-wells-modal');
    if (modal) {
        // Force the modal to be visible with inline styles
        modal.style.cssText = 'display: flex !important; position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; width: 100% !important; height: 100% !important; z-index: 99999 !important; background-color: rgba(0, 0, 0, 0.8) !important; align-items: center !important; justify-content: center !important;';
        resetBulkUploadWells();
        
        // Also check if the modal content is visible
        const modalContent = modal.querySelector('.modal.bulk-modal');
        if (modalContent) {
            modalContent.style.cssText = 'display: block !important; position: relative !important; z-index: 100000 !important; background: white !important;';
        }
    }
}

// Make function available globally
window.openBulkUploadWellsModal = openBulkUploadWellsModal;

// Close bulk upload modal
function closeBulkUploadModal() {
    document.getElementById('bulk-upload-modal').style.display = 'none';
    document.body.style.overflow = ''; // Restore body scrolling
    resetBulkUpload();
}

// Reset to initial state
function resetBulkUpload() {
    document.getElementById('upload-step').style.display = 'block';
    document.getElementById('preview-step').style.display = 'none';
    document.getElementById('import-step').style.display = 'none';
    document.getElementById('results-step').style.display = 'none';
    document.getElementById('file-info').style.display = 'none';
    document.getElementById('parse-error').style.display = 'none';
    document.getElementById('fileInput').value = '';
    parsedData = [];
    validationResults = null;
}

// Handle file drop
function handleFileDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('dropzone').classList.remove('drag-over');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        processFile(files[0]);
    }
}

// Handle drag over
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('dropzone').classList.add('drag-over');
}

// Handle drag leave
function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('dropzone').classList.remove('drag-over');
}

// Handle file select
function handleFileSelect(e) {
    const files = e.target.files;
    if (files.length > 0) {
        processFile(files[0]);
    }
}

// Process uploaded file
async function processFile(file) {
    document.getElementById('filename').textContent = file.name;
    document.getElementById('filesize').textContent = `${(file.size / 1024).toFixed(1)} KB`;
    document.getElementById('file-info').style.display = 'block';
    document.getElementById('parse-error').style.display = 'none';
    
    try {
        // Detect file type
        const extension = file.name.split('.').pop().toLowerCase();
        
        if (extension === 'csv' || extension === 'txt' || extension === 'tsv') {
            // Parse CSV/TSV
            await parseCSV(file);
        } else if (extension === 'xlsx' || extension === 'xls') {
            // Parse Excel
            await parseExcel(file);
        } else {
            throw new Error('Unsupported file type. Please upload CSV or Excel file.');
        }
        
        // If we got here, parsing succeeded
        if (parsedData.length === 0) {
            throw new Error('No data found in file');
        }
        
        // Validate and show preview
        await validateAndPreview();
        
    } catch (error) {
        console.error('File processing error:', error);
        document.getElementById('error-message').textContent = error.message;
        document.getElementById('parse-error').style.display = 'block';
    }
}

// Parse CSV file
async function parseCSV(file) {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                if (results.errors.length > 0) {
                    reject(new Error(`CSV parsing error: ${results.errors[0].message}`));
                    return;
                }
                parsedData = results.data;
                resolve();
            },
            error: (error) => {
                reject(new Error(`CSV parsing failed: ${error.message}`));
            }
        });
    });
}

// Parse Excel file
async function parseExcel(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                
                // Get first sheet
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet);
                
                if (jsonData.length === 0) {
                    reject(new Error('Excel file contains no data'));
                    return;
                }
                
                parsedData = jsonData;
                resolve();
            } catch (error) {
                reject(new Error(`Excel parsing failed: ${error.message}`));
            }
        };
        
        reader.onerror = () => {
            reject(new Error('Failed to read file'));
        };
        
        reader.readAsArrayBuffer(file);
    });
}

// Validate and show preview
async function validateAndPreview() {
    try {
        const response = await fetch('/api/bulk-validate-properties', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ properties: parsedData })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Validation failed');
        }
        
        validationResults = await response.json();
        
        // Show preview step
        document.getElementById('upload-step').style.display = 'none';
        document.getElementById('preview-step').style.display = 'block';
        
        // Render summary badges
        renderSummary();
        
        // Render plan check
        renderPlanCheck();
        
        // Render preview table
        renderPreviewTable();
        
    } catch (error) {
        console.error('Validation error:', error);
        document.getElementById('error-message').textContent = error.message;
        document.getElementById('parse-error').style.display = 'block';
    }
}

// Render summary badges
function renderSummary() {
    const summary = validationResults.summary;
    const html = `
        <div class="validation-badge badge-valid">
            ✓ ${summary.valid} Valid
        </div>
        ${summary.invalid > 0 ? `
        <div class="validation-badge badge-invalid">
            ❌ ${summary.invalid} Invalid
        </div>
        ` : ''}
        ${summary.warnings > 0 ? `
        <div class="validation-badge badge-warning">
            ⚠️ ${summary.warnings} Warnings
        </div>
        ` : ''}
        ${summary.duplicates > 0 ? `
        <div class="validation-badge badge-duplicate">
            🔄 ${summary.duplicates} Duplicates
        </div>
        ` : ''}
    `;
    document.getElementById('validation-summary').innerHTML = html;
}

// Render plan check
function renderPlanCheck() {
    const plan = validationResults.planCheck;
    const wouldExceed = plan.wouldExceedLimit;
    
    const html = `
        <div class="plan-check-box ${wouldExceed ? 'exceeded' : 'ok'}">
            <div class="plan-check-header">
                ${wouldExceed ? '❌ Would Exceed Plan Limit' : '✓ Within Plan Limit'}
            </div>
            <div class="plan-check-details">
                Current: ${plan.current} properties · 
                Adding: ${validationResults.summary.willImport} · 
                Total: ${plan.afterUpload} of ${plan.limit} (${plan.plan} plan)
            </div>
        </div>
    `;
    document.getElementById('plan-check').innerHTML = html;
    
    // Disable import button if would exceed
    document.getElementById('import-btn').disabled = wouldExceed;
}

// Render preview table
function renderPreviewTable() {
    const tbody = document.getElementById('preview-table-body');
    let html = '';
    
    validationResults.results.forEach((result, index) => {
        const prop = result.normalized;
        const rowClass = result.isDuplicate ? 'preview-row-duplicate' : 
                        (result.errors.length > 0 ? 'preview-row-error' :
                        (result.warnings.length > 0 ? 'preview-row-warning' : 'preview-row-valid'));
        
        const statusClass = result.isDuplicate ? 'status-cell-duplicate' :
                           (result.errors.length > 0 ? 'status-cell-error' :
                           (result.warnings.length > 0 ? 'status-cell-warning' : 'status-cell-valid'));
        
        const statusText = result.isDuplicate ? '🔄 Duplicate' :
                          (result.errors.length > 0 ? `❌ ${result.errors[0]}` :
                          (result.warnings.length > 0 ? `⚠️ ${result.warnings[0]}` : '✓ Valid'));
        
        html += `
            <tr class="${rowClass}">
                <td>${index + 1}</td>
                <td>${escapeHtmlBulk(prop.SEC) || '-'}</td>
                <td>${escapeHtmlBulk(prop.TWN) || '-'}</td>
                <td>${escapeHtmlBulk(prop.RNG) || '-'}</td>
                <td>${escapeHtmlBulk(prop.MERIDIAN) || '-'}</td>
                <td>${escapeHtmlBulk(cleanCountyDisplay(prop.COUNTY)) || '-'}</td>
                <td class="status-cell ${statusClass}">
                    ${statusText}
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

// Start import - with chunking to avoid Worker timeouts
async function startImport() {
    // Show import step
    document.getElementById('preview-step').style.display = 'none';
    document.getElementById('import-step').style.display = 'block';
    
    // Progress tracking
    const progressBar = document.getElementById('progress-bar');
    progressBar.classList.remove('indeterminate');
    
    // Prepare valid properties for upload
    const toImport = validationResults.results
        .filter(r => r.isValid && !r.isDuplicate)
        .map(r => r.normalized);
    
    const CHUNK_SIZE = 50; // Upload 50 at a time to avoid timeouts
    const totalChunks = Math.ceil(toImport.length / CHUNK_SIZE);
    let totalSuccessful = 0;
    let totalFailed = 0;
    let totalErrors = [];
    
    document.getElementById('import-progress').textContent = `Importing ${toImport.length} properties...`;
    
    try {
        // Process chunks sequentially
        for (let i = 0; i < toImport.length; i += CHUNK_SIZE) {
            const chunk = toImport.slice(i, i + CHUNK_SIZE);
            const chunkNumber = Math.floor(i / CHUNK_SIZE) + 1;
            
            // Update progress
            const progress = Math.round((i / toImport.length) * 100);
            progressBar.style.width = `${progress}%`;
            document.getElementById('progress-percent').textContent = `${progress}%`;
            document.getElementById('import-progress').textContent = 
                `Importing batch ${chunkNumber}/${totalChunks} (${i + chunk.length}/${toImport.length} properties)...`;
            
            // Upload chunk
            const response = await fetch('/api/bulk-upload-properties', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ properties: chunk })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || `Batch ${chunkNumber} failed`);
            }
            
            const chunkResults = await response.json();
            totalSuccessful += chunkResults.results.successful;
            totalFailed += chunkResults.results.failed;
            if (chunkResults.results.errors) {
                totalErrors = totalErrors.concat(chunkResults.results.errors);
            }
            
            // Small delay between chunks to avoid overwhelming the server
            if (i + CHUNK_SIZE < toImport.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        // Show completion
        progressBar.style.width = '100%';
        document.getElementById('progress-percent').textContent = '100%';
        document.getElementById('import-progress').textContent = `${totalSuccessful} of ${toImport.length} properties created`;
        
        // Brief delay to show completion
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Show results
        showResults({
            results: {
                successful: totalSuccessful,
                failed: totalFailed,
                skipped: 0,
                errors: totalErrors
            }
        });
        
    } catch (error) {
        console.error('Upload error:', error);
        showError(error.message);
    }
}

// Show results
function showResults(results) {
    document.getElementById('import-step').style.display = 'none';
    document.getElementById('results-step').style.display = 'block';
    
    const success = results.results.successful;
    const failed = results.results.failed;
    const skipped = results.results.skipped;
    
    // Update stat boxes
    document.getElementById('result-created').textContent = success;
    document.getElementById('result-skipped').textContent = skipped;
    document.getElementById('result-failed').textContent = failed;
    
    if (failed === 0) {
        document.getElementById('results-icon').textContent = '✅';
        document.getElementById('results-title').textContent = 'Import Complete!';
        document.getElementById('results-details').textContent = 'Your properties are now being monitored for OCC activity.';
    } else {
        document.getElementById('results-icon').textContent = '⚠️';
        document.getElementById('results-title').textContent = 'Import Completed with Errors';
        document.getElementById('results-details').textContent = 'Some properties could not be imported. Check your file and try again.';
    }
}

// Show error
function showError(message) {
    document.getElementById('import-step').style.display = 'none';
    document.getElementById('results-step').style.display = 'block';
    document.getElementById('results-icon').textContent = '❌';
    document.getElementById('results-title').textContent = 'Import Failed';
    
    // Clear stat boxes
    document.getElementById('result-created').textContent = '0';
    document.getElementById('result-skipped').textContent = '0';
    document.getElementById('result-failed').textContent = '–';
    
    document.getElementById('results-details').textContent = message;
}

// Finish and close
function finishBulkUpload() {
    closeBulkUploadModal();
    // Reload properties
    loadProperties();
}

// ==========================================
// WELLS BULK UPLOAD FUNCTIONS
// ==========================================

let wellsParsedData = [];
let wellsValidationResults = null;

// Close wells modal
function closeBulkUploadWellsModal() {
    document.getElementById('bulk-upload-wells-modal').style.display = 'none';
    resetBulkUploadWells();
}

// Reset wells modal
function resetBulkUploadWells() {
    document.getElementById('wells-upload-step').style.display = 'block';
    document.getElementById('wells-preview-step').style.display = 'none';
    document.getElementById('wells-import-step').style.display = 'none';
    document.getElementById('wells-results-step').style.display = 'none';
    document.getElementById('wells-file-info').style.display = 'none';
    document.getElementById('wells-parse-error').style.display = 'none';
    document.getElementById('wellsFileInput').value = '';
    wellsParsedData = [];
    wellsValidationResults = null;
}

// Handle wells file drop
function handleWellsFileDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('wells-dropzone').classList.remove('drag-over');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        processWellsFile(files[0]);
    }
}

function handleWellsDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('wells-dropzone').classList.add('drag-over');
}

function handleWellsDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('wells-dropzone').classList.remove('drag-over');
}

function handleWellsFileSelect(e) {
    const files = e.target.files;
    if (files.length > 0) {
        processWellsFile(files[0]);
    }
}

// Process wells file
async function processWellsFile(file) {
    document.getElementById('wells-filename').textContent = file.name;
    document.getElementById('wells-filesize').textContent = `${(file.size / 1024).toFixed(1)} KB`;
    document.getElementById('wells-file-info').style.display = 'flex';
    document.getElementById('wells-parse-error').style.display = 'none';
    
    try {
        const extension = file.name.split('.').pop().toLowerCase();
        
        if (extension === 'csv' || extension === 'txt' || extension === 'tsv') {
            await parseWellsCSV(file);
        } else if (extension === 'xlsx' || extension === 'xls') {
            await parseWellsExcel(file);
        } else {
            throw new Error('Unsupported file type');
        }
        
        if (wellsParsedData.length === 0) {
            throw new Error('No data found in file');
        }
        
        await validateAndPreviewWells();
        
    } catch (error) {
        console.error('Wells file processing error:', error);
        document.getElementById('wells-error-message').textContent = error.message;
        document.getElementById('wells-parse-error').style.display = 'block';
    }
}

// Parse CSV for wells
async function parseWellsCSV(file) {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                wellsParsedData = results.data;
                resolve();
            },
            error: (error) => reject(error)
        });
    });
}

// Parse Excel for wells
async function parseWellsExcel(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                wellsParsedData = XLSX.utils.sheet_to_json(firstSheet);
                resolve();
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
    });
}

// Validate and preview wells
async function validateAndPreviewWells() {
    try {
        const response = await fetch('/api/bulk-validate-wells', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wells: wellsParsedData })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Validation failed');
        }
        
        wellsValidationResults = await response.json();
        
        document.getElementById('wells-upload-step').style.display = 'none';
        document.getElementById('wells-preview-step').style.display = 'block';
        
        renderWellsSummary();
        renderWellsPlanCheck();
        renderWellsPreviewTable();
        
    } catch (error) {
        console.error('Wells validation error:', error);
        document.getElementById('wells-error-message').textContent = error.message;
        document.getElementById('wells-parse-error').style.display = 'block';
    }
}

// Render wells summary badges
function renderWellsSummary() {
    const summary = wellsValidationResults.summary;
    const html = `
        <div class="validation-badge badge-valid">✓ ${summary.valid} Valid</div>
        ${summary.invalid > 0 ? `<div class="validation-badge badge-invalid">❌ ${summary.invalid} Invalid</div>` : ''}
        ${summary.duplicates > 0 ? `<div class="validation-badge badge-duplicate">↺ ${summary.duplicates} Duplicates</div>` : ''}
    `;
    document.getElementById('wells-validation-summary').innerHTML = html;
}

// Render wells plan check
function renderWellsPlanCheck() {
    const plan = wellsValidationResults.planCheck;
    const wouldExceed = plan.wouldExceedLimit;
    
    const html = `
        <div class="plan-check-box ${wouldExceed ? 'exceeded' : 'ok'}">
            <div class="plan-check-header">
                ${wouldExceed ? '❌ Would Exceed Plan Limit' : '✓ Within Plan Limit'}
            </div>
            <div class="plan-check-details">
                Current: ${plan.current} wells · 
                Adding: ${wellsValidationResults.summary.willImport} · 
                Total: ${plan.afterUpload} of ${plan.limit} (${plan.plan} plan)
            </div>
        </div>
    `;
    document.getElementById('wells-plan-check').innerHTML = html;
    document.getElementById('wells-import-btn').disabled = wouldExceed;
}

// Render wells preview table
function renderWellsPreviewTable() {
    const tbody = document.getElementById('wells-preview-table-body');
    let html = '';
    
    wellsValidationResults.results.forEach((result, index) => {
        const rowClass = result.isDuplicate ? 'preview-row-duplicate' :
                        (result.errors.length > 0 ? 'preview-row-error' :
                        (result.warnings.length > 0 ? 'preview-row-warning' : 'preview-row-valid'));
        
        const statusClass = result.isDuplicate ? 'status-cell-duplicate' :
                           (result.errors.length > 0 ? 'status-cell-error' :
                           (result.warnings.length > 0 ? 'status-cell-warning' : 'status-cell-valid'));
        
        const statusText = result.isDuplicate ? '↺ Duplicate' :
                          (result.errors.length > 0 ? `❌ ${result.errors[0]}` :
                          (result.warnings.length > 0 ? `⚠️ ${result.warnings[0]}` : '✓ Valid'));
        
        // Truncate notes for preview and escape
        const notesRaw = result.normalized.notes ? 
            (result.normalized.notes.length > 25 ? result.normalized.notes.substring(0, 25) + '...' : result.normalized.notes) : '-';
        const notesPreview = escapeHtmlBulk(notesRaw);
        
        html += `
            <tr class="${rowClass}">
                <td>${index + 1}</td>
                <td>${escapeHtmlBulk(result.normalized.apiNumber) || '-'}</td>
                <td style="font-size: 12px; color: var(--slate-blue);">${notesPreview}</td>
                <td class="status-cell ${statusClass}">${statusText}</td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

// Start wells import
async function startWellsImport() {
    document.getElementById('wells-preview-step').style.display = 'none';
    document.getElementById('wells-import-step').style.display = 'block';
    
    // Progress tracking
    const progressBar = document.getElementById('wells-progress-bar');
    progressBar.classList.remove('indeterminate');
    
    const toImport = wellsValidationResults.results
        .filter(r => r.isValid && !r.isDuplicate)
        .map(r => r.normalized);
    
    const CHUNK_SIZE = 50; // Upload 50 at a time to avoid timeouts
    const totalChunks = Math.ceil(toImport.length / CHUNK_SIZE);
    let totalSuccessful = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    let totalErrors = [];
    
    document.getElementById('wells-import-progress').textContent = `Importing ${toImport.length} wells...`;
    
    try {
        // Process chunks sequentially
        for (let i = 0; i < toImport.length; i += CHUNK_SIZE) {
            const chunk = toImport.slice(i, i + CHUNK_SIZE);
            const chunkNumber = Math.floor(i / CHUNK_SIZE) + 1;
            
            // Update progress
            const progress = Math.round((i / toImport.length) * 100);
            progressBar.style.width = `${progress}%`;
            document.getElementById('wells-import-progress').textContent = 
                `Importing batch ${chunkNumber}/${totalChunks} (${i + chunk.length}/${toImport.length} wells)...`;
            
            const response = await fetch('/api/bulk-upload-wells', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wells: chunk })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || `Batch ${chunkNumber} failed`);
            }
            
            const chunkResults = await response.json();
            totalSuccessful += chunkResults.results.successful;
            totalFailed += chunkResults.results.failed;
            totalSkipped += chunkResults.results.skipped;
            if (chunkResults.results.errors) {
                totalErrors = totalErrors.concat(chunkResults.results.errors);
            }
            
            // Small delay between chunks to avoid rate limiting
            if (i + CHUNK_SIZE < toImport.length) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
        
        // Update final progress
        progressBar.style.width = '100%';
        document.getElementById('wells-import-progress').textContent = 'Processing complete!';
        
        // Brief delay to show completion
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Show results
        const results = {
            results: {
                successful: totalSuccessful,
                failed: totalFailed,
                skipped: totalSkipped,
                errors: totalErrors
            }
        };
        
        showWellsResults(results);
        
    } catch (error) {
        console.error('Wells upload error:', error);
        showWellsError(error.message);
    }
}

// Show wells results
function showWellsResults(results) {
    document.getElementById('wells-import-step').style.display = 'none';
    document.getElementById('wells-results-step').style.display = 'block';
    
    const success = results.results.successful;
    const failed = results.results.failed;
    const skipped = results.results.skipped;
    
    document.getElementById('wells-result-created').textContent = success;
    document.getElementById('wells-result-skipped').textContent = skipped;
    document.getElementById('wells-result-failed').textContent = failed;
    
    if (failed === 0) {
        document.getElementById('wells-results-icon').textContent = '✅';
        document.getElementById('wells-results-title').textContent = 'Import Complete!';
        document.getElementById('wells-results-details').textContent = 'Your wells are now being monitored for OCC activity.';
    } else {
        document.getElementById('wells-results-icon').textContent = '⚠️';
        document.getElementById('wells-results-title').textContent = 'Import Completed with Errors';
        document.getElementById('wells-results-details').textContent = 'Some wells could not be imported.';
    }
}

// Show wells error
function showWellsError(message) {
    document.getElementById('wells-import-step').style.display = 'none';
    document.getElementById('wells-results-step').style.display = 'block';
    document.getElementById('wells-results-icon').textContent = '❌';
    document.getElementById('wells-results-title').textContent = 'Import Failed';
    document.getElementById('wells-result-created').textContent = '0';
    document.getElementById('wells-result-skipped').textContent = '0';
    document.getElementById('wells-result-failed').textContent = '–';
    document.getElementById('wells-results-details').textContent = message;
}

// Finish wells upload
function finishBulkUploadWells() {
    closeBulkUploadWellsModal();
    loadWells();
}
</script>

<!-- Add Papa Parse library (CSV parsing) -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.2/papaparse.min.js"></script>

<!-- SheetJS library removed - now using server-side JSON processing -->

<!-- Custom Confirm Dialog -->
<div class="confirm-overlay" id="confirmDialog">
    <div class="confirm-modal">
        <div class="confirm-header">
            <div class="confirm-icon">⚠️</div>
            <h3 class="confirm-title" id="confirmTitle">Confirm Action</h3>
        </div>
        <div class="confirm-body">
            <p class="confirm-message" id="confirmMessage"></p>
        </div>
        <div class="confirm-buttons">
            <button class="confirm-btn confirm-btn-cancel" id="confirmCancel">Cancel</button>
            <button class="confirm-btn confirm-btn-confirm" id="confirmOk">Delete</button>
        </div>
    </div>
</div>

    </body>
</html>
