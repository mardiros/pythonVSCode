"use strict";

import * as net from "net";
import { EventEmitter } from "events";
import { SocketStream } from "./SocketStream";
import { SocketServer } from './socketServer';

export abstract class SocketCallbackHandler extends EventEmitter {
    private _stream: SocketStream = null;
    private commandHandlers: Map<string, Function>;
    private handeshakeDone: boolean;

    constructor(socketServer: SocketServer) {
        super();
        this.commandHandlers = new Map<string, Function>();
        socketServer.on('data', this.onData.bind(this));
    }

    private onData(socketClient: net.Socket, data: Buffer) {
        this.HandleIncomingData(data, socketClient);
    }

    protected get stream(): SocketStream {
        return this._stream;
    }

    protected SendRawCommand(commandId: Buffer) {
        this.stream.Write(commandId);
    }

    protected registerCommandHandler(commandId: string, handler: Function) {
        this.commandHandlers.set(commandId, handler);
    }

    protected abstract handleHandshake(): boolean;

    private HandleIncomingData(buffer: Buffer, socket: net.Socket): boolean {
        if (this._stream === null) {
            this._stream = new SocketStream(socket, buffer);
        }
        else {
            this._stream.Append(buffer);
        }

        if (!this.handeshakeDone && !this.handleHandshake()) {
            return;
        }

        this.handeshakeDone = true;

        this.HandleIncomingDataFromStream();
        return true;
    }

    public HandleIncomingDataFromStream() {
        if (this.stream.Length === 0) {
            return;
        }
        this.stream.BeginTransaction();

        let cmd = this.stream.ReadAsciiString(4);
        if (this.stream.HasInsufficientDataForReading) {
            this.stream.RollBackTransaction();
            return;
        }

        if (this.commandHandlers.has(cmd)) {
            const handler = this.commandHandlers.get(cmd);
            handler();
        }
        else {
            this.emit("error", `Unhandled command '${cmd}'`);
        }

        if (this.stream.HasInsufficientDataForReading) {
            // Most possibly due to insufficient data
            this.stream.RollBackTransaction();
            return;
        }

        this.stream.EndTransaction();
        if (this.stream.Length > 0) {
            this.HandleIncomingDataFromStream();
        }
    }
}
