import 'dotenv/config';
import { DBInterface } from './index';

const dbArgs = process.env.NODE_ENV === 'development' ? 
    { dbUrl: process.env.DATABASE_URL } : 
    { dbUrl: process.env.DATABASE_URL, dbOptions: { ssl: { rejectUnauthorized: false } } };

const db = new DBInterface(dbArgs);

await db.resetDatabase();
await db.seedDatabase();