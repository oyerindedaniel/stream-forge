# StreamForge - Production-Ready Video Platform

## ✅ Core Laws Compliance

### 1. **Never upload large files in one request**
- ✅ Files >100MB use multipart upload (10MB chunks)
- ✅ Client splits files before sending
- ✅ Each chunk uploaded independently with retry logic

### 2. **Never force users to restart uploads**
- ✅ Resumable uploads with session tracking
- ✅ Progress saved to localStorage
- ✅ Pause/Resume functionality
- ✅ Chunk-level tracking (resume from last uploaded chunk)

### 3. **Never stream from your backend**
- ✅ Direct S3 presigned URLs for upload
- ✅ CDN delivery for playback (configurable)
- ✅ Backend only handles metadata and orchestration

### 4. **Never block users during processing**
- ✅ BullMQ for async background processing
- ✅ Real-time status polling from client
- ✅ Users can navigate away during processing

### 5. **Never build infra you can rent cheaper**
- ✅ S3-compatible storage (AWS S3, Cloudflare R2, MinIO)
- ✅ BullMQ + Redis for job queuing
- ✅ Single FFmpeg worker (scales later)

---

## 🏗️ Architecture

```
┌─────────────┐
│   Client    │ ──┐
│  (Upload)   │   │ Direct upload via presigned URLs
└─────────────┘   │ (NEVER through backend)
                  ↓
            ┌──────────┐
            │    S3    │
            │ Storage  │
            └──────────┘
                  │
                  │ S3 Event / Webhook
                  ↓
┌─────────────────────────────────────┐
│         Backend (Fastify)           │
│  - Generates presigned URLs         │
│  - Manages metadata in Postgres     │
│  - Queues processing jobs           │
└─────────────────────────────────────┘
                  │
                  │ Adds job
                  ↓
            ┌──────────┐
            │  Redis   │
            │+ BullMQ  │
            └──────────┘
                  │
                  │ Picks job
                  ↓
       ┌──────────────────┐
       │  Worker Process  │
       │  - Downloads S3  │
       │  - FFmpeg trans  │
       │  - Uploads back  │
       └──────────────────┘
```

---

## 📦 File Upload Flow

### Client Side (components/Uploader.tsx)
1. **Select file** → Check size
2. **If <100MB**: Single presigned URL upload
3. **If >100MB**: Multipart with 10MB chunks
   - Each chunk uploaded independently
   - Progress tracked per chunk
   - Failed chunks retry 3x with exponential backoff
4. **Session persistence**:
   - Saves to localStorage
   - Resume from last uploaded chunk
   - Survives page refresh

### Server Side (server/src/modules/upload/routes.ts)
1. **POST /api/v1/uploads**
   - Creates video record (status: `pending_upload`)
   - Generates presigned URLs or multipart session
   - Returns URLs to client
   - **NEVER receives file data**

2. **POST /api/v1/uploads/:id/complete**
   - Updates status to `processing`
   - Queues BullMQ job
   - Returns immediately

3. **GET /api/v1/uploads/:id/status**
   - Returns current upload/processing status

---

## 🎬 Video Processing Flow

### Worker (server/src/workers/index.ts)
1. **Download from S3** (streaming, not in memory)
2. **Probe metadata** (FFprobe)
3. **Transcode**:
   - 720p (for demo, add 360p/1080p as needed)
   - DASH/fMP4 segmentation (4s segments)
   - H.264 + AAC codec
4. **Generate thumbnails** (every 4s)
5. **Create manifest.json**
6. **Upload to S3**:
   - init.mp4
   - seg_XXX.m4s files
   - thumb_XXX.jpg files
   - manifest.json
7. **Update database** (status: `ready`)

### Retry Logic (server/src/lib/queue.ts)
- 3 automatic retries
- Exponential backoff (5s, 10s, 20s)
- Failed jobs kept for 7 days
- Completed jobs kept for 24h

---

## 🗄️ Database Schema

### `videos` table
```typescript
{
  id: string (PK)
  title: string
  status: 'pending_upload' | 'processing' | 'ready' | 'failed'
  sourceUrl: string (s3://...)
  manifestUrl: string
  duration: number
  width: number
  height: number
  uploadSessionId: string
  uploadedParts: number[] // For resumable uploads
  processingAttempts: number
  lastError: string
  createdAt: timestamp
  updatedAt: timestamp
}
```

