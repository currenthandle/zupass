// import { useCallback } from "react";
import { QrReader } from "react-qr-reader";
// import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { Spacer, TextCenter } from "../core";
import { CircleButton } from "../core/Button";
import { icons } from "../icons";
import { AppContainer } from "../shared/AppContainer";
import { useEffect, useState } from "react";

// Scan a PCD QR code, then go to /verify to verify and display the proof.
export function ScanGifScreen() {
  // const nav = useNavigate();
  const [scans, setScans] = useState<string[]>([]);
  const [scanned, setScanned] = useState(false);
  const [numFrames, setNumFrames] = useState(0);

  console.log(scans);

  useEffect(() => {
    console.log("numFrames > 0", numFrames > 0);
    console.log("numFrames === scans.length", numFrames === scans.length);
    console.log(
      "scans.every((scan) => scan && scan.length > 0)",
      scans.every((scan) => scan && scan.length > 0)
    );
    if (numFrames > 0 && numFrames === scans.length) {
      for (let i = 0; i < numFrames; i++) {
        if (!scans[i]) {
          return;
        }
      }
      setScanned(true);
    }
  }, [numFrames, scans]);
  return (
    <AppContainer bg="gray">
      <div>
        {scans.map((scan, i) => {
          if (scan?.length > 0) {
            return `${i},`;
          }
          return `*,`;
        })}
      </div>
      {!scanned ? (
        <>
          <QrReader
            onResult={(result, error) => {
              // console.log("result");
              if (!result) {
                return;
              }
              const data = result.getText();
              const id = parseInt(data.substring(0, 2), 10);
              const length = parseInt(data.substring(2, 4), 10);
              const chunkData = data.substring(4);

              if (numFrames === 0) {
                console.log("setNumFrames", length);
                setNumFrames(length);
              }

              if (!scans[id]) {
                console.log("");
                console.log("scans[id]", scans[id]);
                console.log("setScans", id);
                setScans((prevScans) => {
                  // console.log(prevScans);
                  const newScans = [...prevScans];
                  newScans[id] = chunkData;

                  return newScans;
                });
              }

              // if (result != null) {
              //   const data = result.getText();
              //   const id = parseInt(data.substring(0, 2), 10);
              //   const length = parseInt(data.substring(2, 4), 10);
              //   const chunkData = data.substring(4);

              //   setScans((prevScans) => {
              //     const newScans = [...prevScans];
              //     newScans[id] = chunkData;

              //     const logScans = newScans.map((scan, i) => {
              //       return scan ? `${i.toString()}, ` : "*, ";
              //     });
              //     console.log(`Scans: ${logScans}`);

              //     if (
              //       length === newScans.length &&
              //       newScans.every((scan) => scan && scan.length > 0)
              //     ) {
              //       // Schedule setScanned to run after the current render/update cycle.
              //       setTimeout(() => setScanned(true), 0);
              //     }

              //     return newScans;
              //   });
              // } else if (error != null) {
              //   // handle the error
              //   // console.error(`Error scanning QR code: ${error}`);
              // }
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
            if (scan?.length > 0) {
              return `${i},`;
            }
            return `*,`;
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
