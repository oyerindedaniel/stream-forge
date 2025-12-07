import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
    CreateMultipartUploadCommand,
    AbortMultipartUploadCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';

const s3 = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'minio',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'miniopassword',
    },
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: !!process.env.S3_ENDPOINT,
});

const BUCKET_NAME = process.env.S3_BUCKET || 'stream-forge-uploads';
const CDN_URL = process.env.CDN_URL;

export const storage = {
    s3Client: s3,
    bucketName: BUCKET_NAME,
    bucketIsConfigured: !!process.env.AWS_ACCESS_KEY_ID,

    async getUploadUrl(key: string, contentType: string, expiresIn = 3600) {
        const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
            ContentType: contentType,
        });
        return getSignedUrl(s3, command, { expiresIn });
    },

    async getDownloadUrl(key: string, expiresIn = 3600) {
        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        });
        return getSignedUrl(s3, command, { expiresIn });
    },

    getPublicUrl(key: string) {
        if (CDN_URL) {
            return `${CDN_URL}/${key}`;
        }
        if (process.env.S3_ENDPOINT) {
            return `${process.env.S3_ENDPOINT}/${BUCKET_NAME}/${key}`;
        }
        return `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`;
    },

    async fileExists(key: string): Promise<boolean> {
        try {
            await s3.send(new HeadObjectCommand({
                Bucket: BUCKET_NAME,
                Key: key,
            }));
            return true;
        } catch {
            return false;
        }
    },

    async deleteFile(key: string) {
        await s3.send(new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        }));
    },

    async uploadStream(key: string, stream: Readable, contentType: string) {
        const upload = new Upload({
            client: s3,
            params: {
                Bucket: BUCKET_NAME,
                Key: key,
                Body: stream,
                ContentType: contentType,
            },
            queueSize: 4,
            partSize: 50 * 1024 * 1024,
            leavePartsOnError: false,
        });

        upload.on('httpUploadProgress', (progress) => {
            console.log(`Upload progress for ${key}:`, progress);
        });

        await upload.done();
    },

    async uploadBuffer(key: string, buffer: Buffer, contentType: string) {
        await s3.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
            Body: buffer,
            ContentType: contentType,
        }));
    },

    async createMultipartUpload(key: string, contentType: string) {
        const command = new CreateMultipartUploadCommand({
            Bucket: BUCKET_NAME,
            Key: key,
            ContentType: contentType,
        });
        return s3.send(command);
    },

    async abortMultipartUpload(key: string, uploadId: string) {
        await s3.send(new AbortMultipartUploadCommand({
            Bucket: BUCKET_NAME,
            Key: key,
            UploadId: uploadId,
        }));
    },
};

export type StorageService = typeof storage;
