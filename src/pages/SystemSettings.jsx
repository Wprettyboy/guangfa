import React, { useEffect, useState } from "react";
import { Check, CircleAlert, Database, Loader2, Save, Settings, Sparkles } from "lucide-react";
import { apiRequest } from "../services/apiClient.js";

const geminiFlashLitePreset = {
  label: "Gemini 3.1 Flash Lite",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  model: "gemini-3.1-flash-lite",
};

const emptyModelConfig = {
  provider: "local",
  proxyUrl: "",
  local: { baseUrl: "", model: "", apiKey: "" },
  cloud: { baseUrl: "", model: "", apiKey: "" },
  embedding: { baseUrl: "", model: "", apiKey: "", dimension: "1024", timeoutMs: "60000" },
};

function SystemSettings() {
  const [config, setConfig] = useState(emptyModelConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const activeRuntime = config.provider === "cloud" ? config.cloud : config.local;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    apiRequest("/api/settings/model", {
      signal: controller.signal,
      fallbackMessage: "读取模型配置失败",
    })
      .then((data) => {
        if (!cancelled) setConfig(mergeModelConfig(data));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "读取模型配置失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  function updateSection(section, key, value) {
    setConfig((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [key]: value,
      },
    }));
  }

  async function saveConfig() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const data = await apiRequest("/api/settings/model", {
        method: "POST",
        json: config,
        fallbackMessage: "保存模型配置失败",
      });
      setConfig(mergeModelConfig(data.config || config));
      setMessage("配置已保存，后端当前进程已生效。");
    } catch (err) {
      setError(err.message || "保存模型配置失败");
    } finally {
      setSaving(false);
    }
  }

  async function testConfig(target) {
    setTesting(target);
    setError("");
    setMessage("");
    try {
      const data = await apiRequest("/api/settings/model/test", {
        method: "POST",
        json: { target, config },
        timeoutMs: 90_000,
        fallbackMessage: "连接测试失败",
      });
      setMessage(data.message || "连接测试通过。");
    } catch (err) {
      setError(err.message || "连接测试失败");
    } finally {
      setTesting("");
    }
  }

  return (
    <section className="settings-manager">
      <div className="manager-toolbar">
        <div>
          <h2>系统设置</h2>
          <p>配置 AI 填充模型与知识库 Embedding 服务，支持本地 OpenAI-compatible 服务和云端 API。</p>
        </div>
        <button className="tool-button primary" onClick={saveConfig} disabled={loading || saving}>
          {saving ? <Loader2 size={17} className="spin" /> : <Save size={17} />}
          保存配置
        </button>
      </div>

      {message ? <div className="settings-message ok"><Check size={16} />{message}</div> : null}
      {error ? <div className="settings-message error"><CircleAlert size={16} />{error}</div> : null}

      <div className="settings-grid">
        <section className="settings-card provider-card">
          <div className="settings-card-title">
            <Settings size={18} />
            <div>
              <h3>当前填充模型</h3>
              <span>{activeRuntime.baseUrl || "未配置 Base URL"} · {activeRuntime.model || "未配置模型"}</span>
            </div>
          </div>
          <div className="provider-switch" role="tablist" aria-label="模型来源">
            <button
              className={config.provider === "local" ? "provider-option active" : "provider-option"}
              onClick={() => setConfig((current) => ({ ...current, provider: "local" }))}
              type="button"
            >
              本地模型
            </button>
            <button
              className={config.provider === "cloud" ? "provider-option active" : "provider-option"}
              onClick={() => setConfig((current) => ({ ...current, provider: "cloud" }))}
              type="button"
            >
              云端 API
            </button>
          </div>
          <button className="tool-button" onClick={() => testConfig("llm")} disabled={loading || Boolean(testing)}>
            {testing === "llm" ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
            测试当前模型
          </button>
        </section>

        <ModelRuntimeCard
          title="本地模型"
          desc="适配 llama-server、vLLM、Ollama 兼容网关等 /v1 接口。"
          runtime={config.local}
          active={config.provider === "local"}
          onChange={(key, value) => updateSection("local", key, value)}
        />

        <ModelRuntimeCard
          title="云端 API"
          desc="适配 DeepSeek、Gemini OpenAI-compatible 等云服务。"
          runtime={config.cloud}
          active={config.provider === "cloud"}
          apiKeyMultiline
          apiKeyPlaceholder={"每行填写一个 Key\nAIza...\nAIza..."}
          apiKeyHint="每行一个 Key；请求会按顺序轮询，限流或 Key 异常时自动尝试下一个。"
          proxyUrl={config.proxyUrl}
          onProxyChange={(value) => setConfig((current) => ({ ...current, proxyUrl: value }))}
          onChange={(key, value) => updateSection("cloud", key, value)}
          presets={[geminiFlashLitePreset]}
          onApplyPreset={(preset) => {
            setConfig((current) => ({
              ...current,
              provider: "cloud",
              cloud: {
                ...current.cloud,
                baseUrl: preset.baseUrl,
                model: preset.model,
              },
            }));
          }}
        />

        <section className="settings-card embedding-card">
          <div className="settings-card-title">
            <Database size={18} />
            <div>
              <h3>Embedding 服务</h3>
              <span>知识库向量化与语义检索使用</span>
            </div>
          </div>
          <SettingsField label="Base URL" value={config.embedding.baseUrl} placeholder="http://127.0.0.1:8000/v1" onChange={(value) => updateSection("embedding", "baseUrl", value)} />
          <SettingsField label="模型名称" value={config.embedding.model} placeholder="BAAI/bge-m3" onChange={(value) => updateSection("embedding", "model", value)} />
          <SettingsField label="API Key" type="password" value={config.embedding.apiKey} placeholder="本地服务通常可留空" onChange={(value) => updateSection("embedding", "apiKey", value)} />
          <div className="settings-two-col">
            <SettingsField label="向量维度" value={config.embedding.dimension} placeholder="1024" onChange={(value) => updateSection("embedding", "dimension", value)} />
            <SettingsField label="超时 ms" value={config.embedding.timeoutMs} placeholder="60000" onChange={(value) => updateSection("embedding", "timeoutMs", value)} />
          </div>
          <button className="tool-button" onClick={() => testConfig("embedding")} disabled={loading || Boolean(testing)}>
            {testing === "embedding" ? <Loader2 size={16} className="spin" /> : <Database size={16} />}
            测试 Embedding
          </button>
        </section>
      </div>
    </section>
  );
}

