import 'dotenv/config';

// Set up OpenAI client
console.log('Initializing LLM client...');
import { OpenAI } from 'openai';
import { LLM } from './llm';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});
const llm = new LLM(openai);



// Set up database
console.log('Initializing database...');
import { DBInterface } from './database';

const db = new DBInterface({
    db_url: process.env.DATABASE_URL
});

// Set up bots
console.log('Initializing bots...');
import { Bot } from './bot';
const bot = new Bot(llm, db, process.env.DISCORD_APP_ID);

// Set up Discord REST and WebSocket client
console.log('Initializing Discord REST and WebSocket client...');
import { REST, Client, GatewayIntentBits, Partials } from 'discord.js';
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel] // Required to get messageCreate event to fire for DMs: https://github.com/discordjs/discord.js/issues/7699
});

// Set up Discord interface
console.log('Initializing Discord interface...');
import { DiscordInterface } from './discord_interface';
const discordInterface = new DiscordInterface({ rest, client, bot, db });
await discordInterface.refreshCommands(process.env.DISCORD_APP_ID);

// Log in
console.log('Logging in...');
discordInterface.login(process.env.DISCORD_TOKEN);