### `upload_sessions` table
- Tracks multipart upload sessions
- Stores completed part ETags
- 1-hour expiration
- Used for resume functionality

---

## 🎥 Video Playback (MSE)

### Client (app/lib/mse-controller.ts)
1. **Fetch manifest.json**
2. **Initialize MediaSource**
3. **Load init.mp4**
4. **Stream segments**:
   - Preloads 3 segments ahead
   - Buffer management (removes old data)
   - Seek support
5. **Custom controls**:
   - Play/pause, volume, fullscreen
   - Thumbnail preview on hover
   - Progress bar with buffered ranges

---

## 💾 Storage Configuration

### S3-Compatible Options
```env
# AWS S3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
S3_BUCKET=streamforge-uploads

# Cloudflare R2
S3_ENDPOINT=https://xxx.r2.cloudflarestorage.com
AWS_REGION=auto

# Local MinIO (dev)
S3_ENDPOINT=http://localhost:9000
AWS_ACCESS_KEY_ID=minio
AWS_SECRET_ACCESS_KEY=miniopassword
```

### CDN Integration
```env
CDN_URL=https://cdn.example.com
```
When set, manifest URLs will reference CDN, not S3 directly.

---

## 🚀 Production Deployment

### Requirements
1. **Postgres** (for metadata)
2. **Redis** (for BullMQ)
3. **S3-compatible storage**
4. **FFmpeg** installed on worker

### Environment Variables
```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/streamforge

# Redis
REDIS_URL=redis://host:6379

# Storage
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
S3_BUCKET=streamforge-uploads
S3_ENDPOINT=  # Optional

# CDN (optional)
CDN_URL=https://cdn.example.com

# Server
PORT=3001
NODE_ENV=production
```

### Run Services
```bash
# Backend API
cd server
pnpm build
pnpm start

# Worker (separate process/container)
cd server
pnpm start:worker

# Frontend
cd ..
pnpm build
pnpm start
```

### Docker Compose (Development)
```bash
docker-compose up -d  # Starts Postgres + Redis
```

---

## 🔒 Security Best Practices

1. **Presigned URLs expire** (1 hour)
2. **CORS configured** (restrict in production)
3. **File size limits** (client-side validation)
4. **S3 bucket policies** (prevent public write)
5. **Database connection pooling**
6. **Redis password protection**

---

## 📊 Monitoring & Observability

### Logs
- Worker events logged to console
- Job failures tracked in database
- Redis connection status
- S3 operation errors

### Metrics to Track
- Upload success rate
- Processing time per video
- Queue depth
- Worker utilization
- S3 bandwidth

---

## 🎯 Scaling Strategy

### Phase 1 (Current): Single Worker
- Handles ~10-20 concurrent videos
- Cost: $20-50/month

### Phase 2: Multiple Workers
- Add more worker containers
- BullMQ automatically distributes jobs
- Cost: Scales linearly

### Phase 3: Geographic Distribution
- Multi-region S3 buckets
- Regional workers
- CDN for global delivery

---

## 💰 Cost Optimization

### Current Setup (per 1000 videos)
- **Storage (S3)**: ~$0.50 (50GB @ $0.01/GB)
- **Bandwidth**: Covered by CDN
- **Compute**: ~$10 (worker time)
- **Database**: ~$5 (Postgres)
- **Total**: ~$15-20 per 1000 videos

### Tips
1. Use Cloudflare R2 (no egress fees)
2. Delete source files after processing
3. Generate only 360p + 720p initially
4. Use CDN free tier (Cloudflare/Bunny)

---

## 🐛 Troubleshooting

### Upload Fails
1. Check S3 credentials
2. Verify CORS settings on S3
3. Check presigned URL expiration
4. Review browser console for errors

### Processing Stuck
1. Check worker logs (`pnpm dev:worker`)
2. Verify FFmpeg installed
3. Check Redis connection
4. Review BullMQ dashboard

### Playback Issues
1. Verify manifest.json is valid
2. Check segment files exist in S3
3. Review browser console for MSE errors
4. Test codec support in browser

---

## 📚 References

- [BullMQ Documentation](https://docs.bullmq.io)
- [Drizzle ORM](https://orm.drizzle.team)
- [AWS S3 Presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [FFmpeg DASH](https://ffmpeg.org/ffmpeg-formats.html#dash-2)
- [Media Source Extensions](https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API)
