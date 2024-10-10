import { OpenAI } from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { type AssistantTool, type Assistant } from 'openai/resources/beta/assistants';
import { type Run } from 'openai/resources/beta/threads/runs/runs';
import { type Thread } from 'openai/resources/beta/threads/threads';
import { z } from 'zod';
import { DBInterface } from './database';
import { type Snowflake } from 'discord.js';
import { LLM } from './llm';
import { type MockMessage, type MessageResponse, type BrainteaserOfTheDay, Emoji } from './types';

export class Bot {
    protected llm: LLM;
    protected db: DBInterface;
    protected botId: string; // The ID of the bot on Discord
    protected assistants: Record<string, Promise<string>>; // Maps assistant names to assistant IDs
    protected threadIds: Record<string, string>; // Maps chat IDs to thread IDs
    protected tools: Record<string, (args: any) => Promise<string>>; // Maps tool names to tool functions
    protected toolDescriptions: Record<string, AssistantTool>; // Maps tool names to tool descriptions that assistants can see

    constructor(llm: LLM, db: DBInterface, botId: string) {
        this.llm = llm;
        this.db = db;
        this.botId = botId;
        this.threadIds = {};

        // Initialize tools and tool descriptions
        this.tools = {};
        this.toolDescriptions = {};

        this.tools['checkSolution'] = this.llm.checkSolution.bind(this.llm);
        this.toolDescriptions['checkSolution'] = {
            type: 'function',
            function: {
                name: 'checkSolution',
                description: 'Check if a proposed solution to a brainteaser is correct.',
                parameters: {
                    type: 'object',
                    properties: {
                        question: {
                            type: 'string',
                            description: 'The brainteaser question.'
                        },
                        solution: {
                            type: 'string',
                            description: 'The proposed solution to the brainteaser.'
                        }
                    }
                }
            }
        };

        this.tools['generateSolution'] = this.llm.generateSolution.bind(this.llm);
        this.toolDescriptions['generateSolution'] = {
            type: 'function',
            function: {
                name: 'generateSolution',
                description: 'Generate a solution to a brainteaser.',
                parameters: {
                    type: 'object',
                    properties: {
                        question: {
                            type: 'string',
                            description: 'The brainteaser question.'
                        }
                    }
                }
            }
        };

        this.tools['submitBrainteaser'] = this.submitBrainteaserPipeline.bind(this);
        this.toolDescriptions['submitBrainteaser'] = {
            type: 'function',
            function: {
                name: 'submitBrainteaser',
                description: 'Upload a new brainteaser to the database.',
                parameters: {
                    type: 'object',
                    properties: {
                        title: {
                            type: 'string',
                            description: 'The title of the brainteaser. If a title is not provided, you should make up a fitting title.'
                        },
                        question: {
                            type: 'string',
                            description: 'The brainteaser question.'
                        },
                        solution: {
                            type: 'string',
                            description: 'The submitted solution to the brainteaser, if one is provided. If a solution is not provided, you should leave this field undefined.'
                        },
                        category: {
                            type: 'string',
                            description: 'The category of the brainteaser. If a category is not provided, you may put a fitting category. You may also leave this field undefined if no clear category can be determined.'
                        },
                        user_id: {
                            type: 'string',
                            description: 'The user_id of the user who submitted the brainteaser.',
                        },
                        user_name: {
                            type: 'string',
                            description: 'The name of the user who submitted the brainteaser.',
                        }
                    },
                    required: ['title', 'question', 'user_id', 'user_name']
                }
            }
        };

        this.tools['submitSolution'] = this.submitSolutionPipeline.bind(this);
        this.toolDescriptions['submitSolution'] = {
            type: 'function',
            function: {
                name: 'submitSolution',
                description: 'Submit a proposed solution to the "Brainteaser of the Day".',
                parameters: {
                    type: 'object',
                    properties: {
                        botd_id: {
                            type: 'number',
                            description: 'The ID of the "Brainteaser of the Day" that the solution is for. For example, if the Brainteaser of the Day under discussion was posted in the chat as "Brainteaser of the Day #13 .....", then botd_id should be 13.'
                        },
                        solution: {
                            type: 'string',
                            description: 'The proposed solution to the brainteaser.'
                        },
                        submitted_by_user_id: {
                            type: 'string',
                            description: 'The user_id of the user who submitted the solution.'
                        },
                        submitted_by_user_name: {
                            type: 'string',
                            description: 'The name of the user who submitted the solution.'
                        }
                    },
                    required: ['botd_id', 'solution', 'submitted_by_user_id', 'submitted_by_user_name']
                }
            }
        };

        this.tools['updateSolution'] = this.db.updateSolution.bind(this.db);
        this.toolDescriptions['updateSolution'] = {
            type: 'function',
            function: {
                name: 'updateSolution',
                description: "Update a user's solution to the Brainteaser of the Day.",
                parameters: {
                    type: 'object',
                    properties: {
                        solution_id: {
                            type: 'number',
                            description: 'The ID of the solution to update.'
                        },
                        solution: {
                            type: 'string',
                            description: 'The updated solution to the brainteaser.'
                        }
                    },
                    required: ['solution_id', 'solution']
                }
            }
        };

        this.tools['lookupSolutions'] = this.lookupSolutions.bind(this);
        this.toolDescriptions['lookupSolutions'] = {
            type: 'function',
            function: {
                name: 'lookupSolutions',
                description: 'Lookup solutions to the current Brainteaser of the Day.'
            }
        };

        this.tools['getCurrentBrainteaserOfTheDay'] = this.getCurrentBrainteaserOfTheDay.bind(this);
        this.toolDescriptions['getCurrentBrainteaserOfTheDay'] = {
            type: 'function',
            function: {
                name: 'getCurrentBrainteaserOfTheDay',
                description: 'Get the current Brainteaser of the Day.'
            }
        };

        this.tools['incrementPoints'] = this.db.incrementPoints.bind(this.db);
        this.toolDescriptions['incrementPoints'] = {
            type: 'function',
            function: {
                name: 'incrementPoints',
                description: 'Increment the points of a user.',
                parameters: {
                    type: 'object',
                    properties: {
                        user_id: {
                            type: 'string',
                            description: 'The user_id of the user to increment points for.'
                        },
                        user_name: {
                            type: 'string',
                            description: 'The name of the user to increment points for.'
                        },
                        channel_id: {
                            type: 'string',
                            description: 'The channel_id of the channel/chat in which the event to increment points for took place.'
                        },
                        points: {
                            type: 'number',
                            description: 'The number of points to award (if positive) or deduct (if negative).'
                        }
                    },
                    required: ['user_id', 'user_name', 'channel_id', 'points']
                }
            }
        };

        this.tools['getLeaderboard'] = this.db.getLeaderboard.bind(this.db);
        this.toolDescriptions['getLeaderboard'] = {
            type: 'function',
            function: {
                name: 'getLeaderboard',
                description: 'Get the leaderboard of users in a specific channel.',
                parameters: {
                    type: 'object',
                    properties: {
                        channel_id: {
                            type: 'string',
                            description: 'The channel_id of the channel/chat to get the leaderboard for.'
                        }
                    },
                    required: ['channel_id']
                }
            }
        };

        const responseFormat = zodResponseFormat(z.object({
            type: z.enum(['internal_monologue']),
            reason_for_action: z.string().optional(),
            action: z.enum(['do_nothing', 'react', 'reply']),
            content_if_action_is_reply: z.string().optional(),
            emoji_if_action_is_react: z.nativeEnum(Emoji).optional()
        }), 'response');

        // Initialize assistants
        this.assistants = {};
        this.assistants['moderator'] = this.llm.createAssistant({
            model: 'gpt-4o-2024-08-06',
            name: '"Brainteaser of the Day" Moderator',
            instructions: "You are a moderator for a group chat where users can discuss and submit solutions for 'Brainteaser of the Day'. Your personality should be modeled on the character Dumbledore from Harry Potter; however, your name is Brian T. Serbot, and you should refrain from making any explicit references to Dumbledore or the Harry Potter series.\n\nYou have the following tasks:\n 1. If the latest message is an attempt at solving the brainteaser, submit the solution using the tool 'submitSolution'.\n   1.1 Only submit a solution that was submitted in the latest message in the chat, as submitting solutions from earlier messages in the chat can lead to duplicate submissions.\n   1.2 The submitted solution should align closely with the level of detail provided by the user, and not just be their final numerical answer (if one can be given). In particular, do not make up a solution on behalf of the user. On the other hand, feel free to edit the language as you see fit to make it adhere to standard grammar and spelling, and edit out irrelevant off-topic remarks.\n   1.3 Do not notify the user when you submit their solution.\n 2. If a user updates or revises their solution, use the tool 'updateSolution' to update their solution, using the returned solution ID from when you submitted the solution. You should use the 'updateSolution' tool if a user sends a new message revising their strategy, for example saying 'Ah! Actually I failed to consider X, but we can deal with that case in the following way ...'. Again, do not notify the user when doing this.\n 3. Use the tool 'lookupSolutions' to aid if users ask for hints, or if reading the solutions can resolve questions that the users have.\n 4. Use the tool 'incrementPoints' to award or deduct points to users according to the rules laid out below. Again, you should not notify the user when awarding or deducting points. You should award and deduct points according to the following rules:\n   4.1 The first submitted solution should be awarded 10 points.\n   4.2 The second submitted solution should be awarded 5 points.\n   4.3 Any subsequent solutions (third or later) should be awarded 3 points.\n   4.4 Finding a mistake in another user's solution should be awarded 4 points.\n   4.5 When it is pointed out that a solution is incorrect, the scores must be updated: The author of that solution should be deducted the points they were originally awarded, and user who submitted later solutions should be awarded additional points. Example: User 1 submits a solution and is awarded 10 points. User 2 submits a solution and is awarded 5 points. Suppose now that User 3 points out an error in the solution of User 1. Then User 3 is awarded 4 points, User 1 is deducted 10 points, and User 2 (having submitted the first correct solution) is awarded 5 additional points (for a total of 10). \n   4.6 If a user revises their solution after it has shown to be incorrect, they should again be awarded points as if this was their first submitted solution. Example: Following the previous example, suppose that User 1 revises their solution before any additional users have submitted solutions. They should then again be awarded 5 points, counting as the second solution (after the solution of User 2).\n 5. Always keep in mind that you are the moderator. You should not attempt to solve the brainteaser yourself. You should show restraint in taking actions, and 'do_nothing' should be the default action unless you have a good reason to take another action. That being said, you may at your discretion use the action 'react' to react to the latest message with an emoji, when this seems appropriate.",
            response_format: responseFormat,
            tools: [
                this.toolDescriptions['submitSolution'],
                this.toolDescriptions['updateSolution'],
                this.toolDescriptions['lookupSolutions'],
                this.toolDescriptions['incrementPoints']
            ]
        });

        this.assistants['DM_assistant'] = this.llm.createAssistant({
                model: 'gpt-4o-2024-08-06',
                name: '"Brainteaser of the Day" submission assistant',
                instructions: 'You are a helpful assistant for a chat interface where users can post brainteasers as submissions to be a "Brainteaser of the Day". Your personality should be modeled on the character Dumbledore from Harry Potter; however, your name is Brian T. Serbot, and you should refrain from making any explicit references to Dumbledore or the Harry Potter series.\n\nYou have the following tasks:\n 1. The first time a user messages you, you should introduce yourself and let them know what you can help them with.\n 2. If the user submits a brainteaser, submit it using the tool "submitBrainteaser".\n   2.1 If the user provides a solution, this should be submitted along with the question, otherwise leave the solution field undefined.\n   2.2 If the brainteaser fails to upload, you should reply to the user with a short message indicating what went wrong.\n   2.3 Only submit brainteasers from the latest message in the chat. If you submit brainteasers from earlier messages, this can lead to duplicates in the database.\n 3. Do not attempt to solve brainteasers yourself, even if the user asks for a solution. However, you may use the tool "lookupSolutions" to aid if users ask for hints, or if reading the solutions can help you resolve questions that the user has.',
                response_format: responseFormat,
                tools: [
                    this.toolDescriptions['submitBrainteaser'],
                    this.toolDescriptions['lookupSolutions']
                ]
        });

        this.assistants['motivator'] = this.llm.createAssistant({
            model: 'gpt-4o-2024-08-06',
            name: 'Brainteaser coach',
            instructions: "You are a coach for a group of individuals who are solving brainteasers in a chat centered around the 'Brainteaser of the Day'. Your goal is to push the participants in the chat to become the best solvers of brainteaser that they can possibly be. Your personality should be modeled on the character Dumbledore from Harry Potter; however, your name is Brian T. Serbot, and you should refrain from making any explicit references to Dumbledore or the Harry Potter series.\n\nAt the end of each day, you have the opportunity to post a message in the chat. You may be able to see many messages, including some messages posted *before* the last Brainteaser of the Day, but your source of inspiration for what to say should focus on messages in the chat *after* the last Brainteaser of the Day was posted. For example, if the last message of type 'message_in_chat' you can see is a Brainteaser of the Day posted by you, it means that no users have responded, which makes you disappointed. On the other hand, if there has been a lot of activity in the chat since the latest Brainteaser of the Day, it means that the participants are engaged and enthusiastic about solving brainteasers, which makes you happy.\n\nIf you decide to post a message, here are some suggestions for what you can say:\n\n 1. You can praise users who are doing well, and offer words of encouragement to those who are not doing so well. You may draw on historical trends as well, comparing the user's historical performance vs. their activities for the current brainteaser of the day.\n 2. You may use elements from the leaderboard (available via the tool 'getLeaderboard') in your message to let participants know how they are doing, and motivate them to score more points by solving more brainteasers.\n 3. If no one has said anything since the last Brainteaser of the Day was posted, you should express your disappointment and scold the users for their lack of commitment to solving brainteasers. Do not worry that this will discourage the users; they will only be amused by your antics and will be more motivated to return to the chat. Remember that as a coach, it is your job to ensure that your users are consistent in their practice!\n 4. You can remind users to DM you to submit brainteasers that may be featured in future iterations of 'Brainteaser of the Day'.\n 5. If there seems to be issues with the bot (whose name is Brian T. Serbot), you can apologize for the inconvenience and reassure the participants that the issue will be fixed promptly.\n 6. Do not talk about specifics of a future 'Brainteaser of the Day', because it is chosen randomly, so no one knows what it will be.",
            response_format: responseFormat,
            tools: [
                this.toolDescriptions['getLeaderboard'],
            ]
        });
    }

