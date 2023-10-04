import {
  PCD,
  PCDArgument,
  PCDPackage,
  SerializedPCD,
  StringArgument
} from "@pcd/pcd-types";
import JSONBig from "json-bigint";
import { v4 as uuid } from "uuid";
import { gzip } from "pako";

// import { type EzklSecretPCD } from "@pcd/ezkl-secret-pcd";
// import { type EzklDisplayPCD } from "@pcd/ezkl-display-pcd";

async function getVerify() {
  try {
    const module = await import("@ezkljs/engine/web/ezkl");
    const verify = module.verify;
    return verify;
  } catch (err) {
    console.error("Failed to import module:", err);
  }
}

function stringToFloat(str: string) {
  let result = "";
  for (let i = 0; i < str.length; i++) {
    result += str.charCodeAt(i).toString();
  }
  return parseFloat(result);
}

function unit8ArrayToJsonObect(uint8Array: Uint8Array) {
  // let string = new TextDecoder("utf-8").decode(uint8Array);
  let string = new TextDecoder().decode(uint8Array);
  let jsonObject = JSON.parse(string);
  return jsonObject;
}

async function getInit() {
  try {
    const module = await import("@ezkljs/engine/web/ezkl");
    const init = module.default;
    return init;
  } catch (err) {
    console.error("Failed to import module:", err);
  }
}

async function getProve() {
  try {
    const module = await import("@ezkljs/engine/web/ezkl");
    const init = module.prove;
    return init;
  } catch (err) {
    console.error("Failed to import module:", err);
  }
}

async function getGenWitness() {
  try {
    const module = await import("@ezkljs/engine/web/ezkl");
    const genWitness = module.genWitness;
    return genWitness;
  } catch (err) {
    console.error("Failed to import module:", err);
  }
}

async function getFloatToVecU64() {
  try {
    const module = await import("@ezkljs/engine/web/ezkl");
    const floatToVecU64 = module.floatToVecU64;
    return floatToVecU64;
  } catch (err) {
    console.error("Failed to import module:", err);
  }
}

async function getPoseidonHash() {
  try {
    const module = await import("@ezkljs/engine/web/ezkl");
    const poseidonHash = module.poseidonHash;
    return poseidonHash;
  } catch (err) {
    console.error("Failed to import module:", err);
  }
}

export const EzklGroupPCDTypeName = "ezkl-group-pcd";

// export interface EzklGroupPCDArgs {
//   group: "GROUP1";
//   witness: Uint8ClampedArray;
//   pk: Uint8ClampedArray;
//   model: Uint8ClampedArray;
//   settings: Uint8ClampedArray;
//   srs: Uint8ClampedArray;
// }

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
  const compiliedModelResp = await fetch("/ezkl-artifacts/network.compiled");
  if (!compiliedModelResp.ok) {
    throw new Error("Failed to fetch network.compiled");
  }
  const modelBuf = await compiliedModelResp.arrayBuffer();
  const model = new Uint8ClampedArray(modelBuf);

  // FETCH SETTINGS
  const settingsResp = await fetch("/ezkl-artifacts/settings.json");
  if (!settingsResp.ok) {
    throw new Error("Failed to fetch settings.json");
  }
  const settingsBuf = await settingsResp.arrayBuffer();
  const settings = new Uint8ClampedArray(settingsBuf);

  const { clearSecret } = secretPCD.proof;
  const float = stringToFloat(clearSecret);

  const hashedSet = `[
    [
      4572534320476584198, 16569434655355399807, 2934216378187574526,
      407414070347714353
    ],
    [
      9076552887107963406, 5988095838945484945, 9199181261850001878,
      632050959657341670
    ],
    [
      12305608786227911750, 9903581919532927302, 2907727335548365623,
      737630934569201951
    ],
    [
      5236164246842610752, 7116161584353376787, 5863925054592117601,
      1720486879953014270
    ],
    [
      8705747727513110919, 8368749124085643527, 1768788280531912488,
      2785003347918012818
    ],
    [
      11098220056660419283, 5728214177482673336, 17470378912069676664,
      2311452660145672176
    ],
    [
      7370671970298444243, 11290245180410780212, 15962375296642530508,
      1372135491719419450
    ],
    [
      12817781970450193072, 17513085767882081417, 8221563647785859506,
      2500146335159376594
    ],
    [
      3246365869747041386, 17437817983640603683, 6502307365827494142,
      73616177511686234
    ]
  ]`;

  const inputObj = {
    input_data: [[7.0], JSONBig.parse(hashedSet)]
  };

  const inputStr = JSONBig.stringify(inputObj);
  const encodeInputBuf = new TextEncoder().encode(inputStr);
  const inputClamped = new Uint8ClampedArray(encodeInputBuf);

  const witnessUint8 = genWitness(model, inputClamped);
  const witnessJson = new TextDecoder().decode(witnessUint8);
  const witness = JSONBig.parse(witnessJson);

  // FETCH PKj
  const pkResp = await fetch("/ezkl-artifacts/test.pk");
  if (!pkResp.ok) {
    throw new Error("Failed to fetch pk.key");
  }
  const pkBuf = await pkResp.arrayBuffer();
  const pk = new Uint8ClampedArray(pkBuf);

  // FETCH SRS
  const srsResp = await fetch("/ezkl-artifacts/kzg.srs");
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
  // const compressedData = new Uint8ClampedArray(gzip(proof, { level: 9 }));
  // const compressedData = gzip(proof, { level: 9 });
  // console.log("compressedData", compressedData);

  // console.log("proof as json string", JSONBig.stringify(proof));

  // function convertDataToString(data: Uint8Array) {
  //   let string = "";
  //   for (let i = 0; i < data.length; i++) {
  //     // string += String.fromCharCode(data[i]);
  //     const elmToStr = data[i].toString();
  //     if (elmToStr.length === 1) {
  //       string += "00" + elmToStr;
  //     } else if (elmToStr.length === 2) {
  //       string += "0" + elmToStr;
  //     } else {
  //       string += elmToStr;
  //     }
  //   }
  //   return string;
  // }

  // const dataStr = convertDataToString(proof);
  // console.log("proof", proof);
  // console.log("dataStr", dataStr);

  // const verify = await getVerify();
  // if (!verify) {
  //   throw new Error("Failed to import module verify");
  // }

  // // LOAD VK
  // const vkResp = await fetch("/ezkl-artifacts/test.vk");
  // // console.log("after fetch vk");
  // if (!vkResp.ok) {
  //   throw new Error("Failed to fetch test.vk");
  // }
  // const vkBuf = await vkResp.arrayBuffer();
  // const vk = new Uint8ClampedArray(vkBuf);
  // console.log("after vkBuf");

  // const testPFResp = await fetch("/ezkl-artifacts/test.pf");
  // const testPF = new Uint8ClampedArray(await testPFResp.arrayBuffer());
  // console.log("proof", proof);

  // const verified = await verify(proof, vk, settings, srs);
  // console.log("VERIFIED", verified);

  // return new EzklGroupPCD(uuid(), { groupName: "GROUP1" }, { proof: dataStr });
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
