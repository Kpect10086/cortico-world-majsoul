/** 仅在专用游戏页面安装；协议数据通过本机 CDP 交给 World，不改写游戏消息。 */
export function installHook(bindingName: string): void {
  const scope = window as any;
  if (scope.__corticoMajsoul) { scope.__corticoMajsoul.bindingName = bindingName; scope.__corticoMajsoul.enabled = true; return; }
  const Native = scope.WebSocket as typeof WebSocket;
  const sockets = new Map<number, { socket: WebSocket; serial: number; nativeIds: Set<number>; ownIds: Set<number> }>();
  const hook: any = { bindingName, enabled: true };
  let nextSocket = 0, queue = Promise.resolve();
  const sendToHost = (packet: any) => {
    if (!hook.enabled) return;
    queue = queue.then(() => scope[hook.bindingName](packet)).catch(() => { hook.enabled = false; });
  };
  const bytesFor = (data: any): Uint8Array | null => data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
  const b64 = (bytes: Uint8Array) => {
    let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(text);
  };
  class GameSocket extends Native {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      if (!/\/(?:gateway|game-gateway(?:-zone)?)\/?$/.test(new URL(String(url), location.href).pathname)) return;
      const id = ++nextSocket, entry = { socket: this as WebSocket, serial: 0, nativeIds: new Set<number>(), ownIds: new Set<number>() };
      sockets.set(id, entry);
      this.addEventListener('open', () => sendToHost({ kind: 'open', socket: id }));
      this.addEventListener('close', () => { sockets.delete(id); sendToHost({ kind: 'close', socket: id }); });
      this.addEventListener('message', (event: MessageEvent) => {
        const capture = (bytes: Uint8Array) => {
          if (bytes.length > 2 * 1024 * 1024) { sendToHost({ kind: 'fault', socket: id }); return; }
          if (bytes[0] === 1) entry.serial++;
          sendToHost({ kind: 'frame', direction: 'in', socket: id, serial: entry.serial, bytes: b64(bytes) });
        };
        const bytes = bytesFor(event.data);
        if (bytes) {
          if (bytes[0] === 3 && entry.ownIds.has(bytes[1] | bytes[2] << 8)) event.stopImmediatePropagation();
          capture(bytes);
        } else if (event.data instanceof Blob) {
          // 注入请求只接受 ArrayBuffer socket，避免异步 Blob 无法阻止回执进入游戏客户端。
          sendToHost({ kind: 'fault', socket: id });
        }
      });
      const nativeSend = this.send.bind(this);
      this.send = (data: any) => {
        const bytes = bytesFor(data);
        if (bytes) {
          if (bytes[0] === 2) {
            entry.nativeIds.add(bytes[1] | bytes[2] << 8);
            const text = new TextDecoder().decode(bytes.subarray(3));
            if (text.includes('.lq.FastTest.inputOperation') || text.includes('.lq.FastTest.inputChiPengGang')) entry.serial++;
          }
          sendToHost({ kind: 'frame', direction: 'out', socket: id, serial: entry.serial, bytes: b64(bytes) });
        }
        nativeSend(data);
      };
    }
  }
  hook.send = (socketId: number, serial: number, encoded: string) => {
    if (!hook.enabled) return { sent: false, reason: '桥接已停止，请通过入口重新连接。' };
    const entry = sockets.get(socketId);
    if (!entry || entry.socket.readyState !== Native.OPEN) return { sent: false, reason: '游戏连接已关闭。' };
    if (entry.socket.binaryType !== 'arraybuffer') return { sent: false, reason: '当前客户端消息类型尚未支持。' };
    if (entry.serial !== serial) return { sent: false, reason: '游戏已经变化，请读取新状态。' };
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)), id = bytes[1] | bytes[2] << 8;
    if (entry.nativeIds.has(id) || entry.ownIds.has(id)) return { sent: false, reason: '请求序号冲突，请重新连接游戏。' };
    entry.ownIds.add(id); entry.serial++;
    Native.prototype.send.call(entry.socket, bytes);
    return { sent: true, serial: entry.serial };
  };
  scope.__corticoMajsoul = hook;
  scope.WebSocket = GameSocket;
}
