import { Server, Socket } from "socket.io";
import { handleSocketEvents } from "./roomHandler";

export const registerSocketHandlers = (io: Server) => {
    io.on("connection", (socket: Socket) => {
        // 룸 및 WebRTC 핸들러 연결
        handleSocketEvents(io, socket);
    });
};