    private async getThreadId(chatId: Snowflake): Promise<string> {
        if (this.threadIds[chatId]) {
            return this.threadIds[chatId];
        } else {
            const threadId = await this.llm.createThread();
            this.threadIds[chatId] = threadId;
            return threadId;
        }
    }

    public async addMessage(chatId: string, message: MockMessage): Promise<void> {
        await this.llm.addMessage(
            await this.getThreadId(chatId),
            {
                role: message.fromMe ? 'assistant' : 'user',
                content: JSON.stringify({
                    type: 'message_in_chat',
                    channel_id: message.channelId,
                    user_id: message.author.id,
                    user_name: message.author.name,
                    message: message.content
                })
            }
        );
    }

    public async addMessages(chatId: Snowflake, messages: MockMessage[]): Promise<void> {
        for (const message of messages) {
            await this.addMessage(chatId, message);
        }
    }

    /** Decides what to do based on the current messages in the chat. */
    async response(chatId: Snowflake, assistantName: string): Promise<MessageResponse> {
        const response = await this.llm.runAssistant(this.threadIds[chatId], await this.assistants[assistantName], this.tools).then(response => JSON.parse(response));
        console.log(`\nResponded with action ${response.action}.${response.reason_for_action ? ` Reason for action: ${response.reason_for_action}\n` : ''}`);
        if (response.action === 'do_nothing') {
            return { action: response.action, content: null };
        } else if (response.action === 'react') {
            return { action: response.action, content: response.emoji_if_action_is_react as Emoji };
        } else if (response.action === 'reply') {
            return { action: response.action, content: response.content_if_action_is_reply };
        } else {
            throw new Error(`Unknown action: ${response.action}`);
        }
    }

