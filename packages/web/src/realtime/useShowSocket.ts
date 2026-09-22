import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import {
  SeatStatus,
  SocketEvents,
  type SeatMapDTO,
  type SeatUpdatePayload,
} from '@ticket/shared';
import { SOCKET_URL } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

/** Apply a seat-status change to a cached seat map, recomputing availability. */
function patchSeatMap(map: SeatMapDTO, seatIds: string[], status: SeatStatus): SeatMapDTO {
  const ids = new Set(seatIds);
  const seats = map.seats.map((seat) => {
    if (!ids.has(seat.id)) return seat;
    // A booked/released/offered seat is no longer "held by me".
    const heldByMe = status === SeatStatus.HELD ? seat.heldByMe : false;
    return { ...seat, status, heldByMe };
  });

  const categories = map.categories.map((cat) => {
    const available = seats.filter(
      (s) => s.categoryId === cat.id && s.status === SeatStatus.AVAILABLE,
    ).length;
    return { ...cat, available };
  });
  const soldOutCategoryIds = categories.filter((c) => c.available === 0).map((c) => c.id);

  return { ...map, seats, categories, soldOutCategoryIds };
}

/**
 * Subscribe to live seat updates for a show and patch the seat-map query cache.
 * The seat grid re-renders automatically as the cache changes.
 */
export function useShowSocket(showId: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!showId) return;

    const socket: Socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });

    // (Re)join the room and resync on every connection. After a reconnect we
    // may have missed seat events, so we refetch the authoritative seat map
    // rather than trusting our now-stale cache.
    const onConnect = () => {
      socket.emit(SocketEvents.JOIN_SHOW, showId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.seatMap(showId) });
    };
    socket.on('connect', onConnect);

    const applyStatus = (status: SeatStatus) => (payload: SeatUpdatePayload) => {
      if (payload.showId !== showId) return;
      queryClient.setQueryData<SeatMapDTO>(queryKeys.seatMap(showId), (prev) =>
        prev ? patchSeatMap(prev, payload.seatIds, status) : prev,
      );
    };

    socket.on(SocketEvents.SEAT_HELD, applyStatus(SeatStatus.HELD));
    socket.on(SocketEvents.SEAT_OFFERED, applyStatus(SeatStatus.HELD));
    socket.on(SocketEvents.SEAT_BOOKED, applyStatus(SeatStatus.BOOKED));
    socket.on(SocketEvents.SEAT_RELEASED, applyStatus(SeatStatus.AVAILABLE));

    return () => {
      socket.emit(SocketEvents.LEAVE_SHOW, showId);
      socket.off('connect', onConnect);
      socket.disconnect();
    };
  }, [showId, queryClient]);
}
