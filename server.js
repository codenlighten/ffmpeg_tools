const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /\.(mp4|avi|mov|wmv|flv|webm|mkv|mp3|wav|aac|flac|ogg)$/i;
    if (allowedTypes.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video and audio files are allowed.'));
    }
  }
});

// WebSocket server for real-time progress updates
const WS_PORT = process.env.WS_PORT || 8081;
const wss = new WebSocket.Server({ port: WS_PORT });
const activeConnections = new Map();

wss.on('connection', (ws) => {
  const connectionId = uuidv4();
  activeConnections.set(connectionId, ws);
  
  ws.on('message', (message) => {
    const data = JSON.parse(message);
    if (data.type === 'subscribe' && data.jobId) {
      ws.jobId = data.jobId;
    }
  });
  
  ws.on('close', () => {
    activeConnections.delete(connectionId);
  });
});

// Job tracking
const activeJobs = new Map();

// Utility functions
const ensureDirectoryExists = async (dir) => {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
};

const broadcastProgress = (jobId, progress) => {
  activeConnections.forEach((ws) => {
    if (ws.jobId === jobId && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'progress',
        jobId,
        progress
      }));
    }
  });
};

const getMediaInfo = (inputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata);
    });
  });
};

// Initialize directories
const initializeDirectories = async () => {
  await ensureDirectoryExists('uploads');
  await ensureDirectoryExists('outputs');
  await ensureDirectoryExists('temp');
  await ensureDirectoryExists('thumbnails');
};

// Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Upload file
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileInfo = {
      id: uuidv4(),
      originalName: req.file.originalname,
      filename: req.file.filename,
      path: req.file.path,
      size: req.file.size,
      uploadedAt: new Date().toISOString()
    };

    // Get media information
    try {
      const mediaInfo = await getMediaInfo(req.file.path);
      fileInfo.mediaInfo = mediaInfo;
    } catch (error) {
      console.warn('Could not extract media info:', error.message);
    }

    res.json(fileInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get media information
app.get('/api/info/:filename', async (req, res) => {
  try {
    const filePath = path.join('uploads', req.params.filename);
    const mediaInfo = await getMediaInfo(filePath);
    res.json(mediaInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate video thumbnail
app.post('/api/thumbnail/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const { timestamp = '00:00:01' } = req.body;
    const inputPath = path.join('uploads', filename);
    const thumbnailFilename = `thumb_${Date.now()}_${filename.replace(/\.[^/.]+$/, '')}.jpg`;
    const thumbnailPath = path.join('thumbnails', thumbnailFilename);

    // Check if input file exists
    try {
      await fs.access(inputPath);
    } catch {
      return res.status(404).json({ error: 'Input file not found' });
    }

    // Generate thumbnail
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .seekInput(timestamp)
        .frames(1)
        .size('320x240')
        .output(thumbnailPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    res.json({ 
      thumbnailFile: thumbnailFilename,
      thumbnailUrl: `/api/thumbnail/view/${thumbnailFilename}`,
      message: 'Thumbnail generated successfully' 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve thumbnail images
app.get('/api/thumbnail/view/:filename', async (req, res) => {
  try {
    const filePath = path.join('thumbnails', req.params.filename);
    await fs.access(filePath);
    res.sendFile(path.resolve(filePath));
  } catch {
    res.status(404).json({ error: 'Thumbnail not found' });
  }
});

// Convert media file
app.post('/api/convert', async (req, res) => {
  try {
    const { inputFile, outputFormat, options = {} } = req.body;
    
    if (!inputFile || !outputFormat) {
      return res.status(400).json({ error: 'inputFile and outputFormat are required' });
    }

    const jobId = uuidv4();
    const inputPath = path.join('uploads', inputFile);
    const outputFilename = `${path.parse(inputFile).name}-${jobId}.${outputFormat}`;
    const outputPath = path.join('outputs', outputFilename);

    // Check if input file exists
    try {
      await fs.access(inputPath);
    } catch {
      return res.status(404).json({ error: 'Input file not found' });
    }

    const job = {
      id: jobId,
      status: 'processing',
      inputFile,
      outputFile: outputFilename,
      startTime: new Date().toISOString(),
      progress: 0
    };

    activeJobs.set(jobId, job);

    // Start conversion
    const command = ffmpeg(inputPath)
      .output(outputPath)
      .format(outputFormat);

    // Apply options
    if (options.videoBitrate) command.videoBitrate(options.videoBitrate);
    if (options.audioBitrate) command.audioBitrate(options.audioBitrate);
    if (options.videoCodec) command.videoCodec(options.videoCodec);
    if (options.audioCodec) command.audioCodec(options.audioCodec);
    if (options.resolution) {
      const [width, height] = options.resolution.split('x');
      command.size(`${width}x${height}`);
    }

    command
      .on('progress', (progress) => {
        job.progress = Math.round(progress.percent || 0);
        broadcastProgress(jobId, job.progress);
      })
      .on('end', () => {
        job.status = 'completed';
        job.endTime = new Date().toISOString();
        job.progress = 100;
        broadcastProgress(jobId, 100);
      })
      .on('error', (err) => {
        job.status = 'failed';
        job.error = err.message;
        job.endTime = new Date().toISOString();
        console.error('Conversion error:', err);
      })
      .run();

    res.json({ jobId, message: 'Conversion started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Trim video
app.post('/api/trim', async (req, res) => {
  try {
    const { inputFile, startTime, duration } = req.body;
    
    if (!inputFile || !startTime || !duration) {
      return res.status(400).json({ error: 'inputFile, startTime, and duration are required' });
    }

    const jobId = uuidv4();
    const inputPath = path.join('uploads', inputFile);
    const outputFilename = `trimmed-${jobId}-${inputFile}`;
    const outputPath = path.join('outputs', outputFilename);

    const job = {
      id: jobId,
      status: 'processing',
      inputFile,
      outputFile: outputFilename,
      startTime: new Date().toISOString(),
      progress: 0
    };

    activeJobs.set(jobId, job);

    ffmpeg(inputPath)
      .seekInput(startTime)
      .duration(duration)
      .output(outputPath)
      .on('progress', (progress) => {
        job.progress = Math.round(progress.percent || 0);
        broadcastProgress(jobId, job.progress);
      })
      .on('end', () => {
        job.status = 'completed';
        job.endTime = new Date().toISOString();
        job.progress = 100;
        broadcastProgress(jobId, 100);
      })
      .on('error', (err) => {
        job.status = 'failed';
        job.error = err.message;
        job.endTime = new Date().toISOString();
      })
      .run();

    res.json({ jobId, message: 'Trimming started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Merge videos
app.post('/api/merge', async (req, res) => {
  try {
    const { inputFiles } = req.body;
    
    if (!inputFiles || !Array.isArray(inputFiles) || inputFiles.length < 2) {
      return res.status(400).json({ error: 'At least 2 input files are required' });
    }

    const jobId = uuidv4();
    const outputFilename = `merged-${jobId}.mp4`;
    const outputPath = path.join('outputs', outputFilename);

    const job = {
      id: jobId,
      status: 'processing',
      inputFiles,
      outputFile: outputFilename,
      startTime: new Date().toISOString(),
      progress: 0
    };

    activeJobs.set(jobId, job);

    const command = ffmpeg();
    
    inputFiles.forEach(file => {
      command.input(path.join('uploads', file));
    });

    command
      .on('progress', (progress) => {
        job.progress = Math.round(progress.percent || 0);
        broadcastProgress(jobId, job.progress);
      })
      .on('end', () => {
        job.status = 'completed';
        job.endTime = new Date().toISOString();
        job.progress = 100;
        broadcastProgress(jobId, 100);
      })
      .on('error', (err) => {
        job.status = 'failed';
        job.error = err.message;
        job.endTime = new Date().toISOString();
      })
      .mergeToFile(outputPath);

    res.json({ jobId, message: 'Merging started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get job status
app.get('/api/job/:jobId', (req, res) => {
  const job = activeJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

// List all jobs
app.get('/api/jobs', (req, res) => {
  const jobs = Array.from(activeJobs.values());
  res.json(jobs);
});

// Download output file
app.get('/api/download/:filename', async (req, res) => {
  try {
    const filePath = path.join('outputs', req.params.filename);
    await fs.access(filePath);
    res.download(filePath);
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

// Apply video filters
app.post('/api/filter', async (req, res) => {
  try {
    const { inputFile, filterType, options = {} } = req.body;
    
    if (!inputFile || !filterType) {
      return res.status(400).json({ error: 'inputFile and filterType are required' });
    }

    const jobId = uuidv4();
    const inputPath = path.join('uploads', inputFile);
    const outputFilename = `filtered_${filterType}_${jobId}_${inputFile}`;
    const outputPath = path.join('outputs', outputFilename);

    // Check if input file exists
    try {
      await fs.access(inputPath);
    } catch {
      return res.status(404).json({ error: 'Input file not found' });
    }

    const job = {
      id: jobId,
      status: 'processing',
      inputFile,
      outputFile: outputFilename,
      filterType,
      startTime: new Date().toISOString(),
      progress: 0
    };

    activeJobs.set(jobId, job);

    let command = ffmpeg(inputPath).output(outputPath);

    // Apply different filters based on type
    switch (filterType) {
      case 'watermark':
        if (options.text) {
          command = command.videoFilters([
            `drawtext=text='${options.text}':fontcolor=${options.color || 'white'}:fontsize=${options.size || '24'}:x=${options.x || '10'}:y=${options.y || '10'}`
          ]);
        }
        break;
      
      case 'blur':
        command = command.videoFilters([`boxblur=${options.intensity || '5:1'}`]);
        break;
      
      case 'brightness':
        const brightness = options.value || '0.1';
        command = command.videoFilters([`eq=brightness=${brightness}`]);
        break;
      
      case 'contrast':
        const contrast = options.value || '1.2';
        command = command.videoFilters([`eq=contrast=${contrast}`]);
        break;
      
      case 'saturation':
        const saturation = options.value || '1.5';
        command = command.videoFilters([`eq=saturation=${saturation}`]);
        break;
      
      case 'speed':
        const speed = options.value || '2.0';
        command = command.videoFilters([`setpts=PTS/${speed}`]);
        if (options.adjustAudio !== false) {
          command = command.audioFilters([`atempo=${speed}`]);
        }
        break;
      
      case 'stabilize':
        command = command.videoFilters(['vidstabdetect=shakiness=10:accuracy=15', 'vidstabtransform=smoothing=30']);
        break;
      
      case 'noise_reduction':
        command = command.videoFilters(['hqdn3d=4:3:6:4.5']);
        break;
      
      default:
        return res.status(400).json({ error: 'Unsupported filter type' });
    }

    command
      .on('progress', (progress) => {
        job.progress = Math.round(progress.percent || 0);
        broadcastProgress(jobId, job.progress);
      })
      .on('end', () => {
        job.status = 'completed';
        job.endTime = new Date().toISOString();
        job.progress = 100;
        broadcastProgress(jobId, 100);
      })
      .on('error', (err) => {
        job.status = 'failed';
        job.error = err.message;
        job.endTime = new Date().toISOString();
        console.error('Filter error:', err);
      })
      .run();

    res.json({ jobId, message: `${filterType} filter started` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List uploaded files
app.get('/api/files', async (req, res) => {
  try {
    const files = await fs.readdir('uploads');
    const fileList = await Promise.all(
      files.map(async (filename) => {
        const filePath = path.join('uploads', filename);
        const stats = await fs.stat(filePath);
        return {
          filename,
          size: stats.size,
          uploadedAt: stats.birthtime.toISOString()
        };
      })
    );
    res.json(fileList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clean up old files (runs daily at midnight)
cron.schedule('0 0 * * *', async () => {
  console.log('Running cleanup job...');
  const now = Date.now();
  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

  try {
    // Clean uploads
    const uploadFiles = await fs.readdir('uploads');
    for (const file of uploadFiles) {
      const filePath = path.join('uploads', file);
      const stats = await fs.stat(filePath);
      if (now - stats.birthtime.getTime() > maxAge) {
        await fs.unlink(filePath);
        console.log(`Deleted old upload: ${file}`);
      }
    }

    // Clean outputs
    const outputFiles = await fs.readdir('outputs');
    for (const file of outputFiles) {
      const filePath = path.join('outputs', file);
      const stats = await fs.stat(filePath);
      if (now - stats.birthtime.getTime() > maxAge) {
        await fs.unlink(filePath);
        console.log(`Deleted old output: ${file}`);
      }
    }
  } catch (error) {
    console.error('Cleanup job error:', error);
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 500MB.' });
    }
  }
  res.status(500).json({ error: error.message });
});

// Start server
const startServer = async () => {
  await initializeDirectories();
  
  app.listen(PORT, () => {
    console.log(`FFmpeg Server Tools running on port ${PORT}`);
    console.log(`WebSocket server running on port ${WS_PORT}`);
    console.log(`API Documentation available at http://localhost:${PORT}`);
  });
};

startServer().catch(console.error);
