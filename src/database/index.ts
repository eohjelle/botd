import postgres from 'postgres';
import type { Brainteaser, BrainteaserOfTheDay, Solution } from '../types';
import { formatDate } from '../utils';

export class DBInterface {
    private sql: postgres.Sql;

    constructor({ dbUrl, dbOptions }: { dbUrl: string, dbOptions?: postgres.Options<any> }) {
        this.sql = postgres(dbUrl, dbOptions);
    }

    /** Warning: This will delete all data. */
    public async resetDatabase() {
        console.log('Resetting database...');
        try {
            await this.sql`
                DO $$ DECLARE
                    r RECORD;
                BEGIN
                    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema()) LOOP
                        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
                    END LOOP;
                END $$;
            `;
            console.log('All tables dropped successfully');
        } catch (error) {
            console.error('Error dropping tables:', error);
        }
    }

    /** Seed the database using the seed.sql file. */
    public async seedDatabase() {
        console.log('Seeding database...');
        try {
            // Read and execute the seed.sql file
            const fs = await import('fs/promises');
            const seedSQL = await fs.readFile(new URL('./seed/seed.sql', import.meta.url), 'utf-8');
            await this.sql.unsafe(seedSQL);

            // Insert the creator of the bot
            await this.sql`INSERT INTO users (user_id, name) VALUES (${process.env.DISCORD_APP_ID}, 'Brian T. Serbot') ON CONFLICT (user_id) DO NOTHING`;

            // Populate the brainteasers table with some initial brainteasers
            const initialBrainteasers = JSON.parse(await fs.readFile(new URL('./seed/initial_brainteasers.json', import.meta.url), 'utf-8'));
            for (const brainteaser of initialBrainteasers) {
                await this.sql`
                    INSERT INTO brainteasers (title, question, category, submitted_by)
                    VALUES (${brainteaser.title}, ${brainteaser.question}, ${brainteaser.category}, ${process.env.DISCORD_APP_ID})
                    ON CONFLICT DO NOTHING
                `;
            }
            console.log(`Inserted ${initialBrainteasers.length} initial brainteasers`);
            console.log('Database seeded successfully');
        } catch (error) {
            console.error('Error seeding database:', error);
        }
    }

    public async createUser({ user_id, user_name }: { user_id: string, user_name: string }): Promise<void> {
        try {
            await this.sql`INSERT INTO users (user_id, name) VALUES (${user_id}, ${user_name}) ON CONFLICT (user_id) DO NOTHING`;
        } catch (error) {
            throw new Error(`Could not create user ${user_id}. ${error}`);
        }
    }

    /** Upload a brainteaser to the database and return the assigned ID of the brainteaser. */
    public async insertBrainteaser({ title, question, user_id, category }: { title: string, question: string, user_id: string, category?: string }): Promise<number> {
        try {
            return await this.sql`
                INSERT INTO brainteasers (title, question, submitted_by, category)
                VALUES (${title}, ${question}, ${user_id}, ${category ?? null})
                RETURNING id
                `.then(data => data[0].id);
        } catch (error) {
            throw new Error(`Could not insert brainteaser titled "${title}". This typically happens when a brainteaser with the same title already exists, because you are attempting to submit the same brainteaser multiple times. If you think this is a coincidence, try submitting the brainteaser again with a different title. ${error}`);
        }
    }

    /** Insert a solution to a brainteaser and return the assigned ID of the solution. */
    public async insertSolution({ brainteaser_id, solution, submitted_by: user_id }: { brainteaser_id: number, solution: string, submitted_by: string }): Promise<number> {
        try {
            const [ returnedSolution ] = await this.sql`INSERT INTO solutions (brainteaser_id, solution, submitted_by)
                VALUES (${brainteaser_id}, ${solution}, ${user_id})
                RETURNING id`;
            return returnedSolution.id;
        } catch (error) {
            throw new Error(`Could not insert solution to Brainteaser with ID=${brainteaser_id}. ${error}`);
        }
    }

