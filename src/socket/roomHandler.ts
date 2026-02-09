import { Server, Socket } from "socket.io";
import { types as mediasoupTypes } from "mediasoup";
import { createRoomRouter, createWebRtcTransport } from "../mediasoup/manager";

// 타입 정의
interface Room {
    router: mediasoupTypes.Router;
    peers: Map<string, {
        sendTransport?: mediasoupTypes.WebRtcTransport;
        recvTransport?: mediasoupTypes.WebRtcTransport;
        producers: Map<string, mediasoupTypes.Producer>;
        consumers: Map<string, mediasoupTypes.Consumer>;
        socketId: string;
    }>;
}

// 메모리 저장소 (전역 변수)
const rooms = new Map<string, Room>();
const socketToRoom = new Map<string, string>();

export const handleSocketEvents = (io: Server, socket: Socket) => {
    console.log("[Socket] 연결됨:", socket.id);

    // 방 참여 (joinRoom)
    socket.on("joinRoom", async (roomId: string, cb) => {
        if (!rooms.has(roomId)) {
            const roomRouter = await createRoomRouter();
            rooms.set(roomId, {
                router: roomRouter,
                peers: new Map(),
            });
            console.log(`[Room] 방 ${roomId} 생성됨`);
        }

        const currentRoom = rooms.get(roomId)!;
        currentRoom.peers.set(socket.id, {
            producers: new Map(),
            consumers: new Map(),
            socketId: socket.id,
        });

        socket.join(roomId);
        socketToRoom.set(socket.id, roomId);


        cb(currentRoom.router.rtpCapabilities);
        console.log(`[Socket] 소켓 ${socket.id} -> 방 ${roomId} 조인 완료`);
    });

    socket.on("getExistingProducers", (cb) => {
        const roomId = socketToRoom.get(socket.id);
        const currentRoom = rooms.get(roomId || "");
        if (!currentRoom) return cb([]);

        const existingProducers = Array.from(currentRoom.peers.values())
            .flatMap(peer => Array.from(peer.producers.values()))
            // 본인의 프로듀서는 제외하고 필터링
            .filter(producer => producer.appData.socketId !== socket.id)
            .map(producer => ({
                producerId: producer.id,
                kind: producer.kind,
                appData: producer.appData,
                socketId: producer.appData.socketId,
            }));

        cb(existingProducers);
    });

    // RTP Capabilities 요청
    socket.on("getRouterRtpCapabilities", (_, cb) => {
        const roomId = socketToRoom.get(socket.id);
        if (roomId && rooms.has(roomId)) {
            cb(rooms.get(roomId)!.router.rtpCapabilities);
        } else {
            cb(null);
        }
    });

    // 송신 트랜스포트 생성
    socket.on("create-transport", async (_, cb) => {
        const roomId = socketToRoom.get(socket.id);
        const currentRoom = rooms.get(roomId!);
        if (!currentRoom) return cb(null);

        const transport = await createWebRtcTransport(currentRoom.router);
        const peer = currentRoom.peers.get(socket.id);
        if (peer) peer.sendTransport = transport;

        cb({
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
        });
    });

    // 수신 트랜스포트 생성
    socket.on("create-recv-transport", async (_, cb) => {
        const roomId = socketToRoom.get(socket.id);
        const currentRoom = rooms.get(roomId!);
        if (!currentRoom) return cb(null);

        const transport = await createWebRtcTransport(currentRoom.router);
        const peer = currentRoom.peers.get(socket.id);
        if (peer) peer.recvTransport = transport;

        cb({
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
        });
    });

    // 트랜스포트 연결
    socket.on("transport-connect", async ({ dtlsParameters }) => {
        const roomId = socketToRoom.get(socket.id);
        const transport = rooms.get(roomId!)?.peers.get(socket.id)?.sendTransport;
        if (transport) await transport.connect({ dtlsParameters });
    });

    socket.on("recv-transport-connect", async ({ dtlsParameters }, cb) => {
        const roomId = socketToRoom.get(socket.id);
        const transport = rooms.get(roomId!)?.peers.get(socket.id)?.recvTransport;
        if (transport) {
            await transport.connect({ dtlsParameters });
            cb?.();
        }
    });

    // 미디어 전송 시작
    socket.on("transport-produce", async ({ kind, rtpParameters, appData }, cb) => {
        const roomId = socketToRoom.get(socket.id);
        const currentRoom = rooms.get(roomId!)!;
        const peer = currentRoom.peers.get(socket.id);
        const transport = peer?.sendTransport;

        if (!transport) return cb(null);

        const producer = await transport.produce({ kind, rtpParameters, appData });
        peer?.producers.set(producer.id, producer);

        producer.on("transportclose", () => {
            peer?.producers.delete(producer.id);
            socket.to(roomId!).emit("producer-closed", producer.id);
        });

        socket.to(roomId!).emit("new-producer", {
            producerId: producer.id,
            kind: producer.kind,
            appData: producer.appData,
            socketId: socket.id,
        });

        cb({ id: producer.id });
    });

    // 미디어 수신 시작
    socket.on("consume", async ({ producerId, rtpCapabilities }, cb) => {
        const roomId = socketToRoom.get(socket.id);
        const currentRoom = rooms.get(roomId!)!;
        const peer = currentRoom.peers.get(socket.id);
        const transport = peer?.recvTransport;

        let producerToConsume: mediasoupTypes.Producer | undefined;
        for (const p of currentRoom.peers.values()) {
            if (p.producers.has(producerId)) {
                producerToConsume = p.producers.get(producerId);
                break;
            }
        }

        if (!producerToConsume || !transport || !currentRoom.router.canConsume({ producerId, rtpCapabilities })) {
            return cb(null);
        }

        const consumer = await transport.consume({ producerId, rtpCapabilities, paused: false });
        peer?.consumers.set(consumer.id, consumer);

        consumer.on("producerclose", () => {
            consumer.close();
            peer?.consumers.delete(consumer.id);
        });

        cb({
            id: consumer.id,
            producerId: producerToConsume.id,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            appData: producerToConsume.appData,
        });
    });

    // 프로듀서 닫기
    socket.on("close-producer", (producerId: string) => {
        const roomId = socketToRoom.get(socket.id);
        console.log(
            `[Socket] close-producer 요청: socketId=${socket.id}, roomId=${roomId}, producerId=${producerId}`
        );
        const peer = roomId ? rooms.get(roomId)?.peers.get(socket.id) : undefined;
        const producer = peer?.producers.get(producerId);

        if (producer) {
            producer.close();
            peer?.producers.delete(producerId);
            if (roomId) {
                socket.to(roomId).emit("producer-closed", producerId);
            }
            console.log(
                `[Socket] 프로듀서 닫힘: socketId=${socket.id}, roomId=${roomId}, producerId=${producerId}`
            );
        } else {
            console.log(
                `[Socket] 프로듀서 찾을 수 없음: socketId=${socket.id}, roomId=${roomId}, producerId=${producerId}`
            );
        }
    });

    // 연결 해제 처리
    socket.on("disconnect", () => {
        const roomId = socketToRoom.get(socket.id);
        console.log(`[Socket] disconnect 이벤트: socketId=${socket.id}, roomId=${roomId}`);
        if (!roomId || !rooms.has(roomId)) {
            console.log(
                `[Socket] disconnect 처리할 방 없음: socketId=${socket.id}, roomId=${roomId}`
            );
            socketToRoom.delete(socket.id);
            return;
        }

        const currentRoom = rooms.get(roomId)!;
        const peer = currentRoom.peers.get(socket.id);

        if (peer) {
            console.log(
                `[Socket] 피어 정리 시작: socketId=${socket.id}, roomId=${roomId}, ` +
                `producers=${peer.producers.size}, consumers=${peer.consumers.size}`
            );
            peer.sendTransport?.close();
            peer.recvTransport?.close();
            peer.producers.forEach(p => {
                p.close();
                socket.to(roomId).emit("producer-closed", p.id);
                console.log(
                    `[Socket] disconnect 중 프로듀서 닫힘: socketId=${socket.id}, roomId=${roomId}, producerId=${p.id}`
                );
            });
            peer.consumers.forEach(c => c.close());
            currentRoom.peers.delete(socket.id);
            console.log(
                `[Socket] 피어 정리 완료: socketId=${socket.id}, roomId=${roomId}, 남은 피어 수=${currentRoom.peers.size}`
            );
        } else {
            console.log(
                `[Socket] disconnect 시 피어 정보 없음: socketId=${socket.id}, roomId=${roomId}`
            );
        }

        if (currentRoom.peers.size === 0) {
            console.log(
                `[Socket] 방에 더 이상 피어 없음, 라우터 종료: roomId=${roomId}`
            );
            currentRoom.router.close();
            rooms.delete(roomId);
        }
        socketToRoom.delete(socket.id);
        console.log(
            `[Socket] 연결 해제 완료: socketId=${socket.id}, roomId=${roomId}, 전체 방 수=${rooms.size}`
        );
    });
};