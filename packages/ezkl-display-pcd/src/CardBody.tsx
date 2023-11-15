import {
  encodeQRPayload,
  QRDisplayWithRegenerateAndStorage
} from "@pcd/passport-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { FieldLabel, Separator, Spacer, TextContainer } from "@pcd/passport-ui";
import styled from "styled-components";
import {
  initArgs,
  EzklDisplayPCD,
  EzklDisplayPCDPackage
} from "./EzklDisplayPCD";
// import { getQRCodeColorOverride, getTicketData } from "./utils";
import { EzklGroupPCD, EzklGroupPCDPackage } from "@pcd/ezkl-group-pcd";
import { ArgumentTypeName } from "@pcd/pcd-types";
import GifQR from "./GifQR";
import { RingLoader } from "react-spinners";
// import { PASSPORT_SERVER_DOMAIN } from "@pcd/ezkl-lib/src/constants";
import { io } from "socket.io-client";
import { Socket } from "socket.io-client";
import { FaCheckCircle, FaTimesCircle } from "react-icons/fa";

import * as ezklLib from "@pcd/ezkl-lib";
const { constants } = ezklLib;
const { PASSPORT_SERVER_DOMAIN } = constants;

export function EzklDisplayCardBody({ pcd }: { pcd: EzklDisplayPCD }) {
  const [groupPCD, setGroupPCD] = useState<EzklGroupPCD | null>(null);

  // const [skipChunks, setSkipChunks] = useState<Record<number, true>>({});
  const socketRef = useRef<Socket | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  useEffect(() => {
    socketRef.current = io(PASSPORT_SERVER_DOMAIN + "/gifscan");

    socketRef.current.on("connect", () => {
      console.log("[SOCKET] Connected to server");
    });

    // socketRef.current.on("broadcastedQrId", (id) => {
    //   console.log("broadcastedQrId", id);
    //   setSkipChunks((prev) => ({ ...prev, [id]: true }));
    // });

    socketRef.current.on("broadcastedVerified", (verfied) => {
      console.log("broadcastedVerified", verfied);
      setVerified(verfied);
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

  useEffect(() => {
    const callProve = async () => {
      const serializedDisplayPCD = await EzklDisplayPCDPackage.serialize(pcd);

      const groupPCD = await EzklGroupPCDPackage.prove({
        displayPCD: {
          argumentType: ArgumentTypeName.PCD,
          value: serializedDisplayPCD
        }
      });

      setGroupPCD(groupPCD);
    };

    callProve();
  }, [pcd]);

  // const arrProof = stringToUint8ClampedArray(groupPCD?.proof?.proof);
  // console.log("DISPLAY CARD", groupPCD?.proof?.proof);
  // return (
  //   <Container>
  //     <p>EZKL Secret PCD</p>

  //     <Separator />

  //     <FieldLabel>Secret</FieldLabel>
  //     <TextContainer>this is a test</TextContainer>
  //   </Container>
  // );
  // console.log("DISPLAY CARD", groupPCD?.proof?.proof);
  // const decodedArray = new TextDecoder().decode(groupPCD?.proof?.proof);
  // console.log("DISPLAY CARD", decodedArray);
  return (
    <Container>
      {/* <p>EZKL Group Membership PCD</p> */}
      {/* <Separator /> */}
      {verified === true ? (
        <FaCheckCircle />
      ) : verified === false ? (
        <FaTimesCircle />
      ) : groupPCD ? (
        <div>
          {/* <FieldLabel>Secret</FieldLabel> */}
          <GifQR proof={groupPCD?.proof?.proof} />
        </div>
      ) : (
        <div
          style={{
            width: "100%",
            // height: "100%",
            display: "flex",
            justifyContent: "center",
            padding: "16px 0",
            alignItems: "center"
            // aspectRatio: "1/1"
          }}
        >
          <RingLoader size={170} color="#19473f" />
        </div>
      )}
    </Container>
  );
}

const Container = styled.span`
  padding: 16px;
  overflow: hidden;
  width: 100%;
`;
