import 'dotenv/config';
import { resolve } from 'node:path';
import { openDatabase, seedDatabase } from './database.js';
const path=process.env.DB_PATH??resolve('data/doma.sqlite');
const db=openDatabase(path);
try {seedDatabase(db,process.env.NODE_ENV==='production');console.log(`Database initialized: ${path}`);} finally {db.close();}
