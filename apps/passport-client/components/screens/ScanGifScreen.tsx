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
import { RingLoader } from "react-spinners";

import { constants, helpers, module, artifacts } from "@pcd/ezkl-lib";
import { getSettings } from "@pcd/ezkl-lib/src/artifacts";
const { getInit, getVerify } = module;
const { base64ToUint8ClampedArray } = helpers;
const { PASSPORT_SERVER_DOMAIN, SET_SERVER_DOMAIN, WASM_PATH } = constants;
const { getVK, getSRS} = artifacts

// Scan a PCD QR code, then go to /verify to verify and display the proof.
export function ScanGifScreen() {
  // const HOST = "http://localhost:5001";
  const HOST = SET_SERVER_DOMAIN;
  const ROUTE = "/public";
  const url = `${HOST}${ROUTE}/`;
  const webSocketUrl = `${PASSPORT_SERVER_DOMAIN}/gifscan`;
  // const nav = useNavigate();
  const [scans, setScans] = useState<string[]>([]);
  const [scanned, setScanned] = useState(false);
  const [numFrames, setNumFrames] = useState(0);
  // const [socket, setSocket] = useState(null);
  const socketRef = useRef(null);

  const [verified, setVerified] = useState<boolean | null>(null);

  // set ezkl artifacts on local storage
  // useEffect(() => {

    


  // }, []);

  useEffect(() => {
    console.log("PASSPORT_SERVER_DOMAIN from scanner", webSocketUrl);
    socketRef.current = io(webSocketUrl);

    socketRef.current.on("connect", () => {
      console.log("[SOCKET] Connected to server", webSocketUrl);
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
  }, [webSocketUrl]);

  useEffect(() => {
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
      console.log('scanned!!!!');
      const verify = await getVerify();
      if (!verify) {
        throw new Error("Failed to import module verify");
      }

      const srs = await getSRS(url)
      const vk = await getVK(url);
      const settings = await getSettings(url);

      console.log('got all artiofacts')



      const aggScan = scans.join("");

      const decodedProof = base64ToUint8ClampedArray(aggScan);
      const uncompressedProof = ungzip(decodedProof);

      const init = await getInit();

      if (!init) {
        throw new Error("Failed to import module init");
      }
      await init(
        WASM_PATH,
        new WebAssembly.Memory({ initial: 20, maximum: 1024, shared: true })
      );

      try {
        const verified = await verify(
          new Uint8ClampedArray(uncompressedProof),
          vk,
          settings,
          srs
        );
        setVerified(verified);
      } catch (err) {
        setVerified(false);
      }
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
              // console.log("data", data);

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
        <div style={{ marginTop: "5rem" }}>
          {verified === null ? (
            <RingLoader
              color="#000000"
              className="w-full m-auto flex justify-center"
            />
          ) : verified ? (
            <div>Verified</div>
          ) : (
            <div>Not verified</div>
          )}
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
