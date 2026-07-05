from pathlib import Path
import gzip
import json
import re


def rewrite_gzip(path: Path):
    with gzip.open(str(path) + ".gz", "wb") as file:
        file.write(path.read_bytes())
    Path(str(path) + ".gz").chmod(0o444)


def write_patched(path: Path, text: str):
    path.chmod(0o644)
    path.write_text(text, encoding="utf-8")
    path.chmod(0o444)
    rewrite_gzip(path)


css = Path("/var/www/onlyoffice/documentserver/web-apps/apps/documenteditor/main/resources/css/app.css")
patch = "\n/* guangfa: hide local OnlyOffice branding/about entry */\n#header-logo,#left-btn-about,#about-menu-panel{display:none!important;}\n"
text = css.read_text(encoding="utf-8")
if "guangfa: hide local OnlyOffice branding/about entry" not in text:
    css.chmod(0o644)
    css.write_text(text + patch, encoding="utf-8")
    css.chmod(0o444)
rewrite_gzip(css)

index = Path("/var/www/onlyoffice/documentserver/web-apps/apps/documenteditor/main/index.html")
html = index.read_text(encoding="utf-8")
old = "../../../apps/documenteditor/main/resources/css/app.css"
new = "../../../apps/documenteditor/main/resources/css/app.css?gf=1"
if old in html and new not in html:
    html = html.replace(old, new)

unregister = '+function unregisterOnlyOfficeServiceWorker(){if("serviceWorker"in navigator){navigator.serviceWorker.getRegistrations().then(function(registrations){registrations.forEach(function(registration){if(registration.active&&registration.active.scriptURL.indexOf("document_editor_service_worker.js")!==-1){registration.unregister()}})}).catch(function(){})}}();'
html = re.sub(r"\+function registerServiceWorker\(\)\{.*?\}\}\(\);", unregister, html)
html = re.sub(r'\s*<script src="guangfa-outline-probe\.js\?gf=\d+"></script>', "", html)
html = re.sub(r'\s*<script src="guangfa-placeholder-fields\.js\?gf=\d+"></script>', "", html)
if "</body>" in html:
    html = html.replace("</body>", '<script src="guangfa-outline-probe.js?gf=86"></script>\n<script src="guangfa-placeholder-fields.js?gf=31"></script>\n</body>')
html = re.sub(r'urlArgs: "gf=\d+"', 'urlArgs: "gf=21"', html)
if 'urlArgs: "gf=21"' not in html:
    html = html.replace(
        "var require = {\n            waitSeconds: 30,",
        'var require = {\n            waitSeconds: 30,\n            urlArgs: "gf=21",',
    )
write_patched(index, html)

probe = Path("/var/www/onlyoffice/documentserver/web-apps/apps/documenteditor/main/guangfa-outline-probe.js")
if probe.exists():
    rewrite_gzip(probe)

placeholder_probe = Path("/var/www/onlyoffice/documentserver/web-apps/apps/documenteditor/main/guangfa-placeholder-fields.js")
if placeholder_probe.exists():
    rewrite_gzip(placeholder_probe)

for api in [
    Path("/var/www/onlyoffice/documentserver/web-apps/apps/api/documents/api.js"),
    Path("/var/www/onlyoffice/documentserver/web-apps/apps/api/documents/api.js.tpl"),
]:
    if api.exists():
        text = api.read_text(encoding="utf-8")
        next_text = re.sub(r'var params = "\?_dc=9\.4\.0-129(?:-gf\d+)?";', 'var params = "?_dc=9.4.0-129-gf30";', text)
        if next_text != text:
            api.chmod(0o644)
            api.write_text(next_text, encoding="utf-8")
            api.chmod(0o444)
        gz = Path(str(api) + ".gz")
        if gz.exists():
            rewrite_gzip(api)

sw = Path("/var/www/onlyoffice/documentserver/sdkjs/common/serviceworker/document_editor_service_worker.js")
if sw.exists():
    sw_text = 'self.addEventListener("install",function(event){self.skipWaiting()});\nself.addEventListener("activate",function(event){event.waitUntil(self.registration.unregister())});\n'
    sw.chmod(0o644)
    sw.write_text(sw_text, encoding="utf-8")
    sw.chmod(0o444)
    rewrite_gzip(sw)

