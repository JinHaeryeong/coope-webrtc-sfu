// src/config/mediasoupConfig.ts
import { types as mediasoupTypes } from "mediasoup";

export const mediaCodecs: mediasoupTypes.RtpCodecCapability[] = [
    {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
        preferredPayloadType: 111,
    },
    {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        preferredPayloadType: 96,
    },
];