// server.ts
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { initWorker } from "./src/mediasoup/manager";
import { registerSocketHandlers } from "./src/socket";


const app = express();
const PORT = process.env.PORT || 4000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
// 미들웨어 설정
app.use(cors({ origin: CLIENT_URL }));
app.use(express.json({ limit: '10mb' }));



const server = http.createServer(app);

// 소켓 서버 설정
const io = new Server(server, {
    cors: {
        origin: CLIENT_URL,
        methods: ["GET", "POST"],
    },
});

// 소켓 이벤트 핸들러 등록
registerSocketHandlers(io);

// Mediasoup 워커 실행 및 서버 가동
server.listen(PORT, async () => {
    await initWorker();
    console.log(`[Server] http://localhost:${PORT} 에서 실행 중`);
    console.log(`[Mediasoup] 워커 초기화 완료`);
});