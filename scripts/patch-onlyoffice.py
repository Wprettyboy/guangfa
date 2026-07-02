from pathlib import Path
import gzip
import json
import re


def rewrite_gzip(path: Path):
    with gzip.open(str(path) + ".gz", "wb") as file:
        file.write(path.read_bytes())
    Path(str(path) + ".gz").chmod(0o444)


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
if "</body>" in html:
    html = html.replace("</body>", '<script src="guangfa-outline-probe.js?gf=36"></script>\n</body>')
html = re.sub(r'urlArgs: "gf=\d+"', 'urlArgs: "gf=6"', html)
if 'urlArgs: "gf=6"' not in html:
    html = html.replace(
        "var require = {\n            waitSeconds: 30,",
        'var require = {\n            waitSeconds: 30,\n            urlArgs: "gf=6",',
    )
index.chmod(0o644)
index.write_text(html, encoding="utf-8")
index.chmod(0o444)
rewrite_gzip(index)

probe = Path("/var/www/onlyoffice/documentserver/web-apps/apps/documenteditor/main/guangfa-outline-probe.js")
if probe.exists():
    rewrite_gzip(probe)

for api in [
    Path("/var/www/onlyoffice/documentserver/web-apps/apps/api/documents/api.js"),
    Path("/var/www/onlyoffice/documentserver/web-apps/apps/api/documents/api.js.tpl"),
]:
    if api.exists():
        text = api.read_text(encoding="utf-8")
        next_text = re.sub(r'var params = "\?_dc=9\.4\.0-129(?:-gf\d+)?";', 'var params = "?_dc=9.4.0-129-gf6";', text)
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
custom_panel_html = """<section class="panel" data-tab="custom-components" role="tabpanel" aria-labelledby="custom-components"><div class="group"><button type="button" class="btn btn-text-default x-huge" style="min-width:96px;margin:9px 6px;" onclick="window.parent.postMessage({source:'guangfa-onlyoffice-custom',action:'toggle-content-audit'}, '*')">内容审查</button><button type="button" class="btn btn-text-default x-huge" style="min-width:96px;margin:9px 6px;" onclick="if(window.guangfaPostOnlyOfficeOutline)window.guangfaPostOnlyOfficeOutline();window.parent.postMessage({source:'guangfa-onlyoffice-custom',action:'toggle-outline-audit'}, '*')">大纲审查</button><button type="button" class="btn btn-text-default x-huge" style="min-width:96px;margin:9px 6px;" onclick="if(window.guangfaPostOnlyOfficeSelection)window.guangfaPostOnlyOfficeSelection();else window.parent.postMessage({source:'guangfa-onlyoffice-custom',action:'annotate-selection',selection:{ok:false,error:'选区脚本未加载'}}, '*')">标注字段</button></div></section>"""
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
    toolbar.chmod(0o644)
    toolbar.write_text(next_toolbar_text, encoding="utf-8")
    toolbar.chmod(0o444)
rewrite_gzip(toolbar)
