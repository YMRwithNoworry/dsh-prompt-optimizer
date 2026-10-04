/**
 * dsh-prompt-optimizer — browser half.
 *
 * Hand-written module-loader bundle (no build step). The only external require
 * is \`react\`, which the shell's module table provides.
 *
 * Contract with the shell:
 *   - register with \`window.__ModuleLoader__.load({id, factory})\` where id is
 *     the package name;
 *   - the factory returns \`{ name, inject, apply }\`;
 *   - \`apply(ctx)\` occupies real slots through \`ctx.slots\`.
 *
 * The button lives in \`conversation.input.right\` — the documented "compact
 * controls before the composer submit action" seat — so it sits inside the
 * composer's own toolbar without any DOM injection, selector matching, or
 * MutationObserver.
 *
 * The single hard guarantee this file enforces: nothing here ever calls
 * \`submit()\`. The optimizer reads \`useInput().draft\` and writes back with
 * \`inputActions.setDraft(...)\`; sending stays the user's action alone.
 */
window.__ModuleLoader__.load({ id: "dsh-prompt-optimizer", factory: (require) => {

	var module = { exports: {} };
	var exports = module.exports;
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

	var react = require("react");
	var h = react.createElement;
	var useState = react.useState;
	var useEffect = react.useEffect;
	var useCallback = react.useCallback;
	var useMemo = react.useMemo;
	var useRef = react.useRef;

	//#region styles
	var CSS = [
		".dshpo-btn{box-sizing:border-box;display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 9px;",
		"border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);",
		"background:var(--dsw-alias-button-floating-fill,transparent);color:var(--dsw-alias-label-secondary);",
		"font:inherit;font-size:13px;line-height:20px;cursor:pointer;white-space:nowrap;",
		"transition:background-color .12s,color .12s,border-color .12s}",
		".dshpo-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));",
		"color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}",
		".dshpo-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}",
		".dshpo-btn:disabled{opacity:.5;cursor:default}",
		".dshpo-btn[data-busy=\"true\"]{color:var(--dsw-alias-state-business-primary)}",
		".dshpo-btnIcon{flex:none;width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center}",
		".dshpo-btnIcon[data-spin=\"true\"]{animation:dshpo-spin 1s linear infinite}",
		"@keyframes dshpo-spin{to{transform:rotate(360deg)}}",
		".dshpo-btnLabel{display:inline}",
		"@media (max-width:720px){.dshpo-btnLabel{display:none}}",

		".dshpo-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.32);",
		"display:flex;align-items:center;justify-content:center;padding:24px}",
		".dshpo-dialog{box-sizing:border-box;display:flex;flex-direction:column;width:min(1040px,100%);",
		"max-height:min(88vh,900px);background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-label-primary);",
		"border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xl,12px);",
		"box-shadow:0 18px 48px rgba(0,0,0,.28);overflow:hidden}",
		"body[data-ds-dark-theme] .dshpo-dialog{background:var(--dsw-static-neutral-850,#1f1f1f)}",
		".dshpo-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none}",
		".dshpo-title{font-size:14px;font-weight:600;line-height:22px;flex:1;min-width:0}",
		".dshpo-meta{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px;flex:none}",
		".dshpo-chip{font-size:11px;line-height:18px;padding:1px 8px;border-radius:999px;",
		"border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}",
		".dshpo-chip[data-tone=\"accent\"]{color:var(--dsw-alias-state-business-primary);border-color:currentColor}",
		".dshpo-body{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;gap:0;overflow:hidden}",
		".dshpo-pane{display:flex;flex-direction:column;min-width:0;min-height:0;border-right:.5px solid var(--dsw-alias-border-l1)}",
		".dshpo-pane:last-child{border-right:none}",
		".dshpo-paneHead{flex:none;display:flex;align-items:center;gap:8px;padding:8px 14px;",
		"font-size:12px;color:var(--dsw-alias-label-tertiary);border-bottom:.5px solid var(--dsw-alias-border-l1)}",
		".dshpo-paneBody{flex:1;min-height:0;overflow:auto;padding:12px 14px}",
		".dshpo-pre{margin:0;white-space:pre-wrap;word-break:break-word;font:inherit;font-size:13px;line-height:1.6}",
		".dshpo-mono{font-family:ui-monospace,'Cascadia Mono',Consolas,monospace;font-size:12px;line-height:1.6}",
		".dshpo-empty{color:var(--dsw-alias-label-tertiary);font-size:13px}",
		".dshpo-diff{font-family:ui-monospace,'Cascadia Mono',Consolas,monospace;font-size:12px;line-height:1.65}",
		".dshpo-diffLine{display:flex;gap:8px;white-space:pre-wrap;word-break:break-word;border-radius:3px;padding:0 4px}",
		".dshpo-diffLine[data-kind=\"add\"]{background:rgba(46,160,67,.14)}",
		".dshpo-diffLine[data-kind=\"del\"]{background:rgba(248,81,73,.14)}",
		".dshpo-diffSign{flex:none;width:12px;opacity:.7;user-select:none}",
		".dshpo-foot{flex:none;display:flex;align-items:center;gap:8px;padding:12px 16px;",
		"border-top:.5px solid var(--dsw-alias-border-l1);flex-wrap:wrap}",
		".dshpo-footSpacer{flex:1}",
		".dshpo-action{box-sizing:border-box;height:30px;padding:0 14px;border-radius:var(--dsw-radius-sm);",
		"font:inherit;font-size:13px;line-height:20px;cursor:pointer;border:.5px solid transparent;",
		"background:transparent;color:var(--dsw-alias-label-primary)}",
		".dshpo-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}",
		".dshpo-action:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}",
		".dshpo-action:disabled{opacity:.5;cursor:default}",
		".dshpo-action[data-variant=\"primary\"]{background:var(--dsw-alias-state-business-primary,#2f81f7);color:#fff}",
		".dshpo-action[data-variant=\"primary\"]:hover:not(:disabled){filter:brightness(1.08)}",
		".dshpo-action[data-variant=\"ghost\"]{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}",
		".dshpo-seg{display:inline-flex;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);overflow:hidden}",
		".dshpo-segBtn{box-sizing:border-box;height:28px;padding:0 10px;border:none;border-right:.5px solid var(--dsw-alias-border-l1);",
		"background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}",
		".dshpo-segBtn:last-child{border-right:none}",
		".dshpo-segBtn[data-active=\"true\"]{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}",
		".dshpo-segBtn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}",
		".dshpo-notice{font-size:12px;line-height:18px;padding:6px 10px;border-radius:var(--dsw-radius-sm);margin:0 16px 10px}",
		".dshpo-notice[data-tone=\"error\"]{background:rgba(248,81,73,.12);color:var(--dsw-alias-state-error-primary,#e5484d)}",
		".dshpo-notice[data-tone=\"warn\"]{background:rgba(210,153,34,.14);color:var(--dsw-alias-state-warning-primary,#d29922)}",
		".dshpo-notice[data-tone=\"info\"]{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1));color:var(--dsw-alias-label-secondary)}",

		".dshpo-set{max-width:760px}",
		".dshpo-setRow{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:.5px solid var(--dsw-alias-border-l1)}",
		".dshpo-setRow:last-child{border-bottom:none}",
		".dshpo-setLabel{flex:none;width:230px;font-size:13px;line-height:20px}",
		".dshpo-setHint{display:block;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin-top:2px}",
		".dshpo-setField{flex:1;min-width:0}",
		".dshpo-input,.dshpo-select,.dshpo-textarea{box-sizing:border-box;width:100%;font:inherit;font-size:13px;",
		"padding:5px 8px;background:transparent;color:inherit;border:.5px solid var(--dsw-alias-border-l2);",
		"border-radius:var(--dsw-radius-sm)}",
		".dshpo-select{appearance:auto;cursor:pointer}",
		".dshpo-select:disabled{opacity:.5;cursor:default}",
		".dshpo-textarea{min-height:90px;resize:vertical;font-family:ui-monospace,'Cascadia Mono',Consolas,monospace;font-size:12px;line-height:1.55}",
		".dshpo-input:focus-visible,.dshpo-select:focus-visible,.dshpo-textarea:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}",
		".dshpo-switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:13px}",
		".dshpo-setFoot{display:flex;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap}",
		".dshpo-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}"
	].join("");

	var TAG_ID = "dsh-prompt-optimizer/styles.css";
	if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG_ID) + "]") === null) {
		var styleTag = document.createElement("style");
		styleTag.dataset.plugin = "dsh-prompt-optimizer";
		styleTag.dataset.pluginCss = TAG_ID;
		styleTag.textContent = CSS;
		document.head.appendChild(styleTag);
	}
	//#endregion

	//#region copy
	/** All user-facing strings, keyed so the panel can be localized later. */
	var TEXT = {
		button: "优化提示词",
		buttonAria: "使用 AI 优化当前提示词",
		title: "优化提示词",
		original: "原始 Prompt",
		optimized: "优化后的 Prompt",
		diff: "差异对比",
		sideBySide: "并排",
		unified: "合并",
		cancel: "取消",
		regenerate: "重新优化",
		apply: "采用优化结果",
		keepCurrent: "保留当前内容",
		applyAnyway: "应用优化结果",
		optimizing: "优化中…",
		thinking: "正在分析意图、识别领域并重构提示词…",
		empty: "输入框为空，先写点什么再优化。",
		failed: "提示词优化失败，请稍后重试。",
		noChange: "输入内容在优化期间发生了变化。",
		noChangeHint: "请选择是应用优化结果，还是保留你刚输入的内容。",
		noopNote: "原提示词已经足够清晰，已按原样返回（仅做最小规范化）。",
		applied: "已写入输入框。请检查后自行点击发送。",
		neverSends: "插件不会自动发送消息，发送始终由你决定。",
		domain: "领域",
		complexity: "复杂度",
		intensity: "强度",
		language: "语言",
		skipped: "已跳过模型调用",
		route: "模型",
		settings: "提示词优化器",
		settingsDesc: "配置「优化提示词」按钮使用的模型、强度、语言与上下文范围。",
		settingsSaved: "已保存。",
		settingsFailed: "保存失败：",
		settingsLoading: "加载中…",
		modelLabel: "优化模型",
		modelHint: "从 DSH 已配置的模型中直接选择，或保留 current 复用当前会话的模型。",
		modelCurrent: "current — 跟随当前会话模型",
		modelCustomSuffix: "（自定义路由）",
		modelNoneDiscovered: "未发现可用的模型路由，将使用 current。",
		effortLabel: "思考强度",
		effortHint: "该模型支持的推理档位。留空表示使用它自己的默认值。",
		effortDefault: "默认（不指定）",
		effortDefaultNamed: "默认",
		intensityLabel: "优化强度",
		intensityHint: "Light 只修表达；Balanced 补全约束并结构化；Deep 深入建立目标、标准与验收条件。",
		languageLabel: "优化语言",
		languageHint: "Auto 跟随原文语言；也可强制中文或英文。",
		domainLabel: "自动识别领域",
		domainHint: "关闭后一律使用通用策略。",
		previewLabel: "优化后先预览",
		previewHint: "关闭后点击按钮直接写入输入框。",
		convLabel: "参考会话上下文",
		convHint: "仅用于消解「那个东西」之类的指代，不会复制整段历史。",
		projectLabel: "参考项目规则",
		projectHint: "读取工作区的 AGENTS.md / DESIGN.md / .prompt-rules 等规则文件，不读取源码。",
		mcLabel: "Minecraft 专项优化",
		mcHint: "开启后 Minecraft 相关请求会启用原版视觉语言与 Mod 实现约束。",
		visionLabel: "视觉上下文",
		visionHint: "当草稿附带图片时，保留对图片的引用而不会凭空描述其内容。",
		customLabel: "自定义优化规则",
		customHint: "例如「所有 UI 设计都优先考虑简洁和高信息密度」。会附加到每次优化。",
		reload: "重新读取",
		save: "保存",
		saving: "保存中…",
		unsaved: "有未保存的修改",
		loadFailed: "读取失败：",
		light: "Light",
		balanced: "Balanced",
		deep: "Deep",
		auto: "Auto",
		chinese: "中文",
		english: "English",
		// Distinct from `original` above, which labels the diff pane.
		langOriginal: "原文语言",
	};

	var ERROR_TEXT = {
		EMPTY_DRAFT: "输入框为空。",
		NO_ROUTE: "找不到可用的模型路由，请在插件设置里指定 provider/model。",
		ABORTED: "优化已取消。",
		EMPTY_OUTPUT: "模型没有返回任何文本，原始提示词已保留。",
		TRUNCATED: "模型输出被截断，原始提示词已保留。可降低思考强度或换一个模型后重试。",
		UNEXPECTED_TOOL_CALL: "模型返回了非预期的工具调用。",
		PROVIDER_ERROR: "模型服务返回错误。",
		AUTH: "模型认证失败，请检查 DSH 的凭据配置。",
		RATE_LIMIT: "模型服务限流，请稍后重试。",
		NETWORK: "网络错误。",
		TIMEOUT: "优化超时。",
	};
	//#endregion

	//#region helpers
	/** Build a stable className string. */
	function cx() {
		var out = [];
		for (var i = 0; i < arguments.length; i += 1) if (arguments[i]) out.push(arguments[i]);
		return out.join(" ");
	}

	/** Mint a request id without depending on crypto.randomUUID. */
	function newRequestId() {
		try {
			var bytes = new Uint8Array(16);
			globalThis.crypto.getRandomValues(bytes);
			return Array.from(bytes, function (b) { return b.toString(16).padStart(2, "0") }).join("");
		} catch (error) {
			return String(Date.now()) + "-" + String(Math.random()).slice(2);
		}
	}

	/** Localized copy for a failure code, falling back to the technical detail. */
	function errorText(code, detail) {
		return ERROR_TEXT[code] || (TEXT.failed + (detail ? "（" + detail + "）" : ""));
	}

	/**
	 * Line diff via a longest-common-subsequence table.
	 *
	 * Deliberately simple: the panel shows which lines were added, removed, or
	 * kept, which is what a user needs to trust the rewrite. Word-level diffing
	 * would cost far more for very little extra trust.
	 */
	function diffLines(before, after) {
		var a = before.length === 0 ? [] : before.split("\n");
		var b = after.length === 0 ? [] : after.split("\n");
		var n = a.length, m = b.length;
		// Guard the O(n*m) table: past this size, fall back to a plain replace.
		if (n * m > 250000) {
			return a.map(function (line) { return { kind: "del", text: line } })
				.concat(b.map(function (line) { return { kind: "add", text: line } }));
		}
		var table = [];
		for (var i = 0; i <= n; i += 1) { table.push(new Int32Array(m + 1)); }
		for (var i2 = n - 1; i2 >= 0; i2 -= 1) {
			for (var j2 = m - 1; j2 >= 0; j2 -= 1) {
				table[i2][j2] = a[i2] === b[j2]
					? table[i2 + 1][j2 + 1] + 1
					: Math.max(table[i2 + 1][j2], table[i2][j2 + 1]);
			}
		}
		var out = [];
		var x = 0, y = 0;
		while (x < n && y < m) {
			if (a[x] === b[y]) { out.push({ kind: "same", text: a[x] }); x += 1; y += 1; }
			else if (table[x + 1][y] >= table[x][y + 1]) { out.push({ kind: "del", text: a[x] }); x += 1; }
			else { out.push({ kind: "add", text: b[y] }); y += 1; }
		}
		while (x < n) { out.push({ kind: "del", text: a[x] }); x += 1; }
		while (y < m) { out.push({ kind: "add", text: b[y] }); y += 1; }
		return out;
	}

	/** Count added and removed lines for the summary line. */
	function diffStats(rows) {
		var added = 0, removed = 0;
		for (var i = 0; i < rows.length; i += 1) {
			if (rows[i].kind === "add") added += 1;
			else if (rows[i].kind === "del") removed += 1;
		}
		return { added: added, removed: removed };
	}

	/** Fetch JSON from the plugin's host routes, surfacing route errors. */
	async function apiFetch(path, options) {
		var response = await fetch("/prompt-optimizer" + path, Object.assign({ cache: "no-store" }, options || {}));
		if (!response.ok) throw new Error("HTTP " + String(response.status));
		return response.json();
	}

	/** Read the settings document from the host. */
	function fetchSettings() { return apiFetch("/settings"); }

	/** Persist a settings document. */
	function saveSettings(settings) {
		return apiFetch("/settings", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ settings: settings }),
		});
	}
	//#endregion

	//#region icons
	/** A four-point sparkle, matching the harness's 16px outline icon weight. */
	function SparkleIcon(props) {
		return h("svg", {
			viewBox: "0 0 16 16", width: props && props.size ? props.size : 14,
			height: props && props.size ? props.size : 14, fill: "none",
			stroke: "currentColor", strokeWidth: 1.2, strokeLinejoin: "round",
			"aria-hidden": "true", focusable: "false",
		},
			h("path", { d: "M8 1.8 9.35 6.1 13.7 7.45 9.35 8.8 8 13.1 6.65 8.8 2.3 7.45 6.65 6.1z" }),
			h("path", { d: "M12.6 11.1l.5 1.6 1.6.5-1.6.5-.5 1.6-.5-1.6-1.6-.5 1.6-.5z" }),
		);
	}

	/** A small spinner for the busy state. */
	function SpinnerIcon() {
		return h("svg", {
			viewBox: "0 0 16 16", width: 14, height: 14, fill: "none",
			stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round",
			"aria-hidden": "true", focusable: "false",
		}, h("path", { d: "M8 1.8a6.2 6.2 0 1 0 6.2 6.2" }));
	}
	//#endregion

	//#region shared state
	/**
	 * Module-scoped store for the "optimize" dialog.
	 *
	 * The button lives in the composer toolbar; the dialog must outlive it and
	 * must survive the toolbar re-rendering. A tiny external store with
	 * useSyncExternalStore-free subscription keeps both halves decoupled without
	 * pulling in a state library.
	 */
	var dialogState = null;
	var dialogListeners = new Set();

	function setDialogState(next) {
		dialogState = next;
		dialogListeners.forEach(function (listener) { listener(); });
	}

	/** Subscribe a component to the dialog store. */
	function useDialogState() {
		var pair = useState(dialogState);
		useEffect(function () {
			var listener = function () { pair[1](dialogState); };
			dialogListeners.add(listener);
			return function () { dialogListeners.delete(listener); };
		}, []);
		return pair[0];
	}
	//#endregion

	//#region OptimizeButton
	/**
	 * The composer button.
	 *
	 * Reads the draft from the standard session props the shell injects into
	 * every \`conversation.input.*\` occupant. It never calls \`submit()\`.
	 */
	function OptimizeButton(props) {
		var useInput = props.useInput;
		var inputActions = props.inputActions;
		var session = props.session;
		var locked = props.locked === true;
		var t = props.t || function (key) { return TEXT[key] || key; };

		// Selecting only the draft keeps the button from re-rendering on every
		// unrelated input-machine transition.
		var draft = useInput ? useInput(function (state) { return state ? state.draft : "" }) : "";
		var draftRev = useInput ? useInput(function (state) { return state ? state.draftRev : 0 }) : 0;
		var phase = useInput ? useInput(function (state) { return state ? state.phase : "plain" }) : "plain";

		var dialog = useDialogState();
		var busy = dialog !== null && dialog.status === "loading";
		var hasText = typeof draft === "string" && draft.trim().length > 0;
		var disabled = !hasText || locked || phase !== "plain";

		var onClick = useCallback(function () {
			if (disabled || inputActions === undefined) return;
			openOptimizeDialog({
				text: draft,
				draftRev: draftRev,
				inputActions: inputActions,
				sessionId: session && session.id ? session.id : undefined,
			});
		}, [disabled, draft, draftRev, inputActions, session]);

		return h("button", {
			type: "button",
			className: cx("dshpo-btn"),
			"data-busy": busy ? "true" : "false",
			disabled: disabled,
			"aria-label": t("buttonAria"),
			title: t("buttonAria"),
			onMouseDown: function (event) { event.preventDefault(); },
			onClick: onClick,
		},
			h("span", { className: "dshpo-btnIcon", "data-spin": busy ? "true" : "false" },
				busy ? h(SpinnerIcon, null) : h(SparkleIcon, null)),
			h("span", { className: "dshpo-btnLabel" }, t("button")),
		);
	}
	//#endregion

	//#region OptimizeDialog
	/** One side-by-side pane. */
	function Pane(props) {
		return h("section", { className: "dshpo-pane" },
			h("div", { className: "dshpo-paneHead" },
				h("span", null, props.title),
				h("span", { className: "dshpo-footSpacer" }),
				h("span", null, String(props.text.length) + " " + "字符"),
			),
			h("div", { className: "dshpo-paneBody" },
				props.children !== undefined
					? props.children
					: (props.text.length === 0
						? h("p", { className: "dshpo-empty" }, TEXT.empty)
						: h("pre", { className: cx("dshpo-pre", props.mono ? "dshpo-mono" : null) }, props.text)),
			),
		);
	}

	/** The unified diff pane. */
	function DiffPane(props) {
		var rows = useMemo(function () { return diffLines(props.before, props.after); }, [props.before, props.after]);
		var stats = useMemo(function () { return diffStats(rows); }, [rows]);
		return h(Pane, { title: TEXT.diff, text: props.after },
			h("div", null,
				h("p", { className: "dshpo-empty", style: { marginBottom: "8px" } },
					"+" + String(stats.added) + " / -" + String(stats.removed)),
				h("div", { className: "dshpo-diff" },
					rows.map(function (row, index) {
						return h("div", {
							key: String(index),
							className: "dshpo-diffLine",
							"data-kind": row.kind,
						},
							h("span", { className: "dshpo-diffSign" },
								row.kind === "add" ? "+" : row.kind === "del" ? "-" : " "),
							h("span", null, row.text.length === 0 ? " " : row.text),
						);
					}),
				),
			),
		);
	}

	/** The optimization dialog: original, optimized, diff, and the action row. */
	function OptimizeDialog(props) {
		var state = useDialogState();
		var dialogRef = useRef(null);
		var previouslyFocused = useRef(null);

		// Esc closes, and focus is restored to whatever held it before.
		useEffect(function () {
			if (state === null) return undefined;
			previouslyFocused.current = document.activeElement;
			var onKeyDown = function (event) {
				if (event.key === "Escape") {
					event.stopPropagation();
					closeDialog();
				}
			};
			document.addEventListener("keydown", onKeyDown, true);
			var timer = setTimeout(function () {
				if (dialogRef.current !== null) dialogRef.current.focus();
			}, 0);
			return function () {
				document.removeEventListener("keydown", onKeyDown, true);
				clearTimeout(timer);
				var previous = previouslyFocused.current;
				if (previous !== null && typeof previous.focus === "function") previous.focus();
			};
		}, [state === null]);

		if (state === null) return null;

		var view = state.view || "side";
		var busy = state.status === "loading";
		var failure = state.status === "error" ? state.error : null;
		var result = state.status === "ready" ? state.result : null;
		var changedDuringFlight = state.drifted === true;

		var setView = function (next) { setDialogState(Object.assign({}, state, { view: next })); };

		return h("div", {
			className: "dshpo-backdrop",
			onMouseDown: function (event) {
				if (event.target === event.currentTarget) closeDialog();
			},
		},
			h("div", {
				className: "dshpo-dialog",
				role: "dialog",
				"aria-modal": "true",
				"aria-label": TEXT.title,
				tabIndex: -1,
				ref: dialogRef,
			},
				h("header", { className: "dshpo-head" },
					h("span", { className: "dshpo-btnIcon" }, h(SparkleIcon, null)),
					h("h2", { className: "dshpo-title" }, TEXT.title),
					h("span", { className: "dshpo-footSpacer" }),
					h("div", { className: "dshpo-seg", role: "group", "aria-label": TEXT.diff },
						h("button", {
							type: "button", className: "dshpo-segBtn",
							"data-active": view === "side" ? "true" : "false",
							onClick: function () { setView("side"); },
						}, TEXT.sideBySide),
						h("button", {
							type: "button", className: "dshpo-segBtn",
							"data-active": view === "diff" ? "true" : "false",
							onClick: function () { setView("diff"); },
						}, TEXT.diff),
					),
				),

				result !== null
					? h("div", { className: "dshpo-meta" },
						h("span", { className: "dshpo-chip", "data-tone": "accent" }, TEXT.domain + " · " + result.plan.domainLabel),
						h("span", { className: "dshpo-chip" }, TEXT.complexity + " · " + result.plan.complexity),
						h("span", { className: "dshpo-chip" }, TEXT.intensity + " · " + result.plan.intensity),
						h("span", { className: "dshpo-chip" }, TEXT.language + " · " + result.plan.language),
						result.plan.noop
							? h("span", { className: "dshpo-chip" }, TEXT.skipped)
							: null,
						result.plan.sections.length > 0
							? h("span", { className: "dshpo-chip" }, result.plan.sections.join(" · "))
							: null,
					)
					: null,

				changedDuringFlight
					? h("p", { className: "dshpo-notice", "data-tone": "warn" },
						TEXT.noChange + " " + TEXT.noChangeHint)
					: null,

				result !== null && result.plan.noop
					? h("p", { className: "dshpo-notice", "data-tone": "info" }, TEXT.noopNote)
					: null,

				failure !== null
					? h("p", { className: "dshpo-notice", "data-tone": "error" },
						errorText(failure.code, failure.detail))
					: null,

				busy
					? h("div", { className: "dshpo-body", style: { gridTemplateColumns: "1fr" } },
						h("div", { className: "dshpo-pane" },
							h("div", { className: "dshpo-paneBody" },
								h("p", { className: "dshpo-empty" },
									h("span", { className: "dshpo-btnIcon", "data-spin": "true", style: { marginRight: "8px" } },
										h(SpinnerIcon, null)),
									TEXT.thinking),
								h("pre", { className: cx("dshpo-pre", "dshpo-mono"), style: { marginTop: "12px", opacity: 0.6 } },
									state.text),
							),
						),
					)
					: h("div", { className: "dshpo-body" },
						view === "diff" && result !== null
							? h(DiffPane, { before: result.original, after: result.optimized })
							: [
								h(Pane, { key: "orig", title: TEXT.original, text: state.text }),
								h(Pane, { key: "opt", title: TEXT.optimized, text: result === null ? "" : result.optimized }),
							],
					),

				h("footer", { className: "dshpo-foot" },
					h("span", { className: "dshpo-chip" }, TEXT.neverSends),
					h("span", { className: "dshpo-footSpacer" }),
					h("button", {
						type: "button", className: "dshpo-action", "data-variant": "ghost",
						onClick: closeDialog,
					}, TEXT.cancel),
					h("button", {
						type: "button", className: "dshpo-action", "data-variant": "ghost",
						disabled: busy,
						onClick: function () { rerunOptimize(); },
					}, busy ? TEXT.optimizing : TEXT.regenerate),
					changedDuringFlight
						? h("button", {
							type: "button", className: "dshpo-action", "data-variant": "ghost",
							onClick: function () { keepCurrent(); },
						}, TEXT.keepCurrent)
						: null,
					h("button", {
						type: "button", className: "dshpo-action", "data-variant": "primary",
						disabled: busy || result === null,
						onClick: function () { applyResult(); },
					}, changedDuringFlight ? TEXT.applyAnyway : TEXT.apply),
				),
			),
		);
	}
	//#endregion

	//#region dialog controller
	/** The AbortController of the in-flight request, so a rerun cancels the old one. */
	var inFlight = null;
	/** Monotonic request id; a reply whose id is stale is dropped. */
	var activeRequestId = null;

	/** Close the dialog and cancel any in-flight request. */
	function closeDialog() {
		if (inFlight !== null) {
			try { inFlight.abort(); } catch (error) { /* already settled */ }
			inFlight = null;
		}
		activeRequestId = null;
		setDialogState(null);
	}

	/** Write the optimized text back into the composer draft, then close. */
	function applyResult() {
		var state = dialogState;
		if (state === null || state.result === null) return;
		try {
			// The ONLY write the plugin performs. \`setDraft\` replaces the draft;
			// it does not submit, and the user still presses send themselves.
			state.inputActions.setDraft(state.result.optimized);
		} catch (error) {
			setDialogState(Object.assign({}, state, {
				status: "error",
				error: { code: "DRAFT_WRITE_FAILED", detail: String(error && error.message ? error.message : error) },
			}));
			return;
		}
		closeDialog();
	}

	/** Discard the result and keep whatever the user has typed since. */
	function keepCurrent() {
		closeDialog();
	}

	/** Re-run the optimization for the same draft. */
	function rerunOptimize() {
		var state = dialogState;
		if (state === null) return;
		runOptimize(state, state.text, state.draftRev);
	}

	/**
	 * Start one optimization.
	 *
	 * @param state - the current dialog state (carries inputActions and session).
	 * @param text - the draft to optimize.
	 * @param draftRev - the draft revision captured when the user clicked.
	 */
	async function runOptimize(state, text, draftRev) {
		if (inFlight !== null) {
			try { inFlight.abort(); } catch (error) { /* already settled */ }
		}
		var controller = new AbortController();
		inFlight = controller;
		var requestId = newRequestId();
		activeRequestId = requestId;

		setDialogState(Object.assign({}, state, {
			status: "loading",
			text: text,
			draftRev: draftRev,
			result: null,
			error: null,
			drifted: false,
		}));

		try {
			var payload = await apiFetch("/optimize", {
				method: "POST",
				headers: { "content-type": "application/json" },
				signal: controller.signal,
				body: JSON.stringify({
					text: text,
					requestId: requestId,
					conversation: state.conversation || [],
					attachments: state.attachments || [],
					cwd: state.cwd,
				}),
			});

			// A reply from a superseded request must never touch the panel.
			if (activeRequestId !== requestId) return;
			if (dialogState === null) return;

			if (payload && typeof payload.code === "string") {
				setDialogState(Object.assign({}, dialogState, {
					status: "error",
					error: { code: payload.code, detail: payload.detail || "" },
				}));
				return;
			}

			// Did the user edit the draft while the model was working?
			var drifted = false;
			try {
				var live = state.inputActions.captureInsertion();
				drifted = live !== undefined && typeof live.rev === "number" && live.rev !== draftRev;
			} catch (error) {
				drifted = false;
			}

			setDialogState(Object.assign({}, dialogState, {
				status: "ready",
				result: payload,
				drifted: drifted,
			}));
		} catch (error) {
			if (activeRequestId !== requestId) return;
			if (dialogState === null) return;
			if (error && error.name === "AbortError") return;
			setDialogState(Object.assign({}, dialogState, {
				status: "error",
				error: { code: "NETWORK", detail: String(error && error.message ? error.message : error) },
			}));
		} finally {
			if (inFlight === controller) inFlight = null;
		}
	}

	/**
	 * Open the dialog and start optimizing.
	 *
	 * @param context - draft text, revision, input actions, and session identity.
	 */
	function openOptimizeDialog(context) {
		var state = {
			status: "loading",
			view: "side",
			text: context.text,
			draftRev: context.draftRev,
			inputActions: context.inputActions,
			sessionId: context.sessionId,
			cwd: context.cwd,
			conversation: context.conversation || [],
			attachments: context.attachments || [],
			result: null,
			error: null,
			drifted: false,
		};
		setDialogState(state);
		runOptimize(state, context.text, context.draftRev);
	}
	//#endregion

	//#region SettingsSection
	/** The plugin's settings page, rendered inside the DSH settings modal. */
	function SettingsSection(props) {
		var t = props.t || function (key) { return TEXT[key] || key; };
		var loaded = useState(null);
		var value = loaded[0], setValue = loaded[1];
		var savedRef = useRef(null);
		var notice = useState({ tone: "idle", text: "" });
		var noticeValue = notice[0], setNotice = notice[1];
		var busy = useState(false);
		var isBusy = busy[0], setBusy = busy[1];
		var routes = useState([]);
		var routeList = routes[0], setRoutes = routes[1];

		var load = useCallback(function () {
			return fetchSettings().then(function (data) {
				setValue(data.settings);
				savedRef.current = data.settings;
				setRoutes(Array.isArray(data.routes) ? data.routes : []);
			});
		}, []);

		useEffect(function () {
			var cancelled = false;
			load().catch(function (error) {
				if (!cancelled) setNotice({ tone: "error", text: TEXT.loadFailed + String(error.message || error) });
			});
			return function () { cancelled = true; };
		}, [load]);

		// A failed load must not leave the panel stuck on "loading": the error is
		// the only thing the user needs to see, and there is nothing to edit.
		if (value === null) {
			return h("div", { className: "dshpo-set" },
				noticeValue.tone === "error" && noticeValue.text.length > 0
					? h("p", { className: "dshpo-notice", "data-tone": "error", style: { margin: "0 0 10px" } }, noticeValue.text)
					: h("p", { className: "dshpo-empty" }, t("settingsLoading")),
				noticeValue.tone === "error"
					? h("div", { className: "dshpo-setFoot" },
						h("button", {
							type: "button", className: "dshpo-action", "data-variant": "ghost",
							disabled: isBusy,
							onClick: reload,
						}, t("reload")),
					)
					: null,
			);
		}

		/** Patch one field. */
		var set = function (key, next) {
			setValue(Object.assign({}, value, (function () { var patch = {}; patch[key] = next; return patch; })()));
		};

		/** Patch several fields at once, for controls that move together. */
		var setMany = function (patch) {
			setValue(Object.assign({}, value, patch));
		};

		/**
		 * Display name of one reasoning effort on one route.
		 *
		 * The adapter's own name wins; the raw id is the fallback so an
		 * unrecognized value is still shown as something rather than blank.
		 */
		var effortLabel = function (route, id) {
			var efforts = (route && route.efforts) || [];
			for (var k = 0; k < efforts.length; k += 1) {
				if (efforts[k].id === id) return efforts[k].name || efforts[k].id;
			}
			return id;
		};

		var dirty = JSON.stringify(value) !== JSON.stringify(savedRef.current);

		var save = function () {
			setBusy(true);
			setNotice({ tone: "idle", text: "" });
			saveSettings(value).then(function (data) {
				setValue(data.settings);
				savedRef.current = data.settings;
				setRoutes(Array.isArray(data.routes) ? data.routes : []);
				setNotice({ tone: "ok", text: TEXT.settingsSaved });
			}).catch(function (error) {
				setNotice({ tone: "error", text: TEXT.settingsFailed + String(error.message || error) });
			}).finally(function () { setBusy(false); });
		};

		var reload = function () {
			setBusy(true);
			load().catch(function (error) {
				setNotice({ tone: "error", text: TEXT.loadFailed + String(error.message || error) });
			}).finally(function () { setBusy(false); });
		};

		/** One labelled settings row. */
		var row = function (key, label, hint, control) {
			return h("div", { className: "dshpo-setRow", key: key },
				h("div", { className: "dshpo-setLabel" },
					label,
					hint ? h("span", { className: "dshpo-setHint" }, hint) : null,
				),
				h("div", { className: "dshpo-setField" }, control),
			);
		};

		/** A checkbox rendered as a labelled switch. */
		var toggle = function (field, label) {
			return h("label", { className: "dshpo-switch" },
				h("input", {
					type: "checkbox",
					checked: value[field] === true,
					onChange: function (event) { set(field, event.target.checked); },
				}),
				h("span", null, label),
			);
		};

		/** A segmented control for a small enum. */
		var segment = function (field, options) {
			return h("div", { className: "dshpo-seg", role: "group" },
				options.map(function (option) {
					return h("button", {
						key: option.value,
						type: "button",
						className: "dshpo-segBtn",
						"data-active": value[field] === option.value ? "true" : "false",
						"aria-pressed": value[field] === option.value ? "true" : "false",
						onClick: function () { set(field, option.value); },
					}, option.label);
				}),
			);
		};

		// The route the current setting points at, when it is one of the
		// discovered ones. An unlisted value is preserved and offered as its own
		// option, so a hand-written route is never silently dropped.
		var currentRoute = null;
		for (var i = 0; i < routeList.length; i += 1) {
			if (routeList[i].value === value.model) { currentRoute = routeList[i]; break; }
		}
		var routeIsKnown = value.model === "current" || currentRoute !== null;

		var routeSelect = h("select", {
			className: "dshpo-select",
			value: value.model,
			"aria-label": t("modelLabel"),
			onChange: function (event) {
				var next = event.target.value;
				// Effort ids are route-specific, so a route change clears a
				// choice the new route does not advertise.
				var target = null;
				for (var j = 0; j < routeList.length; j += 1) if (routeList[j].value === next) { target = routeList[j]; break; }
				var keepsEffort = target !== null && (target.efforts || []).some(function (effort) { return effort.id === value.reasoningEffort; });
				var patch = { model: next };
				if (!keepsEffort) patch.reasoningEffort = "";
				setMany(patch);
			},
		},
			h("option", { key: "current", value: "current" }, t("modelCurrent")),
			routeIsKnown ? null : h("option", { key: "custom", value: value.model }, value.model + " " + t("modelCustomSuffix")),
			routeList.map(function (route) {
				var label = route.providerName + " · " + route.modelName;
				if (route.modelName !== route.model) label += " (" + route.model + ")";
				return h("option", { key: route.value, value: route.value }, label);
			}),
		);

		// Reasoning efforts are per-route, so the control only appears when the
		// selected route actually advertises some.
		var effortIds = currentRoute === null ? [] : (currentRoute.efforts || []);
		var effortControl = effortIds.length === 0
			? null
			: h("select", {
				className: "dshpo-select",
				value: value.reasoningEffort,
				"aria-label": t("effortLabel"),
				style: { marginTop: "6px" },
				onChange: function (event) { set("reasoningEffort", event.target.value); },
			},
				h("option", { key: "", value: "" },
					currentRoute.defaultEffort
						? t("effortDefaultNamed") + "（" + effortLabel(currentRoute, currentRoute.defaultEffort) + "）"
						: t("effortDefault")),
				effortIds.map(function (effort) {
					return h("option", { key: effort.id, value: effort.id }, effortLabel(currentRoute, effort.id));
				}),
			);

		return h("div", { className: "dshpo-set" },
			h("p", { className: "dshpo-setHint", style: { marginTop: 0, marginBottom: "10px" } }, t("settingsDesc")),

			row("model", t("modelLabel"), t("modelHint"),
				h("div", null,
					routeSelect,
					routeList.length === 0
						? h("span", { className: "dshpo-setHint" }, t("modelNoneDiscovered"))
						: null,
				)),

			effortControl === null ? null : row("reasoningEffort", t("effortLabel"), t("effortHint"), effortControl),

			row("intensity", t("intensityLabel"), t("intensityHint"),
				segment("intensity", [
					{ value: "light", label: t("light") },
					{ value: "balanced", label: t("balanced") },
					{ value: "deep", label: t("deep") },
				])),

			row("language", t("languageLabel"), t("languageHint"),
				segment("language", [
					{ value: "auto", label: t("auto") },
					{ value: "chinese", label: t("chinese") },
					{ value: "english", label: t("english") },
					{ value: "original", label: t("langOriginal") },
				])),

			row("autoDetectDomain", t("domainLabel"), t("domainHint"), toggle("autoDetectDomain", t("domainLabel"))),
			row("showPreview", t("previewLabel"), t("previewHint"), toggle("showPreview", t("previewLabel"))),
			row("useConversationContext", t("convLabel"), t("convHint"), toggle("useConversationContext", t("convLabel"))),
			row("useProjectContext", t("projectLabel"), t("projectHint"), toggle("useProjectContext", t("projectLabel"))),
			row("minecraftOptimization", t("mcLabel"), t("mcHint"), toggle("minecraftOptimization", t("mcLabel"))),
			row("enableVisionContext", t("visionLabel"), t("visionHint"), toggle("enableVisionContext", t("visionLabel"))),

			row("customInstructions", t("customLabel"), t("customHint"),
				h("textarea", {
					className: "dshpo-textarea",
					value: value.customInstructions,
					spellCheck: false,
					placeholder: "所有 UI 设计都优先考虑简洁和高信息密度。",
					onChange: function (event) { set("customInstructions", event.target.value); },
				})),

			h("div", { className: "dshpo-setFoot" },
				h("button", {
					type: "button", className: "dshpo-action", "data-variant": "primary",
					disabled: isBusy || !dirty,
					onClick: save,
				}, isBusy ? t("saving") : t("save")),
				h("button", {
					type: "button", className: "dshpo-action", "data-variant": "ghost",
					disabled: isBusy,
					onClick: reload,
				}, t("reload")),
				dirty ? h("span", { className: "dshpo-chip" }, t("unsaved")) : null,
			),

			noticeValue.tone === "idle" || noticeValue.text.length === 0
				? null
				: h("p", {
					className: "dshpo-notice",
					"data-tone": noticeValue.tone === "error" ? "error" : "info",
					style: { margin: "10px 0 0" },
				}, noticeValue.text),
		);
	}
	//#endregion

	//#region plugin face
	var name = "prompt-optimizer";

	/**
	 * Services this client half uses.
	 *
	 * \`slots\` is the only hard requirement. \`locale\` is optional: the plugin
	 * ships its own copy, so a profile without the locale service still renders.
	 */
	var inject = ["slots"];

	/**
	 * Mount the composer button, the dialog, and the settings section.
	 * @param ctx - client root context.
	 */
	function apply(ctx) {
		// The button sits in the composer's own trailing control row.
		ctx.slots.inject("conversation.input.right", function () {
			return ctx.slots.register({
				name: "conversation.input.right",
				id: "prompt-optimizer",
				order: 10,
			}, OptimizeButton);
		});

		// The dialog is registered into the composer card's overlay seat so it
		// lives inside the conversation surface and unmounts with it.
		ctx.slots.inject("conversation.input.overlay", function () {
			return ctx.slots.register({
				name: "conversation.input.overlay",
				id: "prompt-optimizer-dialog",
				order: 100,
			}, OptimizeDialog);
		});

		// The settings page is a normal settings section.
		ctx.slots.inject("settings.section", function () {
			return ctx.slots.register({
				name: "settings.section",
				id: "prompt-optimizer",
				order: 60,
				label: function () { return TEXT.settings; },
			}, SettingsSection);
		});
	}

	/**
	 * Drop all dialog state and cancel any in-flight request.
	 *
	 * Exported for tests and for a host that needs to remount the plugin without
	 * leaking a stale panel into the next mount. Production code never needs it:
	 * the dialog closes itself and the abort controller settles on its own.
	 */
	function resetState() {
		if (inFlight !== null) {
			try { inFlight.abort(); } catch (error) { /* already settled */ }
			inFlight = null;
		}
		activeRequestId = null;
		dialogState = null;
		dialogListeners.forEach(function (listener) { listener(); });
	}

	exports.name = name;
	exports.inject = inject;
	exports.apply = apply;
	exports.resetState = resetState;
	return module.exports;
}
});
