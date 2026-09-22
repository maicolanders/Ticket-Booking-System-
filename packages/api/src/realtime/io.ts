import { Server } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { SocketEvents, showRoom, type SeatStatus } from '@ticket/shared';
import { corsOrigins } from '../config/env';
import { logger } from '../lib/logger';

let io: Server | null = null;

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: corsOrigins, methods: ['GET', 'POST'] },
  });

  io.on('connection', (socket) => {
    socket.on(SocketEvents.JOIN_SHOW, (showId: unknown) => {
      if (typeof showId === 'string') socket.join(showRoom(showId));
    });
    socket.on(SocketEvents.LEAVE_SHOW, (showId: unknown) => {
      if (typeof showId === 'string') socket.leave(showRoom(showId));
    });
  });

  logger.info('Socket.io initialized');
  return io;
}

/** Broadcast a seat status change to everyone viewing a show's seat map. */
export function emitSeatUpdate(
  event: string,
  showId: string,
  seatIds: string[],
  status: SeatStatus,
): void {
  if (!io || seatIds.length === 0) return;
  io.to(showRoom(showId)).emit(event, { showId, seatIds, status });
}
