// import { useCallback } from "react";
import { QrReader } from "react-qr-reader";
// import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { Spacer, TextCenter } from "../core";
import { CircleButton } from "../core/Button";
import { icons } from "../icons";
import { AppContainer } from "../shared/AppContainer";
import { useCallback, useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import { ungzip } from "pako";
import { RingLoader } from "react-spinners";
import { Circle } from "rc-progress";

import { constants, helpers, module, artifacts } from "@pcd/ezkl-lib";
import { getSettings } from "@pcd/ezkl-lib/src/artifacts";
const { getInit, getVerify } = module;
const {
  base64ToUint8ClampedArray,
  clampedArrayToBase64String,
  base64StringToClampedArray
} = helpers;
const { PASSPORT_SERVER_DOMAIN, SET_SERVER_DOMAIN, WASM_PATH } = constants;
const { getVK, getSRS } = artifacts;

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

  const [freshArtifacts, setFreshArtifacts] = useState({
    vk: false,
    // srs: false,
    settings: false
  });

  const [verified, setVerified] = useState<boolean | null>(null);

  const getArtifacts = useCallback(
    async (
      refetch = {
        vk: false,
        // srs: false,
        settings: false
      }
    ) => {
      // Check for SRSk
      if (!localStorage.getItem("srs")) {
        const srs = await getSRS(url);
        localStorage.setItem("srs", clampedArrayToBase64String(srs));
        localStorage.setItem("srsSetTime", Date.now().toString());
      }

      // Check for VK
      if (!localStorage.getItem("vk") || refetch.vk) {
        const vk = await getVK(url);
        localStorage.setItem("vk", clampedArrayToBase64String(vk));
        localStorage.setItem("vkSetTime", Date.now().toString());
        setFreshArtifacts((prev) => ({ ...prev, vk: true }));
      }

      // Check for Settings
      if (!localStorage.getItem("settings") || refetch.settings) {
        const settings = await getSettings(url);
        localStorage.setItem("settings", clampedArrayToBase64String(settings));
        localStorage.setItem("settingsSetTime", Date.now().toString());
        setFreshArtifacts((prev) => ({ ...prev, settings: true }));
      }
    },
    [url]
  ); // Assuming `url` is the only dependency for `getArtifacts`

  useEffect(() => {
    (async () => {
      await getArtifacts();
    })();
  }, [getArtifacts]);

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
      const verify = await getVerify();
      if (!verify) {
        throw new Error("Failed to import module verify");
      }

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

      const vk = base64StringToClampedArray(localStorage.getItem("vk"));
      const srs = base64StringToClampedArray(localStorage.getItem("srs"));
      const settings = base64StringToClampedArray(
        localStorage.getItem("settings")
      );

      async function attemptVerify() {
        const verified = await verify(
          new Uint8ClampedArray(uncompressedProof),
          vk,
          settings,
          srs
        );
        setVerified(verified);

        if (verified === true) {
          socketRef.current.emit("verified", true);
        }
        if (
          verified === false ||
          freshArtifacts.vk ||
          freshArtifacts.settings
        ) {
          socketRef.current.emit("verified", false);
        }
      }

      try {
        await attemptVerify();
      } catch (err) {
        if (!freshArtifacts.vk && !freshArtifacts.settings) {
          getArtifacts({ vk: true, settings: true });
          await attemptVerify();
        } else if (!freshArtifacts.vk) {
          getArtifacts({ vk: true, settings: false });
          await attemptVerify();
        } else if (!freshArtifacts.settings) {
          getArtifacts({ vk: false, settings: true });
          await attemptVerify();
        } else {
          socketRef.current.emit("verified", false);
          setVerified(false);
        }
      }
    })();
  }
  // determine the percentage of frames that have been scanned
  // const percentScanned = Math.floor((scans.length / numFrames) * 100);
  // const percentScanned =
  //   scans.length === 0 ? 0 : Math.floor((scans.length / numFrames) * 100);
  const countScanned = scans.filter((scan) => scan !== undefined).length;
  const percentScanned =
    numFrames === 0 ? 0 : Math.floor((countScanned / numFrames) * 100);

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
              console.log("result");
              if (error) {
                console.error("error", error);
                return;
              }
              if (!result) {
                return;
              }

              const data = result.getText();
              const id = parseInt(data.substring(0, 3), 10);
              const totalFrames = parseInt(data.substring(3, 6), 10);
              const chunkData = data.substring(6);

              socketRef.current.emit("qrId", id);

              if (numFrames === 0) {
                setNumFrames(totalFrames);
              }

              if (scans[id] === undefined) {
                setScans((prevScans) => {
                  const newScans = [...prevScans];
                  newScans[id] = chunkData;

                  return newScans;
                });
              }
            }}
            constraints={{ facingMode: "environment", aspectRatio: 1 }}
            ViewFinder={() => <ViewFinder percentScanned={percentScanned} />}
            containerStyle={{ width: "100%" }}
          />
          <Spacer h={24} />
          <TextCenter
            onClick={() => {
              localStorage.removeItem("vk");
              localStorage.removeItem("settings");
            }}
          >
            Scan a GIF verify
          </TextCenter>
        </>
      ) : (
        <div style={{ marginTop: "5rem" }}>
          {verified === null ? (
            <RingLoader
              color="#000000"
              className="w-full m-auto flex justify-center"
            />
          ) : verified ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center"
              }}
            >
              <video src="/videos/cheers.mp4" autoPlay loop />
              <h1
                style={{
                  fontWeight: "bold",
                  fontSize: "3.5rem",
                  marginTop: "2rem"
                }}
              >
                Welcome!!!
              </h1>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center"
              }}
            >
              <img src="/images/penguin.gif" alt="YOU SHALL NOT PASS!" />

              <h1
                style={{
                  fontWeight: "bold",
                  fontSize: "3.5rem",
                  marginTop: "2rem"
                }}
              >
                You're sus...
              </h1>
            </div>
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

// function ViewFinder() {
function ViewFinder({ percentScanned }: { percentScanned: number }) {
  // const nav = useNavigate();
  // const onClose = useCallback(() => nav("/"), [nav]);
  const onClose = () => console.log("onClose");

  return (
    <ScanOverlayWrap>
      {/* <div>HELLOASKJDH</div> */}
      <CircleButton diameter={20} padding={16} onClick={onClose}>
        <img draggable="false" src={icons.closeWhite} width={20} height={20} />
      </CircleButton>
      <Guidebox style={{}}>
        <Corner top left />
        <Corner top />
        <Corner left />
        <Corner />
        <Circle
          percent={percentScanned}
          strokeWidth={4}
          strokeColor="#19473f"
          style={{ padding: "60px" }}
        />
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
