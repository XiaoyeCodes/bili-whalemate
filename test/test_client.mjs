/**
 * client.js 的离线验证。
 *
 * 不用真浏览器：mock 掉 window.__ModuleLoader__、react 和 ctx，
 * 确认三件事：
 *   1. 模块协议形状对（load({id, factory})，factory(require) 返回 exports）
 *   2. exports.apply / exports.inject 存在且 inject 含 slots
 *   3. apply(ctx) 注册六个设置段和网页表情投影，卸载时清理投影
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const source = fs.readFileSync(path.join(HERE, "..", "client.js"), "utf8");

// ---- mock 环境 -----------------------------------------------------------
let captured = null;

const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (init) => [typeof init === "function" ? init() : init, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (v) => ({ current: v }),
};

const sandbox = {
  window: {
    __ModuleLoader__: {
      load: (mod) => { captured = mod; },
    },
    localStorage: {
      _d: {},
      getItem(k) { return this._d[k] ?? null; },
      setItem(k, v) { this._d[k] = String(v); },
    },
    console,
    fetch: async () => { throw new Error("no network in test"); },
  },
  console,
  document: {
    createElement: () => ({ textContent: '', remove() {} }),
    head: { appendChild() {} },
  },
  fetch: async () => { throw new Error("no network in test"); },
  setTimeout,
  clearTimeout,
};
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "client.js" });

// ---- 1. 模块协议 ---------------------------------------------------------
assert.ok(captured, "没有调用 window.__ModuleLoader__.load");
assert.equal(captured.id, "bili-whalemate", "模块 id 不对");
assert.equal(typeof captured.factory, "function", "factory 不是函数");
console.log("  ✓ 模块协议：load({id, factory})，id=" + captured.id);

const requireMock = (name) => {
  if (name === "react") return fakeReact;
  throw new Error("unexpected require: " + name);
};
const exportsObj = captured.factory(requireMock);

// ---- 2. 导出面 -----------------------------------------------------------
assert.equal(typeof exportsObj.apply, "function", "exports.apply 缺失");
assert.ok(Array.isArray(exportsObj.inject), "exports.inject 缺失");
assert.ok(exportsObj.inject.includes("slots"), "inject 里没有 slots");
console.log("  ✓ 导出面：apply() + inject=[" + exportsObj.inject.join(", ") + "]");

// ---- 3. apply 注册设置段 -------------------------------------------------
const registered = [];
const cleanups = [];
const projections = [];
const ctx = {
  effect: fn => { const dispose = fn(); if (dispose) cleanups.push(dispose); },
  get: (name) => (name === "slots"
    ? {
        inject: (slotName, thunk) => {
          // 模拟 DSH：投影时才求值
          thunk();
        },
        register: (meta, component) => {
          registered.push({ meta, component });
          return { dispose() {} };
        },
      }
    : name === 'uiConversation' ? { events: { register(value) { projections.push(value); return () => projections.pop(); } } } : undefined),
};

exportsObj.apply(ctx);

const settings = registered.filter(row => row.meta.name === 'settings.section');
assert.equal(settings.length, 6, '设置段应包含服务、人设、图库、主动消息、B 站和记忆');
assert.equal(new Set(settings.map(row => row.meta.id)).size, 6);
assert.equal(projections.length, 1, '网页表情消息投影应注册一次');
const { meta, component } = settings.find(row => row.meta.id === 'dsh-remembers');
assert.equal(meta.name, "settings.section", "slot 名不对");
assert.equal(meta.id, "dsh-remembers", "段 id 不对");
assert.equal(typeof meta.label, "function", "label 应该是函数（投影时翻译）");
assert.equal(meta.label(), "记忆服务 API 设置", "label 文本不对");
assert.equal(typeof component, "function", "注册的不是组件函数");
console.log("  ✓ 注册设置段：name=" + meta.name + " id=" + meta.id + " label=" + JSON.stringify(meta.label()) + " order=" + meta.order);

// ---- 4. 组件能产出一棵元素树（不真的渲染） -------------------------------
// 用 fake React 调用一次组件函数，确认它不会立刻抛
const tree = component({});
assert.ok(tree && typeof tree === "object", "组件返回的不是元素");
const flat = JSON.stringify(tree);
assert.ok(flat.includes("正在读取配置"), "loading 态没出现");
console.log("  ✓ 组件可调用（首帧是「正在读取配置…」）");

// ---- 6. 安全约定：密钥不回显 ---------------------------------------------
assert.ok(source.includes("type: \"password\""), "密钥输入框应该是 password");
assert.ok(source.includes("留空保持原密钥"), "缺少「留空保持原密钥」的提示");
assert.ok(!/console\.log\([^)]*llm_key/.test(source), "不要在控制台打印密钥");
console.log("  ✓ 安全约定：password 输入框、留空保持原值、不打印密钥");

console.log("\n全部通过 ✅  client.js 的注册链路是对的");
for (const cleanup of cleanups.reverse()) cleanup();
assert.equal(projections.length, 0, '卸载时应清理消息投影');
