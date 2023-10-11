import {
  encodeQRPayload,
  QRDisplayWithRegenerateAndStorage
} from "@pcd/passport-ui";
import { useCallback, useEffect, useState } from "react";
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

export function EzklDisplayCardBody({ pcd }: { pcd: EzklDisplayPCD }) {
  // const ticketData = getTicketData(pcd);: dataStr
  // console.log("DISPLAY CARD", pcd);

  const [groupPCD, setGroupPCD] = useState<EzklGroupPCD | null>(null);

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
      {groupPCD ? (
        <div>
          {/* <FieldLabel>Secret</FieldLabel> */}
          <GifQR proof={groupPCD?.proof?.proof} />
        </div>
      ) : (
        <div className="w-full">
          <RingLoader
            color="#000000"
            className="w-full m-auto flex justify-center"
          />
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