toolbar = Path("/var/www/onlyoffice/documentserver/web-apps/apps/documenteditor/main/app/controller/Toolbar.js")
toolbar_text = toolbar.read_text(encoding="utf-8")
custom_panel_html = """<section class="panel" data-tab="custom-components" role="tabpanel" aria-labelledby="custom-components"><div class="group"><button type="button" class="btn btn-text-default x-huge" style="min-width:96px;margin:9px 6px;" onclick="window.top.postMessage({source:'guangfa-onlyoffice-custom',action:'toggle-content-audit'}, '*')">内容审查</button><button type="button" class="btn btn-text-default x-huge" style="min-width:96px;margin:9px 6px;" onclick="if(window.guangfaPostOnlyOfficeOutline)window.guangfaPostOnlyOfficeOutline();window.top.postMessage({source:'guangfa-onlyoffice-custom',action:'toggle-outline-audit'}, '*')">大纲审查</button><button type="button" class="btn btn-text-default x-huge" style="min-width:96px;margin:9px 6px;" onclick="if(window.guangfaPostOnlyOfficeSelection)window.guangfaPostOnlyOfficeSelection();else window.top.postMessage({source:'guangfa-onlyoffice-custom',action:'annotate-selection',selection:{ok:false,error:'选区脚本未加载'}}, '*')">标注字段</button><button type="button" class="btn btn-text-default x-huge" style="min-width:110px;margin:9px 6px;" onclick="window.top.postMessage({source:'guangfa-onlyoffice-custom',action:'open-placeholder-panel'}, '*')">自动字段设置</button><button type="button" class="btn btn-text-default x-huge" style="min-width:110px;margin:9px 6px;" onclick="window.top.postMessage({source:'guangfa-onlyoffice-custom',action:'open-complex-fill-panel'}, '*')">复杂类填充</button></div></section>"""
custom_tab = """            // guangfa: local custom tab placeholder.
            if (me.toolbar.getTab && !me.toolbar.getTab('custom-components')) {
                tab = {caption: '定制组件', action: 'custom-components', extcls: config.isEdit ? 'canedit' : '', dataHintTitle: 'G'};
                $panel = $(__CUSTOM_PANEL_HTML__);
                me.toolbar.addTab(tab, $panel, 8);
                me.toolbar.setVisible('custom-components', true);
            }
""".replace("__CUSTOM_PANEL_HTML__", json.dumps(custom_panel_html, ensure_ascii=False))
anchor = "            config.isEdit && Array.prototype.push.apply(me.toolbar.lockControls, viewtab.getView('ViewTab').getButtons());"
custom_tab_pattern = r"            // guangfa: local custom tab placeholder\.\n            if \(me\.toolbar\.getTab && !me\.toolbar\.getTab\('custom-components'\)\) \{\n.*?            \}\n"
if "guangfa: local custom tab placeholder" in toolbar_text:
    next_toolbar_text = re.sub(custom_tab_pattern, custom_tab, toolbar_text, flags=re.S)
elif anchor in toolbar_text:
    next_toolbar_text = toolbar_text.replace(anchor, custom_tab + anchor)
else:
    next_toolbar_text = toolbar_text
if next_toolbar_text != toolbar_text:
    write_patched(toolbar, next_toolbar_text)
else:
    rewrite_gzip(toolbar)

ai_plugin = Path("/var/www/onlyoffice/documentserver/sdkjs-plugins/{9DC93CDB-B576-4F0C-B55E-FCC9C48DD007}")
plugin_index = ai_plugin / "index.html"
if plugin_index.exists():
    plugin_index_text = plugin_index.read_text(encoding="utf-8")
    plugin_index_next = re.sub(r'src="scripts/engine/register\.js(?:\?gf=\d+)?"', 'src="scripts/engine/register.js?gf=3"', plugin_index_text)
    if plugin_index_next != plugin_index_text:
        write_patched(plugin_index, plugin_index_next)
    else:
        rewrite_gzip(plugin_index)

