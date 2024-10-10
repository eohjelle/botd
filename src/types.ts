import type { Snowflake, Message, User } from "discord.js";

export type Brainteaser = {
    id: number;
    title: string;
    question: string;
    category?: string;
    used_for_botd?: number;
}

export type BrainteaserOfTheDay = {
    id: number,
    date_of: string,
    title: string,
    question: string,
    submitted_by: string,
    category: string
}

export type Solution = {
    id: number;
    brainteaser_id: number;
    solution: string;
    submitted_by: string;
}

export enum Emoji {
    THUMBS_UP = '👍',
    THUMBS_DOWN = '👎',
    LAUGH = '😂',
    SAD = '😢',
    ANGRY = '😠',
    HEART = '❤️',
    FIRE = '🔥',
}

export type MessageResponse = { action: 'do_nothing', content: null } | { action: 'react', content: Emoji } | { action: 'reply', content: string };

export type MockMessage = {
    channelId: Snowflake;
    channelName: string;
    fromMe: boolean;
    content: string;
    author: {
        id: Snowflake;
        name: string;
    };
};