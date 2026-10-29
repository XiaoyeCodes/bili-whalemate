/**
 * dsh-remembers 的设置页（浏览器半边）。
 *
 * 形态照着 DSH 自己的「模型 → 第三方模型提供商」那块：
 * 提供商下拉 → API 密钥 → 未配置时的提示 → 「自定义设置」折叠 → 取消 / 保存。
 *
 * 三点说明：
 *  1. 手写 React.createElement，不跑构建。DSH 的 client 插件就是
 *     `window.__ModuleLoader__.load({id, factory})` + `exports.apply/inject`。
 *  2. 只用原生元素加内联样式，不依赖 `@deepseek-ai/dsh-client-ui-primitives`
 *     是否被 seed —— 尺寸和配色尽量贴 DSH 的 `--dsw-*` 变量。
 *  3. 密钥只往服务端写，永不回显。服务端返回的是 `sk-03a…8719` 这种掩码，
 *     输入框留空 = 保持原值。
 */
window.__ModuleLoader__.load({
  id: "bili-whalemate",
  factory: (e) => {
    const module = { exports: {} };
    const exports = module.exports;   // CommonJS 语义：exports 是 module.exports 的别名
    try {
      const React = e("react");
      const h = React.createElement;

      // 公网访问时不能写死 127.0.0.1（那是用户自己的电脑）——
      // 按当前页面地址推导：主套 /mem，第二套 /lan/mem（caddy 反代到 8081/8082）
      function defaultServiceUrl() {
        try {
          const loc = window.location;
          const host = loc.hostname;
          if (host === "127.0.0.1" || host === "localhost") return "http://127.0.0.1:8080";
          const path = loc.pathname || "/";
          const base = path.startsWith("/lan/") ? "/lan/mem" : "/mem";
          const origin = loc.protocol + "//" + loc.host;
          return origin + base;
        } catch {
          return "http://127.0.0.1:8080";
        }
      }
      const URL_KEY = "dsh-remembers:serviceUrl";

      const PRESETS = {
        deepseek: {
          label: "DeepSeek",
          llm_base: "https://api.deepseek.com/v1",
          llm_model: "deepseek-flash",
          hint: "DeepSeek 官方 API。密钥在 platform.deepseek.com 申请。",
        },
        aliyun: {
          label: "阿里云百炼（含 embedding）",
          llm_base: "https://ws-bzw864scfibokwzf.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
          llm_model: "qwen-plus",
          embed_model: "qwen3.7-text-embedding-flash",
          hint: "阿里云一套 key 同时给对话模型和向量模型用。",
        },
        custom: {
          label: "自定义（OpenAI 兼容）",
          llm_base: "",
          llm_model: "",
          hint: "任何 OpenAI 兼容端点都可以，末尾记得带 /v1。",
        },
      };

      // -- 小工具 -----------------------------------------------------------

      function serviceUrl() {
        try {
          return window.localStorage.getItem(URL_KEY) || defaultServiceUrl();
        } catch {
          return defaultServiceUrl();
        }
      }

      function saveServiceUrl(url) {
        try {
          window.localStorage.setItem(URL_KEY, url);
        } catch {
          /* 隐私模式写不了，忽略 */
        }
      }

      async function call(path, init) {
        const res = await fetch(serviceUrl() + path, {
          ...(init || {}),
          headers: { "Content-Type": "application/json; charset=utf-8", ...(init && init.headers) },
        });
        const text = await res.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          throw new Error("服务返回的不是 JSON：" + text.slice(0, 120));
        }
        if (!res.ok) {
          throw new Error((data && (data.error || data.degraded)) || "HTTP " + res.status);
        }
        return data;
      }

      // -- 样式（对齐 DSH 的设置页观感） -------------------------------------

      const SETTINGS_CSS = `
        .dsh-remembers-settings button { transition: background .12s ease, border-color .12s ease, opacity .12s ease; }
        .dsh-remembers-settings button:disabled { opacity: .55; cursor: not-allowed; }
        .dsh-remembers-settings input, .dsh-remembers-settings select, .dsh-remembers-settings textarea { accent-color: color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)); }
        .dsh-remembers-settings input::placeholder, .dsh-remembers-settings textarea::placeholder { color: var(--dsw-alias-label-secondary); opacity: 1; }
        .dsh-remembers-settings :is(input, select, textarea, button, summary):focus-visible { outline: 2px solid color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) !important; outline-offset: 2px; }
      `;

      const S = {
        wrap: { color: "var(--dsw-alias-label-primary)", display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 },
        desc: { fontSize: 13, lineHeight: 1.6, color: "var(--dsw-alias-label-secondary)" },
        card: {
          border: "1px solid var(--dsw-alias-border-l2)",
          borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 14,
          background: "var(--dsw-alias-settings-card-fill)",
        },
        field: { display: "flex", flexDirection: "column", gap: 6 },
        label: { fontSize: 13, fontWeight: 500, color: "var(--dsw-alias-label-primary)" },
        input: {
          width: "100%", boxSizing: "border-box", padding: "9px 12px", fontSize: 13,
          borderRadius: 8, border: "1px solid var(--dsw-alias-border-l4)",
          background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)",
          outline: "none", fontFamily: "inherit",
        },
        select: {
          width: "100%", boxSizing: "border-box", padding: "9px 12px", fontSize: 13,
          borderRadius: 8, border: "1px solid var(--dsw-alias-border-l4)",
          background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)",
        },
        hint: { fontSize: 12, lineHeight: 1.6, color: "color-mix(in srgb, var(--dsw-alias-state-warn-label) 60%, var(--dsw-alias-label-primary))" },
        muted: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" },
        row: { display: "flex", gap: 10, alignItems: "center" },
        footer: { display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 4 },
        btn: (primary) => ({
          padding: "8px 18px", fontSize: 13, borderRadius: 8, cursor: "pointer",
          border: primary ? "1px solid transparent" : "1px solid var(--dsw-alias-border-l4)",
          background: primary ? "var(--dsw-alias-button-primary-fill)" : "var(--dsw-alias-bg-layer-1)",
          color: primary ? "var(--dsw-alias-label-primary-foreground)" : "var(--dsw-alias-label-primary)",
          fontFamily: "inherit",
        }),
        disclosure: {
          display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
          fontSize: 13, color: "var(--dsw-alias-label-secondary)",
          background: "none", border: "none", padding: 0, fontFamily: "inherit",
        },
        notice: (kind) => ({
          fontSize: 12, lineHeight: 1.6, padding: "8px 12px", borderRadius: 8,
          background: kind === "ok" ? "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, var(--dsw-alias-label-primary)) 12%, transparent)" : "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, var(--dsw-alias-label-primary)) 12%, transparent)",
          color: kind === "ok" ? "color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, var(--dsw-alias-label-primary))" : "color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, var(--dsw-alias-label-primary))",
        }),
        badge: (on) => ({
          display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12,
          color: on ? "color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, var(--dsw-alias-label-primary))" : "color-mix(in srgb, var(--dsw-alias-state-warn-label) 60%, var(--dsw-alias-label-primary))",
        }),
        dot: (on) => ({
          width: 7, height: 7, borderRadius: "50%",
          background: on ? "color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, var(--dsw-alias-label-primary))" : "color-mix(in srgb, var(--dsw-alias-state-warn-label) 60%, var(--dsw-alias-label-primary))", display: "inline-block",
        }),
      };

      // -- 组件 -------------------------------------------------------------

      function Field(props) {
        return h("div", { style: S.field },
          h("label", { style: S.label }, props.label,
            props.optional ? h("span", { style: { ...S.muted, marginLeft: 6 } }, "（可选）") : null),
          props.children,
          props.hint ? h("div", { style: S.hint }, props.hint) : null,
        );
      }

      /** 概率按 1% 调整；拖动结束、键盘松开或失焦时提交，0 保留为独立关闭状态。 */
      function ProbabilitySlider({ id, label, value, disabled, offLabel, onChange, onCommit }) {
        const lastEnabled = React.useRef(0.2);
        const dirty = React.useRef(false);
        React.useEffect(() => {
          if (value > 0) lastEnabled.current = value;
        }, [value]);
        const enabled = value !== null && value > 0;
        const percent = Math.round((enabled ? value : lastEnabled.current) * 100);
        const commit = (ev) => {
          if (!dirty.current) return;
          dirty.current = false;
          void onCommit(Number(ev.currentTarget.value) / 100);
        };
        return h("div", { style: { ...S.field, gap: 8, minWidth: 0 } },
          h("div", { style: { ...S.row, flexWrap: "wrap" } },
            h("label", { htmlFor: id, style: { ...S.label, marginRight: "auto" } }, label),
            h("output", { htmlFor: id, style: { ...S.label, color: "var(--dsw-alias-link)", fontVariantNumeric: "tabular-nums" } },
              enabled ? percent + "%" : offLabel),
            h("button", {
              type: "button", disabled, "aria-label": label + (enabled ? "：关闭" : "：开启"),
              style: { ...S.btn(false), padding: "4px 10px", fontSize: 12 },
              onClick: () => {
                dirty.current = false;
                const next = enabled ? 0 : lastEnabled.current;
                onChange(next);
                void onCommit(next);
              },
            }, enabled ? offLabel : "开启"),
          ),
          h("input", {
            id, type: "range", min: 1, max: 100, step: 1, value: percent,
            disabled: disabled || !enabled, "aria-valuetext": enabled ? percent + "%" : offLabel,
            style: { width: "100%", minWidth: 0, height: 28, margin: 0, cursor: disabled || !enabled ? "not-allowed" : "pointer" },
            onChange: (ev) => {
              dirty.current = true;
              onChange(Number(ev.currentTarget.value) / 100);
            },
            onPointerDown: (ev) => ev.currentTarget.setPointerCapture(ev.pointerId),
            onPointerUp: commit, onPointerCancel: commit, onKeyUp: commit, onBlur: commit,
          }),
          h("div", { style: { ...S.row, justifyContent: "space-between", ...S.muted } },
            h("span", null, "1%"), h("span", null, "100%")),
        );
      }

      function MemeChatNode({ node }) {
        const [imageFailed, setImageFailed] = React.useState(false);
        const data = node.data.data;
        if (data.status === "failed" || imageFailed) {
          return h("div", { style: S.notice("error") }, imageFailed ? "表情包加载失败，请检查记忆服务连接" : data.reason);
        }
        const url = serviceUrl() + "/memes/file/" + encodeURIComponent(data.file);
        return h("div", { style: { padding: "4px 0", maxWidth: "100%" } },
          h("a", { href: url, target: "_blank", rel: "noreferrer", "aria-label": "查看表情包" },
            h("img", { src: url, alt: "表情包", loading: "lazy", onError: () => setImageFailed(true),
              style: { display: "block", width: 180, height: 180, maxWidth: "100%", objectFit: "contain", borderRadius: 8 } })),
        );
      }

      function SettingsSection() {
        const [loading, setLoading] = React.useState(true);
        const [error, setError] = React.useState("");
        const [current, setCurrent] = React.useState(null);
        const [status, setStatus] = React.useState(null);
        const [configPath, setConfigPath] = React.useState("");
        const [advanced, setAdvanced] = React.useState(false);
        const [saving, setSaving] = React.useState(false);
        const [notice, setNotice] = React.useState(null);
        const [endpoint, setEndpoint] = React.useState(serviceUrl());
        const [pubStatus, setPubStatus] = React.useState(null);
        const [pubMsg, setPubMsg] = React.useState(null);
        const [pubPort, setPubPort] = React.useState("28582");
        const [draft, setDraft] = React.useState({
          provider: "deepseek",
          llm_key: "",
          llm_base: PRESETS.deepseek.llm_base,
          llm_model: PRESETS.deepseek.llm_model,
          embed_base: "",
          embed_model: "",
          embed_key: "",
          extract: true,
          surprisal_threshold: 0.35,
        });

        const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

        const load = React.useCallback(async () => {
          setLoading(true);
          setError("");
          try {
            const data = await call("/config");
            setCurrent(data.current);
            setStatus(data.status);
            setConfigPath(data.path || "");
            setNotice(null);
            setDraft((d) => ({
              ...d,
              llm_base: data.current.llm_base || "",
              llm_model: data.current.llm_model || "",
              llm_key: "",
              embed_base: data.current.embed_base || "",
              embed_model: data.current.embed_model || "",
              embed_key: "",
              extract: !!data.current.extract,
              surprisal_threshold: data.current.surprisal_threshold,
            }));
          } catch (err) {
            setError(
              "连不上记忆服务（" + serviceUrl() + "）。先确认它在跑：`systemctl status dsh-remembers` 或 `python server.py`。",
            );
          } finally {
            setLoading(false);
          }
        }, []);

        React.useEffect(() => { load(); }, [load]);

        const chooseProvider = (key) => {
          const p = PRESETS[key];
          if (p === undefined) return;
          set({ provider: key, llm_base: p.llm_base, llm_model: p.llm_model });
        };


        const removeAction = (texts, enabled, i, setTexts, setEnabled) => {
          const newTexts = texts.filter((_, j) => j !== i);
          const newEnabled = {};
          newTexts.forEach((_, j) => {
            const srcIdx = j < i ? j : j + 1;
            newEnabled[j] = enabled[srcIdx] !== false;
          });
          setTexts(newTexts);
          setEnabled(newEnabled);
        };

        const save = async () => {
          setSaving(true);
          setNotice(null);
          try {
            saveServiceUrl(endpoint);
            const body = {
              llm_base: draft.llm_base,
              llm_model: draft.llm_model,
              embed_base: draft.embed_base,
              embed_model: draft.embed_model,
              extract: !!draft.extract,
              surprisal_threshold: Number(draft.surprisal_threshold),
            };
            // 留空 = 保持原密钥；服务端也会忽略掩码回传
            if (draft.llm_key.trim()) body.llm_key = draft.llm_key.trim();
            if (draft.embed_key.trim()) body.embed_key = draft.embed_key.trim();
            const res = await call("/config", { method: "POST", body: JSON.stringify(body) });
            setStatus(res.status);
            setNotice({ kind: "ok", text: "已保存，立即生效（不用重启）" });
            await load();
          } catch (err) {
            setNotice({ kind: "error", text: "保存失败：" + (err && err.message ? err.message : String(err)) });
          } finally {
            setSaving(false);
          }
        };

        const cancel = () => {
          setDraft((d) => ({
            ...d,
            llm_key: "",
            embed_key: "",
            llm_base: current ? current.llm_base : d.llm_base,
            llm_model: current ? current.llm_model : d.llm_model,
            extract: current ? !!current.extract : d.extract,
            surprisal_threshold: current ? current.surprisal_threshold : d.surprisal_threshold,
          }));
          setNotice(null);
        };

        if (loading) {
          return h("div", { className: "dsh-remembers-settings", style: S.wrap }, h("div", { style: S.muted }, "正在读取配置…"));
        }

        const llmReady = status ? status.llm_enabled : false;
        const embedReady = status ? status.embedding_enabled : false;
        const extractOn = status ? status.extract_enabled : false;
        const preset = PRESETS[draft.provider] || PRESETS.custom;

        return h("div", { className: "dsh-remembers-settings", style: S.wrap },

          // 状态行
          h("div", { style: S.row },
            h("span", { style: S.badge(llmReady) }, h("span", { style: S.dot(llmReady) }), "对话模型"),
            h("span", { style: S.badge(embedReady) }, h("span", { style: S.dot(embedReady) }), "向量模型"),
            h("span", { style: S.badge(extractOn) }, h("span", { style: S.dot(extractOn) }), "自动抽取"),
            status && status.llm_model ? h("span", { style: S.muted }, status.llm_model) : null,
          ),

          h("div", { style: S.desc },
            "记忆服务要用一个对话模型来抽取事实、一个向量模型来算语义相似度。",
            "填一次就能一直用，密钥只存在服务端。",
          ),

          error ? h("div", { style: S.notice("error") }, error) : null,

          h("div", { style: S.card },

            h(Field, { label: "服务地址" },
              h("input", {
                style: S.input,
                value: endpoint,
                spellCheck: false,
                onChange: (ev) => setEndpoint(ev.target.value),
              }),
              h("div", { style: S.muted },
                "记忆服务地址会按当前页面自动推导（主套 /mem，第二套 /lan/mem）。本机开发默认 127.0.0.1:8080。"),
            ),

            h(Field, { label: "提供商" },
              h("select", {
                style: S.select,
                value: draft.provider,
                onChange: (ev) => chooseProvider(ev.target.value),
              }, Object.keys(PRESETS).map((k) => h("option", { key: k, value: k }, PRESETS[k].label))),
            ),

            h(Field, {
              label: "API 密钥",
              hint: current && current.llm_key_set
                ? "当前： " + current.llm_key_masked + "　留空则保持原值"
                : "还没配置。填好后点保存。",
            },
              h("input", {
                style: S.input,
                type: "password",
                value: draft.llm_key,
                placeholder: current && current.llm_key_set ? "留空保持原密钥" : "sk-...",
                spellCheck: false,
                autoComplete: "off",
                onChange: (ev) => set({ llm_key: ev.target.value }),
              }),
            ),

            !llmReady && !error
              ? h("div", { style: S.hint }, preset.hint)
              : null,

            // 「自定义设置」折叠
            h("div", null,
              h("button", {
                type: "button",
                style: S.disclosure,
                onClick: () => setAdvanced((v) => !v),
              }, h("span", null, advanced ? "▾" : "▸"), "自定义设置"),

              advanced
                ? h("div", { style: { display: "flex", flexDirection: "column", gap: 14, marginTop: 14 } },

                    h(Field, { label: "对话模型 Base URL", optional: true },
                      h("input", {
                        style: S.input, value: draft.llm_base, spellCheck: false,
                        onChange: (ev) => set({ llm_base: ev.target.value }),
                      }),
                    ),

                    h(Field, { label: "对话模型名", optional: true },
                      h("input", {
                        style: S.input, value: draft.llm_model, spellCheck: false,
                        onChange: (ev) => set({ llm_model: ev.target.value }),
                      }),
                    ),

                    h(Field, {
                      label: "向量模型 Base URL", optional: true,
                      hint: "和对话模型不是同一家时才需要单独填；阿里云那套两边可以共用同一个 key。",
                    },
                      h("input", {
                        style: S.input, value: draft.embed_base, spellCheck: false,
                        placeholder: "留空 = 和对话模型同源",
                        onChange: (ev) => set({ embed_base: ev.target.value }),
                      }),
                    ),

                    h(Field, { label: "向量模型名", optional: true },
                      h("input", {
                        style: S.input, value: draft.embed_model, spellCheck: false,
                        placeholder: "qwen3.7-text-embedding-flash",
                        onChange: (ev) => set({ embed_model: ev.target.value }),
                      }),
                    ),

                    h(Field, {
                      label: "向量模型 API 密钥", optional: true,
                      hint: current && current.embed_key_set
                        ? "当前： " + current.embed_key_masked + "　留空则保持原值"
                        : "留空 = 和对话模型用同一个密钥",
                    },
                      h("input", {
                        style: S.input, type: "password", value: draft.embed_key,
                        autoComplete: "off", spellCheck: false,
                        placeholder: current && current.embed_key_set ? "留空保持原密钥" : "留空 = 同上",
                        onChange: (ev) => set({ embed_key: ev.target.value }),
                      }),
                    ),

                  )
                : null,
            ),
          ),

          h("div", {
            style: {
              position: "fixed", right: 24, top: "50%", transform: "translateY(-50%)",
              display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8,
              background: "var(--dsw-alias-bg-layer-1)", padding: "12px 16px", borderRadius: 12,
              border: 0, boxShadow: "var(--dsw-elevation-panel)", zIndex: 9999,
              minWidth: 140,
            },
          },
            notice ? h("div", { style: { fontSize: 12, color: notice.kind === "error" ? "color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, var(--dsw-alias-label-primary))" : "color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, var(--dsw-alias-label-primary))", textAlign: "center" } }, notice.text) : null,
            h("button", { type: "button", style: S.btn(true), onClick: save, disabled: saving },
              saving ? "保存中…" : "保存"),
          ),

          configPath
            ? h("div", { style: S.muted }, "配置文件：" + configPath + "（权限 600，密钥只在这里）")
            : null,
        );
      }

      // -- 人格设定（二合一里的「人」那一半） --------------------------------

      // ---------------------------------------------------------------------
      // 鲸鱼日记本：她现在在干嘛 / 心情 / 记得什么
      // ---------------------------------------------------------------------
      function DiarySection() {
        const [st, setSt] = React.useState(null);
        const [viewHour, setViewHour] = React.useState(null);
        const [diaries, setDiaries] = React.useState([]);
        const [activities, setActivities] = React.useState([]);
        const [diaryDate, setDiaryDate] = React.useState("");
        const [persona, setPersona] = React.useState(null);
        const [memories, setMemories] = React.useState([]);
        const [taskList, setTaskList] = React.useState([]);
        const [noteList, setNoteList] = React.useState([]);
        const [loading, setLoading] = React.useState(true);
        const [error, setError] = React.useState(null);

        const load = async () => {
          setLoading(true);
          setError(null);
          try {
            const s = await call("/state" + (viewHour === null ? "" : "?hour=" + viewHour));
            const p = await call("/persona");
            let m = [];
            try {
              m = await call("/profile");
            } catch {
              m = [];
            }
            let ds = [];
            try {
              ds = await call("/diary");
            } catch {
              ds = [];
            }
            setDiaries(Array.isArray(ds) ? ds : []);
            let acts = [];
            try {
              acts = await call("/activity");
            } catch {
              acts = [];
            }
            setActivities(Array.isArray(acts) ? acts : [])
            try { setTaskList(await call("/tasks") || []); } catch { setTaskList([]); }
            try { setNoteList(await call("/notes") || []); } catch { setNoteList([]); }
            setSt(s);
            setPersona(p);
            setMemories(Array.isArray(m) ? m : []);
          } catch (err) {
            setError(err && err.message ? err.message : String(err));
          } finally {
            setLoading(false);
          }
        };

        React.useEffect(() => {
          void load();
        }, [viewHour]);

        if (loading && !st) {
          return h("div", { className: "dsh-remembers-settings", style: S.wrap }, h("div", { style: S.muted }, "正在读鲸鱼日记本…"));
        }

        const MOOD = { happy: "开心", tired: "累", annoyed: "烦", bored: "无聊", normal: "平常" };
        const mood = st ? (MOOD[st.mood] || "平常") : "?";
        const intimacy = st ? Math.round(Number(st.intimacy) || 0) : 0;
        const stage = st && st.stage ? st.stage.name : "?";
        const stageHint = st && st.stage ? st.stage.hint : "";
        const activity = st && st.activity ? st.activity : "发呆";
        const weather = st && st.weather ? st.weather : "不知道";
        const gameScore = st ? Number(st.game_score) || 0 : 0;
        const gamePlays = st ? Number(st.game_plays) || 0 : 0;

        return h("div", { className: "dsh-remembers-settings", style: S.wrap },

          h("div", { style: S.desc },
            "她现在在干嘛、心情怎么样、还记得什么——实时从记忆服务读。",
          ),

          h("div", { style: S.row },
            h("button", { style: S.btn(false), onClick: () => void load() }, "刷新"),
            h("span", { style: S.muted }, "看看她几点：" ),
            h("select", {
              style: { ...S.select, width: 120 },
              value: viewHour === null ? "" : String(viewHour),
              onChange: (ev) => {
                const v = ev.target.value;
                setViewHour(v === "" ? null : Number(v));
              },
            },
              h("option", { value: "" }, "现在"),
              Array.from({ length: 24 }).map((_, hr) =>
                h("option", { key: hr, value: String(hr) }, (hr < 10 ? "0" + hr : hr) + ":00")),
            ),
            st ? h("span", { style: S.muted }, "最后互动：" + (st.last_interaction ? new Date(st.last_interaction * 1000).toLocaleString() : "还没聊过")) : null,
          ),

          error ? h("div", { style: S.notice("error") }, "读取失败：" + error) : null,

          h("div", { style: S.card },
            h("div", { style: S.label }, "她现在"),
            h("div", { style: { display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13 } },
              h("span", null, "心情：" + mood),
              h("span", null, "亲密度：" + intimacy + "/1000"),
              h("span", null, "阶段：" + stage),
            ),
            h("div", { style: S.muted }, "在干嘛：" + activity),
            h("div", { style: S.muted }, "外面：" + weather),
            h("div", { style: S.muted }, "小游戏：《像素鲸鱼吃豆子》" + gameScore + " 分（玩了 " + gamePlays + " 次）"),
            stageHint ? h("div", { style: S.muted }, "这个阶段的样子：" + stageHint) : null,
          ),

          h("div", { style: S.card },
            h("div", { style: S.label }, "她对自己的认知"),
            h("div", { style: S.desc },
              persona && persona.self_model ? persona.self_model : "还没有——聊够 30 轮她会开始写。"),
          ),

          h("div", { style: S.card },
            h("div", { style: S.label }, "今天的时间线（她真的做了什么）"),
            activities.length === 0
              ? h("div", { style: S.muted }, "还没有记录——聊一句或等她主动找你。")
              : h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
                  activities.slice(0, 30).map((a, i) => h("div", { key: i, style: S.muted },
                    new Date(a.ts * 1000).toLocaleTimeString() + " · " + (a.kind === "chat" ? "聊天" : a.kind === "game" ? "玩游戏" : a.kind === "proactive" ? "主动找你" : a.kind === "bili" ? "B 站" : a.kind === "habit" ? "习惯" : a.kind) + " · " + String(a.detail || "").slice(0, 60)))),
          ),

          h("div", { style: S.card },
            h("div", { style: S.label }, "她给老大派的任务"),
            taskList.length === 0
              ? h("div", { style: S.muted }, "还没有任务——她说派的时候会出现在这里。")
              : h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
                  taskList.slice(0, 10).map((tk) => h("div", { key: tk.id, style: S.row },
                    h("span", { style: { fontSize: 13 } }, (tk.done ? "✓ " : "○ ") + tk.text),
                    h("span", { style: S.muted }, "(" + tk.points + " 分)"),
                  ))),
          ),

          h("div", { style: S.card },
            h("div", { style: S.label }, "共享便签"),
            noteList.length === 0
              ? h("div", { style: S.muted }, "还没有便签。")
              : h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
                  noteList.slice(0, 10).map((nt) => h("div", { key: nt.id, style: S.muted },
                    nt.date + " · " + (nt.author || "某人") + "：" + nt.text))),
          ),


          h("div", { style: S.card },
            h("div", { style: S.row },
              h("div", { style: S.label }, "日记本（按天，每天一篇）"),
              diaries.length > 0
                ? h("select", {
                    style: { ...S.select, width: 160, marginLeft: "auto" },
                    value: diaryDate,
                    onChange: (ev) => setDiaryDate(ev.target.value),
                  },
                    h("option", { value: "" }, "全部"),
                    diaries.map((d) => h("option", { key: d.date, value: d.date }, d.date)))
                : null,
            ),
            diaries.length === 0
              ? h("div", { style: S.muted }, "还没有日记——每天 23:00 她会写一篇。")
              : h("div", { style: { display: "flex", flexDirection: "column", gap: 12, marginTop: 8 } },
                  diaries.filter((d) => !diaryDate || d.date === diaryDate).map((d, i) => h("div", { key: i },
                    h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)", marginBottom: 4 } }, d.date),
                    h("div", { style: S.desc }, d.text)))),
          ),

          h("div", { style: S.card },
            h("div", { style: S.label }, "她记得的事（最近 12 条）"),
            memories.length === 0
              ? h("div", { style: S.muted }, "还没有记忆——先聊几句。")
              : h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
                  memories.slice(0, 12).map((m, i) => h("div", { key: i, style: S.muted },
                    "[" + (m.tier || "?") + "] " + String(m.text || m.summary || "").slice(0, 90)))),
          ),

        );
      }

      // ---------------------------------------------------------------------
      // 表情包：列表 + 上传（自动识别）+ 删除
      // ---------------------------------------------------------------------
      function MemeSection() {
        const [list, setList] = React.useState([]);
        const [busy, setBusy] = React.useState(false);
        const [msg, setMsg] = React.useState(null);
        const [editing, setEditing] = React.useState(null);
        const [pack, setPack] = React.useState("");
        const [packs, setPacks] = React.useState([]);
        const [view, setView] = React.useState("list");
        const [newPack, setNewPack] = React.useState(null);
        const [editPack, setEditPack] = React.useState(null);
        // 概率以 0–1 保存，0 表示关闭。
        const [memeRate, setMemeRate] = React.useState(null);
        // 文字颜 / emoji：总开关默认关闭，关着就完全不干预
        const [textStyleEnabled, setTextStyleEnabled] = React.useState(false);
        const [kaomojiRate, setKaomojiRate] = React.useState(0.2);
        const [emojiRate, setEmojiRate] = React.useState(0.2);
        const [deliveryStatus, setDeliveryStatus] = React.useState({});
        const saveQueue = React.useRef(Promise.resolve());
        const loadDeliveryStatus = async () => {
          try { setDeliveryStatus(await call("/memes/delivery-status")); }
          catch (err) { setDeliveryStatus({ service: { status: "failed", reason: "配图状态读取失败：" + err.message } }); }
        };

        const loadRate = async () => {
          try {
            const r = await call("/proactive");
            const v = Number(r && r.memeRate);
            setMemeRate(Number.isFinite(v) ? v : 0.2);
            setTextStyleEnabled(Boolean(r && r.textStyleEnabled));
            const k = Number(r && r.kaomojiRate);
            setKaomojiRate(Number.isFinite(k) ? k : 0.2);
            const e = Number(r && r.emojiRate);
            setEmojiRate(Number.isFinite(e) ? e : 0.2);
          } catch (err) {
            setMsg("读取概率失败：" + (err && err.message ? err.message : String(err)) + "，请刷新重试");
          }
        };

        const postProactive = (body, note) => {
          const save = async () => {
            try {
              await call("/proactive", { method: "POST", body: JSON.stringify(body) });
              if (note) setMsg(note);
            } catch (err) {
              setMsg("保存失败：" + (err && err.message ? err.message : String(err)));
            }
          };
          saveQueue.current = saveQueue.current.then(save);
          return saveQueue.current;
        };

        const saveRate = async (v) => {
          await postProactive({ memeRate: v }, "表情包概率已设为：" + (v <= 0 ? "不发" : Math.round(v * 100) + "%"));
        };

        const startEdit = (m) => {
          setEditing({ file: m.file, emotion: m.emotion || "", caption: m.caption || "", keywords: m.keywords || "" });
        };

        const saveEdit = async () => {
          if (!editing) return;
          try {
            await call("/memes", { method: "POST", body: JSON.stringify(editing) });
            setMsg("已保存：" + editing.file);
            setEditing(null);
            await load();
          } catch (err) {
            setMsg("保存失败：" + (err && err.message ? err.message : String(err)));
          }
        };

        const load = async () => {
          try {
            const url = "/memes?limit=300" + (pack ? "&pack=" + encodeURIComponent(pack) : "");
            const l = await call(url);
            setList(Array.isArray(l) ? l : []);
          } catch {
            setList([]);
          }
        };

        const loadPacks = async () => {
          try {
            const r = await call("/memes/packs");
            setPacks(Array.isArray(r) ? r : []);
          } catch {
            setPacks([]);
          }
        };

        React.useEffect(() => {
          void loadPacks();
          void loadRate();
          void loadDeliveryStatus();
        }, []);

        React.useEffect(() => {
          if (view === "detail") void load();
        }, [pack, view]);

        const upload = (ev) => {
          const file = ev.target.files && ev.target.files[0];
          if (!file) return;
          setBusy(true);
          setMsg(null);
          const reader = new FileReader();
          reader.onload = async () => {
            try {
              const res = await call("/memes/upload", {
                method: "POST",
                body: JSON.stringify({ filename: file.name, data: reader.result }),
              });
              setMsg("已上传：" + (res && res.caption ? res.caption : file.name));
              await load();
            } catch (err) {
              setMsg("失败：" + (err && err.message ? err.message : String(err)));
            } finally {
              setBusy(false);
            }
          };
          reader.readAsDataURL(file);
        };

        const remove = async (f) => {
          if (!window.confirm("删掉 " + f + "？")) return;
          try {
            await call("/memes/delete", { method: "POST", body: JSON.stringify({ file: f }) });
            await load();
          } catch {
            /* ignore */
          }
        };

        const EMO = { happy: "开心", angry: "生气", sad: "难过", shy: "害羞", confused: "疑惑", daily: "日常" };

        const addPack = async () => {
          if (!newPack || !newPack.id.trim()) return;
          setBusy(true);
          try {
            await call("/memes/packs/add", {
              method: "POST",
              body: JSON.stringify({ id: newPack.id.trim(), name: (newPack.name || newPack.id).trim() }),
            });
            setNewPack(null);
            await loadPacks();
          } catch (err) {
            setMsg("新建失败：" + (err && err.message ? err.message : String(err)));
          } finally {
            setBusy(false);
          }
        };

        // ===== 图库列表视图 =====
        if (view === "list") {
          return h("div", { className: "dsh-remembers-settings", style: S.wrap },
            h("div", { style: S.desc },
              "网页、QQ 与 B 站共用这些图片。B 站顶层评论可附图，主人私信可发图片；楼中楼因平台限制仅回复文字，不放图片链接。不会定时轮播。",
            ),
            h("div", { style: { ...S.card, marginBottom: 14 } },
              h(ProbabilitySlider, {
                id: "meme-probability", label: "发表情包的概率", value: memeRate,
                disabled: memeRate === null, offLabel: "不发", onChange: setMemeRate, onCommit: saveRate,
              }),
              h("div", { style: S.muted }, "拖动滑动条调整概率（1%–100%），松开后自动保存"),
              h("div", { style: { ...S.muted, fontSize: 12 } },
                "网页、QQ 与 B 站共用此概率。100% 时每条普通回复都优先配图，也可选微笑、点头、问号等通用表情。严肃内容、禁用图片或平台发送限制仍可能使本轮只发文字。"),
              Object.keys(deliveryStatus).length ? h("div", { style: { ...S.field, borderTop: "1px solid var(--dsw-alias-border-l4)", paddingTop: 10 } },
                h("div", { style: S.label }, "最近配图结果"),
                Object.entries(deliveryStatus).map(([channel, outcome]) => h("div", { key: channel, style: { ...S.muted, overflowWrap: "anywhere" } },
                  ({ qq: "QQ", web: "网页", bili: "B 站", service: "服务" }[channel] || channel) + "：" + outcome.reason)),
              ) : null,
            ),
            // ---- 文字颜 / emoji（总开关 + 两个频率）----
            h("div", { style: { ...S.card, marginBottom: 14 } },
              h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 } },
                h("div", { style: S.label }, "文字颜 / 表情符号"),
                h("button", {
                  type: "button", role: "switch", "aria-checked": textStyleEnabled,
                  "aria-label": "文字颜 / 表情符号", disabled: memeRate === null,
                  onClick: () => {
                    const next = !textStyleEnabled;
                    setTextStyleEnabled(next);
                    void postProactive(
                      { textStyleEnabled: next },
                      "文字颜 / 表情符号已" + (next ? "开启" : "关闭"),
                    );
                  },
                  style: {
                    display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                    fontFamily: "inherit", flexShrink: 0,
                    padding: "4px 10px", borderRadius: 999,
                    border: textStyleEnabled ? "1px solid color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "1px solid var(--dsw-alias-border-l4)",
                    background: textStyleEnabled ? "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))" : "var(--dsw-alias-bg-layer-1)",
                    transition: "border-color .15s, background .15s",
                  },
                },
                  h("div", {
                    style: {
                      width: 14, height: 14, borderRadius: 999, boxSizing: "border-box",
                      border: textStyleEnabled ? "4px solid color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "1px solid var(--dsw-alias-border-l4)",
                      background: "var(--dsw-alias-bg-layer-1)",
                    },
                  }),
                  h("span", { style: { fontSize: 12, color: textStyleEnabled ? "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "var(--dsw-alias-label-secondary)" } },
                    textStyleEnabled ? "已开启" : "已关闭"),
                ),
              ),
              h("div", { style: { ...S.muted, fontSize: 12, marginBottom: 12 } },
                "默认关闭，关闭时沿用人物卡。QQ、B 站开启后，每条完整回复独立抽签添加颜文字和 emoji；代码、引用和链接保留原文。"),
              h("div", {
                style: {
                  opacity: textStyleEnabled ? 1 : 0.4,
                  display: "flex", flexDirection: "column", gap: 16,
                  transition: "opacity .15s",
                },
              },
                h(ProbabilitySlider, {
                  id: "kaomoji-probability", label: "文字颜 (￣▽￣)", value: kaomojiRate,
                  disabled: !textStyleEnabled || memeRate === null, offLabel: "不用", onChange: setKaomojiRate,
                  onCommit: (v) => postProactive({ kaomojiRate: v }, "文字颜：" + (v <= 0 ? "不用" : Math.round(v * 100) + "%")),
                }),
                h(ProbabilitySlider, {
                  id: "emoji-probability", label: "表情符号 😊", value: emojiRate,
                  disabled: !textStyleEnabled || memeRate === null, offLabel: "不用", onChange: setEmojiRate,
                  onCommit: (v) => postProactive({ emojiRate: v }, "表情符号：" + (v <= 0 ? "不用" : Math.round(v * 100) + "%")),
                }),
              ),
            ),
            h("div", { style: { display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" } },
              h("button", {
                style: { ...S.btn(true), padding: "6px 14px", fontSize: 13 },
                onClick: () => setNewPack({ id: "", name: "" }),
              }, "新建图库包"),
              h("button", {
                style: { ...S.btn(false), padding: "6px 14px", fontSize: 13 },
                onClick: () => { void loadPacks(); void loadRate(); void loadDeliveryStatus(); },
              }, "刷新"),
            ),
            msg ? h("div", { style: S.muted }, msg) : null,
            h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 12 } },
              packs.map((pk) =>
                h("div", {
                  key: pk.pack,
                  onClick: () => { setPack(pk.pack === "all" ? "" : pk.pack); setView("detail"); },
                  onMouseEnter: (e) => {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = "0 5px 14px var(--dsw-alias-border-l4)";
                  },
                  onMouseLeave: (e) => {
                    e.currentTarget.style.transform = "";
                    e.currentTarget.style.boxShadow = "";
                  },
                  style: {
                    border: "1px solid var(--dsw-alias-border-l2)",
                    borderRadius: 12, overflow: "hidden", cursor: "pointer",
                    background: "var(--dsw-alias-bg-layer-1)",
                    display: "flex", flexDirection: "row", alignItems: "center", gap: 12, padding: 12,
                    transition: "transform .12s ease, box-shadow .12s ease",
                  },
                },
                  h("div", {
                    style: {
                      flex: "none", width: 96, height: 96, borderRadius: 10,
                      backgroundColor: "var(--dsw-alias-bg-module-platform)",
                      backgroundImage: pk.cover
                        ? "url(" + serviceUrl() + "/memes/file/" + encodeURIComponent(pk.cover) + ")"
                        : "none",
                      backgroundSize: "cover",
                      backgroundPosition: "center 28%",
                      backgroundRepeat: "no-repeat",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 22,
                      color: "var(--dsw-alias-label-secondary)",
                    },
                  }, pk.cover ? null : (pk.pack === "all" ? "🗂️" : "🐟")),
                  h("div", { style: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 } },
                    h("div", { style: { fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, pk.name),
                    h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } }, pk.count + " 张"),
                  ),
                ),
              ),
            ),
            newPack ? h("div", {
              style: { position: "fixed", inset: 0, background: "var(--dsw-alias-bg-mask-1)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 },
              onClick: (ev) => { if (ev.target === ev.currentTarget) setNewPack(null); },
            },
              h("div", { style: { background: "var(--dsw-alias-bg-layer-1)", borderRadius: 12, padding: 20, width: 340, display: "flex", flexDirection: "column", gap: 10 } },
                h("div", { style: { fontSize: 15, fontWeight: 500 } }, "新建图库包"),
                h("input", {
                  placeholder: "图库 ID（英文/数字，如 my_pack）",
                  value: newPack.id,
                  onChange: (ev) => setNewPack({ ...newPack, id: ev.target.value }),
                  style: { ...S.input },
                }),
                h("input", {
                  placeholder: "显示名（如：我的收藏）",
                  value: newPack.name,
                  onChange: (ev) => setNewPack({ ...newPack, name: ev.target.value }),
                  style: { ...S.input },
                }),
                h("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
                  h("button", { style: S.btn(false), onClick: () => setNewPack(null) }, "取消"),
                  h("button", { style: S.btn(true), onClick: () => void addPack() }, "创建"),
                ),
              ),
            ) : null,
          );
        }

        const PACKS_DEF = [
          { id: "dafeiyu", name: "大肥鱼" },
          { id: "user", name: "用户表情包" },
          { id: "found", name: "大肥鱼叼回来的" },
        ];
        const packCount = (id) => {
          const hit = packs.find((p) => p.pack === id);
          return hit ? hit.count : 0;
        };

        return h("div", { className: "dsh-remembers-settings", style: S.wrap },
          h("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" } },
            h("button", {
              style: { ...S.btn(false), padding: "5px 12px", fontSize: 13 },
              onClick: () => { setView("list"); setPack(""); },
            }, "← 图库列表"),
            h("span", { style: { ...S.muted, fontSize: 12 } },
              "当前图库：" + (packs.find((p) => p.pack === pack)?.name || pack || "全部表情包") + " · " + list.length + " 张"),
            h("button", {
              style: { ...S.btn(false), padding: "5px 12px", fontSize: 12, marginLeft: "auto" },
              onClick: () => {
                const pid = pack || "all";
                const cur = packs.find((x) => x.pack === pid);
                setEditPack({ id: pid, name: cur ? cur.name : (pid === "all" ? "全部表情包" : pid), cover: cur ? cur.cover : "" });
              },
            }, "编辑图库"),
            (pack && pack !== "all") ? h("button", {
              style: { ...S.btn(false), padding: "5px 12px", fontSize: 12, color: "color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, var(--dsw-alias-label-primary))" },
              onClick: async () => {
                if (!window.confirm("删除图库「" + (packs.find((p) => p.pack === pack)?.name || pack) + "」？（里面的图不会删，只是藏起来）")) return;
                try {
                  await call("/memes/packs/remove", { method: "POST", body: JSON.stringify({ id: pack }) });
                  setPack(""); setView("list");
                  await loadPacks();
                } catch (err) {
                  setMsg("删除失败：" + (err && err.message ? err.message : String(err)));
                }
              },
            }, "删除图库") : null,
          ),
          h("div", { style: S.desc },
            "上传后自动识别情绪和描述（视觉模型），她就能按情绪找图。",
          ),
          h("div", { style: S.row },
            h("label", {
              style: {
                ...S.btn(true), padding: "6px 14px", fontSize: 13, cursor: busy ? "not-allowed" : "pointer",
                display: "inline-block", opacity: busy ? 0.6 : 1,
              },
            },
              busy ? "正在上传…" : "新增表情包",
              h("input", {
                type: "file",
                accept: "image/*",
                onChange: upload,
                disabled: busy,
                style: { display: "none" },
              }),
            ),
            busy ? h("span", { style: S.muted }, "正在上传 + 识别…") : null,
          ),
          msg ? h("div", { style: S.muted }, msg) : null,
          h("div", {
            style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 },
          },
            list.map((m) => h("div", {
              key: m.file,
              onMouseEnter: (e) => {
                e.currentTarget.style.transform = "translateY(-3px)";
                e.currentTarget.style.boxShadow = "0 8px 18px var(--dsw-alias-border-l4)";
              },
              onMouseLeave: (e) => {
                e.currentTarget.style.transform = "";
                e.currentTarget.style.boxShadow = "";
              },
              style: {
                border: "1px solid var(--dsw-alias-border-l2)",
                borderRadius: 10, padding: 6, display: "flex", flexDirection: "column", gap: 4,
                background: "var(--dsw-alias-bg-layer-1)",
                transition: "transform .16s ease, box-shadow .16s ease",
                willChange: "transform",
              },
            },
              h("img", {
                src: serviceUrl() + "/memes/file/" + encodeURIComponent(m.file),
                loading: "lazy",
                onError: (ev) => {
                  ev.target.style.display = "none";
                  if (ev.target.nextSibling) ev.target.nextSibling.style.display = "block";
                },
                style: { width: "100%", height: 90, objectFit: "contain", borderRadius: 6, background: "var(--dsw-alias-bg-module-platform)" },
              }),
              h("div", {
                style: { display: "none", height: 90, alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--dsw-alias-label-secondary)", textAlign: "center", padding: 4 },
              }, m.file + "（加载失败）"),
              h("div", { style: { fontSize: 11, fontWeight: 500 } }, EMO[m.emotion] || "未分类"),
              h("div", {
                style: {
                  fontSize: 11, color: "var(--dsw-alias-label-secondary)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                },
              }, m.caption || m.file),
              h("div", { style: { display: "flex", gap: 4 } },
                h("button", {
                  style: { ...S.btn(false), padding: "2px 8px", fontSize: 11, flex: 1 },
                  onClick: () => startEdit(m),
                }, "编辑"),
                h("button", {
                  style: { ...S.btn(false), padding: "2px 8px", fontSize: 11, flex: 1 },
                  onClick: () => void remove(m.file),
                }, "删除"),
              ),
            )),
          ),
          editPack ? h("div", {
            style: { position: "fixed", inset: 0, background: "var(--dsw-alias-bg-mask-1)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 },
            onClick: (ev) => { if (ev.target === ev.currentTarget) setEditPack(null); },
          },
            h("div", { style: { background: "var(--dsw-alias-bg-layer-1)", borderRadius: 12, padding: 20, width: 460, maxHeight: "80vh", display: "flex", flexDirection: "column", gap: 12 } },
              h("div", { style: { fontSize: 15, fontWeight: 500 } }, "编辑图库"),
              h("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
                h("span", { style: { ...S.muted, fontSize: 12 } }, "名称"),
                h("input", {
                  value: editPack.name,
                  onChange: (ev) => setEditPack({ ...editPack, name: ev.target.value }),
                  style: { ...S.input },
                }),
              ),
              h("div", { style: { display: "flex", flexDirection: "column", gap: 4, flex: 1, minHeight: 0 } },
                h("span", { style: { ...S.muted, fontSize: 12 } }, "封面（从图库里选一张，点一下选中）"),
                h("div", {
                  style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: 6, overflowY: "auto", maxHeight: 320, padding: 2 },
                },
                  list.map((m) =>
                    h("div", {
                      key: m.file,
                      onClick: () => setEditPack({ ...editPack, cover: m.file }),
                      style: {
                        height: 72, borderRadius: 8, cursor: "pointer", overflow: "hidden",
                        border: editPack.cover === m.file ? "2px solid color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "1px solid var(--dsw-alias-border-l4)",
                        backgroundImage: "url(" + serviceUrl() + "/memes/file/" + encodeURIComponent(m.file) + ")",
                        backgroundSize: "cover",
                        backgroundPosition: "center 28%",
                      },
                    }),
                  ),
                ),
              ),
              h("div", { style: { display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" } },
                h("button", {
                  style: { ...S.btn(false), padding: "4px 10px", fontSize: 12 },
                  onClick: () => setEditPack({ ...editPack, cover: "" }),
                }, "恢复默认封面"),
                h("div", { style: { display: "flex", gap: 8 } },
                  h("button", { style: S.btn(false), onClick: () => setEditPack(null) }, "取消"),
                  h("button", {
                    style: S.btn(true),
                    onClick: async () => {
                      setBusy(true);
                      try {
                        await call("/memes/packs/update", {
                          method: "POST",
                          body: JSON.stringify({ id: editPack.id, name: editPack.name, cover: editPack.cover }),
                        });
                        setEditPack(null);
                        await loadPacks();
                      } catch (err) {
                        setMsg("保存失败：" + (err && err.message ? err.message : String(err)));
                      } finally {
                        setBusy(false);
                      }
                    },
                  }, "保存"),
                ),
              ),
            ),
          ) : null,
          editing ? h("div", {
            style: {
              position: "fixed", inset: 0, background: "var(--dsw-alias-bg-mask-1)",
              display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
            },
            onClick: (ev) => { if (ev.target === ev.currentTarget) setEditing(null); },
          },
            h("div", {
              style: {
                background: "var(--dsw-alias-bg-layer-1)", borderRadius: 12, padding: 18,
                width: 420, maxWidth: "90vw", display: "flex", flexDirection: "column", gap: 10,
              },
            },
              h("div", { style: { fontWeight: 500, fontSize: 14 } }, "编辑表情包"),
              h("img", {
                src: serviceUrl() + "/memes/file/" + encodeURIComponent(editing.file) + "?t=" + Date.now(),
                style: {
                  maxWidth: "100%", maxHeight: 180, objectFit: "contain",
                  borderRadius: 8, background: "var(--dsw-alias-bg-module-platform)", alignSelf: "center",
                },
              }),
              h("div", { style: S.muted }, editing.file),
              h("div", { style: S.field },
                h("div", { style: S.label }, "分类"),
                h("select", {
                  style: S.select,
                  value: editing.emotion,
                  onChange: (ev) => setEditing({ ...editing, emotion: ev.target.value }),
                },
                  h("option", { value: "" }, "未分类"),
                  Object.keys(EMO).map((k) => h("option", { key: k, value: k }, EMO[k])),
                ),
              ),
              h("div", { style: S.field },
                h("div", { style: S.label }, "描述"),
                h("textarea", {
                  style: { ...S.input, minHeight: 60, resize: "vertical" },
                  value: editing.caption,
                  onChange: (ev) => setEditing({ ...editing, caption: ev.target.value }),
                }),
              ),
              h("div", { style: S.field },
                h("div", { style: S.label }, "关键词（空格分隔）"),
                h("input", {
                  style: S.input,
                  value: editing.keywords,
                  onChange: (ev) => setEditing({ ...editing, keywords: ev.target.value }),
                }),
              ),
              h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 } },
                h("button", { style: S.btn(false), onClick: () => setEditing(null) }, "取消"),
                h("button", { style: S.btn(true), onClick: () => void saveEdit() }, "保存"),
              ),
            ),
          ) : null,
        );
      }

      // ---------------------------------------------------------------------
      // 主动消息：唤醒规则（她醒来之后干嘛由她自己决定）
      // ---------------------------------------------------------------------
      function ProactiveSection() {
        const [cfg, setCfg] = React.useState(null);
        const [biliManaged, setBiliManaged] = React.useState(null);
        const [qqBusy, setQqBusy] = React.useState(false);
        const [qqMsg, setQqMsg] = React.useState(null);
        const [silentActions, setSilentActions] = React.useState([]);
        const [silentActionEnabled, setSilentActionEnabled] = React.useState({});
        const [talkActionEnabled, setTalkActionEnabled] = React.useState({});
        const [talkActions, setTalkActions] = React.useState([]);
        const [newAction, setNewAction] = React.useState({ silent: "", talk: "" });

        // 删除一条动作（文本 + 启用状态一起删，索引要重排）
        const removeAction = (texts, enabled, i, setTexts, setEnabled) => {
          const newTexts = texts.filter((_, j) => j !== i);
          const newEnabled = {};
          newTexts.forEach((_, j) => {
            const srcIdx = j < i ? j : j + 1;
            newEnabled[j] = enabled[srcIdx] !== false;
          });
          setTexts(newTexts);
          setEnabled(newEnabled);
        };
        const [msg, setMsg] = React.useState(null);
        const [err, setErr] = React.useState(null);

        const load = async () => {
          setErr(null);
          try {
            const c = await call("/proactive");
            const automation = await call("/bili/automation");
            setBiliManaged(automation.config.managed);
            const parseActions = (arr) => {
              const texts = [];
              const enabled = {};
              (Array.isArray(arr) ? arr : []).forEach((a, i) => {
                if (a && typeof a === "object") {
                  texts.push(String(a.text || ""));
                  enabled[i] = a.enabled !== false;
                } else {
                  texts.push(String(a || ""));
                  enabled[i] = true;
                }
              });
              return { texts, enabled };
            };
            const sp = parseActions(c.silentActions);
            const tp = parseActions(c.talkActions);
            setCfg(c);
            setSilentActions(sp.texts);
            setTalkActions(tp.texts);
            setSilentActionEnabled(sp.enabled);
            setTalkActionEnabled(tp.enabled);
          } catch (e) {
            setErr(e && e.message ? e.message : String(e));
            setCfg(null);
          }
        };

        React.useEffect(() => {
          void load();
        }, []);

        const save = async () => {
          if (!cfg) return;
          try {
            const packActions = (texts, enabled) =>
              texts.map((txt, i) => ({ text: txt, enabled: enabled[i] !== false }));
            await call("/proactive", {
              method: "POST",
              body: JSON.stringify({
                ...cfg,
                silentActions: packActions(silentActions, silentActionEnabled),
                talkActions: packActions(talkActions, talkActionEnabled),
              }),
            });
            setMsg("已保存");
            setErr(null);
          } catch (e) {
            setMsg("保存失败：" + (e && e.message ? e.message : String(e)));
          }
        };

        if (!cfg) {
          return h("div", { className: "dsh-remembers-settings", style: S.wrap },
            err ? h("div", { style: S.notice("error") }, "读取失败：" + err)
              : h("div", { style: S.muted }, "读取配置…"));
        }

        const num = (key, label, hint) => h("div", { style: S.field },
          h("div", { style: S.label }, label),
          h("input", {
            type: "number",
            style: S.input,
            value: cfg[key],
            onChange: (ev) => setCfg({ ...cfg, [key]: Number(ev.target.value) || 0 }),
          }),
          hint ? h("div", { style: S.muted }, hint) : null,
        );

        const toggle = (key, label, hint) => h("label", {
          style: {
            display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer",
            padding: "10px 12px", borderRadius: 8, marginBottom: 8,
            border: "1.5px solid " + (cfg[key] ? "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "var(--dsw-alias-border-l4)"),
            background: cfg[key] ? "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))" : "var(--dsw-alias-bg-layer-1)",
            transition: "border-color .15s, background .15s",
          },
        },
          h("input", {
            type: "checkbox",
            checked: !!cfg[key],
            onChange: (ev) => setCfg({ ...cfg, [key]: ev.target.checked }),
            style: { marginTop: 2 },
          }),
          h("span", { style: { display: "flex", flexDirection: "column", gap: 2 } },
            h("span", { style: { fontSize: 13, fontWeight: 500 } }, label),
            hint ? h("span", { style: { ...S.muted, fontSize: 12 } }, hint) : null,
          ),
        );

        return h("div", { className: "dsh-remembers-settings", style: S.wrap },
          h("div", { style: S.desc },
            "定时把她叫醒。醒来之后她想干嘛（发呆 / 上网 / 找你 / 发图）由她自己决定——"
            + "关掉「允许发消息」就是只唤醒、不打扰。",
          ),


          h("div", { style: S.card },
            toggle("enabled", "自动唤醒", "总开关：关掉后完全不叫醒她"),
            toggle("talkEnabled", "允许她主动发消息", "关掉 = 只唤醒她、不给你发消息（静默活动）"),
          ),

          h("div", { style: S.card },
            h("div", { style: S.label }, "她的主动性"),
            h("div", { style: { ...S.muted, fontSize: 12, marginBottom: 10 } },
              "勾上之后会写进她的系统提示词。关掉 = 她不会主动约时间、也不会主动分享，只被动等你。"),

            h("div", {
              style: {
                display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer",
                padding: "10px 12px", borderRadius: 8, marginBottom: 8,
                border: "1.5px solid " + (cfg.autoScheduleEnabled !== false ? "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "var(--dsw-alias-border-l4)"),
                background: cfg.autoScheduleEnabled !== false ? "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))" : "var(--dsw-alias-bg-layer-1)",
              },
              onClick: () => setCfg({ ...cfg, autoScheduleEnabled: cfg.autoScheduleEnabled === false }),
            },
              h("input", {
                type: "checkbox",
                checked: cfg.autoScheduleEnabled !== false,
                onClick: (ev) => ev.stopPropagation(),
                onChange: (ev) => setCfg({ ...cfg, autoScheduleEnabled: ev.target.checked }),
                style: { marginTop: 3 },
              }),
              h("div", { style: { flex: 1 } },
                h("div", { style: { fontSize: 13, fontWeight: 500 } }, "聊完可以自己约下次时间"),
                h("div", { style: { ...S.muted, fontSize: 12, marginTop: 2 } },
                  "聊完觉得过会儿还想找你，她可以用 schedule_create 设个时间，到点自己来找你"),
              ),
            ),

            h("div", {
              style: {
                display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer",
                padding: "10px 12px", borderRadius: 8,
                border: "1.5px solid " + (cfg.autoShareEnabled !== false ? "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "var(--dsw-alias-border-l4)"),
                background: cfg.autoShareEnabled !== false ? "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))" : "var(--dsw-alias-bg-layer-1)",
              },
              onClick: () => setCfg({ ...cfg, autoShareEnabled: cfg.autoShareEnabled === false }),
            },
              h("input", {
                type: "checkbox",
                checked: cfg.autoShareEnabled !== false,
                onClick: (ev) => ev.stopPropagation(),
                onChange: (ev) => setCfg({ ...cfg, autoShareEnabled: ev.target.checked }),
                style: { marginTop: 3 },
              }),
              h("div", { style: { flex: 1 } },
                h("div", { style: { fontSize: 13, fontWeight: 500 } }, "刷完 B 站可以主动分享"),
                h("div", { style: { ...S.muted, fontSize: 12, marginTop: 2 } },
                  "刷到有意思的，她会把链接和两句感想发给你"),
              ),
            ),
          ),

          h("div", { style: S.card },
            h("div", { style: S.label }, "她醒着能做什么"),
            h("div", { style: { ...S.muted, marginBottom: 8 } },
              "每次唤醒随机抽一条当作她这轮的状态提示。静默=她自己待着，说话=可以找你。改完点下面的保存。"),

            h("div", { style: { ...S.muted, fontSize: 11, marginTop: 4 } }, "她自己做什么（自己待着，不找你）"),
            h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 } },
              silentActions.map((a, i) => h("label", {
                key: "s" + i,
                style: {
                  display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, cursor: "pointer",
                  padding: "8px 10px", borderRadius: 8,
                  border: "1.5px solid " + (silentActionEnabled[i] !== false ? "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "var(--dsw-alias-border-l4)"),
                  background: silentActionEnabled[i] !== false ? "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))" : "var(--dsw-alias-bg-layer-1)",
                  transition: "border-color .15s, background .15s",
                },
              },
                h("input", {
                  type: "checkbox",
                  checked: silentActionEnabled[i] !== false,
                  onChange: (ev) => { ev.stopPropagation(); setSilentActionEnabled((prev) => ({ ...prev, [i]: prev[i] === false })); },
                  style: { marginTop: 2, flexShrink: 0 },
                }),
                h("span", { style: { flex: 1, lineHeight: "18px" } }, a),
                h("span", { style: { cursor: "pointer", opacity: 0.55, padding: "0 4px", fontSize: 14, lineHeight: "18px" }, onClick: (ev) => { ev.preventDefault(); ev.stopPropagation(); removeAction(silentActions, silentActionEnabled, i, setSilentActions, setSilentActionEnabled); } }, "×"),
              )),
            ),
            h("div", { style: { display: "flex", gap: 6, marginTop: 6 } },
              h("input", {
                style: { ...S.input, flex: 1 }, placeholder: "加一个（例如：躺着听雨声）",
                value: newAction.silent,
                onChange: (ev) => setNewAction({ ...newAction, silent: ev.target.value }),
                onKeyDown: (ev) => {
                  if (ev.key === "Enter" && newAction.silent.trim()) {
                    setSilentActions([...silentActions, newAction.silent.trim()]);
                    setNewAction({ ...newAction, silent: "" });
                  }
                },
              }),
              h("button", {
                style: { ...S.btn(false), fontSize: 12 },
                onClick: () => {
                  if (newAction.silent.trim()) {
                    setSilentActions([...silentActions, newAction.silent.trim()]);
                    setNewAction({ ...newAction, silent: "" });
                  }
                },
              }, "加"),
            ),

            h("div", { style: { ...S.muted, fontSize: 11, marginTop: 14 } }, "她想找你做什么（可以主动发消息）"),
            h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 } },
              talkActions.map((a, i) => h("label", {
                key: "t" + i,
                style: {
                  display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, cursor: "pointer",
                  padding: "8px 10px", borderRadius: 8,
                  border: "1.5px solid " + (talkActionEnabled[i] !== false ? "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "var(--dsw-alias-border-l4)"),
                  background: talkActionEnabled[i] !== false ? "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))" : "var(--dsw-alias-bg-layer-1)",
                  transition: "border-color .15s, background .15s",
                },
              },
                h("input", {
                  type: "checkbox",
                  checked: talkActionEnabled[i] !== false,
                  onChange: (ev) => { ev.stopPropagation(); setTalkActionEnabled((prev) => ({ ...prev, [i]: prev[i] === false })); },
                  style: { marginTop: 2, flexShrink: 0 },
                }),
                h("span", { style: { flex: 1, lineHeight: "18px" } }, a),
                h("span", { style: { cursor: "pointer", opacity: 0.55, padding: "0 4px", fontSize: 14, lineHeight: "18px" }, onClick: (ev) => { ev.preventDefault(); ev.stopPropagation(); removeAction(talkActions, talkActionEnabled, i, setTalkActions, setTalkActionEnabled); } }, "×"),
              )),
            ),
            h("div", { style: { display: "flex", gap: 6, marginTop: 6 } },
              h("input", {
                style: { ...S.input, flex: 1 }, placeholder: "加一个（例如：想问他明天忙不忙）",
                value: newAction.talk,
                onChange: (ev) => setNewAction({ ...newAction, talk: ev.target.value }),
                onKeyDown: (ev) => {
                  if (ev.key === "Enter" && newAction.talk.trim()) {
                    setTalkActions([...talkActions, newAction.talk.trim()]);
                    setNewAction({ ...newAction, talk: "" });
                  }
                },
              }),
              h("button", {
                style: { ...S.btn(false), fontSize: 12 },
                onClick: () => {
                  if (newAction.talk.trim()) {
                    setTalkActions([...talkActions, newAction.talk.trim()]);
                    setNewAction({ ...newAction, talk: "" });
                  }
                },
              }, "加"),
            ),
          ),

          biliManaged === false ? h("div", { style: S.card },
            h("div", { style: S.label }, "B 站（她自己刷视频的节奏）"),
            h("div", { style: { ...S.muted, marginBottom: 8 } },
              "和唤醒分开管：她按自己的间隔去 B 站逛逛，刷到什么会记进见闻，下次聊天能提。"),
            toggle("biliBrowseEnabled", "允许她按自己的节奏刷 B 站", "关掉 = 只有唤醒时抽到「刷 B 站」才去"),
            h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 8 } },
              num("biliMinGapMinutes", "至少隔（分钟）", "两次刷之间最少多久"),
              num("biliMaxGapMinutes", "最多隔（分钟）", "两次刷之间最多多久"),
              num("biliBrowseLimit", "每次刷几条", "存进见闻的条数"),
              num("biliBrowsePerDay", "每天最多刷几次", "超过就不点醒她了"),
            ),
          ) : h("div", { style: S.card }, h("div", { style: S.muted }, "B 站的自动浏览、私信、推荐和每日数量已由“B 站”设置统一管理。")),

          h("div", { style: S.card },
            h("div", { style: S.desc }, "唤醒规则"),
            h("div", { style: { ...S.muted, fontSize: 12, marginBottom: 10 } },
              "选一套预设，下面的参数自动套上并锁定。要自己调就点「自定义」解锁。"),

            h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 } },
              ...[
                ["cold", "冷漠", "一天 2-3 次", { startHour: 10, endHour: 21, minGapMinutes: 240, maxGapMinutes: 480, silentRatio: 70, wakeActionCount: 1 }],
                ["normal", "普通", "一天 5-8 次", { startHour: 8, endHour: 23, minGapMinutes: 30, maxGapMinutes: 180, silentRatio: 40, wakeActionCount: 3 }],
                ["warm", "热情", "一天 10+ 次", { startHour: 8, endHour: 24, minGapMinutes: 15, maxGapMinutes: 60, silentRatio: 20, wakeActionCount: 5 }],
              ].map(([key, label, hint, params]) => {
                const on = (cfg.wakePreset || "normal") === key;
                return h("div", {
                  key: "wp-" + key,
                  onClick: () => setCfg({ ...cfg, ...params, wakePreset: key }),
                  style: {
                    cursor: "pointer", padding: "10px 12px", borderRadius: 8,
                    border: "1.5px solid " + (on ? "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "var(--dsw-alias-border-l4)"),
                    background: on ? "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))" : "var(--dsw-alias-bg-layer-1)",
                    transition: "border-color .15s, background .15s",
                  },
                },
                  h("div", { style: { fontSize: 13, fontWeight: on ? 600 : 500 } }, label),
                  h("div", { style: { ...S.muted, fontSize: 11, marginTop: 2 } }, hint),
                );
              }),
            ),

            h("div", {
              onClick: () => setCfg({ ...cfg, wakePreset: (cfg.wakePreset === "custom" ? "normal" : "custom") }),
              style: {
                display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                padding: "8px 12px", borderRadius: 8, marginBottom: 12,
                border: "1.5px solid " + ((cfg.wakePreset === "custom") ? "color-mix(in srgb, var(--dsw-alias-state-warn-label) 60%, var(--dsw-alias-label-primary))" : "var(--dsw-alias-border-l4)"),
                background: (cfg.wakePreset === "custom") ? "color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, var(--dsw-alias-bg-layer-1))" : "var(--dsw-alias-settings-card-fill)",
              },
            },
              h("span", { style: { fontSize: 14 } }, (cfg.wakePreset === "custom") ? "🔓" : "🔒"),
              h("span", { style: { fontSize: 12, fontWeight: 500 } },
                (cfg.wakePreset === "custom") ? "自定义（已解锁，可改下面参数）" : "自定义（点这里解锁）"),
            ),

            h("div", { style: {
              display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
              pointerEvents: (cfg.wakePreset === "custom") ? "auto" : "none",
              opacity: (cfg.wakePreset === "custom") ? 1 : 0.55,
              transition: "opacity .15s",
            } },
              num("startHour", "开始小时（0-23）", "几点之前不唤醒"),
              num("endHour", "结束小时（0-23）", "到几点就不再唤醒"),
              num("minGapMinutes", "最小间隔（分钟）", "两次唤醒之间至少隔多久"),
              num("maxGapMinutes", "最大间隔（分钟）", "两次唤醒之间最多隔多久"),
            ),
            h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } },
              num("wakeActionCount", "唤醒时给几个选项", "抽几条动作让她挑，1=只给一条"),
              num("silentRatio", "静默概率（%）", "醒来后不打扰你的比例"),
            ),
          ),

          h("div", {
            style: {
              position: "fixed", right: 24, top: "50%", transform: "translateY(-50%)",
              display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8,
              background: "var(--dsw-alias-bg-layer-1)", padding: "12px 16px", borderRadius: 12,
              border: 0, boxShadow: "var(--dsw-elevation-panel)", zIndex: 9999,
              minWidth: 140,
            },
          },
            msg ? h("div", { style: { fontSize: 12, color: msg.includes("失败") ? "color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, var(--dsw-alias-label-primary))" : "color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, var(--dsw-alias-label-primary))", textAlign: "center" } }, msg) : null,
            h("button", { style: S.btn(true), onClick: () => void save() }, "保存"),
          ),
        );
      }

      // B 站选题的预设标签（按分区整理，点一下就能选）
      const PRESET_LIKE = [
        "猫咪", "狗狗", "宠物", "萌宠", "动物",
        "科技", "数码", "手机", "电脑", "AI", "编程", "极客",
        "游戏", "电竞", "主机", "手游", "单机", "游戏实况", "速通",
        "鬼畜", "搞笑", "沙雕", "整活",
        "音乐", "翻唱", "Vocaloid", "纯音乐", "DJ",
        "舞蹈", "宅舞", "街舞",
        "美食", "做饭", "厨艺", "探店", "吃播",
        "动漫", "番剧", "二次元", "cos",
        "电影", "影视解说", "影评",
        "纪录片", "科普", "历史", "人文",
        "知识", "学习", "考研", "公开课",
        "生活", "vlog", "日常",
        "手工", "DIY", "模型", "手办",
        "绘画", "画师", "插画", "板绘",
        "摄影", "摄像",
        "运动", "健身", "跑步",
        "治愈", "白噪音", "ASMR", "助眠",
        "猫咪视频", "猫meme", "萌宠日常",
      ];

      const PRESET_DISLIKE = [
        "恐怖", "惊悚", "恐怖游戏", "血腥", "暴力",
        "擦边", "软色情", "擦边舞", "宅男向",
        "猎奇", "重口", "恶心",
        "争吵", "节奏", "撕逼", "引战",
        "带货", "广告", "推广", "营销号", "标题党",
        "政治", "时政",
        "装疯卖傻", "lowb", "土味",
        "ASMR擦边", "整蛊",
      ];

      /** 标签选择器：预设点选 + 自定义输入。 */
      function TagPicker({ presets, value, onChange, placeholder }) {
        const [draft, setDraft] = React.useState("");
        const list = Array.isArray(value) ? value : [];
        const toggle = (tag) => {
          if (list.includes(tag)) onChange(list.filter((x) => x !== tag));
          else onChange([...list, tag]);
        };
        const addDraft = () => {
          const v = draft.trim();
          if (!v) return;
          if (!list.includes(v)) onChange([...list, v]);
          setDraft("");
        };
        const isOn = (tag) => list.includes(tag);
        return h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
          h("div", { style: { display: "flex", flexWrap: "wrap", gap: 5 } },
            presets.map((tag) =>
              h("button", {
                key: tag,
                onClick: () => toggle(tag),
                style: {
                  fontSize: 12, lineHeight: "20px", padding: "1px 9px", borderRadius: 999,
                  cursor: "pointer", border: "1px solid " + (isOn(tag) ? "transparent" : "var(--dsw-alias-border-l4)"),
                  background: isOn(tag) ? "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))" : "transparent",
                  color: isOn(tag) ? "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "inherit",
                },
              }, tag),
            ),
          ),
          h("div", { style: { display: "flex", gap: 6 } },
            h("input", {
              style: { ...S.input, flex: 1 },
              placeholder,
              value: draft,
              onChange: (ev) => setDraft(ev.target.value),
              onKeyDown: (ev) => { if (ev.key === "Enter") { ev.preventDefault(); addDraft(); } },
            }),
            h("button", { style: { ...S.btn(false), fontSize: 12, padding: "0 10px" }, onClick: addDraft }, "添加"),
          ),
          list.length ? h("div", { style: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 } },
            list.map((tag) =>
              h("span", {
                key: tag,
                style: {
                  fontSize: 12, padding: "1px 7px", borderRadius: 999,
                  background: "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))", color: "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))",
                  display: "inline-flex", alignItems: "center", gap: 4,
                },
              },
                tag,
                h("span", {
                  style: { cursor: "pointer", opacity: 0.7, fontWeight: 500 },
                  onClick: () => toggle(tag),
                }, "×"),
              ),
            ),
          ) : h("div", { style: { ...S.muted, fontSize: 11 } }, "还没选（空着就按默认偏好）"),
        );
      }

      // ---------------------------------------------------------------------
      // B 站：账号状态 + 开关（她自己的号，嘴走 QQ 那套）
      // ---------------------------------------------------------------------
      function BiliAutomationPanel({ value, status, writeBudget, writeUsage, onWriteBudgetChange, onChange, onRun, running }) {
        if (!value) return null;
        const change = (path, next) => {
          const copy = JSON.parse(JSON.stringify(value));
          let cur = copy;
          for (const key of path.slice(0, -1)) cur = cur[key];
          cur[path[path.length - 1]] = next;
          copy.managed = true;
          onChange(copy);
        };
        const check = (text, path, hint) => h("label", { style: { display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" } },
          h("input", { type: "checkbox", checked: path.reduce((o, k) => o[k], value), "aria-label": text,
            onChange: ev => change(path, ev.target.checked), style: { marginTop: 3 } }),
          h("span", null, h("span", { style: S.label }, text), hint ? h("div", { style: S.muted }, hint) : null));
        const number = (label, path, min, max) => h("label", { style: { display: "flex", alignItems: "center", gap: 6 } },
          h("span", { style: S.muted }, label), h("input", { type: "number", min, max, step: 1,
            required: true, "aria-label": label, title: max === undefined ? "请输入正整数" : `请输入 ${min}～${max} 的整数`,
            style: { ...S.input, width: 86 }, value: path.reduce((o, k) => o[k], value),
            onChange: ev => change(path, ev.target.value === "" ? "" : Number(ev.target.value)) }));
        const diagnostic = (text, unknown = false) => {
          const long = text.length > 240 || /[\r\n]|file:\/\/|node:internal/.test(text);
          return h("div", null,
            h("div", { style: S.muted }, long ? (unknown ? "发送结果尚未确认，已暂停重发；请先检查 B 站会话" : "执行未完成，请展开详情查看原因") : text),
            long ? h("details", null, h("summary", { style: S.muted }, "技术详情"),
              h("pre", { style: { ...S.muted, whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, text)) : null);
        };
        const names = { browse: "浏览视频", recommend: "推荐给主人", comment: "独立评论", interact: "评论互动", dmReply: "主人私信回复", strangerReply: "陌生人 @／回复互动", ownerReply: "主人评论区 @／回复",
          ...(value.lifePosts ? { dynamic: "鱼鱼碎碎念动态" } : {}) };
        const states = { success: "成功", running: "执行中", failed: "失败", unknown: "待核查" };
        const budgetTime = timestamp => new Date(timestamp * 1000).toLocaleTimeString("zh-CN", {
          timeZone: "Asia/Shanghai", hourCycle: "h23", hour: "2-digit", minute: "2-digit",
        });
        return h("div", { style: S.card, "data-bili-automation": "" },
          h("div", { style: S.label }, "自动浏览与互动"),
          h("div", { style: S.muted }, "每日目标随机生成并持久保存。每轮推荐、独立评论和互动分别抽签，可执行多项；全部未命中时补选一项符合条件的活动。评分、额度与平台限速仍生效。图库与概率共用「表情包」设置；顶层评论可附图，楼中楼仅文字，私信在正文后发图。未确认发送时显示原因。"),
          h("div", { style: { borderTop: "1px solid var(--dsw-alias-border-l4)", paddingTop: 12 } },
            h("div", { style: S.label }, "写操作总上限"),
            h("div", { style: S.muted }, "评论、私信、图片上传等共用这两个上限，达到任一上限后暂停写入。额度恢复后，未发送的私信会重新检查并重试。修改后点击页面顶部“保存”生效。"),
            h("div", { style: { ...S.row, flexWrap: "wrap", marginTop: 8 } },
              ...[["writeDaily", "每天最多写操作"], ["writeHourly", "每小时最多写操作"]].map(([key, label]) =>
                h("label", { key, style: { display: "flex", alignItems: "center", gap: 6 } },
                  h("span", { style: S.muted }, label),
                  h("input", { type: "number", min: 1, max: 100000, step: 1, required: true, "aria-label": label,
                    title: "请输入 1～100000 的整数", style: { ...S.input, width: 100 }, value: writeBudget[key],
                    onChange: ev => onWriteBudgetChange(key, ev.target.value) })))),
            h("div", { style: { ...S.muted, marginTop: 8 }, role: "status", "data-write-usage": "" },
              writeUsage === null ? "正在读取写操作用量…" : writeUsage.error ? "写操作用量暂时无法读取，请检查记忆服务和 B 站登录状态" : h(React.Fragment, null,
                h("div", null, `今日已用 ${writeUsage.daily} / ${writeUsage.dailyLimit} 次，剩余 ${writeUsage.dailyRemaining} 次（北京时间零点重置）`),
                h("div", null, `本小时 ${budgetTime(writeUsage.hourStartedAt)}–${budgetTime(writeUsage.hourResetsAt)}：已用 ${writeUsage.hourly} / ${writeUsage.hourlyLimit} 次，剩余 ${writeUsage.hourlyRemaining} 次`),
                h("div", null, `小时额度将在 ${budgetTime(writeUsage.hourResetsAt)} 自动重置（北京时间，每 10 秒刷新）`)))),
          check("自动执行 B 站任务", ["enabled"], "需同时开启上方总开关。她会保持“人格设定”中的性格和语气，按下方勾选的项目、时段和次数自动活动（北京时间）。修改后点击页面顶部“保存”生效。"),
          ...Object.entries(names).map(([kind, label]) => {
            const counts = (status && status.counts && status.counts[kind]) || {};
            const target = status && status.targets ? status.targets[kind] : "—";
            return h("div", { key: kind, style: { borderTop: "1px solid var(--dsw-alias-border-l4)", paddingTop: 12 } },
              check(label, ["features", kind], ({ browse: "按已保存偏好选视频并读取内容", recommend: "结合视频的有趣之处写推荐，在评论区真正 @ 主人",
                comment: "独立表达对视频的感想，不自动 @ 主人", interact: "针对已读取的具体评论自然回复，同一视频按动作类型分别去重",
                dmReply: "只读取和回复主人的新私信，成功发送后才确认消息游标",
                strangerReply: "响应陌生人在视频评论区的新 @ 和回复；首次开启只建立收件箱基线，不回复旧消息",
                ownerReply: "回复主人在视频评论区的新 @ 和回复，公开发言不附带私聊画像；楼中楼仅发送文字",
                dynamic: "按上海日期、实际天气和节假日，发鱼生思考、日常感慨与想吃饭的碎碎念；失败也占当日尝试数" })[kind]),
              h("div", { style: { ...S.row, flexWrap: "wrap", marginTop: 8 } },
                kind === "ownerReply" ? number("主人评论每天最多回复", ["ownerCommentDailyMax"], 0, 500) : kind === "strangerReply" ? number("陌生人每天最多 AI 回复", ["strangerDailyMax"], 0, 500) : kind === "dmReply" ? number("私信每天最多", ["dmDailyMax"], 0, 500) : h(React.Fragment, null,
                  number(label + "每天最少", ["daily", kind, "min"], 0, kind === "dynamic" ? 20 : 500),
                  number(label + "每天最多", ["daily", kind, "max"], 0, kind === "dynamic" ? 20 : 500)),
                value.actionProbability && ["recommend", "comment", "interact"].includes(kind)
                  ? number(label + "每轮抽签概率（%）", ["actionProbability", kind], 1, 100) : null,
                h("span", { style: S.muted }, `今日${["dmReply", "strangerReply", "ownerReply"].includes(kind) ? "上限" : "目标"} ${target} · 成功 ${counts.success || 0} · 执行中 ${counts.running || 0} · 失败 ${counts.failed || 0} · 待核查 ${counts.unknown || 0}`)),
              kind === "strangerReply" ? h("div", { style: S.muted }, "AI 生成失败也占当日次数。超限后直接回复「token快要用完啦，我的主人不让我回答啦」，不调用模型；同一人每天最多收到一次固定提示。固定提示成功 " + ((status && status.counts && status.counts.strangerNotice && status.counts.strangerNotice.success) || 0) + " 条。") : null);
          }),
          value.lifePosts ? h("details", { "data-life-post-settings": "" },
            h("summary", { style: { ...S.label, cursor: "pointer" } }, "碎碎念主题、时段与偏好"),
            h("div", { style: { display: "flex", flexDirection: "column", gap: 12, marginTop: 12 } },
              h("div", { style: S.muted }, "结合上海当天的天气、节假日、已完成的视频浏览与评论互动，以及主人聊天的话题和感受，按下方写作提示词生成当天日记或碎碎念。勾选主题可灵活结合；聊天仅提炼感受，不公开私聊原文。暂无记录时不编造经历。发表时间随机安排，刷新与重启不会重新抽取。"),
              check("动态允许带图库表情包", ["lifePosts", "allowMemes"], "复用 QQ 与 B 站现有图库和表情包概率；图片不符合当前语境时只发文字"),
              h("div", { style: { ...S.row, flexWrap: "wrap" } },
                number("碎碎念开始时刻", ["lifePosts", "startHour"], 0, 23), number("碎碎念结束时刻", ["lifePosts", "endHour"], 1, 24),
                number("碎碎念最短间隔（分钟）", ["lifePosts", "minGapMinutes"], 10, 1440), number("碎碎念最多字数", ["lifePosts", "maxChars"], 1, undefined)),
              h("div", { style: { display: "flex", flexWrap: "wrap", gap: 14 } },
                ...Object.entries({ fishlife: "鱼生思考", philosophy: "哲学碎想", world: "对世界的好奇", daily: "日常感慨", food: "饿了想吃饭", weather: "上海天气", holiday: "假期与调休心情" }).map(([key, label]) =>
                  h("label", { key, style: { display: "flex", gap: 6, alignItems: "center" } },
                    h("input", { type: "checkbox", "aria-label": "碎碎念主题：" + label, checked: value.lifePosts.themes.includes(key),
                      onChange: ev => change(["lifePosts", "themes"], ev.target.checked ? [...value.lifePosts.themes, key] : value.lifePosts.themes.filter(t => t !== key)) }), label))),
              value.lifePosts.themes.length ? null : h("div", { style: S.notice("error") }, "至少选择一个碎碎念主题后再保存"),
              h("label", null, h("span", { style: S.label }, "碎碎念写作提示词"),
                h("textarea", { "aria-label": "碎碎念写作提示词", style: { ...S.input, minHeight: 80, resize: "vertical" }, maxLength: 4000,
                  placeholder: "例如：喜欢冷幽默，偶尔想到宇宙；别每条都喊主人", value: value.lifePosts.prompt,
                  onChange: ev => change(["lifePosts", "prompt"], ev.target.value) })),
              h("div", { style: S.muted }, "动态只使用公开人设，不引用私人聊天。预览会调用模型，但不发布，也不消耗今日发表次数。请先保存设置再执行。"),
              status && status.dynamicSchedule ? h("div", { style: S.muted },
                "已安排时刻：" + (status.dynamicSchedule.slots.filter(Boolean).map(t => new Date(t * 1000).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })).join("、") || "剩余时段不足")
                  + (status.dynamicSchedule.note ? " · " + status.dynamicSchedule.note : "")) : null,
              status && status.dynamicError ? h("div", { style: S.notice("error") }, "动态：" + status.dynamicError) : null,
              h("div", { style: { ...S.row, flexWrap: "wrap" } },
                h("button", { style: S.btn(false), disabled: running || !!(status && status.busy), onClick: () => onRun(true, "dynamic") }, "预览碎碎念（不发布）"),
                h("button", { style: S.btn(false), disabled: running || !!(status && status.busy) || !value.enabled || !value.features.dynamic, onClick: () => onRun(false, "dynamic") }, "按已保存设置发一条")),
              status && status.lastDynamicPreview ? h("div", { style: { ...S.desc, whiteSpace: "pre-wrap" } },
                "最近预览（未发布）：\n" + status.lastDynamicPreview.text,
                status.lastDynamicPreview.context ? h("div", { style: S.muted },
                  "上海 · " + status.lastDynamicPreview.context.date + " · " + status.lastDynamicPreview.context.weekday
                  + " · " + (status.lastDynamicPreview.context.calendar.name || "假期资料未更新")
                  + " · " + (status.lastDynamicPreview.context.weather.available ? status.lastDynamicPreview.context.weather.description + " " + status.lastDynamicPreview.context.weather.temperatureC + "°C" : "天气暂不可用")) : null) : null,
            )) : null,
          h("details", null, h("summary", { style: { ...S.label, cursor: "pointer" } }, "时间、私信与推荐设置"),
            h("div", { style: { display: "flex", flexDirection: "column", gap: 12, marginTop: 12 } },
              h("div", { style: { ...S.row, flexWrap: "wrap" } }, number("开始时刻", ["startHour"], 0, 23), number("结束时刻", ["endHour"], 1, 24)),
              h("div", { style: { ...S.row, flexWrap: "wrap" } }, number("浏览最小间隔（分钟）", ["minGapMinutes"], 1, 1440), number("浏览最大间隔（分钟）", ["maxGapMinutes"], 1, 1440)),
              number("私信检查间隔（秒）", ["dmPollSeconds"], 15, 3600),
              check("私信全天回复", ["dmAllDay"]), check("私信只有 @ 大肥鱼时才回复", ["dmRequireMention"], "关闭时，主人的普通私信也会回复"),
              number("评论通知检查间隔（秒）", ["strangerPollSeconds"], 15, 3600),
              check("评论通知全天回复", ["strangerAllDay"], "适用于主人与陌生人的评论 @／回复"),
              number("每轮最多处理陌生人消息", ["strangerBatchSize"], 1, 20),
              check("推荐后也通知主人 QQ", ["notifyQq"]), number("值得推荐的最低评分（0–20）", ["minInterestingScore"], 0, 20))),
          status && status.day ? h("div", { style: S.muted }, "计划日期：" + status.day + (status.nextBrowseAt ? " · 下次浏览：" + new Date(status.nextBrowseAt * 1000).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" }) : "")) : null,
          status && status.blocked ? h("div", { style: S.notice("error") }, "平台限制，已暂停发布：" + status.blocked) : null,
          status && status.lastError ? h("div", { style: S.notice("error") }, status.lastError) : null,
          status && status.dmError ? h("div", { style: S.notice("error") }, "私信：" + status.dmError) : null,
          status && status.strangerError ? h("div", { style: S.notice("error") }, "评论回复：" + status.strangerError) : null,
          h("div", { style: { ...S.row, flexWrap: "wrap" } },
            h("button", { style: S.btn(false), disabled: running || !!(status && status.busy), onClick: () => onRun(true) }, "预览一轮（不发送）"),
            h("button", { style: S.btn(false), disabled: running || !!(status && status.busy), onClick: () => onRun(false) }, status && status.busy ? "正在执行…" : "按已保存设置运行一轮")),
          status && status.lastPreview && status.lastPreview.draft ? h("div", { style: { ...S.desc, whiteSpace: "pre-wrap" } },
            "最近预览：" + status.lastPreview.video.title + "\n摘要：" + (status.lastPreview.draft.summary || "")
              + "\n推荐草稿：" + (status.lastPreview.draft.recommend || "无") + "\n独立评论草稿：" + (status.lastPreview.draft.comment || "无")) : null,
          status && status.events && status.events.length ? h("details", null,
            h("summary", { style: { ...S.label, cursor: "pointer" } }, "最近执行记录"),
            ...status.events.slice(0, 12).map(event => h("div", { key: event.id, style: { padding: "8px 0", borderBottom: "1px solid var(--dsw-alias-border-l4)" } },
              h("span", { style: S.desc }, `${names[event.kind] || "超限固定提示"} · ${states[event.status]} `),
              event.result && event.result.url ? h("a", { href: event.result.url, target: "_blank", rel: "noopener noreferrer" }, event.result.title || "查看结果") : null,
              event.kind === "dynamic" && event.result && event.result.text ? h("div", { style: { ...S.desc, whiteSpace: "pre-wrap" } }, event.result.text) : null,
              event.result && event.result.meme_file ? h("div", { style: S.muted }, (event.result.mediaMode === "link" ? "表情原图链接：" : "配图：") + event.result.meme_file) : null,
              event.result && event.result.mediaWarning ? h("div", { style: S.notice("error") }, event.result.mediaWarning) : null,
              event.error ? diagnostic(event.error, event.status === "unknown") : null))) : null,
        );
      }

      function BiliSection() {
        const sectionRef = React.useRef(null);
        const [st, setSt] = React.useState(null);
        const [busy, setBusy] = React.useState(false);
        const [test, setTest] = React.useState(null);
        const [err, setErr] = React.useState(null);
        const [sessdata, setSessdata] = React.useState("");
        const [ownerMid, setOwnerMid] = React.useState("");
        const [biliCfg, setBiliCfg] = React.useState(null);
        const [biliTools, setBiliTools] = React.useState(null);
        const [biliForm, setBiliForm] = React.useState({});
        const [savedAt, setSavedAt] = React.useState(null);
        const [biliProactive, setBiliProactive] = React.useState(null);
        const [ownerName, setOwnerName] = React.useState("");
        const [ownerMsg, setOwnerMsg] = React.useState(null);
        const [qr, setQr] = React.useState(null);
        const [qrState, setQrState] = React.useState(null);
        const [biliJct, setBiliJct] = React.useState("");
        const [buvid3, setBuvid3] = React.useState("");
        const [loginMsg, setLoginMsg] = React.useState(null);
        const [automation, setAutomation] = React.useState(null);
        const [automationStatus, setAutomationStatus] = React.useState(null);
        const [automationRunning, setAutomationRunning] = React.useState(false);
        const [writeBudget, setWriteBudget] = React.useState({ writeDaily: 30, writeHourly: 12 });
        const [writeUsage, setWriteUsage] = React.useState(null);

        const load = async () => {
          setErr(null);
          try {
            const s = await call("/bili/status");
            setSt(s);
            if (s && s.owner_mid) setOwnerMid(s.owner_mid);
            if (s && s.owner_name) setOwnerName(s.owner_name);
            try {
              const c = await call("/bili/cfg");
              setBiliCfg(c);
              setWriteBudget({ writeDaily: (c.risk || {}).writeDaily ?? 30, writeHourly: (c.risk || {}).writeHourly ?? 12 });
              const a = await call("/bili/automation");
              setAutomation(a.config);
              setAutomationStatus(a);
              setBiliForm({
                like: (c.preferences || {}).like || [],
                dislike: (c.preferences || {}).dislike || [],
                skipChance: (c.night || {}).skipChance ?? 0.3,
                maxVideos: (c.night || {}).maxVideos ?? 6,
                minGapMin: (c.night || {}).minGapMin ?? 10,
                name: (c.persona || {}).name || "",
                ownerTitle: (c.persona || {}).ownerTitle || "",
                selfClaim: (c.persona || {}).selfClaim || "",
                aiCommentGuard: !!((c.share || {}).aiCommentGuard),
                mentionSummary: !!((c.listen || {}).mentionSummary),
              });
            } catch (e) { throw new Error("读取 B 站偏好失败：" + (e && e.message ? e.message : String(e))); }
            try { setBiliTools(await call("/bili/tools")); } catch { setBiliTools(null); }
            try {
              const p = await call("/proactive");
              setBiliProactive({
                biliShareToOwner: p.biliShareToOwner !== false,
                biliShareToGroup: p.biliShareToGroup === true,
                biliComment: p.biliComment !== false,
                biliMentionOwner: p.biliMentionOwner !== false,
              });
            } catch { setBiliProactive({ biliShareToOwner: true, biliShareToGroup: false, biliComment: true, biliMentionOwner: true }); }
          } catch (e) {
            setErr(e && e.message ? e.message : String(e));
            setSt(null);
          }
        };

        React.useEffect(() => {
          void load();
          let disposed = false;
          let usagePending = false;
          const usageController = new AbortController();
          const refreshUsage = async () => {
            if (usagePending || disposed) return;
            usagePending = true;
            try {
              const result = await call("/bili/write-usage", { signal: usageController.signal });
              if (!result || !["daily", "hourly", "dailyLimit", "hourlyLimit", "dailyRemaining", "hourlyRemaining", "hourStartedAt", "hourResetsAt"].every(key => Number.isFinite(result[key]))) {
                throw new Error("写操作用量数据不完整");
              }
              if (!disposed) setWriteUsage(result);
            } catch { if (!disposed) setWriteUsage({ error: true }); }
            finally { usagePending = false; }
          };
          refreshUsage();
          const timer = setInterval(() => {
            refreshUsage();
            void call("/bili/automation").then(result => { if (!disposed) setAutomationStatus(result); })
              .catch(error => { if (!disposed) setErr("读取自动活动状态失败：" + error.message); });
          }, 10000);
          return () => { disposed = true; clearInterval(timer); usageController.abort(); };
        }, []);

        const runAutomation = async (dryRun, kind) => {
          setAutomationRunning(true);
          setErr(null);
          try {
            await call("/bili/automation/run", { method: "POST", body: JSON.stringify({ dry_run: dryRun, ...(kind ? { kind } : {}) }) });
            setAutomationStatus(await call("/bili/automation"));
          } catch (error) { setErr(error.message); }
          finally { setAutomationRunning(false); }
        };

        const saveAll = async () => {
          const invalid = sectionRef.current && sectionRef.current.querySelector("input:invalid");
          if (invalid) {
            for (let parent = invalid.parentElement; parent; parent = parent.parentElement) {
              if (parent.tagName === "DETAILS") parent.open = true;
            }
            invalid.setAttribute("aria-invalid", "true");
            invalid.addEventListener("input", () => invalid.removeAttribute("aria-invalid"), { once: true });
            invalid.focus();
            setSavedAt(null);
            setErr((invalid.getAttribute("aria-label") || "数值设置") + "：" + (invalid.title || "请填写有效数值"));
            return;
          }
          const f = biliForm;
              setBusy(true);
              setErr(null);
              setSavedAt(null);
              try {
                const updates = [
                  { path: ["preferences", "like"], value: Array.isArray(f.like) ? f.like : [] },
                  { path: ["preferences", "dislike"], value: Array.isArray(f.dislike) ? f.dislike : [] },
                  { path: ["night", "skipChance"], value: Number(f.skipChance) || 0 },
                  { path: ["night", "maxVideos"], value: Number(f.maxVideos) || 6 },
                  { path: ["night", "minGapMin"], value: Number(f.minGapMin) || 10 },
                  { path: ["persona", "name"], value: String(f.name || "") },
                  { path: ["persona", "ownerTitle"], value: String(f.ownerTitle || "") },
                  { path: ["persona", "selfClaim"], value: String(f.selfClaim || "") },
                  { path: ["owner"], value: { mid: ownerMid.trim(), name: ownerName.trim() } },
                  { path: ["risk", "writeDaily"], value: Number(writeBudget.writeDaily) },
                  { path: ["risk", "writeHourly"], value: Number(writeBudget.writeHourly) },
                  ...(automation ? [{ path: ["automation"], value: { ...automation, managed: true } }] : []),
                ];
                await call("/bili/cfg", { method: "POST", body: JSON.stringify({ updates }) });
                const c = await call("/bili/cfg");
                for (const { path, value } of updates) {
                  const actual = path.reduce((obj, key) => obj && obj[key], c);
                  if (JSON.stringify(actual) !== JSON.stringify(value)) {
                    throw new Error("B 站设置回读不一致，请重试保存");
                  }
                }
                if (biliProactive) {
                  const legacy = automation ? { ...biliProactive, biliShareToOwner: automation.notifyQq,
                    biliComment: automation.features.comment || automation.features.interact || automation.features.recommend,
                    biliMentionOwner: automation.features.recommend } : biliProactive;
                  const p = await call("/proactive", { method: "POST", body: JSON.stringify(legacy) });
                  if (Object.keys(legacy).some((key) => p[key] !== legacy[key])) {
                    throw new Error("B 站偏好已保存，但分享开关回读不一致，请重试保存");
                  }
                }
                setBiliCfg(c);
                setAutomationStatus(await call("/bili/automation"));
                setSavedAt(new Date().toLocaleTimeString());
              } catch (e) {
                setErr("保存未完成：" + (e && e.message ? e.message : String(e)));
              } finally {
                setBusy(false);
              }
            };

        const startQr = async () => {
          setBusy(true);
          setQrState("生成二维码…");
          try {
            const r = await call("/bili/qr");
            if (!r.ok) {
              setQrState("生成失败：" + (r.error || "unknown"));
              return;
            }
            setQr(r);
            setQrState("用手机 B 站扫码（然后用手机确认）");
            void pollQr(r.key, 0);
          } catch (e) {
            setQrState("生成失败：" + (e && e.message ? e.message : String(e)));
          } finally {
            setBusy(false);
          }
        };

        const pollQr = async (key, tries) => {
          if (tries > 60) {
            setQrState("二维码超时，重新生成吧");
            setQr(null);
            return;
          }
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const r = await call("/bili/qr/poll?key=" + encodeURIComponent(key));
            if (!r.ok) {
              setQrState("出错了：" + (r.error || "unknown"));
              return;
            }
            if (r.code === 0) {
              setQrState(r.verify_ok ? "登录成功 ✓ " + (r.verify_output || "").slice(0, 60) : "扫码已确认，账号验证未通过：" + (r.verify_output || "").slice(0, 120));
              setQr(null);
              await load();
              return;
            }
            if (r.code === 86090) setQrState("已扫码，请在手机上点确认");
            else if (r.code === 86038) {
              setQrState("二维码过期了，重新生成");
              setQr(null);
              return;
            }
            void pollQr(key, tries + 1);
          } catch (e) {
            setQrState("轮询失败：" + (e && e.message ? e.message : String(e)));
          }
        };

        const saveCfg = async (path, value) => {
          try {
            await call("/bili/cfg", { method: "POST", body: JSON.stringify({ path, value }) });
            const c = await call("/bili/cfg");
            setBiliCfg(c);
          } catch (e) {
            setErr(e && e.message ? e.message : String(e));
          }
        };

        const saveOwner = async () => {
          setBusy(true);
          setOwnerMsg(null);
          try {
            await call("/bili/owner", { method: "POST", body: JSON.stringify({ mid: ownerMid.trim(), name: ownerName.trim() }) });
            setOwnerMsg("已保存 ✓" + (ownerMid.trim() ? "（@ " + ownerMid.trim() + "）" : "（不 @）"));
            await load();
          } catch (e) {
            setOwnerMsg("保存失败：" + (e && e.message ? e.message : String(e)));
          } finally {
            setBusy(false);
          }
        };

        const doLogin = async () => {
          if (!sessdata.trim()) {
            setLoginMsg("SESSDATA 必填");
            return;
          }
          setBusy(true);
          setLoginMsg(null);
          try {
            const r = await call("/bili/login", {
              method: "POST",
              body: JSON.stringify({ sessdata: sessdata.trim(), bili_jct: biliJct.trim(), buvid3: buvid3.trim() }),
            });
            setLoginMsg(r.verify_ok ? "登录成功 ✓ " + (r.verify_output || "").slice(0, 80) : "已保存，但验证没通过：" + (r.verify_output || "").slice(0, 120));
            setSessdata("");
            setBiliJct("");
            setBuvid3("");
            await load();
          } catch (e) {
            setLoginMsg("失败：" + (e && e.message ? e.message : String(e)));
          } finally {
            setBusy(false);
          }
        };

        const toggle = async () => {
          if (!st) return;
          setBusy(true);
          try {
            await call("/bili/toggle", { method: "POST", body: JSON.stringify({ enabled: !st.enabled }) });
            await load();
          } catch (e) {
            setErr(e && e.message ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        };

        const toggleTool = async (cmd) => {
          if (!biliTools) return;
          const cur = (biliTools.tools || []).find((x) => x.cmd === cmd);
          setBusy(true);
          try {
            const r = await call("/bili/tools", { method: "POST", body: JSON.stringify({ cmd, enabled: !(cur && cur.enabled) }) });
            setBiliTools(r);
          } catch (e) {
            setErr(e && e.message ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        };

        const toggleMouth = async (key) => {
          if (!st) return;
          setBusy(true);
          try {
            const cur = st[key];
            await call("/bili/toggle", { method: "POST", body: JSON.stringify({ key, value: !cur }) });
            await load();
          } catch (e) {
            setErr(e && e.message ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        };

        const runTest = async () => {
          setBusy(true);
          setTest(null);
          try {
            const r = await call("/bili/feed");
            setTest(r);
          } catch (e) {
            setTest({ ok: false, error: e && e.message ? e.message : String(e) });
          } finally {
            setBusy(false);
          }
        };

        if (!st) {
          return h("div", { className: "dsh-remembers-settings", style: S.wrap },
            err ? h("div", { style: S.notice("error") }, "读取失败：" + err) : h("div", { style: S.muted }, "读取中…"));
        }

        return h("fieldset", { ref: sectionRef, className: "dsh-remembers-settings", disabled: busy, style: { ...S.wrap, minWidth: 0, border: 0, margin: 0 } },
          h("div", { style: { ...S.footer, position: "sticky", top: 0, zIndex: 2, background: "var(--dsw-alias-bg-layer-1)", padding: "8px 0" } },
            savedAt ? h("span", { style: S.muted }, "已保存 " + savedAt) : null,
            h("button", { style: S.btn(true), onClick: () => void saveAll(), disabled: busy }, busy ? "保存中…" : "保存")),
          h("div", { style: S.desc },
            "给她一个 B 站账号，沿用当前人设读私信、刷视频和参与评论。是否发言、每天发多少，由下面的开关和数量控制。",
          ),

          err ? h("div", { style: S.notice("error") }, err) : null,

          h("div", { style: S.card },
            h("div", { style: S.row },
              h("span", { style: { fontSize: 13, fontWeight: 500 } }, "账号："),
              h("span", { style: S.muted }, st.logged_in ? "已登录 ✓" : "未登录（只能刷公开热门）"),
            ),
            h("div", { style: { ...S.desc, fontSize: 12 } },
              st.logged_in ? "已登录，可以刷她自己的推荐了。" : "填 SESSDATA 登录（浏览器 F12 → Application → Cookies → bilibili.com 里复制）。",
            ),
            !st.logged_in ? h("div", { style: { display: "flex", flexDirection: "column", gap: 8, marginTop: 6 } },
              h("div", { style: S.row },
                h("button", { style: S.btn(true), onClick: () => void startQr(), disabled: busy }, "扫码登录"),
                qrState ? h("span", { style: S.muted }, qrState) : null,
              ),
              qr ? h("img", { src: qr.svg, style: { width: 180, height: 180, alignSelf: "center", background: "#fff", borderRadius: 8 } }) : null,
              h("details", { style: { marginTop: 4 } },
                h("summary", { style: { ...S.muted, cursor: "pointer" } }, "或者手动填 cookie（高级）"),
                h("div", { style: { display: "flex", flexDirection: "column", gap: 8, marginTop: 8 } },
                  h("input", { style: S.input, placeholder: "SESSDATA（必填）", value: sessdata, onChange: (ev) => setSessdata(ev.target.value) }),
                  h("div", { style: { display: "flex", gap: 8 } },
                    h("input", { style: S.input, placeholder: "bili_jct（可选）", value: biliJct, onChange: (ev) => setBiliJct(ev.target.value) }),
                    h("input", { style: S.input, placeholder: "buvid3（可选）", value: buvid3, onChange: (ev) => setBuvid3(ev.target.value) }),
                  ),
                  h("div", { style: S.row },
                    h("button", { style: S.btn(false), onClick: () => void doLogin(), disabled: busy }, busy ? "验证中…" : "保存并验证"),
                    loginMsg ? h("span", { style: S.muted }, loginMsg) : null,
                  ),
                ),
              ),
            ) : null,
          ),

          h("label", { style: {
            display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer",
            padding: "14px 16px", borderRadius: 12,
            border: "1.5px solid " + (st.enabled ? "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "var(--dsw-alias-border-l4)"),
            background: st.enabled ? "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))" : "var(--dsw-alias-bg-layer-1)",
            transition: "border-color .15s, background .15s",
          } },
            h("input", { type: "checkbox", checked: !!st.enabled, onChange: () => void toggle(), disabled: busy, style: { marginTop: 3 } }),
            h("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
              h("span", { style: { fontSize: 13, fontWeight: 500 } }, "B 站功能总开关"),
              h("span", { style: { ...S.muted, fontSize: 12 } },
                "关闭后暂停 B 站自动任务；要恢复自动活动，还需开启下方的“自动执行 B 站任务”。此开关修改后立即生效。"),
            ),
          ),

          h(BiliAutomationPanel, { value: automation, status: automationStatus, running: automationRunning, writeBudget, writeUsage,
            onWriteBudgetChange: (key, value) => { setWriteBudget(previous => ({ ...previous, [key]: value })); setSavedAt(null); },
            onChange: value => { setAutomation(value); setSavedAt(null); }, onRun: runAutomation }),

          biliTools ? h("div", { style: S.card },
            h("div", { style: S.label }, "她能用的 B 站工具"),
            h("div", { style: { ...S.muted, marginBottom: 8 } },
              "勾上的命令她才能调。只读的默认开着，写操作（评论/私信/弹幕）默认关——想让她能说再打开。"),
            h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, alignItems: "stretch" } },
              ...(biliTools.tools || []).map((tool) =>
                h("label", {
                  key: tool.cmd,
                  style: {
                    display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer",
                    padding: "10px 12px", borderRadius: 8, height: "100%", boxSizing: "border-box",
                    border: "1.5px solid " + (tool.enabled ? "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "var(--dsw-alias-border-l4)"),
                    background: tool.enabled ? "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))" : "var(--dsw-alias-bg-layer-1)",
                    transition: "border-color .15s, background .15s",
                  },
                },
                  h("input", {
                    type: "checkbox",
                    checked: !!tool.enabled,
                    onChange: () => void toggleTool(tool.cmd),
                    style: { marginTop: 3, flexShrink: 0 },
                  }),
                  h("span", { style: { display: "flex", flexDirection: "column", minWidth: 0 } },
                    h("span", { style: { fontSize: 13, fontWeight: tool.enabled ? 500 : 400 } },
                      tool.cmd + (tool.write ? "（写）" : "")),
                    h("span", { style: { ...S.muted, fontSize: 12 } }, tool.desc),
                  ),
                ),
              ),
            ),
          ) : null,

          h("div", { style: S.card },
            h("div", { style: S.label }, "你在 B 站的 UID"),
            h("div", { style: { ...S.muted, marginBottom: 6 } },
              "她在评论区主动分享时 @ 谁。填你自己的 B 站 UID（个人主页地址里 space.bilibili.com/ 后面那串数字）。不填就不 @。"),
            h("div", { style: { display: "flex", gap: 8 } },
              h("input", { style: S.input, placeholder: "你的 B 站 UID（数字）", value: ownerMid, onChange: (ev) => { setOwnerMid(ev.target.value); setSavedAt(null); } }),
              h("input", { style: S.input, placeholder: "昵称（可选）", value: ownerName, onChange: (ev) => { setOwnerName(ev.target.value); setSavedAt(null); } }),
            ),
            ownerMsg ? h("div", { style: { fontSize: 12, color: ownerMsg.includes("失败") ? "color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, var(--dsw-alias-label-primary))" : "color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, var(--dsw-alias-label-primary))", marginTop: 6 } }, ownerMsg) : null,
          ),

          biliCfg ? (() => {
            const f = biliForm;
            const set = (k, v) => { setBiliForm({ ...f, [k]: v }); setSavedAt(null); };
            const split = (s) => String(s || "").split(/[,，]/).map((x) => x.trim()).filter(Boolean);
            return h("div", { style: S.card },
              h("div", { style: S.label }, "更多设置（她刷 B 站的偏好）"),

              h("div", { style: { ...S.desc, marginTop: 4, fontWeight: 500, fontSize: 12 } }, "口味（点标签选，或自己加）"),
              h("div", { style: { ...S.muted, fontSize: 12, marginBottom: 4 } }, "决定 feed 给她推什么。选中的会高亮，保存后生效。"),

              h("div", { style: { ...S.muted, fontSize: 11, marginTop: 4 } }, "爱看（优先推这类）"),
              h(TagPicker, {
                presets: PRESET_LIKE,
                value: Array.isArray(f.like) ? f.like : [],
                onChange: (v) => set("like", v),
                placeholder: "自己加一个（回车）",
              }),

              h("div", { style: { ...S.muted, fontSize: 11, marginTop: 10 } }, "不爱看（选题时避开）"),
              h(TagPicker, {
                presets: PRESET_DISLIKE,
                value: Array.isArray(f.dislike) ? f.dislike : [],
                onChange: (v) => set("dislike", v),
                placeholder: "自己加一个（回车）",
              }),

            );
          })() : null,

          h("div", { style: S.card },
            h("div", { style: S.label }, "测试一下她能刷到什么"),
            h("div", { style: S.row },
              h("button", { style: S.btn(false), onClick: () => void runTest(), disabled: busy }, busy ? "刷…" : "刷一下 B 站"),
            ),
            test ? h("div", { style: { ...S.desc, marginTop: 8, whiteSpace: "pre-wrap" } },
              test.ok
                ? "来源：" + (test.source || "?") + "\n" + (test.items || []).map((i) => (i.title || i) + (i.url ? "  " + i.url : "")).join("\n")
                : "失败：" + (test.error || "unknown"))
              : null,
          ),
        );
      }

      // ---------------------------------------------------------------------
      // 记忆：她记得的所有东西（L0-L4），能筛能搜
      // ---------------------------------------------------------------------
      function MemoriesSection() {
        const [data, setData] = React.useState(null);
        const [emotionList, setEmotionList] = React.useState(null);
        const [activityList, setActivityList] = React.useState(null);
        const [activityDate, setActivityDate] = React.useState("");
        const [browseList, setBrowseList] = React.useState(null);
        const [notesList, setNotesList] = React.useState(null);
        const [slangList, setSlangList] = React.useState(null);
        const [tasksList, setTasksList] = React.useState(null);
        const [stateInfo, setStateInfo] = React.useState(null);
        const [selfModel, setSelfModel] = React.useState(null);
        const [mode, setMode] = React.useState("memory");
        const [tier, setTier] = React.useState("all");
        const [q, setQ] = React.useState("");
        const [busy, setBusy] = React.useState(false);
        const [err, setErr] = React.useState(null);

        const TIERS = {
          all: "全部",
          L0: "原话",
          L1: "事实",
          L2: "画像",
          L3: "事件",
          L4: "里程碑",
        };

        const loadActivity = async (date) => {
          setBusy(true); setErr(null);
          try {
            const qs = date ? ("?date=" + encodeURIComponent(date)) : "?limit=200";
            const r = await call("/activity" + qs);
            setActivityList(Array.isArray(r) ? r : []);
          } catch (e) {
            setErr(e && e.message ? e.message : String(e));
            setActivityList([]);
          } finally { setBusy(false); }
        };

        const loadBrowse = async () => {
          setBusy(true); setErr(null);
          try { const r = await call("/browse"); setBrowseList(Array.isArray(r) ? r : []); }
          catch (e) { setErr(e && e.message ? e.message : String(e)); setBrowseList([]); }
          finally { setBusy(false); }
        };

        const loadNotes = async () => {
          setBusy(true); setErr(null);
          try { const r = await call("/notes"); setNotesList(Array.isArray(r) ? r : []); }
          catch (e) { setErr(e && e.message ? e.message : String(e)); setNotesList([]); }
          finally { setBusy(false); }
        };

        const loadSlang = async () => {
          setBusy(true); setErr(null);
          try { const r = await call("/slang"); setSlangList(Array.isArray(r) ? r : []); }
          catch (e) { setErr(e && e.message ? e.message : String(e)); setSlangList([]); }
          finally { setBusy(false); }
        };

        const loadTasks = async () => {
          setBusy(true); setErr(null);
          try { const r = await call("/tasks"); setTasksList(Array.isArray(r) ? r : []); }
          catch (e) { setErr(e && e.message ? e.message : String(e)); setTasksList([]); }
          finally { setBusy(false); }
        };

        const loadState = async () => {
          setBusy(true); setErr(null);
          try { const r = await call("/state"); setStateInfo(r); }
          catch (e) { setErr(e && e.message ? e.message : String(e)); }
          finally { setBusy(false); }
        };

        const loadSelfModel = async () => {
          setBusy(true); setErr(null);
          try { const r = await call("/persona"); setSelfModel(r.self_model || ""); }
          catch (e) { setErr(e && e.message ? e.message : String(e)); }
          finally { setBusy(false); }
        };

        const loadEmotion = async () => {
          setBusy(true);
          setErr(null);
          try {
            const r = await call("/emotion?limit=200");
            setEmotionList(Array.isArray(r) ? r : []);
          } catch (e) {
            setErr(e && e.message ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        };

        const [memCfg, setMemCfg] = React.useState(null);
        const [memCfgMsg, setMemCfgMsg] = React.useState(null);

        const loadMemCfg = async () => {
          try {
            const c = await call("/config");
            const cur = (c && c.current) || {};
            setMemCfg({
              extract: !!cur.extract,
              surprisal_threshold: cur.surprisal_threshold != null ? cur.surprisal_threshold : 0.35,
              emotion_threshold: cur.emotion_threshold != null ? cur.emotion_threshold : 0.2,
              diary_enabled: cur.diary_enabled !== false,
              evolve_enabled: cur.evolve_enabled !== false,
              episode_enabled: cur.episode_enabled !== false,
            });
          } catch (e) {
            setMemCfgMsg("读取失败：" + (e && e.message ? e.message : String(e)));
          }
        };

        const patchMemCfg = async (patch) => {
          const next = { ...(memCfg || {}), ...patch };
          setMemCfg(next);
          try {
            await call("/config", { method: "POST", body: JSON.stringify(patch) });
            setMemCfgMsg(null);
          } catch (e) {
            setMemCfgMsg("保存失败：" + (e && e.message ? e.message : String(e)));
          }
        };

        const load = async (t, query) => {
          setBusy(true);
          setErr(null);
          try {
            const params = new URLSearchParams();
            params.set("tier", t || tier);
            params.set("limit", "200");
            if ((query ?? q).trim()) params.set("q", (query ?? q).trim());
            setData(await call("/memories?" + params.toString()));
          } catch (e) {
            setErr(e && e.message ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        };

        React.useEffect(() => {
          void load("all", "");
          void loadState();
          void loadMemCfg();
        }, []);

        const fmt = (ts) => {
          if (!ts) return "";
          const d = new Date(ts * 1000);
          const pad = (n) => String(n).padStart(2, "0");
          return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        };

        const tierColor = {
          L0: "var(--dsw-alias-label-secondary)",
          L1: "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))",
          L2: "color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, var(--dsw-alias-label-primary))",
          L3: "color-mix(in srgb, var(--dsw-alias-state-warn-label) 60%, var(--dsw-alias-label-primary))",
          L4: "var(--dsw-alias-label-primary-bluish)",
        };

        return h("div", { className: "dsh-remembers-settings", style: S.wrap },
          h("div", { style: S.desc },
            "她记得的所有东西。L0 是原话、L1 是事实、L2 是你的画像、L3 是发生过的事、L4 是里程碑和约定。",
          ),
          h("div", { style: S.card },
            h("div", { style: { ...S.label, marginBottom: 8 } }, "记忆开关"),
            h("label", {
              style: {
                display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer",
                padding: "10px 12px", borderRadius: 8,
                border: "1.5px solid " + (memCfg && memCfg.extract ? "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "var(--dsw-alias-border-l4)"),
                background: memCfg && memCfg.extract ? "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))" : "var(--dsw-alias-bg-layer-1)",
                transition: "border-color .15s, background .15s",
              },
            },
              h("input", {
                type: "checkbox",
                checked: !!(memCfg && memCfg.extract),
                onChange: (ev) => void patchMemCfg({ extract: ev.target.checked }),
                style: { marginTop: 2 },
              }),
              h("span", { style: { display: "flex", flexDirection: "column", gap: 3 } },
                h("span", { style: { fontSize: 13, fontWeight: 500 } }, "自动提炼记忆（L1-L4）"),
                h("span", { style: { ...S.muted, fontSize: 12 } },
                  "开着：每轮用对话模型从聊天里提炼事实/画像/事件，多两次模型调用（花钱）。"),
                h("span", { style: { ...S.muted, fontSize: 12 } },
                  "关掉：聊天不再产生新的提炼记忆（原话 L0 仍按惊讶阈值记录），日记/自我认知照常。"),
              ),
            ),
            h("div", { style: { marginTop: 14 } },
              h("div", { style: { ...S.label, marginBottom: 8 } }, "她用不用这些能力（都烧 token）"),
              h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 } },
                ...[
                  ["diary_enabled", "写日记", "每天 23:00 把当天的事写成第一人称日记"],
                  ["evolve_enabled", "演化自我认知", "每 30 轮悟一句「我发现自己……」"],
                  ["episode_enabled", "事件总结", "长对话攒够后压成一条「这段时间发生了什么」"],
                ].map(([key, label, desc]) =>
                  h("label", {
                    key: key,
                    style: {
                      display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer",
                      padding: "10px 12px", borderRadius: 8,
                      border: "1.5px solid " + (memCfg && memCfg[key] ? "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "var(--dsw-alias-border-l4)"),
                      background: memCfg && memCfg[key] ? "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))" : "var(--dsw-alias-bg-layer-1)",
                      transition: "border-color .15s, background .15s",
                    },
                  },
                    h("input", {
                      type: "checkbox",
                      checked: !!(memCfg && memCfg[key]),
                      onChange: (ev) => void patchMemCfg({ [key]: ev.target.checked }),
                      style: { marginTop: 2, flexShrink: 0 },
                    }),
                    h("span", { style: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 } },
                      h("span", { style: { fontSize: 13, fontWeight: memCfg && memCfg[key] ? 500 : 400 } }, label),
                      h("span", { style: { ...S.muted, fontSize: 11 } }, desc),
                    ),
                  ),
                ),
              ),
            ),
            h("div", { style: { marginTop: 14 } },
              h("div", { style: { ...S.label, marginBottom: 4 } }, "原文记多细（L0 惊讶阈值）"),
              h("div", { style: { ...S.muted, fontSize: 12, marginBottom: 8 } },
                "她说的每句话都要和上文比一次「差多远」，过线才存原文。选一档，即时生效。"),
              h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 } },
                ...[
                  [0.15, "全都记", "连「嗯」「好的」都存，原话最全但最占地方"],
                  [0.25, "宽松", "日常闲聊基本都记，只跳过重复的"],
                  [0.35, "平衡（默认）", "跳过寒暄和重复，正常的都记"],
                  [0.5, "严格", "只记有明显变化的话，细节会漏一些"],
                  [0.7, "只记大事", "情绪重、有转折的才记，平时基本不留原话"],
                ].map(([v, label, desc]) =>
                  h("label", {
                    key: "th" + v,
                    style: {
                      display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer",
                      padding: "10px 12px", borderRadius: 8,
                      border: "1.5px solid " + (memCfg && Math.abs(Number(memCfg.surprisal_threshold) - v) < 0.02 ? "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "var(--dsw-alias-border-l4)"),
                      background: memCfg && Math.abs(Number(memCfg.surprisal_threshold) - v) < 0.02 ? "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))" : "var(--dsw-alias-bg-layer-1)",
                      transition: "border-color .15s, background .15s",
                    },
                  },
                    h("input", {
                      type: "radio",
                      name: "surprisal",
                      checked: !!(memCfg && Math.abs(Number(memCfg.surprisal_threshold) - v) < 0.02),
                      onChange: () => void patchMemCfg({ surprisal_threshold: v }),
                      style: { marginTop: 2, flexShrink: 0 },
                    }),
                    h("span", { style: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 } },
                      h("span", { style: { fontSize: 13, fontWeight: memCfg && Math.abs(Number(memCfg.surprisal_threshold) - v) < 0.02 ? 500 : 400 } },
                        label + "（" + v + "）"),
                      h("span", { style: { ...S.muted, fontSize: 11 } }, desc),
                    ),
                  ),
                ),
              ),
            ),
            h("div", { style: { marginTop: 14 } },
              h("div", { style: { ...S.label, marginBottom: 4 } }, "情绪记多细（emotion_log）"),
              h("div", { style: { ...S.muted, fontSize: 12, marginBottom: 8 } },
                "她有多容易被你的话带动情绪。太低会记一堆小事，太高什么都不记。"),
              h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 } },
                ...[
                  [0.1, "极度敏感", "连「嗯」「随便」都能记出情绪，库涨得最快"],
                  [0.2, "敏感（默认）", "一点小情绪就记，日常起伏都留得住"],
                  [0.3, "平衡", "有明确情绪才记，闲聊不占地方"],
                  [0.5, "克制", "只有明显的高兴/难过/烦躁才记"],
                  [0.7, "只记大情绪", "情绪很重才记，平时基本空白"],
                ].map(([v, label, desc]) =>
                  h("label", {
                    key: "em" + v,
                    style: {
                      display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer",
                      padding: "10px 12px", borderRadius: 8,
                      border: "1.5px solid " + (memCfg && Math.abs(Number(memCfg.emotion_threshold) - v) < 0.02 ? "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "var(--dsw-alias-border-l4)"),
                      background: memCfg && Math.abs(Number(memCfg.emotion_threshold) - v) < 0.02 ? "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))" : "var(--dsw-alias-bg-layer-1)",
                      transition: "border-color .15s, background .15s",
                    },
                  },
                    h("input", {
                      type: "radio",
                      name: "emotion_threshold",
                      checked: !!(memCfg && Math.abs(Number(memCfg.emotion_threshold) - v) < 0.02),
                      onChange: () => void patchMemCfg({ emotion_threshold: v }),
                      style: { marginTop: 2, flexShrink: 0 },
                    }),
                    h("span", { style: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 } },
                      h("span", { style: { fontSize: 13, fontWeight: memCfg && Math.abs(Number(memCfg.emotion_threshold) - v) < 0.02 ? 500 : 400 } },
                        label + "（" + v + "）"),
                      h("span", { style: { ...S.muted, fontSize: 11 } }, desc),
                    ),
                  ),
                ),
              ),
            ),
            memCfgMsg ? h("div", { style: { fontSize: 12, color: "color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, var(--dsw-alias-label-primary))", marginTop: 6 } }, memCfgMsg) : null,
          ),



          err ? h("div", { style: S.notice("error") }, err) : null,

          // 她的状态（常驻顶部，不用点 tab）
          h("div", { style: S.card },
            h("div", { style: { ...S.label, marginBottom: 6 } }, "她现在"),
            stateInfo ? h("div", {},
              h("div", { style: { display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, marginBottom: 6 } },
                h("span", {}, "心情：" + (stateInfo.mood || "normal")),
                h("span", {}, "亲密度：" + Math.round(Number(stateInfo.intimacy) || 0) + "/1000"),
                stateInfo.stage && stateInfo.stage.name ? h("span", {}, "阶段：" + stateInfo.stage.name) : null,
              ),
              stateInfo.activity ? h("div", { style: { ...S.muted, marginBottom: 4 } }, "在干嘛：" + stateInfo.activity) : null,
              stateInfo.weather ? h("div", { style: { ...S.muted, marginBottom: 4 } }, "外面：" + stateInfo.weather) : null,
              h("div", { style: { ...S.muted } },
                "小游戏：" + (stateInfo.game_score || 0) + " 分（玩了 " + (stateInfo.game_plays || 0) + " 次）"),
            ) : h("div", { style: S.muted }, "读取中…"),
          ),

          data ? h("div", { style: S.card },
            h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", minHeight: 66, alignContent: "flex-start" } },
              Object.entries(TIERS).map(([k, label]) =>
                h("button", {
                  key: k,
                  style: { ...S.btn(mode === "memory" && tier === k), padding: "4px 10px", fontSize: 12 },
                  onClick: () => { setMode("memory"); setTier(k); void load(k, q); },
                }, label + (k !== "all" && data.counts && data.counts[k] != null ? ` ${data.counts[k]}` : "")),
              ),
              h("button", {
                style: { ...S.btn(mode === "emotion"), padding: "4px 10px", fontSize: 12 },
                onClick: () => { setMode("emotion"); void loadEmotion(); },
              }, "情感" + (emotionList ? ` ${emotionList.length}` : "")),
              h("button", {
                style: { ...S.btn(mode === "activity"), padding: "4px 10px", fontSize: 12 },
                onClick: () => { setMode("activity"); void loadActivity(activityDate); },
              }, "今天干了什么"),
              h("button", {
                style: { ...S.btn(mode === "browse"), padding: "4px 10px", fontSize: 12 },
                onClick: () => { setMode("browse"); void loadBrowse(); },
              }, "见闻" + (browseList ? ` ${browseList.length}` : "")),
              h("button", {
                style: { ...S.btn(mode === "notes"), padding: "4px 10px", fontSize: 12 },
                onClick: () => { setMode("notes"); void loadNotes(); },
              }, "便签" + (notesList ? ` ${notesList.length}` : "")),
              h("button", {
                style: { ...S.btn(mode === "slang"), padding: "4px 10px", fontSize: 12 },
                onClick: () => { setMode("slang"); void loadSlang(); },
              }, "学会的词" + (slangList ? ` ${slangList.length}` : "")),
              h("button", {
                style: { ...S.btn(mode === "tasks"), padding: "4px 10px", fontSize: 12 },
                onClick: () => { setMode("tasks"); void loadTasks(); },
              }, "互相派的活" + (tasksList ? ` ${tasksList.length}` : "")),

              h("button", {
                style: { ...S.btn(mode === "self"), padding: "4px 10px", fontSize: 12 },
                onClick: () => { setMode("self"); void loadSelfModel(); },
              }, "自我认知"),
            ),
            h("div", { style: { display: "flex", gap: 8, marginTop: 8 } },
              h("input", {
                style: S.input,
                placeholder: "搜记忆内容…",
                value: q,
                onChange: (ev) => setQ(ev.target.value),
                onKeyDown: (ev) => { if (ev.key === "Enter") void load(tier, q); },
              }),
              h("button", { style: S.btn(true), onClick: () => void load(tier, q), disabled: busy }, busy ? "查…" : "搜索"),
            ),
            h("div", { style: { ...S.muted, marginTop: 6 } },
              `显示 ${data.items ? data.items.length : 0} / ${data.total} 条`),
          ) : h("div", { style: S.muted }, "读取中…"),

          mode === "state" ? (
            stateInfo ? h("div", { style: S.card },
              h("div", { style: { ...S.label, marginBottom: 8 } }, "她现在"),
              h("div", { style: { display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, marginBottom: 8 } },
                h("span", {}, "心情：" + (stateInfo.mood || "normal")),
                h("span", {}, "亲密度：" + Math.round(Number(stateInfo.intimacy) || 0) + "/1000"),
                stateInfo.stage && stateInfo.stage.name ? h("span", {}, "阶段：" + stateInfo.stage.name) : null,
              ),
              stateInfo.activity ? h("div", { style: { ...S.muted, marginBottom: 6 } }, "在干嘛：" + stateInfo.activity) : null,
              stateInfo.weather ? h("div", { style: { ...S.muted, marginBottom: 6 } }, "外面：" + stateInfo.weather) : null,
              h("div", { style: { ...S.muted, marginBottom: 6 } },
                "小游戏：" + (stateInfo.game_score || 0) + " 分（玩了 " + (stateInfo.game_plays || 0) + " 次）"),
              stateInfo.stage && stateInfo.stage.hint
                ? h("div", { style: { ...S.muted } }, "这个阶段的样子：" + stateInfo.stage.hint)
                : null,
            ) : h("div", { style: S.muted }, "读取中…")
          ) : mode === "self" ? (
            selfModel
              ? h("div", { style: S.card },
                  h("div", { style: { ...S.label, marginBottom: 8 } }, "她对自己的认知"),
                  h("div", { style: { fontSize: 13, lineHeight: 1.75, whiteSpace: "pre-wrap" } }, selfModel),
                )
              : h("div", { style: S.muted }, selfModel === null ? "读取中…" : "还没形成自我认知（每天 22:00 演化一次）")
          ) : mode === "activity" ? (
            h("div", {},
              h("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" } },
                h("span", { style: { ...S.muted, fontSize: 12 } }, "看哪天："),
                h("input", {
                  type: "date",
                  style: { ...S.input, width: 150 },
                  value: activityDate,
                  onChange: (ev) => { setActivityDate(ev.target.value); void loadActivity(ev.target.value); },
                }),
                h("button", {
                  style: { ...S.btn(false), padding: "4px 10px", fontSize: 12 },
                  onClick: () => { setActivityDate(""); void loadActivity(""); },
                }, "最近 200 条"),
              ),
              activityList && activityList.length > 0
                ? h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
                    activityList.map((a, i) => {
                      const d = new Date((a.ts || 0) * 1000);
                      const pad = (n) => String(n).padStart(2, "0");
                      const when = pad(d.getHours()) + ":" + pad(d.getMinutes());
                      const kindColor = { chat: "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))", bili: "color-mix(in srgb, var(--dsw-alias-state-warn-label) 60%, var(--dsw-alias-label-primary))", proactive: "var(--dsw-alias-label-primary-bluish)", game: "color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, var(--dsw-alias-label-primary))", other: "var(--dsw-alias-label-secondary)" };
                      const tone = kindColor[a.kind] || "var(--dsw-alias-label-secondary)";
                      const kindLabel = { chat: "聊天", bili: "B 站", proactive: "主动找你", game: "游戏" };
                      return h("div", { key: i, style: { ...S.card, padding: "8px 12px", borderLeft: "3px solid " + tone } },
                        h("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
                          h("span", { style: { fontSize: 11, fontWeight: 500, padding: "1px 7px", borderRadius: 999, background: "color-mix(in srgb, " + tone + " 14%, transparent)", color: tone } }, kindLabel[a.kind] || a.kind || "其他"),
                          h("span", { style: { ...S.muted, fontSize: 11 } }, when),
                          h("span", { style: { fontSize: 13, lineHeight: 1.6 } }, a.detail || ""),
                        ),
                        a.thought
                          ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)", marginTop: 4, paddingLeft: 10, fontStyle: "italic", borderLeft: "2px solid color-mix(in srgb, " + tone + " 30%, transparent)" } }, "「" + a.thought + "」")
                          : null,
                      );
                    }),
                  )
                : h("div", { style: S.muted }, activityList ? "这天没做什么" : "读取中…"),
            )
          ) : mode === "browse" ? (
            browseList && browseList.length > 0
              ? h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
                  browseList.map((b, i) =>
                    h("div", { key: i, style: { ...S.card, padding: "8px 12px", borderLeft: "3px solid color-mix(in srgb, var(--dsw-alias-state-warn-label) 60%, var(--dsw-alias-label-primary))" } },
                      h("div", { style: { fontSize: 13, lineHeight: 1.6 } }, b.title || ""),
                      b.url ? h("div", { style: { ...S.muted, fontSize: 11, marginTop: 2 } }, b.url) : null,
                    ),
                  ),
                )
              : h("div", { style: S.muted }, browseList ? "还没刷到什么" : "读取中…")
          ) : mode === "notes" ? (
            notesList && notesList.length > 0
              ? h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
                  notesList.map((n) =>
                    h("div", { key: n.id, style: { ...S.card, padding: "10px 12px", borderLeft: "3px solid var(--dsw-alias-label-primary-bluish)" } },
                      h("div", { style: { ...S.muted, fontSize: 11, marginBottom: 4 } }, (n.author || "她") + " · " + (n.date || "")),
                      h("div", { style: { fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" } }, n.text || ""),
                    ),
                  ),
                )
              : h("div", { style: S.muted }, notesList ? "还没记过便签" : "读取中…")
          ) : mode === "slang" ? (
            slangList && slangList.length > 0
              ? h("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 } },
                  slangList.map((s, i) =>
                    h("span", {
                      key: i,
                      style: { fontSize: 12, padding: "2px 10px", borderRadius: 999, border: "1px solid var(--dsw-alias-border-l4)", background: "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))" },
                    }, (s.phrase || s.word || "") + " ×" + (s.count || 0)),
                  ),
                )
              : h("div", { style: S.muted }, slangList ? "还没学会什么词" : "读取中…")
          ) : mode === "tasks" ? (
            tasksList && tasksList.length > 0
              ? h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
                  tasksList.map((k) =>
                    h("div", { key: k.id, style: { ...S.card, padding: "8px 12px", borderLeft: "3px solid " + (k.done ? "color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, var(--dsw-alias-label-primary))" : "color-mix(in srgb, var(--dsw-alias-state-warn-label) 60%, var(--dsw-alias-label-primary))"), opacity: k.done ? 0.7 : 1 } },
                      h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
                        h("span", { style: { fontSize: 11, fontWeight: 500, color: k.done ? "color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, var(--dsw-alias-label-primary))" : "color-mix(in srgb, var(--dsw-alias-state-warn-label) 60%, var(--dsw-alias-label-primary))" } }, k.done ? "✓ 已完成" : "待办"),
                        h("span", { style: { fontSize: 13, lineHeight: 1.6, flex: 1 } }, k.text || ""),
                        h("span", { style: { ...S.muted, fontSize: 11 } }, "+" + (k.points || 0) + " 分"),
                      ),
                    ),
                  ),
                )
              : h("div", { style: S.muted }, tasksList ? "还没有互相派的活" : "读取中…")
          ) : mode === "emotion" ? (
            emotionList && emotionList.length > 0 ? h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
              emotionList.map((e) => {
                const v = Number(e.valence) || 0;
                const tone = v > 0.2 ? "color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, var(--dsw-alias-label-primary))" : v < -0.2 ? "color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, var(--dsw-alias-label-primary))" : "var(--dsw-alias-label-secondary)";
                const d = new Date((e.ts || 0) * 1000);
                const pad = (n) => String(n).padStart(2, "0");
                const when = `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
                return h("div", { key: e.id, style: { ...S.card, padding: "10px 12px", borderLeft: "3px solid " + tone } },
                  h("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 } },
                    h("span", { style: { fontSize: 11, fontWeight: 500, padding: "1px 7px", borderRadius: 999, background: "color-mix(in srgb, " + tone + " 14%, transparent)", color: tone } }, e.label || "情绪"),
                    h("span", { style: { ...S.muted, fontSize: 11 } }, when),
                    h("span", { style: { ...S.muted, fontSize: 11 } }, `v=${v.toFixed(2)} a=${(Number(e.arousal) || 0).toFixed(2)}`),
                    h("span", { style: { ...S.muted, fontSize: 11 } }, e.source || ""),
                  ),
                  h("div", { style: { fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" } }, e.trigger || "（没有记录原因）"),
                );
              }),
            ) : h("div", { style: S.muted }, emotionList ? "还没有情感记录（聊几句，情绪有波动就会记）" : "读取中…")
          ) : data && data.items && data.items.length > 0 ? h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
            data.items.map((m) => h("div", {
              key: m.id,
              style: { ...S.card, padding: "10px 12px" },
            },
              h("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 } },
                h("span", {
                  style: {
                    fontSize: 11, fontWeight: 500, padding: "1px 7px", borderRadius: 999,
                    background: "color-mix(in srgb, " + (tierColor[m.tier] || "var(--dsw-alias-label-secondary)") + " 14%, transparent)",
                    color: tierColor[m.tier] || "var(--dsw-alias-label-secondary)",
                  },
                }, (TIERS[m.tier] || m.tier) + " " + m.tier),
                h("span", { style: { ...S.muted, fontSize: 11 } }, fmt(m.ts)),
                m.tags && m.tags.length ? h("span", { style: { ...S.muted, fontSize: 11 } },
                  m.tags.filter((x) => x !== "extracted" && x !== "raw").slice(0, 3).join(" · ")) : null,
              ),
              h("div", { style: { fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" } }, m.text),
              m.summary ? h("div", { style: { ...S.muted, fontSize: 12, marginTop: 4 } }, "摘要：" + m.summary) : null,
            )),
          ) : (data ? h("div", { style: S.muted }, "没有匹配的记忆") : null),
        );
      }

      function QqSection() {
                const [profiles, setProfiles] = React.useState([]);
        // 默认展开：这块藏起来的话根本没人找得到编辑入口
        const [profilesOpen, setProfilesOpen] = React.useState(true);
        // 每个人手编画像的草稿：user_id -> 正在编辑的文本
        const [profileDrafts, setProfileDrafts] = React.useState({});
        // 「其他用户画像」里不该出现主人自己 —— 他的画像在「人格设定」页的「用户画像」里改
        // 排除主人自己，也排除非法 QQ 号（唤醒脚本注入的系统提醒是 user_id=0）
        const otherProfiles = (profiles || []).filter(
          (p) => !p.is_owner && /^\d{5,}$/.test(String(p.user_id || "")),
        );
const [data, setData] = React.useState(null);
        const [err, setErr] = React.useState(null);
        const [draft, setDraft] = React.useState({});
        const [saving, setSaving] = React.useState(false);
        const [notice, setNotice] = React.useState(null);
        const [fsOpen, setFsOpen] = React.useState(null);
        const [fsData, setFsData] = React.useState(null);
        const [fsErr, setFsErr] = React.useState(null);
        const [arrInput, setArrInput] = React.useState({});
        const [qqSessions, setQqSessions] = React.useState([]);
        const [chatMap, setChatMap] = React.useState({ binding: {}, retired: [] });
        const [sessionHistory, setSessionHistory] = React.useState({});   // chat -> {items, current}
        const [historyOpen, setHistoryOpen] = React.useState(null);        // 展开的 chat
        const [switchIdx, setSwitchIdx] = React.useState({});   // chat -> 输入框的值
        const [qqBind, setQqBind] = React.useState(null);   // 正在选会话重绑的 chat
        const [qqBusy, setQqBusy] = React.useState(false);
        const [qqMsg, setQqMsg] = React.useState(null);

        const browse = async (path) => {
          setFsErr(null);
          try {
            const r = await call("/fs/list?path=" + encodeURIComponent(path || ""));
            setFsData(r);
          } catch (e) {
            setFsErr(e && e.message ? e.message : String(e));
          }
        };

        const load = async () => {
          setErr(null);
          try {
            const r = await call("/qq/config");
            setData(r);
            try {
              setProfiles(((await call("/profiles")).profiles) || []);
            } catch { setProfiles([]); }
            try {
              const s = await call("/qq/sessions");
              setQqSessions((s && s.sessions) || []);
              try {
                const cm = await call("/qq/chat-map");
                setChatMap({
                  binding: (cm && cm.binding) || {},
                  retired: (cm && cm.retired) || [],
                });
              } catch (e) { /* 忽略 */ }
            } catch (e) { /* 会话列表失败不影响配置 */ }
          } catch (e) {
            setErr(e && e.message ? e.message : String(e));
          }
        };

        React.useEffect(() => { void load(); }, []);

        if (err) {
          return h("div", { className: "dsh-remembers-settings", style: S.wrap },
            h("div", { style: S.notice("error") }, "读取失败：" + err));
        }
        if (!data) {
          return h("div", { className: "dsh-remembers-settings", style: S.wrap }, h("div", { style: S.muted }, "读取配置…"));
        }

        const setField = (key, value) => {
          setDraft((d) => ({ ...(d || {}), [key]: value }));
          setNotice(null);
        };

        const dirty = draft && Object.keys(draft).length > 0;

        const save = async () => {
          if (!dirty) return;
          setSaving(true);
          setNotice(null);
          try {
            const r = await call("/qq/config", { method: "POST", body: JSON.stringify(draft) });
            if (r && r.ok) {
              setNotice({ kind: "ok", text: "已保存，" + (r.changed || []).length + " 项，" + (r.restarting ? "正在重启生效…" : "需手动重启生效") });
              setDraft({});
              await load();
            } else {
              setNotice({ kind: "error", text: "保存失败：" + JSON.stringify(r) });
            }
          } catch (err) {
            setNotice({ kind: "error", text: "保存失败：" + (err && err.message ? err.message : String(err)) });
          } finally {
            setSaving(false);
          }
        };

        const curVal = (f) => {
          if (draft && Object.prototype.hasOwnProperty.call(draft, f.key)) return draft[f.key];
          if (f.type === "secret") return "";
          return f.raw != null ? f.raw : f.display;
        };

        const control = (f) => {
          const v = curVal(f);
          if (f.type === "enum") {
            // 卡片式单选（enumCard）
            const opts = Object.entries(f.options || {});
            const big = true;   // 所有 enum 卡片统一大号
            return h("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 } },
              ...opts.map(([k, label]) => {
                const on = String(v) === String(k);
                return h("label", {
                  key: "enumCard-" + f.key + "-" + k,
                  style: {
                    display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                    padding: big ? "12px 16px" : "6px 10px", borderRadius: 8,
                    fontSize: big ? 14 : 12,
                    border: "1.5px solid " + (on ? "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "var(--dsw-alias-border-l4)"),
                    background: on ? "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))" : "var(--dsw-alias-bg-layer-1)",
                    transition: "border-color .15s, background .15s",
                    fontWeight: on ? 500 : 400,
                    flex: big ? "1 1 auto" : undefined,
                  },
                },
                  h("input", {
                    type: "radio",
                    name: "enum-" + f.key,
                    checked: on,
                    onChange: () => setField(
                      f.key,
                      f.key === "requireMention" ? (k === "true") : k
                    ),
                    style: { margin: 0, flexShrink: 0 },
                  }),
                  h("span", {}, label),
                );
              }),
            );
          }
          if (f.type === "boolean") {
            const on = v === true || v === "true";
            return h("label", {
              style: {
                display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                padding: "4px 8px", borderRadius: 6, alignSelf: "flex-start",
                border: "1.5px solid " + (on ? "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "var(--dsw-alias-border-l4)"),
                background: on ? "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))" : "var(--dsw-alias-bg-layer-1)",
              },
            },
              h("input", { type: "checkbox", checked: on, onChange: (ev) => setField(f.key, ev.target.checked) }),
              h("span", { style: { fontSize: 12 } }, on ? "开" : "关"),
            );
          }
          if (f.type === "number") {
            return h("input", {
              style: { ...S.input, padding: "4px 8px", fontSize: 12 },
              type: "number",
              value: v == null ? "" : String(v),
              onChange: (ev) => setField(f.key, Number(ev.target.value) || 0),
            });
          }
          if (f.type === "stringArray") {
            const arr = Array.isArray(v) ? v : String(v || "").split("\n").filter(Boolean);
            const addVal = arrInput[f.key] || "";
            const doAdd = () => {
              const x = addVal.trim();
              if (!x) return;
              setField(f.key, [...arr, x]);
              setArrInput((m) => ({ ...m, [f.key]: "" }));
            };
            return h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
              arr.length
                ? h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
                    ...arr.map((x, i) =>
                      h("div", {
                        key: "av" + i,
                        style: {
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "6px 10px", borderRadius: 8,
                          border: "1.5px solid color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))", background: "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))",
                        },
                      },
                        h("span", { style: { flex: 1, fontSize: 12, wordBreak: "break-all" } }, String(x)),
                        h("span", {
                          style: { cursor: "pointer", opacity: 0.55, fontSize: 14, lineHeight: "16px", padding: "0 4px" },
                          onClick: () => setField(f.key, arr.filter((_, j) => j !== i)),
                        }, "×"),
                      ),
                    ),
                  )
                : h("div", { style: { ...S.muted, fontSize: 11 } }, "（空 = 不允许任何人）"),
              h("div", { style: { display: "flex", gap: 6 } },
                h("input", {
                  style: { ...S.input, flex: 1, padding: "4px 8px", fontSize: 12 },
                  placeholder: f.key === "groupAllowFrom" ? "群号（在群设置里能看到）" : "QQ 号",
                  value: addVal,
                  onChange: (ev) => setArrInput((m) => ({ ...m, [f.key]: ev.target.value })),
                  onKeyDown: (ev) => { if (ev.key === "Enter") doAdd(); },
                }),
                h("button", { style: { ...S.btn(false), padding: "4px 10px", fontSize: 12 }, onClick: doAdd }, "加"),
              ),
            );
          }
          if (f.type === "dirpath") {
            const open = fsOpen === f.key;
            return h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
              h("div", { style: { display: "flex", gap: 6 } },
                h("input", {
                  style: { ...S.input, flex: 1, padding: "4px 8px", fontSize: 12, fontFamily: "monospace" },
                  value: String(v == null ? "" : v),
                  placeholder: "/home/ubuntu/qq-workspace",
                  onChange: (ev) => setField(f.key, ev.target.value),
                }),
                h("button", {
                  style: { ...S.btn(false), padding: "4px 10px", fontSize: 12, whiteSpace: "nowrap" },
                  onClick: () => {
                    const next = open ? null : f.key;
                    setFsOpen(next);
                    if (next) void browse(String(v || "/home/ubuntu"));
                  },
                }, open ? "收起" : "浏览…"),
              ),
              open ? h("div", {
                style: {
                  padding: "8px 10px", borderRadius: 8, border: "1px solid var(--dsw-alias-border-l4)",
                  background: "var(--dsw-alias-settings-card-fill)", display: "flex", flexDirection: "column", gap: 6,
                },
              },
                fsErr ? h("div", { style: { fontSize: 11, color: "color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, var(--dsw-alias-label-primary))" } }, fsErr) : null,
                fsData ? h("div", { style: { fontSize: 11, fontFamily: "monospace", wordBreak: "break-all" } }, fsData.path) : null,
                fsData ? h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
                  fsData.parent ? h("button", {
                    style: { ...S.btn(false), padding: "2px 8px", fontSize: 11 },
                    onClick: () => void browse(fsData.parent),
                  }, "↑ 上一级") : null,
                  h("button", {
                    style: { ...S.btn(true), padding: "2px 8px", fontSize: 11 },
                    onClick: () => { setField(f.key, fsData.path); setFsOpen(null); },
                  }, "✓ 选这个目录"),
                ) : null,
                fsData && fsData.dirs && fsData.dirs.length
                  ? h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, maxHeight: 160, overflowY: "auto" } },
                      ...fsData.dirs.map((d) =>
                        h("div", {
                          key: d.path,
                          style: {
                            cursor: "pointer", padding: "4px 8px", borderRadius: 6, fontSize: 11,
                            border: "1px solid var(--dsw-alias-border-l4)", background: "var(--dsw-alias-bg-layer-1)",
                          },
                          onClick: () => void browse(d.path),
                        }, "📁 " + d.name),
                      ),
                    )
                  : h("div", { style: { ...S.muted, fontSize: 11 } }, fsData ? "（没有子目录）" : "读取中…"),
              ) : null,
            );
          }
          if (f.type === "secret") {
            return h("input", {
              style: { ...S.input, padding: "4px 8px", fontSize: 12 },
              type: "password",
              placeholder: f.is_set ? "留空 = 不改" : "未设置",
              value: String(v || ""),
              onChange: (ev) => setField(f.key, ev.target.value),
            });
          }
          return h("input", {
            style: { ...S.input, padding: "4px 8px", fontSize: 12 },
            value: String(v == null ? "" : v),
            onChange: (ev) => setField(f.key, ev.target.value),
          });
        };

        return h("div", { className: "dsh-remembers-settings", style: S.wrap },
          h("div", { style: S.desc },
            "QQ 通道（dsh-onebot-qq）的全部 " + data.total + " 项配置，改完点保存。"
            + "文件：" + data.path + "（会自动备份 .bak-时间戳）",
          ),

          err ? h("div", { style: S.notice("error") }, err) : null,

          // QQ 会话列表（每个聊天一行，各自独立开新会话）
          h("div", { style: S.card },
            h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 } },
              h("span", { style: { ...S.label, margin: 0 } }, "QQ 会话"),
              qqMsg ? h("span", { style: { fontSize: 11, color: qqMsg.startsWith("失败") ? "color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, var(--dsw-alias-label-primary))" : "color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, var(--dsw-alias-label-primary))" } }, qqMsg) : null,
            ),
            h("div", { style: { ...S.muted, fontSize: 11, marginBottom: 8 } },
              "每个聊天各自一个上下文。开新会话只影响那一个，旧对话留在历史里（QQ 发 /session 切回）；记忆不受影响。"),
            qqSessions.length
              ? h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
                  ...qqSessions.map((x) => {
                    const isGroup = x.kind === "group";
                    const sizeKb = Math.round((x.size || 0) / 1024);
                    const dt = new Date((x.mtime || 0) * 1000);
                    const timeStr = dt.getFullYear() > 1970
                      ? (dt.getMonth() + 1) + "-" + dt.getDate() + " " + String(dt.getHours()).padStart(2, "0") + ":" + String(dt.getMinutes()).padStart(2, "0")
                      : "";
                    return h("div", {
                      key: x.chat,
                      style: {
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 12px", borderRadius: 8,
                        border: "1px solid var(--dsw-alias-border-l4)", background: "var(--dsw-alias-settings-card-fill)",
                      },
                    },
                      h("span", { style: { fontSize: 14 } }, isGroup ? "👥" : "💬"),
                      h("div", { style: { flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 } },
                        h("span", { style: { fontSize: 12, fontWeight: 500 } },
                          (isGroup ? "群 " : "私聊 ") + x.target),
                        h("span", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary)" } },
                          sizeKb + "K" + (timeStr ? " · 最后活跃 " + timeStr : "")
                          + (() => {
                              const b = (chatMap.binding || {})[x.chat];
                              if (!b) return " · 未绑定（下条消息新建）";
                              const short = String(b).replace(/^onebot-(private|group)-\d+-?/, "") || "当前";
                              return " · 当前：" + (short || "已绑定");
                            })()),
                      ),
                      h("div", { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" } },
                        h("button", {
                          style: { ...S.btn(true), padding: "4px 10px", fontSize: 12, whiteSpace: "nowrap" },
                          disabled: qqBusy,
                          onClick: async () => {
                            setQqBusy(true);
                            setQqMsg(null);
                            try {
                              const r = await call("/qq/new-session", {
                                method: "POST",
                                body: JSON.stringify({ chat: x.chat }),
                              });
                              setQqMsg(r && r.ok
                                ? (isGroup ? "群 " : "私聊 ") + x.target + " 已排队"
                                : "失败：" + JSON.stringify(r));
                              if (r && r.ok) setTimeout(() => { void load(); }, 2500);
                            } catch (e) {
                              setQqMsg("失败：" + (e && e.message ? e.message : String(e)));
                            } finally {
                              setQqBusy(false);
                            }
                          },
                        }, qqBusy ? "…" : "开新会话"),
                        h("button", {
                          style: { ...S.btn(false), padding: "4px 10px", fontSize: 12, whiteSpace: "nowrap" },
                          disabled: qqBusy,
                          onClick: async () => {
                            if (historyOpen === x.chat) {
                              setHistoryOpen(null);
                              return;
                            }
                            setHistoryOpen(x.chat);
                            try {
                              const hh = await call("/qq/session-history?chat=" + encodeURIComponent(x.chat));
                              setSessionHistory((m) => ({ ...m, [x.chat]: hh }));
                            } catch (e) {
                              setQqMsg("读历史失败：" + (e && e.message ? e.message : String(e)));
                            }
                          },
                        }, historyOpen === x.chat ? "收起" : "历史"),
                      ),
                    );
                  }),
                )
              : h("div", { style: { ...S.muted, fontSize: 12 } }, "没有找到 QQ 会话（还没人跟她聊过？）"),
            historyOpen
              ? (() => {
                  const hh = sessionHistory[historyOpen];
                  if (!hh) return h("div", { style: { ...S.muted, fontSize: 11, marginTop: 8 } }, "读取中…");
                  const items = hh.items || [];
                  const renderHistoryPanel = true;
                  return h("div", { style: { marginTop: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--dsw-alias-border-l4)", background: "var(--dsw-alias-bg-layer-1)" } },
                    h("div", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary)", marginBottom: 6 } },
                      historyOpen + " 的历史会话（点「绑到这个」切过去，会重启生效）"),
                    items.length
                      ? h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
                          ...items.map((it) => {
                            const d2 = new Date((it.mtime || 0) * 1000);
                            const ts = (d2.getMonth() + 1) + "-" + d2.getDate() + " " + String(d2.getHours()).padStart(2, "0") + ":" + String(d2.getMinutes()).padStart(2, "0");
                            return h("div", {
                              key: it.session,
                              style: {
                                display: "flex", alignItems: "center", gap: 8, fontSize: 11,
                                padding: "5px 8px", borderRadius: 6,
                                border: "1px solid " + (it.is_current ? "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "var(--dsw-alias-border-l4)"),
                                background: it.is_current ? "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))" : "var(--dsw-alias-settings-card-fill)",
                              },
                            },
                              h("span", { style: { flex: 1, fontFamily: "monospace", wordBreak: "break-all" } },
                                it.session + (it.is_current ? "  ←当前" : "")),
                              h("span", { style: { color: "var(--dsw-alias-label-secondary)", whiteSpace: "nowrap" } },
                                Math.round(it.size / 1024) + "K · " + ts),
                              it.is_current
                                ? h("span", { style: { color: "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))", whiteSpace: "nowrap" } }, "使用中")
                                : h("button", {
                                    style: { ...S.btn(false), padding: "2px 8px", fontSize: 11, whiteSpace: "nowrap" },
                                    disabled: qqBusy,
                                    onClick: async () => {
                                      setQqBusy(true);
                                      setQqMsg(null);
                                      try {
                                        const r = await call("/qq/bind", {
                                          method: "POST",
                                          body: JSON.stringify({ chat: historyOpen, session: it.session }),
                                        });
                                        setQqMsg(r && r.ok ? "已绑定，重启中…" : "失败：" + JSON.stringify(r));
                                        setHistoryOpen(null);
                                        setSessionHistory((m) => ({ ...m, [historyOpen]: null }));
                                        setTimeout(() => { void load(); }, 5000);
                                      } catch (e) {
                                        setQqMsg("失败：" + (e && e.message ? e.message : String(e)));
                                      } finally {
                                        setQqBusy(false);
                                      }
                                    },
                                  }, "绑到这个"),
                            );
                          }),
                        )
                      : h("div", { style: { ...S.muted, fontSize: 11 } }, "没有历史会话"),
                  );
                })()
              : null,
            qqSessions.length > 1
              ? h("div", { style: { display: "flex", justifyContent: "flex-end", marginTop: 10 } },
                  h("button", {
                    style: {
                      ...S.btn(false), padding: "4px 12px", fontSize: 12,
                      color: "color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, var(--dsw-alias-label-primary))", borderColor: "color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, var(--dsw-alias-label-primary))",
                    },
                    disabled: qqBusy,
                    onClick: async () => {
                      if (!(window.confirm || confirm)("把所有 " + qqSessions.length + " 个会话都开新的？\n（旧对话都留在历史里，记忆不受影响）")) return;
                      setQqBusy(true);
                      setQqMsg(null);
                      try {
                        const r = await call("/qq/new-session", {
                          method: "POST",
                          body: JSON.stringify({ chat: "all" }),
                        });
                        setQqMsg(r && r.ok ? "全部 " + (r.count || 0) + " 个已排队" : "失败：" + JSON.stringify(r));
                        if (r && r.ok) setTimeout(() => { void load(); }, 3000);
                      } catch (e) {
                        setQqMsg("失败：" + (e && e.message ? e.message : String(e)));
                      } finally {
                        setQqBusy(false);
                      }
                    },
                  }, "全部重置"),
                )
              : null,
          ),

          ...(data.groups || []).map((g) =>
            h("div", { key: g.id, style: S.card },
              h("div", { style: { ...S.label, marginBottom: 10 } }, g.title),
              h("div", { style: {
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10, alignItems: "start",
              } },
                ...g.fields.map((f) => {
                  // 「允许在哪些群聊天」只在「在特定群聊天」时出现，且不显示标题和说明（选了就懂）
                  const isGroupWhite = f.key === "groupAllowFrom";
                  if (isGroupWhite) {
                    const gp = (draft && Object.prototype.hasOwnProperty.call(draft, "groupPolicy"))
                      ? draft.groupPolicy
                      : "open";
                    if (String(gp) !== "allowlist") return null;
                  }

                  // 「管理员用户」跟着「只允许管理员私聊」走
                  if (f.key === "adminUsers") {
                    const dp = (draft && Object.prototype.hasOwnProperty.call(draft, "dmPolicy"))
                      ? draft.dmPolicy
                      : "open";
                    if (String(dp) !== "open") return null;
                  }

                  // 「允许和谁聊天」跟着「只允许特定人私聊」走
                  if (f.key === "allowFrom") {
                    const dp = (draft && Object.prototype.hasOwnProperty.call(draft, "dmPolicy"))
                      ? draft.dmPolicy
                      : "open";
                    if (String(dp) !== "allowlist") return null;
                  }
                  return h("div", {
                    key: f.key,
                    style: {
                      display: "flex", flexDirection: "column", gap: 4, minWidth: 0,
                      gridColumn: f.col === "full" ? "1 / -1" : undefined,
                    },
                  },
                    isGroupWhite ? null : h("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
                      h("span", { style: { fontSize: 12, fontWeight: 500 } }, f.label),
                      f.is_set ? h("span", { style: { fontSize: 10, color: "color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, var(--dsw-alias-label-primary))" } }, "已配") : null,
                    ),
                    control(f),
                    (!isGroupWhite && f.hint) ? h("div", { style: { ...S.muted, fontSize: 11 } }, f.hint) : null,
                  );
                }),
              ),
            ),
          ),

          // ---- 其他用户画像（按 QQ 号区分）----
          h("div", { style: S.card },
            h("div", { style: { ...S.label, display: "flex", alignItems: "center", justifyContent: "space-between" } },
              h("span", {}, "其他用户画像"),
              h("span", {
                style: { fontSize: 12, cursor: "pointer", color: "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))", fontWeight: 400 },
                onClick: () => setProfilesOpen(!profilesOpen),
              }, profilesOpen ? "收起" : `展开 ${otherProfiles.length} 人`),
            ),
            h("div", { style: { ...S.muted, fontSize: 12, marginBottom: 10 } },
              "她认识的人（按 QQ 号区分）。每个人的记忆和画像独立，互不串门。"),
            profilesOpen
              ? (otherProfiles.length === 0
                  ? h("div", { style: { ...S.muted, fontSize: 12, padding: "12px 0", textAlign: "center" } },
                      "还没认识别人。等有人私聊她或她在群里说话，这里会出现。")
                  : h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
                      ...otherProfiles.map((p) =>
                        h("div", {
                          key: "prof-" + p.user_id,
                          style: {
                            display: "flex", gap: 10, padding: "10px 12px", borderRadius: 8,
                            border: "1px solid var(--dsw-alias-border-l4)", background: "var(--dsw-alias-settings-card-fill)",
                          },
                        },
                          h("img", {
                            src: "http://q1.qlogo.cn/g?b=qq&nk=" + p.user_id + "&s=100",
                            style: { width: 40, height: 40, borderRadius: 999, flexShrink: 0, background: "var(--dsw-alias-bg-module-platform)" },
                            onError: (ev) => { ev.target.style.visibility = "hidden"; },
                          }),
                          h("div", { style: { flex: 1, minWidth: 0 } },
                            h("div", { style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 2 } },
                              h("span", { style: { fontSize: 13, fontWeight: 500 } }, p.name || ("QQ " + p.user_id)),
                              h("span", { style: { ...S.muted, fontSize: 11 } }, p.user_id),
                              h("span", { style: { ...S.muted, fontSize: 11 } }, "· 说过 " + (p.msg_count || 0) + " 次"),
                            ),
                            // ---- 段一：你手编的（进系统提示词）----
                            h("div", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary)", margin: "6px 0 3px" } },
                              "你手编的画像 —— 进系统提示词，她每轮都看得到"),
                            h("textarea", {
                              value: profileDrafts[p.user_id] !== undefined
                                ? profileDrafts[p.user_id]
                                : (p.manual_profile || ""),
                              placeholder: "比如：一个爱猫的程序员，说话很短，最烦加班",
                              rows: 2,
                              onChange: (ev) => setProfileDrafts({
                                ...profileDrafts,
                                [p.user_id]: ev.target.value,
                              }),
                              style: {
                                width: "100%", boxSizing: "border-box", fontSize: 12, lineHeight: 1.5,
                                padding: "6px 8px", borderRadius: 6, resize: "vertical",
                                border: "1px solid var(--dsw-alias-border-l4)", background: "var(--dsw-alias-bg-layer-1)",
                                fontFamily: "inherit", color: "var(--dsw-alias-label-primary)",
                              },
                            }),
                            h("div", { style: { display: "flex", gap: 8, alignItems: "center", margin: "4px 0 8px" } },
                              h("button", {
                                disabled: profileDrafts[p.user_id] === undefined,
                                onClick: async () => {
                                  const text = profileDrafts[p.user_id];
                                  if (text === undefined) return;
                                  try {
                                    await call("/profiles", {
                                      method: "POST",
                                      body: JSON.stringify({ user_id: p.user_id, manual_profile: text }),
                                    });
                                    setProfiles(profiles.map((x) =>
                                      x.user_id === p.user_id ? { ...x, manual_profile: text } : x));
                                  } catch (e) { /* 忽略 */ }
                                },
                                style: {
                                  fontSize: 11, padding: "3px 10px", borderRadius: 5,
                                  cursor: profileDrafts[p.user_id] === undefined ? "default" : "pointer",
                                  border: "1px solid var(--dsw-alias-border-l4)",
                                  background: profileDrafts[p.user_id] === undefined ? "var(--dsw-alias-interactive-bg-hover)" : "var(--dsw-alias-bg-layer-1)",
                                  color: profileDrafts[p.user_id] === undefined ? "var(--dsw-alias-label-secondary)" : "var(--dsw-alias-label-primary)",
                                },
                              }, "保存这段"),
                              h("span", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary)" } },
                                "改完最多 20 秒她才看到"),
                            ),
                            // ---- 段二：她自己积累的（只走对话注入）----
                            h("div", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary)", marginBottom: 3 } },
                              "她自己记下的 —— 每抽到一条就变，所以只走对话注入，不进系统提示词"),
                            h("div", { style: { fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-label-secondary)", whiteSpace: "pre-wrap" } },
                              p.profile ? String(p.profile).slice(0, 200) : "（还没提炼出画像）"),
                          ),
                          h("span", {
                            style: { cursor: "pointer", opacity: 0.5, fontSize: 14, flexShrink: 0, alignSelf: "flex-start", padding: "0 4px" },
                            title: "删掉这个人",
                            onClick: async () => {
                              if (!window.confirm("删掉 " + (p.name || p.user_id) + " 的画像？")) return;
                              try {
                                await call("/profiles", { method: "POST", body: JSON.stringify({ user_id: p.user_id, delete: true }) });
                                setProfiles(profiles.filter((x) => x.user_id !== p.user_id));
                              } catch (e) { /* 忽略 */ }
                            },
                          }, "×"),
                        ),
                      ),
                    )
                )
              : null,
          ),

          // 保存按钮（固定在屏幕右侧中间，跟其他页签一致）
          h("div", {
            key: "qq-dirty-save",
            style: {
              position: "fixed", right: 24, top: "50%", transform: "translateY(-50%)",
              display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8,
              background: "var(--dsw-alias-bg-layer-1)", padding: "12px 16px", borderRadius: 12,
              border: 0, boxShadow: "var(--dsw-elevation-panel)",
              zIndex: 9999, minWidth: 160,
            },
          },
            notice ? h("div", {
              style: {
                fontSize: 11, lineHeight: 1.4, textAlign: "center", maxWidth: 180,
                color: notice.kind === "error" ? "color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, var(--dsw-alias-label-primary))" : "color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, var(--dsw-alias-label-primary))",
                wordBreak: "break-word",
              },
            }, notice.text) : null,
            dirty ? h("div", { style: { fontSize: 11, color: "color-mix(in srgb, var(--dsw-alias-state-warn-label) 60%, var(--dsw-alias-label-primary))", textAlign: "center" } }, Object.keys(draft).length + " 项未保存") : null,
            h("button", {
              style: { ...S.btn(true), opacity: dirty ? 1 : 0.5, cursor: dirty ? "pointer" : "default" },
              disabled: saving || !dirty,
              onClick: () => void save(),
            }, saving ? "保存中…" : "保存改动"),
            h("button", {
              style: { ...S.btn(false), fontSize: 11, padding: "4px 10px" },
              onClick: () => { setDraft({}); setNotice(null); },
            }, "撤销改动"),
          ),
        );
      }

      function PersonaCards() {
        const [library, setLibrary] = React.useState(null);
        const [draft, setDraft] = React.useState({ id: "", name: "", prompt: "" });
        const [dirty, setDirty] = React.useState(false);
        const [busy, setBusy] = React.useState(false);
        const [notice, setNotice] = React.useState(null);
        const load = React.useCallback(async () => {
          try {
            const data = await call("/persona/cards");
            setLibrary(data);
            const card = data.cards.find(x => x.id === data.active.qq) || data.cards[0];
            if (card) setDraft({ id: card.id, name: card.name, prompt: card.prompt });
          } catch (error) { setNotice({ kind: "error", text: "人物卡读取失败：" + error.message }); }
        }, []);
        React.useEffect(() => { void load(); }, [load]);
        const pick = (card) => {
          if (dirty && !window.confirm("当前人物卡有未保存的修改，确定放弃吗？")) return;
          setDraft(card ? { id: card.id, name: card.name, prompt: card.prompt } : { id: "", name: "", prompt: "" });
          setDirty(false); setNotice(null);
        };
        const mutate = async (body) => {
          setBusy(true); setNotice(null);
          try {
            const data = await call("/persona/cards", { method: "POST", body: JSON.stringify(body) });
            setLibrary(data);
            if (body.action === "create" || body.action === "update") {
              const card = data.cards.find(x => x.id === data.changed_id);
              setDraft({ id: card.id, name: card.name, prompt: card.prompt });
              setDirty(false);
            } else if (body.action === "delete") {
              const card = data.cards.find(x => x.id === data.active.qq) || data.cards[0];
              setDraft({ id: card.id, name: card.name, prompt: card.prompt });
              setDirty(false);
            }
            setNotice({ kind: "ok", text: body.action === "select" ? "渠道已切换，QQ 稍后生效。" : "已保存。" });
          } catch (error) { setNotice({ kind: "error", text: error.message || "保存失败" }); }
          finally { setBusy(false); }
        };
        if (!library) return h("div", { style: S.card }, notice ? h("div", { style: S.notice("error"), role: "alert" }, notice.text) : "正在读取人物卡…",
          notice ? h("button", { type: "button", style: S.btn(false), onClick: () => void load() }, "重新加载") : null);
        const edit = (key, value) => { setDraft(old => ({ ...old, [key]: value })); setDirty(true); };
        return h("section", { style: S.card, "data-persona-cards": "" },
          h("div", { style: { display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" } },
            h("div", null, h("div", { style: { fontSize: 17, fontWeight: 650 } }, "人物卡"),
              h("div", { style: S.desc }, "一张卡一段完整提示词，两个渠道可以分别选择。")),
            h("button", { type: "button", style: S.btn(false), disabled: busy, onClick: () => pick(null) }, "新建人物卡")),
          h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 } },
            ...[["qq", "QQ 使用"], ["bili", "B 站使用"]].map(([channel, label]) => h("label", { key: channel, style: S.field },
              h("span", { style: S.label }, label),
              h("select", { style: S.select, value: library.active[channel], disabled: busy, "aria-label": label,
                onChange: event => void mutate({ action: "select", channel, id: event.target.value }) },
                ...library.cards.map(card => h("option", { key: card.id, value: card.id }, card.name)))))),
          h("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 } },
            ...library.cards.map(card => h("button", { key: card.id, type: "button", disabled: busy, onClick: () => pick(card),
              "aria-pressed": draft.id === card.id, style: { ...S.btn(draft.id === card.id), maxWidth: "100%", overflowWrap: "anywhere" } }, card.name))),
          h("label", { style: S.field }, h("span", { style: S.label }, "人物卡名称"),
            h("input", { style: S.input, value: draft.name, maxLength: 80, placeholder: "例如：温柔的鲸鱼娘", onChange: event => edit("name", event.target.value) })),
          h("label", { style: S.field }, h("span", { style: S.label }, "系统提示词"),
            h("textarea", { style: { ...S.input, minHeight: 300, resize: "vertical", lineHeight: 1.7 }, value: draft.prompt,
              maxLength: 30000, placeholder: "在这里写完整的人物设定和说话方式…", onChange: event => edit("prompt", event.target.value) }),
            h("span", { style: S.muted }, `${draft.prompt.length} / 30000 字符`)),
          notice ? h("div", { style: S.notice(notice.kind), role: notice.kind === "error" ? "alert" : "status" }, notice.text) : null,
          h("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 } },
            h("button", { type: "button", style: S.btn(true), disabled: busy || !dirty || !draft.name.trim() || !draft.prompt.trim(),
              onClick: () => void mutate({ action: draft.id ? "update" : "create", id: draft.id, name: draft.name, prompt: draft.prompt }) }, busy ? "保存中…" : "保存人物卡"),
            draft.id ? h("button", { type: "button", style: S.btn(false), disabled: busy || Object.values(library.active).includes(draft.id),
              title: Object.values(library.active).includes(draft.id) ? "先切换使用此卡的渠道" : "删除人物卡",
              onClick: () => { if (window.confirm("确定删除这张人物卡吗？")) void mutate({ action: "delete", id: draft.id }); } }, "删除人物卡") : null),
          h("div", { style: S.desc }, "正在使用的卡不能删除。QQ 在配置刷新后更新，B 站下次生成时更新。文字表情和图库图片仍可在表情包设置中单独调整。"));
      }

      function PersonaSection() {
        const [userProfile, setUserProfile] = React.useState("");
        const [profileMsg, setProfileMsg] = React.useState(null);
        const [relations, setRelations] = React.useState([]);
        const [relInput, setRelInput] = React.useState("");
        const [profileFields, setProfileFields] = React.useState({
          name: "", job: "", schedule: "", work: "", food: "", likes: "", taboos: "", note: "",
        });
        // 画像是否已成功加载（防止「加载失败 → 全空 → 保存覆盖」）
        const [profileLoaded, setProfileLoaded] = React.useState(false);
        // 画像字段是否被用户改过（没改过就不覆盖，避免保存别的东西时清空画像）
        const [profileDirty, setProfileDirty] = React.useState(false);
        const setPf = (k, v) => {
          setProfileFields((f) => ({ ...f, [k]: v }));
          setProfileDirty(true);
        };
        const [loading, setLoading] = React.useState(true);
        const [error, setError] = React.useState("");
        const [limits, setLimits] = React.useState({ constitution: 15000, self_model: 4000 });
        const [saving, setSaving] = React.useState(false);
        const [notice, setNotice] = React.useState(null);
        const [saved, setSaved] = React.useState({ constitution: "", self_model: "", self_image: "", identity: "" });
        const [draft, setDraft] = React.useState({ constitution: "", self_model: "", self_image: "", identity: "" });
        const [idFields, setIdFields] = React.useState({
          name: "", self_call: "", user_call: "", personality: "", speaking: "", taboo: "", free: "",
          think_cn: false,
          think_ds: false,
          ai_flavor_on: true,
          self_call_in_speech: false,
          _newTaboo: "",
          taboo_off: "",
          ai_flavor: "允许 2% 语法错误、7% 主谓宾省略、7% 聊跑题；口癖 50% 概率出现且单独一条；允许「？？？」这类网络标点，概率 2%。",
        });
        const setId = (k, v) => setIdFields((f) => ({ ...f, [k]: v }));

        const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

        const load = React.useCallback(async () => {
          setLoading(true);
          setError("");
          try {
            const data = await call("/persona");
            setSaved({ constitution: data.constitution || "", self_model: data.self_model || "", self_image: data.self_image || "", identity: data.identity || "" });
            setDraft({ constitution: data.constitution || "", self_model: data.self_model || "", self_image: data.self_image || "", identity: data.identity || "" });
            try {
              const parsed = data.identity ? JSON.parse(data.identity) : {};
              setIdFields({
                name: parsed.name || "", self_call: parsed.self_call || "", user_call: parsed.user_call || "",
                personality: parsed.personality || "", speaking: parsed.speaking || "",
                taboo: parsed.taboo || "", free: parsed.free || "",
                think_cn: !!parsed.think_cn,
                think_ds: !!parsed.think_ds,
                ai_flavor_on: parsed.ai_flavor_on !== false,
                self_call_in_speech: parsed.self_call_in_speech === true,
                ai_flavor: parsed.ai_flavor || "允许 2% 语法错误、7% 主谓宾省略、7% 聊跑题；口癖 50% 概率出现且单独一条；允许「？？？」这类网络标点，概率 2%。",
              });
            } catch { /* ignore */ }
            if (data.limits) setLimits(data.limits);
            setNotice(null);
          } catch (err) {
            setError("读不到人格设定。先确认记忆服务在跑（" + serviceUrl() + "）。");
          } finally {
            setLoading(false);
          }
        }, []);

        React.useEffect(() => {
          void (async () => {
            try {
              const r = await call("/persona/user");
              if (r && typeof r.user_profile === "string") {
                setUserProfile(r.user_profile);
                // 解析 Markdown → 表单（粗略分行匹配）
                const md = r.user_profile;
                const pick = (key) => {
                  const m = md.match(new RegExp("[-*]\\s*" + key + "：\\s*(.+)"));
                  return m ? m[1].trim() : "";
                };
                const sec = (title) => {
                  const m = md.match(new RegExp("##\\s*" + title + "\\s*\n([\\s\\S]*?)(?=\\n##|$)"));
                  return m ? m[1].trim() : "";
                };
                const relSec = sec("我们的关系");
                const relTags = relSec.match(/他是我(.+)/);
                if (relTags) {
                  setRelations(relTags[1].split(/[、,，]/).map((x) => x.trim()).filter(Boolean));
                }
                setProfileFields({
                  name: pick("称呼"),
                  job: pick("职业"),
                  schedule: pick("作息"),
                  work: pick("工作"),
                  food: pick("饮食"),
                  likes: pick("喜欢"),
                  taboos: sec("雷区").replace(/^[-*]\s*/gm, "").trim(),
                  note: sec("备注"),
                });
                setProfileLoaded(true);
                setProfileDirty(false);
              }
            } catch { /* ignore */ }
          })();
        }, []);
        React.useEffect(() => { load(); }, [load]);

        const buildProfile = () => {
          const f = profileFields;
          const relLine = relations.length ? "## 我们的关系\n- 他是我" + relations.join("、") + "\n\n" : "";
          const basic = [
            f.name ? "- 称呼：" + f.name : "",
            f.job ? "- 职业：" + f.job : "",
            f.schedule ? "- 作息：" + f.schedule : "",
          ].filter(Boolean).join("\n");
          const life = [
            f.work ? "- 工作：" + f.work : "",
            f.food ? "- 饮食：" + f.food : "",
          ].filter(Boolean).join("\n");
          const likeLine = f.likes ? "## 喜欢\n- 喜欢：" + f.likes + "\n\n" : "";
          const taboo = f.taboos ? "## 雷区\n" + f.taboos.split("\n").filter((x) => x.trim()).map((x) => "- " + x.trim()).join("\n") + "\n\n" : "";
          const note = f.note ? "## 备注\n" + f.note + "\n" : "";
          return [
            relLine,
            basic ? "## 基本信息\n" + basic + "\n\n" : "",
            life ? "## 生活\n" + life + "\n\n" : "",
            likeLine,
            taboo,
            note,
          ].join("").trim();
        };

        const save = async () => {
          // 防误清空：画像没加载成功，或新内容是空但原来有内容 → 拦下
          const built = buildProfile();
          if (!profileLoaded) {
            setNotice({ kind: "error", text: "画像还没加载成功，先别保存（防止清空）。刷新页面试试。" });
            return;
          }
          if (!built.trim() && userProfile.trim()) {
            setNotice({ kind: "error", text: "画像会变成空的，已拦下。真要清空请点「清空画像」。" });
            return;
          }
          setSaving(true);
          setNotice(null);
          try {
            // 只在用户真的改过画像时才保存画像（否则保存 taboo 等会误清空画像）
            if (profileDirty) {
              await call("/persona/user", { method: "POST", body: JSON.stringify({ user_profile: built }) });
            }
            const res = await call("/persona", {
              method: "POST",
              body: JSON.stringify({
                constitution: draft.constitution,
                self_model: draft.self_model,
                self_image: draft.self_image,
              }),
            });
            setSaved({ constitution: res.constitution || "", self_model: res.self_model || "", self_image: res.self_image || "" });
            setDraft({ constitution: res.constitution || "", self_model: res.self_model || "", self_image: res.self_image || "" });
            if (res.limits) setLimits(res.limits);
            setProfileDirty(false);
            setNotice({ kind: "ok", text: "已保存。插件下次刷新就带上，不用重启。" });
          } catch (err) {
            setNotice({ kind: "error", text: "保存失败：" + (err && err.message ? err.message : String(err)) });
          } finally {
            setSaving(false);
          }
        };

        const cancel = () => {
          setDraft({ constitution: saved.constitution, self_model: saved.self_model, self_image: saved.self_image });
          setNotice(null);
        };

        if (loading) {
          return h("div", { className: "dsh-remembers-settings", style: S.wrap }, h("div", { style: S.muted }, "正在读取人格设定…"));
        }

        const textareaStyle = {
          ...S.input, minHeight: 132, lineHeight: 1.65, resize: "vertical", fontFamily: "inherit",
        };

        return h("div", { className: "dsh-remembers-settings", style: S.wrap },

          h("div", { style: S.desc }, "选择每个渠道使用的人物卡，卡片内容作为该渠道的人物提示词。"),
          h(PersonaCards),

          error ? h("div", { style: S.notice("error") }, error) : null,

          h("div", { style: S.card },

            h("div", { style: S.field },
              h("div", { style: S.label }, "用户画像（每轮开头注入）"),
              h("div", { style: { ...S.muted, marginBottom: 6 } },
                "这些都在描述【用户是谁】——不是描述她。她每轮开头都会看到：他是谁、干什么、喜欢什么、别碰什么。比记忆抽取更稳（这是硬事实，不靠她记）。"),
              h("div", { style: { ...S.muted, fontSize: 11, marginBottom: 4 } }, "关系（点一下选中，会自动写进画像；后面的可以自己加）"),
              h("div", { style: { display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 6 } },
                ["老大", "主人", "老板", "朋友", "搭子"].map((tag) =>
                  h("button", {
                    key: tag,
                    onClick: () => setRelations(relations.includes(tag) ? relations.filter((x) => x !== tag) : [...relations, tag]),
                    style: {
                      fontSize: 12, lineHeight: "20px", padding: "1px 9px", borderRadius: 999, cursor: "pointer",
                      border: "1px solid " + (relations.includes(tag) ? "transparent" : "var(--dsw-alias-border-l4)"),
                      background: relations.includes(tag) ? "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))" : "transparent",
                      color: relations.includes(tag) ? "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))" : "inherit",
                    },
                  }, tag),
                ),
              ),
              relations.filter((x) => !["老大", "主人", "老板", "朋友", "搭子"].includes(x)).length
                ? h("div", { style: { display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 6 } },
                    relations.filter((x) => !["老大", "主人", "老板", "朋友", "搭子"].includes(x)).map((tag) =>
                      h("span", {
                        key: tag,
                        style: {
                          fontSize: 12, lineHeight: "20px", padding: "1px 9px", borderRadius: 999,
                          background: "color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary)) 10%, var(--dsw-alias-bg-layer-1))", color: "color-mix(in srgb, var(--dsw-alias-link) 75%, var(--dsw-alias-label-primary))",
                          display: "inline-flex", alignItems: "center", gap: 4,
                        },
                      }, tag,
                        h("span", {
                          onClick: () => setRelations(relations.filter((x) => x !== tag)),
                          style: { cursor: "pointer", opacity: 0.6, fontSize: 13, lineHeight: "20px" },
                        }, "×"),
                      ),
                    ),
                  )
                : null,
              h("div", { style: { display: "flex", gap: 6, marginBottom: 10 } },
                h("input", {
                  style: { ...S.input, maxWidth: 160 },
                  placeholder: "自己加一个（回车）",
                  value: relInput,
                  onChange: (ev) => setRelInput(ev.target.value),
                  onKeyDown: (ev) => {
                    if (ev.key === "Enter" && relInput.trim()) {
                      const v = relInput.trim();
                      if (!relations.includes(v)) setRelations([...relations, v]);
                      setRelInput("");
                    }
                  },
                }),
                h("button", {
                  style: S.btn(false),
                  onClick: () => {
                    const v = relInput.trim();
                    if (v && !relations.includes(v)) setRelations([...relations, v]);
                    setRelInput("");
                  },
                }, "添加"),
              ),

              h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 } },
                h("div", {},
                  h("div", { style: { ...S.muted, fontSize: 11 } }, "他的称呼"),
                  h("input", { style: S.input, placeholder: "老大（他让我这么叫）", value: profileFields.name, onChange: (ev) => setPf("name", ev.target.value) }),
                ),
                h("div", {},
                  h("div", { style: { ...S.muted, fontSize: 11 } }, "他的职业"),
                  h("input", { style: S.input, placeholder: "他的职业，比如初中数学老师", value: profileFields.job, onChange: (ev) => setPf("job", ev.target.value) }),
                ),
                h("div", {},
                  h("div", { style: { ...S.muted, fontSize: 11 } }, "他的作息"),
                  h("input", { style: S.input, placeholder: "他几点睡、几点起", value: profileFields.schedule, onChange: (ev) => setPf("schedule", ev.target.value) }),
                ),
                h("div", {},
                  h("div", { style: { ...S.muted, fontSize: 11 } }, "他的工作"),
                  h("input", { style: S.input, placeholder: "他平时干什么活", value: profileFields.work, onChange: (ev) => setPf("work", ev.target.value) }),
                ),
                h("div", {},
                  h("div", { style: { ...S.muted, fontSize: 11 } }, "他的饮食"),
                  h("input", { style: S.input, placeholder: "他爱吃什么、喝什么", value: profileFields.food, onChange: (ev) => setPf("food", ev.target.value) }),
                ),
                h("div", {},
                  h("div", { style: { ...S.muted, fontSize: 11 } }, "他喜欢"),
                  h("input", { style: S.input, placeholder: "他喜欢什么、讨厌什么", value: profileFields.likes, onChange: (ev) => setPf("likes", ev.target.value) }),
                ),
              ),

              h("div", { style: { ...S.muted, fontSize: 11, marginTop: 10 } }, "雷区（每行一条）"),
              h("textarea", {
                style: { ...S.input, minHeight: 70, lineHeight: 1.6, resize: "vertical", fontFamily: "inherit" },
                placeholder: "哪些话别对他说、哪些事别做\n比如：别催他早睡",
                value: profileFields.taboos,
                onChange: (ev) => setPf("taboos", ev.target.value),
              }),

              h("div", { style: { ...S.muted, fontSize: 11, marginTop: 10 } }, "备注（自由写，有什么想让她记住的都放这儿）"),
              h("textarea", {
                style: { ...S.input, minHeight: 90, lineHeight: 1.6, resize: "vertical", fontFamily: "inherit" },
                placeholder: "关于他的任何事都可以写：他上次说过喜欢下雨天；他不太会表达但会在意；别在他加班时问他吃饭没…",
                value: profileFields.note,
                onChange: (ev) => setPf("note", ev.target.value),
              }),
            ),
            h("div", { style: { display: "flex", alignItems: "center", gap: 10, marginTop: 2 } },
              profileMsg ? h("span", { style: { fontSize: 12, color: profileMsg.includes("失败") ? "color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, var(--dsw-alias-label-primary))" : "color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, var(--dsw-alias-label-primary))" } }, profileMsg)
                : h("span", { style: S.muted }, userProfile.length + " 字符"),
            ),
          ),

          h("div", { style: S.card },

            h(Field, {
              label: "旧版自我认知（AI 可写）",
              hint: "这部分保留给其他会话；QQ 和 B 站使用人物卡时不注入旧版自我认知。",
            },
              h("textarea", {
                style: textareaStyle,
                value: draft.self_model,
                spellCheck: false,
                placeholder: "例：我发现自己讲道理时爱打比方，但一抒情就假。\n我最容易犯的错是把「看起来像」当成「查过了」。",
                onChange: (ev) => set({ self_model: ev.target.value }),
              }),
              h("div", { style: S.muted },
                draft.self_model.length + " / " + limits.self_model + " 字符"),
            ),
          ),

          h("div", {
            style: {
              display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8,
            },
          },
            notice ? h("div", { style: { fontSize: 12, color: notice.kind === "error" ? "color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, var(--dsw-alias-label-primary))" : "color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, var(--dsw-alias-label-primary))", textAlign: "center" } }, notice.text) : null,
            h("button", { type: "button", style: S.btn(true), onClick: save, disabled: saving },
              saving ? "保存中…" : "保存用户画像与自我认知"),
          ),
        );
      }

      // -- 注册 -------------------------------------------------------------

      function apply(ctx) {
        const conversation = ctx.get("uiConversation");
        ctx.effect(() => conversation.events.register({
          kind: "dsh-remembers-meme", target: "chat",
          match: (event) => {
            const data = event.data;
            if (event.type !== "plugin:dsh-remembers/meme" || event.ignorable !== true || !data || data.channel !== "web"
              || !Number.isSafeInteger(data.turn) || typeof data.reason !== "string"
              || !["sent", "failed"].includes(data.status)) return null;
            if (data.status === "sent" && (typeof data.file !== "string" || !data.file || /[\\/]/.test(data.file) || data.file === "." || data.file === "..")) return null;
            return { id: String(event.seq), role: "start" };
          },
          start: (_context, match) => ({ seq: match.event.seq, time: match.event.time, data: match.event.data }),
          update: context => context.state,
          buildViewNode: context => context.state ? {
            key: context.key, kind: "dsh-remembers-meme", id: context.id, target: "chat",
            anchorSeq: context.state.seq, location: context.start.location, visibility: "visible", groupTree: "turn", data: context.state,
          } : null,
        }));
        ctx.effect(() => {
          const style = document.createElement("style");
          style.textContent = SETTINGS_CSS;
          document.head.appendChild(style);
          return () => style.remove();
        });
        try {
          const slots = ctx.get("slots");
          if (slots === undefined) {
            console.warn("dsh-remembers: slots 服务不可用，设置页未注册");
            return;
          }
          slots.inject("settings.section", () => slots.register(
            {
              name: "settings.section",
              id: "dsh-remembers",
              order: 32,
              label: () => "记忆服务 API 设置",
            },
            SettingsSection,
          ));
          slots.inject("conversation.chat.node", () => slots.register({
            name: "conversation.chat.node", key: "dsh-remembers-meme",
          }, MemeChatNode));
          slots.inject("settings.section", () => slots.register(
            {
              name: "settings.section",
              id: "dsh-remembers-persona",
              order: 33,
              label: () => "人格设定",
            },
            PersonaSection,
          ));
          slots.inject("settings.section", () => slots.register(
            {
              name: "settings.section",
              id: "dsh-remembers-memes",
              order: 35,
              label: () => "表情包",
            },
            MemeSection,
          ));
          slots.inject("settings.section", () => slots.register(
            {
              name: "settings.section",
              id: "dsh-remembers-proactive",
              order: 36,
              label: () => "主动消息",
            },
            ProactiveSection,
          ));
          slots.inject("settings.section", () => slots.register(
            {
              name: "settings.section",
              id: "dsh-remembers-bili",
              order: 37,
              label: () => "B 站",
            },
            BiliSection,
          ));
          slots.inject("settings.section", () => slots.register(
            {
              name: "settings.section",
              id: "dsh-remembers-memories",
              order: 38,
              label: () => "记忆",
            },
            MemoriesSection,
          ));

        } catch (err) {
          console.error("dsh-remembers: apply() 失败", err);
        }
      }

      exports.apply = apply;
      exports.inject = ["slots", "uiConversation"];
      return module.exports;
    } catch (err) {
      try {
        console.error("dsh-remembers: 浏览器半边注册失败", err);
      } catch {
        /* logging is best-effort */
      }
      return module.exports;
    }
  },
});
