class FFmpegClient {
    constructor() {
        this.ws = null;
        this.currentJobId = null;
        this.init();
    }

    init() {
        this.setupTabs();
        this.setupUpload();
        this.setupForms();
        this.setupWebSocket();
        this.setupEventDelegation();
        this.loadFiles();
        this.loadJobs();
    }

    setupTabs() {
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tabId = btn.dataset.tab;
                
                // Remove active class from all tabs and contents
                tabBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));
                
                // Add active class to clicked tab and corresponding content
                btn.classList.add('active');
                document.getElementById(tabId).classList.add('active');
                
                // Load data when switching to certain tabs
                if (tabId === 'jobs') {
                    this.loadJobs();
                }
            });
        });
    }

    setupUpload() {
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');

        uploadArea.addEventListener('click', () => fileInput.click());
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            this.handleFiles(e.dataTransfer.files);
        });

        fileInput.addEventListener('change', (e) => {
            this.handleFiles(e.target.files);
        });
    }

    setupForms() {
        // Convert form
        document.getElementById('convertForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleConvert();
        });

        // Trim form
        document.getElementById('trimForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleTrim();
        });

        // Merge form
        document.getElementById('mergeForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleMerge();
        });

        // Info button
        document.getElementById('getInfoBtn').addEventListener('click', () => {
            this.getMediaInfo();
        });

        // Refresh jobs button
        document.getElementById('refreshJobsBtn').addEventListener('click', () => {
            this.loadJobs();
        });

        // Thumbnail form
        document.getElementById('thumbnailForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.generateThumbnail();
        });

        // Filter form
        document.getElementById('filterForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.applyFilter();
        });

        // Filter type change handler
        document.getElementById('filterType').addEventListener('change', (e) => {
            this.updateFilterOptions(e.target.value);
        });
    }

    setupWebSocket() {
        try {
            // Use same port as the current page for WebSocket
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.host; // includes port if any
            const wsUrl = `${protocol}//${host}`;
            
            console.log('Attempting WebSocket connection to:', wsUrl);
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('WebSocket connected');
            };
            
            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'progress') {
                    this.updateProgress(data.progress);
                }
            };
            
            this.ws.onclose = () => {
                console.log('WebSocket disconnected');
                // Attempt to reconnect after 3 seconds
                setTimeout(() => this.setupWebSocket(), 3000);
            };
        } catch (error) {
            console.error('WebSocket connection failed:', error);
        }
    }

    setupEventDelegation() {
        // Handle download button clicks using event delegation
        document.addEventListener('click', (e) => {
            if (e.target.closest('.download-btn')) {
                const btn = e.target.closest('.download-btn');
                const filename = btn.dataset.filename;
                const isOutput = btn.dataset.isOutput === 'true';
                this.downloadFile(filename, isOutput);
            }
        });
    }

    async handleFiles(files) {
        for (const file of files) {
            await this.uploadFile(file);
        }
        this.loadFiles();
    }

    async uploadFile(file) {
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const result = await response.json();
                this.showToast(`File "${file.name}" uploaded successfully!`, 'success');
                return result;
            } else {
                const error = await response.json();
                this.showToast(`Upload failed: ${error.error}`, 'error');
            }
        } catch (error) {
            this.showToast(`Upload failed: ${error.message}`, 'error');
        }
    }

    async loadFiles() {
        try {
            const response = await fetch('/api/files');
            const files = await response.json();
            
            this.updateFilesList(files);
            this.updateFileSelects(files);
        } catch (error) {
            console.error('Failed to load files:', error);
        }
    }

    updateFilesList(files) {
        const filesList = document.getElementById('filesList');
        
        if (files.length === 0) {
            filesList.innerHTML = '<p>No files uploaded yet.</p>';
            return;
        }

        filesList.innerHTML = files.map(file => `
            <div class="file-item">
                <div class="file-info">
                    <i class="fas fa-file-video"></i>
                    <div class="file-details">
                        <h4>${file.filename}</h4>
                        <p>Size: ${this.formatFileSize(file.size)} | Uploaded: ${new Date(file.uploadedAt).toLocaleString()}</p>
                    </div>
                </div>
                <div class="file-actions">
                    <button class="btn btn-secondary download-btn" data-filename="${file.filename}" data-is-output="false">
                        <i class="fas fa-download"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    updateFileSelects(files) {
        const selects = ['inputFileSelect', 'trimInputFile', 'infoFileSelect', 'thumbInputFile', 'filterInputFile'];
        
        selects.forEach(selectId => {
            const select = document.getElementById(selectId);
            if (select) {
                select.innerHTML = '<option value="">Select a file...</option>';
                
                files.forEach(file => {
                    const option = document.createElement('option');
                    option.value = file.filename;
                    option.textContent = file.filename;
                    select.appendChild(option);
                });
            }
        });

        // Update merge files list
        const mergeList = document.getElementById('mergeFilesList');
        if (mergeList) {
            mergeList.innerHTML = files.map(file => `
                <div class="checkbox-item">
                    <input type="checkbox" id="merge_${file.filename}" value="${file.filename}">
                    <label for="merge_${file.filename}">${file.filename}</label>
                </div>
            `).join('');
        }
    }

    async handleConvert() {
        const formData = new FormData(document.getElementById('convertForm'));
        const data = {
            inputFile: formData.get('inputFileSelect'),
            outputFormat: formData.get('outputFormat'),
            options: {}
        };

        // Add optional parameters
        if (formData.get('videoCodec')) data.options.videoCodec = formData.get('videoCodec');
        if (formData.get('audioCodec')) data.options.audioCodec = formData.get('audioCodec');
        if (formData.get('videoBitrate')) data.options.videoBitrate = formData.get('videoBitrate');
        if (formData.get('audioBitrate')) data.options.audioBitrate = formData.get('audioBitrate');
        if (formData.get('resolution')) data.options.resolution = formData.get('resolution');

        try {
            const response = await fetch('/api/convert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await response.json();
            
            if (response.ok) {
                this.currentJobId = result.jobId;
                this.subscribeToJob(result.jobId);
                this.showProgressModal();
                this.showToast('Conversion started!', 'success');
            } else {
                this.showToast(`Conversion failed: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showToast(`Conversion failed: ${error.message}`, 'error');
        }
    }

    async handleTrim() {
        const formData = new FormData(document.getElementById('trimForm'));
        const data = {
            inputFile: formData.get('trimInputFile'),
            startTime: formData.get('startTime'),
            duration: formData.get('duration')
        };

        try {
            const response = await fetch('/api/trim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await response.json();
            
            if (response.ok) {
                this.currentJobId = result.jobId;
                this.subscribeToJob(result.jobId);
                this.showProgressModal();
                this.showToast('Trimming started!', 'success');
            } else {
                this.showToast(`Trimming failed: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showToast(`Trimming failed: ${error.message}`, 'error');
        }
    }

    async handleMerge() {
        const checkboxes = document.querySelectorAll('#mergeFilesList input[type="checkbox"]:checked');
        const inputFiles = Array.from(checkboxes).map(cb => cb.value);

        if (inputFiles.length < 2) {
            this.showToast('Please select at least 2 files to merge', 'error');
            return;
        }

        try {
            const response = await fetch('/api/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inputFiles })
            });

            const result = await response.json();
            
            if (response.ok) {
                this.currentJobId = result.jobId;
                this.subscribeToJob(result.jobId);
                this.showProgressModal();
                this.showToast('Merging started!', 'success');
            } else {
                this.showToast(`Merging failed: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showToast(`Merging failed: ${error.message}`, 'error');
        }
    }

    async getMediaInfo() {
        const filename = document.getElementById('infoFileSelect').value;
        
        if (!filename) {
            this.showToast('Please select a file', 'error');
            return;
        }

        try {
            const response = await fetch(`/api/info/${filename}`);
            const info = await response.json();
            
            if (response.ok) {
                document.getElementById('mediaInfo').textContent = JSON.stringify(info, null, 2);
            } else {
                this.showToast(`Failed to get media info: ${info.error}`, 'error');
            }
        } catch (error) {
            this.showToast(`Failed to get media info: ${error.message}`, 'error');
        }
    }

    async loadJobs() {
        try {
            const response = await fetch('/api/jobs');
            const jobs = await response.json();
            
            this.updateJobsList(jobs);
        } catch (error) {
            console.error('Failed to load jobs:', error);
        }
    }

    updateJobsList(jobs) {
        const jobsList = document.getElementById('jobsList');
        
        if (jobs.length === 0) {
            jobsList.innerHTML = '<p>No jobs found.</p>';
            return;
        }

        jobsList.innerHTML = jobs.map(job => `
            <div class="job-item ${job.status}">
                <div class="job-header">
                    <div>
                        <strong>Job ID:</strong> ${job.id}
                        <br>
                        <strong>Input:</strong> ${job.inputFile || job.inputFiles?.join(', ') || 'N/A'}
                        <br>
                        <strong>Output:</strong> ${job.outputFile || 'N/A'}
                    </div>
                    <span class="job-status ${job.status}">${job.status}</span>
                </div>
                
                ${job.status === 'processing' ? `
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${job.progress}%"></div>
                    </div>
                    <div>${job.progress}%</div>
                ` : ''}
                
                <div>
                    <small>Started: ${new Date(job.startTime).toLocaleString()}</small>
                    ${job.endTime ? `<br><small>Ended: ${new Date(job.endTime).toLocaleString()}</small>` : ''}
                    ${job.error ? `<br><small style="color: red;">Error: ${job.error}</small>` : ''}
                </div>
                
                ${job.status === 'completed' && job.outputFile ? `
                    <button class="btn btn-primary download-btn" data-filename="${job.outputFile}" data-is-output="true">
                        <i class="fas fa-download"></i> Download Result
                    </button>
                ` : ''}
            </div>
        `).join('');
    }

    subscribeToJob(jobId) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'subscribe',
                jobId: jobId
            }));
        }
    }

    showProgressModal() {
        document.getElementById('progressModal').style.display = 'block';
        document.getElementById('progressFill').style.width = '0%';
        document.getElementById('progressText').textContent = '0%';
        document.getElementById('progressStatus').textContent = 'Starting...';
    }

    hideProgressModal() {
        document.getElementById('progressModal').style.display = 'none';
    }

    updateProgress(progress) {
        document.getElementById('progressFill').style.width = `${progress}%`;
        document.getElementById('progressText').textContent = `${progress}%`;
        
        if (progress === 100) {
            document.getElementById('progressStatus').textContent = 'Completed!';
            setTimeout(() => {
                this.hideProgressModal();
                this.loadJobs();
            }, 2000);
        } else {
            document.getElementById('progressStatus').textContent = 'Processing...';
        }
    }

    downloadFile(filename, isOutput = false) {
        const endpoint = isOutput ? 'download' : 'files';
        window.open(`/api/${endpoint}/${filename}`, '_blank');
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        document.getElementById('toastContainer').appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 5000);
    }

    async generateThumbnail() {
        const filename = document.getElementById('thumbInputFile').value;
        const timestamp = document.getElementById('thumbTimestamp').value || '00:00:01';
        
        if (!filename) {
            this.showToast('Please select a file', 'error');
            return;
        }

        try {
            const response = await fetch(`/api/thumbnail/${filename}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ timestamp })
            });

            const result = await response.json();
            
            if (response.ok) {
                const preview = document.getElementById('thumbnailPreview');
                preview.innerHTML = `
                    <h4>Generated Thumbnail</h4>
                    <img src="${result.thumbnailUrl}" alt="Video thumbnail" />
                    <p>Thumbnail generated at ${timestamp}</p>
                `;
                this.showToast('Thumbnail generated successfully!', 'success');
            } else {
                this.showToast(`Failed to generate thumbnail: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showToast(`Failed to generate thumbnail: ${error.message}`, 'error');
        }
    }

    updateFilterOptions(filterType) {
        const optionsDiv = document.getElementById('filterOptions');
        
        if (!filterType) {
            optionsDiv.innerHTML = '';
            return;
        }

        let optionsHTML = '<h5>Filter Options</h5>';
        
        switch (filterType) {
            case 'watermark':
                optionsHTML += `
                    <div class="form-group">
                        <label for="watermarkText">Watermark Text:</label>
                        <input type="text" id="watermarkText" placeholder="Enter watermark text" required>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="watermarkColor">Color:</label>
                            <select id="watermarkColor">
                                <option value="white">White</option>
                                <option value="black">Black</option>
                                <option value="red">Red</option>
                                <option value="blue">Blue</option>
                                <option value="green">Green</option>
                                <option value="yellow">Yellow</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="watermarkSize">Font Size:</label>
                            <input type="number" id="watermarkSize" value="24" min="12" max="72">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="watermarkX">X Position:</label>
                            <input type="number" id="watermarkX" value="10" min="0">
                        </div>
                        <div class="form-group">
                            <label for="watermarkY">Y Position:</label>
                            <input type="number" id="watermarkY" value="10" min="0">
                        </div>
                    </div>
                `;
                break;
            
            case 'blur':
                optionsHTML += `
                    <div class="form-group">
                        <label for="blurIntensity">Blur Intensity:</label>
                        <input type="range" id="blurIntensity" min="1" max="20" value="5">
                        <span id="blurValue">5</span>
                    </div>
                `;
                break;
            
            case 'brightness':
                optionsHTML += `
                    <div class="form-group">
                        <label for="brightnessValue">Brightness (-1.0 to 1.0):</label>
                        <input type="range" id="brightnessValue" min="-1" max="1" step="0.1" value="0.1">
                        <span id="brightnessDisplay">0.1</span>
                    </div>
                `;
                break;
            
            case 'contrast':
                optionsHTML += `
                    <div class="form-group">
                        <label for="contrastValue">Contrast (0.0 to 3.0):</label>
                        <input type="range" id="contrastValue" min="0" max="3" step="0.1" value="1.2">
                        <span id="contrastDisplay">1.2</span>
                    </div>
                `;
                break;
            
            case 'saturation':
                optionsHTML += `
                    <div class="form-group">
                        <label for="saturationValue">Saturation (0.0 to 3.0):</label>
                        <input type="range" id="saturationValue" min="0" max="3" step="0.1" value="1.5">
                        <span id="saturationDisplay">1.5</span>
                    </div>
                `;
                break;
            
            case 'speed':
                optionsHTML += `
                    <div class="form-group">
                        <label for="speedValue">Speed Multiplier (0.25 to 4.0):</label>
                        <input type="range" id="speedValue" min="0.25" max="4" step="0.25" value="2">
                        <span id="speedDisplay">2.0x</span>
                    </div>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="adjustAudio" checked>
                            Adjust audio speed accordingly
                        </label>
                    </div>
                `;
                break;
            
            case 'stabilize':
                optionsHTML += `
                    <p><i class="fas fa-info-circle"></i> Video stabilization will analyze and smooth camera movements. This process may take longer than other filters.</p>
                `;
                break;
            
            case 'noise_reduction':
                optionsHTML += `
                    <p><i class="fas fa-info-circle"></i> Noise reduction will remove visual noise and grain from the video, improving overall quality.</p>
                `;
                break;
        }
        
        optionsDiv.innerHTML = optionsHTML;
        
        // Add event listeners for range inputs
        const ranges = optionsDiv.querySelectorAll('input[type="range"]');
        ranges.forEach(range => {
            const displayId = range.id.replace('Value', 'Display').replace('Intensity', 'Value');
            const display = document.getElementById(displayId);
            if (display) {
                range.addEventListener('input', () => {
                    let value = range.value;
                    if (range.id === 'speedValue') value += 'x';
                    display.textContent = value;
                });
            }
        });
    }

    async applyFilter() {
        const inputFile = document.getElementById('filterInputFile').value;
        const filterType = document.getElementById('filterType').value;
        
        if (!inputFile || !filterType) {
            this.showToast('Please select a file and filter type', 'error');
            return;
        }

        const options = {};
        
        // Collect filter-specific options
        switch (filterType) {
            case 'watermark':
                const text = document.getElementById('watermarkText')?.value;
                if (!text) {
                    this.showToast('Please enter watermark text', 'error');
                    return;
                }
                options.text = text;
                options.color = document.getElementById('watermarkColor')?.value || 'white';
                options.size = document.getElementById('watermarkSize')?.value || '24';
                options.x = document.getElementById('watermarkX')?.value || '10';
                options.y = document.getElementById('watermarkY')?.value || '10';
                break;
            
            case 'blur':
                options.intensity = document.getElementById('blurIntensity')?.value || '5';
                break;
            
            case 'brightness':
                options.value = document.getElementById('brightnessValue')?.value || '0.1';
                break;
            
            case 'contrast':
                options.value = document.getElementById('contrastValue')?.value || '1.2';
                break;
            
            case 'saturation':
                options.value = document.getElementById('saturationValue')?.value || '1.5';
                break;
            
            case 'speed':
                options.value = document.getElementById('speedValue')?.value || '2.0';
                options.adjustAudio = document.getElementById('adjustAudio')?.checked !== false;
                break;
        }

        try {
            const response = await fetch('/api/filter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inputFile, filterType, options })
            });

            const result = await response.json();
            
            if (response.ok) {
                this.currentJobId = result.jobId;
                this.subscribeToJob(result.jobId);
                this.showProgressModal();
                this.showToast(`${filterType} filter started!`, 'success');
            } else {
                this.showToast(`Filter failed: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showToast(`Filter failed: ${error.message}`, 'error');
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

// Initialize the client when the page loads
const client = new FFmpegClient();