chat_html = ai_plugin / "chat.html"
if chat_html.exists():
    chat_html_text = chat_html.read_text(encoding="utf-8")
    chat_html_next = re.sub(r'<div id="welcome_text">.*?</div>\s*<div id="welcome_buttons_list"></div>', '<div id="welcome_text"></div>\n\t\t\t\t\t<div id="welcome_buttons_list"></div>', chat_html_text, flags=re.S)
    chat_html_next = re.sub(r'src="scripts/chat\.js(?:\?gf=\d+)?"', 'src="scripts/chat.js?gf=2"', chat_html_next)
    if chat_html_next != chat_html_text:
        write_patched(chat_html, chat_html_next)
    else:
        rewrite_gzip(chat_html)

chat_js = ai_plugin / "scripts/chat.js"
if chat_js.exists():
    chat_text = chat_js.read_text(encoding="utf-8")
    chat_next = re.sub(r"\n\tlet welcomeButtons = \[\n.*?\n\t\];", "\n\tlet welcomeButtons = [];", chat_text, flags=re.S)
    chat_next = re.sub(
        r"\n\tfunction updateStartPanel\(\) \{\n.*?\n\t\};",
        "\n\tfunction updateStartPanel() {\n\t\t$('#welcome_text').empty();\n\t\t$('#welcome_buttons_list').empty();\n\t};",
        chat_next,
        count=1,
        flags=re.S,
    )
    if chat_next != chat_text:
        write_patched(chat_js, chat_next)
    else:
        rewrite_gzip(chat_js)

