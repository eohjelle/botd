import { Bot } from './bot';
import { REST, Routes, Client, Message, Channel, ChannelType } from 'discord.js';
import schedule from 'node-schedule';
import { DBInterface } from './database';

// TODO: Find proper type somewhere
interface InteractionCommand {
  name: string,
  description: string,
  options?: {
    type: number,
    name: string,
    description: string,
    required: boolean,
    choices?: {
      name: string,
      value: string,
    }[],
    min_value: number,
    max_value: number,
  }[],
  type: number,
  integration_types?: number[],
  contexts?: number[],
  default_member_permissions?: string,
}

export class DiscordInterface {
  private bot: Bot;
  private db: DBInterface;
  private rest: REST;
  private client: Client;
  private commands: InteractionCommand[];
  private subscriberChannels: string[] = []; // Channel IDs
  private activeDMChannels: string[] = []; // User IDs

  constructor({ rest, client, bot, db }: { rest: REST, client: Client, bot: Bot, db: DBInterface }) {
      this.bot = bot;
      this.db = db;
      this.rest = rest;
      this.client = client;

      this.commands = [
        {
          name: 'test',
          description: 'Basic command',
          type: 1,
        },
        {
          name: 'subscribe',
          description: 'Subscribe to Brainteaser of the Day in the current channel.',
          type: 1,
          contexts: [0]
        },
        {
          name: 'unsubscribe',
          description: 'Unsubscribe from Brainteaser of the Day in the current channel.',
          type: 1,
          contexts: [0]
        },
        {
          name: 'get_current_botd',
          description: 'Get the current Brainteaser of the Day.',
          type: 1
        },
        {
          name: 'select_next_botd',
          description: 'Select the next Brainteaser of the Day.',
          type: 1,
          default_member_permissions: '8'
        },
        {
          name: 'motivate',
          description: 'Motivate the current channel.',
          type: 1,
          contexts: [0],
          default_member_permissions: '8'
        },
        {
          name: 'leaderboard',
          description: 'Get the leaderboard of the current channel.',
          type: 1,
          contexts: [0]
        },
        {
          name: 'brainteasers_left',
          description: 'Get the number of brainteasers left that have not been used for Brainteaser of the Day.',
          type: 1
        }
      ];

      this.client.on('ready', async () => {
        console.log(`Logged in as ${this.client.user.tag}!`);

        await this.intializeSubscribers();

        schedule.scheduleJob('0 0 12 * * *', () => {
          this.broadcastBrainteaserOfTheDay();
        });

        schedule.scheduleJob('0 45 11 * * *', () => {
          this.broadcastMotivation();
        });
      });
  
      this.client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
  
        const { commandName, channelId } = interaction;
  
        if (commandName === 'test') {
          await interaction.reply({
            content: 'Pong!',
            ephemeral: true
          });
        }

        if (commandName === 'subscribe') {
          await interaction.deferReply({ ephemeral: false });
          try {
            await this.db.upsertChannel({ channel_id: channelId });
            this.subscriberChannels.push(channelId);
            await interaction.editReply({
              content: 'You have subscribed to Brainteaser of the Day in this channel!'
            });
          } catch (error) {
            await interaction.editReply({
              content: `Error subscribing to Brainteaser of the Day: ${error}`
            });
          }
        }

        if (commandName === 'unsubscribe') {
          await interaction.deferReply({ ephemeral: false });
          try {
            await this.db.upsertChannel({ channel_id: channelId, subscribed: false });
            this.subscriberChannels = this.subscriberChannels.filter(id => id !== channelId);
            await interaction.editReply({
              content: 'You have unsubscribed from Brainteaser of the Day in this channel!'
            });
          } catch (error) {
            await interaction.editReply({
              content: `Error unsubscribing from Brainteaser of the Day: ${error}`
            });
          }
        }

        if (commandName === 'get_current_botd') {
          await interaction.deferReply({ ephemeral: true });

          let botd: string;
          try {
            botd = await this.bot.getCurrentBrainteaserOfTheDay();
          } catch (error) {
            botd = `Error getting current brainteaser of the day: ${error}`;
          }

          await interaction.editReply({
            content: botd
          });
        }

        if (commandName === 'select_next_botd') {
          await interaction.deferReply({
            ephemeral: true
          });
          try {
            await this.broadcastBrainteaserOfTheDay();
            await interaction.editReply({
              content: 'Selected next Brainteaser of the Day!'
            });
          } catch (error) {
            await interaction.editReply({
              content: `Error selecting next brainteaser of the day: ${error}`
            });
          }
        }

        if (commandName === 'motivate') {
          await interaction.deferReply({
            ephemeral: true
          });
          try {
            if (!this.subscriberChannels.includes(channelId)) {
              throw new Error('Can not survey a channel which is not subscribed to Brainteaser of the Day.');
            }
            const motivate = await this.bot.response(channelId, 'motivator');
            const channel = await this.client.channels.fetch(channelId);
            if (channel.isSendable() && motivate.action !== 'do_nothing') {
              channel.send(motivate.content);
            }
            await interaction.editReply({
              content: 'Motivation sent!'
            });
          } catch (error) {
            await interaction.editReply({
              content: `Error sending motivation: ${error}`
            });
          }
        }

        if (commandName === 'get_leaderboard') {
          await interaction.deferReply({ ephemeral: true });
          try {
            if (!this.subscriberChannels.includes(channelId)) {
              throw new Error('Can not get leaderboard of a channel which is not subscribed to Brainteaser of the Day.');
            }
            const leaderboard = await this.db.getLeaderboard({ channel_id: channelId });
            await interaction.editReply({
              content: leaderboard
            });
          } catch (error) {
            await interaction.editReply({
              content: `Error getting leaderboard: ${error}`
            });
          }
        }

        if (commandName === 'brainteasers_left') {
          await interaction.deferReply({ ephemeral: true });
          try {
            const brainteasersLeft = await this.db.getBrainteasersLeft();
            await interaction.editReply({
              content: brainteasersLeft
            });
          } catch (error) {
            await interaction.editReply({
              content: `Error getting brainteasers left: ${error}`
            });
          }
        }

        console.log(`Interaction: ${interaction.user.displayName} (${interaction.user.id}) used command ${commandName}!`);
      });

      this.client.on('messageCreate', async message => {
        if (message.channel.type === ChannelType.DM || this.subscriberChannels.includes(message.channelId)) {
          console.log(`\n${message.author.displayName} > ${message.content}\n`);
          await this.bot.addMessage(message.channelId, {
            channelId: message.channelId,
            channelName: 'name' in message.channel ? message.channel.name : message.channel.recipient.displayName,
            fromMe: this.fromMe(message),
            content: message.content,
            author: {
              id: message.author.id,
              name: message.author.displayName
            }
          });
          if (!this.fromMe(message)) {
            if (message.channel.type === ChannelType.DM) {
              await this.activateDMChannel(message.channelId);
              message.channel.sendTyping();
              await this.bot.response(message.channelId, 'DM_assistant').then(response => {
                if (response.action === 'reply') {
                  message.reply(response.content);
                } else if (response.action === 'react') {
                  message.react(response.content);
                }
              });
            } else if (this.subscriberChannels.includes(message.channelId)) {
              await this.bot.response(message.channelId, 'moderator').then(response => {
                if (response.action === 'reply') {
                  message.reply(response.content);
                } else if (response.action === 'react') {
                  message.react(response.content);
                }
              });
            }
          }
        }
      });
  }

  public login(token: string) {
    this.client.login(token);
  }

  public async refreshCommands(appId: string) {
    try {
      console.log('Refreshing application commands...');
      await this.rest.put(
        Routes.applicationCommands(appId),
        { body: this.commands }
      );
      console.log('Application commands refreshed successfully.');
    } catch (err) {
      console.error('Error refreshing application commands:', err);
    }
  }

  private fromMe(message: Message) {
    return message.author.id === this.client.user.id;
  }

  private async broadcastBrainteaserOfTheDay() {
    // await Promise.all(this.subscribers.map(channelId => {
    //   this.client.channels.fetch(channelId).then(channel => {
    //     if (channel.isSendable()) {
    //       channel.send('Testing...');
    //     }
    //   });
    // }));
    let botd: string;
    try {
      botd = await this.bot.selectNextBrainteaserOfTheDay();
    } catch (error) {
      botd = `Error selecting next brainteaser of the day: ${error}`;
    }
    await Promise.all(this.subscriberChannels.map(channelId => {
      this.client.channels.fetch(channelId).then(channel => {
        if (channel.isSendable()) {
          channel.send(botd);
        }
      });
    }));
  }

  private async broadcastMotivation() {
    console.log('Broadcasting motivation...');
    await Promise.all(this.subscriberChannels.map(channelId => {
      this.client.channels.fetch(channelId).then(channel => {
        if (channel.isSendable()) {
          this.bot.response(channelId, 'motivator').then(response => {
            if (response.action === 'reply') {
              channel.send(response.content);
            } else if (response.action === 'react') {
              channel.send(response.content);
            }
          });
        }
      });
    }));
  }

  private async getLastMessages(channelId: string, limit: number = 30): Promise<Message[]> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        const messages = await channel.messages.fetch({ limit });
        return Array.from(messages.values());
      } else {
        throw new Error(`Channel ${channelId} is not a text-based channel`);
      }
    } catch (error) {
      console.error(`Error fetching messages for channel ${channelId}:`, error);
      return [];
    }
  }

  private async addMessageToBotThread(channelId: string, message: Message) {
    await this.bot.addMessage(message.channelId, {
      channelId: message.channelId,
      channelName: 'name' in message.channel ? message.channel.name : message.channel.recipient.displayName,
      fromMe: this.fromMe(message),
      content: message.content,
      author: {
        id: message.author.id,
        name: message.author.displayName
      }
    });
  }

  private async intializeSubscribers() {
    this.subscriberChannels = await this.db.getSubscribedChannelIds();
    await Promise.all(this.subscriberChannels.map(async channelId => {
      const messages = await this.getLastMessages(channelId);
      for (const message of messages.reverse()) {
        await this.addMessageToBotThread(channelId, message);
      }
    }));
  }

  private async activateDMChannel(channelId: string) {
    if (this.activeDMChannels.includes(channelId)) {
      return;
    } else {
      try {
        const messages = await this.getLastMessages(channelId);
        for (const message of messages.reverse()) {
          await this.addMessageToBotThread(channelId, message);
        }
        this.activeDMChannels.push(channelId);
      } catch (error) {
        console.error(`Error activating DM channel ${channelId}:`, error);
      }
    }
  }
}