    public async updateSolution({ solution_id, solution }: { solution_id: number, solution: string }): Promise<string> {
        try {
            await this.sql`UPDATE solutions SET solution = ${solution} WHERE id = ${solution_id}`;
            return `Successfully updated solution ${solution_id}!`;
        } catch (error) {
            throw new Error(`Could not update solution ${solution_id}. ${error}`);
        }
    }

    public async lookupSolutions({ brainteaser_id, limit }: { brainteaser_id: number, limit?: number }): Promise<Solution[]> {
        try {
            const solutions = await this.sql`SELECT * FROM solutions WHERE brainteaser_id = ${brainteaser_id} LIMIT ${limit ?? 10}`;
            return solutions.map(solution => ({ id: solution.id, brainteaser_id: solution.brainteaser_id, solution: solution.solution, submitted_by: solution.submitted_by }));
        } catch (error) {
            throw new Error(`Could not look up solutions to Brainteaser with ID=${brainteaser_id}. ${error}`);
        }
    }

    public async lookupSolutionsToBrainteaserOfTheDay({ botd_id }: { botd_id: number }): Promise<Solution[]> {
        try {
            const [ brainteaser ] = await this.sql`SELECT * FROM brainteasers WHERE used_for_botd = ${botd_id}`;
            return await this.lookupSolutions({ brainteaser_id: brainteaser.id });
        } catch (error) {
            throw new Error(`Could not look up solutions to Brainteaser of the Day #${botd_id}. ${error}`);
        }
    }

    public async lookupSolutionsToCurrentBrainteaserOfTheDay(): Promise<Solution[]> {
        try {
            const [ botd ] = await this.sql`SELECT brainteaser_id FROM botd ORDER BY id DESC LIMIT 1`;
            if (!(botd === undefined)) {
                const solutions = await this.lookupSolutions({ brainteaser_id: botd.brainteaser_id });
                return solutions;
            } else {
                throw new Error('No Brainteaser of the Day has been set yet.');
            }
        } catch (error) {
            throw new Error(`Could not look up solutions to the current Brainteaser of the Day. ${error}`);
        }
    }

    public async insertSolutionToBotd({ botd_id, solution, submitted_by_user_id: user_id, submitted_by_user_name: user_name }: { botd_id: number, solution: string, submitted_by_user_id: string, submitted_by_user_name: string }): Promise<number> {
        await this.createUser({ user_id, user_name });
        try {
            const [ brainteaser ] = await this.sql`SELECT id FROM brainteasers WHERE used_for_botd = ${botd_id}`;
            return await this.insertSolution({ brainteaser_id: brainteaser.id, solution, submitted_by: user_id });
        } catch (error) {
            throw new Error(`Could not insert solution to Brainteaser of the Day #${botd_id}. This typically happens when botd_id is an invalid ID for a Brainteaser of the Day. Please check if your are using the correct ID. You can find the ID=X of the current Brainteaser of the Day by looking for the latest message that starts with "Brainteaser of the Day #X".`);
        }
    }

    public async getBrainteaserOfTheDayById(botd_id: number): Promise<BrainteaserOfTheDay> {
        try {
            const [ botd ] = await this.sql`SELECT * FROM botd_brainteasers WHERE id = ${botd_id}`;
            if (botd === undefined) {
                throw new Error(`Brainteaser of the Day #${botd_id} not found.`);
            }
            return botd as BrainteaserOfTheDay;
        } catch (error) {
            throw new Error(`Could not get Brainteaser of the Day #${botd_id}. ${error}`);
        }
    }

    public async getBrainteaserOfTheDayByDate(date: Date): Promise<BrainteaserOfTheDay> {
        try {
            const [ botd ] = await this.sql`SELECT * FROM botd_brainteasers WHERE date_of = ${formatDate(date)}`;
            return botd as BrainteaserOfTheDay;
        } catch (error) {
            throw new Error(`Could not get Brainteaser of the Day for date ${formatDate(date)}. ${error}`);
        }
    }

