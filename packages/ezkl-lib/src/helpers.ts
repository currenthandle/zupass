import JSONBig from "json-bigint";

export function stringToFloat(str: string) {
  let result = "";
  for (let i = 0; i < str.length; i++) {
    result += str.charCodeAt(i).toString();
  }
  return parseFloat(result);
}

export function unit8ArrayToJsonObect(uint8Array: Uint8Array) {
  // let string = new TextDecoder("utf-8").decode(uint8Array);
  let string = new TextDecoder().decode(uint8Array);
  let jsonObject = JSONBig.parse(string);
  // let jsonObject = JSON.parse(string);
  return jsonObject;
}

// export function clampedArrayToString(clampedArray: Uint8ClampedArray) {
//   let string = new TextDecoder().decode(clampedArray);
//   return string;
// }

// export function stringToClampedArray(str: string) {
//   const buff = new TextEncoder().encode(str);
//   return new Uint8ClampedArray(buff);
// }

export function clampedArrayToBase64String(clampedArray: Uint8ClampedArray) {
  const binaryString = Array.from(clampedArray)
    .map((byte) => String.fromCharCode(byte))
    .join("");
  return btoa(binaryString);
}

export function base64StringToClampedArray(base64: string) {
  console.log("base64", base64);
  const binaryString = atob(base64);
  const bytes = new Uint8ClampedArray(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function stringToUint8ClampedArray(str: string): Uint8Array {
  const buffer = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    buffer[i] = str.charCodeAt(i);
  }
  return buffer;
}

export function base64ToUint8ClampedArray(base64: string): Uint8Array {
  const str = atob(base64);
  return stringToUint8ClampedArray(str);
}
