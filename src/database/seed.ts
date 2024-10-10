import 'dotenv/config';
import { DBInterface } from './index';

const db = new DBInterface({ db_url: process.env.DATABASE_URL });

await db.seedDatabase();