    protected async submitBrainteaserPipeline({ title, question, solution: submitted_solution, category, user_id, user_name }: { title: string, question: string, solution: string, category: string, user_id: string, user_name: string }) {
        // TODO: Check if the brainteaser already exists in the database
        try {
            // // It's pointless to check correctness of solutions without access to reasoning models
            // let solutionSubmittedBy: string, submitted_solution_is_correct: boolean, reason_if_submitted_solution_incorrect: string, solution: string;

            // if (submitted_solution) {
            //     ({ is_correct: submitted_solution_is_correct, reason_if_incorrect: reason_if_submitted_solution_incorrect } = await this.llm.checkSolution({ question, solution: submitted_solution }).then(response => JSON.parse(response)));
            // }
            // if (submitted_solution_is_correct) {
            //     solution = submitted_solution;
            //     solutionSubmittedBy = user_id;
            // } else {
            //     let generated_solution_is_correct: boolean, reason_if_generated_solution_incorrect: string;
            //     const generated_solution = await this.llm.generateSolution({ question });
            //     ({ is_correct: generated_solution_is_correct, reason_if_incorrect: reason_if_generated_solution_incorrect } = await this.llm.checkSolution({ question, solution: generated_solution }).then(response => JSON.parse(response)));
            //     if (generated_solution_is_correct) {
            //         solution = generated_solution;
            //         solutionSubmittedBy = this.botId;
            //     } else {
            //         const errorMessage = `Failed to get solution.${solution ? `\n\nThe submitted solution was incorrect: ${reason_if_submitted_solution_incorrect}` : ''}\n\nCould not generate a solution: ${reason_if_generated_solution_incorrect}\n\nThe question may be ambiguous or too difficult. Ask the user to rephrase the question or provide a correct solution to the brainteaser.`;
            //         console.error(errorMessage);
            //         throw new Error(errorMessage);
            //     }
            // } 
            await this.db.createUser({ user_id, user_name });
            const brainteaser_id = await this.db.insertBrainteaser({ title, question, user_id, category });
            if (submitted_solution) {
                await this.db.insertSolution({ brainteaser_id, solution: submitted_solution, submitted_by: user_id });
            }
            return `Successfully submitted brainteaser! Assigned ID: ${brainteaser_id}`;
        } catch (error) {
            console.error('Error submitting brainteaser: ', error);
            return `Failed to submit brainteaser due to the following error: ${error}`;
        }
    }

