import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';

@WebSocketGateway({ cors: { origin: '*' } })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  @OnEvent('check.completed')
  handleCheckCompleted(payload: any) {
    this.server.emit('check:result', payload);
  }

  @OnEvent('incident.opened')
  handleIncidentOpened(payload: any) {
    this.server.emit('incident:opened', payload);
  }

  @OnEvent('incident.resolved')
  handleIncidentResolved(payload: any) {
    this.server.emit('incident:resolved', payload);
  }
}
