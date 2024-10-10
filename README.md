# Brainteaser of the Day bot

This is a Discord bot which posts the Brainteaser of the Day to subscribed channels. Users can submit new brainteasers by sending a DM to the bot, and participants are awarded points for actions in the main channel such as submitting solutions and pointing out mistakes in posted solutions.

## Simple usage

In a channel, use `/subscribe` to subscribe to the Brainteaser of the Day. The bot will then post a brainteaser in that channel every day. The brainteasers are drawn from a database of brainteasers that is initially empty, but you can add brainteasers to the database by sending a DM to the bot. If there is no brainteaser in the database, the bot will just post an error message.

_Note: Populating the database with good brainteasers takes time, but this setup ensures that the brainteasers are of good quality and around the level of difficulty that you are looking for._

There are some additional commands, such as `/leaderboard`, which shows the current leaderboard of users and their points.

## Setup

This is not a public bot, so you need to run your own instance of the bot. To set it up, you need the following:

- A [Discord](https://discord.com/) account.
- An [OpenAI](https://openai.com/) account and API key.
- A machine with [Node.js](https://nodejs.org/en) to run the main process (e. g. your local machine or a cloud server).
- A PostgreSQL database (can be on the same machine as the bot or on a remote server).

Personally, I use [Heroku](https://www.heroku.com/) to host the bot and database. The file `Procfile` in the root directory is my Heroku configuration.

To set up the bot, follow these steps:

1. Set up your OpenAI account and PostgreSQL database.
2. Set up a new Discord application and bot. Give the bot the username "Brian T. Serbot" and enable Message Content Intent under Priviliged Gateway Intents.
3. Clone this repository and setup the `.env` file in the root directory with the following variables:
   - `OPENAI_API_KEY`: Your OpenAI API key.
   - `DATABASE_URL`: The URL of your PostgreSQL database.
   - `DISCORD_APP_ID`: The ID of your Discord application, which can be found in the developer portal.
   - `DISCORD_TOKEN`: The token of your Discord bot, which can also be found in the developer portal.
   - `DISCORD_PUBLIC_KEY`: The public key of your Discord application, which can also be found in the developer portal.
4. Run `npm install` and `npm run reset-db` in the root directory to install the dependencies and set up the initial tables in the database.
5. Run `npm run start` in the root directory to start the bot.
