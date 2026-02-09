import { createWorker, types as mediasoupTypes } from "mediasoup";
import { mediaCodecs } from "../config/mediasoupConfig";

let worker: mediasoupTypes.Worker;

export const initWorker = async () => {
    worker = await createWorker({ rtcMinPort: 10000, rtcMaxPort: 11000 });
    worker.on("died", () => {
        console.error(
            "[mediasoup] Worker가 예기치 못하게 죽었습니다, 2초 후 종료됩니다"
        );
        setTimeout(() => {
            process.exit(1);
        }, 2000);
    });
    return worker;
};

export const createRoomRouter = async () => {
    return await worker.createRouter({ mediaCodecs });
};

export const createWebRtcTransport = async (router: mediasoupTypes.Router) => {
    const transport = await router.createWebRtcTransport({
        listenIps: [{
            ip: "0.0.0.0",
            announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || "127.0.0.1",
        },],
        // listenIps: [
        //     { ip: "127.0.0.1" }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: 1000000,
    });
    return transport;
};