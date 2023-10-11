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
