import 'dotenv/config';
import { checkStorageIntegrity } from './models/storage-integrity.js';
import mongoose from 'mongoose';
try {
  const result = await checkStorageIntegrity();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
} catch (error) {
  console.error('Storage audit failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