register_js = ai_plugin / "scripts/engine/register.js"
base_prompt_helper = r'''

	function guangfaEnsureBaseChatPrompt(requestData) {
		let messages = Array.isArray(requestData && requestData.messages) ? requestData.messages : [];
		let prompt = "你是招标文件制作助手。只能用自然语言回答用户问题；禁止调用或输出 OnlyOffice 宏、writeMacro、functionCalling、工具调用、代码块或内部 API。优先依据【广发知识库上下文】回答；资料不足时明确说明缺少依据，不要编造。";
		if (messages.length > 0 && messages[0].role === "system") {
			messages[0].content = prompt + "\n\n" + String(messages[0].content || "");
			return;
		}
		messages.unshift({ role: "system", content: prompt });
	}

	function guangfaCleanChatReply(text) {
		let value = String(text || "").trim();
		if (/^\[functionCalling/i.test(value) || /\bwriteMacro\b/i.test(value))
			return "当前聊天机器人已禁用 OnlyOffice 宏工具。请直接用自然语言提问，我会优先依据已挂载知识库回答。";
		return value;
	}
'''
knowledge_helper = r'''

	async function guangfaAttachKnowledgeToChatRequest(requestData) {
		try {
			let context = window.__guangfaAiKnowledgeContext || null;
			if (!context) {
				try { context = JSON.parse(window.localStorage.getItem("guangfa_ai_knowledge_context") || "null"); } catch {}
			}
			if (!context || !context.enabled || !context.apiBase || !Array.isArray(context.kbIds) || context.kbIds.length === 0)
				return;

			let messages = Array.isArray(requestData && requestData.messages) ? requestData.messages : [];
			let lastUser = "";
			for (let index = messages.length - 1; index >= 0; index--) {
				if (messages[index] && messages[index].role === "user") {
					lastUser = guangfaMessageText(messages[index].content);
					if (lastUser)
						break;
				}
			}
			if (!lastUser)
				return;

			let response = await fetch(String(context.apiBase).replace(/\/$/, "") + "/api/ai/knowledge-search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					message: lastUser,
					knowledgeOptions: context
				})
			});
			if (!response.ok)
				return;

			let result = await response.json();
			let chunks = result && Array.isArray(result.snippets) ? result.snippets : [];
			if (!Array.isArray(chunks) || chunks.length === 0)
				return;

			let baseNames = Array.isArray(context.bases) ? context.bases.map(function(item) { return item && item.name; }).filter(Boolean).join("、") : "";
			let knowledgeText = chunks.map(function(chunk, index) {
				return "[" + (index + 1) + "] " + (chunk.documentName || "知识库资料") + (chunk.chunkIndex ? " #" + chunk.chunkIndex : "") + "\n" + chunk.text;
			}).join("\n\n");
			guangfaUpsertSystemMessage(messages,
				"【广发知识库上下文】\n" +
				"当前聊天已挂载知识库：" + (baseNames || context.kbIds.join("、")) + "。\n" +
				"回答招标文件制作相关问题时，优先依据以下召回片段；资料不足时说明缺少依据，不要编造。\n\n" +
				knowledgeText
			);
		} catch (error) {
			console.warn("[guangfa-ai-chat-knowledge-error]", error && (error.message || error));
		}
	}

	function guangfaMessageText(content) {
		if (Array.isArray(content))
			return content.map(guangfaMessageText).join("\n").trim();
		if (content && typeof content === "object")
			return guangfaMessageText(content.text || content.content || "");
		return String(content || "").trim();
	}

	function guangfaUpsertSystemMessage(messages, content) {
		let marker = "【广发知识库上下文】";
		let index = messages.findIndex(function(message) {
			return message && message.role === "system" && String(message.content || "").includes(marker);
		});
		if (index >= 0) {
			messages[index] = { role: "system", content: content };
			return;
		}
		if (messages.length > 0 && messages[0].role === "system") {
			messages[0].content = String(messages[0].content || "") + "\n\n" + content;
			return;
		}
		messages.unshift({ role: "system", content: content });
	}
'''
if register_js.exists():
    register_text = register_js.read_text(encoding="utf-8")
    register_next = register_text
    pure_chat_handler = r'''		chatWindow.attachEvent("onChatMessage", async function(messageHistory) {
			AgentState.isStopped = false;

			let requestEngine = AI.Request.create(AI.ActionType.Chat);
			if (!requestEngine)
				return;

			let requestData = {
				messages: Array.isArray(messageHistory) ? messageHistory.slice() : []
			};

			guangfaEnsureBaseChatPrompt(requestData);
			await guangfaAttachKnowledgeToChatRequest(requestData);

			let isStreamToChat = false;
			try {
				let fullResponse = await requestEngine.chatRequestAgent(requestData, false, async function(chunk) {
					if (AgentState.isStopped)
						return;
					if (!isStreamToChat) {
						isStreamToChat = true;
						chatWindow.command("onChatStreamStart");
					}
					chatWindow.command("onChatStreamChunk", chunk);
				});

				if (isStreamToChat)
					chatWindow.command("onChatStreamEnd");

				if (AgentState.isStopped)
					return;

				if (!fullResponse) {
					chatWindow.command("onChatReply", Asc.plugin.tr("Error:") + " [provider]");
					return;
				}

				let result = guangfaCleanChatReply(fullResponse.content || "");
				if (!isStreamToChat && result)
					chatWindow.command("onChatReply", result);
			} catch (error) {
				chatWindow.command("onChatReply", "AI 回复失败：" + (error && (error.message || error) || "未知错误"));
			} finally {
				chatWindow.command("onChatStreamEnd");
			}
		});'''
    register_next = re.sub(
        r'\t\tchatWindow\.attachEvent\("onChatMessage", async function\(messageHistory\) \{.*?\n\t\t\}\);\s*(?=\n\t\tchatWindow\.attachEvent\("onChatReplace")',
        pure_chat_handler,
        register_next,
        count=1,
        flags=re.S,
    )
    if "function guangfaEnsureBaseChatPrompt" not in register_next:
        register_next = register_next.replace("\n\twindow.chatWindowShow = chatWindowShow;\n", "\n\twindow.chatWindowShow = chatWindowShow;\n" + base_prompt_helper + "\n")
    if "async function guangfaAttachKnowledgeToChatRequest" not in register_next:
        register_next = register_next.replace("\n\twindow.chatWindowShow = chatWindowShow;\n", "\n\twindow.chatWindowShow = chatWindowShow;\n" + knowledge_helper + "\n")
    if "await guangfaAttachKnowledgeToChatRequest(requestData);" not in register_next:
        register_next = register_next.replace("\n\t\t\t// LOOP\n", "\n\t\t\tawait guangfaAttachKnowledgeToChatRequest(requestData);\n\n\t\t\t// LOOP\n")
    if register_next != register_text:
        write_patched(register_js, register_next)
    else:
        rewrite_gzip(register_js)
