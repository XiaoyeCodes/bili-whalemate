/** Read gateway readiness without exposing account identifiers or credentials. */
const targets = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const expression = `(async()=>{
  const bridge=globalThis[Symbol.for('dsh-remembers.qq-bridge')];
  if(!bridge)return {ready:false};
  const owner=bridge.config.ownerOpenId;
  const record=await bridge.manager.getOrCreate('c2c',owner,owner,{scope:'c2c',targetId:owner});
  return {ready:bridge.ready,busy:bridge.busy,ownerAgentStatus:record.agent.status,
    textStyleLoaded:!!bridge.replyStyle,imagesPending:bridge.memeAuto?.pending.size,
    repliesPending:bridge.replyStyle?.queues.size};
})()`;
const result = await new Promise((resolve, reject) => {
  socket.onmessage = event => {
    const value = JSON.parse(event.data);
    if (value.id !== 1) return;
    if (value.error || value.result?.exceptionDetails) reject(Error('Gateway diagnostic failed'));
    else resolve(value.result.result.value);
  };
  socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
});
console.log(JSON.stringify(result));
if (process.argv.includes('--close-inspector')) socket.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate',
  params: { expression: 'setTimeout(()=>process.getBuiltinModule("inspector").close(),100);true' } }));
socket.close();
