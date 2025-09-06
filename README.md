# FFmpeg Server Tools

A comprehensive set of FFmpeg server tools for media processing with a modern web interface and RESTful API.

## Features

### Core Functionality
- **File Upload**: Drag & drop or browse to upload video/audio files
- **Media Conversion**: Convert between various formats (MP4, AVI, MOV, WebM, MKV, MP3, WAV, AAC, FLAC, etc.)
- **Video Editing**: Trim videos and merge multiple files
- **Media Information**: Extract detailed metadata from media files
- **Real-time Progress**: WebSocket-based progress tracking for long-running operations
- **Job Management**: Track and monitor all processing jobs
- **Batch Processing**: Handle multiple files simultaneously

### Technical Features
- **RESTful API**: Complete API for programmatic access
- **Web Interface**: Modern, responsive UI with drag & drop support
- **Security**: Rate limiting, file type validation, and security headers
- **Auto Cleanup**: Automatic cleanup of old files (configurable)
- **Error Handling**: Comprehensive error handling and user feedback

## Installation

### Prerequisites
- Node.js (v14 or higher)
- FFmpeg installed on your system

### Install FFmpeg

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install ffmpeg
```

#### macOS
```bash
brew install ffmpeg
```

#### Windows
Download from [https://ffmpeg.org/download.html](https://ffmpeg.org/download.html)

### Setup Project
```bash
# Clone or download the project
cd ffmpeg-server-tools

# Install dependencies
npm install

# Start the server
npm start

# For development (with auto-restart)
npm run dev
```

## Usage

### Web Interface
1. Open your browser and go to `http://localhost:3000`
2. Use the tabs to navigate between different functions:
   - **Upload**: Upload your media files
   - **Convert**: Convert files to different formats
   - **Edit**: Trim videos or merge multiple files
   - **Info**: Get detailed media information
   - **Jobs**: Monitor processing jobs

### API Endpoints

#### File Operations
- `POST /api/upload` - Upload a file
- `GET /api/files` - List uploaded files
- `GET /api/download/:filename` - Download output file

#### Media Processing
- `POST /api/convert` - Convert media file
- `POST /api/trim` - Trim video
- `POST /api/merge` - Merge multiple videos
- `GET /api/info/:filename` - Get media information

#### Job Management
- `GET /api/job/:jobId` - Get job status
- `GET /api/jobs` - List all jobs

#### Health Check
- `GET /api/health` - Server health status

### API Examples

#### Upload a file
```bash
curl -X POST -F "file=@video.mp4" http://localhost:3000/api/upload
```

#### Convert a file
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "inputFile": "video.mp4",
    "outputFormat": "webm",
    "options": {
      "videoCodec": "libvpx-vp9",
      "videoBitrate": "1000k",
      "resolution": "1280x720"
    }
  }' \
  http://localhost:3000/api/convert
```

#### Trim a video
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "inputFile": "video.mp4",
    "startTime": "00:00:30",
    "duration": "00:01:00"
  }' \
  http://localhost:3000/api/trim
```

#### Get media information
```bash
curl http://localhost:3000/api/info/video.mp4
```

## Configuration

### Environment Variables
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)

### File Limits
- Maximum file size: 500MB (configurable in server.js)
- Supported formats: MP4, AVI, MOV, WMV, FLV, WebM, MKV, MP3, WAV, AAC, FLAC, OGG

### Cleanup Schedule
- Old files are automatically cleaned up daily at midnight
- Files older than 7 days are removed (configurable)

## Directory Structure
```
ffmpeg-server-tools/
├── server.js              # Main server file
├── package.json           # Dependencies and scripts
├── public/                # Web interface files
│   ├── index.html         # Main HTML file
│   ├── styles.css         # Styles
│   └── app.js            # Frontend JavaScript
├── uploads/              # Uploaded files (auto-created)
├── outputs/              # Processed files (auto-created)
├── temp/                 # Temporary files (auto-created)
└── README.md            # This file
```

## WebSocket Connection

The server provides real-time progress updates via WebSocket on port 8080:

```javascript
const ws = new WebSocket('ws://localhost:8080');

ws.onopen = () => {
  // Subscribe to job updates
  ws.send(JSON.stringify({
    type: 'subscribe',
    jobId: 'your-job-id'
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'progress') {
    console.log(`Job ${data.jobId}: ${data.progress}%`);
  }
};
```

## Security Features

- **Rate Limiting**: 100 requests per 15 minutes per IP
- **File Type Validation**: Only allows media files
- **File Size Limits**: Configurable maximum file size
- **Security Headers**: Helmet.js for security headers
- **CORS**: Cross-origin resource sharing enabled

## Error Handling

The API returns appropriate HTTP status codes and error messages:
- `400` - Bad Request (missing parameters, invalid file type)
- `404` - Not Found (file not found)
- `500` - Internal Server Error (processing errors)

## Development

### Running Tests
```bash
npm test
```

### Development Mode
```bash
npm run dev
```

This starts the server with nodemon for automatic restarts on file changes.

## Troubleshooting

### Common Issues

1. **FFmpeg not found**
   - Ensure FFmpeg is installed and available in PATH
   - Test with `ffmpeg -version`

2. **File upload fails**
   - Check file size limits
   - Verify file format is supported

3. **WebSocket connection fails**
   - Ensure port 8080 is available
   - Check firewall settings

4. **Processing jobs fail**
   - Check server logs for detailed error messages
   - Verify input file integrity

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review server logs
3. Open an issue on the project repository
