// import { useCallback } from "react";
import { QrReader } from "react-qr-reader";
// import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { Spacer, TextCenter } from "../core";
import { CircleButton } from "../core/Button";
import { icons } from "../icons";
import { AppContainer } from "../shared/AppContainer";
import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import { ungzip } from "pako";

// function uint8ClampedArrayToString(data: Uint8Array): string {
//   return String.fromCharCode.apply(null, Array.from(data)) as string;
// }

function stringToUint8ClampedArray(str: string): Uint8Array {
  const buffer = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    buffer[i] = str.charCodeAt(i);
  }
  return buffer;
}

// function uint8ClampedArrayToBase64(data: Uint8Array): string {
//   const str = uint8ClampedArrayToString(data);
//   return btoa(str);
// }

function base64ToUint8ClampedArray(base64: string): Uint8Array {
  const str = atob(base64);
  return stringToUint8ClampedArray(str);
}

async function getVerify() {
  try {
    const module = await import("@ezkljs/engine/web/ezkl");
    const verify = module.verify;
    return verify;
  } catch (err) {
    console.error("Failed to import module:", err);
  }
}

// Scan a PCD QR code, then go to /verify to verify and display the proof.
export function ScanGifScreen() {
  // const nav = useNavigate();
  const [scans, setScans] = useState<string[]>([]);
  const [scanned, setScanned] = useState(false);
  const [numFrames, setNumFrames] = useState(0);
  // const [socket, setSocket] = useState(null);
  const socketRef = useRef(null);

  // const timer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // socketRef.current = io("http://192.168.5.120:3002/gifscan");
    // socketRef.current = io("http://192.168.5.120:3002", {
    // socketRef.current = io("http://192.168.5.120:3002/gifscan");
    socketRef.current = io("http://localhost:3002/gifscan");

    socketRef.current.on("connect", () => {
      console.log("[SOCKET] Connected to server");
    });

    socketRef.current.on("connect_error", (error) => {
      console.error("[SOCKET] Connection error:", error);
    });

    socketRef.current.on("disconnect", (reason) => {
      console.log("[SOCKET] Disconnected from server. Reason:", reason);
    });

    // Clean up on component unmount
    return () => {
      socketRef.current.disconnect();
    };
  }, []);

  useEffect(() => {
    // console.log("numFrames > 0", numFrames > 0);
    // console.log("numFrames === scans.length", numFrames === scans.length);
    // console.log(
    //   "scans.every((scan) => scan && scan.length > 0)",
    //   scans.every((scan) => scan && scan.length > 0)
    // );
    if (numFrames > 0 && numFrames === scans.length) {
      for (let i = 0; i < numFrames; i++) {
        if (!scans[i]) {
          return;
        }
      }
      setScanned(true);
    }
  }, [numFrames, scans]);

  if (scanned) {
    (async () => {
      const verify = await getVerify();
      if (!verify) {
        throw new Error("Failed to import module verify");
      }

      // LOAD VK
      const vkResp = await fetch("/ezkl-artifacts/test.vk");
      // console.log("after fetch vk");
      if (!vkResp.ok) {
        throw new Error("Failed to fetch test.vk");
      }
      const vkBuf = await vkResp.arrayBuffer();
      const vk = new Uint8ClampedArray(vkBuf);
      console.log("after vkBuf");

      const settingsResp = await fetch("/ezkl-artifacts/settings.json");
      if (!settingsResp.ok) {
        throw new Error("Failed to fetch settings.json");
      }
      const settingsBuf = await settingsResp.arrayBuffer();
      const settings = new Uint8ClampedArray(settingsBuf);

      const srsResp = await fetch("/ezkl-artifacts/kzg.srs");
      if (!srsResp.ok) {
        throw new Error("Failed to fetch kzg.srs");
      }
      const srsBuf = await srsResp.arrayBuffer();
      const srs = new Uint8ClampedArray(srsBuf);

      // const testPFResp = await fetch("/ezkl-artifacts/test.pf");
      // const testPF = new Uint8ClampedArray(await testPFResp.arrayBuffer());
      const aggScan = scans.join("");
      console.log("scans", scans);
      console.log("aggScan", aggScan);

      const decodedProof = base64ToUint8ClampedArray(aggScan);
      const uncompressedProof = ungzip(decodedProof);

      console.log("proof", uncompressedProof);

      const verified = await verify(
        new Uint8ClampedArray(uncompressedProof),
        vk,
        settings,
        srs
      );
      console.log("VERIFIED", verified);
    })();
  }
  return (
    <AppContainer bg="gray">
      {!scanned ? (
        <>
          <div style={{ whiteSpace: "normal" }}>
            {scans.map((scan, i) => {
              if (scan?.length > 0) {
                return `${i},`;
              }
              return `*,`;
            })}
          </div>
          <QrReader
            onResult={(result, error) => {
              // console.log("result");
              if (error) {
                // console.error("error", error);
                return;
              }
              if (!result) {
                return;
              }

              const data = result.getText();
              const id = parseInt(data.substring(0, 3), 10);
              const totalFrames = parseInt(data.substring(3, 6), 10);
              const chunkData = data.substring(6);
              console.log("data", data);

              socketRef.current.emit("qrId", id);

              if (numFrames === 0) {
                // console.log("setNumFrames", length);
                setNumFrames(totalFrames);
              }

              if (scans[id] === undefined) {
                // console.log("");
                // console.log("scans[id]", scans[id]);
                // console.log("setScans", id);
                // const newScans = [...scans];
                // newScans[id] = chunkData.slice(6);
                // console.log("newScans", newScans);
                // setScans(newScans);
                setScans((prevScans) => {
                  const newScans = [...prevScans];
                  newScans[id] = chunkData;

                  return newScans;
                });
              }
            }}
            constraints={{ facingMode: "environment", aspectRatio: 1 }}
            ViewFinder={ViewFinder}
            containerStyle={{ width: "100%" }}
          />
          <Spacer h={24} />
          <TextCenter>Scan a GIF verify</TextCenter>
        </>
      ) : (
        <div>
          {scans.map((scan, i) => {
            return <div key={i}>{scan}</div>;
          })}
        </div>
      )}
    </AppContainer>
  );
}

