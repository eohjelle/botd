import { OpenAI } from "openai";
import { Thread } from "openai/resources/beta/threads/threads";
import type { Brainteaser, MessageResponse, MockMessage } from "./types";
import { MessageCreateParams } from "openai/resources/beta/threads/messages";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { AssistantCreateParams, AssistantTool } from "openai/resources/beta/assistants";

type QueuedOperation = () => Promise<unknown>;

/** This is a wrapper for the OpenAI client, containing some useful methods for the bot. */
export class LLM {
    private client: OpenAI;
    private operationQueue: Record<string, QueuedOperation[]> = {};
    private processingPromise: Record<string, Promise<void> | null> = {};

    constructor(client: OpenAI) {
        this.client = client;
    }
    
    private async processQueue(threadId: string) {
        if (this.processingPromise[threadId]) {
            // If the queue is already being processed, wait for it to finish
            await this.processingPromise[threadId];
            return;
        }

        // Create a new promise for this processing run
        this.processingPromise[threadId] = (async () => {
            while (this.operationQueue[threadId].length > 0) {
                const operation = this.operationQueue[threadId].shift();
                if (operation) {
                    try {
                        await operation();
                    } catch (error) {
                        console.error("Error processing queued operation:", error);
                    }
                }
            }
        })();

        // Wait for all operations to complete
        await this.processingPromise[threadId];

        // Clear the processing promise
        this.processingPromise[threadId] = null;
    }

    private enqueueOperation<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (!this.operationQueue[threadId]) {
                this.operationQueue[threadId] = [];
            }
            this.operationQueue[threadId].push(async () => {
                try {
                    const result = await operation();
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });
            this.processQueue(threadId);
        });
    }

    /** Creates a new thread and returns the thread ID. */
    public async createThread(): Promise<string> {
        return (await this.client.beta.threads.create()).id;
    }

    public async addMessage(threadId: string, message: MessageCreateParams): Promise<void> {
        return this.enqueueOperation(threadId, async () => {
            await this.client.beta.threads.messages.create(threadId, message);
        });
    }

    /** Creates an assistant and returns the assistant ID. */
    public async createAssistant(params: AssistantCreateParams): Promise<string> {
        return (await this.client.beta.assistants.create(params)).id;
    }

    /**
     * Runs an assistant on a thread, with the given tools. Make sure that all the assistant's tools are included in the tools parameter.
     */
    public async runAssistant(threadId: string, assistantId: string, tools: Record<string, (args: any) => Promise<string>>) {
        return this.enqueueOperation(threadId, async () => {
            // console.log(`Running assistant ${assistantId} on thread ${threadId}`);
            // const messages = await this.client.beta.threads.messages.list(threadId);
            // console.log(`Thread ${threadId} has ${messages.data.length} messages:`, messages.data.map(m => m.content[0]));
            let run = await this.client.beta.threads.runs.create(
                threadId,
                { 
                    assistant_id: assistantId,
                    truncation_strategy: {
                        type: 'last_messages',
                        last_messages: 50
                    }
                }
            );
            while (true) {
                run = await this.client.beta.threads.runs.retrieve(threadId, run.id);
                if (run.status === 'requires_action') {
                    if (run.required_action.type === 'submit_tool_outputs') {
                        try {
                            // console.log('Submitting tool outputs: ', run.required_action.submit_tool_outputs.tool_calls);
                            run = await this.client.beta.threads.runs.submitToolOutputs(
                                threadId,
                                run.id,
                                {
                                    tool_outputs: await Promise.all(run.required_action.submit_tool_outputs.tool_calls.map(async tool_call => {
                                        try {
                                            console.log(`Assistant ${assistantId} is calling tool ${tool_call.function.name} with arguments: ${tool_call.function.arguments}`);
                                            const output = await tools[tool_call.function.name]!(JSON.parse(tool_call.function.arguments));
                                            return {
                                                tool_call_id: tool_call.id,
                                                output: output
                                            }
                                        } catch (error) {
                                            console.error(`Error occured while performing call to tool ${tool_call.function.name}`, error);
                                            return {
                                                tool_call_id: tool_call.id,
                                                output: `Error occured while performing call to tool ${tool_call.function.name}: ${error}`
                                            }
                                        }
                                    }))
                                }
                            );
                        } catch (error) {
                            console.error(`Error occured while submitting tool outputs for run ${run.id} with assistant ${assistantId}:`, error);
                        }
                    }
                } else if (run.status === 'completed') {
                    const message = await this.client.beta.threads.messages.list(threadId).then(messages => messages.data[0]);
                    if (message.content[0].type === 'text') {
                        return message.content[0].text.value;
                    } else {
                        throw new Error(`Unknown message type: ${message.content[0].type}`);
                    }
                } else if (run.status === 'failed') {
                    throw new Error(`Run failed with code ${run.last_error?.code}: ${run.last_error?.message}`);
                } else if (run.status === 'queued' || run.status === 'in_progress') {
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second and poll again
                } else if (run.status === 'incomplete') {
                    throw new Error('Run is incomplete: ' + JSON.stringify(run.incomplete_details));
                } else {
                    throw new Error(`Unknown run status: ${run.status}`);
                }
            }
        });
    }

    public async checkSolution({ question, solution }: { question: string, solution: string }): Promise<string> {
        throw new Error('Disabled until better models are available.');
        // const response = await this.client.chat.completions.create({
        //     model: 'gpt-4o', // TODO: use o1-mini
        //     messages: [
        //         {
        //             role: 'system',
        //             content: 'You are a helpful assistant that checks if a proposed solution to a brainteaser is correct. You will be given a brainteaser question and a proposed solution, and you will need to determine if the solution is correct.'
        //         },
        //         {
        //             role: 'user',
        //             content: JSON.stringify({
        //                 question: question,
        //                 solution: solution
        //             })
        //         }
        //     ],
        //     response_format: zodResponseFormat(z.object({
        //         reason_if_incorrect: z.string().optional(),
        //         is_correct: z.boolean()
        //     }), 'solution_is_correct')
        // });
        // return response.choices[0].message.content;
    }

    public async generateSolution({ question }: { question: string }): Promise<string> {
        throw new Error('Disabled until better models are available.');
    //     const response = await this.client.chat.completions.create({
    //         model: 'gpt-4o', // TODO: use o1-mini
    //         messages: [
    //             {
    //                 role: 'system',
    //                 content: "You are a helpful assistant that generates a solution to a brainteaser. You will be given a brainteaser question, and you will attempt to generate a solution to the brainteaser. If you cannot generate a solution, leave the solution field undefined. The field 'generated_correct_solution' should be set to true if you generated a solution that is correct, and false otherwise."
    //             },
    //             {
    //                 role: 'user',
    //                 content: JSON.stringify({
    //                     question: question
    //                 })
    //             }
    //         ],
    //         response_format: zodResponseFormat(z.object({
    //             solution: z.string().optional(),
    //             generated_correct_solution: z.boolean()
    //         }), 'solution')
    //     });
    //     return response.choices[0].message.content;
    }
}