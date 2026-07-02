import React, { useEffect, useState } from "react";
import { Check, CircleAlert, Database, Loader2, Save, Settings, Sparkles } from "lucide-react";

const emptyModelConfig = {
  provider: "local",
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
    fetch("/api/settings/model")
      .then((response) => {
        if (!response.ok) throw new Error("读取模型配置失败");
        return response.json();
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
      const response = await fetch("/api/settings/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "保存模型配置失败");
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
      const response = await fetch("/api/settings/model/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, config }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "连接测试失败");
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
          desc="适配 DeepSeek、OpenAI-compatible 云服务。"
          runtime={config.cloud}
          active={config.provider === "cloud"}
          onChange={(key, value) => updateSection("cloud", key, value)}
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

function ModelRuntimeCard({ title, desc, runtime, active, onChange }) {
  return (
    <section className={active ? "settings-card active" : "settings-card"}>
      <div className="settings-card-title">
        <Sparkles size={18} />
        <div>
          <h3>{title}</h3>
          <span>{desc}</span>
        </div>
      </div>
      <SettingsField label="Base URL" value={runtime.baseUrl} placeholder="http://127.0.0.1:8129/v1" onChange={(value) => onChange("baseUrl", value)} />
      <SettingsField label="模型名称" value={runtime.model} placeholder="qwen3.6-35b-a3b" onChange={(value) => onChange("model", value)} />
      <SettingsField label="API Key" type="password" value={runtime.apiKey} placeholder="本地服务可留空，云端必填" onChange={(value) => onChange("apiKey", value)} />
    </section>
  );
}

function SettingsField({ label, value, placeholder, type = "text", onChange }) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} autoComplete="off" />
    </label>
  );
}

function mergeModelConfig(data = {}) {
  return {
    provider: data.provider === "cloud" ? "cloud" : "local",
    local: { ...emptyModelConfig.local, ...(data.local || {}) },
    cloud: { ...emptyModelConfig.cloud, ...(data.cloud || {}) },
    embedding: { ...emptyModelConfig.embedding, ...(data.embedding || {}) },
  };
}

export default SystemSettings;
