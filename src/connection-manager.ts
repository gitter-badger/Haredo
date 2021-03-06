import { Options, Connection, connect, Channel, ConfirmChannel } from 'amqplib';
import { makeDebug } from './logger';
import { Queue } from './queue';
import { Exchange } from './exchange';
import { ConsumerManager } from './consumer-manager';
import { delay } from './utils';
import { HaredoError } from './errors';

const log = makeDebug('connectionmanager:');

export class ConnectionManager {
    closing = false;
    closed = false;
    private closePromise: Promise<void>;
    connection: Connection;
    connectionPromise: Promise<Connection>;
    connectionOpts: string | Options.Connect;
    consumerManager = new ConsumerManager();
    socketOpts: any;
    private publishChannel: Channel;
    private publishConfirmChannel: ConfirmChannel;
    constructor(opts: string | Options.Connect = 'amqp://localhost:5672', socketOpts: any = {}) {
        this.connectionOpts = opts;
        this.socketOpts = socketOpts;
    }

    async getConnection() {
        if (this.connectionPromise) {
            return this.connectionPromise;
        }
        if (this.closing) {
            throw new HaredoError('Haredo is closing, no new connections will be opened');
        }
        this.connectionPromise = this.loopGetConnection();
        return this.connectionPromise;
    }

    private async loopGetConnection () {
        while (true) {
            try {
                const connection = await Promise.resolve(connect(this.connectionOpts, this.socketOpts));
                connection.on('error', (err) => {
                    log('connection error', err);
                });
                connection.on('close', () => {
                    this.connectionPromise = undefined;
                    this.connection = undefined;
                    if (!this.closing) {
                        this.getConnection();
                    }
                });
                this.connection = connection;
                return connection;
            } catch (e) {
                log('failed to connect', e);
                await delay(1000);
            }
        }
    }

    async getChannel() {
        const connection = await this.getConnection();
        log('creating channel');
        const channel = await connection.createChannel();
        // Without this channel errors will crash the application
        channel.on('error', () => { });
        return channel;
    }

    async getConfirmChannel() {
        const connection = await this.getConnection();
        log('creating confirm channel');
        const channel = await connection.createConfirmChannel();
        channel.on('error', () => { });
        return channel;
    }

    async getChannelForPublishing() {
        if (this.publishChannel) {
            return this.publishChannel;
        }
        this.publishChannel = await this.getChannel();
        this.publishChannel.on('close', () => {
            this.publishChannel = undefined;
        });
        return this.publishChannel;
    }

    async getConfirmChannelForPublishing() {
        if (this.publishConfirmChannel) {
            return this.publishConfirmChannel;
        }
        this.publishConfirmChannel = await this.getConfirmChannel();
        this.publishConfirmChannel.on('close', () => {
            this.publishConfirmChannel = undefined;
        });
        return this.publishConfirmChannel;
    }

    async assertQueue(queue: Queue) {
        const channel = await this.getChannel();
        const reply = await channel.assertQueue(queue.name, queue.opts);
        queue.name = reply.queue;
        await channel.close();
        return reply;
    }

    async assertExchange(exchange: Exchange) {
        const channel = await this.getChannel();
        const reply = await channel.assertExchange(exchange.name, exchange.type, exchange.opts);
        await channel.close();
        return reply;
    }

    async bindQueue(exchange: Exchange, queue: Queue, pattern: string, args?: any) {
        const channel = await this.getChannel();
        await Promise.all([
            this.assertQueue(queue),
            this.assertExchange(exchange)
        ]);
        const reply = await channel.bindQueue(queue.name, exchange.name, pattern, args);
        await channel.close();
        return reply;
    }

    async close() {
        this.closePromise = this.closePromise || this.internalClose();
        return this.closePromise;
    }

    private async internalClose() {
        log('closing');
        await this.consumerManager.close();
        this.closing = true;
        if (this.connection) {
            await this.connection.close();
        }
        this.closed = true;
    }
}