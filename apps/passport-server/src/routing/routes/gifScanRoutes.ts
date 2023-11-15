import express from "express";
import { Server as SocketIOServer } from "socket.io";
import { logger } from "../../util/logger";
import * as http from "http";

export function initGifScanRoutes(
  app: express.Application,
  server: http.Server
): void {
  logger("[INIT] initializing GifScan routes");

  // HTTP route
  app.get("/gifscan", (req: express.Request, res: express.Response) => {
    logger("[ROUTE] /gifscan");
    res.send("Websocket endpoint at /gifscan");
  });

  // Setting up socket.io using the provided server
  const io = new SocketIOServer(server, {
    cors: {
      origin: "*"
    }
  });
  io.of("/gifscan").on("connection", (socket) => {
    logger("[SOCKET] a user connected");

    socket.on("qrId", (id) => {
      logger("[SOCKET] id received", id);

      socket.broadcast.emit("broadcastedQrId", id);
    });

    socket.on("verified", (verified) => {
      logger("[SOCKET] verified received", verified);

      socket.broadcast.emit("broadcastedVerified", verified);
    });
    socket.on("disconnect", () => {
      logger("[SOCKET] user disconnected");
    });
  });
}
