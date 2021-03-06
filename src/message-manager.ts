import { HaredoMessage } from './haredo-message';
import { TypedEventEmitter, typedEventToPromise } from './events';
import { EventEmitter } from 'events';
import { promiseMap } from './utils';

export enum MessageManagerEvents {
    MESSAGE_MANAGER_DRAINED = 'drained'
}

interface Events {
    [MessageManagerEvents.MESSAGE_MANAGER_DRAINED]: void;
}

export class MessageManager<T = unknown> {
    private messages: HaredoMessage<T>[] = [];
    public readonly emitter = new EventEmitter() as TypedEventEmitter<Events>
    get length() {
        return this.messages.length;
    }
    isDrained() {
        return this.length === 0;
    }
    add(message: HaredoMessage<T>) {
        this.messages = this.messages.concat(message);
        message.emitter.once('handled', () => {
            this.remove(message);
        });
    }
    remove(message: HaredoMessage) {
        this.messages = this.messages.filter(x => x !== message);
    }
    async drain() {
        if (this.messages.length === 0) {
            return;
        }
        await promiseMap(this.messages, message => typedEventToPromise(message.emitter, 'handled'));
    }
    channelBorked() {
        this.messages.forEach(message => {
            message.channelBorked = true;
        });
    }
}