function ModelRuntimeCard({
  title,
  desc,
  runtime,
  active,
  presets = [],
  apiKeyPlaceholder = "本地服务可留空，云端必填",
  apiKeyHint = "",
  apiKeyMultiline = false,
  proxyUrl,
  onProxyChange,
  onApplyPreset,
  onChange,
}) {
  return (
    <section className={active ? "settings-card active" : "settings-card"}>
      <div className="settings-card-title">
        <Sparkles size={18} />
        <div>
          <h3>{title}</h3>
          <span>{desc}</span>
        </div>
      </div>
      {presets.length ? (
        <div className="model-presets" aria-label={`${title}预设`}>
          {presets.map((preset) => (
            <button className="tool-button" key={preset.model} type="button" onClick={() => onApplyPreset?.(preset)}>
              {preset.label}
            </button>
          ))}
        </div>
      ) : null}
      <SettingsField label="Base URL" value={runtime.baseUrl} placeholder="http://127.0.0.1:8129/v1" onChange={(value) => onChange("baseUrl", value)} />
      <SettingsField label="模型名称" value={runtime.model} placeholder="qwen3.6-35b-a3b" onChange={(value) => onChange("model", value)} />
      <SettingsField
        label="API Key"
        type={apiKeyMultiline ? "textarea" : "password"}
        value={runtime.apiKey}
        placeholder={apiKeyPlaceholder}
        hint={apiKeyHint}
        onChange={(value) => onChange("apiKey", value)}
      />
      {onProxyChange ? (
        <SettingsField
          label="代理地址（可选）"
          value={proxyUrl}
          placeholder="http://127.0.0.1:7890"
          hint="仅云端 AI 请求使用；本地模型始终直连。"
          onChange={onProxyChange}
        />
      ) : null}
    </section>
  );
}

function SettingsField({ label, value, placeholder, hint = "", type = "text", onChange }) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      {type === "textarea" ? (
        <textarea value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} rows={5} autoComplete="off" spellCheck={false} />
      ) : (
        <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} autoComplete="off" />
      )}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function mergeModelConfig(data = {}) {
  return {
    provider: data.provider === "cloud" ? "cloud" : "local",
    proxyUrl: String(data.proxyUrl || ""),
    local: { ...emptyModelConfig.local, ...(data.local || {}) },
    cloud: { ...emptyModelConfig.cloud, ...(data.cloud || {}), apiKey: formatApiKeysForEditor(data.cloud?.apiKey) },
    embedding: { ...emptyModelConfig.embedding, ...(data.embedding || {}) },
  };
}

function formatApiKeysForEditor(value = "") {
  return String(value || "")
    .split(/\r?\n|\\n|[,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");
}

export default SystemSettings;