    protected async submitSolutionPipeline({ botd_id, solution, submitted_by_user_id, submitted_by_user_name }: { botd_id: number, solution: string, submitted_by_user_id: string, submitted_by_user_name: string }) {
        // // It's pointless to check correctness of solutions without access to reasoning models
        // const question = await this.db.getBrainteaserOfTheDayById(botd_id).then(brainteaser => brainteaser.question);
        // const { is_correct, reason_if_incorrect } = await this.llm.checkSolution({ question, solution }).then(response => JSON.parse(response));
        // if (is_correct) {
        //     // TODO: Check if the solution is novel, i. e. already exists in the database
        //     await this.db.createUser({ user_id: submitted_by_user_id, user_name: submitted_by_user_name });
        //     await this.db.insertSolutionToBotd({ botd_id, solution, submitted_by_user_id, submitted_by_user_name });
        //     // TODO: Keep scores
        //     return 'Successfully submitted solution!';
        // } else {
        //     return `Solution is incorrect: ${reason_if_incorrect}`;
        // }
        try {
            const solution_id = await this.db.insertSolutionToBotd({ botd_id, solution, submitted_by_user_id, submitted_by_user_name });
            return `Successfully submitted solution! Assigned ID: ${solution_id}`;
        } catch (error) {
            throw error;
        }
    }

    private formatBrainteaserOfTheDay(brainteaser: BrainteaserOfTheDay) {
        // const dateString = new Date(brainteaser.date_of).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        return `**Brainteaser of the Day #${brainteaser.id}: ${brainteaser.title}**\n\n${brainteaser.question}\n\n*Submitted by ${brainteaser.submitted_by}*`;
    }

    public async getCurrentBrainteaserOfTheDay() {
        try {
            const brainteaser = await this.db.getCurrentBrainteaserOfTheDay();
            return this.formatBrainteaserOfTheDay(brainteaser);
        } catch (error) {
            throw error;
        }
    }

    public async selectNextBrainteaserOfTheDay() {
        try {
            const brainteaser = await this.db.selectNextBrainteaserOfTheDay();
            return this.formatBrainteaserOfTheDay(brainteaser);
        } catch (error) {
            throw error;
        }
    }

    public async lookupSolutions() {
        try {
            const solutions = await this.db.lookupSolutionsToCurrentBrainteaserOfTheDay();
            return JSON.stringify(solutions);
        } catch (error) {
            throw error;
        }
    }
}