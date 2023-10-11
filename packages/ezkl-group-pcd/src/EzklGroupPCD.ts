import {
  PCD,
  PCDArgument,
  PCDPackage,
  SerializedPCD,
  StringArgument
} from "@pcd/pcd-types";
import JSONBig from "json-bigint";
import { v4 as uuid } from "uuid";

import { module, helpers } from "@pcd/ezkl-lib";
const { stringToFloat } = helpers;
const { getGenWitness, getProve, getInit } = module;

export const EzklGroupPCDTypeName = "ezkl-group-pcd";

export interface EzklGroupPCDArgs {
  // displayPCD: PCDArgument<EzklDisplayPCD>;
  displayPCD: PCDArgument<any>;
}

export interface EzklGroupPCDClaim {
  // identity: Uint8ClampedArray;
  // hash: Uint8ClampedArray;
  groupName: "GROUP1";
}

export interface EzklGroupPCDProof {
  proof: Uint8Array;
  // proof: string;
  // witness: Uint8ClampedArray;
}

export class EzklGroupPCD implements PCD<EzklGroupPCDClaim, EzklGroupPCDProof> {
  type = EzklGroupPCDTypeName;
  claim: EzklGroupPCDClaim;
  proof: EzklGroupPCDProof;
  id: string;

  public constructor(
    id: string,
    claim: EzklGroupPCDClaim,
    proof: EzklGroupPCDProof
  ) {
    this.id = id;
    this.claim = claim;
    this.proof = proof;
  }
}

export async function prove(args: EzklGroupPCDArgs): Promise<EzklGroupPCD> {
  const HOST = "https://set-membership-server.onrender.com";
  const ROUTE = "/public";
  const url = `${HOST}${ROUTE}/`;
  if (!args.displayPCD.value) {
    throw new Error("Cannot make group proof: missing secret pcd");
  }
  // note: this causes circular dependency
  // const displayPCD = await EzklDisplayPCDPackage.deserialize(
  //   args.displayPCD.value.pcd
  // );
  const displayPCD = JSONBig().parse(args.displayPCD.value.pcd);
  const { secretPCD } = displayPCD.proof;

  const init = await getInit();

  if (!init) {
    throw new Error("Failed to import module init");
  }
  await init(
    "/ezkl-artifacts/ezkl_bg.wasm",
    new WebAssembly.Memory({ initial: 20, maximum: 1024, shared: true })
  );

  const genWitness = await getGenWitness();
  if (!genWitness) {
    throw new Error("Failed to import module genWitness");
  }

  // FETCH COMPILED MODEL
  // const compiliedModelResp = await fetch("/ezkl-artifacts/network.compiled");
  const compiliedModelResp = await fetch(url + "network.compiled");
  if (!compiliedModelResp.ok) {
    throw new Error("Failed to fetch network.compiled");
  }
  const modelBuf = await compiliedModelResp.arrayBuffer();
  const model = new Uint8ClampedArray(modelBuf);

  // FETCH SETTINGS
  // const settingsResp = await fetch("/ezkl-artifacts/settings.json");
  const settingsResp = await fetch(url + "settings.json");
  if (!settingsResp.ok) {
    throw new Error("Failed to fetch settings.json");
  }
  const settingsBuf = await settingsResp.arrayBuffer();
  const settings = new Uint8ClampedArray(settingsBuf);

  const { clearSecret } = secretPCD.proof;
  const float = stringToFloat(clearSecret);

  const hashSetServerResp = await fetch(url + "hash_set.json");

  const hashSetServerBuf = await hashSetServerResp.arrayBuffer();
  const hashSetServer = new Uint8ClampedArray(hashSetServerBuf);
  const hashSetServerString = new TextDecoder().decode(hashSetServer);
  const hashSetServerObj = JSONBig.parse(hashSetServerString);
  const hashSet = hashSetServerObj.y_input;

  const inputObj = {
    input_data: [[float], hashSet]
  };

  const inputStr = JSONBig.stringify(inputObj);
  const encodeInputBuf = new TextEncoder().encode(inputStr);
  const inputClamped = new Uint8ClampedArray(encodeInputBuf);

  const witnessUint8 = genWitness(model, inputClamped);

  // FETCH PKj
  // const pkResp = await fetch("/ezkl-artifacts/test.pk");
  const pkResp = await fetch(url + "test.pk");
  if (!pkResp.ok) {
    throw new Error("Failed to fetch pk.key");
  }
  const pkBuf = await pkResp.arrayBuffer();
  const pk = new Uint8ClampedArray(pkBuf);

  // FETCH SRS
  // const srsResp = await fetch("/ezkl-artifacts/kzg.srs");
  const srsResp = await fetch(url + "kzg.srs");
  if (!srsResp.ok) {
    throw new Error("Failed to fetch kzg.srs");
  }
  const srsBuf = await srsResp.arrayBuffer();
  const srs = new Uint8ClampedArray(srsBuf);

  const ezklProve = await getProve();
  if (!ezklProve) {
    throw new Error("Failed to import module");
  }
  const proof = await ezklProve(
    new Uint8ClampedArray(witnessUint8),
    pk,
    model,
    srs
  );
  return new EzklGroupPCD(uuid(), { groupName: "GROUP1" }, { proof });
}

export async function verify(pcd: EzklGroupPCD): Promise<boolean> {
  return true;
  // const ezklVerify = await getVerify();
  // if (!ezklVerify) {
  //   throw new Error("Failed to import module");
  // }

  // const vk = "vk.key" as unknown as Uint8ClampedArray;
  // const settings = "settings.json" as unknown as Uint8ClampedArray;
  // const srs = "kzg.srs" as unknown as Uint8ClampedArray;
  // const verified = await ezklVerify(
  //   new Uint8ClampedArray(pcd.proof.hex),
  //   vk,
  //   settings,
  //   srs
  // );

  // return verified;
}

export async function serialize(
  // pcd: EzklSecretPCD
  pcd: any
  // ): Promise<SerializedPCD<EzklSecretPCD>> {
): Promise<SerializedPCD<any>> {
  return {
    type: EzklGroupPCDTypeName,
    pcd: JSONBig().stringify(pcd)
  } as SerializedPCD<any>;
}

// export async function deserialize(serialized: string): Promise<EzklSecretPCD> {
export async function deserialize(serialized: string): Promise<any> {
  return JSONBig().parse(serialized);
}

export const EzklGroupPCDPackage: PCDPackage = {
  name: EzklGroupPCDTypeName,
  prove,
  verify,
  serialize,
  deserialize
};