    public async getCurrentBrainteaserOfTheDay(): Promise<BrainteaserOfTheDay> {
        try {
            const [ botd ] = await this.sql`SELECT * FROM botd_brainteasers ORDER BY id DESC LIMIT 1`;
            if (botd === undefined) {
                throw new Error('No Brainteaser of the Day has been set yet.');
            } else {
                return botd as BrainteaserOfTheDay;
            }
        } catch (error) {
            throw new Error(`Could not get current Brainteaser of the Day. ${error}`);
        }
    }

    public async selectNextBrainteaserOfTheDay(): Promise<BrainteaserOfTheDay> {
        try {
            const [ brainteaser ] = await this.sql`SELECT * FROM brainteasers WHERE used_for_botd IS NULL ORDER BY RANDOM() LIMIT 1`;
            if (brainteaser === undefined) {
                throw new Error('No eligible brainteasers for Brainteaser of the Day found. All brainteasers in the database have already been used for Brainteaser of the Day.')
            }
            const [ botd ] = await this.sql`INSERT INTO botd (brainteaser_id) VALUES (${brainteaser.id}) RETURNING id, date_of`;
            await this.sql`UPDATE brainteasers SET used_for_botd = ${botd.id} WHERE id = ${brainteaser.id}`;
            const [ user ] = await this.sql`SELECT name FROM users WHERE user_id = ${brainteaser.submitted_by}`;
            return {
                id: botd.id,
                date_of: botd.date_of,
                title: brainteaser.title,
                question: brainteaser.question,
                submitted_by: user.name,
                category: brainteaser.category
            }
        } catch (error) {
            console.error('Error selecting next Brainteaser of the Day: ', error);
            throw error;
        }
    }
    public async incrementPoints({ user_id, user_name, channel_id, points }: { user_id: string, user_name: string, channel_id: string, points: number }): Promise<string> {
        await this.createUser({ user_id, user_name });
        await this.sql`INSERT INTO users_channels (user_id, channel_id) VALUES (${user_id}, ${channel_id}) ON CONFLICT (user_id, channel_id) DO NOTHING`;
        const [ user ] = await this.sql`UPDATE users_channels SET points = points + ${points} WHERE user_id = ${user_id} AND channel_id = ${channel_id} RETURNING points`;
        return `Successfully incremented points for user ${user_id} by ${points}. New point total: ${user.points}`;
    }

    public async getLeaderboard({ channel_id }: { channel_id: string }): Promise<string> {
        const leaderboard = await this.sql`SELECT * FROM leaderboard WHERE channel_id = ${channel_id} ORDER BY points DESC LIMIT 10`;
        return '**Leaderboard**\n' + leaderboard.map(user => `${user.name}: ${user.points}`).join('\n');
    }

    public async createChannel({ channel_id }: { channel_id: string }): Promise<void> {
        await this.sql`INSERT INTO channels (channel_id) VALUES (${channel_id}) ON CONFLICT (channel_id) DO NOTHING`;
    }

    public async upsertChannel({ channel_id, subscribed }: { channel_id: string, subscribed?: boolean }): Promise<void> {
        try {
            await this.sql`
                INSERT INTO channels (channel_id, subscribed)
                VALUES (${channel_id}, ${subscribed ?? true})
                ON CONFLICT (channel_id) DO UPDATE SET subscribed = ${subscribed ?? true}
            `;
        } catch (error) {
            console.error('Error upserting channel:', error);
            throw error;
        }
    }

    public async getChannelIds(): Promise<string[]> {
        return await this.sql`SELECT channel_id FROM channels`.then(data => data.map(row => row.channel_id));
    }

    public async getSubscribedChannelIds(): Promise<string[]> {
        return await this.sql`SELECT channel_id FROM channels WHERE subscribed = TRUE`.then(data => data.map(row => row.channel_id));
    }

    public async getBrainteasersLeft(): Promise<string> {
        const [result] = await this.sql<[{ count: number }]>`
            SELECT COUNT(*)
            FROM brainteasers 
            WHERE used_for_botd IS NULL
        `;
        return `Brainteasers left: ${result.count}`;
    }
}
