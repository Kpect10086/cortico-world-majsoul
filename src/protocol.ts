import { readFileSync } from 'node:fs';
import protobuf from 'protobufjs';

export const root = protobuf.Root.fromJSON(JSON.parse(readFileSync(new URL('../assets/liqi.json', import.meta.url), 'utf8')));
export type Data = Record<string, any>;
const wrapper = root.lookupType('lq.Wrapper');
export function decode(type: string, bytes: Uint8Array): Data {
  const schema = root.lookupType(type.replace(/^\./, ''));
  return schema.toObject(schema.decode(bytes), { defaults: true, bytes: Buffer, longs: Number });
}
export function encode(type: string, data: Data): Uint8Array {
  const schema = root.lookupType(type.replace(/^\./, ''));
  const error = schema.verify(data);
  if (error) throw new Error(`协议参数错误：${error}`);
  return schema.encode(schema.create(data)).finish();
}
export function envelope(type: number, id: number, name: string, data: Uint8Array): Buffer {
  const header = type === 1 ? Buffer.from([1]) : Buffer.from([type, id & 255, id >>> 8]);
  return Buffer.concat([header, wrapper.encode({ name, data }).finish()]);
}
export function unpack(bytes: Uint8Array): { type: number; id: number; name: string; data: Uint8Array } {
  if (bytes.length < 2 || ![1, 2, 3].includes(bytes[0])) throw new Error('无效牌局消息头。');
  const type = bytes[0], offset = type === 1 ? 1 : 3;
  if (bytes.length < offset) throw new Error('不完整牌局消息。');
  const message = wrapper.decode(bytes.subarray(offset)) as unknown as { name: string; data: Uint8Array };
  return { type, id: type === 1 ? 0 : bytes[1] | (bytes[2] << 8), name: message.name, data: message.data };
}
export function xorAction(bytes: Uint8Array): Uint8Array {
  // Liqi ActionPrototype 的公开编码；恢复消息里的 actions 已解码。
  const key = [132, 94, 78, 66, 57, 162, 31, 96, 28];
  return bytes.map((byte, index) => byte ^ (((bytes.length ^ 23) + index * 5 + key[index % key.length]) & 255));
}
export function action(data: Data, encoded: boolean): { name: string; step: number; data: Data } {
  if (typeof data.name !== 'string' || !data.name.startsWith('Action')) throw new Error('无效动作名称。');
  return { name: data.name, step: data.step, data: decode(`lq.${data.name}`, encoded ? xorAction(data.data) : data.data) };
}
export function request(method: string, id: number, data: Data): Buffer {
  const split = method.lastIndexOf('.');
  const service = root.lookupService(method.slice(1, split));
  const schema = service.methods[method.slice(split + 1)];
  if (!schema) throw new Error('未知牌局操作。');
  return envelope(2, id, method, encode(`lq.${schema.requestType}`, data));
}
export function response(method: string, bytes: Uint8Array): Data {
  const split = method.lastIndexOf('.');
  const schema = root.lookupService(method.slice(1, split)).methods[method.slice(split + 1)];
  return decode(`lq.${schema.responseType}`, bytes);
}
