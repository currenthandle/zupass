import QRCode from "react-qr-code";
import { useEffect, useRef, useState } from "react";
import JSONbig from "json-bigint";
import { Socket } from "socket.io-client";
import io from "socket.io-client";
import "setimmediate";

const chunkSize = 480; // The max length for each chunk

export default function GifQR({ proof }: { proof: string }) {
  const socketRef = useRef<Socket | null>(null);
  const [skipChunks, setSkipChunks] = useState<Record<number, true>>({});
  useEffect(() => {
    // socketRef.current = io("http://192.168.5.120:3002/gifscan");
    // socketRef.current = io("http://192.168.5.120:3002", {
    // socketRef.current = io("http://192.168.5.120:3002/gifscan");
    socketRef.current = io("http://localhost:3002/gifscan");

    socketRef.current.on("connect", () => {
      console.log("[SOCKET] Connected to server");
    });

    socketRef.current.on("broadcastedQrId", (id) => {
      console.log("broadcastedQrId", id);
      setSkipChunks((prev) => ({ ...prev, [id]: true }));
    });

    socketRef.current.on("connect_error", (error) => {
      console.error("[SOCKET] Connection error:", error);
    });

    socketRef.current.on("disconnect", (reason) => {
      console.log("[SOCKET] Disconnected from server. Reason:", reason);
    });

    // Clean up on component unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const BASE62 =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

  function decToBaseN(decStr: string, base: number): string | null {
    // Count the leading zeros
    const leadingZeros = decStr.match(/^0+/);
    let zerosCount = 0;
    if (leadingZeros) {
      zerosCount = leadingZeros[0].length;
    }
    console.log(`Count of leading zeros in decimal: ${zerosCount}`);

    // Validate if it's a number
    if (!/^\d+$/.test(decStr)) {
      console.log(`Invalid input: ${decStr} is not a decimal number.`);
      return null;
    }

    try {
      const decimalPart = decStr.slice(zerosCount);

      const decimal = BigInt(decimalPart);

      let converted = "";
      if (base <= 36) {
        converted = decimal.toString(base);
      } else if (base === 62) {
        converted = toBase62(decimal);
      } else {
        console.log(`Unsupported base: ${base}`);
        return null;
      }
      const leadingConvertedZeros = "0".repeat(zerosCount);

      const result = leadingConvertedZeros + converted;
      return result;
    } catch (e) {
      console.error("Error converting to BigInt:", e);
      return null;
    }
  }

  function toBase62(num: bigint): string {
    if (num === 0n) return BASE62[0];
    let s = "";
    while (num > 0n) {
      s = BASE62[Number(num % 62n)] + s;
      num = num / 62n;
    }
    return s;
  }

  function splitStringIntoChunks(str: string, chunkSize: number) {
    const chunks = [];
    let index = 0;
    while (index < str.length) {
      chunks.push(str.slice(index, index + chunkSize));
      index += chunkSize;
    }
    console.log("chunks.length", chunks.length);
    return chunks;
  }
  const tick = useRef<NodeJS.Timeout | number | null>(null);

  const [currentQRCode, setCurrentQRCode] = useState(0);
  const [arrayOfChunks, setArrayOfChunks] = useState<string[]>([]);

  useEffect(() => {
    const hexProof = decToBaseN(proof, 62);

    if (!hexProof) {
      throw new Error("Invalid proof");
    }
    const arrayOfChunks = splitStringIntoChunks(hexProof, chunkSize);
    setArrayOfChunks(arrayOfChunks);
  }, [proof, setArrayOfChunks]);

  useEffect(() => {
    tick.current = setInterval(() => {
      let nextIndex = currentQRCode + 1;
      if (nextIndex === arrayOfChunks.length) {
        nextIndex = 0;
      }
      while (skipChunks[nextIndex]) {
        nextIndex++;
        if (nextIndex === arrayOfChunks.length) {
          nextIndex = 0;
        }
      }
      setCurrentQRCode(nextIndex);
    }, 400);
    return () => clearInterval(tick.current as any);
  }, [setCurrentQRCode, currentQRCode, arrayOfChunks]);

  const QRCodes = arrayOfChunks.map((chunk, i) => {
    let id;
    if (i < 10) {
      id = `0${i}`;
    } else {
      id = i;
    }

    let numChunks;

    if (arrayOfChunks.length < 10) {
      numChunks = `0${arrayOfChunks.length.toString()}`;
    } else {
      numChunks = arrayOfChunks.length.toString();
    }

    return (
      <QRCode
        key={i}
        level="L"
        size={256}
        style={{
          height: "auto",
          maxWidth: "100%",
          width: "100%",
          paddingLeft: "15px",
          paddingRight: "15px"
        }}
        value={id + numChunks + chunk}
        viewBox={`0 0 256 256`}
      />
    );
  });

  return <main className="p-8 w-7/12 m-auto">{QRCodes[currentQRCode]}</main>;
}