// function maybeRedirect(text: string): string | null {
//   const verifyUrlPrefix = `${window.location.origin}#/verify?`;
//   if (text.startsWith(verifyUrlPrefix)) {
//     const hash = text.substring(window.location.origin.length + 1);
//     console.log(`Redirecting to ${hash}`);
//     return hash;
//   }
//   return null;
// }

function ViewFinder() {
  // const nav = useNavigate();
  // const onClose = useCallback(() => nav("/"), [nav]);
  const onClose = () => console.log("onClose");

  return (
    <ScanOverlayWrap>
      {/* <div>HELLOASKJDH</div> */}
      <CircleButton diameter={20} padding={16} onClick={onClose}>
        <img draggable="false" src={icons.closeWhite} width={20} height={20} />
      </CircleButton>
      <Guidebox>
        <Corner top left />
        <Corner top />
        <Corner left />
        <Corner />
      </Guidebox>
    </ScanOverlayWrap>
  );
}

const ScanOverlayWrap = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  right: 0;
  z-index: 1;
`;

const Guidebox = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 75%;
  height: 75%;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
`;

const Corner = styled.div<{ top?: boolean; left?: boolean }>`
  position: absolute;
  ${(p) => (p.top ? "top: 0" : "bottom: 0")};
  ${(p) => (p.left ? "left: 0" : "right: 0")};
  border: 2px solid white;
  ${(p) => (p.left ? "border-right: none" : "border-left: none")};
  ${(p) => (p.top ? "border-bottom: none" : "border-top: none")};
  width: 16px;
  height: 16px;
  ${(p) => (p.left && p.top ? "border-radius: 8px 0 0 0;" : "")};
  ${(p) => (p.left && !p.top ? "border-radius: 0 0 0 8px;" : "")};
  ${(p) => (!p.left && p.top ? "border-radius: 0 8px 0 0;" : "")};
  ${(p) => (!p.left && !p.top ? "border-radius: 0 0 8px 0;" : "")};
`;
