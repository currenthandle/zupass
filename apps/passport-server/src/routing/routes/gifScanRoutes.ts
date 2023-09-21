import express, { Request, Response } from "express";
import { logger } from "../../util/logger";

export function initGifScanRoutes(app: express.Application): void {
  logger("[INIT] initializing GifScan routes");

  app.get("/gifscan", (req: Request, res: Response) => {
    // respond with the strring "hello gif"
    res.send("hello gif");
  });
}
